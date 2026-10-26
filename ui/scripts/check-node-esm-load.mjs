#!/usr/bin/env node
/**
 * Every published ESM package must be loadable by Node's own resolver.
 *
 * Run:  node scripts/check-node-esm-load.mjs --specifiers-only  (`pnpm check:esm-specifiers`)
 *       node scripts/check-node-esm-load.mjs                    (`pnpm check:node-esm-load`)
 *       node scripts/check-node-esm-load.mjs --force-build      (the same, cache off)
 * Exit: 0 = no un-ledgered package emits an unresolvable relative specifier,
 *           and (full mode) every entry the gate GRADED was built by this tree
 *           and either evaluated or is named as a stated boundary
 *           (UNBUNDLED_NODE_UNSUPPORTED),
 *       1 = a finding, OR the gate could not build, OR an artifact it was about
 *           to grade was not produced by this tree, OR it inspected too little
 *           to be asserting anything.
 *
 * ## The defect (objectui#4538)
 *
 * `packages/react/dist/index.js` re-exported through EXTENSIONLESS relative
 * specifiers — `export * from './SchemaRenderer'`. Node's ESM resolver does not
 * extension-search relative specifiers (that is a CommonJS behaviour), so
 * importing the published entry under plain Node failed:
 *
 *     code: 'ERR_MODULE_NOT_FOUND',
 *     url:  'file:///.../packages/react/dist/SchemaRenderer'
 *
 * Nothing caught it because every consumer this repository exercises goes
 * through a bundler, and bundlers extension-search happily. The unbundled paths
 * — plain Node ESM, an SSR host importing the package directly, a consumer
 * running the published tarball without a build step — are the ones that break.
 *
 * ## Why it is a SOURCE defect, and what that buys the cheap leg
 *
 * The card was triaged as "a build/emit setting". It is not: `packages/react`
 * builds with a bare `tsc`, and **TypeScript never rewrites import
 * specifiers** — there is no emit flag that appends `.js`. What the source
 * writes is exactly what `dist` ships. The extensionless form was permitted
 * only because the root tsconfig sets `"moduleResolution": "bundler"`.
 *
 * That is what makes a CHEAP, per-pull-request criterion possible at all: for a
 * package whose build preserves specifiers, the emitted specifier IS the source
 * specifier, so the source can be judged without building anything. The
 * expensive artifact-level leg then exists to check that the cheap criterion is
 * the right one — see the two legs below.
 *
 * ## Two legs, because neither one alone is honest
 *
 *   1. SPECIFIER leg (`--specifiers-only`, no build, runs per pull request).
 *      For every published `"type": "module"` package whose build preserves
 *      specifiers, every relative specifier in a file the build emits must
 *      carry an explicit extension. Complete over the whole repository and
 *      instant, so a regression is caught the moment it is written.
 *
 *   2. LOAD leg (full mode, builds). Actually `import()`s each published entry
 *      in a child `node`, through the package's own `exports` map, with no
 *      bundler and no loader hooks. This is the leg objectui#4538 asked for by
 *      name, and the reason is measured rather than assumed: `plugin-charts`'
 *      own emitted entry was CLEAN, and the failure appeared only once
 *      evaluation crossed into `@object-ui/react`. A check that stops at
 *      RESOLUTION passes while the tree is broken, so this one evaluates.
 *      It grades only artifacts THIS tree produced — see the leg below, which
 *      is what makes that sentence true rather than merely printed.
 *
 *   3. PROVENANCE leg (full mode, runs between the build and the grading).
 *      Reads the turbo task log beside each package and refuses to grade any
 *      artifact a different tree produced. See `buildProvenance`, and the
 *      section below for why a build is not by itself proof of production.
 *
 * The legs disagree by construction, and that is the point. Leg 1 cannot see a
 * defect that reaches a package through a dependency; leg 2 cannot see a
 * defect on a code path evaluation does not take. Leg 1 is the ratchet; leg 2
 * is the proof that the ratchet guards the right property; leg 3 is the proof
 * that leg 2's verdict is about the tree the caller is standing in.
 *
 * ## Building is not producing (objectui#7276)
 *
 * This gate used to print "the load leg refuses to grade artifacts it did not
 * produce" over a `pnpm build` that could not keep the promise. turbo keys its
 * cache by input hash and — measured on turbo 2.10.9, which announces it every
 * run as `using shared worktree cache` — stores it in the MAIN checkout's
 * `.turbo/cache`, not the worktree's. On a machine running several agents in
 * sibling worktrees of one clone, a build here is routinely satisfied by an
 * entry another worktree wrote, and turbo restores that worktree's artifacts
 * and its log into this one.
 *
 * Both directions of that are bad, and they are not equally visible. The LOUD
 * one is a red whose cause is elsewhere: a cache entry whose `outputs` do not
 * cover everything the build emits replays an incomplete tree, and the gate
 * reports `no-build-output` against a change that touched neither the package
 * nor its inputs. The SILENT one is the one that matters — a GREEN says
 * nothing about your tree when the artifacts came from someone else's, and no
 * exit code tells the two apart. The honest reading there is NOT MEASURED,
 * which was not one of this gate's outputs. Leg 3 makes it one.
 *
 * Why detect rather than isolate: measured in this repository, a cold
 * `turbo run build --filter=!@object-ui/site` took 3m46.7s over 43 tasks and
 * the same run against a warm shared cache took 213ms with all 43 replayed —
 * about 1065x. Paying that on every run to make "I produced these" true by
 * construction is the wrong trade for a gate people run locally, so the
 * default keeps the cache and leg 3 carries the invariant for a few file
 * reads. `--force-build` buys the expensive form (`TURBO_FORCE`) for the
 * caller who wants a reading with no shared-cache question in it at all.
 *
 * Leg 2 also carries this repository's one PRODUCT boundary: three
 * style-carrying plugin packages that plain Node is not expected to load, ruled
 * permanent rather than owed. It is stated at length on
 * UNBUNDLED_NODE_UNSUPPORTED below — including what the boundary costs this
 * gate, and which leg guards those packages instead.
 *
 * ## The vacuous forms this gate must never take
 *
 *   - "Scan `dist/` if it exists." With no per-PR full-repo build `dist/` is
 *     usually absent, so such a gate passes because it looked at NOTHING. Leg 1
 *     therefore reads SOURCES, which are always present, and leg 2 BUILDS
 *     rather than hoping someone else did (`--no-build` exists for callers that
 *     just built, and is wired into nothing).
 *   - "Resolve the entry." Measured and rejected above: resolution succeeded on
 *     the very package the card was filed from.
 *   - "Import it and count the successes." A run where every package failed for
 *     an unrelated reason would report no findings of the gated class. So both
 *     legs assert their own SIZE — see MIN_PACKAGES / MIN_LOADED.
 *   - "Grade whatever artifacts are lying there." Measured, and the reason
 *     leg 3 exists: they can be another worktree's. Leg 3 is written to FAIL
 *     CLOSED for the same reason the floors exist — `own` is the only verdict
 *     it grades on, so a missing task log, an unparseable one, or a marker
 *     convention turbo changes under us all come out as a refusal that names
 *     itself, never as a silent pass. A provenance check that answered "sure"
 *     when it could not read the marker would be this card's own subject
 *     matter one level up.
 *   - "Scan a text the gate MUTATED first." Leg 1 used to blank comments out of
 *     each source with two ordered regexes before matching specifiers in it,
 *     and the block-comment pass had no notion of already being inside a `//`
 *     line: a slash-star sequence in ordinary line-comment prose opened a
 *     comment that ran to the next star-slash anywhere in the file and blanked
 *     the live code between them. Measured on `main` at 478ec54ce — 2132
 *     specifiers seen by the mask, 2133 by the parser, the missing one a real
 *     `import`. Leg 1 now reads the file as written and asks the shared
 *     TypeScript scanner what the module edges are (objectui#5382); see
 *     `relativeSpecifiers`. `readTsconfig` below was the same class in the same
 *     file — three regexes over a tsconfig's raw text, blind to JSON strings,
 *     throwing on 61 of the repository's 91 configs — and took the same remedy
 *     under objectui#5367: TypeScript's own tsconfig reader.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { SKIP_DIRS, TOOLING_FILE, discoverPackages, moduleSpecifiers } from './check-phantom-dependencies.mjs';
import { isEntrypoint } from './invoked-as.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));

/**
 * Below this many published packages the scan is broken, not empty.
 *
 * The `fixed` group holds 40 entries today. A collapse to a handful means the
 * release config or the manifest walk stopped answering, and every assertion
 * below would pass while reading nothing.
 */
