export const BANDS=[[1400,1800,2200,2600],[2300,2700,3100,3500],[3500,3900,4300,4700]];
export const AUDIO={TRAIN:1,REPORT:2,READY:3,COMPLETE:4,SLOW:5,STATUS:6};
export const SYMBOL_SECONDS=.020;
export const PREAMBLE=[0,3,0,3,1,2,1,2,3,0,2,0,1,3,2,1,0,2,3,1];
export const PACKET_BYTES=20;
export const SOUND_SECONDS=(PREAMBLE.length+PACKET_BYTES*6)*SYMBOL_SECONDS+.04;
export function crc16(a){let c=0xffff;for(const b of a){c^=b<<8;for(let k=0;k<8;k++)c=c&0x8000?(c<<1)^0x1021:c<<1;c&=65535;}return c;}
export function packAudio({type,band=0,sid,seq=0,arg0=0,arg1=0,token=0}){
 const b=new Uint8Array(20),v=new DataView(b.buffer);b.set([0xa7,1,type,band]);v.setUint32(4,sid);v.setUint16(8,seq);v.setUint16(10,arg0);v.setUint32(12,arg1);v.setUint16(16,token);v.setUint16(18,crc16(b.subarray(0,18)));return b;
}
export function unpackAudio(b){if(b.length!==20||b[0]!==0xa7||b[1]!==1||b[2]<1||b[2]>6||b[3]>2)return null;const v=new DataView(b.buffer,b.byteOffset,b.length);if(crc16(b.subarray(0,18))!==v.getUint16(18))return null;return{type:b[2],band:b[3],sid:v.getUint32(4),seq:v.getUint16(8),arg0:v.getUint16(10),arg1:v.getUint32(12),token:v.getUint16(16)};}
export function encodeHamming(bytes){const out=[];for(const b of bytes){const a=new Uint8Array(13);let j=7;for(let i=1;i<=12;i++)if((i&(i-1))!==0)a[i]=b>>j--&1;for(const parity of [1,2,4,8])for(let i=1;i<=12;i++)if(i!==parity&&(i&parity))a[parity]^=a[i];out.push(...a.subarray(1));}return out;}
export function decodeHamming(bits){if(bits.length%12)return null;const out=new Uint8Array(bits.length/12);for(let k=0;k<out.length;k++){const a=[0,...bits.slice(k*12,k*12+12)];let err=0;for(let i=1;i<=12;i++)if(a[i])err^=i;if(err>12)return null;if(err)a[err]^=1;let b=0;for(let i=1;i<=12;i++)if((i&(i-1))!==0)b=(b<<1)|a[i];out[k]=b;}return out;}
export function audioSymbols(packet){const bits=encodeHamming(packAudio(packet)),s=[...PREAMBLE];for(let i=0;i<bits.length;i+=2)s.push((bits[i]<<1)|bits[i+1]);return s;}
export function synthesize(packet,sampleRate=48000,gain=.12){
 const symbols=audioSymbols(packet),n=Math.round(SYMBOL_SECONDS*sampleRate),lead=Math.round(.02*sampleRate),out=new Float32Array(lead*2+n*symbols.length),ramp=Math.max(1,Math.round(.002*sampleRate));
 symbols.forEach((s,j)=>{const f=BANDS[packet.band||0][s];for(let i=0;i<n;i++){const edge=Math.min(1,i/ramp,(n-1-i)/ramp),envelope=.5-.5*Math.cos(Math.PI*Math.max(0,edge));out[lead+j*n+i]=Math.sin(2*Math.PI*f*i/sampleRate)*gain*envelope;}});return out;
}
export function spectralFeatures(samples,sampleRate){let rms=0;for(const x of samples)rms+=x*x;rms/=samples.length;
 return BANDS.map(tones=>{const energies=tones.map(f=>{const coeff=2*Math.cos(2*Math.PI*f/sampleRate);let s0=0,s1=0,s2=0;for(let i=0;i<samples.length;i++){const w=.5-.5*Math.cos(2*Math.PI*i/(samples.length-1));s0=samples[i]*w+coeff*s1-s2;s2=s1;s1=s0;}return Math.max(0,s1*s1+s2*s2-coeff*s1*s2)/(samples.length*samples.length);});const ordered=energies.map((e,i)=>[e,i]).sort((a,b)=>b[0]-a[0]),margin=10*Math.log10((ordered[0][0]+1e-12)/(ordered[1][0]+1e-12));return {symbol:rms>1e-8&&margin>3?ordered[0][1]:-1,margin,rms,energy:ordered[0][0]};});
}
// Timing recovery is required: independent capture and playback clocks do not
// necessarily deliver the same effective symbol period. A preamble is only a
// candidate; only a complete versioned packet with valid CRC is accepted.
export class AudioDecoder{
 constructor(onPacket){this.onPacket=onPacket;this.reset();}
 sample(when,band){
  let lo=0,hi=this.samples.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(this.samples[mid].t<when)lo=mid+1;else hi=mid;}
  let best=null,d=.009;
  for(const i of [lo-1,lo]){const a=this.samples[i];if(a&&Math.abs(a.t-when)<d){d=Math.abs(a.t-when);best=a.features[band];}}
  return best;
 }
 preamble(start,period,band){let match=0,margin=0;
  for(let i=0;i<PREAMBLE.length;i++){const f=this.sample(start+i*period,band);if(f?.symbol===PREAMBLE[i]){match++;margin+=f.margin;}}
  return {match,margin:margin/PREAMBLE.length};
 }
 recover(candidate){
  const rates=[0,.0025,-.0025,.005,-.005,.0075,-.0075,.01,-.01,.0125,-.0125,.015,-.015];
  const phases=[0,.0025,-.0025,.005,-.005,.0075,-.0075,.01,-.01,.0125,.015];
  for(const rate of rates)for(const phase of phases){
   const period=SYMBOL_SECONDS*(1+rate),start=candidate.start+phase,proof=this.preamble(start,period,candidate.band);
   if(proof.match<PREAMBLE.length-2)continue;
   const bits=[];let invalid=0;
   for(let j=0;j<PACKET_BYTES*6;j++){const f=this.sample(start+(PREAMBLE.length+j)*period,candidate.band);if(!f||f.symbol<0)invalid++;const s=f?.symbol>=0?f.symbol:0;bits.push(s>>1,s&1);}
   if(invalid>8)continue;
   const bytes=decodeHamming(bits),packet=bytes&&unpackAudio(bytes);
   if(packet&&packet.band===candidate.band)return {...packet,margin:proof.margin,symbolPeriod:period};
  }
  return null;
 }
 push(t,features){
  if(!Number.isFinite(t)||!Array.isArray(features)||features.length!==3)return;
  if(this.samples.length&&t<=this.samples[this.samples.length-1].t)return;
  this.samples.push({t,features});while(this.samples.length&&this.samples[0].t<t-5)this.samples.shift();
  for(let band=0;band<3;band++){
   const start=t-(PREAMBLE.length-1)*SYMBOL_SECONDS;if(start-this.lastStart[band]<.15)continue;
   const proof=this.preamble(start,SYMBOL_SECONDS,band);
   if(proof.match>=PREAMBLE.length-1){this.pending.push({start,band});this.lastStart[band]=start;}
  }
  if(this.pending.length>12)this.pending.splice(0,this.pending.length-12);
  const total=PREAMBLE.length+PACKET_BYTES*6;
  for(let i=this.pending.length-1;i>=0;i--){const p=this.pending[i];
   // Wait for the slowest supported clock plus phase guard, not merely the
   // nominal last symbol (which can truncate the packet being decoded).
   if(t<p.start+(total-1)*SYMBOL_SECONDS*1.015+.024)continue;
   this.pending.splice(i,1);const packet=this.recover(p);if(!packet)continue;
   const key=[packet.type,packet.band,packet.sid,packet.seq,packet.arg0,packet.arg1,packet.token].join(':');
   if(this.accepted.has(key)&&t-this.accepted.get(key)<1)continue;
   this.accepted.set(key,t);for(const [k,seen] of this.accepted)if(t-seen>10)this.accepted.delete(k);
   this.onPacket(packet);
  }
 }
 reset(){this.samples=[];this.pending=[];this.lastStart=[-10,-10,-10];this.accepted=new Map();}
}
