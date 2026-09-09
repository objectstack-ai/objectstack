---
"@objectstack/runtime": patch
---

The `/ui`, `/meta` and `/mcp` dispatcher domains now reach the `protocol` service through a TYPED handle, so their request literals are compiled against the contracts `packages/spec` already declares. Behaviour is unchanged on every route; what changes is that a misspelt key or a misspelt verb is now a compile error instead of a silent no-op.

`deps.resolveService(context, 'protocol')` answers `any` — `protocol` is deliberately left unmapped in `ServiceSlotContracts`, because a filled slot is NOT a promise that the slot holds a complete `MetadataProtocol`. That `any` is honest about the slot, but it also handed every request literal downstream an unchecked call target: `/ui` sent `getUiView({ object, type })` compiled against nothing at all, even though `getUiView` and `GetUiViewRequest` are both declared; `/meta` reached nine seams the same way, four of them through an explicit `(protocol as any)` cast; and `/mcp` was half-repaired, declaring `McpMergedMetadataRead` for its merged-read seam while the handle feeding it stayed annotated `any`.

The repair is the consumer-side narrowing already proven in `domains/packages.ts`: one handle type per domain, `Pick`ed from the declared contract, resolved through a single one-line helper.

- **Every member stays OPTIONAL, and every runtime capability probe survives.** A host may occupy this slot with a partial object — that is why the `typeof protocol.<verb> === 'function'` probes exist, and each one still asks its own question. The type answers "is this key declared?"; the probe answers "did THIS host bring the verb?". Tightening the members to required would pull the probes' premise out from under them, so the handle types are `Partial<...>` even where the declaration upstream is already optional.
- **Not a `packages/spec` change.** Mapping `'protocol'` in `ServiceSlotContracts` would assert that a filled slot IS a `MetadataProtocol`, whose members are mostly required, and it would have to answer for the verbs no contract declares at all. Nothing in `packages/spec` is touched.
- **The ledger ends honestly.** `listDrafts`, `migrateStoredMetadata` and `getProjectId` have no declared request shape anywhere — `@objectstack/metadata-protocol` types them inline on its implementation class and exports nothing for them — so their request keeps `any` and the gap stays greppable. What the entries still buy is the verb NAME.
- **One guard spelled out.** The `/meta` object read's scoped branch asked `typeof protocol.getMetaItem === 'function'` with no `protocol &&`, while its `!scoped` twin three lines below has always carried one. Behaviour-identical — `scoped` can only be true when the handle is there — and the `any` cast is what let the two siblings drift apart in spelling.

No published type changes: `dist/index.d.ts` and `dist/index.d.cts` are byte-identical before and after, since the dispatcher domains are not re-exported from the package index.
