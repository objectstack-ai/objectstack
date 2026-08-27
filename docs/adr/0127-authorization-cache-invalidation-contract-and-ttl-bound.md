# ADR-0127: No authorization answer is cached without a declared invalidation contract and a TTL bound

**Status**: Accepted (2026-08-25) — maintainer ruling on [#11633](https://github.com/objectstack-ai/objectstack/issues/11633), verbatim 「接受你的建议，继续」, accepting the design document and its recommendation on all four forks. **Implementation has not shipped**, and that ordering is deliberate: this record states a decision, not a state of the code. See [Consequences](#consequences) for what is built, what is not, and which card carries each leg.
**Deciders**: ObjectStack Protocol Architects (maintainer ruling, 2026-08-25, decision-inbox review of the cross-request caching design filed under [#11633](https://github.com/objectstack-ai/objectstack/issues/11633))
**Builds on**: [ADR-0091](./0091-grant-lifecycle-and-recertification.md) (grant lifecycle — its **D1** effective-dating and **D2** "correctness = resolution-time filtering, fail-closed" are what D5 below protects from being rounded up by a timer), [ADR-0069](./0069-enterprise-authentication-hardening.md) (**D4** session controls — revocation by writing the `sys_session` row, which is why D7 exists), [ADR-0049](./0049-no-unenforced-security-properties.md) (no unenforced security properties — a declared control that a cache can silently outlive is the same defect one layer down), [ADR-0124](./0124-server-enforces-client-is-courtesy.md) (the server is the enforcement point — a cache sits *inside* that enforcement point and inherits its obligations), [ADR-0095](./0095-authz-kernel-tenant-layer-and-posture-ladder.md) (authz kernel and posture ladder)
**Supersedes**: nothing.
**Consumers**: `@objectstack/core` (`security/resolve-authz-context.ts` — the single derivation site), `@objectstack/plugin-security` (`security-plugin.ts` write-epoch middleware, `explain-engine.ts`), `@objectstack/plugin-auth` (`secondary-storage.ts`, `session-of-record.test.ts`), `@objectstack/objectql` (`IObjectQL.registerMiddleware`, the seam D2 names), `@objectstack/service-cluster` / `service-cluster-redis` (the `authz.invalidated` channel and its bridge), `@objectstack/rest` (`protocol.ts` `getMetaItems`), `@objectstack/service-automation`, and `content/docs/deployment/environment-variables.mdx` (where D6's knobs are registered)
**Surfaced by**: [#11633](https://github.com/objectstack-ai/objectstack/issues/11633) (the design document, comment [5394942824](https://github.com/objectstack-ai/objectstack/issues/11633#issuecomment-5394942824)), tranche 2 of [#10757](https://github.com/objectstack-ai/objectstack/issues/10757). Conversion to this record was filed as [#11969](https://github.com/objectstack-ai/objectstack/issues/11969).

---

## TL;DR

The framing that produced this record is that cross-request caching of the authenticated request path is **a security change wearing a performance costume**. Taken seriously, that changes the unit of design. The unit is not "a cache". It is:

> **A cached answer together with the declared contract that says when it stops being an answer.**

The rule, in the form the design states it and the maintainer accepted:

> **No authorization answer may be cached unless (a) every write that can change it passes a seam this process observes, and (b) a TTL bounds the case where (a) fails. Both. Always. Neither alone is a design.**

(a) alone fails on the writer this process cannot see — another node, a migration, a DBA. (b) alone is the bare timer that [#10757](https://github.com/objectstack-ai/objectstack/issues/10757)'s ruling already refused.

⚠️ **This record's own title is the shorthand, and D2 fixes what the shorthand means.** "A declared invalidation contract" is **not** a list of call sites that remember to invalidate — that reading is rejected in D2, on the record, because it is the reading a later author will otherwise arrive at.

## Context

### What forces both halves, rather than either

The two halves are not belt-and-braces. Each covers a class the other cannot see, and the classes were measured rather than assumed.

**The write seam is stronger than a caching design usually gets.** `IObjectQL.registerMiddleware` hands every middleware an `OperationContext` carrying `object`, `operation`, `ast`, `data` and `result`. `plugin-security` already uses exactly this as an invalidation trigger, and two properties of its use are load-bearing here: the epoch bump is the **first statement in the middleware, ahead of the `isSystem` bypass**, so a seeder, a package publish and the auto-org-admin grant all invalidate; and `metadata.changed` bumps it too, because a permission set can be *declared in metadata*, making a Studio edit a permission change with no row written.

What makes the seam decisive rather than merely convenient is that **better-auth does not bypass it**: `plugin-auth`'s ObjectQL adapter routes better-auth's own `insert` / `update` / `delete` straight through the engine. Membership changes, bans, session revocation and org-role changes are therefore all visible at one seam this process already owns.

**The TTL is not a backstop for sloppiness.** The only shipped cross-node channel is `IPubSub`, and it is **at-most-once** by its own documentation:

> "Redis pub/sub is **at-most-once** — there is no delivery guarantee to subscribers and no replay for a node that was down or slow at publish time. This is acceptable **only** for events that are pure cache-invalidation hints, never the source of truth."

`content/docs/kernel/cluster.mdx` confirms it at the contract level: no shipped driver provides `at-least-once`. A dropped message on such a transport is an escalation window with **no upper bound**. So the TTL is not a convenience and not a backstop for "paths we missed" — **it is the only bound that survives the transport's own stated guarantee.** That is a measurement, not a preference, and it is the strongest available argument for the direction the parent card had already ruled.

### Why the rule is stated as a rule, and not as a cache

The alternative shape — implement three caches, each with its own reasoning — was available and is what the lineage would have produced by default. It was rejected because the failure mode is uniform and silent: an authorization answer that outlives its truth **over-permits**, and it does so without an error, a log line, or a failing test. A per-cache decision leaves the next author, human or AI, to re-derive the invariant from whichever cache they happened to read.

## Decision

### D1 — Both halves are required, always; neither alone is a design

Any cached authorization answer carries, as a declared part of its design and not as an implementation detail:

1. **an observed write seam** — every write that can change the answer passes a seam this process observes; and
2. **a TTL bound** — a finite bound on the case where (1) fails, which it does for every writer outside this process.

⛔ A cache satisfying only (1) is not permitted, because the seam is per-process and the transport that would extend it cross-node is at-most-once. ⛔ A cache satisfying only (2) is not permitted, because a timer alone is the design the parent ruling refused.

The obligation attaches to **the answer, not to the module**. If a future surface caches an authorization answer under a name nobody here anticipated, it is governed by this record: the membership test is *"would serving this from the cache let an unentitled caller read data or land a write after the grant that permitted it was withdrawn?"* If yes, D1 applies.

### D2 — The invalidation contract is an engine seam, never a call-site list

"A declared invalidation contract" means: **the set of objects whose writes retire the entry, enforced at the engine middleware seam.** It does not mean, and may not be read to mean, a maintained list of places that call an invalidation function.

The reasoning is the AI-safety axis specifically, and it is why this is a decision rather than a style note:

> a *call-site list* of "places that must remember to invalidate" is a permanent maintenance obligation, and the failure mode when a new grant path forgets is silent over-permission. A *seam* cannot be forgotten, because writing through the engine is the only way to write at all.

This is the "declared = enforced" shape ([ADR-0049](./0049-no-unenforced-security-properties.md)) applied to cache invalidation: a new capability-granting path **physically cannot** skip the invalidation. A design that would require a reviewer to notice a missing invalidation call has already failed this record.

### D3 — Object-level (coarse) invalidation is the baseline; keyed invalidation is not a scheduled follow-up

Any write to a watched object retires **the whole cache for that leg**. This is what `plugin-security`'s existing `writeEpoch` already does, it is un-missable, and its only cost is cache-effectiveness under write load.

Keyed (fine-grained) invalidation is rejected as a starting point on two measured grounds:

- **The seam does not supply the mapping.** For `insert`, the row is in `opCtx.data`. But for **`update` / `delete` expressed as a `where`**, the affected `user_id` / `organization_id` is frequently **not derivable without reading the row back**. A design that computes "whose entry does this write touch" from the `OperationContext` is assuming something the seam does not provide.
- **The intuitive mapping is wrong where it matters most.** The fellow-org peer list (`org_user_ids`) is read as `sys_member {organization_id}` and therefore depends on **other users' rows**. ⇒ **A `sys_member` write must retire every entry for that organization, not the written user's entry.** This is the single most likely place for a keyed optimization to introduce a silent over-permission, and it is exactly the kind of mapping an AI-authored change extends without noticing.

⇒ **Keyed invalidation is not a follow-up to schedule. It is a follow-up to justify with a measurement of a real write-heavy tenant first.**

### D4 — The TTL is the correctness contract; a cross-node bus narrows the typical window and never the worst case

Cross-node invalidation is delivered as a **new channel (`authz.invalidated`) on the existing at-most-once bus**, following the shipped `MetadataClusterBridgePlugin` shape exactly — never a new transport, never a new dependency.

Its status is fixed here so that it cannot be promoted by a later reader:

- The bus is a **latency** improvement. It moves the usual convergence from "one TTL" to "one network hop".
- ⛔ **The bus is never the correctness mechanism.** The TTL is. **The code at the channel must say so**, in the channel's own comments: a missed message is *expected*, and the TTL is the contract.
- The shipped default composition has **no cluster service**, and the metadata bridge **silently returns** when none is registered. The default configuration must therefore be correct with no bus present.

**Non-optional part of this decision: a loud boot-time posture statement** when an authorization cache is enabled with a non-zero TTL and no invalidation bus is registered. Not a refusal — a deployment may accept the TTL as its whole bound — but it must be **stated, not discovered**. A security-relevant mechanism whose absence is logged at `debug` is precisely the shape of [#4785](https://github.com/objectstack-ai/objectstack/issues/4785), a config that silently disabled a control.

### D5 — An entry expires at `min(ttl, nextBoundary)`

Validity windows ([ADR-0091](./0091-grant-lifecycle-and-recertification.md) **D1**) are evaluated at resolution time, against a `nowMs` taken once per resolution ([ADR-0091](./0091-grant-lifecycle-and-recertification.md) **D2**). A cached envelope therefore **freezes a validity decision**: a grant whose `valid_until` passes *during* the TTL keeps resolving until the entry expires.

⚠️ **No write occurs at that boundary, so no write-invalidation can ever catch it.** D1's primary half is blind to this class **by construction** — not by oversight, and not fixably by watching more objects.

⇒ **Required: an entry carries the earliest upcoming validity boundary among the rows it consulted, and expires at `min(ttl, nextBoundary)`.**

Without it, "expires at T" silently becomes "expires at T rounded up by the TTL", and [ADR-0091](./0091-grant-lifecycle-and-recertification.md) D2's fail-closed promise quietly acquires a tolerance it never granted. This is the clause most likely to be dropped by an implementation that reads only the TL;DR, and it is the one whose absence is least visible in review.

### D6 — Staleness posture: the grants cache is off by default, `0` is a real path, and the knob is deployment config

- **Default TTL `0` (off) for the grants leg specifically**, with a supported non-zero range in the **low seconds**. Lower-sensitivity legs (localization, metadata) may ship enabled; grants is where the escalation window lives, and shipping it *on* by default would make every existing deployment absorb a posture change it did not ask for. A deployment that wants it turns it on **knowingly** — which is also what makes D4's boot-time posture statement meaningful rather than noise.
- ⛔ **`0` must be a real code path, not a degenerate TTL.** With the cache configured to `0`, the issued query multiset is **byte-identical to the uncached golden**. This is what makes "configurable to zero" an escape hatch a deployment can rely on rather than a claim in a docblock.
- **One knob per leg**, so the low-sensitivity legs can ship enabled while grants stays off.
- **The knobs are deployment config (`OS_*` environment), never a settings row.** Two reasons, the first measured: settings live in `sys_setting`, which the localization leg **caches** — a staleness bound read through a cached path is a bootstrap hazard, the knob that governs the cache being served by the cache. Second, it matches the direction ruled on [#11663](https://github.com/objectstack-ai/objectstack/issues/11663) for operator-level configuration, and the settings service already models env as outranking every persisted scope. Registered in `content/docs/deployment/environment-variables.mdx`, the canonical table.

### D7 — The session of record stays uncached

[#4785](https://github.com/objectstack-ai/objectstack/issues/4785) fixed the answer to "where is the session of record?": **it is always `sys_session`, the database.** That ruling **stands**, and this record does not reopen it.

The mechanism, which is why no performance argument reaches it: handing better-auth a `secondaryStorage` moves the session of record into it — `createSession` skips the `sys_session` row and `findSession` answers from the cached snapshot — while ObjectStack revokes sessions **by writing that row** ([ADR-0069](./0069-enterprise-authentication-hardening.md) **D4**: `revoked_at` plus a past `expires_at`). Idle-timeout, absolute-max and concurrent-cap revocation then **silently stop taking effect**. `cookieCache` is a different key reaching the same architecture, with the same result.

⇒ ⛔ **Caching better-auth's own session read is not available to a performance card.** If it is ever wanted, it is a **decision card that re-opens [#4785](https://github.com/objectstack-ai/objectstack/issues/4785)** with the revocation rewrite that option always required — never a caching card. The maintainer's own reason, recorded verbatim on that card: 「撤销从一次写变成两处一致性，AI 生成的新管控极易只写一半」.

### D8 — Two call sites are never served from cache, and one object is never watched

**Never served from cache:**

- **The permission explainer** (`plugin-security/src/explain-engine.ts`). This is the tool an administrator uses to verify that a revocation took effect. An explainer answering from cache would explain a state that no longer exists, and would do it at exactly the moment someone is checking. ⇒ `explain` takes a force-fresh path.
- **`runAs: 'user'` automation runs** (`service-automation`). These are not request-shaped and can be long-lived; they must not pin an envelope.

**Never watched:** ⛔ **`sys_session` is deliberately excluded from the grants cache's watched set.** Session controls **write** `last_activity_at` on a throttled cadence — once a minute per active session — so under D3's coarse invalidation, watching it would retire the entire grants cache roughly every minute on any deployment with idle timeout configured. `sys_session` does not feed the grants envelope, so excluding it is free — but only if someone notices, and the natural instinct ("sessions are authz, watch them") gets it wrong.

⇒ **The general rule, which outlives this one object:** *a watched object with a background write cadence silently converts a cache into a non-cache.* Adding an object to a watched set requires knowing its write cadence, not just its relevance.

### D9 — Identity pins assert `cached ≡ uncached`, never the provenance of a particular capability

The pins that guard this rule are written as **equivalence between the cached and uncached answer**, plus an assertion that the second resolution issued **zero** reads. Both halves are required — equality alone passes on a cache that never caches.

⛔ **A pin may not assert that a cached answer contains a capability *because a particular row exists*.** Such a pin encodes today's derivation, and derivations move: the platform-admin half of the answer is already re-anchoring onto deployment config under [#11663](https://github.com/objectstack-ai/objectstack/issues/11663). A provenance pin becomes an obstacle to that work and gets "fixed" by editing it — at which point the property this record exists to protect is no longer tested by anything.

Two further pin obligations follow from D5 and D3 respectively, because nothing else can catch them: a grant whose `valid_until` falls **inside** the TTL must stop resolving **at the boundary**, not at TTL expiry; and user X's envelope must change when user **Y**'s membership row in the same organization is written.

⚠️ **A revocation pin asserts the absence of the capability, not that the cache was cleared.** A clear-then-repopulate-from-a-stale-read implementation passes the second and fails the first. This is the discipline `plugin-auth`'s `session-of-record.test.ts` states in its own header — *"every test here asserts the END of the chain, not the middle"* — and it is the right precedent because it was written after exactly this blind spot.

## Consequences

**This record precedes its implementation, deliberately.** The design that produced it argued it was ADR-class in substance but not yet ripe to write, because two of its premises were unlanded. Both have since landed: the platform-admin consolidation closed 2026-08-24 (so the enrichment leg collapses into the grants leg, leaving **one** cached derivation with **one** invalidation contract rather than two copies of the same authorization fact), and [#11663](https://github.com/objectstack-ai/objectstack/issues/11663) was ruled 2026-08-25. Writing the rule down before the code obeys it is the intended order for a rule that constrains how the code may be written.

**Nothing is cached today, and no behaviour changes because this record exists.** What changes is that the next author of an authorization cache inherits a decided rule instead of re-deriving one. The implementation is sequenced by rising invalidation difficulty — localization, then metadata, then the shared invalidation substrate (the generalized engine-seam epoch, the `authz.invalidated` channel and D4's posture statement, done once so the grants leg does not carry it), then the grants leg itself.

**The rule costs cache-effectiveness, and that is accepted.** D3's coarse invalidation retires more than it must, D5 expires entries earlier than the TTL would, D6 ships the most valuable leg off by default, and D8 excludes the two call sites most likely to be hot in an admin console. Every one of those is a deliberate trade of hit-rate for a property that fails silently when absent.

**This record does not claim a latency target is met.** The lineage carries a per-request cost gate owned by the cloud repo. The measurements behind this design count **queries and legs, not milliseconds**, and placement is a separate half that was not measured. ⛔ Nothing here should be read as clearing that gate.

⚠️ **One disclosed gap, recorded without an obligation attached.** The `secondaryStorage` door into D7's rejected architecture is **boot-refused and pinned**; the `cookieCache` door reaches the same architecture and is **unguarded** (measured: zero occurrences repo-wide, so it is unconfigured rather than protected). That is a gap in the guard, not a gap in the ruling, and D7 decides the ruling either way. It is noted here so that a future reader finds it recorded rather than rediscovers it.

**If a declared shape is ever needed** for the invalidation event payload or a cache-posture value surfaced in diagnostics, that is a `packages/spec` change with its own review. This record does not take it and does not pre-commit its shape.

## Alternatives considered

**Keyed (fine-grained) invalidation for the grants leg.** Rejected as a starting point by D3. It wins only on write-heavy tenants, and nobody has measured one; meanwhile it requires a write-to-entry mapping the engine seam does not supply, and the `org_user_ids` case shows the intuitive mapping is wrong in the direction that over-permits. Not dropped — gated behind a measurement.

**TTL-only, with no cross-node signal.** Rejected by D4. Under it, every grant change costs a full TTL on every node that did not serve the write, in a deployment that genuinely runs more than one instance. The channel reuses a shipped transport and a shipped bridge pattern, adds no dependency and no new failure mode — *because* the TTL still bounds the worst case, making the bus strictly a narrowing of the typical window.

**Making the bus the correctness mechanism and dropping the TTL.** Rejected as the central error this record exists to prevent. On an at-most-once transport a dropped message is an unbounded escalation window, and the resulting system would look correct in every test that does not drop a message.

**Caching the session of record (re-opening [#4785](https://github.com/objectstack-ai/objectstack/issues/4785) Option B).** Rejected by D7 and by the earlier ruling it defers to. It is the smallest remaining share of a request's reads, it requires an ADR revision, and it makes revocation a two-place consistency problem. Reopening a settled architectural decision for the smallest remaining win is the definition of scope diffusion.

**Shipping the grants cache on by default with a short TTL.** Rejected by D6. It would make every existing deployment absorb a posture change it did not ask for, and it would reduce D4's boot-time posture statement to noise that appears on installations whose operators never chose a staleness window.

**Writing this as three separate cache designs rather than one rule.** Rejected in Context. The failure mode is uniform and silent across all three, and a per-cache treatment leaves the invariant to be re-derived by whoever reads one cache and not the others.
