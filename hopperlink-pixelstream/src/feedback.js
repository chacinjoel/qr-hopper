// Tiny, loss-detecting backchannel. It never carries file payload.
export const FLASH_HALF_MS = 125;
export const FLASH_PREFIX = [0,0,0,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,1,1,0,0,0];
export const FLASH_PACKET_BYTES = 10;
export const FLASH_MESSAGE_MS = (FLASH_PREFIX.length + FLASH_PACKET_BYTES * 16 + 4) * FLASH_HALF_MS;
export const REPAIR_ALL = 0xfffe, COMPLETE = 0xffff;

export function crc16(bytes) {
  let crc = 0xffff;
  for (const b of bytes) { crc ^= b << 8; for (let j = 0; j < 8; j++) crc = (crc << 1 ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff; }
  return crc;
}
export function encodeFeedback({ linkId, group, mask }) {
  if (!Number.isInteger(linkId) || linkId <= 0 || linkId > 0xffffffff || !Number.isInteger(group) || group < 0 || group > 0xffff ||
      !Number.isInteger(mask) || mask < 0 || mask > 0xffff || (group < REPAIR_ALL ? mask === 0 : mask !== 0)) throw new Error('Solicitud inválida');
  const bytes = new Uint8Array(10), v = new DataView(bytes.buffer);
  v.setUint32(0, linkId); v.setUint16(4, group); v.setUint16(6, mask); v.setUint16(8, crc16(bytes.subarray(0, 8)));
  return bytes;
}
export function decodeFeedback(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 10) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint16(8) !== crc16(bytes.subarray(0, 8))) return null;
  const result = { linkId: v.getUint32(0), group: v.getUint16(4), mask: v.getUint16(6) };
  try { encodeFeedback(result); return result; } catch { return null; }
}
export function feedbackText(request) {
  return 'HXR1-' + [...encodeFeedback(request)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}
export function parseFeedbackText(text) {
  const hex = String(text).trim().replace(/^HXR1-/i, '').replace(/\s/g, '');
  if (!/^[a-f0-9]{20}$/i.test(hex)) return null;
  return decodeFeedback(Uint8Array.from(hex.match(/../g), b => parseInt(b, 16)));
}
export function feedbackChips(request) {
  const chips = [...FLASH_PREFIX];
  for (const b of encodeFeedback(request)) for (let i = 7; i >= 0; i--) chips.push(...(b >> i & 1 ? [1,0] : [0,1]));
  return [...chips, 0,0,0,0];
}
export function repairIndices(transport, request, linkId) {
  if (request.linkId !== linkId) throw new Error('El código pertenece a otra transferencia.');
  if (request.group === COMPLETE) return [];
  if (request.group === REPAIR_ALL) return transport.frames.flatMap((f, i) => f.kind === 0 && !f.padding ? [i] : []);
  if (request.group >= transport.groupCount || request.mask >>> transport.k) throw new Error('Bloques fuera del archivo.');
  const out = [];
  transport.frames.forEach((f, i) => { if (f.kind === 0 && !f.padding && f.group === request.group && (request.mask & (1 << f.slot))) out.push(i); });
  if (!out.length) throw new Error('La solicitud no contiene bloques útiles.');
  return out;
}

// This parser accepts timestamped brightness samples, NOT video-frame counts.
// It learns a local threshold, recognizes a 3-chip sync pulse (Manchester data
// has at most 2 consecutive equal chips), then checks the entire packet CRC.
export class FlashDecoder {
  constructor(onPacket) { this.onPacket = onPacket; this.reset(); }
  reset() { this.samples=[]; this.level=null; this.edgeAt=0; this.capture=null; this.low=255; this.high=0; this.lastEmit=''; }
  feed(t, value) {
    if (!Number.isFinite(t) || !Number.isFinite(value)) return;
    this.samples.push({t, value});
    while (this.samples.length && this.samples[0].t < t - 30000) this.samples.shift();
    if (!this.capture) {
      const recent=this.samples.filter(s=>s.t>=t-2500);
      this.low=Math.min(...recent.map(s=>s.value)); this.high=Math.max(...recent.map(s=>s.value));
    }
    if (this.high-this.low<30) return;
    const threshold=(this.high+this.low)/2, margin=(this.high-this.low)*.10;
    const next=this.level===null ? value>threshold : value>threshold+margin ? true : value<threshold-margin ? false : this.level;
    if (next!==this.level) {
      if (this.level===true && next===false && !this.capture) {
        const run=t-this.edgeAt;
        if (run>=FLASH_HALF_MS*2.55 && run<=FLASH_HALF_MS*3.5) this.capture={ start:t+3*FLASH_HALF_MS, half:FLASH_HALF_MS, threshold };
      }
      this.level=next; this.edgeAt=t;
    }
    const cap=this.capture;
    if (cap && t>cap.start+(FLASH_PACKET_BYTES*16+1)*cap.half) {
      for (const offset of [-.25,0,.25]) {
        const bits=[]; let ok=true;
        for(let j=0;j<FLASH_PACKET_BYTES*8;j++) {
          const pair=[];
          for(let h=0;h<2;h++) {
            const mid=cap.start+(2*j+h+.5+offset)*cap.half;
            const samples=this.samples.filter(s=>Math.abs(s.t-mid)<=cap.half*.24);
            if(!samples.length){ok=false;break;}
            pair.push(samples.reduce((n,s)=>n+s.value,0)/samples.length>cap.threshold?1:0);
          }
          if(!ok||pair[0]===pair[1]){ok=false;break;} bits.push(pair[0]);
        }
        if(ok){const bytes=new Uint8Array(10);bits.forEach((b,i)=>bytes[i>>3]|=b<<(7-(i&7)));const packet=decodeFeedback(bytes);
          if(packet){const key=feedbackText(packet);if(key!==this.lastEmit){this.lastEmit=key;this.onPacket(packet);}break;}}
      }
      this.capture=null;
    }
  }
}
