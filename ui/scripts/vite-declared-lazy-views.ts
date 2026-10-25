import fs from 'node:fs';
import path from 'node:path';
// Hook parameters are annotated explicitly throughout: Vite types each hook as
// `ObjectHook<Fn>` (a function-or-object union), and TypeScript cannot
// contextually infer parameters across such a union — same reason
// `scripts/vite-ineffective-dynamic-imports.ts` spells its types out.
import type { Plugin, Rollup } from 'vite';

/**
 * Keeps `AppContent`'s `lazy()` view declarations and the console's EAGER
 * CLOSURE in agreement — by making the laziness real where it can be, and by
 * failing the build when the two drift apart (objectui#6535).
 *
 * ## The measurement this exists for
 *
 * `packages/app-shell/src/console/AppContent.tsx` declares eight route views
 * with `lazy(() => import('../views/<View>.js'))`. Measured on `ece68882` from
 * `apps/console/dist/eager-closure.json` (`files[]` IS the eager set) and
 * cross-checked by an independent BFS over the emitted chunks' static imports,
 * SIX of those eight were in the eager closure anyway:
 *
 * | declared `lazy()`   | eager before | eager after | why it was eager        |
 * |---------------------|--------------|-------------|-------------------------|
 * | `DashboardView`     | yes          | NO          | barrel re-export ONLY   |
 * | `PageView`          | yes          | NO          | barrel re-export ONLY   |
 * | `SearchResultsPage` | yes          | NO          | barrel re-export ONLY   |
 * | `RecordDetailView`  | yes          | yes         | real static edge        |
 * | `RecordFormPage`    | yes          | yes         | chunk co-tenancy        |
 * | `ReportView`        | yes          | yes         | chunk co-tenancy        |
 * | `ComponentNavView`  | no           | no          | never re-exported       |
 * | `ObjectDataPage`    | no           | no          | never re-exported       |
 *
 * The count of six is right and its MECHANISM is right for only three of them.
 * That correction is the whole design of this file, so it is stated rather than
 * implied: removing the barrel edge freed exactly the three views that had no
 * other reason to be eager, and the eager closure moved 3237.0 KB -> 3231.7 KB
 * gzipped (-5,367 bytes, 52 -> 49 eager chunks of 508) as read from
 * `pnpm check:eager-closure`. The other three are held by defects the barrel has
 * nothing to do with, they are worth 53.8 KB gzipped between them, and no import
 * spelling repairs any of them — see {@link DECLARED_LAZY_VIEWS_STILL_EAGER}.
 *
 * ## Defect 1 — the barrel re-export nobody can tree-shake (three views)
 *
 * `packages/app-shell/src/index.ts` re-exports the views from the package
 * barrel (`export { RecordFormPage, ... } from './views/index.js'`), and the
 * console's entry imports that barrel statically (`apps/console/src/main.tsx`,
 * and ~30 other console modules). A named re-export is an ordinary static edge,
 * so the split chunk stays statically reachable from the entry even though the
 * only ROUTING reference to it is a `lazy()` import.
 *
 * Tree-shaking should have dropped those re-exports — nothing in the eager graph
 * uses the bindings. It cannot, because `@object-ui/app-shell` publishes no
 * `sideEffects` field, so every bundler must assume every module in the
 * re-export chain might do something on import and keeps them all.
 *
 * The fix is to tell the CONSOLE's build what is true of these specific
 * modules: they are pure React components, so `moduleSideEffects: false`. That
 * was deliberately narrower than adding `"sideEffects"` to
 * `packages/app-shell/package.json`, which is the general fix and was reserved
 * as a published-contract decision rather than taken in-lane.
 *
 * ⚠️ That decision has since been taken (objectui#6683, maintainer ruling of
 * 2026-08-29): the package now declares a precise `sideEffects` ARRAY, guarded
 * by `scripts/check-side-effects-array.mjs`. `"sideEffects": false` stays
 * disproven and is NOT what shipped — measured, it silently DROPS three real
 * SDUI widget registrations (`mcp:connect-agent`, `cloud:onboarding-next` --
 * since retired, objectui#12954 -- and `cloud:ai-model-status`, all registered
 * through bare side-effect imports in the barrel). The ARRAY names those modules, and
 * `scripts/check-sdui-registration-pins.mjs` weighs the built console for them.
 *
 * This plugin is NOT made redundant by that. It is scoped to AppContent's
 * declared-lazy route views, which are pure components with no registration of
 * their own, so the package array does not — and must not — name them; the
 * console-local declaration is what keeps them shakeable, and the ledger below
 * is what keeps the agreement honest in both directions.
 *
 * ## Defect 2 — edges the barrel has nothing to do with (three views)
 *
 * `RecordDetailView` is eager for an honest reason and stays eager:
 * `packages/app-shell/src/views/ObjectView.tsx` imports it statically, and
 * `ObjectView` is in AppContent's own "eagerly loaded — always needed" block.
 * Its `lazy()` is defeated by a genuine dependency, not by a barrel. It is
 * therefore PINNED in {@link DECLARED_LAZY_VIEWS_STILL_EAGER} rather than
 * quietly declared pure — and it is not declared pure for a second, independent
 * reason: it carries a bare `import './record-approvals-renderer.js'`, so the
 * claim would be false.
 *
 * `RecordFormPage` and `ReportView` are eager for a third reason, and it is the
 * one no `grep` over the source will show: CHUNK CO-TENANCY. Rolldown emits each
 * of them in a chunk it shares with a module that IS eagerly used, so the whole
 * chunk is eager and the view's bytes ride along even with no import edge to the
 * view itself. Both are pinned with the co-tenant named.
 *
 * ## Defect 3 — the surfaces this file used to look away from (objectui#6681)
 *
 * AppContent declares `lazy()` for more than the eight single-file views, and
 * objectui#6535 deliberately parsed only those: a directory barrel
 * (`../views/metadata-admin/index.js`, six declarations), a sibling directory
 * (`./marketplace/*.js`, three then, two since objectui#12733) and a package
 * (`@object-ui/plugin-designer`, three). Measured on `b98352a15` from
 * `apps/console/dist/eager-closure.json` and the emitted chunks' own module
 * lists, three of those four surfaces were
 * eager and worth 182,134 bytes gzipped — 5.6% of a 3180.2 KB closure, and more
 * than four times its 42.5 KB of headroom:
 *
 * | chunk                      | gz eager | mechanism                          |
 * |----------------------------|----------|------------------------------------|
 * | `metadata-admin`           | 172,651  | real static edges — FIXED, #6776   |
 * | `MarketplacePackagePage`   |    7,647 | chunk co-tenancy — FIXED           |
 * | the Installed Apps page    |    1,836 | chunk co-tenancy — FIXED; RETIRED  |
 * | `MarketplacePage`          |        0 | already lazy (the control)         |
 *
 * The two marketplace chunks were held by objectui#6680's mechanism, not by an
 * import of the page: rolldown had put `MarketplacePackagePage.tsx` in a chunk
 * with `components/SuggestedBindingsPanel.tsx` (which eager
 * `views/studio-design/StudioDesignSurface.tsx` imports statically) and the
 * Installed Apps page in a chunk with the SDUI widget module the package barrel
 * bare-imported for its registration. `MarketplacePage.tsx` had no eager
 * co-tenant and was already lazy — the control that makes the mechanism legible.
 * objectui#12733 retired the Installed Apps page and its widget together, so
 * AppContent declares two marketplace pages lazy today, not three.
 * The repair is the `app-shell-eager-leaves` group in
 * `apps/console/vite.config.ts`, which isolates the co-tenants; the eager
 * closure moved 3180.2 KB -> 3171.5 KB (-8,888 bytes, 48 -> 45 eager chunks).
 *
 * ⚠️ The opposite grouping was tried FIRST and measured WORSE, which is why the
 * group names the leaves and not the pages: a `marketplace-routes` group over
 * the three declared-lazy pages became an attractor for 47 modules — including
 * `runtime-config.ts`, `providers/MetadataProvider.tsx` and
 * `@object-ui/plugin-form` — and emitted a 44 KB EAGER chunk, because the same
 * bare-imported widget module got swept into it. Net -1,697 bytes
 * against -8,888, and three other lazy boundaries destroyed. A chunk group is
 * not a laziness declaration; it decides co-tenancy, and co-tenancy runs both
 * ways.
 *
 * ## Why a ledger, and why drift fails in BOTH directions
 *
 * A one-off measurement does not stop the next barrel re-export from undoing
 * this. Neither does a check that only fails when a view goes eager: the
 * dangerous reading here is ZERO, exactly as in
 * `scripts/vite-ineffective-dynamic-imports.ts`. So:
 *
 *  - **unpinned** — a declared-`lazy()` view found in the eager closure that
 *    this ledger does not know about. That is a NEW regression; the build stops
 *    and names the view.
 *  - **missing** — a pinned view that is NOT in the eager closure any more.
 *    Either someone fixed the static edge (record the win: delete the line, say
 *    so in the PR) or this walk has gone blind.
 *
 * Two counter-probes guard the walk itself, because both halves above are
 * statements about a SET that a broken matcher empties silently:
 *
 *  1. Every declared view must be found in SOME chunk, eager or lazy. A view
 *     that matches nothing at all means the module-id matcher stopped matching,
 *     not that the bundle improved.
 *  2. `ObjectView` — imported statically by AppContent's always-needed block —
 *     must be found EAGER. It is the positive control in the same query shape:
 *     if the eager walk cannot see a module that is eager by construction, its
 *     zeroes are not measurements.
 */

