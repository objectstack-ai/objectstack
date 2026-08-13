#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * dispatch-gates (#7341 item 4) — map a card's file surface to the `check:*`
 * gate families that watch it, derived from the tree AT RUNTIME.
 *
 *   node scripts/pm/dispatch-gates.mjs <path> [<path> ...]   # e.g. packages/spec/src/data/filter.zod.ts
 *   node scripts/pm/dispatch-gates.mjs --self-test
 *
 * ## Why derived, never listed
 *
 * The step-5 dispatch template's "Local gates for this card" line is filled by
 * the PM, and the gate inventory is a thing that expires SAME-DAY: it grew
 * twice in one 2026-08-08/09 shift (#6672 added `check:kernel-hook-pairs`,
 * #6661 added `check:app-nav-i18n`), and even "the farm lives in lint.yml" is
 * a memory-shaped claim — measured on #7341's own dispatch-time survey, checks
 * also live in ci.yml / spec-liveness-check.yml / validate-deps.yml /
 * release.yml / showcase-smoke.yml. #6492 is the canonical incident for a
 * second copy of a list rotting inside prose (three mutually-contradicting
 * counts, drifting within one hour), and #6865 for relaying remembered
 * workflow facts into a dispatch prompt (four of six required-context names
 * lived in a different file than claimed). So this script embeds NO list of
 * checks and NO map from paths to checks: every run re-reads
 * `.github/workflows/*.yml`, resolves each `check:*` script through
 * package.json, and scans the check scripts' own sources for the path
 * literals they operate on. When the farm grows, the next run sees it.
 *
 * ## What the output means (and what it cannot promise)
 *
 * For each input path, checks are matched by the path literals discoverable in
 * their sources ("watch hints"). That derivation is honest but heuristic:
 *
 *   - a MATCHED check is one whose own source names a directory/file that
 *     covers the input path — high-signal, paste it into the dispatch prompt.
 *     It is printed as the RUNNABLE invocation (`pnpm --filter <pkg> run
 *     check:x` for a package-scoped gate, `pnpm check:x` for a root-scoped
 *     one), not as the bare script name: the bare name sends a dev to the root
 *     `package.json`, where a package-scoped gate is absent and therefore reads
 *     as nonexistent (#7440);
 *   - a check with NO discoverable path hints is listed once in the
 *     "repo-wide / undetermined" bucket. It is NOT known to be irrelevant —
 *     many gates read the whole tree (check:nul-bytes) or a convention rather
 *     than a path. The PM's judgment call stays a judgment call; what this
 *     script removes is the memory-shaped half (which named checks exist and
 *     where they live);
 *   - a CONVENTION-TRIGGERED check is one the path derivation can never reach,
 *     because it counts a population it computes for itself and so names no
 *     path literal to match. Those are derived from the change's KIND instead
 *     and printed under their own heading — see CHANGE_KIND_GATES.
 *
 * The output is print-only and exits 0 on a completed derivation; a run that
 * cannot read the workflows or package.json exits non-zero (#4690: unreadable
 * input must never look like an empty answer).
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import process from 'node:process';

const ROOT = new URL('../..', import.meta.url).pathname;

// ---------------------------------------------------------------------------
// Extraction — pure functions over file contents, self-testable offline.
// ---------------------------------------------------------------------------

/**
 * A `run:` value that is a YAML block-scalar HEADER (`|`, `>`, with any
 * chomping/indentation indicator) carries no command of its own: the commands
 * are the lines indented beneath the key.
 */
const BLOCK_SCALAR_HEADER = /^[|>][+-]?\d*$/;

/**
 * The command text of every `run:` step in a workflow, one string per step,
 * with whole-line `#` comments removed.
 *
 * ## Why the body of a block scalar has to be read
 *
 * The obvious spelling — one regex for `run:` and take the rest of the line —
 * reads only the steps whose command fits on the `run:` line itself. A step
 * written as a block scalar puts `|` there and its commands on the FOLLOWING
 * lines, so that spelling collected the string "|" and never saw the commands.
 * Measured on this tree at the time of writing: six gate families were invoked
 * exclusively from block-scalar bodies (`check-adr-0087-registration`,
 * `check-empty-changeset`, `check-shard-attestation`, `check-osv-exemptions`,
 * `check-test-completeness`, `check-cross-package-test-inputs`) and were
 * therefore absent from the derivation ENTIRELY — not matched, and not in the
 * "undetermined" bucket either, because a family that is never discovered has
 * no entry to fall into it. That is the one output shape this script's contract
 * forbids (a gate the derivation cannot mention at all), and it cost PR #8399 a
 * CI round: its declared-breaking changeset derived `check-changeset-no-major`
 * (a one-line `run:`, so visible) but not `check-adr-0087-registration` (a
 * block-scalar body, so invisible), which is the gate that actually reddened.
 *
 * Nothing downstream needed changing: `check-adr-0087-registration.mjs` names
 * `.changeset` in its own source, so the ordinary watch-hint match fires as
 * soon as the family is discovered at all. The bug was never in the matching.
 *
 * ## Why comments are stripped, and why only whole-line ones
 *
 * Reading a block body means reading the shell comments inside it, and this
 * tree's workflow bodies discuss gates by name at length (ci.yml's shard job
 * spells `check-shard-attestation.mjs` in a comment explaining that gate's own
 * classifier). "Mentions a gate" is not "runs a gate", and a family discovered
 * from prose would be a fabricated lead — the same failure the "22 leads is the
 * same as none" note below rejects for a wider heuristic. Only whole-line
 * comments are dropped: a trailing `# note` after a real command sits on a line
 * whose command still has to be read, and stripping from the first `#` anywhere
 * would corrupt commands that legitimately contain one inside a quoted string.
 *
 * Measured both ways on this tree: stripping changes no family's discovery
 * today (every gate named in a body comment is also really invoked somewhere).
 * It is here so that stops being luck.
 */
export function runCommandTexts(workflowText) {
  const lines = workflowText.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^([ \t]*)run:[ \t]*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const [, indent, inline] = m;
    if (!BLOCK_SCALAR_HEADER.test(inline.trim())) {
      out.push(inline.trim());
      continue;
    }
    // Block scalar: the body is every following line indented deeper than the
    // key (blank lines belong to it too). Advancing `i` past the body is what
    // keeps a `run:` MENTIONED inside a body from being parsed as a new key.
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (lines[j].trim() === '') {
        body.push('');
        continue;
      }
      if (/^[ \t]*/.exec(lines[j])[0].length <= indent.length) break;
      body.push(lines[j]);
    }
    out.push(body.filter((l) => !/^[ \t]*#/.test(l)).join('\n'));
    i = j - 1;
  }
  return out;
}

/**
 * Pull every `check:*` invocation out of a workflow file's `run:` steps,
 * with the pnpm --filter package (if any) and the workflow's file name.
 */
export function extractCheckInvocations(workflowText, workflowFile) {
  const out = [];
  for (const cmd of runCommandTexts(workflowText)) {
    for (const m of cmd.matchAll(/pnpm\s+(?:--filter\s+(\S+)\s+)?(?:run\s+)?(check:[\w:-]+)/g)) {
      out.push({ check: m[2], filter: m[1] ?? null, workflow: workflowFile });
    }
    for (const m of cmd.matchAll(/node\s+(scripts\/[\w./-]*check-[\w.-]+\.mjs)/g)) {
      out.push({ check: m[1], filter: null, workflow: workflowFile, direct: true });
    }
  }
  return out;
}

/** Resolve a `check:x` script name to the script files it runs, via a package.json `scripts` map. */
export function resolveCheckToFiles(checkName, scriptsMap) {
  const cmd = scriptsMap[checkName];
  if (!cmd) return [];
  // The conventional script shape names its file twice (`--self-test && run`) — dedupe.
  return [...new Set([...cmd.matchAll(/(scripts\/[\w./-]+\.(?:mjs|cjs|js|sh))/g)].map((m) => m[1]))];
}

/**
 * Scan a check script's source for the path-ish string literals it operates
 * on. A hint is a quoted string that contains a `/` (or names a top-level
 * dotted dir) and looks like a repo path rather than a URL or a regex.
 */
export function extractWatchHints(scriptSource) {
  const hints = new Set();
  for (const m of scriptSource.matchAll(/['"`]([^'"`\n]{2,120})['"`]/g)) {
    const s = m[1];
    if (/^(https?:|[A-Z_]+=|-{1,2}\w)/.test(s)) continue;
    if (!/^[\w.@][\w.@/*-]*$/.test(s)) continue;
    const looksPathy = s.includes('/') || /^\.(claude|changeset|github|gitattributes)\b/.test(s);
    if (!looksPathy) continue;
    hints.add(s.replace(/\/+$/, ''));
  }
  return [...hints];
}

/**
 * Render an invocation a dev can paste and run, from the same parse the
 * workflow line produced. The script NAME alone is not runnable for a
 * package-scoped check: `check:doc-formula-expressions` lives in
 * `@objectstack/lint`, not in the root `package.json`, so a dev who searched
 * the obvious place found nothing and concluded the gate did not exist — twice,
 * in independent sessions, within one hour (#7440, PR #7416 / #7417). The
 * `--filter` package is the one piece of provenance this tool parsed and then
 * dropped, and it is the piece needed to run the thing.
 */
export function runnableInvocation({ check, filter, direct }) {
  if (direct) return `node ${check}`; // already a script path, never a pnpm script
  if (filter) return `pnpm --filter ${filter} run ${check}`;
  return `pnpm ${check}`;
}

/**
 * Does a watch hint cover an input path? Prefix either way, with globs
 * collapsed. A hint that collapses to a bare top-level directory name
 * (`packages`, `scripts` — no slash, not a dotted dir) is rejected as too
 * generic: it would match every file under the tree's biggest directories and
 * drown the signal the matched-via column exists to carry.
 */
export function hintCovers(hint, inputPath) {
  const plain = hint.replace(/\*\*?/g, '').replace(/\/+$/, '').replace(/\/$/, '');
  if (plain.length < 2) return false;
  if (!plain.includes('/') && !plain.startsWith('.')) return false;
  return inputPath.startsWith(plain) || plain.startsWith(inputPath);
}

// ---------------------------------------------------------------------------
// Change-kind derivation — the gates a path match can never reach
// ---------------------------------------------------------------------------

/**
 * Is this path a test file, judged the way the gates below judge it?
 *
 * Both gates classify by the FILENAME infix (`*.test.*` / `*.spec.*`), not by
 * directory: a helper at `__tests__/fixtures.ts` is test-adjacent but neither
 * gate counts it — it falls in their NON-test population, where the ordinary
 * blocking lint rule applies instead. Matching directories here would name two
 * gates that cannot move, which is the failure mode this whole script exists to
 * avoid. The extension set is the UNION of the two gates' own (one counts
 * `.ts`/`.tsx`, the other also `.mts`/`.cts`); these are leads to run locally,
 * not verdicts, so the wider side is the safe one.
 */
export function isTestFilePath(path) {
  return /\.(test|spec)\.(ts|tsx|mts|cts)$/.test(path);
}

/**
 * Does this path name an i18n extract config, judged the way `check:i18n`
 * judges it? `scripts/check-i18n-bundles.mjs` (`findConfigs`, ~line 107) tests
 * the FILENAME and additionally requires the file to sit under a `scripts/`
 * directory: `e.name === 'i18n-extract.config.ts' && p.includes('/scripts/')`.
 * Mirrored exactly rather than approximated — a copy that widened the test
 * would name a gate that cannot move, the failure mode this whole script
 * exists to avoid.
 */
export function isExtractConfigPath(path) {
  return basename(path) === 'i18n-extract.config.ts' && path.includes('/scripts/');
}

/**
 * The package directory that OWNS an extract config: everything above the
 * `scripts/` segment `isExtractConfigPath` required. Returns null when the
 * owner would collapse to a bare top-level directory (a config sitting at
 * `packages/scripts/…`) — such an owner covers the entire tree below it, which
 * is the same over-broad match `hintCovers` rejects for watch hints.
 */
export function owningPackageOfExtractConfig(configPath) {
  const i = configPath.indexOf('/scripts/');
  if (i < 0) return null;
  const owner = configPath.slice(0, i);
  return owner.includes('/') ? owner : null;
}

/**
 * Is this input path inside a package that owns an extract config?
 *
 * The WHOLE owning package counts, the config file included. Narrowing to the
 * object definitions would under-cover: the extraction reads whatever each
 * package's config enumerates, and the config itself is part of the trigger
 * surface — edit it and the emitted bundles change.
 *
 * One-directional on purpose: the input must sit inside an owner, never the
 * reverse. Letting a shorter input "cover" owners below it would make a
 * directory argument like `packages/services` drag in every bundle package
 * under it, and `packages` drag in all nine.
 */
export function isInI18nBundlePackage(path, ownerDirs) {
  return ownerDirs.some((dir) => path === dir || path.startsWith(`${dir}/`));
}

/**
 * Walk `packages/` for extract configs exactly the way the gate walks it —
 * same skip set (`node_modules`, `dist`, dotted entries), same file test — and
 * return the repo-relative package directories that own one, deduped.
 *
 * Runtime discovery, like `extractCheckInvocations` re-reading the workflows:
 * when a tenth package grows a bundle, the next run matches it with nothing to
 * update here. `absDir` is the directory to read; `rel` is the repo-relative
 * path it corresponds to, so the answers are comparable to the input paths a
 * card is dispatched with.
 */
export function findI18nBundlePackages(absDir, rel = 'packages', out = []) {
  for (const e of readdirSync(absDir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) findI18nBundlePackages(join(absDir, e.name), child, out);
    else if (isExtractConfigPath(child)) {
      const owner = owningPackageOfExtractConfig(child);
      if (owner && !out.includes(owner)) out.push(owner);
    }
  }
  return out;
}

/**
 * The walk, memoised per process — one answer serves every input path. An
 * unreadable `packages/` throws rather than degrading to "no owners": under
 * this script's contract unreadable input must never look like an empty
 * answer, and the entrypoint turns the throw into a non-zero exit.
 */
let i18nOwnerDirs = null;
export function i18nBundlePackageDirs() {
  i18nOwnerDirs ??= findI18nBundlePackages(join(ROOT, 'packages'));
  return i18nOwnerDirs;
}

/**
 * Gates that fire on what a change IS, keyed by a mechanically-detectable
 * convention. Everything else in this script is derived at runtime and lists
 * nothing; this table is the one exception, and it is bounded on purpose.
 *
 * ## Why these cannot be derived like the rest
 *
 * The path derivation matches a gate when the gate's own source names a
 * directory that covers your file. Every gate here computes its population
 * instead of naming it, so no source carries a literal to match:
 *
 *   - the two test-file gates — one lints a glob set that lives in the shared
 *     ESLint config, the other walks the workspace members — sit permanently
 *     in the "undetermined" bucket;
 *   - `check:i18n` walks `packages/` at runtime for files NAMED
 *     `i18n-extract.config.ts` and re-extracts each owning package's bundles.
 *     Its source is worse than silent: the path-ish literals it does carry are
 *     its CLI prerequisite and stale-dist checks (`packages/cli/dist/commands/
 *     i18n/extract.js`, `packages/spec/dist`, measured — eleven hints, none of
 *     them the population). So it matches nothing AND, having hints, never
 *     reaches the "undetermined" bucket either: before this entry existed, an
 *     edit to `packages/services/service-messaging/src/objects/` — which
 *     regenerates that package's four bundles — printed the gate in NEITHER
 *     half of the output. A gate the derivation cannot mention at all is the
 *     one shape this script must not produce; it cost a PR a CI round.
 *
 * No per-card gate list derived from paths can ever name these, however the
 * derivation improves.
 *
 * ## Why a named table and not a wider heuristic
 *
 * The tempting generalisation — scan every discovered check script for
 * `*.test.ts`-shaped literals and call those the test-sensitive gates — was
 * measured against this tree and names 22 families, because a script's source
 * mentions test paths in its fixtures, its self-test and its comments.
 * "Mentions a test file" is not "counts test files", and 22 leads is the same
 * as none. So the pair is written down, and the cost of writing it down is paid
 * back by the two properties below.
 *
 * ## What the i18n entry still refuses to list
 *
 * Its `matches` does not enumerate the packages that own a bundle today — it
 * repeats the gate's own walk (`findI18nBundlePackages` mirrors `findConfigs`
 * in `scripts/check-i18n-bundles.mjs`: same skip set, same filename-plus-
 * `/scripts/` test). What is written down here is the KIND, not its
 * population, so a tenth package growing a bundle is matched by the next run
 * with nothing to update — the same runtime-discovery contract the workflow
 * and package.json reads already keep.
 *
 * ## How these entries stay honest
 *
 * - Every `name` here is resolved against the families actually discovered in
 *   the workflows at runtime. A gate that is renamed, retired or dropped from
 *   CI does not silently stop being suggested — the run prints it as STALE and
 *   says to fix this table. A hand-written list that reports its own rot is a
 *   different object from one that quietly ages.
 * - Each entry is deletable, with a stated criterion:
 *   - test-file entry: when a gate on it grows a discoverable path literal,
 *     the ordinary derivation names it and its line becomes redundant.
 *   - i18n entry: when `check-i18n-bundles.mjs` stops discovering its targets
 *     at runtime and names its POPULATION in its own source — a literal each
 *     owning package path starts with — the path half matches and this entry
 *     is redundant. Growing more prerequisite paths does not qualify; that is
 *     what it already has.
 *
 *   Delete an entry the day its criterion is met, not before.
 */
export const CHANGE_KIND_GATES = [
  {
    kind: 'adds or edits a test file',
    matches: isTestFilePath,
    gates: [
      {
        name: 'check:query-options-erasure',
        why: 'its test-surface ceiling counts sites in *.test/*.spec files, so new test code moves it',
      },
      {
        name: 'check:type-check-coverage',
        why: "TEST_DEBT ratchets a package's test-layer type errors, so a new test file that does not typecheck cleanly moves it",
      },
    ],
  },
  {
    kind: 'edits a file in a package that owns an i18n-extract.config.ts',
    matches: (path) => isInI18nBundlePackage(path, i18nBundlePackageDirs()),
    gates: [
      {
        name: 'check:i18n',
        why: "it re-extracts every owning package's translation bundles and fails on drift, so any edit that changes what the extractor emits (an object definition, a label, the config itself) moves it — regenerate with `node scripts/check-i18n-bundles.mjs --write`",
      },
    ],
  },
];

/**
 * Render the convention-triggered section. Pure over its inputs so the
 * self-test can drive both the hit and the STALE branch offline;
 * `resolveInvocation` returns a runnable command for a gate the live run
 * discovered, or null for one it did not.
 */
export function changeKindLines(paths, resolveInvocation, kinds = CHANGE_KIND_GATES) {
  const lines = [];
  for (const { kind, matches, gates } of kinds) {
    const hits = paths.filter((p) => matches(p));
    if (hits.length === 0) continue;
    lines.push(`  ${kind}: ${hits.join(', ')}`);
    for (const { name, why } of gates) {
      const invocation = resolveInvocation(name);
      lines.push(
        invocation
          ? `    - ${invocation}   — ${why}`
          : `    - ⚠ ${name}: STALE — no workflow runs a gate under this name. It was renamed or retired; fix CHANGE_KIND_GATES in this script.`,
      );
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Live derivation
// ---------------------------------------------------------------------------

function derive(paths) {
  const wfDir = join(ROOT, '.github/workflows');
  const workflows = readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f));
  if (workflows.length === 0) throw new Error('no workflow files found under .github/workflows');
  const rootScripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts ?? {};

  const invocations = [];
  for (const wf of workflows) {
    invocations.push(...extractCheckInvocations(readFileSync(join(wfDir, wf), 'utf8'), wf));
  }
  if (invocations.length === 0) throw new Error('no check:* invocations found in any workflow');

  // Dedupe by (check, workflow); resolve each to script files + watch hints.
  const byCheck = new Map();
  for (const inv of invocations) {
    const key = inv.check;
    if (!byCheck.has(key)) byCheck.set(key, { ...inv, workflows: new Set(), files: [], hints: [] });
    byCheck.get(key).workflows.add(inv.workflow);
  }
  for (const entry of byCheck.values()) {
    let files = entry.direct ? [entry.check] : resolveCheckToFiles(entry.check, rootScripts);
    if (entry.filter) {
      // package-scoped check: resolve through that package's manifest when findable
      const pkgDirGuess = entry.filter.replace(/^@objectstack\//, '');
      for (const base of ['packages', 'packages/plugins', 'packages/drivers', 'packages/services']) {
        const p = join(ROOT, base, pkgDirGuess, 'package.json');
        if (existsSync(p)) {
          const pkgScripts = JSON.parse(readFileSync(p, 'utf8')).scripts ?? {};
          files = files.concat(
            resolveCheckToFiles(entry.check, pkgScripts).map((f) => join(base, pkgDirGuess, f)),
          );
        }
      }
    }
    entry.files = files;
    for (const f of files) {
      const abs = join(ROOT, f);
      if (existsSync(abs)) entry.hints.push(...extractWatchHints(readFileSync(abs, 'utf8')));
    }
  }

  const matched = new Map();
  const undetermined = [];
  for (const [check, entry] of byCheck) {
    const hits = [];
    for (const p of paths) {
      const hint = entry.hints.find((h) => hintCovers(h, p));
      if (hint) hits.push({ path: p, hint });
    }
    if (hits.length) matched.set(check, { entry, hits });
    else if (entry.hints.length === 0) undetermined.push(check);
  }

  console.log(`dispatch-gates: ${byCheck.size} check famil(ies) discovered across ${workflows.length} workflow file(s) — derived at runtime, nothing listed in this script.\n`);
  if (matched.size) {
    console.log('Local gates for this card (paste into the dispatch prompt):');
    for (const [check, { entry, hits }] of [...matched].sort()) {
      const via = hits.map((h) => `${h.path} ⇢ '${h.hint}'`).join('; ');
      console.log(`  - ${runnableInvocation(entry)}   [${[...entry.workflows].join(', ')}]   matched via ${via}`);
    }
  } else {
    console.log('No check family names the given paths in its own source.');
  }
  const kindLines = changeKindLines(paths, (name) => {
    const entry = byCheck.get(name);
    return entry ? runnableInvocation(entry) : null;
  });
  if (kindLines.length) {
    console.log('\nConvention-triggered gates (this change KIND moves them; no path derivation can name them):');
    for (const line of kindLines) console.log(line);
  }

  console.log(
    `\nRepo-wide / undetermined (no path literals discoverable — not known irrelevant): ${undetermined.length} famil(ies).` +
      '\nConvention-scoped gates match by what the change IS, not where it lives. This script derives the conventions it can detect mechanically ' +
      `(${CHANGE_KIND_GATES.map((k) => k.kind).join('; ')}) and prints them above when they hit; the rest stay the PM judgment call — ` +
      'new fake engine ⇒ check:engine-double-contract, new error code ⇒ check:error-code-casing, any edit ⇒ check:nul-bytes.',
  );
}

// ---------------------------------------------------------------------------
// Self-test — extraction + matching over fixtures.
//
// The extraction and hint cases run over inline fixtures and touch no
// filesystem. The i18n change-kind cases deliberately do: that entry's whole
// content IS a walk of the real `packages/` tree, and a fixture-only test
// passes just as happily when the walk is rooted at the wrong directory or
// skips the wrong entries. So the pure judgments (filename test, owner
// derivation, containment) are pinned offline, and the walk is pinned against
// the tree, in both directions.
// ---------------------------------------------------------------------------

function selfTest() {
  const cases = [];
  const t = (name, cond) => cases.push([name, cond]);

  const wf = [
    'jobs:',
    '  lint:',
    '    steps:',
    '      - name: A',
    '        run: pnpm check:engine-double-contract',
    '      - name: B',
    '        run: pnpm --filter @objectstack/spec check:authorable-surface',
    '      - name: C',
    '        run: node scripts/check-nul-bytes.mjs',
    '      - name: not-a-check',
    '        run: pnpm build',
  ].join('\n');
  const invs = extractCheckInvocations(wf, 'lint.yml');
  t('extracts plain pnpm check', invs.some((i) => i.check === 'check:engine-double-contract' && i.filter === null));
  t('extracts filtered check with its package', invs.some((i) => i.check === 'check:authorable-surface' && i.filter === '@objectstack/spec'));
  t('extracts direct node scripts/check-*.mjs', invs.some((i) => i.check === 'scripts/check-nul-bytes.mjs' && i.direct));
  t('ignores non-check runs', !invs.some((i) => String(i.check).includes('build')));

  // Block-scalar bodies (#8410). A step written `run: |` keeps its commands on
  // the following lines; reading only the `run:` line collected "|" and missed
  // every gate invoked this way. Both scalar styles and both invocation shapes
  // are pinned, plus the two directions in which the body must END.
  const blockWf = [
    'jobs:',
    '  changeset-check:',
    '    steps:',
    '      - name: Literal block, two commands',
    '        env:',
    '          MERGE_BASE: abc',
    '        run: |',
    '          node scripts/check-adr-0087-registration.mjs --self-test',
    '          node scripts/check-adr-0087-registration.mjs --base "$MERGE_BASE"',
    '',
    '      # A YAML comment BETWEEN steps naming `pnpm check:invented-by-prose`.',
    '      - name: Folded block with a pnpm check',
    '        run: >-',
    '          pnpm --filter @objectstack/spec check:folded-surface',
    '      - name: Body carrying a shell comment',
    '        run: |',
    '          # first run node scripts/check-mentioned-only.mjs, they said',
    '          pnpm check:really-invoked',
    '      - name: Back to a one-liner',
    '        run: node scripts/check-nul-bytes.mjs',
  ].join('\n');
  const blockInvs = extractCheckInvocations(blockWf, 'pr-automation.yml');
  const blockNames = blockInvs.map((i) => i.check);
  t('extracts a direct script from a literal block body', blockNames.includes('scripts/check-adr-0087-registration.mjs'));
  t('extracts a pnpm check from a folded block body, with its filter', blockInvs.some((i) => i.check === 'check:folded-surface' && i.filter === '@objectstack/spec'));
  t('a dedented step ends the block body (the one-liner after it still parses)', blockNames.includes('scripts/check-nul-bytes.mjs'));
  t('a blank line does NOT end the block body', blockNames.includes('check:folded-surface'));
  // The over-match guard: discovery must report what a step RUNS, never what a
  // comment mentions. Measured on this tree — four families (check:adr-links,
  // check:empty-changeset, check:platform-checklist, check:skill-frame-freshness)
  // appear in workflow prose only, and a naive any-token scan invents all four.
  t('a gate named only in a YAML comment between steps is not discovered', !blockNames.includes('check:invented-by-prose'));
  t('a gate named only in a shell comment inside a body is not discovered', !blockNames.includes('scripts/check-mentioned-only.mjs'));
  t('a real command in the same body as a comment is still discovered', blockNames.includes('check:really-invoked'));

  // `runCommandTexts` on its own: one entry per step, in file order.
  const texts = runCommandTexts(blockWf);
  t('one command text per run step', texts.length === 4);
  t('a block body keeps its lines joined', texts[0].split('\n').filter((l) => l.trim()).length === 2);
  t('a one-line run yields its command verbatim', texts[3] === 'node scripts/check-nul-bytes.mjs');

  // #7440: the printed line must be runnable as-is. The three shapes come from
  // the same three fixtures above, so the sample workflow and the print site
  // cannot drift apart.
  const inv = (name) => invs.find((i) => i.check === name);
  t('prints a package-scoped check as its full --filter invocation', runnableInvocation(inv('check:authorable-surface')) === 'pnpm --filter @objectstack/spec run check:authorable-surface');
  t('prints a root-scoped check unchanged', runnableInvocation(inv('check:engine-double-contract')) === 'pnpm check:engine-double-contract');
  t('prints a direct script as a node invocation', runnableInvocation(inv('scripts/check-nul-bytes.mjs')) === 'node scripts/check-nul-bytes.mjs');

  const scripts = { 'check:foo': 'node scripts/check-foo.mjs --self-test && node scripts/check-foo.mjs' };
  t('resolves script file from package.json', resolveCheckToFiles('check:foo', scripts).join() === 'scripts/check-foo.mjs');
  t('unknown check resolves to nothing', resolveCheckToFiles('check:bar', scripts).length === 0);

  const src = [
    "const DIR = '.claude/agents';",
    "const GLOB = 'packages/spec/src/**/*.zod.ts';",
    "const URL2 = 'https://example.com/x';",
    "const FLAG = '--self-test';",
    "const WORD = 'hello';",
  ].join('\n');
  const hints = extractWatchHints(src);
  t('finds dotted-dir hint', hints.includes('.claude/agents'));
  t('finds glob hint', hints.some((h) => h.startsWith('packages/spec/src')));
  t('skips urls', !hints.some((h) => h.includes('example.com')));
  t('skips flags and bare words', !hints.includes('--self-test') && !hints.includes('hello'));

  t('hint covers deeper path', hintCovers('.claude/agents', '.claude/agents/os-dev.md'));
  t('collapsed glob prefix covers', hintCovers('packages/spec/src/**', 'packages/spec/src/data/filter.zod.ts'));
  t('input dir covers hint below it', hintCovers('packages/spec/scripts/check-x.mjs', 'packages/spec'));
  t('unrelated path does not match', !hintCovers('.claude/agents', 'packages/rest/src/server.ts'));

  // Change-kind derivation. The predicate is pinned in BOTH directions against
  // what the two gates themselves count: filename infix, never directory — a
  // helper inside `__tests__/` is in their non-test population.
  t('test file by .test infix', isTestFilePath('packages/objectql/src/engine.test.ts'));
  t('test file by .spec infix', isTestFilePath('packages/rest/src/server.spec.tsx'));
  t('test file with an mts extension', isTestFilePath('packages/spec/src/x.test.mts'));
  t('a __tests__ helper is NOT a test file to these gates', !isTestFilePath('packages/core/src/__tests__/fixtures.ts'));
  t('a plain source file is not a test file', !isTestFilePath('packages/objectql/src/engine.ts'));
  t('a non-TS file named test is not a test file', !isTestFilePath('docs/how.test.md'));

  const resolved = (name) => `pnpm ${name}`;
  const kindHit = changeKindLines(['packages/objectql/src/engine.test.ts'], resolved);
  t('a test path emits the convention section', kindHit.length === 3 && kindHit[0].includes('adds or edits a test file'));
  t('the section names both convention gates, runnably', kindHit.some((l) => l.includes('pnpm check:query-options-erasure')) && kindHit.some((l) => l.includes('pnpm check:type-check-coverage')));
  t('a non-test path emits nothing', changeKindLines(['scripts/pm/dispatch-gates.mjs'], resolved).length === 0);

  // i18n change-kind derivation — the pure judgments first, each mirroring one
  // line of the gate's own `findConfigs`.
  t('an extract config under scripts/ is one', isExtractConfigPath('packages/services/service-messaging/scripts/i18n-extract.config.ts'));
  t('the same filename OUTSIDE scripts/ is not', !isExtractConfigPath('packages/services/service-messaging/src/i18n-extract.config.ts'));
  t('another config under scripts/ is not', !isExtractConfigPath('packages/platform-objects/scripts/build-docs.config.ts'));
  t('owner is the package above scripts/', owningPackageOfExtractConfig('packages/plugins/plugin-audit/scripts/i18n-extract.config.ts') === 'packages/plugins/plugin-audit');
  t('an owner collapsing to a bare top-level dir is refused', owningPackageOfExtractConfig('packages/scripts/i18n-extract.config.ts') === null);

  const owners = ['packages/platform-objects', 'packages/services/service-messaging'];
  t('a deep path inside an owning package qualifies', isInI18nBundlePackage('packages/services/service-messaging/src/objects/http-delivery.object.ts', owners));
  t('the config file itself qualifies (whole package, not just objects)', isInI18nBundlePackage('packages/services/service-messaging/scripts/i18n-extract.config.ts', owners));
  t('the package directory itself qualifies', isInI18nBundlePackage('packages/platform-objects', owners));
  t('a path in a package WITHOUT a config does not', !isInI18nBundlePackage('packages/objectql/src/engine.ts', owners));
  t('a sibling sharing a name prefix does not', !isInI18nBundlePackage('packages/services/service-messaging-extra/src/x.ts', owners));
  t('a parent directory does not drag in owners below it', !isInI18nBundlePackage('packages/services', owners));

  // The walk itself, against the real tree — the half no fixture can prove.
  const liveOwners = i18nBundlePackageDirs();
  t('the live walk discovers owning packages', liveOwners.length > 0 && liveOwners.every((d) => d.startsWith('packages/')));
  t('the live walk finds no duplicate owners', new Set(liveOwners).size === liveOwners.length);
  t('the live walk excludes a package that owns no config', !liveOwners.includes('packages/objectql'));
  // Regression pin for the measured miss (PR #8348): this exact path derived no
  // check:i18n. If service-messaging ever stops owning a bundle, this case fails
  // and the answer is to re-point it at a package that does, not to delete it.
  t('the measured incident path now derives the kind', isInI18nBundlePackage('packages/services/service-messaging/src/objects/http-delivery.object.ts', liveOwners));

  // The name assertions below anchor on the rendered DELIMITERS (`- pnpm x   —`,
  // `⚠ x: STALE`), not on a bare substring. Measured while reverse-verifying this
  // entry: renaming the gate to `check:i18n-renamed-probe` made the live run
  // print STALE exactly as designed, and a `includes('pnpm check:i18n')` pin
  // stayed green through it — every prefix-preserving rename is invisible to a
  // substring, which is the one class of rot the STALE branch exists to catch.
  const i18nHit = changeKindLines(['packages/services/service-messaging/src/objects/http-delivery.object.ts'], resolved);
  t('an owning-package path emits the i18n convention section', i18nHit.length === 2 && i18nHit[0].includes('owns an i18n-extract.config.ts'));
  t('the i18n section names check:i18n exactly, runnably', i18nHit.some((l) => l.includes('- pnpm check:i18n   —')));
  t('a path outside every owning package emits no i18n section', !changeKindLines(['packages/objectql/src/engine.ts'], resolved).some((l) => l.includes('check:i18n')));

  // The measured incident (#8410 / PR #8399), pinned against the REAL workflow
  // rather than a fixture: a fixture proves the parser, only the live file
  // proves that THIS repo's changeset gate is reachable. `Check Changeset`
  // invokes check-adr-0087-registration.mjs from a block-scalar body, and that
  // is the gate PR #8399's declared-breaking changeset went red on after a
  // fully green local loop. If the step is ever rewritten as a one-liner this
  // case still passes (it asserts discovery, not the YAML style); if the gate
  // moves out of pr-automation.yml, re-point the case at its new home rather
  // than deleting it.
  const liveWf = readFileSync(join(ROOT, '.github/workflows/pr-automation.yml'), 'utf8');
  const liveInvs = extractCheckInvocations(liveWf, 'pr-automation.yml').map((i) => i.check);
  t('the live Check Changeset job discovers its ADR-0087 gate', liveInvs.includes('scripts/check-adr-0087-registration.mjs'));
  t('the live Check Changeset job discovers its empty-changeset gate', liveInvs.includes('scripts/check-empty-changeset.mjs'));
  t('the live one-line gate in that file still discovers', liveInvs.includes('scripts/check-changeset-no-major.mjs'));
  // The end-to-end direction: a `.changeset/` path must now REACH the ADR-0087
  // gate through the ordinary watch-hint match. That gate names `.changeset` in
  // its own source, so this asserts the whole chain (discover -> resolve ->
  // hint -> cover) rather than the parser alone.
  const adrHints = extractWatchHints(readFileSync(join(ROOT, 'scripts/check-adr-0087-registration.mjs'), 'utf8'));
  t('a .changeset path is covered by the ADR-0087 gate own hints', adrHints.some((h) => hintCovers(h, '.changeset/some-breaking-change.md')));

  // The table's own rot detector: a name no live run discovers must say so,
  // never disappear quietly.
  const stale = changeKindLines(['a.test.ts'], () => null);
  t('an undiscoverable gate renders as STALE', stale.filter((l) => l.includes('STALE')).length === 2);
  const i18nStale = changeKindLines(['packages/services/service-messaging/scripts/i18n-extract.config.ts'], () => null);
  t('an undiscoverable check:i18n renders as STALE', i18nStale.filter((l) => l.includes('⚠ check:i18n: STALE')).length === 1);
  t('every declared convention gate carries a reason', CHANGE_KIND_GATES.every((k) => k.gates.every((g) => g.name && g.why)));

  let failed = 0;
  for (const [name, cond] of cases) {
    if (!cond) failed++;
    console.log(`  ${cond ? '✓' : '✗'} ${name}`);
  }
  if (failed) {
    console.error(`✗ dispatch-gates self-test: ${failed} of ${cases.length} case(s) failed.`);
    process.exit(1);
  }
  console.log(`✓ dispatch-gates self-test: ${cases.length} cases pass.`);
}

const argvPaths = process.argv.slice(2).filter((a) => a !== '--self-test');
if (process.argv.includes('--self-test')) {
  selfTest();
} else if (argvPaths.length === 0) {
  console.error('usage: node scripts/pm/dispatch-gates.mjs <path> [<path> ...] | --self-test');
  process.exit(2);
} else {
  try {
    derive(argvPaths.map((p) => p.replace(/^\.\//, '')));
  } catch (err) {
    console.error(`dispatch-gates: derivation failed — ${err.message}`);
    process.exit(2);
  }
}
