// Diagnostic: browser-like tile load through the ingress (6 parallel clients, z4-z11 around Tehran)
// for 60 s while /api/v1/map/health is polled every 500 ms; records provider status transitions.
const base = 'https://127.0.0.1:8443';
const caps = await (await fetch(`${base}/api/v1/map/capabilities`)).json();
const tpl = caps.map.tiles;
const xy = (lon, lat, z) => { const n = 2 ** z; const r = (lat * Math.PI) / 180; return [Math.floor(((lon + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)]; };
const tiles = [];
for (const z of [4, 5, 6, 7, 8, 9, 10, 11]) { const [cx, cy] = xy(51.39, 35.69, z); for (let dx = -2; dx <= 2; dx++) for (let dy = -1; dy <= 1; dy++) tiles.push([z, cx + dx, cy + dy]); }
const end = Date.now() + 60_000; let done = 0, bad = {}, maxMs = 0;
const worker = async () => { let i = Math.floor(Math.random() * tiles.length); while (Date.now() < end) { const [z, x, y] = tiles[i++ % tiles.length]; const t = performance.now(); try { const r = await fetch(base + tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y)); await r.arrayBuffer(); if (r.status >= 400) bad[r.status] = (bad[r.status] ?? 0) + 1; } catch (e) { bad.err = (bad.err ?? 0) + 1; } maxMs = Math.max(maxMs, performance.now() - t); done++; } };
const events = []; let last = '';
const poll = async () => { while (Date.now() < end + 5000) { try { const h = await (await fetch(`${base}/api/v1/map/health`)).json(); const s = h.status + ' ' + h.providers.map((p) => `${p.provider}:${p.status}${p.error ? '(' + p.error.slice(0, 90) + ')' : ''}`).join(' '); if (s !== last) { events.push(`${new Date().toISOString()} ${s}`); last = s; } } catch (e) { events.push(`${new Date().toISOString()} health fetch error ${e.message}`); } await new Promise((r) => setTimeout(r, 500)); } };
await Promise.all([poll(), ...Array.from({ length: 6 }, worker)]);
console.log(JSON.stringify({ tile_requests: done, tile_errors: bad, max_tile_ms: Math.round(maxMs), health_transitions: events }, null, 1));
