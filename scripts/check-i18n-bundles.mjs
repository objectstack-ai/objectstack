#!/usr/bin/env node
// check-i18n-bundles — the `pnpm check:i18n` gate. TWO verdicts, kept distinct:
//
//   1. BUNDLE DRIFT       a package's committed translation bundles no longer
//                         match what its schema would extract. Fixed by
//                         regenerating (`--write`).
//   2. UNDECLARED KEY     a package's `i18n-extract.config.ts` authors a key
//                         `ObjectStackDefinitionSchema` does not declare, so the
//                         parse DROPS it at load. Fixed by deleting the key from
//                         the config (or, if the key is genuinely wanted, by
//                         declaring it in `packages/spec` — deliberately, with an
//                         ADR-worthy reason, never to accommodate a typo).
//
// Verdict 2 was added by #4804 and is the reason this header no longer says
// "drift gate": before it, `check:i18n` judged drift only. If this gate fails on
// you, read which of the two sections below your package landed in — they are
// reported separately and never merged into one verdict.
//
// Why verdict 2 lives HERE and not in `os i18n extract`: the #4167
// unknown-authoring-key lint already SAW every one of these — it printed a
// `console.warn` per offending package on every run — but the CLI still exited 0,
// so the warning appeared inside a fully green `check:i18n` and was read as
// noise. Nine packages then copied the same undeclared `name:` key from the first
// one (#4736, cleaned in #4803) and nothing stopped any of them. A warning that
// nine authors filtered out is not a control. Making the *gate* fail turns
// "already visible" into "already blocked" without touching the public CLI
// exit-code contract (rejected option B) or making
// `ObjectStackDefinitionSchema` strict (rejected option C, which would silence
// the lint itself — see `metadata-authoring-lint.ts`).
//
// Coverage needs no manifest: `findExtractConfigs` walks `packages/`, so a
// config that lands tomorrow is gated tomorrow. That walk is shared with the
// dispatch-gates derivation rather than mirrored by it (#9116) — see
// SURFACE_MODULE below.
//
// The command each package is checked with is not repeated here: it is parsed
// out of the config file's own docstring, which already documents how to
// regenerate that bundle. Executing exactly the documented command means the
// docs and the gate cannot diverge — the same reason `os lint`'s coverage
// detector was made to share the extractor's walker (#3370).
//
//   node scripts/check-i18n-bundles.mjs             # check all; fail on either verdict
//   node scripts/check-i18n-bundles.mjs --write      # regenerate bundles in place
//   node scripts/check-i18n-bundles.mjs --filter=security
//   node scripts/check-i18n-bundles.mjs --self-test  # prove every classifier can go red
//
// Requires the workspace build (it runs the built CLI), so it belongs after
// the build step with the other consumer gates. `--self-test` does not: it runs
// the output classifiers against fixed samples, no build and no CLI. That
// self-test exists because a gate observed only green is indistinguishable from
// a gate that matches nothing (#4690).
//
// That requirement is now CHECKED, not merely declared (#5217). It used to be a
// sentence in this header, and an unbuilt workspace paid for it twice over:
//
//   - `--check` reported "9 bundle problem(s) … extract failed" — one
//     environment prerequisite rendered as nine CONTENT problems, in the two
//     words ("bundle", "extract") that send the reader to the i18n configs;
//   - `--write` printed "regenerated" nine times and exited **0** — a fully
//     green run that wrote nothing at all.
//
// CI never sees either shape (it builds first — lint.yml's `typecheck` job runs
// `Build workspace packages` well before `pnpm check:i18n`), which is exactly
// why it survived: the only people who meet it are the ones reproducing a red
// i18n CI locally, at the moment a wrong first diagnosis costs the most.
// `checkCliBuildPrerequisite()` now answers it once, before the per-package
// loop, and both shapes above collapse into one prerequisite plus one command.
// "Prefer failing to falling back" (AGENTS.md, route & surface ownership §3):
// the prerequisite verdict is a HARD failure that states it checked nothing —
// never a skip, and never anything a reader can mistake for "bundles are fine".
//
// The two pure functions that answer it moved to `scripts/cli-build-prerequisite.mjs`
// when #5862 found the same missing precondition in `check-i18n-coverage.mjs`, one
// lint.yml step away. They are imported, not copied: see that module's header.
//
// A BUILT CLI is not the only prerequisite, and #7681 is the second one arriving
// in exactly the shape above. The extract this gate runs loads the workspace's own
// packages, so a `packages/spec/dist` older than the commit that added an export
// makes node refuse the import — and that failure matched no prerequisite
// classifier, fell through to the in-loop `else`, and printed as
// "check-i18n-bundles: 1 bundle problem(s) / extract failed …". One environment
// fact, rendered as a CONTENT verdict about bundles nothing had compared, in the
// same two words. The sibling coverage gate met the identical cause in the same
// run and refused to judge ("Nothing was compared… the baseline was left exactly
// as committed" — #6033/#5862); this gate graded it. `looksLikeStaleWorkspaceDist`
// is the classifier that closes that gap, and the verdict it raises is a hard
// prerequisite failure naming the package whose dist is stale — never a count.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  CLI,
  CLI_BUILD_FIX,
  looksLikeMissingCliCommand,
  looksLikeStaleWorkspaceDist,
  oclifCommandFileFor,
  resolveCliCommandFile,
  workspaceBuildFix,
} from './cli-build-prerequisite.mjs';
import { findExtractConfigs, flagsFromDocstring } from './i18n-bundle-surface.mjs';

/**
 * The module this gate's POPULATION is enumerated by, declared as a whole
 * literal so the derivation can see it (#9116).
 *
 * `findConfigs` and `flagsFromDocstring` used to live in this file, and
 * scripts/pm/dispatch-gates.mjs carried a hand-written mirror of the first —
 * two spellings of one contract, agreeing only until one side moved. They are
 * imported from one module now. That module is a real input of this gate, but
 * an import specifier is not a discoverable watch hint (the leading `./`
 * strips to a bare filename), so a card editing the shared enumeration would
 * derive nothing at all. Naming it here as a bare module-body constant is what
 * makes this family match such a card — the same declared-coupling shape
 * check-type-check-coverage.mjs uses for the root-program script whose errors
 * it ratchets, and it is pinned live in dispatch-gates' own self-test.
 */
