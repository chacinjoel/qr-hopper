const TABLE = new Uint32Array(256);
for (let n=0;n<256;n++) { let c=n; for (let k=0;k<8;k++) c=(c&1)?0xEDB88320^(c>>>1):c>>>1; TABLE[n]=c>>>0; }
export function crc32(bytes){let c=0xFFFFFFFF;for(const b of bytes)c=TABLE[(c^b)&0xFF]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
