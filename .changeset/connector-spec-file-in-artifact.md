---
'@objectstack/cli': patch
---

fix(cli): `os build` carries the OpenAPI document a `provider: 'openapi'` connector names by package-relative file into the artifact, so the app works once installed into another runtime

Clause-②: no
Metadata-protocol: none

A declarative OpenAPI connector may name its document by file, relative to the directory holding `objectstack.config.ts` (`providerConfig.spec: './openapi/stripe.openapi.json'`). The build used to write that path into `dist/objectstack.json` unchanged and carry no document. The runtime the artifact is installed into (`os package install ./dist/objectstack.json`, or a marketplace install) keeps the artifact JSON and nothing else, so the path resolved against that runtime's own root, named no file, and the connector never came up: the install answered success, and the instance was missing from `GET /api/v1/automation/connectors`.

- **What the build now writes.** For each `provider: 'openapi'` entry whose `providerConfig.spec` is a string that is not an http(s) URL, the file is read and its JSON written in place of the path, as the inline document the provider already accepts. Every other key of `providerConfig`, an inline document, an http(s) URL and every other provider are written as before. The entries of `packages[i].manifest` bodies are read too.
- **What the build now refuses.** A spec path that is absolute, climbs out of the directory holding the config, names no file, or names a file that is not a JSON object fails the build, located at the entry (`connectors[0].providerConfig.spec`) — it would fail the instance after install otherwise.
- **What changes for readers of the artifact.** An artifact built this way carries the document (its size grows by the document's), and `providerConfig.spec` there is an object rather than a path. Whether the document is OpenAPI 3.x is still judged by the provider when the instance materializes.
- **Your fix, if you ship such an app:** rebuild it with this CLI and publish or install the new artifact. Nothing in the source changes.
