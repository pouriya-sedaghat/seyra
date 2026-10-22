// Helpers for tests/browser/swagger-ui.mjs, kept separate so their logic is tested without a browser
// (tests/browser/test-swagger-checks.mjs).

/** A request is external unless its exact origin (scheme, host, port) is the ingress origin; data:
 * and blob: URLs never leave the page; an unparsable URL counts as external. */
export function isExternal(url, origin) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return true;
  }
  if (u.protocol === 'data:' || u.protocol === 'blob:') return false;
  return u.origin !== new URL(origin).origin;
}

/**
 * Open one operation, press "Try it out", then "Execute". Operation requests are counted in two
 * windows: while the operation is opened and at "Try it out" (must be none: Swagger UI must not send
 * anything before Execute), and after Execute (exactly the executed call).
 * `opRequests()` returns the operation requests recorded so far ({url, method}).
 */
export async function tryOutAndExecute(page, opRequests, { tag, operationId, path, method }) {
  const block = page.locator(`#operations-${tag}-${operationId}`);
  const beforeOpen = opRequests().length;
  await block.locator('.opblock-summary').first().click();
  await block.locator('button.try-out__btn').click();
  await page.waitForTimeout(500);
  const beforeExecute = opRequests().slice(beforeOpen);
  const before = opRequests().length;
  const responded = page.waitForResponse((r) => new URL(r.url()).pathname === path && r.request().method() === method.toUpperCase(), { timeout: 60_000 });
  await block.locator('button.execute').click();
  const r = await responded;
  await page.waitForTimeout(500);
  const sent = opRequests()
    .slice(before)
    .filter((x) => new URL(x.url).pathname === path);
  return { status: r.status(), body: await r.json().catch(() => null), sent: sent.length, beforeExecute };
}
