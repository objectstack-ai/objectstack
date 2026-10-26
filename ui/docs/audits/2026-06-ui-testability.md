# Audit: UI testability anti-patterns (2026-06)

**Scope**: `packages/*` and `apps/*` (excluding `node_modules`, `dist`, `*.test.*`, `*.d.ts`).
**Method**: static grep sweep + targeted read of the offending surfaces.
**Why now**: the platform is moving toward **AI-authored apps verified by AI browser
testing**. A UI that only a human can drive deterministically is, for that future, a
*broken* UI. This audit enumerates the classes of "works-for-a-human, non-deterministic-
for-a-machine" patterns so they can be governed centrally — see
[ADR-0054](../adr/0054-ui-testability-contract.md).

The headline is that the command-palette button "that doesn't open under automation" is
**not a one-off bug**: it is one sample of a *family* of patterns, all of which trade
machine-determinism for a human-convenience shortcut. The numbers below are the evidence.

---

## Summary

| # | Anti-pattern class | Instances | Severity | Central fix point |
| --- | --- | --- | --- | --- |
| 1 | Synthetic-event triggers (dispatch a fake event instead of calling the handler) | 2 keyboard + ~5 mouse/window | **High** | renderer controls |
| 2 | Non-idempotent toggle as the *open* path (`setOpen(p => !p)`) | 5 | **High** | overlay primitives |
| 3 | Keyboard / hover / focus-gated **sole** triggers | 56 `meta/ctrlKey` handlers, 16 `onMouseEnter` | Medium | overlay + design-system |
| 4 | Non-URL-addressable ephemeral state (open dialogs/drawers/steps) | overlays + wizard steps repo-wide | **High** | router-aware overlays |
| 5 | Missing stable locators (`data-testid` / ARIA) | 726 testid vs 1222 `onClick` (~40% gap) | Medium | renderer + field widgets |
| 6 | Debounced/controlled inputs that ignore value-injection | search/picker/filter inputs | Medium (test-tooling) | document + a settle signal |
| 7 | No machine-readable settle signal (no global idle) | ~6 `aria-busy`/`data-state`, **0** global | **High** | app-shell global signal |

Counts are from a grep sweep on `main` at audit time; treat them as a ratchet baseline,
not a frozen census.

---

## 1. Synthetic-event triggers

A click handler dispatches a *synthetic* event instead of invoking the real behavior.
The action then depends on a global listener existing, being mounted, and the host
(browser/OS) not intercepting the event first — none of which a test can assume.

**Keyboard-event triggers (worst — the command-palette case):**

- `packages/app-shell/src/layout/AppHeader.tsx:767` — search button: `onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}`
- `packages/app-shell/src/layout/AppHeader.tsx:784` — same, mobile/tablet header.

These re-emit `⌘K` and hope `CommandPalette`'s global listener is mounted and that the
browser hasn't already claimed `⌘K`. Under automation (and under real `⌘K`-reserving
browsers) the panel does not open. This is the literal symptom that prompted the audit.

**Synthetic-mouse triggers (open via a queried DOM node):**

- `packages/app-shell/src/layout/AppSidebar.tsx:158` — `document.querySelector('[data-sidebar="trigger"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`
- `packages/app-shell/src/layout/UnifiedSidebar.tsx:167` — same idiom.

**Window/event-bus dispatch (legitimate pattern, but the *real* control still needs a locator):**

- `packages/plugin-dashboard/src/DashboardRenderer.tsx:907` — `new PopStateEvent('popstate')` (SPA nav nudge)
- `packages/layout/src/PageHeader.tsx:150` — `new PopStateEvent('popstate')`
- `packages/plugin-detail/src/DetailView.tsx:493` — `new CustomEvent('objectui:record-changed')`
- `packages/app-shell/src/views/RecordDetailView.tsx:1631` — `new CustomEvent('objectui:record:inline-edit-toggle')`
- `packages/plugin-view/src/FilterUI.tsx:100` — `new CustomEvent(schema.onChange, …)`

> Verdict: the **keyboard/mouse synthetic triggers** are true anti-patterns — replace
> with a direct command call. The **CustomEvent/PopState** uses are an acceptable event
> bus / history nudge, *provided* the user-facing control that ultimately fires them
> carries a stable locator and an idempotent command path.

## 2. Non-idempotent toggle as the open path

`setOpen(prev => !prev)` used as the *primary open* path. A test (or AI) cannot "ensure
open" — re-issuing the trigger when already open *closes* it. There is no
`open()`/`close()` to call.

- `packages/app-shell/src/chrome/CommandPalette.tsx:67` — `setOpen(prev => !prev)` (⌘K; the only non-keyboard entry is the broken synthetic button from §1)
- `packages/components/src/ui/sidebar.tsx:110` — `setOpen((open) => !open)` (⌘B sidebar; no in-sidebar button)
- `packages/plugin-kanban/src/CardTemplates.tsx:66` — `setOpen(prev => !prev)` (template dropdown)
- (+2 more matched by the `set*Open(x => !x)` sweep)

> Verdict: reserve `toggle()` for an explicit toggle button. Dialog/drawer/menu/palette
> *open* paths must expose idempotent `open()` (and ideally be URL-addressable, §4).

## 3. Keyboard / hover / focus-gated sole triggers

