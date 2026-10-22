// Reproduce: the REVIEWED preprocessing code on (1) a minimal synthetic record with an address.other array.
const mod = await import(process.argv[2]);
try {
  const stats = await mod.preprocessDump(process.argv[3], process.argv[4], process.argv[5], 'seyra-release-repro');
  console.log('OK', JSON.stringify(stats));
} catch (e) { console.log('ERROR', e.constructor.name, e.message); process.exitCode = 1; }
