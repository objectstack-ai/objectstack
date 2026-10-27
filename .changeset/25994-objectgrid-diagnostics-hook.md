---
'@object-ui/plugin-grid': patch
---

refactor(plugin-grid): `ObjectGrid`'s authored-input diagnostics move into a sibling hook

Clause-②: no
Metadata-protocol: none

The three `console.warn` effects that report an unreadable `columns` entry, an unusable `bulkActionDefs` member and a non-positive page size move verbatim out of `ObjectGrid.tsx` into `useObjectGridDiagnostics` (`objectGridDiagnostics.ts`). `ObjectGrid` calls the hook where the effects stood, so its hook order, its warnings and its rendered output do not change. No name is renamed, and the package entry is unchanged.

What to do: nothing.
