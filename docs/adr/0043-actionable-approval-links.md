# ADR-0043: Actionable approval links — single-use tokens with a session-less confirm page

**Status**: Accepted — implemented (proposed 2026-06-12 · calibrated 2026-06-12) · **Amended** (2026-10-10, #22631 — open-time notification is the approvals service's own `approval.requested` topic, not a flow-authored `notify` node; see the Issue bullet under Mechanics. One-tap links stay `remind()`-only; the token table and every decision below are unchanged)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0042](./0042-approval-sla-escalation.md) (reserved system actors, audit-first discipline), thread interactions (#1740), [ADR-0012/0030](./0030-notification-platform-convergence.md) (messaging + outbox)
**Closes**: [#1743](https://github.com/objectstack-ai/objectstack/issues/1743)
**Consumers**: `@objectstack/plugin-approvals` (token store + redemption + pages), messaging templates, future email channel wiring

---

## TL;DR

Approvers should act from an email/IM message without signing in — the
biggest lever on approval latency. The button behind that experience is a
URL whose bearer has **no session**, so the token in it must carry the
entire authorization, deliberately weakened on every axis:

| axis | decision | failure it prevents |
|---|---|---|
| scope | one token = one request + one action + one approver | leaked token ≠ account takeover |
| storage | only the **SHA-256 hash** is stored (`sys_approval_token`) | a DB leak yields no usable links |
| single-use | `consumed_at` set transactionally before deciding | forwarded email replayed |
| TTL | 72 h default | months-old mail approving today's request |
| identity | token binds `approver_id`; the decision is audited as that approver | anonymous decisions |
| invalidation | redemption re-checks the request is still pending **and** the approver still holds the slot | stale links after reassign / recall / decision |
| scanner-proof | **GET never executes** — it renders a confirm page whose button POSTs | mail-gateway link prefetchers approving requests |

The last row is the classic production incident: enterprise mail security
(Outlook SafeLinks et al.) pre-fetches every link in a message. Any
GET-executes design gets requests approved by robots.

## Mechanics

- **`sys_approval_token`** (new object — table creation only, no
  migrations): `token_hash`, `request_id`, `action`
  (`approve`/`reject`), `approver_id`, `expires_at`, `consumed_at`.
- **Issue** (`issueActionTokens`): 256-bit random raw tokens, returned
  once, hashes stored. Wired into `remind()` — each pending approver with
  a concrete identity (not `role:*` literals) gets their **own**
  notification carrying their own approve/reject links. (Amended
  2026-10-10, #22631: open-time notification is the approvals service's
  `approval.requested` topic, published by `openNodeRequest` to each
  concrete approver on the slate the request opens on — PR #22625; it
  carries no links, and one-tap links remain `remind()`-only.)
- **Confirm page** (`GET /api/v1/approvals/act?token=…`): session-less
  minimal HTML rendered by the plugin on the host Hono app — request
  summary (flow label, record title, action) + a POST form. Invalid /
  expired / consumed tokens render an explanatory page with a Console
  deep link; the GET **never** mutates.
- **Redeem** (`POST /api/v1/approvals/act`): hash lookup → not consumed →
  not expired → request still `pending` → `approver_id` still in
  `pending_approvers` → mark consumed → `decide()` **as that approver**
  (system context carries the bound identity). Every check failure maps
  to a distinct, non-enumerable result page.
- **URLs**: relative by default (works inside Console/IM webviews);
  deployments set `publicBaseUrl` (plugin option) for absolute links in
  outbound email.

## Non-goals (v1)

- Comment capture on the confirm page (a decision comment field is a
  fast follow; the page ships decision-only).
- Email channel *delivery* configuration — the links ride the existing
  messaging payloads; SMTP setup is deployment concern.
- Rate limiting beyond single-use + TTL (the token space is 2^256;
  brute force is not the threat — leaked links are, and those die on
  first use / decision / reassign / expiry).

## Consequences

- The remind nudge becomes genuinely actionable — one tap from the
  notification to a decision, with the audit trail showing the human
  approver (never a system actor).
- A deliberate, narrow bypass lane around session auth exists; its
  entire surface is this ADR's table, and every property is enforced in
  `redeemActionToken` with tests per row.
- Stale-link UX is explicit: recalled/decided/reassigned requests answer
  with "this link is no longer valid" + a Console deep link, not an
  error code.
