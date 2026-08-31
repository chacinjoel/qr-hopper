(() => {
'use strict';
const md=navigator.mediaDevices;
if(!md?.getUserMedia||md.__hopperFallbackInstalled)return;
const native=md.getUserMedia.bind(md);
md.getUserMedia=async constraints=>{
  try{return await native(constraints);}catch(first){
    const video=constraints?.video;
    if(!video||video===true)throw first;
    try{
      return await native({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
    }catch{
      try{return await native({video:{facingMode:{ideal:'environment'}},audio:false});}
      catch{throw first;}
    }
  }
};
md.__hopperFallbackInstalled=true;
window.__hopperCameraFallback={version:'0.6.0',active:true,profiles:['requested','1280x720','environment-default']};
})();