/** Repo root — this file lives in `scripts/`, one level below it. */
const REPO_ROOT = path.resolve(import.meta.dirname, '..');

/**
 * The module whose `lazy()` declarations are the subject:
 * `packages/app-shell/src/console/AppContent.tsx`, repo-relative POSIX.
 */
export const APP_CONTENT_PATH = 'packages/app-shell/src/console/AppContent.tsx';

/**
 * The positive control for the eager walk:
 * `packages/app-shell/src/views/ObjectView.tsx`, statically imported by
 * {@link APP_CONTENT_PATH}'s "eagerly loaded — always needed" block, so it is
 * eager by construction. See counter-probe 2 in the header.
 */
export const EAGER_WALK_CONTROL = 'packages/app-shell/src/views/ObjectView.tsx';

/**
 * Declared-`lazy()` modules that are in the eager closure anyway, with the
 * reason each stands. Kept sorted and deduplicated
 * (`scripts/__tests__/vite-declared-lazy-views.test.ts` checks that, and that
 * every entry still names a file that exists).
 *
 * ONE entry stands, and it does not stand for the barrel re-export
 * objectui#6535 removed:
 *
 *  - `packages/app-shell/src/views/RecordDetailView.tsx` — a real static edge.
 *    `packages/app-shell/src/views/ObjectView.tsx` imports it by name, and
 *    `ObjectView` sits in AppContent's own "eagerly loaded — always needed"
 *    block. Splitting it would mean giving `ObjectView` a lazy boundary.
 *
 * ## `views/metadata-admin/index.ts` was the third removal — objectui#6776
 *
 * It was the LARGEST single entry this ledger ever carried: 172,945 bytes
 * gzipped over 144 modules, 5.3% of the eager closure, the target of SIX
 * `lazy()` declarations in AppContent that deferred nothing. Two static edges
 * held it, both measured from the emitted chunk's module list (objectui#6681):
 *
 *   1. `packages/app-shell/src/index.ts` — the package barrel re-exported 25
 *      runtime values from it (`registerMetadataPreview`, `useMetadataClient`,
 *      …; the earlier note here said eleven, which counted only part of the
 *      list and omitted the 11 type-only names that carry no edge at all —
 *      corrected by objectui#6785). The console's entry imports that barrel.
 *   2. `packages/app-shell/src/services/builtinComponents.tsx` — which the
 *      barrel BARE-imports for its ComponentRegistry registrations, and which
 *      imported `MetadataDirectoryPage` and `MetadataResourceRouter` from this
 *      module BY VALUE. A registry entry that names a component must hold the
 *      component.
 *
 * The note that stood here said neither edge was removable inside a bundling
 * change, and that was right — the repair was NOT a bundling change. Under the
 * maintainer ruling of 2026-08-30 (objectui#6776), three things moved together:
 *
 *   - the five top-level registrations (`registerBuiltinAnchors`,
 *     `registerDefaultMetadataSchemas`, `registerDatasourceResource`,
 *     `registerBuiltinPreviews`, `registerBuiltinInspectors`) moved to
 *     `views/metadata-admin/register-builtins.ts`, bare-imported by the PACKAGE
 *     ENTRY, so they stay exactly as eager as they were while the page barrel
 *     stops being side-effectful. `@object-ui/app-shell`'s `sideEffects` array
 *     names the new leaf instead of the barrel;
 *   - the package barrel's 25 runtime re-exports now name the LEAF modules,
 *     same names and same types, which removes edge 1; and
 *   - `builtinComponents.tsx` registers the two pages as `lazy()` values, each
 *     behind its own `Suspense` inside the registration value, which removes
 *     edge 2 without touching `registerAppComponent`'s signature.
 *
 * ⚠️ The `lazy()` in `builtinComponents.tsx` is the half that looks sufficient
 * and is not. Measured on `fab4802e3` with ONLY that half applied: the eager
 * closure went UP by 211 bytes, the `metadata-admin` chunk went up by 396, the
 * eager chunk count did not move, the chunk stayed EAGER — and the build exited
 * 0 with this plugin printing "2 eager, all pinned" and
 * `scripts/vite-ineffective-dynamic-imports.ts` printing its usual 43, because
 * neither can see a static edge that lives in another module. That trap is
 * written up beside the code in `builtinComponents.tsx`.
 *
 * Read that 211 as a magnitude, not a direction: an INDEPENDENT rebuild of the
 * same variant measured the closure delta at -7 bytes. Both figures stand as
 * what their run measured, and the disagreement is the point — the delta is
 * small and sensitive to the byte-form of the edit, so its sign is not a
 * finding. The finding is the pair that reproduced on both rebuilds: the chunk
 * stayed EAGER and the eager chunk count did not move (45 of 513).
 *
 * ⛔ What has NOT changed: the registrations in `register-builtins.ts` are
 * still load-bearing and still unshakeable. {@link declaredSideEffectful} — not
 * {@link bareSideEffectImport}, which returns `null` for a top-level CALL —
 * is the guard that refuses to declare their module pure, and it now reads
 * `register-builtins.ts` out of the package's own array. Moving the bare import
 * back onto the page barrel would re-arm the whole defect under a new name.
 *
 * objectui#11939 step 2 took two of the five out of that module: the built-in
 * previews and inspectors are registered by `register-builtin-designers.ts`,
 * which the package entry loads with a dynamic `import()` and whose exported
 * function its `.then` calls. That module registers nothing at load time, so
 * the array does not name it and neither guard here is involved; the three
 * registrations whose registries are not observable stay in
 * `register-builtins.ts`, eager as before.
 *
 * ## Two entries were REMOVED here BEFORE that, and both removals are wins
 *
 * `RecordFormPage` and `ReportView` were pinned for a third reason, the one no
 * `grep` over the source shows: CHUNK CO-TENANCY (objectui#6680). Rolldown
 * emitted each of them in a chunk shared with a module that IS eagerly used —
 * `providers/expressionUser.ts` for the first, `views/RuntimeDraftBar.tsx` for
 * the second — so the whole chunk was eager and the view's bytes rode along
 * with no import edge to the view itself.
 *
 * objectui#6683 declared `"sideEffects"` on `@object-ui/app-shell` as a precise
 * ARRAY, which makes those co-tenant modules shakeable in their own right; the
 * chunks they anchored stopped being eager and both views fell out of the
 * closure. The `missing` half of this ledger fired on that build and named both
 * views by path, which is what a recorded win looks like here — the lines are
 * deleted because the build said so, not because the walk was assumed healthy.
 *
 * ⚠️ Deleting a line is a MEASUREMENT, never a repair. Counter-probe 1 below
 * (every declared view must be found in SOME chunk) is what separates "the view
 * became lazy" from "the matcher stopped matching", and it ran green on the
 * same build.
 */
