// Targeted reviewer checks for the attached nine-commit patch ending at 82942c1.
// Usage: node verify-vm2-geocoder.mjs BASE_CHECKOUT PATCHED_CHECKOUT
// Node 24; no packages, Docker, PBF, network or provider mocks. Executes actual preprocessing
// and actual shared normalization through Node's built-in TypeScript transformer.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync,mkdtempSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { join,resolve } from 'node:path';

const [base,patched]=process.argv.slice(2).map(x=>resolve(x));
const work=mkdtempSync(join(process.cwd(),'seyra-geocoder-review-'));
const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const source=p=>stripTypeScriptTypes(readFileSync(p,'utf8'),{mode:'transform',sourceUrl:p});
async function load(root){const n=url(source(join(root,'packages/contracts/src/normalize.ts')));return import(url(source(join(root,'apps/ops/src/geocoder-preprocess.ts')).replace("from '@seyra/contracts'",'from '+JSON.stringify(n))));}
const old=await load(base),fixed=await load(patched);
const results=[];const pass=(id,detail)=>results.push({id,result:'PASS',detail});
async function run(mod,label,content){const p=join(work,label);writeFileSync(p+'.in',[
 JSON.stringify({type:'NominatimDumpFile',content:{version:'0.1.0',data_timestamp:'2026-10-17T20:14:22Z'}}),
 JSON.stringify({type:'Place',content:Array.isArray(content)?content:[content]})].join('\n'));
 const stats=await mod.preprocessDump(p+'.in',p+'.out',p+'.syn','seyra-release-review');
 return {stats,text:readFileSync(p+'.out','utf8'),docs:readFileSync(p+'.out','utf8').trim().split('\n').map(JSON.parse),syn:JSON.parse(readFileSync(p+'.syn','utf8'))};}
assert.throws(()=>old.collectSynonyms(['محله يك'],new Map()),/normalize is not a function/);
pass('baseline-array-defect','The actual old module crashes on the reported array shape.');
const oldSyn=new Map();old.collectSynonyms('؟ ؟؟؟؟',oldSyn);assert.ok(oldSyn.has('?')&&oldSyn.has('????'));
pass('baseline-symbol-defect','The actual old module emits both reported invalid normalized synonym terms.');

assert.deepEqual(fixed.textValues(['a',null,3,'b',{},['nested']]),['a','b']);
for(const v of [null,undefined,42,{},false])assert.deepEqual(fixed.textValues(v),[]);
pass('text-values','Only strings and direct string array elements are collected; malformed components are ignored.');

const address={city:'شهر نمونه',other:['محله يك','بخش دو'],'other:fa':['محله یک'],'other:en':['District One']};
const a=await run(fixed,'arrays',{name:{name:'کافه نمونه'},address,housenumber:'۱۲',centroid:[51.4,35.7]});
assert.deepEqual(a.docs[1].content[0].address,address);assert.ok(a.syn.search_synonyms.includes('یک,يك'));
assert.equal(a.docs[1].content[0].extra.seyra_name,'کافه نمونه');
assert.equal(a.docs[1].content[0].extra.seyra_housenumber,'۱۲');assert.equal(a.docs[1].content[0].housenumber,'12');
pass('array-fix-preserves-display','Array addresses survive unchanged, their strings contribute synonyms, and original display name/house number are retained.');

const b=await run(fixed,'symbols',{name:{name:'؟؟؟؟'},address:{street:'كوچه ؟',other:['؟','٪','؛','،','ــ']}});
const terms=b.syn.search_synonyms.flatMap(x=>x.split(','));
assert.ok(!terms.includes('?')&&!terms.includes('????')&&!terms.includes('؟')&&!terms.includes('؟؟؟؟'));
assert.ok(b.syn.search_synonyms.includes('کوچه,كوچه'));assert.equal(b.docs[1].content[0].extra.seyra_name,'؟؟؟؟');
pass('symbol-fix','Both reported offending entries disappear; useful Persian synonyms and original display text remain.');

const c=await run(fixed,'mixed',[{name:{name:'داروخانه كوثر'},address:{other:['يك',null,8,'۱۲']}},{name:{name:'آزمايش'},address:{street:'خيابان اصلي'},housenumber:'۱۲'}]);
assert.equal(c.stats.places,2);assert.equal(c.docs.length,3);assert.ok(c.syn.search_synonyms.includes('12,۱۲'));
const marker=c.docs.at(-1).content[0];assert.equal(marker.name.name,'seyra-release-review');assert.deepEqual(marker.categories,['seyra.release_marker']);
assert.equal(marker.extra.seyra_data_timestamp,'2026-10-17T20:14:22Z');
pass('mixed-stream-marker','Multiple places, mixed runtime address elements, digit synonyms and release provenance/marker pass through correctly.');

const corpus=[
 {name:{name:'داروخانه كوثر','name:en':'Kowsar'},address:{street:'خيابان اصلي'},housenumber:'۱۲'},
 {name:{name:'خیابان‌شمالی',old_name:'آزمايشي'},address:{city:'تهران',postcode:'۱۲۳۴۵'}},
 {name:{name:'Cafe No.12-B','name:fa':'کافه دوازده'},address:{city:'Tehran'}},
 {name:{name:'École تهران'},housenumber:'٣٤'},
];
for(let i=0;i<corpus.length;i++){
 const prior=await run(old,'old-'+i,corpus[i]);const after=await run(fixed,'new-'+i,corpus[i]);
 assert.equal(after.text,prior.text);assert.deepEqual(after.syn,prior.syn);assert.deepEqual(after.stats,prior.stats);
 pass('compatibility-'+i,'Byte-identical transformed JSONL and equal synonyms/stats for a previously supported fixture.');
}

const sourceHash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const evidence={reported_head:'82942c1296e638c8715c021fee49aeb7c540a703',base:'9f0d7925eef0d43fc157cdd64b557b962df457a6',node:process.version,checks:results,source_sha256:{geocoder_preprocess:sourceHash(join(patched,'apps/ops/src/geocoder-preprocess.ts')),normalization:sourceHash(join(patched,'packages/contracts/src/normalize.ts'))},limitations:'Targeted actual-code checks only; real Photon analyzer, full PBF and full Docker suites not run by reviewer.'};
const output=join(work,'verification.json');writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({...evidence,evidence:output},null,2));