export const MIN_PACKAGES = 30;

/**
 * Below this many SUCCESSFUL imports the load leg proved nothing.
 *
 * Without it, a run in which every single entry failed to build would report
 * "no findings of the gated class" and exit 0 — the exact green-having-imported-
 * nothing result objectui#4538 called the failure mode to look for.
 */
export const MIN_LOADED = 3;


// ── who built the artifacts (objectui#7276) ──────────────────────────────────

/**
 * The per-task log turbo writes beside every build, and the one fact read out
 * of it: WHERE the script ran.
 *
 * The marker costs nothing to keep because turbo already keeps it. Each task's
 * stdout is cached alongside that task's outputs, and its first banner line is
 * pnpm's `> <name>@<version> <script> <absolute package dir>` — the directory
 * as it was WHEN THE SCRIPT ACTUALLY RAN. A cache replay restores that line
 * verbatim into the tree it replays into, so it keeps naming the worktree that
 * produced the artifacts rather than the one now holding them. That is exactly
 * the fact this gate needs and cannot get from the artifacts themselves, which
 * are byte-identical either way.
 */
export const TURBO_TASK_LOG = join('.turbo', 'turbo-build.log');

/**
 * pnpm's run banner. Only the tail is an absolute path; nothing else on the
 * line is, which is what makes the shape safe to read positionally.
 *
 * Anchored at both ends and applied to the FIRST `> ` line only. A build whose
 * own stdout happens to contain a look-alike line must not be able to answer
 * this question — and neither must the second `> ` line every multi-command
 * build script writes (`> tsc && node ...`), which the `@` and the absolute
 * tail already deny it.
 */
const PNPM_RUN_BANNER = /^> \S+@\S+ \S+ (\/.+?)\s*$/;

/**
 * The only provenance verdict the load leg will grade on.
 *
 * Written down as a constant, and pinned as the ONLY member of the accepting
 * set, because the way a check like this dies quietly is by growing a second
 * "close enough" verdict — at which point it examines everything and refuses
 * nothing, which is the shape of gate objectui#7276 was filed about.
 */
export const PROVENANCE_OK = 'own';

/**
 * What each refusal means and what the caller does about it.
 *
 * `unreadable-build-log` names the two identifiers a future maintainer has to
 * change, because the day turbo or pnpm moves that line is the day every
 * package in the repository starts refusing, and this message is the only
 * place that will say why.
 */
export const PROVENANCE_REMEDY = {
  foreign:
    'turbo shares one cache across every worktree of a checkout, so the build replayed another ' +
    "tree's entry here. Re-run with --force-build for a reading with no shared-cache question in it.",
  'no-build-log':
    'no turbo task log sits beside this package, so nothing says who built what is here. Run the ' +
    'build (drop --no-build), or --force-build.',
  'unreadable-build-log':
    "the task log's first `> ` line is not pnpm's `> name@version script dir`, so provenance could " +
    'not be READ — which this gate treats as a refusal, never as a pass. If turbo or pnpm changed ' +
    'that line, TURBO_TASK_LOG and PNPM_RUN_BANNER in this file are what need updating.',
};

/**
 * Who produced the artifacts currently sitting in `pkgDir`.
 *
 * Fails closed by construction: every outcome other than `PROVENANCE_OK` is a
 * refusal, including both ways of not knowing. "Could not read the marker" and
 * "the marker names someone else" differ in the remedy, not in whether the
 * load leg is allowed to speak.
 *
 * @param {string} pkgDir absolute path to the package directory
 * @returns {{ code: 'own'|'foreign'|'no-build-log'|'unreadable-build-log', producedIn: string|null }}
 */
