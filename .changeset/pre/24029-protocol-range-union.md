---
"@objectstack/metadata-core": patch
---

fix(metadata-core): the protocol handshake reads an `engines.protocol` `||` union, so `'^17.7.0 || ^18.0.0'` loads on protocol 18 instead of being refused as incompatible

Clause-②: no

- **What was wrong.** `rangeAdmitsMajor` had no branch for `||`. A union reached the caret branch and was read as a caret on its first alternative, so `'^17.7.0 || ^18.0.0'` answered `OS_PROTOCOL_INCOMPATIBLE` on protocol 18. Every door that runs the ADR-0087 D1 handshake refused it: `sys_packages` boot rehydration, the marketplace install-local POST and rehydrate, and `protocol.installPackage`.
- **What it does now.** A union admits a major when any alternative admits it. When none does and any alternative is unrecognized (an empty one included, `'^17 ||'`), the union answers `unparsed-range`: the package loads with the existing `[protocol]` warning and is never refused. A union whose every alternative refuses is refused as before. Each alternative is read with the unchanged single-range grammar (caret, tilde, hyphen, comparators, `x`, `*`), so a range without `||` reads exactly as it did.
- **The refusal's `targetMajor`.** For a refused union it is the lowest alternative's major, whatever order the alternatives are written in, so `'^17 || ^16'` and `'^16 || ^17'` both name `objectstack migrate meta --from 16`. It used to read the first alternative.
- **The artifact forward-conversion floor.** `parseRangeFloor` reads a union's floor as its lowest alternative's (`'^18.0.0 || ^17.1.0'` → `17.1.0`, as for `'^17.1.0 || ^18.0.0'`), and `null` when an alternative is unreadable. It used to read the first alternative, so a union written high-first opened a narrower conversion window than the same range written low-first.
