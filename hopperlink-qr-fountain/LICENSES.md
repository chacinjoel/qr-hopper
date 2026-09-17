# Third-party components

HopperLink QR Fountain Lab is an independently implemented experiment and does not copy Decimen Optical Transfer source code.

It vendors `zxing-wasm` 3.1.4 for QR reading/writing. The package identifies its own code as MIT, ZXing-C++ as Apache-2.0, and Zint as BSD-3-Clause. The vendoring workflow preserves package license files when present and records SHA-256 hashes of the exact vendored assets.

The experiment reuses HopperLink's existing HXS2 envelope from this repository.
