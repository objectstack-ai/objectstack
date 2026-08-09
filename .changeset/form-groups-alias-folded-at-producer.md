---
"@objectstack/spec": minor
---

fix(spec): `form.groups` is folded onto `form.sections` at the producer — the declared alias is now true for every consumer (#6926)

`FormViewSchema` has declared `groups` with the inline comment *"Legacy support
-> alias to sections"* for as long as it has existed, and nothing in this repo
performed the fold. The alias was honored exactly **one boundary downstream**,
inside the renderer (ObjectUI's `spec-bridge` reads `spec.sections ??
spec.groups`, and `plugin-form/ObjectForm` carries a full legacy fold — shipped
because a `groups`-only spec once rendered nothing at all). Every framework
consumer that is not that renderer read `sections` only.

So one authored form behaved two ways. A `groups`-authored **public** form
rendered correctly in the console and degraded on all three REST public-form
routes at once, because each of them walks `sections`:

- `GET /forms/:slug` published an empty field schema,
- `POST /forms/:slug/submit` computed an empty `allowedFields` whitelist,
- `GET /forms/:slug/lookup/:field` answered `403 LOOKUP_NOT_PUBLIC` for every
  field.

The fix is at the producer, not in the consumers: `FormViewSchema` now folds
`groups` onto `sections` at parse, so every consumer of a parsed form sees one
key. Teaching each consumer a second key to read was the other option and was
rejected — a lenient consumer is where authored (especially AI-authored)
metadata errors hide, and it leaves the next consumer blind.

**What changes.** Only the parsed OUTPUT of a form view:

| Authored | Parsed before | Parsed now |
| --- | --- | --- |
| `groups: [...]` | `groups: [...]`, no `sections` | `sections: [...]`, no `groups` |
| both keys | both, verbatim | `sections` (the authored one), no `groups` |
| `sections: [...]` | unchanged | unchanged |

`sections` wins when both are present — deliberately the renderer's own
`sections ?? groups` rule, so nothing that renders today renders differently.
`??` treats an empty array as present, and so does the fold.

**What does not change.** The acceptance face: `groups` is still a legal
authoring key, still validated as `FormSection[]`, and a misplaced `pane` inside
it is still reported at `groups.0.pane` — the path the author actually wrote.
Consumers that read metadata *before* it is parsed are unaffected and still read
both keys, which is correct for them: `os lint`'s view rules walk authored
sources, and a `sys_metadata` row is persisted verbatim and re-read through the
ADR-0087 stored-row conversion chain rather than through a Zod parse. The fold
narrows output; it never narrows what is accepted.

The fold is declared once and inherited by every parse door — `FormViewSchema`
itself, `ViewSchema.form` and `.formViews.*`, both `ViewItemSchema` form arms,
and `ViewMetadataSchema`'s container and flattened form-overlay members.

If you read `.groups` off a **parsed** form view, read `.sections` instead; it
now carries what `groups` used to.
