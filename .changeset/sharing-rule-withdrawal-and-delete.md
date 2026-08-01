---
"@objectstack/plugin-sharing": minor
---

fix(plugin-sharing): deactivating or deleting a sharing rule actually withdraws its grants (#4433, #4434)

An over-granting sharing rule had no withdrawal path on the product's API
surface. Deactivating it left every grant it had materialised in place — not on
the next record touch, not after a full restart — and the DELETE route answered
500 for both address forms it advertises, so the rule could not be removed
either. Together that made a too-broad rule unrecoverable short of hand-editing
`sys_record_share`, against a v17 release note that advertises the opposite
("switching a rule off actually withdraws access").

`minor`, not `patch`: this changes an observable runtime behaviour that
deployments may have adapted to. A `source: 'rule'` grant whose rule is
inactive — or whose rule row is gone — now disappears, on the deactivating
write, on the next touch of the record, and on the next boot. Anything relying
on those rows surviving deactivation (including data repaired by hand around
the old behaviour) will see them revoked on upgrade. `DELETE
/api/v1/sharing/rules/:idOrName` also starts succeeding where it used to 500,
so callers that treated that 500 as "unsupported" will now really delete.

#4433 — three independent gaps, one per path the report walked:

- **The deactivating write.** The `sys_sharing_rule` reconcile trigger skipped
  every `isSystem` write, on the theory that those were boot seeding.
  `SharingRuleService.defineRule` — the only implementation behind
  `POST /sharing/rules`, and the documented way to deactivate a rule — writes
  with SYSTEM_CTX unconditionally, because it must reach a platform table the
  sharing middleware otherwise gates. So the skip caught 100% of REST
  authoring: the withdrawal path built by #3821 existed, had tests (against a
  mocked session the real path never sends), and was unreachable in production.
  Now gated on boot phase, which is the question the skip actually meant to
  ask.
- **The record touch.** `evaluateAllForRecord` listed only active rules, so a
  deactivated rule was absent from the loop entirely and its grants were never
  examined. It now reconciles every rule; an inactive one desires nothing and
  takes the existing revoke-the-remainder branch.
- **The boot pass.** `backfillRuleGrants` was handed an `activeOnly` list,
  making it structurally incapable of revoking anything. It now walks every
  rule, and a new `sweepOrphanedRuleGrants` retires grants whose rule row is
  gone entirely — unreachable by rule iteration, so they need their own sweep.

#4434 — `deleteRule` purged `sys_record_share` with a predicate-shaped
`engine.delete` carrying neither a scalar id nor `multi: true`, the one shape
the engine's dispatch refuses; it threw before ever reaching the rule row.
Fixed by routing through the same `SharingService.revoke` path every other
withdrawal already uses, rather than adding `multi: true` — a rule's grants now
retire exactly one way instead of two divergent ones.

The unit fakes are part of the fix: `makeEngine().delete` accepted any `where`,
which is why #4434 shipped green — the pre-existing "deleteRule drops rule and
all its grants" test asserted success against a delete the running server
always rejected. The fakes now mirror the real engine's dispatch guard.
