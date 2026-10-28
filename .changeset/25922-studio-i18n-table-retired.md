---
'@object-ui/i18n': patch
---

docs(i18n): the `studio` namespace is the designer strings' only home

Clause-②: no
Metadata-protocol: none

- **Last slice of the move ruled on objectstack#25922** (6431032267, Q2 = A; kept by 6431234244). `@object-ui/app-shell`'s private designer table, empty since the previous slice, is deleted, and its `t()` / `tOptional()` read `@object-ui/i18n/namespaces/studio` alone. Every string reads the same as before in every language. The README and the namespace's doc comments now say so, and point at `src/__tests__/studio-namespace.test.ts` as the namespace's one parity check, since the paired-table gate `check:i18n-designer-parity` is retired with the table. No export or string changes.
