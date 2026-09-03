(() => {
'use strict';

// One-shot guard for the dynamically generated HPS7 core.
// v0.10.8 keeps the legacy syntax repair + lane photometric normalization,
// and now wires HPS7 tryDecode directly to Optical Dock v3 geometry/tracking.
const NativeFunction=globalThis.Function;
let armed=true;

function injectPrecisionScanner(src){
  const re=/function tryDecode\(\)\{[\s\S]*?\}\nfunction dispatchPacket/;
  if(!re.test(src))return{src,injected:false};
  const replacement=`function precisionDockGeometry(){const d=globalThis.__hopperOpticalDockV3?.last,b=globalThis.__hopperBinaryTagBridge?.last,s=d?.valid&&d.markers?d:(b?.valid&&b.markers?b:null);if(!s?.markers)return null;const age=performance.now()-(s.ts||0);if(age>650)return null;const src=MARKER_KEYS.map(k=>({x:MARKER_NORM[k][0],y:MARKER_NORM[k][1]})),dst=MARKER_KEYS.map(k=>s.markers[k]);if(dst.some(v=>!v))return null;const H=computeHomography(src,dst);if(!H)return null;return{H,markers:s.markers,quality:s.quality||88,stable:s.stableForDecode!==false,source:s.source||s.dock?.source||'dock',age,held:!!s.held};}\nfunction precisionAdopt(g,alpha=.22){if(!g?.H||!g?.markers)return;trackedMarkers=trackedMarkers?smoothMarkers(trackedMarkers,g.markers,alpha):g.markers;const src=MARKER_KEYS.map(k=>({x:MARKER_NORM[k][0],y:MARKER_NORM[k][1]})),dst=MARKER_KEYS.map(k=>trackedMarkers[k]);trackedH=computeHomography(src,dst)||g.H;trackedFails=0;markerMemory={markers:trackedMarkers,ts:performance.now()};}\nfunction precisionDispatch(r){for(const z of (r.all||[r]))dispatchPacket(z.p);}\nfunction precisionLabel(g){const s=String(g?.source||'DOCK').toUpperCase().replace('TAG-MEMORY','TAG TRACK');return g?.held?'PRECISION HOLD':('PRECISION '+s);}\nfunction tryDecode(){const frame=captureFrame();if(!frame)return;const dock=precisionDockGeometry(),minDim=Math.min(frame.w,frame.h);if(dock?.stable){const close=!trackedMarkers||markerDistance(trackedMarkers,dock.markers)<minDim*.14;if(!trackedH||trackedFails>0||close)precisionAdopt(dock,trackedFails?0.38:0.18);}if(trackedH){const r=decodeWithH(frame,trackedH);if(r){trackedFails=0;trackedSuccess++;drawGuide(trackedMarkers,trackedH,'LOCK');setQuality(Math.round((r.q+(dock?.quality||r.q))/2),dock?precisionLabel(dock):'LOCK FAST');precisionDispatch(r);return;}trackedFails++;if(dock?.stable){const r2=decodeWithH(frame,dock.H);if(r2){precisionAdopt(dock,.48);trackedSuccess++;drawGuide(trackedMarkers,trackedH,'LOCK');setQuality(Math.round((r2.q+dock.quality)/2),'LOCK DOCK');precisionDispatch(r2);return;}}if(trackedFails<=18){if(!dock&&trackedFails%6===0){const det=detectFiducials(frame);if(det.H){const rr=decodeWithH(frame,det.H);if(rr){adoptGeometry(det);drawGuide(trackedMarkers,trackedH,'LOCK');setQuality(rr.q,'LOCK RECOVER');precisionDispatch(rr);return;}}}drawGuide(trackedMarkers,trackedH,'LOCK');setQuality(Math.max(42,Math.round((dock?.quality||72)-trackedFails*1.4)),dock?'TRACK HOLD':'GEOMETRY HOLD');return;}trackedH=null;trackedMarkers=null;trackedFails=0;}if(dock){drawGuide(dock.markers,dock.H,dock.stable?'AUTO':'SEARCH');if(dock.stable){const r=decodeWithH(frame,dock.H);if(r){precisionAdopt(dock,.55);trackedSuccess++;drawGuide(trackedMarkers,trackedH,'LOCK');setQuality(Math.round((r.q+dock.quality)/2),'LOCK PRECISION');precisionDispatch(r);return;}setQuality(dock.quality||70,precisionLabel(dock));return;}setQuality(dock.quality||48,dock.held?'PRECISION HOLD':'DOCK HOLD');return;}const det=detectFiducials(frame);if(!det.H){drawGuide(det.markers||null,null,'SEARCH');setQuality((det.found||0)*18,\`BUSCANDO \${det.found||0}/4\`);return;}const r=decodeWithH(frame,det.H);if(r){adoptGeometry(det);drawGuide(trackedMarkers,trackedH,'LOCK');setQuality(Math.round((r.q+(det.quality||60))/2),'LOCK LEGACY');precisionDispatch(r);return;}drawGuide(det.markers,det.H,'AUTO');setQuality(det.quality||55,'AUTOLOCK LEGACY');}\nfunction dispatchPacket`;
  return{src:src.replace(re,replacement),injected:true};
}

function GuardedFunction(...args){
  const i=args.length-1;
  if(armed&&i>=0&&typeof args[i]==='string'&&args[i].includes('hps7-core-v')){
    const bad="else showNack(p.round,suggest);}}}\nfunction controlPayloadNack";
    const good="else showNack(p.round,suggest);}}\nfunction controlPayloadNack";
    let syntaxFixed=false,normalizerInjected=false,precisionScannerInjected=false;
    if(args[i].includes(bad)){args[i]=args[i].replace(bad,good);syntaxFixed=true;}

    const sampleRe=/function sampleGridRGB\(frame,grid,H,lane=-1\)\{([\s\S]*?)return out;\}/;
    if(sampleRe.test(args[i])){
      args[i]=args[i].replace(sampleRe,(m,inner)=>`function sampleGridRGB(frame,grid,H,lane=-1){${inner}return globalThis.__hopperOpticalDockV3?.normalizeSamples?globalThis.__hopperOpticalDockV3.normalizeSamples(out,lane):out;}`);
      normalizerInjected=true;
    }

    const p=injectPrecisionScanner(args[i]);args[i]=p.src;precisionScannerInjected=p.injected;
    try{globalThis.dispatchEvent(new CustomEvent('hopper:runtime-syntax-fixed',{detail:{version:'v0108',syntaxFixed,normalizerInjected,precisionScannerInjected,geometryHoldFrames:18}}));}catch{}
    armed=false;
    globalThis.Function=NativeFunction;
  }
  return NativeFunction(...args);
}
try{
  Object.setPrototypeOf(GuardedFunction,NativeFunction);
  GuardedFunction.prototype=NativeFunction.prototype;
  globalThis.Function=GuardedFunction;
}catch(e){console.error('HopperLink runtime syntax guard failed to arm',e);}
globalThis.__hopperRuntimeSyntaxGuard={version:'v0108',armed:true,photometricNormalizer:true,precisionScanner:true,opticalDockGeometry:true,geometryHoldFrames:18};
})();