export function buildProvenance(pkgDir) {
  let log;
  try {
    log = readFileSync(join(pkgDir, TURBO_TASK_LOG), 'utf8');
  } catch {
    return { code: 'no-build-log', producedIn: null };
  }
  const banner = log.split('\n').find((line) => line.startsWith('> '));
  const match = banner === undefined ? null : PNPM_RUN_BANNER.exec(banner);
  if (!match) return { code: 'unreadable-build-log', producedIn: null };
  const producedIn = match[1];
  return {
    code: resolve(producedIn) === resolve(pkgDir) ? PROVENANCE_OK : 'foreign',
    producedIn,
  };
}

// ── which builds preserve specifiers ─────────────────────────────────────────

/**
 * Parse a tsconfig, tolerating the comments this repository writes in them.
 *
 * ## Why this asks TypeScript rather than blanking comments (objectui#5367)
 *
 * It used to be three ordered `replace` calls over the raw text — blank block
 * comments, blank whole-line comments, drop trailing commas — feeding
 * `JSON.parse`. None of them knew what a JSON string was, so a slash-star
 * sequence written INSIDE a string opened a "block comment" that ran to the
 * next star-slash anywhere in the file and deleted every line between them.
 *
 * That is not exotic: `"@/*"` in a `paths` map and `"**\/*.test.ts"` in an
 * `exclude` list are the two commonest lines in this repository's tsconfigs,
 * and they are a matched opener and closer. Measured on `main` at ed35c23bb
 * over the 91 tsconfigs tracked by git: **61 of them threw**, not the two the
 * card was filed for. Every one of those throws was absorbed by
 * `effectiveNoEmit`'s catch, which grades an unreadable config as emitting — so
 * the gate's scope was being decided by a fallback rather than by a reading,
 * with no signal that it had happened.
 *
 * This is the same class as the specifier mask objectui#5382 retired further
 * down, and it takes the same remedy: ask the parser instead of pattern-
 * matching around it. `ts.parseConfigFileTextToJson` is TypeScript's own
 * tsconfig reader — comments, trailing commas and BOMs stop being questions
 * this gate has an opinion about, and the answer is by construction the one
 * `tsc` itself would compute. Re-measured with it: **0 of 91 throw**.
 *
 * No new dependency edge: `typescript` is a root devDependency and this module
 * already loads it on every run, transitively through the shared scanner it
 * imports from `check-phantom-dependencies.mjs`.
 *
 * Still THROWS on a genuinely unparseable config, deliberately — that is the
 * contract `effectiveNoEmit`'s conservative catch is written against, and the
 * contract `scripts/__tests__/check-node-esm-load.test.ts` asserts over every
 * tsconfig in the repository so this class cannot come back silently.
 *
 * @param {string} path absolute path to a tsconfig
 * @returns {Record<string, unknown>} the parsed config (`{}` for an empty file,
 *   which is what TypeScript reads it as: inherit everything)
 */
export function readTsconfig(path) {
  const parsed = ts.parseConfigFileTextToJson(path, readFileSync(path, 'utf8'));
  if (parsed.error) {
    throw new Error(`${path}: ${ts.flattenDiagnosticMessageText(parsed.error.messageText, ' ')}`);
  }
  return parsed.config ?? {};
}

/**
 * A tsconfig's EFFECTIVE `noEmit`, following `extends`.
 *
 * Following the chain is load-bearing rather than thorough: the root tsconfig
 * sets `"noEmit": true` and each emitting package overrides it to `false`, so
 * reading only the leaf answers "undefined" for exactly the configs whose
 * answer decides this gate's scope.
 */
export function effectiveNoEmit(configPath, seen = new Set()) {
  if (!existsSync(configPath) || seen.has(configPath)) return true;
  seen.add(configPath);
  let config;
  try {
    config = readTsconfig(configPath);
  } catch {
    // An unreadable config is graded as emitting, so a parse failure widens the
    // scan rather than silently dropping a package out of it.
    //
    // This is the fallback for a config nobody can read, and until objectui#5367
    // it was the NORMAL path: the regex strip `readTsconfig` used threw on 61 of
    // this repository's 91 tsconfigs, so most of this gate's scope came from
    // here instead of from a reading. With a real JSONC parse the branch is
    // reached by nothing in the repository today, which is what it was always
    // meant to be — a margin, not the mechanism.
    return false;
  }
  if (typeof config.compilerOptions?.noEmit === 'boolean') return config.compilerOptions.noEmit;
  if (typeof config.extends === 'string') {
    const parent = config.extends.startsWith('.')
      ? resolve(dirname(configPath), config.extends)
      : null;
    if (parent) {
      return effectiveNoEmit(parent.endsWith('.json') ? parent : `${parent}.json`, seen);
    }
  }
  return false;
}

/**
 * Whether a package's build copies import specifiers through unchanged.
 *
 * A bare `tsc` does: TypeScript emits the specifier the source wrote. A bundler
 * (`vite build`, `tsup`) RESOLVES relative specifiers while bundling, so an
 * extensionless one in its source never reaches the artifact — measured:
 * `@object-ui/data-objectstack` has 10 extensionless specifiers in `src/` and 0
 * in its `dist/`.
 *
 * A `tsc` step that does not EMIT is excluded, and the emit question is settled
 * by reading the tsconfig rather than the command line. That distinction is not
 * academic: `@object-ui/console`'s build is `tsc && vite build && pnpm
 * build:plugin`, whose `tsc` step carries `"noEmit": true` — it type-checks, and
 * the artifact comes from the two steps after it. Grading it on the command
 * alone reported 124 findings against a package that emits none of them.
 *
 * A pipeline that runs an EMITTING `tsc` and a bundler counts as preserving: the
 * `tsc` half still writes files, and judging it is the conservative direction —
 * a false positive lands in the ledger with a reason, a false negative ships.
 * No published package matches that shape today; the rule is kept because the
 * shape is legal, not because something wears it.
 *
 * ## `@object-ui/fields` used to be this paragraph's example, and it was wrong
 *
 * It was named here as the emitting-tsc-plus-bundler case, and it is the
 * opposite: `packages/fields/tsconfig.json` inherits the root's `noEmit: true`
 * and its own comment says so in as many words — `tsc` CHECKS, `dist` is written
 * by vite-plugin-dts. The example survived only because `readTsconfig` could not
 * parse that file at all (objectui#5367): the throw hit `effectiveNoEmit`'s
 * catch, the catch answered "emitting", and the wrong answer got written down as
 * a fact about the package.
 *
 * Fixing the parse therefore MOVES this gate's scope, once, in one place:
 * `@object-ui/fields` leaves the specifier leg, 13 published specifier-
 * preserving ESM packages become 12. It is the only membership change in the
 * repository — `@object-ui/auth`'s config throws today too, but it declares
 * `"noEmit": false` outright, so its verdict is unchanged and merely stops being
 * an accident.
 *
 * Letting it drop is deliberate, and it costs no coverage. Measured at ed35c23bb:
 * `fields`' sources carry 0 extensionless relative specifiers, so no live finding
 * leaves with it; its built `dist` carries 0 extensionless out of 155 relative
 * specifiers, because rolldown resolves them while bundling, so the property this
 * leg ratchets is not observable in what `fields` publishes. And the sources keep
 * a STRICTER guard than this heuristic: that tsconfig pins `"moduleResolution":
 * "nodenext"`, under which a missing relative extension is TS2835 and a bare
 * directory import is TS2834 — the compiler rejects in `fields`' own build step
 * what this leg would only have reported.
 *
 * @param {string} buildScript the package's `scripts.build`, or ''
 * @param {string} pkgDir absolute path to the package, for resolving `-p`
 */
