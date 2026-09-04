'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'premium-one-fullscreen.css'),'utf8');
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
assert(!html.includes('class="lane-label"'),'Sender labels must not cover optical cells');
assert(css.includes('.lane-label{display:none!important}'),'Cached HTML must also hide lane labels');
assert(!/\.data-live\s+\.(stage-hud|stage-controls|triframe-grid|optical-frame)\s*\{/.test(css),'HELLO and DATA must not change optical geometry or overlay controls');
assert(css.includes('height:calc(52px + var(--safe-top))'));
assert(css.includes('height:calc(52px + var(--safe-bottom))'));
assert(css.includes('.stage-controls [hidden]{display:none!important}'));
for(const lane of ['A','B','C']){
  assert(html.includes(`id="laneCanvas${lane}"`));
  assert(html.includes(`aria-label="Cuadrante ${lane}"`));
}
assert.equal((html.match(/id="laneCanvas[A-C]"/g)||[]).length,3);
const cssPath='premium-one-fullscreen.css?v=1204-clean1';
assert(html.includes(cssPath)&&sw.includes(cssPath),'HTML and offline cache must load the fixed CSS');
assert(html.includes('Pantalla limpia'));
assert(sw.includes('hopperlink-one-v1204-clean1'));
assert(sw.includes('./hopper-one.js?v=1204'));
assert(sw.includes('./runtime/hopper-one.bundle-01.txt?v=1204'));
console.log('Unobstructed optical surface / stable HELLO-DATA geometry contract: PASS');
