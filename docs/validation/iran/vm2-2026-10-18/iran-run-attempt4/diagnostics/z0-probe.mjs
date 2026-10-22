// Diagnostic (container on seyra_backend): time Tegola's z0 tile, which the readiness probe fetches,
// idle and while 6 clients request uncached low-zoom tiles directly and abandon them after 800 ms.
const tegola = 'http://tegola:8080';
const caps = await (await fetch(`${tegola}/capabilities`)).json();
const map = caps.maps.find((m) => m.name.startsWith('seyra_')).name;
const z0 = async () => { const t = performance.now(); try { const r = await fetch(`${tegola}/maps/${map}/0/0/0.pbf`, { signal: AbortSignal.timeout(5000) }); const b = await r.arrayBuffer(); return { ms: Math.round(performance.now() - t), status: r.status, bytes: b.byteLength }; } catch (e) { return { ms: Math.round(performance.now() - t), error: String(e.name) }; } };
const idle = []; for (let i = 0; i < 5; i++) idle.push(await z0());
const end = Date.now() + 45_000; let n = 0;
const load = async (seed) => { let k = seed; while (Date.now() < end) { const z = 3 + (k % 5); const N = 2 ** z; const x = Math.floor(N * (0.62 + 0.05 * ((k * 7) % 5))) % N; const y = Math.floor(N * (0.37 + 0.03 * ((k * 3) % 4))) % N; k += 6; const c = new AbortController(); const t = setTimeout(() => c.abort(), 800); try { const r = await fetch(`${tegola}/maps/${map}/${z}/${x}/${y}.pbf?nocache=${k}`, { signal: c.signal }); await r.arrayBuffer(); } catch {} clearTimeout(t); n++; } };
const busy = []; const probe = async () => { while (Date.now() < end) { busy.push(await z0()); await new Promise((r) => setTimeout(r, 1000)); } };
await Promise.all([probe(), ...Array.from({ length: 6 }, (_, i) => load(i))]);
console.log(JSON.stringify({ map, idle, under_load: { tile_requests: n, probes: busy.length, ms: busy.map((b) => b.ms), failures: busy.filter((b) => b.error || b.status !== 200) } }));
