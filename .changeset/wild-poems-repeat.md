---
"@objectstack/spec": patch
---

Strip internal issue-tracker ids from the customer-facing text in `packages/spec`

Refusal prose, unknown-key guidance, tombstone prescriptions and `.describe()`
docs no longer carry `#NNNN` references. A customer reading a rejected-metadata
error — or the generated reference docs — has no access to this repo's tracker,
so an id there is a citation-shaped token that resolves to nothing in the one
place the sentence most needs to be actionable.

**FROM → TO, at bucket level** (584 strings across 88 spec sources):

| bucket | strings | FROM | TO |
|---|---:|---|---|
| `strictObject` guidance / history / aliases | 262 | ``Until #4001 closed this shape these were dropped silently`` | ``Until this shape was closed these were dropped silently`` |
| `retiredKey()` tombstones + `*_RETIRED_KEY_GUIDANCE` | 130 | ``removed in @objectstack/spec 17 (#3894) — use `skills`.`` | ``removed in @objectstack/spec 17 — use `skills`.`` |
| `.describe()` docs prose | 187 | ``Parsed but no runtime consumer yet (liveness #1878/#1893).`` | ``Parsed but no runtime consumer yet.`` |
| zod `message:` (hoisted spelling) | 5 | ``a pair that cannot work as written (#9041).`` | ``a pair that cannot work as written.`` |

**Kept, deliberately:** ADR ids, protocol and package versions, error codes, and
the `os migrate meta --from <N>` migration commands. AGENTS.md requires a
tombstone prescription to carry a durable reference, and those are the forms a
customer can actually resolve — the issue id riding beside them was the
strippable half.

No behaviour changes: no schema accepts or rejects anything it did not before,
and no key, default or error `code` moved. This is the wording of messages and
generated docs only.