export function buildPreservesSpecifiers(buildScript, pkgDir) {
  if (!buildScript) return false;
  return buildScript
    .split(/&&|\|\||;/)
    .map((step) => step.trim())
    .some((step) => {
      if (!/^tsc\b/.test(step)) return false;
      if (/\B--noEmit\b/.test(step)) return false;
      const project = /\s-(?:p|-project)\s+(\S+)/.exec(step)?.[1] ?? 'tsconfig.json';
      return !effectiveNoEmit(join(pkgDir, project));
    });
}

// ── the ledger ───────────────────────────────────────────────────────────────

/**
 * Packages measured to carry this defect that objectui#4538 did NOT fix.
 *
 * **Empty — every measured package has been cleared.** objectui#4538's own
 * scope was `@object-ui/react` plus the dependency closure its entry evaluates
 * through (`types`, `core`, `i18n`) — without those three the card's own
 * package stayed unloadable, so they were in scope by necessity rather than by
 * choice. Seven more packages carried the identical defect and were left for
 * their own cards: six (`auth`, `collaboration`, `fields`, `mobile`,
 * `permissions`, `providers`) were cleared under objectui#5214, and
 * `app-shell` — an order of magnitude larger than any of them, and split off
 * for its own card — under objectui#5357.
 *
 * An empty ledger is not a formality: while a name sat here the specifier leg
 * was a RATCHET, and with none it is a HARD REQUIREMENT. Any extensionless
 * relative specifier in any specifier-preserving package now fails the run on
 * the pull request that writes it, with no grandfathering left to hide behind.
 * Re-adding a name is therefore a deliberate act that owes a card and a reason,
 * not a way to get a red run green.
 *
 * It stays a ratchet in the other direction too: a package named here that is
 * now clean is itself a FINDING — the entry must be deleted in the commit that
 * fixes it, so the ledger cannot outlive the debt it records.
 *
 * Deliberately no per-package counts. This repository has been bitten by
 * hand-maintained numbers that nothing recomputes (see the note in
 * `.github/workflows/lint.yml`); a count here would go stale on its own clock
 * and still read as authoritative. The consequence is stated rather than
 * hidden: growth INSIDE an already-ledgered package is not caught. Those
 * packages are red-listed already, and the entry is removed only when the
 * package reaches zero.
 *
 * @type {Map<string, string>}
 */
export const SPECIFIER_DEBT = new Map();

/**
 * Packages whose published entry cannot evaluate under plain Node, and for which
 * that is a STATED PRODUCT BOUNDARY rather than a debt anyone intends to pay.
 *
 * Kept separate from SPECIFIER_DEBT on purpose: an entry here answers a
 * DIFFERENT question (is an unbundled consumer supported at all?), and merging
 * the two would let this gate become a grab-bag in which the defect it exists
 * for stops being visible.
 *
 * Formerly `LOAD_DEBT`, renamed by the ruling below. A map whose name says
 * "debt" reads as a promise to fix, and these three entries are not one — the
 * old name is what made the ledger aspirational rather than honest. The
 * previous spelling survives in `packages/app-shell/CHANGELOG.md`, which
 * records the day that entry was added; this is the map it names.
 *
 * ## The boundary, and who ruled it
 *
 * **Unbundled Node consumption is NOT supported for style-carrying plugin
 * packages.** Ruled on objectui#5384 (2026-08-20), taken over the three
 * packages as a group rather than one at a time, exactly as the card asked.
 * The maintainer accepted the triage batch verbatim: 「其他接受你的建议。」
 *
 * The card put three directions on the table — move the stylesheet import off
 * module scope so the entry loads, declare the boundary, or something
 * upstream-shaped for `react-grid-layout` / `maplibre-gl` — and the ruling took
 * the second, with its reason recorded: *"No known unbundled-Node consumer
 * exists; converting a zero-pull capability gap into permanent maintained
 * machinery is the shape the startup rule rejects."*
 *
 * That premise was re-measured when this ledger was reworded, not inherited.
 * Every consumer of these three packages in this repository reaches them
 * through a bundler: `vite` in `apps/console`, `examples/console-starter` and
 * `examples/byo-backend-console`, and Next's `transpilePackages` in `apps/site`
 * — which is the key that makes the stylesheet work there. Nothing declares
 * them under `serverExternalPackages`, so Next's Node side never loads these
 * entries itself either, and the sibling `objectstack` repository names them
 * only in comments and changeset fixtures. Zero unbundled-Node consumers, and
 * the searches that returned zero were counter-probed with terms known to be
 * present.
 *
 * Revisit ONLY on a real consumer request, which reopens objectui#5384 as a
 * DESIGN card rather than a debt payment: the question to re-answer is whether
 * these packages should carry their stylesheet at module scope at all, and it
 * needs the consumer's shape to answer.
 *
 * ## What each entry excuses, measured rather than assumed
 *
 * All three die on the same code, and it is not this gate's defect class:
 * `ERR_UNKNOWN_FILE_EXTENSION`. Resolution SUCCEEDS — both stylesheets are
 * exported by their own packages — and evaluation fails, because Node has no
 * loader for `.css` at all. Measured directly under Node 22.22.2:
 *
 *     TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".css"
 *       for …/react-grid-layout/css/styles.css
 *     TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".css"
 *       for …/maplibre-gl/dist/maplibre-gl.css
 *
 * ## What the boundary costs, stated here rather than discovered later
 *
 * This map matches by PACKAGE NAME, not by error code, so the load leg cannot
 * speak for these three AT ALL: a genuine extensionless-specifier regression in
 * any of them would print as a boundary line here instead of failing the run.
 * That was true while they were debt and it is true now — permanence just makes
 * it permanent, so it is written down instead of remembered.
 *
 * What carries the guard instead is the SPECIFIER leg, which became a hard
 * requirement the moment SPECIFIER_DEBT emptied, and the ruling keeps it there
 * deliberately. It is measured, not hoped: objectui#5357's ablation reverted
 * app-shell's specifiers and watched the specifier leg redden while the load
 * leg went on printing a ledger line.
 *
 * An entry here is therefore never a way to turn a red run green. It owes what
 * these three pay: the boundary in words, the ruling that made it permanent,
 * and the consumer question it answers — a bare name would be a mystery to
 * whoever reads it next. `check-node-esm-load.test.ts` pins that every entry
 * cites a ruling, so an unexplained one fails the suite.
 *
 * The ratchet in the other direction is kept exactly as it was: a package named
 * here whose entry DOES load is a finding, because from that moment the
 * exemption costs coverage and buys nothing.
 *
 * @type {Map<string, string>}
 */
