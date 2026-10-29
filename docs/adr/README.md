# Architecture Decision Records — index

> **Generated** by `node scripts/adr-index.mjs` from the records in `docs/adr/` — do not edit by hand; change a record's `**Status**:` line and regenerate (`pnpm adr:index`). The lint ADR step reports a stale index as a warning and never fails on it.

## Conventions

- **One registry per repository, numbers never reassigned, files never moved** (AGENTS.md Prime Directive 13). A reversed decision is a new ADR or an amended status line, never a quiet changeset. Before changing behaviour in territory an ADR governs, grep this index for the surface.
- **The status line is the single fact.** Every record carries, right under its title, one line that starts `**Status**: ` followed by a keyword — `Partially implemented`, `Accepted`, `Proposed`, `Draft`, `Superseded`, `Withdrawn`, `Deferred`, `Implemented`, `Revised`, `Amended` — and any free prose after it (dates, implementation notes, amendments). This index is generated from that line by `scripts/adr-index.mjs`; a record whose line is missing or names no keyword is listed as **Unparsed** and reported, never guessed.
- **Status hygiene.** A PR that lands an ADR's implementation flips that ADR's `**Status**:` line to `Accepted — implemented` with one line of evidence (key file + test), in the same PR. (The rule the retired `PRIORITIZATION.md` review carried; it lives here now.)
- **Shared numbers are cited by stem.** Where two unrelated records carry one number, a bare `ADR-NNNN` is one of two; the unambiguous id is the record's filename stem prefixed `ADR-` (`ADR-0057-system-data-lifecycle-and-retention`), which `scripts/check-adr-anchors.mjs` resolves to that one record. Versions of one decision share a stem and add `.vN`; cite a version as `ADR-0006 v4` in prose or `ADR-0006-project-environment-split.v4` where a checker reads it.
- **The ObjectUI registry (`ui/docs/adr/`) keeps its own sequence**, imported with the ui merge. Its numbers overlap this registry's and mean something else; this index lists them under the `ui-` prefix, and a citation of one is spelled `ObjectUI ADR-NNNN`, which the anchor checker recognises as another registry's.
- **Decisions that draw the open/closed or commercial boundary live in `objectstack-ai/cloud`** and are cited from here as `cloud ADR-NNNN`, never as a bare number.

## Summary

145 records under `docs/adr/` (140 numbers), 11 under `ui/docs/adr/` (listed separately below).

| Status | Records |
|---|---|
| Accepted | 127 |
| Proposed | 4 |
| Superseded | 4 |
| Draft | 3 |
| Deferred | 2 |
| Withdrawn | 2 |
| Amended | 1 |
| Partially implemented | 1 |
| Revised | 1 |
| **Total** | **145** |

## Shared numbers

Listed side by side, never renumbered (Prime Directive 13). A **collision** is two unrelated decisions under one number — cite each by its stem-qualified id; **versions** are one decision revised under its own number.

### ADR-0006 — one decision, 3 versions

A bare `ADR-0006` names the decision; its current text is [0006-project-environment-split.v4.md](./0006-project-environment-split.v4.md). Cite one revision by its version or its stem.

| Cite as | File | Title | Status | Date |
|---|---|---|---|---|
| `ADR-0006-project-environment-split` (unversioned file, superseded) | [0006-project-environment-split.md](./0006-project-environment-split.md) | Environment & Project as Independent Siblings — v3 | Superseded — by v4 (`0006-project-environment-split.v4.md`) — 2026-05-20 | 2026-05-20 |
| `ADR-0006 v2` / `ADR-0006-project-environment-split.v2` | [0006-project-environment-split.v2.md](./0006-project-environment-split.v2.md) | Three-Layer Tenancy — Organization, Project, Environment | Superseded — by v4 (`0006-project-environment-split.v4.md`) — 2026-05-20 | 2026-05-20 |
| `ADR-0006` (current) / `ADR-0006 v4` / `ADR-0006-project-environment-split.v4` | [0006-project-environment-split.v4.md](./0006-project-environment-split.v4.md) | Environment & Project — v4 (drop dev-workspace Project, unify on Package) | Accepted — v4 — supersedes v3 — API-surface vocabulary boundary recorded 2… | 2026-05-20 |

### ADR-0010 — 2 unrelated decisions — a collision

