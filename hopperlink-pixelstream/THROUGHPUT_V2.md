# HopperLink Adaptive 2 — Throughput experiment

Adaptive 2 is the next throughput-oriented layer on top of the working Adaptive 1 negotiation flow. It keeps Lighthouse acquisition, HXS2, SHA-256 verification, acoustic COMPLETE/STATUS and QR fallback.

## What changed

- Throughput candidates in the full calibration now include:
  - 16 colours · 112×176 · 30 symbols/s · RS 12+2.
  - 8 colours · 128×200 · 30 symbols/s · RS 12+2.
  - 16 colours · 128×200 · 30 symbols/s · RS 14+2.
- Their calculated payload budgets are about 200.6, 207.1 and 276.5 kB/s before real camera losses, retransmission and pauses. These are capacity budgets, not measured phone-to-phone throughput.
- Dense frames are split into eight independently protected spatial sectors. Each sector carries CRC16; the original optical block still carries CRC32 and the file still finishes with SHA-256.
- Repeated presentations rotate logical sectors across physical regions. A glare or motion-damaged region therefore does not have to destroy the same bytes on every opportunity. The receiver accumulates valid sectors until the original block CRC32 matches.
- FEC is now useful on the first pass: the first schedule contains every systematic block once plus Reed-Solomon parity. The second, third and fourth systematic opportunities are progressive protection and can be cancelled as soon as the verified COMPLETE response reaches the sender.
- The tracker uses local Lighthouse refinement between periodic global searches, and once negotiation indicates the expected optical profile it avoids brute-forcing the complete catalogue on every camera frame.

## Why this matters

The previous four-opportunity carousel was intentionally conservative. Its full-plan average could be much lower than the optical payload budget because four complete copies were scheduled before the sender knew whether they were needed. Adaptive 2 keeps the four opportunities as a ceiling rather than treating all four as mandatory work.

Sector recovery addresses another source of waste: a small damaged portion of a dense frame no longer has to invalidate every byte in that frame. A block is emitted to the file assembler only after all sectors have been recovered and its original CRC32 validates.

## Acceptance criteria

The target is not a theoretical FPS number. The experiment is successful only when physical phones repeatedly reach useful verified throughput near 150–200 kB/s for incompressible files while preserving reliability and acceptable setup time.

Measure at least:

- time from DATA begin to SHA-256 OK;
- current and average unique useful bytes/s;
- selected profile;
- processed camera frames/s;
- valid blocks, CRC failures and recovered FEC blocks;
- valid/failed sectors and sector assemblies;
- local-tracking vs global-search counts;
- number of systematic opportunities actually consumed before COMPLETE.

Synthetic browser tests validate software behaviour, not real camera/display performance. Physical measurements remain the deciding evidence.