export const UNBUNDLED_NODE_UNSUPPORTED = new Map([
  [
    '@object-ui/app-shell',
    'unbundled Node is not supported for this package, by ruling objectui#5384 — a stated boundary, ' +
      "not debt. It reaches react-grid-layout's stylesheet through the STATIC " +
      '`@object-ui/plugin-dashboard` imports in DashboardView and ReportView, so Node stops on the same ' +
      'ERR_UNKNOWN_FILE_EXTENSION that package does. Its own specifier debt is paid and its own artifact ' +
      'is clean — uncovered by objectui#5357, because while app-shell emitted extensionless specifiers ' +
      'its first error was ERR_MODULE_NOT_FOUND on its own file, which masked the stylesheet entirely ' +
      '(the first-failure shape objectui#5214 measured: 5 predicted red, 10 observed)',
  ],
  [
    '@object-ui/plugin-dashboard',
    'unbundled Node is not supported for this package, by ruling objectui#5384 — a stated boundary, ' +
      "not debt. DashboardGridLayout imports react-grid-layout's stylesheet " +
      '(`react-grid-layout/css/styles.css`) at module scope, and Node has no loader for `.css`, so the ' +
      'entry resolves and then dies with ERR_UNKNOWN_FILE_EXTENSION. Every supported consumer bundles it',
  ],
  [
    '@object-ui/plugin-map',
    'unbundled Node is not supported for this package, by ruling objectui#5384 — a stated boundary, ' +
      "not debt. ObjectMap imports maplibre-gl's stylesheet (`maplibre-gl/dist/maplibre-gl.css`) at " +
      'module scope; same ERR_UNKNOWN_FILE_EXTENSION and same ruling as @object-ui/plugin-dashboard',
  ],
]);

// ── leg 1: the specifiers ────────────────────────────────────────────────────

/**
 * Extensions Node's ESM resolver accepts as written, so the specifier is done.
 *
 * `.json` needs an import attribute to actually load and `.css` never loads at
 * all — but neither is THIS defect, and grading them here would silently widen
 * a gate whose whole value is that it names one thing precisely.
 */
export const EXPLICIT_EXTENSION = /\.(js|jsx|mjs|cjs|json|css|svg|png|woff2?)$/;

/**
 * The `moduleSpecifiers()` kinds Node's ESM resolver actually has to resolve.
 *
 * The shared scanner reads all five forms that make a module edge. Two of them
 * are CommonJS — `require('…')` and `import x = require('…')` — and the ESM
 * resolver never sees either, so grading them here would answer a different
 * question with this gate's error message. Measured on this repository before
 * excluding them: ZERO relative edges of either kind exist in any
 * specifier-preserving package, so the exclusion narrows nothing today and is
 * written down rather than left to be discovered if one ever appears.
 *
 * The four kept forms are exactly what the retired regex matched, so the scope
 * of the leg is unchanged by the parser swap. `import()-type` is erased from the
 * JavaScript emit and survives only in the `.d.ts`, which is graded for the same
 * conservative reason `buildPreservesSpecifiers` grades a tsc-plus-bundler
 * pipeline: a false positive lands in a ledger with a reason, a false negative
 * ships.
 */
export const ESM_MODULE_EDGE = new Set(['import', 'export', 'dynamic import()', 'import()-type']);

