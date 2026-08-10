---
"@objectstack/plugin-security": minor
---

fix(plugin-security): the row-level write gate honours `modifyAllRecords` and `edit`-level record shares (#5492)

HotCRM's 17.0 GA acceptance sweep measured two declared write-widening
mechanisms as completely inert. A manager profile carrying `viewAllRecords` +
`modifyAllRecords` got `403 … (row-level security)` on **every** cross-owner
write — update and delete, four objects — while its reads widened exactly as
declared (43/43, 9/9). And all three `edit`-level sharing rules materialised
into `sys_record_share` correctly and widened reads exactly, yet a `PATCH` by
the share target was refused every time. Read-level shares correctly denied
writes, so the machinery distinguished the levels on paper and the write gate
then ignored the distinction.

**One root cause.** Row-level write access was two authorities AND-ed together
with no knowledge of each other. `ISharingService` reads all three declared
wideners (ownership at write DEPTH, `sys_record_share.access_level`, the
`modifyAllRecords` bypass); the security plugin's by-id write pre-image gate
read only RLS — and sitting inside that RLS is the platform's own ownership
floor, `owner_only_writes` / `owner_only_deletes` (`created_by ==
current_user.id`, applicability `positions: ['org_member']`). That floor is a
second implementation of "ownership", and it is the one blind to every widener.
Every member resolves it additively from the `member_default` baseline — a
manager is an org member too — so the widener-blind copy always won.

**The fix is composition by provenance, not a new bypass.** The pre-image gate
now asks the authority that owns those mechanisms for its tri-state verdict
(`ISharingService.checkEdit` / `checkDelete`, the contract added in #6428):

- `allow` — a positive basis exists, so the declared authority **replaces** the
  platform floor;
- `abstain` — record sharing does not enforce on this row at all (a `public`
  object, an object with no owner field, a platform internal), so the floor
  **stays**: it is the only row-level write gate such rows have;
- `deny` — the floor stays; the refusal belongs to the sharing middleware that
  produced the verdict.

The action boundary is inherited rather than restated (ADR-0111 D3): update asks
`checkEdit`, delete asks `checkDelete`, so an `edit` share widens update and
still does not confer delete. `modifyAllRecords` covers both verbs
(`MODIFY_ALL_WRITE_KEYS`).

**What is deliberately unchanged.** Layer 0's tenant wall and every
**app-authored** RLS policy are untouched — only the policies the platform
itself ships are replaceable, matched by the same `(object, name, using)`
provenance key ADR-0105 D3 uses for tenant policies, so an app policy spelling
the identical predicate keeps refusing (ADR-0049: a declared security property
stays declared). This is therefore not `modifyAllRecords` bypassing write-side
RLS on an ordinary business posture, which ADR-0066 ① withholds and this change
leaves withheld; it is the platform's floor deferring to the platform's own
ownership authority. The on-behalf-of (ADR-0090 D10) path keeps both principals'
floors, matching `hasWriteBypass`, which already fails closed for a delegated
context. A deployment without `@objectstack/plugin-sharing` sees no change at
all: with nothing to consult, the gate abstains and the floor decides.

Net effect for deployments: a Modify All Data holder can now correct, reassign
and clean up records they did not create, and an `edit`-share recipient can
finally edit the record shared with them. Nothing that was refused for lack of a
grant becomes permitted — read-share targets are still denied writes, `edit`
shares still cannot delete, and a member with neither is still refused.
