---
"@objectstack/spec": major
"@objectstack/example-showcase": patch
---

refactor(spec)!: remove the RLS-policy `priority` key — it promised conflict resolution that cannot exist (#3896 audit)

`RowLevelSecurityPolicySchema.priority` was documented as *"Policy priority for
conflict resolution"*. The 2026-07-30 security-subset liveness re-verification
found that **nothing ever read it** — and, stronger, that nothing ever could:
applicable policies **OR-combine** (any match allows access, most permissive
wins — the schema's own describe said so), so there is never a conflict to
order and evaluation order cannot change an outcome. A semantically-void knob
on a security policy is worse than dead: an author — very often an AI
(ADR-0033) — reads it as a precedence lever and reasons about policy
interactions that do not exist.

Removed per the `tool.requiresConfirmation` (#3715) / `DynamicLoadingConfig`
(#3950) precedent, inside the v17 breaking window:

- **Tombstoned, not silently stripped** (`retiredKey`, #3855 pattern): an
  authored `priority` fails `tsc` (the input type is `never`) and rejects at
  parse with the prescription itself — *"policies OR-combine (most permissive
  wins), so there is no conflict to order. Delete the key — policy outcomes are
  unchanged."*
- **ADR-0087 D2 conversion + D3 chain step** (`permission-rls-priority-removed`):
  `os migrate meta` deletes the key from authored sources mechanically — a pure
  lossless delete, no semantic residue. spec-changes.json and the protocol
  upgrade guide carry the entry.
- The policy factory helpers (`ownerPolicy`, `tenantPolicy`, …), the showcase
  example's permission sets, and `content/docs/permissions/rls.mdx` no longer
  author it; the docs table's `enabled` row now states the (since-enforced)
  contract instead.
- Liveness ledger entry updated to record the removal; the tombstone and entry
  age out ~two majors from now.

Dropping the key changes **no policy outcome anywhere** — that impossibility of
effect is the entire reason for the removal.
