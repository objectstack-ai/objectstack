# ADR-0057: Console AI chat is one system — surfaces are views over one conversation, docked as the canonical shell

**Status**: Accepted (2026-07-13) — **IMPLEMENTED IN FULL**. P1+P2 shipped
(#2414), P4 shipped (#2439 / #2444 + cloud#818/#819; reliability follow-ups
#2449 + cloud#820), P3 shipped (P3a #2464, P3b #2465, P3c #2467, go-live #2469,
follow-ups #2470 — epic #2409); the final cleanup removed the `chatDock`
rollout flag, the console floating-overlay path (`ConsoleFloatingChatbot`),
and the legacy left Studio copilot panel — the dock (rail / bottom sheet /
maximized `/ai` / Studio right dock) is the console's ONE chat presentation;
the runtime SDUI bubble is unchanged per §4. Console-layer
realization of the two-agent,
surface-bound model (cloud ADR-0063). **No agent, boundary, or commercial-model
change** — this ADR only rearranges how the objectui console *renders and wires*
chat surfaces.
**Amended**: Amendment A2 (2026-09-28) — the dock binds its build thread to the
current authorable app, reversing A1.b's dock clause (objectui#10926).
**Author**: ObjectUI app-shell / Studio team
**Consumers**: `@object-ui/app-shell`
(`console/ai/AiChatPage.tsx`, `layout/ConsoleFloatingChatbot.tsx`,
`layout/ConsoleChatbotFab.tsx`, `layout/ConsoleLayout.tsx`, `layout/agentPicker.ts`,
`views/studio-design/StudioAiCopilot.tsx`, `views/studio-design/StudioDesignSurface.tsx`,
`assistant/assistantBus.ts`, `hooks/useChatConversation.ts`,
`hooks/useConversationList.ts`, `hooks/useAiSurface.ts`),
`@object-ui/plugin-chatbot`
(`ChatbotEnhanced.tsx`, `FloatingChatbot*.tsx`, `useObjectChat.ts`, `useAgents.ts`,
`agentAliases.ts`, `renderer.tsx` — the SDUI `type: 'chatbot'` component)
**Relates to (framework/cloud)**: **cloud ADR-0063** (two agents `ask` / `build`,
bound by surface, no roster / no per-turn classifier — the invariant this ADR
enforces UI-side; itself the reversal of ADR-0040's unified assistant),
**cloud ADR-0025** (the in-UI AI runtime is cloud-owned; OSS ships MCP / BYO-AI
only — so this whole surface must degrade to nothing on community builds),
**ADR-0080** (Studio WYSIWYG design surface — the `aiSlot` this copilot fills),
**ADR-0037** (Live Canvas — the build focus view), **ADR-0068** (per-user AI seat →
the access-filtered agent catalog), **ADR-0013** (durable turns / `turnId`,
share links)
**Relates to (objectui)**: **ADR-0053 / ADR-0055** (nav / surface-context
precedent), **ADR-0054** (UI-testability contract — a browser proof per phase)
**Tracking**: objectstack-ai/objectui#2409 (epic — "Unify console AI chat surfaces");
cloud dependencies objectstack-ai/cloud#816 (agent `capabilities`) and
objectstack-ai/cloud#817 (ask→build handoff contract)

---

> **Cross-repo numbering note.** ObjectUI keeps its own ADR sequence (latest is
> ADR-0056); this is ADR-0057 in **that** sequence. The `framework` repo has an
> unrelated ADR-0057 (RLS depth / business-unit tree) and `cloud` runs its own
> 0063 / 0025 / 0080. Every cross-reference above is given **by title + repo**,
> not by number alone, because the three repos' ADR numbers have always collided.
> If reviewers prefer this decision live in the AI-platform series, it becomes
> **cloud ADR-00xx** instead — see *Alternatives considered* A5 (chosen against,
> because every decision here is an objectui UI-surface-ownership call).

## TL;DR

The console renders AI chat through **three parallel shells over one backend**,
and the shells **fork the conversation**:

- **`ConsoleFloatingChatbot`** — a **bottom-right floating FAB** (`ask`), an
  overlay, with its own conversation wiring (`assistantBus`, reconcile-on-error).
- **`AiChatPage`** — full-page `/ai/build` + `/ai/ask` (with the **Live Canvas**
  for build), resolving the agent from the route.
- **`StudioAiCopilot`** — a **left-docked panel** inside the Studio design surface
  (`build`), keyed on scope `studio:${packageId}:${agent}`.
- (+ the SDUI `type: 'chatbot'` embedded inside runtime **end-user** apps.)

They already share the render body (`ChatbotEnhanced`) and the transport
(`POST /api/v1/ai/agents/:name/chat`), but **above** that there are **two
conversation-state layers**, **~5 divergent surface→agent picks**, **two
enablement gates**, and **surface-forked conversations** — so the *same app's*
build chat can exist as **two disjoint threads** (an empty "Build with AI" copilot
next to an active full-page build conversation).

This is **not** a proposal to merge `ask` and `build`. Cloud ADR-0063 already
settled that: **two products, bound by surface, no roster, no per-turn
classifier** (ADR-0040's unified-classifier assistant was reversed). The problem
is **console-layer surface sprawl**, not the agent model.

**Decision — one console chat *system*, on a single principle:**

> **surface = view · conversation = model · product (`ask` / `build`) = the
> binding axis.** Today's bug is that the *model* is forked per *view*.

1. **One conversation/session context**, keyed on **`(user, app, product)` — not
   on surface.** Every shell becomes a thin view over it. (Fixes the forked
   threads; the `studio:` scope prefix is the bug and is dropped.)
2. **One declarative surface→agent resolver** enforcing ADR-0063
   (`studio-build → build`; everything else `→ ask`; `app.defaultAgent` may
   override, but only within `ask` / `build`). Replaces the scattered
   `isBuildAgent` picks — a roster becomes structurally unrepresentable.
3. **Canonical presentation = a right-docked, collapsible, resizable panel**
   (the VS Code / Cursor idiom). The floating FAB **retires** to a launcher /
   shortcut that opens the same dock. Full-page `/ai` becomes the same panel
   **maximized** (focus mode + Live Canvas), sharing the thread.
4. **Runtime end-user apps keep the bubble.** A support-widget presentation is
   the right *audience* idiom; same state code, different chrome. **Presentation
   is decoupled from state.**
5. **One enablement gate** — the access-filtered agent catalog (`useAiSurface`,
   ADR-0068). The `discovery.services.ai` (`isAiEnabled`) path and its per-user
   403 gap are deleted.
6. **OSS degrades to nothing** (cloud ADR-0025): empty catalog → the whole
   surface hides; the only AI is MCP.

## Context

### The three shells, and the forked conversation

All three shells ultimately hit **one** backend endpoint
(`POST /api/v1/ai/agents/:name/chat`, cloud `service-ai`) and share **one**
conversation/message model (`ai_conversations` / `ai_messages`), one stream
(Vercel Data Stream), one LLM adapter. They differ only in **shell + state
wiring**:

- **`layout/ConsoleFloatingChatbot.tsx`** — the global FAB. Lazy-mounted,
  overlay, wired to `assistantBus` (open signal + "what am I editing" context)
  and `useReconcileOnError`. Picks its agent at
  `ConsoleFloatingChatbot.tsx:915` (`defaultAgentProp ?? envDefaultAgent ??
  (has build ? 'build' : undefined)` → `resolveDefaultAgentName`).
- **`console/ai/AiChatPage.tsx`** — the full-page surface owning **both**
  `/ai/build` and `/ai/ask`, plus the Live Canvas iframe (ADR-0037). Exports the
  reusable `ChatPane`. Resolves the agent from the route param
  (`AiChatPage.tsx:610`).
- **`views/studio-design/StudioAiCopilot.tsx`** — the ADR-0080 `aiSlot`, a
  **left** panel (`w-96`, `border-r`) that **reuses `ChatPane`** but forces
  `build` (`StudioAiCopilot.tsx:44`) and binds a **surface-specific** conversation
  scope `studio:${packageId}:${activeAgent}` (`:56`).

Because the copilot's scope carries the `studio:` prefix and the full-page uses
its own resolution, opening the same app in both yields **two conversations**.

### What is already unified (do not rebuild)

- **Backend**: one endpoint, one conversation model, one stream, one adapter.
- **Render body**: `ChatbotEnhanced` + `useObjectChat` + `useAgents`
  (`@object-ui/plugin-chatbot`) are reused by all three shells;
  `StudioAiCopilot` literally imports `ChatPane` from `AiChatPage`.
- **The correct gate already exists**: `hooks/useAiSurface.ts` keys off the
  access-filtered agent catalog (ADR-0068) and its docstring **explicitly warns**
  against collapsing back to `discovery.services.ai`.
- **The context bridge already exists**: `assistant/assistantBus.ts` connects
  the metadata designers to the global chat (editor context, open signal, review
  signal per ADR-0033, canvas invalidation per ADR-0037, live-metadata refresh).
  This ADR **generalizes and keeps** that bus — it is the fusion seam, not a
  thing to rebuild.

### Why the sprawl is the wrong surface

1. **Forked threads read as a bug.** An active build conversation beside an empty
   build copilot for the *same* app is indistinguishable from data loss.
2. **Two state layers.** `app-shell` hooks (`useChatConversation`,
   `useConversationList`, `useAiSurface`, `conversationLanguage`, `reconcileTurn`,
   `assistantBus`) vs `plugin-chatbot` hooks (`useObjectChat`, `useAgents`,
   `usePendingActions`, `useHitlInChat`). No single conversation owner.
3. **~5 re-implementations of the ADR-0063 resolution chain**, with **drift** —
   e.g. `ConsoleLayout.tsx:84` carries an `!aiStudioEnabled &&
   isBuildAgent(app.defaultAgent) → downgrade` special case that exists **nowhere
   else**. One rule, five spellings.
4. **Two gates.** `useAiSurface` (correct, per-user) vs `discovery.services.ai`
   (`isAiEnabled`, identical for every user → seat-less users see controls that
   403 on click).
5. **Inconsistent presentation.** Studio docks **left**, the FAB floats
   **bottom-right**, `/ai` is **full-screen** — no muscle memory; and a
   bottom-right popup is cramped for a long agentic build turn (plan → draft →
   verify → publish, tool-call chips, review diffs) that wants to sit *beside*
   the canvas, not over it.

### Do not over-split the surfaces

`console-data` (the console's ambient `ask` — FAB / full-page) and `runtime-app`
(the `ask` chat embedded in a shipped end-user app) differ only in **scope**
(which app / which RLS — a *model* concern, carried in the conversation key) and
**view** (FAB vs SDUI bubble — a *presentation* concern). **They do not differ in
agent** — both bind `ask`, and a runtime app can never reach `build` (end users
don't author metadata; ADR-0063 routes "change the app" to the Builder). So the
surface→agent resolver is effectively a single question — *"is this the Studio
authoring surface?"* — `build` if yes, `ask` otherwise.

## Decision

**One console chat system. Surface is a view; the conversation is the model; the
product (`ask` / `build`) is the axis that binds — resolved by the surface, never
chosen.** The six points of the TL;DR, expanded:

### 1 · One conversation/session context

Introduce a single `ChatSessionProvider` (or consolidate into
`@object-ui/plugin-chatbot`) that owns agent resolution, conversation binding,
list, streaming, pending actions, and reconcile. Conversations are keyed on
**`(user, app, product)`**; the surface is **not** part of the key. The Studio
copilot's `studio:${packageId}:${agent}` becomes `app:${packageId}:${product}`,
so the full-page focus view and the docked copilot are the **same thread**.

### 2 · One declarative surface→agent resolver (enforces ADR-0063)

```ts
const SURFACE_DEFAULT = { 'studio-build': 'build', 'default': 'ask' } as const;

function resolveSurfaceAgent(surface, { catalog, appDefaultAgent, aiStudioEnabled }) {
  const want = appDefaultAgent ?? SURFACE_DEFAULT[surface] ?? 'ask';
  // the ConsoleLayout special case, folded in ONCE:
  const eff = !aiStudioEnabled && isBuildAgent(want) ? 'ask' : want;
  return resolveAgentParam(eff, catalog) ?? resolveDefaultAgentName(catalog);
}
```

Every call site (`StudioAiCopilot`, `ConsoleFloatingChatbot`, `ConsoleLayout`,
`AiChatPage`, `agentPicker`) uses this one function. There is no place to add a
roster or a per-turn classifier — ADR-0063 becomes a structural guarantee, not a
convention repeated five times.

### 3 · The dock, concretely — three modes over one code

- **Docked rail (console default).** Right side, collapsible, **default
  collapsed**, resizable. Replaces the FAB as the canonical console chat; the FAB
  button becomes the launcher / keyboard toggle (⌘I / ⌘L idiom). Default-collapsed
  preserves the FAB's virtue — zero layout cost, no reflow of dense data grids —
  until invoked.
- **Focus / full-screen.** `/ai` = the same panel **maximized** (build + Live
  Canvas). "Expand" from the rail, "collapse" back — **same thread**. Deep links
  (`/ai/build/:conversationId`, share links, ADR-0013) open the dock maximized on
  that thread.
- **Bubble / embedded.** Runtime apps + the SDUI `chatbot` keep the
  support-widget chrome; **same state code**, different presentation.
- **Side = right** (VS Code / Cursor norm; the left is nav). **Consequence:**
  Studio's current `[left: copilot] [center: canvas] [right: properties]` becomes
  `[left: nav/tree] [center: canvas + properties] [right: chat]`. This is the one
  non-trivial layout change and is scoped to P3.

### 4 · Runtime apps keep the bubble; 5 · one gate; 6 · OSS → nothing

End-user business apps render the support bubble (audience idiom), over the same
`ChatSessionProvider`. `useAiSurface` is the **only** enablement gate everywhere;
`isAiEnabled` / `discovery.services.ai` is deleted. On OSS (cloud ADR-0025) the
catalog is empty → the entire surface (rail, launcher, focus route, bubble) is
inert; AI is reached only via MCP.

### Phased rollout — each step reversible; no big-bang on the most-used AI entry

- **P1 — one conversation context + one gate.** Stand up `ChatSessionProvider`;
  all three shells read it; key on `(user, app, product)` (drop `studio:`); delete
  `isAiEnabled`, `useAiSurface` everywhere. **No visible change** — safe to land
  first. *Proof (ADR-0054): the same thread is visible in the full-page surface
  and the Studio copilot for one app.*
- **P2 — declarative resolver (B).** Extract `resolveSurfaceAgent` +
  `SURFACE_DEFAULT`; every site uses it; delete the scattered picks including the
  `ConsoleLayout` downgrade. *Proof: a unit table for ADR-0063 — Studio→build,
  console/app→ask, aiStudio-off downgrade, `app.defaultAgent` bounded to
  ask/build.*
- **P3 — docked rail + Studio right-side reflow; retire the FAB.** `ChatDock`
  renders the shared panel as a collapsible right rail; the FAB → launcher; the
  Studio copilot moves to the shared right dock (properties reflow); `/ai` =
  maximized dock, same thread; runtime SDUI unchanged (bubble). *Proof: chat
  location is identical across console pages; expand/collapse preserves the
  thread.* **Shipped behind `features.chatDock` (default OFF): P3a #2464 (rail),
  P3b #2465 (FAB → launcher), P3c #2467 (maximized `/ai` ⇄ rail + Studio reflow
  + canvas auto-maximize). Flag default-on + floating-overlay retirement are the
  remaining cleanup (epic #2409).**
- **P4 — ask→build handoff (explicit).** In `ask`, a build-shaped request
  surfaces an explicit **"Open in Builder →"** that carries the conversation
  context through the generalized `assistantBus` — ADR-0063's *decline-and-
  redirect*, never a silent re-route into authoring. *Optional cloud dependency: a
  handoff-context contract (objectstack-ai/cloud#817).* *Proof: an ask thread opens
  the Builder with context; no authoring ever happens on the ask surface.*

## Consequences

- **One presentation, one place.** Chat is always the right rail (console) —
  muscle memory; long build turns get a workbench beside the canvas, not a popup
  over it.
- **~5 divergent picks + 2 state layers + 2 gates collapse to one each.** Large
  maintainability win; ADR-0063 is enforced structurally, not by five conventions.
- **OSS degradation is one decision** (empty catalog → hidden); the MCP-only
  story (cloud ADR-0025) stays intact.
- **Presentation is decoupled from state**, so future surfaces (mobile, an
  in-record inline assistant) are cheap *views* over the same context, and runtime
  apps keep their own idiom.
- **Cloud follow-ups (optional, separate issues, not blocking):**
  1. **B+** (objectstack-ai/cloud#816) — have `GET /api/v1/ai/agents` return
     per-agent `capabilities` (`{ authoring, canvas, debug, resume }`) so the
     panel renders behavior by **declared capability**, not by
     `isBuildAgent(...)` name checks (future skill-driven variants then need no
     console change).
  2. A **handoff-context contract** for P4 (objectstack-ai/cloud#817) — carry the
     ask thread's context into the Builder.
- **Costs.** P3 touches the **most-used AI entry** (the FAB) and the **Studio
  layout** (properties vs chat on the right). Both are why the rollout is phased
  and reversible.

## Amendment A1 (2026-07-13, Proposed) — build conversations bind a package, lazily

**Motivation — three defects observed in live browser testing (2026-07-13).**
Build conversations are only HALF-bound today: the "Edit with AI" / Studio
entries key the thread `app:{pkg}:build` (ADR-0070), but a bare `/ai/build`
visit — the **magic flow**, the new user's first experience — degrades to the
product-only scope. Consequences, all reproduced live:

1. **Agent ambiguity.** With a blueprint Awaiting Approval in the SAME thread,
   a second handoff made the agent ask *"which app do you mean?"* — it has no
   declarable binding to reason from, so it guesses.
2. **Thread mixing.** Every package-less build shares ONE global conversation;
   two unrelated projects interleave in a single thread.
3. **Continuity break.** The thread that BUILT app X (product-scope) and the
   thread "Edit with AI" later opens for X (`app:X:build`) are DIFFERENT
   conversations — the user's original build history is stranded where they
   will never look for it.

**Decision (proposed).** Every build conversation carries a **package binding
— visible, switchable, and lazily established** (the Claude-Code-picks-a-repo
idiom, but the analogy stops at *display*, never at *gating*):

- **Binding chip** in the build surface header (and the P3 dock header once it
  lands): bound → `📦 <app label> (<pkg id>)`; unbound → **"✨ New app"**. The
  user always sees the blast radius of edits.
- **The magic flow starts UNBOUND** — no create-a-package-first friction, the
  empty-state prompt stays "describe your app". The moment the build creates
  the package, the conversation **auto-binds and re-keys** to `app:X:build`
  (untitled-document idiom: named on first save) — healing defect 3. The
  server already carries the seed of this ("active package" set by a prior
  build, ADR-0070); the amendment keys the conversation by it and shows it.
- **Binding = WRITE target** (a cwd, not a cage): the agent may still read
  other packages; edits land on the bound one. The system prompt states the
  binding — or "none: you will create one" — which is the structural fix for
  defect 1.
- **Switching the chip switches threads**: each app gets its own build
  conversation (defect 2), exactly as the Studio copilot already keys; the
  sidebar can group threads by package.

**Relation to P1.** A refinement, not a reversal: the `(user, app, product)`
key's `app` axis becomes **always present for `build`**, with a draft
placeholder for not-yet-created packages instead of the silent product-only
degradation.

**Phasing.**
- **A1.a — read-only chip.** Display `editPackageId` / the conversation's
  server-side active package; "New app" when absent. Fold into P3a's dock
  header design.
- **A1.b — bind-on-create + re-key.** Conversation re-keys to `app:X:build`
  when the build mints package X (with a legacy-scope fallback read so
  existing product-scoped threads stay reachable); chip becomes a switcher.
  **Shipped (#2466)**: `useChatConversation.rekeyScope` (synchronous scope
  flip so the #2450 scope gate holds through the `?package=` navigate — no
  pane remount mid-stream) + a `legacyScope`/`adoptLegacy` migration read
  (adopt the product-only thread iff its own history is bound to X). Keying
  is client-side only (the per-`(user, scope)` localStorage cache; no server
  change). Two decisions made explicit: the legacy product-only key is **not
  cleared** (dock/FAB and bare `/ai/build` keep resolving through it), and
  re-keying is **latest-wins** (the bound thread most recently open becomes
  the app's Edit-with-AI thread; older ones stay in sidebar history).
  **The dock half of the first decision is reversed by Amendment A2 below**
  (2026-09-28): inside an authorable app, a `build` dock resolves
  `app:X:build`, not the product-only key. The key is still never cleared,
  and bare `/ai/build` still resolves through it.
- **A1.c — cloud follow-up.** Inject the binding into the build agent's
  context block, and add the pending-blueprint rule: *a new authoring request
  while a blueprint awaits approval defaults to AMENDING that blueprint* (the
  merge/supersede behavior decided for P4's second handoff, made explicit).

**Costs / open points.** The re-key needs a migration read for existing
product-scoped threads; a deleted bound package needs a terminal chip state
(read-only thread); concurrent unbound drafts must not collide (the existing
`forceNew` path already mints separate threads).

## Amendment A2 (2026-09-28, Accepted) — the dock binds its build thread to the current app

**What it reverses.** One clause of A1.b: "the legacy product-only key is
**not cleared** (dock/FAB and bare `/ai/build` keep resolving through it)".
The DOCK half of that clause is reversed for authorable apps. The rest of
A1.b stands: the key is still never cleared, bare `/ai/build` (no
`?package=`) still resolves through it, and re-keying is still latest-wins.

**Why.** In the hosted console (objectui#10899 item 4, epic
objectstack-ai/cloud#2440), a maker who opened the dock inside an existing
app saw the build chip read "New app". The dock used the app-less,
product-only build scope and sent no `packageId`, so the build agent had to
infer which app to edit. That is A1's defect 1 (agent ambiguity), reached
through the one surface A1.b left unbound.

**Maintainer ruling** (epic session, 2026-09-28), verbatim, not translated:

> 绑定当前应用（推荐）

The terms it was presented with (objectui#10926):

- Inside an authorable app (package not `com.objectstack.*`), when the
  resolved agent is `build`, the dock binds its build thread to that app:
  `editPackageId` is the app's package and the scope is `app:PKG:build`.
- The chip, the empty state and the agent context name the app.
- The dock, `/ai/build?package=PKG` and the Studio copilot share one thread;
  Maximize goes to `/ai/build?package=PKG`.
- `ask` stays ambient.
- Existing ambient build threads stay reachable in the `/ai` sidebar.

**Decision.**

- **Key.** The dock's scope is `app:PKG:build` exactly when its resolved
  agent is `build` and the current app's package is authorable. Otherwise it
  is the product alone, as before: an `ask` dock, a dock inside a
  `com.objectstack.*` app, and a dock with no current app.
- **Authorable** is the predicate the A1.b switcher already applies to its
  list (`isPlatformBuiltinApp`: the `com.objectstack.*` package namespace is
  the platform's code-delivered apps). There is no second resolver.
- **The product-only thread.** It is not cleared and not moved: it keeps its
  own key and its row in the `/ai` sidebar. The dock runs the same A1.b
  migration read the `?package=` entry runs. When nothing is cached under
  `app:PKG:build` yet, it adopts the product-only thread only if that
  thread's own history binds it to `PKG`. So the dock and the full page
  arrive at the same thread whichever of them resolves first.
- **Maximize.** A bound dock opens `/ai/build?package=PKG`, carrying the same
  one-shot full-page opt-out the Studio dock's door sets, so the built-moment
  transition (objectui#5799) does not bounce the arrival straight on to
  Studio. An app-less dock opens `/ai`, as before.

**Consequences.** Each authorable app a maker opens the dock in gets its own
build thread, minted on first open, as the Studio copilot already does per
package. The dock's previous product-only thread is not shown in the dock
inside an app unless it is bound to that app; it stays in the `/ai` sidebar
and in the dock outside any authorable app. This extends A1's direction
("the `app` axis becomes always present for `build`") to the one surface
A1.b had kept product-only. Implemented under objectui#10926.

## Open design questions

1. **Dock side under Studio (P3).** ~~Chat right vs properties right.~~
   **DECIDED (2026-07-13): chat right**; properties fold into a center tab —
   `[left: nav/tree] [center: canvas + properties] [right: chat]`. **Shipped in
   P3c** (Interfaces pillar `[Canvas | Properties]` center tabs; Data/Automations
   keep their in-center inspectors).
2. **FAB retirement path (P3).** ~~Hard-retire, or keep the FAB as the collapsed
   affordance?~~ **DECIDED (2026-07-13): the FAB becomes the dock's collapsed
   affordance** — the bottom-right button stays and expands the right rail
   (gentle migration; the familiar entry point survives).
3. **Handoff aggressiveness (P4).** **DECIDED & SHIPPED: explicit** "Open in
   Builder →" (#2439), carrying the ask conversation as first-turn context
   (#2444 + cloud#819). A second handoff landing on a pending blueprint simply
   auto-sends — the agent sees the awaiting plan in context and decides
   merge/supersede itself (product decision 2026-07-13).
4. **`app.defaultAgent` post-ADR-0063.** Now bounded to `ask` / `build` (tenant
   custom agents withdrawn). Confirm the resolver **rejects** anything else rather
   than silently falling through.
5. **Focus-mode routing.** ~~Does `/ai/build/:conversationId` stay a deep-linkable,
   shareable URL (ADR-0013) once the dock is canonical?~~ **DECIDED & SHIPPED
   (P3c): yes** — the routes are untouched; the full page IS the dock maximized
   (same P1 thread), with a maximize button on the rail and a collapse-to-dock
   button on the page bridging the two presentations.

## Alternatives considered

- **A1 — Keep three shells, just share more hooks.** Rejected: the forked-thread
  bug is a *state-ownership* problem; sharing render hooks fixes neither the
  conversation forking nor the divergent resolution.
- **A2 — Keep the FAB as the only console chat (no dock).** Rejected: a
  bottom-right popup is cramped for agentic build and cannot sit beside the
  canvas, and it never unifies with Studio's already-docked copilot.
- **A3 — Dock everywhere, including runtime end-user apps.** Rejected: end users
  of a business app expect a support bubble, not a developer rail. Presentation is
  a view concern; forcing one look fights the audience.
- **A4 — Merge `ask` + `build` into one assistant with a picker/classifier.**
  Rejected — this is exactly ADR-0040, **already reversed by cloud ADR-0063**.
  Out of scope and against the invariant.
- **A5 — File this in `cloud`, not objectui.** Rejected: this is a **console
  presentation/state** decision; `cloud` is backend-only and ships no chat UI. The
  agent / boundary / commercial decisions (ADR-0063 / ADR-0025) live in cloud and
  this references them — same split as ADR-0056 A5. The optional B+ / handoff
  contract *are* cloud changes and get their own small cloud issues.

## References

- objectui: `packages/app-shell/src/console/ai/AiChatPage.tsx`,
  `layout/ConsoleFloatingChatbot.tsx`, `layout/ConsoleChatbotFab.tsx`,
  `layout/ConsoleLayout.tsx`, `layout/agentPicker.ts`,
  `views/studio-design/StudioAiCopilot.tsx`,
  `views/studio-design/StudioDesignSurface.tsx`, `assistant/assistantBus.ts`,
  `hooks/useChatConversation.ts`, `hooks/useConversationList.ts`,
  `hooks/useAiSurface.ts`;
  `packages/plugin-chatbot/src/{ChatbotEnhanced,FloatingChatbot,FloatingChatbotProvider,useObjectChat,useAgents,agentAliases,renderer}.tsx`.
- cloud / framework ADRs (by title): ADR-0063 (two agents `ask` / `build`, bound
  by surface), ADR-0025 (in-UI AI is cloud-owned; OSS = MCP only), ADR-0080
  (Studio WYSIWYG design surface / `aiSlot`), ADR-0037 (Live Canvas), ADR-0068
  (per-user AI seat → agent catalog gate), ADR-0033 (draft → review), ADR-0013
  (durable turns / `turnId`).
- objectui ADRs: ADR-0053 / ADR-0055 (nav / surface context), ADR-0054
  (UI-testability contract).
