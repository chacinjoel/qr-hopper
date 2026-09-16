# RX FIX 2 — distinguish area acquisition from incoming data

The supplied screenshot contains four idle Lighthouse rings and the sender label `Aún sin emitir`. Replaying its camera crop through the production detector locates all four markers. The screenshot alone does not establish why the user's live preview showed no overlay; it does not contain a calibration packet.

## Corrections

- Fine tracking first uses the existing white centre spot. Idle markers have an 18-cell ring while active markers have a 10-cell ring. An intensity centroid computed from a narrow slice of the large ring can shift the estimated centre. In the supplied screenshot the previous refinement shifted a cyan centre roughly 18 pixels; centre-spot refinement removes that ring bias. Colour segmentation remains the coarse finder and CRC remains the gate for data.
- Frame callbacks use `presentedFrames` where available, not only `mediaTime`. A test with a fixed reported media time but advancing presented frames used to suppress new processing. The watchdog monitors successful processing rather than callback invocation and reports stalled input without claiming a valid lock.
- The acquisition message and counters now appear BEFORE the camera preview. They distinguish waiting for calibration, reading valid packets and stalled video. Four idle markers never create a session or advance download progress.
- Adaptive imports use the same `rxfix2` token. Both devices must reload.

The optical renderer, catalogue geometry/palettes, sector wire format, FEC, compressed envelope and transmission queues are unchanged. The protocol module changes only import version tokens and the display build label.

## Evidence scope

The user's screenshot was replayed locally through a real Chromium video element; four beacons were localized, no data headers were invented, and the UI showed `Área detectada · esperando Calibrar enlace en el emisor`. The image is not published in this public repository. Further synthetic browser regressions exercise idle acquisition, occlusion, frame-counter fallback, calibration and verified transfer. These checks are not a new physical-phone measurement and do not guarantee that every cause of the user's live issue is eliminated.
