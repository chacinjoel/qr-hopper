# HopperLink QR Fountain Lab

Experimental parallel transport used to answer one question: can a deliberately simple screen-camera channel reach the same useful range demonstrated by fast QR/fountain systems before HopperLink invests further in custom colour cells?

This branch does **not** replace Adaptive 2 until physical tests win.

## Design

- Standard QR Code, ECC L, fixed mask 0.
- QR v27/v35/v40 profiles; Turbo uses 2,860 fountain payload bytes plus a 40-byte Hopper header.
- Optional 2-code layout. Each code is an independent rateless fountain equation and carries its own sequence number.
- No optical handshake. A receiver can join at any point in the stream and a new session id resets reconstruction.
- Robust-soliton LT-style fountain distribution. The degree is transmitted in the header; the subset PRNG is integer-only so browser math differences cannot change the selected blocks.
- ZXing-C++ WebAssembly via the independently licensed `zxing-wasm` package, isolated in workers.
- Existing HXS2 file envelope is retained, including optional gzip and final SHA-256 verification.

## Throughput budget

Turbo x2: `2,860 bytes × 60 display updates/s × 2 QR = 343,200 bytes/s` before camera losses and fountain overhead. At a hypothetical 75% QR catch rate and 1.20 received-fountain overhead, the corresponding useful budget is about 214 kB/s. This is not a measured phone result.

## Acceptance test

Use the same incompressible 1 MB and 10 MB files on the same two phones and report:

- camera fps actually obtained;
- processed capture fps and worker completion rate;
- QR packets accepted;
- fountain blocks solved / K;
- elapsed time from first valid packet to SHA-256 OK;
- final useful bytes/s.

Only the physical result decides whether this transport should replace or feed back into Adaptive 2.
