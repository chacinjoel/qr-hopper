# HopperLink ONE · HopperCore 1.4.0 · H7 Control+

Build **1400**, protocol **4**. Update both endpoints; build 1300 optical frames are incompatible.

## What was actually recovered from HPS7

Audited HPS7 at commit `c63815037ccf4d3aaa08bc03b964012b6cc44bcf`, specifically `hps7.js` and `binary-tag-bridge-fast.js`. HPS7 used a separate fixed-gray HELLO/control channel, a 13-byte initial HELLO payload, and four global corner references. It did not require reading the selected color DATA modulation to acquire the session.

The four original 5×5 HPS7 binary patterns are reused exactly (converted from black=1 to white=1). Their 16 rotated variants have minimum pairwise Hamming distance 9. The new renderer makes each marker twice as wide/high in raster units as build 1300 and shares four markers across the whole optical dock, rather than requiring three small identified markers for each of three lanes. At least three of the four current references are required. No synthetic markers are painted over camera pixels.

## Control and file identification

- HELLO uses **30×18 cells in fixed 2-bit grayscale**, independent of the selected 2/3/4-bit DATA mode. Control cells are twice as wide and twice as high as DATA cells.
- Metadata includes full UTF-8 filename, size, actual DATA mode, CRC32, SHA-256 when available, MIME and modification time. Compact metadata is split into at most 20-byte fragments with bounded, session-bound reassembly.
- The complete packet, including its header, is protected by Hamming(8,4) SECDED and interleaved codewords. Single-bit errors per codeword are correctable; detected double-bit damage is rejected. Per-packet CRC32 and whole-metadata CRC32 must pass. This does not imply arbitrary burst-error immunity.
- Three consecutive metadata fragments are shown at once and the control carousel advances every 400 ms. Missing fragments repeat. No filename/session success is declared from geometry alone or from partial metadata.
- The receiver displays partial metadata progress, then the validated filename and actual DATA mode. Existing Sonic Assist ACK follows complete validated metadata; a lost ACK can be retried on subsequent HELLOs while awaiting DATA. Audio remains a basic, unaddressed tone backchannel, not authenticated telemetry.

## Geometry and DATA

One canonical **92×166 raster** contains four exterior markers and the three vertically stacked **60×36** DATA regions. The same transform and outer geometry are retained through HELLO and DATA. No CSS-inset guessing, independently stretched marker rectangles, or labels over payload. Modulation capacities remain 480 / 736 / 1000 bytes per DATA lane.

The current image supplies all accepted coordinates. Previous positions narrow the next search windows; stale coordinates never count as a newly decoded packet. Workers process one frame at a time with bounded fallback. Missing/blurred frames do not discard received blocks. Systematic/Fountain reconstruction and final integrity checks are retained. The maximum accepted file size is 128 MiB in this browser implementation.

## Use

1. Confirm **HopperCore 1.4.0 · H7 Control+** on both devices.
2. Choose the DATA mode, prepare a file and open the sender vertically.
3. The sender initially shows grayscale in every DATA mode. That is the robust control channel, not a failure to select color.
4. Include the entire white dock and its four large black/white corner patterns in the receiver camera. Wait for the filename and mode.
5. Sonic ACK can begin DATA automatically; the manual start button is a fallback after the receiver shows the filename. DATA then uses the selected color/grayscale mode.
6. The download is enabled only after file integrity verification.

`Captura para diagnóstico` saves a raw PNG of the current camera frame, without UI overlays, only on explicit user action. Pair it with the existing Flight Recorder JSON when investigating a physical-device failure. The app does not upload camera images.

## Reproducible validation

```sh
HOPPER_BUILD=1400 node hopperlink-pixelstream/tools/build-runtime.mjs
node hopperlink-pixelstream/tests/hopper-one-color-modes.test.cjs
node hopperlink-pixelstream/tests/hopper-one-unobstructed.test.cjs
node hopperlink-pixelstream/tests/hopper-one-h7-control.test.cjs
# Requires Python Playwright and Chrome or Chromium:
python hopperlink-pixelstream/tests/hopper-one-browser.py
```

The pixel suite covers 35 synthetic frames/scenarios: every DATA mode, coarse gray HELLO, small projection, exposure/noise/moderate blur, a hidden global corner, exact metadata, Unicode fragmentation, SECDED correction/rejection, current-frame motion, blank-frame rejection and DATA reconstruction. The browser test serves the real files over localhost, loads the same-origin worker/imports, feeds actual sender screenshots through a simulated Canvas camera, receives 2048 bytes in each mode, checks filename/mode, native SHA-256, unobstructed layout and exact downloaded bytes. Audio and physical lenses are not simulated by that test.

Neither these checks nor the HPS7 comparison establish physical-phone reliability, universal motion tolerance, or a particular throughput. The new raw capture export makes the next physical failure directly inspectable rather than inferred from UI overlays.
