import { ReceiverSession } from './receiver2.js';
import { packFile } from './superstream.js';
import { crc32 } from './crc32.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_METADATA = 65536;
export const BUILD = 'hdp21-metrics-flash1';

// HXS2 remains the file envelope. These optional metadata fields do not change
// compression, FEC, optical cells, or the file reconstructed by older readers.
export async function prepareTransfer(file) {
  const packed = await packFile(file);
  const oldLength = new DataView(packed.stream.buffer).getUint32(4);
  const linkId = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  const meta = { ...packed.meta, linkId, build: BUILD };
  const bytes = encoder.encode(JSON.stringify(meta));
  if (bytes.length > MAX_METADATA) throw new Error('Metadatos demasiado grandes.');
  const stream = new Uint8Array(8 + bytes.length + packed.packedBytes);
  stream.set([0x48, 0x58, 0x53, 0x32]);
  new DataView(stream.buffer).setUint32(4, bytes.length);
  stream.set(bytes, 8);
  stream.set(packed.stream.subarray(8 + oldLength), 8 + bytes.length);
  return { ...packed, meta, stream, metadataBytes: 8 + bytes.length };
}

export function duration(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  seconds = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60);
  return hours ? `${hours} h ${minutes} min` : minutes ? `${minutes} min ${seconds % 60} s` : `${seconds} s`;
}

