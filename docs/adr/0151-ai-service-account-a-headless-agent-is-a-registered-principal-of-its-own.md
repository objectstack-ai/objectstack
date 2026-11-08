# ADR-0151: An AI service account — a headless agent is a registered principal of its own, with its own keys and its own name on every row; a person's key stays the person's

**Status**: Proposed (2026-11-08) — draft. `docs/adr/**` is a Tier H governed surface: the maintainer's merge adopts this record, and until then every decision below is a proposal.
- **Date**: 2026-11-08
- **Card**: [#31603](https://github.com/objectstack-ai/objectstack/issues/31603) (p1, `domain:cloud`), item O1 of [objectstack-ai/cloud#3820](https://github.com/objectstack-ai/cloud/issues/3820) (the Enterprise AI employee console).
- **Builds on**: [ADR-0090](./0090-permission-model-v2-concept-convergence.md) D10 (the principal taxonomy, agent rules 1–5, the 2026-09-16 note that an API key is its owner's credential, and the 2026-09-20 status note that reserves `performedBy` room for a run id), [ADR-0118](./0118-non-user-actor-contract.md) (the non-user actor contract: D1 null for the system, D2 absence is never system, D5 no actor-kind column, D6 no polymorphic actor), [ADR-0092](./0092-sys-user-profile-field-delegation.md) (the identity-table write guard), [ADR-0093](./0093-tenancy-mode-and-membership-lifecycle.md) D7 (the service-account exemption it deferred), [ADR-0135](./0135-identity-and-access-architecture.md) D2/D4 (user populations and how a row is marked), [ADR-0101](./0101-mcp-stdio-principal-admission.md) (an API key is the stdio principal), [ADR-0108](./0108-membership-grade-is-not-a-capability-channel.md) (membership grade is not a capability channel).
- **Amends**: ADR-0090 D10 — a second provenance for an agent principal, an agent that is its own authorization subject, and the reading of rule 4 for it (see [D5](#d5--attribution-the-account-is-the-subject-so-its-id-is-the-name-on-the-row)). ADR-0093 D7 — the deferred service-account row: the marker now exists, and an account is exempt from the membership reconciler (see [D1](#d1--an-ai-service-account-is-a-sys_user-row-of-kind-agent)).
- **Leaves unchanged**: the 2026-09-16 note (a person's API key is that person's credential, never an agent); rule 5 and its credential-kind × target-door table; ADR-0118 D1, D2, D5 and D6; the meaning of `ExecutionContext.performedBy` (the OAuth client that acted for a person) and the room it reserves; the OAuth agent path end to end; ADR-0073's automation principal, which stays a separate identity.
- **Consumers**: `@objectstack/platform-objects` (two `sys_user` columns), `@objectstack/plugin-auth` (the registration, key and lifecycle doors; the session and credential refusal), `@objectstack/core` (key admission carries the kind; the shared assembler stamps the principal), `@objectstack/plugin-security` (the agent ceiling at evaluation and at assignment), `@objectstack/plugin-audit` and `@objectstack/spec` (the hook surface, O4), and in `objectstack-ai/cloud` the licence layer and the console (cloud ADR-0116 D7, cloud#3886, cloud#3820).

---

## Provenance

- **The requirement**: cloud ADR-0116 D7, adopted 2026-11-08 — "An agent that connects to the deployment over MCP with an API key counts as **one AI user**." It writes down the maintainer's ruling on cloud#3844 D7, quoted on cloud#3886 as 「每个 agent 的服务身份算 1 个 AI 用户（指通过 MCP 加 API key 接入的 agent）」. cloud ADR-0116's own Consequences records that the rule is commercial, not metered, because the runtime has no agent identity to count, and names the identity proposed on cloud#3820 as the mechanism it waits on. cloud#3820 adds the governance half: list the AIs, stop one, trace what it did.
- **Which half lives here** (Prime Directive #13): this record is the **mechanism** half, in the repository whose code it governs — what an agent identity is in open code, how it authenticates, what it may do and how its writes are attributed. The **commercial** half — counting, caps, billing — stays in cloud ADR-0116 D7 and is implemented by cloud#3886. cloud ADR-0116 owes a one-line pointer to this number; that edit belongs to the cloud repository and is not made here.
- **The start**: the maintainer, 2026-11-08 16:27Z, in the cloud#3820 thread: 「objectstack 可以先开工吗？」. That is the word to begin the open-source items, not a ruling on this record's content.
- **The condition ADR-0090 named**: its 2026-09-16 note refused a key-scoped principal for lack of pull and said: "If a compliance requirement to tell credential-driven writes from hand-driven ones is ever stated, that is a new decision with the requirement named, ⛔ not a reading of this one." The requirement is now stated, above. This record is that new decision — and it does **not** take the road that note refused. A key never becomes a principal; a registered account does, and its keys are its credentials.
- **Readings**: every code citation is a symbol anchor (`path#symbol`) read on `objectstack-ai/objectstack` at `158cc2aa` (2026-11-08). Nothing below was run; the readings are of code.

---

## Context

### What an agent on an API key is today

- **It is its key's owner.** `packages/core/src/security/api-key.ts#resolveApiKeyAdmission` resolves the key's `user_id` and nothing else, and `packages/core/src/security/resolve-authz-context.ts#resolveAuthzContext` builds that person's grants. The shared assembler (`packages/core/src/security/assemble-execution-context.ts#entryFields`) makes a principal an agent only when an OAuth access token names a client, so a key's principal is `human`, with neither `onBehalfOf` nor `performedBy`, and its `sys_audit_log` row is the owner's own. That is decided behaviour (ADR-0090, the 2026-09-16 note), not a gap.
- **It cannot be narrower than that person.** `packages/runtime/src/domains/keys.ts` mints a key only for a signed-in caller, pins `user_id` to that caller, and refuses `scopes` in v1, so a key acts exactly as its owner. An agent handed a person's key holds that person's whole reach.
- **So it cannot be listed, counted, narrowed in advance or stopped on its own.** Nothing marks which of a person's keys an agent holds. Counting keys miscounts a person's own CLI or script as an agent, and one key shared by several agents as one (cloud#3886 measured both). Revoking or banning stops the person's other work too.
- **The one agent principal that exists is delegated.** The `/mcp` OAuth door turns a token naming a client into `principalKind: 'agent'` acting **for** the consenting person: `onBehalfOf` names them, rule 1 intersects the agent's scope ceiling with their grants, and `performedBy.clientId` names the client. That model needs a person who consents and who stays the subject. A headless agent — a pipeline, a scheduled worker, an MCP client on a server — has no such person in the loop.

### What the requirement needs from an identity

Five properties, each one a cloud#3820 or cloud ADR-0116 D7 need: **listable** (one row per agent), **countable** (one agent is one identity, however many keys it holds), **narrowable in advance** (its own grants, decided before it acts), **stoppable alone** (suspend it without touching a person), **attributable** (its writes name it, not a person).

### Why the account is a `sys_user` row

Every column that names who acted or who owns is a lookup to `sys_user`: ownership stamps, `created_by`, `sys_audit_log.user_id`, the assignment tables (`sys_user_permission_set.user_id`, `sys_user_position`), `sys_member.user_id`, and RLS `current_user`. An agent identity kept in a second table would need every one of those to point at two tables — the polymorphic actor reference ADR-0118 D6 refuses. As a `sys_user` row, the account is a principal the whole authorization and attribution stack already understands, and nothing downstream grows a second shape.

### ADR-0118's objection to identity rows, answered

ADR-0118 refused a seeded "system" pseudo-user for two reasons: seeding writes the identity tables around the identity driver, and such a row must then be excluded from every surface — users list, invitations, licence counting, permission pickers — where one missed exclusion is a bug, and a security bug where it can be granted. An account differs on both counts:

1. **It is registered, never seeded.** A door creates it through the identity driver, for a real actor an administrator registered, with a person accountable for it. It never stands for "nobody": D1's `null` for the system and D2's "absence is never system" are untouched.
2. **It is included where a principal belongs and refused at one seam.** It belongs in permission assignment, ownership, attribution and RLS — that is the point of having it. Where a person's capability would be a hole — holding a session or a sign-in credential — it is refused once, in the identity driver's own hooks, for every caller ([D2](#d2--it-never-signs-in-one-refusal-in-the-identity-driver)). A surface that forgets the kind cannot hand it a session, because the refusal sits below every surface.

---

## Decision

### D1 — An AI service account is a `sys_user` row of kind `agent`

- **The kind is a column**: `sys_user.principal_kind`, `human` (the default, and the value every existing row reads as) or `agent`. The vocabulary is `ExecutionContext.principalKind`'s (`packages/spec/src/kernel/execution-context.zod.ts#principalKind`), so the row's kind is the kind its requests carry. A row admits these two values only. `service` (ADR-0090 D10's integration identity) arrives with the door that would set it, never ahead of it; `guest` and `system` are never row kinds (ADR-0138, ADR-0118 D1).
- **Born with its kind, and the kind never changes.** The registration door writes `principal_kind` in the insert that creates the row, so no account ever exists as a human row, however briefly. An update that changes it is refused for every caller, `isSystem` included: a human row turned into an agent, or an agent into a human, would defeat both the counting rule ([D7](#d7--what-the-licence-layer-counts)) and the sign-in refusal ([D2](#d2--it-never-signs-in-one-refusal-in-the-identity-driver)). It is system-managed under ADR-0092 D2, never writable through the generic data path.
- **An accountable owner**: `sys_user.accountable_user_id`, a lookup to `sys_user`, required on an `agent` row and absent on a `human` row. The owner is a `human` member of the account's organization. **Accountability, not authority**: the owner's grants never flow to the account and never bound it. That is the difference from an OAuth agent, whose authority is intersected with its person's.
- **Exactly one organization, as a plain member.** Registration creates the account's one `sys_member` row with grade `member`. It never gains a second membership and its grade is never raised (ADR-0108: grade is not a capability channel, and an administrator's grade is exactly the standing [D3](#d3--its-authority-its-own-grants-under-the-agent-ceiling)'s ceiling forbids). The membership reconciler never binds an account: that is the exemption ADR-0093 D7 deferred until "a first-class service-account marker exists", and `principal_kind` is that marker.
- **An undeliverable address.** better-auth requires a unique email, so the account gets one from `packages/plugins/plugin-auth/src/placeholder-email.ts#generatePlaceholderEmail`, under the reserved `.invalid` domain. Invitations and every auth mail callback already refuse such an address (`#isPlaceholderEmail`). Its `sys_user.source` is `env_native` (ADR-0135 D2/D4): the environment's own identity, linked to no directory.
- **Who may register one**: an administrator of the organization (`packages/plugins/plugin-auth/src/invitation-role-cap.ts#isOrgAdminGrade`) or a platform administrator. An ordinary member may not: letting any member mint identities would put agents outside the organization's administration and outside any count. A registration names the account and says what it is for, which is what the inventory shows.

### D2 — It never signs in: one refusal in the identity driver

- **No session, ever.** better-auth's session-create hook (`packages/plugins/plugin-auth/src/auth-manager-database-hooks.ts#sessionBefore`) refuses to create a session for an `agent` row, for every caller, `isSystem` included. Every sign-in method creates a session — password, magic link, one-time code, passkey, social and SSO sign-in — and so do impersonation and an administrator-minted session, so one refusal closes all of them.
- **No sign-in credential.** The account holds no `sys_account` row: no password and no provider link. The account-create hook refuses one for an `agent` row, the same way.
- **What follows from those two, with nothing more built**: the account cannot consent to an OAuth client, because consent needs a session, so no OAuth token ever names an account as its subject; it cannot reach `POST /keys`, which requires an interactive session; it is never an administrator (D3), so `packages/plugins/plugin-auth/src/last-admin-guard.ts#registerLastAdminGuard` never counts it as one who can sign in; and its placeholder address means no invitation, reset or magic link is ever delivered for it.

### D3 — Its authority: its own grants, under the agent ceiling

- **The account is the authorization subject.** A request admitted by an account's key carries `userId` = the account, `principalKind: 'agent'` and no `onBehalfOf`. Rule 1's intersection is read from `onBehalfOf` (the explain engine and the security plugin key on its presence), so it does not apply: the account acts for nobody, and its own grants are its whole authority.
- **Its grants are ordinary assignments.** Permission sets and positions are assigned to it through the existing tables and doors, `sys_user_permission_set` and `sys_user_position`, under ADR-0090 D12 as amended (an organization administrator assigns inside the organization boundary).
- **Explicit grants only.** An agent principal receives no member baseline and none of the sets bound to the `everyone` anchor; its floor is the restricted set, `packages/spec/src/ai/mcp.zod.ts#MCP_AGENT_PERMISSION_SET_RESTRICTED`. Half of that exists: the security plugin's agent branch (`packages/plugins/plugin-security/src/security-plugin-permission-sets.ts#isAgent`) already withholds the member baseline and floors at the restricted set. The other half is O3's: the resolver hands every authenticated member the `everyone` anchor (`packages/core/src/security/resolve-authz-context.ts#resolveUserAuthzGrants`) and skips only an external member today, so it must skip an account the same way. Then a newly registered account can do nothing until it is granted something. Narrow in advance is the default, not a setting.
- **Rule 2's ceiling holds at evaluation, not only at assignment.** Whatever its sets say, an agent principal never carries View All or Modify All, the destructive class (`packages/plugins/plugin-security/src/permission-evaluator.ts#DESTRUCTIVE_OPERATIONS`), a system permission, a superuser wildcard or an admin scope, and never runs `isSystem`. Assigning a set that breaches the ceiling to an account is refused by name, which is the loud, early answer. The guarantee is the clamp at evaluation, because a set can be edited after it was assigned. One consequence is deliberate: an action gated by a system permission is closed to an account until a decision widens rule 2.
- **The agent ceiling sets stay out of the assignment tables.** `mcp_agent_*` remain an OAuth agent's scope-derived ceiling, and `packages/plugins/plugin-security/src/agent-ceiling-grant-refusal.ts` keeps refusing them for every holder. Only its premise sentence, "no `sys_user` row is an agent principal", stops being true; O3 rewrites it in the same change that makes it false.
- **Rule 3: no human is in the loop, so the account never completes alone what needs one.** The destructive class is already closed by the ceiling. An action that asks for a person's confirmation before it runs (ADR-0011's `ai.requiresConfirmation`, rule 3's co-sign) is refused for an account, and never confirmed by the account itself, until a hold door exists that hands the run to a person: the account's owner or an administrator (O6, through the approvals engine).
- **Rule 5 needs nothing new.** An account's `api` action forward carries the account's own key, and that key already *is* the agent, so no forward credential is minted. Its cells in the table are the `api_key` row as it stands: the identity door refuses by name, the MCP and platform doors accept.
- **MCP.** On the HTTP endpoint and over stdio (ADR-0101, `OS_MCP_STDIO_API_KEY`), an account's key admits the account through the same shared chain. The OAuth tool families are a person's consent and do not apply; the account's grants bound what its tools reach.

### D4 — Its credentials: dedicated API keys, minted by a person

- **API keys, one or many.** Each key row carries `user_id` = the account and `active_organization_id` = the account's organization. An account may hold several keys (rotation, one per deployment); they remain one identity.
- **A person mints them; the account never does.** A signed-in administrator of the account, or its owner, mints a key for it through a door that checks that authority, and sees the raw secret once. `POST /keys` stays exactly as it is — self only, interactive session only — so the account cannot mint, rotate or revoke its own credentials. Managing credentials stays with a person's sign-in.
- **The same lifecycle policy.** The default life and the expiry ceiling that bind a person's key bind an account's key.
- **A person's key stays the person's.** No door turns a person's key into an account's, or the reverse, and no key ever changes its `user_id`. The 2026-09-16 note stands.
- **Key scopes stay refused.** A narrow credential is an account with narrow grants; that is the narrowing `keys.ts` deferred, delivered without subset enforcement.
- **OAuth `client_credentials` is not in this record.** The OAuth door resolves to a delegated agent with a consenting person. A grant with no person is a second shape on that door, with its own registration and consent questions. A follow-up may add it, and if it does, its token names this same account as its subject.

### D5 — Attribution: the account is the subject, so its id is the name on the row

- **`userId` is the account.** So ownership stamps, `created_by`, `current_user` and `sys_audit_log.user_id` all name the account, and the row keeps joining to `sys_user` (ADR-0118 D1). A reader tells an agent's write from a person's by the subject row's `principal_kind`; no kind column is added to any audit row (ADR-0118 D5 holds).
- **`performedBy` stays absent for an account, and its meaning does not move.** It names a performer who is *not* the subject: the OAuth client that acted for a person. For an account the performer *is* the subject, so rule 4's absence rule reads true as written ("the principal acted for itself"), and the principal is the agent. The card proposed a `performedBy` key naming the account. This record refuses it, for three reasons:
  1. The audit writer records `on_behalf_of` beside every `performed_by` (`packages/plugins/plugin-audit/src/audit-writers.ts`), so the row would say the agent acted on behalf of itself.
  2. `performed_by` holds `sys_oauth_application` ids today. A `sys_user` id in the same key gives one key two id namespaces, which a reader cannot tell apart.
  3. The one way to make `performedBy` mean something is to make the owner the subject — the delegated model. Then the owner owns what the agent creates, the agent's RLS is the owner's, and the agent's authority moves whenever the owner's does. That is the opposite of an identity of its own, and it is what the OAuth path already offers when a person consents.

  The sibling room on `performedBy` stays reserved, for the run id the 2026-09-20 note names.
- **Rule 4, read for the second provenance**: an agent acting for a person records `performed_by` and `on_behalf_of` (unchanged); an agent that is its own subject records itself as `user_id`, and nothing else.
- **Which key it used is not recorded per write.** That would be the credential-scoped audit subject the 2026-09-16 note refused. `sys_api_key.last_used_at` says which key was used last.
- **Hooks and the governance seam see the kind without a lookup.** Today a hook learns that an agent acted only from `performedByClientId`, which an account never carries. O4 surfaces the envelope's `principalKind` to hooks (the spec key is O4's to name), so the AI governance interceptor (O2) and approval routing (O6) can ask one question for both kinds of agent.
- **Lifecycle acts are audited as the writes they are.** Registration, assignments, key mints and revocations, suspension and owner changes write `sys_user`, `sys_member`, `sys_user_permission_set` and `sys_api_key`, none of which the CRUD audit excludes, with the acting person attributed.

### D6 — Lifecycle

| Act | Who | What it writes | Effect |
|:--|:--|:--|:--|
| Register | An administrator of the organization, or a platform administrator | One act: the `sys_user` row (kind `agent`, owner, placeholder address) and its `sys_member` row (`member`) | It exists, holds no key and no grant, and its floor is the restricted set |
| Grant, revoke grants | An administrator, under D12's boundary | `sys_user_permission_set` / `sys_user_position` rows | Read on the next request |
| Mint a key | The owner or an administrator, signed in | A `sys_api_key` row for the account | The secret is shown once, to that person |
| Revoke a key | The owner or an administrator | That key's `revoked` and `revoked_reason` | That key is dead for good; the account and its other keys are untouched |
| Suspend | The owner or an administrator | The account's ban state (`banned`, `ban_reason`), the state `ban_user` writes | Every key is refused on its next call: key admission already reads the owner's row on every resolution and asks `packages/core/src/security/user-ban.ts#isUserBanInForce`. Nothing is revoked |
| Resume | An administrator only | Lifts the ban | The same keys work again. The owner cannot resume, so an owner cannot undo an administrator's stop |
| Change owner | An administrator | `accountable_user_id` | — |
| The owner leaves | Automatic | When the owner's membership in the account's organization ends, the account is suspended | It stays suspended until an administrator names a new owner, so no agent is left with nobody accountable |
| Retire | An administrator | Revokes every key and ends the membership; keeps the row | Terminal: the mint door refuses an account with no membership, so it never gets a key again, and its id keeps joining every row it wrote |
| Last used | Derived | Nothing: the latest `last_used_at` over its keys | `sys_user.last_login_at` stays empty for ever, because it never signs in |

**Suspension is the ban.** One state, one predicate, already read on every path an account can authenticate through. ⛔ No second suspension column, and no second refusal path.

### D7 — What the licence layer counts

Open code defines the identity and counts nothing: it caps nothing and refuses nothing for a licence reason. What it guarantees the licence layer:

- **One registered account is one agent identity**: one `sys_user` row with `principal_kind = 'agent'`. A counter counts those rows — never keys, calls, sessions or clients. N keys on one account are one; a key belongs to exactly one account.
- **A person's own key is that person.** A person who runs a script with their own key is that person and nothing more (cloud#3886's acceptance: no double count).
- **An OAuth client acting for a consenting person is that person's delegated agent, not an account.** This record gives the count nothing new about it.
- **Registration is an identity write**, so a licence plugin can observe or refuse it on that write, as cloud's AI-seat plugin acts on `ai_access` writes today. Whether an account holds `ai_access` (`packages/platform-objects/src/identity/sys-user.object.ts#ai_access`, which opens the in-app assistants an account has no session to use), and whether a suspended account counts, are cloud's to decide.
- **cloud#3886 question 3 — what happens to an agent that uses a person's key on `/mcp`**: open code keeps admitting it as that person (the 2026-09-16 note). A door policy that refuses a person's key on `/mcp`, so that every agent must register, is not added here. Until one exists, an agent run on a person's key is that person and no count can see it. cloud ADR-0116's Consequences already covers that case: the contract states the count.

---

## Options considered

| Option | Verdict | Why |
|:--|:--|:--|
| **Explicit registration** of an agent account (this record) | **Chosen** | Gives all five properties. Reuses the subject, grant, ownership and attribution machinery unchanged, and closes sign-in at one seam. |
| **Auto-discovery**: any key seen on `/mcp` is an agent | Refused | It counts a person's own CLI or script as an agent, and one key shared by many agents as one. It discovers the agent after it has acted, so nothing can be narrowed in advance. And it changes what an existing credential means without its owner's act, against the 2026-09-16 ruling. |
| **The key as a principal** (key-held grants, a key-scoped audit subject) | Refused, again | The 2026-09-16 note's refusal stands: a credential is how a principal acted, never a second who. Grants on a key also need the subset enforcement `keys.ts` deferred. |
| **A delegated account**: the owner is the subject, the account rides in `performedBy`, authority intersected with the owner's | Refused | See D5's third reason. It is the OAuth model under another name, with a static key standing in for consent. |
| **A separate identity table** | Refused | Every user-lookup column would need a second target: the polymorphic actor ADR-0118 D6 refuses. |
| **A seeded pseudo-user per agent** | Refused | ADR-0118's own objection. Registration through the identity driver is what this record does instead. |
| **Reuse the `service` kind** | Refused | ADR-0090 D10's `service` is an integration identity with no seat. An AI agent must carry the agent rules (the ceiling, the co-sign) and be countable as an AI. `service` stays reserved for an integration door of its own. |

---

## Non-goals

- **No licence logic** — counting, caps, billing: cloud ADR-0116 D7, implemented by cloud#3886.
- **No console** — inventory, kill switch, trace, usage and cost: cloud#3820's cards consume this identity.
- **No MCP tool-call interceptor**: O2.
- **No change to OAuth agents**, and nothing about cutting off live OAuth tokens or suspending a person's own key: O5.
- **Not decided here**: OAuth `client_credentials`; an account acting on behalf of a person (token exchange); a flow or job `runAs` naming an account (ADR-0073's automation principal stays the identity of user-less runs); the `service` kind; external or multi-organization accounts; a `/mcp` policy that refuses persons' keys.

---

## What builds on this

- **O3 (objectstack) — the account.** D1's two columns, born-with-kind and immutable; D2's session and credential refusal; registration, key and lifecycle doors (D4, D6); key admission carries `principal_kind` on the owner read it already makes (`packages/core/src/security/user-ban.ts#USER_BAN_FIELDS` gains the column, so no read is added), and the shared assembler stamps `principalKind: 'agent'` with no `onBehalfOf` for it; the `everyone` anchor skip, the ceiling clamp at evaluation and the refusal at assignment (D3); the owner-leaves suspension. Pins O3 owes: an account's key on REST, on `/mcp` and over stdio each admits `principalKind: 'agent'`, with `userId` the account and no `onBehalfOf`; every sign-in method and impersonation refuse an account; a ceiling-breaching set assigned to an account and then edited grants nothing; a suspended account's key is refused on its next call and works again after resume. O3 also inventories the code that reads `principalKind === 'agent'` as "OAuth-shaped" — `onBehalfOf` or `oauthScopes` present — in `packages/runtime/src/action-execution.ts`, `packages/runtime/src/domains/automation.ts#connectorConnectionDelegatedCaller`, `packages/plugins/plugin-security/src/explain-engine.ts` and the storage and comment access hooks, and gives each an account answer.
- **O4 (objectstack) — attribution.** D5: every audit writer (CRUD, action invocation, data export) records the account as `user_id`, which needs no change; `principalKind` reaches hooks and explain. No audit column is added.
- **O2 and O6** read `principalKind` to decide and to route a hold to the owner or an administrator.
- **cloud**: cloud#3886 counts D7's rows; the console lists accounts with owner, grants and last use, stops one through D6's suspend, and traces it by `user_id`. cloud ADR-0116 gains its pointer to this number.

---

## Consequences

- **What an account creates, it owns.** Ownership follows the subject, so the agent's RLS sees its own rows. Assignment rules ([ADR-0142](./0142-ownership-queue-membership-claim-and-assignment-rules.md)) can hand them on, and a notification addressed to the account delivers nowhere.
- **Surfaces that mean people, not principals, filter by `principal_kind`.** That is the residual cost ADR-0118 predicted. It is smaller here, because the surfaces where a missed exclusion is a hole — sign-in, credentials, sessions, administrator standing — are closed below every surface, and a missed exclusion elsewhere shows an agent in a list rather than letting it in.
- **Migration is additive.** Two columns with defaults; no existing row changes meaning, and every existing principal keeps reading as `human`.
- **ADR-0090 and ADR-0093 carry status lines pointing here.** ADR-0118 is cited and not amended.

---

## References

- [ADR-0090](./0090-permission-model-v2-concept-convergence.md) D10 — principal taxonomy; agent rules 1–5; the 2026-09-16 API-key note; the 2026-09-20 run-id status note; the rule 5 amendment.
- [ADR-0118](./0118-non-user-actor-contract.md) — non-user actor contract.
- [ADR-0092](./0092-sys-user-profile-field-delegation.md) — identity-table write guard.
- [ADR-0093](./0093-tenancy-mode-and-membership-lifecycle.md) D7 — the deferred service-account exemption.
- [ADR-0135](./0135-identity-and-access-architecture.md) D2/D4 — populations and source marking.
- [ADR-0101](./0101-mcp-stdio-principal-admission.md) — the stdio key principal.
- [ADR-0108](./0108-membership-grade-is-not-a-capability-channel.md) — grade is not a capability channel.
- [ADR-0011](./0011-actions-as-ai-tools.md) — actions as AI tools, `ai.requiresConfirmation`.
- [ADR-0073](./0073-automation-execution-identity.md) — the automation principal, kept separate.
- cloud ADR-0116 D7; [objectstack-ai/cloud#3820](https://github.com/objectstack-ai/cloud/issues/3820); [objectstack-ai/cloud#3886](https://github.com/objectstack-ai/cloud/issues/3886); [objectstack-ai/cloud#3844](https://github.com/objectstack-ai/cloud/issues/3844).
