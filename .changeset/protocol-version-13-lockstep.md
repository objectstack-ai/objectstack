---
'@objectstack/spec': patch
---

fix(spec): bump PROTOCOL_VERSION 12.0.0 → 13.0.0 to match the spec major

The version-packages roll (#2720) took `@objectstack/spec` to major `13.0.0`
but left `PROTOCOL_VERSION` at `12.0.0`, so `protocol-version.test.ts` (the
lockstep guard that asserts the protocol major equals the package major) failed
on `main` — reddening Test Core for every PR. Restore the lockstep so the
loader/installer handshake advertises the major the package actually ships.
