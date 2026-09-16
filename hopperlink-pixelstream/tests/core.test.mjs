import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareTransfer,DownloadSession,metadataSchedule,estimateTransmission} from '../src/transfer-metrics.js';
import {buildTransport,buildFrameSchedule} from '../src/superstream.js';
import {resolveProfile,HDP} from '../src/optical2.js';
import {crc32} from '../src/crc32.js';
import {encodeFeedback,decodeFeedback,feedbackText,parseFeedbackText,feedbackChips,FlashDecoder,FLASH_HALF_MS,FLASH_MESSAGE_MS,repairIndices,REPAIR_ALL,COMPLETE} from '../src/feedback.js';
import {controlFrame,parseControl} from '../src/control-frame.js';

function decoded(f,t) {return {header:{...f,k:t.k,r:t.r,payloadLen:f.payload.length,streamLength:t.streamLength,crc:crc32(f.payload)},payload:f.payload};}
function fixture(n=9000,name='foto.png') {const bytes=Uint8Array.from({length:n},(_,i)=>(i*113+(i>>7)*71)&255);return {bytes,file:new File([bytes],name)};}
async function prepared(n=9000,name='foto.png',mode='robust') {const f=fixture(n,name),p=await prepareTransfer(f.file),profile=resolveProfile(mode,'64x96'),t=buildTransport(p.stream,profile);return {...f,p,t,profile};}

