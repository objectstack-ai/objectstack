---
'@objectstack/metadata-core': patch
---

fix(metadata-core): an exclusive protocol comparator (`'>18'`, `'<18'`) names the major it admits in the `OS_PROTOCOL_INCOMPATIBLE` refusal

Clause-②: no
Metadata-protocol: none

The refusal for a package whose `engines.protocol` excludes this runtime names a target major (`targetMajor` in the diagnostic and in `error.details`) and, for a package behind the runtime, `objectstack migrate meta --from N`. It used to find the target by peeling every leading operator off the range as if it were `^`, so on a protocol-18 runtime both `'>18'` (19 and up) and `'<18'` (17 and below) answered `migrate meta --from 18`, a migration from the runtime's own major.

Now the target is read from the majors the range admits, with the same grammar that decides whether it admits the runtime:

- **`'>18'` on an 18 runtime** targets 19. The package is ahead, so the answer is the upgrade remedy from the previous release: "Upgrade the runtime to protocol 19", and no `migrateCommand`. On a 17 runtime it now names protocol 19 too, where it used to name 18, which `'>18'` does not admit.
- **`'<18'` and `'<18.0.0'`** target 17: `migrate meta --from 17`.
- **A compound range** targets its floor in either order: `'<18 >=15'` targets 15 (it named 18), and `'>15 <18'` targets 16 (it named 15).
- **A `||` union** still targets its lowest alternative, now read the same way: `'<17 || >19'` targets 16.
- **A range that admits no major** (`'>=19 <15'`, `'<0'`) has `targetMajor: null` and the bare `objectstack migrate meta`.

`^`, `~`, `>=`, `<=`, wildcards, exact versions, hyphen ranges and partial bounds (`'>18.1'`, `'<18.5'`) answer as before. No range changes between admitted and refused: only the refusal's target and prescription change.

Two CLI readers of `targetMajor` follow: `objectstack migrate meta` now rewrites a `'<N'` range to `'^N'` when it migrates a stack to protocol N (it used to leave it for the load to refuse), and the protocol-version advisory now speaks for such a range.
