# ADR-0037: Live Canvas — draft-overlay live preview while you build

**Status**: Accepted (2026-06-10) — all four phases implemented: `previewDrafts` reads (`runtime/http-dispatcher.ts`), objectui LiveCanvas/PreviewModeContext/DraftPreviewBar, draft-data preview via `service-analytics/preview-evaluator.ts` (+test), assistantBus back-channel (Phase 4 the least exercised).
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0033](./0033-ai-assisted-metadata-authoring.md) (AI authors metadata as DRAFTS; publish is the human gate), [ADR-0021](./0021-analytics-dataset-semantic-layer.md) (datasets as the single analytics form — what dashboards render from), [ADR-0005](./0005-metadata-customization-overlay.md) (the overlay model the draft state lives in)
**Consumers**: `@objectstack/runtime` + `@objectstack/objectql` (preview data plane — mostly already present), `@objectstack/service-analytics` (Phase 3 draft-data queries), `../objectui` (`data-objectstack` preview client, `app-shell` Live Canvas + assistant bus, view/dashboard renderers), `../cloud` (Build-with-AI entry surface)

**Premise**: pre-launch, no back-compat debt — specify the target end-state directly.

**Design center**: **the magic moment should not be a progress bar that ends in an app — it should be the app itself, taking shape on screen while you talk.** Airtable/Lovable-class builders win on feedback-loop latency: say a thing, *see* the thing. ObjectStack can match that loop **without giving up the ADR-0033 governance gate**, because the thing the user watches is the *draft overlay* rendered live — what you see is exactly what Publish will make real. Their live preview mutates production; ours previews the staged truth. That is a strictly stronger story for the enterprise buyer ("WYSIWYG of the pending change") and an equally strong demo.

---

## TL;DR

Everything hard about live preview already exists in the platform; it has simply never been wired together for the builder:

1. The server can already render the world **as-if-published**: `GET /meta/:type[/:name]?preview=draft` overlays pending drafts on the active registry (list **and** item level, `protocol.getMetaItems/getMetaItem({ previewDrafts })`). The SPA uses this **nowhere** today.
2. The chat already knows, in real time, **which artifact just changed**: the streaming build tree (`data-build-progress` parts) and every authoring tool's `drafted` envelope name the exact `(type, name)`.
3. The chat and the host app already share an **event bus** (`assistantBus` in objectui app-shell) with an editor-context primitive.

**Decision.** Ship a split-view **Live Canvas**: chat on the left, the user's app rendered from the **draft overlay** on the right, refreshed per-artifact by the existing stream events. Four phases: (1) static draft preview behind a `?preview=draft` mode + watermark; (2) event-driven live refresh during builds and edits; (3) draft **data** preview (seed rows visible pre-publish — the only genuinely new mechanism); (4) canvas→chat back-channel ("change *this*" while pointing). Publish remains the only commit point; the canvas is a read-only window onto the draft layer.

**Open-core boundary**: the preview data plane (`preview=draft` reads, draft-data query overlay) is **open mechanism** (framework). The Live Canvas surface, the chat wiring, and the build intelligence stay in objectui/cloud.

---

## Context

### What already exists (verified 2026-06-10, file-level)

| Capability | Where | Status |
|---|---|---|
| Draft-overlay reads, list level | `runtime/src/http-dispatcher.ts` (`query.preview === 'draft'` → `getMetaItems({ previewDrafts })`) | ✅ shipped |
| Draft-overlay reads, item level | same dispatcher → `getMetaItem({ previewDrafts })`; protocol implements both (`objectql/src/protocol.ts`) | ✅ shipped |
| Per-artifact change signal, mid-build | `data-build-progress` stream parts (reconciled snapshots; items carry `{type, name}`) | ✅ shipped |
| Per-artifact change signal, per edit | every authoring tool returns the `drafted` envelope with `(type, name)`; chat already lifts it (`draftReview`) | ✅ shipped |
| Chat ↔ host event bus | `app-shell/src/assistant/assistantBus.ts` (`requestAssistantReview`, `AssistantEditorContext`) | ✅ shipped |
| Single metadata entry point in renderers | `DashboardView` / `ObjectView` → `useMetadataClient()` | ✅ shipped |
| Single governed data entry point | `dataSource.queryDataset` (ADR-0021 path used by `DatasetWidget`) | ✅ shipped |
| Seed rows materialize on publish | `protocol.publishMetaItem`/`publishPackageDrafts` apply seeds, report `seedApplied` | ✅ shipped (2026-06-10) |
| SPA usage of `preview=draft` | — | ❌ none (the gap) |
| Draft **data** (seed rows before publish) | — | ❌ does not exist (Phase 3) |

