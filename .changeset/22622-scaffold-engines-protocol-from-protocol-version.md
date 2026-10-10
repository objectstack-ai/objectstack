---
"create-objectstack": patch
---

fix(create-objectstack): the blank template's `engines.protocol` is stamped from the protocol major, not the package major

Clause-②: no

`engines.protocol` in the scaffolded `objectstack.config.ts` is the range the runtime's protocol handshake checks before it loads the project.

- The release stamp (`scripts/sync-template-versions.mjs`) used to write it from create-objectstack's own major. It now writes the major of `PROTOCOL_VERSION`, the value the handshake compares against. The two differ while the protocol moves ahead of a release: in that window the unreleased template declared `'^17'` beside a protocol-18 runtime, which refused to load the project it scaffolded.
- The template now declares `'^18'`, written by that stamp rather than by hand.
- Unchanged: `specVersion` and the `@objectstack/*` dependency ranges still carry the package range.
- No released version shipped the mismatch. A project you scaffolded earlier keeps its own range; to move it to protocol 18, run `objectstack migrate meta --from 17 --write`, which rewrites `engines.protocol` with the rest of the step.
