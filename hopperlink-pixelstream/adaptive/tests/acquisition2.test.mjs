import test from 'node:test';
import assert from 'node:assert/strict';
import {centreSpot,videoFrameKey,acquisitionMessage} from '../acquisition.js';
import {AdaptiveTracker,render} from '../optics.js';
import {bootstrap,finderCenters} from '../protocol.js';
import {RasterCanvas} from './raster.mjs';
test('RX2: presented frames advance even when mediaTime is unchanged',()=>{
 const v={currentTime:0};
 assert.notEqual(videoFrameKey(v,{mediaTime:0,presentedFrames:1}),videoFrameKey(v,{mediaTime:0,presentedFrames:2}));
 assert.equal(videoFrameKey(v,{mediaTime:0,presentedFrames:2}),'presented:2');
 assert.equal(videoFrameKey({currentTime:2,getVideoPlaybackQuality:()=>({totalVideoFrames:25})}),'decoded:25');
 assert.equal(videoFrameKey({currentTime:3}),'time:3');
 assert.equal(videoFrameKey({currentTime:NaN}),null);
});
test('RX2: large idle rings locate centres without pretending to decode a payload',()=>{
 const c=new RasterCanvas();render(c,null,bootstrap,0);
 for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const o=(y*c.width+x)*4;for(let k=0;k<3;k++)c.data[o+k]=Math.round(c.data[o+k]*(y<c.height/2?.65:1)+20);}
 const t=Object.create(AdaptiveTracker.prototype);Object.assign(t,{lastProfile:0,expectedProfile:null,stats:{},partial:new Map()});
 const found=t.detectBeacons(c.data,c.width,c.height);assert(found);
 const q=t.refine(c.data,c.width,c.height,found.quad);
 const expected=finderCenters(bootstrap).map(p=>({x:p.x*10-.5,y:p.y*10-.5}));
 for(let i=0;i<4;i++)assert(Math.hypot(q[i].x-expected[i].x,q[i].y-expected[i].y)<1);
 assert.equal(t.decodeAdaptive(c.data,c.width,c.height,q),null);
});
test('RX2: a uniform or blank scene has no valid centre spot',()=>{
 for(const v of [0,60,180,255]){const data=new Uint8ClampedArray(60*60*4).fill(v);assert.equal(centreSpot(data,60,60,{x:30,y:30},6),null);}
});
test('RX2: distinguish idle detected screen, packets, no area and stalled video',()=>{
 assert.match(acquisitionMessage({lock:.99,beacons:4,lastPacketAge:Infinity}),/esperando Calibrar/);
 assert.match(acquisitionMessage({lock:.99,lastPacketAge:10}),/leyendo mensajes/);
 assert.match(acquisitionMessage({lock:0}),/Buscando/);
 assert.match(acquisitionMessage({lock:1,stalled:true}),/no entrega cuadros nuevos/);
});