| Cite as | File | Title | Status | Date |
|---|---|---|---|---|
| `ADR-0010-metadata-protection-model` | [0010-metadata-protection-model.md](./0010-metadata-protection-model.md) | Metadata Protection Model | Accepted — 2026-10-27 (ruled on objectstack#26553, ADR batch 1; proposed 2… | 2026-05-29 |
| `ADR-0010-nl-to-flow-authoring` | [0010-nl-to-flow-authoring.md](./0010-nl-to-flow-authoring.md) | Natural-Language → Flow Authoring (Platform Capability) | Draft — 2026-05-24 | 2026-05-24 |

### ADR-0019 — 2 unrelated decisions — a collision

| Cite as | File | Title | Status | Date |
|---|---|---|---|---|
| `ADR-0019-app-as-consumer-unit` | [0019-app-as-consumer-unit.md](./0019-app-as-consumer-unit.md) | App as the Consumer-Facing Unit | Accepted — 2026-10-27 (ruled on objectstack#26553, ADR batch 1; proposed 2… | 2026-05-31 |
| `ADR-0019-approval-as-flow-node` | [0019-approval-as-flow-node.md](./0019-approval-as-flow-node.md) | Collapse Approval into Flow — one engine, approval as a durable-pause node | Accepted — 2026-05-31 — fully implemented (A1–A5) | 2026-05-31 |

### ADR-0057 — 2 unrelated decisions — a collision

| Cite as | File | Title | Status | Date |
|---|---|---|---|---|
| `ADR-0057-erp-authorization-core-business-units-and-scope-depth` | [0057-erp-authorization-core-business-units-and-scope-depth.md](./0057-erp-authorization-core-business-units-and-scope-depth.md) | ERP-Grade Authorization Core — Business-Unit Partitioning, Scope-Depth Grants, and Hierar… | Accepted — in part (2026-06-21) — D1–D3/D8 implemented (scope-depth enum +… | 2026-06-21 |
| `ADR-0057-system-data-lifecycle-and-retention` | [0057-system-data-lifecycle-and-retention.md](./0057-system-data-lifecycle-and-retention.md) | System data has a lifecycle — declarative retention, rotation, and reclamation for platfo… | Accepted — P0–P4 implemented (P0 shipped with this ADR, #2079; P1–P4 in #2… | 2026-06-20 |

## Records — `docs/adr/`

| Number | Title | Status | Date | Supersedes | Superseded by |
|---|---|---|---|---|---|
| [ADR-0001](./0001-withdrawn-metadata-service-architecture.md) | Withdrawn — this number is retired and must not be reused | Withdrawn — 2026-02-11. This file is a tombstone, not a decision: nothing i… | 2026-02-11 | — | — |
| [ADR-0002](./0002-environment-database-isolation.md) | Environment-Per-Database Isolation | Accepted | 2026-04-19 | *The v3.4/v4.0 "per-organization databas…* | — |
| [ADR-0003](./0003-package-as-first-class-citizen.md) | Package as First-Class Citizen with Versioned Releases | Accepted — revised by cloud ADR-0007 (2026-06-12): `syspackageinstallation… | 2026-04-20 | ADR-0002 | cloud ADR-0007 |
| [ADR-0004](./0004-cloud-multi-kernel.md) | Cloud Control Plane + Per-Project Kernels | Superseded — 2026-04-23 — the physical split between `apps/cloud` | 2026-04-22 | — | — |
| [ADR-0005](./0005-metadata-customization-overlay.md) | Metadata Customization Overlay (Artifact + sysmetadata Delta) | Accepted — 2026-05-16 · Amended (2026-05-22, see "Amendment: post-ADR-0006… | 2026-05-16 | — | — |
| [ADR-0006](./0006-project-environment-split.md) | Environment & Project as Independent Siblings — v3 | Superseded — by v4 (`0006-project-environment-split.v4.md`) — 2026-05-20 | 2026-05-20 | v1, v2 | ADR-0006 v4 |
| [ADR-0006 v2](./0006-project-environment-split.v2.md) | Three-Layer Tenancy — Organization, Project, Environment | Superseded — by v4 (`0006-project-environment-split.v4.md`) — 2026-05-20 | 2026-05-20 | — | ADR-0006 v4 |
| [ADR-0006 v4](./0006-project-environment-split.v4.md) | Environment & Project — v4 (drop dev-workspace Project, unify on Package) | Accepted — v4 — supersedes v3 — API-surface vocabulary boundary recorded 2… | 2026-05-20 | v1, v2, v3 | — |
| [ADR-0007](./0007-settings-manifest-and-kv-store.md) | Settings — Manifest + K/V Store + Resolver (Apple-style) | Accepted — backend implemented; UI pending (objectui) (proposed 2026-05-20… | 2026-05-20 | — | — |
| [ADR-0008](./0008-metadata-repository-and-change-log.md) | Metadata Repository, Change Log & Subscription (M0 → M4) | Accepted — 2026-05-22 · Amended 2026-04-13 — branch concept removed (see §… | 2026-05-22 | *ad-hoc HMR wiring in `packages/metadata…* | — |
| [ADR-0009](./0009-execution-pinned-metadata.md) | Execution-Pinned Metadata | Accepted | 2026-05-22 | — | — |
| [ADR-0010-metadata-protection-model](./0010-metadata-protection-model.md) | Metadata Protection Model | Accepted — 2026-10-27 (ruled on objectstack#26553, ADR batch 1; proposed 2… | 2026-05-29 | — | — |
| [ADR-0010-nl-to-flow-authoring](./0010-nl-to-flow-authoring.md) | Natural-Language → Flow Authoring (Platform Capability) | Draft — 2026-05-24 | 2026-05-24 | — | — |
| [ADR-0011](./0011-actions-as-ai-tools.md) | Actions as AI Tools (Operational Parity) | Accepted — implemented (2026-06-04) | 2026-06-04 | — | — |
| [ADR-0012](./0012-notification-platform.md) | Messaging Platform — Outbound Notifications on a Generalized Outbox | Draft — 2026-05-25 · scope-revised 2026-05-26 · Superseded by ADR-0030… | 2026-05-25 | — | ADR-0030 |
| [ADR-0013](./0013-bidirectional-messaging.md) | Bidirectional Messaging — Conversational Channels, Slack First | Draft — 2026-05-26 | 2026-05-26 | — | — |
| [ADR-0014](./0014-record-form-field-type.md) | `record` Form Field Type | Accepted | 2026-04-17 | — | — |
| [ADR-0015](./0015-external-datasource-federation.md) | External Datasource Federation | Accepted — backend/REST/CLI implemented; Studio UI + extra dialect drivers… | 2026-05-29 | — | — |
| [ADR-0016](./0016-studio-package-authoring-and-publish.md) | Studio Package Authoring & One-Click Publish | Partially implemented — revised 2026-05-30 | 2026-05-30 | — | — |
| [ADR-0017](./0017-object-has-many-view.md) | Object has-many View (Independent View Entities) | Accepted — · Implemented Phases 1–4 (2026-05-30) · Phase 5 (Studio designe… | 2026-05-30 | — | — |
| [ADR-0018](./0018-unified-node-action-registry.md) | Unified Node/Action Registry across Flow, Workflow-Rule & Approval | Accepted — 2026-05-31 — M1–M3 implemented; M4 framework-side complete (des… | 2026-05-31 | — | — |
| [ADR-0019-app-as-consumer-unit](./0019-app-as-consumer-unit.md) | App as the Consumer-Facing Unit | Accepted — 2026-10-27 (ruled on objectstack#26553, ADR batch 1; proposed 2… | 2026-05-31 | — | — |
| [ADR-0019-approval-as-flow-node](./0019-approval-as-flow-node.md) | Collapse Approval into Flow — one engine, approval as a durable-pause node | Accepted — 2026-05-31 — fully implemented (A1–A5) | 2026-05-31 | — | — |
| [ADR-0020](./0020-state-machine-converge-and-enforce.md) | State Machine — converge three declaration forms to one enforced `statemachine` | Accepted — Implemented (2026-05-31) | 2026-05-31 | — | — |
| [ADR-0021](./0021-analytics-dataset-semantic-layer.md) | Analytics — one semantic `dataset` layer, `report` / `dashboard` become pure presentation | Accepted — & shipped — Phase 2 closed 2026-06-10. The author-surface conve… | 2026-06-10 | — | — |
| [ADR-0022](./0022-connectors-vs-messaging-channels.md) | Connectors vs Messaging Channels — Where "Push to Slack" Lives | Accepted — 2026-10-27 (ruled on objectstack#26553, ADR batch 1; proposed 2… | 2026-10-27 | — | — |
| [ADR-0023](./0023-openapi-to-connector-generator.md) | OpenAPI → Connector Generator — Bulk Connectors From Declarative API Specs | Accepted — library implemented; CLI + examples pending (proposed 2026-06-0… | 2026-06-01 | — | — |
| [ADR-0024](./0024-mcp-connectors.md) | MCP Servers as Connectors — Adopting an Open, Vendor-Neutral Tool Protocol | Accepted — library implemented; examples pending (proposed 2026-06-01 · ca… | 2026-06-01 | — | — |
| [ADR-0025](./0025-plugin-package-distribution.md) | Plugin Package Distribution (Code + Dependencies) | Accepted — 2026-10-28 (ruled on objectstack#26553, ADR batch 4; proposed 2… | 2026-10-28 | — | — |
| [ADR-0026](./0026-client-ui-plugin-distribution.md) | Client-Side UI Plugin Distribution | Deferred — 2026-10-27 (ruled on objectstack#26553, ADR batch 1; proposed 2… | 2026-10-27 | — | — |
| [ADR-0027](./0027-metadata-authoring-lifecycle.md) | `@objectstack/metadata-authoring` — Staged Authoring, Publish & Promotion Lifecycle | Accepted — 2026-10-27 (ruled on objectstack#26553, ADR batch 1; proposed 2… | 2026-10-27 | — | — |
| [ADR-0028](./0028-metadata-naming-and-namespace-isolation.md) | Metadata Naming & Namespace Isolation — Derived Physical Names, Namespace-Scoped Identity, and a Single Kerne… | Deferred — 2026-07-16; proposed 2026-06-01 — the target model (namespace a… | 2026-07-16 | ADR-0129 | — |
| [ADR-0029](./0029-kernel-object-ownership-and-platform-objects-decomposition.md) | Kernel Object Ownership — First-Party Capabilities as Plugins That Own Their Data, and Decomposing the `platf… | Accepted — K0/K1/K2/D7 implemented; K3 (pending ADR-0030/storage) + K4 cle… | 2026-06-01 | — | — |
| [ADR-0030](./0030-notification-platform-convergence.md) | Notification Platform Convergence (single ingress, layered pipeline) | Accepted — 2026-06-01 — P0–P3b2 shipped (P3b-2 digest collapse landed); cr… | 2026-06-01 | ADR-0012 | — |
| [ADR-0031](./0031-advanced-flow-node-executors-and-dag.md) | Structured control-flow for flows (loop / parallel / try-catch) — native + AI-authored, BPMN as interop | Accepted — 2026-06-02 — implemented in #1482 (spec + loop), #1489 (paralle… | 2026-06-02 | — | — |
| [ADR-0032](./0032-unified-expression-layer.md) | Expression layer for an AI-authored platform — validate-by-default, schema-aware, one CEL language, no silent… | Accepted — implemented; designer builders pending (objectui) (proposed 202… | 2026-06-02 | — | — |
| [ADR-0033](./0033-ai-assisted-metadata-authoring.md) | AI-assisted metadata authoring — one agent brain, draft-gated review, type-agnostic apply, open-core boundary | Accepted — 2026-06-02 | 2026-06-02 | — | cloud ADR-0025 |
| [ADR-0034](./0034-transactional-writes-and-ambient-transaction.md) | Robust multi-write transactions (ambient transaction context) | Accepted — implemented (v8.0.0) (calibrated 2026-06-12) | 2026-06-12 | — | — |
| [ADR-0035](./0035-config-driven-master-detail.md) | Config-driven master-detail (declare on the relationship, forms derive) | Accepted — · Amended (2026-10-28, #27069, maintainer rulings on that card:… | 2026-10-28 | — | — |
| [ADR-0036](./0036-app-as-rest-api-and-mcp-server.md) | Every app is a REST API + an MCP server — make it visible and connectable after build | Accepted — framework implemented; cloud surfacing pending (proposed 2026-0… | 2026-06-06 | — | — |
| [ADR-0037](./0037-live-canvas-draft-preview.md) | Live Canvas — draft-overlay live preview while you build | Accepted — 2026-06-10 — all four phases implemented: `previewDrafts` reads… | 2026-06-10 | — | — |
| [ADR-0038](./0038-build-verification-loop.md) | Build Verification Loop — the agent builds, verifies, and corrects itself | Accepted — 2026-10-28 (ruled on objectstack#26553, ADR batch 2; proposed 2… | 2026-10-28 | — | cloud ADR-0025 |
| [ADR-0039](./0039-token-scope-tree-execution.md) | Concurrent durable pause — multi-instance nodes now, token/scope-tree later | Accepted — Track A implemented; Track B deferred (proposed 2026-06-11, rev… | 2026-06-11 | — | — |
| [ADR-0040](./0040-unified-assistant-and-agent-binding.md) | Unified Assistant — the end user never picks an agent | Superseded — by ADR-0063 — original: Proposed (2026-06-11) | 2026-06-11 | — | ADR-0063, cloud ADR-0025 |
| [ADR-0041](./0041-flow-trigger-family.md) | Flow trigger family — taxonomy, naming, and the open-source core set | Accepted — Tier 1 implemented (rename deprecation stubs pending) (proposed… | 2026-06-12 | — | — |
| [ADR-0042](./0042-approval-sla-escalation.md) | Approval SLA escalation — a jobs-backed scanner with audit-row idempotency | Accepted — implemented (proposed 2026-06-12 · calibrated 2026-06-12) | 2026-06-12 | — | — |
| [ADR-0043](./0043-actionable-approval-links.md) | Actionable approval links — single-use tokens with a session-less confirm page | Accepted — implemented (proposed 2026-06-12 · calibrated 2026-06-12) · Ame… | 2026-06-12 | — | — |
| [ADR-0044](./0044-approval-send-back-for-revision.md) | Flow-level send-back-for-revision — `revise` branch + typed back-edge re-entry | Accepted — engine + model implemented; designer pending (objectui) (propos… | 2026-06-12 | — | — |
| [ADR-0045](./0045-additive-materialization-and-visibility-gate.md) | Additive materialization with a visibility gate — drafts narrow to mutations | Accepted — 2026-06-12 · Amended 2026-08-09 (#4829, maintainer ruling 2026-… | 2026-06-12 | — | — |
| [ADR-0046](./0046-package-docs-as-metadata.md) | Package documentation as metadata — flat `src/docs/.md` compiled into the manifest | Accepted — 2026-10-28 (ruled on objectstack#26553, ADR batch 2; proposed 2… | 2026-10-28 | — | — |
| [ADR-0047](./0047-object-ui-run-modes.md) | Two run modes for object UI — data views vs interface pages, user filters, and runtime visualization choice | Accepted — 2026-06-12; revised 2026-06-19 — framework scope implemented (`… | 2026-06-12 | — | — |
| [ADR-0048](./0048-cross-package-metadata-collision.md) | Cross-package metadata collision — package-id identity, namespace install gate, package-scoped resolution | Revised — 2026-06-13 — supersedes the original per-item collision | 2026-06-13 | — | — |
| [ADR-0049](./0049-no-unenforced-security-properties.md) | Spec must not declare security properties the runtime does not enforce (enforce-or-remove gate) | Accepted — 2026-06-15 — implemented: fail-closed `DESTRUCTIVEOPERATIONS` (… | 2026-06-15 | — | — |
| [ADR-0050](./0050-form-layout-vs-presentation.md) | Form layout vs presentation — split the overloaded `FormView.type` | Proposed — 2026-06-15 · Amended (2026-10-20, letter B′ on #24692, ruling r… | 2026-06-15 | — | — |
| [ADR-0051](./0051-inline-metadata-views-in-docs.md) | Inline metadata views in docs — the ` ```metadata ` fenced block | Accepted — 2026-10-28 (ruled on objectstack#26553, ADR batch 2; proposed 2… | 2026-10-28 | — | — |
| [ADR-0052](./0052-audit-is-not-the-activity-feed.md) | Audit is not the activity feed — decompose collaboration, activity, and audit into bounded contexts | Accepted — 2026-10-28 (ruled on objectstack#26553, ADR batch 2; proposed 2… | 2026-10-28 | — | — |
| [ADR-0053](./0053-date-and-datetime-semantics.md) | `date` is a timezone-naive calendar day; `datetime` is an instant rendered in a reference timezone | Accepted — 2026-06-16 — Phase 1 + addendum D-A1 implemented (`sql-driver.t… | 2026-06-16 | — | — |
| [ADR-0054](./0054-runtime-proof-for-authorable-surface.md) | A live authorable property must be proven at runtime, not merely have a consumer (prove-it-runs gate) | Accepted — 2026-06-18 | 2026-06-18 | — | — |
| [ADR-0055](./0055-master-detail-controlled-by-parent.md) | Master-detail "controlled by parent" permissions — derived access via pre-resolved master-id membership | Accepted — 2026-06-19 — implemented in this PR (P0–P2) · Amended (2026-09-… | 2026-06-19 | — | — |
| [ADR-0056](./0056-permission-model-landing-verification.md) | Permission Model Landing Verification — Whole-Model Enforce / Prove / Reconcile Audit | Accepted — 2026-06-20 — landed per the implementation-status addendum (D2… | 2026-06-20 | — | ADR-0090 |
| [ADR-0057-erp-authorization-core-business-units-and-scope-depth](./0057-erp-authorization-core-business-units-and-scope-depth.md) | ERP-Grade Authorization Core — Business-Unit Partitioning, Scope-Depth Grants, and Hierarchy Rollup | Accepted — in part (2026-06-21) — D1–D3/D8 implemented (scope-depth enum +… | 2026-06-21 | ADR-0056 | ADR-0090, ADR-0095 |
| [ADR-0057-system-data-lifecycle-and-retention](./0057-system-data-lifecycle-and-retention.md) | System data has a lifecycle — declarative retention, rotation, and reclamation for platform-generated objects | Accepted — P0–P4 implemented (P0 shipped with this ADR, #2079; P1–P4 in #2… | 2026-06-20 | — | — |
| [ADR-0058](./0058-expression-and-predicate-surface.md) | The Expression & Predicate Surface — One Authoring Language, Two Backends, and the Pushdown-Compiler Reconcil… | Accepted — 2026-06-21 — implemented: canonical CEL→Filter compiler (`formu… | 2026-06-21 | ADR-0056, ADR-0057 | — |
| [ADR-0059](./0059-third-party-backward-compatibility-gates.md) | Third-party backward compatibility is proven by layered gates, not by in-repo consumers | Accepted — 2026-06-21 | 2026-06-21 | — | — |
| [ADR-0060](./0060-conformance-ledger-platform-pattern.md) | Conformance Ledger as a Platform Pattern | Accepted — P1–P2 implemented; D5 landed-bar in force; D6 (CI aggregate) de… | 2026-06-21 | — | — |
| [ADR-0061](./0061-record-search-architecture.md) | Record Search Architecture — metadata-driven `$search` resolution | Accepted — 2026-06-21; Tier 1 — implemented and conformance-closed per thi… | 2026-06-21 | — | — |
| [ADR-0062](./0062-external-datasource-runtime.md) | External Datasource Runtime — connection lifecycle, credentials, visibility & query completeness | Accepted — 2026-06-22 — D1–D8 implemented. D1 fully implemented across bot… | 2026-06-22 | ADR-0015 | — |
| [ADR-0063](./0063-two-kernel-agents-skills-are-the-extension-primitive.md) | Two agents (`ask` / `build`), bound by surface; skills are the only third-party extension primitive | Accepted — 2026-10-28 (ruled on objectstack#26553, ADR batch 3; proposed 2… | 2026-10-28 | ADR-0040, ADR-0064 | cloud ADR-0025 |
| [ADR-0064](./0064-tool-scoping-to-agent.md) | Tool scoping — an agent's tools are exactly its skills' tools | Accepted — 2026-10-28 (ruled on objectstack#26553, ADR batch 3; proposed 2… | 2026-10-28 | — | cloud ADR-0025 |
| [ADR-0065](./0065-sdui-styling-model.md) | SDUI styling model — scoped style-objects over arbitrary Tailwind classes | Accepted — 2026-06-22 — open-mechanism half implemented: `style`/`responsi… | 2026-06-22 | — | — |
| [ADR-0066](./0066-unified-authorization-model.md) | Unified authorization model — capability registry, secure-by-default posture, resource→capability contracts,… | Accepted — 2026-06-23 — D1–D5 + refinements ⑤/⑨ implemented (capability re… | 2026-06-23 | — | — |
| [ADR-0067](./0067-commit-history-and-rollback-for-ai-authoring.md) | Commit history and rollback for AI authoring — turns become atomic, revertible commits | Accepted — 2026-06-24; completed 2026-07-16 · Amended (2026-08-06, #5351/#… | 2026-06-24 | — | — |
| [ADR-0068](./0068-unified-user-context-and-built-in-identity-roles.md) | Unified user-context contract & built-in identity roles — one `currentuser` shape across formula/RLS/client,… | Accepted — 2026-06-24 — implemented under the position model: `EvalUser` f… | 2026-06-24 | — | — |
| [ADR-0069](./0069-enterprise-authentication-hardening.md) | Enterprise authentication hardening — password policy, enforced MFA, SSO, session controls, network gating, a… | Accepted — P1 + P2 implemented (2026-07-04); P3 partially landed (see Adde… | 2026-07-04 | — | — |
| [ADR-0070](./0070-package-first-authoring.md) | Package-first authoring — every runtime-authored item lives in a writable package (base); no orphans | Accepted — 2026-06-24 — P1–P3 implemented, merged & live-verified (see Imp… | 2026-06-24 | — | — |
| [ADR-0071](./0071-dataset-semantic-layer-depth.md) | Dataset semantic-layer depth — multi-hop joins | Accepted — 2026-10-28 (ruled on objectstack#26553, ADR batch 3; proposed 2… | 2026-10-28 | — | — |
| [ADR-0072](./0072-reference-scope-and-resolvability.md) | Reference Scope & Resolvability — the authored-expression data-picker model (#1934) | Accepted — 2026-10-28 (ruled on objectstack#26553, ADR batch 3; proposed 2… | 2026-10-28 | — | — |
| [ADR-0073](./0073-automation-execution-identity.md) | Automation execution identity — a built-in non-human principal for user-less runs, `runAs` as authorization p… | Accepted — 2026-10-28 (ruled on objectstack#26553, ADR batch 3; proposed 2… | 2026-10-28 | — | — |
| [ADR-0074](./0074-canonical-audit-timestamp-storage-on-sqlite.md) | Audit timestamps are stored in one canonical, timezone-explicit format on SQLite | Accepted — 2026-06-26. Read side extended (2026-09-07): the read repair th… | 2026-06-26 | — | — |
| [ADR-0076](./0076-objectql-core-tiering.md) | objectql is the data engine — relocate metadata management (protocol) out of it; enforce the boundary; defer… | Accepted — D1/D2/D4/D5/D6/D8/D9 implemented; D10/D12 partially landed; D11… | 2026-08-15 | — | — |
| [ADR-0077](./0077-authoring-surface-boundary-hook-flow-validation.md) | The authoring-surface boundary — route by intent, not mechanism; verifiability tier = friction tier; loud-not… | Accepted — 2026-10-28 (ruled on objectstack#26553, ADR batch 4; proposed 2… | 2026-10-28 | — | — |
| [ADR-0078](./0078-no-silently-inert-metadata.md) | A Zod-valid metadata instance that is functionally incomplete must fail loudly at author time, uniformly acro… | Accepted — framework implemented; the cloud half of §2/§3 pending (cloud)… | 2026-06-28 | — | — |
| [ADR-0079](./0079-record-display-name.md) | The record display-name contract — `nameField` is the one canonical primary-title pointer | Accepted — implemented. This file is a RETROACTIVE RECONSTRUCTION written… | 2026-06-28 | — | — |
| [ADR-0080](./0080-ai-authored-ui-jsx-source.md) | AI-authored UI pages — JSX source compiled to the SDUI tree (parse ≠ execute); the component registry is the… | Accepted — 2026-10-28 (ruled on objectstack#26553, ADR batch 4; proposed 2… | 2026-10-28 | — | ADR-0065 |
| [ADR-0081](./0081-trusted-react-page-tier.md) | A trusted `kind:'react'` page tier — real React executed in the main tree, gated by a host capability; and re… | Accepted — 2026-06-30 — framework scope implemented (`html`/`react` page k… | 2026-06-30 | — | ADR-0065 |
| [ADR-0082](./0082-react-component-contract-governance.md) | Governing the react-tier component contract — spec is the protocol source of truth, the registry is a designe… | Accepted — 2026-06-30 | 2026-06-30 | — | — |
| [ADR-0084](./0084-application-builder-information-architecture.md) | Application-builder information architecture — four content pillars + Settings/Advanced | Accepted — 2026-07-01 | 2026-07-01 | — | — |
| [ADR-0085](./0085-object-semantic-roles-over-surface-hint-blocks.md) | Presentation intent on an object is declared as cross-surface semantic roles, never as per-surface hint block… | Accepted — 2026-07-16 — proposed 2026-07-02; execution complete through PR… | 2026-07-16 | *the `detail.` passthrough-block approac…* | — |
| [ADR-0086](./0086-authz-metadata-config-boundary-and-cross-package-composition.md) | Authorization metadata↔config boundary + cross-package composition — DEFINITION travels, ASSIGNMENT stays, pa… | Accepted — 2026-07-04 — substantially implemented; parts refined/supersede… | 2026-07-04 | — | ADR-0090, ADR-0094 |
| [ADR-0087](./0087-metadata-protocol-upgrade-contract.md) | Metadata protocol upgrades for AI consumers — conversion over notification, executable migrations, machine-ve… | Accepted — 2026-07-04, #2582 · trued up to as-built 2026-07-15 (see Addend… | 2026-07-04 | — | — |
| [ADR-0088](./0088-metadata-kind-admission-and-retirement.md) | Metadata-kind admission test; retire `trigger`, `router`, `function`, `service` | Accepted — 2026-07-05 · Amended (2026-10-16, #23787 — #23128 ruling C′ ite… | 2026-07-05 | — | — |
| [ADR-0089](./0089-unify-visibility-predicate-naming.md) | Unify the conditional-visibility predicate under one name (`visibleWhen`), alias the rest | Accepted — 2026-07-14 — D1 + D2 + codemod + docs implemented in #2642/#290… | 2026-07-14 | — | — |
| [ADR-0090](./0090-permission-model-v2-concept-convergence.md) | Permission Model v2 — Concept Convergence, Final Naming, and AI-Authoring Safety | Accepted — 2026-07-09 | 2026-07-09 | ADR-0056 | — |
| [ADR-0091](./0091-grant-lifecycle-and-recertification.md) | Grant lifecycle — effective-dated assignments, delegation, break-glass, recertification substrate | Accepted | 2026-07-09 | — | — |
| [ADR-0092](./0092-sys-user-profile-field-delegation.md) | Identity-table write guard — engine-enforced `managedBy: 'better-auth'`, with sysuser profile fields as the f… | Accepted | 2026-07-10 | — | — |
| [ADR-0093](./0093-tenancy-mode-and-membership-lifecycle.md) | Tenancy mode as a first-class capability, and a single owner for the user→membership lifecycle | Accepted — 2026-07-13 — implemented: `tenancy` kernel service (`plugin-aut… | 2026-07-13 | — | — |
| [ADR-0094](./0094-sys-permission-set-pure-projection.md) | Permission-Set Definitions Have One Authoritative Store — `syspermissionset` Becomes a Pure Projection | Accepted — 2026-07-14; D5 retired 2026-08-09 (see D5-R) · Amended (2026-10… | 2026-07-14 | — | — |
| [ADR-0095](./0095-authz-kernel-tenant-layer-and-posture-ladder.md) | Authorization Kernel Chain — Tenant Isolation as Layer 0, a Monotonic Posture Ladder, Capability-Derived Post… | Accepted — 2026-07-14 — implemented: D1 tenant Layer 0 (`plugin-security/s… | 2026-07-14 | — | — |
| [ADR-0096](./0096-execution-surface-identity-admission.md) | Execution-Surface Identity Admission — no data-engine call without an explicit principal or an explicit, audi… | Accepted — 2026-10-28 (ruled on objectstack#26553, ADR batch 4; proposed 2… | 2026-10-28 | — | — |
| [ADR-0097](./0097-declarative-connector-instances.md) | Declarative Connector Instances — Provider-Bound `connectors:` Entries Materialized by Generic Executors | Accepted — 2026-07-15 — implemented in framework#2977 | 2026-07-15 | — | — |
| [ADR-0098](./0098-pinyin-search-companion-column.md) | Pinyin Search via a Locale-Gated Companion Column | Accepted | 2026-07-16 | — | — |
| [ADR-0099](./0099-posture-adjudicated-tiering-and-external-rung.md) | Posture-Adjudicated Tiering — one axis for tier decisions, the EXTERNAL rung's enforcement path, no explicit… | Accepted — 2026-07-18; proposed 2026-07-17 — P0 equivalence gate landed wi… | 2026-07-18 | — | — |
| [ADR-0100](./0100-credential-field-channels.md) | Credential Field Channels — `secret` (encrypted) and `password` (masked) | Accepted | 2026-07-18 | — | — |
| [ADR-0101](./0101-mcp-stdio-principal-admission.md) | MCP stdio Principal Admission — env-supplied API-key identity, fail-closed, no system bypass | Accepted — 2026-07-19 — v1 landed with this acceptance (#3246): key→EC thr… | 2026-07-19 | — | — |
| [ADR-0102](./0102-sandbox-cpu-budget-and-engine-variant.md) | Sandbox Execution Budget & Engine Variant — CPU-time budget with a wall ceiling; per-invocation sync WASM mod… | Accepted — 2026-07-19 — D1 + D2 landed: Phase 1 (#3295 / PR #3301) shipped… | 2026-07-19 | — | — |
| [ADR-0103](./0103-managedby-write-policy-and-engine-write-guard.md) | `managedBy` write policy — split the overloaded `system` bucket, enforce engine-owned writes | Accepted — (D5 completed in v17 — see the #3355 addendum at the end: | 2026-07-19 | — | — |
| [ADR-0104](./0104-field-runtime-value-shape-contract.md) | Field runtime value-shape as a first-class contract — spec-owned value schemas, typed action handlers, file-a… | Accepted — 2026-07-22 — staged per D4. D1 landed (#3429), D2 | 2026-07-22 | — | — |
| [ADR-0105](./0105-group-tenancy-posture-and-first-class-org-scope.md) | Group Tenancy Posture — Organization Scope as a First-Class Authorization Dimension | Accepted — 2026-07-27; proposed 2026-07-25 — Phase 0/1 implemented (#3559)… | 2026-07-27 | — | — |
| [ADR-0106](./0106-metadata-plane-fls-object-schema-masking.md) | Metadata-Plane Field-Level Security — Per-Caller Masking of Object Schemas | Accepted — 2026-07-27; implemented 2026-08-08 — #3682 | 2026-07-27 | — | — |
| [ADR-0107](./0107-withdrawn-hook-body-write-set-static-gap.md) | Withdrawn — this number is retired and must not be reused | Withdrawn — 2026-07-28. This file is a tombstone, not a decision: nothing i… | 2026-07-28 | — | — |
| [ADR-0108](./0108-membership-grade-is-not-a-capability-channel.md) | Membership Grade Is Not a Capability Channel — the `sysmember.role` Vocabulary Is Closed | Accepted — 2026-07-28 — implemented in the same PR: the two `role` selects… | 2026-07-28 | — | — |
| [ADR-0109](./0109-ai-tool-authoring-model.md) | The AI tool authoring model — the default third-party path needs no tool records | Accepted — implemented (Phase 1) (2026-07-28; revised same day before acce… | 2026-07-28 | — | — |
| [ADR-0110](./0110-action-identity-and-declaration-admission.md) | An action's identity is its `name`; anything executable over a governed surface must have a declaration (the… | Accepted — implemented (2026-07-29) in protocol 17 (`@objectstack/spec@17.… | 2026-07-29 | — | — |
| [ADR-0111](./0111-record-share-management-authority-and-verb-boundary.md) | Record-share management authority and the verb boundary — sharing needs "who may manage a share" and "which v… | Accepted — 2026-07-30 — P0 + P1 + D8 (framework) implemented. P0 (D1/D2/D4… | 2026-07-30 | — | — |
| [ADR-0112](./0112-error-code-vocabulary-and-ledger.md) | One error-code vocabulary — SCREAMINGSNAKE on the wire, a closed standard catalog plus a registered extension… | Accepted — 2026-07-30 | 2026-07-30 | — | — |
| [ADR-0113](./0113-required-write-contract-vs-column-constraint.md) | `required` is a write-time contract — the column constraint becomes its own, explicitly-authored axis | Accepted — 2026-07-30 — Q1/Q2/Q3 adjudicated same day (uniform semantics;… | 2026-07-30 | — | — |
| [ADR-0114](./0114-field-level-error-code-catalog.md) | Field-level error codes name the violated constraint — a closed lowercase catalog, and Zod stops leaking onto… | Accepted — 2026-07-30 | 2026-07-30 | — | — |
| [ADR-0115](./0115-plugin-dev-assembly-not-stub-table.md) | The stub table is retired — plugin-dev assembles real plugins, and an empty slot means the same thing in ever… | Accepted — 2026-07-30 | 2026-07-30 | — | — |
| [ADR-0116](./0116-plugin-ordering-declared-contract.md) | Plugin ordering is a declared contract — soft dependencies plus validated init-service requirements | Accepted — 2026-07-30 | 2026-07-30 | — | — |
| [ADR-0117](./0117-owning-business-unit-record-stamp.md) | 记录级业务单元归属（owning business unit） | Accepted — D1/D3 scoped（2026-08-05）—— 仅 D1（`ownership` 新增 | 2026-07-31 | — | — |
| [ADR-0118](./0118-non-user-actor-contract.md) | 非用户 actor 的平台契约 —— null 表示、fail-closed、显式 `isSystem` | Accepted — （2026-08-02，维护者按四轴框架裁决：平台长远合理性 / 防 AI 作者静默犯错 / 实际业务需求 / 创业阶段不扩边… | 2026-08-02 | — | — |
| [ADR-0119](./0119-plugin-reachable-transactions-and-honest-atomic-batch.md) | Multi-write atomicity is reachable through the contract, `atomic` means atomic or refuses, and migrations too… | Accepted — 2026-08-02 · Amended (2026-08-06, #5351/#5696 — D1's two caveat… | 2026-08-02 | — | — |
| [ADR-0120](./0120-unique-scope-vocabulary-and-null-safe-tenant-uniqueness.md) | Uniqueness scope is an explicit vocabulary — declared-index organization scoping and NULL-safe per-organizati… | Accepted — 2026-08-04, maintainer decision on #4986 / #5030; proposed same… | 2026-08-04 | — | — |
| [ADR-0121](./0121-declarative-endpoint-routing-namespace-and-channel-split.md) | 声明式端点的路由归属与通道分工 —— 命名空间制、actions/apis 按调用方分工、`type: flow` 保留 | Accepted — （2026-08-04，维护者裁决；本记录只立规则，执行体由 #5040 的 E 系列实施） | 2026-08-04 | — | — |
| [ADR-0122](./0122-schema-type-alias-naming-convention.md) | One naming family for schema type aliases — bare name is the author state, `XParsed` is the parsed state | Accepted — 2026-08-06 — ruled by the maintainer on 2026-08-06 on the #5551… | 2026-08-06 | — | — |
| [ADR-0123](./0123-no-active-organization-session-semantics.md) | An authenticated session with no active organization is a legal state — reads resolve to nothing, tenant-scop… | Accepted — 2026-08-13 | 2026-08-13 | — | — |
| [ADR-0124](./0124-server-enforces-client-is-courtesy.md) | The server is the enforcement point; client-side gating is a usability courtesy | Accepted — 2026-08-18 — retroactive recording of an already-practised rule… | 2026-08-18 | — | — |
| [ADR-0125](./0125-release-approval-gate-replaces-the-typed-version.md) | The human act that authorises a release is the environment approval, not a typed version string | Accepted — 2026-08-20 — accepted by the merge that landed it on `main` (#1… | 2026-08-20 | — | — |
| [ADR-0126](./0126-packaged-metadata-customization-model.md) | The platform customization model for packaged metadata — three regimes, one activation ledger | Amended — 2026-09-04 by ADR-0131 D6 — maintainer, verbatim: 「所以 ADR-0126… | 2026-09-04 | — | — |
| [ADR-0127](./0127-authorization-cache-invalidation-contract-and-ttl-bound.md) | No authorization answer is cached without a declared invalidation contract and a TTL bound | Accepted — 2026-08-25 — maintainer ruling on #11633, verbatim 「接受你的建议，继续」,… | 2026-08-25 | — | — |
| [ADR-0128](./0128-producer-discriminated-aad-for-cryptocontext.md) | The AAD binding on `CryptoContext` is producer-discriminated | Accepted — 2026-09-07 — accepted by the maintainer's reply of 2026-09-07 (… | 2026-09-07 | — | — |
| [ADR-0129](./0129-object-name-is-the-canonical-id.md) | Object `name` is the canonical id — literal module prefix, no separate `namespace` field | Accepted — (2026-08-29; maintainer ruling on #12918, option 甲 — recorded a… | 2026-08-29 | — | — |
| [ADR-0130](./0130-release-artifact-as-co-ownership-boundary.md) | The release artifact is the co-ownership boundary — one artifact, N packages | Accepted — 2026-09-01 — accepted by the merge that landed it on `main` (#1… | 2026-09-01 | — | — |
| [ADR-0131](./0131-total-organization-ownership-no-null-organization-id.md) | Organization ownership is total — no NULL `organizationid`; declared metadata stays in code; a row exists onl… | Accepted — 2026-09-04 — accepted by the merge that landed it on `main` (#1… | 2026-09-04 | — | — |
| [ADR-0132](./0132-multi-organization-runtime-is-open-core.md) | The multi-organization runtime is open core — single-database organization isolation ships open; only the ent… | Accepted — 2026-09-07 — accepted by the merge that landed it on `main` | 2026-09-07 | — | — |
| [ADR-0133](./0133-org-management-open-basics.md) | Organization management — the open basics; a mirror of cloud ADR-0081 D1/D3/D4 in the repository whose code e… | Accepted — 2026-09-07 — accepted by the merge that landed it on `main` (#1… | 2026-09-07 | — | — |
| [ADR-0134](./0134-env-side-scim-provisioning.md) | Env-side SCIM provisioning — `@better-auth/scim` is the mechanism, and this platform writes the deactivation | Proposed — 2026-09-07. This file is a MIRROR of the open, mechanism half of | 2026-09-07 | — | — |
| [ADR-0135](./0135-identity-and-access-architecture.md) | Identity and access architecture — the open half, mirrored from cloud ADR-0024 | Accepted — The DECISION is — it is `objectstack-ai/cloud` ADR-0024, accept… | 2026-06-25 | — | — |
| [ADR-0137](./0137-predicate-fault-semantics-are-contract.md) | A predicate's FAULT semantics are part of the protocol — loud at submit, fail-open at render, and a blank pre… | Accepted — 2026-09-18 — this record declares; it implements nothing. D1's… | 2026-09-18 | — | — |
| [ADR-0138](./0138-guest-model-anonymous-principal-doors-grants-and-organization.md) | The guest model — one anonymous principal, a closed list of doors, one grants channel, one organization rule,… | Accepted — 2026-10-13, accepted by the maintainer's approval of the pull r… | 2026-10-13 | — | — |
| [ADR-0139](./0139-engine-internal-semi-join-leaf-readable-parent-ids.md) | One engine-internal semi-join leaf — "the ids of object X this caller may read" — pushed down by ObjectQL, ne… | Accepted — 2026-10-11, accepted by the merge that landed it on `main` | 2026-10-11 | — | — |
| [ADR-0141](./0141-inter-app-dependency-declared-checked-before-install.md) | An app may depend on another installed app — declared in `manifest.dependencies`, checked once before install… | Proposed — 2026-10-25; first draft 2026-10-24. `docs/adr/` is Tier H (Prim… | 2026-10-25 | — | — |
| [ADR-0142](./0142-ownership-queue-membership-claim-and-assignment-rules.md) | An ownership queue is a platform primitive — a queue entity, membership through the existing recipient kinds,… | Proposed — 2026-10-25 · Amended (2026-10-28, ruling `6457475657` on #25769… | 2026-10-25 | — | — |
| [ADR-0143](./0143-outbound-connector-auth-is-open-tier.md) | Outbound connector auth is open tier — OAuth2 grants, vendor app-credential exchange and request signing in o… | Accepted — 2026-10-28. Proposed 2026-10-27 (#26833, which also landed the… | 2026-10-28 | — | — |
| [ADR-0145](./0145-ui-deprecation-tombstones-retire-on-the-spec-window.md) | A `?: never` tombstone on the ui authoring face retires on the spec's own window — one major after the retire… | Accepted — 2026-10-28, #27251 · Amended (2026-10-28, #27291 — one clause e… | 2026-10-28 | — | — |

## ObjectUI registry — `ui/docs/adr/` (`ui-` prefix)

objectui's own decision sequence, imported with the ui merge and kept in place (#26080). Numbers overlap the registry above and name different decisions; cite one as `ObjectUI ADR-NNNN`.

| Number | Title | Status | Date | Supersedes | Superseded by |
|---|---|---|---|---|---|
| [ui-0001](../../ui/docs/adr/0001-master-detail-subform.md) | Master-Detail Subform (parent + line items, entered and viewed together) | Accepted — implementing (2026-06-05) | 2026-06-05 | — | — |
| [ui-0034](../../ui/docs/adr/0034-unified-runtime-metadata-persistence.md) | Runtime editing reuses studio's per-item draft → publish → version model (retire `sysview` / `sysreport` / `s… | Implemented — 2026-06-06 — see #1533 (chrome + view-create seam) and #1534 (r… | 2026-06-06 | — | — |
| [ui-0036](../../ui/docs/adr/0036-field-conditional-rules.md) | Field-level conditional rules (visibleWhen / readonlyWhen / requiredWhen) | Accepted — implementing (2026-06-07) | 2026-06-07 | — | — |
| [ui-0053](../../ui/docs/adr/0053-list-view-navigation-modes.md) | List-view navigation — two mutually-exclusive modes | Accepted — 2026-06-18; revised after implementation spike | 2026-06-18 | ADR-0047 | — |
| [ui-0054](../../ui/docs/adr/0054-ui-testability-contract.md) | UI testability contract | Proposed — 2026-06-22 | 2026-06-22 | — | — |
| [ui-0055](../../ui/docs/adr/0055-parameterized-bare-data-surface.md) | Parameterized bare data surface — the third list context | Accepted — 2026-07-05 | 2026-07-05 | — | — |
| [ui-0056](../../ui/docs/adr/0056-permission-editing-studio.md) | Permission editing belongs in Studio — Setup keeps user management and assignment | Accepted — implemented in objectstack-ai/objectui#2403 (2026-07-13). Revis… | 2026-07-13 | — | — |
| [ui-0057](../../ui/docs/adr/0057-console-ai-chat-one-conversation-docked.md) | Console AI chat is one system — surfaces are views over one conversation, docked as the canonical shell | Accepted — 2026-07-13 — IMPLEMENTED IN FULL. P1+P2 shipped | 2026-07-13 | — | — |
| [ui-0058](../../ui/docs/adr/0058-cascading-select-options.md) | Cascading & role-gated select options (`option.visibleWhen` + `dependsOn`) | Accepted — implemented (2026-07-15) | 2026-07-15 | — | — |
| [ui-0059](../../ui/docs/adr/0059-action-params-shared-field-widgets.md) | Action params render through the shared form field-widget renderer | Accepted — implemented (2026-07-19) | 2026-07-19 | — | — |
| [ui-0060](../../ui/docs/adr/0060-product-neutral-renderer.md) | objectui is a product-neutral renderer | Accepted — maintainer ruling (2026-10-12); this record and its ratchet lan… | 2026-10-12 | — | — |
