from pathlib import Path
root=Path('hopperlink-pixelstream')
p=root/'tests/adaptive-browser.py'
s=p.read_text()
s=s.replace("errors=[];page.on('pageerror',lambda e:errors.append(str(e)))", "errors=[];page.on('pageerror',lambda e:errors.append(str(e)))\n  page.on('console',lambda m: print('BROWSER',m.type,m.text,flush=True))")
s=s.replace("window.framesAB={A,B,sink};", """window.framesAB={A,B,sink};
    window.gumCalls=[];
    for(const [label,w] of [['A',A],['B',B]]){const fn=w.navigator.mediaDevices.getUserMedia;Object.defineProperty(w.navigator.mediaDevices,'getUserMedia',{configurable:true,value:async c=>{gumCalls.push([label,c]);return fn(c);}});}
    window.cameraPump=setInterval(()=>{for(const c of [A.hopperTest.canvas,B.document.getElementById('reportCanvas')])if(c.width&&c.height)c.getContext('2d').drawImage(c,0,0);},80);
    window.startupState=()=>({calls:gumCalls,AState:A.hopperTest.sender?.state,Actx:A.hopperTest.audio.ctx?.state,Atime:A.hopperTest.audio.ctx?.currentTime,Astream:A.hopperTest.audio.stream?.getTracks().map(t=>[t.kind,t.readyState,t.muted]),Bctx:B.hopperTest.audio.ctx?.state,Btime:B.hopperTest.audio.ctx?.currentTime,Bvideo:[B.document.getElementById('rxVideo').readyState,B.document.getElementById('rxVideo').videoWidth,B.document.getElementById('rxVideo').paused],Bnotice:B.document.getElementById('notice').textContent,Amsg:A.document.getElementById('audioState').textContent});""")
s=s.replace("  try:\n   if not use_audio:","  try:\n   page.wait_for_timeout(10000)\n   print('STARTUP',json.dumps(page.evaluate('startupState()'),ensure_ascii=False),flush=True)\n   assert page.evaluate(\"framesAB.A.hopperTest.sender?.state !== 'starting'\"), 'Sender media initialization did not finish'\n   if not use_audio:")
s=s.replace("page.evaluate('framesAB.A.hopperTest.stop();framesAB.B.hopperTest.stop()')", "page.evaluate('clearInterval(window.cameraPump);framesAB.A.hopperTest.stop();framesAB.B.hopperTest.stop()')")
p.write_text(s)
