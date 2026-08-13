---
"@objectstack/plugin-sharing": patch
"@objectstack/rest": patch
---

fix(plugin-sharing): the ADR-0111 D7 inert-grant guard runs for SYSTEM callers too, so the sharing-rule evaluator can no longer materialise rows no gate consults (#8207)

`SharingService.grant` skipped **both** of its pre-flights for a system context,
in one block, under one justification: *"System callers bypass: the rule
evaluator materialises through here under its own validation."* The two halves
ask different questions, and only one of them may vary by caller.

- **D1, `assertCanManageShares` — an AUTHORIZATION check.** "May this principal
  manage shares on this record?" A sharing rule is not a principal and has no
  ownership to prove, so the system skip is correct and is unchanged.
- **D7, the inertness guard — not an authorization check.** "Would any gate ever
  read a row on this object?" The gates that would consult the row
  (`buildReadFilter`, `checkEdit`, `checkDelete`) never see the granter, so the
  answer cannot depend on who asks. Exempting the system context made the guard
  answer a question it was not asked.

**The "own validation" the old comment credited the evaluator with is not
there.** Measured, one rule per class, `defineRule` then `evaluateRule`, both
under a system context: a rule against a `public_read_write` object, an
owner-less object, a `controlled_by_parent` detail, a federated phantom-anchor
object, or a bypass object was accepted and materialised a real
`sys_record_share` row — five for five. `defineRule` never reads the object's
schema, and reconcile hands `grant` whatever `object_name` the rule row carries.
So an authored sharing rule pointed at any of those objects minted rows that
looked granted and enforced nothing, which is the ADR-0078 silently-inert trap
arriving through the one door the guard did not watch.

The inertness verdict is now computed caller-free and refused for **every**
caller. Refusing costs no live access on either path: the row it declines to
write could never have granted any.

**What deliberately did NOT move.** The existence check stays non-system-only. An
unresolvable object name is a NOT_FOUND (REST: 404) for a caller who typed it,
but for the evaluator it is a stored `object_name` meeting an engine that may not
have that schema registered at this instant — and absence of a schema is absence
of *evidence* of inertness, not evidence of it. Hard-failing a reconcile pass on
that would refuse a write nobody showed to be inert. An engine with no
`getSchema` at all keeps its existing "it cannot know" skip.

**Operator-visible effects.** A sharing rule pointed at an object no gate
consults now fails loudly instead of quietly writing nothing usable. Every system
caller of `grant` is the rule evaluator's reconcile, and each of its entry points
already treats a per-rule failure as best-effort: the boot rule backfill, the
object-wide re-grant and the business-unit re-grant queue log the refusal (naming
the rule and the reason) and carry on, and the write hooks catch it, so a user's
insert or update is never failed by it. `POST /api/v1/sharing/rules/:idOrName/evaluate`
now answers **422 `SHARING_NOT_ENABLED`**, naming the object and the reason,
instead of burying the diagnosis in a 500 — the same code-to-status pair the
per-record shares routes already publish. Withdrawal is untouched, so rows minted
by an earlier build stay purgeable through `deleteRule` and through evaluating a
deactivated rule.
