---
'@objectstack/spec': patch
---

docs(spec): `SpecialOperator` gains the `.describe()` that puts `$null` / `$exists` on the reference page (#14048)

`SpecialOperatorSchema` declared both members as bare `z.boolean().optional()` with a
JSDoc comment and no `.describe()`. `content/docs/references/data/filter.mdx` fills its
Description column from `prop.description` — the JSON-Schema projection of a Zod
`.describe()` — so both cells rendered **empty**, and the published reference page said
nothing whatsoever about the two operators whose meaning was the subject of a six-site
correction campaign (#13539, #13709). A reader could not learn from that page that
`$exists` asks whether the field HAS A VALUE.

Each member now carries a `.describe()`; the JSDoc stays as the source of truth it
already was and the describe restates it. The regenerated page gains exactly two
Description cells (`filter.mdx:138-139`) and nothing else.

Prose only. No accept/reject or shape change: both members were and stay
`z.boolean().optional()`, so the only JSON-Schema delta is a `description` string on two
properties. Verified on a freshly built `dist`: `check:generated` reported
`content/docs/references/**` as the single stale artifact and `--fix` regenerated only
`filter.mdx`; `check:api-surface`, `check:export-origins` and `check:authorable-surface`
stayed green with no new export.

The wording was written against `scripts/check-corpus-claim-drift.mjs` rather than into
it: that shrink-only ratchet watches `content/docs/**` for `$exists` prose, its
`exists-key-presence` row reads `exists-key-presence 4` both before this diff and after
the page was regenerated, so the new prose adds zero claim sites.
