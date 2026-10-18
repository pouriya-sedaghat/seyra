// Read-only scan of a Nominatim->Photon dump: report name/address/housenumber values that are not strings.
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
const rl = createInterface({ input: createReadStream(process.argv[2], { encoding: 'utf8' }), crlfDelay: Infinity });
let lines = 0, places = 0, firstLine = null; const byPath = {}; const samples = [];
const types = {}; let header = null;
for await (const line of rl) {
  lines++;
  if (!line.trim()) continue;
  const doc = JSON.parse(line);
  types[doc.type] = (types[doc.type] ?? 0) + 1;
  if (doc.type === 'NominatimDumpFile') header = doc.content;
  if (doc.type !== 'Place') continue;
  for (const c of Array.isArray(doc.content) ? doc.content : [doc.content]) {
    places++;
    for (const f of ['name', 'address']) for (const [k, v] of Object.entries(c[f] ?? {})) {
      if (typeof v !== 'string') {
        const key = `${f}.${k}:${Array.isArray(v) ? 'array' : typeof v}`;
        byPath[key] = (byPath[key] ?? 0) + 1;
        firstLine ??= lines;
        if (samples.length < 4) samples.push({ line: lines, place_id: c.place_id, osm: `${c.object_type}${c.object_id}`, osm_key: c.osm_key, osm_value: c.osm_value, field: f, key: k, value: v });
      }
    }
    if (c.housenumber !== undefined && typeof c.housenumber !== 'string') { const key = `housenumber:${typeof c.housenumber}`; byPath[key] = (byPath[key] ?? 0) + 1; }
  }
}
console.log(JSON.stringify({ lines, places, doc_types: types, header, first_offending_line: firstLine, non_string_by_path: byPath, samples }, null, 1));
