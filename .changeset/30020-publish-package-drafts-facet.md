---
'@objectstack/metadata-protocol': patch
---

refactor(metadata-protocol): the `publishPackageDrafts` body moves into its facet

Clause-②: no
Metadata-protocol: none

- The body of `ObjectStackProtocolImplementation#publishPackageDrafts` moves out of `protocol.ts` into `ProtocolHistoryAndPublishFacet` (`protocol-history-and-publish.ts`), the facet of its section. The method stays on the class as a one-call stub with its signature and its docblock. It runs on the class's host, and where the body handed the protocol instance itself on (the build-probe metadata read), it reads the same instance through the host's new `facade` entry.
- No behaviour changes and nothing to do on upgrade: the same statements run in the same order. The built declaration files are unchanged; the source maps move.
