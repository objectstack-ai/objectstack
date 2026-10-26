---
"@object-ui/collaboration": minor
---

Clause-②: no
Metadata-protocol: none

**Breaking:** removed `LiveCursors` and `LiveCursorsProps`, which nothing rendered (objectui#13453). Declared `minor` per the version-alignment policy (a changeset never declares `major`). `usePresence` still reports each user's cursor, so a host can draw them itself.
