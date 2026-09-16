import {spectralFeatures} from './audio-codec.js';
class HopperAudioSampler extends AudioWorkletProcessor{
 constructor(){super();this.size=Math.round(sampleRate*.010);this.hop=Math.round(sampleRate*.005);this.buffer=new Float32Array(this.size);this.count=0;this.until=0;this.samples=0;}
 process(inputs,outputs){const input=inputs[0]?.[0];if(input)for(const x of input){this.buffer[this.count++]=x;this.samples++;if(this.count===this.size){this.port.postMessage({t:(this.samples-this.size/2)/sampleRate,features:spectralFeatures(this.buffer,sampleRate)});this.buffer.copyWithin(0,this.hop);this.count=this.size-this.hop;}}for(const output of outputs)for(const channel of output)channel.fill(0);return true;}
}
registerProcessor('hopper-audio-sampler',HopperAudioSampler);