export const DECLARED_LAZY_VIEWS_STILL_EAGER: readonly string[] = Object.freeze([
  'packages/app-shell/src/views/RecordDetailView.tsx',
]);

/**
 * Pull the modules out of AppContent's `lazy()` declarations.
 *
 * Every RELATIVE specifier, not just `../views/<Name>.js`. objectui#6535 kept
 * this to the eight single-file route views on purpose — the directory barrel
 * (`../views/metadata-admin/index.js`) and the sibling directory
 * (`./marketplace/*.js`) had their own eager-closure story and nobody had
 * measured it. objectui#6681 measured it, so they are in the subject now: on
 * `b98352a15` this parses TWELVE distinct files, and three of the four surfaces
 * it adds were eager (see the header table).
 *
 * The PACKAGE specifier stays out. AppContent also declares
 * `lazy(() => import('@object-ui/plugin-designer'))` for three pages, and
 * `@object-ui/plugin-designer` is a bare specifier with no repo-relative source
 * file until a resolver has run — this parser reads a string and checks the
 * filesystem, which is the property that lets it run in `buildStart` before any
 * module is loaded. Measured on the same build, the chunk holding
 * `packages/plugin-designer/src/**` is NOT in the eager closure, so the ledger
 * is not currently blind to a live defect; it IS blind to a future one, which
 * is recorded rather than papered over.
 *
 * Returns repo-relative POSIX paths to the REAL source files, resolved on disk
 * through `exists` — the specifier says `.js` (NodeNext spelling) and the file
 * is `.tsx` (or, for a directory barrel, `index.ts`), and guessing that mapping
 * instead of checking it is how a ledger ends up naming a path that no longer
 * exists.
 */
