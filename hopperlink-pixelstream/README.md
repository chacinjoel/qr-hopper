# HopperLink ONE · HopperCore 1.3.0 · AnchorScan

A single screen-to-camera file transfer app. Three vertically stacked lanes, with selectable 2/3/4-bit optical modes. Both endpoints **must load build 1300**: the optical frame is new and packets use protocol 3.

## Acquisition is now based on coded anchors, not colored rings

Each lane renders four exterior black/white 7×7 fiducials on a white quiet zone. The payload, pilots and fiducials are rendered in **one canonical 84×40 raster**. The 60×36 data grid is at a known offset (12,2), so the receiver no longer guesses CSS border insets.

36 marker codes encode optical mode, lane and corner. Including rotations, all 144 variants have minimum Hamming distance 8. Identification accepts at most 2 bit errors and requires a separated runner-up. At least three independently identified markers in a lane must agree on a projective transform. One hidden marker per lane can therefore be tolerated when the remaining markers and data are readable. Markers identify the candidate mode; only a valid packet CRC and HELLO metadata establish a session.

## Motion and performance

- Adaptive local grayscale threshold; no requirement for a particular cyan hue.
- Convex-hull proposals followed by subpixel black/white edge fitting.
- Least-squares homography from the current frame's marker corners, with reprojection rejection.
- Fast region-of-interest re-detection after acquisition; periodic full scans and same-frame full reacquisition on failed tracking.
- **No stale-coordinate decoding, artificial marker painting, or 1.8-second geometry hold.** Tracking windows may use the previous position; accepted payload coordinates must come from current markers.
- Real video-frame callbacks where available, one worker job in flight, transferable pixel buffer, bounded main-thread fallback. No growing processing queue.
- The worker isolates detection and decoding from the UI. Capture preserves sensor aspect ratio and is capped at 1080 on the short side / 1920 on the long side. Marker acquisition uses a reduced grayscale pyramid level capped at 960 on the long side; payload colors are sampled from the higher-resolution image.
- Existing received blocks remain intact through lost or blurry frames. Frames without enough valid references or with a failed CRC do not advance file reception.

Motion blur, severe glare, tiny projected cells and rolling shutter can still prevent decoding. This is not unlimited noise immunity. Recovery means accepting the next usable frame without discarding the partial file, not manufacturing pixels obscured by motion.

## Modes and integrity

| Mode | Symbols | Bits/cell | Payload bytes/lane |
|---|---:|---:|---:|
| Robusto | 4 gray levels | 2 | 480 |
| Color Adaptativo | 8 colors | 3 | 736 |
| Color Turbo | 16 colors | 4 | 1,000 |

The data-cell count and per-packet capacities are unchanged. Exterior markers reserve screen area and do not increase theoretical bitrate. Real throughput depends on frame reception and redundancy. The existing systematic/Fountain stream, CRC32 and final SHA-256 verification (when Web Crypto is available), and basic Sonic Assist ACK/COMPLETE remain in the runtime. This change does **not** add an acoustic telemetry protocol.

## Use

Open the app on both endpoints and confirm **HopperCore 1.3.0 · AnchorScan**. On TX select a mode and file, prepare, and open fullscreen. On RX start the camera and include the white panels and black markers. Do not aim only at the colored interiors. The UI distinguishes markers, candidate mode, CRC-validated packets and verified file completion. Receiver overlays are drawn separately from the image sent to the decoder. No labels or controls are drawn over TX data.

## Reproducible checks

```sh
HOPPER_BUILD=1300 node hopperlink-pixelstream/tools/build-runtime.mjs
node hopperlink-pixelstream/tests/hopper-one-color-modes.test.cjs
node hopperlink-pixelstream/tests/hopper-one-unobstructed.test.cjs
node hopperlink-pixelstream/tests/hopper-one-anchor-scan.test.cjs
```

The new regression suite tests 36 synthetic screen-to-camera scenarios: all three modes, perspective, noise/exposure variation, moderate blur, 90-degree rotation, one hidden marker, insufficient-marker rejection, HELLO metadata, corrupted payload rejection, moving-hand sequences, no stale lock on a blank frame, next-frame reacquisition, noise-only rejection and exact block reconstruction. Timings printed by tests describe the test machine, not measured phone performance.

All assets, including worker dependencies, are local and versioned in the offline cache. HTTPS is required for production camera/microphone permissions. An initial online load is needed to cache the app.
