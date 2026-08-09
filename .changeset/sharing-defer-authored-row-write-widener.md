---
"@objectstack/plugin-sharing": patch
---

fix(sharing): the by-id write gate defers to an app-authored RLS widener instead of hard-refusing (#5493)

HotCRM's 17.0 GA acceptance sweep declared two RLS update-wideners on one
profile and measured one of them working. On the junction object
`crm_campaign_member` a non-owner PATCH returned 200; on `crm_campaign` the
identical shape returned 403 `FORBIDDEN: insufficient privileges to update
crm_campaign`. That sentence is the sharing middleware's, not the row gate's
`(row-level security)` — so the refusal landed **before** RLS was consulted and
the declared widener was never asked.

The discriminator was never "carries sharing rules". It is whether **record
sharing enforces on the object at all**: `checkEdit` abstains — and `canEdit`
therefore answers `true`, letting the write through to RLS — when the effective
sharing model is `public` (which `controlled_by_parent` maps onto) or when the
schema has no `owner_id` field. A junction lands in that set; an ordinary owned
business object does not. Same declaration, opposite outcome, split by a
property no author writes down.

Row-level write authority is ONE composite determination (maintainer ruling on
#5492), so the middleware no longer ends the decision by itself. Before it
hard-refuses a **by-id** update or delete, it asks the security service's
`ISecurityService.checkAuthoredRowWrite` — the fail-closed verdict landed by
#5493 step 1 (PR #6841) — whether an **app-authored** (non-floor) row-level
policy admits this row for this operation. `admit` retracts this authority's
refusal and hands the row to the security pre-image gate, which composes per
#6684/#5492 and makes the final row decision. It does not authorize anything on
its own.

Everything else is unchanged, deliberately:

- **The guarded surface does not shrink.** A member with no authored policy, no
  share and no bypass is still refused; a read-level share still never widens a
  write; an `edit`-level share still widens update and not delete (ADR-0111 D3),
  and an update-only authored widener does not open delete either — the verb is
  threaded through to the verdict, not collapsed.
- **Fail-closed on every non-`admit` outcome.** No security service (a
  deployment without `@objectstack/plugin-security`), a service predating the
  method, a throwing probe, a principal-less context, an on-behalf-of context
  (ADR-0090 D10) and any unrecognised verdict all leave today's refusal
  byte-for-byte intact. The probe is reached through the same structural
  late-binding this plugin already uses for `hasWriteBypass`; no runtime
  dependency on `plugin-security` is introduced.
- **A creator who is no longer the owner gets nothing back.** The platform's own
  ownership floor (`created_by == current_user.id`, shipped on the additive
  `member_default` baseline) matches a record transferred away from its creator,
  so a deferral keyed on "the composed RLS admits this row" would return
  transferred records to former creators. The verdict is provenance-aware and
  abstains there; the deferral does not widen it.
- **The bulk path is untouched** — it composes a filter rather than a verdict,
  and is tracked separately (#6736).
- **Objects with no owner field are untouched** (#6698): sharing abstains, the
  gate never refuses, so the deferral is never reached and the platform
  `created_by` write floor remains their only row-level write gate.
