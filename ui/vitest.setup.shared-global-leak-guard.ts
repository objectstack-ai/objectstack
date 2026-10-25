/**
 * ObjectUI — shared-global leak guard for `isolate: false` projects (objectui#8500)
 *
 * ## The invariant, and why it needed a gate rather than a comment
 *
 * The `unit` project runs `isolate: false`: one module graph and one global
 * object per worker, for the 3.2x it buys. `vitest.config.mts` already writes
 * out the FIRST invariant that pays for it — a `ComponentRegistry` key one file
 * asserts absent must be registered by no other file — and hands enforcement to
 * `scripts/__tests__/unit-registry-absence-collision.test.ts` rather than
 * leaving it as prose, because the prose had already gone false unnoticed.
 *
 * `globalThis` is the SECOND invariant, in the same class, and it had no gate:
 *
 *     a global the setup files install must be the same value at the END of a
 *     file as it was at the START of it.
 *
 * A breach fails exactly the way a registry collision does — ORDER dependent, in
 * a file that did nothing wrong, saying nothing about the code under test.
 * Measured on `c30026715`, a clean `main`: four files replaced `globalThis.fetch`
 * with a bare `vi.fn()` by assignment and never handed it back, so
 * `scripts/__tests__/network-escape-ledger.test.ts` read `Mock` where the
 * network-escape guard's `guardedFetch` wrapper should have been and went red on
 * a full `--project unit` run. The wrapper is a SAFETY guard: while a mock sits
 * on top of it, nobody can read the true state of network escapes off that test
 * either, which is why the leak is worse than the red it causes.
 *
 * ## Why an `afterAll` in a SETUP FILE, and not in the guard it protects
 *
 * Both halves of that sentence are measured, not stylistic.
 *
 * A hook must be registered from a file Vitest re-executes per test file, and
 * under `isolate: false` an ordinary imported module is NOT one. Vitest re-runs
 * `setupFiles` for every test file even with the module graph shared, but a
 * module those setup files IMPORT is evaluated once per worker — so hooks
 * registered in its body attach to the first test file of the worker and to no
 * other. (Measured: a probe module imported by a setup file logged its body once
 * and its `afterEach` fired for file 1 only, while the setup file's own body and
 * hooks ran for both.) That is why this file is wired into
 * `vitest.config.mts`'s `setupFiles` in its own right instead of being folded
 * into `vitest.setup.base.ts`'s import list.
 *
 * `afterAll`, not `afterEach`, because the invariant is about what crosses a
 * FILE boundary. The network-escape guard's own `Fix:` text prescribes leaving a
 * module-scope double up for a whole file when the component under test can read
 * after the test body returns; an `afterEach` here would red exactly that
 * prescribed shape. What it may not do is outlive the file, and `afterAll` is
 * where that becomes checkable.
 *
 * ## It heals as well as reports
 *
 * The leaked value is put back BEFORE the throw. Reporting alone would leave the
 * worker poisoned and hand the next files a cascade of failures that name the
 * wrong file — which is the very shape this guard exists to end. So the file
 * that leaked is the only one that goes red.
 *
 * ## Scope: only projects that share a global object
 *
 * `dom` / `dom-heavy` / `dist` keep `isolate: true`; there each file gets its own
 * global object, nothing crosses, and the module-scope-double shape above is
 * simply correct. Wiring this guard into them would fail correct tests. The
 * wiring — every `isolate: false` project in `vitest.config.mts` lists this file
 * LAST in its `setupFiles` — is pinned by
 * `scripts/__tests__/shared-global-leak-guard.test.ts`, which also drives the
 * detector over a synthetic scope.
 *
 * ## Why the detector lives next door
 *
 * The watch list and the comparison are in `vitest.setup.shared-global-leak.ts`,
 * which registers nothing when it is imported. This file is the only place that
 * CALLS `installSharedGlobalLeakGuard()`, so it is the only place a hook is
 * registered — and that is what keeps the logic importable by the one gate that
 * has to reuse it without arming a second copy. That file's header carries the
 * reason in full.
 */
import { installSharedGlobalLeakGuard } from './vitest.setup.shared-global-leak';

installSharedGlobalLeakGuard();
