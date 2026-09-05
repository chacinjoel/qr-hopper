# AnchorScan 1300 validation and limits

## Code changes

Replaced the active white/cyan-ring + horizontal-rail + tower-split acquisition path. Removed the old ring margin guess and coordinate smoothing/hold. The scan now uses explicit coded fiducials, current-frame least-squares geometry, exact raster mapping, CRC validation and a single-flight Worker. A/B/C remain vertically stacked and unobstructed in HELLO and DATA.

## Checks executed locally

- Node 22.16: all existing packet/color/build integrity tests updated to protocol 3 and build 1300; PASS.
- No-overlay and stable HELLO/DATA layout source contract; PASS.
- New deterministic acquisition regression: 36 scenarios; PASS. All payloads accepted by the scan were checked byte-for-byte. Dictionary distance was checked over every pair of rotated codewords. The tests reject insufficient references, damaged payload and pure noise instead of treating geometry alone as file detection.
- A 12-frame simulated handheld translation/tilt sequence recovered all three payloads on every frame. Ten frames exercised the ROI path, not just full detection.
- Test-machine timings from one run: median total detection + payload decode about 29 ms, p95 about 67 ms, warm ROI frames about 17–21 ms. These are **not phone measurements or throughput guarantees**.
- Chromium rendered the production sender UI at 430×932 / device scale 2. The actual screenshots decoded all three HELLOs for all three modes in the production scanner. No page errors were observed in those sender checks.
- Chromium receiver integration used a real Web Worker and a mocked camera made from a Canvas MediaStream of those sender screenshots. In all three modes, the receiver identified the filename `anchor-proof.bin`, the correct mode and all 12 markers. Worker source was composed inline in this test because local browser navigation was restricted; production uses same-origin worker imports. This does not constitute a physical screen-to-camera or acoustic test.

## Honest limitations

The supplied old recordings do not contain the new coded markers, so they are not evidence that this new optical format works on a physical handset. Real phone testing is still needed for focus, lens distortion, exposure time, reflections, rolling shutter, low-end CPU load, Web Worker startup/caching and the acoustic ACK/COMPLETE. No claim of arbitrary-motion/noise immunity is made.

A lane currently needs at least three identified marker corners. If more are hidden or the data are too blurred, the frame is discarded while previously received blocks remain. Marker mode is a candidate until a CRC-valid packet/HELLO confirms it. Full-session completion still requires file integrity verification.
