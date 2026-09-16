import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioDecoder,AUDIO,synthesize,spectralFeatures} from '../audio-codec.js';

test('REPORT/READY/COMPLETE survive independent clock drift and timing phase at 44.1/48 kHz',()=>{
 for(const sr of [44100,48000])for(const factor of [.99,1,1.01])for(const type of [AUDIO.REPORT,AUDIO.READY,AUDIO.COMPLETE]){
  const band=(type-2)%3,packet={type,band,sid:3486976648,seq:2,arg0:2,arg1:4184419382,token:9};
  const waveform=synthesize(packet,sr,.12),offset=Math.round(sr*.0637),length=Math.ceil(waveform.length*factor),input=new Float32Array(offset+length+Math.round(sr*.20));
  for(let i=0;i<length-1;i++){const x=i/factor,j=Math.floor(x),f=x-j;input[offset+i]=(waveform[j]||0)*(1-f)+(waveform[j+1]||0)*f;}
  const got=[],decoder=new AudioDecoder(p=>got.push(p)),window=Math.round(sr*.010),hop=Math.round(sr*.005);
  for(let i=0;i+window<=input.length;i+=hop)decoder.push((i+window/2)/sr,spectralFeatures(input.subarray(i,i+window),sr));
  assert(got.some(p=>p.sid===packet.sid&&p.arg1===packet.arg1&&p.type===type),`sr=${sr}, factor=${factor}, type=${type}`);
  assert.equal(got.length,1,'one packet must not produce duplicate state transitions');
 }
});