test('metadata early, unchanged bytes, Unicode and HTML-like name remain literal',async()=>{
 const {bytes,p,t}=await prepared(12000,'foto <b>Maracaibo</b> 🪐.png'),s=new DownloadSession();
 for(const i of metadataSchedule(t,p.metadataBytes))s.ingest(decoded(t.frames[i],t),1000);
 assert.equal(s.meta.name,p.meta.name);assert.equal(s.meta.linkId,p.meta.linkId);assert.ok(!s.metrics(1500).verified);
 for(const i of buildFrameSchedule(t))s.ingest(decoded(t.frames[i],t),2000+i*50);
 assert.equal(s.metrics(10000).percent,99.9);const result=await s.verify(()=>11000);
 assert.deepEqual(result.data,bytes);assert.equal(s.metrics(12000).percent,100);assert.equal(s.metrics(13000).elapsed,s.metrics(12000).elapsed);
});
test('duplicate, parity and padding do not inflate unique useful byte count',async()=>{
 const {p,t}=await prepared(1800),s=new DownloadSession(),f=decoded(t.frames[0],t);
 s.ingest(f,0);const n=s.metrics(1000).bytes;for(let i=1;i<=50;i++)s.ingest(f,i*25);
 assert.equal(s.metrics(1500).bytes,n);assert.equal(s.metrics(8000).speed,0);assert.equal(s.metrics(8000).eta,null);
 for(const f of t.frames)s.ingest(decoded(f,t),9000);
 assert.equal(s.metrics(10000).bytes,p.stream.length);assert.equal(s.metrics(10000).percent,99.9);
});
test('FEC reconstruction survives missing systematic frames and final partial group',async()=>{
 for(const mode of ['robust','balanced','turbo']){const {t,bytes}=await prepared(21341,'random.png',mode),s=new DownloadSession();
  for(const i of buildFrameSchedule(t)){const f=t.frames[i];if(f.slot===1||f.slot===2)continue;s.ingest(decoded(f,t),1000+i*50);}
  assert.ok(s.progress().complete);assert.ok(s.recovered>0);assert.deepEqual((await s.verify()).data,bytes);}
});
test('feedback CRC, session binding, exact mask and manual-code round trip',async()=>{
 const {t,p}=await prepared(16000),request={linkId:p.meta.linkId,group:1,mask:0b100101};
 assert.deepEqual(parseFeedbackText(feedbackText(request)),request);const coded=encodeFeedback(request);
 for(let bit=0;bit<80;bit++){const damaged=coded.slice();damaged[bit>>3]^=1<<(bit%8);assert.equal(decodeFeedback(damaged),null);}
 assert.deepEqual(repairIndices(t,request,p.meta.linkId).map(i=>t.frames[i].slot),[0,2,5]);
 assert.throws(()=>repairIndices(t,request,(p.meta.linkId+1)>>>0));
 assert.equal(repairIndices(t,{linkId:p.meta.linkId,group:COMPLETE,mask:0},p.meta.linkId).length,0);
 assert.equal(repairIndices(t,{linkId:p.meta.linkId,group:REPAIR_ALL,mask:0},p.meta.linkId).length,t.dataCount);
});
test('selective repair closes missing group without restarting the download',async()=>{
 const {t,p,bytes}=await prepared(15000),s=new DownloadSession();
 for(const f of t.frames){if(f.group===1 && [1,2,3,4].includes(f.slot))continue;s.ingest(decoded(f,t),1000);}
 assert.ok(!s.progress().complete);const before=s.usefulBytes(),nack={linkId:p.meta.linkId,...s.nextMissing()};
 for(const i of repairIndices(t,nack,p.meta.linkId))s.ingest(decoded(t.frames[i],t),5000);
 assert.ok(s.usefulBytes()>before);assert.deepEqual((await s.verify()).data,bytes);
});
test('compressed and empty files round-trip through the original HXS2 decoder',async()=>{
 for(const file of [new File(['Hopper '.repeat(10000)],'datos.txt'),new File([],'vacío.txt')]){const p=await prepareTransfer(file),t=buildTransport(p.stream,resolveProfile('robust','64x96')),s=new DownloadSession();
 for(const f of t.frames)s.ingest(decoded(f,t),1000);assert.deepEqual((await s.verify()).data,new Uint8Array(await file.arrayBuffer()));}
});
test('reject malformed packet before creating receiver allocation/state',async()=>{
 const {t}=await prepared(),s=new DownloadSession(),d=decoded(t.frames[0],t);
 assert.equal(s.ingest({...d,header:{...d.header,k:0}}),null);assert.equal(s.streamLength,0);
 assert.equal(s.ingest({...d,header:{...d.header,group:60000}}),null);assert.equal(s.streamLength,0);
 assert.equal(s.ingest({...d,header:{...d.header,crc:1}}),null);
});
test('feedback window uses existing optics packet CRC and never enters data assembler',async()=>{
 const {t,p}=await prepared(),c={action:'feedback',linkId:p.meta.linkId,window:1,streamLength:t.streamLength,blockLen:t.blockLen,k:t.k,r:t.r};
 const d=decoded(controlFrame(t,c),t);assert.equal(parseControl(d).linkId,p.meta.linkId);assert.equal(new DownloadSession().ingest(d),null);
 d.payload[6]^=1;assert.equal(parseControl(d),null);
});
test('Flash Manchester decoder: 30/60 fps, clock phase, brightness noise, corrupt rejection',()=>{
 const request={linkId:0x54327891,group:17,mask:5},chips=feedbackChips(request);
 for(const fps of [30,60])for(const phase of [0,7,19]){const out=[],d=new FlashDecoder(p=>out.push(p));
 for(let t=phase;t<FLASH_MESSAGE_MS+1500;t+=1000/fps){const i=Math.floor((t-600)/FLASH_HALF_MS),v=(i>=0&&i<chips.length?chips[i]:0)*180+25+Math.sin(t*.037)*4;d.feed(t,v);}
 assert.deepEqual(out,[request],`fps=${fps} phase=${phase}`);}
 const out=[],d=new FlashDecoder(p=>out.push(p)),bad=chips.slice();bad[100]^=1;
 for(let t=0;t<FLASH_MESSAGE_MS+1000;t+=1000/30){const i=Math.floor((t-600)/FLASH_HALF_MS);d.feed(t,(bad[i]||0)*200+10);}assert.deepEqual(out,[]);
});
test('transmission duration model includes rescues and beacon budget, not fictitious bandwidth',async()=>{
 const {t,p}=await prepared(1048576),schedules=[[...metadataSchedule(t,p.metadataBytes),...buildFrameSchedule(t)],buildFrameSchedule(t,{dataOnly:true,pass:1}),buildFrameSchedule(t,{dataOnly:true,pass:2})];
 const seconds=estimateTransmission(schedules,20,HDP);assert.ok(seconds>200&&seconds<220);assert.ok(estimateTransmission([schedules[0]],20,HDP)<100);
});
test('baseline DATA/FEC/Lighthouse modules are byte-for-byte unchanged',async()=>{
 const {readFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto');
 const files={'crc32.js':'1f820c7447f7520852d30bf11713017c656a8af1','gf256.js':'210b9f836bb25a89cd83c906a923985e45b83700','superstream.js':'d03da1ddd14e78e9a9bcbb06ada1f1d4191f5794','optical2.js':'0816cd7bc5c33d2cd62cada10c4ef75b85d3fa8c','receiver2.js':'8922ea558e9ca0ecefc25c35b39f382f51aac308'};
 for(const [file,sha] of Object.entries(files)){const b=await readFile(new URL('../src/'+file,import.meta.url));const actual=createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');assert.equal(actual,sha,file);}
});
test('reset during SHA-256 verification cannot complete a different download',async()=>{
 const {t}=await prepared(),s=new DownloadSession();for(const f of t.frames)s.ingest(decoded(f,t),0);
 const verification=s.verify();s.reset();await assert.rejects(verification,/reiniciada/);assert.equal(s.verified,false);assert.equal(s.metrics().percent,0);
});
