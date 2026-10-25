---
"@object-ui/react-runtime": minor
---

Clause-②: no
Metadata-protocol: none

**Breaking:** React 18 is no longer a supported host. `peerDependencies.react` now reads `^19.0.0` (was `^18.0.0 || ^19.0.0`). Nothing in this repository ever installed or tested React 18, so the old range was a promise without a test behind it; a React 18 host now gets a peer-dependency warning or refusal at install time instead of an untested runtime. Declared `minor` per the version-alignment policy (a changeset never declares `major`). Upgrade the host to React 19 (objectui#13465).