Behavior reachable *only* via a key combo, hover, or focus — with no click/route
alternative — is invisible to a click-driven agent and fragile to host interception.

- **56** files/handlers test `metaKey || ctrlKey` (keyboard shortcuts). Most are *also*
  reachable by click; the **sole-trigger** offenders are the §1/§2 cases (`⌘K`, `⌘B`).
- **16** `onMouseEnter` interactions (hover-reveal). Hover-only entry points are
  unreachable for an agent that clicks but does not synthesize pointer-move.

> Verdict: a keyboard shortcut or hover affordance is always an *accelerator*, never the
> *only* path. Every action needs a click- and/or route-reachable entry.

## 4. Non-URL-addressable ephemeral state

Major UI state lives only in component `useState`, so it cannot be deep-linked, restored
on reload, or driven by navigating to a URL — the single most powerful automation
primitive (it is *why* lists and record pages are testable: they are routes).

Representative offenders:

- `packages/app-shell/src/chrome/CommandPalette.tsx:54` — `[open, setOpen]` (palette open)
- `packages/app-shell/src/views/RecordDetailView.tsx:298,301,305` — action confirm / param / result dialogs
- `packages/app-shell/src/views/RecordDetailView.tsx:132` — `[screenFlow, setScreenFlow]` (wizard step not in URL)
- list filter/sort builder popovers (`plugin-list`) — state in component, not searchParams
- plugin overlays (`plugin-form`, `plugin-detail`, `plugin-grid`) default to `useState`

> Verdict: "open dialog / drawer / wizard step / active filter" should be reflectable in
> the URL on the surfaces where deep-linking matters. This is also a UX/shareability win,
> not only a test win.

## 5. Missing stable locators

Interactive elements without a `data-testid` *and* without an ARIA role/name force tests
onto fragile selectors (positional CSS/XPath, or i18n-fragile visible text).

- Repo-wide: **726** `data-testid` vs **1222** `onClick` — roughly **40%** of clickable
  surfaces lack a stable locator.
- Worst in the shared primitives: most of `packages/components/src/ui/*` (Button, Select,
  Popover, Dialog) and most `packages/fields/src/widgets/*` (TextField, SelectField,
  BooleanField, …) emit no `data-testid`.

> Verdict: locators must be emitted by the **renderer/design-system**, derived from
> metadata (object/field/action names) so every generated app inherits them — not
> hand-added per app.

## 6. Debounced / controlled inputs that ignore value-injection

Controlled + debounced inputs only react to *trusted* input. Value-injection
(`el.value = …` + synthetic `input`) does not fire React's `onChange`, so the debounced
fetch never runs and the request never leaves the page.

- `packages/plugin-list/src/ListView.tsx` — list search box
- `packages/fields/src/widgets/RecordPickerDialog.tsx` — record-picker search
- `packages/fields/src/widgets/LookupField.tsx` — inline lookup search

> This is exactly the class that hid three real bugs (server `$search` no-op, client
> dropping `$search`, `$searchFields` comma-string ignored) until they were exercised with
> **CDP-real keystrokes**. The fix is two-fold: (a) document that these inputs require a
> trusted-input driver; (b) provide a settle signal (§7) so the debounce boundary is
> observable. See `memory: reference_browser_e2e_verification`.

## 7. No machine-readable settle signal

There is no global "the app is idle / no requests in flight" signal. Tests must hardcode
waits or poll per-component loading state.

- Local signals exist in ~6 spots only: `plugin-list/ListView`, `plugin-list/ViewSwitcher`,
  `plugin-timeline/ObjectTimeline`, `components/custom/refresh-indicator`,
  `components/ui/sidebar` (`data-state`), `components/renderers/complex/data-table`.
- **No** `window.__idle` / in-flight counter / `pendingRequests` global exists.

> Verdict: app-shell should expose a single global in-flight/idle signal (and standardize
> `aria-busy`/`data-state` on async regions) so "wait until settled" is a one-liner for
> any agent.

---

## Headline systemic gaps

1. **Synthetic triggers break click→state fidelity** — the highest-fidelity blocker.
   The two `AppHeader` keyboard dispatches are the command-palette symptom; the sidebar
   mouse dispatches are the same idiom.
2. **Toggle-as-open prevents "ensure open"** — 5 critical surfaces (palette, sidebar,
   kanban) cannot be deterministically opened.
3. **Ephemeral state is not URL-addressable** — palettes, dialogs, wizard steps, filters
   can't be deep-linked or restored; back/forward is unreliable.
4. **Locators are author-supplied, not renderer-supplied** — ~40% gap, concentrated in
   the very primitives every generated app reuses.
5. **No global settle signal** — every test reinvents waiting; the debounced-input class
   (§6) is untestable without it.
6. **No documented contract** — there is no ADR, no `data-testid` convention, no
   `aria-busy`/`data-state` standard, and adoption is organic.

## Why this is a platform problem, not a bug list

ObjectUI **generates** UIs from metadata. So testability is a property of the
**renderer + design-system**, not of each app's hand-written tests. Fix the overlay
primitive once → every generated palette/dialog/drawer becomes openable, locatable, and
URL-addressable. That is the leverage [ADR-0054](../adr/0054-ui-testability-contract.md)
acts on, and the ratchet it proposes is what keeps the counts above from regressing.
