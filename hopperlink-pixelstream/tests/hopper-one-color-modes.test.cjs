const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const zlib=require('zlib');
const crypto=require('crypto');
const {webcrypto}=crypto;

const root=path.resolve(__dirname,'..');
const sourcePath=path.join(root,'src','hopper-one-runtime.js');
const source=fs.readFileSync(sourcePath,'utf8');
new Function(source);
const localStore=new Map();
const document={readyState:'loading',getElementById(){return null;},querySelectorAll(){return[];},addEventListener(){},documentElement:{dataset:{},classList:{add(){},remove(){}}}};
const context={
  console,Uint8Array,Float32Array,ArrayBuffer,TextEncoder,TextDecoder,Blob,
  URL:{createObjectURL(){return'blob:test';},revokeObjectURL(){}},
  crypto:webcrypto,performance,document,navigator:{},screen:{},
  localStorage:{getItem:key=>localStore.get(key)||null,setItem:(key,value)=>localStore.set(key,value)},
  setTimeout,clearTimeout,requestAnimationFrame:()=>0,cancelAnimationFrame(){},
  alert(){},window:null,globalThis:null,
};
context.window=context;context.globalThis=context;
vm.createContext(context);
vm.runInContext(source,context,{timeout:3000});
const I=context.__hopperLinkOneInternals;
assert(I,'test internals were not exported');
assert.strictEqual(I.VERSION,'1.2.3');
assert.strictEqual(I.PROTOCOL,2);
assert.deepStrictEqual(Array.from(I.MODE_ORDER),['robust2','adaptive3','turbo4']);
assert.strictEqual(I.PILOT_CELL_COUNT,64);

const expected={robust2:{bits:2,symbols:4,chunk:480},adaptive3:{bits:3,symbols:8,chunk:736},turbo4:{bits:4,symbols:16,chunk:1000}};
for(const [modeId,want] of Object.entries(expected)){
  const mode=I.resolveMode(modeId);
  assert.strictEqual(mode.bits,want.bits,`${modeId} bits`);
  assert.strictEqual(mode.symbols,want.symbols,`${modeId} symbols`);
  assert.strictEqual(mode.chunkBytes,want.chunk,`${modeId} chunk`);
  assert(I.packetPayloadCapacity(mode)>=want.chunk,`${modeId} payload capacity`);
  const entries=I.pilotEntries(36,60,mode);
  assert.strictEqual(entries.length,64,`${modeId} pilot count`);
  const counts=new Array(mode.symbols).fill(0);
  for(const[,symbol]of entries)counts[symbol]++;
  for(const count of counts)assert.strictEqual(count,64/mode.symbols,`${modeId} balanced pilots`);

  const payload=Uint8Array.from({length:mode.chunkBytes},(_,index)=>(index*29+mode.bits*17)&255);
  const packet=I.makePacket({type:I.TYPE.SYSTEMATIC,lane:1,session:0x42a0b100+mode.bits,sequence:7,sourceCount:9,chunkSize:mode.chunkBytes,symbol:3,payload,mode});
  const symbols=I.rawToSymbols(packet,36,60,mode);
  const decodedBytes=I.symbolsToBytes(symbols,36,60,mode);
  const parsed=I.parsePacket(decodedBytes,mode);
  assert(parsed&&!parsed.bad,`${modeId} packet parses`);
  assert.strictEqual(parsed.modeId,modeId,`${modeId} header mode`);
  assert.strictEqual(parsed.payload.length,payload.length,`${modeId} payload length`);
  assert(Buffer.from(parsed.payload).equals(Buffer.from(payload)),`${modeId} payload round trip`);

  const samples=new Float32Array(symbols.length*3);
  for(let index=0;index<symbols.length;index++){
    const rgb=mode.palette[symbols[index]];
    samples[index*3]=rgb[0];samples[index*3+1]=rgb[1];samples[index*3+2]=rgb[2];
  }
  const classified=I.classifyColorSamples(samples,36,60,mode,0);
  assert(classified,`${modeId} RGB calibration`);
  assert.strictEqual(classified.mode.id,modeId,`${modeId} calibrated mode`);
  assert(Buffer.from(classified.symbols).equals(Buffer.from(symbols)),`${modeId} RGB symbols`);
}

