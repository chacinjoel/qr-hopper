# Adaptive 2.0.1 — receiver acquisition hotfix

This fix preserves Lighthouse markers, payload layout, the throughput profile catalogue, sector recovery, FEC and the transmission schedules. Both phones should reload the version labelled RX FIX 1.

## Reproduced regressions

1. The coarse Lighthouse detector accepts hue contrast above 72, but Adaptive 2's fine refinement rejected every pixel at contrast <=90 and returned null for the complete quadrilateral. A synthetic screen transformed by RGB * 0.35 + 60 reproduces this: the stable acquisition detects all four markers, then the new refinement discards all four. Fine and coarse detection now share the acceptance threshold, and a failed refinement can fall back to globally validated centres, never to unvalidated payload bytes.
2. Missing the single initial HELLO left CalibrationReceiver.sid at zero. Every later control was ignored. A CRC- and catalogue-validated AUDIO or TRIAL can now acquire a session after the first announcement. An unrelated OFFER cannot claim a new session, and the application still protects a partially received file against a foreign session.
3. A missed TRIAL profile announcement could leave the header decoder permanently restricted to the old profile. After failed headers it now searches the catalogue again; CRC is still mandatory.

## Recovery and observability

- Global acquisition uses the same coarse-resolution budget as the working Lighthouse path. Local tracking is preferred only while packets are being read, and cannot prevent global reacquisition indefinitely.
- New reception clears geometry and profile hints as well as partial optical sectors.
- Video callback delivery has a watchdog using only new real video timestamps; stopped/blank video is not treated as a lock.
- The receiver shows captures, decoded headers, valid CRC packets and acquisition state. Catalogue mismatch is reported as different versions rather than silently appearing as no detection.
- Adaptive ES modules and the audio-worklet URL are pinned to the same release token. The unchanged original core modules retain their existing hash-regression tests.

## Validation scope

The regression suite includes low-chroma acquisition, joining after HELLO, missed profile announcements, loss/reacquisition of screen, foreign catalogue reporting and video callback fallback. A portrait-browser test feeds a scaled/rotated scene through a real video element, and the full paired-browser test still requires actual decoding, SHA-256 and acoustic COMPLETE. These are synthetic-channel software tests, not proof of performance in the user's physical phones.