export class DownloadSession extends ReceiverSession {
  reset() {
    super.reset();
    this.generation = (this.generation || 0) + 1;
    this.meta = null; this.metadataBytes = 0; this.startedAt = null;
    this.finishedAt = null; this.verified = false; this.failure = null;
    this.samples = []; this.lastUsefulAt = null; this.wireFrames = 0;
    this.seenOptical = new Set(); this.lastHeader = null;
  }
  ingest(decoded, now = performance.now()) {
    const h = decoded?.header, b = decoded?.payload;
    if (!h || !(b instanceof Uint8Array) || ![0, 1].includes(h.kind)) return null;
    if (!Number.isInteger(h.streamLength) || h.streamLength <= 0 || h.streamLength > 256 * 1024 * 1024 ||
        !Number.isInteger(h.k) || h.k < 1 || h.k > 20 || !Number.isInteger(h.r) || h.r < 0 || h.k + h.r > 255 ||
        !Number.isInteger(h.group) || h.group < 0 || !Number.isInteger(h.slot) || h.slot < 0 || h.slot >= h.k + h.r ||
        !b.length || b.length > 65535 || h.payloadLen !== b.length || crc32(b) !== h.crc ||
        (h.kind === 0) !== (h.slot < h.k) ||
        h.group >= Math.ceil(Math.ceil(h.streamLength / b.length) / h.k)) return null;
    if (this.streamLength && (this.streamLength !== h.streamLength || this.blockLen !== b.length || this.k !== h.k || this.r !== h.r)) return null;
    if (this.startedAt === null) { this.startedAt = now; this.samples.push({ t: now, bytes: 0 }); }
    const before = this.usefulBytes();
    const progress = super.ingest(decoded);
    this.lastHeader = h;
    this.seenOptical.add(`${h.group}:${h.slot}`); this.wireFrames++;
    this.readMetadata();
    const bytes = this.usefulBytes();
    if (bytes > before) this.lastUsefulAt = now;
    // Bytes include unique reconstructed stream bytes, not duplicate or parity
    // symbols. FEC contributes only when it actually reconstructs missing data.
    this.samples.push({ t: now, bytes });
    while (this.samples.length > 2 && this.samples[1].t < now - 6000) this.samples.shift();
    return progress;
  }
  usefulBytes() {
    let bytes = 0;
    if (!this.blockLen) return bytes;
    for (const [g, slots] of this.groups) for (let s = 0; s < this.k; s++) {
      const offset = (g * this.k + s) * this.blockLen;
      if (offset < this.streamLength && slots.has(s)) bytes += Math.min(this.blockLen, this.streamLength - offset);
    }
    return bytes;
  }
  readMetadata() {
    if (this.meta || !this.blockLen) return this.meta;
    const first = this.groups.get(0)?.get(0);
    if (!first || first.length < 8 || first[0] !== 0x48 || first[1] !== 0x58 || first[2] !== 0x53 || first[3] !== 0x32) return null;
    const length = new DataView(first.buffer, first.byteOffset, first.byteLength).getUint32(4);
    if (length > MAX_METADATA || length + 8 > this.streamLength) return null;
    const prefix = new Uint8Array(8 + length);
    for (let i = 0; i < Math.ceil(prefix.length / this.blockLen); i++) {
      const b = this.groups.get(Math.floor(i / this.k))?.get(i % this.k);
      if (!b) return null;
      prefix.set(b.subarray(0, Math.min(b.length, prefix.length - i * this.blockLen)), i * this.blockLen);
    }
    try {
      const m = JSON.parse(decoder.decode(prefix.subarray(8)));
      if (typeof m.name !== 'string' || !Number.isSafeInteger(m.size) || m.size < 0 ||
          !['raw', 'gzip'].includes(m.codec) || !Number.isSafeInteger(m.packedSize) ||
          m.packedSize !== this.streamLength - prefix.length || !/^[a-f0-9]{64}$/i.test(m.sha256)) return null;
      this.meta = m; this.metadataBytes = prefix.length;
    } catch { return null; }
    return this.meta;
  }
  metrics(now = performance.now()) {
    const bytes = this.usefulBytes(), total = this.streamLength;
    const end = this.finishedAt ?? now;
    const elapsed = this.startedAt === null ? 0 : Math.max(0, (end - this.startedAt) / 1000);
    const cutoff = now - 5000;
    let anchor = this.samples[0];
    for (const s of this.samples) { if (s.t <= cutoff) anchor = s; else break; }
    const stalled = !this.verified && this.lastUsefulAt !== null && now - this.lastUsefulAt > 5000;
    const span = anchor ? (now - anchor.t) / 1000 : 0;
    const speed = !this.verified && !stalled && span >= 1 ? Math.max(0, (bytes - anchor.bytes) / span) : 0;
    const average = elapsed > 0 ? bytes / elapsed : 0;
    const remaining = Math.max(0, total - bytes);
    const percent = this.verified ? 100 : total ? Math.min(99.9, bytes / total * 100) : 0;
    return { bytes, total, percent, speed, average, elapsed, stalled,
      eta: this.verified ? 0 : remaining && speed > 0 ? remaining / speed : null,
      verified: this.verified, awaitingVerification: total > 0 && remaining === 0,
      name: this.meta?.name || 'Esperando nombre del archivo…', originalSize: this.meta?.size ?? null,
      opticalFrames: this.seenOptical.size, duplicates: this.duplicates, failure: this.failure };
  }
  async verify(now = () => performance.now()) {
    const generation = this.generation;
    const file = await super.assemble();
    if (generation !== this.generation) throw new Error('Descarga reiniciada durante la verificación.');
    this.meta = file.meta; this.verified = true; this.finishedAt = now();
    return file;
  }
  nextMissing() {
    if (!this.streamLength || !this.k) return null;
    for (let g = 0; g < Math.ceil(this.dataCount / this.k); g++) {
      let mask = 0;
      for (let s = 0; s < this.k; s++) if (g * this.k + s < this.dataCount && !this.groups.get(g)?.has(s)) mask |= 1 << s;
      if (mask) return { group: g, mask };
    }
    return null;
  }
}

// Repeat the existing systematic prefix before the interleaved schedule. No
// separate file-name protocol is necessary and no unverified name is executed.
export function metadataSchedule(transport, metadataBytes) {
  const count = Math.ceil(metadataBytes / transport.blockLen), out = [];
  for (let i = 0; i < count; i++) {
    const index = transport.frames.findIndex(f => f.kind === 0 && f.dataIndex === i);
    if (index >= 0) out.push(index);
  }
  return [...out, ...out];
}

export function estimateTransmission(schedules, fps, hdp) {
  if (!Number.isFinite(fps) || fps <= 0) return null;
  let seconds = hdp.discoveryMs / 1000;
  schedules.forEach((s, i) => {
    seconds += s.length / fps + Math.floor(Math.max(0, s.length - 1) / hdp.beaconEvery) * hdp.beaconHoldMs / 1000;
    if (i) seconds += 0.18;
  });
  return seconds;
}
