// Diagnostic: poll /health/ready and /api/v1/map/health every 500 ms for N seconds; log transitions.
const base = 'https://127.0.0.1:8443'; const end = Date.now() + Number(process.argv[2] ?? 120) * 1000;
let last = ''; const ev = []; let polls = 0, not200 = 0;
while (Date.now() < end) {
  polls++;
  try {
    const r = await fetch(`${base}/health/ready`); await r.text(); if (r.status !== 200) not200++;
    const h = await (await fetch(`${base}/api/v1/map/health`)).json();
    const s = `ready=${r.status} ` + h.providers.map((p) => `${p.provider}:${p.status}${p.error ? '(' + p.error.slice(0, 120) + ')' : ''}`).join(' ');
    if (s !== last) { ev.push(`${new Date().toISOString()} ${s}`); last = s; }
  } catch (e) { ev.push(`${new Date().toISOString()} fetch error ${e.message}`); }
  await new Promise((res) => setTimeout(res, 500));
}
console.log(JSON.stringify({ polls, ready_not_200: not200, transitions: ev }, null, 1));
