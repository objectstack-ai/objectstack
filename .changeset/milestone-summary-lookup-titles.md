---
"@objectstack/plugin-audit": patch
---

fix(plugin-audit): `activityMilestones` summary tokens render referenced record titles, not raw ids (#7290)

ADR-0052 §5b.2 lets an object declare a semantic milestone whose summary
interpolates `{token}`s from the record — `{ field: 'stage', value:
'closed_won', summary: 'Deal won by {owner}' }`. A token naming a `lookup` /
`master_detail` / `user` field was interpolated with no title map, so it fell
through to the raw stored id and the record timeline read `Deal won by oBK25…`.

The milestone branch takes **precedence** over the tracked-change branch, so on
every object that declares `activityMilestones` this was the string users saw,
and #7230's fix to the tracked-change branch never reached them.

A reference token now renders the referenced record's title, resolved through
ADR-0079's `resolveDisplayField`. The author's template wording is untouched —
only what a token resolves to changes — and the change is restore-invariant: an
id with no resolvable title (target removed out of band, unregistered object,
failing read) renders exactly as it did before. The empty-token rule is
unchanged too: an empty value still renders as the empty string, not `∅`.

**Read cost.** `matchMilestone` was split into detection and rendering so the
read plan is built from the tokens of the template that actually **fired**, and
only then. Measured with a copy-returning counting driver: every create, every
delete, every update of a milestone-declaring object that fires no milestone,
and every fired milestone whose template names no reference token all add
**zero** reads; a fired milestone with reference tokens costs **one read per
distinct target object** (two tokens onto the same object are one batched
`id: { $in: [...] }`), paid only on the transition itself. The alternative
placement — resolving before knowing whether a milestone fired — was measured at
**3 reads on a write that fires nothing**, and was rejected: it is the shape
#6656's Option A+ ruling was obtained to remove from this write path.

A target object that designates a credential field as its title is **not read
at all** — the same `collectMaskedReadFields` predicate the ledger masks with,
so no secret can reach a user-facing summary through this path.
