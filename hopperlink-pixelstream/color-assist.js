(() => {
'use strict';

const nativeGetImageData = CanvasRenderingContext2D.prototype.getImageData;
const CANON = [
  {rgb:[0,220,220], c:[0.02,0.49,0.49]},   // cyan
  {rgb:[220,0,220], c:[0.49,0.02,0.49]},   // magenta
  {rgb:[220,220,0], c:[0.49,0.49,0.02]},   // yellow
  {rgb:[0,220,102], c:[0.02,0.68,0.30]}    // green
];

function markerClass(r,g,b){
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b), chroma=mx-mn, sum=r+g+b;
  if(mx<48 || sum<105 || chroma<24) return -1;
  const sat=chroma/Math.max(1,mx);
  if(sat<0.18) return -1;

  const nr=r/sum, ng=g/sum, nb=b/sum;
  let best=-1, bestScore=1e9, second=1e9;
  for(let i=0;i<CANON.length;i++){
    const t=CANON[i].c;
    const dr=nr-t[0], dg=ng-t[1], db=nb-t[2];
    let score=Math.sqrt(dr*dr+dg*dg+db*db);

    // Penalizaciones suaves para conservar separación cyan/verde.
    if(i===0 && ng<nb*0.62) score+=0.08;
    if(i===3 && ng<nb*1.18) score+=0.08;
    if(i===1 && ng>Math.min(nr,nb)*0.82) score+=0.06;
    if(i===2 && nb>Math.min(nr,ng)*0.82) score+=0.06;

    if(score<bestScore){second=bestScore;bestScore=score;best=i;}
    else if(score<second) second=score;
  }

  // Muy parecido: aceptar directamente. Parecido moderado: exigir margen.
  if(bestScore<=0.165) return best;
  if(bestScore<=0.235 && second-bestScore>=0.018) return best;
  return -1;
}

CanvasRenderingContext2D.prototype.getImageData = function(...args){
  const img=nativeGetImageData.apply(this,args);
  if(this.canvas?.id!=='capture') return img;

  const d=img.data;
  for(let p=0;p<d.length;p+=4){
    const cls=markerClass(d[p],d[p+1],d[p+2]);
    if(cls<0) continue;
    const c=CANON[cls].rgb;
    d[p]=c[0]; d[p+1]=c[1]; d[p+2]=c[2];
  }
  return img;
};

window.__hopperColorAssist = {version:'0.4.2', active:true};
})();