### Why now

The 2026-06-10 reliability batch closed the failure modes a live canvas would have amplified: dangling dataset references auto-heal, seed data reliably lands on publish (loudly when it can't), the build streams artifact-level progress, and reloaded conversations render honestly. The canvas is now an additive surface over trustworthy primitives, not a magnifier for bugs.

### Non-goals

- **Not** a collaborative multiplayer editor. ADR-0033's single-draft read-modify-write model stays; the canvas only reads.
- **Not** a bypass of the publish gate. Nothing the canvas shows is live until Publish.
- **Not** a new renderer. The canvas mounts the *existing* ObjectView/DashboardView/app-shell renderers in preview mode.

---

## Decision

### Phase 1 — static draft preview (objectui, ~2–3 days)

- `data-objectstack/metadata-client.ts`: `MetadataClientConfig.previewDrafts?: boolean` → `list()`/`get()` append `?preview=draft`. (~30 lines + tests; both endpoints already honor it.)
- `app-shell`: a `PreviewModeContext` keyed off the URL (`?preview=draft`); `useMetadataClient()` reads it. A persistent **"Draft preview"** watermark bar with one-click exit and one-click Publish.
- Entry: a **Preview** button next to the chat's existing Review affordance, navigating to the drafted artifact's route with `?preview=draft`.
- Data plane untouched in this phase: an unpublished object renders with an empty table — structure-WYSIWYG only.

**Acceptance**: an unpublished dashboard/view/app renders fully in the canvas; the watermark is present; after Publish the same route renders identically without it.

### Phase 2 — event-driven live canvas (objectui, ~3–4 days)

- `assistantBus`: `emitCanvasInvalidate({ type, name })` / `subscribeCanvasInvalidate` (mirrors the existing review-request pattern).
- Both chat hosts (`ConsoleFloatingChatbot`, `AiChatPage`) emit invalidations from (a) `buildProgress.items` diffs and (b) `drafted` envelopes — the data is already in hand; this is wiring.
- A `LiveCanvas` split-view host: opens automatically for Build-with-AI sessions; re-keys/refetches the affected renderer per `(type, name)`; a ~200 ms coalescing window prevents invalidation storms during whole-app builds.
- Renderers accept an external refresh key (most already expose a reload hook).

**Acceptance**: during `apply_blueprint` the right pane grows artifact-by-artifact in step with the build tree; an incremental "add a field" edit reflects in the rendered form/kanban in < 1 s.

### Phase 3 — draft data preview (framework, ~1–2 weeks; the only new mechanism)

Options considered:

| Option | Idea | Verdict |
|---|---|---|
| A. Client-side sample rows | canvas fabricates rows for draft objects | 1 day, but diverges from the real seed → two sources of truth; rejected |
| **B-min. In-memory seed overlay (chosen)** | `queryDataset({ previewDrafts })` resolves the object's pending `seed` draft and overlays its parsed rows as the data source, without touching physical tables; reuses `SeedLoaderService` (now in objectql) in a resolve-only mode | smallest honest mechanism; numbers are continuous across Publish because publish materializes the *same* seed |
| C. Per-session sandbox environment | clone the env for preview | cleanest isolation, heaviest cost; deferred until multiplayer preview matters |

- `service-analytics` dataset executor: when `previewDrafts` is set and the dataset's base object has a pending `seed` draft, evaluate the query over the seed's resolved rows (reference resolution via the existing loader logic, dry-run — no writes).
- Row reads for plain object views (`/data/{object}` list) get the same overlay behind the same flag, bounded to preview-sized LIMITs.
- Security: preview queries run under the same org/RLS context as any other read; the flag only changes the *source*, never the principal.

**Acceptance**: mid-build, the drafted dashboard charts real numbers from the drafted seed; after Publish the same widgets show the same numbers from real tables.

### Phase 4 — canvas → chat back-channel (objectui, ~3–4 days)

- The `AssistantEditorContext` primitive already exists; the canvas sets it on hover/selection (`{ type, name, field? }`), the chat injects "the user is pointing at X" into the agent's context.
- End-to-end: click a kanban column, say "make this red", the right artifact is edited without naming it.

**Acceptance**: context-sensitive edit commands work without the user naming the object/view.

---

## Risks

| Risk | Mitigation |
|---|---|
| Half-formed drafts crash the canvas | per-widget ErrorBoundary (partially present in plugin-dashboard) + canvas-level fallback ("this part of the draft isn't renderable yet") |
| `preview=draft` exposure | confirm/add a builder/admin role gate on the dispatcher reads; the canvas entry itself is builder-only |
| Invalidation storms during whole-app builds | coalescing window + only refresh artifacts currently visible |
| Cache staleness | preview reads are already `cache: no-store` in `MetadataClient` |
| Concurrent editors | out of scope; single-draft model serializes writers, canvas is a reader |

## Rollout & sequencing

Phase 1+2 land together (one objectui PR + a cloud pin bump) ≈ one week → 80 % of the Airtable feel (structure-level WYSIWYG). Phase 3 is one framework PR ≈ cumulative 2–3 weeks → the full "living app" feel. Phase 4 follows independently. Each phase is separately shippable and separately revertible (the canvas is additive; no existing surface changes behavior when it is closed).

---

## Amendment (2026-06-10) — product boundaries: one truth, four altitudes

Discussion after the proposal surfaced the integration question: the AI's designs already land in the metadata repository, Studio already exists as the metadata workbench, and the floating AI chat is already everywhere — where does the canvas END and everything else BEGIN? The answer that keeps this from becoming a fourth competing product: **these are not four products; they are one truth (the metadata repository) viewed at four altitudes.**

| Altitude | Surface | Persona | Access |
|---|---|---|---|
| L0 — intent | AI chat (floating / Build-with-AI) | anyone | writes drafts via tools |
| L1 — outcome | **Live Canvas** (this ADR) | app owner / business builder | read-only, `?preview=draft` |
| L2 — artifact | Studio workbench | developer / implementer | full-fidelity edit (still drafts) |
| L3 — truth | `sys_metadata` draft+active overlay (ADR-0033) | — | the single store |

All write paths converge on the same draft rows; **Publish remains the single commit gate** shared by every surface.

**Boundary rules (each one is a "we will NOT build"):**

1. **One truth.** The canvas has NO store of its own — no "AI workspace" parallel repository. It renders the same `sys_metadata` rows Studio edits.
2. **The canvas never edits in place.** It renders and *selects* (point at a widget/field); changing anything goes through exactly two doors — say it (chat → authoring tools → draft) or **"Open in Studio"** (the existing review/designer deep-link). This rule is what guarantees the canvas can never grow into a second Studio.
3. **There is one chat.** The canvas ships no chat of its own; in build sessions the existing `ChatbotEnhanced` (same conversation, same component) becomes the left pane and the canvas is its result pane. The floating button keeps its role as the everywhere intent-entry; the canvas appears only in building contexts.
4. **No new lifecycle semantics.** The canvas's Publish calls the existing endpoints; Review deep-links to Studio's diff. Nothing new to govern.

**Relationship to Studio's existing previews**: Studio's dataset-designer live preview (ADR-0021) is *artifact-level* preview; the canvas is *app-level* preview. Both consume the same primitives (`preview=draft` reads; `queryDataset` already accepts inline draft definitions — the hook originally added for Studio preview), so the mechanism is shared, not duplicated. Canvas selection and Studio deep-links ride the same `assistantBus` — three surfaces, one context bus.

This framing also slots ADR-0036 (every app is an API + MCP server) into the same L1 outcome surface — the build-complete state shows "your app + its API + its agent tools" without inventing another surface.
