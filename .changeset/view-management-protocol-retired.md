---
"@objectstack/spec": major
"@objectstack/client": major
---

refactor(spec,client)!: retire `ViewProtocol`'s five viewId-addressed methods and their ten schemas (#6239)

`listViews`, `getView`, `createView`, `updateView` and `deleteView` — the
`ViewProtocol` interface and `ListViews`/`GetView`/`CreateView`/`UpdateView`/`DeleteView`
Request+Response schemas in `api/protocol.zod.ts` — are REMOVED under ADR-0049
enforce-or-remove (maintainer ruling 2026-08-07). `@objectstack/client` drops the
five response types it re-exported.

Measured on `origin/main` immediately before the removal, the surface had none of
the three things a protocol method needs:

- **no implementation** — `packages/metadata-protocol/src/protocol.ts` declares no
  `listViews`/`getView`/`createView`/`updateView`/`deleteView`; its only view
  resolver is `getUiView`;
- **no route** — `packages/rest/src/rest-server.ts` never mentions `viewId`, so
  nothing viewId-addressed was reachable over HTTP at all;
- **no caller** — the only `ViewProtocol` mention outside its own file was
  `content/docs/kernel/services-checklist.mdx`, which already recorded the five as
  declared-and-unrouted.

FROM → TO — both replacements are surfaces that were always the live ones:

| removed | use instead |
|---|---|
| `listViews` / `getView` / `createView` / `updateView` / `deleteView` (+ their 10 schemas) | the generic metadata methods with `type: 'view'` — `getMetaItem` / `getMetaItems` / `saveMetaItem` / `deleteMetaItem`, served at `/api/v1/meta/view/:name` |
| `GetViewResponse` as "the shape of the resolved view" | `GetUiViewResponse` — `getUiView`, served at `GET /api/v1/ui/view/:object/:type` |

**The fix:** delete the import and address views by NAME through the metadata API
(`view` is a metadata type), or by object+type through `getUiView`. Nothing
addressed a view by `viewId` before this change either; that is the finding.

**Why a removal rather than a note.** The declared surface is name-identical and
semantics-adjacent to a real one, which makes it an attractive nuisance in every
grep — and it has already mis-directed a decision: **#5948's issue body AND its
2026-08-07 maintainer ruling both read `GetViewResponseSchema` (zero
implementations) as the contract of `GET /ui/view/:object/:type`**, whose declared
response is `GetUiViewResponseSchema`, 250 lines up and one word different. That
ruling's reasoning happened to survive the mix-up; this removal stops relying on
that luck.

The retirement kit — route 3: **no tombstone and no D2 conversion** (none of the ten
was a key on an authorable shape, and nothing parsed them, so there is no source or
`sys_metadata` row to rewrite). `RETIRED_DEFS_BY_MAJOR[17]` (10 defs) plus the D3
`SemanticMigration` `view-management-protocol-retired` are the declaration; the
generated baselines and reference docs lose their entries in the same change.

If "read and write ONE view by id" becomes a real requirement, it returns
implementation-first.

<!-- adr-0087: registered view-management-protocol-retired -->
