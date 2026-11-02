---
'@objectstack/metadata-protocol': patch
---

refactor(metadata-protocol): one `ObjectStackProtocolImplementation` member body moves out of `protocol.ts` through a host object, the shape the rest of the class follows

Clause-②: no
Metadata-protocol: none

No behaviour change. `tenantAuthoredWriteRefusal` keeps its docblock and signature on the class; its body now lives in `protocol-tenant-authored-write.ts`, reached through `protocol-host.ts`, a per-instance object that forwards to the class's own members (built in the class's static block, so the class gains no member). The moved body differs from the method body only by `this.` reading `host.`. The published `index.d.ts` (ESM and CJS) is byte-identical to the one `main` builds before this change. Nothing to migrate.
