---
"@object-ui/create-plugin": minor
---

Clause-②: no
Metadata-protocol: none

**Breaking:** a generated plugin's `package.json` now declares `react` and `react-dom` peers as `^19.0.0` (was `^18.0.0 || ^19.0.0`), matching the React 19-only peer range every `@object-ui/*` package now declares. Plugins already generated are unchanged; their authors may narrow the range the same way. Declared `minor` per the version-alignment policy (objectui#13465).