/**
 * Every relative module specifier a source file names, read from the PARSER.
 *
 * ## Why this is not a regex any more (objectui#5382)
 *
 * It used to be one, over a source that a `withoutCommentedCode()` helper had
 * blanked comments out of. That helper blanked BLOCK comments first, with a
 * pattern that had no notion of already being inside a `//` line, so any slash-
 * star sequence occurring in ordinary line-comment prose opened a comment that
 * ran to the next star-slash anywhere in the file — blanking every line in
 * between, live code included.
 *
 * That is not exotic prose. A line comment naming a package glob, a path
 * pattern or a wildcard import is ordinary here, and one such comment in
 * `packages/app-shell/src/preview/DraftChangesPanel.tsx` hid the real `import`
 * eight lines below it. Re-measured on `main` at 478ec54ce, over the 805 files
 * of the 13 specifier-preserving packages: the regex found 2132 relative
 * specifiers and the TypeScript parser found 2133 — one live import invisible
 * to a leg that has been a HARD REQUIREMENT since SPECIFIER_DEBT emptied, which
 * is the direction that ships a broken artifact behind a green run.
 *
 * The fix is not a cleverer pattern. A pattern cannot answer "am I inside a
 * comment", and the two `replace` calls whose ORDER decided the answer were the
 * defect. Asking the parser removes the whole class at once: comments, strings,
 * template literals and regex literals stop being questions this gate has an
 * opinion about. `readTsconfig()` above was a SEPARATE live instance of the same
 * class — regexes over a tsconfig's raw text, deliberately left for its own card
 * — and it is closed the same way, by TypeScript's own tsconfig reader
 * (objectui#5367).
 *
 * ## Why the sibling gate's scanner rather than a second parser
 *
 * `moduleSpecifiers()` is `check-phantom-dependencies.mjs`'s TypeScript-backed
 * scanner, already shared with `check-package-self-import.mjs` for the reason
 * that applies here too: three gates that each decide for themselves what a
 * module edge IS will eventually disagree, and the one that drifts stops
 * covering a form without anybody noticing.
 *
 * ## The line number is the SPECIFIER's, not the statement's
 *
 * `moduleSpecifiers()` reports where the STATEMENT starts, which is the right
 * answer for a gate asking "which package does this file name". This one prints
 * a line a reader is expected to jump to and check against `tsc`, and `tsc`
 * reports the error at the specifier — measured, for an import whose statement
 * opens on line 6 and whose specifier sits on line 8:
 *
 *     src/index.ts(8,8): error TS2835: Relative import paths need explicit file
 *       extensions in ECMAScript imports when '--moduleResolution' is 'node16'
 *       or 'nodenext'. Did you mean './a.js'?
 *
 * The two disagree for 255 of this repository's 2066 relative import/export
 * specifiers — 12.3%, by up to 7 lines. The retired regex matched at `from`,
 * which shares the specifier's line, so it was accurate and this must not
 * regress: a gate whose line numbers do not match the compiler's teaches the
 * reader to stop trusting them. (That lesson was paid for once already, by a
 * block-comment strip that moved every finding in `packages/react/src/index.ts`
 * six lines up — the license header.) Verified by construction: over all 2132
 * specifiers the old method could see, the new one reports the identical
 * specifier-and-line pair for every single entry.
 *
 * The literal is LOCATED, never re-parsed. The AST has already decided that
 * this statement carries this specifier, and an import or export declaration
 * holds no other string literal, so the first occurrence of the quoted text at
 * or after the statement's own start IS that literal. Nothing here decides what
 * is code — the parser did. If the text cannot be found (a specifier written
 * with an escape), the statement's own line is used rather than a guess.
 *
 * @param {string} source the file's text, unmodified
 * @param {string} fileName only for the parser's diagnostics
 * @returns {{ specifier: string, kind: string, line: number }[]} in source order
 */
export function relativeSpecifiers(source, fileName) {
  const lineStarts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '\n') lineStarts.push(i + 1);
  }

  const found = [];
  for (const use of moduleSpecifiers(source, fileName)) {
    if (!ESM_MODULE_EDGE.has(use.kind)) continue;
    if (!/^\.\.?(?:\/|$)/.test(use.specifier)) continue;

    const statementStart = lineStarts[use.line - 1] + (use.column - 1);
    let literalAt = -1;
    for (const quote of ['"', "'"]) {
      const at = source.indexOf(quote + use.specifier + quote, statementStart);
      if (at !== -1 && (literalAt === -1 || at < literalAt)) literalAt = at;
    }
    const line =
      literalAt === -1
        ? use.line
        : use.line + source.slice(statementStart, literalAt).split('\n').length - 1;

    found.push({ specifier: use.specifier, kind: use.kind, line });
  }
  return found;
}

/** Every source file a specifier-preserving build emits from `srcDir`. */
export function emittedSources(srcDir, relativeTo = srcDir) {
  const files = [];
  for (const entry of readdirSync(srcDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(srcDir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...emittedSources(full, relativeTo));
      continue;
    }
    if (!/\.[cm]?tsx?$/.test(entry.name)) continue;
    // Tooling material is excluded by every one of these packages' build
    // tsconfigs, so it is not part of what ships. Read from the sibling gate's
    // regex rather than re-spelled, so the two cannot drift apart.
    if (TOOLING_FILE.test(full)) continue;
    files.push(full);
  }
  return files;
}

/**
 * Whether a relative specifier names a real module, and so must carry an
 * extension.
 *
 * Existence is checked rather than assumed: a specifier that resolves to
 * nothing is either dead code the emit drops or a defect of a different class,
 * and reporting it here would be a false positive on this gate's own terms.
 */
export function resolvesToModule(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  for (const ext of ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx']) {
    if (existsSync(base + ext)) return true;
  }
  for (const name of ['index.ts', 'index.tsx', 'index.js']) {
    if (existsSync(join(base, name))) return true;
  }
  return false;
}

/**
 * Findings for one package's sources.
 *
 * The file's text is handed to the parser UNMODIFIED. Nothing masks, strips or
 * blanks it first — that step is what objectui#5382 was: a comment mask hid a
 * live import from a leg that is a hard requirement.
 */
export function scanSpecifiers(pkg) {
  const findings = [];
  if (!existsSync(pkg.srcDir)) return findings;
  for (const file of emittedSources(pkg.srcDir)) {
    const source = readFileSync(file, 'utf8');
    for (const { specifier, line } of relativeSpecifiers(source, file)) {
      if (EXPLICIT_EXTENSION.test(specifier)) continue;
      if (!resolvesToModule(file, specifier)) continue;
      findings.push({ file, line, spec: specifier });
    }
  }
  return findings;
}

// ── leg 2: the load ──────────────────────────────────────────────────────────

/**
 * The file an ESM consumer reaches through the package's own `exports` map.
 *
 * Read from the manifest rather than guessed, in the order Node consults, so
 * the gate imports what a real consumer imports.
 */
export function esmEntryOf(manifest) {
  const dot = manifest.exports?.['.'];
  const fromExports =
    typeof dot === 'string' ? dot : dot?.import ?? dot?.default ?? dot?.node;
  return fromExports ?? manifest.module ?? manifest.main ?? null;
}

/**
 * Import one entry in a CHILD `node`, and report what happened.
 *
 * A child process, because a failed import can leave the parent's module
 * registry poisoned, and because a package that calls `process.exit` on load
 * would otherwise take the gate with it. No loader hooks, no bundler, no
 * `--experimental-*`: this is the plain resolver the card measured against.
 */