export function parseDeclaredLazyViews(
  source: string,
  exists: (repoRelative: string) => boolean = (p) => fs.existsSync(path.join(REPO_ROOT, p)),
  appContentPath: string = APP_CONTENT_PATH,
): string[] {
  const dir = path.posix.dirname(appContentPath);
  const found = new Set<string>();
  // Any relative specifier: `./x.js`, `../views/x.js`, `../views/dir/index.js`.
  // A bare/package specifier (no leading `.`) is deliberately not matched — see
  // the note above.
  const pattern = /lazy\(\s*\(\s*\)\s*=>\s*import\(\s*['"](\.[^'"]*?)\.js['"]\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    const base = path.posix.normalize(path.posix.join(dir, match[1] as string));
    const resolved = ['.tsx', '.ts'].map((ext) => `${base}${ext}`).find(exists);
    if (resolved) found.add(resolved);
    else found.add(`${base}.tsx`);
  }
  return [...found].sort();
}

/**
 * Whether this view can honestly be declared `moduleSideEffects: false`.
 *
 * Returns the offending line when the module carries a bare side-effect import
 * (`import './x.js';`), otherwise `null`. The complement rule — "every declared
 * view that is not pinned eager is declared pure" — would otherwise turn a
 * future view's registration into a silent drop, so the claim is CHECKED
 * against the source rather than assumed from the ledger.
 */
export function bareSideEffectImport(source: string): string | null {
  const match = /^\s*import\s+['"][^'"]+['"]\s*;?\s*$/m.exec(source);
  return match ? (match[0].trim() as string) : null;
}

/**
 * Whether the OWNING PACKAGE has already declared this module side-effectful.
 *
 * {@link bareSideEffectImport} reads the module's own source for a bare
 * `import './x.js';`. That catches one shape of side effect and misses the
 * shape that costs the most here: a top-level CALL. Measured on `b98352a15`,
 * `packages/app-shell/src/views/metadata-admin/index.ts` performs five of them
 * (`registerBuiltinAnchors()`, `registerDefaultMetadataSchemas()`,
 * `registerDatasourceResource()`, `registerBuiltinPreviews()`,
 * `registerBuiltinInspectors()`) and `bareSideEffectImport` returns `null` for
 * it — so on that file alone, the source-reading guard would have let this
 * plugin declare `moduleSideEffects: false` and silently drop every built-in
 * preview and inspector registration in the console. That is the exact failure
 * objectui#6683 measured when `"sideEffects": false` was tried on the package.
 *
 * So the second guard does not re-derive the answer from the source at all. It
 * reads the package's OWN published claim — the `sideEffects` array that
 * objectui#6683 landed and `scripts/check-side-effects-array.mjs` keeps honest
 * — and refuses any module that array names. One producer of the fact, two
 * consumers; a module cannot be side-effectful for npm and pure for this build.
 *
 * `sideEffects` is matched the way bundlers match it: `false` claims nothing is
 * side-effectful, `true` (or absent) claims everything might be, and an array
 * names paths relative to the package root. Only exact `./path` entries are
 * honoured here — glob entries are reported as a match for the whole package,
 * because a guard that silently under-matches a glob is the failure this
 * function exists to prevent.
 *
 * @param sideEffects the package.json `sideEffects` field, as parsed.
 * @param packageRelative the module's path relative to the package root, POSIX,
 *   WITHOUT a leading `./` (e.g. `src/views/metadata-admin/index.ts`).
 * @returns the entry that names it (or a description of the claim), else `null`.
 */
export function declaredSideEffectful(
  sideEffects: unknown,
  packageRelative: string,
): string | null {
  if (sideEffects === false) return null;
  if (sideEffects === undefined) {
    // No claim at all. This plugin exists precisely because that is the state
    // `@object-ui/app-shell` was in before objectui#6683, and the narrow
    // per-module declaration below is what it replaced. Not a refusal.
    return null;
  }
  if (sideEffects === true) return 'the package declares `"sideEffects": true`';
  if (!Array.isArray(sideEffects)) {
    return `the package declares a \`sideEffects\` of an unrecognised shape (${JSON.stringify(sideEffects)})`;
  }
  for (const raw of sideEffects) {
    if (typeof raw !== 'string') continue;
    const entry = raw.startsWith('./') ? raw.slice(2) : raw;
    if (entry === packageRelative) return raw;
    if (entry.includes('*')) {
      return `${raw} (a glob — this guard refuses rather than under-match it)`;
    }
  }
  return null;
}

/**
 * The nearest `package.json` at or above `repoRelative`, and the module's path
 * relative to it. Returns `null` above the repo root — a source file outside any
 * package has no published `sideEffects` claim to read.
 */
export function nearestPackage(
  repoRelative: string,
  repoRoot: string,
): { packageJsonPath: string; packageRelative: string } | null {
  let dir = path.posix.dirname(repoRelative);
  while (dir !== '.' && dir !== '' && dir !== '/') {
    const candidate = path.posix.join(dir, 'package.json');
    if (fs.existsSync(path.join(repoRoot, candidate))) {
      return {
        packageJsonPath: candidate,
        packageRelative: path.posix.relative(dir, repoRelative),
      };
    }
    dir = path.posix.dirname(dir);
  }
  return null;
}

/** The two directions of drift a build can show against the ledger. */
export interface DeclaredLazyViewDiff {
  /** Declared-lazy views found eager that the ledger does not know about. */
  readonly unpinned: readonly string[];
  /** Pinned views that are no longer eager — a fix to record, or a blind walk. */
  readonly missing: readonly string[];
}

/**
 * Compare one build's eager declared-lazy views against the ledger. Pure, so
 * the policy is unit-testable without a five-minute console build.
 */
export function diffDeclaredLazyViews(
  eagerViews: Iterable<string>,
  pinned: readonly string[] = DECLARED_LAZY_VIEWS_STILL_EAGER,
): DeclaredLazyViewDiff {
  const pinnedSet = new Set(pinned);
  const eagerSet = new Set(eagerViews);
  return {
    unpinned: [...eagerSet].filter((id) => !pinnedSet.has(id)).sort(),
    missing: [...pinnedSet].filter((id) => !eagerSet.has(id)).sort(),
  };
}

/**
 * Render {@link diffDeclaredLazyViews}'s verdict, or `null` when it is clean.
 *
 * `why` carries, per view, the chunk that holds it and the EAGER chunks that
 * statically import that chunk. Without it the failure names a view and leaves
 * the reader to rebuild the graph by hand to find the edge — and the edge is
 * frequently not a source-level import of the view at all but a chunk-grouping
 * decision, which no amount of `grep` over the source will show.
 */
export function formatDeclaredLazyViewFailure(
  diff: DeclaredLazyViewDiff,
  why: ReadonlyMap<string, string> = new Map(),
): string | null {
  const lines: string[] = [];
  if (diff.unpinned.length > 0) {
    lines.push(
      `${diff.unpinned.length} view(s) that AppContent declares with \`lazy()\` are in the ` +
        `EAGER closure, so the browser fetches and parses them before first render whatever ` +
        `the route — the \`lazy()\` + \`<Suspense>\` around them buys nothing (objectui#6535):`,
      ...diff.unpinned.map((id) => `  + ${id}${why.has(id) ? ` -- ${why.get(id)}` : ''}`),
      `Find the edge in the EMITTED chunk's own module list, never by grepping the source: ` +
        `the \`--\` note above names the chunk and its eager importers, and the edge is often ` +
        `not an import of the view at all but CHUNK CO-TENANCY (objectui#6680) — an eagerly ` +
        `reached leaf that rolldown parked in the same chunk. Three repairs, in order of ` +
        `preference: remove the static edge (usually a named re-export from ` +
        `\`packages/app-shell/src/index.ts\` that the console's entry pulls in); isolate the ` +
        `eager co-tenant with an \`advancedChunks\` group in \`apps/console/vite.config.ts\` ` +
        `(objectui#6681 — group the CO-TENANT, not the lazy page: the other way round measured ` +
        `worse); or pin the view in DECLARED_LAZY_VIEWS_STILL_EAGER with the reason it stands.`,
    );
  }
  if (diff.missing.length > 0) {
    lines.push(
      `${diff.missing.length} pinned view(s) are NO LONGER in the eager closure. If you fixed ` +
        `the static edge, record the win: delete the line from ` +
        `DECLARED_LAZY_VIEWS_STILL_EAGER and say so in the PR. If you did not, this walk has ` +
        `gone blind and its zeroes are not measurements:`,
      ...diff.missing.map((id) => `  - ${id}`),
    );
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

export interface DeclaredLazyViewsOptions {
  /** Repo-relative POSIX path to the module carrying the `lazy()` declarations. */
  readonly appContentPath?: string;
  /** Ledger of declared-lazy views that are eager anyway. */
  readonly pinnedEager?: readonly string[];
  /** Repo root the repo-relative paths are resolved against. */
  readonly repoRoot?: string;
}

/**
 * Both halves of the agreement, in one plugin so they cannot drift: the same
 * parsed declaration list decides what is declared side-effect-free and what
 * the eager-closure assertion weighs.
 */
export function viteDeclaredLazyViews(options: DeclaredLazyViewsOptions = {}): Plugin {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const appContentPath = options.appContentPath ?? APP_CONTENT_PATH;
  const pinnedEager = options.pinnedEager ?? DECLARED_LAZY_VIEWS_STILL_EAGER;

  /** Repo-relative view paths parsed from AppContent, filled in `buildStart`. */
  let declared: string[] = [];
  /** Absolute ids of the views this build declares side-effect-free. */
  let shakeable = new Set<string>();
  /**
   * Bare file names (`DashboardView.js`) of {@link shakeable}, so the hot
   * `resolveId` path rejects the ~30k specifiers that cannot be a view with one
   * string compare, instead of re-entering the resolver for every one of them.
   */
  let shakeableSpecifiers = new Set<string>();

  const abs = (repoRelative: string) => path.join(repoRoot, repoRelative);

  return {
    name: 'declared-lazy-views',
    // `resolveId` MUST outrank vite's own resolver. Vite runs core plugins
    // (`vite:resolve` among them) BEFORE normal-order plugins, and `resolveId`
    // is first-wins — so at normal order this hook is never called at all and
    // the side-effect declaration below is silently inert. Measured on this
    // branch: at normal order the build reached `generateBundle` with all five
    // views still eager and failed on the ledger, which reads exactly like "the
    // fix does not work" rather than "the hook never ran".
    enforce: 'pre',

    buildStart() {
      const appContentAbs = abs(appContentPath);
      if (!fs.existsSync(appContentAbs)) {
        this.error(
          `[declared-lazy-views] \`${appContentPath}\` does not exist, so no \`lazy()\` view ` +
            `declaration can be read and every check below would pass vacuously. The module ` +
            `was moved or renamed — re-point \`appContentPath\` at it.`,
        );
      }
      const source = fs.readFileSync(appContentAbs, 'utf8');
      declared = parseDeclaredLazyViews(source, (p) => fs.existsSync(abs(p)), appContentPath);

      // Counter-probe — a parse that finds nothing is a broken matcher, and it
      // would make BOTH halves below vacuous: nothing declared side-effect-free
      // (no win, silently) and nothing weighed (no guard, silently).
      if (declared.length === 0) {
        this.error(
          `[declared-lazy-views] counter-probe failed: no \`lazy(() => import('<relative>.js'))\` ` +
            `declaration found in \`${appContentPath}\`. objectui#6535 measured eight single-file ` +
            `route views and objectui#6681 widened the subject to every relative specifier, ` +
            `twelve distinct files on \`b98352a15\`. Either the ` +
            `route views stopped being declared lazy — in which case retire this plugin ` +
            `deliberately rather than leaving a guard with no subject — or the declarations were ` +
            `re-spelled and this matcher no longer sees them. Do not read this as "all views are ` +
            `lazy now": it is a statement about the regex, never about the graph.`,
        );
      }

      const pinnedSet = new Set(pinnedEager);
      const next = new Set<string>();
      for (const view of declared) {
        if (pinnedSet.has(view)) continue;

        // Guard 1 — the package's own published claim. Checked FIRST because it
        // is the one that catches a top-level registration CALL, which the
        // source-reading guard below cannot see (objectui#6681).
        const owner = nearestPackage(view, repoRoot);
        if (owner) {
          const manifest = JSON.parse(fs.readFileSync(abs(owner.packageJsonPath), 'utf8')) as {
            sideEffects?: unknown;
          };
          const claim = declaredSideEffectful(manifest.sideEffects, owner.packageRelative);
          if (claim) {
            this.error(
              `[declared-lazy-views] refusing to declare \`${view}\` side-effect-free: its own ` +
                `package says otherwise — \`${owner.packageJsonPath}\` names it in ` +
                `\`sideEffects\` (\`${claim}\`). A module cannot be side-effectful for every ` +
                `npm consumer and pure for this one build; the array is the published claim and ` +
                `this plugin is not entitled to a second opinion about it. Measured on ` +
                `objectui#6683, declaring \`@object-ui/app-shell\` side-effect-free silently ` +
                `dropped three SDUI widget registrations, and on objectui#6681 the module this ` +
                `guard first fired for performs FIVE top-level registrations that ` +
                `\`bareSideEffectImport\` cannot see — it has no bare import at all. Either ` +
                `pin \`${view}\` in DECLARED_LAZY_VIEWS_STILL_EAGER with the reason it stands, ` +
                `or move the side effect out of it and drop the \`sideEffects\` entry ` +
                `(\`pnpm check:side-effects-array\` weighs that edit).`,
            );
          }
        }

        // Guard 2 — the module's own source. Narrower, and still needed: a
        // module absent from the array can carry a bare side-effect import that
        // nobody has noticed yet, which is how `RecordDetailView` was caught.
        const offending = bareSideEffectImport(fs.readFileSync(abs(view), 'utf8'));
        if (offending) {
          this.error(
            `[declared-lazy-views] refusing to declare \`${view}\` side-effect-free: it carries ` +
              `a bare side-effect import (\`${offending}\`), so the claim would be false and the ` +
              `import could be dropped from every build that believes it — measured on ` +
              `objectui#6535, that is exactly how \`"sideEffects": false\` on ` +
              `\`@object-ui/app-shell\` silently loses SDUI widget registrations. Either move the ` +
              `side effect out of the view, or pin the view in ` +
              `DECLARED_LAZY_VIEWS_STILL_EAGER with the reason.`,
          );
        }
        next.add(abs(view));
      }
      shakeable = next;
      shakeableSpecifiers = new Set(
        [...next].map((id) => `${path.basename(id, path.extname(id))}.js`),
      );
    },

    // A named re-export the eager graph never uses is droppable only if the
    // module is known pure. `@object-ui/app-shell` publishes no `sideEffects`
    // field, so rolldown must assume otherwise; this states the truth for THIS
    // build and these modules only. `resolveId` rather than `load`/`transform`
    // so the file's contents and sourcemaps are left entirely alone.
    async resolveId(source: string, importer: string | undefined, resolveOptions) {
      if (shakeable.size === 0) return null;
      const bare = source.split('?')[0] as string;
      if (!shakeableSpecifiers.has(bare.slice(bare.lastIndexOf('/') + 1))) return null;
      const resolved = await this.resolve(source, importer, { ...resolveOptions, skipSelf: true });
      if (!resolved || resolved.external) return resolved;
      if (!shakeable.has(resolved.id.split('?')[0] as string)) return resolved;
      return { ...resolved, moduleSideEffects: false };
    },

    generateBundle(_outputOptions, bundle: Rollup.OutputBundle) {
      const chunks = new Map<string, Rollup.OutputChunk>();
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type === 'chunk') chunks.set(fileName, output);
      }

      // The eager closure: every chunk reachable from an entry chunk through
      // STATIC imports only. Same walk, and the same entry selection, as
      // `emitEagerClosureReport` in `apps/console/vite.config.ts` — the two must
      // answer the same question or this guard and the budget disagree.
      const entries = [...chunks.values()].filter((c) => c.isEntry).map((c) => c.fileName);
      const eager = new Set<string>();
      const queue = [...entries];
      while (queue.length > 0) {
        const fileName = queue.pop() as string;
        if (eager.has(fileName)) continue;
        eager.add(fileName);
        for (const imported of chunks.get(fileName)?.imports ?? []) {
          if (!eager.has(imported)) queue.push(imported);
        }
      }

      const chunksHolding = (repoRelative: string): string[] => {
        const suffix = `/${repoRelative}`;
        return [...chunks.values()]
          .filter((chunk) =>
            Object.keys(chunk.modules).some((id) => {
              const bare = id.replace(/^\0/, '').split('?')[0] as string;
              const posix = bare.split(path.sep).join('/');
              return posix === repoRelative || posix.endsWith(suffix);
            }),
          )
          .map((chunk) => chunk.fileName);
      };

      // Counter-probe 1 — every declared view must be SOMEWHERE in this bundle.
      const invisible = declared.filter((view) => chunksHolding(view).length === 0);
      if (invisible.length > 0) {
        this.error(
          `[declared-lazy-views] counter-probe failed: ${invisible.length} declared-lazy view(s) ` +
            `are in no chunk at all — eager or lazy — so the module-id matcher below can no ` +
            `longer fail and its verdict is a statement about this matcher, not about the ` +
            `graph: ${invisible.join(', ')}. AppContent still declares them, so they must be in ` +
            `the bundle; the ids rolldown reports have changed shape. (chunks: ${chunks.size})`,
        );
      }

      // Counter-probe 2 — the eager walk must see a module that is eager by
      // construction. A walk that finds too little reports "all lazy", which
      // this guard would read as good news.
      const controlChunks = chunksHolding(EAGER_WALK_CONTROL);
      if (controlChunks.filter((fileName) => eager.has(fileName)).length === 0) {
        this.error(
          `[declared-lazy-views] counter-probe failed: \`${EAGER_WALK_CONTROL}\` is not in the ` +
            `eager closure. AppContent imports it statically in its "eagerly loaded — always ` +
            `needed" block, so it is eager by construction — its absence means this walk is ` +
            `reading the graph wrongly, not that the bundle improved. Fix the walk before ` +
            `trusting the verdict below. (chunks holding it: ${controlChunks.join(', ') || 'NONE'}; ` +
            `entry chunks: ${entries.join(', ') || 'NONE'}; eager: ${eager.size}/${chunks.size})`,
        );
      }

      const eagerViews = declared.filter((view) =>
        chunksHolding(view).some((fileName) => eager.has(fileName)),
      );

      // Why each eager view is eager: the chunk holding it, and the eager
      // chunks that statically import that chunk. An entry chunk names itself.
      const why = new Map<string, string>();
      for (const view of eagerViews) {
        for (const holder of chunksHolding(view).filter((f) => eager.has(f))) {
          const importers = [...chunks.values()]
            .filter((c) => eager.has(c.fileName) && (c.imports ?? []).includes(holder))
            .map((c) => c.fileName);
          why.set(
            view,
            `in eager chunk \`${holder}\`, statically imported by ` +
              `${importers.join(', ') || (entries.includes(holder) ? 'nothing (it IS an entry chunk)' : 'NOTHING -- so it was placed there by chunk grouping, not by an import edge')}`,
          );
        }
      }

      const failure = formatDeclaredLazyViewFailure(
        diffDeclaredLazyViews(eagerViews, pinnedEager),
        why,
      );
      if (failure) this.error(`[declared-lazy-views] ${failure}`);

      const lazyCount = declared.length - eagerViews.length;
      this.info(
        `${lazyCount}/${declared.length} modules AppContent declares lazy are genuinely lazy; ` +
          `${eagerViews.length} eager, all pinned (objectui#6535, widened to the directory ` +
          `barrel and the marketplace routes by objectui#6681). Ledger + why they stand: ` +
          `scripts/vite-declared-lazy-views.ts`,
      );
    },
  };
}
