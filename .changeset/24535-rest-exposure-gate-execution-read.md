---
'@objectstack/rest': minor
---

perf(rest): `GET /api/v1/data/OBJECT` no longer computes the object's metadata diagnostics; the API-exposure gate reads the protocol's execution face

Clause-②: yes (widening): the exported `RestProtocol` type gains one optional member, `getMetaItemForExecution?`. Measured on the built `dist/index.d.ts` before and after: the export list is unchanged (81 names), and every other member signature is byte-identical. The member is optional, so nothing a protocol must provide changes.

- **What.** The API-exposure gate on the `/data` doors (`enforceApiAccess`) reads the object it judges through `getMetaItemForExecution` when the protocol has it, and through `getMetaItem` otherwise. Both are the by-name read with the same sources, overlay cache and governance. The execution face skips the serving decorations, so a `/data` request computes no `_diagnostics` (a full schema `safeParse` of the object's definition) to read one `enable` block. On a fixture object with 60 fields, a warm by-name read took about 1.0 ms on the served face and about 32 µs on the execution face; this was measured on a shared box, and the ratio is about 0.03.
- **Unchanged.** Every `/data` answer: the same `404`/`405` verdicts and `allowed` set, a thrown read still fails open and logs, and an object of a disabled package still gets the data plane's `404 OBJECT_PACKAGE_DISABLED`. `GET /api/v1/meta/object/NAME` still serves `_diagnostics`.
