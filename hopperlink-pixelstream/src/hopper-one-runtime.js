(() => {
  "use strict";
  const ENGINE_NAME = "HopperCore ONE";
  const VERSION = "1.2.2";
  const PROTOCOL = 2;
  const MAGIC = Uint8Array.from([0x48, 0x4f, 0x50, 0x31]);
  const TYPE = Object.freeze({ HELLO: 1, SYSTEMATIC: 2, FOUNTAIN: 3 });
  const HEADER_BYTES = 36;
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
  const $ = (id) => document.getElementById(id);
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
    lastTrackedQuads: [],
    trackedAt: 0,
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
    const max = packetPayloadCapacity(selectedMode);
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
      chunkSize > mode.chunkBytes ||
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
  function renderPacketToCanvas(canvas, raw) {
    if (!canvas || !raw) return;
    const { cols, rows } = activeGrid();
    const mode = modeByBits(raw[7] & 0x0f) || activeMode();
    const symbols = rawToSymbols(raw, cols, rows, mode);
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext("2d", { alpha: false });
    const image = ctx.createImageData(cols, rows);
    for (let i = 0; i < symbols.length; i++) {
      const rgb = mode.palette[symbols[i]] || mode.palette[0],
        offset = i * 4;
      image.data[offset] = rgb[0];
      image.data[offset + 1] = rgb[1];
      image.data[offset + 2] = rgb[2];
      image.data[offset + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }
  function renderCurrentTriFrame() {
    const canvases = [$("laneCanvasA"), $("laneCanvasB"), $("laneCanvasC")];
    for (let lane = 0; lane < 3; lane++)
      if (app.currentLanePackets[lane])
        renderPacketToCanvas(canvases[lane], app.currentLanePackets[lane]);
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
      $("blackboxHealth").textContent = `Salud:${health}%`;
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
    document.querySelectorAll("[data-optical-mode]").forEach((button) => {
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
      const bytes = new Uint8Array(await file.arrayBuffer());
      setTxProgress(34, "Calculando CRC32…");
      const fileCrc = crc32(bytes);
      setTxProgress(55, "Calculando SHA-256…");
      const sha256 = await sha256Hex(bytes);
      setTxProgress(72, `Construyendo bloques de ${mode.chunkBytes} B…`);
      const blocks = splitBlocks(bytes, mode.chunkBytes),
        session = randomSession();
      let safeName = file.name.slice(0, 120);
      let meta, payload;
      do {
        meta = {
          engine: ENGINE_NAME,
          version: VERSION,
          protocol: PROTOCOL,
          transport: "TriFrame-3",
          mode: mode.id,
          modeLabel: mode.label,
          name: safeName,
          type: (file.type || "application/octet-stream").slice(0, 80),
          size: file.size,
          lastModified: file.lastModified || 0,
          fileCrc,
          sha256,
          sourceCount: blocks.length,
          chunkSize: mode.chunkBytes,
          bits: mode.bits,
          symbols: mode.symbols,
          gridCells: SHORT_SIDE * LONG_SIDE,
          pilotCells: PILOT_CELL_COUNT,
        };
        payload = encoder.encode(JSON.stringify(meta));
        if (payload.length > packetPayloadCapacity(mode))
          safeName = safeName.slice(0, Math.max(16, safeName.length - 16));
      } while (
        payload.length > packetPayloadCapacity(mode) &&
        safeName.length > 16
      );
      if (payload.length > packetPayloadCapacity(mode))
        throw new Error(`La metadata no cabe en HELLO ${mode.label}`);
      app.tx = {
        file,
        bytes,
        blocks,
        meta,
        helloPayload: payload,
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
    $("stagePhase").textContent = "HELLO·3/3";
    $("stageRate").textContent = "ESTÁTICO";
    $("stageMode").textContent =
      `${resolveMode(app.tx.modeId).shortLabel}·${resolveMode(app.tx.modeId).bits}b`;
    $("stageCoverage").textContent = "0%";
    $("stageStartBtn").hidden = false;
    $("stageStartBtn").disabled = false;
    $("stageStartBtn").textContent = "Iniciar DATA";
    $("stagePauseBtn").hidden = true;
    $("stageMessageTitle").textContent =
      "Muestra esta pantalla completa al receptor";
    $("stageMessageDetail").textContent =
      `AutoDock 3 detectará ${resolveMode(app.tx.modeId).symbols} colores por lane sin encuadre manual.`;
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
  function renderHelloTriFrame() {
    if (!app.tx) return;
    const mode = resolveMode(app.tx.modeId);
    for (let lane = 0; lane < 3; lane++) {
      const packet = makePacket({
        type: TYPE.HELLO,
        lane,
        session: app.tx.session,
        sequence: nextSequence(),
        sourceCount: app.tx.blocks.length,
        chunkSize: mode.chunkBytes,
        symbol: 0,
        aux: app.tx.meta.fileCrc,
        payload: app.tx.helloPayload,
        mode,
      });
      app.currentLanePackets[lane] = packet;
      app.currentLaneModes[lane] = mode.id;
    }
    renderCurrentTriFrame();
  }
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
    if (tx.frames > 0 && tx.frames % 42 === 0) {
      packets[2] = makePacket({
        type: TYPE.HELLO,
        lane: 2,
        session: tx.session,
        sequence: nextSequence(),
        sourceCount: tx.blocks.length,
        chunkSize: tx.meta.chunkSize,
        symbol: 0,
        aux: tx.meta.fileCrc,
        payload: tx.helloPayload,
        mode: tx.modeId,
      });
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
  function lumaAt(data, width, height, x, y, radius = 0) {
    x = Math.round(x);
    y = Math.round(y);
    let total = 0,
      count = 0;
    for (
      let yy = Math.max(0, y - radius);
      yy <= Math.min(height - 1, y + radius);
      yy++
    ) {
      for (
        let xx = Math.max(0, x - radius);
        xx <= Math.min(width - 1, x + radius);
        xx++
      ) {
        const offset = (yy * width + xx) * 4;
        total +=
          data[offset] * 0.2126 +
          data[offset + 1] * 0.7152 +
          data[offset + 2] * 0.0722;
        count++;
      }
    }
    return count ? total / count : 0;
  }
  function isCyanPixel(data, offset) {
    const r = data[offset],
      g = data[offset + 1],
      b = data[offset + 2];
    return g > 82 && b > 96 && Math.min(g, b) - r > 38 && Math.abs(g - b) < 105;
  }
  function quadCenter(quad) {
    return {
      x: (quad.tl.x + quad.tr.x + quad.bl.x + quad.br.x) / 4,
      y: (quad.tl.y + quad.tr.y + quad.bl.y + quad.br.y) / 4,
    };
  }
  function quadDimensions(quad) {
    const top = Math.hypot(quad.tr.x - quad.tl.x, quad.tr.y - quad.tl.y);
    const bottom = Math.hypot(quad.br.x - quad.bl.x, quad.br.y - quad.bl.y);
    const left = Math.hypot(quad.bl.x - quad.tl.x, quad.bl.y - quad.tl.y);
    const right = Math.hypot(quad.br.x - quad.tr.x, quad.br.y - quad.tr.y);
    return { width: (top + bottom) / 2, height: (left + right) / 2 };
  }
  function bilerp(quad, u, v) {
    const top = {
      x: quad.tl.x * (1 - u) + quad.tr.x * u,
      y: quad.tl.y * (1 - u) + quad.tr.y * u,
    };
    const bottom = {
      x: quad.bl.x * (1 - u) + quad.br.x * u,
      y: quad.bl.y * (1 - u) + quad.br.y * u,
    };
    return {
      x: top.x * (1 - v) + bottom.x * v,
      y: top.y * (1 - v) + bottom.y * v,
    };
  }
  function projectQuadPoint(quad, u, v) {
    const p0 = quad.tl,
      p1 = quad.tr,
      p2 = quad.br,
      p3 = quad.bl;
    const dx1 = p1.x - p2.x,
      dx2 = p3.x - p2.x,
      sx = p0.x - p1.x + p2.x - p3.x;
    const dy1 = p1.y - p2.y,
      dy2 = p3.y - p2.y,
      sy = p0.y - p1.y + p2.y - p3.y;
    if (Math.abs(sx) < 1e-7 && Math.abs(sy) < 1e-7)
      return {
        x: p0.x + (p1.x - p0.x) * u + (p3.x - p0.x) * v,
        y: p0.y + (p1.y - p0.y) * u + (p3.y - p0.y) * v,
      };
    const determinant = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(determinant) < 1e-7) return bilerp(quad, u, v);
    const g = (sx * dy2 - dx2 * sy) / determinant;
    const h = (dx1 * sy - sx * dy1) / determinant;
    const a = p1.x - p0.x + g * p1.x,
      b = p3.x - p0.x + h * p3.x,
      c = p0.x;
    const d = p1.y - p0.y + g * p1.y,
      e = p3.y - p0.y + h * p3.y,
      f = p0.y;
    const z = g * u + h * v + 1;
    if (Math.abs(z) < 1e-7) return bilerp(quad, u, v);
    return { x: (a * u + b * v + c) / z, y: (d * u + e * v + f) / z };
  }
  function insetQuad(quad, amount = 0.032) {
    const center = quadCenter(quad),
      out = {};
    for (const key of ["tl", "tr", "bl", "br"])
      out[key] = {
        x: quad[key].x + (center.x - quad[key].x) * amount,
        y: quad[key].y + (center.y - quad[key].y) * amount,
      };
    return out;
  }
  function overlapRatio(a, b) {
    const box = (q) => {
      const xs = [q.tl.x, q.tr.x, q.bl.x, q.br.x],
        ys = [q.tl.y, q.tr.y, q.bl.y, q.br.y];
      return {
        x1: Math.min(...xs),
        y1: Math.min(...ys),
        x2: Math.max(...xs),
        y2: Math.max(...ys),
      };
    };
    const A = box(a),
      B = box(b),
      x1 = Math.max(A.x1, B.x1),
      y1 = Math.max(A.y1, B.y1),
      x2 = Math.min(A.x2, B.x2),
      y2 = Math.min(A.y2, B.y2);
    const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const areaA = (A.x2 - A.x1) * (A.y2 - A.y1),
      areaB = (B.x2 - B.x1) * (B.y2 - B.y1);
    return intersection / Math.max(1, Math.min(areaA, areaB));
  }
  function componentToQuad(component, stride, width, height) {
    const convert = (point) => ({
      x: clamp((point.x + 0.5) * stride, 0, width - 1),
      y: clamp((point.y + 0.5) * stride, 0, height - 1),
    });
    return {
      tl: convert(component.tl),
      tr: convert(component.tr),
      bl: convert(component.bl),
      br: convert(component.br),
    };
  }
  function detectCyanComponents(image, width, height) {
    const data = image.data,
      stride = Math.max(2, Math.floor(Math.min(width, height) / 300));
    const gridWidth = Math.ceil(width / stride),
      gridHeight = Math.ceil(height / stride);
    const mask = new Uint8Array(gridWidth * gridHeight),
      points = [];
    for (let gy = 0; gy < gridHeight; gy++) {
      const y = Math.min(height - 1, gy * stride + (stride >> 1));
      for (let gx = 0; gx < gridWidth; gx++) {
        const x = Math.min(width - 1, gx * stride + (stride >> 1)),
          offset = (y * width + x) * 4,
          index = gy * gridWidth + gx;
        if (isCyanPixel(data, offset)) {
          mask[index] = 1;
          points.push({ x: gx, y: gy });
        }
      }
    }
    const seen = new Uint8Array(mask.length),
      candidates = [];
    const minCount = Math.max(
      24,
      Math.floor(Math.min(gridWidth, gridHeight) * 0.12),
    );
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || seen[start]) continue;
      const stack = [start];
      seen[start] = 1;
      let count = 0,
        minX = Infinity,
        minY = Infinity,
        maxX = -1,
        maxY = -1,
        minSum = Infinity,
        maxSum = -Infinity,
        minDiff = Infinity,
        maxDiff = -Infinity;
      let tl = null,
        tr = null,
        bl = null,
        br = null;
      while (stack.length) {
        const current = stack.pop(),
          cy = Math.floor(current / gridWidth),
          cx = current - cy * gridWidth;
        count++;
        minX = Math.min(minX, cx);
        maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy);
        maxY = Math.max(maxY, cy);
        const sum = cx + cy,
          diff = cx - cy;
        if (sum < minSum) {
          minSum = sum;
          tl = { x: cx, y: cy };
        }
        if (sum > maxSum) {
          maxSum = sum;
          br = { x: cx, y: cy };
        }
        if (diff > maxDiff) {
          maxDiff = diff;
          tr = { x: cx, y: cy };
        }
        if (diff < minDiff) {
          minDiff = diff;
          bl = { x: cx, y: cy };
        }
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = cx + dx,
              ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= gridWidth || ny >= gridHeight)
              continue;
            const next = ny * gridWidth + nx;
            if (mask[next] && !seen[next]) {
              seen[next] = 1;
              stack.push(next);
            }
          }
      }
      if (count < minCount || !tl || !tr || !bl || !br) continue;
      const bw = (maxX - minX + 1) * stride,
        bh = (maxY - minY + 1) * stride,
        area = bw * bh;
      if (
        bw < width * 0.1 ||
        bh < height * 0.1 ||
        area < width * height * 0.035
      )
        continue;
      const ratio = bw / Math.max(1, bh);
      if (ratio < 0.38 || ratio > 2.65) continue;
      const quad = componentToQuad({ tl, tr, bl, br }, stride, width, height);
      const dimensions = quadDimensions(quad);
      if (dimensions.width < width * 0.09 || dimensions.height < height * 0.09)
        continue;
      const score =
        area * (1 + Math.min(1, count / Math.max(1, (2 * (bw + bh)) / stride)));
      candidates.push({ quad, score, count });
    }
    candidates.sort((a, b) => b.score - a.score);
    const selected = [];
    for (const candidate of candidates) {
      if (
        selected.every((item) => overlapRatio(item.quad, candidate.quad) < 0.38)
      )
        selected.push(candidate);
      if (selected.length === 3) break;
    }
    if (selected.length < 3 && points.length > minCount * 3) {
      const clustered = clusterCyanPoints(points, stride, width, height);
      for (const item of clustered) {
        if (
          selected.every(
            (existing) => overlapRatio(existing.quad, item.quad) < 0.38,
          )
        )
          selected.push(item);
        if (selected.length === 3) break;
      }
    }
    return selected.slice(0, 3);
  }
  function clusterCyanPoints(points, stride, width, height) {
    const horizontal = width >= height,
      axis = (point) => (horizontal ? point.x : point.y);
    const values = points.map(axis).sort((a, b) => a - b);
    if (values.length < 60) return [];
    let centers = [
      values[Math.floor(values.length * 0.16)],
      values[Math.floor(values.length * 0.5)],
      values[Math.floor(values.length * 0.84)],
    ];
    for (let iteration = 0; iteration < 8; iteration++) {
      const groups = [[], [], []];
      for (const point of points) {
        let best = 0,
          distance = Math.abs(axis(point) - centers[0]);
        for (let i = 1; i < 3; i++) {
          const d = Math.abs(axis(point) - centers[i]);
          if (d < distance) {
            distance = d;
            best = i;
          }
        }
        groups[best].push(point);
      }
      centers = groups.map((group, index) =>
        group.length
          ? group.reduce((sum, point) => sum + axis(point), 0) / group.length
          : centers[index],
      );
    }
    const groups = [[], [], []];
    for (const point of points) {
      let best = 0,
        distance = Math.abs(axis(point) - centers[0]);
      for (let i = 1; i < 3; i++) {
        const d = Math.abs(axis(point) - centers[i]);
        if (d < distance) {
          distance = d;
          best = i;
        }
      }
      groups[best].push(point);
    }
    const out = [];
    for (const group of groups) {
      if (group.length < 30) continue;
      let minSum = Infinity,
        maxSum = -Infinity,
        minDiff = Infinity,
        maxDiff = -Infinity,
        tl,
        tr,
        bl,
        br;
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      for (const point of group) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
        const sum = point.x + point.y,
          diff = point.x - point.y;
        if (sum < minSum) {
          minSum = sum;
          tl = point;
        }
        if (sum > maxSum) {
          maxSum = sum;
          br = point;
        }
        if (diff > maxDiff) {
          maxDiff = diff;
          tr = point;
        }
        if (diff < minDiff) {
          minDiff = diff;
          bl = point;
        }
      }
      const bw = (maxX - minX + 1) * stride,
        bh = (maxY - minY + 1) * stride;
      if (bw < width * 0.09 || bh < height * 0.09) continue;
      out.push({
        quad: componentToQuad({ tl, tr, bl, br }, stride, width, height),
        score: bw * bh * 0.7,
        count: group.length,
      });
    }
    return out.sort((a, b) => b.score - a.score);
  }
  function orderQuads(items) {
    if (items.length < 2) return items;
    const centers = items.map((item) => quadCenter(item.quad));
    const spreadX =
      Math.max(...centers.map((p) => p.x)) -
      Math.min(...centers.map((p) => p.x));
    const spreadY =
      Math.max(...centers.map((p) => p.y)) -
      Math.min(...centers.map((p) => p.y));
    return items.slice().sort((a, b) => {
      const ca = quadCenter(a.quad),
        cb = quadCenter(b.quad);
      return spreadX >= spreadY ? ca.x - cb.x : ca.y - cb.y;
    });
  }
  function smoothQuad(previous, current, alpha = 0.42) {
    if (!previous) return current;
    const out = {};
    for (const key of ["tl", "tr", "bl", "br"])
      out[key] = {
        x: previous[key].x * (1 - alpha) + current[key].x * alpha,
        y: previous[key].y * (1 - alpha) + current[key].y * alpha,
      };
    return out;
  }
  function cyanAt(image, width, height, point) {
    const x = clamp(Math.round(point.x), 0, width - 1),
      y = clamp(Math.round(point.y), 0, height - 1);
    return isCyanPixel(image.data, (y * width + x) * 4);
  }
  function median(values) {
    if (!values.length) return null;
    const ordered = values.slice().sort((a, b) => a - b),
      middle = Math.floor(ordered.length / 2);
    return ordered.length % 2
      ? ordered[middle]
      : (ordered[middle - 1] + ordered[middle]) / 2;
  }
  function detectRailMargins(image, width, height, quad, dimensions) {
    const probes = [0.22, 0.38, 0.5, 0.62, 0.78];
    function scan(side, position) {
      const horizontal = side === "left" || side === "right";
      const span = horizontal ? dimensions.width : dimensions.height;
      const maxPixels = Math.max(8, Math.min(24, Math.ceil(span * 0.075)));
      let seen = false,
        lastCyan = -1,
        clearRun = 0;
      for (let pixel = 0; pixel <= maxPixels; pixel++) {
        const t = pixel / Math.max(1, span);
        let u = position,
          v = position;
        if (side === "left") {
          u = t;
          v = position;
        } else if (side === "right") {
          u = 1 - t;
          v = position;
        } else if (side === "top") {
          u = position;
          v = t;
        } else {
          u = position;
          v = 1 - t;
        }
        if (cyanAt(image, width, height, projectQuadPoint(quad, u, v))) {
          seen = true;
          lastCyan = pixel;
          clearRun = 0;
        } else if (seen && ++clearRun >= 2) {
          return clamp((lastCyan + 1.25) / Math.max(1, span), 0.003, 0.06);
        }
      }
      return null;
    }
    const left = median(
      probes.map((v) => scan("left", v)).filter(Number.isFinite),
    );
    const right = median(
      probes.map((v) => scan("right", v)).filter(Number.isFinite),
    );
    const top = median(
      probes.map((v) => scan("top", v)).filter(Number.isFinite),
    );
    const bottom = median(
      probes.map((v) => scan("bottom", v)).filter(Number.isFinite),
    );
    const estimatedCell = Math.min(
      dimensions.width /
        (dimensions.width > dimensions.height ? LONG_SIDE : SHORT_SIDE),
      dimensions.height /
        (dimensions.width > dimensions.height ? SHORT_SIDE : LONG_SIDE),
    );
    const fallbackU = clamp(
      (estimatedCell * 0.62) / Math.max(1, dimensions.width),
      0.004,
      0.038,
    );
    const fallbackV = clamp(
      (estimatedCell * 0.62) / Math.max(1, dimensions.height),
      0.004,
      0.038,
    );
    return {
      u: clamp(
        Number.isFinite(left) && Number.isFinite(right)
          ? (left + right) / 2
          : Number.isFinite(left)
            ? left
            : Number.isFinite(right)
              ? right
              : fallbackU,
        0.004,
        0.05,
      ),
      v: clamp(
        Number.isFinite(top) && Number.isFinite(bottom)
          ? (top + bottom) / 2
          : Number.isFinite(top)
            ? top
            : Number.isFinite(bottom)
              ? bottom
              : fallbackV,
        0.004,
        0.05,
      ),
    };
  }
  function rgbAt(data, width, height, x, y, radius = 0) {
    x = Math.round(x);
    y = Math.round(y);
    const totals = [0, 0, 0];
    let count = 0;
    for (
      let yy = Math.max(0, y - radius);
      yy <= Math.min(height - 1, y + radius);
      yy++
    )
      for (
        let xx = Math.max(0, x - radius);
        xx <= Math.min(width - 1, x + radius);
        xx++
      ) {
        const offset = (yy * width + xx) * 4;
        totals[0] += data[offset];
        totals[1] += data[offset + 1];
        totals[2] += data[offset + 2];
        count++;
      }
    return count ? totals.map((value) => value / count) : [0, 0, 0];
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
  function decodeOpticalQuad(image, width, height, quad) {
    const dimensions = quadDimensions(quad),
      wide = dimensions.width > dimensions.height;
    const cols = wide ? LONG_SIDE : SHORT_SIDE,
      rows = wide ? SHORT_SIDE : LONG_SIDE;
    const samples = new Float32Array(cols * rows * 3);
    const estimatedCell = Math.min(
      dimensions.width / cols,
      dimensions.height / rows,
    );
    const margins = detectRailMargins(image, width, height, quad, dimensions);
    const marginU = margins.u,
      marginV = margins.v;
    const radius = estimatedCell > 6 ? 1 : 0;
    let sampleOffset = 0;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const u = marginU + ((x + 0.5) / cols) * (1 - marginU * 2);
        const v = marginV + ((y + 0.5) / rows) * (1 - marginV * 2);
        const point = projectQuadPoint(quad, u, v),
          rgb = rgbAt(image.data, width, height, point.x, point.y, radius);
        samples[sampleOffset++] = rgb[0];
        samples[sampleOffset++] = rgb[1];
        samples[sampleOffset++] = rgb[2];
      }
    const preferred = app.rx?.modeId || app.modeId;
    const modeIds = [preferred, ...MODE_ORDER].filter(
      (modeId, index, all) =>
        MODE_DEFINITIONS[modeId] && all.indexOf(modeId) === index,
    );
    let bestBad = null;
    for (const modeId of modeIds)
      for (const rotation of [0, 180]) {
        const classified = classifyColorSamples(
          samples,
          cols,
          rows,
          modeId,
          rotation,
        );
        if (!classified) continue;
        const bytes = symbolsToBytes(
            classified.symbols,
            cols,
            rows,
            classified.mode,
          ),
          packet = parsePacket(bytes, classified.mode);
        const result = {
          packet,
          quality: classified.quality,
          quad,
          cols,
          rows,
          mode: classified.mode,
          rotation,
          centers: classified.centers,
          pilotError: classified.pilotError,
          minSeparation: classified.minSeparation,
        };
        if (packet?.bad) {
          if (!bestBad || result.quality > bestBad.quality)
            bestBad = { ...result, bad: true };
          continue;
        }
        if (packet) return result;
      }
    return bestBad;
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
    setPhase("RX_DATA");
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
      let meta;
      try {
        meta = JSON.parse(decoderText.decode(packet.payload));
      } catch {
        return;
      }
      const mode = modeByBits(packet.bits);
      if (
        !mode ||
        meta.engine !== ENGINE_NAME ||
        meta.protocol !== PROTOCOL ||
        meta.transport !== "TriFrame-3" ||
        meta.mode !== mode.id ||
        meta.bits !== mode.bits ||
        meta.symbols !== mode.symbols ||
        meta.sourceCount !== packet.sourceCount ||
        meta.chunkSize !== packet.chunkSize ||
        packet.chunkSize !== mode.chunkBytes
      )
        return;
      if (!app.rx || app.rx.session !== packet.session)
        newReceiverSession(packet, meta);
      else if (!app.rx.acked) {
        app.rx.acked = true;
        sonic.emit("ACK").catch(() => {});
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
      : "AUTO 2/3/4-bit";
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
    const scale = Math.min(1, 720 / shortSide, 1280 / longSide);
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
          width: { ideal: 1080 },
          height: { ideal: 1920 },
          aspectRatio: { ideal: 9 / 16 },
          resizeMode: { ideal: "crop-and-scale" },
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
      $("cameraState").textContent = "AUTODOCK 3·VERTICAL·BUSCANDO";
      setEngineStatus("CÁMARA ACTIVA", "online");
      app.scanFrames = 0;
      app.scanFpsAt = performance.now();
      app.scanLastAt = 0;
      app.lastTrackedQuads = [];
      app.trackedAt = 0;
      app.scanRaf = requestAnimationFrame(scanLoop);
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
  function scanLoop(timestamp) {
    if (!app.cameraStream) return;
    app.scanRaf = requestAnimationFrame(scanLoop);
    if (timestamp - app.scanLastAt < 68) return;
    app.scanLastAt = timestamp;
    const video = $("cameraVideo");
    if (video.readyState < 2 || !video.videoWidth) return;
    const { width, height } = receiverScanDimensions(video);
    const canvas = $("captureCanvas"),
      ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.drawImage(video, 0, 0, width, height);
    let image;
    try {
      image = ctx.getImageData(0, 0, width, height);
    } catch {
      return;
    }
    let items = orderQuads(detectCyanComponents(image, width, height));
    const currentTime = performance.now();
    if (items.length === 3) {
      items = items.map((item, index) => ({
        ...item,
        quad: smoothQuad(app.lastTrackedQuads[index], item.quad),
      }));
      app.lastTrackedQuads = items.map((item) => item.quad);
      app.trackedAt = currentTime;
    } else if (
      items.length < 3 &&
      app.lastTrackedQuads.length === 3 &&
      currentTime - app.trackedAt < 1150
    ) {
      const existing = items.map((item) => item.quad);
      for (const tracked of app.lastTrackedQuads) {
        if (existing.every((quad) => overlapRatio(quad, tracked) < 0.42))
          items.push({ quad: tracked, score: 0, held: true });
        if (items.length === 3) break;
      }
      items = orderQuads(items);
    }
    for (const item of items) {
      const decoded = decodeOpticalQuad(image, width, height, item.quad);
      item.decoded = decoded && !decoded.bad ? decoded : null;
      if (decoded?.bad) {
        app.detection.rejected++;
        if (app.rx) app.rx.rejected++;
        if (app.detection.rejected % 20 === 1)
          flight.record(
            "optical",
            "packet-crc-rejected",
            {
              lane: decoded.packet.lane,
              session: decoded.packet.session,
              expected: decoded.packet.expected,
              actual: decoded.packet.actual,
            },
            decoded.quality,
          );
      } else if (decoded?.packet)
        processDecodedPacket(decoded.packet, decoded.quality);
    }
    drawGuide(width, height, items);
    updateLaneLocks();
    const validItems = items.filter((item) => item.decoded?.packet),
      detected = items.length;
    $("cameraState").textContent =
      detected === 3
        ? validItems.length
          ? "AUTODOCK 3·DECODIFICANDO"
          : "AUTODOCK 3·GEOMETRÍA 3/3"
        : `AUTODOCK 3·BUSCANDO ${detected}/3`;
    app.scanFrames++;
    if (currentTime - app.scanFpsAt >= 1000) {
      app.scanFps = (app.scanFrames * 1000) / (currentTime - app.scanFpsAt);
      app.scanFrames = 0;
      app.scanFpsAt = currentTime;
      $("scanFps").textContent = `${app.scanFps.toFixed(1)}fps`;
    }
    if (currentTime - app.detection.lastMetricAt > 2000) {
      app.detection.lastMetricAt = currentTime;
      const average = app.recentQuality.length
        ? app.recentQuality.reduce((sum, value) => sum + value, 0) /
          app.recentQuality.length
        : 0;
      flight.record(
        "metric",
        "rx-snapshot",
        {
          detectedQuads: detected,
          decodedLanes: validItems.length,
          scanFps: Number(app.scanFps.toFixed(1)),
          validPackets: app.detection.valid,
          rejectedCrc: app.detection.rejected,
          known: app.rx?.decoder?.snapshot?.().known || 0,
          total: app.rx?.sourceCount || 0,
          mode: app.rx?.modeId || null,
          bits: app.rx ? resolveMode(app.rx.modeId).bits : null,
        },
        average,
      );
    }
    updateReceiverUI();
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
      .querySelectorAll("[data-optical-mode]")
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
      if (app.tx) {
        app.tx.running = false;
        app.tx.loopToken++;
      }
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
        "./sw.js?v=1202",
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
        autoDock3: true,
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
        flightEvents: flight.events.length,
      }),
    };
  }
  window.__hopperLinkOneInternals = {
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
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
