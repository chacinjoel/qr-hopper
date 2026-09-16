import test from 'node:test';
import assert from 'node:assert/strict';
import {AdaptiveTracker,render} from '../optics.js';
import {bootstrap,controlBytes,readControl} from '../protocol.js';
import {CalibrationReceiver,createTrial} from '../calibration.js';
import {RasterCanvas} from './raster.mjs';
function tracker(){const t=Object.create(AdaptiveTracker.prototype);Object.assign(t,{lastProfile:0,expectedProfile:null,headerMisses:0,partial:new Map(),stats:{headers:0,valid:0,crcFailed:0,motion:0,sectorsValid:0,sectorsFailed:0,sectorAssemblies:0}});return t;}
function hello(){const c=new RasterCanvas();render(c,{kind:2,payload:controlBytes({op:'hello',sid:42,epoch:1,serial:1,audio:-1,mode:'quick'})},bootstrap,42);return c;}
test('receiver regression: globally detected low-chroma beacons survive fine refinement and decode HELLO',()=>{
 const c=hello();for(let i=0;i<c.data.length;i+=4)for(let k=0;k<3;k++)c.data[i+k]=Math.round(c.data[i+k]*.35+60);
 const t=tracker(),found=t.detectBeacons(c.data,c.width,c.height,null);assert(found,'legacy acquisition must find the pattern');
 const refined=t.refine(c.data,c.width,c.height,found.quad);assert(refined,'fine refinement must not throw away a valid acquisition');
 const d=t.decodeAdaptive(c.data,c.width,c.height,refined);assert(d?.crcOK);assert.equal(readControl(d)?.op,'hello');
});
test('receiver regression: starting after HELLO joins the next validated AUDIO/TRIAL control',()=>{
 for(const first of [{op:'audio',index:0,band:0},{op:'trial',pid:1,round:0}]){
  const events=[],r=new CalibrationReceiver(e=>events.push(e));assert(r.control({...first,sid:42,epoch:1,serial:4,audio:-1},5000));
  assert.equal(r.sid,42);assert(events.some(e=>e.type==='session-acquired'&&e.late));
  r.control({op:'trial',sid:42,epoch:1,serial:5,pid:1,round:0,audio:-1},5500);assert.equal(r.trial.pid,1);
 }
});
test('receiver regression: a missed profile announcement cannot permanently restrict header decoding',()=>{
 const t=tracker();t.expectedProfile=1;t.lastProfile=1;
 const {p,transport:tr}=createTrial(45,7,0),c=new RasterCanvas();render(c,{...tr.frames[0],kind:3,round:0},p,45,0,tr.frames.length,tr.streamLength);
 const centres=[[90,90],[p.cols*10-90,90],[p.cols*10-90,p.rows*10-90],[90,p.rows*10-90]].map(([x,y])=>({x,y}));
 let d;for(let i=0;i<3;i++)d=t.decodeAdaptive(c.data,c.width,c.height,centres)||d;
 assert(d?.crcOK);assert.equal(d.header.profileId,7);assert.equal(t.expectedProfile,7);assert(t.stats.profileReacquires>0);
});
test('receiver regression: blank input never keeps stale local tracking alive',()=>{
 const c=hello(),t=tracker(),found=t.detectBeacons(c.data,c.width,c.height,null);assert(found);c.data.fill(0);
 assert.equal(t.refine(c.data,c.width,c.height,found.quad),null);
 assert.equal(t.detectBeacons(c.data,c.width,c.height,found.quad),null);
});
test('receiver regression: new reception clears optical profile, timing and partial-sector hints',()=>{
 const t=tracker();t.rawQuad=[1];t.visibleQuad=[1];t.expectedProfile=10;t.lastProfile=10;t.lastSeen=900;t.headerMisses=7;t.partial.set('old',{});
 t.resetAcquisition();assert.equal(t.expectedProfile,null);assert.equal(t.lastProfile,0);assert.equal(t.rawQuad,null);assert.equal(t.partial.size,0);
});
test('receiver regression: non-session control cannot claim a new receiver session',()=>{
 const r=new CalibrationReceiver();assert.equal(r.control({op:'offer',sid:44,epoch:1,serial:5,chosen:1},100),false);assert.equal(r.sid,0);
});
