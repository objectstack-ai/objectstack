# ADR-0124: The server is the enforcement point; client-side gating is a usability courtesy

**Status**: Accepted (2026-08-18) — **retroactive recording of an already-practised rule.** This record changes no behaviour anywhere. The rule it states has been in force and honoured across five packages and both repos since at least 2026-06-22; what did not exist was a decision record to cite. Implementation status is therefore "already implemented, everywhere, before this record was written" — see [Consequences](#consequences).
**Deciders**: ObjectStack Protocol Architects (maintainer ruling on [#9628](https://github.com/objectstack-ai/objectstack/issues/9628), 2026-08-18: record it as an *independent general* ADR at a new number rather than as a decision line on ADR-0057, with the scope written general from the start)
**Builds on**: [ADR-0057](./0057-erp-authorization-core-business-units-and-scope-depth.md) (ERP authorization core — its D10 "PS-2 implementation note" is the **closest ancestor** of this rule and the seed the rule was back-formed from; see Context), [ADR-0049](./0049-no-unenforced-security-properties.md) (no unenforced security properties — the *whether* axis: a declared property must be enforced at all), [ADR-0104](./0104-field-runtime-value-shape-contract.md) (its addendum's "enforcement-point principle" — the *when* axis: build/validate time vs runtime), [ADR-0058](./0058-expression-and-predicate-surface.md) (D5 — the predicate failure tiers this record composes with and does not overwrite), [ADR-0095](./0095-authz-kernel-tenant-layer-and-posture-ladder.md) (the tenant wall — one instance of the rule, decided on its own terms), [ADR-0106](./0106-metadata-plane-fls-object-schema-masking.md) (metadata-plane FLS masking — the enforcement whose client-facing projection D4 governs)
**Consumers**: `@objectstack/objectql` (`validation/rule-validator.ts`, `engine.ts`), `@objectstack/lint` (`validate-expressions.ts`, `validate-rls-predicate-enforceability.ts`), `@objectstack/rest` (`rest-server.ts` `filterAppForUser` and the app publish gate), `@objectstack/plugin-hono-server` (`current-user-endpoints.ts` — the `/me/permissions` FLS fold), `@objectstack/spec` (`ui/app.zod.ts`, `data/field.zod.ts`, `ui/action.zod.ts`), `docs/qa/platform-checklist` (RUNNER rule 4 and the area files), and — cross-repo — the ObjectUI shell's client-side `visible` / `requiresObject` gates
**Surfaced by**: [#9628](https://github.com/objectstack-ai/objectstack/issues/9628), split out of [#9255](https://github.com/objectstack-ai/objectstack/issues/9255). A corpus search of all 127 records under `docs/adr/`, **by content rather than by number**, found the rule cited in ~30 in-repo sites and 9 in `objectui` and decided by **no ADR at all**.

---

## TL;DR

One sentence has been load-bearing across this platform for months, cited about forty times, and never decided:

> **The server enforces. Client-side gating is a usability courtesy.**

This record decides it, **generally** — not for navigation, not for fields, not for any one surface. It is written general on purpose, because the measured history of this exact sentence is that a **narrow** statement of it got generalized by inheritance until the citations no longer matched the decision they pointed at. A record that can be re-narrowed by its next citer would reproduce the defect it exists to close.

Nothing here is new. Every behaviour this record describes already ships. What it adds is an anchor: ~30 in-repo citations and 9 in `objectui` currently point at `ADR-0057 D10`, which decides Setup-nav capability surfacing and does not say this.

## Context

### The rule is universally practised, and no ADR decided it

Measured on the whole `docs/adr/` corpus — **127 records, searched by content, not by number**: `courtesy`, `server enforces`, `server is the authority`, `client is a courtesy`, `enforcement point`, `fail-closed`, `UI absence`, plus every decision heading matching `server|client|enforc|authorit`.

| Candidate | What it actually decides | Is it this rule? |
|:--|:--|:--|
| ADR-0057 (ERP auth) **D10** | Setup-nav surfacing follows the capability (ADR-0029 K2); the object stays open | **No** — nav-entry tiering |
| same record, **PS-2 implementation note** (2026-06-22) | The Setup nav is filtered server-side in `filterAppForUser`; `requiresObject` is "a **client-side** (objectui) gate, not enforced in this repo" | **Closest ancestor** — but scoped to nav / app-metadata visibility |
| `0057-system-data-lifecycle-and-retention.md` | Lifecycle and retention; uses `§3.1`–`§3.6`, **zero `D`-numbered headings** | No — and it is the *other* record sharing the number (see below) |
| ADR-0049 | *Whether* a declared property is enforced at all (declared = enforced, no silent fail-open) | No — a different axis: **whether**, not **where** |
| ADR-0104 addendum, "the enforcement-point principle" | Build/validate time vs runtime | No — a different axis: **when**, not **where** |
| ADR-0111 D2 / D6 | Management authority is enforced in the service, not just the route | A narrow **instance** of the rule, not the rule |

So the rule was real, universally honoured, and anchorless.

### The lineage — how a nav-scoped note became a platform rule

This is the part that determines how the present record must be written, so it is stated with its evidence.

- The first commit ever to write the string is **`2256e9369`** — *"feat: gate Setup Org/Invitations nav on multi-org, server-side (ADR-0057 D10) (#2150)"*. The citation began **correct and nav-scoped**.
- The substance it drew on is D10's **PS-2 implementation note** (2026-06-22), which contrasts server-side `filterAppForUser` filtering against `requiresObject`, "a **client-side** (objectui) gate, not enforced in this repo".
- That contrast is the seed. **Later citers kept the number and dropped the scope** — into field locks, FLS maps, route authority and QA method, none of which D10 decides.

Nobody did anything unreasonable at any step. The generalization was *correct as engineering* — the rule really does hold at all those surfaces — and wrong only as attribution. Which is precisely why writing this record narrowly would not help: a narrow record placed in front of an author who correctly believes the rule is general will be cited generally, and the next reader will land on a mismatch again.

**⚠️ Therefore the scope of this record is written general from the start, and D2 makes re-narrowing an explicit violation rather than an available reading.**

### Why a new record, and not a decision line on ADR-0057

Two reasons, both on the 2026-08-18 ruling.

1. **Scope.** ERP authorization is not the rule's domain. A general enforcement-location invariant filed inside the ERP-authorization record inherits a scope it does not want, and inherits it *silently* — the next reader arrives at a record about business units and scope depth.
2. **The bare-`ADR-0057` ambiguity has already cost once.** The number 0057 is claimed by **two unrelated records** — `0057-erp-authorization-core-business-units-and-scope-depth.md` and `0057-system-data-lifecycle-and-retention.md` (#5992, frozen on `check-adr-anchors`'s shrink-only `KNOWN_NUMBER_COLLISIONS`). Filing the platform's most-cited enforcement sentence behind an ambiguous number would put every future citation of it one grep away from the wrong document. A fresh, unambiguous number is cheap; the ambiguity is not.

ADR-0057 keeps the lineage and gains a one-line pointer at the PS-2 note, so a reader who arrives there from an old citation is sent on rather than left to re-derive the rule.

## Decision

### D1 — The server is the enforcement point; client-side gating is a usability courtesy

Every access decision this platform declares — who may see a thing, who may write a field, which routes answer at all, what a permission map reports — is **decided by the server before the answer leaves the process**. A client-side check evaluating the same declaration exists to make the interface honest, immediate and pleasant. It is never what makes the rule true.

The operational form, for an author or reviewer: **assume the client is hostile, absent, or simply an older build.** If the guarantee still holds under that assumption, enforcement is in the right place.

### D2 — The scope is general, and membership is decided by a test, not by a list of surfaces

⛔ **This record is not scoped to any surface, and may not be re-scoped to one by a later citer.** The surfaces where the rule is practised today are *illustrations*, not the boundary:

- **visibility gates** — app and area navigation, the launcher, the app publish gate;
- **field locks** — `readonlyWhen`, `requiredWhen`, and the write-path enforcement behind them;
- **FLS maps** — the effective field-level-security projection served to clients;
- **route authority** — which endpoints answer, for which principal, at all.

Membership in the scope is decided by a **test**, so that a surface nobody listed is still covered:

> **If deleting the client-side check would let an unentitled caller read data or land a write, then that check was never a courtesy — it was the enforcement point, and it is in the wrong place.**

Anything that answers *yes* to that test is governed by D1. Writing a narrower scope was considered and rejected on this record's own evidence: the nav-scoped ancestor was re-generalized by inheritance across ~30 sites, and a nav-scoped record here would be re-generalized the same way by the next citer.

### D3 — The server's answer is the whole answer; it may not delegate an undecided case to the client

When the server cannot decide a declared gate — an unevaluable predicate, an unbindable scope root, a probe it cannot run — it resolves the case **itself**. ⛔ It may not emit a permissive answer on the expectation that the courtesy layer will hide the result.

*This decides **where**, not **which way**.* Whether a given undecided case falls open or closed belongs to that gate's own record — ADR-0058 D5's failure tiers and the narrowings recorded against them stand exactly as written, and this record does not convert any fail-soft tier into a fail-closed one. What it forbids is the third option: letting it through and relying on the UI. That option is what makes a lock that "fails open" a lock enforced in the courtesy layer, which is to say not enforced.

### D4 — What the client is told may not overstate what the server enforces

Anything the server sends a client *about* enforcement — an FLS map, a permission set, a capability probe, an author-facing diagnostic — is derived from the server's **actual effective enforcement**, not from an independent reading of the declarations.

- A client-side gate **stricter** than the server is a presentation choice and is permitted (hiding an entry that was nonetheless served is exactly what a courtesy layer is for).
- A client-side gate **looser** than the server, or a map that reports an enforcement the server does not perform, is a **defect** — it tells an author or an operator that something is protected when it is not, and it is the shape in which such claims survive review.

### D5 — Verifying a gate means exercising the server; UI absence is not evidence

A test that asserts only that the interface hides something has tested the courtesy layer and left the enforcement point unobserved. Verification of any permission, visibility or feature gate covers **both sides**: presence for the entitled persona, **and server-side refusal for the unentitled one** — proven with a direct request against the server wherever that is feasible.

### D6 — ⛔ This record does not license removing client-side gating

The courtesy layer remains **required where it is declared**. A client that ignores a declared `visibleWhen` renders an interface its author did not describe; that is a conformance defect in the client, and D1 is not a defence for it. What a client-side gate is *not* is the security boundary. Both halves are load-bearing: the first keeps the product coherent, the second keeps it safe, and neither substitutes for the other.

## Consequences

**Nothing changes at runtime.** This is a retroactive recording. Every behaviour named above already ships and was already reviewed on its own terms; no package, endpoint, schema or test changes because this record exists. That is the intended shape — the defect being closed is a **traceability** defect, not a behavioural one.

**~30 in-repo citations gain a resolvable anchor.** [#9255](https://github.com/objectstack-ai/objectstack/issues/9255) / PR [#9655](https://github.com/objectstack-ai/objectstack/pull/9655) already converted the affected sites to *attributive* phrasing — "the rule the framework cites as `ADR-0057 D10`" — so that no reader is sent to a decision that does not say this. Those phrasings now retarget mechanically to `ADR-0124 D1`. **That retarget is deliberately not part of this record's PR**; it is sequenced after, per the same ruling.

**Not every `ADR-0057 D10` citation is wrong.** The sites that cite D10 for what D10 actually decides — Setup-nav capability surfacing, `filterAppForUser`'s `requiresService` gating, the account app's nav declarations — are correct as written and stay. Only the citations that invoke the *general* rule move here. A blanket rewrite would trade one mis-citation for another.

**The decision letters here are markdown headings, and that is deliberate.** [#9592](https://github.com/objectstack-ai/objectstack/issues/9592) extends `check-adr-anchors` to verify that a cited `ADR-NNNN Dk` resolves to a real decision heading of the cited record. `D1`–`D6` above are `###` headings, the form used by the majority of this corpus and by ADR-0057 itself, so a citation of `ADR-0124 D3` is anchorable by that gate rather than merely plausible. An enforcement rule whose own citations cannot be checked is the failure family this record sits in; it should not join it.

**What was rejected.**

- *A decision line on ADR-0057 (the originally proposed "D13").* Rejected on scope and on the #5992 number ambiguity — see Context. The lineage is preserved by a pointer instead.
- *A surface-list scope ("nav, fields, FLS, routes").* Rejected as the recorded failure mode: a list invites the reading that an unlisted surface is out of scope, and invites the next citer to re-narrow to the one surface they arrived from. D2 states a test and demotes the list to illustration.
- *A maximal reading ("no client-side check ever means anything").* Rejected by D6. Nine live `objectui` sites and this repo's own `visibleWhen` surface depend on the courtesy layer continuing to exist and to be correct; a record that reads as permission to delete it would cause real damage while claiming this record's authority.
- *Converting every unevaluable case to fail-closed as part of this record.* Rejected by D3's explicit bound. That is per-gate work with its own evidence, and ADR-0058 D5 is not amended here by implication.