export function importEntry(entryPath, timeoutMs = 60_000) {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `await import(${JSON.stringify(entryPath)});`],
    { encoding: 'utf8', timeout: timeoutMs },
  );
  if (result.status === 0) return { ok: true };
  const stderr = result.stderr ?? '';
  const code = /\b(ERR_[A-Z_]+)\b/.exec(stderr)?.[1] ?? (result.signal ? `signal:${result.signal}` : 'unknown');
  const message =
    stderr.split('\n').find((l) => /Error|Cannot find/.test(l))?.trim() ??
    stderr.trim().split('\n')[0] ??
    '';
  const missing = /Cannot find module '([^']+)'/.exec(stderr)?.[1] ?? null;
  return { ok: false, code, message: message.slice(0, 300), missing };
}

/**
 * Which workspace package OWNS the path an import could not find.
 *
 * This is objectui#4538's central observation made mechanical. The card was
 * filed from `@object-ui/plugin-charts`, whose own emitted entry is clean; the
 * failure appeared only once evaluation crossed into `@object-ui/react`. The
 * same shape dominates a full run — `plugin-grid`, `plugin-list`,
 * `plugin-timeline` and `plugin-view` all fail on
 * `packages/mobile/dist/useBreakpoint`, which is `@object-ui/mobile`'s defect,
 * not theirs.
 *
 * Reporting those against the importing package would produce a dozen findings
 * for one cause and make the ledger meaningless. Attribution puts each failure
 * on the package that has to fix it.
 *
 * @returns {string|null} the owning package's name, or null if it is not one of ours
 */
export function attributeMissingModule(missingPath, packages, root) {
  if (!missingPath) return null;
  const relative = missingPath.startsWith(root) ? missingPath.slice(root.length + 1) : missingPath;
  let best = null;
  for (const pkg of packages) {
    if (!relative.startsWith(`${pkg.dir}/`)) continue;
    if (!best || pkg.dir.length > best.dir.length) best = pkg;
  }
  return best?.name ?? null;
}

// ── the run ──────────────────────────────────────────────────────────────────

