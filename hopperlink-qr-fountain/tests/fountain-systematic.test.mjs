import test from 'node:test';
import assert from 'node:assert/strict';
import {FountainEncoder,FountainDecoder,framePlan} from '../fountain.js';
import {parsePacket} from '../protocol.js';

function bytes(n){const a=new Uint8Array(n);for(let i=0;i<n;i++)a[i]=(i*73+(i>>3)*19)&255;return a;}

test('systematic plan yields four direct blocks per five frames',()=>{
  const kinds=Array.from({length:10},(_,i)=>framePlan(i,100).systematic);
  assert.deepEqual(kinds,[true,true,true,true,false,true,true,true,true,false]);
});

test('first 100 frames solve at least 80 source blocks without loss',()=>{
  const stream=bytes(515*280-37),enc=new FountainEncoder(stream,280,0x12345678);
  let dec=null;
  for(let seq=0;seq<100;seq++){
    const p=parsePacket(enc.frame(seq));
    if(!dec)dec=new FountainDecoder(p);
    dec.ingest(p);
  }
  assert.ok(dec.progress().solved>=80,dec.progress());
});

test('systematic + fountain recovers complete stream with deterministic 25% erasure',()=>{
  const stream=bytes(515*280-37),enc=new FountainEncoder(stream,280,0x5a17c0de);
  let dec=null;
  for(let seq=0;seq<4000;seq++){
    if(seq%4===0)continue;
    const p=parsePacket(enc.frame(seq));
    if(!dec)dec=new FountainDecoder(p);
    dec.ingest(p);
    if(dec.progress().complete)break;
  }
  assert.ok(dec?.progress().complete,dec?.progress());
  assert.deepEqual(dec.assemble(),stream);
});
