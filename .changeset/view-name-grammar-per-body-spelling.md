---
"@objectstack/spec": patch
---

docs(spec): state the `view` name grammar per body spelling in the view module header (#13134)

`ViewMetadataSchema` is a union over three persisted `view` body spellings, and
they do not share one `name` grammar. Nothing said so — the rule was
reconstructible only by reading three schema factories:

| body spelling | `name` is declared as | flat (undotted) name |
|:---|:---|:---|
| standalone ViewItem record | `ViewItemNameSchema` — `QUALIFIED_ITEM_NAME_PATTERN`, dot REQUIRED | rejected, located at `["name"]` |
| flattened runtime overlay | `z.string().optional()` — no grammar | accepted |
| `defineView` container | `z.string().optional()` — no grammar | accepted, and normally IS flat |

Which grammar applies is decided by the body's shape, which an author never
names explicitly, so neither failure direction is discoverable from the key
being written: reading `ViewItemNameSchema` alone suggests the dot is mandatory
everywhere (it is not — a container's own name is the bare object key under
ADR-0017 §3.2's dual-read, and an overlay's name is stamped by the write path),
while reading a flat-named overlay or container row suggests flat is fine
generally (it is not — the same name on a standalone ViewItem record is
refused).

**No schema change.** This is documentation: a family-level JSDoc block on
`ui/view.zod.ts`, three pointer comments at the declaration sites, and the
regenerated reference page. Every accept/reject decision is byte-for-byte what
it was — all three spellings were already internally consistent and the
flat-named rows already parse.

Side effect worth naming for readers of the generated reference: `ui/view.zod.ts`
had no module description, so `content/docs/references/ui/view.mdx` and the two
skill reference indexes opened with the doc comment attached to an unrelated
`HttpRequest` re-export. They now open with the module's own description. The
`HttpRequest` note is unchanged in the source, where it documents that
re-export.