const SURFACE_MODULE = 'scripts/i18n-bundle-surface.mjs';

/**
 * The two producers of the `metadataForms` TYPE-LEVEL surface, declared as
 * bare module-body path literals for the same reason as SURFACE_MODULE above
 * (#9144). `walkMetadataForms` (packages/cli/src/utils/i18n-extract.ts) emits
 * `metadataForms.<type>.label` / `.description` for every entry of
 * `DEFAULT_METADATA_TYPE_REGISTRY` — including form-less types like
 * `datasource`/`job`/`translation` — and separately reads
 * `METADATA_FORM_REGISTRY` itself (the map, not the `*.form.ts` leaves it
 * points at) to decide which types also get section/field labels. Editing
 * either moves the same `platform-objects` bundles PR #9113 had to
 * regenerate — and, unlike the `*.form.ts` leaves, neither carries a filename
 * SURFACE_MODULE's own convention (`isMetadataFormModulePath`) can see.
 *
 * Not folded into SURFACE_MODULE: that module documents the ONE convention it
 * enumerates at runtime (the `.form.ts` suffix), and these two files
 * deliberately do not carry it — inventing a second filename convention for
 * exactly two files would be the guess #9144 declined to make. A bare
 * coupling constant was the option the card measured to have no downside
 * beyond upkeep; see i18n-bundle-surface.mjs's header for the two rejected
 * alternatives and why.
 *
 * This is per-coupling manual upkeep, deliberately, and it does not go quiet:
 * dispatch-gates' own self-test pins that a card editing either path derives
 * check:i18n, against the real files (existsSync) — delete either constant
 * and that self-test reddens instead of the silence coming back. If either
 * module is renamed or the registries merge, update the self-test's pins in
 * the same change: the evidence goes with the claim, never ahead of it.
 */
const METADATA_TYPE_REGISTRY_MODULE = 'packages/spec/src/kernel/metadata-plugin.zod.ts';
const METADATA_FORM_REGISTRY_MODULE = 'packages/spec/src/system/metadata-form-registry.ts';

/** The one command this gate invokes per package, as oclif topic/command parts. */
const EXTRACT_COMMAND_ID = ['i18n', 'extract'];
const write = process.argv.includes('--write');
const filterArg = process.argv.find((a) => a.startsWith('--filter='));
const filter = filterArg ? filterArg.slice('--filter='.length) : '';

// `findConfigs` (every scripts/i18n-extract.config.ts under packages/) and
// `flagsFromDocstring` (the regenerate command each config documents about
// itself) moved to the shared module named in SURFACE_MODULE above. This gate
// and the dispatch-gates derivation now run the SAME walk instead of two
// spellings of it; see that module's header for why the mirror had to go.

// ---------------------------------------------------------------------------
// Output classifiers. Pure string -> findings, so `--self-test` can drive them
// with recorded CLI output instead of a build.
// ---------------------------------------------------------------------------

/**
 * The signature `formatUnknownAuthoringKey()` (packages/spec) emits, whatever
 * prints it. `defineStack` writes it to **stderr** with a `defineStack: ` prefix;
 * `os compile` writes the same text to stdout behind a `• ` bullet. Both streams
 * are scanned, so the gate does not depend on which seam happens to surface it.
 *
 * The parenthesised path/key groups are what lets the failure name the offending
 * key rather than merely assert one exists.
 */
const UNDECLARED_KEY_LINE =
  /^\s*(?:•\s+)?(?:defineStack:\s*)?(?<path>[^\s:]+):\s*'(?<key>[^']+)' is not a declared (?<surface>\S+) key\b(?<rest>.*)$/;

/** Weaker signature: enough to fail on, not enough to attribute. See below. */
const UNDECLARED_KEY_SIGNATURE = /is not a declared \S+ key/;

/**
 * Every unknown-authoring-key finding in one package's CLI output.
 *
 * Deduped by path, mirroring the lint's own per-process dedupe — but note the
 * dedupe is per *path within one process*, and this gate spawns one process per
 * config, so nine offending packages really do produce nine findings. Presence,
 * not count, is what fails the gate; the count only shapes the message.
 *
 * The `unattributed` bucket is deliberate anti-#4690 insurance: if the message
 * format ever changes so the strict regex stops matching, the weak signature
 * still fails the gate — loudly saying it could not name the key — instead of
 * quietly reporting a clean run.
 */
function collectUndeclaredKeys(text) {
  const findings = [];
  const unattributed = [];
  const seen = new Set();
  for (const line of String(text ?? '').split('\n')) {
    if (!UNDECLARED_KEY_SIGNATURE.test(line)) continue;
    const m = line.match(UNDECLARED_KEY_LINE);
    if (!m) {
      unattributed.push(line.trim());
      continue;
    }
    const { path, key, surface, rest } = m.groups;
    if (seen.has(path)) continue;
    seen.add(path);
    // `rest` still holds the shared ", so its value is dropped at load" clause;
    // the gate states that consequence in its own words, so strip it and keep
    // only the finding-specific tail (`did you mean 'x'?`, or a retirement note).
    const hint = (rest ?? '')
      .replace(/^,\s*so its value is dropped at load/, '')
      .replace(/^\s*[—–-]\s*/, '')
      .replace(/^\s*\.\s*$/, '')
      .trim();
    findings.push({ path, key, surface, hint });
  }
  return { findings, unattributed };
}

/** Bundles the extractor reported as stale. Unchanged since the gate's first version. */
function collectDriftedBundles(text) {
  return [...String(text ?? '').matchAll(/(?:out of date|missing):\s+(\S+)/g)].map((m) => m[1]);
}

