(() => {
  "use strict";
  const ENGINE_NAME = "HopperCore ONE";
  const VERSION = "1.5.0";
  const PROTOCOL = 5;
  const MAGIC = Uint8Array.from([0x48, 0x4f, 0x50, 0x31]);
  const TYPE = Object.freeze({ HELLO: 1, SYSTEMATIC: 2, FOUNTAIN: 3 });
  const HEADER_BYTES = 36;
  const CONTROL_FLAG = 0x80, GUIDE_FLAG = 0x40, CONTROL_CHUNK = 20, MAX_META_BYTES = 4096, QUICK_GUIDE_NAME_BYTES = 36;
  const CONTROL_MODE = "robust2", CONTROL_COLS = 30, CONTROL_ROWS = 18;
  const helloAssemblies = new Map();
  const quickGuideAssemblies = new Map();
  const SHORT_SIDE = 36;
  const LONG_SIDE = 60;
  const PILOT_SIDE = 4;
  const PILOT_CELL_COUNT = PILOT_SIDE * PILOT_SIDE * 4;
  const DEFAULT_MODE = "adaptive3";
  const MODE_ORDER = Object.freeze(["robust2", "adaptive3", "turbo4"]);
  const MODE_DEFINITIONS = Object.freeze({
    robust2: Object.freeze({
      id: "robust2",
      code: 2,
      bits: 2,
      symbols: 4,
      chunkBytes: 480,
      label: "Robusto 2-bit",
      shortLabel: "ROBUSTO",
      description:
        "Máxima tolerancia a distancia, reflejos y exposición irregular.",
      minFps: 8,
      maxFps: 12,
      defaultFps: 10,
      minPilotSeparation: 24,
      palette: Object.freeze([
        Object.freeze([18, 18, 18]),
        Object.freeze([88, 88, 88]),
        Object.freeze([166, 166, 166]),
        Object.freeze([240, 240, 240]),
      ]),
    }),
    adaptive3: Object.freeze({
      id: "adaptive3",
      code: 3,
      bits: 3,
      symbols: 8,
      chunkBytes: 736,
      label: "Color Adaptativo 3-bit",
      shortLabel: "COLOR 3-BIT",
      description: "Equilibrio premium entre velocidad, color y estabilidad.",
      minFps: 8,
      maxFps: 12,
      defaultFps: 9,
      minPilotSeparation: 28,
      palette: Object.freeze([
        Object.freeze([22, 22, 22]),
        Object.freeze([236, 236, 236]),
        Object.freeze([228, 48, 48]),
        Object.freeze([44, 204, 70]),
        Object.freeze([48, 72, 226]),
        Object.freeze([236, 190, 34]),
        Object.freeze([204, 52, 184]),
        Object.freeze([234, 108, 34]),
      ]),
    }),
    turbo4: Object.freeze({
      id: "turbo4",
      code: 4,
      bits: 4,
      symbols: 16,
      chunkBytes: 1000,
      label: "Color Turbo 4-bit",
      shortLabel: "COLOR TURBO",
      description:
        "Máxima densidad para pantallas brillantes y cámaras cercanas.",
      minFps: 8,
      maxFps: 12,
      defaultFps: 8,
      minPilotSeparation: 18,
      palette: Object.freeze([
        Object.freeze([16, 16, 16]),
        Object.freeze([76, 76, 76]),
        Object.freeze([158, 158, 158]),
        Object.freeze([242, 242, 242]),
        Object.freeze([224, 42, 42]),
        Object.freeze([118, 24, 24]),
        Object.freeze([244, 126, 32]),
        Object.freeze([122, 62, 18]),
        Object.freeze([230, 208, 32]),
        Object.freeze([112, 102, 18]),
        Object.freeze([42, 206, 66]),
        Object.freeze([20, 106, 38]),
        Object.freeze([50, 78, 228]),
        Object.freeze([24, 40, 118]),
        Object.freeze([208, 48, 188]),
        Object.freeze([106, 24, 96]),
      ]),
    }),
  });
  function modeByBits(bits) {
    return (
      MODE_ORDER.map((id) => MODE_DEFINITIONS[id]).find(
        (mode) => mode.bits === Number(bits),
      ) || null
    );
  }
  function resolveMode(input = DEFAULT_MODE) {
    if (input && typeof input === "object" && input.id)
      return MODE_DEFINITIONS[input.id] || MODE_DEFINITIONS[DEFAULT_MODE];
    if (typeof input === "number")
      return modeByBits(input) || MODE_DEFINITIONS[DEFAULT_MODE];
    return MODE_DEFINITIONS[input] || MODE_DEFINITIONS[DEFAULT_MODE];
  }
  function loadModePreference() {
    try {
      const stored = localStorage.getItem("hopperlink-one-optical-mode");
      return MODE_DEFINITIONS[stored] ? stored : DEFAULT_MODE;
    } catch {
      return DEFAULT_MODE;
    }
  }
  function activeMode() {
    return resolveMode(app.modeId);
  }
  function theoreticalRange(modeInput, lanes = 3) {
    const mode = resolveMode(modeInput);
    return {
      minKib: (mode.chunkBytes * lanes * mode.minFps) / 1024,
      maxKib: (mode.chunkBytes * lanes * mode.maxFps) / 1024,
    };
  }
  const MAX_FLIGHT_EVENTS = 5000;
  const encoder = new TextEncoder();
  const decoderText = new TextDecoder();
  const $ = (id) => globalThis.document?.getElementById(id);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const nowIso = () => new Date().toISOString();
  const app = {
    role: "send",
    modeId: loadModePreference(),
    rxModeId: null,
    phase: "IDLE",
    selectedFile: null,
    tx: null,
    rx: null,
    cameraStream: null,
    scanRaf: 0,
    scanLastAt: 0,
    scanFrames: 0,
    scanFpsAt: 0,
    scanFps: 0,
    scanEpoch: 0,
    scanBusy: false,
    scanWorker: null,
    candidateBits: null,
    receiverObjectUrl: null,
    wakeLock: null,
    deferredInstall: null,
    stageOpen: false,
    receiverFullscreen: false,
    recentQuality: [],
    detection: { locks: [0, 0, 0], valid: 0, rejected: 0, lastMetricAt: 0 },
    currentLanePackets: [null, null, null],
    currentLaneModes: [DEFAULT_MODE, DEFAULT_MODE, DEFAULT_MODE],
    renderScheduled: false,
  };
  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return "—";
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1048576)
      return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)}KiB`;
    if (bytes < 1073741824)
      return `${(bytes / 1048576).toFixed(bytes < 10485760 ? 2 : 1)}MiB`;
    return `${(bytes / 1073741824).toFixed(2)}GiB`;
  }
  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "—";
    const s = Math.round(seconds),
      m = Math.floor(s / 60),
      r = s % 60;
    return m ? `${m}m ${String(r).padStart(2, "0")}s` : `${r}s`;
  }
  function safeDetail(value) {
    try {
      return JSON.stringify(value, (key, item) => {
        if (item instanceof Uint8Array) return `Uint8Array(${item.length})`;
        if (item instanceof ArrayBuffer)
          return `ArrayBuffer(${item.byteLength})`;
        return item;
      });
    } catch {
      return String(value);
    }
  }
  function setPhase(phase) {
    app.phase = phase;
    const phaseEl = $("blackboxPhase");
    if (phaseEl) phaseEl.textContent = phase;
  }
  function setEngineStatus(text, kind = "online") {
    const el = $("engineStatus");
    if (!el) return;
    el.className = `status-pill ${kind}`;
    el.innerHTML = "<b></b>" + text;
  }
  function setSonicStatus(text, kind = "") {
    const el = $("sonicStatus");
    if (el) {
      el.className = `status-pill ${kind}`.trim();
      el.innerHTML = "<b></b>" + text;
    }
    const stage = $("stageSonic");
    if (stage) stage.textContent = text;
  }
  function alertError(message, error = null) {
    setEngineStatus("REVISAR CAJA NEGRA", "error");
    flight.record(
      "error",
      "ui-error",
      { message, error: error?.message || String(error || "") },
      0,
    );
    window.alert(message);
  }
  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let bit = 0; bit < 8; bit++)
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function writeU16(out, offset, value) {
    out[offset] = (value >>> 8) & 255;
    out[offset + 1] = value & 255;
  }
  function writeU32(out, offset, value) {
    out[offset] = (value >>> 24) & 255;
    out[offset + 1] = (value >>> 16) & 255;
    out[offset + 2] = (value >>> 8) & 255;
    out[offset + 3] = value & 255;
  }
  function readU16(bytes, offset) {
    return (bytes[offset] << 8) | bytes[offset + 1];
  }
  function readU32(bytes, offset) {
    return (
      (((bytes[offset] << 24) >>> 0) |
        (bytes[offset + 1] << 16) |
        (bytes[offset + 2] << 8) |
        bytes[offset + 3]) >>>
      0
    );
  }
  function concatBytes(...parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }
  function randomSession() {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] || 1;
  }
  async function sha256Hex(bytes) {
    if (!crypto?.subtle) return null;
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
  }
  function activeGrid() {
    return { cols: LONG_SIDE, rows: SHORT_SIDE, portrait: true };
  }
  function pilotEntries(cols, rows, modeInput = DEFAULT_MODE) {
    const mode = resolveMode(modeInput);
    const anchors = [
      [0, 0],
      [cols - PILOT_SIDE, 0],
      [0, rows - PILOT_SIDE],
      [cols - PILOT_SIDE, rows - PILOT_SIDE],
    ];
    const entries = [];
    for (const [originX, originY] of anchors)
      for (let y = 0; y < PILOT_SIDE; y++)
        for (let x = 0; x < PILOT_SIDE; x++) {
          const symbol = (y * PILOT_SIDE + x) % mode.symbols;
          entries.push([(originY + y) * cols + originX + x, symbol]);
        }
    return entries;
  }
  function opticalRawCapacity(cols, rows, modeInput = DEFAULT_MODE) {
    const mode = resolveMode(modeInput);
    return Math.floor(((cols * rows - PILOT_CELL_COUNT) * mode.bits) / 8);
  }
  function packetPayloadCapacity(
    modeInput = DEFAULT_MODE,
    cols = SHORT_SIDE,
    rows = LONG_SIDE,
  ) {
    return opticalRawCapacity(cols, rows, modeInput) - HEADER_BYTES;
  }
  function makePacket({
    type,
    lane,
    session,
    sequence,
    sourceCount,
    chunkSize = null,
    symbol = 0,
    aux = 0,
    payload = new Uint8Array(0),
    flags = 0,
    mode = activeMode(),
  }) {
    const selectedMode = resolveMode(mode);
    const effectiveChunkSize = chunkSize ?? selectedMode.chunkBytes;
    payload = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    const control = type === TYPE.HELLO && (flags & CONTROL_FLAG);
    if(control && selectedMode.bits !== 2)throw new Error("HELLO requires grayscale control");
    const max = control ? CONTROL_CHUNK : packetPayloadCapacity(selectedMode);
    if (payload.length > max)
      throw new Error(
        `Payload ${payload.length} excede ${max} en ${selectedMode.label}`,
      );
    const header = new Uint8Array(HEADER_BYTES);
    header.set(MAGIC, 0);
    header[4] = PROTOCOL;
    header[5] = type;
    header[6] = lane & 3;
    header[7] = (flags & 0xf0) | selectedMode.bits;
    writeU32(header, 8, session >>> 0);
    writeU32(header, 12, sequence >>> 0);
    writeU32(header, 16, sourceCount >>> 0);
    writeU16(header, 20, effectiveChunkSize >>> 0);
    writeU16(header, 22, payload.length);
    writeU32(header, 24, symbol >>> 0);
    writeU32(header, 28, aux >>> 0);
    writeU32(header, 32, crc32(concatBytes(header.slice(0, 32), payload)));
    return concatBytes(header, payload);
  }
  function parsePacket(bytes, expectedModeInput = null) {
    if (!bytes || bytes.length < HEADER_BYTES) return null;
    for (let i = 0; i < MAGIC.length; i++)
      if (bytes[i] !== MAGIC[i]) return null;
    if (bytes[4] !== PROTOCOL) return null;
    const type = bytes[5],
      lane = bytes[6],
      flags = bytes[7],
      bits = flags & 0x0f,
      mode = modeByBits(bits);
    if (!mode || !Object.values(TYPE).includes(type) || lane > 2) return null;
    if (expectedModeInput && resolveMode(expectedModeInput).id !== mode.id)
      return null;
    const session = readU32(bytes, 8),
      sequence = readU32(bytes, 12),
      sourceCount = readU32(bytes, 16);
    const chunkSize = readU16(bytes, 20),
      payloadLength = readU16(bytes, 22),
      symbol = readU32(bytes, 24),
      aux = readU32(bytes, 28);
    const expected = readU32(bytes, 32);
    if (
      !session ||
      !sourceCount ||
      !chunkSize ||
      chunkSize > ((type === TYPE.HELLO && (flags & CONTROL_FLAG)) ? 1000 : mode.chunkBytes) ||
      payloadLength > packetPayloadCapacity(mode) ||
      HEADER_BYTES + payloadLength > bytes.length
    )
      return null;
    const payload = bytes.slice(HEADER_BYTES, HEADER_BYTES + payloadLength);
    const actual = crc32(concatBytes(bytes.slice(0, 32), payload));
    if (actual !== expected)
      return {
        bad: true,
        type,
        lane,
        session,
        sequence,
        expected,
        actual,
        modeId: mode.id,
        bits: mode.bits,
      };
    return {
      type,
      lane,
      flags,
      session,
      sequence,
      sourceCount,
      chunkSize,
      payloadLength,
      symbol,
      aux,
      payload,
      modeId: mode.id,
      bits: mode.bits,
      symbols: mode.symbols,
    };
  }
  function rawToSymbols(raw, cols, rows, modeInput = null) {
    const mode = resolveMode(
      modeInput || modeByBits(raw?.[7] & 0x0f) || activeMode(),
    );
    const cellCount = cols * rows;
    const symbols = new Uint8Array(cellCount);
    const pilots = new Map(pilotEntries(cols, rows, mode));
    for (const [position, value] of pilots) symbols[position] = value;
    let bitIndex = 0;
    const totalBits = raw.length * 8;
    for (let cell = 0; cell < cellCount; cell++) {
      if (pilots.has(cell)) continue;
      let value = 0;
      for (let bit = 0; bit < mode.bits; bit++) {
        value <<= 1;
        if (bitIndex < totalBits) {
          const byteIndex = bitIndex >> 3,
            shift = 7 - (bitIndex & 7);
          value |= (raw[byteIndex] >> shift) & 1;
        }
        bitIndex++;
      }
      symbols[cell] = value;
    }
    return symbols;
  }
  function symbolsToBytes(symbols, cols, rows, modeInput = DEFAULT_MODE) {
    const mode = resolveMode(modeInput);
    const capacity = opticalRawCapacity(cols, rows, mode);
    const bytes = new Uint8Array(capacity);
    const pilots = new Set(
      pilotEntries(cols, rows, mode).map(([position]) => position),
    );
    let bitIndex = 0;
    for (let cell = 0; cell < symbols.length; cell++) {
      if (pilots.has(cell)) continue;
      for (let bit = mode.bits - 1; bit >= 0; bit--) {
        if (bitIndex >= capacity * 8) break;
        const byteIndex = bitIndex >> 3,
          shift = 7 - (bitIndex & 7);
        bytes[byteIndex] |= ((symbols[cell] >> bit) & 1) << shift;
        bitIndex++;
      }
    }
    return bytes;
  }
  // HPS7 separated robust control from high-density DATA. This port adds SECDED,
  // interleaving, compact metadata and bounded reassembly. Channel is always gray2.
  function hammingEncode(n) {
    let w=((n>>3)&1)<<2|((n>>2)&1)<<4|((n>>1)&1)<<5|(n&1)<<6;
    const b=i=>(w>>i)&1;
    w|=(b(2)^b(4)^b(6))|(b(2)^b(5)^b(6))<<1|(b(4)^b(5)^b(6))<<3;
    let parity=0;for(let i=0;i<7;i++)parity^=(w>>i)&1;
    return w|(parity<<7);
  }
  function hammingDecode(w) {
    const b=i=>(w>>i)&1;
    const syndrome=(b(0)^b(2)^b(4)^b(6))|((b(1)^b(2)^b(5)^b(6))<<1)|((b(3)^b(4)^b(5)^b(6))<<2);
    let parity=0;for(let i=0;i<8;i++)parity^=b(i);
    if(syndrome&&!parity)return {n:0,bad:true,corrected:0};
    if(parity)w^=1<<(syndrome?syndrome-1:7);
    return {n:((w>>2)&1)<<3|((w>>4)&1)<<2|((w>>5)&1)<<1|((w>>6)&1),bad:false,corrected:parity};
  }
  function controlEncode(raw) {
    const capacity=opticalRawCapacity(CONTROL_COLS,CONTROL_ROWS,CONTROL_MODE); // 119 B; 118 used by SECDED
    if(raw.length*2>capacity)throw new Error('HELLO control fragment too large');
    const out=new Uint8Array(capacity),coded=capacity-(capacity%2);
    for(let i=0;i<coded;i++){
      const byte=raw[i>>1]||0,n=(i&1)?byte&15:byte>>>4;
      out[(i*157)%coded]=hammingEncode(n);
    }
    return out;
  }
  function controlDecode(channel) {
    const capacity=opticalRawCapacity(CONTROL_COLS,CONTROL_ROWS,CONTROL_MODE);
    if(channel.length!==capacity)return null;
    const coded=capacity-(capacity%2);
    const raw=new Uint8Array(coded/2),bad=new Uint8Array(coded/2),fixes=new Uint8Array(coded/2);
    for(let i=0;i<coded;i++){
      const value=hammingDecode(channel[(i*157)%coded]),j=i>>1;
      raw[j]|=value.n<<((i&1)?0:4);bad[j]|=value.bad?1:0;fixes[j]+=value.corrected;
    }
    const packet=parsePacket(raw,CONTROL_MODE);
    if(!packet||packet.bad||packet.type!==TYPE.HELLO||!(packet.flags&CONTROL_FLAG))return null;
    const used=HEADER_BYTES+packet.payload.length;
    if(bad.subarray(0,used).some(v=>v))return null;
    return {packet,corrected:fixes.subarray(0,used).reduce((a,b)=>a+b,0)};
  }
  function compactHello(meta) {
    const bytes=encoder.encode(JSON.stringify(['H7C1',meta.bits,meta.size,meta.fileCrc,
      meta.sha256,meta.name,meta.type,meta.lastModified||0]));
    if(bytes.length>MAX_META_BYTES)throw new Error('Nombre/tipo de archivo demasiado extenso');
    return bytes;
  }
  function utf8Prefix(text,maxBytes) {
    let out='';
    for(const ch of String(text||'')){const next=out+ch;if(encoder.encode(next).length>maxBytes)break;out=next;}
    return encoder.encode(out);
  }
  function compactQuickGuide(meta) {
    const name=utf8Prefix(meta.name,QUICK_GUIDE_NAME_BYTES);
    const out=new Uint8Array(20+name.length);
    out.set([0x48,0x37,0x47,0x31],0);
    out[4]=meta.bits;
    writeU32(out,5,meta.size>>>0);
    writeU32(out,9,meta.fileCrc>>>0);
    writeU32(out,13,meta.sourceCount>>>0);
    writeU16(out,17,meta.chunkSize>>>0);
    out[19]=name.length;out.set(name,20);
    if(out.length>CONTROL_CHUNK*3)throw new Error('Nombre de archivo demasiado largo para la guía H7 estática');
    return out;
  }
  function acceptQuickGuide(packet) {
    if(packet.bad||packet.type!==TYPE.HELLO||packet.bits!==2||!(packet.flags&CONTROL_FLAG)||!(packet.flags&GUIDE_FLAG))return null;
    const total=packet.symbol>>>16,index=packet.symbol&65535;
    if(total!==3||index>=3||packet.payload.length>CONTROL_CHUNK)return null;
    const now=performance.now();
    for(const [key,entry]of quickGuideAssemblies)if(now-entry.at>10000)quickGuideAssemblies.delete(key);
    const key=[packet.session,packet.aux,packet.sourceCount,packet.chunkSize].join(':');
    let entry=quickGuideAssemblies.get(key);
    if(!entry){if(quickGuideAssemblies.size>=4)quickGuideAssemblies.delete(quickGuideAssemblies.keys().next().value);entry={parts:new Map(),at:now};quickGuideAssemblies.set(key,entry);}
    entry.at=now;entry.parts.set(index,packet.payload);
    app.helloProgress={parts:entry.parts.size,total:3,bits:((packet.flags>>4)&3)+2,guide:true};
    if(entry.parts.size!==3)return null;
    const full=concatBytes(entry.parts.get(0),entry.parts.get(1),entry.parts.get(2));
    if(crc32(full)!==packet.aux||full.length<20||full[0]!==0x48||full[1]!==0x37||full[2]!==0x47||full[3]!==0x31)return null;
    const bits=full[4],size=readU32(full,5),fileCrc=readU32(full,9),sourceCount=readU32(full,13),chunkSize=readU16(full,17),nameLen=full[19],mode=modeByBits(bits);
    if(!mode||nameLen>QUICK_GUIDE_NAME_BYTES||20+nameLen!==full.length||sourceCount!==packet.sourceCount||chunkSize!==packet.chunkSize||chunkSize!==mode.chunkBytes||sourceCount!==Math.max(1,Math.ceil(size/chunkSize)))return null;
    const name=decoderText.decode(full.slice(20));
    if(!name)return null;
    quickGuideAssemblies.delete(key);
    return {engine:ENGINE_NAME,version:VERSION,protocol:PROTOCOL,transport:'TriFrame-3',mode:mode.id,modeLabel:mode.label,bits:mode.bits,symbols:mode.symbols,name,type:'application/octet-stream',size,fileCrc,sha256:null,lastModified:0,sourceCount,chunkSize,quickGuide:true};
  }

  function acceptControlHello(packet) {
    if(packet.bad||packet.type!==TYPE.HELLO||packet.bits!==2||!(packet.flags&CONTROL_FLAG))return null;
    const total=packet.symbol>>>16,index=packet.symbol&65535;
    if(total<1||total>Math.ceil(MAX_META_BYTES/CONTROL_CHUNK)||index>=total||
      packet.payload.length<1||packet.payload.length>CONTROL_CHUNK||
      (index<total-1&&packet.payload.length!==CONTROL_CHUNK))return null;
    const now=performance.now();
    for(const [key,entry]of helloAssemblies)if(now-entry.at>10000)helloAssemblies.delete(key);
    const key=[packet.session,packet.aux,total,packet.sourceCount,packet.chunkSize].join(':');
    let entry=helloAssemblies.get(key);
    if(!entry){
      if(helloAssemblies.size>=4)helloAssemblies.delete(helloAssemblies.keys().next().value);
      entry={parts:new Map(),at:now};helloAssemblies.set(key,entry);
    }
    entry.at=now;entry.parts.set(index,packet.payload);
    app.helloProgress={parts:entry.parts.size,total,bits:((packet.flags>>4)&3)+2};
    if(entry.parts.size!==total)return null;
    const full=concatBytes(...Array.from({length:total},(_,i)=>entry.parts.get(i)));
    if(full.length>MAX_META_BYTES||crc32(full)!==packet.aux){helloAssemblies.delete(key);return null;}
    let a;try{a=JSON.parse(decoderText.decode(full));}catch{return null;}
    if(!Array.isArray(a)||a.length!==8||a[0]!=='H7C1')return null;
    const [_,bits,size,fileCrc,sha256,name,type,lastModified]=a,mode=modeByBits(bits);
    if(!mode||bits!==(((packet.flags>>4)&3)+2)||!Number.isSafeInteger(size)||size<0||size>128*1024*1024||
      !Number.isInteger(fileCrc)||fileCrc<0||fileCrc>0xffffffff||
      (sha256!==null&&!(typeof sha256==='string'&&/^[a-f0-9]{64}$/.test(sha256)))||
      typeof name!=='string'||!name||typeof type!=='string'||type.length>256||
      !Number.isSafeInteger(lastModified)||lastModified<0||
      packet.chunkSize!==mode.chunkBytes||packet.sourceCount!==Math.max(1,Math.ceil(size/mode.chunkBytes)))return null;
    return {engine:ENGINE_NAME,version:VERSION,protocol:PROTOCOL,transport:'TriFrame-3',
      mode:mode.id,modeLabel:mode.label,bits:mode.bits,symbols:mode.symbols,name,type,size,
      fileCrc,sha256,lastModified,sourceCount:packet.sourceCount,chunkSize:packet.chunkSize};
  }

  function opticalSymbols(raw) {
    const mode=modeByBits(raw[7]&15)||activeMode();
    if(!(raw[7]&CONTROL_FLAG))return rawToSymbols(raw,LONG_SIDE,SHORT_SIDE,mode);
    const small=rawToSymbols(controlEncode(raw),CONTROL_COLS,CONTROL_ROWS,CONTROL_MODE);
    const symbols=new Uint8Array(LONG_SIDE*SHORT_SIDE);
    for(let y=0;y<SHORT_SIDE;y++)for(let x=0;x<LONG_SIDE;x++)symbols[y*LONG_SIDE+x]=small[(y>>1)*CONTROL_COLS+(x>>1)];
    return symbols;
  }
  function renderCurrentTriFrame() {
    if(app.currentLanePackets.some(p=>!p))return;
    const lanes=app.currentLanePackets.map(raw=>({symbols:opticalSymbols(raw),palette:modeByBits(raw[7]&15).palette}));
    const raster=globalThis.HopperAnchorScan.framePixels(lanes);
    const canvas=$("stageDockCanvas"),ctx=canvas.getContext("2d",{alpha:false});
    if(canvas.width!==raster.width||canvas.height!==raster.height){canvas.width=raster.width;canvas.height=raster.height;}
    const image=ctx.createImageData(raster.width,raster.height);image.data.set(raster.data);ctx.putImageData(image,0,0);
  }
  function xorInto(target, source) {
    const length = Math.min(target.length, source.length);
    for (let i = 0; i < length; i++) target[i] ^= source[i];
    return target;
  }
  function xorshift(seed) {
    let x = seed >>> 0 || 0x6d2b79f5;
    return () => {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return x >>> 0;
    };
  }
  function fountainDegree(seed, count) {
    if (count <= 1) return 1;
    const next = xorshift((seed ^ 0x9e3779b9) >>> 0),
      r = next() / 0x100000000;
    const degree =
      r < 0.16 ? 1 : r < 0.54 ? 2 : r < 0.78 ? 3 : r < 0.92 ? 4 : 5;
    return Math.max(1, Math.min(count, degree));
  }
  function fountainIndices(seed, count, forcedDegree = 0) {
    if (count <= 0) return [];
    const next = xorshift((seed ^ (count * 0x45d9f3b)) >>> 0);
    const degree = Math.max(
      1,
      Math.min(count, forcedDegree || fountainDegree(seed, count)),
    );
    const set = new Set();
    while (set.size < degree) set.add(next() % count);
    return Array.from(set);
  }
  function makeParity(blocks, seed, forcedDegree = 0) {
    const indices = fountainIndices(seed, blocks.length, forcedDegree);
    const data = new Uint8Array(blocks[0].length);
    for (const index of indices) xorInto(data, blocks[index]);
    return { indices, data, degree: indices.length, seed: seed >>> 0 };
  }
  function createFountainDecoder(count, chunkSize, onKnown) {
    const known = new Array(count).fill(null);
    const equations = new Map();
    const byIndex = Array.from({ length: count }, () => new Set());
    const seenSeeds = new Set();
    const queue = [];
    const maxEquations = Math.min(10000, Math.max(512, count * 2));
    let solved = 0,
      equationId = 1,
      propagating = false;
    const clone = (value) =>
      value instanceof Uint8Array ? value.slice() : new Uint8Array(value);
    function removeEquation(id) {
      const equation = equations.get(id);
      if (!equation) return;
      for (const index of equation.unknown) byIndex[index].delete(id);
      equations.delete(id);
    }
    function trimEquations() {
      while (equations.size > maxEquations) {
        let worstId = null,
          worstDegree = -1;
        for (const [id, equation] of equations) {
          if (equation.unknown.size > worstDegree) {
            worstDegree = equation.unknown.size;
            worstId = id;
          }
          if (worstDegree >= 5) break;
        }
        if (worstId == null) break;
        removeEquation(worstId);
      }
    }
    function addKnown(index, data) {
      if (index < 0 || index >= count || known[index]) return false;
      const value = clone(data);
      if (value.length !== chunkSize) return false;
      known[index] = value;
      solved++;
      queue.push(index);
      try {
        onKnown?.(index, value, solved, count);
      } catch (error) {
        console.error(error);
      }
      propagate();
      return true;
    }
    function registerEquation(indices, data) {
      const reduced = clone(data),
        unknown = [];
      for (const index of indices) {
        if (index < 0 || index >= count) return false;
        if (known[index]) xorInto(reduced, known[index]);
        else if (!unknown.includes(index)) unknown.push(index);
      }
      if (!unknown.length) return false;
      if (unknown.length === 1) return addKnown(unknown[0], reduced);
      const id = equationId++;
      equations.set(id, { id, unknown: new Set(unknown), data: reduced });
      for (const index of unknown) byIndex[index].add(id);
      trimEquations();
      return true;
    }
    function propagate() {
      if (propagating) return;
      propagating = true;
      try {
        while (queue.length) {
          const index = queue.shift(),
            value = known[index],
            ids = Array.from(byIndex[index]);
          byIndex[index].clear();
          for (const id of ids) {
            const equation = equations.get(id);
            if (!equation || !equation.unknown.has(index)) continue;
            xorInto(equation.data, value);
            equation.unknown.delete(index);
            if (!equation.unknown.size) {
              removeEquation(id);
              continue;
            }
            if (equation.unknown.size === 1) {
              const only = equation.unknown.values().next().value,
                data = equation.data.slice();
              removeEquation(id);
              addKnown(only, data);
            }
          }
        }
      } finally {
        propagating = false;
      }
    }
    function addSystematic(index, data) {
      return addKnown(index, data);
    }
    function addParity(seed, data) {
      seed >>>= 0;
      if (seenSeeds.has(seed)) return false;
      seenSeeds.add(seed);
      if (seenSeeds.size > 20000) {
        const first = seenSeeds.values().next().value;
        seenSeeds.delete(first);
      }
      return registerEquation(fountainIndices(seed, count), data);
    }
    function snapshot() {
      return {
        known: solved,
        total: count,
        missing: count - solved,
        equations: equations.size,
        complete: solved === count,
      };
    }
    function blocks() {
      return known.map((value) => value?.slice() || null);
    }
    return {
      addSystematic,
      addParity,
      snapshot,
      blocks,
      get complete() {
        return solved === count;
      },
      get knownCount() {
        return solved;
      },
    };
  }
  class FlightRecorder {
    constructor() {
      this.startedAt = performance.now();
      this.events = [];
      this.pendingRender = false;
      this.restore();
    }
    restore() {
      try {
        const raw = localStorage.getItem("hopperlink-one-flight-recorder");
        const parsed = raw ? JSON.parse(raw) : null;
        if (Array.isArray(parsed)) this.events = parsed.slice(-250);
      } catch {}
    }
    persist() {
      try {
        localStorage.setItem(
          "hopperlink-one-flight-recorder",
          JSON.stringify(this.events.slice(-250)),
        );
      } catch {}
    }
    record(category, event, detail = {}, confidence = null) {
      const entry = {
        timestamp: nowIso(),
        elapsedMs: Math.round(performance.now() - this.startedAt),
        role: app.role,
        phase: app.phase,
        category,
        event,
        confidence: Number.isFinite(confidence) ? Math.round(confidence) : null,
        detail,
      };
      this.events.push(entry);
      if (this.events.length > MAX_FLIGHT_EVENTS)
        this.events.splice(0, this.events.length - MAX_FLIGHT_EVENTS);
      if (this.events.length % 10 === 0) this.persist();
      this.scheduleRender();
      return entry;
    }
    scheduleRender() {
      if (this.pendingRender) return;
      this.pendingRender = true;
      setTimeout(() => {
        this.pendingRender = false;
        this.render();
      }, 80);
    }
    render() {
      const host = $("flightLog");
      if (!host) return;
      $("blackboxCount").textContent =
        `${this.events.length}evento${this.events.length === 1 ? "" : "s"}`;
      const valid = app.detection.valid,
        rejected = app.detection.rejected;
      const health =
        valid + rejected ? Math.round((valid / (valid + rejected)) * 100) : 100;
      $("blackboxHealth").textContent = valid + rejected ? `Paquetes válidos:${health}%` : "Sin paquetes validados";
      const recent = this.events.slice(-100).reverse();
      if (!recent.length) {
        host.innerHTML =
          '<div class="flight-empty">La caja negra registrará cada transición y métrica importante.</div>';
        return;
      }
      host.textContent = "";
      const fragment = document.createDocumentFragment();
      for (const item of recent) {
        const row = document.createElement("div");
        row.className = "flight-row";
        const time = new Date(item.timestamp).toLocaleTimeString();
        const detail = safeDetail(item.detail);
        row.innerHTML = `<span class="time"></span><span class="category"></span><span class="phase"></span><span class="event"></span><span class="detail"></span><span class="confidence"></span>`;
        row.children[0].textContent = time;
        row.children[1].textContent = item.category.toUpperCase();
        row.children[2].textContent = item.phase;
        row.children[3].textContent = item.event;
        row.children[4].textContent = detail;
        row.children[4].title = detail;
        row.children[5].textContent =
          item.confidence == null ? "—" : `${item.confidence}%`;
        fragment.appendChild(row);
      }
      host.appendChild(fragment);
    }
    clear() {
      this.events = [];
      this.startedAt = performance.now();
      this.persist();
      this.render();
    }
    exportJson() {
      this.download(
        `hopperlink-one-flight-${Date.now()}.json`,
        JSON.stringify(
          {
            engine: ENGINE_NAME,
            version: VERSION,
            exportedAt: nowIso(),
            events: this.events,
          },
          null,
          2,
        ),
        "application/json",
      );
    }
    exportCsv() {
      const head = [
        "timestamp",
        "elapsedMs",
        "role",
        "phase",
        "category",
        "event",
        "confidence",
        "detail",
      ];
      const escape = (value) =>
        `"${String(value ?? "").replaceAll('"', '""')}"`;
      const rows = [head.join(",")];
      for (const item of this.events)
        rows.push(
          [
            item.timestamp,
            item.elapsedMs,
            item.role,
            item.phase,
            item.category,
            item.event,
            item.confidence ?? "",
            safeDetail(item.detail),
          ]
            .map(escape)
            .join(","),
        );
      this.download(
        `hopperlink-one-flight-${Date.now()}.csv`,
        rows.join("\n"),
        "text/csv",
      );
    }
    download(name, content, type) {
      const blob = new Blob([content], { type }),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
  const flight = new FlightRecorder();
  class SonicAssist {
    constructor() {
      this.context = null;
      this.stream = null;
      this.source = null;
      this.analyser = null;
      this.raf = 0;
      this.callback = null;
      this.hits = { ACK: 0, COMPLETE: 0 };
      this.lastFire = { ACK: 0, COMPLETE: 0 };
      this.frequencies = { ACK: 12800, COMPLETE: 14600 };
    }
    async contextReady() {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error("Web Audio no disponible");
      if (!this.context)
        this.context = new AudioContext({ latencyHint: "interactive" });
      if (this.context.state !== "running") await this.context.resume();
      return this.context;
    }
    async primeOutput() {
      await this.contextReady();
      setSonicStatus("SONIC·SALIDA LISTA", "online");
      flight.record(
        "sonic",
        "output-ready",
        { sampleRate: this.context.sampleRate },
        100,
      );
    }
    async startListener(callback) {
      if (this.stream) {
        this.callback = callback;
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error("Micrófono no disponible");
      const context = await this.contextReady();
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
        video: false,
      });
      this.source = context.createMediaStreamSource(this.stream);
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 8192;
      this.analyser.smoothingTimeConstant = 0.08;
      this.source.connect(this.analyser);
      this.callback = callback;
      setSonicStatus("SONIC·ESCUCHANDO", "online");
      flight.record(
        "sonic",
        "listener-ready",
        { sampleRate: context.sampleRate, fft: this.analyser.fftSize },
        100,
      );
      this.listenLoop();
    }
    levelAt(data, frequency) {
      const binWidth = this.context.sampleRate / this.analyser.fftSize;
      const center = Math.round(frequency / binWidth);
      let peak = -160;
      for (let delta = -2; delta <= 2; delta++)
        peak = Math.max(peak, data[clamp(center + delta, 0, data.length - 1)]);
      let noise = 0,
        count = 0;
      for (let delta = -28; delta <= 28; delta++) {
        if (Math.abs(delta) <= 5) continue;
        noise += data[clamp(center + delta, 0, data.length - 1)];
        count++;
      }
      return {
        peak,
        noise: count ? noise / count : -160,
        margin: peak - (count ? noise / count : -160),
      };
    }
    listenLoop() {
      cancelAnimationFrame(this.raf);
      const data = new Float32Array(this.analyser.frequencyBinCount);
      const loop = () => {
        if (!this.analyser) return;
        this.analyser.getFloatFrequencyData(data);
        const time = performance.now();
        for (const type of ["ACK", "COMPLETE"]) {
          const level = this.levelAt(data, this.frequencies[type]);
          const detected = level.peak > -76 && level.margin > 9;
          this.hits[type] = detected
            ? this.hits[type] + 1
            : Math.max(0, this.hits[type] - 1);
          if (this.hits[type] >= 3 && time - this.lastFire[type] > 1800) {
            this.hits[type] = 0;
            this.lastFire[type] = time;
            flight.record(
              "sonic",
              `${type.toLowerCase()}-detected`,
              {
                frequency: this.frequencies[type],
                peak: level.peak,
                margin: level.margin,
              },
              clamp(level.margin * 5, 0, 100),
            );
            try {
              this.callback?.(type, level);
            } catch (error) {
              console.error(error);
            }
          }
        }
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }
    async emit(type) {
      const context = await this.contextReady();
      const frequency = this.frequencies[type];
      if (!frequency) return;
      const pulses = type === "COMPLETE" ? 3 : 2;
      let at = context.currentTime + 0.025;
      for (let i = 0; i < pulses; i++) {
        const oscillator = context.createOscillator(),
          gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.055, at + 0.018);
        gain.gain.setValueAtTime(0.055, at + 0.14);
        gain.gain.linearRampToValueAtTime(0, at + 0.18);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(at);
        oscillator.stop(at + 0.19);
        at += 0.27;
      }
      flight.record(
        "sonic",
        `${type.toLowerCase()}-emitted`,
        { frequency, pulses },
        100,
      );
    }
    stopListener() {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      try {
        this.source?.disconnect();
      } catch {}
      for (const track of this.stream?.getTracks?.() || []) track.stop();
      this.stream = null;
      this.source = null;
      this.analyser = null;
      this.callback = null;
      setSonicStatus("SONIC EN ESPERA", "");
    }
  }
  const sonic = new SonicAssist();
  function modeMetrics(modeInput = app.modeId) {
    const mode = resolveMode(modeInput),
      range = theoreticalRange(mode);
    return {
      mode,
      range,
      rangeText: `${range.minKib.toFixed(1)}–${range.maxKib.toFixed(1)} KiB/s teóricos`,
      capacityText: `${mode.chunkBytes.toLocaleString()} B/lane`,
    };
  }
  function updateModeUI() {
    const { mode, rangeText, capacityText } = modeMetrics();
    document.documentElement.dataset.opticalMode = mode.id;
    document.querySelectorAll("button[data-optical-mode]").forEach((button) => {
      const active = button.dataset.opticalMode === mode.id;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    if ($("selectedModeName")) $("selectedModeName").textContent = mode.label;
    if ($("selectedModeSpeed")) $("selectedModeSpeed").textContent = rangeText;
    if ($("selectedModeCapacity"))
      $("selectedModeCapacity").textContent = capacityText;
    if ($("txChunkSize") && !app.tx)
      $("txChunkSize").textContent = `${mode.chunkBytes} B`;
    if ($("stageMode"))
      $("stageMode").textContent = `${mode.shortLabel}·${mode.bits}b`;
    if ($("rxMode") && !app.rx) $("rxMode").textContent = "AUTO 2/3/4-bit";
  }
  function invalidatePreparedTransfer(reason) {
    if (app.tx) {
      app.tx.running = false;
      app.tx.loopToken++;
    }
    app.tx = null;
    $("launchBtn").disabled = true;
    $("txSourceCount").textContent = "—";
    $("txSession").textContent = "—";
    setTxProgress(0, reason || "Vuelve a preparar el archivo");
  }
  function selectOpticalMode(modeId) {
    const mode = resolveMode(modeId);
    if (app.stageOpen || app.tx?.running) {
      alertError("Cierra la transmisión antes de cambiar la modulación.");
      return;
    }
    if (mode.id === app.modeId) return;
    const previous = app.modeId;
    app.modeId = mode.id;
    try {
      localStorage.setItem("hopperlink-one-optical-mode", mode.id);
    } catch {}
    if (app.tx)
      invalidatePreparedTransfer(
        `Modo cambiado a ${mode.label}·vuelve a preparar`,
      );
    updateModeUI();
    flight.record(
      "adaptive",
      "optical-mode-selected",
      {
        from: previous,
        to: mode.id,
        bits: mode.bits,
        symbols: mode.symbols,
        chunkBytes: mode.chunkBytes,
        theoretical: theoreticalRange(mode),
      },
      100,
    );
  }
  function selectFile(file) {
    if (!file) return;
    app.selectedFile = file;
    if (app.tx)
      invalidatePreparedTransfer("Archivo cambiado·vuelve a preparar");
    $("dropTitle").textContent = file.name;
    $("dropDetail").textContent =
      `${formatBytes(file.size)}·${file.type || "tipo desconocido"}·listo para preparar`;
    $("txFileSize").textContent = formatBytes(file.size);
    $("txSourceCount").textContent = "—";
    $("txSession").textContent = "—";
    $("launchBtn").disabled = true;
    setTxProgress(0, "Archivo seleccionado");
    flight.record(
      "file",
      "selected",
      {
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
      },
      100,
    );
  }
  function setTxProgress(percent, label) {
    const value = clamp(percent, 0, 100);
    $("txProgressBar").style.width = `${value}%`;
    $("txProgressText").textContent = `${Math.round(value)}%`;
    if (label) $("txProgressLabel").textContent = label;
  }
  function splitBlocks(bytes, chunkSize) {
    const count = Math.max(1, Math.ceil(bytes.length / chunkSize)),
      blocks = [];
    for (let index = 0; index < count; index++) {
      const block = new Uint8Array(chunkSize);
      const start = index * chunkSize;
      block.set(bytes.slice(start, Math.min(bytes.length, start + chunkSize)));
      blocks.push(block);
    }
    return blocks;
  }
  async function prepareFile() {
    const file = app.selectedFile || $("fileInput").files?.[0];
    if (!file) {
      alertError("Selecciona un archivo antes de prepararlo.");
      return;
    }
    const mode = activeMode();
    const button = $("prepareBtn");
    button.disabled = true;
    button.textContent = "Preparando…";
    setPhase("PREPARING");
    setEngineStatus("PREPARANDO MOTOR", "mid");
    setTxProgress(8, `Leyendo archivo·${mode.label}…`);
    try {
      if(file.size>128*1024*1024)throw new Error("Límite de esta versión: 128 MiB por archivo");
      const bytes = new Uint8Array(await file.arrayBuffer());
      setTxProgress(34, "Calculando CRC32…");
      const fileCrc = crc32(bytes);
      setTxProgress(55, "Calculando SHA-256…");
      const sha256 = await sha256Hex(bytes);
      setTxProgress(72, `Construyendo bloques de ${mode.chunkBytes} B…`);
      const blocks = splitBlocks(bytes, mode.chunkBytes),
        session = randomSession();
      const meta={engine:ENGINE_NAME,version:VERSION,protocol:PROTOCOL,transport:"TriFrame-3",
        mode:mode.id,modeLabel:mode.label,name:file.name,type:file.type||"application/octet-stream",
        size:file.size,lastModified:file.lastModified||0,fileCrc,sha256,sourceCount:blocks.length,
        chunkSize:mode.chunkBytes,bits:mode.bits,symbols:mode.symbols};
      const payload=compactHello(meta);
      const helloParts=[];
      for(let offset=0;offset<payload.length;offset+=CONTROL_CHUNK)helloParts.push(payload.slice(offset,offset+CONTROL_CHUNK));
      const guidePayload=compactQuickGuide(meta),guideParts=[];
      for(let i=0;i<3;i++)guideParts.push(guidePayload.slice(i*CONTROL_CHUNK,Math.min(guidePayload.length,(i+1)*CONTROL_CHUNK)));
      app.tx = {
        file,
        bytes,
        blocks,
        meta,
        helloPayload: payload,
        helloParts,helloCursor:0,helloChecksum:crc32(payload),
        guidePayload,guideParts,guideChecksum:crc32(guidePayload),guidePackets:null,
        session,
        modeId: mode.id,
        sequence: 1,
        systematicIndex: 0,
        repeatIndex: 0,
        paritySeed: (randomSession() | 1) >>> 0,
        frames: 0,
        packets: 0,
        running: false,
        paused: false,
        completed: false,
        fps: mode.defaultFps,
        renderSamples: [],
        startedAt: 0,
        lastMetricAt: 0,
        loopToken: 0,
        phase: "READY",
      };
      $("txSourceCount").textContent = blocks.length.toLocaleString();
      $("txSession").textContent =
        `${session.toString(16).toUpperCase().padStart(8, "0")}`;
      $("txChunkSize").textContent = `${mode.chunkBytes} B`;
      $("launchBtn").disabled = false;
      setTxProgress(100, `Preparado·${mode.label}·fullscreen disponible`);
      setPhase("READY");
      setEngineStatus("MOTOR PREPARADO", "online");
      flight.record(
        "engine",
        "file-prepared",
        {
          session,
          mode: mode.id,
          bits: mode.bits,
          symbols: mode.symbols,
          sourceCount: blocks.length,
          chunkSize: mode.chunkBytes,
          fileSize: file.size,
          crc32: fileCrc.toString(16).padStart(8, "0"),
          sha256,
          theoretical: theoreticalRange(mode),
        },
        100,
      );
    } catch (error) {
      app.tx = null;
      setTxProgress(0, "No se pudo preparar");
      alertError(`No se pudo preparar el archivo: ${error.message}`, error);
    } finally {
      button.disabled = false;
      button.textContent = app.tx ? "Repreparar archivo" : "Preparar archivo";
    }
  }
  async function requestFullscreen(element = document.documentElement) {
    const fn = element.requestFullscreen || element.webkitRequestFullscreen;
    if (!fn) return false;
    try {
      const result = fn.call(element, { navigationUI: "hide" });
      if (result?.then) await result;
      return true;
    } catch (error) {
      flight.record(
        "fullscreen",
        "request-failed",
        { message: error.message },
        0,
      );
      return false;
    }
  }
  async function exitFullscreen() {
    const active =
      document.fullscreenElement || document.webkitFullscreenElement;
    const fn = document.exitFullscreen || document.webkitExitFullscreen;
    if (active && fn)
      try {
        const result = fn.call(document);
        if (result?.then) await result;
      } catch {}
  }
  async function acquireWakeLock() {
    if (!navigator.wakeLock?.request) return false;
    try {
      app.wakeLock = await navigator.wakeLock.request("screen");
      app.wakeLock.addEventListener("release", () =>
        flight.record("power", "wake-lock-released", {}, 50),
      );
      flight.record("power", "wake-lock-acquired", {}, 100);
      return true;
    } catch (error) {
      flight.record("power", "wake-lock-failed", { message: error.message }, 0);
      return false;
    }
  }
  async function releaseWakeLock() {
    try {
      await app.wakeLock?.release();
    } catch {}
    app.wakeLock = null;
  }
  async function tryPortraitLock() {
    try {
      if (screen.orientation?.lock) {
        await screen.orientation.lock("portrait");
        flight.record(
          "fullscreen",
          "orientation-lock",
          { orientation: "portrait" },
          100,
        );
        return true;
      }
    } catch (error) {
      flight.record(
        "fullscreen",
        "orientation-lock-unavailable",
        { message: error.message },
        30,
      );
    }
    return false;
  }
  function showStage() {
    app.stageOpen = true;
    document.documentElement.classList.add("triframe-open");
    $("transmissionStage").classList.add("active");
    $("transmissionStage").setAttribute("aria-hidden", "false");
  }
  async function launchTransmission() {
    if (!app.tx) {
      alertError("Prepara primero el archivo.");
      return;
    }
    await requestFullscreen(document.documentElement);
    showStage();
    acquireWakeLock();
    tryPortraitLock();
    setPhase("TX_HELLO");
    app.tx.phase = "HELLO";
    app.tx.running = false;
    app.tx.paused = false;
    app.tx.completed = false;
    $("transmissionStage").classList.remove("data-live");
    $("stageFileName").textContent =
      `${app.tx.file.name}·${formatBytes(app.tx.file.size)}`;
    $("stagePhase").textContent = "GUÍA H7 ESTÁTICA";
    $("stageRate").textContent = "CONTROL · FIJO";
    $("stageMode").textContent =
      `${resolveMode(app.tx.modeId).shortLabel}·${resolveMode(app.tx.modeId).bits}b`;
    $("stageCoverage").textContent = "0%";
    $("stageStartBtn").hidden = false;
    $("stageStartBtn").disabled = false;
    $("stageStartBtn").textContent = "Receptor listo · Iniciar DATA";
    $("stagePauseBtn").hidden = true;
    $("stageMessageTitle").textContent =
      "Muestra esta pantalla completa al receptor";
    $("stageMessageDetail").textContent =
      "Guía gris fija: nombre, tamaño, modo y CRC. No cambia hasta recibir ACK del receptor.";
    renderHelloTriFrame();
    flight.record(
      "tx",
      "triframe-opened",
      {
        session: app.tx.session,
        lanes: 3,
        mode: app.tx.modeId,
        bits: resolveMode(app.tx.modeId).bits,
        fullscreen: !!(
          document.fullscreenElement || document.webkitFullscreenElement
        ),
      },
      100,
    );
    if ($("sonicToggle").checked) {
      setSonicStatus("SONIC·INICIANDO", "mid");
      sonic
        .startListener((type, level) => {
          if (type === "ACK" && app.tx?.phase === "HELLO") {
            setSonicStatus("SONIC·ACK✓", "online");
            $("stageMessageTitle").textContent = "ACK sónico recibido";
            $("stageMessageDetail").textContent =
              "La transferencia DATA comenzará automáticamente.";
            flight.record("tx", "receiver-ack", { level }, 100);
            setTimeout(() => startData("sonic-ack"), 450);
          } else if (type === "COMPLETE" && app.tx?.running) {
            setSonicStatus("SONIC·COMPLETE✓", "online");
            finishTransmission("receiver-complete");
          }
        })
        .catch((error) => {
          setSonicStatus("SONIC·FALLBACK VISUAL", "mid");
          flight.record(
            "sonic",
            "listener-fallback",
            { message: error.message },
            0,
          );
        });
    } else setSonicStatus("SONIC·DESACTIVADO", "");
  }
  function nextSequence() {
    return app.tx.sequence++ >>> 0 || 1;
  }
  function helloPacket(lane, index = 0) {
    const tx=app.tx,parts=tx.helloParts;
    return makePacket({type:TYPE.HELLO,lane,session:tx.session,sequence:nextSequence(),
      sourceCount:tx.blocks.length,chunkSize:tx.meta.chunkSize,
      symbol:(parts.length<<16)|(index%parts.length),aux:tx.helloChecksum,
      payload:parts[index%parts.length],flags:CONTROL_FLAG|((resolveMode(tx.modeId).bits-2)<<4),mode:CONTROL_MODE});
  }
  function quickGuidePacket(lane) {
    const tx=app.tx,part=tx.guideParts[lane]||new Uint8Array(0);
    return makePacket({type:TYPE.HELLO,lane,session:tx.session,sequence:lane+1,
      sourceCount:tx.blocks.length,chunkSize:tx.meta.chunkSize,symbol:(3<<16)|lane,aux:tx.guideChecksum,
      payload:part,flags:CONTROL_FLAG|GUIDE_FLAG|((resolveMode(tx.modeId).bits-2)<<4),mode:CONTROL_MODE});
  }
  function renderHelloTriFrame() {
    if (!app.tx) return;
    const tx=app.tx;
    if(!tx.guidePackets)tx.guidePackets=[0,1,2].map(quickGuidePacket);
    app.currentLanePackets=tx.guidePackets;
    renderCurrentTriFrame();
  }
  function startHelloCarousel() { clearInterval(app.helloTimer); }
  function nextParityPacket(lane) {
    const mode = resolveMode(app.tx.modeId);
    app.tx.paritySeed = (app.tx.paritySeed + 0x9e3779b9) >>> 0 || 1;
    const parity = makeParity(app.tx.blocks, app.tx.paritySeed);
    return makePacket({
      type: TYPE.FOUNTAIN,
      lane,
      session: app.tx.session,
      sequence: nextSequence(),
      sourceCount: app.tx.blocks.length,
      chunkSize: mode.chunkBytes,
      symbol: parity.seed,
      aux: parity.degree,
      payload: parity.data,
      mode,
    });
  }
  function systematicPacket(lane, index) {
    const mode = resolveMode(app.tx.modeId);
    return makePacket({
      type: TYPE.SYSTEMATIC,
      lane,
      session: app.tx.session,
      sequence: nextSequence(),
      sourceCount: app.tx.blocks.length,
      chunkSize: mode.chunkBytes,
      symbol: index,
      aux: 0,
      payload: app.tx.blocks[index],
      mode,
    });
  }
  function nextTriFramePackets() {
    const tx = app.tx,
      packets = new Array(3);
    for (let lane = 0; lane < 2; lane++) {
      if (tx.systematicIndex < tx.blocks.length)
        packets[lane] = systematicPacket(lane, tx.systematicIndex++);
      else packets[lane] = nextParityPacket(lane);
    }
    packets[2] = nextParityPacket(2);
    if (tx.frames > 0 && tx.frames % 18 === 0) {
      packets[2]=helloPacket(2,Math.floor(tx.frames/18)-1);
    }
    if (tx.systematicIndex >= tx.blocks.length && tx.frames % 11 === 0) {
      packets[0] = systematicPacket(0, tx.repeatIndex % tx.blocks.length);
      tx.repeatIndex++;
    }
    return packets;
  }
  function renderTriFramePackets(packets) {
    app.currentLanePackets = packets;
    renderCurrentTriFrame();
  }
  function adaptiveGovernor(renderMs) {
    const tx = app.tx;
    tx.renderSamples.push(renderMs);
    if (tx.renderSamples.length < 24) return;
    const average =
      tx.renderSamples.reduce((sum, value) => sum + value, 0) /
      tx.renderSamples.length;
    tx.renderSamples = [];
    const frameBudget = 1000 / tx.fps;
    const mode = resolveMode(tx.modeId);
    let next = tx.fps;
    if (average > frameBudget * 0.68) next = Math.max(mode.minFps, tx.fps - 1);
    else if (average < frameBudget * 0.34 && tx.fps < mode.maxFps)
      next = tx.fps + 1;
    if (next !== tx.fps) {
      const old = tx.fps;
      tx.fps = next;
      $("stageRate").textContent = `${next}frames/s`;
      flight.record(
        "adaptive",
        "tx-rate-changed",
        { from: old, to: next, averageRenderMs: Math.round(average) },
        85,
      );
    }
  }
  async function startData(reason = "manual") {
    const tx = app.tx;
    if (
      !tx ||
      !app.stageOpen ||
      tx.phase !== "HELLO" ||
      tx.running ||
      tx.completed
    )
      return;
    clearInterval(app.helloTimer);
    tx.running = true;
    tx.paused = false;
    tx.phase = "DATA";
    tx.startedAt = performance.now();
    tx.lastMetricAt = 0;
    tx.loopToken++;
    setPhase("TX_DATA");
    $("transmissionStage").classList.add("data-live");
    $("stagePhase").textContent = "DATA·TRI-LANE";
    $("stageRate").textContent = `${tx.fps}frames/s`;
    $("stageMode").textContent =
      `${resolveMode(tx.modeId).shortLabel}·${resolveMode(tx.modeId).bits}b`;
    $("stageStartBtn").hidden = true;
    $("stagePauseBtn").hidden = false;
    $("stagePauseBtn").textContent = "Pausar";
    $("stageMessageTitle").textContent = "TriFrame transmitiendo";
    $("stageMessageDetail").textContent =
      "A/B envían systematic;C emite Fountain.Luego los tres mantienen recuperación continua.";
    flight.record(
      "tx",
      "data-started",
      {
        reason,
        fps: tx.fps,
        lanes: 3,
        mode: tx.modeId,
        bits: resolveMode(tx.modeId).bits,
        sourceCount: tx.blocks.length,
      },
      100,
    );
    transmitLoop(tx.loopToken);
  }
  async function transmitLoop(token) {
    const tx = app.tx;
    while (tx && tx.running && !tx.completed && token === tx.loopToken) {
      if (tx.paused) {
        await sleep(90);
        continue;
      }
      const frameStarted = performance.now();
      const packets = nextTriFramePackets();
      renderTriFramePackets(packets);
      tx.frames++;
      tx.packets += 3;
      const coverage = clamp(
        (tx.systematicIndex / tx.blocks.length) * 100,
        0,
        100,
      );
      $("stageCoverage").textContent =
        tx.systematicIndex < tx.blocks.length
          ? `${Math.floor(coverage)}%SYS`
          : "FEC CONTINUO";
      const elapsed = (performance.now() - tx.startedAt) / 1000;
      const shownBytes = Math.min(
        tx.file.size,
        tx.systematicIndex * tx.meta.chunkSize,
      );
      setTxProgress(
        tx.systematicIndex < tx.blocks.length ? coverage : 100,
        tx.systematicIndex < tx.blocks.length
          ? `Cobertura systematic·${formatBytes(shownBytes)}mostrados`
          : `Cobertura completa·Fountain Recovery activo·${tx.frames.toLocaleString()}frames`,
      );
      const renderMs = performance.now() - frameStarted;
      adaptiveGovernor(renderMs);
      if (performance.now() - tx.lastMetricAt > 2000) {
        tx.lastMetricAt = performance.now();
        flight.record(
          "metric",
          "tx-snapshot",
          {
            frames: tx.frames,
            packets: tx.packets,
            fps: tx.fps,
            mode: tx.modeId,
            bits: resolveMode(tx.modeId).bits,
            chunkBytes: tx.meta.chunkSize,
            coverage: Math.round(coverage),
            elapsed: formatDuration(elapsed),
            layout: activeGrid().portrait ? "3-rows" : "3-columns",
          },
          100,
        );
      }
      const delay = Math.max(
        18,
        1000 / tx.fps - (performance.now() - frameStarted),
      );
      await sleep(delay);
    }
  }
  function togglePause() {
    const tx = app.tx;
    if (!tx?.running) return;
    tx.paused = !tx.paused;
    $("stagePauseBtn").textContent = tx.paused ? "Reanudar" : "Pausar";
    $("stagePhase").textContent = tx.paused ? "PAUSA" : "DATA·TRI-LANE";
    setPhase(tx.paused ? "TX_PAUSED" : "TX_DATA");
    flight.record(
      "tx",
      tx.paused ? "paused" : "resumed",
      { frame: tx.frames },
      100,
    );
  }
  function finishTransmission(reason) {
    const tx = app.tx;
    if (!tx) return;
    tx.completed = true;
    tx.running = false;
    tx.paused = false;
    tx.loopToken++;
    tx.phase = "COMPLETE";
    setPhase("TX_COMPLETE");
    $("stagePhase").textContent = "COMPLETE✓";
    $("stageCoverage").textContent = "100%";
    $("stagePauseBtn").hidden = true;
    $("stageStartBtn").hidden = false;
    $("stageStartBtn").disabled = true;
    $("stageStartBtn").textContent = "Receptor completó";
    $("stageMessageTitle").textContent = "Archivo confirmado por el receptor";
    $("stageMessageDetail").textContent =
      "CRC32+SHA-256 verificados.Ya puedes cerrar la pantalla.";
    flight.record(
      "tx",
      "transfer-complete",
      {
        reason,
        frames: tx.frames,
        packets: tx.packets,
        elapsedMs: Math.round(performance.now() - tx.startedAt),
      },
      100,
    );
  }
  async function closeStage() {
    clearInterval(app.helloTimer);
    if (app.tx) {
      app.tx.running = false;
      app.tx.paused = false;
      app.tx.loopToken++;
      app.tx.phase = "READY";
    }
    sonic.stopListener();
    app.stageOpen = false;
    $("transmissionStage").classList.remove("active", "data-live");
    $("transmissionStage").setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("triframe-open");
    setPhase(app.tx ? "READY" : "IDLE");
    await releaseWakeLock();
    try {
      screen.orientation?.unlock?.();
    } catch {}
    await exitFullscreen();
    flight.record("fullscreen", "triframe-closed", {}, 100);
  }
  function colorDistance(a, b) {
    const dr = (a[0] - b[0]) * 0.88,
      dg = (a[1] - b[1]) * 1.12,
      db = (a[2] - b[2]) * 0.94;
    const la = a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722,
      lb = b[0] * 0.2126 + b[1] * 0.7152 + b[2] * 0.0722,
      dl = (la - lb) * 0.22;
    return Math.hypot(dr, dg, db, dl);
  }
  function orientRgbSamples(samples, cols, rows, rotation = 0) {
    if (rotation !== 180) return samples;
    const oriented = new Float32Array(samples.length);
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const source = ((rows - 1 - y) * cols + (cols - 1 - x)) * 3,
          target = (y * cols + x) * 3;
        oriented[target] = samples[source];
        oriented[target + 1] = samples[source + 1];
        oriented[target + 2] = samples[source + 2];
      }
    return oriented;
  }
  function classifyColorSamples(
    rawSamples,
    cols,
    rows,
    modeInput,
    rotation = 0,
  ) {
    const mode = resolveMode(modeInput),
      samples = orientRgbSamples(rawSamples, cols, rows, rotation),
      entries = pilotEntries(cols, rows, mode),
      sums = Array.from({ length: mode.symbols }, () => [0, 0, 0, 0]);
    for (const [position, symbol] of entries) {
      const offset = position * 3,
        sum = sums[symbol];
      sum[0] += samples[offset];
      sum[1] += samples[offset + 1];
      sum[2] += samples[offset + 2];
      sum[3]++;
    }
    if (sums.some((sum) => sum[3] < 2)) return null;
    const centers = sums.map((sum) => [
      sum[0] / sum[3],
      sum[1] / sum[3],
      sum[2] / sum[3],
    ]);
    let minSeparation = Infinity;
    for (let a = 0; a < centers.length; a++)
      for (let b = a + 1; b < centers.length; b++)
        minSeparation = Math.min(
          minSeparation,
          colorDistance(centers[a], centers[b]),
        );
    let pilotError = 0;
    for (const [position, symbol] of entries) {
      const offset = position * 3;
      pilotError += colorDistance(
        [samples[offset], samples[offset + 1], samples[offset + 2]],
        centers[symbol],
      );
    }
    pilotError /= entries.length;
    if (
      !Number.isFinite(minSeparation) ||
      minSeparation < mode.minPilotSeparation ||
      pilotError > Math.max(18, minSeparation * 0.7)
    )
      return null;
    const symbols = new Uint8Array(cols * rows);
    let aggregateMargin = 0;
    for (let cell = 0; cell < symbols.length; cell++) {
      const offset = cell * 3,
        rgb = [samples[offset], samples[offset + 1], samples[offset + 2]];
      let best = 0,
        bestDistance = colorDistance(rgb, centers[0]),
        secondDistance = Infinity;
      for (let symbol = 1; symbol < centers.length; symbol++) {
        const distance = colorDistance(rgb, centers[symbol]);
        if (distance < bestDistance) {
          secondDistance = bestDistance;
          bestDistance = distance;
          best = symbol;
        } else if (distance < secondDistance) secondDistance = distance;
      }
      symbols[cell] = best;
      aggregateMargin += Math.max(0, secondDistance - bestDistance);
    }
    const averageMargin = aggregateMargin / symbols.length;
    const quality = clamp(
      34 +
        (minSeparation - mode.minPilotSeparation) * 0.72 +
        averageMargin * 0.34 -
        pilotError * 1.05,
      0,
      100,
    );
    return {
      mode,
      symbols,
      centers,
      quality,
      pilotError,
      minSeparation,
      averageMargin,
      rotation,
    };
  }
  function decodeOpticalQuad(image, width, height, quad, geometry = null) {
    if(!geometry?.exact)return null;
    const A=globalThis.HopperAnchorScan;
    const ordered=[quad.tl,quad.tr,quad.br,quad.bl];
    const h=A.homography(ordered.map((p,i)=>({u:[0,1,1,0][i],v:[0,0,1,1][i],x:p.x,y:p.y})));
    if(!h)return null;
    const ids=[CONTROL_MODE,app.rx?.modeId,...MODE_ORDER].filter((id,i,all)=>id&&all.indexOf(id)===i);
    const rgba=image.data;let bestBad=null;
    for(const isControl of [true,false]){
    if(!isControl && geometry.cellPx<1.8)continue;
    const cols=isControl?CONTROL_COLS:LONG_SIDE,rows=isControl?CONTROL_ROWS:SHORT_SIDE;
    for(const [sx,sy]of [[0,0],[-.16,0],[.16,0],[0,-.16],[0,.16]]){
      const samples=new Float32Array(cols*rows*3);
      for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
        const p=A.project(h,(x+.5+sx)/cols,(y+.5+sy)/rows);
        const xx=clamp(Math.floor(p.x),0,width-2),yy=clamp(Math.floor(p.y),0,height-2);
        const fx=clamp(p.x-xx,0,1),fy=clamp(p.y-yy,0,1),a=(yy*width+xx)*4,out=(y*cols+x)*3;
        for(let c=0;c<3;c++)samples[out+c]=(rgba[a+c]*(1-fx)+rgba[a+4+c]*fx)*(1-fy)+
          (rgba[a+width*4+c]*(1-fx)+rgba[a+width*4+4+c]*fx)*fy;
      }
      for(const id of isControl?[CONTROL_MODE]:ids){
        const classified=classifyColorSamples(samples,cols,rows,id,0);if(!classified)continue;
        const raw=symbolsToBytes(classified.symbols,cols,rows,id);
        const candidates=isControl?[controlDecode(raw)].filter(Boolean):[{packet:parsePacket(raw,id),corrected:0}];
        for(const {packet,corrected}of candidates){
          if(!packet||packet.lane!==geometry.lane)continue;
          const result={packet,quality:classified.quality,quad,cols,rows,mode:classified.mode,
            pilotError:classified.pilotError,minSeparation:classified.minSeparation,
            control:!!(packet.flags&CONTROL_FLAG),corrected,samplingPhase:[sx,sy]};
          if(packet.bad){bestBad={...result,bad:true};continue;}
          return result;
        }
      }
    }
    }
    return bestBad;
  }
  function scanAnchorFrame(scanner, image, timestamp) {
    const start=performance.now(), result=scanner.detect(image,timestamp);
    for (const item of result.items) {
      const decoded=decodeOpticalQuad(image,image.width,image.height,item.quad,item);
      item.decoded=decoded && !decoded.bad ? decoded : null;
      item.rejected=decoded?.bad ? decoded : null;
    }
    result.processingMs=performance.now()-start;
    result.width=image.width;result.height=image.height;
    return result;
  }
  function drawGuide(width, height, items) {
    const canvas = $("guideCanvas"),
      ctx = canvas.getContext("2d");
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = Math.max(2, Math.min(width, height) / 220);
    ctx.font = `700 ${Math.max(12, Math.min(width, height) / 28)}px system-ui`;
    items.forEach((item, index) => {
      const quad = item.quad,
        packet = item.decoded?.packet;
      const lane = packet?.lane;
      const label =
        lane == null
          ? `Q${index + 1}`
          : `${String.fromCharCode(65 + lane)}·${item.decoded.mode?.bits || "?"}b·${Math.round(item.decoded.quality)}%`;
      ctx.strokeStyle = packet ? "#34d399" : "#fbbf24";
      ctx.fillStyle = packet ? "#34d399" : "#fbbf24";
      ctx.beginPath();
      ctx.moveTo(quad.tl.x, quad.tl.y);
      ctx.lineTo(quad.tr.x, quad.tr.y);
      ctx.lineTo(quad.br.x, quad.br.y);
      ctx.lineTo(quad.bl.x, quad.bl.y);
      ctx.closePath();
      ctx.stroke();
      ctx.fillText(
        label,
        quad.tl.x + 6,
        quad.tl.y + Math.max(16, Math.min(width, height) / 28),
      );
    });
  }
  function updateLaneLocks() {
    const now = performance.now(),
      ids = ["lockA", "lockB", "lockC"];
    ids.forEach((id, lane) => {
      const el = $(id),
        remaining = app.detection.locks[lane] - now;
      if (remaining > 0) {
        el.className = "locked";
        el.textContent = `${String.fromCharCode(65 + lane)}·LOCK`;
      } else {
        el.className = "";
        el.textContent = `${String.fromCharCode(65 + lane)}·BUSCANDO`;
      }
    });
  }
  function newReceiverSession(packet, meta) {
    if (app.receiverObjectUrl) {
      URL.revokeObjectURL(app.receiverObjectUrl);
      app.receiverObjectUrl = null;
    }
    const mode = resolveMode(meta.mode || packet.modeId || packet.bits);
    $("receivedFile").hidden = true;
    app.rxModeId = mode.id;
    app.rx = {
      session: packet.session,
      meta,
      modeId: mode.id,
      sourceCount: packet.sourceCount,
      chunkSize: packet.chunkSize,
      decoder: null,
      seen: new Set(),
      valid: 0,
      rejected: 0,
      acked: false,
      lastAckAt:performance.now(),dataStarted:false,
      completing: false,
      complete: false,
      startedAt: performance.now(),
      lastUpdateAt: performance.now(),
      known: 0,
    };
    app.rx.decoder = createFountainDecoder(
      packet.sourceCount,
      packet.chunkSize,
      (index, value, known, total) => {
        app.rx.known = known;
        app.rx.lastUpdateAt = performance.now();
        updateReceiverUI();
        if (known === total) finalizeReceiver();
      },
    );
    $("rxFileName").textContent = meta.name || "Archivo sin nombre";
    $("rxSession").textContent =
      `Sesión ${packet.session.toString(16).toUpperCase().padStart(8, "0")}·${formatBytes(meta.size)}`;
    $("rxMode").textContent = `${mode.label}·${mode.bits}b`;
    flight.record(
      "rx",
      "session-locked",
      {
        session: packet.session,
        name: meta.name,
        size: meta.size,
        mode: mode.id,
        bits: mode.bits,
        symbols: mode.symbols,
        sourceCount: packet.sourceCount,
        chunkSize: packet.chunkSize,
        crc32: Number(meta.fileCrc).toString(16).padStart(8, "0"),
        sha256: meta.sha256,
      },
      100,
    );
    setPhase("RX_READY");
    if (!app.rx.acked) {
      app.rx.acked = true;
      setTimeout(
        () =>
          sonic
            .emit("ACK")
            .then(() => setSonicStatus("SONIC·ACK ENVIADO", "online"))
            .catch((error) => {
              flight.record(
                "sonic",
                "ack-output-failed",
                { message: error.message },
                0,
              );
            }),
        180,
      );
    }
  }
  function processDecodedPacket(packet, quality) {
    app.detection.valid++;
    app.recentQuality.push(quality);
    if (app.recentQuality.length > 40) app.recentQuality.shift();
    app.detection.locks[packet.lane] = performance.now() + 800;
    updateLaneLocks();
    if (packet.type === TYPE.HELLO) {
      if(packet.flags&GUIDE_FLAG){
        const meta=acceptQuickGuide(packet);
        if(!meta)return;
        if (!app.rx || app.rx.session !== packet.session)newReceiverSession(packet, meta);
        else if(!app.rx.dataStarted && performance.now()-(app.rx.lastAckAt||0)>1800){app.rx.lastAckAt=performance.now();sonic.emit("ACK").catch(()=>{});}
      } else {
        const meta=acceptControlHello(packet);
        if(!meta)return;
        if (!app.rx || app.rx.session !== packet.session)newReceiverSession(packet, meta);
        else {
          app.rx.meta={...app.rx.meta,...meta};
          $("rxFileName").textContent=meta.name||app.rx.meta.name;
          $("rxSession").textContent=`Sesión ${packet.session.toString(16).toUpperCase().padStart(8,"0")}·${formatBytes(meta.size)}`;
          flight.record("rx","full-metadata-upgraded",{session:packet.session,name:meta.name,sha256:meta.sha256},100);
        }
      }
      updateReceiverUI();
      return;
    }
    const rx = app.rx;
    if (
      !rx ||
      rx.session !== packet.session ||
      rx.complete ||
      packet.modeId !== rx.modeId
    )
      return;
    rx.dataStarted=true;setPhase("RX_DATA");
    const key = `${packet.type}:${packet.sequence}:${packet.symbol}:${packet.lane}`;
    if (rx.seen.has(key)) return;
    rx.seen.add(key);
    if (rx.seen.size > 25000) {
      const first = rx.seen.values().next().value;
      rx.seen.delete(first);
    }
    let accepted = false;
    if (
      packet.type === TYPE.SYSTEMATIC &&
      packet.symbol < rx.sourceCount &&
      packet.payload.length === rx.chunkSize
    ) {
      accepted = rx.decoder.addSystematic(packet.symbol, packet.payload);
    } else if (
      packet.type === TYPE.FOUNTAIN &&
      packet.payload.length === rx.chunkSize
    ) {
      accepted = rx.decoder.addParity(packet.symbol, packet.payload);
    }
    rx.valid++;
    if (accepted && rx.valid % 25 === 0) {
      const snapshot = rx.decoder.snapshot();
      flight.record(
        "rx",
        "fountain-progress",
        {
          known: snapshot.known,
          total: snapshot.total,
          missing: snapshot.missing,
          equations: snapshot.equations,
        },
        quality,
      );
    }
    updateReceiverUI();
  }
  function updateReceiverUI() {
    const rx = app.rx,
      valid = app.detection.valid,
      rejected = app.detection.rejected;
    $("rxValid").textContent = valid.toLocaleString();
    $("rxRejected").textContent = rejected.toLocaleString();
    const average = app.recentQuality.length
      ? app.recentQuality.reduce((sum, value) => sum + value, 0) /
        app.recentQuality.length
      : 0;
    $("rxQuality").textContent = average ? `${Math.round(average)}%` : "—";
    $("rxMode").textContent = rx
      ? `${resolveMode(rx.modeId).shortLabel}·${resolveMode(rx.modeId).bits}b`
      : app.helloProgress ? `${app.helloProgress.guide?"GUÍA H7":"META"} · ${app.helloProgress.parts}/${app.helloProgress.total}` : "GUÍA H7 GRIS · ESPERANDO";
    if (!rx) {
      $("rxKnown").textContent = "0/—";
      $("rxPercent").textContent = "0%";
      $("rxProgressBar").style.width = "0%";
      return;
    }
    const snapshot = rx.decoder.snapshot(),
      percent = snapshot.total ? (snapshot.known / snapshot.total) * 100 : 0;
    $("rxKnown").textContent =
      `${snapshot.known.toLocaleString()}/${snapshot.total.toLocaleString()}`;
    $("rxPercent").textContent = `${percent.toFixed(percent < 10 ? 1 : 0)}%`;
    $("rxProgressBar").style.width = `${clamp(percent, 0, 100)}%`;
  }
  async function finalizeReceiver() {
    const rx = app.rx;
    if (!rx || rx.completing || rx.complete) return;
    rx.completing = true;
    setPhase("RX_VERIFY");
    $("cameraState").textContent = "VERIFICANDO INTEGRIDAD";
    flight.record(
      "integrity",
      "verification-started",
      { session: rx.session, blocks: rx.sourceCount },
      100,
    );
    try {
      const blocks = rx.decoder.blocks();
      if (blocks.some((block) => !block))
        throw new Error("Faltan bloques pese al estado complete");
      const joined = new Uint8Array(blocks.length * rx.chunkSize);
      blocks.forEach((block, index) => joined.set(block, index * rx.chunkSize));
      const bytes = joined.slice(0, rx.meta.size);
      const actualCrc = crc32(bytes),
        expectedCrc = Number(rx.meta.fileCrc) >>> 0;
      if (actualCrc !== expectedCrc)
        throw new Error(
          `CRC32 ${actualCrc.toString(16)}≠${expectedCrc.toString(16)}`,
        );
      const actualSha = await sha256Hex(bytes);
      if (rx.meta.sha256 && actualSha !== rx.meta.sha256)
        throw new Error("SHA-256 final no coincide");
      rx.complete = true;
      rx.completing = false;
      const blob = new Blob([bytes], {
        type: rx.meta.type || "application/octet-stream",
      });
      app.receiverObjectUrl = URL.createObjectURL(blob);
      $("downloadLink").href = app.receiverObjectUrl;
      $("downloadLink").download = rx.meta.name || "hopperlink-file";
      $("receivedName").textContent = rx.meta.name || "Archivo listo";
      $("receivedIntegrity").textContent =
        `CRC32 ${actualCrc.toString(16).toUpperCase().padStart(8, "0")}·SHA-256 ${actualSha ? actualSha.slice(0, 16).toUpperCase() + "…" : "no disponible"}`;
      $("receivedFile").hidden = false;
      $("rxPercent").textContent = "100%";
      $("rxProgressBar").style.width = "100%";
      $("cameraState").textContent = "ARCHIVO COMPLETO✓";
      setPhase("RX_COMPLETE");
      setEngineStatus("TRANSFERENCIA VERIFICADA", "online");
      flight.record(
        "integrity",
        "file-complete",
        {
          session: rx.session,
          name: rx.meta.name,
          size: bytes.length,
          crc32: actualCrc.toString(16).padStart(8, "0"),
          sha256: actualSha,
          elapsedMs: Math.round(performance.now() - rx.startedAt),
          validPackets: rx.valid,
        },
        100,
      );
      try {
        await sonic.emit("COMPLETE");
        setSonicStatus("SONIC·COMPLETE ENVIADO", "online");
      } catch (error) {
        flight.record(
          "sonic",
          "complete-output-failed",
          { message: error.message },
          0,
        );
      }
    } catch (error) {
      rx.completing = false;
      $("cameraState").textContent = "ERROR DE INTEGRIDAD";
      setPhase("RX_INTEGRITY_ERROR");
      setEngineStatus("ERROR DE INTEGRIDAD", "error");
      flight.record(
        "integrity",
        "verification-failed",
        { message: error.message },
        0,
      );
    }
  }
  async function tuneCameraTrack(track) {
    try {
      const capabilities = track.getCapabilities?.() || {},
        advanced = {};
      if (
        Array.isArray(capabilities.focusMode) &&
        capabilities.focusMode.includes("continuous")
      )
        advanced.focusMode = "continuous";
      if (
        Array.isArray(capabilities.exposureMode) &&
        capabilities.exposureMode.includes("continuous")
      )
        advanced.exposureMode = "continuous";
      if (
        Array.isArray(capabilities.whiteBalanceMode) &&
        capabilities.whiteBalanceMode.includes("continuous")
      )
        advanced.whiteBalanceMode = "continuous";
      if (capabilities.zoom && Number.isFinite(capabilities.zoom.min))
        advanced.zoom = clamp(1, capabilities.zoom.min, capabilities.zoom.max);
      if (Object.keys(advanced).length)
        await track.applyConstraints({ advanced: [advanced] });
      flight.record("camera", "track-tuned", { advanced }, 100);
    } catch (error) {
      flight.record(
        "camera",
        "track-tune-skipped",
        { message: error.message },
        40,
      );
    }
  }
  function receiverScanDimensions(video) {
    const sourceWidth = Math.max(1, Number(video?.videoWidth) || 1080);
    const sourceHeight = Math.max(1, Number(video?.videoHeight) || 1920);
    const shortSide = Math.min(sourceWidth, sourceHeight);
    const longSide = Math.max(sourceWidth, sourceHeight);
    const scale = Math.min(1, 1080 / shortSide, 1920 / longSide);
    return {
      width: Math.max(1, Math.round(sourceWidth * scale)),
      height: Math.max(1, Math.round(sourceHeight * scale)),
      sourceWidth,
      sourceHeight,
      portrait: sourceHeight >= sourceWidth,
    };
  }
  function syncReceiverViewport(video, track) {
    const geometry = receiverScanDimensions(video);
    const shell = $("cameraShell");
    shell.dataset.feedOrientation = geometry.portrait
      ? "portrait"
      : "landscape";
    shell.style.setProperty(
      "--camera-source-aspect",
      `${geometry.sourceWidth} / ${geometry.sourceHeight}`,
    );
    flight.record(
      "camera",
      "portrait-viewport-ready",
      {
        sourceWidth: geometry.sourceWidth,
        sourceHeight: geometry.sourceHeight,
        scanWidth: geometry.width,
        scanHeight: geometry.height,
        portrait: geometry.portrait,
        settings: track?.getSettings?.() || {},
      },
      geometry.portrait ? 100 : 72,
    );
    return geometry;
  }
  async function startCamera() {
    if (app.cameraStream) return;
    switchRole("receive");
    setPhase("RX_SEARCH");
    setEngineStatus("INICIANDO CÁMARA", "mid");
    try {
      await sonic
        .primeOutput()
        .catch((error) =>
          flight.record(
            "sonic",
            "output-prime-failed",
            { message: error.message },
            0,
          ),
        );
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1440 },
          aspectRatio: { ideal: 4 / 3 },
          frameRate: { ideal: 30, min: 15 },
        },
        audio: false,
      });
      app.cameraStream = stream;
      const video = $("cameraVideo");
      video.srcObject = stream;
      await video.play();
      await tuneCameraTrack(stream.getVideoTracks()[0]);
      syncReceiverViewport(video, stream.getVideoTracks()[0]);
      await acquireWakeLock();
      $("cameraEmpty").style.display = "none";
      $("cameraBtn").disabled = true;
      $("stopCameraBtn").disabled = false;
      $("receiverFullscreenBtn").disabled = false;
      $("cameraState").textContent = "H7 GUIDE · BUSCANDO GUÍA ESTÁTICA";
      setEngineStatus("CÁMARA ACTIVA", "online");
      app.scanFrames = 0;
      app.scanFpsAt = performance.now();
      app.scanLastAt = 0;
      app.candidateBits = null;app.helloProgress=null;helloAssemblies.clear();quickGuideAssemblies.clear();
      app.scanEpoch = (app.scanEpoch || 0) + 1;
      app.scanBusy = false;
      app.scanLastMediaTime = -1;
      startScanWorker();
      scheduleCameraFrame();
      flight.record(
        "camera",
        "started",
        {
          width: video.videoWidth,
          height: video.videoHeight,
          settings: stream.getVideoTracks()[0]?.getSettings?.() || {},
        },
        100,
      );
    } catch (error) {
      setPhase("CAMERA_ERROR");
      alertError(`No se pudo iniciar la cámara:${error.message}`, error);
    }
  }
  function stopCamera() {
    cancelAnimationFrame(app.scanRaf);
    $("cameraVideo").cancelVideoFrameCallback?.(app.scanVideoCallback || 0);
    app.scanEpoch = (app.scanEpoch || 0) + 1;
    app.scanWorker?.terminate();
    app.scanWorker = null;
    app.scanBusy = false;
    app.scanRaf = 0;
    for (const track of app.cameraStream?.getTracks?.() || []) track.stop();
    app.cameraStream = null;
    releaseWakeLock();
    try {
      screen.orientation?.unlock?.();
    } catch {}
    const video = $("cameraVideo");
    video.pause();
    video.srcObject = null;
    $("cameraEmpty").style.display = "flex";
    $("cameraBtn").disabled = false;
    $("stopCameraBtn").disabled = true;
    $("receiverFullscreenBtn").disabled = true;
    $("cameraState").textContent = "CÁMARA EN ESPERA";
    $("scanFps").textContent = "0 fps";
    const guide = $("guideCanvas");
    guide.getContext("2d").clearRect(0, 0, guide.width, guide.height);
    app.detection.locks = [0, 0, 0];
    updateLaneLocks();
    setPhase(app.rx?.complete ? "RX_COMPLETE" : "IDLE");
    flight.record("camera", "stopped", {}, 100);
  }
  function startScanWorker() {
    app.scanWorker?.terminate();
    app.scanWorker=null;
    app.anchorScanner = new globalThis.HopperAnchorScan.Scanner();
    if (typeof Worker !== "function") return;
    try {
      const worker = new Worker("./anchor-worker.js?v=1510");
      app.scanWorker=worker;
      worker.onmessage=({data}) => {
        if (app.scanWorker !== worker || data.epoch !== app.scanEpoch) return;
        app.scanBusy=false;
        if (data.error) { stopFailedWorker(data.error); return; }
        if (app.cameraStream) applyScanResult(data.result);
      };
      worker.onerror=event => {
        if(app.scanWorker === worker) stopFailedWorker(event.message || "worker failed");
      };
      flight.record("scan","worker-started",{build:"1510",singleFlight:true},100);
    } catch(error) {stopFailedWorker(error.message);}
  }
  function stopFailedWorker(message) {
    app.scanWorker?.terminate();app.scanWorker=null;app.scanBusy=false;
    flight.record("scan","main-thread-fallback",{message},40);
  }
  function scheduleCameraFrame() {
    if (!app.cameraStream) return;
    const video=$("cameraVideo");
    if (typeof video.requestVideoFrameCallback === "function")
      app.scanVideoCallback=video.requestVideoFrameCallback(scanLoop);
    else app.scanRaf=requestAnimationFrame(scanLoop);
  }
  function scanLoop(timestamp, metadata) {
    if (!app.cameraStream) return;
    scheduleCameraFrame();
    if (app.scanBusy) {
      if (performance.now()-app.scanSubmittedAt>3000) stopFailedWorker("worker-timeout");
      return;
    }
    const video=$("cameraVideo"), mediaTime=metadata?.mediaTime ?? video.currentTime;
    if (video.readyState<2 || !video.videoWidth || mediaTime===app.scanLastMediaTime) return;
    // Worker: at most 30 real frames/s. Fallback is bounded to keep controls responsive.
    if (timestamp-app.scanLastAt<(app.scanWorker?30:100)) return;
    app.scanLastMediaTime=mediaTime;app.scanLastAt=timestamp;
    const {width,height}=receiverScanDimensions(video);
    const canvas=$("captureCanvas"),ctx=canvas.getContext("2d",{alpha:false,willReadFrequently:true});
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    ctx.drawImage(video,0,0,width,height);
    try {
      const image=ctx.getImageData(0,0,width,height);
      if(app.scanWorker){
        app.scanBusy=true;app.scanSubmittedAt=performance.now();
        app.scanWorker.postMessage({epoch:app.scanEpoch,width,height,buffer:image.data.buffer,timestamp},[image.data.buffer]);
      } else applyScanResult(scanAnchorFrame(app.anchorScanner,image,timestamp));
    } catch(error) {app.scanBusy=false;flight.record("scan","frame-error",{message:error.message},0);}
  }
  function applyScanResult(result) {
    if(!app.cameraStream)return;
    const {items,width,height}=result,now=performance.now();
    app.lastAnchorMetrics={markers:result.markers,strategy:result.strategy,scanMs:result.scanMs,processingMs:result.processingMs,
      lanes:items.map(i=>({lane:i.lane,anchors:i.anchorCount,cellPx:i.cellPx,motionCells:i.motionCells,reprojection:i.reprojection,valid:!!i.decoded,control:!!i.decoded?.control,corrected:i.decoded?.corrected||0}))};
    for(const item of items){
      if(item.rejected){app.detection.rejected++;if(app.rx)app.rx.rejected++;}
      else if(item.decoded?.packet)processDecodedPacket(item.decoded.packet,item.decoded.quality);
    }
    drawGuide(width,height,items);updateLaneLocks();
    const valid=items.filter(i=>i.decoded?.packet).length;
    if(app.rx?.complete)$("cameraState").textContent="ARCHIVO COMPLETO ✓";
    else $("cameraState").textContent=valid
      ? (app.rx && !app.rx.dataStarted ? "ARCHIVO IDENTIFICADO · ESPERANDO DATA" : `H7 CONTROL+ · LEYENDO ${valid}/3`)
      : items.length ? `H7 CONTROL+ · ${items.length}/3 ZONAS · VALIDANDO DATOS`
      : `H7 CONTROL+ · ${result.markers}/4 REFERENCIAS`;
    app.candidateBits = null;
    if(!app.rx&&items.length){
      const bits=[...new Set(items.map(i=>i.decoded?.packet?.bits).filter(Boolean))];
      app.candidateBits=bits.length===1?bits[0]:null;
    }
    app.scanFrames++;
    if(now-app.scanFpsAt>=1000){app.scanFps=app.scanFrames*1000/(now-app.scanFpsAt);app.scanFrames=0;app.scanFpsAt=now;
      $("scanFps").textContent=`${app.scanFps.toFixed(1)} fps · ${Math.round(result.processingMs)} ms`;}
    if(now-app.detection.lastMetricAt>2000){app.detection.lastMetricAt=now;
      flight.record("metric","anchor-scan",{...app.lastAnchorMetrics,worker:!!app.scanWorker,
        validPackets:app.detection.valid,rejectedCrc:app.detection.rejected,known:app.rx?.known||0},valid?100:null);}
    updateReceiverUI();
  }
  function saveScanCapture() {
    if(!app.cameraStream){alertError("Inicia la cámara antes de capturar el diagnóstico.");return;}
    const video=$("cameraVideo"),canvas=document.createElement("canvas");
    canvas.width=video.videoWidth;canvas.height=video.videoHeight;
    canvas.getContext("2d").drawImage(video,0,0);
    canvas.toBlob(blob=>{
      if(!blob)return;
      const url=URL.createObjectURL(blob),a=document.createElement("a");
      a.href=url;a.download=`hopper-h7-scan-1510-${Date.now()}.png`;a.click();
      setTimeout(()=>URL.revokeObjectURL(url),5000);
    },"image/png");
    flight.record("scan","raw-capture-exported",{width:canvas.width,height:canvas.height,build:1510,metrics:app.lastAnchorMetrics},null);
  }
  function switchRole(role) {
    app.role = role;
    const send = role === "send";
    $("sendTab").classList.toggle("active", send);
    $("receiveTab").classList.toggle("active", !send);
    $("sendView").classList.toggle("active", send);
    $("receiveView").classList.toggle("active", !send);
    flight.record("ui", "role-changed", { role }, 100);
  }
  async function toggleReceiverFullscreen() {
    const shell = $("cameraShell");
    if (!app.receiverFullscreen) {
      const native = await requestFullscreen(shell);
      await tryPortraitLock();
      shell.classList.add("receiver-fullscreen");
      app.receiverFullscreen = true;
      $("receiverFullExitBtn").hidden = false;
      flight.record("fullscreen", "receiver-opened", { native }, 100);
    } else closeReceiverFullscreen();
  }
  async function closeReceiverFullscreen() {
    const shell = $("cameraShell");
    shell.classList.remove("receiver-fullscreen");
    app.receiverFullscreen = false;
    $("receiverFullExitBtn").hidden = true;
    if (
      document.fullscreenElement === shell ||
      document.webkitFullscreenElement === shell
    )
      await exitFullscreen();
    flight.record("fullscreen", "receiver-closed", {}, 100);
  }
  function installHandlers() {
    $("sendTab").addEventListener("click", () => switchRole("send"));
    $("receiveTab").addEventListener("click", () => switchRole("receive"));
    document
      .querySelectorAll("button[data-optical-mode]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          selectOpticalMode(button.dataset.opticalMode),
        ),
      );
    $("fileInput").addEventListener("change", (event) =>
      selectFile(event.target.files?.[0]),
    );
    const drop = $("dropZone");
    for (const type of ["dragenter", "dragover"])
      drop.addEventListener(type, (event) => {
        event.preventDefault();
        drop.classList.add("drag");
      });
    for (const type of ["dragleave", "drop"])
      drop.addEventListener(type, (event) => {
        event.preventDefault();
        drop.classList.remove("drag");
      });
    drop.addEventListener("drop", (event) =>
      selectFile(event.dataTransfer?.files?.[0]),
    );
    $("prepareBtn").addEventListener("click", prepareFile);
    $("launchBtn").addEventListener("click", launchTransmission);
    $("stageStartBtn").addEventListener("click", () => startData("manual"));
    $("stagePauseBtn").addEventListener("click", togglePause);
    $("stageCloseBtn").addEventListener("click", closeStage);
    $("cameraBtn").addEventListener("click", startCamera);
    $("stopCameraBtn").addEventListener("click", stopCamera);
    $("captureScanBtn").addEventListener("click",saveScanCapture);
    $("receiverFullscreenBtn").addEventListener(
      "click",
      toggleReceiverFullscreen,
    );
    $("receiverFullExitBtn").addEventListener("click", closeReceiverFullscreen);
    $("exportJsonBtn").addEventListener("click", () => flight.exportJson());
    $("exportCsvBtn").addEventListener("click", () => flight.exportCsv());
    $("clearLogBtn").addEventListener("click", () => flight.clear());
    $("installBtn").addEventListener("click", async () => {
      if (!app.deferredInstall) return;
      app.deferredInstall.prompt();
      const choice = await app.deferredInstall.userChoice;
      flight.record(
        "pwa",
        "install-prompt-result",
        choice,
        choice.outcome === "accepted" ? 100 : 50,
      );
      app.deferredInstall = null;
      $("installBtn").hidden = true;
    });
    window.addEventListener(
      "resize",
      () => {
        if (app.stageOpen) {
          clearTimeout(app.renderScheduled);
          app.renderScheduled = setTimeout(() => {
            renderCurrentTriFrame();
            flight.record(
              "fullscreen",
              "layout-changed",
              { layout: activeGrid().portrait ? "3-rows" : "3-columns" },
              100,
            );
          }, 100);
        }
      },
      { passive: true },
    );
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      app.deferredInstall = event;
      $("installBtn").hidden = false;
    });
    document.addEventListener("fullscreenchange", () => {
      if (
        app.receiverFullscreen &&
        document.fullscreenElement !== $("cameraShell") &&
        !app.stageOpen
      )
        closeReceiverFullscreen();
    });
    document.addEventListener("visibilitychange", () => {
      if (
        document.visibilityState === "visible" &&
        app.stageOpen &&
        !app.wakeLock
      )
        acquireWakeLock();
    });
    window.addEventListener("pagehide", () => {
      clearInterval(app.helloTimer);
      if (app.tx) {
        app.tx.running = false;
        app.tx.loopToken++;
      }
      app.scanWorker?.terminate();
      app.scanWorker=null;
      sonic.stopListener();
      releaseWakeLock();
      for (const track of app.cameraStream?.getTracks?.() || []) track.stop();
    });
    window.addEventListener("error", (event) =>
      flight.record(
        "error",
        "window-error",
        {
          message: event.message,
          source: event.filename,
          line: event.lineno,
          column: event.colno,
        },
        0,
      ),
    );
    window.addEventListener("unhandledrejection", (event) =>
      flight.record(
        "error",
        "unhandled-rejection",
        { message: event.reason?.message || String(event.reason) },
        0,
      ),
    );
  }
  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.register(
        "./sw.js?v=1510",
        { scope: "./" },
      );
      flight.record(
        "pwa",
        "service-worker-ready",
        { scope: registration.scope },
        100,
      );
    } catch (error) {
      flight.record(
        "pwa",
        "service-worker-failed",
        { message: error.message },
        0,
      );
    }
  }
  function ensureReceiverExitButton() {
    if ($("receiverFullExitBtn")) return;
    const button = document.createElement("button");
    button.id = "receiverFullExitBtn";
    button.className = "camera-full-exit";
    button.hidden = true;
    button.type = "button";
    button.setAttribute("aria-label", "Salir de pantalla completa");
    button.textContent = "×";
    $("cameraShell").appendChild(button);
  }
  function initialize() {
    ensureReceiverExitButton();
    installHandlers();
    updateModeUI();
    flight.render();
    setPhase("IDLE");
    setEngineStatus("MOTOR LISTO", "online");
    setSonicStatus("SONIC EN ESPERA", "");
    updateReceiverUI();
    updateLaneLocks();
    registerServiceWorker();
    flight.record(
      "engine",
      "runtime-ready",
      {
        engine: ENGINE_NAME,
        version: VERSION,
        protocol: PROTOCOL,
        lanes: 3,
        gridLandscape: `${SHORT_SIDE}×${LONG_SIDE}`,
        gridPortrait: `${LONG_SIDE}×${SHORT_SIDE}`,
        selectedMode: app.modeId,
        modes: MODE_ORDER.map((id) => {
          const mode = MODE_DEFINITIONS[id];
          return {
            id,
            bits: mode.bits,
            symbols: mode.symbols,
            chunkBytes: mode.chunkBytes,
            payloadCapacity: packetPayloadCapacity(mode),
          };
        }),
        fullscreen: true,
        anchorScan: true,
        precisionDock: false,
        autoDock3: false,
        fountain: true,
        sonicAssist: true,
        flightRecorder: true,
      },
      100,
    );
    window.__hopperLinkOne = {
      engine: ENGINE_NAME,
      version: VERSION,
      protocol: PROTOCOL,
      lanes: 3,
      get selectedMode() {
        return app.modeId;
      },
      modes: MODE_ORDER.map((id) => {
        const mode = MODE_DEFINITIONS[id],
          speed = theoreticalRange(mode);
        return {
          id: mode.id,
          label: mode.label,
          bits: mode.bits,
          symbols: mode.symbols,
          chunkSize: mode.chunkBytes,
          payloadCapacity: packetPayloadCapacity(mode),
          theoreticalKib: speed,
        };
      }),
      setMode: selectOpticalMode,
      config: () => {
        const mode = activeMode();
        return {
          shortSide: SHORT_SIDE,
          longSide: LONG_SIDE,
          pilotCells: PILOT_CELL_COUNT,
          mode: mode.id,
          bits: mode.bits,
          symbols: mode.symbols,
          chunkSize: mode.chunkBytes,
          payloadCapacity: packetPayloadCapacity(mode),
        };
      },
      diagnostics: () => ({
        role: app.role,
        phase: app.phase,
        selectedMode: app.modeId,
        tx: app.tx
          ? {
              session: app.tx.session,
              mode: app.tx.modeId,
              bits: resolveMode(app.tx.modeId).bits,
              frames: app.tx.frames,
              packets: app.tx.packets,
              fps: app.tx.fps,
            }
          : null,
        rx: app.rx
          ? {
              session: app.rx.session,
              mode: app.rx.modeId,
              bits: resolveMode(app.rx.modeId).bits,
              ...app.rx.decoder.snapshot(),
              valid: app.rx.valid,
              rejected: app.rx.rejected,
            }
          : null,
        scan: app.lastAnchorMetrics || null,
        flightEvents: flight.events.length,
      }),
    };
  }
  globalThis.__hopperLinkOneInternals = {
    CONTROL_MODE,CONTROL_FLAG,GUIDE_FLAG,CONTROL_CHUNK,CONTROL_COLS,CONTROL_ROWS,opticalSymbols,controlEncode,controlDecode,compactHello,compactQuickGuide,acceptQuickGuide,acceptControlHello,
    processDecodedPacket, getApp:()=>app,
    ENGINE_NAME,
    VERSION,
    PROTOCOL,
    TYPE,
    HEADER_BYTES,
    SHORT_SIDE,
    LONG_SIDE,
    PILOT_CELL_COUNT,
    MODE_ORDER,
    MODE_DEFINITIONS,
    resolveMode,
    modeByBits,
    theoreticalRange,
    pilotEntries,
    opticalRawCapacity,
    packetPayloadCapacity,
    makePacket,
    parsePacket,
    rawToSymbols,
    symbolsToBytes,
    classifyColorSamples,
    receiverScanDimensions,
    crc32,
    decodeOpticalQuad,
    scanAnchorFrame,
    splitBlocks,
    createFountainDecoder,
    sha256Hex,
  };
  if (typeof document === "undefined") return;
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