const manifest=JSON.parse(fs.readFileSync(path.join(root,'hopper-one.runtime.json'),'utf8'));
assert.strictEqual(manifest.build,'1203');
const encoded=manifest.parts.map(part=>fs.readFileSync(path.join(root,part),'utf8').replace(/\s+/g,'')).join('');
const runtime=zlib.gunzipSync(Buffer.from(encoded,'base64'));
assert.strictEqual(runtime.length,manifest.bytes);
assert.strictEqual(crypto.createHash('sha256').update(runtime).digest('hex'),manifest.sha256);
assert.strictEqual(runtime.toString('utf8'),source);
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
assert.strictEqual((html.match(/data-optical-mode=/g)||[]).length,3);
assert(html.includes('id="stageMode"'));
assert(html.includes('id="rxMode"'));
assert(!/hps[78]|protocol-selector/i.test(html));
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
assert(sw.includes('hopperlink-one-v1203'));
const fullscreenCss=fs.readFileSync(path.join(root,'premium-one-fullscreen.css'),'utf8');
assert(fullscreenCss.includes('grid-template-columns:1fr!important'));
assert(fullscreenCss.includes('grid-template-rows:repeat(3,minmax(0,1fr))!important'));
assert(source.includes('screen.orientation.lock("portrait")'));
assert(!source.includes('tryLandscapeLock'));
assert(source.includes('return { cols: LONG_SIDE, rows: SHORT_SIDE, portrait: true };'));
const webManifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
assert.strictEqual(webManifest.orientation,'portrait');
assert(!html.includes('Gira el teléfono'));
const receiverCss=fs.readFileSync(path.join(root,'premium-one-receiver.css'),'utf8');
assert(receiverCss.includes('aspect-ratio:2/3'));
assert(receiverCss.includes('object-fit:cover'));
assert(receiverCss.includes('width:min(100vw,66.6667dvh)'));
assert(source.includes('width: { ideal: 1920 }'));
assert(source.includes('height: { ideal: 1440 }'));
assert(source.includes('aspectRatio: { ideal: 4 / 3 }'));
const portraitScan=I.receiverScanDimensions({videoWidth:1080,videoHeight:1920});
assert.strictEqual(portraitScan.width,720);
assert.strictEqual(portraitScan.height,1280);
assert.strictEqual(portraitScan.portrait,true);
assert(html.includes('Vista fullscreen 2:3'));
function makeStackScanFixture(width=1280,height=720){
  const data=new Uint8ClampedArray(width*height*4);
  for(let offset=0;offset<data.length;offset+=4){data[offset]=7;data[offset+1]=12;data[offset+2]=15;data[offset+3]=255;}
  const put=(x,y,r,g,b)=>{if(x<0||y<0||x>=width||y>=height)return;const offset=(y*width+x)*4;data[offset]=r;data[offset+1]=g;data[offset+2]=b;};
  const rails=[24,242,460,678],leftTop=430,rightTop=850,leftBottom=410,rightBottom=840;
  for(let lane=0;lane<3;lane++){
    const y1=rails[lane],y2=rails[lane+1];
    for(let y=y1;y<=y2;y++){
      const t=y/(height-1),left=Math.round(leftTop+(leftBottom-leftTop)*t),right=Math.round(rightTop+(rightBottom-rightTop)*t);
      for(let edge=0;edge<7;edge++){put(left+edge,y,92,178,158);put(right-edge,y,88,184,164);}
    }
    for(const y of [y1,y2])for(let dy=-3;dy<=3;dy++)for(let x=410;x<=855;x++)put(x,y+dy,98,187,160);
    const palette=[[20,20,20],[232,232,232],[228,48,48],[44,204,70],[48,72,226],[236,190,34],[204,52,184],[234,108,34]];
    for(let y=y1+12;y<y2-12;y++)for(let x=440;x<825;x++)if((x*13+y*7)%17<8){const color=palette[(x+y)%palette.length];put(x,y,color[0],color[1],color[2]);}
  }
  for(let y=0;y<height;y++)for(let edge=0;edge<3;edge++)put(1160+edge,y,50,130,80);
  return {data,width,height};
}
const stackItems=I.detectCyanComponents(makeStackScanFixture(),1280,720);
assert.strictEqual(stackItems.length,3,'StackScan returns three lanes from a fused green-shifted tower');
assert(stackItems.every(item=>item.source==='portrait-rails'),'StackScan rail strategy selected');
const stackCenters=stackItems.map(item=>(item.quad.tl.y+item.quad.tr.y+item.quad.bl.y+item.quad.br.y)/4);
assert(stackCenters[0]<stackCenters[1]&&stackCenters[1]<stackCenters[2],'StackScan lanes ordered top to bottom');
assert(source.includes('currentTime - app.trackedAt < 1800'));
assert(source.includes('advanced.zoom = capabilities.zoom.min'));
assert(source.includes('STACKSCAN V2'));
console.log('HopperLink ONE Color Modes + StackScan V2: PASS');
