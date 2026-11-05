---
'@objectstack/runtime': patch
---

fix(runtime): the empty kernel's own stub declares its protocol range, so `os start` in an empty directory boots with no compatibility warning

Clause-②: no — boot diagnostics only; nothing accepted or published changes
Metadata-protocol: none

The empty-boot stub `createDefaultHostConfig({ requireArtifact: false })` writes to `~/.objectstack/dist/objectstack.json` (manifest id `com.objectstack.empty`) now declares `engines: { protocol: '^<major>' }`, the major of the runtime that writes it. Before, it declared no range, so the ADR-0087 handshake warned "package 'com.objectstack.empty' declares no engines.protocol range" on the first boot of the docs' one-line Community quickstart (`npm i -g @objectstack/cli && os start`), about a package the user never wrote. A stub already on disk from an older CLI is refreshed in place on the next empty boot: only `manifest.engines.protocol` is rewritten, and only while the file is still the stub. The same refresh re-stamps a stub written under another protocol major, which would otherwise be refused as `OS_PROTOCOL_INCOMPATIBLE` once the runtime moves to the next major. An artifact that is not the stub, or a file that is not JSON, is left alone.
