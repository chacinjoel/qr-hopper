/* Nova Pop Flow Lab — standalone design prototype. No Unity project or save data is used. */
(function(root){
'use strict';
const ROWS=8,COLS=6,COLORS=['cyan','green','pink','orange','yellow'];
const clone=o=>JSON.parse(JSON.stringify(o));
const at=(r,c)=>r*COLS+c, row=i=>Math.floor(i/COLS), col=i=>i%COLS;
const special=k=>['seeker','slash','beam','burst','prism'].includes(k);
const recipe=n=>n>=9?'prism':n>=7?'burst':n===6?'beam':n===5?'slash':n===4?'seeker':null;
const adjacent=(i,j,s)=>Math.abs(row(i)-row(j))+Math.abs(col(i)-col(j))===1 && (row(i)<s.split)===(row(j)<s.split);
const neighbors=(i,s)=>[i-COLS,i+1,i+COLS,i-1].filter(j=>j>=0&&j<48&&adjacent(i,j,s));
const route=s=>Array.from({length:8},(_,i)=>(i+s.split)%8);
function rand(s){s.rng=(Math.imul(s.rng,1664525)+1013904223)>>>0;return s.rng/4294967296;}
function piece(s,kind='normal',color=null,hp=0){return{id:s.nextId++,kind,color:color||COLORS[Math.floor(rand(s)*5)],hp};}
function next(s,c){const g=s.gates[c],n=g.generated++; let k='normal';
 if(g.mixed){if(n%8===0)k='seeker';else if(n%16===12)k='prism';else if(n%8===4)k=c===1?'burst':'beam';}
 return piece(s,k);
}
function init({seed=71024,split=4,mixed=true}={}){
 if(![3,4,5].includes(split))throw Error('La entrada debe ser fila 4, 5 o 6.');
 const s={version:1,seed,split,rng:seed>>>0,nextId:1,moves:26,score:0,board:[],goals:{cyan:16,pink:14,block:4,relic:2},initialGoals:{cyan:16,pink:14,block:4,relic:2},gates:[],stats:{spawned:0,portals:0,removed:0,collected:0,created:0},turn:0,status:'playing'};
 const pattern=['cyan cyan pink pink green yellow','cyan orange orange green pink yellow','green yellow pink pink green orange','cyan yellow cyan cyan pink orange','yellow yellow yellow yellow orange orange','green green cyan pink green orange','pink orange cyan cyan yellow orange','pink yellow green green orange orange'];
 pattern.forEach(line=>line.split(' ').forEach(c=>s.board.push(piece(s,'normal',c))));
 for(const c of[1,4]){s.board[at(Math.max(0,split-3),c)]=piece(s,'relic','cyan');s.board[at(split-2,c)]=piece(s,'block','orange',2);s.board[at(6,c)]=piece(s,'block','orange',1);}
 s.board[at(split-1,2)]=piece(s,'beam','cyan');s.board[at(5,5)]=piece(s,'seeker','cyan');s.board[at(7,2)]=piece(s,'slash','green');
 for(let c=0;c<COLS;c++){s.gates.push({mixed:mixed&&[1,4].includes(c),generated:0,delivered:0,queue:[]});for(let k=0;k<3;k++)s.gates[c].queue.push(next(s,c));}
 return s;
}
function group(s,i){const t=s.board[i];if(!t||t.kind!=='normal')return[];const visited=new Set([i]),q=[i];for(let n=0;n<q.length;n++)for(const j of neighbors(q[n],s)){const b=s.board[j];if(!visited.has(j)&&b&&b.kind==='normal'&&b.color===t.color){visited.add(j);q.push(j);}}return q;}
function area(i,k,s){const r=row(i),c=col(i);return Array.from({length:48},(_,j)=>j).filter(j=>k==='slash'?row(j)===r:k==='beam'?col(j)===c:k==='cross'?row(j)===r||col(j)===c:k==='widecross'?Math.abs(row(j)-r)<=1||Math.abs(col(j)-c)<=1:k==='burst'?Math.abs(row(j)-r)<=1&&Math.abs(col(j)-c)<=1&&(row(j)<s.split)===(r<s.split):false);}
function decrement(s,key,amount=1){if(s.goals[key]!=null)s.goals[key]=Math.max(0,s.goals[key]-amount);}
function stepFlow(s,refill=true){
 const before=s.board.slice(),rs=route(s),events=[];
 // Snapshot occupancy: a piece travels at most one edge per tick. Paths are acyclic.
 for(let c=0;c<6;c++){
  const end=at(s.split-1,c),p=before[end];
  if(p&&p.kind==='relic'){s.board[end]=null;decrement(s,'relic');s.stats.collected++;s.score+=300;events.push({kind:'collect',from:end,piece:clone(p)});}
  for(let k=6;k>=0;k--){const a=at(rs[k],c),b=at(rs[k+1],c),t=before[a];if(t&&t.kind!=='block'&&!before[b]){s.board[b]=t;s.board[a]=null;const kind=rs[k]===7?'portal':'fall';if(kind==='portal')s.stats.portals++;events.push({kind,from:a,to:b,piece:clone(t)});}}
  const first=at(s.split,c),g=s.gates[c];if(!before[first]&&g.queue.length){const t=g.queue.shift();s.board[first]=t;g.delivered++;s.stats.spawned++;if(refill)g.queue.push(next(s,c));events.push({kind:'spawn',from:-1,to:first,lane:c,piece:clone(t)});}
 }
 return events;
}
function settle(s,refill=true){const events=[];for(let t=0;t<100;t++){const e=stepFlow(s,refill);if(!e.length)return events;events.push(...e);}throw Error('El flujo no se estabilizó.');}
function remaining(s){return Object.values(s.goals).reduce((a,b)=>a+b,0);}
function relicProgress(s){const rs=route(s);return s.board.reduce((a,p,i)=>a+(p&&p.kind==='relic'?rs.indexOf(row(i)):0),0);}
function progressScore(before,after){let score=0;for(const k of Object.keys(before.goals)){score+=(before.goals[k]-after.goals[k])*({cyan:14,pink:14,block:130,relic:700}[k]||0);}
 const hp=x=>x.board.reduce((a,t)=>a+(t&&t.kind==='block'?t.hp:0),0);if(before.goals.block)score+=(hp(before)-hp(after))*30;
 score+=Math.max(0,relicProgress(after)-relicProgress(before))*22;
 if(remaining(after)===0&&remaining(before)>0)score+=10000;return score;
}
function basicTarget(s){let best=-1,score=-Infinity;for(let i=0;i<48;i++){const t=s.board[i];if(!t||t.kind==='relic')continue;let v=t.kind==='block'?30:(s.goals[t.color]>0?15:1);if(special(t.kind)&&t.kind!=='seeker')v+=12;if(v>score){score=v;best=i;}}return best;}
function applyHits(s,indices,q){const unique=[...new Set(indices)];const hits=[];for(const i of unique){const t=s.board[i];if(!t||t.kind==='relic')continue;hits.push(i);if(t.kind==='block'){t.hp--;if(t.hp<=0){s.board[i]=null;s.stats.removed++;decrement(s,'block');s.score+=100;}}else{s.board[i]=null;s.stats.removed++;if(special(t.kind))q.push({i,t:clone(t)});else{decrement(s,t.color);s.score+=20;}}}return hits;}
function reason(before,after,t){const parts=[];for(const k of['relic','block','cyan','pink']){let n=before.goals[k]-after.goals[k];if(n)parts.push(n+' '+({relic:'reliquia(s)',block:'bloqueo(s)',cyan:'cian',pink:'rosa'}[k]));}
 if(!parts.length){if(t.kind==='block')return 'Debilita un bloqueo para abrir la ruta.';if(relicProgress(after)>relicProgress(before))return 'Acerca una reliquia a su terminal.';return 'Abre espacio para el suministro visible.';}
 return (special(t.kind)?'Activa '+t.kind.toUpperCase()+': ':'Impacto útil: ')+parts.join(' + ')+'.';
}
function target(s){let best=null;for(let i=0;i<48;i++){const t=s.board[i];if(!t||t.kind==='relic')continue;const d=clone(s),q=[];applyHits(d,[i],q);drain(d,q,[],false);settle(d,false);let value=progressScore(s,d);
 // Avoid wasting an unrelated special for a negligible improvement.
 if(special(t.kind))value-=5;if(t.kind==='block'){const rs=route(s),pos=rs.indexOf(row(i));if(s.goals.relic&&s.board.some((p,j)=>p&&p.kind==='relic'&&col(j)===col(i)&&rs.indexOf(row(j))<pos))value+=85;}
 if(!best||value>best.value)best={i,value,reason:reason(s,d,t)};
 }return best;
}
function drain(s,q,phases,smart=true){let guard=0;while(q.length){if(++guard>150)throw Error('Cadena de especiales inválida.');const {i,t}=q.shift();let hits=[],kind=t.kind,chosen=null;
 if(kind==='seeker'){chosen=smart?target(s):{i:basicTarget(s),reason:'Apoyo local'};if(chosen&&chosen.i>=0){hits=applyHits(s,[chosen.i],q);}}
 else if(kind==='prism'){hits=applyHits(s,s.board.flatMap((p,j)=>p&&p.kind==='normal'&&p.color===t.color?[j]:[]),q);}
 else hits=applyHits(s,area(i,kind,s),q);
 if(phases)phases.push({kind,i,hits,target:chosen,snapshot:clone(s)});
 }}
function combine(s,i,j,q,phases){const a=s.board[i],b=s.board[j];if(!a||!b)return false;
 if(a.kind==='seeker'||b.kind==='seeker')return false;
 const lines=['slash','beam'];let hits=[],kind='';
 if(a.kind==='prism'||b.kind==='prism'){
  const p=a.kind==='prism'?a:b,other=a.kind==='prism'?b:a;s.board[i]=s.board[j]=null;s.stats.removed+=2;
  if(other.kind==='prism'){kind='prism';hits=applyHits(s,Array.from({length:48},(_,x)=>x),q);}
  else{kind='convert';for(let x=0;x<48;x++){const t=s.board[x];if(t&&t.kind==='normal'&&t.color===p.color){t.kind=other.kind;hits.push(x);}}
   phases.push({kind,i,hits,snapshot:clone(s)});for(const x of hits){const t=s.board[x];s.board[x]=null;s.stats.removed++;q.push({i:x,t:clone(t)});}return true;}
 }else if(lines.includes(a.kind)&&lines.includes(b.kind)){kind='cross';s.board[i]=s.board[j]=null;s.stats.removed+=2;hits=applyHits(s,area(i,'cross',s),q);}
 else if(a.kind==='burst'&&b.kind==='burst'){kind='widecross';s.board[i]=s.board[j]=null;s.stats.removed+=2;hits=applyHits(s,area(i,'widecross',s),q);}
 else return false;
 phases.push({kind,i,hits,snapshot:clone(s)});return true;
}
function partner(s,i){const t=s.board[i];if(!t||!special(t.kind)||t.kind==='seeker')return -1;return neighbors(i,s).find(j=>{const b=s.board[j];return b&&special(b.kind)&&b.kind!=='seeker'&&(t.kind==='prism'||b.kind==='prism'||t.kind==='burst'&&b.kind==='burst'||['slash','beam'].includes(t.kind)&&['slash','beam'].includes(b.kind));})??-1;}
function act(input,i){const s=clone(input),t=s.board[i],phases=[],q=[];if(s.status!=='playing'||s.moves<=0||!t)return{ok:false,reason:'La partida no está activa.'};if(t.kind==='block'||t.kind==='relic')return{ok:false,reason:t.kind==='relic'?'La reliquia debe llegar al terminal al final del segmento superior.':'Golpea el bloqueo con un especial o un grupo adyacente.'};
 let g=[];if(t.kind==='normal'){g=group(s,i);if(g.length<2)return{ok:false,reason:'Necesitas al menos 2 tiles conectados del mismo color.'};}
 if(t.kind==='seeker'&&!s.board.some((p,j)=>j!==i&&p&&p.kind!=='relic'))return{ok:false,reason:'Seeker no encuentra un destino válido.'};
 s.moves--;s.turn++;
 if(t.kind==='normal'){
  const k=recipe(g.length);const border=new Set();g.forEach(j=>neighbors(j,s).forEach(x=>{if(s.board[x]?.kind==='block')border.add(x);}));
  applyHits(s,[...g,...border],q);if(k){s.board[i]=piece(s,k,t.color);s.stats.created++;}
  phases.push({kind:'match',i,hits:g.concat([...border]),created:k,snapshot:clone(s)});
 }else{const j=partner(s,i);if(j<0||!combine(s,i,j,q,phases)){s.board[i]=null;s.stats.removed++;q.push({i,t});}}
 drain(s,q,phases,true);return{ok:true,state:s,phases};
}
function finish(s){s.status=remaining(s)===0?'won':s.moves<=0?'lost':'playing';return s.status;}
function legal(s){return s.board.flatMap((t,i)=>t&&(special(t.kind)||t.kind==='normal'&&group(s,i).length>=2)?[i]:[]);}
function hint(s){let best=null,seen=new Set();for(const i of legal(s)){const t=s.board[i];if(t.kind==='normal'){const g=group(s,i).sort((a,b)=>a-b),key=g.join(',');if(seen.has(key))continue;seen.add(key);}
 const result=act(s,i);if(!result.ok)continue;const after=result.state;settle(after,false);let value=progressScore(s,after)+(after.stats.created-s.stats.created)*24;
 if(!best||value>best.value)best={i,value};}return best;}
function config(s){return{prototype:'Nova Pop Flow Lab 1.0',coordinateSystem:'Filas/columnas mostradas desde 1; indices internos desde 0',rows:8,columns:6,entryRow:s.split+1,seed:s.seed,moves:26,objectives:s.initialGoals,segments:[{id:'A',rows:[1,s.split],source:'portal',end:'terminal: solo extrae reliquias'},{id:'B',rows:[s.split+1,8],source:'incoming'}],gates:s.gates.map((g,c)=>({id:'G'+(c+1),entry:[s.split+1,c+1],profile:g.mixed?'mixed':'normal',previewCount:3,sequence:g.mixed?'ciclo de 16: Seeker en 1 y 9, Burst/Beam en 5, Prism en 13; resto normal':'normal',initialFillCounts:false})),portals:Array.from({length:6},(_,c)=>({id:'P'+(c+1),from:[8,c+1],to:[1,c+1]})),flowRows:route(s).map(r=>r+1),blockedFallEdges:Array.from({length:6},(_,c)=>({from:[s.split,c+1],to:[s.split+1,c+1]})),generation:{2:'none',3:'none',4:'seeker',5:'slash',6:'beam','7-8':'burst','9+':'prism'},notes:'Prototipo independiente; no es un formato de importación Unity. Gravedad descendente; efectos y heurística documentados en README.'};}
const api={ROWS,COLS,COLORS,clone,at,row,col,special,recipe,neighbors,route,init,group,area,stepFlow,settle,act,finish,legal,target,hint,partner,remaining,config,progressScore};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FlowLab=api;
})(typeof window!=='undefined'?window:globalThis);
