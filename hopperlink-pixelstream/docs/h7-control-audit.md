# HPS7 scanner comparison and H7 Control+ changes

## Evidence, not inferred guarantees

Original reference: `c63815037ccf4d3aaa08bc03b964012b6cc44bcf/hopperlink-pixelstream/hps7.js`:
`helloPayload()` contains 13 bytes; `showHello()` sends it with CONTROL_GRID and 2 bits. DATA modulation is carried inside the HELLO, rather than needed to decode it. The later `binary-tag-bridge-fast.js` recognizes four global patterns TL/TR/BL/BR.

Build 1300 used 12 small mode/lane/corner-coded markers, required at least 3 per lane and encoded the full metadata using the selected DATA palette. These are confirmed design differences, not proof that one particular phone failed solely for that reason. No new raw physical-camera sample was supplied for this revision.

Build 1400 reuses the actual four HPS7 pattern identities with enlarged rendering and one projective mapping, restores independent fixed-gray control, halves control density on both axes and protects fragmented metadata with SECDED plus CRC. It deliberately does not copy the old capture-prototype patching or synthetic marker painting.

## Validation scope

The new deterministic pixel test checks full reconstructed metadata and exact packets, not just marker counts. It also validates the original 16 rotated HPS7 codewords, metadata ordering, damaged control rejection and absence of stale-frame success. Browser validation is separately reproducible using the production HTTP loader and same-origin Web Worker with a Canvas camera fed sender screenshots.

Local browser rendering was also checked using inline loading because local HTTP browser navigation is restricted in the development container. Inline-worker checks alone are not evidence that production worker imports work; the CI browser check is required before publication. Physical camera focus, exposure, lens distortion, motion blur and the acoustic link still require a real-device check.