function main(argv) {
  const specifiersOnly = argv.includes('--specifiers-only');
  const noBuild = argv.includes('--no-build');
  // Buys the expensive form of the same invariant: with the cache off, every
  // artifact graded below is one this run produced, so leg 3 has nothing left
  // to find. Opt-in because it is measured at ~1065x the cached build — see
  // "Building is not producing" at the top of this file.
  const forceBuild = argv.includes('--force-build');
  if (noBuild && forceBuild) {
    console.error('--no-build and --force-build ask for opposite things; pass one.');
    return 1;
  }
  const root = resolve(scriptDir, '..');

  const packages = discoverPackages(root).filter((p) => !p.manifest.private);
  if (packages.length < MIN_PACKAGES) {
    console.error(
      `only ${packages.length} published packages discovered (expected at least ${MIN_PACKAGES}). ` +
        'The release group or the manifest walk is broken; every assertion below would pass while reading nothing.',
    );
    return 1;
  }

  let failed = false;

  // ── leg 1 ──
  const esmPackages = packages.filter((p) => p.manifest.type === 'module');
  const preserving = esmPackages.filter((p) =>
    buildPreservesSpecifiers(p.manifest.scripts?.build ?? '', join(root, p.dir)),
  );
  console.log(
    `Specifier leg: ${preserving.length} of ${esmPackages.length} published ESM packages have a ` +
      'specifier-preserving build.',
  );
  if (preserving.length === 0) {
    console.error('no package was judged specifier-preserving — the build-script criterion has stopped matching.');
    return 1;
  }

  const dirty = new Set();
  for (const pkg of preserving) {
    const findings = scanSpecifiers(pkg);
    if (findings.length === 0) continue;
    dirty.add(pkg.name);
    if (SPECIFIER_DEBT.has(pkg.name)) {
      console.log(`  ledgered  ${pkg.name}: ${findings.length} extensionless (${SPECIFIER_DEBT.get(pkg.name)})`);
      continue;
    }
    failed = true;
    console.error(`\n✗ ${pkg.name}: ${findings.length} relative specifier(s) without an explicit extension.`);
    console.error(
      "  Node's ESM resolver does not extension-search relative specifiers, and this package's build " +
        'emits them unchanged, so its published entry cannot be imported under plain Node.',
    );
    for (const f of findings.slice(0, 10)) {
      console.error(`    ${f.file.slice(root.length + 1)}:${f.line}  '${f.spec}'  →  '${f.spec}.js'`);
    }
    if (findings.length > 10) console.error(`    … and ${findings.length - 10} more`);
  }

  for (const [name, reason] of SPECIFIER_DEBT) {
    if (dirty.has(name)) continue;
    if (!preserving.some((p) => p.name === name)) continue;
    failed = true;
    console.error(
      `\n✗ ${name} is in SPECIFIER_DEBT but is now clean (${reason}).\n` +
        '  Delete its entry in the commit that fixed it — a ledger that outlives its debt hides the next regression.',
    );
  }
  if (!failed) console.log('Specifier leg: no un-ledgered package emits an extensionless relative specifier.');

  if (specifiersOnly) {
    // The second door into this script. It reads SOURCES and never looks at
    // an artifact, so it has no provenance question to answer — but it must
    // not be read as having answered the load leg's, which is why the line
    // says what was not run rather than only that something passed.
    console.log(
      '\n--specifiers-only: the load leg (which builds, and grades only artifacts this tree ' +
        'produced) was not run, so nothing above is a statement about built artifacts.',
    );
    return failed ? 1 : 0;
  }

  // ── leg 2 ──
  if (!noBuild) {
    console.log(
      forceBuild
        ? '\nBuilding every published package with the cache OFF (TURBO_FORCE), so every artifact the ' +
            'load leg grades below is one this run produced…'
        : '\nBuilding every published package. turbo shares one cache across every worktree of this ' +
            'checkout, so this build can be a replay of a sibling worktree\'s — the provenance leg ' +
            'below reads each task log and refuses to grade what this tree did not produce ' +
            '(objectui#7276)…',
    );
    try {
      execFileSync('pnpm', ['build'], {
        cwd: root,
        stdio: 'inherit',
        env: forceBuild ? { ...process.env, TURBO_FORCE: 'true' } : process.env,
      });
    } catch (error) {
      console.error(`\n✗ the build failed, so the load leg has nothing to grade: ${error.message}`);
      return 1;
    }
  }

  // ── leg 3 ──
  // Asked BEFORE anything is graded, because the answer decides whether a
  // verdict about these artifacts would be a verdict about this tree at all.
  const gradable = esmPackages.filter((p) => esmEntryOf(p.manifest));
  if (gradable.length === 0) {
    console.error(
      'no published ESM package declares an importable entry — the provenance and load legs would ' +
        'both examine nothing, which is the one answer they are not allowed to give.',
    );
    return 1;
  }
  const provenance = new Map();
  const refused = [];
  for (const pkg of gradable) {
    const verdict = buildProvenance(join(root, pkg.dir));
    provenance.set(pkg.name, verdict);
    if (verdict.code !== PROVENANCE_OK) refused.push({ pkg, ...verdict });
  }
  console.log(
    `\nProvenance leg: ${gradable.length - refused.length} of ${gradable.length} gradable entries were ` +
      'built by this tree.',
  );
  if (refused.length > 0) {
    failed = true;
    console.error(
      `\n✗ ${refused.length} of ${gradable.length} entries REFUSED — the load leg does not grade what ` +
        'this tree did not produce, so it has nothing to say about them. Grouped by why, and each one ' +
        "names the tree it came from, because a GREEN over another tree's artifacts is the direction " +
        'objectui#7276 was filed for and the one no exit code used to distinguish.',
    );
    // Grouped, and the remedy printed once per group: the same sentence
    // repeated forty times is how a reader stops reading the paths, which are
    // the part that says WHERE the artifacts came from.
    for (const code of Object.keys(PROVENANCE_REMEDY)) {
      const group = refused.filter((r) => r.code === code);
      if (group.length === 0) continue;
      console.error(`\n  ${code} (${group.length}):`);
      for (const r of group.slice(0, 10)) {
        const detail = r.producedIn ?? `nothing readable at ${join(r.pkg.dir, TURBO_TASK_LOG)}`;
        console.error(`    ${r.pkg.name}  ←  ${detail}`);
      }
      if (group.length > 10) console.error(`    … and ${group.length - 10} more`);
      console.error(`  → ${PROVENANCE_REMEDY[code]}`);
    }
  }

  let loaded = 0;
  const loadFindings = [];
  const notImportable = [];
  for (const pkg of esmPackages) {
    const entry = esmEntryOf(pkg.manifest);
    if (!entry) {
      // Not a defect: a `bin`-only CLI (`@object-ui/create-plugin`) and a built
      // web application (`@object-ui/runner`, whose dist is `index.html` plus
      // assets) declare no importable entry because they are not libraries.
      // Named on every run rather than skipped silently — an exclusion nobody
      // can see is how a gate quietly stops covering things.
      notImportable.push(`${pkg.name} (${pkg.manifest.bin ? 'bin-only CLI' : 'no importable entry declared'})`);
      continue;
    }
    if (provenance.get(pkg.name)?.code !== PROVENANCE_OK) continue;
    const entryPath = join(root, pkg.dir, entry);
    if (!existsSync(entryPath)) {
      loadFindings.push({
        name: pkg.name,
        owner: pkg.name,
        code: 'no-build-output',
        message: `${entry} does not exist after the build`,
      });
      continue;
    }
    const outcome = importEntry(entryPath);
    if (outcome.ok) {
      loaded++;
      if (UNBUNDLED_NODE_UNSUPPORTED.has(pkg.name)) {
        failed = true;
        console.error(
          `\n✗ ${pkg.name} is named as unsupported under unbundled Node, but its entry now loads.\n` +
            '  Delete its entry in the commit that made it loadable: the boundary no longer describes ' +
            'this package, and while the name sits here the load leg cannot speak for it at all.',
        );
      }
      continue;
    }
    loadFindings.push({
      name: pkg.name,
      owner: attributeMissingModule(outcome.missing, packages, root) ?? pkg.name,
      ...outcome,
    });
  }

  console.log(`\nLoad leg: ${loaded} of ${esmPackages.length} published ESM entries imported and evaluated.`);
  if (refused.length > 0) {
    // Named on every run for the same reason the two lines below are: a
    // shortfall a reader cannot see is how a count starts meaning nothing.
    console.log(`  refused on provenance, NOT graded: ${refused.length} (named by the provenance leg above)`);
  }
  if (notImportable.length > 0) {
    console.log(`  not importable by design: ${notImportable.join(', ')}`);
  }
  // Named on every run for the same reason the line above is: the packages this
  // gate is not allowed to speak for are the ones a reader most needs to see. A
  // count that never reaches the total is honest only while the shortfall is
  // legible from the run itself.
  const boundary = esmPackages.filter((p) => UNBUNDLED_NODE_UNSUPPORTED.has(p.name)).map((p) => p.name);
  if (boundary.length > 0) {
    console.log(
      '  unbundled Node unsupported, by ruling rather than by debt (each entry names its ruling in ' +
        `UNBUNDLED_NODE_UNSUPPORTED): ${boundary.join(', ')}`,
    );
  }
  if (loaded < MIN_LOADED) {
    console.error(
      `✗ only ${loaded} entries evaluated (expected at least ${MIN_LOADED}). This run proved nothing — ` +
        'a green verdict here would be the "imported nothing" failure objectui#4538 named.',
    );
    failed = true;
  }

  for (const f of loadFindings) {
    // Two different verdicts, printed as two different words. `ledgered` means
    // a debt someone still owes; `by design` means a boundary that was ruled,
    // and reading the second as the first is how a permanent statement gets
    // mistaken for a worklist item.
    const byDesign = UNBUNDLED_NODE_UNSUPPORTED.has(f.name);
    const ledgered = byDesign || (f.code === 'ERR_MODULE_NOT_FOUND' && SPECIFIER_DEBT.has(f.owner));
    const via = f.owner !== f.name ? ` (via ${f.owner})` : '';
    if (!ledgered) failed = true;
    const line = `${f.name}${via}: ${f.code} — ${f.message}`;
    if (byDesign) console.log(`  by design ${line}`);
    else if (ledgered) console.log(`  ledgered ${line}`);
    else console.error(`✗ ${line}`);
  }

  return failed ? 1 : 0;
}

if (isEntrypoint(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}

export { main };
