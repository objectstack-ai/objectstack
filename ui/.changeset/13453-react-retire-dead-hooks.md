---
"@object-ui/react": minor
---

Clause-②: no
Metadata-protocol: none

**Breaking:** removed four hooks with no reader (objectui#13453): `useFocusTrap`, `useFocusReturn` and `useRovingFocus` (from `useFocusManagement`), `usePageTransition`, and `useSchemaPersistence` with `createLocalStorageAdapter`, plus their option and result types. Declared `minor` per the version-alignment policy (a changeset never declares `major`). No replacement inside ObjectUI; a host that used one should keep its own copy.
