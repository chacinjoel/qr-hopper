export class RasterCanvas{
 constructor(){this._width=0;this._height=0;this.data=null;this.ctx={fillStyle:'#000',fillRect:(x,y,w,h)=>{let hex=this.ctx.fillStyle.slice(1);if(hex.length===3)hex=[...hex].map(x=>x+x).join('');const n=parseInt(hex,16),r=n>>16,g=n>>8&255,b=n&255;for(let yy=Math.max(0,Math.floor(y));yy<Math.min(this.height,Math.ceil(y+h));yy++)for(let xx=Math.max(0,Math.floor(x));xx<Math.min(this.width,Math.ceil(x+w));xx++){const o=(yy*this.width+xx)*4;this.data[o]=r;this.data[o+1]=g;this.data[o+2]=b;this.data[o+3]=255;}}};}
 get width(){return this._width;}set width(w){this._width=w;this.data=new Uint8ClampedArray(w*this.height*4);}get height(){return this._height;}set height(h){this._height=h;this.data=new Uint8ClampedArray(this.width*h*4);}getContext(){return this.ctx;}
}
