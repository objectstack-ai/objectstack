/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * MEASUREMENT GATE: the objectui#3291 DOM-leak canary sweep, generalized beyond
 * `packages/fields` to the registry-reachable SDUI widgets of the four packages
 * objectui#4425 named (plugin-charts, plugin-calendar, plugin-chatbot,
 * plugin-dashboard) — and, since objectui#5574, to the renderer family in
 * `packages/components/src/renderers/**`, which is the bulk of what this gate
 * now covers.
 *
 * ## What this is, and what it deliberately is NOT
 *
 * This file landed as phase 1 of objectui#4425: **measure before converging.**
 * It renders every target through the real SDUI path with planted canaries and
 * checks every attribute of every rendered element against what HTML actually
 * defines. It changes **no widget contract and no widget source** — leaks it
 * finds are RECORDED in {@link LEAK_LEDGER} with a reason and an owning issue,
 * never silently tolerated and never fixed here.
 *
 * Phase 2 is now RULED (objectui#4425, comment 5270759246): option 1 —
 * `toDomProps`' whitelist is promoted to the SDUI widget contract, and the
 * migration runs as per-package cards that each delete their own ledger rows.
 * So this gate's job changed without its mechanism changing: it was the
 * measurement the ruling was waiting for, and it is now the ratchet that
 * migration is graded against. The reading, kept at current truth as each card
 * lands:
 *
 *   | package          | targets | targets leaking | leaked attributes |
 *   |------------------|---------|-----------------|-------------------|
 *   | plugin-charts    |       5 |               0 |                 0 |
 *   | plugin-calendar  |       3 |               0 |                 0 |
 *   | plugin-chatbot   |       3 |               0 |                 0 |
 *   | plugin-dashboard |       7 |               0 |                 0 |
 *   | components       |     150 |              82 |          12 .. 15 |
 *
 * **82 of 168 targets leak.** All of them are the `components` row, which is
 * objectui#5574 and is covered in its own section below. The four packages
 * objectui#4425 named now read zero. Three migration steps have closed their
 * rows since the phase-1 measurement:
 *
 *   - `plugin-chatbot:chatbot` / `chatbot-enhanced` — 14 attributes each,
 *     objectui#4431 / PR #4485, which also lifted `toDomProps` to
 *     `@object-ui/core` so later cards consume one executor.
 *   - `plugin-dashboard:dashboard` (spelled `view:dashboard` until
 *     objectui#9533) — `DashboardRenderer`'s widget-grid container, 13
 *     attributes, objectui#4432.
 *   - `plugin-dashboard:metric` / `metric-card` — the KPI cards' open tail, 7
 *     and 9 attributes, objectui#4425 itself: the last two rows inside these
 *     four packages. See "what is left of it" below.
 *
 * The four packages now reading 0 are NOT clean for the same reason, and the
 * difference is worth keeping straight: `plugin-charts` never spreads the node
 * onto its container at all; `plugin-calendar`'s components take a declared prop
 * list and drop what they do not name, so the node's keys never reach an
 * element; `plugin-chatbot`, `DashboardRenderer`'s grid and the two KPI cards
 * reach zero by FILTERING — they still spread, through `toDomProps`. The KPI
 * cards filter on the renderer's door only: rendered directly as React
 * components they keep their declared `HTMLAttributes` pass-through
 * (objectui#4426), and this gate, which renders every target through
 * `SchemaRenderer`, never sees that door.
 *
 * `calendar-view` was originally swept with the `events` canary WITHHELD, because
 * authoring it crashed the component outright (objectui#4433) — a worse failure
 * than the leak this gate was looking for, and one that would have read as a
 * clean pass. That is fixed, so the omission is gone and the target is swept
 * with the full canary set; section 5 below carries what is left of it.
 *
 * ## The divergence that decided phase 2, and what is left of it
 *
 * objectui#4425's option 3 was "record the divergence rather than converge".
 * Both answers were live in the tree at once and this gate observed both, which
 * is how the ruling got its evidence:
 *
 *   - a **whitelist** (`toDomProps`, #3291): keep the declared DOM pass-through
 *     keys, drop everything else. Born in `packages/fields`, whose own gate
 *     (`fields/src/__tests__/widget-dom-leak-e2e.test.tsx`) is untouched by this
 *     file and stays the reference implementation of the technique; the
 *     MECHANISM now lives in `@object-ui/core` (`utils/dom-props.ts`, #4431) so
 *     every plugin package can reach it.
 *   - a **deny-list** (`plugin-dashboard/src/schemaHostProps.ts`, #4357/PR
 *     #4428): destructure seven measured non-DOM props out, spread the rest.
 *
 * The deny-list was correct for the seven props it enumerates — this sweep
 * confirmed all seven gone from `metric` and `metric-card`. What it could not
 * close was the **open tail**, exactly as `toDomProps`' docblock predicted: an
 * authored key the component does not declare still reached the DOM. That was
 * not a hypothetical here; it was two {@link LEAK_LEDGER} rows, `metric` (7
 * attributes) and `metric-card` (9), where `zzcanary` / `reference_to` / `name`
 * / an authored `props: { colorVariant }` — and, on `metric-card`, an authored
 * `label` — all landed as attributes while every one of the seven named keys
 * was correctly stripped. A deny-list bounded by enumeration cannot be
 * finished; a whitelist bounded by declaration can. That contrast IS the
 * measurement phase 2 waited for, and the ruling went to the whitelist on it.
 *
 * The divergence is now gone from these four packages. objectui#4425 moved the
 * two KPI components' renderer door onto `toDomProps` and deleted both rows in
 * the same change — the two-way expiry below, which turned this gate red on
 * exactly those two targets (each measured `[]` against its row) until they
 * went. The deny-list stays in `schemaHostProps.ts` as the direct React door's
 * filter, which this gate does not render.
 *
 * ## objectui#5574 — the family this sweep could not see, and what it found
 *
 * Until objectui#5574 this gate's discovery was four namespace prefixes wide.
 * `packages/components/src/renderers/**` registered **158 types across five**
 * (`ui:`, `element:`, `page:`, `action:`, `protocol-placeholder:`) and not one
 * of them was reachable, so the whole family sat outside the ratchet. That is
 * not a theoretical hole: it is why `ui:grid`'s leak had to be found BY HAND
 * during objectui#4011 / PR #4785 rather than by this file.
 *
 * The widening was measured both ways before it was written, at one scope:
 *
 *   - PROBE — register one extra widget under `ui:`, a prefix this family owns,
 *     and run the gate as it stood: **green**. The completeness case never saw
 *     it.
 *   - CONTROL — the same perturbation, same assertion, one namespace over:
 *     register one extra widget under `plugin-dashboard:`, a prefix the gate
 *     DID cover: **red**, naming the unswept type. So the mechanism works and
 *     the four-prefix input was the whole of the gap.
 *
 * A control at some other scope would have proved nothing here — it could not
 * have failed. These two differ in exactly one thing: which namespace the extra
 * widget went into.
 *
 * ### The reading — 119 of 158 ON ARRIVAL, in seven shapes; 82 today
 *
 * The card named four candidates (`flex`, `stack`, `container`, `text`) and was
 * careful to call them candidates. All four leaked. So did 115 others, and the
 * measurement is in {@link COMPONENTS_LEAK_GROUPS}, grouped by the MECHANISM
 * that produces each shape rather than one hand-written sentence per renderer.
 * `ui:grid` read clean, which is objectui#4787 / PR #5573's fix now pinned by
 * a gate instead of by hand.
 *
 * Twenty-two rows have since been DELETED rather than edited. First `ui:flex`,
 * `ui:stack`, `ui:container` and `ui:text` (objectui#5574), then the eighteen
 * form controls that made up the whole `BARE_SPREAD_MINUS_NAME` shape
 * (objectui#5632) — which took a SHAPE off this list, not just rows, so the
 * grouping is six mechanisms now and not seven. All twenty-two measure clean,
 * so their rows had to go for the gate to pass — the two-way expiry below,
 * working exactly once it had something to expire. Later slices took more,
 * and objectui#5632's `ui:sidebar-trigger` took the last shape that named a
 * single renderer: **82 rows in FOUR shapes** remain, on a target set of 150
 * today (it grew past 158, and objectui#10859 batch 8 phase 2d took the ten
 * retired `ui:sidebar-*` part keys out of it). What the arrival reading measured is preserved here in prose and in
 * the burn-down note on {@link COMPONENTS_LEAK_GROUPS}; what the gate asserts
 * is always current truth, which is the whole point of not writing dates into
 * a ledger.
 *
 * ⚠️ That reasoning is right about the ROWS and was wrong about the COUNTS: the
 * numbers quoted in this docblock were a SECOND, unasserted copy of the same
 * facts, and six of them had drifted by objectui#8659 — three correctly scoped
 * PRs each moved an array and left the prose behind. Section 6 closes it: every
 * count above is now read back out of this file's own text and checked against
 * the arrays. Adding a count to this docblock without adding it there puts the
 * next slice back where objectui#8659 found this one.
 *
 * ### Four phantom cleans, which are the finding behind the finding
 *
 * A first pass over this family reported 46 clean targets. Sixteen of those
 * were not clean — they had rendered NOTHING, or rendered an error boundary,
 * and an empty scan reports no leaks:
 *
 *   - 12 rendered no element at all: the overlays are closed until
 *     `defaultOpen`, `action:*` return `null` with no actions, and `ui:icon`
 *     returned `null` because the canary node's `name` is not a lucide icon.
 *
 *     ⚠️ `ui:icon` is the one of those twelve that has since been FIXED at the
 *     renderer rather than worked around here (objectui#5631). It used to need
 *     a forced `schemaExtras: { name: 'check' }` to render at all; it now
 *     renders a visible placeholder for an unresolvable glyph, so it is swept
 *     as an ordinary plain target on the node this file actually authors —
 *     identity `name: 'canary_node'` and nothing else. Its `BARE_SPREAD_ON_SVG`
 *     row was re-measured on that node as the ruling required and was
 *     UNCHANGED: the placeholder is the same bare spread onto the same SVG
 *     host, so it leaked the same fourteen. That the row did not move is the
 *     point — the reading no longer depended on a workaround that hid whether
 *     the renderer rendered. That row is now GONE, burned by objectui#5632
 *     (see the burn-down record below); this note is kept because the phantom
 *     it describes is a property of the SWEEP, not of the row.
 *   - 4 threw `useSidebar must be used within a SidebarProvider` and were
 *     caught by `SchemaErrorBoundary`, whose markup is attribute-clean.
 *
 * That is traps 1, 3 and 4 of the list below, at scale, and it is the reason
 * this family's readiness is an AUTHORED `className` ({@link COMPONENTS_READY})
 * rather than one transcribed selector per target: it proves the widget rendered its own
 * host element on every target, uniformly, and it caught all sixteen. The
 * targets it cannot cover carry their reason in
 * {@link READY_OVERRIDE_REASONS}, pinned two-way so that list cannot grow
 * quietly.
 *
 * Three of those six were swept in a PLACEHOLDER branch — `element:repeater`,
 * `element:definition-list` and `element:metadata_viewer` rendered an empty
 * state because the fixture never gave them enough to reach their real markup.
 * Their clean reading covered that branch only, and was recorded as such
 * rather than implied.
 *
 * ### objectui#5630 — deepening the three placeholder-branch fixtures
 *
 * Fixed by authoring real content for each, and — for the two that need it —
 * a per-target REACT HOST, the same technique `sidebar` above already uses:
 *
 *   - `element:definition-list` — pure schema. Authoring `items` is enough;
 *     no host needed.
 *   - `element:repeater` — needs `AdapterCtx` populated with a fixture whose
 *     `find()` returns a row. Measured first, and worth stating precisely
 *     because the issue that opened this card described the mechanism as
 *     "the sweep's `FAKE_ADAPTER` answers with no rows by design" — that undersold
 *     it: `useAdapter()` reads `AdapterCtx`, a context this suite never wires
 *     at all (it is normally populated by `app-shell`'s own `AdapterProvider`,
 *     which dials a real network client this suite has no business importing).
 *     So `element:repeater` was never actually reading `FAKE_ADAPTER`'s empty
 *     answer — the renderer's `useEffect` short-circuits on `!adapter` before
 *     ever calling `.find()`, on ANY fixture. Widening what `FAKE_ADAPTER`
 *     returns, the naive reading of the issue's own suggested shape, would
 *     have changed nothing; the fix is a new, additive `AdapterCtx.Provider`
 *     host (`REPEATER_FAKE_ADAPTER`), scoped to this one target only.
 *   - `element:metadata_viewer` — needs `MetadataCtx` populated with a
 *     resolvable `permission` fixture (`METADATA_HOST_CONTEXT`), the third
 *     data channel this family uses (`useMetadataItem()`), independent of
 *     both of the above.
 *
 * Two of the three dropped their `READY_OVERRIDE_REASONS` entry entirely:
 * `element:definition-list`'s `<dl>` and `element:repeater`'s `<ul>` both fold
 * `schema?.className` into their own `cn(...)` once they have real content, so
 * the shared readiness class reaches the DOM the same as any plain target and
 * the default {@link COMPONENTS_READY} selector matches. `element:metadata_viewer`
 * did NOT drop out — measured, not assumed, against an expectation at dispatch
 * time that it would: its `Shell` wrapper's className is hardcoded in every
 * branch (`ViewerProps` declares no `className` field), so no fixture depth
 * changes that. Its entry is rewritten to name the real render instead of the
 * not-found placeholder, not deleted. Net: `READY_OVERRIDE_REASONS` shrinks
 * from six entries to four — by TWO, not three.
 *
 * All three read CLEAN in the populated branch, same as they did in the
 * placeholder branch — but now as a measurement of markup that actually
 * exists, not as a report of nothing having rendered. Traced rather than
 * inferred: neither `basic/data-list.tsx` nor `basic/metadata-viewer.tsx`
 * spreads `{...props}` (or any rest of the React props `SchemaRenderer` hands
 * these components) onto a DOM element anywhere in either file — every host
 * element they render is hand-built from named fields only. So the canary
 * families this sweep plants have no path to the DOM in ANY branch of these
 * three renderers, regardless of fixture depth. The reverse-verification for
 * each target (a deliberately planted leak on the now-reachable populated-
 * branch element, confirmed to fail the gate, then reverted) is what turns
 * that trace into a measurement instead of a prediction; see the PR for the
 * transcript.
 *
 * ### Why the ledger, and why the renderer fixes are NOT in this change
 *
 * Widening the gate and fixing what it catches are separable, and folding 119
 * renderer fixes into the change that first measures them would destroy the
 * measurement: the ledger IS the record of what the tree looked like when the
 * gate arrived, and a PR that both widens and fixes leaves no reading anyone
 * can check the fixes against. `packages/components` is also the most-shared
 * package in the repo, so 119 renderer edits in one PR is the worst possible
 * shape for a merge queue several agents are landing into. The convergence runs
 * as per-package cards that each delete their own rows — the objectui#4425
 * phase-2 pattern this file already grades, now with rows to delete.
 *
 * ### Why a warning-as-error pin is not the answer here either
 *
 * objectui#4787 asked whether React's unknown-attribute warning could close
 * this class instead. PR #5573 answers that in full and the answer is no —
 * React does not warn for all-lowercase attributes at all, its suggested remedy
 * silences the warning while keeping the leak, Vitest discards console output
 * from passing tests, and the warning latches per prop name so a shared canary
 * consumes it. This family makes the point concrete: of the 14 attributes in
 * the commonest shape, the ones React would warn about are a minority, and the
 * SVG-hosted group objectui#5632 burned was one React reported differently
 * again — camelCase survives on an SVG host, so the spelling React sees and the
 * spelling that lands are the same and no warning distinguishes them. The
 * technique that closes the class reads the DOM, which is what this file does.
 *
 * ## Why this file lives in `packages/app-shell`
 *
 * The objectui#4409 dependency-direction method, applied to this sweep. A gate
 * that renders widgets from four plugin packages must live somewhere that may
 * legally import all four. Measured against the manifests on this tree:
 *
 *   - None of the four target packages can host it. `plugin-dashboard` declares
 *     only `plugin-charts` (a devDependency); no target package depends on
 *     `plugin-calendar` or `plugin-chatbot` at all. Hosting the sweep in any one
 *     of them would invert the dependency direction for the other three — the
 *     same inversion #4409 refused when it kept the map gate out of
 *     `@object-ui/i18n`.
 *   - Four workspace entries declare all four: `apps/console`, `apps/site`,
 *     `examples/console-starter` and `packages/app-shell`. The first three are
 *     applications and examples, not the natural home of a cross-package
 *     invariant.
 *   - `packages/app-shell` declares all four (`devDependencies`, which is the
 *     correct field for a test-only import and is what
 *     `scripts/check-phantom-dependencies.mjs` honours for a `__tests__/` file),
 *     and it declares `@object-ui/components` as a runtime `dependency` — so
 *     objectui#5574's widening needed no manifest change at all, and the
 *     direction argument holds a fortiori for it,
 *     and it is already the home of this repo's cross-package gates —
 *     `__tests__/spec-symbol-parity.test.ts` and #4409's own
 *     `__tests__/defaults-maps-mirror-en-pack.test.tsx`.
 *
 * So one suite covers all four packages and the "one suite per package" fallback
 * the card allowed for was not needed.
 *
 * ## Four traps that make a sweep like this pass while testing NOTHING
 *
 * Each was hit while building this file, and each is now an assertion rather
 * than a comment. This is the non-vacuity discipline: a target that does not
 * really render is a RED gate, never a quiet zero.
 *
 * 1. **A lazy boundary answers with a skeleton.** Every `plugin-charts` target
 *    renders through `React.lazy` inside `ChartRenderer`. The first measurement
 *    scanned the Suspense fallback (`class="animate-pulse …"`) and reported nine
 *    clean chart targets while the chart component had never mounted. Every
 *    target therefore has to reach a readiness selector proving its REAL markup
 *    exists before anything is scanned — for the charts that is the
 *    `[data-slot="chart"]` container the spread actually lands on. See the
 *    import block below for why the modules behind that boundary cannot simply
 *    be preloaded at module scope.
 * 2. **Portals are not in the render container.** `chatbot-floating` mounts
 *    through `ReactDOM.createPortal` into `#floating-chatbot-portal` on
 *    `document.body`, so an RTL `container`-scoped scan saw ZERO elements and
 *    reported it clean. This sweep scans `document.body`.
 * 3. **An error boundary looks like a render.** `SchemaErrorBoundary` catches a
 *    throwing widget and renders its own tidy alert markup, which has no leaked
 *    attributes at all. Three calendar targets "passed" that way. Every target
 *    now asserts the boundary is ABSENT before scanning.
 * 4. **A host-less render is a different component.** `object-calendar` throws
 *    `useSchemaContext must be used within a SchemaRendererProvider` on a bare
 *    `SchemaRenderer`, and an unconfigured one renders a "configuration
 *    required" placeholder instead of the calendar. Renders go through the
 *    provider, and each target carries the minimum schema its real markup needs.
 *
 * ## The judge is shared — it is no longer this file's to keep
 *
 * `isKnownAttribute` / `findLeaks` / `leakReport` used to be defined below, as
 * a copy of the judge in `packages/fields/src/__tests__/widget-dom-leak-e2e.test.tsx`.
 * That copy is gone: objectui#4434 extracted one judge into
 * `@object-ui/test-support` (private, never published — see its README for why
 * that home and not a subpath export), carrying the UNION of what the two
 * copies knew. The sweep-only half of that union is the ten recharts
 * marker/gradient/pattern attributes this file's SVG list had grown and the
 * fields copy never had; the calibration fixtures moved with the judge and now
 * exercise them.
 *
 * What did NOT move is everything below: the canary sets, the target
 * enumeration, the readiness selectors, {@link LEAK_LEDGER} and every
 * assertion. Only the judge unifies — a judge that starts carrying one gate's
 * policy is back to being two judges wearing one name.
 */

import type { ComponentType } from 'react';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { render, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
// Module scope: the component registrations these packages perform as a side
// effect. The modules behind `ChartRenderer`'s `React.lazy` boundary CANNOT be
// preloaded the same way — `@object-ui/plugin-charts` exports only `.`, so
// `@object-ui/plugin-charts/ChartImpl` resolves for Vite's alias but not for
// tsc (TS2882), and widening that package's `exports` would be a public-surface
// change this measurement-only PR must not make. The readiness selector each
// chart target carries is what covers it instead: the load happens inside a
// deliberately generous 10s `waitFor` rather than outside it (AGENTS.md
// 测试纪律 / objectui#3010).
import '@object-ui/components';
// The one HOST this sweep needs beyond `SchemaRendererProvider` (trap 4). Four
// `packages/components` targets read `useSidebar()` and threw
// `useSidebar must be used within a SidebarProvider` without it — measured, and
// a throw renders attribute-clean error-boundary markup that reads as a clean
// pass. Two are left under it: `ui:header-bar`, which still throws bare, and
// `ui:sidebar`, which since objectui#10859 batch 8 phase 2d mounts its own
// provider only when none is above it, and so uses this one. The other two,
// `ui:sidebar-trigger` and `ui:sidebar-menu-button`, retired with that phase.
// It is a REACT host, deliberately not a `ui:sidebar-provider` SCHEMA node:
// that node was itself a swept target carrying the full canary set, so
// wrapping in it would have attributed the wrapper's own leaks to the target
// inside (and that key retired with the same phase).
import { SidebarProvider } from '@object-ui/components';
// Two more HOSTS, added by objectui#5630 to deepen `element:repeater` and
// `element:metadata_viewer` past their empty-state branch (see the section
// below `READY_OVERRIDE_REASONS`). `AdapterCtx` matters because
// `element:repeater` reads data through `useAdapter()` (`AdapterCtx`), a
// SEPARATE channel from `SchemaRendererProvider`'s `dataSource` prop below —
// `FAKE_ADAPTER` on that prop is never even reached by this renderer, so
// widening what it returns would have done nothing. `AdapterCtx` is normally
// wired by `app-shell`'s own `AdapterProvider`, which this suite does not
// import (it dials a real network client); the fake value below duck-types
// only the `.find()` the renderer calls. `MetadataCtx` is for
// `element:metadata_viewer`, which resolves its target through
// `useMetadataItem()` — a third channel again, unrelated to both of the above.
import {
  SchemaRenderer,
  SchemaRendererProvider,
  AdapterCtx,
  MetadataCtx,
  type MetadataContextValue,
} from '@object-ui/react';
import '@object-ui/plugin-charts';
import '@object-ui/plugin-calendar';
import '@object-ui/plugin-chatbot';
import '@object-ui/plugin-dashboard';
// The attribute judge, shared with `packages/fields`' gate (objectui#4434).
// Its calibration fixtures live next to it and prove it for both gates.
import { findLeaks, leakReport } from '@object-ui/test-support';
import type { Leak } from '@object-ui/test-support';

/* ════════════════════════════════════════════════════════════════════════════
 * The canaries
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The props a host INJECTS, which a widget never authored and must not forward.
 * `schema` is injected by `SchemaRenderer` on every single render; the rest are
 * authored SDUI metadata that survives the renderer's own strip list (see
 * `packages/react/src/SchemaRenderer.tsx`, the `React.createElement` block) and
 * the `props` CONTAINER, whose contents the renderer already spreads separately.
 */
const INJECTED_SDUI_KEYS = {
  bind: 'data.revenue',
  events: { onClick: [{ action: 'navigate', params: { url: '/x' } }] },
  ariaLabel: 'Canary label',
  ariaDescribedBy: 'canary-desc',
};

/**
 * The OPEN TAIL: ordinary keys an author wrote on the node that no component
 * declares. This is the half a deny-list structurally cannot close, and the
 * reason #3291 chose a whitelist. `reference_to` and the `zzcanary*` family are
 * the same canaries the fields gate plants, kept identical on purpose so the two
 * gates report the same vocabulary.
 */
const AUTHORED_EXTRAS = {
  zzcanary: 'CANARY-STR',
  zzcanaryobj: { nested: true },
  zzcanarynum: 42,
  zzcanaryCamel: 'CANARY-CAMEL',
  reference_to: 'contacts',
};

/**
 * Authored `props: { … }`. `colorVariant` is objectui#4425's own measured
 * example — `metric-card` has no such prop, so it landed as `colorvariant`
 * until that card moved onto `toDomProps`.
 */
const AUTHORED_PROPS = {
  colorVariant: 'success',
  zzcanaryprop: 'CANARY-PROP',
};

/**
 * The injected data-source ADAPTER. It does not come from the node — the
 * renderer strips the schema's own `dataSource` BINDING by name
 * (objectstack#5576) — it is the adapter a host hands `SchemaRenderer`, and it
 * is the one prop that only leaks on a dashboard that actually loads data. PR
 * #4428 shipped a six-key first pass because a schema-only measurement cannot
 * see it. Answering with empty results keeps every data-bound target on its
 * real render path rather than an error state.
 *
 * ⚠️ That last sentence has ONE measured exception, and it is not an error
 * state: since objectui#7130 an empty result is a real render path for
 * `ObjectChart` that is not its CHART markup — it renders a self-describing
 * empty state. The two object-bound chart targets therefore author their own
 * rows; see {@link OBJECT_CHART_EXTRAS}. Read that before widening this
 * adapter: handing rows to all ~200 targets would move many of them off the
 * branch they are pinned on.
 */
const FAKE_ADAPTER = {
  find: async () => [],
  findOne: async () => null,
  aggregate: async () => [],
  count: async () => 0,
  getObject: async () => null,
};

/* ════════════════════════════════════════════════════════════════════════════
 * The target set — MEASURED from the registry, not asserted from the card
 * ══════════════════════════════════════════════════════════════════════════ */

interface Target {
  /** Registry type, as `SchemaRenderer` resolves it. */
  readonly type: string;
  /** Minimum schema this widget needs before it renders its REAL markup. */
  readonly schemaExtras?: Record<string, unknown>;
  /** A selector proving the real component mounted (trap 1, 3 and 4 above). */
  readonly ready: string;
  /**
   * Canary keys withheld from this target, each with the reason. Withholding is
   * never a convenience: every entry here is pinned by its own case below, so a
   * withheld canary is a recorded defect, not a quiet exemption.
   */
  readonly omitCanaries?: readonly string[];
  /**
   * A React host this target must render inside, beyond `SchemaRendererProvider`.
   * Trap 4 again: a host-less render is a different component. For `sidebar`
   * it is a caught throw, which renders CLEAN markup; for the two objectui#5630
   * added it is the opposite direction — without the host the renderer takes
   * its OWN empty-state branch (no throw), which is exactly the phantom-clean
   * gap that card closed. See the host constants below `READY_OVERRIDE_REASONS`.
   */
  readonly host?: 'sidebar' | 'repeater-adapter' | 'metadata';
}

const CHART_DATA = [
  { name: 'Jan', sales: 400, revenue: 240, value: 400 },
  { name: 'Feb', sales: 300, revenue: 139, value: 300 },
];
const CHART_SERIES = [{ dataKey: 'sales' }, { dataKey: 'revenue' }];
/**
 * The scatter target's own rows and series, because scatter is the one family
 * here that {@link CHART_DATA} / {@link CHART_SERIES} cannot reach (objectui#7401).
 *
 * Since objectui#10859 batch 8 (phase 2b) retired the `scatter-chart` key, the
 * scatter target is `plugin-charts:chart` with `chartType: 'scatter'` — the
 * spelling that draws — and the history below is about the retired key. Phase
 * 2c retired `pie-chart`, `donut-chart` and `radar-chart` too, so their three
 * targets left with their registrations (this sweep has one target per
 * registered type).
 *
 * ⭐ Until objectui#7401 this target was NOT SWEPT AT ALL. Its registration
 * declared its family as `defaultProps: { chartType: 'scatter' }`, nothing on
 * the SDUI path read that, and so `plugin-charts:scatter-chart` rendered — and
 * passed this gate — as a BAR chart. `plugin-charts:pie-chart`,
 * `donut-chart` and `radar-chart` were blind in exactly the same way: four of
 * this package's nine targets were one target, measured four times.
 *
 * That is how the defect surfaced, and this file is where the evidence was:
 * PR #7400's `scatter-multi-series` refusal (objectui#7194) SHOULD have
 * reddened this two-series entry the day it landed, and did not. Now that the
 * type resolves to its own family the two meet, so the entry has to be a
 * schema scatter can actually draw, on both counts:
 *
 *   - ONE series. Scatter binds one measure — `series[0].dataKey` is the
 *     `YAxis` key — and a second series is refused by name, not projected.
 *     ⛔ Two series here would sweep the REFUSAL's markup, leaving the scatter
 *     renderer exactly as unswept as it has been.
 *   - A NUMERIC x. Scatter's category axis is a measure, so `name: 'Jan'` has
 *     no position and every row is unplaceable (`no-plottable-points`) — the
 *     other refusal, and the same blindness one step over.
 *
 * ⛔ Do not "simplify" this back onto the shared constants: both of those
 * refusals render attribute-clean markup, which is precisely the phantom-clean
 * pass this gate's objectui#5630 section warns about.
 */
const SCATTER_DATA = [
  { x: 10, y: 400, value: 400 },
  { x: 20, y: 300, value: 300 },
];
const SCATTER_SERIES = [{ dataKey: 'y' }];
/**
 * The two OBJECT-BOUND chart targets (`plugin-charts:object-chart`,
 * `view:chart`). They stay object-bound — `objectName` is what makes them a
 * different registry path from the three inline chart targets above, which reach
 * `ObjectChart` through `ObjectChartBlock` and its `ElementDataSourceGate`.
 *
 * `data` / `series` are authored on TOP of that binding (`data` is a declared
 * registry input on this component: "Optional static data") because
 * {@link FAKE_ADAPTER} answers every query with no rows, and since objectui#7130
 * `ObjectChart` renders a self-describing empty state on an empty result
 * instead of an empty chart frame. Without rows these two targets stop at that
 * empty state, `[data-slot="chart"]` never matches, and the readiness guard
 * below refuses to scan — correctly, because an empty state is not the chart
 * markup this sweep exists to scan.
 *
 * This is objectui#5630's lesson in a third dress: a data-bound target whose
 * clean reading would otherwise cover only its empty-state placeholder. That
 * card answered it with a populated host where a host was needed, and with a
 * plain `schemaExtras` change where the populated branch was reachable from
 * pure schema (`element:definition-list`'s `items`). This is the latter case,
 * and it also makes these two scan STRICTLY MORE markup than before: the
 * pre-#7130 reading swept a chart frame with no marks in it.
 */
const OBJECT_CHART_EXTRAS = {
  objectName: 'accounts',
  chartType: 'bar',
  categoryField: 'name',
  valueField: 'amount',
  data: CHART_DATA,
  series: CHART_SERIES,
};
const CALENDAR_OBJECT_EXTRAS = {
  objectName: 'accounts',
  startDateField: 'start_at',
  titleField: 'name',
};

/* ── `packages/components`: the renderer family objectui#5574 widened this to ──
 *
 * The four plugin packages above were the whole target set until objectui#5574.
 * The gap that card measured: `packages/components/src/renderers/**` registers
 * 158 types across five namespaces and NOT ONE of them was swept, which is why
 * `ui:grid`'s leak had to be found by hand (objectui#4787 / PR #5573) instead of
 * by this gate. `ui:grid` reading CLEAN below is that fix, now pinned.
 *
 * This family is authored differently from the plugin widgets, so three of its
 * pieces are shared rather than per-target.
 */

/**
 * The readiness selector for this family, authored rather than discovered.
 *
 * The plugin targets above each name a selector out of their own markup. Doing
 * that once per target in this family would be one hand-transcribed string
 * each, every one able to rot into a
 * selector that matches something else — and a readiness selector that matches
 * the WRONG element is precisely the trap-1 failure this file exists to refuse.
 * So the node authors a `className` and the selector is derived from it: one
 * string, and it proves the widget rendered its own host element AND honoured
 * an ordinary authored prop while doing it.
 *
 * Measured on the tree this landed on: 152 of 158 targets matched it.
 * Today 147 of 150 targets match it; the other three are in
 * {@link READY_OVERRIDE_REASONS}, each with the reason it cannot —
 * a recorded limitation with its own two-way assertion below, never a quiet
 * exemption (the `omitCanaries` discipline, applied to readiness).
 */
const COMPONENTS_READY_CLASS = 'zzready-canary';
const COMPONENTS_READY = `.${COMPONENTS_READY_CLASS}`;

/**
 * The slot child the overlay targets need — and the reason it is `ui:grid`
 * specifically.
 *
 * This sweep scans `document.body`, so ANY node rendered inside a target
 * contributes its own attributes to that target's reading. An overlay authored
 * with a leaky child would be recorded as leaking keys it never touched.
 * `ui:grid` is the one renderer in this family already converged on
 * `toDomProps` (objectui#4787 / PR #5573), so it is the only child that adds
 * nothing. Measured, with `ui:span` as the child instead: seven overlay targets
 * reported `content` and `type` — both the CHILD's keys.
 */
const CLEAN_SLOT = { type: 'ui:grid' };

/**
 * The overlays render NOTHING until they are open — measured: `document.body`
 * held only RTL's own container div, and every one of them read clean. That is
 * trap 3 in a new dress: not an error boundary this time, just a closed
 * component, and it passes just as quietly.
 */
const OPEN_OVERLAY = {
  defaultOpen: true,
  title: 'Canary title',
  description: 'Canary description',
  trigger: CLEAN_SLOT,
  content: CLEAN_SLOT,
};

/** `action:*` renderers return `null` when no action survives filtering. */
const CANARY_ACTIONS = [
  { name: 'act_a', label: 'Act A', action: { type: 'navigate', url: '/x' } },
];

/**
 * objectui#5630 — the two per-target hosts `element:repeater` and
 * `element:metadata_viewer` need to reach their POPULATED branch, so their
 * clean reading stops covering the empty-state placeholder only.
 * `element:definition-list` needed no host: authoring `items` is pure schema,
 * so it only needed a schemaExtras change (see `COMPONENTS_SPECIAL_TARGETS`).
 *
 * Both fixtures are duck-typed to the one method each renderer actually
 * calls — they are not real adapter/metadata clients, and must not become
 * one; a richer fixture here would be scope creep past what this card
 * measures.
 */
const REPEATER_FAKE_ADAPTER = {
  find: async () => [{ id: 'acc-1', name: 'Acme Corp', amount: 4200 }],
  findOne: async () => null,
  aggregate: async () => [],
  count: async () => 1,
  getObject: async () => null,
};

/** The one metadata item {@link METADATA_HOST_CONTEXT} resolves. */
const METADATA_FAKE_PERMISSION = {
  name: 'sales_permission',
  label: 'Sales Permission',
  objects: {
    accounts: { allowCreate: false, allowRead: true, allowEdit: true, allowDelete: false },
  },
};

const METADATA_HOST_CONTEXT: MetadataContextValue = {
  apps: [],
  objects: [],
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async (type, name) =>
    type === 'permission' && name === METADATA_FAKE_PERMISSION.name
      ? METADATA_FAKE_PERMISSION
      : null,
  getItemsByType: () => [],
  getTypeStatus: () => 'ready',
};

/**
 * Why each of the three targets below cannot use {@link COMPONENTS_READY}, and
 * what its selector proves instead. Every entry is measured, and the assertion
 * in section 3 makes this map and the overrides EXACTLY each other: an override
 * without a reason fails, and a reason whose target no longer needs one fails
 * too. So this cannot become a place to park an inconvenient target.
 *
 * Was six until objectui#5630: `element:definition-list` and `element:repeater`
 * dropped out because their populated branch DOES carry the authored
 * `className` — `<dl>` and `<ul>` both fold `schema?.className` into their own
 * `cn(...)`, so once real content reaches them the shared readiness class
 * reaches the DOM same as any plain target. `element:metadata_viewer` did NOT
 * drop out: its `Shell` wrapper's className is fully hardcoded in every branch
 * (`ViewerProps` has no `className` field at all), so no fixture depth can
 * make it carry the canary — this is a fact about the renderer, not about how
 * empty the fixture is, and fixing it is out of this card's scope (test
 * fixtures only, no renderer edits). Its entry below is REWRITTEN, not
 * deleted: it still names a real gap, just a different one than before.
 *
 * Was four until objectui#10397: `ui:header-bar` dropped out because its
 * renderer now merges `schema.className` onto its root `header` through
 * `cn(...)`, so the shared readiness class reaches the DOM there too. Its
 * reason had said the renderer forwarded the authored `className` to neither
 * its own `header` nor the sidebar wrapper, which that repair made false.
 */
const READY_OVERRIDE_REASONS: Readonly<Record<string, string>> = {
  'ui:toaster':
    'Sonner owns the root it renders and takes no `className` from the node; the selector names the live-region `section` Sonner emits.',
  'ui:tooltip':
    'the authored `className` goes to `TooltipContent`, which is not rendered while the tooltip is closed. `[data-state="closed"]` is the state Radix merges onto the TRIGGER, so it proves the `Tooltip` root mounted. Its clean reading is therefore clean-by-no-DOM, not clean-by-filtering — the `{...props}` spread lands on a Radix root that renders no element (see the reading table).',
  'element:metadata_viewer':
    'swept with a resolvable `permission` fixture (objectui#5630), so this is no longer the not-found placeholder — but `ElementMetadataViewerRenderer`\'s `Shell` wrapper never merges the authored `className` onto its root in ANY branch (`ViewerProps` carries no `className` field), so the selector instead names the populated `Shell` root by its own hardcoded classes.',
};

function componentsTarget(
  type: string,
  schemaExtras: Record<string, unknown> = {},
  ready: string = COMPONENTS_READY,
  host?: Target['host'],
): Target {
  return {
    type,
    ready,
    ...(host ? { host } : {}),
    schemaExtras: { className: COMPONENTS_READY_CLASS, ...schemaExtras },
  };
}

/**
 * The components-owned types that need nothing but the shared readiness class.
 * Enumerated, not prefix-globbed: the parity case in section 3 proves this list
 * plus the specials below is EXACTLY what the registry holds under the five
 * prefixes, so a renderer added to this package cannot slip past unswept.
 */
const COMPONENTS_PLAIN_TYPES: readonly string[] = [
  'action:button', 'action:icon', 'element:button', 'element:divider', 'element:image',
  'element:number', 'element:record_picker', 'element:text', 'element:text_input',
  'page:accordion', 'page:card', 'page:footer', 'page:header', 'page:section',
  'page:sidebar', 'page:tabs', 'protocol-placeholder:ai:suggestion',
  'protocol-placeholder:global:search', 'protocol-placeholder:nav:breadcrumb',
  'protocol-placeholder:nav:menu', 'ui:a', 'ui:abbr', 'ui:accordion', 'ui:address',
  'ui:alert', 'ui:app', 'ui:article', 'ui:aside', 'ui:aspect-ratio', 'ui:avatar', 'ui:b',
  'ui:badge', 'ui:blockquote', 'ui:box', 'ui:br', 'ui:breadcrumb', 'ui:button', 'ui:button-group',
  'ui:calendar', 'ui:card', 'ui:carousel', 'ui:checkbox', 'ui:cite', 'ui:code', 'ui:collapsible',
  'ui:combobox', 'ui:command', 'ui:container', 'ui:context-menu', 'ui:data-table',
  'ui:date-picker', 'ui:dd', 'ui:del', 'ui:div', 'ui:dl', 'ui:dt', 'ui:em', 'ui:email',
  'ui:empty', 'ui:figcaption', 'ui:figure', 'ui:file-upload', 'ui:filter-builder', 'ui:flex',
  'ui:footer', 'ui:form', 'ui:grid', 'ui:h1', 'ui:h2', 'ui:h3', 'ui:h4', 'ui:h5', 'ui:h6',
  'ui:header', 'ui:home', 'ui:hr', 'ui:html', 'ui:i', 'ui:icon', 'ui:image', 'ui:img',
  'ui:input',
  'ui:input-otp', 'ui:ins', 'ui:kbd', 'ui:label', 'ui:li', 'ui:list', 'ui:loading',
  'ui:main', 'ui:mark', 'ui:menubar', 'ui:nav', 'ui:navigation-menu', 'ui:ol', 'ui:p',
  'ui:page', 'ui:pagination', 'ui:password', 'ui:pre', 'ui:progress', 'ui:q',
  'ui:radio-group', 'ui:record', 'ui:resizable', 'ui:scroll-area', 'ui:section', 'ui:select',
  'ui:separator', 'ui:skeleton', 'ui:slider', 'ui:small', 'ui:sonner', 'ui:span',
  'ui:spinner', 'ui:stack', 'ui:statistic', 'ui:strong', 'ui:sub', 'ui:sup', 'ui:switch',
  'ui:table', 'ui:tabs', 'ui:text', 'ui:textarea', 'ui:time', 'ui:toast', 'ui:toggle',
  'ui:toggle-group', 'ui:tree-view', 'ui:u', 'ui:ul', 'ui:utility',
];

/** The targets that need more than the readiness class, each with its reason. */
const COMPONENTS_SPECIAL_TARGETS: readonly Target[] = [
  // Closed overlays render nothing at all (see OPEN_OVERLAY).
  componentsTarget('ui:dialog', OPEN_OVERLAY),
  componentsTarget('ui:alert-dialog', { ...OPEN_OVERLAY, actionText: 'OK', cancelText: 'Cancel' }),
  componentsTarget('ui:sheet', OPEN_OVERLAY),
  componentsTarget('ui:drawer', OPEN_OVERLAY),
  componentsTarget('ui:popover', OPEN_OVERLAY),
  componentsTarget('ui:dropdown-menu', { ...OPEN_OVERLAY, items: [{ label: 'a', value: 'a' }] }),
  componentsTarget('ui:hover-card', OPEN_OVERLAY),
  componentsTarget('ui:tooltip', { trigger: CLEAN_SLOT, content: 'tip' }, '[data-state="closed"]'),
  // `action:*` return `null` with no actions (see CANARY_ACTIONS).
  componentsTarget('action:bar', { actions: CANARY_ACTIONS }),
  componentsTarget('action:group', { actions: CANARY_ACTIONS }),
  componentsTarget('action:menu', { actions: CANARY_ACTIONS }),
  // `useSidebar()` throws without the host — trap 4, and a caught throw is
  // attribute-clean markup that passes. `ui:header-bar` still reads it.
  // `ui:sidebar` no longer throws bare (it mounts its own provider when none is
  // above it, objectui#10859 batch 8 phase 2d); it stays under the host, the
  // app-shell context where it uses the host's provider. `ui:sidebar-trigger`
  // and `ui:sidebar-menu-button` left the sweep with their retired keys.
  componentsTarget('ui:sidebar', {}, COMPONENTS_READY, 'sidebar'),
  componentsTarget('ui:header-bar', {}, COMPONENTS_READY, 'sidebar'),
  componentsTarget('ui:toaster', {}, 'section[aria-label="Notifications alt+T"]'),
  // objectui#5630 — deepened past the empty-state placeholder. `items`
  // authored: pure schema, no host needed, and the populated `<dl>` carries
  // `schema?.className`, so this reaches the default `COMPONENTS_READY`
  // selector like any plain target (no more override reason for it).
  //
  // Nested under `properties`, not authored at the schema top level like
  // `OPEN_OVERLAY` above: `basic/data-list.tsx`'s own docblock says so
  // (`readProps()` reads `schema.properties` with a `schema.props`
  // fallback) — measured the hard way first (`schema.items` silently did
  // nothing; the renderer never looks there, so the empty-state branch
  // rendered regardless of what was authored beside it).
  componentsTarget('element:definition-list', {
    properties: {
      items: [
        { term: 'Owner', description: 'Ada Lovelace' },
        { term: 'Region', description: 'EMEA' },
      ],
    },
  }),
  // objectui#5630 — `useAdapter()` reads `AdapterCtx`, wired here by
  // `REPEATER_FAKE_ADAPTER`, NOT by `FAKE_ADAPTER` on `SchemaRendererProvider`
  // (that prop is a different channel this renderer never reads — see the
  // import-block comment above `AdapterCtx`). Once rows arrive the populated
  // `<ul>` carries `schema?.className` too, so this also reaches
  // `COMPONENTS_READY` and needed no override reason either. `properties`
  // nesting for the same reason as `element:definition-list` above. The query
  // object is the node-level `dataSource` binding, the repeater's only query
  // source (objectui#12345): the flat `properties.object` is retired and unread.
  componentsTarget(
    'element:repeater',
    { dataSource: { object: 'accounts' }, properties: { titleField: 'name', fields: ['amount'] } },
    COMPONENTS_READY,
    'repeater-adapter',
  ),
  // objectui#5630 — resolved through `MetadataCtx` (`METADATA_HOST_CONTEXT`),
  // a `permission` fixture with one object entry so `PermissionView` renders
  // its table rather than the "No object permissions declared" placeholder
  // (a DIFFERENT, still-placeholder branch inside the real view — the sweep's
  // `getItem` deliberately returns a non-empty `objects` map to clear it too).
  // Still overridden: see the reason above — `Shell` never carries the canary
  // class, in any branch. `type`/`name` MUST go under `properties`, same as
  // the two targets above — and doubly so here: at the schema TOP level,
  // `type` is the key `ComponentRegistry` dispatches on (`schemaFor()` spreads
  // `schemaExtras` after it), so an unnested `type: 'permission'` silently
  // overwrites `'element:metadata_viewer'` itself and the sweep resolves
  // "permission" as an unregistered type instead of ever reaching this
  // renderer — measured (the first attempt did exactly that).
  componentsTarget(
    'element:metadata_viewer',
    { properties: { type: 'permission', name: METADATA_FAKE_PERMISSION.name } },
    '.rounded-lg.border.bg-card.overflow-hidden',
    'metadata',
  ),
];

const COMPONENTS_TARGETS: readonly Target[] = [
  ...COMPONENTS_PLAIN_TYPES.map((type) => componentsTarget(type)),
  ...COMPONENTS_SPECIAL_TARGETS,
];

const TARGETS: Readonly<Record<string, readonly Target[]>> = {
  'plugin-charts': [
    { type: 'plugin-charts:bar-chart', schemaExtras: { data: CHART_DATA }, ready: '.recharts-responsive-container' },
    // The scatter carrier since objectui#10859 batch 8 retired `scatter-chart`:
    // bar stays swept through `chart:bar` and `bar-chart`, and this target keeps
    // the scatter arm swept (see SCATTER_DATA).
    { type: 'plugin-charts:chart', schemaExtras: { chartType: 'scatter', data: SCATTER_DATA, xAxisKey: 'x', series: SCATTER_SERIES }, ready: '[data-slot="chart"]' },
    { type: 'plugin-charts:chart:bar', schemaExtras: { data: CHART_DATA, series: CHART_SERIES }, ready: '[data-slot="chart"]' },
    { type: 'plugin-charts:object-chart', schemaExtras: OBJECT_CHART_EXTRAS, ready: '[data-slot="chart"]' },
    { type: 'view:chart', schemaExtras: OBJECT_CHART_EXTRAS, ready: '[data-slot="chart"]' },
  ],
  'plugin-calendar': [
    { type: 'plugin-calendar:calendar-view', ready: '[role="region"][aria-label="Calendar"]' },
    { type: 'plugin-calendar:object-calendar', schemaExtras: CALENDAR_OBJECT_EXTRAS, ready: '[role="region"][aria-label="Calendar"]' },
    { type: 'view:calendar', schemaExtras: CALENDAR_OBJECT_EXTRAS, ready: '[role="region"][aria-label="Calendar"]' },
  ],
  'plugin-chatbot': [
    // The message composer is this widget's real markup; the root above it is
    // the spread site.
    { type: 'plugin-chatbot:chatbot', ready: 'input' },
    { type: 'plugin-chatbot:chatbot-enhanced', ready: 'textarea' },
    // Trap 2: this one mounts through a portal, outside the render container.
    { type: 'plugin-chatbot:chatbot-floating', ready: '#floating-chatbot-portal' },
  ],
  'plugin-dashboard': [
    { type: 'plugin-dashboard:metric', schemaExtras: { label: 'Revenue', value: 42 }, ready: '.rounded-lg.border' },
    // `label` is deliberately NOT this card's heading (`MetricCardProps` spells
    // it `title`): authored here it is one more open-tail key, and it once
    // leaked as `label="Revenue"` (objectui#4425). Kept so the gate keeps
    // proving it stops at the component.
    { type: 'plugin-dashboard:metric-card', schemaExtras: { label: 'Revenue', value: 42 }, ready: '.rounded-lg.border' },
    { type: 'plugin-dashboard:object-metric', schemaExtras: { objectName: 'accounts' }, ready: '.rounded-lg.border' },
    { type: 'plugin-dashboard:pivot', ready: '[data-testid="pivot-empty-state"]' },
    { type: 'plugin-dashboard:object-pivot', schemaExtras: { objectName: 'accounts' }, ready: '[data-testid="pivot-empty-state"]' },
    { type: 'plugin-dashboard:object-data-table', schemaExtras: { objectName: 'accounts' }, ready: '[data-testid="table-empty-state"]' },
    // `DashboardRenderer`'s widget grid — the element its `{...props}` lands on.
    // Spelled `view:dashboard` until objectui#9533 converged the bare `dashboard`
    // key onto this package's own namespace; the renderer is the same one.
    { type: 'plugin-dashboard:dashboard', ready: '.grid.auto-rows-min' },
  ],
  // objectui#5574 — 150 targets, built above rather than spelled here because
  // 133 of them need nothing but the shared readiness class.
  components: COMPONENTS_TARGETS,
};

const ALL_TARGETS: readonly Target[] = Object.values(TARGETS).flat();

/**
 * The namespaces each package owns. Used by the parity case below to prove the
 * lists above still cover everything the four barrels register: a widget added
 * to a plugin without a line here fails loudly instead of quietly going
 * unscanned (the guarantee the fields gate gets from `FORM_FIELD_TYPES`).
 */
const OWNED_NAMESPACES: Readonly<Record<string, readonly string[]>> = {
  'plugin-charts': ['plugin-charts:'],
  'plugin-calendar': ['plugin-calendar:'],
  'plugin-chatbot': ['plugin-chatbot:'],
  'plugin-dashboard': ['plugin-dashboard:'],
  // `packages/components` owns FIVE registry prefixes, which is why this map
  // holds a LIST per package rather than one string. Measured on this tree:
  // every `ui:` / `element:` / `page:` / `action:` / `protocol-placeholder:`
  // registration in the workspace comes from `packages/components/src/renderers/**`
  // — `packages/core` and `packages/sdui-parser` mention `namespace: 'ui'` only
  // in a docstring and in a standalone `verify.ts` script, neither of which
  // registers into this registry at import time. So the prefix scan below is
  // exactly the card's file surface, with nothing else swept into its counts.
  components: ['ui:', 'element:', 'page:', 'action:', 'protocol-placeholder:'],
};

/**
 * Aliases these packages register under the SHARED `view:` namespace. They are
 * listed rather than derived because `view:` is not owned by any one package —
 * `plugin-list`, `plugin-detail` and others register into it too, so a prefix
 * scan would sweep other packages' widgets into these four packages' counts.
 */
const OWNED_VIEW_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'plugin-charts': ['view:chart'],
  'plugin-calendar': ['view:calendar'],
  'plugin-chatbot': [],
  // objectui#9533 — EMPTY, and measured rather than defaulted. This package's
  // dashboard renderer moved out of the shared `view:` namespace onto
  // `plugin-dashboard:dashboard`, so it is covered by the prefix case above.
  // `view:dashboard` is still a registered key, but what answers it is a
  // retirement TOMBSTONE (a refusal alert naming the migration), not a widget:
  // it destructures nothing and spreads nothing onto its element, so there is no
  // pass-through surface for this sweep to measure. Its contract — the refusal
  // and the text of it — is pinned in
  // `packages/plugin-dashboard/src/__tests__/dashboardBareKeyOwnership.test.tsx`.
  'plugin-dashboard': [],
};

/* ════════════════════════════════════════════════════════════════════════════
 * The leak ledger — recorded defects, never silent baselines
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Every leak this sweep found on the tree it landed on, per target, with the
 * exact attribute names and the issue that owns the fix.
 *
 * ## Why a ledger and not a fix
 *
 * objectui#4425's phase-1 ruling is measurement only: this PR touches no widget
 * source and no widget contract. A gate that simply went red on landing would be
 * a broken build, and a gate that skipped the leaking targets would be the
 * silent baseline the ruling forbids. So each leak is written down, in full, at
 * the granularity of the individual attribute.
 *
 * ## The expiry discipline
 *
 * The assertion is EXACT SET EQUALITY, not "at most". A row is therefore a
 * two-way ratchet:
 *
 *   - a NEW leaked attribute on a ledgered target fails the gate, because the
 *     measured set no longer equals the recorded one;
 *   - FIXING a leak ALSO fails the gate, until the corresponding entry is
 *     deleted from this ledger in the same change.
 *
 * That second direction is the expiry: a row cannot outlive the defect it
 * records, because the fix cannot go green while the row is still here. There is
 * no date to forget and no allow-list to rot — the tree itself expires the row.
 * A ledger entry with no `issue` is not allowed; see the shape assertion below.
 */
interface LedgerEntry {
  /** Attribute names, exactly as they reach the DOM (lowercased by HTML). */
  readonly attributes: readonly string[];
  /** Why it leaks — the mechanism, not a restatement of the symptom. */
  readonly reason: string;
  /** The issue that owns the fix. Deleting the row is part of closing it. */
  readonly issue: string;
}

/* ── objectui#5574: the `packages/components` reading, as a LEDGER ─────────── */

/**
 * 82 of the 150 `packages/components` targets leak, and they do it in exactly
 * FOUR shapes (119 targets in seven shapes did on arrival; see the burn-down
 * note below — and note the arrival count of shapes read `eight` here until
 * objectui#5632 counted them: the groups were seven, and the card's own table
 * listed seven). Writing that
 * many near-identical rows longhand would have buried the shapes
 * — so the rows are GROUPED BY MEASURED SHAPE, and every group names its
 * renderers one by one. Nothing here is a wildcard and nothing here is a
 * prefix: {@link LEAK_LEDGER} below is still a per-target map with exact set
 * equality, so the two-way expiry is unchanged. Fixing one renderer means
 * deleting one name from one list, and the gate stays red until that happens.
 *
 * ## The burn-down, so far
 *
 * Rows leave this ledger by being DELETED in the change that fixes them, never
 * by being edited into something looser. The record of what has left:
 *
 *   - objectui#5574 (this card's second pass) — `ui:flex`, `ui:stack`,
 *     `ui:container`, `ui:text`, all four from {@link BARE_SPREAD}. Converged on
 *     `toDomProps` the way `grid.tsx` was by objectui#4787 / PR #5573. The
 *     catalog-scale reading that drove it: 248 `flex`, 153 `stack`, 15
 *     `container` and 699 `text` nodes in `examples/schema-catalog` rendered
 *     through the real `SchemaRenderer` put 1194 illegitimate attributes on the
 *     DOM (`text[content]` 522, `flex[align]` 198, `flex[gap]` 193, `stack[gap]`
 *     153, `flex[justify]` 98, `container[padding]` 14, `container[maxwidth]` 6,
 *     `flex[direction]` 5, `stack[align]` 4, `text[value]` 1); the same probe
 *     reads 0 after, with `grid`'s 26 nodes at 0 both times as the control.
 *
 *   - objectui#5632 — the entire `BARE_SPREAD_MINUS_NAME` shape, all eighteen
 *     members: `action:button`, `action:icon`, `ui:button`, `ui:checkbox`,
 *     `ui:combobox`, `ui:date-picker`, `ui:email`, `ui:file-upload`, `ui:input`,
 *     `ui:input-otp`, `ui:password`, `ui:radio-group`, `ui:sidebar-menu-button`,
 *     `ui:slider`, `ui:sonner`, `ui:switch`, `ui:textarea`, `ui:toggle`. These
 *     render FORM CONTROLS, so the convergence is NOT the bare `toDomProps` the
 *     four above took — it is a form-control DECLARATION over the same
 *     mechanism (`packages/components/src/lib/form-control-dom-props.ts`),
 *     which forwards the `name` and `disabled` the SDUI baseline deliberately
 *     withholds. That distinction is invisible from inside this file, which is
 *     the point of writing it down here: `name` was never in these rows and
 *     `disabled` is not even a canary, so a convergence that dropped both would
 *     have turned this gate green while un-naming and re-enabling every control
 *     in the library. The catalog-scale reading: 287 form-control nodes in
 *     `examples/schema-catalog` put 284 illegitimate attributes on the DOM
 *     (`button[label]` 140, `button[icon]` 25, `input[inputtype]` 23,
 *     `input[label]` 19, `toggle[label]` 14, `radio-group[options]` 8,
 *     `date-picker[placeholder]` 7, `file-upload[label]` 7,
 *     `file-upload[buttontext]` 7, and a 34-attribute tail); the same probe
 *     reads 0 after, with `grid`'s 26 nodes at 0 both times as the control and
 *     an unchanged per-type node census across the two runs.
 *
 *   - objectui#5632 (the slice after that one) — the entire
 *     `BARE_SPREAD_ON_SVG` shape, both members: `ui:icon` and `ui:spinner`.
 *     Converged on the bare `toDomProps`, which is the answer the form-control
 *     group above could NOT take: `IconSchema` and `SpinnerSchema` declare only
 *     `icon` / `size` / `color`, and both renderers already consume all three by
 *     name, so nothing legitimate was withheld and no third declaration was
 *     warranted. The group is DELETED, which took the grouping from six
 *     mechanisms to five.
 *
 *     ⚠️ What this file could not have graded, recorded here because the next
 *     slice needs the warning: on an SVG host the judge counts `stroke`,
 *     `width`, `height`, `fill` and `color` as LEGITIMATE, so everything lucide
 *     emits sits in the half this gate never reports, in either direction. Two
 *     real behaviours lived in it. `ui:spinner` declares `size` as an ENUM and
 *     the spread handed the string to lucide's numeric `size` prop, so every
 *     sized spinner carried `width="lg" height="lg"`; and `ui:icon` declares
 *     `color` as a Tailwind CLASS, which the spread also fed to lucide's
 *     `color` prop, emitting `stroke="text-red-500"`. Both are gone, and
 *     neither moved a number here. They are measured and pinned in
 *     `examples/schema-catalog/test/svg-host-dom-leak-5632.test.tsx`, which
 *     asserts the LEGITIMATE attribute sets too — the guard this gate
 *     structurally cannot provide.
 *
 *   - objectui#5632 (the slice after that one) — `ui:sidebar-trigger`, the
 *     one-member group that leaked FOURTEEN where the rest of its shape leaks
 *     thirteen. The extra attribute was `schema` ITSELF, and it was there for a
 *     SECOND reason, not the group's: every other registration in
 *     `renderers/navigation/sidebar.tsx` destructures `schema` because it needs
 *     `schema.body`, while this one renders no children and named only
 *     `className` — so the node `SchemaRenderer` injects on every render simply
 *     rode the same spread. One filter closed both, and it is the FORM-CONTROL
 *     declaration rather than the bare `toDomProps`: the host is the `<button>`
 *     `SidebarTrigger` renders, where HTML defines `name`. The row's own
 *     thirteen-not-fourteen shape is the evidence — the judge counts the
 *     authored `name` LEGITIMATE here, so a bare `toDomProps` would have
 *     un-named this control without moving one number in this file.
 *
 *     ⚠️ Same warning as the SVG group above, in the other host's vocabulary:
 *     on a `<button>` the legitimate half this gate never reports is `name`,
 *     `id`, `class`, the resolved `aria-*`, `data-obj-*` and the primitive's own
 *     `data-sidebar="trigger"` — eight attributes, measured IDENTICAL before and
 *     after. That reading, plus the fact that the trigger still toggles and
 *     still carries its "Toggle Sidebar" accessible name, was pinned in
 *     `examples/schema-catalog/test/sidebar-trigger-dom-leak-5632.test.tsx`
 *     until objectui#10859 batch 8 phase 2d retired the `ui:sidebar-trigger`
 *     key, and that file with it (2026-10-02).
 *
 * ## This is a ledger, not an allowlist — the difference, stated once
 *
 * An allowlist says "do not look here". Every row below says "we looked, this
 * is what we saw, and here is who owns it". Concretely, and this is the whole
 * distinction: a row cannot get looser on its own. If a listed renderer starts
 * leaking a NINTH attribute the gate fails, because the measured set no longer
 * equals the recorded one; if it stops leaking, the gate ALSO fails until the
 * row goes. An allowlist has neither property. Nothing below is skipped,
 * `it.skip`-ed, quarantined or excluded from the sweep — all 150 targets render
 * and all 150 are scanned on every run, the 68 clean ones included.
 */

/**
 * The shape the card named: destructure `data-obj-id` / `data-obj-type` /
 * `style` (or nothing at all) and spread the rest onto the host element. Every
 * canary family arrives — the injected node metadata, the authored SDUI keys,
 * the authored `props` container and the injected adapter.
 */
const BARE_SPREAD: readonly string[] = [
  'ariadescribedby', 'arialabel', 'bind', 'colorvariant', 'datasource', 'events', 'name',
  'props', 'reference_to', 'zzcanary', 'zzcanarycamel', 'zzcanarynum', 'zzcanaryobj',
  'zzcanaryprop',
];

/**
 * The same bare spread on a host element that DEFINES `name` — form controls,
 * mostly. `name` is absent from these rows not because the renderer stripped
 * it but because HTML makes it legitimate there, so the judge does not report
 * it. The authored identity key still reaches the DOM; on this host it is
 * simply not a leak.
 *
 * NO GROUP CARRIES THIS SHAPE ANY MORE — objectui#5632 burned all eighteen of
 * its members and DELETED the group, which is why what is left is a bare
 * attribute list. It survives as the base three other groups still derive from
 * (`action:menu` and `ui:form`), each of which measures this shape plus or
 * minus one attribute. It derived a THIRD until objectui#5632 burned
 * `ui:sidebar-trigger`. Deleting it would mean hand-copying thirteen strings
 * into two places and losing the statement that those two ARE this shape,
 * varied.
 *
 * The prediction this docblock carried before the burn-down — "converging these
 * renderers on `toDomProps` will not change that attribute, only the thirteen
 * around it" — is now measured, and it was only true because the convergence
 * was built to make it true. A bare `toDomProps` would have stripped `name`
 * (and `disabled`, which this gate never measured at all) off every one of the
 * eighteen controls, and nothing in this file would have moved. See
 * `packages/components/src/lib/form-control-dom-props.ts`, which is the
 * declaration that keeps the promise.
 */
const BARE_SPREAD_MINUS_NAME: readonly string[] = [
  'ariadescribedby', 'arialabel', 'bind', 'colorvariant', 'datasource', 'events', 'props',
  'reference_to', 'zzcanary', 'zzcanarycamel', 'zzcanarynum', 'zzcanaryobj', 'zzcanaryprop',
];

interface LedgerGroup {
  readonly attributes: readonly string[];
  readonly reason: string;
  readonly issue: string;
  /** Every renderer in this shape, named. */
  readonly targets: readonly string[];
}

const COMPONENTS_LEAK_GROUPS: readonly LedgerGroup[] = [
  {
    attributes: BARE_SPREAD,
    reason:
      'the bare spread objectui#5574 names: the renderer forwards its whole ' +
      'prop bag to the host element, so every canary family becomes an ' +
      'attribute. These renderers declare no `name` prop and their host does ' +
      'not define one, so the authored identity key leaks too.',
    issue: 'objectui#5574',
    targets: [
      'action:bar', 'ui:a', 'ui:abbr', 'ui:accordion', 'ui:address', 'ui:alert',
      'ui:article', 'ui:aside', 'ui:aspect-ratio', 'ui:avatar', 'ui:b', 'ui:badge',
      'ui:blockquote', 'ui:br', 'ui:breadcrumb', 'ui:button-group', 'ui:card', 'ui:carousel',
      'ui:cite', 'ui:code', 'ui:collapsible', 'ui:command', 'ui:dd', 'ui:del', 'ui:div',
      'ui:dl', 'ui:dt', 'ui:em', 'ui:empty', 'ui:figcaption', 'ui:figure',
      'ui:footer', 'ui:h1', 'ui:h2', 'ui:h3', 'ui:h4', 'ui:h5', 'ui:h6', 'ui:header',
      'ui:hr', 'ui:html', 'ui:i', 'ui:image', 'ui:img', 'ui:ins', 'ui:kbd',
      'ui:label', 'ui:li', 'ui:list', 'ui:loading', 'ui:main', 'ui:mark', 'ui:menubar',
      'ui:nav', 'ui:navigation-menu', 'ui:ol', 'ui:p', 'ui:pagination', 'ui:pre',
      'ui:progress', 'ui:q', 'ui:resizable', 'ui:scroll-area', 'ui:section',
      'ui:separator', 'ui:sidebar', 'ui:skeleton', 'ui:small', 'ui:span',
      'ui:strong', 'ui:sub', 'ui:sup', 'ui:table', 'ui:tabs',
      'ui:time', 'ui:toggle-group', 'ui:tree-view', 'ui:u', 'ui:ul',
    ],
  },
  {
    attributes: [...BARE_SPREAD, 'actions'].sort(),
    reason:
      'the bare spread plus `actions` — the authored action LIST itself, ' +
      'stringified onto the element by the same forward.',
    issue: 'objectui#5574',
    targets: ['action:group'],
  },
  {
    attributes: [...BARE_SPREAD_MINUS_NAME, 'actions'].sort(),
    reason:
      'the `name`-defining variant of the row above: the trigger button ' +
      'defines `name`, and `actions` leaks alongside the other thirteen.',
    issue: 'objectui#5574',
    targets: ['action:menu'],
  },
  {
    attributes: BARE_SPREAD_MINUS_NAME.filter((attribute) => attribute !== 'datasource'),
    reason:
      '`FormRenderer` consumes the injected `dataSource` adapter and renders ' +
      'onto a `form` element, which defines `name` — so those two are absent ' +
      'and the remaining twelve spread.',
    issue: 'objectui#5574',
    targets: ['ui:form'],
  },
];

const LEAK_LEDGER: Readonly<Record<string, LedgerEntry>> = {
  // ⛔ No `plugin-dashboard` rows. The last two — `metric` and `metric-card`,
  // the open tail `schemaHostProps.ts`' deny-list could not close — were
  // deleted by objectui#4425 when both KPI components moved their renderer door
  // onto `toDomProps`. Both targets are still swept above with the full canary
  // set, so a regression there is a NEW leak on an unledgered target and fails
  // on the empty-report branch below, naming every attribute.

  /* ── packages/components: 82 of 150 targets, in four measured shapes ───── */
  ...Object.fromEntries(
    COMPONENTS_LEAK_GROUPS.flatMap((group) =>
      group.targets.map((type) => [
        type,
        { attributes: group.attributes, reason: group.reason, issue: group.issue },
      ]),
    ),
  ),
};

/* ════════════════════════════════════════════════════════════════════════════
 * The harness
 * ══════════════════════════════════════════════════════════════════════════ */

/** The text `SchemaErrorBoundary` renders when a widget throws (trap 3). */
const ERROR_BOUNDARY_MARKER = 'failed to render';

function canariesFor(target: Target): Record<string, unknown> {
  const canaries: Record<string, unknown> = { ...INJECTED_SDUI_KEYS, ...AUTHORED_EXTRAS };
  for (const key of target.omitCanaries ?? []) delete canaries[key];
  return canaries;
}

function schemaFor(target: Target): Record<string, unknown> {
  return {
    type: target.type,
    id: 'canary-node',
    name: 'canary_node',
    ...target.schemaExtras,
    ...canariesFor(target),
    props: { ...AUTHORED_PROPS },
  };
}

/**
 * Renders one target through the real SDUI host and returns the scan root.
 *
 * `document.body`, not the RTL container: `chatbot-floating` mounts through a
 * portal and is invisible to a container-scoped scan (trap 2).
 */
async function renderTarget(target: Target): Promise<Element> {
  // `FAKE_ADAPTER` here is the one `SchemaRendererProvider`/`SchemaRenderer`
  // `dataSource` prop, and it stays exactly as load-bearing for the other 155
  // targets as it always was (objectui#5630 must not deepen it globally — see
  // the card). The two hosts below are a SEPARATE channel each: neither
  // `useAdapter()` (`AdapterCtx`) nor `useMetadataItem()` (`MetadataCtx`) reads
  // this prop at all, which is why widening it could never have reached
  // `element:repeater` or `element:metadata_viewer` in the first place.
  const tree = (
    <SchemaRendererProvider dataSource={FAKE_ADAPTER as never}>
      <SchemaRenderer schema={schemaFor(target) as never} dataSource={FAKE_ADAPTER as never} />
    </SchemaRendererProvider>
  );
  const hosted =
    target.host === 'sidebar' ? (
      <SidebarProvider>{tree}</SidebarProvider>
    ) : target.host === 'repeater-adapter' ? (
      <AdapterCtx.Provider value={REPEATER_FAKE_ADAPTER as never}>{tree}</AdapterCtx.Provider>
    ) : target.host === 'metadata' ? (
      <MetadataCtx.Provider value={METADATA_HOST_CONTEXT}>{tree}</MetadataCtx.Provider>
    ) : (
      tree
    );
  render(hosted);

  // Non-vacuity, per target: the REAL markup must exist before anything is
  // scanned. Without this every trap in the docblock reads as a clean sweep.
  await waitFor(
    () => {
      if (!document.body.querySelector(target.ready)) {
        throw new Error(
          `${target.type}: readiness selector \`${target.ready}\` never matched. ` +
            `The widget did not reach its real markup, so scanning it would ` +
            `measure nothing. Body was:\n${document.body.innerHTML.slice(0, 600)}`,
        );
      }
    },
    { timeout: 10000 },
  );

  // Trap 3: a caught throw renders tidy, attribute-clean markup that would pass.
  expect(
    document.body.textContent?.includes(ERROR_BOUNDARY_MARKER)
      ? `${target.type} rendered a SchemaErrorBoundary instead of the widget:\n` +
          document.body.innerHTML.slice(0, 600)
      : '',
  ).toBe('');

  return document.body;
}

/** Leaked attribute names for a target, deduped and sorted — the ledger's unit. */
function leakedAttributeNames(leaks: readonly Leak[]): string[] {
  return [...new Set(leaks.map((leak) => leak.attribute))].sort();
}

beforeAll(() => {
  // Recharts measures its container through ResizeObserver, which happy-dom
  // does not implement; without it every chart target stays at the skeleton.
  (globalThis as Record<string, unknown>).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  // The floating chatbot's portal container is appended to `document.body` and
  // is NOT owned by RTL, so `cleanup()` does not take it with it. Left behind,
  // it makes the next target's body scan report the previous target's leaks.
  for (const node of Array.from(document.querySelectorAll('#floating-chatbot-portal'))) {
    node.remove();
  }
  vi.restoreAllMocks();
});

/* ════════════════════════════════════════════════════════════════════════════
 * 1. The judge proves itself — in `@object-ui/test-support`, not here
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * This section used to hold a calibration pair: standard markup that must
 * yield zero findings, and planted fake attributes that must all be reported.
 * Both moved to `packages/test-support/src/__tests__/dom-leak-judge.test.tsx`
 * with the judge (objectui#4434), unioned with the `packages/fields` gate's
 * pair — which is how the ten recharts SVG attributes THIS file contributed to
 * the shared list finally got a clean-markup fixture behind them. The judge is
 * still proven before it is trusted on the sweep; it is proven once, for both
 * gates, instead of once per copy.
 *
 * What stays here is the calibration this gate alone can do: section 2 below,
 * which proves the CANARIES reach a widget through the real `SchemaRenderer`
 * path. That is a property of the harness, not of the judge, and no shared
 * module can assert it.
 */

/* ════════════════════════════════════════════════════════════════════════════
 * 2. The canary MECHANISM proves itself, end to end through the real path
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Calibrating the judge on static markup is not enough: it says nothing about
 * whether the CANARIES actually reach a widget through `SchemaRenderer`. These
 * two fixtures close that gap by running the whole harness against components
 * whose behaviour is known by construction.
 *
 * Predicted before the first run, and the reason this pair is here at all:
 *
 *   - `leaky` spreads everything it is handed onto a `<div>`, so it MUST report
 *     at least one leak from every canary family — the injected `schema`, the
 *     SDUI metadata, the authored open tail, the authored `props` contents, and
 *     the injected adapter.
 *   - `filtered` keeps only what may become an attribute, so it MUST report
 *     nothing while rendering the same node.
 *
 * A sweep whose canaries never arrive would report every target clean, and both
 * halves of this pair are what makes that failure impossible to miss: if the
 * mechanism breaks, `leaky` goes green and this case goes red.
 */
const FIXTURE_NAMESPACE = 'zz-leak-gate-fixture';
const LEAKY_FIXTURE_TYPE = `${FIXTURE_NAMESPACE}:leaky`;
const FILTERED_FIXTURE_TYPE = `${FIXTURE_NAMESPACE}:filtered`;

const LeakyFixture: ComponentType<Record<string, unknown>> = (props) => (
  <div data-testid="leaky-fixture" {...props} />
);

const FilteredFixture: ComponentType<Record<string, unknown>> = (props) => {
  // The `toDomProps` shape, inlined: keep the known-safe set, drop the rest.
  const domProps: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (key === 'id' || key === 'className' || key.startsWith('data-') || key.startsWith('aria-')) {
      domProps[key] = props[key];
    }
  }
  return <div data-testid="filtered-fixture" {...domProps} />;
};

const LEAKY_FIXTURE_TARGET: Target = {
  type: LEAKY_FIXTURE_TYPE,
  ready: '[data-testid="leaky-fixture"]',
};
const FILTERED_FIXTURE_TARGET: Target = {
  type: FILTERED_FIXTURE_TYPE,
  ready: '[data-testid="filtered-fixture"]',
};

describe('the canary mechanism works through the real SDUI path (objectui#4425)', () => {
  beforeAll(() => {
    ComponentRegistry.register('leaky', LeakyFixture as never, {
      namespace: FIXTURE_NAMESPACE,
      skipFallback: true,
    });
    ComponentRegistry.register('filtered', FilteredFixture as never, {
      namespace: FIXTURE_NAMESPACE,
      skipFallback: true,
    });
  });

  it('a deliberately leaking widget is CAUGHT — every canary family arrives', async () => {
    const root = await renderTarget(LEAKY_FIXTURE_TARGET);
    const found = new Set(leakedAttributeNames(findLeaks(root)));

    // One representative per family. Losing any one of these means the sweep
    // stopped exercising that half of the leak surface.
    const perFamily: ReadonlyArray<readonly [string, string]> = [
      ['schema', 'the node injected on every render'],
      ['bind', 'authored SDUI metadata'],
      ['events', 'authored SDUI action metadata'],
      ['props', 'the props container'],
      ['arialabel', 'authored camelCase ARIA'],
      ['zzcanary', 'the authored open tail'],
      ['zzcanaryprop', 'the authored `props` contents'],
      ['datasource', 'the injected data-source adapter'],
    ];
    const missing = perFamily
      .filter(([attribute]) => !found.has(attribute))
      .map(([attribute, what]) => `${attribute} (${what})`);
    expect(missing).toEqual([]);
  });

  it('a widget that filters its spread is CLEAN — the judge is not just noisy', async () => {
    const root = await renderTarget(FILTERED_FIXTURE_TARGET);
    expect(leakReport(FILTERED_FIXTURE_TYPE, findLeaks(root))).toBe('');
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * 3. The target enumeration is non-empty, real, and still complete
 * ══════════════════════════════════════════════════════════════════════════ */

/** Canonical (namespaced) types the registry holds under a given prefix. */
function registeredTypesUnder(prefix: string): string[] {
  const configs = ComponentRegistry.getAllConfigs() as ReadonlyArray<{ type: string }>;
  return [...new Set(configs.map((config) => config.type))]
    .filter((type) => type.startsWith(prefix))
    .sort();
}

describe('the sweep covers a real, non-empty target set (objectui#4425)', () => {
  it.each(Object.keys(TARGETS))('%s contributes at least one target', (pkg) => {
    expect(TARGETS[pkg].length).toBeGreaterThan(0);
  });

  it('every target is actually registered — none silently renders "Unknown component type"', () => {
    const unregistered = ALL_TARGETS.map((target) => target.type).filter(
      (type) => !ComponentRegistry.has(type),
    );
    expect(unregistered).toEqual([]);
  });

  it.each(Object.keys(OWNED_NAMESPACES))(
    '%s: every widget it registers is swept — a new one cannot slip past',
    (pkg) => {
      // The guarantee `FORM_FIELD_TYPES` gives the fields gate, derived here
      // from the registry itself rather than from a hand-kept list.
      const prefixes = OWNED_NAMESPACES[pkg];
      const swept = TARGETS[pkg]
        .map((target) => target.type)
        .filter((type) => prefixes.some((prefix) => type.startsWith(prefix)))
        .sort();
      const registered = [...new Set(prefixes.flatMap(registeredTypesUnder))].sort();
      expect(swept).toEqual(registered);
    },
  );

  it('the shared `view:` aliases these packages own are registered and swept', () => {
    const declared = Object.values(OWNED_VIEW_ALIASES).flat();
    expect(declared.filter((type) => !ComponentRegistry.has(type))).toEqual([]);
    const sweptTypes = new Set(ALL_TARGETS.map((target) => target.type));
    expect(declared.filter((type) => !sweptTypes.has(type))).toEqual([]);
  });

  it('no renderer is ledgered twice — one shape per target, or the map silently keeps one', () => {
    const seen = new Map<string, number>();
    for (const group of COMPONENTS_LEAK_GROUPS) {
      for (const type of group.targets) seen.set(type, (seen.get(type) ?? 0) + 1);
    }
    expect([...seen.entries()].filter(([, count]) => count > 1).map(([type]) => type)).toEqual([]);
  });

  it('every readiness override has a recorded reason, and every reason an override', () => {
    // Two-way, so this cannot become a parking space. An override with no
    // reason fails; a reason whose target no longer needs one fails too.
    const overridden = COMPONENTS_TARGETS.filter((target) => target.ready !== COMPONENTS_READY)
      .map((target) => target.type)
      .sort();
    expect(overridden).toEqual(Object.keys(READY_OVERRIDE_REASONS).sort());
    expect(
      Object.entries(READY_OVERRIDE_REASONS)
        .filter(([, reason]) => !reason.trim())
        .map(([type]) => type),
    ).toEqual([]);
  });

  it('the whole `toDomProps` layout family is CLEAN — no row may re-absorb it', () => {
    // The card listed `flex` / `stack` / `container` / `text` as CANDIDATES —
    // same source shape as `grid`, unverified. The first pass verified them:
    // all four leaked, and they were ledgered. This is the state AFTER the fix,
    // and the assertion had to be INVERTED to stay true, which is the two-way
    // expiry doing its job — a row cannot outlive the defect it records.
    //
    // Keeping the case rather than deleting it is the point. The sweep case
    // above already fails if one of these five regresses; what this one adds is
    // that the regression cannot be made green by putting the row BACK. That is
    // the one repair the ledger's shape would otherwise invite, and it converts
    // a measurement into an allowlist entry. Fix the renderer; never re-ledger
    // this family.
    const converged = ['ui:flex', 'ui:stack', 'ui:container', 'ui:text', 'ui:grid'];
    expect(
      converged.filter((type) => LEAK_LEDGER[type]),
      'these renderers are converged on `toDomProps` (objectui#4787 / PR #5573 ' +
        'for `grid`, objectui#5574 for the other four) and measure clean. A row ' +
        'here means a regression was re-ledgered instead of fixed.',
    ).toEqual([]);
    // …and they are still SWEPT, so "no row" cannot mean "no longer looked at".
    const sweptTypes = new Set(ALL_TARGETS.map((target) => target.type));
    expect(converged.filter((type) => !sweptTypes.has(type))).toEqual([]);
  });

  it('the whole form-control family is CLEAN — no row may re-absorb it', () => {
    // objectui#5632's slice: the eighteen renderers that carried the
    // `BARE_SPREAD_MINUS_NAME` shape. Their group is DELETED, and this is the
    // inverted case that keeps it deleted — the same treatment objectui#5574
    // gave the layout family directly above, and for the same reason: the sweep
    // case fails if one of these regresses, and this one additionally fails if
    // someone makes that red green by putting the row back.
    //
    // What this family adds over the layout one is the second failure
    // direction, which is why the fix is NOT a bare `toDomProps`. These hosts
    // are form controls, so `name` and `disabled` are legal on them — the judge
    // never reported either, and the canary node authors no `disabled` at all.
    // A convergence that dropped them would therefore read as a clean pass HERE
    // while silently un-naming and re-enabling every control in the library.
    // The declaration that prevents it is
    // `packages/components/src/lib/form-control-dom-props.ts`; the guard that
    // proves this file could not have noticed is stated in its docblock.
    const converged = [
      'action:button', 'action:icon', 'ui:button', 'ui:checkbox', 'ui:combobox',
      'ui:date-picker', 'ui:email', 'ui:file-upload', 'ui:input', 'ui:input-otp',
      'ui:password', 'ui:radio-group', 'ui:slider', 'ui:sonner',
      'ui:switch', 'ui:textarea', 'ui:toggle',
      // `ui:sidebar-menu-button`, the eighteenth, retired with objectui#10859
      // batch 8 phase 2d: no row and no target, because no registration.
    ];
    expect(
      converged.filter((type) => LEAK_LEDGER[type]),
      'these renderers are converged on the form-control DOM declaration ' +
        '(objectui#5632) and measure clean. A row here means a regression was ' +
        're-ledgered instead of fixed.',
    ).toEqual([]);
    // …and they are still SWEPT, so "no row" cannot mean "no longer looked at".
    const sweptTypes = new Set(ALL_TARGETS.map((target) => target.type));
    expect(converged.filter((type) => !sweptTypes.has(type))).toEqual([]);
  });

  // `ui:sidebar-trigger` is CLEAN was pinned here (objectui#5632's one-member
  // group that leaked `schema` itself). Its node key retired with objectui#10859
  // batch 8 phase 2d, so there is no registration left to sweep or to
  // re-ledger; `packages/cli`'s registered-types ratchet pins the absence.

  it('the ledger is well formed — every row names a swept target, a reason and an issue', () => {
    const sweptTypes = new Set(ALL_TARGETS.map((target) => target.type));
    const problems: string[] = [];
    for (const [type, entry] of Object.entries(LEAK_LEDGER)) {
      if (!sweptTypes.has(type)) problems.push(`${type}: ledgered but not a swept target`);
      if (entry.attributes.length === 0) problems.push(`${type}: empty row — delete it instead`);
      if (!entry.issue.trim()) problems.push(`${type}: no owning issue`);
      if (!entry.reason.trim()) problems.push(`${type}: no reason`);
    }
    expect(problems).toEqual([]);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * 4. The sweep
 * ══════════════════════════════════════════════════════════════════════════ */

describe.each(Object.keys(TARGETS))(
  'no registry-reachable %s widget leaks an unledgered non-DOM prop (objectui#4425)',
  (pkg) => {
    it.each(TARGETS[pkg].map((target) => [target.type, target] as const))(
      '%s',
      async (type, target) => {
        const root = await renderTarget(target);
        const leaks = findLeaks(root);
        const found = leakedAttributeNames(leaks);
        const ledgered = [...(LEAK_LEDGER[type]?.attributes ?? [])].sort();

        // Exact equality in BOTH directions — see the ledger's expiry
        // discipline. A new leak fails; a fixed leak fails until its row goes.
        if (ledgered.length === 0) {
          expect(leakReport(type, leaks)).toBe('');
        } else {
          expect(found).toEqual(ledgered);
        }
      },
      30000,
    );
  },
);

/* ════════════════════════════════════════════════════════════════════════════
 * 5. The canary that was withheld, and is not any more
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * `plugin-calendar:calendar-view` used to be swept WITHOUT the `events` canary,
 * because authoring `events` — the ordinary SDUI action metadata of AGENTS.md
 * section 4, legal on any node — crashed the component outright: its renderer
 * computed a `CalendarEvent[]`, passed it as `events={…}`, then spread
 * `{...props}` AFTER it, so the authored object overwrote the array and
 * `CalendarView` threw `events is not iterable`. A crashing render produces
 * tidy, attribute-clean error-boundary DOM, so the canary had to be withheld or
 * the target would have read as a clean pass (trap 3).
 *
 * objectui#4433 fixed that — the renderer destructures the authored key out
 * before the spread — so BOTH halves came out in the same change: the
 * `omitCanaries` entry is gone (this target is swept with the full canary set
 * above, `events` included) and this case flipped from pinning the crash to
 * pinning the render.
 *
 * It is kept rather than deleted because it is the DIAGNOSIS the sweep case
 * cannot be: the sweep plants the whole canary set at once, so a regression
 * there says only "calendar-view broke". This one plants `events` alone, and
 * names the key.
 *
 * The `omitCanaries` facility itself stays. Nothing withholds a canary today,
 * but it carries the discipline — a withheld canary is a recorded defect with
 * its own pin, never a quiet exemption — that objectui#4425 phase 2 will need
 * the next time a target cannot take the full set.
 */
describe('the canary once withheld from calendar-view is swept again (objectui#4433)', () => {
  it('authoring `events` on a calendar-view node renders the calendar', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <SchemaRendererProvider dataSource={FAKE_ADAPTER as never}>
          <SchemaRenderer
            schema={
              {
                type: 'plugin-calendar:calendar-view',
                id: 'canary-node',
                events: { onClick: [{ action: 'navigate' }] },
              } as never
            }
          />
        </SchemaRendererProvider>,
      );
      // The real component, not the error boundary `SchemaErrorBoundary`
      // rendered here before the fix.
      await waitFor(() => {
        expect(
          document.body.querySelector('[role="region"][aria-label="Calendar"]'),
        ).not.toBeNull();
      });
      expect(document.body.textContent ?? '').not.toContain(ERROR_BOUNDARY_MARKER);
      // The mechanism, not just the symptom: the authored `events` OBJECT no
      // longer reaches `CalendarView`'s `events` ARRAY prop, so nothing tries to
      // iterate it.
      expect(document.body.textContent ?? '').not.toContain('events is not iterable');
    } finally {
      errors.mockRestore();
    }
  }, 30000);
});

/* ════════════════════════════════════════════════════════════════════════════
 * 6. The docblock's counts are MEASURED, not remembered (objectui#8659)
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The counts this file states in prose, asserted.
 *
 * ## What rotted, and why a text correction was not the fix
 *
 * Everything above reads its rows off the arrays, so the ROWS are always
 * current truth — that is the two-way expiry, and it works. The COUNTS were the
 * exception: a second, hand-written copy of the same facts, sitting in prose
 * that nothing read. objectui#8659 measured six of them wrong at once, produced
 * by three landed PRs (#7564, #7958, #8034 plus the `element:*` additions), each
 * correctly scoped to its own slice and each moving an array without moving the
 * paragraph that quotes it.
 *
 * ⛔ The realised harm is not "the docs are stale". This docblock is the FIRST
 * thing a burn-down slice reads, and a dispatch had already quoted `95 of 158`
 * out of it as a baseline — a slice that believed it would have reported
 * `95 -> 94` where the truth was `90 -> 89`. The PM loop ate a fabricated
 * number.
 *
 * objectui#5632's slice corrected all six texts once. That is precisely why
 * this section exists rather than a seventh correction: the next slice inherits
 * the same unasserted prose and it rots again. ⭐ The deliverable is the
 * MECHANISM — a moved array that leaves the paragraph behind must go RED.
 *
 * ## How the loop is closed, in two legs
 *
 * Neither leg alone closes it, and the reason is worth stating because the
 * obvious implementation stops after the first:
 *
 *  1. **{@link DOCBLOCK_COUNTS} vs {@link MEASURED_COUNTS}** — the named
 *     constants against the value re-derived from {@link COMPONENTS_PLAIN_TYPES},
 *     {@link COMPONENTS_SPECIAL_TARGETS} and {@link COMPONENTS_LEAK_GROUPS} on
 *     every run. One side is DERIVED; a constant compared against another
 *     constant asserts nothing.
 *  2. **The prose vs {@link DOCBLOCK_COUNTS}** — every sentence that quotes a
 *     number is read back out of this file's own source and checked. Without
 *     this leg the first one only MOVES the hand-written copy from the prose
 *     into a constant: a slice reddened by leg 1 repairs the constant, the
 *     paragraph stays wrong, and the defect is exactly where it was with one
 *     more place to forget.
 *
 * Together: move an array and leg 1 goes red; repair only the constant and
 * leg 2 goes red; the paragraph has to move.
 *
 * ## The rule for a number added to this file later
 *
 * ⚠️ Every count here is one of two things, and the difference is the whole
 * discipline:
 *
 *   - a LIVE reading of the tree as it stands — it belongs in
 *     {@link DOCBLOCK_COUNTS} with a statement in {@link QUOTED_COUNTS}, or it
 *     is the next drift;
 *   - an ARRIVAL reading, kept deliberately because the burn-down is the story
 *     (`119 of 158 ON ARRIVAL`, the phantom-clean census, the per-PR rows of the
 *     burn-down list) — it must SAY it is historical, in the sentence itself.
 *     A live-sounding tense on a frozen number is how `158` got quoted as
 *     today's target count.
 *
 * A number that is incidental rather than a reading — "one selector per target"
 * — is best written without a literal at all.
 *
 * ⭐ The shape generalises past this file, and objectui#8659's triage asked for
 * the observation rather than a tenth hand-written card: this is the first
 * enforced instance of a class that has been repaired BY HAND at least six
 * times in this repo (objectui#7448, #8122, #8484, #8629, #9004, and this one),
 * across workflow headers, gate `.mjs` docblocks and docs pages. What makes it
 * mechanisable here is that the file holding the prose also holds the arrays,
 * so no cross-file rooting is needed. Where that is true elsewhere, this is the
 * technique; where it is not, the pin needs a path and the path needs a root
 * (`scripts/check-test-path-roots.mjs`).
 */

/** Number words as this docblock spells them, for the counts written as words. */
const COUNT_WORDS: readonly string[] = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve',
];
const wordForCount = (count: number): string => COUNT_WORDS[count] ?? String(count);

/**
 * Every count the prose above quotes, named once and written by hand — these
 * are the numbers AS WRITTEN, deliberately not derived. They are what leg 2
 * checks the prose against and what leg 1 checks the arrays against.
 */
const DOCBLOCK_COUNTS = {
  /** `packages/components` targets swept: the plain types plus the specials. */
  componentsTargets: 150,
  /** Of those, the ones needing nothing but the shared readiness class. */
  componentsPlainTypes: 133,
  /** Ledgered `packages/components` rows — targets with a recorded leak. */
  componentsLedgered: 82,
  /** The complement: swept, scanned and clean. */
  componentsClean: 68,
  /** Measured shapes the ledgered rows fall into. */
  componentsShapes: 4,
  /** Registry prefixes `packages/components` owns. */
  componentsPrefixes: 5,
  /** Targets the shared readiness selector reaches. */
  componentsReadyMatched: 147,
  /** The rest, each with a recorded reason it cannot. */
  componentsReadyOverrides: 3,
  /** Attributes leaked by the shape with the most members. */
  commonestShapeAttributes: 14,
  /** Every target this sweep renders, all five packages. */
  allTargets: 168,
  /** Every ledgered row, all five packages. */
  allLedgered: 82,
} as const;

type CountName = keyof typeof DOCBLOCK_COUNTS;

const COMPONENTS_TARGET_COUNT = COMPONENTS_PLAIN_TYPES.length + COMPONENTS_SPECIAL_TARGETS.length;
const COMPONENTS_LEDGERED_COUNT = COMPONENTS_LEAK_GROUPS.reduce(
  (total, group) => total + group.targets.length,
  0,
);
const COMPONENTS_READY_MATCHED = COMPONENTS_TARGETS.filter(
  (target) => target.ready === COMPONENTS_READY,
).length;
const COMMONEST_SHAPE = [...COMPONENTS_LEAK_GROUPS].sort(
  (a, b) => b.targets.length - a.targets.length,
)[0];

/**
 * The same quantities, RE-DERIVED from the arrays on every run. This is the
 * derived side of leg 1: nothing below is typed from memory.
 */
const MEASURED_COUNTS: Readonly<Record<CountName, number>> = {
  componentsTargets: COMPONENTS_TARGET_COUNT,
  componentsPlainTypes: COMPONENTS_PLAIN_TYPES.length,
  componentsLedgered: COMPONENTS_LEDGERED_COUNT,
  componentsClean: COMPONENTS_TARGET_COUNT - COMPONENTS_LEDGERED_COUNT,
  componentsShapes: COMPONENTS_LEAK_GROUPS.length,
  componentsPrefixes: OWNED_NAMESPACES.components.length,
  componentsReadyMatched: COMPONENTS_READY_MATCHED,
  componentsReadyOverrides: COMPONENTS_TARGET_COUNT - COMPONENTS_READY_MATCHED,
  commonestShapeAttributes: COMMONEST_SHAPE.attributes.length,
  allTargets: ALL_TARGETS.length,
  allLedgered: Object.keys(LEAK_LEDGER).length,
};

/**
 * This file's own source, read from its own URL rather than from anything
 * rooted at `process.cwd()` — the rule `scripts/check-test-path-roots.mjs`
 * enforces, and the reason the same assertion cannot reach two verdicts
 * depending on which directory the run started in.
 */
const SELF_SOURCE = readFileSync(fileURLToPath(import.meta.url), 'utf8');

/** Comment furniture removed, so the docblock reads as ordinary text. */
const PROSE_LINES = SELF_SOURCE.replace(/^[ \t]*(?:\/\*\*?|\*\/|\*|\/\/)[ \t]?/gm, '');
/** …and folded onto one line, so a sentence that WRAPS still matches as one. */
const PROSE = PROSE_LINES.replace(/\s+/g, ' ');

interface QuotedCount {
  /** Which sentence, for the failure message. */
  readonly where: string;
  /** It must match EXACTLY once: a pattern that matches nothing asserts nothing. */
  readonly pattern: RegExp;
  /** One expected value per capture group, in order. */
  readonly expected: readonly (number | string)[];
}

/**
 * Every statement in this file that quotes a count, with the value it must
 * quote. ⛔ A number added to the prose without a row here is unasserted again.
 */
const QUOTED_COUNTS: readonly QuotedCount[] = [
  {
    where: 'the whole-sweep reading under the package table',
    pattern: /\*\*(\d+) of (\d+) targets leak\.\*\*/,
    expected: [DOCBLOCK_COUNTS.allLedgered, DOCBLOCK_COUNTS.allTargets],
  },
  {
    where: 'the `objectui#5574` reading heading',
    pattern: /ON ARRIVAL, in \w+ shapes; (\d+) today/,
    expected: [DOCBLOCK_COUNTS.componentsLedgered],
  },
  {
    where: 'the burn-down sentence under that heading',
    pattern:
      /\*\*(\d+) rows in ([A-Z]+) shapes\*\* remain, on a target set of (\d+) today/,
    expected: [
      DOCBLOCK_COUNTS.componentsLedgered,
      wordForCount(DOCBLOCK_COUNTS.componentsShapes).toUpperCase(),
      DOCBLOCK_COUNTS.componentsTargets,
    ],
  },
  {
    where: 'the readiness-selector reading above `COMPONENTS_READY_CLASS`',
    pattern:
      /Today (\d+) of (\d+) targets match it; the other (\w+) are in \{@link READY_OVERRIDE_REASONS\}/,
    expected: [
      DOCBLOCK_COUNTS.componentsReadyMatched,
      DOCBLOCK_COUNTS.componentsTargets,
      wordForCount(DOCBLOCK_COUNTS.componentsReadyOverrides),
    ],
  },
  {
    where: 'the prefix note inside `OWNED_NAMESPACES`',
    pattern: /`packages\/components` owns ([A-Z]+) registry prefixes/,
    expected: [wordForCount(DOCBLOCK_COUNTS.componentsPrefixes).toUpperCase()],
  },
  {
    where: 'the shape summary above `COMPONENTS_LEAK_GROUPS`',
    pattern:
      /(\d+) of the (\d+) `packages\/components` targets leak, and they do it in exactly\s*\*?\s*([A-Z]+) shapes/,
    expected: [
      DOCBLOCK_COUNTS.componentsLedgered,
      DOCBLOCK_COUNTS.componentsTargets,
      wordForCount(DOCBLOCK_COUNTS.componentsShapes).toUpperCase(),
    ],
  },
  {
    where: 'the "ledger, not an allowlist" paragraph',
    pattern:
      /all (\d+) targets render and all (\d+) are scanned on every run, the (\d+) clean ones included/,
    expected: [
      DOCBLOCK_COUNTS.componentsTargets,
      DOCBLOCK_COUNTS.componentsTargets,
      DOCBLOCK_COUNTS.componentsClean,
    ],
  },
  {
    where: 'the warning-as-error section, on the commonest shape',
    pattern: /of the (\d+) attributes in the commonest shape/,
    expected: [DOCBLOCK_COUNTS.commonestShapeAttributes],
  },
  {
    where: 'the `components` entry of the `TARGETS` map',
    pattern:
      /(\d+) targets, built above rather than spelled here because (\d+) of them need nothing but the shared readiness class\./,
    expected: [DOCBLOCK_COUNTS.componentsTargets, DOCBLOCK_COUNTS.componentsPlainTypes],
  },
  {
    where: 'the `packages/components` banner inside `LEAK_LEDGER`',
    pattern: /packages\/components: (\d+) of (\d+) targets, in ([a-z]+) measured shapes/,
    expected: [
      DOCBLOCK_COUNTS.componentsLedgered,
      DOCBLOCK_COUNTS.componentsTargets,
      wordForCount(DOCBLOCK_COUNTS.componentsShapes),
    ],
  },
];

/** A row of the per-package reading table in the docblock. */
const READING_TABLE_ROW = / \| *([a-z-]+) *\| *(\d+) *\| *(\d+) *\| *([\d ./]+?) *\|/g;

/** The integers a table cell names, so `7 / 9` and `12 .. 15` read the same. */
function cellNumbers(cell: string): number[] {
  return (cell.match(/\d+/g) ?? []).map(Number);
}

describe("the docblock's counts are measurements, not memory (objectui#8659)", () => {
  // ── Leg 1: the named constants against the arrays ────────────────────────
  //
  // The four quantities objectui#8659's ruling named, one case each, so a red
  // says which reading moved rather than "some number is wrong".

  it('targets — the components family size is what the two arrays hold', () => {
    expect(
      MEASURED_COUNTS.componentsTargets,
      'COMPONENTS_PLAIN_TYPES + COMPONENTS_SPECIAL_TARGETS moved; every sentence ' +
        'quoting the target count has to move with them (objectui#8659).',
    ).toBe(DOCBLOCK_COUNTS.componentsTargets);
    // …and the split, so the plain-type count cannot drift inside a stable total.
    expect(MEASURED_COUNTS.componentsPlainTypes).toBe(DOCBLOCK_COUNTS.componentsPlainTypes);
    expect(COMPONENTS_TARGETS.length).toBe(MEASURED_COUNTS.componentsTargets);
  });

  it('ledgered rows — the recorded leaks are what the groups name', () => {
    expect(
      MEASURED_COUNTS.componentsLedgered,
      'COMPONENTS_LEAK_GROUPS moved — a burn-down that deleted rows, or a ' +
        'regression that added them. The prose counts move too (objectui#8659).',
    ).toBe(DOCBLOCK_COUNTS.componentsLedgered);
    // The groups and the ledger are the same population, counted two ways.
    const ledgeredComponents = Object.keys(LEAK_LEDGER).filter((type) =>
      COMPONENTS_TARGETS.some((target) => target.type === type),
    ).length;
    expect(ledgeredComponents).toBe(MEASURED_COUNTS.componentsLedgered);
  });

  it('clean targets — swept, scanned, and carrying no row', () => {
    expect(
      MEASURED_COUNTS.componentsClean,
      'the clean count is targets minus ledgered rows; it moves whenever either ' +
        'does, and it is the number the "ledger, not an allowlist" paragraph quotes.',
    ).toBe(DOCBLOCK_COUNTS.componentsClean);
  });

  it('shapes — the number of measured mechanisms, not of rows', () => {
    expect(
      MEASURED_COUNTS.componentsShapes,
      'a shape left COMPONENTS_LEAK_GROUPS (a whole mechanism burned down) or ' +
        'joined it. The prose spells this one as a WORD in three places.',
    ).toBe(DOCBLOCK_COUNTS.componentsShapes);
  });

  it.each(Object.keys(DOCBLOCK_COUNTS) as CountName[])(
    'every named count is the measured one: %s',
    (name) => {
      expect(MEASURED_COUNTS[name]).toBe(DOCBLOCK_COUNTS[name]);
    },
  );

  // ── Leg 2: the prose against the named constants ─────────────────────────

  it('the extractor is reading this file — the control every regex below needs', () => {
    // A pattern that matches nothing makes its assertion vacuously true, so the
    // source has to be proved present before anything is extracted from it.
    expect(SELF_SOURCE).toContain('MEASUREMENT GATE: the objectui#3291 DOM-leak canary sweep');
    expect(SELF_SOURCE.length).toBeGreaterThan(40_000);
    // The furniture strip left prose behind, not an empty string.
    expect(PROSE).toContain('This is a ledger, not an allowlist');
  });

  it.each(QUOTED_COUNTS.map((quoted) => [quoted.where, quoted] as const))(
    'the prose quotes the measured count: %s',
    (_where, quoted) => {
      const all = [...PROSE.matchAll(new RegExp(quoted.pattern, 'g'))];
      expect(
        all.length,
        `${quoted.where}: expected exactly one match for ${quoted.pattern}. Zero means ` +
          'the sentence was reworded and this row has to follow it; more than one means ' +
          'the pattern is too loose to name what it pins.',
      ).toBe(1);
      const captured = all[0].slice(1).map((group) => (/^\d+$/.test(group) ? Number(group) : group));
      expect(
        captured,
        `${quoted.where}: the sentence quotes numbers the arrays do not hold. Update the ` +
          'prose (and DOCBLOCK_COUNTS) to the measured values — objectui#8659 is the card ' +
          'about doing exactly that and having it rot again.',
      ).toEqual(quoted.expected);
    },
  );

  it('the reading table is derived row by row from the target set and the ledger', () => {
    const rows = [...PROSE_LINES.matchAll(READING_TABLE_ROW)];
    expect(
      rows.map((row) => row[1]).sort(),
      'every package in TARGETS needs a row in the docblock table, and no row may ' +
        'name a package that is no longer swept.',
    ).toEqual(Object.keys(TARGETS).sort());

    for (const [, pkg, targets, leaking, attributes] of rows) {
      const swept = TARGETS[pkg];
      expect(Number(targets), `${pkg}: the table's target count`).toBe(swept.length);
      const rowsHere = swept
        .map((target) => LEAK_LEDGER[target.type])
        .filter((entry): entry is LedgerEntry => Boolean(entry));
      expect(Number(leaking), `${pkg}: the table's leaking count`).toBe(rowsHere.length);
      // The attribute cell is a RANGE, spelled `7 / 9` for two and `12 .. 15`
      // for more; both are pinned by their extremes rather than by punctuation.
      const widths = rowsHere.map((entry) => entry.attributes.length);
      const quoted = cellNumbers(attributes);
      expect(quoted.length, `${pkg}: the table's attribute cell names no number`).toBeGreaterThan(0);
      if (widths.length === 0) {
        expect(quoted, `${pkg}: no rows, so the cell reads 0`).toEqual([0]);
      } else {
        expect(
          [Math.min(...quoted), Math.max(...quoted)],
          `${pkg}: the attribute cell's extremes against the ledgered rows`,
        ).toEqual([Math.min(...widths), Math.max(...widths)]);
      }
    }
  });
});
