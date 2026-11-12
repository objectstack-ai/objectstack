---
'@objectstack/metadata-protocol': patch
---

refactor(metadata-protocol): `applySeedBodies` builds its seed host on the class's per-instance host

Clause-②: no
Metadata-protocol: none

- The body of `ObjectStackProtocolImplementation#applySeedBodies` (the host it hands the seed apply, with the slot that reads the `field-files` service from the kernel's registry) moves unedited out of `protocol.ts` into `protocol-publish-batch.ts` as `applySeedBodiesOnHost`, which runs on the class's host (`protocol-host.ts`). The method keeps its signature and docblock and is now one forwarding call, so the facade gate no longer needs an exception row for it.
- No behaviour changes and nothing to do on upgrade: a published seed's files are still stored through the `field-files` service, as the boot seed's are. The built declaration files are unchanged; the source maps move.
