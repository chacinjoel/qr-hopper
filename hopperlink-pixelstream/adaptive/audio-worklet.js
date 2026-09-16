// Self-contained worklet: no secondary module fetch can delay registration.
// The same spectral algorithm is regression-tested in audio-codec.js.
const BANDS=[[1400,1800,2200,2600],[2300,2700,3100,3500],[3500,3900,4300,4700]];
// Precompute the Hann window and Goertzel coefficients outside the render path.
// This keeps identical spectral mathematics without thousands of Math.cos calls
// in each 5 ms audio deadline while the camera is being decoded.
const size = Math.round(sampleRate * .010);
const windowWeights = Float64Array.from({length:size}, (_,i)=>.5-.5*Math.cos(2*Math.PI*i/(size-1)));
const coefficients = BANDS.map(tones=>tones.map(f=>2*Math.cos(2*Math.PI*f/sampleRate)));
const weighted = new Float64Array(size);
function spectralFeatures(samples,sr){
 let rms=0;for(let i=0;i<samples.length;i++){const x=samples[i];rms+=x*x;weighted[i]=x*windowWeights[i];}rms/=samples.length;
 return coefficients.map(tones=>{
  const energies=tones.map(coeff=>{let s1=0,s2=0;for(let i=0;i<samples.length;i++){const s0=weighted[i]+coeff*s1-s2;s2=s1;s1=s0;}return Math.max(0,s1*s1+s2*s2-coeff*s1*s2)/(samples.length*samples.length);});
  const ordered=energies.map((e,i)=>[e,i]).sort((a,b)=>b[0]-a[0]),margin=10*Math.log10((ordered[0][0]+1e-12)/(ordered[1][0]+1e-12));
  return {symbol:rms>1e-8&&margin>3?ordered[0][1]:-1,margin,rms,energy:ordered[0][0]};
 });
}
class HopperAudioSampler extends AudioWorkletProcessor{
 constructor(){super();this.size=Math.round(sampleRate*.010);this.hop=Math.round(sampleRate*.005);this.buffer=new Float32Array(this.size);this.count=0;this.samples=0;}
 process(inputs,outputs){const input=inputs[0]?.[0];if(input)for(const x of input){this.buffer[this.count++]=x;this.samples++;if(this.count===this.size){this.port.postMessage({t:(this.samples-this.size/2)/sampleRate,features:spectralFeatures(this.buffer,sampleRate)});this.buffer.copyWithin(0,this.hop);this.count=this.size-this.hop;}}for(const output of outputs)for(const channel of output)channel.fill(0);return true;}
}
registerProcessor('hopper-audio-sampler',HopperAudioSampler);
