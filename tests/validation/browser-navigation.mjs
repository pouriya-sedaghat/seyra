// Navigation proof for the browser audit (review F3, e7a2175). Finding a matching result card and
// actually reaching that place are separate facts:
//   result_found  the intended area appears in the result list (its rank is an exploratory note)
//   target        the selected card's feature, matched by OSM id to the search API response the
//                 cards were rendered from (so the coordinates come from the data, not the UI)
//   click_error   a rejected click is recorded, never swallowed
//   center_after  the map viewport's center after the click, read through an existing client
//                 interface: with "bias to map view" on, the client sends the current viewport
//                 center as bias_lon/bias_lat on its search request
//   reached       center_after lies within NAV_TOLERANCE_M of the target. A click that changed
//                 nothing still passes only if the viewport was already on the target.
// No product hook is added. The scale bar text is kept only as an informational note.
export const NAV_TOLERANCE_M = 250;
const API_SEARCH = /\/api\/v1\/map\/(search|autocomplete)\?/;

export function distanceM(a, b) {
  const R = 6_371_008.8;
  const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function createNavigator(page, { settle, toleranceM = NAV_TOLERANCE_M, timeoutMs = 15_000 }) {
  const cards = () => page.locator('aside li, aside button.result, aside .result');
  const checkbox = (i) => page.locator('aside input[type=checkbox]').nth(i); // 0 autocomplete, 1 bias
  const textbox = () => page.getByRole('textbox').first();
  const setBox = async (i, on) => {
    const b = checkbox(i);
    if ((await b.isChecked()) !== on) await (on ? b.check() : b.uncheck());
  };

  // Autocomplete off: the result list then comes from exactly one (submitted) search response.
  async function prepare() {
    await setBox(0, false);
    await setBox(1, false);
  }

  async function submitSearch(q) {
    const responded = page.waitForResponse((r) => API_SEARCH.test(r.url()) && new URL(r.url()).searchParams.get('q') === q, { timeout: timeoutMs });
    await textbox().fill(q);
    await textbox().press('Enter');
    const res = await responded;
    const body = await res.json();
    await settle(1500);
    return body.results ?? [];
  }

  /** Current viewport center, or null when the client sent none (e.g. no move event yet). */
  async function viewportCenter() {
    await setBox(1, true);
    try {
      const requested = page.waitForRequest((r) => API_SEARCH.test(r.url()) && new URL(r.url()).searchParams.has('bias_lon'), { timeout: timeoutMs });
      await textbox().press('Enter');
      const u = new URL((await requested).url());
      const c = { lon: Number(u.searchParams.get('bias_lon')), lat: Number(u.searchParams.get('bias_lat')) };
      return Number.isFinite(c.lon) && Number.isFinite(c.lat) ? c : null;
    } catch {
      return null;
    } finally {
      await setBox(1, false);
    }
  }

  async function searchAndOpen(q, expect) {
    const visit = { q, expect, result_found: false, rank_of_expected_area: null, results_listed: 0, target: null, click_error: null, center_after: null, distance_m: null, reached: false, error: null, scale_after_open: null };
    try {
      // Re-assert the preconditions every visit: the client remounts its search panel (resetting
      // autocomplete and bias to on) e.g. when it falls back to its error view during an outage.
      await prepare();
      const results = await submitSearch(q);
      const list = cards();
      const count = await list.count();
      visit.results_listed = count;
      let card = null;
      let text = '';
      for (let i = 0; i < count; i++) {
        text = await list.nth(i).innerText();
        if (text.includes(expect)) {
          visit.rank_of_expected_area = i + 1;
          card = list.nth(i);
          break;
        }
      }
      if (!card) return visit;
      visit.result_found = true;
      const hit = results.find((r) => r.id && text.includes(r.id));
      if (!hit) {
        visit.error = 'the selected card matches no result id of the search response';
        return visit;
      }
      visit.target = { id: hit.id, lon: hit.coordinate.lon, lat: hit.coordinate.lat };
      try {
        await card.click({ timeout: timeoutMs });
      } catch (e) {
        visit.click_error = String(e?.message ?? e).split('\n')[0].slice(0, 200);
        return visit;
      }
      await settle(4500); // the client flies to the selected feature
      for (let attempt = 0; attempt < 3 && !visit.reached; attempt++) {
        if (attempt) await page.waitForTimeout(1500);
        const c = await viewportCenter();
        visit.center_after = c;
        if (!c) continue;
        visit.distance_m = Math.round(distanceM(c, visit.target));
        visit.reached = visit.distance_m <= toleranceM;
      }
      visit.scale_after_open = await page.locator('.maplibregl-ctrl-scale').first().innerText().catch(() => null);
    } catch (e) {
      visit.error = String(e?.message ?? e).split('\n')[0].slice(0, 200);
    }
    return visit;
  }

  return { prepare, searchAndOpen, viewportCenter, toleranceM };
}
