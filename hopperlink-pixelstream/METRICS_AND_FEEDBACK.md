# HDP 2.1 · Metrics and experimental flash return

## Preserved baseline

`optical2.js`, `receiver2.js`, `superstream.js`, `gf256.js`, and `crc32.js` are byte-for-byte identical to commit `f39274de4b444f30485d98a4b4f577debdcb92db`. The automated core test checks their Git blob hashes. Lighthouse geometry, RGB palettes, Reed-Solomon codes, payload layout, compression selection, slot interleaving and automatic rescue schedules are retained.

`app-metrics.js` is the new UI/queue controller. The old controller stays in repository history and is not loaded by index.html. Both phones must reload the updated index and its versioned dependencies.

## Download metrics

The receiver reads the HXS2 JSON metadata from the first contiguous recovered prefix. The sender prepends two copies of the necessary systematic prefix blocks to give the name an earlier chance of arriving. Optional metadata fields `linkId` and `build` are added before transport segmentation; file contents are unchanged.

- Name and original file size are displayed as text, never HTML.
- Progress and speed measure **unique reconstructed HXS2 stream bytes**, bounded by the real last-block length. This includes the small metadata envelope. Duplicates, transmitted padding and unused parity do not inflate the result. FEC counts only when it reconstructs missing useful data.
- Speed is based on a trailing approximately five-second observation window; average uses elapsed receipt time.
- If no useful progress occurs for five seconds, current speed becomes zero and ETA becomes unknown/waiting. No fabricated infinite ETA or perpetual positive speed.
- The receiver displays at most 99.9% until reconstruction and SHA-256 verification succeed. Final duration stops at verification. Reset invalidates an in-flight verification.
- Sender output is labelled **bytes submitted to canvas**, not received bandwidth. Its completion status does not claim receiver success without feedback.
- Estimated first-pass and full-plan durations account for payload frames, repeated metadata prefix, fixed FEC/rescue schedules, discovery, and beacon holds. They exclude preparation, frame-clock/CPU stalls, any requested repair, and flash windows.

## Flash return (opt-in; physical validation pending)

Geometry: sender screen -> receiver rear camera; receiver rear LED -> sender front camera. No sound, server, Bluetooth or local network carries the payload or feedback.

Receiver must expose torch capability through MediaStreamTrack, and the sender must grant front-camera permission. Capability detection is not proof of reliable pulse timing. If a torch transition is late by over 100 ms, the attempt is aborted and the LED is turned off in `finally`; manual repair and original rescues remain available. Hidden pages/cancelled capture terminate flashing. Do not point the flash into eyes; users sensitive to flashes should not enable it.

After the programmed data/rescue passes, a sender with return enabled emits an HDP control frame (`kind=2`, `HXC1` payload with CRC32). Data (`kind=0`) and parity (`kind=1`) formats are unchanged. New readers intercept control frames before the data assembler. The sender listens in up to three 65-second windows. During a flash response, the receiver does not ingest DATA; the sender is already holding the feedback window rather than streaming payload.

Response packet: 10 bytes, big endian: random transfer ID (32 bits), FEC group (16 bits), missing systematic-slot bitmap (16 bits), CRC16-CCITT (16 bits). The transfer ID prevents accidental mixing with a different prepared transfer; it is not cryptographic authentication. Normal requests enqueue exactly the indicated useful systematic blocks for one group. With more than three pending groups, a compact `REPAIR_ALL` request asks for an entire systematic rescue rather than sending many long flash messages. `COMPLETE` is sent only after receiver SHA-256 verification.

Modulation: Manchester, 125 ms per half-bit, training/sync prefix and off tail. 190 half-bit periods = **23.75 seconds per message** (4 bit/s during the data part). This is deliberately slow and cannot be called an instantaneous ACK. Optical reading uses timestamped camera samples and CRC; 24 brightness regions are tried. Real rolling shutter, automatic exposure, torch driver latency, glare and browser throttling are not modelled by the synthetic tests.

## Manual fallback

The receiver also displays `HXR1-` plus 20 hexadecimal characters. Enter this code in the sender's repair field after its current passes finish. Session ID and CRC are checked, then the same queue logic schedules the requested blocks. This fallback is not automatic and does not claim to transmit a code between devices without a user action.

## Validation

Run `node --test hopperlink-pixelstream/tests/core.test.mjs` from repository root. The tests cover metadata, raw/gzip/empty-file integrity, FEC loss recovery, final partial group, exact unique-byte accounting, duplicate rejection, feedback masks/session IDs/CRC, synthetic 30/60 fps pulse decoding, invalid packets, frozen baseline hashes and reset during hash verification.

`tests/browser_smoke.py` loads the real HTTP-served HTML with Playwright Chromium, exercises preparation/transmission, and routes a synthetic canvas camera through the actual HDP tracker and decoder to verify a file. It does **not** test physical phones or hardware LEDs. Safari/iPhone flash reliability remains to be measured.

Reference: W3C MediaStream Image Capture, https://www.w3.org/TR/image-capture/ ; W3C Media Capture and Streams, https://www.w3.org/TR/mediacapture-streams/ .
