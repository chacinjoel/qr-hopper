/** Receiver-only helpers. No change to Lighthouse or the optical wire format. */
export function videoFrameKey(video, meta) {
  // A callback frame counter is stronger evidence than a rounded mediaTime.
  if (Number.isFinite(meta?.presentedFrames)) return `presented:${meta.presentedFrames}`;
  if (Number.isFinite(meta?.mediaTime)) return `time:${meta.mediaTime}`;
  try {
    const n = video.getVideoPlaybackQuality?.().totalVideoFrames;
    if (Number.isFinite(n) && n > 0) return `decoded:${n}`;
  } catch { /* Playback quality is optional. */ }
  return Number.isFinite(video.currentTime) ? `time:${video.currentTime}` : null;
}

/** Refine the white centre, not an intensity-biased slice of its coloured ring.
 * Idle (18-cell) and active (10-cell) beacons have the same 2-cell centre.
 * No centre is invented when the contrast is insufficient. */
export function centreSpot(data, width, height, point, pitch) {
  if (!point || !Number.isFinite(pitch) || pitch < 1) return null;
  const radius = Math.max(4, Math.ceil(pitch * 2.4));
  const x0 = Math.max(0, Math.floor(point.x - radius));
  const y0 = Math.max(0, Math.floor(point.y - radius));
  const x1 = Math.min(width, Math.ceil(point.x + radius + 1));
  const y1 = Math.min(height, Math.ceil(point.y + radius + 1));
  const w = x1 - x0, h = y1 - y0;
  if (w < 2 || h < 2) return null;
  const light = new Float32Array(w * h), neutral = new Uint8Array(w * h);
  let lo = 255, hi = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = ((y + y0) * width + x + x0) * 4;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const v = .2126 * r + .7152 * g + .0722 * b;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), i = y * w + x;
    light[i] = v; lo = Math.min(lo, v);
    neutral[i] = max > 95 && min > max * .50 ? 1 : 0;
    if (neutral[i]) hi = Math.max(hi, v);
  }
  if (hi - lo < 30) return null;
  const threshold = lo + (hi - lo) * .58, seen = new Uint8Array(w * h);
  let best = null, bestScore = -Infinity;
  for (let i = 0; i < seen.length; i++) {
    if (seen[i] || !neutral[i] || light[i] < threshold) continue;
    const queue = [i]; seen[i] = 1;
    let count = 0, sx = 0, sy = 0, minX = w, minY = h, maxX = 0, maxY = 0;
    while (queue.length) {
      const n = queue.pop(), x = n % w, y = Math.floor(n / w);
      count++; sx += x + x0; sy += y + y0;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (!seen[j] && neutral[j] && light[j] >= threshold) { seen[j] = 1; queue.push(j); }
      }
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const cx = sx / count, cy = sy / count, distance = Math.hypot(cx - point.x, cy - point.y);
    if (count < Math.max(2, pitch * pitch * .22) || bw > pitch * 4.2 || bh > pitch * 4.2 ||
        Math.min(bw, bh) / Math.max(bw, bh) < .35 || distance > pitch * 1.7) continue;
    const score = count / (bw * bh) - distance / (pitch * 2);
    if (score > bestScore) { bestScore = score; best = { x: cx, y: cy }; }
  }
  return best;
}

export function acquisitionMessage({lock = 0, beacons = 0, headers = 0, lastPacketAge = Infinity, stalled = false} = {}) {
  if (stalled) return 'La cámara no entrega cuadros nuevos. Reinicia la cámara.';
  if (lock > .45) return lastPacketAge < 1200
    ? 'Área detectada · leyendo mensajes.'
    : 'Área detectada · esperando Calibrar enlace en el emisor.';
  if (beacons > 0) return `Balizas ${beacons}/4 · incluye las cuatro esquinas.`;
  return 'Buscando las cuatro balizas.';
}