// `oclifCommandFileFor` and `looksLikeMissingCliCommand` — the two classifiers the
// prerequisite is built from — now live in `./cli-build-prerequisite.mjs`, shared
// with `check-i18n-coverage.mjs` (#5862). The self-test below still drives them
// directly, so this gate's corpus keeps proving them from here.

/** stderr lines that are neither the lint signature nor blank — pass them through. */
function passthroughStderrLines(text) {
  return String(text ?? '')
    .split('\n')
    .filter((l) => l.trim() && !UNDECLARED_KEY_SIGNATURE.test(l));
}

// ---------------------------------------------------------------------------
// Self-test — the proof that each classifier can go red, and that the two
// verdicts do not contaminate each other.
// ---------------------------------------------------------------------------

function selfTest() {
  const failures = [];
  const expect = (name, cond, detail) => {
    if (!cond) failures.push(`${name} — ${detail}`);
  };

  // Recorded verbatim from `node packages/cli/bin/run.js i18n extract
  // packages/platform-objects/scripts/i18n-extract.config.ts … --check` at
  // ffab8033b^ (the commit before #4803 removed the nine `name:` keys). This is
  // the corpus the gate has to catch; if the CLI's wording moves, this string
  // stops matching and the self-test says so before CI goes quietly green.
  const REAL_STDERR_AT_FFAB8033B_PARENT =
    "defineStack: stack.name: 'name' is not a declared stack key, so its value is dropped at load — did you mean 'pages'?";

  const real = collectUndeclaredKeys(REAL_STDERR_AT_FFAB8033B_PARENT);
  expect('#4804 real-corpus', real.findings.length === 1, `expected 1 finding, got ${real.findings.length}`);
  expect('#4804 real-corpus path', real.findings[0]?.path === 'stack.name', `got ${real.findings[0]?.path}`);
  expect('#4804 real-corpus key', real.findings[0]?.key === 'name', `got ${real.findings[0]?.key}`);
  expect('#4804 real-corpus surface', real.findings[0]?.surface === 'stack', `got ${real.findings[0]?.surface}`);
  expect('#4804 real-corpus unattributed', real.unattributed.length === 0, 'strict regex should have matched');
  expect(
    '#4804 real-corpus hint',
    real.findings[0]?.hint === "did you mean 'pages'?",
    `the shared "dropped at load" clause must not leak into the hint; got ${JSON.stringify(real.findings[0]?.hint)}`,
  );

  // The same finding as `os compile` prints it (stdout, bulleted, no prefix).
  const bulleted = collectUndeclaredKeys("  • objects[0].fields.pii: 'pii' is not a declared field key, so its value is dropped at load.");
  expect('#4804 bulleted form', bulleted.findings.length === 1, `expected 1, got ${bulleted.findings.length}`);
  expect('#4804 bulleted key', bulleted.findings[0]?.key === 'pii', `got ${bulleted.findings[0]?.key}`);
  expect('#4804 bulleted surface', bulleted.findings[0]?.surface === 'field', `got ${bulleted.findings[0]?.surface}`);
  expect('#4804 bulleted hint', bulleted.findings[0]?.hint === '', `a hintless finding must yield '', got ${JSON.stringify(bulleted.findings[0]?.hint)}`);

  // Two distinct paths in one package's output must both survive; a repeat of
  // one path must not double-count.
  const multi = collectUndeclaredKeys(
    [
      "defineStack: stack.name: 'name' is not a declared stack key, so its value is dropped at load.",
      "defineStack: stack.title: 'title' is not a declared stack key, so its value is dropped at load.",
      "defineStack: stack.name: 'name' is not a declared stack key, so its value is dropped at load.",
    ].join('\n'),
  );
  expect('#4804 multi-key', multi.findings.length === 2, `expected 2 distinct paths, got ${multi.findings.length}`);

  // Anti-#4690: a reworded signature must still fail the gate, flagged as
  // unattributable — never silently classified as clean.
  const reworded = collectUndeclaredKeys('warn: the key `name` is not a declared stack key here');
  expect('#4804 reworded still red', reworded.findings.length + reworded.unattributed.length === 1, 'weak signature must still register');
  expect('#4804 reworded unattributed', reworded.unattributed.length === 1, 'should land in the unattributed bucket');

  // A clean run is clean — the gate must not fail on ordinary output.
  const clean = collectUndeclaredKeys('  ✓ 8 bundle(s) are in sync with the schema (487ms)\n  ℹ Config: /x/y.ts');
  expect('#4804 clean run', clean.findings.length === 0 && clean.unattributed.length === 0, 'clean output must produce nothing');

  // The two verdicts must not read each other's output (issue #4804 criterion 3).
  const driftOutput = '  ✗ out of date: zh-CN.ts\n  ✗ missing: ja-JP.ts';
  expect('#4804 drift still detected', collectDriftedBundles(driftOutput).length === 2, 'drift classifier regressed');
  expect('#4804 drift is not an undeclared key', collectUndeclaredKeys(driftOutput).findings.length === 0, 'drift leaked into the key verdict');
  expect(
    '#4804 undeclared key is not drift',
    collectDriftedBundles(REAL_STDERR_AT_FFAB8033B_PARENT).length === 0,
    'the key verdict leaked into drift',
  );

  // Passthrough must not swallow unrelated diagnostics.
  const pass = passthroughStderrLines(`${REAL_STDERR_AT_FFAB8033B_PARENT}\nnode:internal/errors: something else\n`);
  expect('#4804 passthrough keeps other stderr', pass.length === 1 && pass[0].includes('something else'), `got ${JSON.stringify(pass)}`);

  // -------------------------------------------------------------------------
  // Third classifier (#5217): the build prerequisite. Same anti-#4690 duty as
  // the two above — a prerequisite check observed only green is indistinguishable
  // from one that matches nothing, and this one's whole job is to fire on a
  // machine where the gate cannot run at all.
  // -------------------------------------------------------------------------

  // Both recorded VERBATIM from `node scripts/check-i18n-bundles.mjs` in an
  // installed-but-unbuilt worktree at 72c3c8613 — the run reproduced in #5217.
  // oclif wraps its one-sentence error at a width that depends on the config
  // path, so the same failure arrives in two shapes; the second breaks the path
  // mid-token ("…/i18n" + "-extract.config.ts"). Keep both: a per-line regex
  // passes neither, which is the implementation this corpus exists to reject.
  const OCLIF_WRAPPED_3_LINE =
    ' ›   Error: command \n ›   i18n:extract:packages/platform-objects/scripts/i18n-extract.config.ts not \n ›   found';
  const OCLIF_WRAPPED_MID_TOKEN =
    ' ›   Error: command i18n:extract:packages/plugins/plugin-approvals/scripts/i18n\n ›   -extract.config.ts not found';

  expect('#5217 wrapped 3-line', !!looksLikeMissingCliCommand(OCLIF_WRAPPED_3_LINE), 'oclif line wrapping must not hide the signature');
  expect('#5217 wrapped mid-token', !!looksLikeMissingCliCommand(OCLIF_WRAPPED_MID_TOKEN), 'a path split mid-token must still match');
  expect(
    '#5217 unwrapped form',
    !!looksLikeMissingCliCommand('Error: command i18n:extract:x/y.ts not found'),
    'the unwrapped single-line form must match too',
  );
  expect(
    '#5217 flattens for the message',
    looksLikeMissingCliCommand(OCLIF_WRAPPED_3_LINE) ===
      'Error: command i18n:extract:packages/platform-objects/scripts/i18n-extract.config.ts not found',
    `the evidence line must come back as one readable sentence; got ${JSON.stringify(looksLikeMissingCliCommand(OCLIF_WRAPPED_3_LINE))}`,
  );

  // Recorded verbatim from the OTHER real prerequisite scenario: `dist/` and the
  // command file both present but the built command surface unusable (a stale or
  // interrupted build), which the pre-loop probe cannot see and the net catches.
  // oclif prepends a node `Warning:` block there, so this pins that the quoted
  // evidence is the ERROR SENTENCE and not whichever noise came first.
  const OCLIF_STALE_DIST_WITH_WARNING_NOISE =
    '(node:13260) Warning: Error\nmodule: @oclif/core@4.13.2\ntask: findCommand (i18n:extract)\nplugin: @objectstack/cli\nroot: /repo/packages/cli\nmessage: command i18n:extract not found\nSee more details with DEBUG=*\n' +
    ' ›   Error: command \n ›   i18n:extract:packages/platform-objects/scripts/i18n-extract.config.ts not \n ›   found';
  expect(
    '#5217 stale dist quotes the sentence, not the noise',
    looksLikeMissingCliCommand(OCLIF_STALE_DIST_WITH_WARNING_NOISE) ===
      'Error: command i18n:extract:packages/platform-objects/scripts/i18n-extract.config.ts not found',
    `evidence must be the error sentence; got ${JSON.stringify(looksLikeMissingCliCommand(OCLIF_STALE_DIST_WITH_WARNING_NOISE))}`,
  );

  // Must not contaminate — or be contaminated by — the two content verdicts.
  // A real bundle problem on a correctly built workspace must never be reported
  // as "your workspace is not built", which would send the reader to run a build
  // that changes nothing and hide a genuine drift behind it.
  expect('#5217 clean run is not a missing build', !looksLikeMissingCliCommand('  ✓ 8 bundle(s) are in sync with the schema (487ms)'), 'clean output must not match');
  expect('#5217 drift is not a missing build', !looksLikeMissingCliCommand(driftOutput), 'drift leaked into the prerequisite verdict');
  expect(
    '#5217 undeclared key is not a missing build',
    !looksLikeMissingCliCommand(REAL_STDERR_AT_FFAB8033B_PARENT),
    'the key verdict leaked into the prerequisite verdict',
  );
  expect(
    '#5217 unrelated failure is not a missing build',
    !looksLikeMissingCliCommand("Error: Cannot find module 'node:fs/promises'\n  at ModuleJob.run"),
    'only oclif command resolution may claim this verdict',
  );

  // The probe derives its path from the CLI's declaration; pin the derivation
  // against the real oclif block so a moved `target` is caught here rather than
  // by a probe that quietly checks a path nothing writes any more.
  const derived = oclifCommandFileFor({ oclif: { commands: { strategy: 'pattern', target: './dist/commands', glob: '**/*.js' } } }, ['i18n', 'extract']);
  expect('#5217 derives the command file', derived.file === 'packages/cli/dist/commands/i18n/extract.js', `got ${JSON.stringify(derived)}`);
  const undeclaredTarget = oclifCommandFileFor({ oclif: {} }, ['i18n', 'extract']);
  expect('#5217 unreadable shape defers, loudly', !!undeclaredTarget.unknown && !undeclaredTarget.file, `an unreadable oclif block must yield a reason, not a guessed path; got ${JSON.stringify(undeclaredTarget)}`);

  // -------------------------------------------------------------------------
  // Fourth classifier (#7681): the OTHER prerequisite — a workspace package this
  // gate loads whose build output no longer matches its source. Pinned here or
  // nowhere, for the same reason as the third: CI builds the whole workspace
  // before this gate runs, so nothing in CI ever reaches this path.
  //
  // Both directions are pinned on purpose. Over-widening this classifier would
  // relabel a genuine drift or undeclared key as "your workspace is stale" and
  // send the reader to a rebuild that changes nothing — the #5862 defect (a
  // confident diagnosis pointing somewhere innocent) rebuilt one layer down.
  // -------------------------------------------------------------------------

  // The failure #7681 reported, as node actually prints it: produced locally by
  // importing a name that a package's built ESM does not export — a fixture
  // standing in for the stale `packages/spec/dist` of the QA run — under node
  // v22.22.2, then normalised to `/repo`. The specifier and the export name are
  // the run's own (`@objectstack/spec/system`, `authorisesIrreversibleAction`,
  // added by #7285). Keep the frame and the stack: the sentence worth matching is
  // the FOURTH line, the echoed source line above it mentions the same specifier
  // in an import statement, and a per-line regex over stdout would meet the frame
  // first. This is the corpus that used to reach `broken.push('extract failed')`.
  const REAL_STALE_SPEC_DIST_AT_06BE54EC =
    'file:///repo/packages/platform-objects/scripts/i18n-extract.config.bundled_9qzr4x.mjs:1\n' +
    "import { authorisesIrreversibleAction } from '@objectstack/spec/system';\n" +
    '         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n' +
    "SyntaxError: The requested module '@objectstack/spec/system' does not provide an export named 'authorisesIrreversibleAction'\n" +
    '    at ModuleJob._instantiate (node:internal/modules/esm/module_job:226:21)\n' +
    '    at async ModuleJob.run (node:internal/modules/esm/module_job:335:5)';

  /** The one sentence of that corpus worth quoting — the frame and stack are not evidence. */
  const EXPECTED_STALE_SENTENCE =
    "The requested module '@objectstack/spec/system' does not provide an export named 'authorisesIrreversibleAction'";

  const staleDist = looksLikeStaleWorkspaceDist(REAL_STALE_SPEC_DIST_AT_06BE54EC);
  expect('#7681 stale dist is a prerequisite', !!staleDist, 'the export-mismatch signature must be classified');
  expect('#7681 names the package at fault', staleDist?.pkg === '@objectstack/spec', `got ${JSON.stringify(staleDist?.pkg)}`);
  expect('#7681 names the missing export', staleDist?.missingExport === 'authorisesIrreversibleAction', `got ${JSON.stringify(staleDist?.missingExport)}`);
  expect(
    '#7681 quotes the sentence, not the frame',
    staleDist?.sentence === EXPECTED_STALE_SENTENCE,
    `the evidence must be the one sentence; got ${JSON.stringify(staleDist?.sentence)}`,
  );

  // …and the same failure after oclif has wrapped it into ` › ` lines.
  expect(
    '#7681 survives oclif wrapping',
    looksLikeStaleWorkspaceDist(
      " ›   Error: The requested module '@objectstack/spec/system' does not \n ›   provide an export named 'authorisesIrreversibleAction'",
    )?.pkg === '@objectstack/spec',
    'a wrapped sentence must still be classified',
  );

  // The sibling shape: the package is installed but was never built at all. Same
  // prerequisite, different sentence — recorded in the form #6033 measured on the
  // neighbouring coverage gate, retargeted at a package this gate loads.
  const missingOutput = looksLikeStaleWorkspaceDist(
    "Cannot find module '/repo/packages/platform-objects/node_modules/@objectstack/spec/dist/index.mjs' " +
      'imported from /repo/packages/platform-objects/scripts/i18n-extract.config.bundled_9qzr4x.mjs',
  );
  expect('#7681 unbuilt dist is a prerequisite too', missingOutput?.kind === 'missing-output', `got ${JSON.stringify(missingOutput)}`);
  expect('#7681 unbuilt dist names the package', missingOutput?.pkg === '@objectstack/spec', `got ${JSON.stringify(missingOutput?.pkg)}`);

  // ⚠️ The negative direction — a CONTENT failure must still read as content.
  // These are the three verdicts this gate exists to give; if any of them starts
  // matching, a real problem gets reported as an environment fact and the reader
  // is sent to a rebuild that fixes nothing.
  expect('#7681 drift is not a stale dist', !looksLikeStaleWorkspaceDist(driftOutput), 'drift leaked into the prerequisite verdict');
  expect(
    '#7681 undeclared key is not a stale dist',
    !looksLikeStaleWorkspaceDist(REAL_STDERR_AT_FFAB8033B_PARENT),
    'the key verdict leaked into the prerequisite verdict',
  );
  expect(
    '#7681 clean run is not a stale dist',
    !looksLikeStaleWorkspaceDist('  ✓ 8 bundle(s) are in sync with the schema (487ms)'),
    'clean output must not match',
  );
  expect(
    '#7681 a broken config is not a stale dist',
    !looksLikeStaleWorkspaceDist("Error: Duplicate object name 'contacts' in packages/x/scripts/i18n-extract.config.ts"),
    'a config that is genuinely at fault must keep its own verdict',
  );
  // Narrowness, in the three shapes that look like this failure and are not it.
  expect(
    '#7681 a third-party export mismatch is not ours to diagnose',
    !looksLikeStaleWorkspaceDist("SyntaxError: The requested module 'zod' does not provide an export named 'z'"),
    'no rebuild of this repo would clear it, so it keeps the caller\'s verdict',
  );
  expect(
    '#7681 CommonJS interop is not staleness',
    !looksLikeStaleWorkspaceDist(
      "SyntaxError: Named export 'defineStack' not found. The requested module '@objectstack/spec' is a CommonJS module, which may not support all module.exports as named exports.",
    ),
    'an interop authoring problem is not a stale build',
  );
  expect(
    '#7681 a non-dist specifier is not a stale build',
    !looksLikeStaleWorkspaceDist("Cannot find package '@objectstack/nope' imported from /repo/x.ts") &&
      !looksLikeStaleWorkspaceDist("Cannot find module '/repo/packages/x/scripts/helpers.js' imported from /repo/x.ts"),
    'only a specifier reaching into a workspace package\'s build output may claim this verdict',
  );

  // The two prerequisites must not claim each other: their remedies differ, and
  // the wrong one sends the reader to a command that changes nothing. The second
  // half of this pair is the root cause of #7681 stated as a pin — the
  // export-mismatch signature never did match the missing-CLI classifier, which is
  // exactly why it fell through to the content branch.
  expect('#7681 a missing CLI is not a stale dist', !looksLikeStaleWorkspaceDist(OCLIF_WRAPPED_3_LINE), 'the CLI verdict leaked into this one');
  expect(
    '#7681 a stale dist is not a missing CLI',
    !looksLikeMissingCliCommand(REAL_STALE_SPEC_DIST_AT_06BE54EC),
    'the two prerequisite classifiers must stay distinct',
  );

  // …and the reason it landed in `broken` rather than being ignored: the corpus
  // produces no drift lines and no key findings, so the `else` branch took it and
  // printed one environment fact as "1 bundle problem(s)".
  expect(
    '#7681 the corpus produces no content findings at all',
    collectDriftedBundles(REAL_STALE_SPEC_DIST_AT_06BE54EC).length === 0 &&
      collectUndeclaredKeys(REAL_STALE_SPEC_DIST_AT_06BE54EC).findings.length === 0 &&
      collectUndeclaredKeys(REAL_STALE_SPEC_DIST_AT_06BE54EC).unattributed.length === 0,
    'if a content classifier matched this, the mislabel would have a second cause',
  );

  // The verdict this raises: it must blame the PACKAGE, exonerate the config that
  // was merely holding the bag, and prescribe a rebuild of that package — never
  // the CLI build, which would change nothing here.
  //
  // The fallback keeps a classifier that stopped matching FAILING these
  // expectations by name, with their reasons, rather than crashing the self-test
  // on an undefined field and hiding every other finding behind one stack.
  const staleForDetail = staleDist ?? { kind: 'export-mismatch', pkg: '(unclassified)', missingExport: '', sentence: '' };
  const staleDetail = staleWorkspaceDistDetail(staleForDetail, { pkg: 'platform-objects', status: 1, remaining: 7 }).join('\n');
  expect('#7681 verdict names the stale package', staleDetail.includes('`@objectstack/spec`'), `got ${JSON.stringify(staleDetail)}`);
  expect(
    '#7681 verdict exonerates the config',
    /not of platform-objects's i18n config/.test(staleDetail),
    'the package holding the bag must be named innocent, in words',
  );
  expect('#7681 verdict carries the evidence', staleDetail.includes(EXPECTED_STALE_SENTENCE), 'a conclusion with no reading under it is not auditable');
  expect('#7681 verdict says what it did not attempt', staleDetail.includes('(7 package(s) not attempted)'), `got ${JSON.stringify(staleDetail)}`);
  expect(
    '#7681 verdict does not claim a stop it did not make',
    !staleWorkspaceDistDetail(staleForDetail, { pkg: 'platform-objects', status: 1, remaining: 0 })
      .join('\n')
      .includes('0 package(s) not attempted'),
    'the last package in the loop stopped nothing — the wording must not say it did',
  );
  expect(
    '#7681 prescribes rebuilding that package, not the CLI',
    workspaceBuildFix('@objectstack/spec') === 'pnpm exec turbo run build --filter=@objectstack/spec' &&
      workspaceBuildFix('@objectstack/spec') !== CLI_BUILD_FIX,
    `got ${JSON.stringify(workspaceBuildFix('@objectstack/spec'))}`,
  );
  const longSentence = staleWorkspaceDistDetail(
    { kind: 'export-mismatch', pkg: '@objectstack/spec', missingExport: 'x', sentence: 'S'.repeat(400) },
    { pkg: 'p', status: 1, remaining: 0 },
  ).join('\n');
  expect('#7681 long evidence is truncated', longSentence.includes(`${'S'.repeat(160)}…`), 'a 400-char sentence must not be pasted whole');

  if (failures.length) {
    console.error(`✗ check:i18n --self-test — ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(
    '✓ check:i18n --self-test — bundle-drift, undeclared-authoring-key, missing-CLI-build and ' +
      'stale-workspace-dist classifiers all go red, and stay distinct.',
  );
}

if (process.argv.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// The prerequisites: this gate runs the BUILT CLI (#5217), and the extract it
// runs loads the workspace's own built packages (#7681).
// ---------------------------------------------------------------------------

/**
 * ONE prerequisite and ONE command to satisfy it — never per package, and never
 * phrased so it can be mistaken for a verdict about the bundles.
 *
 * Exits 1, the same code the two real verdicts use: any wrapper that treats
 * non-zero as failure keeps behaving identically, and inventing a second failure
 * code would be a new contract nobody asked for.
 *
 * `scanned` is how many packages the loop had already attempted when the
 * prerequisite fired, and it is what keeps the closing paragraph TRUE. The
 * pre-loop probe fires at 0, where "nothing was checked" is exact; the in-loop
 * nets can fire later, and #7681's own run is that case — one package's extract
 * blew up while others had already printed "in sync". Those earlier lines are not
 * a clean bill either (they read the same unbuilt output), so the message says so
 * instead of claiming a nothing that did not happen. Same invariant as the
 * sibling coverage gate's partial-round wording (#6033): nothing judged, nothing
 * written.
 *
 * @param {string} headline
 * @param {string[]} detail
 * @param {{ fix?: string, alsoFix?: string[], scanned?: number }} [options]
 */
function reportPrerequisiteNotMet(headline, detail, options = {}) {
  const { fix = CLI_BUILD_FIX, alsoFix = [], scanned = 0 } = options;
  const nothingChecked =
    scanned === 0
      ? `  Nothing was checked: no bundle was compared and no config was parsed, so this\n` +
        `  result says NOTHING about whether the committed translation bundles are in sync.`
      : `  Nothing was judged: the failing package's bundles were never compared, the\n` +
        `  packages after it were never attempted, and the ${scanned} attempted before it read the\n` +
        `  same unbuilt output — an "in sync" line above is not a clean bill. So this\n` +
        `  result says NOTHING about whether the committed translation bundles are in sync.`;
  console.error(
    `\ncheck-i18n-bundles: PREREQUISITE NOT MET — ${headline}\n\n` +
      detail.map((l) => (l ? `  ${l}` : '')).join('\n') +
      `\n\n  Fix:  ${fix}\n` +
      alsoFix.map((l) => `        ${l}\n`).join('') +
      `\n${nothingChecked}\n` +
      `  (Exit code 1 — but piping this gate reports the PIPE's status, so\n` +
      `  \`pnpm check:i18n | tail -4\` reads green either way. Use \`echo "EXIT=$?"\`.)`,
  );
  process.exit(1);
}

/**
 * The stale-dependency prerequisite's detail lines (#7681). Pure and separate from
 * the printer so `--self-test` can prove the verdict blames the PACKAGE whose
 * build output is at fault, never the i18n config that was merely holding the bag
 * when it blew up — the whole defect being fixed.
 *
 * @param {{ kind: string, pkg: string, missingExport: string, sentence: string }} stale
 * @param {{ pkg: string, status: number, remaining: number }} at
 * @returns {string[]}
 */
function staleWorkspaceDistDetail(stale, at) {
  const quoted = stale.sentence.length > 160 ? `${stale.sentence.slice(0, 160)}…` : stale.sentence;
  const cause =
    stale.kind === 'export-mismatch'
      ? [
          `${at.pkg}'s extract exited ${at.status} loading \`${stale.pkg}\`: the module resolved,`,
          `but its build output does not carry the export the config needs —`,
          ``,
          `  ${quoted}`,
          ``,
          `\`${stale.pkg}\`'s dist predates the source that declares '${stale.missingExport}'. That is a`,
          `property of that package's build output — not of ${at.pkg}'s i18n config, and not`,
          `of its committed translation bundles.`,
        ]
      : [
          `${at.pkg}'s extract exited ${at.status} loading \`${stale.pkg}\`: the package is`,
          `installed but has no build output in this worktree —`,
          ``,
          `  ${quoted}`,
          ``,
          `That is a property of \`${stale.pkg}\` — not of ${at.pkg}'s i18n config, and not of`,
          `its committed translation bundles.`,
        ];
  return [
    ...cause,
    ``,
    ...(at.remaining > 0
      ? [
          `Every remaining package's extract loads the same output, so the loop stopped here`,
          `(${at.remaining} package(s) not attempted) rather than counting one environment fact as`,
          `bundle problems.`,
        ]
      : [`No package was left to attempt, and one environment fact is not a bundle problem.`]),
  ];
}

/**
 * Answered once, before the per-package loop — so a missing build costs one
 * verdict instead of one per package, and costs zero CLI spawns.
 *
 * Probes the exact command FILE the loop needs, not merely `dist/`: an
 * interrupted or partial build leaves the directory behind, and a `dist/` that
 * exists without `commands/i18n/extract.js` reproduces the nine-problem report
 * this check exists to prevent.
 *
 * When the CLI's package.json shape moves out from under the derivation, this
 * says so on stderr and defers to the in-loop signature net rather than failing:
 * a probe that cannot read the declaration must not turn a correctly-built
 * workspace red. It stays audible either way — the net is the enforcement, this
 * is only the cheap early answer.
 */
function checkCliBuildPrerequisite() {
  const resolved = resolveCliCommandFile(EXTRACT_COMMAND_ID);
  if (resolved.unknown) {
    console.error(`check-i18n-bundles: ${resolved.unknown} — build prerequisite not pre-checked`);
    return;
  }
  if (existsSync(resolved.file)) return;
  reportPrerequisiteNotMet('the workspace CLI is not built', [
    `This gate runs the BUILT CLI. ${CLI} is only a source stub that hands`,
    `off to oclif, which resolves \`os ${EXTRACT_COMMAND_ID.join(' ')}\` from the compiled`,
    `output — and that command is not there:`,
    ``,
    `  ${resolved.file}`,
  ]);
}

checkCliBuildPrerequisite();

const configs = findExtractConfigs('packages', 'packages')
  .map((c) => c.rel)
  .sort()
  .filter((c) => !filter || c.includes(filter));
if (configs.length === 0) {
  console.error(`check-i18n-bundles: no extract configs matched${filter ? ` --filter=${filter}` : ''}`);
  process.exit(1);
}

const drifted = [];
const broken = [];
/** One entry per package that authored a key the schema does not declare. */
const undeclared = [];
for (const [index, config] of configs.entries()) {
  const pkg = config.replace(/^packages\//, '').replace(/\/scripts\/i18n-extract\.config\.ts$/, '');
  const flags = flagsFromDocstring(config);
  const out = flags.find((f) => f.startsWith('--out='));
  if (!out) {
    broken.push(`${pkg}: its docstring documents no --out=<dir>, so the gate cannot tell where the bundles live`);
    continue;
  }
  const outDir = out.slice('--out='.length);
  if (!existsSync(outDir)) {
    broken.push(`${pkg}: documented --out directory does not exist: ${outDir}`);
    continue;
  }
  const args = [CLI, 'i18n', 'extract', config, ...flags, ...(write ? [] : ['--check'])];
  // `spawnSync`, not `execFileSync`: the unknown-authoring-key lint writes to
  // **stderr**, and execFileSync surfaces stderr only on the throw path — on a
  // zero-exit run it is discarded (previously: inherited straight to the
  // terminal, seen by nobody, judged by nothing). That asymmetry is precisely
  // how nine offending configs sat inside a green run. spawnSync hands back both
  // streams on both paths. Everything on stderr that is not the lint is
  // re-emitted below, so capturing it costs no diagnostics.
  const run = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.error) {
    broken.push(`${pkg}: could not run the extractor — ${run.error.message}`);
    console.log(`  ${pkg.padEnd(30)} ERROR`);
    continue;
  }
  const stdout = run.stdout ?? '';
  const stderr = run.stderr ?? '';
  const failed = run.status !== 0;

  // The prerequisites' safety net, and the reason the probe above is allowed to
  // defer instead of guessing. It fires on the cases the probe cannot see: a
  // stale build whose command surface no longer answers to this id, a partial
  // dist that satisfies the file check, or a package.json shape the derivation
  // could not read. Aborting on the FIRST package is the whole point — the
  // defect being fixed is nine reports of one cause, so the loop must not
  // continue accumulating them.
  //
  // TWO signatures are netted here, deliberately distinct (#7681). The CLI can be
  // built and this gate still unable to run: the extract loads the workspace's own
  // packages, and a `dist/` older than the source that added an export makes node
  // refuse the import. That failure used to fall past this net into the `else`
  // branch below — `broken.push('extract failed …')` — and printed as
  // "N bundle problem(s)", which is a CONTENT verdict about translation bundles
  // nothing ever compared, in the two words that send the reader to the i18n
  // configs. Neither signature may claim the other's cause: the remedies differ
  // (build the CLI vs rebuild that package), and a wrong one sends the reader to
  // run a command that changes nothing.
  if (failed) {
    const signature = looksLikeMissingCliCommand(`${stdout}\n${stderr}`);
    if (signature) {
      reportPrerequisiteNotMet(
        'the built CLI cannot resolve the command this gate runs',
        [
          `${pkg}'s extract exited ${run.status} with oclif's own "command not found":`,
          ``,
          `  ${signature.length > 160 ? `${signature.slice(0, 160)}…` : signature}`,
          ``,
          `Every remaining package would fail the same way for the same one reason, so the`,
          `loop stopped here rather than reporting it ${configs.length} times as bundle problems.`,
        ],
        { scanned: index },
      );
    }
    const stale = looksLikeStaleWorkspaceDist(`${stdout}\n${stderr}`);
    if (stale) {
      reportPrerequisiteNotMet(
        `a workspace package this gate loads is ${stale.kind === 'export-mismatch' ? 'built from older source' : 'not built'} — \`${stale.pkg}\``,
        staleWorkspaceDistDetail(stale, { pkg, status: run.status, remaining: configs.length - index - 1 }),
        {
          fix: workspaceBuildFix(stale.pkg),
          alsoFix: ['…or `pnpm build`, on a tree whose other packages may be stale too.'],
          scanned: index,
        },
      );
    }
  }

  const keyScan = collectUndeclaredKeys(`${stdout}\n${stderr}`);
  for (const line of passthroughStderrLines(stderr)) console.error(line);
  const hasUndeclared = keyScan.findings.length > 0 || keyScan.unattributed.length > 0;
  if (hasUndeclared) undeclared.push({ pkg, config, ...keyScan });
  // Marker on the per-package line so the two verdicts are already
  // distinguishable in the scan-line summary, not only in the report below.
  const keyNote = hasUndeclared ? '  ← UNDECLARED KEY' : '';

  if (write) {
    console.log(`  ${pkg.padEnd(30)} regenerated${keyNote}`);
    continue;
  }
  if (failed) {
    const stale = collectDriftedBundles(stdout);
    if (stale.length) {
      drifted.push(`${pkg}: ${stale.length} bundle(s) drifted from the schema`);
      console.log(`  ${pkg.padEnd(30)} DRIFTED (${stale.length})${keyNote}`);
    } else {
      // Not a drift result — the extract itself blew up. Never report that as
      // a pass; a config that cannot load is a broken gate, not a clean one.
      broken.push(`${pkg}: extract failed — ${(stdout.trim().split('\n').pop() || 'no output').trim()}`);
      console.log(`  ${pkg.padEnd(30)} ERROR${keyNote}`);
    }
    continue;
  }
  const n = (stdout.match(/(\d+) bundle\(s\) are in sync/) ?? [, '?'])[1];
  console.log(`  ${pkg.padEnd(30)} in sync (${n} bundle(s))${keyNote}`);
}

/** Render the undeclared-key verdict — its own section, never folded into drift. */
function reportUndeclaredKeys() {
  console.error(
    `\ncheck-i18n-bundles: UNDECLARED AUTHORING KEY in ${undeclared.length} package(s)\n` +
      `These keys are parsed away at load — whatever they were meant to configure is NOT\n` +
      `in effect, and never was. This is a separate verdict from bundle drift below/above;\n` +
      `regenerating bundles will not fix it.\n`,
  );
  for (const u of undeclared) {
    console.error(`  ${u.pkg}  (${u.config})`);
    for (const f of u.findings) {
      console.error(
        `    • '${f.key}' at ${f.path} is not a declared ${f.surface} key — dropped at load` +
          (f.hint ? ` (${f.hint.replace(/\.$/, '')})` : ''),
      );
    }
    for (const line of u.unattributed) {
      console.error(`    • ${line}  [gate could not parse the package/key out of this line — report it]`);
    }
  }
  console.error(
    `\nFix at the producer: delete the key from that config. If the key is genuinely\n` +
      `wanted, declare it in \`packages/spec\` deliberately — do not add a consumer-side\n` +
      `fallback, and do not make the schema strict to silence the lint (see this script's\n` +
      `header, and #4736/#4804 for why this is a hard failure rather than a warning).`,
  );
}

if (write) {
  if (undeclared.length) {
    reportUndeclaredKeys();
    console.error(`\n(--write regenerates bundles only; the keys above still need deleting by hand.)`);
  }
  process.exit(0);
}

if (broken.length || drifted.length || undeclared.length) {
  if (broken.length || drifted.length) {
    console.error(`\ncheck-i18n-bundles: ${broken.length + drifted.length} bundle problem(s)\n`);
    for (const b of broken) console.error('  • ' + b);
    for (const d of drifted) {
      console.error('  • ' + d);
    }
    if (drifted.length) {
      console.error(
        `\nRegenerate and commit: node scripts/check-i18n-bundles.mjs --write\n` +
          `Merge mode is on for translated locales, so no existing translation is\n` +
          `overwritten — new schema keys are added filled with the source text, and they\n` +
          `still need translating. The default locale (en) is rewritten from the source\n` +
          `on every run (#8543): it is a copy of the source, not a translation.`,
      );
    }
  }
  if (undeclared.length) reportUndeclaredKeys();
  process.exit(1);
}
console.log(
  `\ncheck-i18n-bundles: OK (${configs.length} package(s) — all bundles in sync, no undeclared authoring keys).`,
);
