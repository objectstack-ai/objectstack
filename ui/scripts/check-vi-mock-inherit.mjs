#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Rejects a `vi.mock` factory that HAND-LISTS the exports of a covered
 * workspace package instead of inheriting the real module's export surface.
 *
 * Run:  node scripts/check-vi-mock-inherit.mjs
 *       node scripts/check-vi-mock-inherit.mjs --list   # every call site found
 *       node scripts/check-vi-mock-inherit.mjs --json
 * Exit: 0 = OK, 1 = a frozen factory, an unreadable one, or a collapsed
 *       population (see "Green at rest" below)
 *
 * ## The defect (objectui#6849, surfaced by #6768 / PR #6847)
 *
 * A factory that returns a hand-written object freezes the mock's export
 * surface at whatever the author typed that day:
 *
 *     vi.mock('@object-ui/react', () => ({ SchemaRenderer: Stub }));
 *
 * The real module keeps growing. The next export that any module in the file's
 * import graph reads AT MODULE SCOPE resolves to `undefined` against the frozen
 * stand-in, and the file dies during COLLECTION -- before a single test runs.
 *
 * That failure does not look like a test failure. Measured on #6768:
 *
 *     Test Files  3 failed | 546 passed
 *     Tests       6694 passed          <- ZERO failed assertions
 *
 * The tests in those three files never ran, so nothing failed. PR #6847's
 * ablation reproduced it in isolation: reverting one converted file gives
 * `Test Files 1 failed (1)` / `Tests no tests`, against 32 passing on the
 * converted form. A reader seeing that months later reads flake, and the bill
 * is paid by whoever added the export -- in a red suite that does not point at
 * them. That is why the sweep needed a gate behind it rather than a habit.
 *
 * ## The recogniser is SEMANTIC. A name match is wrong in BOTH directions
 *
 * #6768 was written from a grep for the literal `importOriginal` and counted 36
 * frozen sites. The true count was 25, and this gate's first run found the miss
 * in the other direction too. Both errors are measured, not argued:
 *
 *   - **False positives -- 11.** Eleven files already inherited the real
 *     surface under a different spelling: nine in `plugin-dashboard` spread
 *     `await vi.importActual('@object-ui/react')` from a ZERO-PARAMETER
 *     factory; `EnvironmentListToolbar.test.tsx` names its callback parameter
 *     `importActual`; `PageView.test.tsx` names it `orig`. A gate matching the
 *     name would have demanded edits to eleven correct files and been deleted
 *     by the first person it annoyed.
 *   - **A false negative -- 1.** `plugin-view`'s
 *     `ObjectView.contractEnvelope-6726.test.tsx` hand-listed four exports from
 *     a zero-parameter factory and contains the token `importOriginal` nowhere,
 *     so the grep could not see it. It was byte-identical at PR #6847's own
 *     commit (`1e14d70ae`) and the sweep passed over it. This gate's first run
 *     over the tree flagged it; the same PR converts it.
 *
 * So the criterion is a property of the CODE, never of a name:
 *
 *   1. does the factory OBTAIN the real module -- through a callback parameter
 *      under ANY name, or through `vi.importActual` of the SAME specifier; and
 *   2. does the obtained value get SPREAD into the returned object?
 *
 * Obtaining without spreading is still frozen: `const actual = await
 * importOriginal(); return { SchemaRenderer: Stub };` inherits nothing. Both
 * halves are required, and both are read off the factory's own text.
 *
 * ## Scope: a declared, GROW-ONLY set of covered specifiers
 *
 * Triage ruled this gate NARROW (objectui#6849, R+34): limited to widely-
 * imported workspace specifiers rather than every `vi.mock` factory, because
 * the measured failure mechanism is itself narrow -- it needs a real export
 * surface that GROWS. Three things are therefore out of scope by construction,
 * not by exemption:
 *
 *   - **Whole-module replacement of a local module.** `vi.mock('./ObjectCalendar',
 *     ...)` in `plugin-calendar/src/registration.test.tsx` replaces a component
 *     wholesale and says so in its own comment. There is no growing surface to
 *     inherit, and a gate that reddened on it would be deleted rather than
 *     fixed. Relative specifiers are counted here and never judged.
 *   - **Third-party packages.** `sonner`, `react-router-dom`, `lucide-react`
 *     and friends grow only on a deliberate version bump. Counted, never judged.
 *   - **Workspace specifiers that are neither a `COVERED_SPECIFIERS` member
 *     nor a SUBPATH of one.** See below, and "A member covers its subpaths".
 *
 * `COVERED_SPECIFIERS` holds the workspace packages whose frozen sites have
 * actually been SWEPT to zero. Today that is twenty-one: nineteen joined by
 * sweep, and the last two -- `@object-ui/plugin-view` and `@object-ui/core` --
 * by a MEASUREMENT that found nothing to sweep, which is the degenerate case of
 * the same precondition and not a second door (see "Slices 15 + 16" below).
 * Running this file's classifier over all 1,499
 * `vi.mock` call sites in the tree at `9ce20233f`:
 *
 *     covered set = @object-ui/react (swept by PR #6847)  ->    1 frozen
 *     covered set = every @object-ui/* workspace package  ->  299 frozen
 *
 * with `@object-ui/auth` at 92, `@object-ui/i18n` at 34, `@object-ui/collaboration`
 * at 25 and `@object-ui/components` at 22. Import breadth does not separate them
 * either -- `@object-ui/react` is THIRD by measured import count (576 imports
 * across 552 files), behind `@object-ui/core` and `@object-ui/types` -- so there
 * was no threshold to derive and no honest way to widen the set that day.
 *
 * ⚠️ Those per-specifier figures were taken with the FIRST-ANGLE-BRACKET
 * generic this file carried until objectui#7337, which mis-read a nested
 * `vi.importActual` generic and over-reported `frozen`; re-derive before acting
 * on any of them. `@object-ui/i18n` was the second member, swept and added by
 * objectui#7337 -- 92 judged call sites, 92 inheriting, 0 frozen at the flip,
 * with the all-specifier population moving 315 -> 314 frozen and no site moving
 * the other way.
 *
 * The next three members joined together as objectui#6892's first slice, the
 * three specifiers the worklist's triage named as the flow-proving start
 * because each carried exactly ONE frozen factory. Re-derived on `eeda78a780`
 * with the fixed classifier -- ⛔ never from the worklist's own table, which
 * predates both the recogniser fix and the `@object-ui/i18n` flip:
 *
 *     @object-ui/plugin-markdown    1 judged, 0 inheriting, 1 frozen -> 0
 *     @object-ui/data-objectstack   1 judged, 0 inheriting, 1 frozen -> 0
 *     @object-ui/plugin-report      1 judged, 0 inheriting, 1 frozen -> 0
 *
 * with the all-specifier population over the 22 specifiers any `vi.mock` call
 * site in the tree names moving 318 -> 315 frozen, and no site moving the other
 * way.
 *
 * The next two joined as objectui#6892's SECOND slice, re-derived on
 * `689127723` by the same method -- `scan()` imported with `covered` set to
 * every workspace specifier the tree names, so the constant below was never
 * widened-and-reverted:
 *
 *     @object-ui/plugin-charts      1 judged, 0 inheriting, 1 frozen -> 0
 *     @object-ui/plugin-dashboard   3 judged, 0 inheriting, 3 frozen -> 0
 *
 * with the same population moving 315 -> 311 frozen and, again, no site moving
 * the other way. `@object-ui/plugin-charts` never appeared on the worklist's
 * table at all, and the reason is a THIRD way that table goes stale, distinct
 * from both the recogniser fix and the sweeps: its only call site did not yet
 * exist. `ObjectView.chartConfigForward-7891.test.tsx` was ADDED by `38158c6bb`
 * (2026-09-06), a week AFTER the `9ce20233f` snapshot (2026-08-30) -- verified
 * by `git cat-file -e 9ce20233f:PATH` against a control path that resolves at
 * the same commit. So the population GROWS while the worklist is being worked,
 * and a slice scoped from the table alone would have missed this specifier
 * entirely. Re-derive per slice; never inherit.
 *
 * `@object-ui/auth` joined as objectui#6892's THIRD slice -- the largest block
 * on the worklist by a factor of three -- re-derived on `06761b351` by the same
 * `scan()` method, the constant below again never widened-and-reverted:
 *
 *     @object-ui/auth             135 judged, 33 inheriting, 102 frozen -> 0
 *
 * with the same population moving 311 -> 209 frozen and no site moving the
 * other way -- both figures measured on `06761b351`, the base this sweep was
 * derived and converted on. On the merged head the population reads 211 over
 * 643 judged, and the delta is NOT this sweep: merging `origin/main` mid-slice
 * brought in two new frozen sites (`@object-ui/plugin-form`, `@object-ui/plugin-grid`)
 * and one new inheriting `@object-ui/react` site, all landed by other PRs
 * while this one was being verified. That is the growth warning above,
 * observed a second time inside a single slice; `@object-ui/auth` stayed at 0.
 *
 * ⭐ That slice paid for one measurement worth keeping here, because
 * it is the question every REMAINING slice has to ask and the answer is not
 * uniform: **what does inheriting actually RUN?** Converting freezes to
 * inheritance loads the real barrel in every converted file, so a barrel with
 * module-scope side effects has those effects restored in all of them at once.
 * Slice 2's two barrels each made 8 module-scope `ComponentRegistry.register`
 * calls, absorbed in four files. `packages/auth/src` was measured before any
 * conversion, by walking its 22-module static import graph and classifying
 * every top-level statement: 8 module-scope initialisers, ALL pure in-memory
 * allocation (two `Set`s of literal strings, an `Object.values`, a `Set` over
 * it, `createContext(null)` plus its `displayName`, an empty listener `Set`,
 * one alias), and ZERO registrations, timers, globals, `fetch` or
 * side-effect-only imports. Inert -- so 102 files inherit it for free. ⛔ Do
 * not generalise that verdict to the next barrel; take the measurement. The
 * remaining 209 stay on objectui#6892, `@object-ui/collaboration` (33) and
 * `@object-ui/plugin-form` (30) next by yield and `@object-ui/app-shell` (23)
 * only after objectui#6580.
 *
 * `@object-ui/collaboration` joined as objectui#6892's FOURTH slice, re-derived
 * on `0caacca37` by the same `scan()` method, the constant below again never
 * widened-and-reverted:
 *
 *     @object-ui/collaboration     33 judged, 0 inheriting, 33 frozen -> 0
 *
 * with the population moving 211 -> 178 frozen over 643 judged and no site
 * moving the other way -- every other one of the 21 rows byte-identical between
 * the two runs. All 33 sites sit under `packages/app-shell` and all 33 are ONE
 * syntactic shape (the multi-line object-literal arrow), so this slice needed
 * none of the three-shape handling `@object-ui/auth` did.
 *
 * STEP 0 was taken again rather than inherited, and it differs from auth's in
 * the EVIDENCE available, not in the verdict. `packages/collaboration` is a
 * presence/realtime package -- `useRealtimeSubscription`, `usePresence`,
 * `PresenceProvider` -- which is exactly why the walk was the point rather than
 * a formality. Its 11-module static import graph from `index.ts` holds 11
 * module-scope initialisers, ALL pure in-memory allocation: two `let` counters
 * at 0, four style/label object literals, the `COLLAB_DEFAULT_TRANSLATIONS`
 * map, one `createSafeTranslation(...)` call that only closes over that map and
 * returns a hook, an empty `NOOP_SOURCE` object, and `React.createContext` of
 * it. Every `WebSocket`, `setTimeout` and `window.addEventListener` in the
 * package is indented inside a hook body, and the only RUNTIME workspace import
 * is `@object-ui/i18n` -- already covered by this gate and already loaded in
 * these tests. Inert, so 33 files inherit it for free.
 *
 * ⚠️ What auth had and this slice did NOT is the free confirmation. auth had 33
 * of its 135 sites already inheriting on `main`, which proved the real barrel
 * loads in that test environment before anything was converted;
 * `@object-ui/collaboration` had ZERO -- no test in the tree loaded the real
 * barrel at runtime. So the confirmation here is the suite run itself, which is
 * weaker evidence than a pre-existing green site, and is recorded as such. A
 * later slice on a specifier with 0 inheriting sites should expect the same and
 * budget the full suite accordingly.
 *
 * `@object-ui/plugin-form` joined as objectui#6892's FIFTH slice, re-derived
 * on `d5c1f527e` by the same `scan()` method, the constant below again never
 * widened-and-reverted:
 *
 *     @object-ui/plugin-form       32 judged, 1 inheriting, 31 frozen -> 0
 *
 * with the population moving 178 -> 147 frozen over 643 judged and no site
 * moving the other way -- every other one of the 21 rows byte-identical between
 * the two runs. Merging `origin/main` mid-slice then brought in a THIRTY-SECOND
 * frozen site on this same specifier (`plugin-view`'s
 * `ObjectView.expandFls-7429.test.tsx` -- landed by objectui#7429), swept in the
 * same PR: on the merged head the specifier reads 33 judged, 33 inheriting, 0
 * frozen and the population reads 148 over 654. That is the growth warning
 * above firing for the THIRD consecutive slice, and it is the reason the
 * constant may only be widened by a run of this gate on the tree that ships,
 * never by the derivation taken on the base.
 *
 * This is the first slice whose sites span THREE owning packages
 * (20 under `packages/plugin-view`, 8 under `packages/app-shell`, 4 under
 * `packages/plugin-designer`) and the first to meet a THIRD syntactic shape:
 * four `plugin-designer` sites delegated the whole factory to a shared manual
 * mock module (`() => import('./__mocks__/plugin-form')`), which inherits
 * nothing. Those become an async factory that spreads the real barrel FIRST and
 * the manual mock module SECOND, so the hand-written `ModalForm` / `DrawerForm`
 * still win and every other export is the real one.
 *
 * STEP 0 was taken again rather than inherited, and here it found what the two
 * previous barrels did not: `packages/plugin-form/src` is NOT inert. Its
 * 28-module static import graph from `index.tsx` holds 75 module-scope
 * statements, and six of them are `ComponentRegistry.register(...)` calls in
 * the barrel itself (`object-form`, `form`, `embeddable-form`,
 * `form-analytics`, `object-master-detail-form`, `line_items`). The slice
 * proceeded anyway, and the reason is the class of the effect rather than its
 * absence: `register()` is a `Map.set` into an in-memory registry plus a
 * `console.warn` on the un-namespaced spelling, all six pass a namespace, and
 * this is the same effect slice 2 absorbed for `plugin-charts` and
 * `plugin-dashboard`. The other 69 statements are pure allocation -- `Set`s of
 * literal strings, style and threshold literals, one regular expression, four
 * `createSafeTranslation(...)` factory calls (already measured pure by slice 3)
 * and four `elementDataSourceBlock(...)` marks into a module-level `Set` in
 * `@object-ui/core`. ZERO timers, globals, storage, `fetch`, connections, and
 * zero side-effect-only imports; two column-anchored greps over all 28 modules
 * agree with the walk exactly. The registry question the ruling asks was also
 * answered on the CONSUMING side: of the 31 converted files exactly one names
 * `ComponentRegistry` at all, and it READS one entry (`get('object-view')`)
 * rather than asserting emptiness or a count, so no converted assertion can be
 * broken by the six new entries.
 *
 * ⭐ Unlike `@object-ui/collaboration`, this specifier DID have the free
 * confirmation: `packages/app-shell/src/views/studio-design/StudioDesignSurface.formFields.test.tsx`
 * already inherited the real barrel on `main` and passed, so the real module
 * was known to load in that environment before anything was converted.
 *
 * `@object-ui/components` joined as objectui#6892's SIXTH slice, re-derived on
 * `336a9eb8a` by the same `scan()` method, the constant below again never
 * widened-and-reverted:
 *
 *     @object-ui/components        47 judged, 20 inheriting, 27 frozen -> 0
 *
 * with the population moving 150 -> 123 frozen over 659 judged and no site
 * moving the other way -- every other one of the 21 rows byte-identical between
 * the two runs. The 27 sites sit in three owning packages (24 under
 * `packages/app-shell`, 2 under `packages/plugin-detail`, 1 under
 * `packages/plugin-timeline`) and in three syntactic shapes: 16 object-literal
 * arrows, 6 block-bodied arrows with a `return`, and 5 that were ALREADY
 * `async` and still frozen -- they awaited something OTHER than the module
 * under mock (React, or one deep-relative source module) and returned a
 * hand-listed object, which is the shape a name-matching gate would wave
 * through and this one does not.
 *
 * STEP 0 was taken again rather than inherited, and this barrel is the largest
 * yet measured: 205 modules and 1173 module-scope statements reached from
 * `packages/components/src/index.ts`. It is NOT inert, and it was not expected
 * to be -- objectui#7837 had already counted the registrations. What decided
 * the slice is the CLASS of the effect, measured three ways. Statically: 112
 * module-scope `ComponentRegistry.register(...)` call sites, every one of them
 * carrying a namespace (`ui` 85, `element` 10, `page` 7, `action` 5, plus the
 * loop-driven `protocol-placeholder` marks), so the deprecation `console.warn`
 * in `register()` cannot fire; `register()` itself is a `Map.set` plus that
 * warn plus a `notify()` over a listener `Set` that is empty at import time.
 * Beyond registration there is exactly ONE non-allocation statement in the
 * whole graph -- `hooks/related-count-store.ts` calls `subscribeDataChanges`,
 * which `packages/react/src/data-invalidation.ts` implements as a `Set.add`
 * into a module-level listener set: no timer, no window listener, no request.
 * Two column-anchored greps over all 205 modules agree: the
 * timers/globals/storage/network/DOM grep matches nothing, and the
 * IDENT.method grep returns the register lines and nothing else. Empirically:
 * importing the real barrel in the happy-dom environment registers 295 keys
 * over 159 `register()` calls and emits ZERO `console.warn` and ZERO
 * `console.error`. The consuming side was checked for the failure class the
 * worklist names -- of the 27 converted files NONE names `ComponentRegistry`
 * at all, and the six `console.warn` spies among them are all installed inside
 * `it(...)` bodies (after import) AND filter by message content, so no
 * assertion can see a registration.
 *
 * ⚠️ The ONE side-effect import in the barrel is a CSS import
 * (`./sidebar-fixes.css`, plain CSS by construction -- the barrel's own comment
 * explains why the Tailwind entry is deliberately NOT imported there). The root
 * Vitest config declares no `css` option, so CSS is not processed and the
 * import is inert in jsdom. That is corroborated rather than argued: 20 sites
 * on this specifier already inherited the real barrel on `main` and passed, 8
 * of them in `packages/app-shell` under the LIGHT `dom` project -- the free
 * confirmation slice 4 did not have.
 *
 * ⭐ This slice is the first where inheriting made converted files DIE during
 * collection, which is the failure this whole worklist exists to describe,
 * observed from the other side. 15 of the 27 died at once, all on one cause:
 * the real barrel reaches `notifications/severity.ts`, which reads four icons
 * from `lucide-react` AT MODULE SCOPE into a `const` -- and those 15 files
 * carried their own frozen `lucide-react` factory that had never listed them.
 * Nothing in product source was touched: the repair is the neighbouring
 * FACTORY, converted to the same inheriting form (spread the real module
 * first, keep every hand-written icon stub after it), which is why a frozen
 * third-party factory can be the thing that blocks a workspace-specifier
 * sweep even though this gate never judges it.
 *
 * ⚠️ Inheriting is NOT free here, and the cost is recorded rather than
 * absorbed silently. The `dom`/`dom-heavy` project split exists precisely to
 * keep this package's graph out of the light project's setup, so a converted
 * file now pulls it through its own imports instead. Measured on one app-shell
 * file, twice each: 6.17s / 5.97s frozen, 8.72s / 9.36s inheriting both the
 * barrel and `lucide-react`. See the slice's pull request for the whole-package
 * figure.
 *
 * `@object-ui/plugin-grid` joined as objectui#6892's SEVENTH slice, re-derived
 * on `21d7989fb` by the same `scan()` method, the constant below again never
 * widened-and-reverted:
 *
 *     @object-ui/plugin-grid       25 judged, 0 inheriting, 25 frozen -> 0
 *
 * with the population moving 123 -> 98 frozen over 659 judged and no site
 * moving the other way -- every other one of the 21 rows byte-identical between
 * the two runs. The 25 sites sit in two owning packages (21 under
 * `packages/plugin-view`, 4 under `packages/plugin-designer`) and in two
 * syntactic shapes: 21 object-literal arrows -- 15 of them the SAME single line
 * byte-for-byte -- and the 4 designer sites delegating the whole factory to a
 * shared manual mock module, the shape slice 5 first met.
 *
 * STEP 0 was taken again rather than inherited, and this graph is the largest
 * yet measured on this worklist: 560 modules and 1421 module-scope statements
 * reached from `packages/plugin-grid/src/index.tsx` -- larger than slice 6's
 * barrel because this one reaches `@object-ui/components`, `@object-ui/fields`,
 * `@object-ui/react`, `@object-ui/core`, `@object-ui/permissions`,
 * `@object-ui/mobile` and `@object-ui/i18n`. It is NOT inert, and the slice
 * proceeded on the CLASS of the effect. Statically: 114 module-scope
 * `ComponentRegistry.register(...)` call sites, every one carrying a namespace
 * (`ui` 89, `element` 10, `page` 7, `action` 5, `plugin-grid` 2, `view` 1 --
 * the five in `renderers/layout/page.tsx` that read as bare carry `ui` through
 * the spread `pageMeta` constant), so the deprecation `console.warn` in
 * `register()` cannot fire. THREE effects this worklist had not met before, all
 * in `packages/fields/src/index.tsx` and all the same benign class: five
 * `registerFieldRenderer(...)` calls that are a `Map.set` into a module-level
 * registry, one `setCellRendererResolver(...)` that assigns a module-level
 * `let`, and `registerAllFields()`, which loops the widget map into
 * `ComponentRegistry.register` under the `field` namespace. Beyond registration
 * the graph holds only allocation -- 171 `React.forwardRef`, 94 `new Set`, 21
 * `createContext`, 15 `Object.freeze`, 14 `new Map`, 13 `cva`, 10
 * `createDiscardProofCache` (a `new WeakMap` plus a closure) and nine
 * module-scope `new` singletons whose constructors were READ and assign fields
 * only (`UndoManager`'s `localStorage` path is a method nothing calls at import).
 * ZERO timers, globals, storage, `fetch` or connections. Empirically: importing
 * the real barrel under happy-dom moves `ComponentRegistry.getAllTypes()` from
 * 0 to 375 keys, exports 20 names, and emits ZERO `console.warn` and ZERO
 * `console.error`.
 *
 * ⚠️ Two column-anchored greps corroborate the walk with ONE disagreement worth
 * recording, because it is the grep that is wrong: four `self.addEventListener`
 * lines match at column 0 in `packages/mobile/src/serviceWorkerSource.ts`, and
 * all four sit INSIDE the template literal that module returns as generated
 * service-worker SOURCE. They are never executed by importing anything. The AST
 * walk does not report them; a column-anchored grep cannot see template-literal
 * nesting. Prefer the parser, and record the disagreement rather than the
 * quieter number.
 *
 * The consuming side was checked for the failure class the worklist names: of
 * the 25 converted files exactly ONE names `ComponentRegistry` at all, and it
 * READS one entry -- `get('object-view')`, a key `packages/plugin-view`'s own
 * index registers, not one this barrel claims -- rather than asserting
 * emptiness or a count. Not one of the 25 installs a `console.warn` or
 * `console.error` spy. So no converted assertion can be broken by the 375 keys.
 *
 * ⚠️ Like `@object-ui/collaboration`, this specifier had ZERO already-inheriting
 * sites, so there was no free confirmation -- the suite runs themselves are the
 * evidence, and that is weaker than a pre-existing green site.
 *
 * ⭐ The collection-death failure class slice 6 met did NOT fire here, and the
 * reason is worth carrying rather than reading as luck. Every one of the 25
 * files carries neighbouring factories -- 25 on `@object-ui/plugin-form`, 21 on
 * `@object-ui/react`, one on `@object-ui/permissions` -- and ALL of them were
 * already inheriting, swept by slices 3, 5 and 6 or written that way. There is
 * not a single frozen THIRD-PARTY factory in the 25. Slice 6's 15 deaths came
 * from frozen `lucide-react` neighbours; a specifier whose sites have none
 * inherits cleanly. Check the neighbours before budgeting for the repair.
 *
 * ⚠️ Cost, measured the same way slice 6 measured it -- one converted
 * `plugin-view` file, twice each: 9.53s / 8.37s frozen, 10.17s / 9.91s
 * inheriting. The ~1.1s marginal cost is far below slice 6's ~3s, and for a
 * structural reason: these files ALREADY inherit the real `@object-ui/react`
 * and `@object-ui/plugin-form` barrels, whose graphs already pull
 * `@object-ui/components`. Inheriting a barrel is cheap once its own
 * dependencies are already loaded in that file.
 *
 * `@object-ui/permissions` joined as objectui#6892's EIGHTH slice, re-derived
 * on `571b4870d` by the same `scan()` method, the constant below again never
 * widened-and-reverted:
 *
 *     @object-ui/permissions       48 judged, 24 inheriting, 24 frozen -> 0
 *
 * with the population moving 98 -> 74 frozen over 659 judged and no site moving
 * the other way -- every other one of the 21 rows byte-identical between the
 * two runs. The 24 frozen sites sit in four owning packages (17 under
 * `packages/app-shell`, 4 under `packages/plugin-grid`, 2 under
 * `packages/plugin-detail`, 1 under `packages/plugin-form`) and in two
 * syntactic shapes: 23 zero-parameter object-literal arrows and one that was
 * ALREADY `async` and still frozen -- it awaited `react`, not the module under
 * mock, which is the shape a name-matching gate waves through.
 *
 * STEP 0 was taken again rather than inherited, and this barrel is the SMALLEST
 * yet measured on this worklist and the first to come back genuinely INERT
 * since `@object-ui/collaboration`: 27 modules and 422 module-scope statements
 * reached from `packages/permissions/src/index.ts` -- the package plus
 * `@object-ui/types`, and nothing else in the workspace. It is a 43-line
 * re-export-only barrel, and a verdict on one of those is NOT free: what it
 * re-exports is what runs. Of the 422 statements exactly 18 execute anything,
 * and every one is allocation: ten `createDiscardProofCache()` calls (a
 * `new WeakMap` plus a returned closure -- read at the definition, not
 * assumed), one `createContext(null)` with its `displayName` assignment, three
 * `new Set` of literals, one `Object.freeze` of a literal, one `new WeakMap`,
 * and one `Symbol.for('objectui.inflightGet')`. That last one is the only
 * effect that leaves the module, and it is the global SYMBOL REGISTRY rather
 * than a global property: interning is idempotent, stores no value, and the
 * empirical run confirms it puts nothing on `globalThis` (the probe's own
 * `getOwnPropertySymbols(globalThis)` does not contain it). ZERO
 * `ComponentRegistry.register` calls -- the first swept barrel with none --
 * ZERO timers, globals, storage, `fetch`, connections, side-effect-only
 * imports and CSS. Two column-anchored greps over all 27 modules agree with the
 * walk EXACTLY, with no disagreement to record this time. Empirically:
 * importing the real barrel under happy-dom in the light `dom` project exports
 * 7 names, costs ~0.47s and emits ZERO `console.warn` and ZERO `console.error`.
 *
 * ⭐ The free confirmation is back, and it is the strongest this worklist has
 * had: 24 of the 48 sites -- exactly half, spread over TWELVE packages --
 * already inherited the real barrel on `main` and passed, so the real module
 * was known to load in the environment before anything was converted. All 48
 * sites are `.test.tsx` and NONE is in `heavyDomTests`, so all 48 run in the
 * single light `dom` project and one environment is the whole answer.
 *
 * ⭐ Slice 6's collection-death class did NOT fire, and the neighbour reading
 * says why in advance rather than after the fact. The 24 files carry 8 frozen
 * `sonner` factories and 7 frozen `@object-ui/plugin-list` ones -- the exact
 * shape that killed 15 files in slice 6 -- but this barrel's graph reaches
 * NEITHER, because it reaches nothing beyond `@object-ui/types`, `react` and
 * `@objectstack/spec`. A frozen neighbour is dangerous only when the newly-real
 * module's graph reaches it; walk the graph, then read the neighbours against
 * it.
 *
 * `@object-ui/plugin-detail` joined as objectui#6892's NINTH slice, re-derived
 * on `310c0ab19` by the same `scan()` method, the constant below again never
 * widened-and-reverted:
 *
 *     @object-ui/plugin-detail     17 judged, 4 inheriting, 13 frozen -> 0
 *
 * with the population moving 74 -> 61 frozen over 659 judged and no site moving
 * the other way. The 13 frozen sites sit in three owning packages (8 under
 * `packages/plugin-gantt`, 4 under `packages/plugin-calendar`, 1 under
 * `packages/plugin-tree`) and in ONE syntactic shape -- all 13 are
 * zero-parameter object-literal arrows, the most uniform surface this worklist
 * has swept.
 *
 * ⭐ The import-cost reading this slice owed, and why an isolated probe would
 * have answered it WRONG. Both `vitest.config.mts` and `apps/console`'s config
 * alias this specifier to `packages/plugin-detail/src`, so `importOriginal`
 * transforms the barrel's graph on demand -- and that graph is the LARGEST this
 * worklist has walked: 564 modules and 6,181 module-scope statements, carrying
 * 127 `ComponentRegistry.register` calls and 99 bare side-effect imports, the
 * latter almost entirely the `@object-ui/components` renderer cascade. Timed
 * COLD in an otherwise-empty test file, `importOriginal` of this barrel costs a
 * median of 8.8s (8815ms / 8646ms / 8827ms) -- squarely in objectui#6580's
 * ~10s `@object-ui/app-shell` range, which the dispatch defined as a STOP.
 *
 * ⛔ That number is an ARTEFACT of the empty file, and acting on it would have
 * stopped a free conversion. Measured on the REAL files instead -- the only
 * measurement that decides anything -- the marginal cost is roughly zero:
 * gantt 9.81s frozen -> 9.73s inheriting, tree 9.65s -> 9.84s, calendar 9.32s
 * -> 10.32s, i.e. -0.1s to +1.0s per file, the `@object-ui/plugin-grid` range
 * and not objectui#6580's. The mechanism is a SUBSET relation, and it is
 * measured rather than argued: every one of these 13 files already imports
 * `@object-ui/react` and its own view component (`./ObjectGantt` and friends)
 * at module scope, and those two together reach 572 modules -- a strict
 * SUPERSET of the barrel's 564, with `comm -23` reporting exactly ZERO modules
 * that inheriting adds. `importOriginal` here resolves an already-resident
 * graph; it loads nothing new.
 *
 * ⇒ CARRY-FORWARD, and it generalises past this specifier: a barrel's import
 * cost is NOT a property of the barrel. Measure it in the files that will pay
 * it, against what they already load, and never from a probe that imports the
 * barrel alone -- the probe answers "what does this graph cost from cold",
 * which is the wrong question whenever the consuming file already holds it.
 *
 * The neighbours in these 13 files are 7 frozen `sonner` factories plus 12
 * local whole-module replacements (`./GanttView` 8, `./CalendarView` 4), all
 * out of scope by construction, and slice 6's collection-death class again did
 * not fire: this barrel's graph reaches neither `sonner` nor those local
 * modules. ZERO neighbouring repairs.
 *
 * `@object-ui/plugin-chatbot` joined as objectui#6892's TENTH slice, re-derived
 * on `97b0177e1` by the same `scan()` method, the constant below again never
 * widened-and-reverted:
 *
 *     @object-ui/plugin-chatbot    16 judged, 5 inheriting, 11 frozen -> 0
 *
 * with the population moving 61 -> 50 frozen over 659 judged and no site moving
 * the other way -- a diff of the two per-specifier tables with the
 * `@object-ui/plugin-chatbot` row removed is EMPTY. All 16 sites sit under
 * `packages/app-shell` and all 11 frozen ones are ONE syntactic shape (the
 * zero-parameter object-literal arrow), each hand-listing one to three names
 * from a 48-export barrel.
 *
 * STEP 0 was taken again rather than inherited: 454 modules and 5,238
 * module-scope statements reached from `packages/plugin-chatbot/src/index.tsx`,
 * over eight workspace packages (`components` 206, `core` 95, `react` 64,
 * `plugin-chatbot` 33, `i18n` 27, `types` 17, `sdui-parser` 8,
 * `data-objectstack` 5). NOT inert, and the slice proceeded on the CLASS of the
 * effect: 114 module-scope `ComponentRegistry.register(...)` calls, and ZERO of
 * them are bare. Every one carries a namespace (`ui` 89, `element` 10, `page` 7,
 * `action` 5, `plugin-chatbot` 3); the five rows in `renderers/layout/page.tsx`
 * that READ as bare carry `ui` through the spread `pageMeta` constant, so the
 * deprecation `console.warn` in `register()` cannot fire. ⚠️ Slice 9's REPORT
 * called those five bare, and slice 10's dispatch inherited the claim; slice 7's
 * record above had them right. Read the third argument, not the key -- the
 * namespace never appears in the registered string. Empirically: importing
 * the real barrel under happy-dom exports 48 names, moves
 * `ComponentRegistry.getAllTypes()` from 0 to 301 keys, and emits ZERO
 * `console.warn` and ZERO `console.error`.
 *
 * ⭐ This is the first slice whose files span TWO vitest projects, and checking
 * that mattered. Fifteen of the sixteen sites run in the light `dom` project;
 * `packages/app-shell/src/layout/__tests__/ChatDock.test.tsx` is in
 * `heavyDomTests` and runs in `dom-heavy`, and
 * `packages/app-shell/src/hooks/__tests__/useAiSurface.test.ts` is a `.test.ts`
 * that reaches `dom` only through `domTsTests`. The isolated cold import differs
 * by an order of magnitude between the two projects -- a median 5.82s under
 * `dom` against 0.66s under `dom-heavy`, because that project's heavy setup has
 * already loaded 391 of the registry's keys before the barrel is asked for.
 *
 * ⚠️ The per-file marginal cost here is BIMODAL, and it is the first counter-
 * example to slice 9's carry-forward reading as uniform. Ten of the eleven files
 * already reach 422 of the barrel's 454 modules at module scope, so inheriting
 * adds 32 modules and costs +0.4s to +0.8s -- slice 9's range. The eleventh
 * (the `useAiSurface` hook spec) reaches ZERO of the 454: it is a four-test file
 * whose only route to the barrel is the mock itself, so inheriting adds all 454
 * modules plus 58 external leaves and the file goes 0.68s -> 7.77s, an 11.4x
 * marginal cost squarely inside objectui#6580's STOP band. What settled the
 * slice is the number CI actually pays, measured over the eleven files as ONE
 * invocation: 25.6s frozen -> 28.6s inheriting, +2.7s for the whole slice with
 * 64/64 tests green in both states. ⇒ CARRY-FORWARD, sharpening slice 9's: take
 * the marginal per FILE, but decide on the AGGREGATE -- a lone cold file can sit
 * in the STOP band while the population it belongs to costs a tenth of it, and
 * stopping on the per-file number alone would have forfeited ten free
 * conversions and left the specifier permanently outside this list, since there
 * is deliberately no per-file exception ledger.
 *
 * The neighbour reading found ZERO repairs owed and said so in advance: the
 * eleven files carry 11 already-inheriting `@object-ui/auth` factories, 8
 * already-inheriting `@object-ui/i18n` ones, 6 frozen `react-router-dom` ones
 * (third-party, out of scope by construction) and 24 local whole-module
 * replacements. Slice 6's collection-death class needed a frozen neighbour the
 * newly-real graph REACHES: this barrel's graph reaches `i18n` (already
 * inheriting) and NOT `react-router-dom`, and not one of the sixteen files
 * carries a frozen `lucide-react` factory even though the graph reads
 * `lucide-react` 71 times.
 *
 * ⭐ The free confirmation is present: 5 of the 16 sites already inherited the
 * real barrel on `main` and passed, all of them in the light `dom` project.
 *
 * `@object-ui/plugin-designer` joined as objectui#6892's ELEVENTH slice,
 * re-derived on `ecf8e726e` by the same `scan()` method, the constant below
 * again never widened-and-reverted:
 *
 *     @object-ui/plugin-designer   10 judged, 0 inheriting, 10 frozen -> 0
 *
 * with the population moving 50 -> 40 frozen over 659 judged and no site moving
 * the other way. The 10 sites are an `AppContent.*` SIBLING FAMILY in one
 * syntactic shape -- the zero-parameter object-literal arrow, each hand-listing
 * the same three of the barrel's 29 exports -- and this is the first slice on
 * this worklist to reach OUTSIDE `packages/`: nine sit under
 * `packages/app-shell` and one under `apps/console`, which runs in its own
 * merged vitest project rather than in the root config's.
 *
 * STEP 0 was taken again rather than inherited: 619 modules and 6,825
 * module-scope statements reached from `packages/plugin-designer/src/index.tsx`
 * over fourteen workspace packages (`components` 206, `core` 95, `fields` 77,
 * `react` 64, `plugin-grid` 31, `plugin-designer` 29, `plugin-form` 28, `i18n`
 * 27, `types` 18, `mobile` 16, `permissions` 10, `sdui-parser` 8,
 * `data-objectstack` 5, `providers` 5). NOT inert, and the slice proceeded on
 * the CLASS of the effect: 130 module-scope `ComponentRegistry.register(...)`
 * calls, ZERO of them bare. Every one carries a namespace (`ui` 89, `element`
 * 10, `page` 7, `action` 5, `plugin-form` 4, `plugin-designer` 10, `plugin-grid`
 * 2, `view` 2, `record` 1); the five rows in the `page.tsx` renderer that READ
 * as bare carry `ui` through the spread `pageMeta` constant, so the deprecation
 * `console.warn` in `register()` cannot fire. The remaining effects are the
 * benign registration class slice 7 already measured in `packages/fields`: five
 * `registerFieldRenderer(...)` map writes, one `setCellRendererResolver(...)`
 * assignment and `registerAllFields()`. One CSS import, inert (the root config
 * declares no `css` option). Empirically, importing the real barrel emits ZERO
 * `console.warn` and ZERO `console.error` in BOTH projects and exports 29 names.
 *
 * ⭐ The import cost was taken in both projects the sites run in, and the two
 * differ by an order of magnitude for the same reason slice 10 recorded: under
 * the light `dom` project the isolated cold import costs a median 6.89s and
 * moves the registry 0 -> 405 keys; under the console project, whose merged
 * config uses the HEAVY dom setup, it costs a median 0.54s and moves the
 * registry 391 -> 421. Neither number decides anything on its own. The marginal
 * cost measured in the files that pay it is uniform and small -- an app-shell
 * file 9.19s frozen -> 9.55s inheriting, the console file 18.84s -> 19.22s --
 * and the aggregate over the ten files as ONE invocation is +3.6s on a ~36s
 * median (four frozen runs against five inheriting ones, two of them
 * interleaved A/B), i.e. inside the noise band of a shared box and nowhere near
 * objectui#6580's STOP band. The mechanism is measured, not argued: every one
 * of the ten files ALREADY holds 590 of the barrel's 619 modules at module
 * scope, so inheriting adds exactly the 29 modules of the designer package
 * itself.
 *
 * ⚠️ This slice met a failure mode the worklist had not met before, and it is
 * NOT slice 6's collection death: two of the ten went red on LOAD TIMING. The
 * console shell reaches `CreateAppPage` only through
 * `React.lazy(() => import('@object-ui/plugin-designer'))`, so an inheriting
 * factory first runs when that lazy boundary resolves -- inside the RTL
 * `findBy` budget of the two files that assert on the rendered designer page.
 * Alone they pass; in the ten-file invocation the transform pipeline is
 * saturated and the 29 added modules do not fit in 1000ms, so the assertion
 * fails while the shell is still booting. The repair is the one AGENTS.md
 * prescribes for an unbounded module load counted against a bounded window --
 * a module-scope `import '@object-ui/plugin-designer'` in those two files,
 * which moves the cost into the import phase where no timeout applies. No
 * assertion was touched. ⇒ CARRY-FORWARD: a specifier reached only through
 * `React.lazy` defers the whole inheritance cost into a test's assertion
 * window, so budget the timing check on the AGGREGATE invocation and never on
 * the per-file run, which cannot see it.
 *
 * The neighbour reading found ZERO repairs owed and said so in advance: across
 * the ten files every workspace neighbour already inherits (10 `@object-ui/auth`
 * sites, 10 `@object-ui/i18n`, 8 `@object-ui/react`, 1 `@object-ui/plugin-form`)
 * and there is not one third-party factory in the family at all -- so the frozen
 * `lucide-react` neighbour that killed 15 files in slice 6 cannot exist here,
 * even though this barrel's graph reads `lucide-react` 106 times. The remaining
 * neighbours are 39 local whole-module replacements, out of scope by
 * construction. No file among the ten mocks `@object-ui/app-shell`, so the
 * parked specifier stays parked.
 *
 * ⚠️ Like slices 4 and 7, this specifier had ZERO already-inheriting sites, so
 * there was no free confirmation -- the suite runs themselves are the evidence.
 *
 * `@object-ui/plugin-list` joined as objectui#6892's TWELFTH slice, re-derived
 * on `190cd07b3` by the same `scan()` method, the constant below again never
 * widened-and-reverted:
 *
 *     @object-ui/plugin-list       10 judged, 1 inheriting, 9 frozen -> 0
 *
 * with the population moving 40 -> 31 frozen over 660 judged and no site moving
 * the other way -- a diff of the two per-specifier tables with the
 * `@object-ui/plugin-list` row removed is EMPTY. All 10 sites are an
 * `ObjectView` / `InterfaceListPage` / `ObjectDataPage` SIBLING FAMILY in one
 * directory (`packages/app-shell/src/views`), and the 9 frozen ones come in
 * THREE shapes rather than the single one the previous slice met: four
 * one-line object-literal arrows returning a null-rendering `ListView`, three
 * multi-line ones whose double captures `props.schema` and returns null, and
 * two whose double renders a JSX probe element. Each hand-listed exactly ONE
 * of the barrel's twelve exports.
 *
 * STEP 0 was taken again rather than inherited: 539 modules and 5,777
 * module-scope statements reached from `packages/plugin-list/src/index.tsx`
 * over twelve workspace packages (`components` 206, `core` 95, `fields` 77,
 * `react` 64, `i18n` 27, `types` 17, `mobile` 16, `permissions` 10,
 * `plugin-list` 8, `sdui-parser` 8, `data-objectstack` 6, `providers` 5). NOT
 * inert, and the slice proceeded on the CLASS of the effect: 115 module-scope
 * `ComponentRegistry.register(...)` calls, ZERO of them bare -- `ui` 85,
 * `element` 10, `page` 7, `action` 5, `plugin-list` 2, `view` 1, plus the five
 * rows in the `page.tsx` renderer that READ as bare and carry `ui` through the
 * spread `pageMeta` constant. Beyond registration the graph holds only
 * allocation: 173 `React.forwardRef`, 84 `new Set`, 21 `createContext`, 16
 * `Object.freeze`, 13 `new Map`, 13 `cva`, 13 `createSafeTranslation`, 10
 * `createDiscardProofCache`, five `registerFieldRenderer` map writes, one
 * `setCellRendererResolver` assignment and `registerAllFields()` -- the benign
 * `packages/fields` class slice 7 measured. An AST walk that STOPS at every
 * function-like boundary reports ZERO timers, globals, storage, `fetch` and
 * connections at import time; 98 bare side-effect imports (the
 * `@object-ui/components` renderer cascade) and one CSS import, inert because
 * the root config declares no `css` option. Empirically, importing the real
 * barrel under the light `dom` project exports 12 names, moves
 * `ComponentRegistry.getAllTypes()` from 0 to 375 keys and emits ZERO
 * `console.warn` and ZERO `console.error`.
 *
 * ⭐ The cost was decided on the AGGREGATE, per slice 10's carry-forward, and
 * the per-file number could not have decided it either way. The isolated cold
 * import under the light `dom` project costs a median 6.2s, but every one of
 * the ten files already holds 515 to 539 of the barrel's 539 modules at module
 * scope -- the three view components under test each import `ListView` from
 * this specifier, and their own graphs pull the rest -- so inheriting adds only
 * 8 modules in seven files and 24 in the other two. Measured: an
 * `InterfaceListPage` file 9.58s frozen -> 9.98s inheriting, an `ObjectView`
 * one 10.26s -> 10.86s, an `ObjectDataPage` one 9.02s -> 8.85s, and the ten
 * files as ONE invocation, taken as an interleaved A/B against the committed
 * tree because the box drifts by ten seconds across an hour: -1.0s and +2.3s
 * on the two pairs, i.e. inside the noise band and nowhere near objectui#6580's
 * STOP band, with 113/113 green in both states.
 *
 * ⚠️ This barrel's graph DOES reach `sonner`, and seven of the ten files carry
 * a frozen `sonner` factory -- the exact pairing that killed 15 files in slice
 * 6. It is benign here for a reason worth writing down, because the neighbour
 * rule as stated ("dangerous only when the newly-real graph reaches it") would
 * have predicted a repair: the two renderer modules that import `sonner` read
 * `toast.success` and friends only INSIDE their click handlers, and
 * `components/src/ui/sonner.tsx` re-exports `toast` at module scope but
 * dereferences `Toaster` only inside a component body. The frozen factories all
 * provide `toast`. So the sharper rule is: a frozen neighbour is dangerous when
 * the newly-real graph reads a MISSING BINDING from it AT MODULE SCOPE -- reach
 * alone is necessary, not sufficient. The two `react-router-dom` factories are
 * safe by reach (no module in the graph imports it). ZERO neighbouring repairs,
 * predicted in advance from the walk and then confirmed by the runs.
 *
 * ⭐ The free confirmation is present, and it is the strongest kind for this
 * pairing: one of the ten sites already inherited the real barrel on `main`,
 * passed, and carries a frozen `sonner` neighbour of its own -- so the real
 * barrel was known to load in the light `dom` project alongside that neighbour
 * before anything was converted. No `React.lazy` or dynamic `import()` of this
 * specifier exists anywhere in the tree, so slice 11's deferred-cost class
 * could not fire and no module-scope import was owed in any file.
 *
 * `@object-ui/fields` joined as objectui#6892's THIRTEENTH slice, re-derived on
 * `340489334` by the same `scan()` method, the constant below again never
 * widened-and-reverted:
 *
 *     @object-ui/fields            10 judged, 2 inheriting, 8 frozen -> 0
 *
 * with the population moving 31 -> 23 frozen over 660 judged and no site moving
 * the other way -- a diff of the two per-specifier tables with the
 * `@object-ui/fields` row removed is EMPTY. All 8 frozen sites sit under
 * `packages/app-shell/src/views/metadata-admin` -- three across the
 * `AccessExplainPanel` and `AssignedUsersSection` specs, three in the
 * `PermissionMatrixEditor` family and two under `inspectors` -- and all 8 are
 * ONE syntactic shape -- the zero-parameter object-literal arrow -- carrying
 * THREE double families: a null-rendering `RecordPickerDialog` in three files,
 * a `CapabilityMultiSelectField` JSX probe paired with a `parseCapabilityNames`
 * function double in three, and a `LookupField` JSX probe in two. Each
 * hand-listed one or two of the barrel's 140 exports.
 *
 * STEP 0 was taken again rather than inherited: 504 modules and 5,455
 * module-scope statements reached from `packages/fields/src/index.tsx` over
 * nine workspace packages (`components` 205, `core` 95, `fields` 77, `react`
 * 64, `i18n` 27, `types` 17, `sdui-parser` 8, `data-objectstack` 6,
 * `providers` 5). NOT inert, and the slice proceeded on the CLASS of the
 * effect: 112 module-scope `ComponentRegistry.register(...)` calls, ZERO of
 * them bare -- `ui` 90, `element` 10, `page` 7, `action` 5, with the
 * `page.tsx` renderer's five rows carrying `ui` through the spread `pageMeta`
 * constant, so the deprecation `console.warn` in `register()` cannot fire. The
 * barrel's OWN module-scope effects are the benign `packages/fields` class
 * slice 7 measured, confirmed rather than inherited: five `registerFieldRenderer`
 * map writes, one `setCellRendererResolver` assignment and `registerAllFields()`,
 * which loops the widget map into `ComponentRegistry.register` under the `field`
 * namespace wrapping a `React.lazy` loader -- so registering a widget does not
 * LOAD it. Beyond registration the graph holds only allocation: 171
 * `React.forwardRef`, 81 `new Set`, 30 `createContext`, 14 `Object.freeze`, 13
 * `new Map`, 13 `cva`, 11 `createSafeTranslation`, four `Symbol.for` and one
 * `subscribeDataChanges` (a `Set.add` into a module-level listener set). An AST
 * walk that STOPS at every function-like boundary reports ZERO timers, globals,
 * storage, `fetch` and connections at import time; 98 bare side-effect imports
 * (the `@object-ui/components` renderer cascade) and one CSS import, inert
 * because the root config declares no `css` option. Empirically, importing the
 * real barrel under the light `dom` project exports 140 names, moves
 * `ComponentRegistry.getAllTypes()` from 0 to 370 keys and emits ZERO
 * `console.warn` and ZERO `console.error`.
 *
 * ⭐ This slice's sites span TWO projects and the two answer the cost question
 * in OPPOSITE ways, so taking only one would have been useless. Eight run in
 * the light `dom` project, where the isolated cold import costs a median 5.8s;
 * the other two are in `heavyDomTests` and run in `dom-heavy`, whose setup
 * ALREADY imports this very barrel at module scope -- there the isolated
 * "cold" import measures 0 ms and leaves the registry unmoved at 391 keys,
 * because the module is resident before any test file is transformed. That is
 * the strongest form of the free confirmation this worklist has had for a
 * specifier: for two of the eight, inheriting cannot cost anything at all.
 * Statically the eight already hold 352 to 422 of the barrel's 504 modules, so
 * inheriting adds 82 to 152; measured in the files that pay it the marginal is
 * -0.29s (the `dom-heavy` one), +0.05s and +0.94s, and the ten files as ONE
 * invocation, taken as an interleaved A/B against the committed tree, read
 * +0.50s and +0.65s on a ~25.4s aggregate -- about 2%, inside the noise band
 * and nowhere near objectui#6580's STOP band, with 58/58 green in every state.
 *
 * ⚠️ Slice 11's deferred-cost class was checked and is ABSENT for this
 * specifier: the only `import('@object-ui/fields')` anywhere in the tree is a
 * TYPE position (`typeof import(...)`) inside an already-inheriting factory, so
 * no consuming module reaches this barrel through `React.lazy`. The two
 * module-scope `React.lazy` calls the graph does contain are INSIDE the package
 * and load package-local widget modules, which the real barrel resolves itself;
 * neither defers anything across a converted file's assertion window. No
 * module-scope import repair was owed, and none was made.
 *
 * The neighbour reading found ZERO repairs owed and said so in advance from the
 * walk. Across the ten files there is not ONE third-party factory -- so the
 * frozen `lucide-react` neighbour that killed 15 files in slice 6 cannot exist
 * here, even though this barrel's graph reads `lucide-react` 76 times and
 * reaches `sonner`. Every workspace neighbour already inherits (four
 * `@object-ui/react` sites, one `@object-ui/auth`), and two of the four
 * `@object-ui/react` ones already provide `subscribeDataChanges` explicitly --
 * the one binding this graph reads from that specifier at module scope, which
 * is slice 12's sharpened rule satisfied before the fact rather than by luck.
 * The remaining nine neighbours are local whole-module replacements, out of
 * scope by construction and safe by REACH: this barrel's graph reaches nothing
 * under `packages/app-shell`. No file among the ten mocks `@object-ui/app-shell`,
 * so the parked specifier stays parked.
 *
 * ### Slice 14 -- `@object-ui/app-shell`, the last specifier carrying frozen sites
 *
 * The nineteenth member, and the one slice 13 left PARKED. Re-derived on
 * `fff250ff1` by running this file's own `scan()` with a local `covered`
 * override -- ⛔ never from the worklist's table:
 *
 *     @object-ui/app-shell   23 judged, 0 inheriting, 23 frozen -> 0
 *
 * with the tree-wide census moving `625 judged / 625 inherit / 35 other
 * workspace` to `648 / 648 / 12`: the covered count rose by exactly the
 * converted sites and `other workspace` fell by the same number, so no site
 * moved the other way and nothing joined the judged population except these.
 *
 * ⭐ THREE different counts were in circulation for this slice, and the way
 * they reconcile is a property of THIS gate, so it is recorded here rather
 * than left to be rediscovered:
 *
 *   - **22** -- objectui#6892's own Verification recipe greps `vi.mock` and
 *     counts FILES. It can never reach 23:
 *     `AppManagementPage.mutations.test.tsx` carries TWO call sites.
 *   - **23** -- what `scan()` reports, and what this slice converted.
 *   - **24** -- an unmasked regex over the same tree, matching `vi.mock` and
 *     `vi.doMock` OCCURRENCES. The extra one is at
 *     `FormPage.predicateScope.test.tsx:76` and it is **inside a block
 *     comment** -- a doc comment that quotes the very call it documents.
 *
 * ⚠️ The 24th is NOT the `embedded` bucket, and guessing that it was would
 * have been wrong in a way that reads plausible: `scanSource()` blanks
 * comments BEFORE `CALL_RE` runs, so a commented occurrence never becomes a
 * call site at all and is counted in NO bucket. `embedded` reads 3 tree-wide
 * and every one of them names something else (two `@object-ui/react` samples
 * in this file's own header, one `./dep` in an eslint-rule test). Measured:
 * `comment[offset] = 1, literal[offset] = 0`.
 *
 * ⭐ **The odd site: a `vi.doMock` INSIDE a test.** Twenty-two of the 23 are
 * module-scope `vi.mock` calls whose factory runs during the import phase.
 * The twenty-third, `AppManagementPage.mutations.test.tsx:280`, is a
 * `vi.doMock` inside a test body after `vi.resetModules()`, so its obtain sits
 * in a BOUNDED window -- exactly the shape AGENTS.md's 测试纪律 section warns
 * about. It was measured before conversion rather than argued about
 * (objectui#8173): that test went 459ms -> 660ms against a 5000ms
 * `testTimeout`, while `hop1SessionPrincipal` -- the 15000ms window
 * objectui#6580 was fighting -- went 9ms -> 8ms. Harmless, but shaped
 * differently from the other 22, and the next reader should not have to
 * discover that.
 *
 * ⭐ **The cost question was settled by objectui#8173 in 11 vitest arms, and
 * ⛔ no maintainer ruling is owed.** The blocker that parked this specifier
 * was a `10s x 22 = 220s` extrapolation from objectui#6580. The per-file
 * figure reproduces in isolation (~8.3s), but the cost is a ONE-TIME
 * transform of the app-shell graph PER VITEST PROCESS, and ~67 of the console
 * project's 89 test files already load the real barrel -- so a realistic
 * shard has already paid it before the first converted file is transformed.
 * The bound is **at most +4% of one shard**, and only in the pathological case
 * where all 22 files land in one shard with no non-mocking console file beside
 * them. Confirmed green over three replicates at 22/22 files, 150/150 tests,
 * and the whole console project at 1069/1069.
 *
 * The neighbour reading found ZERO repairs owed. Across the 22 files the 28
 * workspace neighbours are ALL already inheriting (16 `@object-ui/auth`, 11
 * `@object-ui/i18n`, one `@object-ui/plugin-markdown`), and the only
 * third-party factory is `sonner` (7) -- so the frozen `lucide-react`
 * neighbour that killed 15 files in slice 6 cannot exist here. The remaining
 * 61 neighbours are local whole-module replacements, out of scope by
 * construction.
 *
 * ### Slices 15 + 16 -- `@object-ui/plugin-view` and `@object-ui/core`, folded
 *
 * The twentieth and twenty-first members, and the first two to join WITHOUT a
 * sweep: both already read all-inheriting when judged, so this slice edits no
 * test file at all. Re-derived on `d9788c141` by running this file's own
 * `scan()` with a local `covered` override -- ⛔ never from the worklist's
 * table, and never from slice 14's paragraph above, which recorded these same
 * two figures a day earlier and is exactly the reading the ruling says to
 * retake rather than inherit:
 *
 *     @object-ui/plugin-view   10 judged, 10 inheriting, 0 frozen
 *     @object-ui/core           2 judged,  2 inheriting, 0 frozen
 *
 * with the tree-wide census moving `648 judged / 648 inherit / 12 other
 * workspace` to `660 / 660 / 0`. Diffed PER SITE -- verdict AND reason string,
 * across all 1,785 call sites the walk reports: exactly 12 rows changed, every
 * one of them `workspace/unjudged -> covered/inherits`, and the other 1,773
 * byte-identical. So this landed as a RATCHET, the shape objectui#8141 and
 * objectui#8183 landed in, and the precondition below is met by MEASUREMENT
 * because there was nothing to convert.
 *
 * ⭐ **A membership flip owes no STEP 0 barrel walk, and that is a property of
 * the flip rather than an exemption.** Every previous slice measured its
 * barrel's module-scope effects because converting a frozen factory makes the
 * real barrel LOAD in each converted file. Nothing converts here: all twelve
 * factories already spread the real module, so both barrels already load in
 * exactly the files that load them today, and this diff cannot change what a
 * single test executes. What moves is the gate's judgement, nothing else.
 * ⛔ Do not read that as "flips are free" -- for a specifier that still carries
 * a frozen factory the sweep, and its STEP 0, are owed in the same PR.
 *
 * ⚠️ `@object-ui/components/ui/sonner` is the one named specifier this slice
 * deliberately did NOT add, and it is named here so the next reader refuses it
 * on purpose rather than rediscovering it. It is a SUBPATH of the member slice
 * 6 swept and has been judged by REACH since objectui#8141, so its 2 sites are
 * already inside the 648. The constant names package ROOTS only and the gate's
 * test pins that mechanically (`spec.split('/')` has length 2), so adding it
 * would turn a green pin red while changing no verdict at all.
 *
 * ### What is left -- nothing, and what that does NOT mean
 *
 * ⭐ **The worklist is CLOSED.** With these two members added, every
 * `@object-ui/*` specifier that any `vi.mock` or `vi.doMock` call site in this
 * tree names is judged -- 22 distinct specifiers: 21 package roots, all
 * members, plus one subpath covered by reach. The gate reads **660 judged, 660
 * inherit, 0 frozen**, and `other workspace` reads **0**. That last figure is
 * the one to watch, because it is the count of workspace call sites the gate
 * declines to judge: the verdict line's claim and the population it was
 * computed over are now the same set.
 *
 * ⛔ **That is a statement about today's tree, not a guarantee about
 * tomorrow's.** Three things it does NOT promise, each of them measured
 * somewhere on this worklist rather than argued:
 *
 *   - **`other workspace` does not stay 0 by itself.** A new package, or the
 *     first `vi.mock` naming an existing one no test named before, lands as an
 *     UNJUDGED site -- counted, never judged, verdict line still green. Slice 2
 *     met exactly that: `@object-ui/plugin-charts` had no call site at all when
 *     the worklist's table was taken, and the population GREW three consecutive
 *     slices in a row while the worklist was being worked.
 *   - **A member reading zero today can carry a frozen factory tomorrow.**
 *     Membership is what makes the gate RED when that happens -- that is the
 *     whole value of the flip. It buys nothing retroactively.
 *   - **Zero frozen is not zero risk.** This gate judges the FACTORY's shape on
 *     a covered specifier. A converted file can still die at COLLECTION for the
 *     neighbouring reason slice 6 measured 15 times: a frozen THIRD-PARTY
 *     factory (`lucide-react`), which this gate never judges by construction.
 *
 * ⇒ So the standing job after closure has exactly one shape: **a non-zero
 * `other workspace` in the verdict line means a specifier is being mocked that
 * nobody has swept.** Re-derive it with `scan()`, sweep it if it carries a
 * frozen factory, and add it -- never floor it, never exempt it.
 *
 * **The precondition for widening is a sweep, not a judgement.** Convert a
 * specifier's frozen factories to the inheriting form, confirm this gate reads
 * zero for it, then add it to `COVERED_SPECIFIERS` in the same PR. The list only
 * ever grows. objectui#6892 carries the per-specifier worklist, and slices 15 +
 * 16 close it. A specifier that ALREADY reads zero has an empty conversion set,
 * so the confirmation -- a fresh `scan()` over the tree that ships, taken with a
 * local `covered` override rather than by widening the constant first -- is then
 * the whole of the evidence; it is not a lighter bar, it is the same bar with
 * nothing to convert underneath it.
 *
 * ## A member covers its SUBPATHS (objectui#8141)
 *
 * The resolver decided scope by EXACT string equality against
 * `COVERED_SPECIFIERS` until objectui#8141, so `@object-ui/components/ui/sonner`
 * -- a subpath of the member slice 6 swept -- fell into the "other workspace"
 * bucket: counted, never judged, while the verdict line above it named the
 * package as covered. A gate that reports a verdict broader than what it
 * checked hides the absence behind a green, and the defect it hides is the one
 * this whole file exists to catch: the failure mechanism does not care whether
 * the frozen stand-in stood in for a package root or for one of its subpaths.
 * A subpath's export surface GROWS exactly the way the root's does.
 *
 * ⭐ That was not an exemption and not a recogniser bug -- the resolver did
 * exactly what it said. It was a scope boundary drawn when the covered set had
 * ONE member and no call site named a subpath.
 *
 * A member therefore covers `member` and `member/...`, and the separator is
 * part of the prefix, so a sibling package whose NAME merely starts with a
 * member's (`@object-ui/react-native`) is a different package and stays out.
 * The constant keeps naming package ROOTS only, so "a member joins only by
 * sweep" is unchanged: what widened is the reach of one membership, not the
 * test for membership.
 *
 * ⚠️ Widening the resolver newly JUDGES sites nobody swept, so it carries the
 * same precondition a new member does. Re-measured on `b38014e82` against
 * today's EIGHTEEN members by running this file's own `scan()` -- ⛔ never from
 * objectui#8141's own table, which was taken on `214d5d5a6` when the constant
 * held eleven:
 *
 *     subpath call sites on a covered member  ->  2, both
 *       `@object-ui/components/ui/sonner`, both in `packages/plugin-form`
 *     the same 2, once the prefix match lands  ->  2 inherit, 0 frozen
 *
 * with the census moving 623 -> 625 judged and 37 -> 35 other-workspace, no
 * site moving the other way and every other row byte-identical between the two
 * runs. Zero frozen before and after, so this landed as a RATCHET -- the same
 * "the tree is at zero" argument that scoped objectui#6849 -- and no sweep was
 * owed. ⛔ A later re-measure that DOES turn up a frozen subpath factory sweeps
 * it in the same PR: never a floor, never a per-site allowance.
 *
 * ⛔ There is deliberately NO per-file exception list, and adding one is the
 * wrong repair. An exemption means the recogniser called correct code broken;
 * fix the recogniser, or the specifier does not belong in the covered set yet.
 *
 * ## The operand must BE the module, not merely MENTION it (objectui#8183)
 *
 * The spread recogniser asked whether the obtained token appeared ANYWHERE in
 * the spread's text until objectui#8183, so a spread of an object literal that
 * merely NESTS the obtained module satisfied it -- and the gate quoted the
 * evasion back in its own reason line:
 *
 *     ...({ _: await importOriginal() })      read as `inherits`
 *
 * That object has exactly ONE key -- `_`, holding the module -- so the returned
 * mock carries one inherited name, and the next export any module in the file's
 * import graph reads AT MODULE SCOPE still resolves to `undefined`. It is the
 * failure this whole file exists to stop, wearing the accepted spelling's
 * clothes.
 *
 * The property is therefore the OPERAND, never a mention: the spread's operand
 * has to DENOTE the obtained module. `operandDenotes` reads it as ONE whole
 * expression through a deliberately small grammar, and the invariant every
 * production preserves is that the operand's KEY SET is the real module's, so
 * it still GROWS when the real module grows:
 *
 *   - `await`, parentheses, `as`/`satisfies` and `!` are transparent;
 *   - calling the obtainer produces the module (`importOriginal()`,
 *     `importOriginal<T>()`, `(orig as any)()`); the bare name does not;
 *   - a property read keeps a key set the module owns
 *     (`(await importOriginal()).default`, the CJS interop shape);
 *   - `OBTAIN_TOKEN` already STANDS FOR a completed `vi.importActual(...)`.
 *
 * ⚠️ An object literal is refused even when its own contents would inherit
 * (`...{ ...actual }`). Deliberate rather than an oversight: the nesting IS the
 * evasion shape, the one nesting that would be correct spells the same thing as
 * `...actual`, and no call site in this tree writes either. Pinned as such.
 *
 * ⛔ Tightening this recogniser carries the same precondition widening the
 * covered set does, for the mirrored reason: a FALSE REFUSAL reds correct code,
 * and that is how a gate gets deleted rather than fixed (see "The recogniser is
 * SEMANTIC" above -- this one has been wrong in BOTH directions). Re-measured
 * on `47053c9f6` by running this file's own `scan()` before and after and
 * diffing PER SITE, verdict AND reason string:
 *
 *     625 judged, 625 inherit, 0 frozen   before
 *     625 judged, 625 inherit, 0 frozen   after -- all 625 rows byte-identical
 *
 * so this landed as a RATCHET and no sweep was owed. The nine distinct operand
 * shapes the tree actually writes -- `(await importOriginal<T>())` (367),
 * `actual` (169), `(await importOriginal<typeof import(...)>())` (55), `mod`
 * (22), `(await importActual<typeof import(...)>())` (6), `real` (2),
 * `(await importOriginal())` (2), `(await importActual<any>())` (1) and
 * `((await importOriginal<any>()) as Record<string, unknown>)` (1) -- are each
 * pinned in this gate's test as its own case.
 *
 * ## Green at rest, and what follows from that
 *
 * Once the one site above is converted this gate reads zero, and on any
 * ordinary day its output is indistinguishable from a gate that matches
 * nothing -- which is the defect it exists to catch, one level up. Three
 * consequences, all load-bearing:
 *
 *   1. **The population must refuse to collapse.** A walk that finds no source
 *      files, no test files, or no covered call sites is a broken walk, not a
 *      clean tree. `FLOORS` turns each into a failure. Same discipline as
 *      `check-vi-mock-specifiers.mjs` and objectui#6195.
 *   2. **The verdict line carries the census**, so a reader sees the population
 *      the green was computed over.
 *   3. **A factory the gate cannot READ is a failure, never a pass.** An
 *      unbalanced argument list (`unreadable`) or a factory passed as some
 *      other expression (`indirect` -- a helper call, a shared constant) is
 *      reported and fails. Both are zero on this tree; letting either through
 *      silently would leave the obvious way to evade the gate wide open.
 *
 * `scripts/__tests__/check-vi-mock-inherit.test.ts` carries the ablation --
 * every already-correct spelling as a negative control, and a deliberately
 * hand-listed factory as the positive one -- because on a swept tree the run
 * itself proves nothing.
 *
 * ## Only text the language would EXECUTE is judged
 *
 * Comments are blanked and a call whose `vi` token sits inside a string is
 * classified `embedded` and counted, never judged -- both through one pass of
 * the shared `js-comment-mask.mjs`, exactly as the sibling gate does it, and
 * for the same reasons (this file's own header quotes the defect in prose).
 *
 * ## `js-comment-mask` USED to read a JSX closing tag as a regex literal
 *
 * Kept as measured history: it is why the shared module was fixed, and the two
 * behavioural cases in this gate's test still pin the outcome.
 *
 * The shared masker decided a `/` opens a regex when the preceding character is
 * not a value. In `</div>` the preceding character is `<`, so it opened a
 * PHANTOM regex that ran to the end of the line and swallowed whatever was
 * there -- including the `)` that closes a `vi.mock` call.
 *
 * That was not hypothetical here: measured on this tree at the time, SEVEN
 * `vi.mock` call sites in five files could not have their argument list
 * delimited at all because of it, one of them a covered `@object-ui/react` site
 * (`plugin-dashboard/src/__tests__/ObjectDataTable.cells.test.tsx`). The sibling
 * gate never noticed because it only reads the specifier; this gate reads the
 * factory BODY, so it could not.
 *
 * This gate carried a LOCAL workaround for it -- `deJsxClosingTags`, a
 * length-preserving rewrite of every closing tag applied before masking. The
 * shared masker itself was then fixed by objectui#6891 (CLOSED, PR #7880),
 * which taught `scanSource` that a `/` whose immediately preceding byte is `<`
 * opens nothing. Re-measured on the fixed masker, the raw source with the
 * rewrite NOT applied has ZERO undelimitable sites and the gate's verdict is
 * byte-identical either way, so the workaround was retired by objectui#7883.
 * ⛔ That is not "the masker is correct on JSX": objectui#6891 closed only the
 * `<` `/` half. A `/` after `}` or `>` -- a self-closing tag, a `/` in JSX text
 * -- still opens a phantom; that half is objectui#7882 and is still open. The
 * retired rewrite never covered it either (its pattern matched closing tags
 * only), which is why removing it lost no coverage.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';
import { blank, scanSource } from './js-comment-mask.mjs';

/**
 * The workspace packages this gate judges. GROW-ONLY, and a specifier joins it
 * only after its frozen factories have been swept to zero -- see "Scope" above.
 */
export const COVERED_SPECIFIERS = Object.freeze([
  '@object-ui/react',
  '@object-ui/i18n',
  '@object-ui/plugin-markdown',
  '@object-ui/data-objectstack',
  '@object-ui/plugin-report',
  '@object-ui/plugin-charts',
  '@object-ui/plugin-dashboard',
  '@object-ui/auth',
  '@object-ui/collaboration',
  '@object-ui/plugin-form',
  '@object-ui/components',
  '@object-ui/plugin-grid',
  '@object-ui/permissions',
  '@object-ui/plugin-detail',
  '@object-ui/plugin-chatbot',
  '@object-ui/plugin-designer',
  '@object-ui/plugin-list',
  '@object-ui/fields',
  '@object-ui/app-shell',
  '@object-ui/plugin-view',
  '@object-ui/core',
]);

/** Files the walk reads at all. */
const SOURCE_FILE_RE = /\.[cm]?[jt]sx?$/;

/** The test-file naming convention, for the census figure and its floor. */
const TEST_FILE_RE = /(\.(test|spec)\.[cm]?[jt]sx?$)|((^|\/)__tests__\/)/;

/** Belt-and-braces: git ignores these already, so nothing matches today. */
const EXCLUDED = /(^|\/)(node_modules|dist|build|\.next|\.turbo|\.wt-[^/]*)\//;

/**
 * A mock call followed by its opening quote, with an optional `import(` between
 * the two. Deliberately the same pattern as `check-vi-mock-specifiers.mjs`:
 * the two gates judge different properties of the SAME population, and a
 * population that drifts between them is a hole neither one reports.
 */
export const CALL_RE = /\bvi\s*\.\s*(mock|doMock)\s*\(\s*(import\s*\(\s*)?(['"`])([^'"`\n]*)\3/g;

/**
 * Floors below which a green verdict is a claim about coverage rather than a
 * statement about the tree. Set with room -- the point is to catch a walk that
 * COLLAPSED, not to pin today's exact numbers, which move every day.
 */
export const FLOORS = Object.freeze({
  sources: 1000,
  testFiles: 1000,
  covered: 50,
});

/** 1-based line number of `offset` in `source`. */
function lineOf(source, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) if (source[i] === '\n') line++;
  return line;
}

/**
 * Index of the `)` closing the `(` at `open`, ignoring anything inside a
 * literal, or -1 when the source does not balance.
 */
function matchingParen(masked, literal, open) {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    if (literal[i]) continue;
    if (masked[i] === '(') depth++;
    else if (masked[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** `[start, end)` spans of the top-level arguments between `open` and `close`. */
function argumentSpans(masked, literal, open, close) {
  const spans = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < close; i++) {
    if (literal[i]) continue;
    const c = masked[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      spans.push([start, i]);
      start = i + 1;
    }
  }
  spans.push([start, close]);
  return spans;
}

/** Whole-word reference test, so `actual` does not match `actualThing`. */
function referencesName(text, name) {
  return new RegExp(`(?<![\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(text);
}

/** The index of the bracket closing the one at `open`, or -1. Plain text only. */
function closingIndex(text, open) {
  const pairs = { '(': ')', '[': ']', '{': '}', '<': '>' };
  const close = pairs[text[open]];
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === text[open]) depth++;
    else if (c === close && --depth === 0) return i;
  }
  return -1;
}

/** The index of the bracket opening the one at `close`, or -1. Plain text only. */
function openingIndex(text, close) {
  const pairs = { ')': '(', ']': '[', '}': '{', '>': '<' };
  const open = pairs[text[close]];
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    const c = text[i];
    if (c === text[close]) depth++;
    else if (c === open && --depth === 0) return i;
  }
  return -1;
}

/** `f<Record<string, unknown>>` -> `f`. The list NESTS, so balance it. */
function stripTypeArguments(text) {
  const s = text.trimEnd();
  if (!s.endsWith('>')) return text;
  const open = openingIndex(s, s.length - 1);
  return open < 0 ? text : s.slice(0, open);
}

/** `X as T` / `X satisfies T` at bracket depth 0 -> `X`, else `null`. */
function beforeTypeAssertion(text) {
  const re = /(?<![\w$])(?:as|satisfies)(?![\w$])/g;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[' || c === '{' || c === '<') depth++;
    else if (c === ')' || c === ']' || c === '}' || c === '>') depth--;
    else if (depth === 0) {
      re.lastIndex = i;
      const m = re.exec(text);
      if (m && m.index === i) return text.slice(0, i);
    }
  }
  return null;
}

/** `X.name` / `X?.name` at bracket depth 0 -> `X`, else `null`. */
function beforeMemberAccess(text) {
  const tail = /(\??\.)\s*[A-Za-z_$][\w$]*\s*$/.exec(text);
  if (!tail) return null;
  const at = tail.index;
  let depth = 0;
  for (let i = 0; i < at; i++) {
    const c = text[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
  }
  return depth === 0 && at > 0 ? text.slice(0, at) : null;
}

/**
 * What does `expr` -- the WHOLE operand of a spread, or the WHOLE initialiser
 * of a binding -- denote?
 *
 *   `'module'`   the real module obtained through `token`
 *   `'obtainer'` the callback that would RETURN it, not the module itself
 *   `null`       anything else
 *
 * The grammar is deliberately small, and every production preserves the one
 * property that makes a spread inherit: the operand's KEY SET is the real
 * module's, so it grows when the real module grows. `await`, parentheses, a
 * type assertion and a non-null assertion are all transparent; a call of the
 * obtainer produces the module; a property read off the module keeps a key set
 * the module still owns (`(await importOriginal()).default` -- the interop
 * shape). Nothing else qualifies, and the exclusion that matters is the object
 * literal: `{ _: await importOriginal() }` has the key set the AUTHOR typed
 * (`_`), so spreading it inherits exactly one key and freezes the surface at
 * that -- see "The operand must BE the module" in the header.
 */
function operandDenotes(expr, token, tokenIsValue) {
  const s = expr.trim();
  if (s === '') return null;

  const awaited = /^await(?![\w$])/.exec(s);
  if (awaited) return operandDenotes(s.slice(awaited[0].length), token, tokenIsValue);

  if (s[0] === '(' && closingIndex(s, 0) === s.length - 1) {
    return operandDenotes(s.slice(1, -1), token, tokenIsValue);
  }

  if (s.endsWith('!')) return operandDenotes(s.slice(0, -1), token, tokenIsValue);

  if (s.endsWith(')')) {
    const open = openingIndex(s, s.length - 1);
    if (open > 0) {
      const callee = stripTypeArguments(s.slice(0, open));
      // Only calling the OBTAINER yields the module; calling the module does not.
      return operandDenotes(callee, token, tokenIsValue) === 'obtainer' ? 'module' : null;
    }
    return null;
  }

  const asserted = beforeTypeAssertion(s);
  if (asserted !== null) return operandDenotes(asserted, token, tokenIsValue);

  const receiver = beforeMemberAccess(s);
  if (receiver !== null) {
    return operandDenotes(receiver, token, tokenIsValue) === 'module' ? 'module' : null;
  }

  if (!new RegExp(`^${token.replace(/\$/g, '\\$')}$`).test(s)) return null;
  // A callback parameter is a FUNCTION until it is called; `OBTAIN_TOKEN`
  // already STANDS FOR a completed `vi.importActual(<specifier>)` call, and a
  // binding was resolved to the module before it entered `inherited`.
  return tokenIsValue || token === OBTAIN_TOKEN ? 'module' : 'obtainer';
}

/**
 * Is `text` -- read as ONE whole expression -- the real module obtained
 * through `token`?
 *
 * ⛔ NOT "does `text` mention `token`". That was the recogniser until
 * objectui#8183, and it judged the wrong thing: a spread of an object literal
 * that merely NESTS the obtained module (`...({ _: await importOriginal() })`)
 * satisfied it, so the gate read `inherits` and quoted the evasion back in its
 * own reason line. See "The operand must BE the module" in the header.
 *
 * For a callback parameter the reference is not enough either -- the parameter
 * is a FUNCTION, and `...importOriginal` spreads the function rather than the
 * module it would have returned. That is a frozen factory wearing an
 * inheriting one's clothes, so the call is required: `importOriginal()`,
 * `importOriginal<T>()` and `(orig as any)()` all qualify, the bare name does
 * not.
 */
function holdsObtainedModule(text, token, tokenIsValue = false) {
  if (!referencesName(text, token)) return false;
  return operandDenotes(text, token, tokenIsValue) === 'module';
}

/**
 * The initialiser of a `const`/`let`/`var` starting at `from` (the index just
 * past its `=`), up to the `;` that ends the statement at bracket depth 0.
 *
 * Not a line-bounded slice: a generic argument list wrapped across lines
 * (`await importOriginal<\n  Record<string, unknown>\n>()`) would otherwise be
 * cut before its call parentheses and read as a binding that never calls
 * anything -- a fabricated finding on correct code.
 */
function readInitialiser(body, from) {
  let depth = 0;
  for (let i = from; i < body.length; i++) {
    const c = body[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return body.slice(from, i);
      depth--;
    } else if (c === ';' && depth === 0) return body.slice(from, i);
  }
  return body.slice(from);
}

/** The synthetic stand-in for `vi.importActual(<the covered specifier>)`. */
const OBTAIN_TOKEN = '__OBTAINED_ORIGINAL__';

/**
 * Every `vi.importActual(<specifier>)` in `text`, as `[start, end)` spans.
 *
 * Deliberately NOT one regular expression. The optional generic argument
 * NESTS -- `vi.importActual<Record<string, unknown>>('@object-ui/i18n')` is
 * the spelling four factories in this tree write -- and the `<[^>]*>` this
 * replaces stopped at the FIRST `>`: it consumed `<Record<string, unknown>`
 * and then failed against the `>` that follows, so the whole call went
 * unrecognised and the factory was reported as one that "never obtains the
 * real module" -- on code that obtains it and spreads it.
 *
 * That is the failure this gate's header rules out by name: a recogniser that
 * calls correct code broken gets the gate deleted rather than fixed. Measured
 * on this tree at the time of the fix, with `@object-ui/i18n` as the covered
 * specifier, 35 frozen became 31, and each of the four that moved spreads a
 * binding initialised from this call (objectui#7337). Nothing moves the other
 * way: this only ever ADDS a way to recognise the obtain, so no site that read
 * `inherits` can start reading `frozen`.
 *
 * Angle brackets are scanned BALANCED. Anything that does not parse as the
 * exact call shape is skipped, so the worst case for an unforeseen spelling is
 * the verdict the regex already gave.
 */
export function importActualSpans(text, specifier) {
  const spans = [];
  const head = /\bvi\s*\.\s*importActual\s*/g;
  let m;
  while ((m = head.exec(text)) !== null) {
    let i = m.index + m[0].length;
    if (text[i] === '<') {
      let depth = 0;
      for (; i < text.length; i++) {
        if (text[i] === '<') depth++;
        else if (text[i] === '>' && --depth === 0) {
          i++;
          break;
        }
      }
      if (depth !== 0) continue; // unbalanced -- not a call this gate can read
      while (/\s/.test(text[i] ?? '')) i++;
    }
    if (text[i] !== '(') continue;
    i++;
    while (/\s/.test(text[i] ?? '')) i++;
    const quote = text[i];
    if (quote !== "'" && quote !== '"' && quote !== '`') continue;
    if (text.slice(i + 1, i + 1 + specifier.length) !== specifier) continue;
    let j = i + 1 + specifier.length;
    if (text[j] !== quote) continue;
    j++;
    while (/\s/.test(text[j] ?? '')) j++;
    if (text[j] !== ')') continue;
    spans.push([m.index, j + 1]);
    head.lastIndex = j + 1;
  }
  return spans;
}

/**
 * Read the head of a factory argument: its parameter names, and where its body
 * starts. Returns `null` when the argument is not a function literal at all.
 */
function readFactoryHead(masked, literal, start, end) {
  const text = masked.slice(start, end);
  const lead = text.length - text.replace(/^\s+/, '').length;
  const head = text.slice(lead);
  const at = start + lead;

  if (head === '') return null; // no factory argument

  const single = head.match(/^(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/);
  if (single) return { params: [single[1]], bodyStart: at + single[0].length };

  const parenthesised = /^(?:async\s+)?\(/.test(head);
  const keyword = /^(?:async\s+)?function\b/.test(head);
  if (!parenthesised && !keyword) return null; // a helper call, a constant, ...

  const open = masked.indexOf('(', at);
  if (open < 0 || open >= end) return null;
  const close = matchingParen(masked, literal, open);
  if (close < 0 || close > end) return null;

  const params = masked
    .slice(open + 1, close)
    .split(',')
    .map((p) => (p.match(/^\s*([A-Za-z_$][\w$]*)/) || [, null])[1])
    .filter(Boolean);
  return { params, bodyStart: close + 1 };
}

/**
 * Does the factory spanning `[start, end)` inherit the real export surface of
 * `specifier`?
 *
 * @returns {{ verdict: 'inherits'|'frozen'|'automock'|'indirect', obtained: string[], spreads: string[], reason?: string }}
 */
export function classifyFactory(masked, literal, start, end, specifier) {
  if (masked.slice(start, end).trim() === '') {
    // `vi.mock(spec)` with no factory: vitest AUTO-mocks the real module, so
    // the export surface is inherited by construction. Nothing to judge.
    return { verdict: 'automock', obtained: [], spreads: [] };
  }
  const head = readFactoryHead(masked, literal, start, end);
  if (!head) return { verdict: 'indirect', obtained: [], spreads: [] };

  // The body, with comments already blanked by the caller. Two more passes:
  // first swap in the obtain token for `vi.importActual(<this specifier>)`,
  // then blank literal content -- in that order, because the specifier the
  // first pass matches on IS literal content.
  const bodyStart = head.bodyStart;

  let body = '';
  for (let i = bodyStart; i < end; i++) body += literal[i] ? ' ' : masked[i];
  // ...but the importActual specifier has to survive the blanking to be
  // matched, so run that pass over the un-blanked body and pad to length.
  const rawBody = masked.slice(bodyStart, end);
  let m;
  // A call whose own `vi` token sits inside a string literal is prose, not code.
  const marks = importActualSpans(rawBody, specifier).filter(([from]) => !literal[bodyStart + from]);
  const obtainedViaImportActual = marks.length > 0;
  for (const [from, to] of marks) {
    body = body.slice(0, from) + OBTAIN_TOKEN.padEnd(to - from, ' ') + body.slice(to);
  }

  const obtained = [...head.params];
  if (obtainedViaImportActual) obtained.push(OBTAIN_TOKEN);
  if (obtained.length === 0) {
    return { verdict: 'frozen', obtained, spreads: [], reason: 'the factory never obtains the real module' };
  }

  // Bindings, so `const actual = await importOriginal(); ... ...actual` counts.
  // A destructuring pattern is deliberately not a binding here: picking names
  // out of the real module is not inheriting its surface.
  const inherited = new Set(obtained);
  const bindings = [];
  const bindRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]*)?=\s*/g;
  while ((m = bindRe.exec(body)) !== null) {
    bindings.push({ name: m[1], init: readInitialiser(body, m.index + m[0].length) });
  }
  for (let pass = 0; pass < bindings.length + 1; pass++) {
    let grew = false;
    for (const b of bindings) {
      if (inherited.has(b.name)) continue;
      if ([...inherited].some((t) => holdsObtainedModule(b.init, t, !obtained.includes(t)))) {
        inherited.add(b.name);
        grew = true;
      }
    }
    if (!grew) break;
  }

  // Every spread in the factory body, with the expression it spreads.
  const spreads = [];
  for (let i = 0; i + 2 < body.length; i++) {
    if (body[i] !== '.' || body[i + 1] !== '.' || body[i + 2] !== '.') continue;
    let depth = 0;
    let j = i + 3;
    for (; j < body.length; j++) {
      const c = body[j];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') {
        if (depth === 0) break;
        depth--;
      } else if (c === ',' && depth === 0) break;
    }
    spreads.push(body.slice(i + 3, j).trim());
    i = j - 1;
  }

  const inheriting = spreads.find((s) => [...inherited].some((t) => holdsObtainedModule(s, t, !obtained.includes(t))));
  if (inheriting) return { verdict: 'inherits', obtained, spreads, reason: `...${inheriting}` };
  return {
    verdict: 'frozen',
    obtained,
    spreads,
    reason:
      spreads.length === 0
        ? 'the factory obtains the real module but never spreads it'
        : 'the factory spreads something, but not the real module',
  };
}

/**
 * Every mock call site in one file, classified.
 *
 * `scope` is `covered` (judged -- a `COVERED_SPECIFIERS` member OR a subpath of
 * one), `workspace` (a workspace package that is neither), `external` (a
 * third-party package), `local` (a
 * relative specifier -- whole-module replacement, out of scope by the ruling),
 * `dynamic` (an interpolated specifier) or `embedded` (the call token sits
 * inside a string, so it is a code SAMPLE -- see `check-vi-mock-specifiers.mjs`
 * for the instance that made this distinction necessary).
 */
export function findCallSites(source, { covered = COVERED_SPECIFIERS } = {}) {
  const { comment, literal } = scanSource(source);
  const masked = blank(source, comment);
  const coveredSet = new Set(covered);
  // A member covers its own SUBPATHS too -- see "A member covers its subpaths"
  // in the header. The separator is part of the prefix, so a sibling package
  // whose NAME merely starts with a member's (`@object-ui/react-native`) is not
  // swallowed; only a subpath of the member itself (`@object-ui/react/x`) is.
  const coveredPrefixes = [...coveredSet].map((member) => `${member}/`);
  const isCovered = (spec) => coveredSet.has(spec) || coveredPrefixes.some((prefix) => spec.startsWith(prefix));

  const sites = [];
  CALL_RE.lastIndex = 0;
  let m;
  while ((m = CALL_RE.exec(masked)) !== null) {
    const specifier = m[4];
    const line = lineOf(masked, m.index);
    const viaImport = Boolean(m[2]);
    if (literal[m.index]) {
      sites.push({ fn: m[1], specifier, scope: 'embedded', verdict: 'unjudged', viaImport, line });
      continue;
    }
    const scope = specifier.includes('${')
      ? 'dynamic'
      : specifier === '.' || specifier === '..' || specifier.startsWith('./') || specifier.startsWith('../')
        ? 'local'
        : isCovered(specifier)
          ? 'covered'
          : specifier.startsWith('@object-ui/')
            ? 'workspace'
            : 'external';

    if (scope !== 'covered') {
      sites.push({ fn: m[1], specifier, scope, verdict: 'unjudged', viaImport, line });
      continue;
    }

    const open = masked.indexOf('(', m.index);
    const close = matchingParen(masked, literal, open);
    if (close < 0) {
      sites.push({ fn: m[1], specifier, scope, verdict: 'unreadable', viaImport, line, reason: 'the argument list does not balance' });
      continue;
    }
    const args = argumentSpans(masked, literal, open, close);
    const factory = args[1] ? [args[1][0], args[args.length - 1][1]] : [close, close];
    const judged = classifyFactory(masked, literal, factory[0], factory[1], specifier);
    sites.push({ fn: m[1], specifier, scope, viaImport, line, ...judged });
  }
  return sites;
}

/** The NUL that `git ls-files -z` delimits with, built from its code point. */
const NUL = String.fromCharCode(0);

function trackedFiles(root) {
  return execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  })
    .toString('utf8')
    .split(NUL)
    .filter(Boolean);
}

/**
 * The one scan. `main()`, `--list`, `--json` and the test suite all go through
 * here, so the tests exercise the real code path rather than an imitation.
 *
 * @param {string} root  Repository root to scan.
 * @param {{ files?: string[] | null, floors?: Record<string, number>, covered?: readonly string[] }} [options]
 *   `files` overrides the `git ls-files` walk (fixtures pass their own list);
 *   `floors` overrides `FLOORS` -- pass `{}` to switch the collapse check off
 *   for a fixture tree, which is legitimately far below every repo floor;
 *   `covered` overrides `COVERED_SPECIFIERS`, so a fixture can exercise the
 *   scope boundary without waiting for the real list to grow.
 */
export function scan(root, { files = null, floors = FLOORS, covered = COVERED_SPECIFIERS } = {}) {
  const tracked = files ?? trackedFiles(root);
  const sources = tracked.filter((f) => SOURCE_FILE_RE.test(f) && !EXCLUDED.test(f));
  const testFiles = sources.filter((f) => TEST_FILE_RE.test(f));

  const sites = [];
  const frozen = [];
  const unreadable = [];
  const counters = {
    covered: 0,
    workspace: 0,
    external: 0,
    local: 0,
    dynamic: 0,
    embedded: 0,
    inherits: 0,
    automock: 0,
    filesWithMocks: 0,
  };

  for (const file of sources) {
    let source;
    try {
      source = readFileSync(join(root, file), 'utf8');
    } catch {
      continue; // symlink, gitlink, unreadable -- nothing to judge
    }
    // Cheap pre-filter only. The pattern below is what actually decides.
    if (!source.includes('vi')) continue;
    const found = findCallSites(source, { covered });
    if (found.length === 0) continue;
    counters.filesWithMocks++;
    for (const site of found) {
      counters[site.scope]++;
      const record = { file, ...site };
      if (site.scope === 'covered') {
        if (site.verdict === 'inherits' || site.verdict === 'automock') counters[site.verdict]++;
        else if (site.verdict === 'unreadable' || site.verdict === 'indirect') unreadable.push(record);
        else frozen.push(record);
      }
      sites.push(record);
    }
  }

  const census = { tracked: tracked.length, sources: sources.length, testFiles: testFiles.length, ...counters };

  // The population, checked for collapse. See "Green at rest" in the header.
  const vacuous = [];
  for (const [counter, floor] of Object.entries(floors)) {
    if (census[counter] < floor) vacuous.push({ counter, value: census[counter], floor });
  }

  return { census, sites, frozen, unreadable, vacuous, covered: [...covered] };
}

function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

/** The census, as one line, for the verdict. */
export function summarise({ census, covered }) {
  return (
    `${census.sources} tracked source file(s), ${census.testFiles} test-named; ` +
    `${census.filesWithMocks} carry a mock; ` +
    `${census.covered} call site(s) on ${covered.join(', ')} and their subpaths judged ` +
    `(${census.inherits} inherit, ${census.automock} auto-mocked); ` +
    `${census.workspace} other workspace, ${census.external} external, ` +
    `${census.local} local, ${census.dynamic} non-static, ` +
    `${census.embedded} embedded in a string literal -- all out of scope`
  );
}

function main() {
  const result = scan(repoRoot());
  const { frozen, unreadable, vacuous } = result;

  if (frozen.length === 0 && unreadable.length === 0 && vacuous.length === 0) {
    console.log(`✅  check-vi-mock-inherit: OK (${summarise(result)}).`);
    process.exit(0);
  }

  if (frozen.length > 0) {
    const plural = frozen.length === 1 ? 'factory freezes' : 'factories freeze';
    console.error(`❌  check-vi-mock-inherit: ${frozen.length} ${plural} the mock export surface\n`);
    console.error('  A hand-listed factory pins the mock to the exports written that day. The');
    console.error('  next export any module in the file\'s import graph reads AT MODULE SCOPE');
    console.error('  then kills the file during COLLECTION -- the tests never run, so the suite');
    console.error('  reports ZERO failed assertions and reads like flake (objectui#6768):\n');
    for (const f of frozen) {
      console.error(`    - ${f.file}:${f.line} -- vi.${f.fn}(${JSON.stringify(f.specifier)})`);
      console.error(`      ${f.reason}`);
    }
    console.error(`
Inherit the real surface instead. Any of these spellings passes -- the gate reads
what the code DOES, not what the parameter is called:

    vi.mock('@object-ui/react', async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      SchemaRenderer: Stub,
    }));

    vi.mock('@object-ui/react', async () => {
      const actual = await vi.importActual('@object-ui/react');
      return { ...actual, SchemaRenderer: Stub };
    });

Obtaining without SPREADING is still frozen: a factory that awaits the real
module and then returns a hand-written object inherits nothing.

Only ${result.covered.join(', ')} is judged. Relative specifiers (whole-module
replacement), third-party packages and other workspace packages are counted and
never judged -- see the header for the ruling and the widening precondition.`);
  }

  if (unreadable.length > 0) {
    console.error(`\n❌  check-vi-mock-inherit: ${unreadable.length} covered factory/factories could not be READ\n`);
    console.error('  A factory this gate cannot parse is not a pass -- reporting OK for one is');
    console.error('  how the check gets evaded without anybody deciding to evade it:\n');
    for (const u of unreadable) {
      console.error(`    - ${u.file}:${u.line} -- vi.${u.fn}(${JSON.stringify(u.specifier)})`);
      console.error(
        `      ${u.verdict === 'indirect' ? 'the factory is not written inline (a helper call, a shared constant)' : u.reason}`,
      );
    }
    console.error(`
Write the factory inline in the \`vi.mock\` call so its shape is reviewable at the
call site. If it IS inline and the gate still cannot read it, the parse is the
bug -- fix it here rather than working around it in the test.`);
  }

  if (vacuous.length > 0) {
    console.error('\n❌  check-vi-mock-inherit: the population COLLAPSED -- this run proves nothing\n');
    for (const v of vacuous) {
      console.error(`    - ${v.counter}: found ${v.value}, floor is ${v.floor}`);
    }
    console.error(`
A scan that finds nothing reports OK, and reads as coverage. That is the exact
defect this gate exists to catch, one level up, so it is a FAILURE here instead.

Something upstream of the judgement broke: \`git ls-files\` returned little or
nothing, a filter inverted, the pattern stopped matching, or a specifier in
\`COVERED_SPECIFIERS\` was renamed and now matches no call site at all. Fix the
walk. If a floor is genuinely too high because the tree changed shape, move it in
\`FLOORS\` deliberately and say why -- never to make a red run green.

Census: ${summarise(result)}`);
  }

  process.exit(1);
}

// Run only when invoked directly -- the test suite imports `scan` and friends
// and must not trigger a repo scan (or a `process.exit`) on import.
if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--json')) {
    const result = scan(repoRoot());
    console.log(
      JSON.stringify(
        { census: result.census, covered: result.covered, frozen: result.frozen, unreadable: result.unreadable, vacuous: result.vacuous },
        null,
        2,
      ),
    );
  } else if (process.argv.includes('--list')) {
    const result = scan(repoRoot());
    for (const s of result.sites) {
      const mark = s.scope === 'covered' ? String(s.verdict).toUpperCase().padEnd(10) : s.scope.padEnd(10);
      console.log(`${mark}  ${s.file}:${s.line}  vi.${s.fn}(${JSON.stringify(s.specifier)})`);
    }
    console.log(`\n${summarise(result)}`);
  } else {
    main();
  }
}
