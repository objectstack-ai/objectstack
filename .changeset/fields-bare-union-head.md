---
'@objectstack/spec': patch
---

fix(spec)!: a refused data-API request no longer lists zod's bare "Invalid input" union entry in `fields[]` ahead of the entries that explain it

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none (no skills/ page names the union's `invalid_shape` / `Invalid input` entry or reads `fields[]` by position)

What narrows: `zodIssuesToFields` (`@objectstack/spec/api`, re-exported by `@objectstack/rest`) no longer emits a union's own `{ code: 'invalid_shape', message: 'Invalid input' }` entry when an entry below it explains the failure, at every depth. Every `400 VALIDATION_FAILED` / `VALIDATION_ERROR` whose `fields[]` comes from it moves: the query door, personal-view config saves, and the other declared-schema ingress doors. `fields[0]` of such a refusal is now the first located cause.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed or renamed, and nothing stored is rewritten: what moves is which entries a refusal's fields list carries, computed afresh on every refused request. The accept set is unchanged. The one reading instruction is in the body: read entries by field and code, never by index. -->

**BREAKING** for a client that reads a refused request's `fields[]` by position, or that looks for an `invalid_shape` entry carrying `Invalid input`. That entry named only the slot the union sat on; the entries that name the key and the constraint were always further down the same list, and they are now first. Read entries by `field` and `code`, not by index.

FROM → TO, for a value refused by a `z.union` slot whose branches explain the failure:

| | Was | Now |
|:--|:--|:--|
| `fields[]` | `{ field: 'u', code: 'invalid_shape', message: 'Invalid input' }`, then `{ field: 'u.a', code: 'required', … }` | `{ field: 'u.a', code: 'required', … }` only |
| a union nested in a union | one `invalid_shape` / `Invalid input` entry per level, then the cause | the cause only |

The fix for a caller that read `fields[0]` expecting the union's slot: find the entry whose `field` equals the slot or starts with the slot and a dot.

**What stays.** A union entry is kept, ahead of what it explains, in every other case:

- nothing below explains it: every branch only says the value is the wrong kind, or the nesting bound was reached. Then it is the whole answer for that slot, and the only entry naming it.
- its message is the schema's own sentence rather than zod's default (a union declared with an `error`). That sentence is a prescription, so dropping it would drop the fix.
- it is a container's entry (`invalid_key`, `invalid_element`): its code is the one place that says a key was refused rather than the value under it.

The comparison is against zod's exact default text, held in one constant beside the mapper and pinned against a real zod parse, so a zod upgrade that rewords the default fails a test instead of quietly bringing every such entry back.

**Now the same as the metadata envelope.** This is the rule a refused metadata save's `issues[]` took in the previous release (`@objectstack/metadata-protocol`), so the two machine-read lists say the same thing about one value; the cross-package parity test pins them entry for entry. The terminal renderer (`formatZodError`, the CLI) still prints the union line as the parent of its indented tree.
