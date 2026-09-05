/* Local, single-flight optical decoder. No microphone/camera permissions or network uploads. */
'use strict';
importScripts('./anchor-scan.js?v=1400','./src/hopper-one-runtime.js?v=1400');
const scanner=new self.HopperAnchorScan.Scanner();
self.onmessage=({data})=>{
  try {
    const image={width:data.width,height:data.height,data:new Uint8ClampedArray(data.buffer)};
    const result=self.__hopperLinkOneInternals.scanAnchorFrame(scanner,image,data.timestamp);
    self.postMessage({epoch:data.epoch,result});
  } catch(error) {self.postMessage({epoch:data.epoch,error:error?.message||String(error)});}
};
