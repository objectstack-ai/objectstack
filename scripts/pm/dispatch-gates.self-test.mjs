// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * dispatch-gates.self-test — the battery of `dispatch-gates.mjs`, in its own module.
 *
 *   node scripts/pm/dispatch-gates.mjs --self-test          # both tiers: the battery CI runs
 *   node scripts/pm/dispatch-gates.mjs --self-test --fast   # the fast tier alone: what a dev delivery runs
 *
 * This module exports one function and runs nothing on import; the engine's `--self-test` branch is
 * its only caller, and the verdict it returns is the engine's `SELF_TEST_VERDICT` handshake. It
 * drives the engine's exported derivation functions and the data rows beside it, against fixtures
 * and against the live tree.
 *
 * ## Two tiers
 *
 * FAST — every in-process case: fixture derivations, path matching, the marker grammars, the
 * renderings, and the one memoised discovery of this tree. SLOW — the full replay: every section
 * that spawns the tool's own CLI as a child, builds a temporary git repository, or sweeps the whole
 * tracked corpus file by file. Each slow section is wrapped in `slow(label, …)` below; a fast run
 * prints the label of every section it defers, and the tail pins that the two tiers partition the
 * battery, so a case can be in neither tier only by failing that pin. ⛔ No case was dropped by the
 * split: a run of both tiers is the battery as it was before the tiers existed.
 *
 * ## Why the battery is not in the engine file
 *
 * The engine's watch hints are read from its module body, and a self-test of a path-matching tool is
 * made of path strings. Masking the self-test out of the scan was the standing repair; keeping the
 * fixtures in a module no gate resolves to and no gate imports removes the question. The engine
 * declares its own inherited population from what it OPENS, so this move changed no derivation.
 */

import { spawnSync } from 'node:child_process';
import {
  readFileSync,
  readdirSync,
  existsSync,
  statSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { flagsExtractMetadataForms, isExtractConfigPath, isMetadataFormModulePath } from '../i18n-bundle-surface.mjs';
import { EXIT_PREREQUISITE_NOT_MET } from '../import-prerequisite.mjs';
import { maskComments, scanSource } from '../js-comment-mask.mjs';
import { invokedAs } from '../invoked-as.mjs';
import { GOVERNED_REPOS, HUMAN_MERGE_LINE_THRESHOLD, SELF_REPO_ID } from './check-governed-merges.mjs';
import { isTestPath } from '../check-undeclared-dep-imports.mjs';
import {
  ALWAYS_RUN_COMMAND_CAP,
  ANCHOR_CENSUS_EXTENSIONS,
  CHANGESET_PROBE_PATH,
  CHANGE_KIND_GATES,
  bindChangeKindRows,
  bindMandatoryTierRows,
  bindSuspectTierRows,
  COMPOUND_ANCHOR_KEYS,
  CONTRACT_REVIEW_TIER,
  CONTRACT_REVIEW_TIER_NAME,
  DEFAULT_BASE_BRANCH,
  DEFAULT_BASE_REF,
  DEFAULT_BASE_REMOTE,
  ESCAPABLE_LITERAL_LEDGER,
  GENERATED_MODULE_SOURCES,
  HARVEST_SNIPPET,
  INHERITED_POPULATION_MARKER,
  MANDATORY_TIER_GLOBS,
  MARKER_LOOKALIKES,
  MARKER_REASON_GRAMMARS,
  NO_DIFF_REFUSAL,
  POPULATION_DECLARATION_FIELDS,
  PROGRAM_TEXT_TARGET,
  PR_TIME_TRIGGER_EVENTS,
  RAN_FLAG,
  REPO_FLAG,
  REPO_ROOT_WALK_SPELLINGS,
  ROOT,
  ROOT_WALK_RESIDUE_REASONS,
  RUN_RECORD_EXIT_PREFIX,
  RUN_RECORD_KILL_EXITS,
  RUN_RECORD_NOT_MEASURED_KILL_SOURCE,
  RUN_RECORD_REASON_SEPARATOR,
  RUN_RECORD_UNMEASURED_MARKER,
  SELF_TEST_VERDICT,
  SUSPECT_TIER_GLOBS,
  TIER_CEILING,
  USAGE_LINE,
  absentDeclaredPaths,
  absentPathVerdict,
  alwaysRunLines,
  alwaysRunSteps,
  alwaysRunsPopulationLines,
  anchoredReadTargets,
  argvTokens,
  artifactOnlyNote,
  artifactOnlySilence,
  artifactRosterLines,
  bannerLines,
  baseDrift,
  ceilingTierSpellings,
  changeKindGates,
  changeKindLines,
  changedLineLines,
  changedPathsFromGit,
  checkFamilyCoverageGaps,
  ciOnlyMeasurement,
  classifyEntry,
  collapseHint,
  commandsFor,
  commonDirectory,
  comparedForm,
  compositeActionRunsBlock,
  compoundAnchorDecls,
  containerModelRefusal,
  coveringJobFilter,
  coveringKey,
  coveringTrigger,
  deadHintSweep,
  deadNamesNote,
  declaredArgvDefaults,
  declaredFileTarget,
  declaredInheritedPopulation,
  declaredLocalEnv,
  declaredNoCheckFamiliesReason,
  declaredNoPathPopulation,
  declaredSelfTestReads,
  declaredTriggerEvents,
  declaredWholeTreePopulation,
  declaredWidePopulation,
  declaresPullRequestTrigger,
  deepestTrackedPrefix,
  defaultedArgv,
  derivationProvenance,
  deriveTier,
  discoverFamilies,
  discoveryPassCount,
  driftLines,
  emitsAnHttpStatus,
  escapableLiteralKey,
  escapableLiteralRows,
  exportedValueConstant,
  exposedScratchDirs,
  extensionlessModuleTarget,
  extractCheckInvocations,
  extractJobBlocks,
  extractJobOutputSources,
  extractPathsFilterSteps,
  extractStepBlocks,
  extractTriggerPaths,
  extractWatchHints,
  familyReconciliation,
  familyReconciliationLines,
  firstPartyImportBindings,
  firstPartyImportTargets,
  followCompositeActions,
  gateFamilyFiles,
  generatedModuleSources,
  globCarriesLiteralSuffix,
  globInNonFinalSegment,
  governedReadCensus,
  governedSisterRepo,
  hashCommentProgram,
  hintCovers,
  hintReachesTree,
  ignoreVerdicts,
  i18nBundlePackageDirs,
  importBindsNoPopulation,
  isGateScriptPath,
  isInI18nBundlePackage,
  isInRootTsProgram,
  isNonPathNamespace,
  isPlainTopLevelDir,
  isTestFilePath,
  isTypeCheckInvocation,
  jobFilterOutputRefs,
  jobFilterPopulation,
  jobFilteredStepLines,
  jobFilteredSteps,
  jobPathPopulations,
  joinLineContinuations,
  judgedAsPattern,
  leadingCommentBlock,
  lineCountOf,
  lineFormReason,
  localCompositeActionUses,
  localEnvAdmitted,
  localEnvRefusal,
  machineReadableOutput,
  markerFormKind,
  markerFormsFor,
  markerReasonCutRefusal,
  maskSelfTests,
  maskShellComments,
  metadataFormModulePaths,
  metadataFormsSurfaceIsExtracted,
  notRunnableCommandSet,
  outsideBlockCounts,
  outsideBlockNames,
  owningPackageOfExtractConfig,
  packageManifestTargets,
  packageRootBinding,
  parseRepoSlug,
  parseRunRecord,
  pathListMarkerPattern,
  payloadEnvDependence,
  pendingChangesetFamilies,
  pendingChangesetLines,
  placeFamily,
  populationMarkerPattern,
  populationReasonContinuation,
  populationReasonCutRefusal,
  reachesMetadataFormModule,
  readContainerModelLine,
  readPopulationDeclaration,
  readPopulationMarker,
  readProgramTargetsInSource,
  refuseCutMarkerReason,
  refusedAsTooGeneric,
  renderedArgv,
  repoAssertionVerdict,
  repoCorpus,
  repoIdentity,
  repoRootWalkSpelling,
  residueLines,
  residueNames,
  resolveCheckToFiles,
  resolveModuleRelativeHint,
  rootTsProgramExcludedDirs,
  rootTsconfigExcludeEntries,
  rosterCheckerHealth,
  runCommandSteps,
  runCommandTexts,
  runReconciliation,
  runReconciliationLines,
  runRecordKillLabel,
  runnableInvocation,
  scratchDirSitesInSource,
  selfTestCaseLines,
  selfTestOnlyInvocation,
  sisterRepoTierRun,
  spawnedProgramTargets,
  spellingFooterLines,
  spellingSplit,
  splitArgv,
  stampsAnErrorCodeLiteral,
  tierLines,
  tierWordOf,
  trackedFiles,
  trackedPrefixes,
  triggerCovers,
  triggerListCovers,
  typeCheckLaneLines,
  typeCheckLaneSteps,
  unnamedRootWalk,
  unparsedPopulationMarkerRefusal,
  unparsedPopulationMarkers,
  unreachableClass,
  unreachableFamilies,
  unreachableLines,
  unreachableReason,
  watchHintTree,
  wholeTreePopulationRefusal,
  widePopulationLines,
  widePopulationRefusal,
  withoutAnchor,
  workflowEnvValues,
  zeroSegmentForms,
} from './dispatch-gates.mjs';
import {
  COMPOUND_ANCHOR_LEDGER,
  GOVERNED_READ_FLOOR,
  MARKER_COMMENT_FORMS,
  MARKER_KEY_FORMS,
  PATH_LIST_MARKER_KEYS,
  POPULATION_MARKER_KEYS,
  REASON_TAIL_MARKER_KEYS,
  RETIRED_TIER_WORDS,
  ROOT_WALK_RESIDUE_LEDGER,
  TIER_DEFAULT,
  TIER_FLOOR,
} from './dispatch-gates.data.mjs';

/**
 * The battery. `tier` is `'full'` (both tiers, the default) or `'fast'`; it returns
 * `SELF_TEST_VERDICT` only after the verdict line printed, and exits 1 itself on a failed case.
 */
export function selfTest({ tier = 'full' } = {}) {
  const cases = [];
  const ENGINE_URL = new URL('./dispatch-gates.mjs', import.meta.url);
  // Two tiers of one battery. The FAST tier is every in-process case — fixture derivations, path
  // matching, the grammars, the rendering, and the one memoised discovery of this tree. The SLOW
  // tier is the full replay: every case that spawns this tool's own CLI, builds a temporary git
  // repository, or sweeps the whole tracked corpus. A run of both is byte-identical to the battery
  // before the tiers existed; a fast run defers each slow section by name and says so.
  const tiers = { fast: true, slow: tier !== 'fast' };
  let tierNow = 'fast';
  const tierCases = { fast: 0, slow: 0 };
  const tierMillis = { fast: 0, slow: 0 };
  const deferred = [];
  const tierStarted = Date.now();
  const slow = (label, run) => {
    if (!tiers.slow) {
      deferred.push(label);
      console.log(`  ⏭ SLOW TIER, not run in this tier — ${label}`);
      return;
    }
    const started = Date.now();
    tierNow = 'slow';
    try {
      run();
    } finally {
      tierNow = 'fast';
      tierMillis.slow += Date.now() - started;
    }
  };
  // How many cases handed `t` a diagnostic reading (#15539). Read by one case
  // near the tail, after every call site that passes one has run.
  let detailedCases = 0;
  // Stream the verdict the moment it is decided (#14281) rather than only at
  // the tail: every `t()` call evaluates `cond` eagerly at the call site, so
  // the line below is not a preview of the tail loop's output — it prints the
  // SAME verdict, just however many calls earlier than a buffered run did. A
  // run that dies mid-battery (the container's foreground cap SIGTERMs a run
  // past ~10 minutes; see check-dispatch-gates.mjs's header for the detached
  // workaround) used to leave zero case lines; now the log already carries
  // every case decided before the kill. `cases` still collects every entry —
  // the tail's `failed`/`length` summary reads it unchanged.
  const t = (name, cond, detail = null) => {
    cases.push([name, cond]);
    tierCases[tierNow] += 1;
    // Counted so the repair cannot go vacuous: the six call sites #15539 names
    // were passing this argument into a function that had no parameter for it,
    // and a case that only pins the RENDERER would stay green the day someone
    // "cleaned up" the arguments those call sites pass. See the case near the
    // tail that reads this.
    if (detail !== null && detail !== undefined && detail !== '') detailedCases += 1;
    // The third parameter is #15539's whole repair: six call sites below were
    // already passing a diagnostic reading into an arity-two function. It is
    // rendered by `selfTestCaseLines` rather than here so both directions are
    // pinned by cases of their own.
    for (const line of selfTestCaseLines(name, cond, detail)) console.log(line);
  };

  // ── A subject this TREE cannot decide is not a passing case (#15255) ──────
  //
  // A handful of cases below read the REAL corpus rather than a fixture,
  // because a fixture cannot show that a live specimen still reaches the tree
  // it names. That is the right shape, and it carries one hazard a fixture does
  // not: the specimen's population is a property of the tree, and a tree may
  // legitimately hold none of it. `.changeset/*.md` is the measured instance —
  // a changesets version pass consumes the whole population by design, so the
  // Version Packages PR carries a tree the corpus assertions cannot be
  // evaluated over, and `main` carries one for as long as it takes the next
  // changesets to land.
  //
  // The control that guarded them asserted the population itself
  // (`length >= 100`), which is a claim about the release cycle rather than
  // about this tool, and it made a REQUIRED context red on the one PR whose
  // merge IS the release. ⛔ The repair is not a quiet `if` around them either:
  // a silent skip is exactly how a specimen rots unnoticed, which is the
  // failure the population control was reaching for in the first place.
  //
  // So an undecidable subject is neither: it prints its own line, states WHY
  // this tree cannot decide it in words a reader can check, and is counted
  // apart from `cases` in the verdict. It is never pushed into `cases` — there
  // it would be one more `✓`, indistinguishable from a case that ran.
  const notMeasured = [];
  const unmeasurable = (subject, why) => {
    notMeasured.push([subject, why]);
    console.log(`  ⊘ NOT MEASURED — ${subject}`);
    console.log(`      ${why}`);
  };

  /**
   * The verdict's NOT-MEASURED suffix — a pure renderer so the two properties
   * that matter can be pinned on fixtures instead of on a run of this tree,
   * which by construction skips nothing: it is EMPTY when nothing was skipped,
   * so a fully-measured run's verdict line is byte-identical to the one this
   * file printed before the tally existed; and it NAMES every skipped subject
   * when there is one, so no skip can reach a reader as a bare pass count.
   */
  const notMeasuredSuffix = (entries) =>
    entries.length ? ` ⊘ ${entries.length} subject(s) NOT MEASURED on this tree — ${entries.map(([s]) => s).join(' · ')}.` : '';

  /**
   * The `.changeset/*.md` live specimen's population in a corpus, and the whole
   * decision behind the block far below: with one member the corpus assertions
   * are real, with none they are vacuous. Named and pure so both of its call
   * sites ask the same question and so the boundary can be pinned at the sizes
   * the release cycle really produces, rather than only at the one this tree
   * happens to be at today.
   */
  const changesetSpecimenPop = (corpus) => corpus.filter((f) => /^\.changeset\/[^/]+\.md$/.test(f));

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

  // ── The package-local gate lane: a path is keyed WHOLE (#15342) ───────────
  //
  // `lint.yml` invoked `packages/lint/scripts/check-reference-carrier-shape.mjs`
  // by path, twice (that gate is retired; the lane has no live member today, so
  // these cases are synthetic on purpose and are what holds the grammar).
  // Before the directory prefix documented beside the patterns,
  // `node ` had to be followed IMMEDIATELY by `scripts/`, so neither matcher saw
  // that step at all: no family, no hints, and nothing for `--residue` to place.
  //
  // Cases 1-3 and 6 FAIL against the base spelling — measured by applying this
  // battery to `/node[ \t]+(scripts\/…)/` in a scratch ablation — which is what
  // makes them an instrument rather than a restatement of the operators. Cases
  // 4, 5, 7 and 8 hold on BOTH spellings: they are the controls that prove the
  // widening did not buy its new answers by dropping the old ones.
  {
    const PKG = 'packages/lint/scripts/check-reference-carrier-shape.mjs';
    const pkgInvs = extractCheckInvocations(
      ['jobs:', '  lint:', '    steps:', '      - name: package-local gate', '        run: |',
        `          node ${PKG} --self-test`, `          node ${PKG}`].join('\n'),
      'lint.yml',
    );
    t(
      'a gate CI invokes by a PACKAGE-LOCAL path is discovered at all — unfound, it is in no family, so no '
        + 'card can be told to run it and --residue has no bucket to place it in either (#15342)',
      pkgInvs.some((i) => i.check === `${PKG} --self-test` && i.direct),
    );
    t(
      '…and its bare production invocation arrives as the SECOND family under its own key, the #14880 split',
      pkgInvs.some((i) => i.check === PKG && i.direct),
    );
    t(
      '…both keyed by the REAL path, which is what `entry.files` carries and `existsSync` then opens',
      pkgInvs.length === 2 && pkgInvs.every((i) => i.script === PKG),
    );
    t(
      'control — no PHANTOM root key is minted beside them: a `scripts/…` TAIL keyed as a path in its own '
        + 'right names a file this ROOT does not hold, and every audit downstream then passes for the wrong reason',
      !pkgInvs.some((i) => String(i.script ?? i.check).startsWith('scripts/')),
    );
    t(
      'control — a CLIMBING spelling is refused rather than resolved: `..` is not a prefix segment, because '
        + 'a path this ROOT cannot resolve is exactly how a phantom identity key gets minted',
      extractCheckInvocations('    - run: node ../scripts/check-x.mjs\n', 'x.yml').length === 0,
    );
    t(
      'the SELF-TEST matcher carries the same prefix grammar — a package-local gate not named `check-*` '
        + 'would otherwise be discovered by neither matcher, which is this silence one filename over',
      extractCheckInvocations('    - run: node packages/lint/scripts/carrier-census.mjs --self-test\n', 'x.yml')
        .some((i) => i.check === 'packages/lint/scripts/carrier-census.mjs --self-test' && i.direct),
    );
    t(
      'control — the prefix widens the DIRECTORY a gate may sit under and never the SPECIES of file: a path '
        + 'with no `scripts/` segment is still admitted by neither matcher (`packages/cli/bin/run.js` is live)',
      extractCheckInvocations('    - run: node packages/cli/bin/run.js check\n', 'x.yml').length === 0,
    );
    t(
      'control — a root-spelled invocation is keyed BYTE-IDENTICALLY to before, so the prefix re-attributes '
        + 'nothing: it matches empty there and the remainder of each pattern is unchanged',
      extractCheckInvocations('    - run: node scripts/check-nul-bytes.mjs\n', 'x.yml')
        .every((i) => i.check === 'scripts/check-nul-bytes.mjs' && i.script === 'scripts/check-nul-bytes.mjs'),
    );
  }

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
  // The key carries the argv the block body really spells (#15083), so the
  // subject of this case — a direct script pulled out of a literal block —
  // is asserted on the invocation the body contains rather than on a bare path
  // the body does not.
  t('extracts a direct script from a literal block body', blockNames.includes('scripts/check-adr-0087-registration.mjs --base "$MERGE_BASE"'));
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

  // ── The self-test invocation matcher (#11404) ─────────────────────────────
  //
  // A gate whose script follows neither naming convention was not a family at
  // all — absent from the matched list, the convention list, the unreachable
  // list and all three residue buckets, because it never entered the universe
  // those partition. The specimen is the one that shipped the red on PR #11397
  // over a diff whose seven derived families were all green.
  const selfTestWf = [
    'jobs:',
    '  gates:',
    '    steps:',
    '      - name: Bare-root worklist self-test',
    '        run: node scripts/pm/bare-root-worklist.mjs --self-test',
    '      - name: Release tooling, not a gate',
    '        run: node scripts/release-github-releases.mjs',
    '      - name: A wrapper whose WRAPPED command carries the flag',
    '        run: node scripts/run-with-stall-guard.mjs --log "/tmp/x.log" --stall-minutes 10 -- pnpm test',
    '      - name: Two commands, one body, only the second is a self-test',
    '        run: |',
    '          node scripts/docs-audit/affected-docs.mjs --json base > affected.json',
    '          node scripts/pm/git-history.mjs --self-test',
  ].join('\n');
  const stInvs = extractCheckInvocations(selfTestWf, 'lint.yml');
  const stNames = stInvs.map((i) => i.check);
  // Absent rather than thrown: with the matcher ablated these lookups return
  // nothing, and a self-test that CRASHES instead of naming its failing case
  // reports "something is broken" where the whole value is "this exact case
  // went red". Measured — the first ablation run of this change died on a
  // destructure here and printed no case name at all.
  const stFind = (name) => stInvs.find((i) => i.check === name) ?? { check: '(not discovered)', direct: true };
  t(
    'the gate that shipped the red on PR #11397 is discovered, flag included',
    stNames.includes('scripts/pm/bare-root-worklist.mjs --self-test'),
  );
  t(
    '…as a DIRECT family resolving to the script file, not to the flagged key',
    stFind('scripts/pm/bare-root-worklist.mjs --self-test').script
      === 'scripts/pm/bare-root-worklist.mjs',
  );
  t(
    '…and it prints as a command a dev can paste, flag included — the bare path exits 0 without testing anything',
    runnableInvocation(stFind('scripts/pm/bare-root-worklist.mjs --self-test'))
      === 'node scripts/pm/bare-root-worklist.mjs --self-test',
  );
  // The refusal, which is the half that keeps this from being the widening
  // `hintCovers` prices at +139084 pairs: a `scripts/**` script in a `run:`
  // step is NOT a gate unless it says so.
  t(
    'a scripts/ script invoked WITHOUT the flag is not a family',
    !stNames.some((n) => String(n).includes('release-github-releases')),
  );
  // The over-match guard, both live shapes. A command text is one whole `run:`
  // body, so the flag must not travel backwards across a separator or a value.
  t(
    'a wrapper does not absorb the flag of the command it wraps — the `--` separator and the quoted --log value both stop the match',
    !stNames.some((n) => String(n).includes('run-with-stall-guard')),
  );
  t(
    'the FIRST command in a two-command body does not take the SECOND command\'s flag',
    !stNames.some((n) => String(n).includes('affected-docs')),
  );
  t(
    '…while the second command, which really carries it, is discovered',
    stNames.includes('scripts/pm/git-history.mjs --self-test'),
  );
  // The no-double-count property: ONE workflow invocation yields ONE family,
  // whichever matcher admits it.
  //
  // ⚠️ This case was rewritten by #14880 and the rewrite is deliberate, so the
  // two halves it used to assert together are separated here. Its COUNT half —
  // one invocation, one family — is the invariant #11404 built the `check-`
  // skip to protect, and it is untouched: the direct matcher admits this
  // invocation and the self-test matcher skips it. Its KEY half asserted that
  // the family lands under the BARE path key, and that half WAS the defect
  // #14880 fixed: it is what collapsed CI's two invocations of one script into
  // the plain one and left the failing `--self-test` invocation with no entry.
  // The key now carries the argv (`renderedArgv`'s docblock has the
  // measurement), so the expectation moves with it.
  const dualWf = [
    'jobs:',
    '  j:',
    '    steps:',
    '      - run: node scripts/check-adr-0087-registration.mjs --self-test',
  ].join('\n');
  const dualInvs = extractCheckInvocations(dualWf, 'x.yml');
  const dualNames = dualInvs.map((i) => i.check);
  t(
    'a check- script invoked with the flag is ONE family, not one per matcher',
    dualNames.length === 1,
  );
  t(
    '⭐ …and its key carries the flag, so the invocation CI runs is the one derived (#14880)',
    dualNames[0] === 'scripts/check-adr-0087-registration.mjs --self-test',
  );
  t(
    '…resolving to the script FILE, never to the flagged key — the flag is not a path',
    dualInvs[0]?.script === 'scripts/check-adr-0087-registration.mjs',
  );
  t(
    '…and it is marked as a self-test invocation, which is what the follow narrowings read',
    dualInvs[0]?.selfTest === true,
  );

  // ── The derivation KEY is (script, args) (#14880), and the argv is RENDERED
  //    rather than refused (#15083) ───────────────────────────────────────────
  //
  // #14880's third mechanism, and the one no better output mode reaches: the
  // derived list named the PLAIN invocation of a script CI also runs with a
  // flag, and the flagged invocation was the red one. That split is pinned
  // below, unchanged.
  //
  // ⚠️ #14880's other half — the REFUSAL — is what #15083 retired, so the two
  // cases that pinned it are rewritten here rather than dropped. They asserted
  // that a value-bearing tail and a continued tail keep the BARE path key, and
  // that key is an invocation CI never runs: measured on this tree,
  // `node scripts/check-test-completeness.mjs` exits 3 with `PREREQUISITE NOT
  // MET`, and four more of the nine answer a different question than CI asks.
  // The subject of each case is unchanged — same tail, same fixture — and what
  // moved is the expectation, from "keeps the bare key" to "renders in full and
  // says whether it is runnable". Every OTHER case in this block keeps its
  // verdict untouched, the two census cases and the redirection case included.
  //
  // The fixtures below are QUOTED FROM the live workflow text, invocation for
  // invocation, so no case can pin a shape the tree does not have. Their
  // sources: `pr-automation.yml` (the `--base` gates), `ci.yml` (the shard
  // attestation), `engine-split-metric.yml` (`--days 90`),
  // `required-set-patrol.yml` (a complete argv behind a continuation and a
  // redirection), `prerelease-pin-watch.yml` (`--verbose 2>&1`). The live half
  // at the end of the block re-reads them from the workflows themselves.
  const keyWf = [
    'jobs:',
    '  gates:',
    '    steps:',
    '      - name: Both invocations, the shape lint.yml really uses',
    '        run: |',
    '          node scripts/check-tenant-audit-census.mjs --self-test',
    '          node scripts/check-tenant-audit-census.mjs',
    '      - name: VARIABLE — pr-automation.yml pins the base to a step output',
    '        run: node scripts/check-empty-changeset.mjs --base "$MERGE_BASE"',
    '      - name: VARIABLE — ci.yml continues the attestation across two more lines',
    '        run: |',
    '          node scripts/check-shard-attestation.mjs --emit \\',
    '            --job test --shard ${{ matrix.shard }} --total 6 \\',
    '            --out "$RUNNER_TEMP/att"',
    '      - name: LITERAL — engine-split-metric.yml writes the window down',
    '        run: node scripts/check-engine-split-ratio.mjs --days 90',
    "      - name: LITERAL behind a CONTINUATION and a REDIRECTION, both the shell's",
    '        run: |',
    '          node scripts/check-required-contexts.mjs --verify-required-set \\',
    '            > "$RUNNER_TEMP/required-set.md" 2> "$RUNNER_TEMP/required-set.err"',
    '      - name: LITERAL whose line ends in a REDIRECTION carrying its own fd',
    '        run: node scripts/check-prerelease-pin-watch.mjs --verbose 2>&1',
    '      - name: A complete flag run whose line ends in a REDIRECTION, not an argument',
    '        run: node scripts/check-release-section-coverage.mjs --strict > "$RUNNER_TEMP/x.txt"',
  ].join('\n');
  const keyInvs = extractCheckInvocations(keyWf, 'lint.yml');
  const keyNames = keyInvs.map((i) => i.check);
  const censusKeys = keyNames.filter((n) => n.startsWith('scripts/check-tenant-audit-census.mjs'));
  t(
    '⭐ the two census invocations derive TWO entries, not one collapsed onto the plain run',
    censusKeys.length === 2
      && censusKeys.includes('scripts/check-tenant-audit-census.mjs --self-test')
      && censusKeys.includes('scripts/check-tenant-audit-census.mjs'),
  );
  t(
    'CONTROL: the plain census entry is still there — the fix ADDS the flagged invocation, it does not move the plain one',
    keyNames.includes('scripts/check-tenant-audit-census.mjs'),
  );
  t(
    '…and both print as commands a dev can paste, each reproducing the invocation CI runs',
    keyInvs
      .filter((i) => i.script === 'scripts/check-tenant-audit-census.mjs')
      .map((i) => runnableInvocation(i))
      .sort()
      .join('|')
      === 'node scripts/check-tenant-audit-census.mjs|node scripts/check-tenant-audit-census.mjs --self-test',
  );
  // ⭐ THE VARIABLE KIND (#15083). Rewritten from "keeps the bare path key": the
  // bare key is an invocation `pr-automation.yml` never makes, and it answered
  // against the DEFAULT base while CI pins it to the PR's merge base. The
  // invocation now renders in full, with the variable's own name in the value
  // position, and carries the variable so the row can be labelled.
  const emptyKey = keyInvs.find((i) => i.script === 'scripts/check-empty-changeset.mjs');
  t(
    '⭐ an invocation whose tail carries a VARIABLE renders in FULL, and the bare key CI never runs is gone',
    keyNames.includes('scripts/check-empty-changeset.mjs --base "$MERGE_BASE"')
      && !keyNames.includes('scripts/check-empty-changeset.mjs'),
  );
  t(
    '…and it carries the variable it takes from the workflow, which is what marks the row NOT RUNNABLE LOCALLY',
    (emptyKey?.argvVariables ?? []).join(',') === '$MERGE_BASE',
  );
  // ⭐ The sharpest of them, and the one a terminator at the backslash would
  // have got wrong in the direction that LOOKS right: ` --emit ` reads as a
  // complete flag run and the invocation's real values are on the next two
  // lines. Joining is how the whole argv arrives; refusing it was how a
  // truncation was avoided before there was a join.
  const shardKey = keyInvs.find((i) => i.script === 'scripts/check-shard-attestation.mjs');
  t(
    '⭐ an invocation CONTINUED across two lines renders as ONE command, values and all',
    shardKey?.check
      === 'scripts/check-shard-attestation.mjs --emit --job test --shard ${{ matrix.shard }} --total 6 --out "$RUNNER_TEMP/att"',
  );
  t(
    '…with BOTH of its workflow variables named, the expression and the shell expansion',
    (shardKey?.argvVariables ?? []).join(',') === '${{ matrix.shard }},$RUNNER_TEMP',
  );
  t(
    '…and ⛔ no bare key survives beside it — a bare run of this script is an invocation ci.yml never makes',
    !keyNames.includes('scripts/check-shard-attestation.mjs'),
  );
  // ⭐ THE LITERAL KIND (#15083) — three shapes, all of them renderable, and the
  // last two were refused before this card only because a REDIRECTION and a
  // CONTINUATION stood behind an argv that was already complete.
  const literalKeys = [
    'scripts/check-engine-split-ratio.mjs --days 90',
    'scripts/check-required-contexts.mjs --verify-required-set',
    'scripts/check-prerelease-pin-watch.mjs --verbose',
  ];
  t(
    '⭐ an invocation whose every token is a LITERAL renders as the command CI runs, value included',
    literalKeys.every((k) => keyNames.includes(k)),
  );
  t(
    '…and every one of them is runnable — no variable, so nothing to label',
    keyInvs.filter((i) => literalKeys.includes(i.check)).every((i) => i.argvVariables.length === 0),
  );
  t(
    '…and none of the three keeps a bare key CI never runs',
    !['scripts/check-engine-split-ratio.mjs', 'scripts/check-required-contexts.mjs', 'scripts/check-prerelease-pin-watch.mjs']
      .some((k) => keyNames.includes(k)),
  );
  // ⛔ The truncation this card must not reintroduce, asserted as a shape over
  // every key rather than as one expectation: a key ending in a dangling flag,
  // a bare backslash or a stray redirection fd is the outcome #14880 refused
  // the whole class to avoid, and rendering is only an improvement while none
  // of them can appear.
  //
  // ⭐ The QUOTE half (#15116). `DIRECT_CHECK_INVOCATION` cuts at `(`, so a
  // value written as a command substitution is cut INSIDE its own construct and
  // leaves a tail whose quote never closes — `--base "$` from
  // `--base "$(git merge-base origin/main HEAD)"`. Reading that shape here is
  // deliberately INDEPENDENT of `argvTokens`: this scans the finished KEY with
  // the shell's own outermost-quote rule (a `'` inside a `"…"` is text, not a
  // delimiter), so a bug in the tokeniser cannot make the pin agree with it. A
  // parity count would not do — measured on this tree zero live keys nest a
  // quote, and the day one does a parity scan calls a balanced key truncated.
  const carriesTruncation = (text) => {
    const s = String(text);
    let quote = null;
    let i = 0;
    while (i < s.length) {
      if (quote !== null) {
        if (s[i] === quote) quote = null;
        i += 1;
        continue;
      }
      if (s[i] === "'" || s[i] === '"') {
        quote = s[i];
        i += 1;
        continue;
      }
      if (s.startsWith('${{', i)) {
        const close = s.indexOf('}}', i + 3);
        if (close === -1) return true;
        i = close + 2;
        continue;
      }
      i += 1;
    }
    return quote !== null || /\$(?=\s|$)/.test(s);
  };
  // The statement is over EVERY derived key and it is the contrapositive rather
  // than a flat "every key is balanced": under this file's own rule a truncated
  // tail is NAMED — its unresolved remainder is a value the workflow supplies,
  // so the row is marked NOT RUNNABLE LOCALLY and the key stays out of
  // `--commands`. What must never happen is a truncation that RENDERS as a
  // command a dev can paste, and that is exactly what this says.
  t(
    '⛔ no derived key is a TRUNCATED argv — no continuation backslash, no redirection fd surviving as an argument, and ⭐ no key carrying an unclosed quote, an unclosed ${{ … }} or a bare `$` is RUNNABLE (#15116)',
    keyNames.every((n) => !/\\/.test(n))
      && keyNames.includes('scripts/check-prerelease-pin-watch.mjs --verbose')
      && !keyNames.some((n) => /^scripts\/check-prerelease-pin-watch\.mjs --verbose\s+\d+$/.test(n))
      && keyInvs.every((i) => !carriesTruncation(i.check) || (i.argvVariables ?? []).length > 0),
  );

  // ⭐ THE UNRENDERABLE KIND (#15116), and this fixture is the ONLY place the
  // tree has it. Measured at this commit: 114 direct invocations across
  // `.github/workflows` and ZERO carry a paren or a terminator inside a quoted
  // value — the three paren hits in the workflow text are all comment lines. So
  // unlike `keyWf` above, whose every step is quoted from live workflow text,
  // this fixture is WRITTEN rather than quoted, and it says so: the shape is
  // latent, and a fixture is what stands in for a tree that does not have it
  // yet. The live half at the end of the block asserts the same property over
  // the workflows and is vacuous today by that measurement, which is the whole
  // reason these three steps exist.
  const cutWf = [
    'jobs:',
    '  gates:',
    '    steps:',
    '      - name: a command substitution in the value position — the tail is cut at the paren',
    '        run: node scripts/check-x.mjs --base "$(git merge-base origin/main HEAD)"',
    '      - name: a terminator INSIDE a quoted value — the tail is cut at the semicolon',
    "        run: node scripts/check-y.mjs --gate 'a;b'",
    '      - name: CONTROL — the two live spellings, which must classify exactly as before',
    "        run: node scripts/check-z.mjs --gate 'Test Core' --shard ${{ matrix.shard }}",
  ].join('\n');
  const cutInvs = extractCheckInvocations(cutWf, 'x.yml').filter((i) => i.direct);
  const cutOf = (script) => cutInvs.find((i) => i.script === script);
  t(
    'the `$(…)` value really IS cut to a truncation — the fixture reproduces the key this card measured, so the cases below cannot go vacuous',
    cutOf('scripts/check-x.mjs')?.check === 'scripts/check-x.mjs --base "$',
  );
  t(
    '⭐ …and that truncation is NOT runnable: the unresolved remainder is named as the value the workflow supplies',
    (cutOf('scripts/check-x.mjs')?.argvVariables ?? []).join(',') === '"$',
  );
  t(
    '⭐ a terminator inside a quoted value lands the same way — named, never rendered as a command a dev could paste',
    cutOf('scripts/check-y.mjs')?.check === "scripts/check-y.mjs --gate 'a"
      && (cutOf('scripts/check-y.mjs')?.argvVariables ?? []).join(',') === "'a",
  );
  t(
    "CONTROL: `--gate 'Test Core'` and `--shard ${{ matrix.shard }}` tokenise and classify EXACTLY as today — the expression is the one variable, the quoted literal contributes none",
    cutOf('scripts/check-z.mjs')?.check === "scripts/check-z.mjs --gate 'Test Core' --shard ${{ matrix.shard }}"
      && (cutOf('scripts/check-z.mjs')?.argvVariables ?? []).join(',') === '${{ matrix.shard }}',
  );
  t(
    '⛔ …and the shape-level statement over every key this fixture derives: carrying a truncation and rendering as runnable are mutually exclusive — non-vacuously, 2 of the 3 carry one',
    cutInvs.every((i) => !carriesTruncation(i.check) || i.argvVariables.length > 0)
      && cutInvs.filter((i) => carriesTruncation(i.check)).length === 2,
  );
  // ...while a REDIRECTION really does end the argv, so the flag run before it
  // is complete and is keyed. Unchanged by #15083, verdict and all: what the
  // shell hands to this command and what it keeps for itself is the same
  // boundary it always was.
  t(
    'a complete flag run followed by a redirection IS keyed — the redirection is the shell\'s, never this argv',
    keyNames.includes('scripts/check-release-section-coverage.mjs --strict')
      && !keyNames.includes('scripts/check-release-section-coverage.mjs'),
  );
  t(
    'renderedArgv renders every tail and reports which values come from the workflow',
    renderedArgv(' --self-test').args === '--self-test'
      && renderedArgv(' --self-test').variables.length === 0
      && renderedArgv(' --emit --verify').args === '--emit --verify'
      && renderedArgv('') === null
      && renderedArgv(' --days 90').args === '--days 90'
      && renderedArgv(' --days 90').variables.length === 0
      && renderedArgv(' --base "$MERGE_BASE"').variables.join(',') === '$MERGE_BASE'
      && renderedArgv(' "$RUNNER_TEMP/test-core.log"').variables.join(',') === '$RUNNER_TEMP'
      && renderedArgv(' --shard ${{ matrix.shard }}').args === '--shard ${{ matrix.shard }}'
      // ⭐ #15116: the three spellings the CUT leaves unresolved. Each names its
      // own remainder, which is what keeps the key out of `--commands`.
      && renderedArgv(' --base "$').variables.join(',') === '"$'
      && renderedArgv(' --base $').variables.join(',') === '$'
      && renderedArgv(' --job ${{ inputs.a').variables.join(',') === '${{ inputs.a'
      // …and the CONTROL, on the same call: a CLOSED quote resolves, so a
      // quoted literal is still a literal and still renders as runnable.
      && renderedArgv(" --gate 'Test Core'").args === "--gate 'Test Core'"
      && renderedArgv(" --gate 'Test Core'").variables.length === 0,
  );
  t(
    'argvTokens holds a quoted value and a ${{ … }} expression together, spaces and all — and ⭐ swallows an UNCLOSED one into a single token, which is the seam #15116 reads',
    argvTokens(' --gate \'Test Core\' --shard ${{ matrix.shard }}').join('|')
      === "--gate|'Test Core'|--shard|${{ matrix.shard }}"
      && argvTokens(' --base "$').join('|') === '--base|"$'
      && argvTokens(' --job ${{ inputs.a').join('|') === '--job|${{ inputs.a',
  );
  t(
    'joinLineContinuations splices a continued command into one line, and ⛔ never joins a COMMENT',
    joinLineContinuations('a \\\n  b').trim() === 'a b'
      && joinLineContinuations('  # a comment \\\n  node scripts/check-x.mjs').split('\n').length === 2,
  );
  // The LIVE half, and the count is READ from the workflow rather than typed —
  // a number typed here would rot the first time lint.yml moved. The point of
  // the reading is that the fixture above judges a real convention: if this
  // ever fell to zero, every case in this block would be about a shape the tree
  // no longer has. Measured when this landed: 28 in lint.yml, 41 across all
  // workflow files, every one of them carrying a `check-` basename and so
  // collapsed by the old key.
  {
    const lintText = readFileSync(nodePath.join(ROOT, '.github/workflows/lint.yml'), 'utf8');
    const argvOfScript = new Map();
    for (const inv of extractCheckInvocations(lintText, 'lint.yml')) {
      if (!inv.direct) continue;
      if (!argvOfScript.has(inv.script)) argvOfScript.set(inv.script, new Set());
      argvOfScript.get(inv.script).add(inv.check);
    }
    const multi = [...argvOfScript.entries()].filter(([, keys]) => keys.size > 1);
    t(
      `lint.yml really invokes ${multi.length} script(s) more than once under different argv, so the cases above judge a live convention`,
      multi.length > 0,
    );
    t(
      '⭐ and the census pair CI runs on two lines derives as two families on the real workflow, not one',
      (argvOfScript.get('scripts/check-tenant-audit-census.mjs')?.size ?? 0) === 2,
    );
    t(
      'every derived key is either the bare script path or that path plus the WHOLE argv, re-tokenising to itself',
      [...argvOfScript.entries()].every(([script, keys]) =>
        [...keys].every((k) => k === script || renderedArgv(k.slice(script.length))?.args === k.slice(script.length).trim())),
    );
  }

  // ── The value-bearing class, read from the LIVE workflows (#15083) ─────────
  //
  // The card counted nine scripts whose only CI invocations carry a value or a
  // continuation. The count is READ here rather than typed, for the reason the
  // block above reads its own: a list typed into a self-test rots the first
  // time a workflow moves, and this one already has — the same sweep over the
  // tree at this commit finds `scripts/pm/check-half-states.mjs` too, a TENTH
  // member the card's table does not name (`half-state-patrol.yml` runs it
  // `--format=markdown --provenance="$PROVENANCE"` and nowhere else).
  //
  // What is asserted is the PROPERTY, not the roster: every direct invocation
  // in the tree renders, and every rendered key is either all-literal (and
  // therefore in `--commands`) or names the variables that keep it out. A
  // script with both kinds gets both entries, which is the card's third clause.
  {
    const liveInvs = [];
    for (const wf of readdirSync(nodePath.join(ROOT, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f))) {
      liveInvs.push(...extractCheckInvocations(readFileSync(nodePath.join(ROOT, '.github/workflows', wf), 'utf8'), wf));
    }
    const direct = liveInvs.filter((i) => i.direct);
    const valueBearing = direct.filter((i) => (i.argvVariables ?? []).length > 0);
    // The live half of the package-local lane (#15342). The fixtures above prove
    // the pattern; these read the tree CI actually runs, so the phantom class is
    // held over EVERY direct invocation, not only over a specimen.
    //
    // The specimen the first of these used to name —
    // `packages/lint/scripts/check-reference-carrier-shape.mjs` — was the tree's
    // ONLY package-local by-path invocation, and it was retired by maintainer
    // ruling. So the lane did not move, it emptied, and a live pin on it could
    // only ever be a pin on zero from here. The reading is recorded as a zero WITH
    // ITS CONTROL: no `packages/…` direct invocation, while the same extraction
    // over the same corpus yields 143 root ones — so the zero is an empty lane and
    // not a reader that stopped matching. The grammar itself stays under the
    // synthetic fixtures above. ⛔ Do not widen the matchers to manufacture a
    // subject; the day CI invokes a package-local gate by path, the fixtures
    // already key it and a specimen can be named here again.
    t(
      `⭐ the package-local lane reads as EMPTY against a corpus that yields ${direct.length} direct root `
        + 'invocation(s) — the control that makes the zero a reading. If the control collapses to 0 the '
        + 'extraction broke; if a `packages/…` direct invocation appears, name it as the specimen again',
      direct.length > 0 && !direct.some((i) => i.script.startsWith('packages/')),
    );
    t(
      `every one of the ${direct.length} direct invocation(s) in the live tree resolves to a file that EXISTS `
        + 'on disk — a key with no file behind it reads as a confident gate identity in both directions (#15342)',
      direct.length > 0 && direct.every((i) => existsSync(nodePath.join(ROOT, i.script))),
    );
    t(
      `the live tree really carries ${valueBearing.length} value-bearing invocation(s) across ${new Set(valueBearing.map((i) => i.script)).size} script(s), so the cases above judge a live class`,
      valueBearing.length > 0,
    );
    // Five of the card's six named specimens. The sixth,
    // `scripts/check-cross-package-test-inputs.mjs`, classified as VARIABLE
    // through ci.yml's inline package-selection step (`--union-into
    // "$RUNNER_TEMP/turbo-ls.json" --changed …`) until #16453 moved that step's
    // shell into scripts/ci/select-shard-packages.sh, which no workflow-text
    // scan reaches; its only workflow invocation is now the all-literal
    // `pnpm check:cross-package-test-inputs`, so it belongs to the LITERAL
    // class below and no longer to this roster — the rot the block comment
    // above predicts for a typed list, and the reason the count is read.
    t(
      '⭐ the card\'s named specimens all classify as VARIABLE from the workflow text — no per-script table was needed',
      ['scripts/check-empty-changeset.mjs', 'scripts/check-test-completeness.mjs', 'scripts/check-shard-attestation.mjs',
        'scripts/check-adr-0087-registration.mjs', 'scripts/check-changeset-no-major.mjs']
        .every((script) => valueBearing.some((i) => i.script === script)),
    );
    t(
      '⭐ …and the three the card called value-bearing that are really LITERAL render as runnable commands instead',
      ['scripts/check-engine-split-ratio.mjs --days 90', 'scripts/check-required-contexts.mjs --verify-required-set',
        'scripts/check-prerelease-pin-watch.mjs --verbose']
        .every((key) => direct.some((i) => i.check === key && i.argvVariables.length === 0)),
    );
    t(
      '⛔ no live key survives as a bare path for a script CI only ever invokes WITH argv',
      !direct.some((i) => i.check === i.script)
        || direct.filter((i) => i.check === i.script).every((bare) => liveInvs.some((i) => i.script === bare.script && i.check === i.script)),
    );
    // The same property the fixture block asserts, read from the workflows. It
    // is VACUOUS today and that is the reading, not an oversight: at this commit
    // no live invocation carries an unclosed quote, an unclosed `${{ … }}` or a
    // bare `$`, so the non-vacuous subjects live in the fixture above. What this
    // half adds is the day the tree grows one — the property holds then too,
    // because the classification names the remainder rather than rendering it.
    t(
      '⛔ and no live key is truncated: no continuation backslash reaches one, and ⭐ any key carrying an unclosed quote, an unclosed ${{ … }} or a bare `$` is NOT runnable (#15116)',
      direct.every((i) => !i.check.includes('\\'))
        && direct.every((i) => !carriesTruncation(i.check) || (i.argvVariables ?? []).length > 0),
    );
    // A script invoked BOTH ways gets BOTH entries — the card's third clause,
    // read off the live tree. `check-release-section-coverage.mjs` is the
    // specimen: `lint.yml` runs it bare, `release-coverage-patrol.yml` runs it
    // bare AND `--strict`, and before the continuation join the `--strict` run
    // had no entry of its own at all.
    const coverageKeys = new Set(direct.filter((i) => i.script === 'scripts/check-release-section-coverage.mjs').map((i) => i.check));
    t(
      '⭐ a script CI invokes bare AND with argv keeps BOTH entries — the bare key is kept where CI really runs it bare',
      coverageKeys.has('scripts/check-release-section-coverage.mjs')
        && coverageKeys.has('scripts/check-release-section-coverage.mjs --strict'),
    );
  }


  // ── The DECLARED-DEFAULT repair, and the class it belongs to (#15441) ──────
  //
  // The classification above asks whether the WORKFLOW supplies a value. It
  // never asked whether the SCRIPT needs it supplied, and for the `--base`
  // gates the two answers differ: `pr-automation.yml` pins the base to the PR's
  // merge base, and the script's own first lines say `base defaults to
  // origin/main` while the scan starts at `merge-base(base, head)` either way.
  // The family scored value-bearing, so the only member `--commands` offered
  // for it was the SELF-TEST invocation of the same script — a zero from a
  // command that cannot answer the question, sitting in the union where nothing
  // distinguishes it from a green. It bit: a dev reported "50 run · 50 exit 0 ·
  // 0 red" on a PR whose Check Changeset job was red in CI the whole time.
  //
  // The class was ENUMERATED by predicate before any of it was repaired, and
  // the enumeration is asserted below as a property rather than typed as a
  // roster, for the reason the value-bearing block above states: a list typed
  // into a self-test rots the first time a workflow moves.
  {
    const usageFixture = [
      '#!/usr/bin/env node',
      '// check-fixture -- a gate.',
      '//',
      '//   node scripts/check-fixture.mjs --base <ref-or-sha> [--head <ref>]',
      '//   node scripts/check-fixture.mjs              # base defaults to origin/main',
      '//',
      "const REPO_ROOT = '.';",
      '// the endpoint defaults to the repository default branch',
      'export function work() { return REPO_ROOT; }',
    ].join('\n');
    t(
      '⭐ a script that documents a default for the flag CI pins declares it, and the declaration is read from the script',
      [...declaredArgvDefaults(usageFixture)].map(([f, v]) => `${f}=${v}`).join(',') === '--base=origin/main',
    );
    t(
      '⛔ and prose PAST the usage block mints nothing — a sentence about behaviour is not a declaration about an argument',
      !declaredArgvDefaults(usageFixture).has('--endpoint'),
    );
    t(
      '…which is the whole point of reading the LEADING comment block: it stops at the first line of code',
      leadingCommentBlock(usageFixture).includes('base defaults to origin/main')
        && !leadingCommentBlock(usageFixture).includes('the endpoint defaults to'),
    );
    const fixtureDefaults = declaredArgvDefaults(usageFixture);
    t(
      '⭐ DIRECTION ONE — a DEFAULTED variable renders the REAL invocation, with the default spelled out where CI writes the variable',
      defaultedArgv('--base "$MERGE_BASE"', fixtureDefaults).args === '--base origin/main',
    );
    t(
      '…and it says which workflow value it filled, so the row can state what CI pins instead',
      JSON.stringify(defaultedArgv('--base "$MERGE_BASE"', fixtureDefaults).defaulted)
        === JSON.stringify([{ flag: '--base', variable: '$MERGE_BASE', value: 'origin/main' }]),
    );
    t(
      '⭐ DIRECTION TWO — an UNDEFAULTED variable is untouched, so its family stays value-bearing and unrunnable',
      defaultedArgv('--format=markdown --provenance="$PROVENANCE"', fixtureDefaults).args
        === '--format=markdown --provenance="$PROVENANCE"'
        && defaultedArgv('--format=markdown --provenance="$PROVENANCE"', fixtureDefaults).defaulted.length === 0,
    );
    t(
      '⛔ a token the workflow only PART wrote is not a variable this can replace — half a path is not a value to substitute',
      defaultedArgv('--base "$RUNNER_TEMP/base.txt"', fixtureDefaults).args === '--base "$RUNNER_TEMP/base.txt"'
        && defaultedArgv('--base "$RUNNER_TEMP/base.txt"', fixtureDefaults).defaulted.length === 0,
    );
    t(
      'the `--flag=value` spelling is covered too, since that is how the tree writes the one flag with no default',
      defaultedArgv('--base="$MERGE_BASE"', fixtureDefaults).args === '--base=origin/main',
    );
    // ⭐ THE DRIFT DIRECTION the ruling names, driven on the REAL specimen
    // source rather than on a fixture: a script that stops documenting the
    // default returns its family to NOT RUNNABLE LOCALLY with no edit here.
    // That is the whole reason the declaration is read from the script instead
    // of from a table in this file.
    const specimenPath = 'scripts/check-adr-0087-registration.mjs';
    const specimenSource = readFileSync(nodePath.join(ROOT, specimenPath), 'utf8');
    t(
      'CONTROL: the live specimen really documents its default, so the drift case below is not vacuous',
      declaredArgvDefaults(specimenSource).get('--base') === 'origin/main',
    );
    const undocumented = specimenSource.replace(/^.*base defaults to origin\/main.*$/m, '//');
    t(
      '⭐ a script whose usage block STOPS documenting the default returns its family to unrunnable — no table here to drift',
      undocumented !== specimenSource
        && !declaredArgvDefaults(undocumented).has('--base')
        && defaultedArgv('--base "$MERGE_BASE"', declaredArgvDefaults(undocumented)).defaulted.length === 0,
    );

    // ── The live half: the class, enumerated by predicate on this tree ───────
    const defaultsFamilies = discoverFamilies().byCheck;
    const withArgv = [...defaultsFamilies.values()].filter((e) => e.direct && e.script && (e.check !== e.script));
    const repaired = withArgv.filter((e) => (e.argvDefaulted ?? []).length > 0);
    const stillValueBearing = withArgv.filter((e) => e.notRunnable);
    t(
      `the live tree carries ${repaired.length} repaired and ${stillValueBearing.length} still-value-bearing famil(ies), so both directions below judge a live class`,
      repaired.length > 0 && stillValueBearing.length > 0,
    );
    t(
      '⭐ ALL OR NOTHING — no family is repaired while a workflow value it cannot fill is still in its argv',
      repaired.every((e) => !e.notRunnable),
    );
    t(
      '⭐ every repaired family read its default off ITS OWN script, flag by flag — nothing here invented a value',
      repaired.every((e) => {
        const declared = declaredArgvDefaults(readFileSync(nodePath.join(ROOT, e.script), 'utf8'));
        return (e.argvDefaulted ?? []).every((d) => declared.get(d.flag) === d.value);
      }),
    );
    t(
      '⭐ and every family still filed value-bearing is one whose script declares NO default for what the workflow pins',
      stillValueBearing.every((e) => {
        const declared = declaredArgvDefaults(readFileSync(nodePath.join(ROOT, e.script), 'utf8'));
        return (e.notRunnable?.variables ?? []).length > 0 && ![...declared.keys()].some((flag) => e.check.includes(`${flag} `));
      }),
    );
    t(
      '⛔ the KEY never moved — a repaired family is still keyed on the invocation CI runs, so nothing was re-attributed',
      repaired.every((e) => e.check.includes('$') || e.check.includes('${{')),
    );
    // ⭐ The card's own specimen, on the live tree.
    const adrKey = 'scripts/check-adr-0087-registration.mjs --base "$MERGE_BASE"';
    const adrEntry = defaultsFamilies.get(adrKey);
    t(
      '⭐ THE SPECIMEN — the ADR-0087 registration gate is keyed as pr-automation.yml runs it and is no longer filed unrunnable',
      Boolean(adrEntry) && !adrEntry.notRunnable,
    );
    t(
      '…and what a dev pastes for it is the REAL check with the script\'s own default spelled out, never the self-test',
      runnableInvocation(adrEntry ?? {}) === 'node scripts/check-adr-0087-registration.mjs --base origin/main',
    );
    t(
      'CONTROL: its --self-test invocation is STILL its own family — the repair ADDS the real check, it moves nothing',
      defaultsFamilies.has('scripts/check-adr-0087-registration.mjs --self-test'),
    );
    t(
      'CONTROL: the sweeper the workflow hands a provenance string is untouched — no default, so still value-bearing',
      Boolean(defaultsFamilies.get('scripts/pm/check-half-states.mjs --format=markdown --provenance="$PROVENANCE"')?.notRunnable),
    );
  }

  // ── The self-test harness prints the reading its call sites pass (#15539) ──
  //
  // `t` was declared with arity TWO while six call sites passed a THIRD
  // argument carrying the case's diagnostic reading, and JavaScript dropped
  // every one. Each sits on a case whose verdict is about the LIVE tree, so the
  // day one goes red the person triaging it gets the sentence and nothing else
  // — while the author had already written the reading they would need.
  t(
    '⭐ a FAILING case with a reading prints the reading, on its own line under the case',
    JSON.stringify(selfTestCaseLines('subject', false, JSON.stringify({ before: 3, after: 3 })))
      === JSON.stringify(['  ✗ subject', '      ↳ reading: {"before":3,"after":3}']),
  );
  t(
    '…and a non-string reading is rendered rather than printed as [object Object]',
    selfTestCaseLines('subject', false, { verdict: 'silent' })[1] === '      ↳ reading: {"verdict":"silent"}',
  );
  t(
    '⛔ a PASSING case is byte-identical to what this harness has always printed — the reading is owed to a red, not to 1400 greens',
    JSON.stringify(selfTestCaseLines('subject', true, JSON.stringify({ before: 3 }))) === JSON.stringify(['  ✓ subject']),
  );
  t(
    '⛔ and a failing case with NO reading grows no line either — an empty diagnostic is not a diagnostic',
    JSON.stringify(selfTestCaseLines('subject', false, null)) === JSON.stringify(['  ✗ subject'])
      && JSON.stringify(selfTestCaseLines('subject', false, '')) === JSON.stringify(['  ✗ subject']),
  );

  // The live halves. Fixtures cannot prove the tree changed; these read it.
  const liveSelfTestFamilies = [...discoverFamilies().byCheck].filter(([, e]) => e.selfTest);
  t(
    `the live tree really has self-test families (${liveSelfTestFamilies.length}), so the cases above judge something`,
    liveSelfTestFamilies.length > 0,
  );
  t(
    'the PR #11397 gate is one of them, on the real workflows',
    liveSelfTestFamilies.some(([c]) => c === 'scripts/pm/bare-root-worklist.mjs --self-test'),
  );
  t(
    '…and it resolves to a file that EXISTS, which is what a flagged key would have broken',
    liveSelfTestFamilies
      .filter(([c]) => c === 'scripts/pm/bare-root-worklist.mjs --self-test')
      .every(([, e]) => (e.files ?? []).length === 1 && existsSync(nodePath.join(ROOT, e.files[0]))),
  );
  // The import narrowing, proven NON-VACUOUS: the module this gate imports
  // really does declare literals, and they really would have reached the tree.
  // Without that half the case below is satisfied by a module with nothing in
  // it, which is the shape a green-over-nothing pin takes.
  const bareRootEntry = liveSelfTestFamilies.find(([c]) => c === 'scripts/pm/bare-root-worklist.mjs --self-test')?.[1];
  const importedByBareRoot = firstPartyImportTargets(
    'scripts/pm/bare-root-worklist.mjs',
    readFileSync(nodePath.join(ROOT, 'scripts/pm/bare-root-worklist.mjs'), 'utf8'),
  );
  const wouldHaveInherited = importedByBareRoot.flatMap((m) =>
    extractWatchHints(readFileSync(nodePath.join(ROOT, m), 'utf8'), m),
  );
  t(
    `the refused inheritance is real — the modules this gate imports declare ${wouldHaveInherited.length} literal(s)`,
    wouldHaveInherited.length > 0,
  );
  t(
    'a self-test family inherits NONE of them — those literals are join bases and tier globs, the fabrication #8162 already refused by spawning',
    (bareRootEntry?.hints ?? []).length === 0 && (bareRootEntry?.hintOrigin?.size ?? 0) === 0,
  );

  // The SECOND guard, on the same live specimen (#11556). The narrowing above
  // is invocation-shaped: it holds for a `--self-test` family and nothing else,
  // so a `check-` gate importing the same modules was untouched by it. What
  // covers that caller is the module's OWN inherited-population declaration,
  // and this measures it through the follow's rule rather than through the raw
  // extractor the case above uses.
  const inheritableFromImports = importedByBareRoot.flatMap((m) => {
    const src = readFileSync(nodePath.join(ROOT, m), 'utf8');
    const spelled = extractWatchHints(src, m);
    return declaredInheritedPopulation(src, spelled, m)?.population ?? spelled;
  });
  t(
    `a gate that IMPORTS the same modules inherits ${inheritableFromImports.length} of those ${wouldHaveInherited.length} literal(s)`,
    inheritableFromImports.length > 0 && inheritableFromImports.length < wouldHaveInherited.length,
  );
  const inhSweep = trackedFiles();
  const inhCovered = (hs) => inhSweep.filter((f) => hs.some((h) => hintCovers(h, f))).length;
  t(
    `and the price of that import drops from ${inhCovered(wouldHaveInherited)} tracked files to ${inhCovered(inheritableFromImports)}`,
    inhCovered(inheritableFromImports) < inhCovered(wouldHaveInherited),
  );
  // The direction that could SUBTRACT, asserted rather than argued: a
  // declaration is a narrowing, and a narrowing that took the real population
  // with it would read exactly like this one — fewer pairs, every gate green.
  // The tool DOES readdir the workflow tree, so every file in it must stay
  // reachable through what a follower inherits.
  t(
    'and it is not a coverage cut — every workflow file the tool really readdirs is still reachable through the declaration',
    inhSweep.filter((f) => f.startsWith('.github/workflows/')).length > 0
      && inhSweep
        .filter((f) => f.startsWith('.github/workflows/'))
        .every((f) => inheritableFromImports.some((h) => hintCovers(h, f))),
  );

  // The direction that could SUBTRACT, and the reason it is asserted rather
  // than argued: admitting these nine makes six previously-followable modules
  // GATE FILES, and `discoverFamilies` refuses to follow a gate file. Any
  // family that used to inherit a hint from one of them would silently stop —
  // and a lead that stops appearing is indistinguishable from a lead that was
  // never earned, so nothing in the output would say so. Measured here: the
  // only newly-promoted module that declares a literal at all is pr-labels.mjs
  // (`.github/labeler.yml`), and no family imports it.
  // ⚠️ Narrowed by #14880, and the narrowing is what keeps this case measuring
  // its own claim. A `check-`named script invoked with `--self-test` is now a
  // self-test family too, but its file was ALREADY a gate file — CI also runs
  // it plainly, or the direct matcher admits it under a `check-` basename
  // either way — so counting it as "promoted BY the self-test admission" reads
  // a refusal that predates that admission as a loss it caused. Measured: with
  // the raw list, four families reported hints "lost" to modules
  // (`check-adr-links.mjs`, `check-self-test-wired.mjs`) that were gate files
  // on the base tree as well, and the follow had already been refusing them.
  // What this case is about is the module a self-test family is the ONLY
  // reason to treat as a gate file, so that is what it takes.
  const namedByWorkFamilies = new Set(
    [...discoverFamilies().byCheck.values()].filter((e) => !e.selfTest).flatMap((e) => e.files ?? []),
  );
  const promoted = liveSelfTestFamilies
    .flatMap(([, e]) => e.files ?? [])
    .filter((f) => !namedByWorkFamilies.has(f));
  const subtracted = [];
  for (const [check, entry] of discoverFamilies().byCheck) {
    if (entry.selfTest) continue;
    for (const f of entry.files ?? []) {
      if (!existsSync(nodePath.join(ROOT, f))) continue;
      const src = readFileSync(nodePath.join(ROOT, f), 'utf8');
      for (const mod of firstPartyImportTargets(f, src)) {
        if (!promoted.includes(mod)) continue;
        const lost = extractWatchHints(readFileSync(nodePath.join(ROOT, mod), 'utf8'), mod);
        if (lost.length > 0) subtracted.push(`${check} <- ${mod} (${lost.join(', ')})`);
      }
    }
  }
  t(
    `promoting ${promoted.length} module(s) to gate files subtracts no inherited hint from any other family`
      + `${subtracted.length ? ` — LOST: ${subtracted.join(' · ')}` : ''}`,
    subtracted.length === 0,
  );

  // ── The refused fifth key, kept honest (#13126) ────────────────────────────
  // `coveringKey`'s docblock refuses an IDENTITY key over these same import
  // edges, and that refusal is a MEASUREMENT rather than a preference: it holds
  // only while the class stays concentrated in the shared utilities nearly
  // every gate links. Prose cannot notice the tree flattening under it, so the
  // price is re-derived here on every run and asserted. A red in this block is
  // not a broken derivation — it says the refusal is due a re-pricing.
  const importClassFamilies = [...discoverFamilies().byCheck];
  const importClassEdges = new Map();
  for (const [check, e] of importClassFamilies) {
    const edges = new Set();
    for (const f of e.files ?? []) {
      if (!existsSync(nodePath.join(ROOT, f))) continue;
      for (const mod of firstPartyImportTargets(f, readFileSync(nodePath.join(ROOT, f), 'utf8'))) {
        if ((e.files ?? []).includes(mod)) continue;
        edges.add(mod);
      }
    }
    importClassEdges.set(check, edges);
  }
  const importNovel = [];
  let importCoveredElsewhere = 0;
  for (const [check, e] of importClassFamilies) {
    for (const mod of importClassEdges.get(check) ?? []) {
      if (coveringKey(e, mod)) importCoveredElsewhere++;
      else importNovel.push([check, mod]);
    }
  }
  t(
    `the refused import-edge class is real and NOVEL — ${importNovel.length} (family, imported module)`
      + ` pair(s) no key reaches, of ${importNovel.length + importCoveredElsewhere}`,
    importNovel.length > 0,
  );
  t(
    `…and the split the refusal quotes is not invented: ${importCoveredElsewhere} pair(s) another key`
      + ' already answers, so the novel half is a measurement and not the raw count',
    importCoveredElsewhere > 0,
  );
  // The card's own witness, and the single lead this refusal is KNOWN to cost.
  // Asserted in both halves: the import edge exists, and no key names it.
  const bareRootKey = 'scripts/pm/bare-root-worklist.mjs --self-test';
  const bareRootImportFamily = importClassFamilies.find(([c]) => c === bareRootKey)?.[1];
  t(
    'the witness holds — bare-root-worklist --self-test imports THIS file, and no key names that'
      + ' family for a card editing it',
    (importClassEdges.get(bareRootKey)?.has('scripts/pm/dispatch-gates.mjs') ?? false)
      && !!bareRootImportFamily
      && coveringKey(bareRootImportFamily, 'scripts/pm/dispatch-gates.mjs') === null,
  );
  // Why it is refused, re-derived rather than recalled: the worst module would
  // print a list nobody reads. The bound is the header's own "22 leads is the
  // same as none", doubled — green through ordinary drift, red only if the
  // concentration genuinely collapses and the class is worth re-pricing.
  const importAddPerModule = new Map();
  for (const [, mod] of importNovel) importAddPerModule.set(mod, (importAddPerModule.get(mod) ?? 0) + 1);
  const importWorst = [...importAddPerModule]
    .map(([mod, add]) => ({
      mod,
      add,
      after: add + importClassFamilies.filter(([, e]) => coveringKey(e, mod)).length,
    }))
    .sort((a, b) => b.after - a.after);
  t(
    `the refusal is still earned — a card editing ${importWorst[0]?.mod} would name`
      + ` ${importWorst[0]?.after} families under the refused key`,
    (importWorst[0]?.after ?? 0) > 44,
  );
  const importTop5 = importWorst.slice(0, 5).reduce((s, r) => s + r.add, 0);
  t(
    `…and the class is still concentrated: ${importTop5} of ${importNovel.length} novel pair(s) land`
      + ` on ${Math.min(5, importWorst.length)} module(s)`,
    importTop5 * 2 > importNovel.length,
  );
  // The PRICE the refusal states is an AVERAGE (#13467). "The miss costs one CI
  // round" holds for a novel pair whose family some UNFILTERED workflow runs —
  // CI opens the module on that PR regardless — and does not hold for one whose
  // family no every-PR workflow runs at all: nothing on the PR repays that
  // miss. Prose cannot notice the split moving and this one has moved three
  // times, so the docblock states the SHAPE and these three assertions print
  // the sizes. A red here re-prices the paragraph; it does not fault the
  // derivation.
  const everyPRWorkflow = new Map();
  for (const wf of readdirSync(nodePath.join(ROOT, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f))) {
    const wfText = readFileSync(nodePath.join(ROOT, '.github/workflows', wf), 'utf8');
    // No `paths:` on a workflow that declares `pull_request` is the same
    // reading `discoverFamilies` makes when it drops such a workflow from
    // `triggers` — an unfiltered workflow discriminates nothing, which is
    // exactly why it runs on every PR.
    everyPRWorkflow.set(wf, declaresPullRequestTrigger(wfText) && extractTriggerPaths(wfText).length === 0);
  }
  const runsOnEveryPR = (e) => [...(e?.workflows ?? [])].some((wf) => everyPRWorkflow.get(wf));
  const importFamilyByCheck = new Map(importClassFamilies);
  const importDeferred = importNovel.filter(([check]) => !runsOnEveryPR(importFamilyByCheck.get(check)));
  const importDeferredWorkflows = [...new Set(
    importDeferred.flatMap(([check]) => [...(importFamilyByCheck.get(check)?.workflows ?? [])]),
  )].sort();
  t(
    `the "one CI round" price is an average, not a uniform one — ${importDeferred.length} of`
      + ` ${importNovel.length} novel pair(s) sit in families no every-PR workflow runs`
      + ` (${importDeferredWorkflows.join(', ') || 'none'}), so no CI round on the PR repays that miss`,
    importDeferred.length > 0 && importDeferred.length * 4 < importNovel.length,
  );
  // The half that keeps the exception from being over-read: a deferred pair is
  // a deferred LEAD, never a silent load break. Every module carrying one is
  // imported by every-PR families too, so a module that fails to LOAD reddens
  // the PR through a sibling; what defers is the narrower break.
  const importLoadBreakSilent = importDeferred.filter(([, mod]) =>
    !importClassFamilies.some(([c2, e2]) => runsOnEveryPR(e2) && (importClassEdges.get(c2)?.has(mod) ?? false)));
  t(
    'a deferred pair defers the LEAD, not the load break — every module carrying one is imported by'
      + ' an every-PR family as well, so failing to load still reddens the PR'
      + `${importLoadBreakSilent.length ? ` — SILENT: ${importLoadBreakSilent.map(([c, m]) => `${c} <- ${m}`).join(' · ')}` : ''}`,
    importLoadBreakSilent.length === 0,
  );
  // And they are not spread thin: the deferred pairs land on the shared heads
  // this key is refused FOR — the modules most likely to be edited into a
  // break. `fan-in <= 3` is the tail boundary the aggregate paragraph uses.
  const importFanIn = (mod) => importClassFamilies.filter(([c2]) => importClassEdges.get(c2)?.has(mod)).length;
  const importDeferredOnHeads = importDeferred.filter(([, mod]) => importFanIn(mod) > 3);
  t(
    `…and the deferred pair(s) concentrate on the heads rather than the tail:`
      + ` ${importDeferredOnHeads.length} of ${importDeferred.length} land on a module more than 3`
      + ` families import`,
    importDeferredOnHeads.length * 2 > importDeferred.length,
  );

  // #12107, the live half — three claims about THIS tree, each one a thing the
  // fix buys that a fixture cannot show.
  const tsLiveFamilies = [...discoverFamilies().byCheck];

  // 1. No gate file the derivation NAMES is a path that does not exist. This is
  //    the invariant the package-relative normalisation buys, and it is the one
  //    that catches the near-miss: widening the extensions WITHOUT normalising
  //    produced `packages/client/scripts/check-exported-any-returns.mts` — a
  //    phantom identity key that `coveringKey` would print as a `gate script`
  //    match while `existsSync` kept the file closed and the family kept
  //    reading zero hints. Measured on this tree at the fix: 0 phantoms.
  const phantomGateFiles = tsLiveFamilies.flatMap(([check, e]) =>
    (e.files ?? []).filter((f) => !existsSync(nodePath.join(ROOT, f))).map((f) => `${check} -> ${f}`),
  );
  t(
    `every gate file the derivation names exists on disk${phantomGateFiles.length ? ` — PHANTOM: ${phantomGateFiles.join(' · ')}` : ''}`,
    phantomGateFiles.length === 0,
  );

  // 2. The TypeScript families really do resolve now, on the live tree rather
  //    than through a fixture — and the climbing one resolves to the ROOT path.
  const anyReturns = tsLiveFamilies.find(([c]) => c === 'check:exported-any-returns')?.[1];
  t(
    'the live TypeScript gate that climbs out of its package resolves to the tracked root path',
    (anyReturns?.files ?? []).join() === 'scripts/check-exported-any-returns.mts',
  );
  const tsFamilies = tsLiveFamilies.filter(([, e]) =>
    (e.files ?? []).some((f) => /\.(?:ts|mts|cts)$/.test(f)),
  );
  t(`the live tree resolves TypeScript-authored gates at all (${tsFamilies.length} families)`, tsFamilies.length >= 20);

  // 3. What is LEFT zero-file, and why it must stay that way. `resolveCheckToFiles`
  //    reads PATHS out of a command string; a family whose script names a package
  //    and a script NAME instead (`pnpm --filter @objectstack/cli run check:…`)
  //    carries no path for any extension list to match. It is a different
  //    mechanism and a different card, so the assertion is that every remaining
  //    zero-file family is one of those composites — never that the count is
  //    zero, which would mean this fix had absorbed a family it cannot honestly
  //    resolve.
  const rootScriptsMap = JSON.parse(readFileSync(nodePath.join(ROOT, 'package.json'), 'utf8')).scripts ?? {};
  const zeroFile = tsLiveFamilies.filter(([, e]) => (e.files ?? []).length === 0);
  const unexplained = zeroFile
    .map(([check]) => [check, rootScriptsMap[check] ?? ''])
    .filter(([, cmd]) => !/\bpnpm\b[^&|]*?(?:--filter|--recursive|-r)\b[^&|]*?\brun\b/.test(cmd))
    .map(([check, cmd]) => `${check} (${cmd || 'no root script'})`);
  t(
    `every zero-file family left is a pnpm workspace composite, not an unmatched extension${unexplained.length ? ` — UNEXPLAINED: ${unexplained.join(' · ')}` : ''}`,
    unexplained.length === 0,
  );
  t('and there is still at least one, so the assertion above is not vacuous', zeroFile.length > 0);

  // 4. The SUBTRACTION direction, asserted the way the self-test families'
  //    promotion above asserts its own: admitting these sources makes them GATE
  //    FILES, and `discoverFamilies` refuses to follow a gate file. A family
  //    that used to inherit a hint from one of them would silently stop, and a
  //    lead that stops appearing is indistinguishable from one never earned.
  //    Measured on this tree: none of the newly admitted sources is imported by
  //    any gate at all — all 12 modules this tree follows live in the root
  //    `scripts/` dir, and 22 of the 23 admitted sources live under
  //    `packages/spec/scripts/`. The 23rd (`scripts/check-exported-any-returns.mts`)
  //    is imported by nothing.
  const admittedTs = tsLiveFamilies.flatMap(([, e]) => (e.files ?? []).filter((f) => /\.(?:ts|mts|cts)$/.test(f)));
  const tsSubtracted = [];
  for (const [check, entry] of tsLiveFamilies) {
    if (entry.selfTest) continue;
    for (const f of entry.files ?? []) {
      if (/\.(?:ts|mts|cts)$/.test(f)) continue;
      if (!existsSync(nodePath.join(ROOT, f))) continue;
      for (const mod of firstPartyImportTargets(f, readFileSync(nodePath.join(ROOT, f), 'utf8'))) {
        if (!admittedTs.includes(mod)) continue;
        const lost = extractWatchHints(readFileSync(nodePath.join(ROOT, mod), 'utf8'), mod);
        if (lost.length > 0) tsSubtracted.push(`${check} <- ${mod} (${lost.join(', ')})`);
      }
    }
  }
  t(
    `admitting ${admittedTs.length} TypeScript gate source(s) subtracts no inherited hint from any other family`
      + `${tsSubtracted.length ? ` — LOST: ${tsSubtracted.join(' · ')}` : ''}`,
    tsSubtracted.length === 0,
  );

  // `runCommandTexts` on its own: one entry per step, in file order.
  const texts = runCommandTexts(blockWf);
  t('one command text per run step', texts.length === 4);
  t('a block body keeps its lines joined', texts[0].split('\n').filter((l) => l.trim()).length === 2);
  t('a one-line run yields its command verbatim', texts[3] === 'node scripts/check-nul-bytes.mjs');

  // The compact step form (#9203): `- run: …`, a block-sequence entry with the
  // key on the dash line. Before it was read, every command in a step written
  // this way was invisible to the derivation.
  //
  // The `env:` values are the load-bearing part of the fixture, not padding.
  // They name gates the steps do NOT run, positioned exactly where a body walk
  // that mis-reads `indent` swallows them — the compact one sits in the columns
  // the `- ` marker occupies, which is the only place the two candidate
  // readings disagree. Pinning the classic form's `env:` too keeps the two step
  // shapes asserted against the same trap, so a future edit cannot fix one
  // reading by breaking the other.
  const compactWf = [
    'jobs:',
    '  smoke:',
    '    steps:',
    '      - name: Classic block, sibling key after the body',
    '        run: |',
    '          pnpm check:classic-body',
    '        env:',
    '          NOTE: "we do not run pnpm check:phantom-classic here"',
    '      - run: pnpm --filter @objectstack/spec check:compact-one-liner',
    '      - run: |',
    '          pnpm check:compact-body',
    '          node scripts/check-compact-direct.mjs',
    '        env:',
    '          NOTE: "we do not run pnpm check:phantom-compact here"',
    '      - run: node scripts/check-compact-tail.mjs',
    '      - name: Back to the named form',
    '        run: pnpm check:after-compact',
  ].join('\n');
  const compactInvs = extractCheckInvocations(compactWf, 'showcase-smoke.yml');
  const compactNames = compactInvs.map((i) => i.check);
  // Leg 1 — the form is now REACHED. Each of these was zero before #9203.
  t('a compact `- run:` one-liner is discovered, with its filter', compactInvs.some((i) => i.check === 'check:compact-one-liner' && i.filter === '@objectstack/spec'));
  t('a compact `- run: |` block body is discovered', compactNames.includes('check:compact-body'));
  t('a direct script in a compact block body is discovered', compactNames.includes('scripts/check-compact-direct.mjs'));
  t('a compact step after a compact block body still parses', compactNames.includes('scripts/check-compact-tail.mjs'));
  // Leg 2 — the widening bought no over-consumption. `indent` counts the `- `,
  // so a compact block body ends at its own sibling keys exactly as the named
  // form's does; both directions of the mis-read fabricate a gate here.
  t('a compact block body ends at the `env:` key of its own step', !compactNames.includes('check:phantom-compact'));
  t('the named form still ends its block body at the `env:` key', !compactNames.includes('check:phantom-classic'));
  t('the step after a compact block body is not swallowed by it', compactNames.includes('check:after-compact'));
  const compactTexts = runCommandTexts(compactWf);
  // Indexed reads are defaulted rather than asserted-then-dereferenced: under a
  // parser that drops the compact form entirely there is no element 2, and a
  // bare `compactTexts[2].split(…)` THROWS out of the whole self-test — the
  // reverse-verification run for this card hit exactly that and got one stack
  // trace where it needed a list of named failures. A gate that cannot say
  // which case broke is a worse gate, even when it is correctly red.
  t('one command text per compact step too', compactTexts.length === 5);
  t('a compact block body keeps both of its lines', (compactTexts[2] ?? '').split('\n').filter((l) => l.trim()).length === 2);
  t('a compact one-liner yields its command verbatim', compactTexts[1] === 'pnpm --filter @objectstack/spec check:compact-one-liner');
  // A `-` that is not a list marker must not be read as one: `-run:` is a key
  // named `-run`, and `- name:` is a step whose `run:` comes later on its own
  // line (already covered above, but the negative half needs its own pin).
  t('a bare `-run:` is not read as a compact step', runCommandTexts('      -run: pnpm check:not-a-step').length === 0);

  // ── The step's `env:` is the OTHER carrier of a workflow value (#15761) ────
  //
  // `partof-closing-keyword-guard.yml` passes the whole input through `env:`
  // and leaves the argv bare, so the argv-shaped classifier scored
  // `node scripts/check-partof-closing-keyword.mjs` as a command a dev can
  // paste — one whose only possible outcome here is the gate's own exit 2
  // ("NOT WIRED — neither PR_BODY nor PR_NUMBER is set"). The fixture carries
  // the specimen's shape plus the three shapes that must NOT move.
  const envWf = [
    'jobs:',
    '  guard:',
    '    steps:',
    '      - name: The specimen — bare argv, the input through env:',
    '        env:',
    '          PR_BODY: ${{ github.event.pull_request.body }}',
    '          PR_NUMBER: ${{ github.event.pull_request.number }}',
    '        run: node scripts/check-env-carried.mjs',
    '      - name: A LITERAL env value is not a workflow value',
    '        run: node scripts/check-literal-env.mjs',
    '        env:',
    '          PR_BODY: a body written down right here',
    '          HOME_ISH: $HOME/not-an-expression',
    '      - name: argv-carried, the regression control',
    '        run: node scripts/check-argv-carried.mjs --base "$MERGE_BASE"',
    '      - name: one value, one carrier — the command spells this env name itself',
    '        env:',
    '          MERGE_BASE: ${{ github.event.pull_request.base.sha }}',
    '        run: node scripts/check-spelled-env.mjs --base "$MERGE_BASE"',
    '      - run: node scripts/check-compact-env.mjs',
    '        env:',
    '          COMPACT: ${{ github.sha }}',
    '      - name: an env: that belongs to a nested mapping is not this step\'s',
    '        uses: some/action@v1',
    '        with:',
    '          env:',
    '            NESTED: ${{ github.sha }}',
    '        run: node scripts/check-nested-env.mjs',
  ].join('\n');
  const envInvs = extractCheckInvocations(envWf, 'partof-closing-keyword-guard.yml');
  const envOf = (name) => (envInvs.find((i) => i.script === name)?.envVariables ?? null);
  // (a) The specimen: the step's `env:` names ride the invocation, in order.
  t(
    '\u2b50 a bare argv beside an `env:` expression carries the env NAMES the step passes it',
    (envOf('scripts/check-env-carried.mjs') ?? []).join(',') === 'PR_BODY,PR_NUMBER',
  );
  t(
    '\u2026and it reads the `env:` block whichever side of `run:` the step writes it on',
    (envOf('scripts/check-compact-env.mjs') ?? []).join(',') === 'COMPACT',
  );
  // (b) A literal `env:` value keeps the command runnable — including the shell
  //     spellings, which Actions does NOT substitute in an env value.
  t(
    '\u2b50 a LITERAL `env:` value is not a workflow value, so the command stays runnable',
    (envOf('scripts/check-literal-env.mjs') ?? null)?.length === 0,
  );
  // (c) The regression control: argv-carried detection is untouched, and a name
  //     the command spells for itself is ONE value with ONE carrier.
  t(
    'CONTROL: an argv-carried variable is still detected, and carries no env of its own',
    envInvs.some((i) => i.check === 'scripts/check-argv-carried.mjs --base "$MERGE_BASE"'
      && (i.argvVariables ?? []).join(',') === '$MERGE_BASE'
      && (i.envVariables ?? []).length === 0),
  );
  t(
    '\u2b50 CONTROL: an env name the command SPELLS is argv-carried, not counted twice \u2014 this is what keeps #15441\'s repaired `--base` families runnable',
    (envOf('scripts/check-spelled-env.mjs') ?? null)?.length === 0,
  );
  t(
    'CONTROL: an `env:` nested under `with:` is not read as the step\'s own',
    (envOf('scripts/check-nested-env.mjs') ?? null)?.length === 0,
  );
  t(
    'the same walk, read directly: one step per `run:` key, each with its own env',
    runCommandSteps(envWf).length === 6
      && runCommandSteps(envWf)[0].envVariables.join(',') === 'PR_BODY,PR_NUMBER'
      && runCommandSteps(envWf)[1].envVariables.length === 0,
  );
  t(
    'CONTROL: the classic and compact fixtures above carry no `env:` expression, so this widening moved neither',
    runCommandSteps(blockWf).every((step) => step.envVariables.length === 0)
      && runCommandSteps(compactWf).every((step) => step.envVariables.length === 0),
  );
  // The limbs, each one of which has a live case on this tree (see
  // `workflowEnvValues`' docblock for which family each keeps out).
  const envEntry = (over = {}) => ({ envVariables: ['PR_BODY'], direct: true, selfTest: false, ciOnly: null, ...over });
  t('\u2b50 a direct, non-self-test family with no payload dependence is classified by its env carrier', workflowEnvValues(envEntry()).join(',') === 'PR_BODY');
  t('a `--self-test` invocation consumes no workflow value, so its step\'s env cannot subtract it', workflowEnvValues(envEntry({ selfTest: true })).length === 0);
  t('a `check:*` family is invocable by name and its KEY drops the argv, so one step\'s env is not a property of it', workflowEnvValues(envEntry({ direct: false })).length === 0);
  t('a family already named CI-MEASURED ONLY is not named a second time as value-bearing', workflowEnvValues(envEntry({ ciOnly: { env: 'GITHUB_EVENT_PATH' } })).length === 0);
  t('CONTROL: no env carrier at all classifies nothing', workflowEnvValues(envEntry({ envVariables: [] })).length === 0);

  // ── The script's own `local-env` declaration (#20278) ─────────────────────
  //
  // Judged on the specimen's own step text: `lint.yml`'s diff-scoped citation
  // step passes two workflow values through `env:`, and the script declares its
  // BARE run needs neither. Pinned by DIRECTION — which command reaches the
  // runnable union and which stays NOT MEASURED — never by a count.
  const localEnvWf = [
    'jobs:',
    '  lint:',
    '    steps:',
    '      - name: Issue citations this change adds resolve on the board',
    '        env:',
    '          GITHUB_TOKEN: ${{ github.token }}',
    '          OS_GATE_MERGE_GROUP_BASE_SHA: ${{ github.event.merge_group.base_sha }}',
    '        run: pnpm check:issue-citations && node scripts/check-issue-citations.mjs',
    '      - name: the census, report-only',
    '        env:',
    '          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}',
    '        run: node scripts/check-issue-citations.mjs --census',
  ].join('\n');
  const localEnvSource = [
    "export const SURFACES = ['packages/**'];",
    '',
    '// dispatch-gates: local-env GITHUB_TOKEN OS_GATE_MERGE_GROUP_BASE_SHA -- the bare diff run reads a public board and falls back to the merge base',
    '',
    'export function run() {}',
  ].join('\n');
  const localEnvDecl = declaredLocalEnv(localEnvSource, 'scripts/check-issue-citations.mjs');
  t(
    '⭐ a `local-env` declaration reads back its NAMES, its whole reason and its line',
    localEnvDecl?.names.join(',') === 'GITHUB_TOKEN,OS_GATE_MERGE_GROUP_BASE_SHA'
      && localEnvDecl?.reason === 'the bare diff run reads a public board and falls back to the merge base'
      && localEnvDecl?.line === 3,
  );
  t('CONTROL: a script that declares nothing reads back null', declaredLocalEnv("export const X = 'local-env';\n") === null);
  t(
    'a `local-env` reason cut by the comment line under it is REFUSED, by file and line — the shared wholeness reading reaches this key by construction',
    (() => {
      try {
        declaredLocalEnv('// dispatch-gates: local-env GITHUB_TOKEN -- the diff run\n// needs no token\n', 'scripts/x.mjs');
        return false;
      } catch (error) {
        return String(error.message).includes('scripts/x.mjs:2 continues it with');
      }
    })(),
  );
  t(
    'a token in the name list that is not an environment variable name is REFUSED, never read as one',
    (() => {
      try {
        declaredLocalEnv('// dispatch-gates: local-env GITHUB_TOKEN --census -- x\n', 'scripts/x.mjs');
        return false;
      } catch (error) {
        return String(error.message).includes('scripts/x.mjs:1') && String(error.message).includes('--census');
      }
    })(),
  );
  const localEnvInvs = extractCheckInvocations(localEnvWf, 'lint.yml');
  const localEnvBareInv = localEnvInvs.find((i) => i.check === 'scripts/check-issue-citations.mjs');
  const localEnvCensusInv = localEnvInvs.find((i) => i.check === 'scripts/check-issue-citations.mjs --census');
  t(
    'CONTROL: the step text yields the bare run and the census as two direct keys, each carrying its OWN step env',
    (localEnvBareInv?.envVariables ?? []).join(',') === 'GITHUB_TOKEN,OS_GATE_MERGE_GROUP_BASE_SHA'
      && (localEnvCensusInv?.envVariables ?? []).join(',') === 'GITHUB_TOKEN'
      && localEnvBareInv?.direct === true && localEnvCensusInv?.direct === true,
  );
  const localEnvRow = (inv, declaration) => {
    const entry = { ...inv, ciOnly: null, localEnv: declaration };
    const values = workflowEnvValues(entry);
    return {
      check: entry.check,
      command: runnableInvocation(entry),
      ciOnly: null,
      notRunnable: values.length > 0 ? { variables: values.map((n) => `env ${n}`), envVariables: values } : null,
    };
  };
  const localEnvRows = [localEnvRow(localEnvBareInv ?? {}, localEnvDecl), localEnvRow(localEnvCensusInv ?? {}, localEnvDecl)];
  const localEnvCommands = commandsFor({ matchedRows: localEnvRows });
  const localEnvUnrunnable = notRunnableCommandSet(localEnvRows);
  t(
    '⭐ the lint.yml step text, with the script\'s declaration, puts the BARE command in --commands and NOT in the not-runnable set',
    localEnvCommands.includes('node scripts/check-issue-citations.mjs')
      && !localEnvUnrunnable.has('node scripts/check-issue-citations.mjs'),
  );
  t(
    '⭐ …while the census invocation of the SAME script stays not-runnable, on the token its own step passes',
    !localEnvCommands.includes('node scripts/check-issue-citations.mjs --census')
      && localEnvUnrunnable.has('node scripts/check-issue-citations.mjs --census')
      && (localEnvRows[1].notRunnable?.variables ?? []).join(',') === 'env GITHUB_TOKEN',
  );
  const localEnvUndeclared = [localEnvRow(localEnvBareInv ?? {}, null), localEnvRow(localEnvCensusInv ?? {}, null)];
  t(
    'CONTROL: with no declaration the bare run is not-runnable on both names — the reading this card repairs, unchanged for every script that declares nothing',
    notRunnableCommandSet(localEnvUndeclared).has('node scripts/check-issue-citations.mjs')
      && (localEnvUndeclared[0].notRunnable?.variables ?? []).join(',') === 'env GITHUB_TOKEN,env OS_GATE_MERGE_GROUP_BASE_SHA',
  );
  t(
    'the limb is per NAME: a declaration naming only the token leaves the undeclared base keeping the family out',
    (() => {
      const tokenOnly = { names: ['GITHUB_TOKEN'], reason: 'x', line: 1 };
      return (localEnvRow(localEnvBareInv ?? {}, tokenOnly).notRunnable?.variables ?? []).join(',') === 'env OS_GATE_MERGE_GROUP_BASE_SHA';
    })(),
  );
  t(
    'the scope is the BARE key alone: a `--census` or `--self-test` key of the declaring script, and any `check:*` key, admit nothing',
    localEnvAdmitted({ ...localEnvCensusInv, localEnv: localEnvDecl }).length === 0
      && localEnvAdmitted({ check: 'scripts/check-issue-citations.mjs --self-test', script: 'scripts/check-issue-citations.mjs', direct: true, selfTest: true, localEnv: localEnvDecl }).length === 0
      && localEnvAdmitted({ check: 'check:issue-citations', direct: false, localEnv: localEnvDecl }).length === 0
      && localEnvAdmitted({ ...localEnvBareInv, localEnv: localEnvDecl }).join(',') === 'GITHUB_TOKEN,OS_GATE_MERGE_GROUP_BASE_SHA',
  );
  const localEnvBareEntry = { ...(localEnvBareInv ?? {}) };
  t(
    'CONTROL: a declaration naming exactly what the bare run\'s step passes is NOT refused',
    localEnvRefusal(localEnvDecl, localEnvBareEntry, 'scripts/check-issue-citations.mjs') === null,
  );
  t(
    '⭐ a STALE name — one the step does not pass — is REFUSED, naming the file, the line and the name',
    (localEnvRefusal({ names: ['GITHUB_TOKEN', 'PR_BODY'], reason: 'x', line: 3 }, localEnvBareEntry, 'scripts/check-issue-citations.mjs') ?? '')
      .includes('scripts/check-issue-citations.mjs:3 declares local-env PR_BODY,'),
  );
  t(
    'a name only SOME steps pass is refused too — the bare key carries the intersection, and a value one step omits is not a property of the invocation',
    (localEnvRefusal(localEnvDecl, { ...localEnvBareEntry, envVariables: ['GITHUB_TOKEN'] }, 'scripts/check-issue-citations.mjs') ?? '')
      .includes('declares local-env OS_GATE_MERGE_GROUP_BASE_SHA,'),
  );
  t(
    '⭐ a declaration whose BARE run no workflow makes is REFUSED — an argv no workflow runs admits nothing and must not read as a promise',
    (localEnvRefusal(localEnvDecl, null, 'scripts/check-issue-citations.mjs') ?? '').includes('no workflow runs `node scripts/check-issue-citations.mjs` with no argv')
      && localEnvRefusal(localEnvDecl, { ...localEnvCensusInv }, 'scripts/check-issue-citations.mjs') !== null,
  );

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

  // #12107 — the extension list. Each of the three TypeScript spellings is a
  // case the OLD alternation (`mjs|cjs|js|sh`) resolved to nothing, which is
  // why they are pinned separately rather than as one representative: the
  // defect was an alternation, and an alternation regresses one branch at a
  // time.
  const tsScripts = {
    'check:ts': 'tsx scripts/check-generated.ts',
    'check:mts': 'tsx scripts/check-variant-docs.mts',
    'check:cts': 'tsx scripts/check-legacy.cts',
    'check:mixed': 'node scripts/pre.mjs && tsx scripts/check-generated.ts',
  };
  t('resolves a .ts gate script — zero-file under the old alternation', resolveCheckToFiles('check:ts', tsScripts).join() === 'scripts/check-generated.ts');
  t('resolves a .mts gate script', resolveCheckToFiles('check:mts', tsScripts).join() === 'scripts/check-variant-docs.mts');
  t('resolves a .cts gate script', resolveCheckToFiles('check:cts', tsScripts).join() === 'scripts/check-legacy.cts');
  t('a command naming both an .mjs and a .ts file yields both', resolveCheckToFiles('check:mixed', tsScripts).join() === 'scripts/pre.mjs,scripts/check-generated.ts');
  // The negative half of the alternation: widening it must not admit every
  // extension. A `.json` argument is data the gate READS, not a file it runs,
  // and the hint scan is what places those.
  t('a data file argument is still not a gate script', resolveCheckToFiles('check:x', { 'check:x': 'tsx scripts/check-x.mts scripts/fixtures/pins.json' }, { dir: '' }).join() === 'scripts/check-x.mts');
  t('nor a .tsx file, the one this widening would newly have mis-matched as .ts', resolveCheckToFiles('check:x', { 'check:x': 'tsx scripts/render.tsx' }).length === 0);
  t('while the extension it is a prefix of still resolves', resolveCheckToFiles('check:x', { 'check:x': 'tsx scripts/render.ts' }).join() === 'scripts/render.ts');

  // #12107 point 1 — a package manifest spells its script relative to ITSELF,
  // so the manifest's directory is an input to the resolution, not a prefix
  // the caller staples on afterwards.
  const pkgScripts = {
    'check:in-package': 'tsx scripts/build-docs.ts --check',
    'check:climbing': 'tsx ../../scripts/check-exported-any-returns.mts --self-test && tsx ../../scripts/check-exported-any-returns.mts --package packages/client',
    'check:escaping': 'tsx ../../../../scripts/check-elsewhere.mjs',
  };
  t('a package-local spelling lands under the package that declares it', resolveCheckToFiles('check:in-package', pkgScripts, { dir: 'packages/spec' }).join() === 'packages/spec/scripts/build-docs.ts');
  t('a spelling that climbs out of its package normalises to the tracked repo path', resolveCheckToFiles('check:climbing', pkgScripts, { dir: 'packages/client' }).join() === 'scripts/check-exported-any-returns.mts');
  // The regression this normalisation exists for, stated as the wrong answer
  // rather than only as the right one: with the extensions widened and the
  // climb prefix dropped, this resolved to a path that does not exist, and the
  // family left the honest `undetermined` bucket while still reading no hints.
  t('and never to the package-prefixed path that does not exist', !resolveCheckToFiles('check:climbing', pkgScripts, { dir: 'packages/client' }).includes('packages/client/scripts/check-exported-any-returns.mts'));
  t('the twice-named climbing script is ONE file, deduped on the normalised path', resolveCheckToFiles('check:climbing', pkgScripts, { dir: 'packages/client' }).length === 1);
  t('a spelling that climbs clear of the repo root is dropped, not returned unnameable', resolveCheckToFiles('check:escaping', pkgScripts, { dir: 'packages/client' }).length === 0);
  t('an absent dir leaves a root-manifest spelling exactly as it was', resolveCheckToFiles('check:foo', scripts).join() === 'scripts/check-foo.mjs');

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

  // ── An EXCLUSION constant is not a watch surface (#15753) ─────────────────
  //
  // The declaration is the whole reading: the same literal, under a name that
  // says "never look here", must not become a lead — and under any other name
  // must still be one. Both halves are asserted on ONE literal so the pair
  // cannot drift, and the positive control is what makes the negative a
  // measurement rather than a scan that stopped working.
  //
  // Every fixture NAME that would MATCH the predicate is assembled at run time
  // rather than written after a `const`. `maskSelfTests` already blanks this
  // body before the module scans itself, so no fixture here reaches the live
  // hint set today; the assembly is what keeps that true if the block is ever
  // moved out of the masked region, where a verbatim declaration would be a
  // real declaration site silencing THIS module's own hints. It is the fixture
  // hazard `check-watch-hint-literal.mjs` records about its own, one class over
  // — there with no mask standing in the way.
  const NOISE_SUFFIX = ['NO', 'ISE'].join('');
  const excluded = `export const SHARED_PREFIX_${NOISE_SUFFIX} = Object.freeze(['.changeset/']);`;
  const included = "export const SHARED_PREFIX_ROOTS = Object.freeze(['.changeset/']);";
  t('a path literal declared inside an exclusion constant is NOT a hint', !extractWatchHints(excluded).includes('.changeset'));
  t('CONTROL: the same literal under a plain declaration still is — the scan did not simply stop', extractWatchHints(included).includes('.changeset'));
  // The span, not the line: a noise floor is usually written multi-line, and a
  // per-line check would admit every entry but the first.
  const multiline = [
    `const SCAN_${NOISE_SUFFIX} = new Set([`,
    "  'packages/generated/src',",
    "  'apps/fixtures/src',",
    ']);',
    "const REAL = 'packages/core/src';",
  ].join('\n');
  const multilineHints = extractWatchHints(multiline);
  t('every entry of a MULTI-LINE exclusion list is skipped, not just the one on the declaration line', !multilineHints.some((h) => h.startsWith('packages/generated') || h.startsWith('apps/fixtures')));
  t('and a declaration AFTER it is unaffected — the span closes where the statement does', multilineHints.includes('packages/core/src'));
  // The named spellings, one case each, so a narrowing of the predicate is
  // visible here rather than only in the live census.
  for (const word of ['SKIP', 'EXCLUDE', 'EXCLUDED', 'EXCLUSIONS', 'IGNORE', 'DEFERRED']) {
    const named = `const ${word}_PATHS = ['packages/skipped/src'];`;
    t(`\`${word}\` names an exclusion too — the predicate is the convention, not one constant`, !extractWatchHints(named).includes('packages/skipped/src'));
  }
  t('a name that merely CONTAINS the word without a segment boundary is not one', extractWatchHints("const SKIPPY_ROOTS = ['packages/skippy/src'];").includes('packages/skippy/src'));
  t('nor is a CALLABLE whose name matches — a function body is not a population declaration', extractWatchHints("function skipDirs() { return ['packages/callable/src']; }").includes('packages/callable/src'));
  // LIVE, against the gate the card was filed on: the noise floor is gone from
  // its hints and the gate is still reachable by its own script path, which is
  // the pair a narrowing has to hold. Read from disk rather than restated.
  {
    const half = 'scripts/pm/check-half-states.mjs';
    const liveHints = extractWatchHints(readFileSync(nodePath.join(ROOT, half), 'utf8'), half);
    t('LIVE: the gate that declares the noise floor no longer offers `.changeset` as a surface it watches', !liveHints.some((h) => h.startsWith('.changeset')));
    t('LIVE: and it is still reachable — the narrowing took the exclusion, not the gate', liveHints.includes(half));
  }

  // ── What a gate READS vs what its source MENTIONS (#8478) ─────────────────
  //
  // Both halves are pinned in both directions, because both directions are the
  // product: a path in prose or in a fixture must NOT be a hint, and a path the
  // module body really opens must still be one. The fabricated half is the
  // expensive one — a false lead is pasted into every dispatch prompt whose
  // surface brushes it — but a narrowing that also drops the real inputs would
  // just move the dishonesty.
  // Every path a comment case names is QUOTED inside that comment, because the
  // scan only ever reads quoted spans: an unquoted path in prose is invisible
  // to it with or without masking, so a fixture spelling one bare would assert
  // nothing and pass forever. Measured — the first draft of the two cases below
  // did exactly that, and only the reverse-verification run that removed the
  // comment mask showed them staying green through it.
  const commented = [
    '/**',
    ' * Reads `packages/spec/src` and `.changeset/x.md` — prose, not inputs.',
    ' */',
    "const REAL = 'packages/rest/src';   // twin of 'packages/core/src', says the comment",
    "const U = 'https://example.com/a/b'; const AFTER_URL = 'packages/metadata/src';",
    "const RE = /['\"`]/;",
    "const AFTER_REGEX = 'packages/client/src';",
  ].join('\n');
  const commentHints = extractWatchHints(commented);
  t('a backticked path in a block comment is not a hint', !commentHints.includes('packages/spec/src'));
  t('a dotted path in a block comment is not a hint', !commentHints.some((h) => h.startsWith('.changeset')));
  t('a path in a trailing line comment is not a hint', !commentHints.includes('packages/core/src'));
  t('the module-body literal on that same line still is', commentHints.includes('packages/rest/src'));
  // The two traps that make this a scan and not a regex: `//` inside a URL is
  // not a comment, and a quote character inside a regex literal does not open a
  // string. Either mistake blanks real code — silently, and only downstream.
  t('a `//` inside a string does not start a comment', commentHints.includes('packages/metadata/src'));
  t('a quote inside a regex literal does not open a string', commentHints.includes('packages/client/src'));
  t('masking preserves every offset', maskComments(commented).length === commented.length);

  // ...and the re-export of that masker is CODE, not comment text (#9640). The
  // statement sits at the end of the longest docblock in this file, and a
  // missing `*/` swallows it into prose that still parses: the module then has
  // no `maskComments` export while its header says it has one, and nothing goes
  // red — every gate stayed green over it until someone parsed for it. Asked of
  // this file's own source with this file's own masker, which is what the
  // docblock claims. Column 0 only, and a match the scan flags as literal is
  // rejected, so no fixture spelling in this self-test can stand in for the
  // statement.
  const ownSource = readFileSync(new URL(ENGINE_URL), 'utf8');
  const ownScan = scanSource(ownSource);
  t(
    'the maskComments re-export is code, not comment text',
    [...ownSource.matchAll(/^export \{ maskComments \};$/gm)].some(
      (m) => !ownScan.comment[m.index] && !ownScan.literal[m.index],
    ),
  );

  // The self-test boundary. The fixture puts a column-0 `}` inside a template
  // literal on purpose: that is the shape this tree really has (a check script
  // whose self-test embeds TS sources as fixtures), and a boundary that stopped
  // at the first column-0 `}` would end the mask there and leak every fixture
  // after it — measured on `scripts/check-engine-double-contract.mjs`, whose
  // self-test carries 24 such braces and whose last fixture path sits 400 lines
  // past the first one.
  const withSelfTest = [
    "const REAL = 'packages/runtime/src';",
    'function selfTest() {',
    "  const FIXTURE = 'packages/spec/src/data/filter.zod.ts';",
    '  const embedded = `',
    '}',
    "  const AFTER_BRACE = 'packages/objectql/src';",
    '  `;',
    '}',
    "const TAIL = 'docs/adr';",
  ].join('\n');
  const bodyHints = extractWatchHints(withSelfTest);
  t('a fixture path inside the self-test is not a hint', !bodyHints.includes('packages/spec/src/data/filter.zod.ts'));
  t('a column-0 brace inside a fixture does not end the self-test', !bodyHints.includes('packages/objectql/src'));
  t('the module body before the self-test still hints', bodyHints.includes('packages/runtime/src'));
  t('the module body after the self-test still hints', bodyHints.includes('docs/adr'));
  const otherSpellings = [
    'async function selfTest() {',
    "  const A = 'packages/aaa/src';",
    '}',
    'function fixtureSelfTest() {',
    "  const B = 'packages/bbb/src';",
    '}',
    'const box = {',
    '  run() {',
    "    const NESTED = 'packages/ccc/src';",
    '  },',
    '};',
  ].join('\n');
  const spellingHints = extractWatchHints(otherSpellings);
  t('an async self-test is masked too', !spellingHints.includes('packages/aaa/src'));
  t('a compound self-test name is masked too', !spellingHints.includes('packages/bbb/src'));
  t('an ordinary nested function is NOT masked', spellingHints.includes('packages/ccc/src'));
  // Composition order: comments are masked first, so a self-test declaration
  // QUOTED in a docblock (this file is full of them) cannot anchor a mask over
  // real code below it.
  const declInComment = [
    '/*',
    'function selfTest() {',
    '*/',
    "const REAL = 'packages/ddd/src';",
  ].join('\n');
  t('a self-test declaration inside a comment anchors nothing', extractWatchHints(declInComment).includes('packages/ddd/src'));

  // ── The helpers the self-test CALLS ──────────────────────────────────────
  //
  // `SELF_TEST_DECL` finds the ENTRY POINT by name, and a fixture builder is
  // named for what it builds, so its body used to survive the mask whole.
  // Measured specimen, live on this tree:
  // `scripts/pm/release-rehearsal-clone.mjs` commits a fixture `.changeset`
  // tree inside `makeSource`, and its two entries were read as paths that gate
  // OPENS — the residue printed "the tree stops at .changeset; the layout moved
  // under it" for them, a directory rename that never happened.
  //
  // The safety half is pinned beside it: a helper the module body can also
  // reach is a path the gate really reads, and must survive.
  const helperFixtures = [
    "const REAL = 'packages/runtime/src';",
    'function makeFixture(root) {',
    "  write(root, 'packages/fixture-only/one.ts');",
    '}',
    'function shared() {',
    "  return 'packages/shared/src';",
    '}',
    'function unreferenced() {',
    "  return 'packages/dead/src';",
    '}',
    'export function alsoExported() {',
    "  return 'packages/exported/src';",
    '}',
    'function selfTest() {',
    '  makeFixture(tmp);',
    '  shared();',
    '  alsoExported();',
    '}',
    'function run() {',
    '  return shared();',
    '}',
    'run();',
  ].join('\n');
  const helperHints = extractWatchHints(helperFixtures);
  t(
    'a fixture literal in a helper only the self-test calls is not a hint',
    !helperHints.includes('packages/fixture-only/one.ts'),
  );
  t('…but a helper the module body also reaches keeps its literal', helperHints.includes('packages/shared/src'));
  t('…and a declaration nothing references at all is left alone', helperHints.includes('packages/dead/src'));
  t('…and an exported helper is reachable from outside this file, so it stays', helperHints.includes('packages/exported/src'));
  t('the module body around them still hints', helperHints.includes('packages/runtime/src'));

  // Transitive, and through a signature that carries braces. Counting the
  // SIGNATURE's braces closes the body before it opens — the mask then covers
  // 29 characters and reports success, which is how
  // `function makeSource(root, name, { branch = 'main', … } = {})` reads.
  const transitiveHelpers = [
    'function writeOne(root, rel) {',
    "  return rel === 'packages/leaf/fixture.ts';",
    '}',
    'function buildTree(root, { depth = 0 } = {}) {',
    "  writeOne(root, 'packages/branch/fixture.ts');",
    '}',
    'function selfTest() {',
    '  buildTree(root);',
    '}',
  ].join('\n');
  const transitiveHints = extractWatchHints(transitiveHelpers);
  t('a helper reached only THROUGH another helper is masked too', !transitiveHints.includes('packages/leaf/fixture.ts'));
  t(
    'a destructured default in the signature does not end the body early',
    !transitiveHints.includes('packages/branch/fixture.ts'),
  );

  // ── The anchor fires on NAMES, so it also fires on production code ───────
  //
  // Live, over the tracked tree, against `COMPOUND_ANCHOR_LEDGER`. The census
  // and the argument for measuring rather than narrowing are at that table;
  // what runs here is the half that can go red.
  //
  // Read the three assertions as one instrument. The first says the population
  // has not moved under the table. The second says masking the accidental half
  // still costs no hint — the claim the ledger makes in prose, re-measured on
  // every run, so the day someone writes a path literal into `maskSelfTests`,
  // `carriesSelfTest` or any other accidental row, THIS goes red and names the
  // hint instead of dropping it in silence. The third is the control that makes
  // the second mean anything: a counterfactual that silently failed to rename
  // would report "no hint moves" for every row, which is indistinguishable from
  // a pass, so at least one GENUINE row must be seen to move a hint.
  {
    const census = new Map();
    for (const rel of trackedFiles()) {
      if (!ANCHOR_CENSUS_EXTENSIONS.test(rel)) continue;
      let text;
      try {
        text = readFileSync(nodePath.join(ROOT, rel), 'utf8');
      } catch {
        continue;
      }
      if (!/[Ss]elf[_]?[Tt]est/.test(text)) continue;
      for (const decl of compoundAnchorDecls(text)) census.set(`${rel}::${decl.name}`, rel);
    }
    const unlisted = [...census.keys()].filter((k) => !COMPOUND_ANCHOR_KEYS.has(k)).sort();
    const stale = [...COMPOUND_ANCHOR_KEYS.keys()].filter((k) => !census.has(k)).sort();
    t(
      `every compound self-test NAME the anchor matches is classified in COMPOUND_ANCHOR_LEDGER` +
        (unlisted.length ? ` — unlisted: ${unlisted.join(', ')}` : '') +
        (stale.length ? ` — listed but gone: ${stale.join(', ')}` : ''),
      unlisted.length === 0 && stale.length === 0,
    );

    const costly = [];
    const movers = [];
    for (const [key, accidental] of COMPOUND_ANCHOR_KEYS) {
      const rel = census.get(key);
      if (!rel) continue;
      const name = key.slice(rel.length + 2);
      const src = readFileSync(nodePath.join(ROOT, rel), 'utf8');
      const alt = withoutAnchor(src, name);
      if (alt === null || compoundAnchorDecls(alt).length !== compoundAnchorDecls(src).length - 1) {
        costly.push(`${key} (the counterfactual rename did not land — this row was NOT measured)`);
        continue;
      }
      const before = extractWatchHints(src, rel);
      const after = extractWatchHints(alt, rel);
      const dropped = after.filter((h) => !before.includes(h));
      if (dropped.length === 0) continue;
      if (accidental) costly.push(`${key} now hides ${JSON.stringify(dropped)}`);
      else movers.push(key);
    }
    t(
      'masking an ACCIDENTAL name match still costs this tree no watch hint' +
        (costly.length ? ` — ${costly.join('; ')}` : ''),
      costly.length === 0,
    );
    t(
      'control: at least one GENUINE self-test battery is seen to lose a fixture hint, so the ' +
        'measurement above is an instrument and not a broken rename reporting zero everywhere',
      movers.length > 0,
    );
  }

  // The card's own specimen, pinned by identity: this module's masker and the
  // helper predicate beside it are both named into the anchor's population, so a
  // rename that "fixes" either one has to move the ledger row rather than the
  // problem.
  {
    const selfCensus = compoundAnchorDecls(readFileSync(nodePath.join(ROOT, 'scripts/pm/dispatch-gates.mjs'), 'utf8'));
    const names = selfCensus.map((d) => d.name);
    t("this module's own masker is in the anchor's population", names.includes('maskSelfTests'));
    t('…and so is the reachability helper beside it', names.includes('selfTestOnlyCallables'));
  }

  // #15310 — the docblock above states this table's TOTAL / GENUINE /
  // ACCIDENTAL composition in prose, and prose does not move when a row is
  // added: three integers that agree with EACH OTHER while jointly
  // disagreeing with the table is exactly the shape that let this drift twice
  // without ever looking wrong. The declared numbers are read out of this
  // module's own docblock text, never re-typed as a second constant here, and
  // checked against a count taken fresh from COMPOUND_ANCHOR_LEDGER itself —
  // so a row added without touching the docblock reds here, and an edit to
  // any unrelated line changes neither side and stays green.
  {
    const ownSource = readFileSync(nodePath.join(ROOT, 'scripts/pm/dispatch-gates.data.mjs'), 'utf8');
    const ledgerAt = ownSource.indexOf('export const COMPOUND_ANCHOR_LEDGER = [');
    const before = ledgerAt < 0 ? '' : ownSource.slice(0, ledgerAt);
    const blockStart = before.lastIndexOf('/**');
    const blockEnd = before.lastIndexOf('*/');
    // Line-wrapped JSDoc prose carries a `\n * ` between words that happen to
    // fall on a line break — flattened to single spaces so a future rewrap of
    // this paragraph cannot itself make a true reading look false.
    const prose =
      blockStart < 0 || blockEnd < 0
        ? ''
        : ownSource
            .slice(blockStart, blockEnd)
            .replace(/\n[ \t]*\*[ \t]?/g, ' ')
            .replace(/[ \t]+/g, ' ');

    const total = COMPOUND_ANCHOR_LEDGER.length;
    const genuine = COMPOUND_ANCHOR_LEDGER.filter(([, , accidental]) => !accidental).length;
    const accidental = COMPOUND_ANCHOR_LEDGER.length - genuine;
    const distinctSpellings = new Set(COMPOUND_ANCHOR_LEDGER.map(([, name]) => name)).size;

    // Only as wide as the words this docblock actually spells; extending it is
    // a deliberate edit, not silent tolerance for a new spelling.
    const NUMBER_WORDS = {
      zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
      ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
      seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
    };
    const asCount = (word) => (/^\d+$/.test(word) ? Number(word) : NUMBER_WORDS[String(word).toLowerCase()]);

    const remaining = prose.match(/the remaining (\d+) carry compound names/);
    const allFiring = prose.match(/keeps firing on all (\d+), the mask keeps blanking all (\d+)/);
    const genuineLine = prose.match(/([A-Za-z]+) are genuine self-test batteries/);
    const accidentalLine = prose.match(/([A-Za-z]+) are production code:/);
    const spellingsLine = prose.match(/over (\d+) distinct spellings/);

    t(
      'the docblock\'s TOTAL row count — "the remaining N carry compound names" and both "all N" claims — ' +
        `agrees with the table (table: ${total}; declared: ` +
        `${remaining ? remaining[1] : '<not found>'}/${allFiring ? allFiring[1] : '<not found>'}/` +
        `${allFiring ? allFiring[2] : '<not found>'})`,
      remaining !== null
        && allFiring !== null
        && Number(remaining[1]) === total
        && Number(allFiring[1]) === total
        && Number(allFiring[2]) === total,
    );
    t(
      "the docblock's GENUINE count (\"N are genuine self-test batteries\") agrees with the table " +
        `(table: ${genuine}; declared: ${genuineLine ? genuineLine[1] : '<not found>'})`,
      genuineLine !== null && asCount(genuineLine[1]) === genuine,
    );
    t(
      "the docblock's ACCIDENTAL count (\"N are production code:\") agrees with the table " +
        `(table: ${accidental}; declared: ${accidentalLine ? accidentalLine[1] : '<not found>'})`,
      accidentalLine !== null && asCount(accidentalLine[1]) === accidental,
    );
    // Distinct NAMES, not rows: `runSelfTest` is a genuine entry point in one
    // file and an accidental one in another, so it is one spelling occupying
    // two rows — the same reason COMPOUND_ANCHOR_KEYS has to carry the file in
    // its key. This is derivable from the table exactly like the three above,
    // so it is pinned the same way rather than left as the one clause in this
    // paragraph a future row could still drift without going red.
    t(
      "the docblock's distinct-spellings count (\"over N distinct spellings\") agrees with the table " +
        `(table: ${distinctSpellings}; declared: ${spellingsLine ? spellingsLine[1] : '<not found>'})`,
      spellingsLine !== null && Number(spellingsLine[1]) === distinctSpellings,
    );
  }

  // A population DECLARED for this very scanner is referenced by no executing
  // code — being unreferenced is what such a declaration IS. Extending the mask
  // to value declarations was implemented and REFUSED on this evidence: over
  // the 204 scripts this derivation scans it took 175 hints from 36 files
  // instead of 104 from 9, and the 71 extra were the declared populations of
  // eight gates (`ROOT_DIR_WATCH_HINTS` and its spellings).
  const declaredPopulation = [
    "const ROOT_DIR_WATCH_HINTS = ['packages/drivers/**'];",
    'function selfTest() {',
    '  return ROOT_DIR_WATCH_HINTS;',
    '}',
  ].join('\n');
  t(
    'a declaration constant only the self-test names is still a declaration',
    extractWatchHints(declaredPopulation).includes('packages/drivers/**'),
  );

  // `${…}` is CODE, and reading it as string text is not academic: the live
  // specimen names its own path only from inside template literals, so a scan
  // blind to interpolations finds that constant unreferenced and masks the one
  // hint the file really declares.
  const interpolatedReference = [
    'function banner() {',
    "  return 'scripts/pm/thing.mjs';",
    '}',
    'function usage() {',
    '  return `node ${banner()} --help`;',
    '}',
    'function selfTest() {',
    '  banner();',
    '}',
    'usage();',
  ].join('\n');
  t(
    'a reference from inside a template interpolation keeps a helper alive',
    extractWatchHints(interpolatedReference).includes('scripts/pm/thing.mjs'),
  );

  // The specimen itself, on the live tree rather than in a fixture — both
  // directions, so a future edit that deletes the file or empties its
  // declaration cannot leave this green by vacuity.
  const rehearsalPath = 'scripts/pm/release-rehearsal-clone.mjs';
  const rehearsalAbs = nodePath.join(ROOT, rehearsalPath);
  t('the fixture-in-helper specimen is still on the tree', existsSync(rehearsalAbs));
  if (existsSync(rehearsalAbs)) {
    const rehearsalHints = extractWatchHints(readFileSync(rehearsalAbs, 'utf8'), rehearsalPath);
    t(
      'the fixture changesets it commits are not hints',
      !rehearsalHints.some((h) => /^\.changeset\/(one|two)\.md$/.test(h)),
    );
    t('…while the population it really declares survives', rehearsalHints.includes('.changeset/*.md'));
    t('…and so does its own path', rehearsalHints.includes(rehearsalPath));
  }
  // Module-relative spellings: `new URL('../../x', import.meta.url)` is how
  // these scripts name a repo path, and the leading segments are the script's
  // own depth, not part of what it watches.
  const relative = ["const P = new URL('../../.claude/agents/os-dev.md', import.meta.url);", "const R = '../..';"].join('\n');
  const relHints = extractWatchHints(relative);
  t('a module-relative path is normalised to repo-relative', relHints.includes('.claude/agents/os-dev.md'));
  t('a literal that is nothing but dots names no file', !relHints.some((h) => h.startsWith('..')));

  // ── The literal is RESOLVED against its writer, never stripped (#12371) ───
  //
  // The strip assumed the writer sits at the depth its own `../` run climbs to.
  // That holds for `scripts/*.mjs` and FAILS for a gate inside a package, whose
  // `'./lib/x'` came out as the top-level `lib/x` — a string this tree has no
  // `lib/` for, while the file it names is on disk. Both directions are pinned:
  // what MUST convert, and what must NOT.
  const insideAPackage = "import { f } from './lib/dist-freshness';\nconst S = '../src/kernel/protocol-version';";
  const pkgHints = extractWatchHints(insideAPackage, 'packages/spec/scripts/check-x.ts');
  t(
    'a gate inside a package resolves its own-directory literal against ITSELF',
    pkgHints.includes('packages/spec/scripts/lib/dist-freshness'),
  );
  t(
    '…and a `../` literal against its parent, not against the repo root',
    pkgHints.includes('packages/spec/src/kernel/protocol-version'),
  );
  t(
    'the top-level spelling the strip used to produce is GONE, not merely joined',
    !pkgHints.includes('lib/dist-freshness') && !pkgHints.includes('src/kernel/protocol-version'),
  );
  // The no-op half, and the reason the widening is cheap: a writer that really
  // does sit at the depth it climbs gets the same hint it always got.
  t(
    'a literal already spelled from the root by a writer at that depth is unchanged',
    extractWatchHints("const P = '../../packages/spec/src';", 'scripts/pm/x.mjs').includes('packages/spec/src'),
  );
  t(
    'a literal carrying no relative prefix is untouched by the resolve',
    extractWatchHints("const P = 'packages/spec/src';", 'packages/spec/scripts/check-x.ts').includes('packages/spec/src'),
  );
  // MUST NOT convert. Admission still reads the literal as the author wrote it,
  // so a single-segment sibling specifier is no hint at all — the same refusal
  // `hintCovers`' docblock states for a bare filename. Admitting it would hand
  // every gate its own import specifiers as a watched population, a second and
  // unpriced answer to the question `firstPartyImportTargets` owns.
  //
  // Both are asserted WITH the live tree, never without one. The refusal is
  // cheap to pass for the wrong reason — a call with no tree refuses every
  // single-segment literal — so a pin that omitted it would be green whatever
  // `moduleRelativeDirectoryHint` did.
  const hintTree = watchHintTree();
  const isTrackedDir = (p) => hintTree.prefixes.has(p) && !hintTree.files.has(p);
  t(
    'a single-segment sibling specifier does NOT convert into a hint',
    extractWatchHints("import { invokedAs } from './invoked-as.mjs';", 'scripts/check-x.mjs', { tree: hintTree })
      .length === 0,
  );
  t(
    '…and it is refused because the resolve lands on a tracked FILE, not for want of a tree',
    hintTree.files.has('scripts/invoked-as.mjs') && !isTrackedDir('scripts/invoked-as.mjs'),
  );
  t(
    '…nor does a bare sibling manifest name',
    extractWatchHints("const P = './package.json';", 'scripts/check-x.mjs', { tree: hintTree }).length === 0,
  );

  // ── ONE class IS admitted back: a single-segment literal whose resolve lands
  // ── on a tracked DIRECTORY (#12470)
  //
  // `moduleRelativeDirectoryHint` carries the split of the 53 hints the naive
  // widening adds and the judgement that puts this class apart from the two
  // `hintCovers` refuses. Pinned here as the four things a reader needs to be
  // able to break: that it FIRES, WHERE the admitted hint lands, and the two
  // structural refusals that keep it from becoming either of its neighbours.
  const specDirLiteral = "const SRC_DIR = path.resolve(__dirname, '../src');";
  t(
    'a single-segment literal resolving to a tracked directory DOES convert',
    extractWatchHints(specDirLiteral, 'packages/spec/scripts/build-docs.ts', { tree: hintTree }).join() ===
      'packages/spec/src',
    extractWatchHints(specDirLiteral, 'packages/spec/scripts/build-docs.ts', { tree: hintTree }).join(),
  );
  t(
    '…and without a tree the same call keeps the standing refusal — a missing lead, never a fabricated one',
    extractWatchHints(specDirLiteral, 'packages/spec/scripts/build-docs.ts').length === 0,
  );
  // ARRIVAL, not departure. That the literal left the refused set says nothing
  // about which family it reaches or which files: both live gates are named,
  // and each is shown to reach a real file under the directory that NO other
  // hint of that family reaches — so the pair is this rule's, not a coincidence
  // of some other hint already covering the tree there.
  const dirLanding = discoverFamilies({ tree: hintTree }).byCheck;
  const specSrcFile = trackedFiles().find((f) => f.startsWith('packages/spec/src/'));
  for (const check of ['check:docs', 'check:skill-refs']) {
    const entry = dirLanding.get(check);
    t(
      `${check} carries the admitted directory hint`,
      (entry?.hints ?? []).includes('packages/spec/src'),
    );
    t(
      `…and it is what reaches ${specSrcFile} for ${check} — no other hint of that family does`,
      Boolean(specSrcFile) &&
        (entry?.hints ?? []).filter((h) => hintCovers(h, specSrcFile)).join() === 'packages/spec/src',
    );
  }
  // The BLAST RADIUS, both directions, over the live fleet: which families this
  // rule changes at all. Read as the difference between the discovery WITH the
  // tree and the same discovery WITHOUT one, so it measures the rule and not
  // the tree — `packages/spec/src` is already a hint several other gates spell
  // from the root, and asking "who carries it" would count those too.
  const withoutTree = discoverFamilies({ tree: null }).byCheck;
  const dirGained = [];
  const dirLost = [];
  for (const [check, entry] of dirLanding) {
    const before = new Set(withoutTree.get(check)?.hints ?? []);
    for (const h of entry.hints ?? []) if (!before.has(h)) dirGained.push(`${check} +${h}`);
    for (const h of before) if (!(entry.hints ?? []).includes(h)) dirLost.push(`${check} -${h}`);
  }
  // ⚠️ WITH-tree against WITHOUT-tree measures every TREE-COUPLED rule at once,
  // and there are TWO of them now: this one, and the package-root anchor
  // (#14208), which refuses without a tree for the same reason. The rows are
  // PARTITIONED rather than filtered — a filter would let a third rule's rows
  // disappear from the one pin whose job is to notice them.
  const dirRuleGained = dirGained.filter((r) => r.endsWith('+packages/spec/src'));
  const parseRow = (row, sign) => {
    const at = row.indexOf(` ${sign}`);
    return { check: row.slice(0, at), hint: row.slice(at + 2) };
  };
  const anchorGained = dirGained.filter((r) => !dirRuleGained.includes(r)).map((r) => parseRow(r, '+'));
  const anchorLost = dirLost.map((r) => parseRow(r, '-'));
  t(
    'the rule changes exactly the two gates that walk packages/spec/src, and adds exactly the directory they walk',
    dirRuleGained.join(' · ') === 'check:docs +packages/spec/src · check:skill-refs +packages/spec/src',
    dirGained.join(' · '),
  );
  // It takes nothing away, and every remaining tree-coupled row belongs to the
  // anchor — asserted as a PAIRING rather than as a list of names, so the pin
  // survives packages/spec's artifact ledger moving and still reds the day the
  // anchor starts ADDING a hint beside a dead one instead of replacing it.
  t(
    'and it takes NOTHING away — a widening that also subtracted would read exactly like this one',
    anchorLost.length === anchorGained.length &&
      anchorGained.every((g) =>
        anchorLost.some(
          (l) =>
            l.check === g.check &&
            g.hint.endsWith(`/${l.hint}`) &&
            hintTree.files.has(`${g.hint.slice(0, g.hint.length - l.hint.length - 1)}/package.json`),
        ),
      ),
    `${anchorGained.map((g) => `${g.check} +${g.hint}`).join(' · ')} || ${dirLost.join(' · ')}`,
  );

  // ── The THIRD anchor: a literal bound to the writer's PACKAGE ROOT (#14208)
  //
  // `packageRootAnchoredHint` carries the population sweep, the pricing against
  // the two refusals it must not become, and the provenance split. Pinned here
  // as the four things a reader has to be able to break: that it FIRES, that it
  // is REFUSED without a tree, that it cannot invent a path, and that it leaves
  // the layout-moved class alone.
  const pkgAnchorSrc =
    "const PKG_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');\n" +
    "const GATED = [{ check: 'check:api-surface', artifact: 'api-surface/' }];\n";
  t(
    'a literal dead at the repo root is re-read against the package root its writer binds',
    extractWatchHints(pkgAnchorSrc, 'packages/spec/scripts/check-x.ts', { tree: hintTree }).join() ===
      'packages/spec/api-surface',
    extractWatchHints(pkgAnchorSrc, 'packages/spec/scripts/check-x.ts', { tree: hintTree }).join(),
  );
  t(
    '…and without a tree the same call keeps the root spelling — a missing lead, never a fabricated one',
    extractWatchHints(pkgAnchorSrc, 'packages/spec/scripts/check-x.ts').join() === 'api-surface',
  );
  t(
    'a re-anchoring that reaches nothing is REFUSED, so the rule cannot invent a path',
    extractWatchHints(
      `${pkgAnchorSrc}const P = 'no-such-dir/no-such-file.ts';`,
      'packages/spec/scripts/check-x.ts',
      { tree: hintTree },
    ).includes('no-such-dir/no-such-file.ts'),
  );
  // The layout-moved class is NOT this rule's: its first segment is a real repo
  // directory, so the root is the base its author most plausibly meant, and
  // re-anchoring it would replace a triage lead with a fabricated one.
  t(
    'a hint the tree stops short of keeps the ROOT spelling — the layout-moved class is left to triage',
    extractWatchHints(
      `${pkgAnchorSrc}const P = 'scripts/gone-from-here.mjs';`,
      'packages/spec/scripts/check-x.ts',
      { tree: hintTree },
    ).includes('scripts/gone-from-here.mjs'),
  );
  t(
    'a module-anchored binding that carries no package.json is no anchor',
    packageRootBinding(
      'scripts/pm/x.mjs',
      "const D = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');",
      hintTree,
    ) === null,
  );
  t(
    '…and the repo root is never the anchor — that base is the one already applied',
    packageRootBinding('scripts/pm/x.mjs', "const R = new URL('../..', import.meta.url).pathname;", hintTree) === null,
  );
  // LIVE, on this tree: the specimen the card was filed for. ARRIVAL, not
  // departure — the family is named, and the re-anchored hint is shown to reach
  // a real file that NO other hint of that family reaches, so the pair is this
  // rule's rather than a coincidence of some other hint already covering it.
  t(
    'the live spec gate binds the package root the card names',
    packageRootBinding(
      'packages/spec/scripts/check-generated.ts',
      readFileSync(nodePath.join(ROOT, 'packages/spec/scripts/check-generated.ts'), 'utf8'),
      hintTree,
    ) === 'packages/spec',
  );
  const generatedEntry = dirLanding.get('check:generated');
  const apiSurfaceFile = trackedFiles().find((f) => f.startsWith('packages/spec/api-surface/'));
  t(
    'check:generated carries its artifact ledger re-anchored, and that hint is what reaches it',
    Boolean(apiSurfaceFile) &&
      (generatedEntry?.hints ?? []).filter((h) => hintCovers(h, apiSurfaceFile)).join() ===
        'packages/spec/api-surface',
    (generatedEntry?.hints ?? []).filter((h) => hintCovers(h, apiSurfaceFile)).join(),
  );

  // REFUSAL 1 — module-relative ONLY. `resolve` treats a bare word exactly like
  // a `./` one, so without this the rule reads any bare word against its
  // writer's directory and becomes the bare-word class one gate at a time. The
  // specimen is the sharpest one on the tree: a member of
  // check-error-status-conformance's SKIP_DIRS, a directory the gate DECLARES
  // it does not read, which the tree happens to have under `scripts/`.
  t(
    'a BARE word is not resolved against its writer, even when that lands on a tracked directory',
    extractWatchHints("const SKIP = new Set(['fixtures']);", 'scripts/check-x.mjs', { tree: hintTree }).length === 0,
  );
  t(
    '…and that refusal is non-vacuous: scripts/fixtures IS a tracked directory the resolve would have found',
    isTrackedDir('scripts/fixtures'),
  );
  // REFUSAL 2 — the resolved form must carry a SEPARATOR. A bare root would
  // build a hint `hintCovers` refuses on its own bare-word rule, reaching
  // nothing and landing as a fresh row in the SHRINK-ONLY escapable-literal
  // ledger. Refusing it here makes that structural rather than lucky.
  t(
    'a single-segment literal that resolves to a bare ROOT is refused',
    extractWatchHints("const P = '../../skills';", 'scripts/pm/x.mjs', { tree: hintTree }).length === 0,
  );
  t(
    '…non-vacuously: skills IS a tracked directory, and a hint spelling it would reach nothing anyway',
    isTrackedDir('skills') && !trackedFiles().some((f) => hintCovers('skills', f)),
  );
  // The #12794 boundary, asserted as the structural exclusion it is rather than
  // as a count. `extensionlessModuleTarget` refuses any hint the tree has as a
  // prefix, and this rule admits ONLY hints the tree has as a prefix — so no
  // literal can be both a tracked-directory hint and an extensionless module
  // target, on this tree or any other.
  t(
    'a single-segment literal whose target the tree has only under a dropped extension is NOT admitted',
    extractWatchHints("import { invokedAs } from './invoked-as';", 'scripts/check-x.mjs', { tree: hintTree })
      .length === 0,
  );
  t(
    '…non-vacuously: had it been admitted, hintCovers would have matched the file through the extension rule',
    hintCovers('scripts/invoked-as', 'scripts/invoked-as.mjs'),
  );
  t(
    'the two rules are mutually exclusive by construction — an admitted directory is a tracked prefix, which extensionlessModuleTarget refuses',
    extensionlessModuleTarget('packages/spec/src', hintTree.files, hintTree.prefixes) === null &&
      isTrackedDir('packages/spec/src'),
  );
  t(
    'a literal that climbs out of the repo names nothing',
    extractWatchHints("const P = '../../../elsewhere/x/y';", 'scripts/check-x.mjs').length === 0,
  );
  t(
    'and one that resolves to the repo root itself names nothing — it would cover the tree',
    resolveModuleRelativeHint('../..', 'scripts/pm/x.mjs') === null,
  );
  // A caller with no path keeps the strip: not every caller has a writer to
  // resolve against, and a missing lead is the direction this file errs in.
  t(
    'a caller that passes no script path still gets the stripped spelling',
    extractWatchHints("import { f } from './lib/dist-freshness';").includes('lib/dist-freshness'),
  );

  // ── `#` COMMENTS on a shell-kind source (#16132) ──────────────────────────
  //
  // The card's fixture table, which is the whole of the acceptance criterion:
  // three sources that were indistinguishable and must not be, and a fourth row
  // that is the CONTROL — the JS masking discipline already reached this file
  // kind, and this change may not cost it. ⛔ A pin written against only the
  // negative rows would pass on an instrument that returned nothing at all, and
  // a pin written against only the positive one would pass on the broken
  // instrument, which returned `1` for all three.
  const shTarget = 'scripts/bump-objectui.selftest.sh';
  const shProseTick = '# see `' + shTarget + '` for the self-test\n';
  const shProseQuote = '# see "' + shTarget + '" for the self-test\n';
  const shInvocation = "bash '" + shTarget + "'\n";
  const shJsComment = '// see `' + shTarget + '`\n';
  const shHints = (src, path = 'scripts/fixture.sh') => extractWatchHints(src, path, { tree: hintTree });
  t(
    'a path a shell `#` comment quotes in BACKTICKS is not a hint',
    shHints(shProseTick).length === 0,
    shHints(shProseTick),
  );
  t(
    '…nor one it quotes in DOUBLE QUOTES — the two spellings reach the scan as a template and as a string, and one fix must cover both',
    shHints(shProseQuote).length === 0,
    shHints(shProseQuote),
  );
  t(
    '…while a REAL invocation on the same file still yields its hint, so the mask removed prose rather than the population',
    shHints(shInvocation).join() === shTarget,
    shHints(shInvocation),
  );
  t(
    'and the fourth row still reads 0 — the `//` mask this change composes onto is untouched on a shell source',
    shHints(shJsComment).length === 0,
    shHints(shJsComment),
  );
  // ── The PHANTOM BLOCK COMMENT the order used to open (#16744) ─────────────
  //
  // The other direction of the same "THIRD kind" defect, and the card's whole
  // acceptance criterion: two sources that differ in FOUR CHARACTERS OF PROSE,
  // both of which must read the one hint their code spells. The first carries a
  // block-comment opener inside a `#` comment; while `#` was masked LAST that
  // opener reached the JS scanner and blanked the real `DEST=` line under it.
  //
  // ⛔ The control is not decoration. A change that only makes the first row
  // fire — by disabling the mask, or by dropping the JS scanner on this kind —
  // takes the second row down with it or leaves it as the ONLY row that fires.
  // Both rows read 1, or this is not the fix.
  const shPhantom = '# published @objectstack/* packages\nDEST="node_modules/@objectstack/spec/dist"\n';
  const shPhantomControl = '# published packages\nDEST="node_modules/@objectstack/spec/dist"\n';
  t(
    '⭐ a `/*` inside a `#` comment no longer opens a block comment over the shell code below it',
    shHints(shPhantom, 'scripts/x.sh').join() === 'node_modules/@objectstack/spec/dist',
    shHints(shPhantom, 'scripts/x.sh'),
  );
  t(
    '⭐ CONTROL: the same code under a comment with NO opener still reads its one hint — the mask was fixed, not switched off',
    shHints(shPhantomControl, 'scripts/x.sh').join() === 'node_modules/@objectstack/spec/dist',
    shHints(shPhantomControl, 'scripts/x.sh'),
  );
  // The span, not just the line: an unterminated opener ran to the END OF FILE,
  // so the cost was every hint below it rather than the one line beside it.
  const shPhantomSpan =
    '# everything below this line is /* invisible\n'
    + 'bash "scripts/one.sh"\n'
    + 'bash "scripts/two.sh"\n';
  t(
    '…and it ran to END OF FILE, so the recovered span is every hint below the comment, not one line',
    shHints(shPhantomSpan, 'scripts/x.sh').join() === 'scripts/one.sh,scripts/two.sh',
    shHints(shPhantomSpan, 'scripts/x.sh'),
  );
  t(
    '…non-vacuously: the JS-kind control on the same bytes still loses both, which is what this order costs a `.sh` file',
    shHints(shPhantomSpan, 'scripts/x.sh.mjs').length === 0,
    shHints(shPhantomSpan, 'scripts/x.sh.mjs'),
  );
  // KIND-SCOPED, in both directions. The same bytes on a `.mjs` path must keep
  // spelling their hint: `#` is not a comment in JavaScript, and a mask that
  // fired there would be a widening rather than this card's narrowing.
  t(
    'the `#` mask does NOT reach a JS source — the same prose on a .mjs path still spells its hint',
    shHints(shProseTick, 'scripts/check-x.mjs').join() === shTarget,
    shHints(shProseTick, 'scripts/check-x.mjs'),
  );
  t(
    'the kind predicate is the DIFFERENCE of the two that already exist, so a widened follow arrives already masked',
    hashCommentProgram('scripts/x.sh')
      && !hashCommentProgram('scripts/x.mjs')
      && !hashCommentProgram('packages/spec/src/x.ts')
      && !hashCommentProgram('apps/docs/x.tsx')
      && !hashCommentProgram('docs/x.md')
      && !hashCommentProgram(null),
  );
  // A `#` opens a comment only at the start of a WORD, and only outside quotes.
  // Each of these is a line a blank-from-`#`-to-end-of-line pass would destroy,
  // and each carries a real hint AFTER the `#` so the case cannot pass by
  // returning nothing.
  t(
    'a `#` that is not at a word start opens no comment — $#, ${#…} and a bare a#b all keep the hint beside them',
    shHints('[ "$#" -gt 0 ] && cat "docs/a/b.md"\n').join() === 'docs/a/b.md'
      && shHints('n=${#argv[@]} ; cat "docs/a/b.md"\n').join() === 'docs/a/b.md'
      && shHints('git log --grep=fix#1 -- "docs/a/b.md"\n').join() === 'docs/a/b.md',
  );
  t(
    'a `#` inside single or double quotes opens no comment either',
    shHints("grep '#' \"docs/a/b.md\"\n").join() === 'docs/a/b.md'
      && shHints('grep "#" "docs/a/b.md"\n').join() === 'docs/a/b.md',
  );
  t(
    'a TRAILING `#` comment is masked without taking the code before it',
    shHints('cat "docs/a/b.md"   # and see `docs/gone.md`\n').join() === 'docs/a/b.md',
    shHints('cat "docs/a/b.md"   # and see `docs/gone.md`\n'),
  );
  // The two shapes that make a CROSS-LINE quote scanner desync on real shell,
  // and the reason quote state is line-scoped instead. Both were measured on
  // this tree against a here-doc-aware implementation before this one: a
  // here-string read as a here-doc introducer, and a command substitution whose
  // inner `"…"` closes the outer one. Either desync silently disables the mask
  // for the rest of the file, which is the FABRICATING direction.
  t(
    'a `<<<` here-string does not disable the mask for what follows it',
    shHints('awk \'{ print $2 }\' <<< "$rest"\n# see `docs/gone.md`\n').length === 0,
    shHints('awk \'{ print $2 }\' <<< "$rest"\n# see `docs/gone.md`\n'),
  );
  t(
    '…nor does a command substitution carrying its own quotes',
    shHints('v="$(printf \'%s\' "$input" | head -1)"\n# see `docs/gone.md`\n').length === 0,
    shHints('v="$(printf \'%s\' "$input" | head -1)"\n# see `docs/gone.md`\n'),
  );
  // The residue that line-scoping BUYS those two with, pinned so nobody
  // "repairs" it back into carried state: a `#` beginning a line inside a
  // multi-line quoted string or a here-doc BODY is masked as if it were a
  // comment. That text is data rather than a path the script opens, so the cost
  // is a missing lead — the direction this file errs in everywhere.
  t(
    '⭐ the deliberate over-mask: a `#` line inside a here-doc body is blanked, and that is the cheap direction, not a defect',
    shHints('cat > /tmp/n <<\'EOF\'\n# see `docs/gone.md`\nEOF\n').length === 0,
  );
  // The projection, asserted as `blank`'s contract next door states it: spans
  // become spaces, so every byte offset and every line number survives and a
  // caller can index this output against the unmasked source.
  const shProjectionSrc = 'cat "docs/a/b.md" # x\n# y\nbash \'scripts/z.sh\'\n';
  const shProjected = maskShellComments(shProjectionSrc);
  t(
    'maskShellComments only ever BLANKS — same length, same newlines, and every surviving character is the source\'s own',
    shProjected.length === shProjectionSrc.length
      && shProjected.split('\n').length === shProjectionSrc.split('\n').length
      && [...shProjected].every((c, k) => c === ' ' || c === shProjectionSrc[k])
      && shProjected !== shProjectionSrc,
  );
  // ── LIVE, on this tree: the census the card was filed on ──────────────────
  //
  // Appending `.mjs` to a shell path turns the kind predicate off while leaving
  // the writer's DIRECTORY — the only other thing `scriptPath` decides here —
  // byte for byte the same, so it is the control for what this mask removed.
  // ⛔ Written as a DIRECTION and a floor rather than as a count: a reading
  // belongs to a named commit, and this one moves whenever a shell script gains
  // or loses a comment.
  const liveShellFiles = trackedFiles().filter((f) => f.endsWith('.sh'));
  let shellGrew = 0;
  let shellShrank = 0;
  let shellBefore = 0;
  let shellAfter = 0;
  const shellAddedProse = [];
  for (const f of liveShellFiles) {
    const src = readFileSync(nodePath.join(ROOT, f), 'utf8');
    const masked = extractWatchHints(src, f, { tree: hintTree });
    const unmasked = extractWatchHints(src, `${f}.mjs`, { tree: hintTree });
    shellBefore += unmasked.length;
    shellAfter += masked.length;
    const added = masked.filter((h) => !unmasked.includes(h));
    // An ADDED hint is admissible only if it is spelled in CODE: its literal has
    // to survive the `#` mask. One spelled only inside a `#` comment would be
    // the FABRICATING direction arriving through the very reorder that fixed
    // the under-mask, so it is collected by name rather than counted.
    const code = maskShellComments(src);
    for (const h of added) if (!code.includes(h)) shellAddedProse.push([f, h]);
    if (added.length) shellGrew++;
    else if (masked.length < unmasked.length) shellShrank++;
  }
  t(
    `⭐ LIVE: over ${liveShellFiles.length} tracked .sh file(s) every hint the \`#\` mask ADDS is spelled in CODE — ${shellBefore} hints without the mask, ${shellAfter} with`,
    liveShellFiles.length > 0 && shellAddedProse.length === 0 && shellAfter < shellBefore,
    JSON.stringify({ files: liveShellFiles.length, shellBefore, shellAfter, shellGrew, shellShrank, shellAddedProse }),
  );
  t(
    '…non-vacuously: at least one live file really loses a hint, so the sweep is not passing over an instrument that changed nothing',
    shellShrank >= 1,
    JSON.stringify({ shellShrank }),
  );
  // ⛔ This case replaced a `shellGrew === 0` pin (#16132), and the replacement
  // is the point of #16744 rather than a relaxation of it. That spelling was
  // true only because `#` was masked LAST, which left shell prose to reach the
  // JS scanner first: a `#` comment containing `/*` opened a phantom block
  // comment over the real code below it, so the code could not spell a hint in
  // EITHER column and the difference read 0. Masking `#` FIRST uncovers that
  // code, so additions are now expected — and the honest invariant is what they
  // ARE, not that there are none.
  t(
    '…and the additions really happen, so the case above is not a subset test wearing a code test\'s name',
    shellGrew >= 1,
    JSON.stringify({ shellGrew }),
  );
  // The card's sharpest specimen, both ends. DEPARTURE alone would stay green
  // on a mask that emptied the file, so the ARRIVAL half names a live shell
  // script whose hint is spelled in CODE and must survive.
  const liveBumpSrc = readFileSync(nodePath.join(ROOT, 'scripts/bump-objectui.sh'), 'utf8');
  t(
    'LIVE: the file the card measured no longer offers the path its `#` comments merely NAME',
    !extractWatchHints(liveBumpSrc, 'scripts/bump-objectui.sh', { tree: hintTree }).includes(
      'docs/releases-maintenance.md',
    ),
  );
  t(
    '…non-vacuously: that path IS spelled in the file, inside a `#` comment, and the unmasked control still reads it',
    extractWatchHints(liveBumpSrc, 'scripts/bump-objectui.sh.mjs', { tree: hintTree }).includes(
      'docs/releases-maintenance.md',
    ),
  );
  // ⭐ LIVE RECOVERY (#16744): the site the card named, both ends. The `.mjs`
  // control is what makes it a recovery rather than an ordinary arrival — the
  // JS-only path STILL cannot read this line, because the phantom comment the
  // header's `@objectstack/*` opens is what hid it, and that is precisely what
  // masking `#` first removes.
  const liveDownstream = 'scripts/downstream-smoke.sh';
  const liveDownstreamSrc = readFileSync(nodePath.join(ROOT, liveDownstream), 'utf8');
  t(
    '⭐ LIVE RECOVERY: a path spelled in real shell CODE under a `#` comment carrying a block-comment opener is read again',
    extractWatchHints(liveDownstreamSrc, liveDownstream, { tree: hintTree }).includes(
      'node_modules/@objectstack/spec/dist',
    ),
    extractWatchHints(liveDownstreamSrc, liveDownstream, { tree: hintTree }),
  );
  t(
    '…non-vacuously: the JS-kind control on the same bytes still cannot see it, so a phantom comment is what was hiding it',
    !extractWatchHints(liveDownstreamSrc, `${liveDownstream}.mjs`, { tree: hintTree }).includes(
      'node_modules/@objectstack/spec/dist',
    ),
  );
  const liveShardSelfTest = 'scripts/ci/select-shard-packages.selftest.sh';
  t(
    '⭐ LIVE ARRIVAL: a shell script whose hint is spelled in CODE still spells it, so the mask removed prose and not the population',
    extractWatchHints(readFileSync(nodePath.join(ROOT, liveShardSelfTest), 'utf8'), liveShardSelfTest, {
      tree: hintTree,
    }).includes('scripts/ci/select-shard-packages.sh'),
  );
  // One resolver, not two. `firstPartyImportTargets` answers the same question
  // for the import follow; if they could disagree, one of them is the copy
  // nobody re-measured.
  t(
    'the hint resolve and the import follow agree on a shared specimen',
    resolveModuleRelativeHint('./invoked-as.mjs', 'scripts/check-doc-anchors.mjs') ===
      firstPartyImportTargets('scripts/check-doc-anchors.mjs', "import { invokedAs } from './invoked-as.mjs';")[0],
  );
  // LIVE, on this tree: the specimen the card was filed for, driven through
  // `hintCovers` — never through `collapseHint` and never re-implemented.
  const liveSchemaHints = extractWatchHints(
    readFileSync(nodePath.join(ROOT, 'packages/spec/scripts/build-schemas.ts'), 'utf8'),
    'packages/spec/scripts/build-schemas.ts',
  );
  t(
    'the live spec builder names its own src subtree, resolved',
    liveSchemaHints.includes('packages/spec/src/data'),
  );
  t(
    '…and that hint really reaches a tracked file, which the stripped spelling never did',
    hintCovers('packages/spec/src/data', 'packages/spec/src/data/field.zod.ts') &&
      !hintCovers('src/data', 'packages/spec/src/data/field.zod.ts'),
  );
  // The residue's claim stops being false: a resolved literal HAS a tracked
  // prefix, so `unreachableReason` no longer files it under the by-construction
  // sentence about a file that exists.
  //
  // ⚠️ The assertion is written against the sentence that branch prints TODAY,
  // not against a phrase it used to print. Pinned to a retired phrase this pin
  // would pass on any tree at all — the branch cannot emit a string nothing
  // renders — which is a green over the exact regression it exists to catch.
  //
  // ⚠️ This case asserted ONLY `Boolean(deepest)` — that the hint had LEFT the
  // "never" branch — and leaving that branch is precisely what puts a hint into
  // the "layout moved" one, so it stayed green through a false reason it never
  // looked at (#12299). A departure pin cannot see an arrival: both ends are
  // asserted here now, on the same live specimen.
  const distFreshnessFiles = trackedFiles();
  const distFreshnessDead = [
    {
      hint: 'packages/spec/scripts/lib/dist-freshness',
      deepest: deepestTrackedPrefix('packages/spec/scripts/lib/dist-freshness', trackedPrefixes(distFreshnessFiles)),
      target: extensionlessModuleTarget(
        'packages/spec/scripts/lib/dist-freshness',
        new Set(distFreshnessFiles),
        trackedPrefixes(distFreshnessFiles),
      ),
    },
  ];
  t(
    'a resolved dead hint has a tracked prefix, so the residue stops filing it by construction',
    Boolean(distFreshnessDead[0].deepest) &&
      !/no tracked path under its first segment/.test(unreachableReason(distFreshnessDead)),
  );
  t(
    '...and it does NOT arrive at "the layout moved" instead — the tree HAS the file, named',
    !/layout moved/.test(unreachableReason(distFreshnessDead)) &&
      unreachableReason(distFreshnessDead).includes('packages/spec/scripts/lib/dist-freshness.ts'),
  );
  t(
    '...so the family carrying it is a standing fact, not a miss worth triaging',
    unreachableClass(distFreshnessDead) === 'by construction',
  );
  // The extension list is a NARROWING, and the price of a narrowing is what it
  // refuses. Pinned as an AGREEMENT rather than as a count, so it survives the
  // tree moving: over every inert hint in the live fleet, resolving through
  // MODULE_SPECIFIER_EXTENSIONS and resolving through "any suffix in the same
  // directory" must pick the same file. Today both pick 38 hints and all 38
  // land on `.ts`. The day they disagree, some gate imports a specifier whose
  // only sibling is not a module — and whether to name that file is a decision
  // for whoever is standing there, not a drift for nobody to notice.
  const agreeFiles = trackedFiles();
  const agreeFileSet = new Set(agreeFiles);
  const agreePrefixes = trackedPrefixes(agreeFiles);
  const agreeHints = new Set();
  for (const [, entry] of discoverFamilies().byCheck) for (const h of entry.hints ?? []) agreeHints.add(h);
  const looseTarget = (hint) => {
    const plain = collapseHint(hint);
    if (!plain || agreePrefixes.has(plain)) return null;
    return agreeFiles.find((f) => f.startsWith(`${plain}.`) && !f.slice(plain.length + 1).includes('/')) ?? null;
  };
  // POPULATION: every distinct hint in the fleet, not just the inert ones.
  // #12514 made the matcher follow a dropped extension, so the 38 hints this
  // trade was measured over are LIVE now and an `inert`-scoped population would
  // have emptied — taking three green cases with it while asserting nothing.
  // Both `looseTarget` and `extensionlessModuleTarget` already refuse a hint
  // whose collapsed form the tree HAS as a path, so widening the population
  // adds no candidate; measured, it still selects the same 38.
  //
  // A hint on a GENERATED, git-ignored module (#22554) is out of this population
  // by construction: the module is not a tracked file, so the strict rule names
  // nothing, while the loose one names the tracked `registry.ts.template` beside
  // it — not a module, and not what the import means. Such a hint reaches the
  // tree through its declared committed sources (`GENERATED_MODULE_SOURCES`),
  // pinned in its own case below, never through an extension.
  const agreeCandidates = [...agreeHints].filter((h) => generatedModuleSources(collapseHint(h)) === null);
  const strictOf = (h) => extensionlessModuleTarget(h, agreeFileSet, agreePrefixes);
  const refusedByNarrowing = agreeCandidates.filter((h) => !strictOf(h) && looseTarget(h));
  t(
    `the extension narrowing costs no lead — every hint the loose rule resolves, this one resolves too (refused: ${refusedByNarrowing.join(', ') || 'none'})`,
    refusedByNarrowing.length === 0,
  );
  t(
    'and it invents nothing: every file it names is a tracked file',
    agreeCandidates.every((h) => !strictOf(h) || agreeFileSet.has(strictOf(h))),
  );
  // The reason the list is explicit rather than "any suffix", held to the tree
  // so the justification cannot quietly evaporate: somewhere in the fleet the
  // loose rule picks a `.test.ts` sibling over the module the import means. If
  // those test files are ever removed, re-point this case at whatever pair the
  // tree then has rather than deleting it — the trade is decided, not stale.
  t(
    'the loose alternative really would name the wrong file, which is why it is refused',
    agreeCandidates.some((h) => strictOf(h) && looseTarget(h) && strictOf(h) !== looseTarget(h)),
  );
  // ⚠️ And the trade is now load-bearing in a second place. It used to decide
  // one SENTENCE in a listing; since #12514 the same list decides which files
  // the MATCHED column names, so the loose rule would put a gate's `.test.ts`
  // sibling into dispatch prompts. Re-measured here: 4 of the 38 (the four
  // named in MODULE_SPECIFIER_EXTENSIONS' docblock), and the matcher reaches
  // the module rather than the test for every one of them.
  const trapped = agreeCandidates.filter((h) => strictOf(h) && looseTarget(h) && strictOf(h) !== looseTarget(h));
  t(
    `the matcher reaches the module, never the test sibling the loose rule would have named (${trapped.length} such hints)`,
    trapped.length > 0 &&
      trapped.every((h) => hintCovers(h, strictOf(h)) && !hintCovers(h, looseTarget(h))),
  );

  // ── A dropped extension is followed, at COMPARISON time (#12514) ──────────
  //
  // Nine `packages/spec` families were unreachable ENTIRELY because a gate
  // spells an imported module without its extension, so no path derivation
  // could name them and a dev editing the file was never told they owed them.
  // Silent under-derivation, exit 0. The pins below are ARRIVAL pins: where a
  // hint lands, never merely that it left the branch it used to be in.
  t(
    'the matcher follows the extension an ESM specifier drops',
    hintCovers('packages/spec/src/migrations/registry', 'packages/spec/src/migrations/registry.ts'),
  );
  // The live specimen the card was filed for, driven end to end through the
  // real fleet: the family, the hint and the file are all read from the tree.
  const extlessLive = discoverFamilies().byCheck.get('check:spec-changes');
  t(
    'check:spec-changes really declares the extensionless specifier',
    (extlessLive?.hints ?? []).includes('packages/spec/src/migrations/registry'),
  );
  t(
    '...and a card touching that file now MATCHES it — the silent under-derivation this card names',
    (extlessLive?.hints ?? []).some((h) => hintCovers(h, 'packages/spec/src/migrations/registry.ts')),
  );
  // EQUALITY, not a prefix. The rule may name the one file the specifier
  // resolves to and nothing else — not a subtree under it, not a sibling that
  // merely starts the same way, and not a second extension stacked on the
  // first. Each of these would be a fabricated lead, which this file prices
  // above a missing one.
  t('the extension follow does not become a subtree claim', !hintCovers('packages/spec/src/migrations/registry', 'packages/spec/src/migrations/registry.ts/inner.ts'));
  t('nor reach a sibling that merely shares the stem', !hintCovers('packages/spec/src/migrations/registry', 'packages/spec/src/migrations/registry-v2.ts'));
  t('nor a doubled extension', !hintCovers('packages/spec/src/migrations/registry', 'packages/spec/src/migrations/registry.ts.ts'));
  t('and it stays inside the segment rule — a bare word is still refused, extension or not', !hintCovers('registry', 'registry.ts'));
  // The dotted-suffix sibling trade (#8534) is what a LOOSE suffix rule would
  // have taken back. Pinned here as well as above, because this card is the one
  // that would have broken it: `.base.json` is not a module extension.
  t('the sibling-file refusal survives the extension follow', !hintCovers('packages/spec/authorable-surface', 'packages/spec/authorable-surface.base.json'));

  // ── A GENERATED, git-ignored module is reached through its SOURCES (#22554) ──
  //
  // The migration registry left git: its hint names a file no card can touch,
  // and a card that changes what it contains edits the template or an entry.
  // ARRIVAL pins on both kinds of source and both spellings of the hint; the
  // CONTROL is the same hint against a migrations sibling and a lookalike of the
  // source directory, and a NON-generated module's hint against an entry — the
  // mapping belongs to the declared row and to nothing else.
  const genHint = 'packages/spec/src/migrations/registry';
  t(
    "a generated module's hint reaches its committed sources: the template, and a file under entries/, by either spelling",
    hintCovers(genHint, 'packages/spec/src/migrations/registry.ts.template') &&
      hintCovers(genHint, 'packages/spec/src/migrations/entries/semantic/18.x.ts') &&
      hintCovers(`${genHint}.ts`, 'packages/spec/src/migrations/entries/retired-keys/17.x.ts'),
  );
  t(
    "CONTROL: and nothing else — not a sibling module, not a lookalike of the source directory, not another module's hint",
    !hintCovers(genHint, 'packages/spec/src/migrations/chain.ts') &&
      !hintCovers(genHint, 'packages/spec/src/migrations/entries-notes/x.ts') &&
      !hintCovers('packages/spec/src/migrations/chain', 'packages/spec/src/migrations/entries/semantic/18.x.ts'),
  );
  // The row is DECLARED, so it is proven against the real tree on every run:
  // the module untracked and ignored by a TRACKED ignore file, every source
  // tracked. Committing the module again, or moving a source, reds here.
  {
    const genFiles = trackedFiles();
    const genTracked = new Set(genFiles);
    const genPrefixes = trackedPrefixes(genFiles);
    const genIgnored = ignoreVerdicts(GENERATED_MODULE_SOURCES.map((row) => row.module));
    const genBroken = GENERATED_MODULE_SOURCES.filter((row) => {
      const verdict = genIgnored.get(row.module);
      return (
        genTracked.has(row.module) ||
        verdict?.covered !== true ||
        !genTracked.has(verdict.source) ||
        !row.sources.every((source) => genPrefixes.has(source))
      );
    });
    t(
      `every GENERATED_MODULE_SOURCES row holds in this tree: module untracked and ignored by a tracked ignore file, each source tracked (broken: ${genBroken.map((row) => row.module).join(', ') || 'none'})`,
      GENERATED_MODULE_SOURCES.length > 0 && genBroken.length === 0,
    );
  }

  // COHERENCE: the matcher and the residue cannot disagree about a file the
  // tree HAS. `extensionlessModuleTarget` exists to say "the tree has this
  // file" about a hint the sweep calls dead; after this change no hint that
  // carries a separator can be in both states at once, so the residue can never
  // print that sentence about a hint the derivation is silently missing.
  const stillDead = agreeCandidates.filter((h) => h.includes('/') && !hintReachesTree(h, agreeFiles));
  t(
    'no separator-carrying hint is both dead to the matcher and resolvable to a tracked file',
    stillDead.every((h) => !strictOf(h)),
  );

  // ── The fabrication direction, re-homed from #12299 ───────────────────────
  //
  // This widening is root-agnostic: it follows an extension wherever the hint
  // points, INCLUDING at a top-level root the tree does not have. The tree
  // grows a `src/` or a `data/` and inert hints become MATCHED pairs for gates
  // that never read those files — the fabricated-lead direction this file
  // prices above a missing one. The requirement adopted on #12299 was that this
  // cannot happen SILENTLY, so the roots are held out by name here and their
  // arrival reds THIS case instead of quietly minting pairs into prompts.
  const fabTopLevel = new Set(agreeFiles.map((f) => f.split('/')[0]));
  const fabRoots = new Set();
  for (const h of agreeCandidates) {
    if (hintReachesTree(h, agreeFiles)) continue;
    const root = collapseHint(h).split('/')[0];
    if (root && !fabTopLevel.has(root)) fabRoots.add(root);
  }
  // The mechanism, shown rather than argued — a synthetic pair, so the reader
  // can see exactly what the guard below is holding out.
  t('a hint under an absent root WOULD convert the day that root appears', hintCovers('src/kernel/protocol-version', 'src/kernel/protocol-version.ts'));
  t(
    `and today none of the ${fabRoots.size} roots one directory away is in the tree — ` +
      'if this reds, a new top-level directory just converted inert hints into MATCHED pairs; ' +
      'check each against the gate that declares it before accepting the leads',
    [...fabRoots].every((r) => !fabTopLevel.has(r)),
  );
  // The two the #12299 requirement names, held explicitly so the guard cannot
  // evaporate if the derived set above ever empties for an unrelated reason.
  t('`src` is not a tracked top-level entry — 20 inert hints are rooted there', !fabTopLevel.has('src') && fabRoots.has('src'));
  t('`data` is not a tracked top-level entry — 9 inert hints are rooted there', !fabTopLevel.has('data') && fabRoots.has('data'));

  t('hint covers deeper path', hintCovers('.claude/agents', '.claude/agents/os-dev.md'));
  t('collapsed glob prefix covers', hintCovers('packages/spec/src/**', 'packages/spec/src/data/filter.zod.ts'));
  t('input dir covers hint below it', hintCovers('packages/spec/scripts/check-x.mjs', 'packages/spec'));
  t('unrelated path does not match', !hintCovers('.claude/agents', 'packages/rest/src/server.ts'));

  // ── Segment boundaries, not string prefixes (#8534) ───────────────────────
  //
  // Every case above is one the raw-prefix rule also passed; they stay to prove
  // the narrowing kept them. The cases below are the ones it failed.
  t('a hint equal to the input path covers it', hintCovers('docs/adr', 'docs/adr'));
  t('a sibling sharing a name prefix is NOT covered', !hintCovers('packages/client', 'packages/client-react/src/index.ts'));
  t('nor in the other direction', !hintCovers('packages/spec-extra/x.ts', 'packages/spec'));
  // The live specimen this is measured on: a real FILE sitting beside a real
  // directory of the same name stem. The filed census called the rule dormant
  // after probing package DIRECTORIES; it was live all along, on a file. The
  // original specimen was `content/docs` + `content/docs.site.json`; that file
  // was deleted as dead config (#12489) and this case was re-pointed, per the
  // standing instruction kept here: if `packages/spec/authorable-surface.base.json`
  // is ever removed, re-point this case at whatever sibling pair the tree then
  // has rather than deleting it.
  t('the live sibling FILE is no longer claimed by the directory hint', !hintCovers('packages/spec/authorable-surface', 'packages/spec/authorable-surface.base.json'));
  t('while the directory it names is still covered', hintCovers('packages/spec/authorable-surface', 'packages/spec/authorable-surface/ai.json'));
  // The collapsed-glob reach trade, pinned in BOTH directions so the decision
  // reads as an assertion. Refusing the sibling reach is the DECIDED loss (see
  // hintCovers' docblock): measured, no repo-path hint of this shape exists —
  // the only two live partial-segment globs are npm specifiers.
  t('a collapsed partial-segment glob does NOT reach the sibling it would match as a glob', !hintCovers('packages/client*', 'packages/client-react/src/index.ts'));
  t('the same glob still covers the package it names', hintCovers('packages/client*', 'packages/client/src/index.ts'));
  t('a segment-boundary glob is untouched by the trade', hintCovers('packages/client/**', 'packages/client/src/index.ts'));

  // ── A glob in a NON-FINAL segment is matched, not collapsed (#12246) ──────
  //
  // Collapse-by-deletion mangles this one shape into a double separator no tree
  // can hold, so the hint matched nothing BY CONSTRUCTION and its family was
  // then misfiled as "THE LAYOUT MOVED". Both halves are pinned: what the rule
  // now reaches, and — the larger half — everything it deliberately does NOT
  // disturb, because the refused alternative (matching ALL whole-segment globs)
  // breaks the ROOT_DIR_WATCH_HINTS idiom by −7404 pairs on each of three gates.
  t('the predicate reads the LAST segment, so a trailing glob is not this case', !globInNonFinalSegment('packages/**'));
  t('nor is a partial-segment glob in the last segment', !globInNonFinalSegment('packages/client*'));
  t('a glob in a middle segment IS', globInNonFinalSegment('skills/*/references/_index.md'));
  t('and a `**` in a middle segment IS', globInNonFinalSegment('packages/**/*.ts'));
  // The live specimen: `packages/spec/scripts/build-skill-references.ts` emits
  // these nine files and the derivation reached zero of them. If the skills
  // layout ever changes, re-point this case at whatever mid-segment glob the
  // fleet then declares rather than deleting it.
  t('a mid-segment glob reaches the file it names', hintCovers('skills/*/references/_index.md', 'skills/objectstack-formula/references/_index.md'));
  t('and does NOT claim the rest of the subtree it passes through', !hintCovers('skills/*/references/_index.md', 'skills/objectstack-formula/SKILL.md'));
  t('a `**` crosses separators, a single `*` does not', hintCovers('packages/**/*.ts', 'packages/spec/src/data/filter.zod.ts'));
  t('so a single `*` segment matches exactly one segment', !hintCovers('skills/*/references/_index.md', 'skills/a/b/references/_index.md'));
  t('the extension the glob names is honoured', !hintCovers('packages/**/*.object.ts', 'packages/spec/src/index.ts'));
  // Reverse containment, the direction a coarse card surface needs: the literal
  // prefix before the first wildcard still reaches back to a directory surface,
  // exactly as the collapsed form used to.
  t('a directory surface above the glob still derives the gate', hintCovers('skills/*/references/_index.md', 'skills'));
  t('but an unrelated root does not', !hintCovers('skills/*/references/_index.md', 'packages'));
  // ⛔ The refused alternative, pinned as the loss it would be. Each of these
  // is a trailing glob and MUST keep going through the collapse.
  t('a trailing `**` still collapses to the root it names', hintCovers('packages/**', 'packages/spec/src/index.ts'));
  t('the ROOT_DIR_WATCH_HINTS idiom is untouched', hintCovers('skills/**', 'skills/objectstack-formula/SKILL.md'));
  t('and so is a trailing single `*`', hintCovers('examples/*', 'examples/app-showcase/src/x.ts'));
  t('the DECIDED partial-segment trade still refuses the sibling', !hintCovers('packages/client*', 'packages/client-react/src/index.ts'));

  // ── `**` covers ZERO segments too (#12329) ───────────────────────────────
  //
  // The branch above judges these hints with `triggerCovers`, i.e. with
  // GitHub's filter-pattern language, where `**` is a CHARACTER wildcard and
  // the `/` written after it is a literal that must still appear. That makes
  // `**` mean ONE OR MORE segments, so the natural spelling for a top-level
  // population reaches none of it. Read from the real corpus, not a fixture: a
  // fixture cannot show that the tree still has the shape the trap needs.
  const topLevelMirrors = trackedFiles().filter((f) => /^scripts\/[^/]+\.d\.mts$/.test(f));
  t('the tree really does hold top-level `.d.mts` files under a root', topLevelMirrors.length >= 3);
  t('a `**` root reaches the top-level files under it', topLevelMirrors.every((f) => hintCovers('scripts/**/*.d.mts', f)));
  t('and claims nothing else in the whole tree', trackedFiles().filter((f) => hintCovers('scripts/**/*.d.mts', f)).length === topLevelMirrors.length);
  t('the ONE-OR-MORE reading it used to have is still there', hintCovers('scripts/**/*.d.mts', 'scripts/pm/x.d.mts'));
  t('at any depth', hintCovers('scripts/**/*.d.mts', 'scripts/a/b/x.d.mts'));
  t('the extension the glob names is still honoured at the top level', !hintCovers('scripts/**/*.d.mts', 'scripts/invoked-as.mjs'));
  t('and a directory surface above it still derives the gate', hintCovers('scripts/**/*.d.mts', 'scripts'));
  // The forms are itself first, then the reductions — the original spelling is
  // never lost, which is what keeps the one-or-more cases above passing.
  t('the forms of a `**` hint are the hint and its zero-segment reduction', zeroSegmentForms('scripts/**/*.d.mts').join(' ') === 'scripts/**/*.d.mts scripts/*.d.mts');
  t('each `**` drops independently, so two of them give the power set', zeroSegmentForms('a/**/b/**/c').join(' ') === 'a/**/b/**/c a/b/**/c a/**/b/c a/b/c');
  t('a hint with no `**` segment has exactly one form', zeroSegmentForms('skills/*/references/_index.md').join(' ') === 'skills/*/references/_index.md');
  t('and so does a hint with no glob at all', zeroSegmentForms('packages/spec/src/index.ts').join(' ') === 'packages/spec/src/index.ts');
  t('a hint above the cap keeps its written and fully-reduced forms only', zeroSegmentForms('a/**/**/**/**/**/**/**/**/**/z').length === 2);
  // ⛔ Deliberately NOT droppable — three refusals that keep this narrow.
  t('a single `*` segment is not a zero-segment wildcard', !hintCovers('skills/*/references/_index.md', 'skills/references/_index.md'));
  t('nor is a `**` that is only PART of a segment', zeroSegmentForms('packages/a**/b.ts').join(' ') === 'packages/a**/b.ts');
  t('and a trailing `**` never reaches this rule at all', hintCovers('packages/**', 'packages/spec/src/index.ts') && !globInNonFinalSegment('packages/**'));
  // The CI mirror is untouched, which is the whole reason the repair lives in
  // `hintCovers` and not in `triggerPatternRegex`: a hint is a glob a gate
  // author wrote, a trigger is a filter GitHub will evaluate, and this file
  // must keep saying what GitHub does. `validate-deps.yml` declares
  // `'**/package.json'` and is the live specimen.
  t('the trigger language still reads `**` as the character wildcard GitHub documents', !triggerCovers('**/package.json', 'package.json'));
  t('while the same spelling as a HINT covers the root file', hintCovers('**/package.json', 'package.json'));
  // The sibling spelling used to be dead by the OLDER route and is repaired by
  // `globCarriesLiteralSuffix` (#13448). The collapse still mangles it — that
  // is the whole reason it must not be judged by the collapse — so BOTH halves
  // are pinned: the mangle is still what deletion produces, and the hint no
  // longer goes through it.
  t('the collapse of a final-segment glob with a literal suffix is still a splice', collapseHint('scripts/*.d.mts') === 'scripts/.d.mts');
  t('...so the hint is judged as a pattern instead', judgedAsPattern('scripts/*.d.mts') && globCarriesLiteralSuffix('scripts/*.d.mts'));
  t('...and now reaches every one of the files it names', topLevelMirrors.every((f) => hintCovers('scripts/*.d.mts', f)));
  t('...and claims nothing else in the whole tree', trackedFiles().filter((f) => hintCovers('scripts/*.d.mts', f)).length === topLevelMirrors.length);
  t('a single `*` still never crosses a separator', !hintCovers('scripts/*.d.mts', 'scripts/pm/x.d.mts'));

  // ── A final-segment glob with a literal SUFFIX is a splice too (#13448) ───
  //
  // The species `zeroSegmentForms` recorded and left. Deletion-collapse mangles
  // `.changeset/*.md` into `.changeset/.md`, so the hint reached ZERO of 548
  // tracked changesets while reading as an ordinary literal, and the residue
  // then named a directory rename as the cause. Read from the REAL corpus: a
  // fixture cannot show that the hint still reaches the population the trap was
  // sprung on. What that corpus is NOT is something this file may require: it
  // grows with every merged PR and a version pass takes all of it back (#15255,
  // and the docblock under `changesetPop` below).
  const suffixCorpus = trackedFiles();
  const changesetPop = changesetSpecimenPop(suffixCorpus);
  // ⛔ NOT `changesetPop.length >= 100` (#15255). That control was reaching for
  // something real — the two assertions under it pass VACUOUSLY over an empty
  // population, `every` on nothing and `0 === 0` — but it bought the guard with
  // a claim this tool has no standing to make. The size of that population is
  // owned by the release cycle: a changesets version pass consumes all of it,
  // so it is 1 on the Version Packages PR (measured on #11336's head
  // b8573e843: `.changeset/` holds README.md and config.json and nothing else),
  // it is whatever has landed since on `main` for the days after, and it is 865
  // here. A required context that reds at 1 and at 3 blocks the release itself,
  // and then blocks `main` behind it.
  //
  // What a gate CAN require is the specimen's HOME. `.changeset/config.json` is
  // the changesets tool's own configuration: while it is tracked, an empty
  // population is this repo mid-cycle and the specimen is merely resting; when
  // it goes, the specimen has no population to come back to and somebody must
  // pick a new one for this species. That distinction is the whole difference
  // between "not measurable today" and "rotted", and it is the one the count
  // could not draw.
  //
  // The vacuity the count was guarding is closed by construction instead: the
  // three corpus assertions run only where there is a corpus, and where there
  // is not, `unmeasurable` says so out loud rather than letting them green.
  // Note the population is 1, not 0, on the real release PR — `README.md`
  // survives a version pass — so a guard written at `=== 0` would have left the
  // gate red on the very tree it was written for. It is written at "empty" and
  // measured at 0, 1, 3 and 865.
  t('the `.changeset/*.md` specimen still has a home in this tree', suffixCorpus.includes('.changeset/config.json'));
  if (changesetPop.length === 0) {
    unmeasurable(
      'the `.changeset/*.md` live-specimen corpus assertions',
      'this tree tracks no `.changeset/*.md` at all — that is what a changesets version pass produces, and the ' +
        'population comes back as changesets land. The specimen still has its home (see the case above); the three ' +
        'assertions that need a population are the only thing skipped, and every literal case in this block ran. ' +
        "Check it yourself: git ls-files '.changeset/'",
    );
  } else {
    t('the live specimen reaches every changeset it names', changesetPop.every((f) => hintCovers('.changeset/*.md', f)));
    t('and claims nothing else in the whole tree', suffixCorpus.filter((f) => hintCovers('.changeset/*.md', f)).length === changesetPop.length);
    t('so it is nobody\'s dead literal any more', hintReachesTree('.changeset/*.md', suffixCorpus));
  }
  // The branch above is a decision this tree can only exercise one way — it
  // holds a population today and will hold one on almost every run — so the
  // sizes the release cycle really produces are pinned on fixtures, at the four
  // states named in the docblock. A boundary written at the wrong one is the
  // defect that shipped: `>= 100` is green at 865 and red at every size a
  // version pass leaves behind.
  const csTree = (...names) => ['AGENTS.md', '.changeset/config.json', ...names];
  t('at 865 the corpus assertions run, which is this tree and every ordinary day',
    changesetSpecimenPop(csTree(...Array.from({ length: 865 }, (_, i) => `.changeset/c${i}.md`))).length === 865);
  t('at 3 they still run — the state `main` is in for days after a release lands, and where `>= 100` was red',
    changesetSpecimenPop(csTree('.changeset/a.md', '.changeset/b.md', '.changeset/c.md')).length === 3);
  t('at 1 they still run, and 1 is what the Version Packages PR really carries — README.md survives a version pass',
    changesetSpecimenPop(csTree('.changeset/README.md')).length === 1);
  t('only an EMPTY population is undecidable, and that is the only state that skips',
    changesetSpecimenPop(csTree()).length === 0);
  // The home discriminator, both directions: it is what separates "resting" from
  // "rotted", so it must not answer the same way for a tree that has retired
  // changesets altogether.
  t('a tree mid-cycle still has the specimen home, so an empty population reads as resting',
    csTree().includes('.changeset/config.json'));
  t('...while a tree that retired changesets has no home, and the case above reds instead of skipping',
    !['AGENTS.md', 'package.json'].includes('.changeset/config.json'));
  // The tally the skip is reported through. Pinned here rather than at the
  // verdict because a green run of this file never reaches the non-empty branch
  // of it, so nothing else in this program can show that a skip is visible.
  t('a run that skipped nothing prints the verdict it always printed', notMeasuredSuffix([]) === '');
  t('...and a run that skipped something names it, so no skip reaches a reader as a bare pass count',
    notMeasuredSuffix([['a subject', 'a reason']]).includes('NOT MEASURED') &&
      notMeasuredSuffix([['a subject', 'a reason']]).includes('a subject'));
  t('...naming every one of them, never just a count',
    notMeasuredSuffix([['first', 'x'], ['second', 'y']]).includes('first') &&
      notMeasuredSuffix([['first', 'x'], ['second', 'y']]).includes('second'));
  t('and a skipped subject is never a case, so the pass count cannot absorb one',
    !cases.some(([name]) => name.includes('NOT MEASURED')));
  t('the extension the glob names is honoured', !hintCovers('.changeset/*.md', '.changeset/config.json'));
  t('a single `*` matches exactly one segment here too', !hintCovers('.changeset/*.md', '.changeset/pre/x.md'));
  t('a directory surface above it still derives the gate', hintCovers('.changeset/*.md', '.changeset'));
  t('but an unrelated root does not', !hintCovers('.changeset/*.md', 'packages'));
  // The predicate, both directions. What decides it is a LITERAL behind the
  // glob, never a literal in front of one.
  t('a glob with a literal behind it in the last segment is the splice case', globCarriesLiteralSuffix('.changeset/*.md'));
  t('a literal PREFIX before the glob is not what decides it', globCarriesLiteralSuffix('scripts/check-*.mjs') && !globCarriesLiteralSuffix('scripts/check-*'));
  t('a TRAILING glob is not this case — deletion truncates it to a real prefix', !globCarriesLiteralSuffix('packages/**') && !globCarriesLiteralSuffix('packages/*') && !globCarriesLiteralSuffix('packages/client*'));
  t('nor is a hint with no glob at all', !globCarriesLiteralSuffix('packages/spec/src/index.ts'));
  // ⛔ The refusals, pinned as the losses they would be. Each of these MUST
  // keep going through the collapse: the alternative was measured at −7404
  // pairs on each of three gates (see zeroSegmentForms' docblock).
  t('the ROOT_DIR_WATCH_HINTS idiom is bit-for-bit untouched',
    hintCovers('skills/**', 'skills/objectstack-formula/SKILL.md') &&
      hintCovers('examples/*', 'examples/app-showcase/src/x.ts') &&
      hintCovers('packages/**', 'packages/spec/src/index.ts'));
  t('the DECIDED partial-segment trade still refuses the sibling', !hintCovers('packages/client*', 'packages/client-react/src/index.ts'));
  t('...and still covers the package it names', hintCovers('packages/client*', 'packages/client/src/index.ts'));
  // ⛔ `?`, `+` and `[…]` are NOT admitted. `collapseHint` never deleted them,
  // so they are not a mangle — they are an ordinary literal that fails to
  // match, which is the MISSING-lead direction this file errs in. Measured at
  // zero live instances; pinned so their arrival is a decision somebody makes
  // rather than a fabricated-pair widening nobody sees.
  const finalSegmentShapes = new Set();
  for (const [, entry] of discoverFamilies().byCheck) for (const h of entry.hints ?? []) finalSegmentShapes.add(h.split('/').pop());
  t('no hint in the fleet carries a `?`, `+` or character class', ![...finalSegmentShapes].some((s) => /[?+[]/.test(s)));
  t('and such a hint is still judged by the collapse, exactly as before', !judgedAsPattern('scripts/check-?.mjs'));

  // The trailing-separator strip is ONE call, not two: `/\/+$/` is greedy and
  // anchored, so nothing survives for a second `/\/$/` to remove. Measured at
  // zero of 754 hints; pinned on the probes that could tell them apart, so a
  // future reader does not restore the redundant call as defence-in-depth.
  t('the greedy trailing strip removes every trailing separator', collapseHint('a///') === 'a');
  t('including the one a trailing `**` leaves behind', collapseHint('a/**/') === 'a');
  t('and a hint that is nothing but separators collapses to empty', collapseHint('**/') === '');
  t('what it cannot touch is a separator left in the MIDDLE', collapseHint('skills/*/references/_index.md') === 'skills//references/_index.md');

  // ── A declared SUBTREE is not a bare word (#9626) ─────────────────────────
  //
  // The genericity refusal reads the hint as the author wrote it. Both
  // directions, because the whole value of the rule is the pair: the word is
  // still refused, the declaration is now honoured. Collapsing `content/**`
  // yields the same `content` the bare word yields, which is precisely why the
  // refusal cannot be decided on the collapsed copy.
  t('a single-segment root declared as a subtree covers the tree it names', hintCovers('content/**', 'content/docs/any-page.mdx'));
  t('the same declaration covers the OTHER subtree under that root', hintCovers('content/**', 'content/blog/a-post.mdx'));
  t('a bare top-level directory WORD is still refused as too generic', !hintCovers('packages', 'packages/spec/src/index.ts'));
  t('a bare root that lost its separator to the trailing trim is still refused', !hintCovers(extractWatchHints("const D = 'examples/';")[0] ?? 'examples', 'examples/app-showcase/src/x.ts'));
  t('a declared subtree does not reach a sibling root', !hintCovers('content/**', 'contentious/x.md'));
  // A top-level FILE stays out of reach on purpose: accepting a bare filename
  // would admit every `package.json` basename a gate joins with a package dir.
  // Pinned so the loss reads as a decision, not an oversight. What is refused
  // is the LITERAL, never the file — a gate whose population really is a root
  // file reaches it by declaring the subtree spelling, which is what the
  // rootFileDeclarations cases below pin.
  t('a bare top-level FILE name is refused, the decided loss', !hintCovers('README.md', 'README.md'));

  // The three live declarations the refusal used to swallow, read from the real
  // gates rather than fixtures — a fixture cannot show that the tree still has
  // the shape. If one of these gates stops declaring its root, re-point the
  // case at whatever gate then does; deleting one deletes the evidence.
  // Re-pointed at the module that DECLARES the table (#11511): it moved out of
  // check-cross-package-test-inputs.mjs into a plain module precisely so the
  // follow below could reach it, and this read is of the declaration, not of
  // the gate. Exactly what the paragraph above asks for -- "if one of these
  // gates stops declaring its root, re-point the case at whatever gate then
  // does". Left pointing at the gate it would have gone green over an empty
  // hint list, which is the vacuous-pass shape these cases exist to refuse.
  const crossPkgHints = extractWatchHints(readFileSync(nodePath.join(ROOT, 'scripts/cross-package-test-inputs.mjs'), 'utf8'), 'scripts/cross-package-test-inputs.mjs');
  // NOT `scripts/check-nul-bytes.mjs`: that gate names that file explicitly
  // too, so the case would pass with the declaration still refused — measured,
  // it survived the ablation. Pick a scripts path reachable ONLY through the
  // declared subtree, or the case pins nothing.
  t('the cross-package declaration table reaches the root scripts dir it declares', crossPkgHints.some((h) => hintCovers(h, 'scripts/pm/dispatch-gates.mjs')));
  t('and the content tree it declares', crossPkgHints.some((h) => hintCovers(h, 'content/docs/getting-started/index.mdx')));
  const governedHints = extractWatchHints(readFileSync(nodePath.join(ROOT, 'scripts/pm/check-governed-merges.mjs'), 'utf8'), 'scripts/pm/check-governed-merges.mjs');
  t('the governed-merge gate reaches the published skills catalog it declares', governedHints.some((h) => hintCovers(h, 'skills/objectstack-upgrade/SKILL.md')));

  // The card this landed for: the ONLY fragment coverage in the repo, which
  // scored `silent` for every content card while being REQUIRED in lint.yml.
  const anchorHints = extractWatchHints(readFileSync(nodePath.join(ROOT, 'scripts/check-doc-anchors.mjs'), 'utf8'), 'scripts/check-doc-anchors.mjs');
  t('the doc-anchors gate reaches the content page population it declares', anchorHints.some((h) => hintCovers(h, 'content/docs/deployment/cli.mdx')));
  t('and does not thereby claim a path outside that population', !anchorHints.some((h) => hintCovers(h, 'packages/spec/src/index.ts')));

  // The sixth instance of the class (#10648), and the worst-shaped one: three
  // of check-doc-authoring's four roots were bare words (`.claude` survived on
  // the dotted-dir arm alone), while its SKIP_PATHS carried separators and were
  // taken. Five of the six paths it declared were therefore EXCLUSIONS, and 383
  // of its 389 walked files were declared by nothing. The failure printed as a
  // populated `names:` column, which reads as "declared, just not relevant to
  // you" rather than as a blind spot — the reason it survived five same-class
  // fixes without being noticed.
  const docAuthoringHints = extractWatchHints(readFileSync(nodePath.join(ROOT, 'scripts/check-doc-authoring.mjs'), 'utf8'), 'scripts/check-doc-authoring.mjs');
  // One case per declared root, because a single one passes for a declaration
  // that dropped the other three — which is the exact shape being fixed. Each
  // path is reachable ONLY through its root's subtree spelling, never through a
  // SKIP_PATHS literal.
  t('the doc-authoring gate reaches the live docs corpus it declares', docAuthoringHints.some((h) => hintCovers(h, 'docs/qa/platform-checklist/RUNNER.md')));
  t('and the top-level docs guides, which are files rather than a subtree', docAuthoringHints.some((h) => hintCovers(h, 'docs/protocol-upgrade-guide.md')));
  // ⚠️ This one case does NOT pin the declaration, and says so rather than
  // reading as though it does: `.claude` is a top-level DOTTED dir, which
  // `looksPathy` admits and `hintCovers` does not refuse, so the bare ROOTS
  // entry reaches this path on its own. Measured — deleting `.claude/**` from
  // the gate leaves this case green, exactly the way check-nul-bytes survives
  // the ablation above. What it pins is that `.claude` stays reachable AT ALL;
  // the declaration itself is pinned in the gate's own self-test, which
  // requires a subtree spelling for every separator-less ROOT.
  t('and the agent operating manual it took in for the same reason', docAuthoringHints.some((h) => hintCovers(h, '.claude/agents/os-dev.md')));
  t('and the published skills catalog', docAuthoringHints.some((h) => hintCovers(h, 'skills/objectstack-upgrade/SKILL.md')));
  t('and the content tree', docAuthoringHints.some((h) => hintCovers(h, 'content/docs/deployment/cli.mdx')));
  // Rule 3's root, added when the gate took in the spec's customer-facing zod
  // refusal messages. It is NOT one of ROOTS — the Markdown rules never walk it
  // — so the gate's own self-test (which derives its declaration from ROOTS)
  // cannot pin it and this case is the only place that does.
  t('and the spec refusal-message population Rule 3 walks', docAuthoringHints.some((h) => hintCovers(h, 'packages/spec/src/ui/action.zod.ts')));
  // #13297 widened Rule 3's root: the cross-package prose-id leg walks every
  // sibling package's non-test sources against a pinned baseline, so the gate
  // now genuinely reads any package edit and declares `packages/**`. The
  // narrow claim these cases used to pin ("spec/src and nothing else under
  // packages/") is the boundary the #13179 deferral drew, and the deferral's
  // own codified revival condition retired it — a sibling package source is
  // now POSITIVE coverage, not an over-claim.
  t('and the sibling-package prose population the ledgered leg walks', docAuthoringHints.some((h) => hintCovers(h, 'packages/runtime/src/index.ts')));
  // The residual over-claim is bounded and known: `packages/**` subsumes
  // spec's non-src files and every test file, which the leg's own walk skips
  // (spec belongs to the position-based rule; test bodies are out). That is
  // the tolerated carve-out-inside-a-walked-root case — the same shape as
  // check:slot-lookup-ratchet declaring the whole of `packages/**` — pinned
  // here so it stays a recorded residual rather than an accident.
  t('spec outside its source tree rides the bounded packages/** over-claim', docAuthoringHints.some((h) => hintCovers(h, 'packages/spec/package.json')));
  // The negative half that SURVIVES the widening, still load-bearing: a gate
  // named on EVERY card is the louder version of naming none, and the leg
  // walks packages/ only — never apps/ or examples/.
  t('and claims nothing under apps/', !docAuthoringHints.some((h) => hintCovers(h, 'apps/console/src/main.tsx')));
  t('nor under examples/', !docAuthoringHints.some((h) => hintCovers(h, 'examples/crm/objects/account.object.ts')));

  // The second gate of that class (#9700): a whole-tree ESLint ratchet whose
  // only literals were its own baseline artifact and the ref it diffs against,
  // so it scored `silent` for every card in the tree while being REQUIRED in
  // lint.yml — twice at the cost of a p0's CI round (#9391, PR #9695). It now
  // declares the subtree it lints. Read from the real gate, not a fixture: what
  // is being pinned is that the tree still HAS the declaration.
  const slotHints = extractWatchHints(readFileSync(nodePath.join(ROOT, 'scripts/check-slot-lookup-ratchet.mjs'), 'utf8'), 'scripts/check-slot-lookup-ratchet.mjs');
  t('the slot-lookup ratchet reaches the package source population it declares', slotHints.some((h) => hintCovers(h, 'packages/services/service-datasource/src/admin-routes.ts')));
  // The negative half is the load-bearing one for a declaration this broad: a
  // gate named on EVERY card is the louder version of naming none. `packages/**`
  // must reach nothing outside `packages/`, and these three roots are where a
  // widened extractor would have leaked it (measured in hintCovers' docblock:
  // the rejected alternative takes one card from 7 matched families to 34).
  t('and claims nothing under apps/', !slotHints.some((h) => hintCovers(h, 'apps/console/src/main.tsx')));
  t('nor under examples/', !slotHints.some((h) => hintCovers(h, 'examples/crm/objects/account.object.ts')));
  t('nor a content page', !slotHints.some((h) => hintCovers(h, 'content/docs/deployment/cli.mdx')));

  // The third gate of that class (#9964), and the one nothing above could
  // reach: the pm line ratchet's population includes the repo-ROOT AGENTS.md,
  // and a root file carries no separator for `looksPathy` to find — so its
  // eighteen ceilings produced seventeen hints and an AGENTS.md card derived
  // zero gates, on the largest ceiling in that map at headroom 0. It declares
  // the subtree spelling instead. Read from the real gate, not a fixture: what
  // is pinned is that the tree still HAS the declaration.
  const lineRatchetHints = extractWatchHints(readFileSync(nodePath.join(ROOT, 'scripts/pm/check-skill-line-ratchet.mjs'), 'utf8'), 'scripts/pm/check-skill-line-ratchet.mjs');
  t('the pm line ratchet reaches the repo-root instruction file it declares', lineRatchetHints.some((h) => hintCovers(h, 'AGENTS.md')));
  // The negative half, and the reason this is a DECLARATION rather than an
  // extractor change. Widening the extractor to admit bare top-level `*.md`
  // literals was measured on the same corpus as the refusal above — 114
  // families x 6326 tracked files — and costs only 17 pairs, but 8 of them are
  // fabricated: gates spell `README.md` and `CHANGELOG.md` as basenames they
  // join with a package directory, so a README.md card gains six leads of which
  // five name a gate that never reads it. The class stays refused; these pin
  // that this declaration bought no part of it.
  t('and claims no other repo-root file', !lineRatchetHints.some((h) => hintCovers(h, 'README.md')));
  t('nor a same-named file inside a directory', !lineRatchetHints.some((h) => hintCovers(h, 'examples/AGENTS.md')));
  t('a bare top-level file literal is still no hint at all', extractWatchHints("const F = 'README.md';").length === 0);

  // The rest of that class (#9979). The ratchet above was one of SIX families
  // whose population genuinely includes a repo-root instruction file; the other
  // five were measured still invisible, so an AGENTS.md card derived ONE gate
  // out of six and a README.md / ARCHITECTURE.md card derived NONE at all —
  // while `check:doc-anchors` is REQUIRED in lint.yml and is this repo's only
  // fragment coverage. Each declares the subtree spelling in its own source.
  //
  // Read from the real gates, not fixtures: what is pinned is that the tree
  // still HAS the declarations. If one of these gates stops reading its root
  // file, delete its case with the declaration — never keep a case green by
  // re-pointing it at a gate that never read the file.
  const rootFileDeclarations = [
    ['the pm skill-id lint', 'scripts/pm/check-skill-id-lint.mjs', 'AGENTS.md'],
    ['the governed-merge register', 'scripts/pm/check-governed-merges.mjs', 'AGENTS.md'],
    ['the governed-merge register (CLAUDE.md half)', 'scripts/pm/check-governed-merges.mjs', 'CLAUDE.md'],
    ['the governed-prose gate', 'scripts/pm/check-governed-prose.mjs', 'AGENTS.md'],
    ['the docs-audit scope gate', 'scripts/docs-audit/check-audit-scope.mjs', 'AGENTS.md'],
    ['the required-context pin', 'scripts/check-required-contexts.mjs', 'AGENTS.md'],
    ['the doc-anchors gate', 'scripts/check-doc-anchors.mjs', 'README.md'],
    ['the doc-anchors gate (ARCHITECTURE.md half)', 'scripts/check-doc-anchors.mjs', 'ARCHITECTURE.md'],
  ];
  for (const [what, gate, rootFile] of rootFileDeclarations) {
    const gateHints = extractWatchHints(readFileSync(nodePath.join(ROOT, gate), 'utf8'), gate);
    t(`${what} reaches the repo-root file it declares (${rootFile})`, gateHints.some((h) => hintCovers(h, rootFile)));
    // The negative half, and the reason each of these is a DECLARATION rather
    // than an extractor change: a declaration must buy its own file and NOT the
    // bare-`*.md` class the extractor still refuses. `examples/AGENTS.md` is
    // the live specimen — a real tracked file, same basename, not read by any
    // of these gates (check-governed-merges' own near-miss case names it).
    t(`${what} claims no same-named file inside a directory`, !gateHints.some((h) => hintCovers(h, `examples/${rootFile}`)));
  }
  // …and the root files stay separated from each other: the governed-merge
  // register is the only one of the six that declares two, and nothing here may
  // reach a root file its gate does not read.
  const proseHints = extractWatchHints(readFileSync(nodePath.join(ROOT, 'scripts/pm/check-governed-prose.mjs'), 'utf8'), 'scripts/pm/check-governed-prose.mjs');
  t('a one-root declaration does not reach the other root file', !proseHints.some((h) => hintCovers(h, 'CLAUDE.md')));
  const anchorRootHints = extractWatchHints(readFileSync(nodePath.join(ROOT, 'scripts/check-doc-anchors.mjs'), 'utf8'), 'scripts/check-doc-anchors.mjs');
  t('and the doc-anchors pair claims neither instruction file', !anchorRootHints.some((h) => hintCovers(h, 'AGENTS.md') || hintCovers(h, 'CLAUDE.md')));

  // A THIRD shape of the same class, and the one with the worst failure
  // direction (#13207): a gate whose declared population was its OWN GUARDED
  // ARTIFACT. `check:llms-txt` re-derives the claims of `packages/spec/llms.txt`
  // against trees elsewhere — the `*.zod.ts` counts under `packages/spec/src`,
  // the `api-surface/` shards, the manifest `exports` keys, and the non-private
  // `@objectstack/*` workspace set — but reached every one of them through
  // `join(PKG, ...)`, so the only literal it spelled was `llms.txt` itself.
  //
  // The derivation could therefore name the gate only AFTER the artifact had
  // been edited, while the edits that FALSIFY it land in those other trees.
  // Measured on PR #13186 across two rounds of one branch: deleting a `src/`
  // schema module moved `src/kernel/` 32 -> 31 and the summed total 208 -> 207,
  // the derived family did not contain the gate, and the red reached CI. That
  // is UNDER-matching — silent, and invisible in the tool's own output, where an
  // omitted gate looks exactly like a gate that does not apply.
  //
  // Read from the real gate, not a fixture: what is pinned is that the tree
  // still HAS the declaration. If this gate stops reading one of these trees,
  // delete the case together with the literal — never keep it green by
  // re-pointing it at a tree the gate never reads.
  const llmsHints = extractWatchHints(
    readFileSync(nodePath.join(ROOT, 'packages/spec/scripts/check-llms-txt.ts'), 'utf8'),
    'packages/spec/scripts/check-llms-txt.ts',
  );
  const llmsReaches = (f) => llmsHints.some((h) => hintCovers(h, f));
  // The reproduction, as a case: the falsifying edit alone names the gate.
  t('check:llms-txt reaches the schema tree its counts are derived from', llmsReaches('packages/spec/src/kernel/cluster.zod.ts'));
  // …and by a route that is NOT the artifact hint. This is the reproduction
  // itself: before this declaration the only hint covering anything was
  // `packages/spec/llms.txt`, so a src-only diff derived nothing.
  t('and by a route that is not the guarded artifact — the #13207 reproduction', llmsHints.some((h) => h !== 'packages/spec/llms.txt' && hintCovers(h, 'packages/spec/src/kernel/cluster.zod.ts')));
  t('it still reaches the artifact it guards', llmsReaches('packages/spec/llms.txt'));
  t('it reaches the api-surface shards every NAMED claim resolves against', llmsReaches('packages/spec/api-surface/data.json'));
  t('it reaches the manifest whose exports keys the SUBPATH claims resolve against', llmsReaches('packages/spec/package.json'));
  t('it reaches the repo-root workspace file it opens', llmsReaches('pnpm-workspace.yaml'));
  t('and the workspace manifests whose set is the package-ecosystem denominator', llmsReaches('packages/drivers/driver-mongodb/package.json'));
  // The negative half, and the load-bearing one. A population this broad is
  // one respelling away from the "22 leads is the same as none" failure the
  // header prices: `packages/spec` or `packages/**` would have bought the flip
  // too, and named this gate on nearly every card in the repo. These pin that
  // it bought the four trees it reads and NOTHING else — including the sibling
  // directories inside its own package.
  t('but claims no other file in its own package', !llmsReaches('packages/spec/docs/anything.md'));
  t('nor a sibling package source', !llmsReaches('packages/rest/src/analytics-dataset-dimension-gate.test.ts'));
  t('nor a content page', !llmsReaches('content/docs/deployment/cli.mdx'));
  t('nor an app source', !llmsReaches('apps/docs/components/ui/card.tsx'));
  t('nor an example', !llmsReaches('examples/app-crm/src/objects/lead.object.ts'));
  // A workspace manifest is reached; a workspace SOURCE file is not. This is
  // the pair that separates `packages/**\/package.json` from `packages/**`.
  t('and a package manifest is reached where its source is not', llmsReaches('packages/qa/dogfood/package.json') && !llmsReaches('packages/qa/dogfood/test/two-factor-lockout.dogfood.test.ts'));

  // The DIRECTORY half of the same class (#10107). A gate whose population is a
  // top-level DIRECTORY spelled as a bare word is invisible for the same reason
  // a root file is — `looksPathy` finds no separator, so the extractor builds no
  // hint at all — and it is the more expensive half, because the word names a
  // whole subtree rather than one file. `check:role-word` walks
  // `['content/docs', 'skills']`: the first is a hint, the second was nothing,
  // so a skills-only card derived the content half and scored this gate
  // `silent`. PR #10038 paid for it — a green local union, then
  // `role-word count grew 2 → 3` in CI. It declares the subtree spelling now.
  //
  // Read from the real gate, not a fixture: what is pinned is that the tree
  // still HAS the declaration. If this gate stops walking that root, delete the
  // declaration and these cases together — never keep them green by re-pointing
  // at a gate that never read it.
  const roleWordHints = extractWatchHints(readFileSync(nodePath.join(ROOT, 'scripts/check-role-word.mjs'), 'utf8'), 'scripts/check-role-word.mjs');
  t('the role-word ratchet reaches the published skills catalog it declares', roleWordHints.some((h) => hintCovers(h, 'skills/objectstack-platform/SKILL.md')));
  t('and still reaches the content half it always named', roleWordHints.some((h) => hintCovers(h, 'content/docs/deployment/cli.mdx')));
  // The negative halves, and the reason this is a DECLARATION and not an
  // extractor change. `.claude/skills/` is the live specimen: a real tracked
  // tree whose last segment IS the declared root, which this gate does not walk
  // — a widened extractor accepting the bare word `skills` would not tell them
  // apart, and the collapsed subtree does.
  t('and claims nothing under the internal .claude skills tree it never walks', !roleWordHints.some((h) => hintCovers(h, '.claude/skills/pm-dispatch/SKILL.md')));
  t('nor a package source file', !roleWordHints.some((h) => hintCovers(h, 'packages/spec/src/index.ts')));
  // CONSTRUCTED path, deliberately: `content/docs.site.json` was a live file
  // until it was deleted as dead config (#12489), and `content/` now holds only
  // the two collection directories, so the tree offers no sibling beside the
  // content root to name. The probe stays spelled against the `content/docs`
  // hint anyway — that hint is the one with bite here, and re-pointing at a
  // path some far-away gate names would keep this green while testing nothing.
  t('nor a sibling FILE beside the content root', !roleWordHints.some((h) => hintCovers(h, 'content/docs.site.json')));
  // The pair that makes the declaration worth having: the bare word this gate
  // actually spells in its ROOTS array stays refused, so the coverage above is
  // bought by the declaration and by nothing else.
  t('the bare root word the gate spells in ROOTS is still refused as too generic', !hintCovers('skills', 'skills/objectstack-platform/SKILL.md'));
  t('while the declared subtree covers that same path', hintCovers('skills/**', 'skills/objectstack-platform/SKILL.md'));

  // The seventh instance of the same directory class (#10664), in a
  // PACKAGE-scoped gate — `pnpm --filter @objectstack/lint run
  // check:doc-formula-expressions`, REQUIRED in lint.yml — so the source this
  // reads is resolved through that package's manifest rather than the root one.
  //
  // Its ROOTS were `['.claude', 'docs', 'skills', 'content']`, three bare words
  // and one dotted dir, while its SKIP_PATHS spelled five exclusions WITH
  // separators. Measured on this tree: of the 1388 files it walks, 396 (28.5%)
  // were declared by nothing — every file under `docs` (156), `skills` (48) and
  // `content` (192). Inside the `docs` root the shape was inverted rather than
  // merely absent: `docs/plans/` derived the gate (an exclusion, via its own
  // SKIP_PATHS literal) while `docs/qa/` derived nothing.
  //
  // Read from the real gate, not a fixture: what is pinned is that the tree
  // still HAS the declaration.
  const docFormulaHints = extractWatchHints(readFileSync(nodePath.join(ROOT, 'packages/lint/scripts/check-doc-formula-expressions.mjs'), 'utf8'), 'packages/lint/scripts/check-doc-formula-expressions.mjs');
  // One case per declared root, because a single one passes for a declaration
  // that dropped the other two. Each path is reachable ONLY through its root's
  // subtree spelling, never through a SKIP_PATHS literal.
  t('the doc-formula gate reaches the live docs corpus it declares', docFormulaHints.some((h) => hintCovers(h, 'docs/qa/platform-checklist/RUNNER.md')));
  t('and the published skills catalog', docFormulaHints.some((h) => hintCovers(h, 'skills/objectstack-upgrade/SKILL.md')));
  t('and the content tree', docFormulaHints.some((h) => hintCovers(h, 'content/docs/deployment/cli.mdx')));
  // ⚠️ These two do NOT pin the declaration, and say so rather than reading as
  // though they do. `.claude` is a top-level DOTTED dir, which `looksPathy`
  // admits and `hintCovers` does not refuse; `packages/spec/src` (the gate's
  // SPEC_ROOT, its second surface — 972 files) already carries a separator.
  // Both reach their paths on the bare literal alone — measured: deleting the
  // declaration outright leaves both green. What they pin is that those two
  // surfaces stay reachable AT ALL; the declaration itself is pinned in the
  // gate's own self-test, which requires a subtree spelling for every
  // separator-less ROOT and a separator in SPEC_ROOT.
  t('and the agent operating manual it walks for the same reason', docFormulaHints.some((h) => hintCovers(h, '.claude/agents/os-dev.md')));
  t('and its second surface, the spec TSDoc population', docFormulaHints.some((h) => hintCovers(h, 'packages/spec/src/index.ts')));
  // The negative half, load-bearing for a declaration spanning four roots: a
  // gate named on EVERY card is the louder version of naming none. `packages/`
  // must be probed OUTSIDE `packages/spec/src`, which the gate really does read
  // — a case using a spec path would pass on SPEC_ROOT and pin nothing.
  t('and claims nothing elsewhere under packages/', !docFormulaHints.some((h) => hintCovers(h, 'packages/core/src/index.ts')));
  t('nor under apps/', !docFormulaHints.some((h) => hintCovers(h, 'apps/console/src/main.tsx')));
  t('nor under examples/', !docFormulaHints.some((h) => hintCovers(h, 'examples/crm/objects/account.object.ts')));
  // The bounded residual, whose PROVENANCE moved under #15753. `hintCovers`
  // cannot subtract, so `docs/**` necessarily claims the exempt `docs/plans`.
  // That subtree used to derive the gate a SECOND way as well, through the
  // `SKIP_PATHS` literal that names it — and a skip list is not a watch
  // surface, so the extractor no longer reads it. The over-claim is the
  // declaration's alone now, which is the honest reading rather than a
  // narrower one: a root claiming a subtree carved out of it, stated here.
  // Asserted with the declaration removed from the hint set, which is what makes
  // it a measurement instead of a restatement.
  const withoutDeclaration = docFormulaHints.filter((h) => !['docs/**', 'skills/**', 'content/**', '.claude/**'].includes(h));
  t('the exempt subtree no longer derives the gate through the skip list that names it — an exclusion is not a watch surface (#15753)', !withoutDeclaration.some((h) => hintCovers(h, 'docs/plans/x.md')));
  t('while the declaration still reaches it, so the over-claim is bounded and STATED rather than quietly doubled', docFormulaHints.some((h) => hintCovers(h, 'docs/plans/x.md')));
  t('while the live corpus derived nothing without it — the gap this closes', !withoutDeclaration.some((h) => hintCovers(h, 'docs/qa/platform-checklist/RUNNER.md')));
  // The pair that makes the declaration worth having: the bare words this gate
  // spells in its ROOTS array stay refused, so the coverage above is bought by
  // the declaration and by nothing else.
  t('the bare root words the gate spells in ROOTS are still refused as too generic', !hintCovers('docs', 'docs/qa/platform-checklist/RUNNER.md') && !hintCovers('content', 'content/docs/deployment/cli.mdx'));
  t('while the declared subtrees cover those same paths', hintCovers('docs/**', 'docs/qa/platform-checklist/RUNNER.md') && hintCovers('content/**', 'content/docs/deployment/cli.mdx'));

  // ── The escapable-literal ledger (#10705) ────────────────────────────────
  //
  // Every case above pins ONE gate that took the escape. What none of them can
  // say is who still has not — and that is the whole finding: six instances
  // were found one at a time, on six unrelated cards, the sixth a re-discovery
  // of the fourth by an agent who did not know the enumeration existed. These
  // cases turn that into a bounded list with a verdict.
  //
  // The predicate is pinned on FIXTURES first, because a tree-only assertion
  // cannot show which of its conditions is doing the work; the live halves
  // follow.
  const fx = (hints) => [['check:fixture', { hints }]];
  const fxPrefixes = new Set(['scripts', 'scripts/pm', 'examples', 'skills']);
  t(
    'a bare root literal the tree HAS, undeclared, is a ledger row',
    escapableLiteralRows(fx(['scripts']), fxPrefixes).length === 1,
  );
  t(
    'the same literal beside its subtree spelling is NOT — that gate escaped',
    escapableLiteralRows(fx(['scripts', 'scripts/**']), fxPrefixes).length === 0,
  );
  // The live distinction `check:published-files` forced: a hint that reaches
  // INTO the root covers the bare directory through hintCovers' reverse
  // containment, while covering no other file under it. If this case ever goes
  // green the ledger has started retiring rows for gates that are still
  // unnameable.
  t(
    'a hint that merely reaches into the root does not escape it',
    escapableLiteralRows(fx(['scripts', 'scripts/check-x.mjs']), fxPrefixes).length === 1,
  );
  t(
    'a literal the covering rule never refused is no part of the species',
    escapableLiteralRows(fx(['scripts/pm']), fxPrefixes).length === 0,
  );
  t(
    'nor is a dotted root, which hintCovers admits as written',
    escapableLiteralRows(fx(['.claude']), new Set(['.claude'])).length === 0,
  );
  // The other species the residue block names, kept out by exactly the test
  // `unreachableReason` uses to tell them apart: no declaration can fix a
  // literal the tree does not have, so it is not a debt anyone can pay.
  t(
    'a bare word the tree does NOT have is the genuinely-dead species, not this one',
    escapableLiteralRows(fx(['node_modules']), fxPrefixes).length === 0,
  );

  // The live halves, over the real tree and through the SAME discovery pass
  // `derive` runs — a second pass built here could enumerate a population no
  // dispatch prompt is derived from.
  const ledgerSwept = trackedFiles();
  const ledgerPrefixes = trackedPrefixes(ledgerSwept);
  const ledgerFamilies = [...discoverFamilies().byCheck];
  const ledgerRows = escapableLiteralRows(ledgerFamilies, ledgerPrefixes);
  const ledgerKeys = ledgerRows.map(escapableLiteralKey);
  // #4690 at ZERO ROWS: a quiet sweep must still prove it can SPEAK.
  //
  // This guard used to be `ledgerRows.length > 0` — a live-tree count, which
  // read the right rule off the wrong quantity. It conflated two separable
  // claims: "the recognizer still works" and "the tree still owes a row".
  // While a debt existed the two moved together, so the conflation was
  // invisible; paying the LAST row (#10875) is what pulled them apart, and the
  // guard then failed on a clean tree — a shrink-only ledger that could not be
  // allowed to reach zero, which is the one end state it exists to reach.
  //
  // So the recognizer is asked directly instead: splice ONE synthetic family
  // spelling a bare root into the LIVE corpus and require the sweep to find
  // exactly it, and exactly one more row than the tree really owes. That holds
  // at zero live rows and at any other count, it fails loudly if the recognizer
  // or the prefix set goes dead, and unlike the fixture cases above it runs on
  // the live prefixes the real sweep runs on.
  const probeKey = 'check:escapable-literal-probe';
  const probedRows = escapableLiteralRows([...ledgerFamilies, [probeKey, { hints: ['scripts'] }]], ledgerPrefixes);
  const probedKeys = probedRows.map(escapableLiteralKey);
  t(
    'the live sweep still RECOGNISES this species — a probe family spelling a bare root is found,' +
      ' so a quiet sweep means a clean tree rather than a broken recognizer (#4690)',
    probedKeys.filter((k) => k === `${probeKey} scripts`).length === 1 &&
      probedRows.length === ledgerRows.length + 1,
  );
  const freshRows = ledgerKeys.filter((k) => !ESCAPABLE_LITERAL_LEDGER.has(k));
  const staleRows = [...ESCAPABLE_LITERAL_LEDGER].filter((k) => !ledgerKeys.includes(k)).sort();
  t(
    'no gate has NEWLY joined the escapable-literal species' +
      (freshRows.length
        ? ` — FRESH: ${freshRows.join(' · ')}. Unnameable by any dispatch derivation as spelled,` +
          ' so it lands already invisible. TWO remedies, and which one is right depends on what the' +
          ' gate actually READS — pick, do not reach for the first one:' +
          ' (a) it really does walk that repo root ⇒ declare the subtree spelling beside the literal,' +
          ' the ROOT_DIR_WATCH_HINTS idiom (see check-role-word.mjs and check-examples-live-imports.mjs);' +
          ' (b) it does NOT ⇒ stop spelling a bare root, respelling the literal to say what the predicate' +
          ' means (check-published-files.mjs is the worked instance: its predicate is package-relative,' +
          ' over tarball contents, so it took (b) and the row discharged by construction).' +
          ' ⛔ Declaring a root the gate does not read is a FABRICATED lead — worse than the row,' +
          ' at the price hintCovers puts on one. ⛔ The ledger is SHRINK-ONLY: a new line is not a remedy.'
        : ''),
    freshRows.length === 0,
  );
  t(
    'and no ledger row is stale' +
      (staleRows.length
        ? ` — STALE: ${staleRows.join(' · ')}. Good news, and the list must say so:` +
          ' delete each one from ESCAPABLE_LITERAL_LEDGER. A stale line is how this would start' +
          ' drifting into an allowlist nobody re-reads.'
        : ''),
    staleRows.length === 0,
  );
  // The spelling rule the ledger's docblock states, held mechanically rather
  // than remembered: a row keyed by a direct script path would enter THIS
  // file's own hint set as a path it does not read.
  //
  // Carried on a WITNESS PAIR rather than on the ledger alone. The ledger is
  // empty now, and `[].every(...)` is a pass that proves nothing — precisely
  // the vacuous shape #10784's ablation caught one case over, where a fixture
  // with no subtree hint to strip compared silent to silent and read green. The
  // sample row keeps the positive half exercised at zero rows; the negative
  // witness is what gives the case teeth at all, since the live key format
  // (\`${check} ${hint}\`) always carries a space and the extractor refuses a
  // span with one — so a key in that format cannot build a hint whatever it
  // names, and only the bare-path spelling the docblock warns against can.
  const asHints = (row) => extractWatchHints(`const L = ${JSON.stringify(row)};`);
  t(
    'no ledger row enters this file\'s own declared population as a path',
    [...ESCAPABLE_LITERAL_LEDGER, 'check:sample-gate someroot'].every((row) => asHints(row).length === 0),
  );
  t(
    '…and that rule can FAIL: the direct-script spelling it forbids does build a hint',
    asHints('scripts/check-x.mjs').length === 1,
  );
  // The ledger describes the derivation, so it must agree with what the
  // derivation actually reports: every row must name a root the tree HAS and
  // the covering rule refuses — the pair that puts a row in this species rather
  // than in the dead one beside it in the residue block. Asserted over whatever
  // the ledger holds, never over a remembered count of it.
  //
  // Run over the PROBED rows, which are the live rows plus the one synthetic
  // row spliced in above. Two things fall out of that and both are wanted: the
  // property is still checked on every real row, and the case can never go
  // vacuous now that the live half is legitimately empty — the probe row is a
  // row of exactly this species, so `.every` always has something to judge.
  t(
    'every ledger row names a root the tree HAS and the covering rule refuses',
    probedRows.length > 0 &&
      probedRows.every(
        ({ hint, plain }) =>
          // refused: the gate cannot be named for anything under the root
          !hintCovers(hint, `${plain}/any-file-under-it.mjs`) &&
          // …and the root is really there, which is what separates this species
          // from the dead literals beside it in the residue block
          ledgerPrefixes.has(plain) &&
          deepestTrackedPrefix(hint, ledgerPrefixes) === plain,
      ),
  );

  // ── The scripts/** blind spot, closed at the source (#10784) ──────────────
  //
  // BOTH gates that walk `scripts/` were invisible to this derivation, by two
  // opposite routes: `check:parse-guard` declared a bare root the covering rule
  // refuses as too generic, and `check:entry-guard` declared its baseline
  // ROSTER — the files that already violate its import-safety half — so a newly
  // added script could never be in the declared population, BY CONSTRUCTION.
  // Anyone adding a script got neither gate named, and one CI round was paid.
  //
  // Pinned against the LIVE tree through the same discovery pass `derive` runs:
  // a hand-built fixture here could pass while the real gates stayed
  // unnameable, which is the exact failure this case exists to prevent from
  // recurring. The probe path deliberately does not exist — "a file nobody has
  // written yet" is the one input a roster of current members can never contain.
  const scriptsFamilies = discoverFamilies().byCheck;
  const unwrittenScript = 'scripts/the-one-nobody-has-written-yet.mjs';
  for (const gate of ['check:entry-guard', 'check:parse-guard']) {
    const entry = scriptsFamilies.get(gate);
    t(`${gate} is discovered at all — the pin below means nothing without this`, Boolean(entry));
    const verdict = entry ? classifyEntry(entry, [unwrittenScript]) : null;
    t(
      `${gate} is MATCHED for a brand-new scripts/ file, not silent and not unreachable`,
      verdict?.verdict === 'matched',
      JSON.stringify({ verdict: verdict?.verdict, hints: entry?.hints }),
    );
    // The ablation, run in-place: strip the declared SUBTREE from the live hint
    // set and the verdict must fall back to NOT MATCHED — that is the whole
    // claim, since a brand-new file is nameable only through the subtree half.
    // Without it the case above could pass through any hint that happened to
    // cover the probe, and the reader could not tell which half was load-bearing.
    //
    // WHICH not-matched verdict it lands on is not fixed, and pinning one
    // spelling was a latent trap: for `check:entry-guard` the residual depends
    // on whether its KNOWN_IMPORT_UNSAFE roster still contributes path literals
    // as hints — `silent` while it held entries, `undetermined` once it emptied
    // and the stripped hint set is bare. That ledger is ⛔ SHRINK-ONLY and
    // reaching zero is its GOAL, so the day it emptied this case went red over
    // a gate that had not changed at all. Either verdict proves the subtree
    // hint is the load-bearing half, so both are accepted — spelled as an
    // explicit pair rather than `!== 'matched'`, so a NEW verdict value added
    // later cannot slip through here as a pass.
    const undeclared = entry ? { ...entry, hints: entry.hints.filter((h) => !h.includes('/*')) } : null;
    const residual = undeclared ? classifyEntry(undeclared, [unwrittenScript]).verdict : null;
    t(
      `…and it is the subtree declaration doing it: strip it and ${gate} goes back to NOT MATCHED`,
      // The length check is what stops this passing VACUOUSLY. With no subtree
      // hint to remove, `undeclared` is the entry itself and a not-matched
      // verdict compared against itself reads as a pass — measured, on the
      // ablation run that removed both declarations: this case stayed green
      // while the two above went red.
      Boolean(undeclared) &&
        undeclared.hints.length < entry.hints.length &&
        ['silent', 'undetermined'].includes(residual),
      JSON.stringify({ before: entry?.hints?.length, after: undeclared?.hints?.length, residual }),
    );
  }

  // ── The MANIFEST population of check:merge-driver (#15501) ────────────────
  //
  // That family's `git-merge-regen --self-test` refuses a generator with no
  // recorded merge disposition, and the population that refusal sweeps is the
  // MANIFESTS — the root one plus every workspace member's, read for their
  // `gen:` / `check:` rows. What the family declared HERE was the artifact
  // paths `scripts/regen-artifacts.mjs` carries, imported one level down: the
  // generators ALREADY routed. So the one class of card the refusal exists to
  // catch — a card that ADDS a generator, touching a manifest and a new
  // `scripts/*.mjs` — was the one class this derivation could not name, and the
  // gate fired a cycle late, in CI, on every card of that shape. Measured
  // before the repair, on a `package.json` change set: zero lines naming it.
  //
  // Pinned against the LIVE tree through the same discovery pass `derive` runs,
  // for the reason the scripts/** case above states: a hand-built fixture could
  // pass here while the real family stayed unnameable, which is the exact
  // failure these cases exist to stop recurring.
  const mdFamilies = discoverFamilies().byCheck;
  const MERGE_DRIVER = 'check:merge-driver';
  const mdEntry = mdFamilies.get(MERGE_DRIVER);
  t(`${MERGE_DRIVER} is discovered at all — the pins below mean nothing without this`, Boolean(mdEntry));
  // The declared halves, stripped for the ablation below. Spelled as a
  // PREDICATE over the live hint set rather than as a copy of the declaration,
  // so a hint respelled in `git-merge-regen.mjs` cannot leave a stale twin here
  // that keeps the ablation passing.
  const isManifestHint = (h) => h === 'package.json/**' || h.endsWith('/package.json');
  const mdStripped = mdEntry ? { ...mdEntry, hints: (mdEntry.hints ?? []).filter((h) => !isManifestHint(h)) } : null;
  // The POSITIVE direction, one probe per declared half. The table is pinned to
  // its own length first (#13799's floor recipe): a loop over an emptied table
  // runs zero cases and prints nothing, which reads exactly like a pass.
  const MD_MANIFEST_PROBES = [
    ['the ROOT manifest, where the measured CI red added its `gen:` row', 'package.json'],
    ['a workspace MEMBER manifest', 'packages/plugins/plugin-auth/package.json'],
  ];
  t('the manifest probe table still has both declared halves in it', MD_MANIFEST_PROBES.length === 2);
  for (const [why, probe] of MD_MANIFEST_PROBES) {
    const verdict = mdEntry ? classifyEntry(mdEntry, [probe]).verdict : null;
    // The reading rides in the case NAME, never in a third argument: `t` takes
    // two, so a detail passed beyond them is dropped on the floor — and a
    // failing case whose reading went with it is a case nobody can act on.
    t(
      `a change set touching ${why} derives ${MERGE_DRIVER} — ${probe} => ${verdict}`,
      verdict === 'matched',
    );
    // …and it is the manifest declaration doing it. Without this half the case
    // above could pass through any hint that happens to cover the probe —
    // `packages/spec/package.json`, for one, was already reachable through the
    // `packages/spec` literal, so a probe chosen there would have proved
    // nothing at all. Both not-matched verdicts are accepted, spelled as an
    // explicit pair so a NEW verdict value added later cannot slip through as
    // a pass — the same reasoning as the scripts/** ablation above.
    const residual = mdStripped ? classifyEntry(mdStripped, [probe]).verdict : null;
    t(
      `…and it is the manifest declaration doing it: strip it and ${probe} goes back to NOT MATCHED`
        + ` (hints ${mdEntry?.hints?.length} -> ${mdStripped?.hints?.length}, residual ${residual})`,
      // The length comparison is what stops this passing VACUOUSLY: with no
      // manifest hint to remove, `mdStripped` is the entry itself and a
      // not-matched verdict compared against itself reads as a pass.
      Boolean(mdStripped) &&
        mdStripped.hints.length < (mdEntry.hints ?? []).length &&
        ['silent', 'undetermined'].includes(residual),
    );
  }
  // The NEGATIVE direction, and it is what keeps the declaration from being a
  // whole-tree widening in disguise: an unrelated script is not newly derived.
  // Stated as "the declaration moved NOTHING for it" rather than as a bare
  // not-matched verdict — the manifest hints are the only thing that changed,
  // so the two verdicts agreeing is the claim, and it stays true whatever the
  // rest of the family's population does later.
  const mdUnrelated = 'scripts/the-one-nobody-has-written-yet.mjs';
  const mdUnrelatedVerdict = mdEntry ? classifyEntry(mdEntry, [mdUnrelated]).verdict : null;
  t(
    `an unrelated brand-new scripts/*.mjs is NOT derived to ${MERGE_DRIVER} (${mdUnrelatedVerdict})`,
    ['silent', 'undetermined'].includes(mdUnrelatedVerdict),
  );
  t(
    'and the manifest declaration is what moved nothing for it — the same verdict with and without',
    mdUnrelatedVerdict === (mdStripped ? classifyEntry(mdStripped, [mdUnrelated]).verdict : null),
  );

  // ── The bare root this gate must NOT spell (#10875) ───────────────────────
  //
  // `check:published-files` asks whether a published package ships a scripts/
  // directory OF ITS OWN — a package-relative predicate over would-be tarball
  // contents. Written as a quoted literal it read to this derivation as a
  // declaration of the repo's own scripts/ tree, which the gate never opens:
  // the last row of ESCAPABLE_LITERAL_LEDGER, discharged by respelling the
  // predicate rather than by declaring a subtree that would have been FALSE.
  //
  // ⛔ The remedy the FRESH message offers first — declare the subtree — is the
  // WRONG one here, and it is the one a reader reaches for. The ledger cannot
  // say so, because by design it says nothing at all once a row is out. So the
  // correct verdict is pinned here, in both directions, against the live tree.
  const publishedFiles = scriptsFamilies.get('check:published-files');
  t(
    'check:published-files is discovered at all — the pins below mean nothing without it',
    Boolean(publishedFiles),
  );
  t(
    'check:published-files declares no bare repo root it does not open',
    Boolean(publishedFiles) && !publishedFiles.hints.includes('scripts'),
    JSON.stringify({ hints: publishedFiles?.hints }),
  );
  t(
    '…so a brand-new repo-root scripts/ file does NOT name it — a fabricated lead is the costlier error',
    Boolean(publishedFiles) && classifyEntry(publishedFiles, [unwrittenScript]).verdict !== 'matched',
    JSON.stringify({ verdict: publishedFiles && classifyEntry(publishedFiles, [unwrittenScript]).verdict }),
  );
  // Non-vacuity for the case above, and the whole difference between a verdict
  // that is CORRECT and one that is merely quiet: it must be passing because
  // the gate reads a different population, never because the gate went dark.
  // Its own source is a population it really does have, and still names it.
  t(
    '…and it is not silent everywhere: the population it really has still names it',
    Boolean(publishedFiles) &&
      classifyEntry(publishedFiles, ['scripts/check-published-files.mjs']).verdict === 'matched',
    JSON.stringify({
      verdict: publishedFiles && classifyEntry(publishedFiles, ['scripts/check-published-files.mjs']).verdict,
    }),
  );

  // ── Telling a WEAK silence from an INVERTED one (#10784) ──────────────────
  //
  // The residue said the same words for a gate that genuinely does not read
  // your file and for one whose declared literals are a census of the files it
  // already has. These pin the split as a property of the HINT SET, so a gate
  // of that shape reports itself rather than waiting to be noticed.
  t('a common directory is found on segment boundaries', commonDirectory(['scripts/a.mjs', 'scripts/pm/b.mjs']) === 'scripts');
  t('a sibling whose name merely shares a prefix does not invent one', commonDirectory(['packages/spec/a.ts', 'packages/species/b.ts']) === 'packages');
  t('files with nothing above the repo root share no directory', commonDirectory(['README.md', 'AGENTS.md']) === '');
  t('one file is its own directory', commonDirectory(['scripts/pm/a.mjs']) === 'scripts/pm');

  const rosterTree = watchHintTree(['scripts/a.mjs', 'scripts/b.mjs', 'scripts/pm/c.mjs']);
  const rosterFam = (hints) => ({ hints, files: [], workflows: new Set(['lint.yml']) });
  const roster = artifactOnlySilence(rosterFam(['scripts/a.mjs', 'scripts/b.mjs']), [unwrittenScript], rosterTree);
  t('a population of nothing but tracked FILES is an artifact roster', roster?.artifacts.length === 2 && roster.dir === 'scripts');
  t('…and it is flagged when the card edits the directory the roster sits in', roster?.coversYourPath === true);
  t(
    'the same roster is NOT flagged for a card somewhere else — it is a standing fact there, not a lead',
    artifactOnlySilence(rosterFam(['scripts/a.mjs', 'scripts/b.mjs']), ['packages/spec/src/index.ts'], rosterTree)?.coversYourPath === false,
  );
  t(
    'one declared DIRECTORY is a population, so the family is not a roster however many files sit beside it',
    artifactOnlySilence(rosterFam(['scripts/a.mjs', 'scripts/pm']), [unwrittenScript], rosterTree) === null,
  );
  t(
    'a literal the tree does not track is not an artifact either — that is the unreachable species',
    artifactOnlySilence(rosterFam(['scripts/gone.mjs']), [unwrittenScript], rosterTree) === null,
  );
  t('a family that declares nothing at all is undetermined, never a roster', artifactOnlySilence(rosterFam([]), [unwrittenScript], rosterTree) === null);
  const rosterNote = artifactOnlyNote(roster).join('\n');
  t('the note states the shape', rosterNote.includes('artifact roster') && rosterNote.includes('2 declared'));
  t(
    'and STOPS SHORT of claiming the gate reads your file — the half the tree cannot answer, and a fabricated lead if asserted',
    !/reads your file|very likely reads/.test(rosterNote),
    rosterNote,
  );
  t('names the remedy as the subtree spelling of the roster\'s OWN root', rosterNote.includes('scripts/**'));
  t('and hands over the discriminator instead of deciding intent', rosterNote.includes('If it really reads only those files'));
  t(
    'a roster that does not touch the card prints the standing fact, not the warning',
    artifactOnlyNote(artifactOnlySilence(rosterFam(['scripts/a.mjs', 'scripts/b.mjs']), ['packages/spec/src/index.ts'], rosterTree))
      .join('\n')
      .includes('ordinary one'),
  );

  // ── The roster block, printed where a dev without --residue will see it (#14880)
  //
  // The note above is per family and prints only inside the silent listing,
  // which is behind a flag no dispatch brief tells anyone to pass. Two measured
  // CI reds on this card were carried by families of exactly this shape
  // (`check:optional-error-sink`, `check:error-code-provenance`), invisible to
  // a `--commands` harvest for EVERY card. The block states the standing fact
  // and names the families — and its whole contract is that it is a block
  // BESIDE the derived list, never a part of it.
  const blockRows = [
    { check: 'check:b', command: 'pnpm check:b', workflows: ['lint.yml'], artifacts: ['scripts/a.mjs'], dir: 'scripts', coversYourPath: true, checkerHealth: false },
    { check: 'check:a', command: 'pnpm check:a', workflows: ['lint.yml'], artifacts: ['docs/x.md'], dir: 'docs', coversYourPath: false, checkerHealth: false },
  ];
  const blockOut = artifactRosterLines(blockRows);
  t('no rosters, no block — an empty section is never printed', artifactRosterLines([]).length === 0);
  t('the block sizes itself and names every family, sorted by the command a dev would run', blockOut[0].includes('2 famil(ies)')
    && blockOut.filter((l) => l.startsWith('  - ')).join('|') === '  - pnpm check:a|  - pnpm check:b   ⛔ roster under scripts, which one of your paths is in');
  t(
    '⭐ it says out loud that these are OUTSIDE the derived total, which is the whole reason it is a separate block',
    blockOut.some((l) => l.includes('NOT counted among the derived')) && blockOut.some((l) => l.includes('NOT in the runnable total')),
  );
  t(
    'and it marks the correlated subset — the rosters sitting in a directory one of the card\'s paths is in',
    blockOut.some((l) => l.includes('1 of them keep that roster in a directory one of YOUR paths is in')),
  );
  t(
    'a card no roster touches gets the standing fact instead of a warning about none of them',
    artifactRosterLines([{ ...blockRows[1] }]).some((l) => l.includes('None of their rosters sits in a directory your paths are in')),
  );
  // ⛔ The refusal, and it is the one that keeps this block from being the
  // fabricated lead `artifactOnlyNote`'s docblock prices: whether a roster is a
  // baseline in a directory or a census OF it is intent, and intent is not in
  // the tree. The block must not call them scanners, and must not tell anyone
  // the gate reads their file.
  t(
    '⛔ and it never calls them scanners or claims they read your file — the half the tree cannot answer',
    !/scanner|reads your file|very likely reads/.test(blockOut.join('\n')),
    blockOut.join('\n'),
  );
  t(
    'it names the producer-side remedy the residue already carries, so the block points at a fix and not only at work',
    blockOut.some((l) => l.includes('declare the scan surface beside the roster')),
  );
  // ⛔ STRUCTURAL, not a filter someone has to remember: `commandsFor` reads the
  // matched, convention and always-runs rows only, and a roster family is
  // `silent`. Asserted against the real union so a future edit that started
  // feeding rosters into it reddens here rather than in a dev's harvest.
  t(
    '⛔ a roster command is not in the runnable union, whatever the block prints',
    !commandsFor({ matchedRows: [{ check: 'check:m', command: 'pnpm check:m', ciOnly: null }], kindGroups: [], alwaysRunsRows: [] })
      .some((c) => c === 'pnpm check:a' || c === 'pnpm check:b'),
  );

  // ── A roster row whose green cannot grade the diff (#16030) ──────────────
  //
  // ⚠️ Every case here asserts the AXIS and where the row LANDED, never that
  // the block still renders. The defect was a green in the right shape: a row
  // that cannot fail for anything in the diff, sitting in the same list and the
  // same syntax as rows that can. A case checking only that the command appears
  // would have been green against the bug.
  //
  // The predicate first, on the two carriers and on the shape that must NOT
  // move — the conventional `--self-test && <work>` pair, where the second
  // segment is what judges the diff.
  t('a lone --self-test invocation grades the checker, not the diff', selfTestOnlyInvocation('node scripts/x.mjs --self-test') === true);
  t(
    '⛔ ...and the conventional two-segment shape does NOT: its second segment does the work',
    selfTestOnlyInvocation('node scripts/x.mjs --self-test && node scripts/x.mjs') === false,
  );
  t('...whichever separator joins the segments', selfTestOnlyInvocation('node scripts/x.mjs --self-test; node scripts/x.mjs') === false);
  t('every segment counts, so a pair of self-tests is still checker-health', selfTestOnlyInvocation('node a.mjs --self-test && node b.mjs --self-test') === true);
  t('a bare work invocation judges the diff', selfTestOnlyInvocation('node scripts/x.mjs') === false);
  t('⛔ and a flag that merely CONTAINS the token is not the flag', selfTestOnlyInvocation('node scripts/x.mjs --self-testing') === false);
  t('an empty or absent body is never read as checker-health', selfTestOnlyInvocation('') === false && selfTestOnlyInvocation(null) === false);
  // ⭐ The carrier that the card's own discriminator misses. A direct row wears
  // the flag in the bytes the block prints; a pnpm-spelled row is a NAME, and
  // reading the printed bytes for it answers `false` — which is how both rows
  // this card was filed for would have stayed unmarked by a fix that trusted
  // the rendered command alone.
  t(
    'a direct row is classified from the invocation the block prints',
    rosterCheckerHealth({ direct: true }, 'node scripts/x.mjs --self-test') === true
      && rosterCheckerHealth({ direct: true }, 'node scripts/x.mjs') === false,
  );
  t(
    '⭐ a pnpm-spelled row is classified from the manifest body, NOT from the name the block prints',
    rosterCheckerHealth({ direct: false, manifestCommand: 'node scripts/x.mjs --self-test' }, 'pnpm check:x') === true
      && rosterCheckerHealth({ direct: false, manifestCommand: 'node scripts/x.mjs --self-test && node scripts/x.mjs' }, 'pnpm check:x') === false,
  );
  t(
    '⛔ an unresolvable invocation is null — NEITHER judging nor checker-health',
    rosterCheckerHealth({ direct: false, manifestCommand: null }, 'pnpm check:x') === null,
  );
  // Now the rendering, which is where the harvest reads it.
  const healthRow = { check: 'check:h', command: 'pnpm check:h', workflows: ['lint.yml'], artifacts: ['scripts/h.json'], dir: 'scripts', coversYourPath: false, checkerHealth: true };
  const splitOut = artifactRosterLines([...blockRows, healthRow]);
  t(
    '⭐ a --self-test-only roster entry lands in the checker-health sub-list, under its own heading',
    splitOut.some((l) => l.includes("1 of these 3 famil(ies) run ONLY the checker's own")),
    splitOut.join('\n'),
  );
  // ⛔ ON THE ROW, not only in the heading: `spellingDistribution`'s docblock
  // records that consumers grep ROWS out of this block, so a caption a row-wise
  // harvest never reads would leave the two greens indistinguishable in the one
  // stream that matters.
  t(
    '⛔ ...and the row itself carries the mark, because a harvest greps rows and not headings',
    splitOut.some((l) => l.startsWith('  - pnpm check:h') && l.includes('NOT a PR verdict')),
    splitOut.filter((l) => l.startsWith('  - ')).join('|'),
  );
  t(
    '...while the rows that DO judge the diff keep their plain shape, so nothing is marked that can fail',
    splitOut.filter((l) => l.startsWith('  - ') && !l.includes('NOT a PR verdict')).length === 2
      && !splitOut.some((l) => l.startsWith('  - pnpm check:a') && l.includes('checker-health')),
    splitOut.filter((l) => l.startsWith('  - ')).join('|'),
  );
  t(
    'the instruction to run them now says what a green from such a row is worth',
    splitOut.some((l) => l.includes('never read a green from a row')),
  );
  // ⛔ The third answer, pinned so it can never quietly become one of the other
  // two. Zero members on this tree today; a row this tool cannot resolve must
  // be NAMED, because filing it among the judging rows mints the same false
  // clearance through a different door.
  const unresolvedOut = artifactRosterLines([{ ...healthRow, check: 'check:u', command: 'pnpm check:u', checkerHealth: null }]);
  t(
    '⛔ an unclassified row is named as unclassified, never defaulted into either side',
    unresolvedOut.some((l) => l.includes('could not resolve to a command body'))
      && unresolvedOut.some((l) => l.startsWith('  - pnpm check:u') && l.includes('UNCLASSIFIED')),
    unresolvedOut.join('\n'),
  );
  t(
    '...and the block never claims of an unclassified row that it judges the diff',
    !unresolvedOut.some((l) => l.startsWith('  - pnpm check:u') && l.includes('NOT a PR verdict')),
  );

  // ── The classifier returned a plausible WRONG CATEGORY (#13520) ───────────
  //
  // ⚠️ Every case below asserts the CATEGORY, never "it did not crash" and
  // never "it still classifies". This defect threw nothing and printed no
  // error — it answered `null` where the answer is a roster, so a case that
  // only checked for an answer would have been GREEN against the bug. Each
  // assertion therefore names the bucket AND its contents: which tracked files,
  // under which directory, and for the negatives, `null` exactly.
  const extlessTree = watchHintTree([
    'packages/spec/scripts/lib/dist-freshness.ts',
    'packages/spec/scripts/lib/sharded-artifacts.ts',
    'packages/spec/scripts/lib/notes.md',
    'packages/spec/src/index.ts',
  ]);
  const extlessRoster = artifactOnlySilence(
    rosterFam(['packages/spec/scripts/lib/dist-freshness', 'packages/spec/scripts/lib/sharded-artifacts']),
    ['packages/spec/scripts/lib/dist-freshness.ts'],
    extlessTree,
  );
  t(
    'a roster spelled as extensionless module specifiers is an artifact ROSTER, not an ordinary silence',
    extlessRoster !== null,
    JSON.stringify(extlessRoster),
  );
  t(
    '…and the CATEGORY is pinned by its contents: the tracked files those specifiers name',
    JSON.stringify(extlessRoster?.artifacts) ===
      JSON.stringify(['packages/spec/scripts/lib/dist-freshness.ts', 'packages/spec/scripts/lib/sharded-artifacts.ts']),
    JSON.stringify(extlessRoster?.artifacts),
  );
  t(
    '…under the directory those files really sit in, not the one the specifier stops short at',
    extlessRoster?.dir === 'packages/spec/scripts/lib',
    String(extlessRoster?.dir),
  );
  t(
    '…and for a card in that directory it is the INVERTED silence, which is the whole point of the split',
    extlessRoster?.coversYourPath === true,
  );
  t(
    'a roster mixing both spellings of the same claim resolves to the same category',
    JSON.stringify(
      artifactOnlySilence(
        rosterFam(['packages/spec/scripts/lib/dist-freshness', 'packages/spec/scripts/lib/notes.md']),
        [],
        extlessTree,
      )?.artifacts,
    ) === JSON.stringify(['packages/spec/scripts/lib/dist-freshness.ts', 'packages/spec/scripts/lib/notes.md']),
  );
  // The negatives, which are what stop the widening from becoming a second
  // defect pointing the other way: a POPULATION must still refuse the roster
  // category however resolvable its siblings are.
  t(
    'a declared DIRECTORY beside resolvable specifiers is still a population, not a roster',
    artifactOnlySilence(
      rosterFam(['packages/spec/scripts/lib/dist-freshness', 'packages/spec/scripts/lib']),
      [],
      extlessTree,
    ) === null,
  );
  t(
    'a specifier that resolves to nothing is not an artifact — that is still the unreachable species',
    artifactOnlySilence(rosterFam(['packages/spec/scripts/lib/gone']), [], extlessTree) === null,
  );
  t(
    'a PATTERN whose collapse would land on a tracked file is refused before the file branch',
    declaredFileTarget('packages/spec/scripts/lib/dist-freshness*.ts', extlessTree) === null &&
      extlessTree.files.has(collapseHint('packages/spec/scripts/lib/dist-freshness*.ts')),
  );
  t(
    '…non-vacuously: that hint really is judged as a pattern, and the same literal without the glob resolves',
    judgedAsPattern('packages/spec/scripts/lib/dist-freshness*.ts') &&
      declaredFileTarget('packages/spec/scripts/lib/dist-freshness', extlessTree) ===
        'packages/spec/scripts/lib/dist-freshness.ts',
  );
  // The bare file set is the OLD parameter, and it is the one input that
  // reproduces the defect exactly. It must not be readable as an empty answer.
  let rosterRefusedBareSet = false;
  try {
    artifactOnlySilence(rosterFam(['scripts/a.mjs']), [], new Set(['scripts/a.mjs']));
  } catch {
    rosterRefusedBareSet = true;
  }
  t('a bare file set is REFUSED, never answered — it is the shape that mis-categorises silently', rosterRefusedBareSet);

  // ⭐ THE CLASS GUARD, and the reason this card is not "nine gate names added
  // to a table". The defect was ONE PREDICATE holding a private, weaker copy of
  // the covering rule; the copy is gone, and this holds the two instruments
  // EQUAL over the LIVE fleet, at FAMILY grain:
  //
  //   for every discovered family — `artifactOnlySilence` returns a roster
  //   exactly when every declared literal of that family names exactly one
  //   tracked file under `hintCovers`, and the roster IS those files.
  //
  // ⚠️ Family grain, not literal grain, and the difference was measured rather
  // than reasoned. Written against `declaredFileTarget` this case was GREEN
  // against the very bug it exists to catch: the ablation that put the old rule
  // back inside `artifactOnlySilence` left the resolver untouched, so a guard
  // comparing resolver to covering rule saw nothing wrong. A guard on the OWNER
  // does not hold the CALLER to it. Stated over the classifier's own output it
  // reds, because the classifier is what the reader is shown.
  //
  // Non-tautological in both directions: the right side is computed by sweeping
  // the whole tracked corpus through `hintCovers`, which shares no code with the
  // membership test and resolver the classifier composes. Measured while
  // writing this — before the repair the two disagreed about 40 of 754 declared
  // literals and 9 of 192 families; after it, 0 and 0. The day someone teaches
  // `hintCovers` a further spelling (the way #12514 taught it the extension
  // list) and forgets this reader, or reintroduces a private test in the
  // classifier, this reds for whatever family happens to carry it. No gate name
  // appears in it, which is the whole point.
  const classFiles = trackedFiles();
  const classTree = watchHintTree(classFiles);
  const classFams = [...discoverFamilies({ tree: classTree }).byCheck];
  const isTrackedDirHint = (h) => {
    const plain = collapseHint(h);
    return classTree.prefixes.has(plain) && !classTree.files.has(plain);
  };
  // The covering rule's own answer to "this literal names exactly one tracked
  // FILE": swept, not resolved. A pattern and a directory are declared
  // POPULATIONS and are excluded before the sweep — `apps/*/package.json`
  // reaches exactly one file on this tree only because the repo has one app.
  const coveringRuleFile = (h) => {
    if (judgedAsPattern(h) || isTrackedDirHint(h)) return null;
    const reached = classFiles.filter((f) => hintCovers(h, f));
    return reached.length === 1 ? reached[0] : null;
  };
  const ruleRoster = (entry) => {
    const declaredHints = [...new Set(entry.hints ?? [])];
    if (declaredHints.length === 0) return null;
    const named = declaredHints.map(coveringRuleFile);
    return named.every(Boolean) ? named : null;
  };
  const classSplit = classFams.map(([check, entry]) => [
    check,
    JSON.stringify(artifactOnlySilence(entry, [], classTree)?.artifacts ?? null),
    JSON.stringify(ruleRoster(entry)),
  ]);
  const classDisagreements = classSplit.filter(([, mine, rule]) => mine !== rule);
  t(
    `the roster classifier and the covering rule agree about every family in the fleet (${classFams.length} families)`,
    classDisagreements.length === 0,
    classDisagreements.slice(0, 5).map(([c, mine, rule]) => `${c}: classifier=${mine} rule=${rule}`).join(' · '),
  );
  // Non-vacuity for the case above — an agreement over an empty or all-null
  // population asserts nothing, and the fleet really does carry both the shape
  // this card was filed for and rosters that predate it.
  t(
    '…non-vacuously: the fleet carries families whose roster is named only through a dropped extension',
    classFams.some(([, entry]) => {
      const r = artifactOnlySilence(entry, [], classTree);
      return r && r.artifacts.some((a, i) => a !== collapseHint([...new Set(entry.hints ?? [])][i]));
    }),
  );

  // ── A trailing sentence period is not part of the path (#8534, half two) ──
  //
  // Coupled to the rule above: the raw-prefix comparison reached the real file
  // THROUGH the stray period, so the boundary rule alone would have taken this
  // hint from covering its own file to covering nothing. Both directions pinned.
  const dotted = extractWatchHints("const CITED = ['scripts/check-x.mjs.'];");
  t('a hint ending in a sentence period is trimmed to the path it names', dotted.includes('scripts/check-x.mjs'));
  t('no extracted hint ends in a dot', !dotted.some((h) => h.endsWith('.')));
  t('and the trimmed hint still reaches its file under the segment rule', dotted.some((h) => hintCovers(h, 'scripts/check-x.mjs')));
  t('trimming does not eat a leading dotted directory', extractWatchHints("const D = '.claude/agents';").includes('.claude/agents'));
  t('trimming does not eat a trailing glob', extractWatchHints("const G = 'packages/spec/src/**';").some((h) => h.includes('**')));

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
  // Seven: the kind's own heading plus its six gates (#10542 added
  // check:cross-package-test-inputs, whose judged population is exactly this
  // kind rather than a subtree any path hint can name).
  t('a test path emits the convention section', kindHit.length === 7 && kindHit[0].includes('adds or edits a test file'));
  // All three halves anchor on the rendered DELIMITERS (`- pnpm x   —`), for the
  // reason the i18n entry's pins below state at length: a bare `includes` is
  // satisfied by every name that merely STARTS WITH the expected one, so a
  // prefix-preserving rename is invisible to it — the single rot class the STALE
  // branch exists to report. Measured on this entry rather than inherited from
  // that one: renaming these gates to `check:query-options-erasure-v2` and
  // `check:type-check-coverage-v2` in CHANGE_KIND_GATES left the substring form
  // green at 61/61 while the live run printed both as STALE; anchored, the same
  // rename fails this case. The two conventions in this file now agree.
  //
  // The coverage/debt PAIR is pinned as a pair on purpose (#8545): they are two
  // invocations of one script, and the anchored form is what tells them apart —
  // `includes('pnpm check:type-check-coverage')` is satisfied by the debt line's
  // absence AND by a `-v2` rename, which is how a rationale describing the
  // ratchet went on naming the invocation that never runs it.
  t('the section names all five convention gates, runnably', kindHit.some((l) => l.includes('- pnpm check:query-options-erasure   —')) && kindHit.some((l) => l.includes('- pnpm check:type-check-coverage   —')) && kindHit.some((l) => l.includes('- pnpm check:type-check-debt   —')) && kindHit.some((l) => l.includes('- pnpm check:engine-double-contract   —')) && kindHit.some((l) => l.includes('- pnpm check:where-matcher   —')));
  // The two ratchets this entry gained (#8632), pinned apart from the pair
  // above because they arrived for a different reason: they were handed to the
  // PM's judgment in this file's closing prose while a structurally identical
  // ratchet sat in this table. Their `why` must carry the repair direction —
  // fix the double / refuse the unsupported shape — because both baselines are
  // shrink-only and a seat that raises one turns a caught defect into a pinned
  // one.
  const doubleLine = kindHit.find((l) => l.includes('- pnpm check:engine-double-contract   —')) ?? '';
  const whereLine = kindHit.find((l) => l.includes('- pnpm check:where-matcher   —')) ?? '';
  t('the engine-double line states the guard it wants and refuses the baseline raise', /assertEngineDeleteDispatch/.test(doubleLine) && /shrink-only/.test(doubleLine));
  t('the where-matcher line states that refusing is the conforming repair', /refus/i.test(whereLine) && /shrink-only/.test(whereLine));
  // The ratchet line's prerequisite is part of the product, not decoration: a
  // seat that runs `--re-measure` on an unbuilt worktree gets a throw, and an
  // unexplained throw reads as "not applicable to me" — which is a green report
  // over a gate that never ran. So the printed line must carry both the
  // condition and a command that satisfies it.
  const debtLine = kindHit.find((l) => l.includes('- pnpm check:type-check-debt   —')) ?? '';
  t('the ratchet line states its built-closure prerequisite', /closure BUILT|BUILT closure/.test(debtLine) && debtLine.includes('turbo run build'));
  t('a non-test path in no other kind emits nothing — a .mjs is outside the root tsc program too', changeKindLines(['scripts/pm/dispatch-gates.mjs'], resolved).length === 0);

  // ── The ROOT tsc program entry (#9873) ────────────────────────────────────
  //
  // The one gate population no path literal can describe: the root program is
  // declared by EXCLUSION, so this entry derives the complement from the root
  // tsconfig's own list. These pin the predicate, the config read under it, the
  // rendered line, and the property the entry was added for — the path from the
  // PR that paid for this now derives the ratchet.
  const rootExcl = rootTsProgramExcludedDirs();
  t('the root exclude list is read from the config and is not empty', rootExcl.length > 0);
  t('and it really names the three source trees tsc skips', ['packages', 'apps', 'examples'].every((d) => rootExcl.includes(d)));
  t('a new script in the root tree is in the root program — the PR #9853 case', isInRootTsProgram('scripts/bench/runtime-publish-gate.bench.mts', rootExcl));
  t('so is a top-level config file', isInRootTsProgram('tsup.config.ts', rootExcl));
  t('so is a declaration file in the same tree', isInRootTsProgram('scripts/check-regen-pending.d.mts', rootExcl));
  t('a leading ./ does not hide one', isInRootTsProgram('./scripts/check-test-typecheck.mts', rootExcl));
  t('a package source is NOT in the root program', !isInRootTsProgram('packages/rest/src/rest-server.ts', rootExcl));
  t('nor an app source', !isInRootTsProgram('apps/console/src/main.ts', rootExcl));
  t('nor an example source — imports can still pull one in, which the entry note states as its limit', !isInRootTsProgram('examples/app-showcase/src/data/objects/index.ts', rootExcl));
  // The extension half, which is what keeps this entry from firing on nearly
  // every card that touches tooling. The root config sets no `allowJs`, so the
  // tree's checker scripts are outside the program: 117 tracked JS files sit in
  // these same directories against 11 TypeScript files that are really in it,
  // so a bare "outside those directories" test would fire on 128 paths to reach
  // 11 — and send each of them to a ratchet that needs a built closure.
  t('a checker script is NOT in the root program — the root config sets no allowJs', !isInRootTsProgram('scripts/check-type-check-coverage.mjs', rootExcl));
  t('nor is this deriver itself', !isInRootTsProgram('scripts/pm/dispatch-gates.mjs', rootExcl));
  t('nor a non-TS file that merely lives there', !isInRootTsProgram('scripts/pm/README.md', rootExcl));

  // The exclude-SHAPE guard. This complement can only judge plain directory
  // names and silently drops anything else; dropping WIDENS the kind, so the
  // rot would be quiet by construction. This pair is what makes it loud.
  t('plain directory names are judged', isPlainTopLevelDir('packages') && isPlainTopLevelDir('.github'));
  t('a nested path is not a plain directory name', !isPlainTopLevelDir('packages/objectql/src/engine.test.ts'));
  t('nor is a pattern form', !isPlainTopLevelDir('*.test.ts') && !isPlainTopLevelDir('[abc]'));
  t('nor an empty or non-string entry', !isPlainTopLevelDir('') && !isPlainTopLevelDir(null));
  t('the LIVE root tsconfig still consists only of the shape this reads', rootTsconfigExcludeEntries().every(isPlainTopLevelDir));

  // The rendered line, anchored on the delimiters for the reason the pair
  // above states at length: a bare `includes` survives a prefix-preserving
  // rename, which is the one rot class the STALE branch exists to report.
  const rootKind = changeKindLines(['scripts/bench/runtime-publish-gate.bench.mts'], resolved);
  t('a root-program path emits the convention section', rootKind.length === 2 && rootKind[0].includes('ROOT tsc program'));
  t('and it names the RATCHET half — the invocation that re-measures', rootKind.some((l) => l.includes('- pnpm check:type-check-debt   —')));
  const rootLine = rootKind.find((l) => l.includes('- pnpm check:type-check-debt   —')) ?? '';
  t('the root-program line refuses the baseline raise and states the real repair', /shrink-only/.test(rootLine) && /maintainer-only/.test(rootLine));
  t('and carries the built-closure prerequisite, like the other ratchet line', /closure BUILT/.test(rootLine) && rootLine.includes('turbo run build'));
  // Re-pointed rather than deleted (#12074). This case pinned one property —
  // a `.mjs` checker script is NOT in the ROOT tsc program, unlike the `.mts`
  // bench file above — and the gate-script kind below now makes the same path
  // emit a DIFFERENT section. So the property is asserted where it still lives:
  // the root-program heading and its ratchet stay absent, and what does render
  // is named, so a future kind that starts firing here reddens instead of
  // hiding inside a `length` this case no longer checks.
  const checkerKind = changeKindLines(['scripts/check-type-check-coverage.mjs'], resolved);
  t('a checker script is still outside the ROOT tsc program', !checkerKind.some((l) => l.includes('ROOT tsc program')));
  t('…and the root ratchet is not named for it', !checkerKind.some((l) => l.includes('- pnpm check:type-check-debt   —')));
  t('…and the ONE section it does emit is the gate-script kind', checkerKind.length === 3 && checkerKind[0].includes('GATE SCRIPT'));

  // -- The GATE SCRIPT entry (#12074) --------------------------------------
  //
  // The card: a new gate carries LANDING OBLIGATIONS that no derivation
  // enumerates, so they are learned from red CI after the dev has already
  // reported -- which costs the reviewing seat a correction on a verdict it had
  // issued. Measured at four devs and two obligations, twice inside one hour.
  //
  // The obligations are real gates that already know how to detect their own
  // omission; what was missing is a pre-CI channel that ASKS them. This entry is
  // that channel, and it is a KIND rather than a path derivation for the reason
  // #10542 gives for check:cross-package-test-inputs: neither gate declares the
  // population it judges. Both DISCOVER it -- they open exactly the files the
  // families resolve to -- so the honest trigger is that same identity, and the
  // precision is 100% by construction rather than by estimate.
  const gateFiles = gateFamilyFiles();
  t('the gate-script population is derived and non-empty (this kind is not vacuous)', gateFiles.size > 50);
  t('a gate script is one', isGateScriptPath('scripts/check-type-check-coverage.mjs', gateFiles));
  t('a leading ./ does not hide one', isGateScriptPath('./scripts/check-type-check-coverage.mjs', gateFiles));
  t('an ordinary source file is not', !isGateScriptPath('packages/objectql/src/engine.ts', gateFiles));
  // The two directions that make the FILENAME spelling wrong, pinned as
  // directions rather than as counts, so they redden if someone swaps the
  // identity test for the `check-*` regex the card proposed. Both were measured
  // on this tree: the regex fabricates 10 leads and misses 31 real gate scripts,
  // 93.3% precision and 81.8% recall against 100/100 here.
  // The specimen is `check-test-typecheck.mts`, run only by package manifests.
  // It was `check-dts-emitted.mjs` until ci.yml's Build Core began running that
  // checker's `--self-test` (#21202), which made it a family file.
  t('a name-shaped script no family runs is NOT a gate script — the fabrication direction',
    !isGateScriptPath('scripts/check-test-typecheck.mts', gateFiles));
  t('…and a real gate that is not called check-anything IS one — the recall direction',
    isGateScriptPath('packages/spec/scripts/build-schemas.ts', gateFiles));
  // The two instances this card measured. They are the whole reason the entry
  // exists, so they are pinned as paths rather than described.
  t('the first measured CI red is in the kind', isGateScriptPath('scripts/check-objectql-double-limit.mjs', gateFiles));
  t('the second measured CI red is in the kind', isGateScriptPath('scripts/check-i18n-stale-fill.mjs', gateFiles));

  // The rendered section, anchored on the delimiters for the reason the entries
  // above state at length: a bare `includes` survives a prefix-preserving
  // rename, the one rot class the STALE branch exists to report.
  const gateKind = changeKindLines(['scripts/check-objectql-double-limit.mjs'], resolved);
  t('a gate-script path emits the convention section', gateKind.length === 3 && gateKind[0].includes('GATE SCRIPT'));
  t('and it names the bare-root self-test, runnably',
    gateKind.some((l) => l.includes('- pnpm scripts/pm/bare-root-worklist.mjs --self-test   —')));
  t('and it names this tool own gate too — the SECOND obligation, which no path derivation reaches',
    gateKind.some((l) => l.includes('- pnpm check:pm-dispatch-gates   —')));
  // Each `why` has to carry the half a dev cannot re-derive, or the lead is a
  // command with no obligation attached to it.
  const bareLine = gateKind.find((l) => l.includes('bare-root-worklist')) ?? '';
  const escLine = gateKind.find((l) => l.includes('- pnpm check:pm-dispatch-gates   —')) ?? '';
  t('the bare-root line states that an EDIT counts, by naming all three directions',
    /FRESH/.test(bareLine) && /STALE/.test(bareLine) && /CONTRADICTED/.test(bareLine));
  t('…and refuses the two wrong repairs the failure text warns about',
    /shrink-only/.test(bareLine) && /costlier error/.test(bareLine));
  t('the escapable-literal line states that identity is its ONLY route, so the silence is not a clearance',
    /artifact roster/.test(escLine) && /IDENTITY/.test(escLine));
  t('…and refuses reaching for the declare remedy by default', /shrink-only/.test(escLine) && /by default/.test(escLine));
  // Both names pinned individually beside the census guard's own reasoning: a
  // count alone stays green if one is dropped and another added.
  t('the bare-root self-test is a live family, so naming it is not a guess',
    [...discoverFamilies().byCheck.keys()].includes('scripts/pm/bare-root-worklist.mjs --self-test'));
  // A non-gate script in no other kind still emits nothing — the genuine zero
  // this block took over from the re-pointed case above. Read FROM THE TREE
  // rather than spelled, so it cannot rot into a path that quietly became a
  // gate and turned this case vacuous.
  const nonGate = trackedFiles().find((f) => f.startsWith('scripts/') && f.endsWith('.mjs') && !gateFiles.has(f));
  t('a non-gate script exists to probe the zero with', Boolean(nonGate));
  t('…and it emits no convention section at all', changeKindLines([nonGate], resolved).length === 0);


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
  // One kind line plus one line per gate in the entry — TWO gates since #11671
  // added the stale-fill ratchet to the same file surface. The count is pinned
  // (not `>= 1`) so a gate silently dropped from the entry fails here.
  t('an owning-package path emits the i18n convention section', i18nHit.length === 3 && i18nHit[0].includes('owns an i18n-extract.config.ts'));
  t('the i18n section names check:i18n exactly, runnably', i18nHit.some((l) => l.includes('- pnpm check:i18n   —')));
  // #11671: the two gates answer DIFFERENT moves on the same surface — check:i18n
  // sees a key set change, this one sees a source string REVISED under a stale
  // translated leaf. The delimiter anchor keeps the check:i18n pin above from
  // matching this line by prefix, and vice versa.
  t('the i18n section also names check:i18n-stale-fill, runnably', i18nHit.some((l) => l.includes('- pnpm check:i18n-stale-fill   —')));
  t('a path outside every owning package emits no i18n section', !changeKindLines(['packages/objectql/src/engine.ts'], resolved).some((l) => l.includes('check:i18n')));

  // ── The error-code CONTENT kind (#12850) ─────────────────────────────────
  //
  // The first entry in this table judged from a file's CONTENT rather than its
  // path (the HTTP-status entry below is the second), so its cases are shaped
  // differently: the limbs are driven through an
  // INJECTED reader (offline, no tree), and the tree itself is used only for
  // the two properties a fixture cannot pin — that the predicate still reaches
  // the real specimen, and that it still DISCRIMINATES.
  const codeSrc = (text) => (_path) => text;
  const stamps = (text, path = 'packages/x/src/a.ts') => stampsAnErrorCodeLiteral(path, codeSrc(text));
  t('a quoted code literal in a stamp position is a hit', stamps("const e = { code: 'NOT_CREATABLE' };"));
  t('a SCREAMING_SNAKE constant in a stamp position is a hit', stamps('const e = { code: NOT_CREATABLE };'));
  t('an assigned code is a hit', stamps("err.code = 'FLOW_FAILED';"));
  t('an optional code FIELD TYPE is a hit', stamps("interface E { code?: 'FLOW_FAILED' }"));
  // The specimen shape from #12843, spelled out: without the `typeof` limb this
  // case is the one that fails, and it is the exact form that cost the round
  // trip — a literal `code` type reached through a named constant.
  t('a typeof reference to a code constant is a hit — the #12843 shape',
    stamps('interface N { code: typeof CONVERSION_NOTICE_CODE; }'));
  // The declaration half of that same shape, which carries no `code` token at
  // all and is therefore invisible to every `code`-anchored limb.
  t('a SCREAMING_SNAKE constant bound to a SCREAMING_SNAKE string is a hit',
    stamps("export const CONVERSION_NOTICE_CODE = 'OS_METADATA_CONVERTED' as const;"));
  t('a file with neither shape is not a hit', !stamps('export function add(a: number, b: number) { return a + b; }'));
  // Masking is load-bearing in the cheap direction only: a code the gate would
  // never report because it is not in source cannot cost a run here either.
  t('a code discussed only in a comment is not a hit', !stamps("// code: 'NOT_CREATABLE' is stamped elsewhere\nexport const x = 1;"));
  t('a lowercase constant binding is not a hit', !stamps("const notACode = 'lowercase';"));
  // Population: the gate does not read tests, declaration files or non-TS, so
  // neither does the lead. Each is driven with content that WOULD hit, so the
  // case fails if the population half stops being consulted.
  t('a test file carrying a stamp is not a hit', !stamps("const e = { code: 'X_Y' };", 'packages/x/src/a.test.ts'));
  t('a d.ts carrying a stamp is not a hit', !stamps("const e = { code: 'X_Y' };", 'packages/x/src/a.d.ts'));
  t('a non-TS file carrying a stamp is not a hit', !stamps("const e = { code: 'X_Y' };", 'packages/x/src/a.md'));
  // The unreadable branch, pinned as its own case because it is the one this
  // entry deliberately does NOT close: at dispatch time the card's surface is a
  // hypothesis, and a file with no content on disk answers false rather than
  // falling back to a path match. A regression here would be silent.
  t('a path with nothing to read is not a hit, and does not throw', !stampsAnErrorCodeLiteral('packages/x/src/a.ts', () => null));
  t('…and the live reader answers the same way for a path the tree does not have',
    !stampsAnErrorCodeLiteral('packages/there-is-no-such-package/src/a.ts'));

  // Anti-vacuity, against the REAL tree: the shape that cost #12843 a CI round
  // trip must still be reached. Spelled rather than discovered because it IS
  // the specimen — a derived probe would answer about some other file.
  const CODE_SPECIMEN = 'packages/spec/src/conversions/types.ts';
  t('the live tree still carries the #12843 specimen shape, and the predicate reaches it',
    stampsAnErrorCodeLiteral(CODE_SPECIMEN));
  // The discrimination pin, and the one case that holds this card's ruling
  // mechanically: a content trigger is only worth having while it names the
  // gate for SOME cards and not for most. The path spelling this entry refuses
  // would have scored 39%; if a future widening pushes this predicate up there,
  // the entry has become the thing it was written against and this case fails.
  const codeCorpus = trackedFiles().filter((f) => /\.[cm]?tsx?$/.test(f) && !/\.d\.[cm]?ts$/.test(f) && !isTestFilePath(f));
  const codeHits = codeCorpus.filter((f) => stampsAnErrorCodeLiteral(f));
  t(`the content trigger discriminates: ${codeHits.length} of ${codeCorpus.length} non-test TS files (neither vacuous nor tree-wide)`,
    codeCorpus.length > 500 && codeHits.length > 20 && codeHits.length < codeCorpus.length / 4);

  // The rendered section, driven through THIS entry alone so the count is a
  // statement about the entry rather than about which other kinds happen to
  // fire for the specimen path.
  const codeEntry = CHANGE_KIND_GATES.filter((k) => k.gates.some((g) => g.name === 'check:dispatcher-error-vocabulary'));
  t('exactly one entry in the table names the vocabulary gate', codeEntry.length === 1);
  const codeKind = changeKindLines([CODE_SPECIMEN], resolved, codeEntry);
  t('a code-carrying path emits the convention section', codeKind.length === 2 && codeKind[0].includes('judged from CONTENT'));
  t('and it names the vocabulary gate runnably, anchored on the delimiter',
    codeKind.some((l) => l.includes('- pnpm check:dispatcher-error-vocabulary   —')));
  const codeLine = codeKind.find((l) => l.includes('- pnpm check:dispatcher-error-vocabulary   —')) ?? '';
  // The `why` owes the three halves a dev cannot re-derive from the command:
  // why no path derivation names it, what the repair direction is, and that it
  // needs no build (unlike the two ratchets in this same table).
  t('the vocabulary line states why no path derivation reaches it', /REFUSE-WIDE/.test(codeLine));
  t('…and pushes the repair to registration rather than to a tolerant consumer',
    /REGISTERING/.test(codeLine) && /never by widening a consumer/.test(codeLine));
  t('…and says it needs no build, unlike the ratchets in this table', /needs NO build/.test(codeLine));
  // The card's second ruling, pinned: the over-broad direction is the chosen
  // one and the trade is written where the next reader will meet it. A silent
  // narrowing that drops this sentence fails here.
  t('…and writes the false-positive trade down, so nobody assumes narrowing is free',
    /deliberately WIDE/.test(codeLine) && /CI round trip/.test(codeLine));

  // ── The HTTP-status CONTENT kind (#22320) ────────────────────────────────
  //
  // The second content entry, pinned in the first one's shape: limbs through an
  // injected reader, then the live tree for the specimen and the controls, then
  // the rendered section. The specimen is the emit site PR #22311 lost a CI
  // round on. Two of the limb cases are paired with the CODE predicate missing
  // the same text, because that divergence is the whole reason this is a
  // sibling entry and not a second gate on the one above.
  const emits = (text, path = 'packages/x/src/a.ts') => emitsAnHttpStatus(path, codeSrc(text));
  t('a status literal in a status-and-body terminal is a hit',
    emits("return { status: 409, body: { code: 'RESOURCE_CONFLICT' } };"));
  t('an error class declaring its own status is a hit',
    emits("class E extends Error { readonly code = 'X_Y'; readonly status = 422; }"));
  const ENUM_PAIR = 'err.code = StandardErrorCode.enum.INVALID_FILTER;\nerr.status = 400;';
  t('an assignment pair whose code is an enum member is a hit', emits(ENUM_PAIR));
  t('…and the code predicate misses that text, so the status entry is not redundant', !stamps(ENUM_PAIR));
  const DOOR_CALL = "sendError(res, 403, 'SETTINGS_FORBIDDEN', err.message);";
  t('the positional four-argument sendError door is a hit', emits(DOOR_CALL));
  t('…and the code predicate misses that one too', !stamps(DOOR_CALL));
  t('a status named by a SCREAMING_SNAKE constant is a hit',
    emits('return { code: NOT_UPLOADER_CODE, status: NOT_UPLOADER_STATUS };'));
  t('a status constant declared for another file to resolve is a hit', emits('export const NOT_UPLOADER_STATUS = 403;'));
  t('a quoted status WORD is not a hit', !emits("const row = { status: 'active' };"));
  t('a 2xx status is not a hit: the gate reconciles 4xx and 5xx only', !emits('return { status: 200, body: {} };'));
  t('a comparison is not a binding', !emits('if (res.status === 404) return null;'));
  t('a status read from a runtime value is not a hit: the gate cannot resolve it either', !emits('err.status = status;'));
  t('a status discussed only in a comment is not a hit', !emits('// status: 409 is answered elsewhere\nexport const x = 1;'));
  t('a .ts file with no status and no code at all is not a hit',
    !emits('export function add(a: number, b: number) { return a + b; }'));
  t('a test file binding a status is not a hit', !emits('const e = { status: 409 };', 'packages/x/src/a.test.ts'));
  t('a d.ts binding a status is not a hit', !emits('const e = { status: 409 };', 'packages/x/src/a.d.ts'));
  t('a non-TS file binding a status is not a hit', !emits('status: 409', 'packages/x/README.md'));
  t('a path with nothing to read is not a hit, and does not throw', !emitsAnHttpStatus('packages/x/src/a.ts', () => null));

  // The live tree: the specimen is reached, and the card's controls are not.
  // Spelled rather than discovered, like the code specimen above: a derived
  // probe would answer about some other file.
  const STATUS_SPECIMEN = 'packages/services/service-storage/src/storage-routes.ts';
  t('the live tree still carries the #22311 emit site, and the predicate reaches it', emitsAnHttpStatus(STATUS_SPECIMEN));
  t('a docs-only page is not reached', !emitsAnHttpStatus('content/docs/ai/agents.mdx'));
  t('the package README beside the specimen is not reached', !emitsAnHttpStatus('packages/services/service-storage/README.md'));
  t('a live .ts with no status and no code (the package barrel) is reached by neither content entry',
    !emitsAnHttpStatus('packages/services/service-storage/src/index.ts')
      && !stampsAnErrorCodeLiteral('packages/services/service-storage/src/index.ts'));
  const statusHits = codeCorpus.filter((f) => emitsAnHttpStatus(f));
  t(`the status trigger discriminates: ${statusHits.length} of ${codeCorpus.length} non-test TS files (neither vacuous nor tree-wide)`,
    statusHits.length > 20 && statusHits.length < codeCorpus.length / 4);

  // The rendered section, through this entry alone and then through the whole
  // table, which is where the card's controls have to hold.
  const statusEntry = CHANGE_KIND_GATES.filter((k) => k.gates.some((g) => g.name === 'check:error-status-conformance'));
  t('exactly one entry in the table names the status gate', statusEntry.length === 1);
  const statusKind = changeKindLines([STATUS_SPECIMEN], resolved, statusEntry);
  t('the emit-site path emits the status convention section',
    statusKind.length === 2 && statusKind[0].includes('HTTP STATUS') && statusKind[0].includes('judged from CONTENT'));
  t('and it names the status gate runnably, anchored on the delimiter',
    statusKind.some((l) => l.includes('- pnpm check:error-status-conformance   —')));
  const statusLine = statusKind.find((l) => l.includes('- pnpm check:error-status-conformance   —')) ?? '';
  t('the status line states why no path derivation reaches it', /REFUSE-WIDE/.test(statusLine));
  t('…and pushes the repair to documenting the status, with the baseline remedy kept maintainer-only',
    /DOCUMENTING/.test(statusLine) && /MAINTAINER-ONLY/.test(statusLine));
  t('…and says it needs no build', /needs NO build/.test(statusLine));
  const throughTable = (p) => changeKindLines([p], resolved).some((l) => l.includes('check:error-status-conformance'));
  t('through the whole table, the specimen derives the status gate', throughTable(STATUS_SPECIMEN));
  t('…a docs-only path does not', !throughTable('content/docs/ai/agents.mdx'));
  t('…the package README does not', !throughTable('packages/services/service-storage/README.md'));
  t('…and the package barrel does not', !throughTable('packages/services/service-storage/src/index.ts'));
  const statusStale = changeKindLines([STATUS_SPECIMEN], () => null, statusEntry);
  t('an undiscoverable status gate renders STALE for this entry',
    statusStale.filter((l) => l.includes('⚠ check:error-status-conformance: STALE')).length === 1);

  // ── The metadata-form edge (#9116) ────────────────────────────────────────
  //
  // The bundles' OTHER producer, and the half no owning-package test can reach:
  // the metadataForms surface is registry-driven, its source lives in
  // packages/spec, and packages/spec owns no extract config. Pure judgments
  // first, then the live tree, then both rendering directions.
  t('a form module is one', isMetadataFormModulePath('packages/spec/src/data/object.form.ts'));
  t('its sibling schema is not', !isMetadataFormModulePath('packages/spec/src/data/object.zod.ts'));
  t('a bare .form.ts with no name is not one', !isMetadataFormModulePath('packages/spec/src/data/.form.ts'));
  t('a form module test file is not one', !isMetadataFormModulePath('packages/spec/src/data/object.form.test.ts'));

  const formMods = ['packages/spec/src/data/object.form.ts', 'packages/spec/src/ui/view.form.ts'];
  t('the module itself reaches', reachesMetadataFormModule('packages/spec/src/data/object.form.ts', formMods));
  t('a directory CONTAINING one reaches (a card surface is named before its files exist)', reachesMetadataFormModule('packages/spec/src/ui', formMods));
  t('a sibling sharing a name prefix does not', !reachesMetadataFormModule('packages/spec/src/dat', formMods));
  t('an unrelated package does not', !reachesMetadataFormModule('packages/objectql/src/engine.ts', formMods));
  // The over-broad direction, the expensive one: a bare top-level directory
  // covers the whole tree below it, so it must not drag every form module in.
  t('a bare top-level directory is refused', !reachesMetadataFormModule('packages', formMods));

  // Applicability is READ from the configs, not assumed — the flag that decides
  // whether any package still commits the shared baseline at all.
  t('a config with no opt-out extracts the metadata-form surface', flagsExtractMetadataForms(['--locales=zh-CN', '--fill=default']));
  t('the opt-out flag removes it', !flagsExtractMetadataForms(['--objects-only', '--no-metadata-forms']));

  // The live tree — the half no fixture can prove.
  const liveForms = metadataFormModulePaths();
  t('the live walk discovers form modules', liveForms.length > 0 && liveForms.every((f) => f.endsWith('.form.ts')));
  t('the live walk finds no duplicates', new Set(liveForms).size === liveForms.length);
  // If this flips, the entry stops firing BY DESIGN (every package opted out of
  // the shared baseline) — read the entry's deletion criterion before "fixing" it.
  t('some package still commits the shared metadata-form baseline', metadataFormsSurfaceIsExtracted());

  // Regression pin for the measured incident (PR #9113): these two exact paths
  // moved four platform-objects bundles, reddened check:i18n on CI, and derived
  // NOTHING — the family appeared in neither half of the output. Anchored on the
  // rendered delimiters for the reason the entry above states: a bare substring
  // stays green through a prefix-preserving rename, the one rot the STALE branch
  // exists to catch.
  const formHit = changeKindLines(['packages/spec/src/data/object.form.ts', 'packages/spec/src/data/field.form.ts'], resolved);
  // The `?? ''` is not defensive noise: reverse-verifying this block by making
  // every config opt out emptied `formHit`, and the bare index CRASHED the whole
  // self-test on a TypeError — one stack in place of 180-odd named verdicts. A
  // case that stopped holding must fail BY NAME, with its reason, the way the
  // i18n gate's own self-test says it (its `staleForDetail` fallback exists for
  // exactly this). Ablating the entry now reddens these three and nothing else.
  const formKindLine = formHit[0] ?? '';
  t('the measured incident paths now emit the metadata-form section', formHit.length === 2 && formKindLine.includes('metadata form module'));
  t('that section names check:i18n exactly, runnably', formHit.some((l) => l.includes('- pnpm check:i18n   —')));
  t('and it names both incident paths, not just the first', formKindLine.includes('object.form.ts') && formKindLine.includes('field.form.ts'));
  // The over-trigger direction, which the card demanded in its own right: a spec
  // change that touches no form must NOT be pushed into this gate. Both a schema
  // beside a real form module and an unrelated package are pinned, because the
  // first is the one a filename convention could plausibly over-reach into.
  t('a spec schema next door to a form emits no i18n section', !changeKindLines(['packages/spec/src/data/filter.zod.ts'], resolved).some((l) => l.includes('check:i18n')));
  t('an unrelated package still emits no i18n section', !changeKindLines(['packages/rest/src/rest-server.ts'], resolved).some((l) => l.includes('check:i18n')));
  const formStale = changeKindLines(['packages/spec/src/data/object.form.ts'], () => null);
  t('an undiscoverable check:i18n renders STALE for this entry too', formStale.filter((l) => l.includes('⚠ check:i18n: STALE')).length === 1);

  // The measured incident (#8410 / PR #8399), pinned against the REAL workflow
  // rather than a fixture: a fixture proves the parser, only the live file
  // proves that THIS repo's changeset gate is reachable. `Check Changeset`
  // invokes check-adr-0087-registration.mjs from a block-scalar body, and that
  // is the gate PR #8399's declared-breaking changeset went red on after a
  // fully green local loop. If the step is ever rewritten as a one-liner this
  // case still passes (it asserts discovery, not the YAML style); if the gate
  // moves out of pr-automation.yml, re-point the case at its new home rather
  // than deleting it.
  const liveWf = readFileSync(nodePath.join(ROOT, '.github/workflows/pr-automation.yml'), 'utf8');
  const liveInvs = extractCheckInvocations(liveWf, 'pr-automation.yml').map((i) => i.check);
  // ⚠️ Asserted on the SCRIPT, not on a key (#15083). All three of these gates
  // are invoked by `pr-automation.yml` with `--base "$MERGE_BASE"` and by
  // nothing bare, so their keys now carry that argv — the discovery this case
  // is about is unchanged, and pinning the bare key here would pin the very
  // invocation CI never makes. The keyed half is asserted immediately below,
  // so a rewrite of the step cannot quietly satisfy this by discovering the
  // script under some other argv.
  const liveScripts = extractCheckInvocations(liveWf, 'pr-automation.yml').map((i) => i.script);
  t('the live Check Changeset job discovers its ADR-0087 gate', liveScripts.includes('scripts/check-adr-0087-registration.mjs'));
  t('the live Check Changeset job discovers its empty-changeset gate', liveScripts.includes('scripts/check-empty-changeset.mjs'));
  t('the live one-line gate in that file still discovers', liveScripts.includes('scripts/check-changeset-no-major.mjs'));
  t(
    '…each under the argv that file really runs it with, merge base and all',
    ['scripts/check-adr-0087-registration.mjs --base "$MERGE_BASE"',
      'scripts/check-empty-changeset.mjs --base "$MERGE_BASE"',
      'scripts/check-changeset-no-major.mjs --base "$MERGE_BASE"'].every((k) => liveInvs.includes(k)),
  );
  // The end-to-end direction: a `.changeset/` path must now REACH the ADR-0087
  // gate through the ordinary watch-hint match. That gate names `.changeset` in
  // its own source, so this asserts the whole chain (discover -> resolve ->
  // hint -> cover) rather than the parser alone.
  const adrHints = extractWatchHints(readFileSync(nodePath.join(ROOT, 'scripts/check-adr-0087-registration.mjs'), 'utf8'), 'scripts/check-adr-0087-registration.mjs');
  t('a .changeset path is covered by the ADR-0087 gate own hints', adrHints.some((h) => hintCovers(h, '.changeset/some-breaking-change.md')));

  // ── The measured population (#8478), against the REAL scripts ─────────────
  //
  // A fixture proves the boundary; only these files prove that THIS tree's
  // gates land on the right side of it. Each pin names a path the card measured
  // before the narrowing, so a regression reads as the specific claim it broke
  // rather than as a count. If a gate is renamed or moves, re-point the case at
  // its new home — deleting one deletes the evidence, not the problem.
  //
  // Measured on this branch's base (commit 3208222) and after, coverage-capable
  // hints per script: dispatch-gates 46 -> 5, check-empty-changeset 36 -> 3,
  // check-adr-0087-registration 34 -> 6, check-skill-id-lint 2 -> 2 (already
  // clean, the control). Across all 66 discoverable gate scripts: 1144 hints ->
  // 473, with no hint gained that any repo path can reach.
  const readHints = (rel) => extractWatchHints(readFileSync(nodePath.join(ROOT, rel), 'utf8'), rel);
  const covers = (hs, p) => hs.some((h) => hintCovers(h, p));

  t(
    'the ADR-0087 gate no longer claims a runtime path through its own fixtures',
    !covers(adrHints, 'packages/runtime/src/index.ts'),
  );
  const emptyHints = readHints('scripts/check-empty-changeset.mjs');
  t('the empty-changeset gate still reaches a .changeset path', covers(emptyHints, '.changeset/anything.md'));
  t(
    'the empty-changeset gate no longer claims a skills path through its own fixtures',
    !covers(emptyHints, 'skills/demo/SKILL.md'),
  );
  // The load-bearing survivor: this gate's real literals are the per-file
  // ceiling keys (repo-relative paths in its CEILINGS map) — before the
  // narrowing it reached SKILL.md only through a path copy in its own header,
  // a real input carried by prose.
  const ratchetHints = readHints('scripts/pm/check-skill-line-ratchet.mjs');
  t('the skill ratchet still reaches the SKILL.md it counts', covers(ratchetHints, '.claude/skills/pm-dispatch/SKILL.md'));
  t('the skill ratchet reaches the references files it now counts', covers(ratchetHints, '.claude/skills/pm-dispatch/references/dispatch-runbook.md'));
  t(
    'the skill ratchet claims only its covered files, not all of references/',
    !covers(ratchetHints, '.claude/skills/pm-dispatch/references/facts.md'),
  );
  // The control the card called "what a clean one looks like": two hints, both
  // real, unchanged by the narrowing.
  const idLintHints = readHints('scripts/pm/check-skill-id-lint.mjs');
  t('the skill-id lint keeps both of its real inputs', covers(idLintHints, '.claude/skills/pm-dispatch/SKILL.md') && covers(idLintHints, '.claude/agents/os-dev.md'));
  // This tool's own gate: its thin gate file's one literal is the tool, so a
  // card editing the tool must still derive it.
  t('the dispatch-gates gate still reaches the tool it runs', covers(readHints('scripts/pm/check-dispatch-gates.mjs'), 'scripts/pm/dispatch-gates.mjs'));
  // And this file, the worst specimen in the card's table: the directory it
  // really reads survives, the fixtures naming other packages do not. The spec
  // contract surface DOES hint now — via the declared module-body suspect glob
  // (a real constant, not a fixture; inert for gate matching for the reason the
  // MANDATORY_TIER_GLOBS docblock records) — so the fixture-masking claim is
  // pinned on a path only fixtures name.
  const ownHints = readHints('scripts/pm/dispatch-gates.mjs');
  t('this tool still hints the workflow directory it reads', covers(ownHints, '.github/workflows/lint.yml'));
  t(
    'this tool no longer spells the spec contract surface — the suspect glob is data beside it, which no gate reads, and the declared population never inherited it',
    !covers(ownHints, 'packages/spec/src/data/filter.zod.ts') && SUSPECT_TIER_GLOBS.some((g) => g.glob === 'packages/spec/src/**'),
  );
  t('this tool still does not hint the paths only its fixtures name', !covers(ownHints, 'packages/objectql/src'));
  // The LIVE trailing-dot specimen (#8534): this gate spells its own filename as
  // the last word of a sentence, in a module-body array element that comment
  // masking cannot reach, so the hint carried the period. Pinned live because
  // the fixture above proves the trimming and only this file proves the tree
  // still contains the shape. If that sentence is ever rewritten, re-point the
  // case at whatever file then carries a trailing-dot literal — or, if none
  // does, delete it together with the trim, never ahead of it.
  const compatHints = readHints('scripts/check-skill-compatibility-version.mjs');
  t('the live trailing-dot hint is trimmed to the file it names', compatHints.includes('scripts/check-skill-compatibility-version.mjs'));
  t('so it still reaches that file under the segment rule', covers(compatHints, 'scripts/check-skill-compatibility-version.mjs'));

  // ── The one DECLARED coupling (#8551) ─────────────────────────────────────
  //
  // The narrowing above is about gates that MENTION a path without reading it.
  // This is its mirror image: a gate that really does move with a path it never
  // opens. The type-check ledgers ratchet a count for the workspace root, whose
  // program is the scripts tree, and one script accounts for 29 of that entry's
  // 80 errors — so editing it moves a number this farm holds. The coupling was
  // written down all along, inside the ledger note's prose, where whole-literal
  // extraction discards it: the family then scored `silent` — neither matched
  // nor undetermined, printed nowhere — and a card editing that script was told
  // no family names its paths.
  //
  // The remedy is per-coupling and manual (a bare, whole-literal constant in
  // the gate's own module body), which is exactly the kind of declaration that
  // rots quietly. So it is pinned LIVE, against both real files: delete the
  // constant and this gate reddens instead of the silence coming back. If the
  // ledger's coupling genuinely ends, delete the constant AND these cases in
  // the same change — the evidence goes with the claim, never ahead of it.
  //
  // This does NOT retire the test-file entry in CHANGE_KIND_GATES, whose
  // deletion criterion is a discoverable literal for that KIND: the constant
  // names one script carrying no `.test.` infix, while that entry answers for
  // every test file in the tree.
  const coverageHints = readHints('scripts/check-type-check-coverage.mjs');
  t(
    'the type-check ledger gate declares the root-program script whose errors it ratchets',
    covers(coverageHints, 'scripts/check-test-typecheck.mts'),
  );
  const coupledVerdict = classifyEntry(
    { files: ['scripts/check-type-check-coverage.mjs'], hints: coverageHints },
    ['scripts/check-test-typecheck.mts'],
  );
  t(
    'so a card editing that script is MATCHED through that constant, not dropped as silent',
    coupledVerdict.verdict === 'matched' && coupledVerdict.hits[0]?.hint === 'scripts/check-test-typecheck.mts',
  );

  // The same coupling, for the module this file now IMPORTS its i18n walks from
  // (#9116). Sharing one enumeration between the gate and this tool removed a
  // mirror, and it would have opened a smaller hole of exactly the kind this
  // card is about: an import specifier is not a discoverable hint, so a card
  // editing the shared module could move two gates while deriving neither.
  // Both are pinned LIVE against the real files — delete either constant and
  // this reddens instead of the silence coming back.
  const SHARED = 'scripts/i18n-bundle-surface.mjs';
  t(
    'the i18n gate declares the module its population is enumerated by',
    covers(readHints('scripts/check-i18n-bundles.mjs'), SHARED),
  );
  t(
    'the dispatch-gates gate declares it too, since the tool self-test drives those functions',
    covers(readHints('scripts/pm/check-dispatch-gates.mjs'), SHARED),
  );
  t(
    'and that gate still reaches the tool it runs — the new constant displaces nothing',
    covers(readHints('scripts/pm/check-dispatch-gates.mjs'), 'scripts/pm/dispatch-gates.mjs'),
  );
  // The shared module is a real file, so the two claims above are live rather
  // than a pair of matching strings.
  t('the declared shared module exists', existsSync(nodePath.join(ROOT, SHARED)));

  // The same coupling once more, for the frame-sync gate whose COPIES table
  // the 2026-08-20 clause-① narrowing made a DEFINING input of the tier
  // mandate. The tool's self-test reaches it through a spawned import — not a
  // discoverable hint — so the gate declares it as a constant, and this pin
  // keeps that declaration live: delete it and this reddens instead of a
  // COPIES edit moving the gate's verdict while deriving nothing.
  const FRAME = 'scripts/check-skill-frame-sync.mjs';
  t(
    'the dispatch-gates gate declares the frame-sync module the tier mandate is defined against',
    covers(readHints('scripts/pm/check-dispatch-gates.mjs'), FRAME),
  );
  t('the declared frame-sync module exists', existsSync(nodePath.join(ROOT, FRAME)));

  // The same shape again, for the TYPE-registry edge of walkMetadataForms
  // (#9144) — two specific, known files rather than a runtime-enumerated
  // population, so they are closed as coupling constants in
  // check-i18n-bundles.mjs rather than a third CHANGE_KIND_GATES entry. Both
  // directions pinned LIVE: delete either constant and this reddens instead
  // of the derivation going silently blind on that edge again.
  const TYPE_REGISTRY = 'packages/spec/src/kernel/metadata-plugin.zod.ts';
  const FORM_REGISTRY = 'packages/spec/src/system/metadata-form-registry.ts';
  const i18nGateHints = readHints('scripts/check-i18n-bundles.mjs');
  t('the i18n gate declares the type-level metadata registry module', covers(i18nGateHints, TYPE_REGISTRY));
  t('the i18n gate declares the form registry module too (not just its *.form.ts leaves)', covers(i18nGateHints, FORM_REGISTRY));
  const typeRegistryVerdict = classifyEntry({ files: ['scripts/check-i18n-bundles.mjs'], hints: i18nGateHints }, [TYPE_REGISTRY]);
  const formRegistryVerdict = classifyEntry({ files: ['scripts/check-i18n-bundles.mjs'], hints: i18nGateHints }, [FORM_REGISTRY]);
  t(
    'so a card editing the type registry is MATCHED through that constant, not dropped as silent',
    typeRegistryVerdict.verdict === 'matched' && typeRegistryVerdict.hits[0]?.hint === TYPE_REGISTRY,
  );
  t(
    'and a card editing the form registry module is MATCHED through its own constant',
    formRegistryVerdict.verdict === 'matched' && formRegistryVerdict.hits[0]?.hint === FORM_REGISTRY,
  );
  // Both declared paths are real files, so the four claims above are live
  // rather than a pair of matching strings.
  t('the declared type registry module exists', existsSync(nodePath.join(ROOT, TYPE_REGISTRY)));
  t('the declared form registry module exists', existsSync(nodePath.join(ROOT, FORM_REGISTRY)));

  // ── A family's OWN script files as match keys (#8509) ─────────────────────
  //
  // Both directions are the product, and both are pinned: a card editing a
  // gate's script must derive that gate, and a card that touches nothing of the
  // gate's must gain nothing from the new key. The over-match direction is the
  // expensive one here — this key is added to EVERY discovered family at once,
  // so a key that covered too much would fabricate leads across the whole farm
  // rather than in one gate.
  const identityEntry = { files: ['scripts/check-empty-changeset.mjs'], hints: [] };
  t(
    'a gate script derives its own family, with the file path itself as provenance',
    coveringKey(identityEntry, 'scripts/check-empty-changeset.mjs')?.key === 'scripts/check-empty-changeset.mjs',
  );
  t('an unrelated path gains nothing from the identity key', coveringKey(identityEntry, 'packages/rest/src/server.ts') === null);
  t('another gate script does not match through this one identity', coveringKey(identityEntry, 'scripts/check-adr-0087-registration.mjs') === null);
  t('a family that resolves to no file at all matches nothing by identity', coveringKey({ files: [], hints: [] }, 'scripts/check-empty-changeset.mjs') === null);
  // Precedence, in both of its directions. One answer per path either way — the
  // question is only which provenance a reader is shown when both keys fire.
  const bothKeys = { files: ['scripts/pm/check-x.mjs'], hints: ['scripts/pm'] };
  t('identity outranks a scanned hint that also covers', coveringKey(bothKeys, 'scripts/pm/check-x.mjs')?.key === 'scripts/pm/check-x.mjs');
  t('a scanned hint still answers a path identity does not cover', coveringKey(bothKeys, 'scripts/pm/other.mjs')?.key === 'scripts/pm');
  // The live thin-gate-file specimen, both directions. This tool's own gate is
  // one file whose single module-body constant is the tool it runs, so the two
  // keys answer DIFFERENT inputs and neither displaces the other. If that gate
  // is renamed or its file moves, re-point these cases rather than deleting
  // them — they are the evidence that the two keys compose.
  const gateEntry = { files: ['scripts/pm/check-dispatch-gates.mjs'], hints: readHints('scripts/pm/check-dispatch-gates.mjs') };
  t('the gate FILE now derives its own family', coveringKey(gateEntry, 'scripts/pm/check-dispatch-gates.mjs')?.key === 'scripts/pm/check-dispatch-gates.mjs');
  t('the TOOL it runs still derives it through the module-body constant', coveringKey(gateEntry, 'scripts/pm/dispatch-gates.mjs')?.key === 'scripts/pm/dispatch-gates.mjs');
  // The card's own specimen, resolved through the REAL root package.json: the
  // gate whose entire job is running that script's self-test names the script
  // there and nowhere in the script's source, which is why the identity key is
  // the only thing that can reach it.
  const liveRootScripts = JSON.parse(readFileSync(nodePath.join(ROOT, 'package.json'), 'utf8')).scripts ?? {};
  const selfTestGateFiles = resolveCheckToFiles('check:changeset-gate-self-tests', liveRootScripts);
  t('the changeset self-test gate really resolves to the script the card named', selfTestGateFiles.includes('scripts/check-empty-changeset.mjs'));
  t(
    'so a card editing that script now derives that gate end to end',
    coveringKey({ files: selfTestGateFiles, hints: [] }, 'scripts/check-empty-changeset.mjs')?.key === 'scripts/check-empty-changeset.mjs',
  );

  // The bucket the one-line spelling would empty. A family whose source names
  // no path still resolves to a script file, so identity must decide matching
  // WITHOUT being allowed to answer "does this gate's source name a path?".
  const noLiterals = { files: ['scripts/check-silent.mjs'], hints: [] };
  t('a family with no scanned hints stays undetermined for an unrelated card', classifyEntry(noLiterals, ['packages/rest/src/server.ts']).verdict === 'undetermined');
  t('the same family is MATCHED, not undetermined, for a card editing its script', classifyEntry(noLiterals, ['scripts/check-silent.mjs']).verdict === 'matched');
  t('a family whose scanned hints all miss is neither matched nor undetermined', classifyEntry({ files: [], hints: ['packages/spec/src'] }, ['docs/adr/0112-x.md']).verdict === 'silent');
  const identityHits = classifyEntry(noLiterals, ['scripts/check-silent.mjs', 'packages/rest/src/server.ts']).hits;
  t('an identity hit carries the path and the key that covered it, once', identityHits.length === 1 && identityHits[0].path === 'scripts/check-silent.mjs' && identityHits[0].hint === 'scripts/check-silent.mjs');

  // ── CI's own trigger as a match key (#9171) ───────────────────────────────
  //
  // The incident: a workflow declares the paths CI schedules its job on, and
  // nothing here read them. The gates of the whole `Spec property liveness` job
  // read a registry rather than a path, so they carry no watch hint and sat in
  // the `undetermined` bucket for every card — including a card editing
  // `packages/spec/**`, the job's own first trigger. A dev following the
  // dispatch instruction exactly therefore never ran them.
  //
  // The extraction first. `paths` belongs to `pull_request` inside `on:` and
  // nowhere else: the fixtures below put a decoy list under another event and
  // under a job, because a walk that scooped either would widen every family in
  // the file to paths CI never filters on.
  const triggerWf = [
    'name: Fixture',
    'on:',
    '  pull_request:',
    '    types: [opened, synchronize]',
    '    paths:',
    "      - 'packages/spec/**'",
    '      # a comment between entries',
    '      - docs/audits/**',
    '  merge_group:',
    '  schedule:',
    '    - cron: 0 3 * * 1',
    'jobs:',
    '  build:',
    '    paths:',
    '      - never/read/**',
    '',
  ].join('\n');
  const triggerPaths = extractTriggerPaths(triggerWf);
  t('the pull_request paths list is read in declaration order', triggerPaths.join('|') === 'packages/spec/**|docs/audits/**');
  t('a decoy paths list outside the on: mapping is NOT read', !triggerPaths.some((p) => p.includes('never/read')));
  t('a workflow with no paths filter yields an empty list, not a match-nothing list', extractTriggerPaths('on:\n  pull_request:\n    branches: [main]\njobs: {}\n').length === 0);
  t('the flow-sequence spelling is read too', extractTriggerPaths("on:\n  pull_request:\n    paths: ['a/**', \"b/c\"]\n").join('|') === 'a/**|b/c');
  t('pull_request_target is not mistaken for pull_request', extractTriggerPaths("on:\n  pull_request_target:\n    paths:\n      - 'x/**'\n").length === 0);

  // ── Derivation THROUGH a composite action (#19229) ─────────────────────────
  //
  // The card: six gates root their population at `.github/workflows` and none
  // reads `.github/actions/**`, so a command executed through a composite
  // action was audited by nothing while every scope line read as coverage. The
  // repair is `followCompositeActions` + the `viaAction` provenance it carries;
  // these cases are the firing control and the dark control for it.
  //
  // ⛔ The repair the card REFUSES, recorded here because this is where someone
  // would take it: re-pointing the four live-specimen CONTROL assertions below
  // at a different value-bearing family. That turns the pin green while leaving
  // the derivation blind, which is the declaration-without-an-assertion shape
  // this whole file exists to refuse.
  const compositeCallerWf = [
    'name: Fixture',
    'on:',
    '  pull_request: {}',
    'jobs:',
    '  sweep:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v7',
    '      - name: Through the action',
    '        uses: ./.github/actions/fixture-gate',
    '',
  ].join('\n');
  const compositeActionYml = [
    'name: Fixture gate',
    'description: >-',
    '  A description whose folded body mentions run: and must never be read as a step.',
    'runs:',
    '  using: composite',
    '  steps:',
    '    - name: Run the gate',
    '      shell: bash',
    '      run: |',
    '        node scripts/check-nul-bytes.mjs',
    '        pnpm check:agent-model-declared',
    '',
  ].join('\n');
  const compositeReader = (files) => (dir) =>
    (Object.hasOwn(files, dir) ? { file: `${dir}/action.yml`, text: files[dir] } : null);
  t(
    'a local composite `uses:` is read out of a workflow, in its repo-relative spelling',
    localCompositeActionUses(compositeCallerWf).join('|') === '.github/actions/fixture-gate',
  );
  t(
    'the quoted spellings and a trailing comment are read too, and a repeat is read once',
    localCompositeActionUses(
      [
        "      - uses: './.github/actions/a'",
        '      - uses: "./.github/actions/b"   # why',
        '      - uses: ./.github/actions/a',
      ].join('\n'),
    ).join('|') === '.github/actions/a|.github/actions/b',
  );
  t(
    'a third-party action and a local path outside .github/actions are NOT followed — a missing lead, never a fabricated one',
    localCompositeActionUses(
      ['      - uses: actions/checkout@v7', '      - uses: ./tools/some-action', '      - uses: ./.github/workflows/x.yml'].join('\n'),
    ).length === 0,
  );
  t(
    "an action's `runs:` body is what is read — a `run:` mentioned in a top-level description block scalar is not a step",
    runCommandSteps(compositeActionRunsBlock(compositeActionYml)).length === 1
      && !compositeActionRunsBlock(compositeActionYml).includes('description'),
  );
  // ⭐ THE FIRING CONTROL. The caller invokes no check of its own; both families
  // exist only because the action's steps were read, and both are attributed to
  // the CALLER, which is what CI schedules.
  const compositeFollowed = followCompositeActions(
    compositeCallerWf,
    compositeReader({ '.github/actions/fixture-gate': compositeActionYml }),
  );
  const compositeVia = compositeFollowed.steps.flatMap((s) =>
    extractCheckInvocations(s.text, 'fixture.yml', { via: s.action }));
  t(
    'the caller itself invokes no check family, so the families below can only come from the action',
    extractCheckInvocations(compositeCallerWf, 'fixture.yml').length === 0,
  );
  t(
    '⭐ a command executed THROUGH a composite action is derived exactly as an inline one is'
      + ` (${compositeVia.map((i) => i.check).join(', ') || 'none'})`,
    compositeVia.map((i) => i.check).sort().join('|')
      === 'check:agent-model-declared|scripts/check-nul-bytes.mjs',
  );
  t(
    '…attributed to the CALLING workflow, with the action file carried beside it as provenance',
    compositeVia.length > 0
      && compositeVia.every((i) => i.workflow === 'fixture.yml'
        && i.viaAction === '.github/actions/fixture-gate/action.yml'),
  );
  t(
    'and an INLINE invocation carries no viaAction at all, so the two spellings stay legible',
    extractCheckInvocations('    - run: node scripts/check-nul-bytes.mjs\n', 'fixture.yml')
      .every((i) => i.viaAction === undefined),
  );
  // ⭐ THE DARK CONTROL, both halves: with the action file gone the families
  // disappear (so they really came from it), and the absence is REPORTED rather
  // than skipped — GitHub refuses to start a job whose `uses: ./…` resolves to
  // nothing, so a derivation that dropped it quietly would describe a CI this
  // repo does not have.
  const compositeDark = followCompositeActions(compositeCallerWf, compositeReader({}));
  t(
    'the dark control fires — with no action file behind the `uses:`, not one family is derived',
    compositeDark.steps.length === 0
      && compositeDark.steps.flatMap((s) => extractCheckInvocations(s.text, 'fixture.yml')).length === 0,
  );
  t(
    '…and the absence is NAMED, never skipped (#4690)',
    compositeDark.unresolved.join('|') === '.github/actions/fixture-gate',
  );
  // An action may `uses:` a sibling. A one-hop follow would re-open this card's
  // own blind spot one level down, so the walk recurses — and terminates on a
  // cycle rather than spinning, which a fixture asserts rather than a comment.
  const nestedOuter = ['runs:', '  using: composite', '  steps:', '    - uses: ./.github/actions/inner', ''].join('\n');
  const nestedInner = ['runs:', '  using: composite', '  steps:', '    - shell: bash', '      run: node scripts/check-nul-bytes.mjs', ''].join('\n');
  const nested = followCompositeActions(
    '      - uses: ./.github/actions/outer\n',
    compositeReader({ '.github/actions/outer': nestedOuter, '.github/actions/inner': nestedInner }),
  );
  t(
    'the follow recurses — a gate an action reaches through a SECOND action is derived too',
    nested.steps.map((s) => s.dir).join('|') === '.github/actions/outer|.github/actions/inner'
      && nested.steps.flatMap((s) => extractCheckInvocations(s.text, 'fixture.yml')).length === 1,
  );
  const cyclicA = ['runs:', '  using: composite', '  steps:', '    - uses: ./.github/actions/b', ''].join('\n');
  const cyclicB = ['runs:', '  using: composite', '  steps:', '    - uses: ./.github/actions/a', ''].join('\n');
  t(
    'and a cycle terminates with each action read exactly once, rather than spinning',
    followCompositeActions(
      '      - uses: ./.github/actions/a\n',
      compositeReader({ '.github/actions/a': cyclicA, '.github/actions/b': cyclicB }),
    ).steps.map((s) => s.dir).join('|') === '.github/actions/a|.github/actions/b',
  );
  // ── LIVE: the card's own positive control, re-taken here ───────────────────
  //
  // Fixtures cannot prove the live derivation opens the tree at all. The card's
  // control is `.github/actions/setup-pnpm/action.yml` and its `run:` steps —
  // audited by nothing on the day the card was filed, and read by the discovery
  // pass now. A zero here is a follow that stopped following.
  const liveComposites = discoverFamilies().compositeActions ?? [];
  t(
    `⭐ the live discovery really opens the composite action tree (${liveComposites.join(', ') || 'none'})`,
    liveComposites.length > 0 && liveComposites.includes('.github/actions/setup-pnpm/action.yml'),
  );
  const liveCompositeRunSteps = liveComposites.reduce(
    (n, rel) => n + runCommandSteps(compositeActionRunsBlock(readFileSync(nodePath.join(ROOT, rel), 'utf8'))).length,
    0,
  );
  t(
    `…and really reads the steps in it — ${liveCompositeRunSteps} \`run:\` step(s) that no gate rooted at`
      + ' .github/workflows could see, which is the card\'s positive control',
    liveCompositeRunSteps > 0,
  );
  // ── The BOUNDARY, measured rather than assumed ─────────────────────────────
  //
  // A script path that reaches the command through a step `env:` value is
  // derived by NEITHER spelling — written inline in a workflow, or written in a
  // composite action. That is one blind spot and it is not this one: the
  // composite follow makes an action's step read EXACTLY like an inline step,
  // including where an inline step is already not derived. Pinned so nobody
  // reads a green follow as coverage of the env-carried class, and so the day
  // that class is closed it is closed for both spellings at once.
  const envCarriedStep = [
    '      - name: Run the sweep',
    '        shell: bash',
    '        env:',
    '          SWEEPER: ${{ steps.sources.outputs.root }}/scripts/pm/check-half-states.mjs',
    '        run: node "$SWEEPER" --format=markdown',
    '',
  ].join('\n');
  const envCarriedAction = ['runs:', '  using: composite', '  steps:', envCarriedStep].join('\n');
  t(
    'an env-carried script path is derived by neither spelling — the composite follow closes the ACTION'
      + ' boundary, not the env-carrier one',
    extractCheckInvocations(envCarriedStep, 'fixture.yml').length === 0
      && followCompositeActions('      - uses: ./.github/actions/c\n', compositeReader({ '.github/actions/c': envCarriedAction }))
        .steps.flatMap((s) => extractCheckInvocations(s.text, 'fixture.yml')).length === 0,
  );
  // The second declared deferral, sized rather than described: the always-runs
  // tail walks `jobs:` and a composite action has none, so its rows still
  // under-report by exactly the composite steps the follow now reads. Under-
  // reporting is the safe direction (a MISSING lead), and this number is what
  // makes the deferral honest instead of merely convenient.
  t(
    `the always-runs tail still reads no composite step — ${liveCompositeRunSteps} step(s) deferred, a`
      + ' MISSING lead and never a fabricated one; when this number matters, extend that walk',
    alwaysRunSteps(discoverFamilies().workflowEntries).rows.every((r) => r.workflow.endsWith('.yml')),
  );

  // ── The SCHEDULED-ONLY routing question, measured and answered ZERO (#14899)
  //
  // The card: the derivation named `node scripts/pm/check-half-states.mjs` —
  // a live board sweep — for any diff carrying a changeset, on the reading
  // that its only caller is a `schedule`-triggered workflow. Two things were
  // measured against the tree instead of accepted:
  //
  //   1. `half-state-patrol.yml` DOES declare a `pull_request:` trigger, with
  //      a `paths:` filter naming the sweeper and the workflow — it already
  //      did on the day the card was filed. So the specimen was never a
  //      workflow no PR runs; it is a patrol that exercises itself on the PRs
  //      that change it, the posture every patrol in this tree keeps.
  //   2. Across the whole tree, the number of discovered families whose
  //      source workflows ALL lack a PR-time trigger is ZERO — and it stays
  //      zero under the narrowest reading of "PR-time" as well.
  //
  // So the classification the card proposed has no members, and shipping it
  // would be a capability with nothing in it. What ships instead is this pin:
  // the reading is re-taken from the workflow text on every run, so the
  // deferral goes loud the day the population stops being empty. ⛔ The cases
  // below are the whole remedy for that day — they are not a roster to edit
  // when one reds. See the header section of the same name for the exits.
  const wfDirLive = nodePath.join(ROOT, '.github/workflows');
  const eventsWf = [
    'name: Fixture',
    '# a comment before the on: block',
    'on:',
    '  schedule:',
    "    - cron: '37 1,7,13,19 * * *'",
    '  workflow_dispatch: {}',
    '  # a comment between events',
    '  pull_request:',
    '    types: [opened, synchronize]',
    '    paths:',
    "      - 'scripts/pm/check-half-states.mjs'",
    // A decoy at an event's OWN depth-plus-one: a key under `pull_request:` is
    // not an event, however event-shaped its name.
    '    push:',
    '      branches: [main]',
    'jobs:',
    '  sweep:',
    // A decoy under `jobs:`, the shape a walk without the top-level reset eats.
    '    merge_group:',
    '      never: read',
    '',
  ].join('\n');
  const fixtureEvents = declaredTriggerEvents(eventsWf);
  t('the on: mapping\'s events are read in declaration order', fixtureEvents.join('|') === 'schedule|workflow_dispatch|pull_request');
  t('a key nested UNDER an event is not an event, however event-shaped its name', !fixtureEvents.includes('push'));
  t('a decoy event under jobs: is not read', !fixtureEvents.includes('merge_group'));
  t('an event\'s own sub-keys never enter the list', !fixtureEvents.includes('types') && !fixtureEvents.includes('paths') && !fixtureEvents.includes('branches'));
  t('the flow-sequence spelling is read', declaredTriggerEvents('on: [push, pull_request]\njobs: {}\n').join('|') === 'push|pull_request');
  t('the bare-scalar spelling is read', declaredTriggerEvents('on: push\njobs: {}\n').join('|') === 'push');
  t('the block-sequence spelling is read', declaredTriggerEvents('on:\n  - push\n  - schedule\njobs: {}\n').join('|') === 'push|schedule');
  // The YAML 1.1 coercion the two walkers above already accept: unquoted `on`
  // is the boolean `true`, so all three spellings name the same key.
  t('the quoted and YAML-1.1 spellings of the key are all read', ["'on'", '"on"', 'true'].every((k) => declaredTriggerEvents(`${k}:\n  schedule:\n    - cron: '0 1 * * *'\n`).join('|') === 'schedule'));
  t('a workflow declaring no on: block yields an empty list, not a fabricated event', declaredTriggerEvents('name: X\njobs: {}\n').length === 0);

  // The same reader against REAL `on:` blocks, read from the tree rather than
  // pasted: a quoted copy of a workflow is a second revision of it waiting to
  // rot, which is what this whole file refuses.
  const eventsOfWorkflow = new Map();
  for (const f of readdirSync(wfDirLive).filter((x) => /\.ya?ml$/.test(x))) {
    eventsOfWorkflow.set(f, declaredTriggerEvents(readFileSync(nodePath.join(wfDirLive, f), 'utf8')));
  }
  // ⚠️ The specimen lost its SCHEDULE on 2026-09-21 (ruling #208 on #19491,
  // executed by #19497: the patrol is `workflow_dispatch`-only now, and no line
  // of the sweeper was edited for it). Both cases below are re-pointed at the
  // fact each was always about — the PR-time trigger, and the withholding class
  // — and ⛔ nothing is added: pinning the absence of the schedule would be a
  // new ratchet, which this file may not grow without the maintainer's word.
  t(
    '⭐ the card\'s own specimen declares a pull_request trigger beside its workflow_dispatch — half-state-patrol.yml is not a workflow no PR runs',
    ['workflow_dispatch', 'pull_request'].every((e) => (eventsOfWorkflow.get('half-state-patrol.yml') ?? []).includes(e)),
  );
  t(
    'and a genuinely scheduled-only workflow reads as one, so the predicate is not answering `pull_request` to everything (stale.yml)',
    (eventsOfWorkflow.get('stale.yml') ?? []).join('|') === 'schedule|workflow_dispatch',
  );

  // The live half. Fixtures cannot prove the tree has no scheduled-only
  // family; this reads it.
  const reachesPRTime = (workflows, prTime = PR_TIME_TRIGGER_EVENTS) =>
    [...workflows].some((wf) => (eventsOfWorkflow.get(wf) ?? []).some((e) => prTime.includes(e)));
  const isScheduled = (wf) => (eventsOfWorkflow.get(wf) ?? []).includes('schedule');
  const triggerFamilies = [...discoverFamilies().byCheck.values()];
  const scheduledWorkflows = [...eventsOfWorkflow.keys()].filter(isScheduled);
  const scheduledContributors = scheduledWorkflows.filter((wf) => triggerFamilies.some((e) => e.workflows.has(wf)));
  const fromScheduled = triggerFamilies.filter((e) => [...e.workflows].some(isScheduled));
  const scheduledOnly = triggerFamilies.filter((e) => !reachesPRTime(e.workflows) && [...e.workflows].every(isScheduled));
  // Non-vacuity, both halves — a zero over an empty sweep is a broken
  // instrument wearing a clean result's clothes, which is #4690's shape.
  t(
    `the live tree really declares ${scheduledWorkflows.length} schedule-triggered workflow(s), so the sweep below has a population`,
    scheduledWorkflows.length > 0,
  );
  t(
    `…and ${scheduledContributors.length} of them really contribute discovered families (${fromScheduled.length} famil(ies)), so the zero below is a reading`,
    scheduledContributors.length > 0 && fromScheduled.length > 0,
  );
  t(
    `⭐ ZERO of the ${triggerFamilies.length} discovered families is SCHEDULED-ONLY — every one reaches a workflow that declares a PR-time`
      + ' event, so no board sweep is routed into a per-PR gate list. If this reds, a scheduled-only family has ARRIVED: give its'
      + ' workflow the pull_request paths trigger every patrol here already carries, or ship the withheld class the header defers',
    scheduledOnly.length === 0,
  );
  t(
    '…and the reading does not depend on how wide PR-time is drawn: narrowing it to `pull_request` alone leaves the same zero',
    triggerFamilies.filter((e) => !reachesPRTime(e.workflows, ['pull_request']) && [...e.workflows].every(isScheduled)).length === 0,
  );
  // The complement, so the zero above cannot be the union quietly hiding a
  // member: a family reached by NO PR-time event at all must come from a
  // workflow that declares no `schedule` either. Today that is `cut-rc.yml`,
  // the human release lane, which is `workflow_dispatch`-only.
  const noPRTime = triggerFamilies.filter((e) => !reachesPRTime(e.workflows));
  t(
    `the complement agrees: all ${noPRTime.length} famil(ies) reached by no PR-time event at all come from workflows that declare no schedule`,
    noPRTime.every((e) => [...e.workflows].every((wf) => !isScheduled(wf))),
  );
  // The control the card's ruling names: a family from a scheduled workflow
  // that ALSO declares a PR-time trigger keeps the class it already had. The
  // card's own specimen is the subject — it is withheld from `--commands` by
  // the value-bearing class (#15083) and by nothing else, which is why the
  // 3m09s it measured is gone without any scheduled-only rule existing.
  const sweepEntry = triggerFamilies.find((e) => e.check.startsWith('scripts/pm/check-half-states.mjs'));
  t(
    'the card\'s specimen is still discovered, still reached only through its patrol, and still classified VALUE-BEARING — withheld by that class and by nothing else',
    Boolean(sweepEntry)
      && [...sweepEntry.workflows].join('|') === 'half-state-patrol.yml'
      && reachesPRTime(sweepEntry.workflows)
      && Boolean(sweepEntry.notRunnable)
      && !sweepEntry.ciOnly,
  );
  // And the half this card must NOT move: the OFFLINE self-test lint.yml runs
  // on every PR stays a runnable command. It is the same script's other
  // spelling, and a rule keyed on the sweeper's name rather than on the
  // workflow text — the per-script exclusion the ruling refused — would have
  // taken this one with it.
  const offlineHalf = triggerFamilies.find((e) => e.check === 'check:pm-half-states');
  t(
    'and the offline half CI runs on every PR is untouched — check:pm-half-states reaches lint.yml, carries neither withholding class, and still renders a runnable command',
    Boolean(offlineHalf)
      && offlineHalf.workflows.has('lint.yml')
      && reachesPRTime(offlineHalf.workflows)
      && !offlineHalf.ciOnly
      && !offlineHalf.notRunnable,
  );

  // ── The population a job `if:` names one hop away (#12956) ────────────────
  //
  // The card: an `.objectui-sha` diff derived NO pin-critical gate, because
  // ci.yml declares no workflow `paths:` at all — its filtering lives in a
  // `filter` job's dorny/paths-filter step, read by every other job's `if:`.
  // The fixture carries every shape that must be READ and every shape that must
  // be REFUSED, because the refusals are the half that keeps a widening from
  // fabricating leads across a whole workflow at once.
  const jobFilterWf = [
    'name: Fixture',
    'on:',
    '  pull_request:',
    '    branches: [main]',
    'jobs:',
    '  filter:',
    '    runs-on: ubuntu-latest',
    '    outputs:',
    "      console: ${{ steps.changes.outputs.console || 'true' }}",
    // The indirection is real: the job output NAME and the filter name differ.
    "      area: ${{ steps.changes.outputs.core || 'true' }}",
    '    steps:',
    '      - uses: dorny/paths-filter@v4',
    '        id: changes',
    '        with:',
    '          filters: |',
    '            console:',
    "              - '.objectui-sha'",
    '            core:',
    "              - 'packages/**'",
    '              # a comment between entries',
    "              - 'apps/!(docs)/**'",
    '  console-pin:',
    '    name: Console Pin Gate',
    '    needs: filter',
    "    if: ${{ !cancelled() && needs.filter.outputs.console != 'false' }}",
    '    steps:',
    '      - run: pnpm check:console-sha',
    '  both:',
    '    name: Two Areas',
    "    if: ${{ !cancelled() && (needs.filter.outputs.console != 'false' || needs.filter.outputs.area != 'false') }}",
    '    steps:',
    '      - run: pnpm check:two',
    '  always-on:',
    '    name: Always',
    '    steps:',
    '      - run: pnpm check:always',
    '  intersected:',
    '    name: Intersected',
    "    if: ${{ needs.filter.outputs.console != 'false' && needs.filter.outputs.area != 'false' }}",
    '    steps:',
    '      - run: pnpm check:intersected',
    '',
  ].join('\n');

  const fixtureJobs = extractJobBlocks(jobFilterWf);
  t(
    'every job under jobs: is segmented, and nothing above it is',
    fixtureJobs.map((j) => j.id).join('|') === 'filter|console-pin|both|always-on|intersected',
  );
  t(
    "a job's declared name is read, and an unnamed job falls back to its id",
    fixtureJobs.find((j) => j.id === 'console-pin')?.name === 'Console Pin Gate'
      && fixtureJobs.find((j) => j.id === 'filter')?.name === 'filter',
  );
  t(
    'a job block keeps its own steps and NOT the next job\'s',
    fixtureJobs.find((j) => j.id === 'console-pin')?.text.includes('check:console-sha')
      && !fixtureJobs.find((j) => j.id === 'console-pin').text.includes('check:two'),
  );
  const fixtureSteps = extractPathsFilterSteps(jobFilterWf);
  t('the paths-filter step is keyed by the id downstream references use', fixtureSteps.has('changes'));
  t(
    'its filters block scalar is parsed into named glob lists',
    fixtureSteps.get('changes')?.get('console')?.join('|') === '.objectui-sha'
      && fixtureSteps.get('changes')?.get('core')?.join('|') === 'packages/**|apps/!(docs)/**',
  );
  t(
    "the job's outputs: mapping is resolved to the STEP output each value reads, not assumed to share its name",
    (() => {
      const src = extractJobOutputSources(fixtureJobs.find((j) => j.id === 'filter').text);
      return src.get('console')?.output === 'console' && src.get('area')?.output === 'core'
        && src.get('area')?.step === 'changes';
    })(),
  );

  // The `if:` whitelist, in both directions. Everything the live tree spells is
  // read; everything else is refused rather than approximated.
  t(
    "the live spelling reads: !cancelled() is stripped and != 'false' is the run condition",
    jobFilterOutputRefs("${{ !cancelled() && needs.filter.outputs.console != 'false' }}")
      ?.map((r) => `${r.job}.${r.output}`).join('|') === 'filter.console',
  );
  t(
    'an OR of two outputs reads as BOTH, in declaration order',
    jobFilterOutputRefs("${{ !cancelled() && (needs.filter.outputs.core != 'false' || needs.filter.outputs.crosspkg != 'false') }}")
      ?.map((r) => r.output).join('|') === 'core|crosspkg',
  );
  t("the == 'true' spelling of the same condition reads too", jobFilterOutputRefs("${{ needs.filter.outputs.core == 'true' }}")?.length === 1);
  t('an AND of two filter outputs is REFUSED — that is an intersection this does not compute', jobFilterOutputRefs("${{ needs.f.outputs.a != 'false' && needs.f.outputs.b != 'false' }}") === null);
  t('an INVERTED comparison is refused, not read as its opposite', jobFilterOutputRefs("${{ needs.f.outputs.a == 'false' }}") === null);
  t('a term this cannot read refuses the WHOLE expression', jobFilterOutputRefs("${{ github.event_name == 'push' || needs.f.outputs.a != 'false' }}") === null);
  t('an if: naming no filter output at all yields no population', jobFilterOutputRefs("${{ github.ref == 'refs/heads/main' }}") === null);
  t('an absent if: is not an expression', jobFilterOutputRefs(null) === null);

  const fixturePops = jobPathPopulations(jobFilterWf, 'fixture.yml');
  t(
    'only the jobs whose if: RESOLVED and that invoke a check family contribute a population',
    fixturePops.map((p) => p.job).join('|') === 'console-pin|both',
  );
  t(
    'the console job resolves to the globs its filter declares, and names the check it runs',
    fixturePops[0].paths.join('|') === '.objectui-sha' && fixturePops[0].checks.join('|') === 'check:console-sha',
  );
  t(
    'a two-output if: takes the UNION of both filters',
    fixturePops[1].paths.join('|') === '.objectui-sha|packages/**',
  );
  t(
    'the extglob entry is DROPPED and COUNTED, never translated with a language that lacks it',
    fixturePops[1].dropped === 1 && !fixturePops[1].paths.some((p) => p.includes('!(')),
  );
  t(
    'a job CI schedules unconditionally contributes nothing — it discriminates no path',
    !fixturePops.some((p) => p.job === 'always-on'),
  );
  t(
    'and the AND-joined job contributes nothing rather than an over-claimed union',
    !fixturePops.some((p) => p.job === 'intersected'),
  );
  t(
    'an extglob NEGATION refuses the whole population — dropping it would WIDEN what is claimed',
    jobFilterPopulation(
      { if: "${{ needs.f.outputs.a != 'false' }}" },
      new Map([['f.a', ['packages/**', '!(vendor)/**']]]),
    ) === null,
  );
  t(
    'a workflow with no paths-filter step at all yields no job populations',
    jobPathPopulations("on:\n  pull_request:\n    branches: [main]\njobs:\n  a:\n    steps:\n      - run: pnpm check:x\n", 'x.yml').length === 0,
  );

  // Matching, and the precedence question the new key raises. A job filter is a
  // DECLARATION CI obeys, so it outranks a literal scanned out of a script and
  // sits under the workflow trigger, which decides whether the job runs at all.
  const jfEntry = {
    files: [], hints: ['scripts/somewhere'], triggers: [],
    jobFilters: [{ workflow: 'ci.yml', job: 'console-pin', name: 'Console Pin Gate', outputs: ['filter.console'], paths: ['.objectui-sha'], dropped: 0 }],
  };
  t(
    'a job filter matches its path and names the JOB a dev will see go red',
    coveringKey(jfEntry, '.objectui-sha')?.via === "CI job filter for 'Console Pin Gate' in ci.yml",
  );
  t('a path the job filter does not cover gains nothing from it', coveringKey(jfEntry, 'packages/spec/src/x.ts') === null);
  t(
    'the workflow trigger still outranks the job filter where both fire',
    coveringKey({ ...jfEntry, triggers: [{ workflow: 'ci.yml', paths: ['.objectui-sha'] }] }, '.objectui-sha')?.via
      === 'CI trigger in ci.yml',
  );
  t(
    'and the job filter outranks a scanned hint that also covers',
    coveringKey({ ...jfEntry, hints: ['.objectui-sha'] }, '.objectui-sha')?.via
      === "CI job filter for 'Console Pin Gate' in ci.yml",
  );
  t(
    'a family with no job filters is unchanged by the new key',
    coveringKey({ files: [], hints: ['scripts/somewhere'], triggers: [] }, 'scripts/somewhere/x.mjs')?.via === 'gate source',
  );

  // ── LIVE: the card's acceptance criterion, pinned against the real ci.yml ──
  //
  // Pinned rather than left to the fixture, because the whole finding was that
  // the FIXTURE-shaped question ("can it follow an indirection?") had a
  // different answer from the LIVE one. If the console job is renamed or its
  // filter re-spelled, re-point these cases — do not delete them: they are the
  // measured statement that a pin bump derives its own gates.
  const liveCiPops = jobPathPopulations(readFileSync(nodePath.join(ROOT, '.github/workflows/ci.yml'), 'utf8'), 'ci.yml');
  const livePinJob = liveCiPops.find((p) => p.checks.includes('check:console-sha'));
  t('the live console job is found by the gate it runs', Boolean(livePinJob));
  t('and it is named Console Pin Gate — the name branch protection and the Checks tab use', livePinJob?.name === 'Console Pin Gate');
  t(
    'its derived population covers the pin file, which is the whole acceptance criterion',
    Boolean(livePinJob && triggerListCovers(livePinJob.paths, '.objectui-sha')),
  );
  t(
    'both console gates are reached, not just the one the card named',
    Boolean(livePinJob?.checks.includes('check:console-sha') && livePinJob?.checks.includes('check:console-injection')),
  );
  // The NEGATIVE control, and it is the half that keeps the widening honest: a
  // path in none of the four filters must derive nothing extra. AGENTS.md is a
  // repo-root file no filter names.
  t(
    'a path none of the live filters covers matches NO job filter — the widening is not a blanket',
    !liveCiPops.some((p) => triggerListCovers(p.paths, 'AGENTS.md')),
  );
  t(
    'and the same sweep DOES cover a packages/ path, so that zero is a reading rather than a broken instrument',
    liveCiPops.some((p) => triggerListCovers(p.paths, 'packages/spec/src/index.ts')),
  );

  // The pattern language. `*` must not cross a slash and `**` must, or a
  // trigger reads as narrower or wider than the one CI obeys.
  t('a double-star trigger covers a file any depth below it', triggerCovers('packages/spec/**', 'packages/spec/src/data/filter.zod.ts'));
  t('a single star does NOT cross a path separator', !triggerCovers('packages/*', 'packages/spec/src/index.ts'));
  t('the same single star still covers a direct child', triggerCovers('packages/*', 'packages/spec'));
  t('a leading double-star reaches a nested file', triggerCovers('**/package.json', 'packages/spec/package.json'));
  t('an exact-file trigger covers exactly that file', triggerCovers('pnpm-workspace.yaml', 'pnpm-workspace.yaml'));
  t('an unrelated path is not covered', !triggerCovers('packages/spec/**', 'packages/rest/src/server.ts'));
  t('a dot in a trigger is a literal dot, not a wildcard', !triggerCovers('pnpm-lock.yaml', 'pnpm-lockXyaml'));
  // The directory-surface reach and the reach deliberately refused — a card's
  // file surface is often given as a directory, but a pattern whose literal
  // prefix is empty could sit under ANY directory and must not claim one.
  t('a directory surface derives a trigger that reaches into it', triggerCovers('packages/spec/**', 'packages/spec'));
  t('a leading-wildcard trigger does NOT claim an arbitrary directory surface', !triggerCovers('**/package.json', 'packages/spec'));
  t('nor a sibling directory sharing a name prefix', !triggerCovers('packages/spec/**', 'packages/spec-extra'));

  // Ordered negation, both directions — CI evaluates the list in order and so
  // must this, or an excluded path derives a job that will never run on it.
  t('a plain list answers with the pattern that covered', triggerListCovers(['docs/**', 'packages/spec/**'], 'packages/spec/x.ts') === 'packages/spec/**');
  t('a later negation excludes what an earlier pattern included', triggerListCovers(['packages/**', '!packages/spec/**'], 'packages/spec/x.ts') === null);
  t('a later positive re-includes it', triggerListCovers(['packages/**', '!packages/spec/**', 'packages/spec/src/**'], 'packages/spec/src/x.ts') === 'packages/spec/src/**');
  t('a list of negations alone covers nothing', triggerListCovers(['!packages/**'], 'packages/spec/x.ts') === null);
  t('an empty list covers nothing — no filter is not a filter that matches all', triggerListCovers([], 'packages/spec/x.ts') === null);

  // Precedence and the bucket. A trigger match must outrank a scanned literal
  // (a declaration beats an inference) and must never be allowed to answer the
  // bucket's question, which is about the gate's SOURCE.
  const triggered = { files: [], hints: [], triggers: [{ workflow: 'spec-liveness-check.yml', paths: ['packages/spec/**'] }] };
  t('a family with no hints at all is MATCHED when CI schedules it', classifyEntry(triggered, ['packages/spec/src/x.ts']).verdict === 'matched');
  // Read defensively: a regression here produces NO hit, and an assertion that
  // indexed straight into `hits[0]` would throw and abort the whole self-test
  // run — every case below it, the live liveness pins included, would then stop
  // reporting. A gate that fails must still say what else it checked.
  t('and its provenance says the claim came from CI, not from a string in a script', Boolean(classifyEntry(triggered, ['packages/spec/src/x.ts']).hits[0]?.via?.includes('spec-liveness-check.yml')));
  t('the same family is still undetermined for a card the workflow does not schedule', classifyEntry(triggered, ['packages/rest/src/server.ts']).verdict === 'undetermined');
  const allThreeKeys = {
    files: ['scripts/check-x.mjs'],
    hints: ['packages/spec/src'],
    triggers: [{ workflow: 'w.yml', paths: ['packages/spec/**'] }],
  };
  t('identity still outranks CI trigger', coveringKey(allThreeKeys, 'scripts/check-x.mjs')?.via === 'gate script');
  t('CI trigger outranks a scanned literal that also covers', coveringKey(allThreeKeys, 'packages/spec/src/x.ts')?.via === 'CI trigger in w.yml');
  t('a scanned literal still answers where no trigger covers', coveringKey({ hints: ['packages/rest/src'], triggers: [{ workflow: 'w.yml', paths: ['packages/spec/**'] }] }, 'packages/rest/src/x.ts')?.via === 'gate source');
  t('an entry with no triggers at all behaves exactly as before', coveringKey({ files: [], hints: ['packages/spec/src'] }, 'packages/spec/src/x.ts')?.via === 'gate source');

  // The card's own specimen, end to end against the LIVE workflow: the trigger
  // is read off the file rather than inferred from the one hit that surfaced
  // this (a `packages/objectql/**` path, which is NOT in the list at all — the
  // job ran because that PR also touched a path that is). If this workflow is
  // renamed or its gates move, re-point these cases; do not delete them.
  const livenessWf = readFileSync(nodePath.join(ROOT, '.github/workflows/spec-liveness-check.yml'), 'utf8');
  const livenessTriggers = extractTriggerPaths(livenessWf);
  t('the liveness workflow really declares a path filter', livenessTriggers.length > 0);
  const livenessFamilies = extractCheckInvocations(livenessWf, 'spec-liveness-check.yml').map((i) => i.check);
  t('check:liveness really is one of that workflow\'s families', livenessFamilies.includes('check:liveness'));
  const livenessEntry = { files: [], hints: [], triggers: [{ workflow: 'spec-liveness-check.yml', paths: livenessTriggers }] };
  t('so a card editing the spec now derives it', classifyEntry(livenessEntry, ['packages/spec/src/data/filter.zod.ts']).verdict === 'matched');
  t('a dogfood proof edit derives it too — the ADR-0054 half of the same job', classifyEntry(livenessEntry, ['packages/qa/dogfood/src/some.test.ts']).verdict === 'matched');
  t('and a hand-written doc page, which is why the trigger is read and not guessed at packages/spec', classifyEntry(livenessEntry, ['content/docs/reference/apps.mdx']).verdict === 'matched');
  t('while an unrelated package still derives nothing from it', classifyEntry(livenessEntry, ['packages/rest/src/server.ts']).verdict === 'undetermined');

  // The table's own rot detector: a name no live run discovers must say so,
  // never disappear quietly.
  const stale = changeKindLines(['a.test.ts'], () => null);
  // Seven, not six, since #10542 added check:cross-package-test-inputs to the
  // test-file kind. `a.test.ts` is a root-level TypeScript file, so it is BOTH
  // a test file and inside the root tsc program and legitimately hits two
  // kinds. The ratchet therefore renders twice, under a different `why` each
  // time — pinned just below, because a bare count cannot tell that apart from
  // one kind rotting away.
  t('an undiscoverable gate renders as STALE', stale.filter((l) => l.includes('STALE')).length === 7);
  t('a root-level test file hits both kinds, so the ratchet renders STALE under each', stale.filter((l) => l.includes('\u26a0 check:type-check-debt: STALE')).length === 2);
  // Per NAME, anchored on both sides of the rendered name (`⚠ x: STALE`), so the
  // pair that shares one script is reported apart: a count alone stays green if
  // one of the two is dropped from the table and something else is added, and a
  // leading substring stays green through a `-v2` rename — the two ways this
  // table has actually rotted.
  t('the coverage half renders STALE under its own name', stale.some((l) => l.includes('⚠ check:type-check-coverage: STALE')));
  t(
    'and so does the cross-package-inputs entry, anchored on both sides of its own name',
    stale.some((l) => l.includes('⚠ check:cross-package-test-inputs: STALE')),
  );
  t('the ratchet half renders STALE under its own name', stale.some((l) => l.includes('⚠ check:type-check-debt: STALE')));
  t('the engine-double ratchet renders STALE under its own name', stale.some((l) => l.includes('⚠ check:engine-double-contract: STALE')));
  t('the where-matcher ratchet renders STALE under its own name', stale.some((l) => l.includes('⚠ check:where-matcher: STALE')));
  const i18nStale = changeKindLines(['packages/services/service-messaging/scripts/i18n-extract.config.ts'], () => null);
  t('an undiscoverable check:i18n renders as STALE', i18nStale.filter((l) => l.includes('⚠ check:i18n: STALE')).length === 1);
  t('every declared convention gate carries a reason', CHANGE_KIND_GATES.every((k) => k.gates.every((g) => g.name && g.why)));

  // ── The census guard (#8632) ──────────────────────────────────────────────
  //
  // CHANGE_KIND_GATES is the one enumerable list in this file, so it is the one
  // list a guard can hold. The STALE branch reports a rotted name to whoever
  // reads the output; this case makes the same rot fail CI, against the REAL
  // workflow tree rather than a fixture. Discovery is repeated here rather than
  // borrowed from `derive`, which prints instead of returning — the assertion is
  // "every name in the table is a family the workflows really run", and it needs
  // the live population to mean anything.
  const liveFamilies = new Set();
  for (const wf of readdirSync(nodePath.join(ROOT, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f))) {
    for (const i of extractCheckInvocations(readFileSync(nodePath.join(ROOT, '.github/workflows', wf), 'utf8'), wf)) {
      liveFamilies.add(i.check);
    }
  }
  t('the live workflows discover a farm at all (the guard is not vacuous)', liveFamilies.size > 20);
  const declared = CHANGE_KIND_GATES.flatMap((k) => k.gates.map((g) => g.name));
  const missing = declared.filter((n) => !liveFamilies.has(n));
  t(`every convention gate named in the table is a live family (missing: ${missing.join(', ') || 'none'})`, missing.length === 0);
  // The two gates this card moved out of the closing prose, pinned individually
  // — a count alone stays green if one is dropped and another added.
  t('check:engine-double-contract is a live family, so naming it in the table is not a guess', liveFamilies.has('check:engine-double-contract'));
  t('check:where-matcher is a live family too — the gate the prose never named', liveFamilies.has('check:where-matcher'));
  t(
    'check:cross-package-test-inputs is a live family (#10542 moved it here from a path derivation that could name it at 49.6% precision at best)',
    liveFamilies.has('check:cross-package-test-inputs'),
  );
  // #12850's entry, pinned here for the same reason and with one of its own:
  // its gate is reached only by a CONTENT predicate, so the census guard above
  // is the only thing standing between a rename and a lead that renders STALE
  // on a card nobody re-reads.
  t('check:dispatcher-error-vocabulary is a live family, so naming it is not a guess',
    liveFamilies.has('check:dispatcher-error-vocabulary'));
  // #22320's entry, the second content-reached gate, pinned for the same reason.
  t('check:error-status-conformance is a live family, so naming it is not a guess',
    liveFamilies.has('check:error-status-conformance'));

  // ── The test-file entry's deletion criterion, MEASURED (#11199) ───────────
  //
  // The card behind these cases reported that no local derivation ever named
  // `check:cross-package-test-inputs` for an edited test file. That is closed —
  // the entry above has been in the table since #10542 — and the reason these
  // cases exist rather than a seventh entry is what the re-measurement found:
  // the entry now READS redundant against its own stated deletion criterion,
  // and it is not. The full measurement is in that criterion's bullet in this
  // table's docblock; what is pinned here is every load-bearing half of it, so
  // the claim reddens instead of ageing.
  //
  // Both directions matter. The positive case keeps the redundancy honest (the
  // hint route really does reach an ordinary packages test file — Zone rule:
  // two routes to one gate is redundancy, never a bug, and neither may be
  // deleted BECAUSE of the other). The negative cases are the residue: a class
  // the hint route cannot reach in principle, with live tracked specimens.
  const XPKG = 'check:cross-package-test-inputs';
  const xpkgEntry = discoverFamilies().byCheck.get(XPKG);
  // Live specimens, one per residue reason. If either file is ever deleted or
  // renamed, re-point the case at another member of its class — and if a class
  // ever EMPTIES, that is the measurement to redo, not a case to drop.
  const OUTSIDE_PACKAGES = 'examples/app-crm/test/smoke.test.ts';   // not under packages/**
  const TSX_TEST = 'packages/client-react/src/realtime-hooks.test.tsx'; // not *.ts
  const APPS_TEST = 'apps/docs/src/x.test.ts';                      // no tracked member today
  t('the gate is discovered with hints at all, so these cases are not vacuous', (xpkgEntry?.hints ?? []).length > 0);
  t('both residue specimens are real tracked files, so the negatives are live rather than a pair of matching strings',
    existsSync(nodePath.join(ROOT, OUTSIDE_PACKAGES)) && existsSync(nodePath.join(ROOT, TSX_TEST)));
  t('the hint route really does reach an ordinary packages test file — the redundancy #12300 recovered is real',
    covers(xpkgEntry.hints, 'packages/spec/src/x.test.ts'));
  t('but no hint of this gate reaches a test file outside packages/**', !covers(xpkgEntry.hints, OUTSIDE_PACKAGES));
  t('nor a .tsx test file inside it', !covers(xpkgEntry.hints, TSX_TEST));
  t('nor one under apps/**, the class with no tracked member to lose', !covers(xpkgEntry.hints, APPS_TEST));
  // The entry itself, anchored on both sides of the rendered name the way the
  // STALE cases above are: a bare substring test stays green if some other
  // gate's `why` ever quotes this gate's name.
  t('the KIND names the gate for every one of them — delete the entry and this reddens',
    [OUTSIDE_PACKAGES, TSX_TEST, APPS_TEST].every((p) =>
      changeKindLines([p], (n) => n).some((l) => l.includes(`- ${XPKG}   —`))));
  // The fragility half: the covering hint is INHERITED from the declaration
  // table this gate imports (one package's declared turbo `inputs` glob), not
  // declared by the gate as its own population. `hintOrigin` carries exactly
  // that provenance, and it is what the output prints as `gate source via …`.
  const xpkgCovering = xpkgEntry.hints.find((h) => hintCovers(h, 'packages/spec/src/x.test.ts'));
  t('and that covering hint is inherited from a module the gate imports, not a population the gate declares',
    Boolean(xpkgEntry.hintOrigin?.get(xpkgCovering)));
  // The class-level claim, against the real corpus rather than two specimens:
  // while ANY tracked test file is unreachable by every hint this gate has, the
  // entry's deletion criterion is unmet. The day this reddens, re-measure the
  // criterion and either retire the entry with these cases or re-point them.
  const xpkgResidue = trackedFiles().filter((f) => isTestFilePath(f) && !covers(xpkgEntry.hints, f));
  t(`the tree still holds test files no hint of this gate reaches (${xpkgResidue.length}), so the entry is not redundant`,
    xpkgResidue.length > 0);

  // ── The test-file entry's hint-set prose, re-derived (#13232) ─────────────
  //
  // This entry's docblock used to TRANSCRIBE the three ratchets' hint sets and
  // conclude from the copy that all three score `silent`. Both halves went
  // false without anything editing this file — one ratchet grew a real
  // population literal (#13231), and the git ref two of the rows named stopped
  // being admitted as a hint at all — so the transcription is gone and what it
  // asserted is re-derived here instead. A red in this block means the prose
  // above is due a re-reading, not that the derivation broke.
  const WM = 'check:where-matcher';
  const QOE = 'check:query-options-erasure';
  const EDC = 'check:engine-double-contract';
  const ratchetEntries = new Map([WM, QOE, EDC].map((c) => [c, discoverFamilies().byCheck.get(c)]));
  t('all three ratchets are still discovered with hints, so nothing below is vacuous',
    [...ratchetEntries.values()].every((e) => (e?.hints ?? []).length > 0));
  // The half that survived: two of the three still name only artifacts, so
  // `silent` for every card in the tree is still the right description of them.
  const ORDINARY_TEST = 'packages/spec/src/x.test.ts';
  t(`${QOE} still names nothing that can cover a card's test file — the surviving half of the old paragraph`,
    !covers(ratchetEntries.get(QOE).hints, ORDINARY_TEST) && !covers(ratchetEntries.get(QOE).hints, OUTSIDE_PACKAGES));
  t(`…and so does ${EDC}`,
    !covers(ratchetEntries.get(EDC).hints, ORDINARY_TEST) && !covers(ratchetEntries.get(EDC).hints, OUTSIDE_PACKAGES));
  // The half that broke, pinned in the direction that broke it: the moment this
  // reddens, `check:where-matcher` is silent again and the ⚠ paragraph is wrong.
  t(`${WM} IS reached by the ordinary path derivation for a packages test file — the exception the prose states`,
    covers(ratchetEntries.get(WM).hints, ORDINARY_TEST));
  t('…and that covering hint is the gate\'s OWN declared population, not one inherited from a module it imports',
    !ratchetEntries.get(WM).hintOrigin?.get(ratchetEntries.get(WM).hints.find((h) => hintCovers(h, ORDINARY_TEST))));
  // Why it stays in the table regardless — the same two-direction argument the
  // #11199 block above makes for check:cross-package-test-inputs.
  t(`but no hint of ${WM} reaches a test file outside its scan root, while the KIND does`,
    !covers(ratchetEntries.get(WM).hints, OUTSIDE_PACKAGES)
      && changeKindLines([OUTSIDE_PACKAGES], (n) => n).some((l) => l.includes(`- ${WM}   —`)));
  const wmResidue = trackedFiles().filter((f) => isTestFilePath(f) && !covers(ratchetEntries.get(WM).hints, f));
  t(`the tree still holds test files no hint of ${WM} reaches (${wmResidue.length}), so its line is not redundant either`,
    wmResidue.length > 0);
  // The drift the deleted transcription could not report, closed at the source
  // rather than by re-copying: both sources still SPELL the ref, and neither
  // yields it as a hint. This is the case that reddens if the refusal is ever
  // relaxed and a row naming `origin/main` becomes writable again.
  const REF = ['origin', 'main'].join('/');
  const refSpellers = [ratchetEntries.get(QOE), ratchetEntries.get(WM)]
    .flatMap((e) => e.files ?? [])
    .filter((f) => existsSync(nodePath.join(ROOT, f)) && readFileSync(nodePath.join(ROOT, f), 'utf8').includes(`'${REF}'`));
  t(`both ratchet sources still spell ${REF} (${refSpellers.length}), so the next case is about the extractor and not a missing literal`,
    refSpellers.length === 2);
  t(`…and not one of them yields it as a hint, which is why no row here may name it`,
    refSpellers.every((f) => !extractWatchHints(readFileSync(nodePath.join(ROOT, f), 'utf8'), f).includes(REF)));

  // ── The check-family coverage guard (#9187) ───────────────────────────────
  //
  // `docs-drift-check.yml` declared a `paths:` filter and ran a real self-test
  // (`node scripts/docs-audit/affected-docs.mjs --self-test`) that discovery
  // could never see, because the naming convention every OTHER family follows
  // — `check:NAME` or `check-NAME.mjs` — is enforced nowhere: the tree just
  // happened to comply 103 times running up to this card. This section rules
  // it normative: a paths-filtered workflow with no discovered family is now
  // a CI failure, not a lead nobody could see. Fixture cases pin the shape;
  // the live case at the end pins it against the real tree, the same pairing
  // the census guard above uses.
  //
  // #11404 RE-BASED THE FIXTURE, and the reason is the card itself. This
  // section's original invisible-step fixture was verbatim the shape #9187
  // measured — `node scripts/some-mapper.mjs --self-test` — and the third
  // matcher in extractCheckInvocations now DISCOVERS that shape, so the
  // fixture stopped being an example of the thing it illustrates. The
  // invisible step here is now a `node scripts/…` command that is neither a
  // `check-` basename nor a self-test, which is what genuinely has no family
  // today; the retired shape is pinned as discovered two cases below, so the
  // pair records the move rather than losing it.
  const noFamilyWf = [
    'name: X',
    'on:',
    '  pull_request:',
    '    paths:',
    "      - 'packages/**'",
    'jobs:',
    '  j:',
    '    steps:',
    '      - name: Run the mapper',
    '        run: node scripts/some-mapper.mjs --emit',
  ].join('\n');
  t(
    'a paths-filtered workflow discovering no check family is a coverage gap',
    checkFamilyCoverageGaps([{ file: 'x.yml', text: noFamilyWf }]).includes('x.yml'),
  );
  const familyWf = noFamilyWf.replace(
    'node scripts/some-mapper.mjs --emit',
    'pnpm check:some-mapper',
  );
  t(
    'a paths-filtered workflow that DOES discover a family is not a gap',
    checkFamilyCoverageGaps([{ file: 'x.yml', text: familyWf }]).length === 0,
  );
  // The retired fixture, kept as the pin for what #11404 changed: the exact
  // step #9187 recorded as undiscoverable is a family now, so the same
  // workflow is no longer a coverage gap.
  const selfTestFamilyWf = noFamilyWf.replace(
    'node scripts/some-mapper.mjs --emit',
    'node scripts/some-mapper.mjs --self-test',
  );
  t(
    "the step #9187 measured as invisible is discovered now, so its workflow is no longer a gap",
    checkFamilyCoverageGaps([{ file: 'x.yml', text: selfTestFamilyWf }]).length === 0,
  );
  const unfilteredNoFamilyWf = [
    'name: X',
    'on:',
    '  pull_request: {}',
    'jobs:',
    '  j:',
    '    steps:',
    '      - name: Run the mapper',
    '        run: node scripts/some-mapper.mjs --emit',
  ].join('\n');
  t(
    'an UNFILTERED workflow with no family is not a gap — it runs on every PR regardless, the residue bucket already accounts for it',
    checkFamilyCoverageGaps([{ file: 'x.yml', text: unfilteredNoFamilyWf }]).length === 0,
  );
  t(
    'the declared opt-out reads its reason back',
    declaredNoCheckFamiliesReason('# dispatch-gates: no-check-families -- e2e build, no named verification (#9187)\n')
      === 'e2e build, no named verification (#9187)',
  );
  t('no marker present reads as no declared reason', declaredNoCheckFamiliesReason('# just a comment\n') === null);
  t('the marker with no reason text does not count as declared', declaredNoCheckFamiliesReason('# dispatch-gates: no-check-families\n') === null);
  const exemptedWf = noFamilyWf.replace(
    'jobs:',
    '# dispatch-gates: no-check-families -- fixture, not a real verification step\njobs:',
  );
  t(
    "a paths-filtered, zero-family workflow carrying the marker is NOT a gap — the declared opt-out this card's route requires",
    checkFamilyCoverageGaps([{ file: 'x.yml', text: exemptedWf }]).length === 0,
  );

  // ── This marker's reason is WHOLE, or the declaration is REFUSED (#18662) ──
  //
  // The capture was a fourth hand-written copy of the reason-tail grammar, so
  // the #18422 wholeness reading never reached it: a reason wrapped onto the
  // comment line below read back as line ONE and `checkFamilyCoverageGaps`
  // accepted the workflow without a sound. Measured on `origin/main`
  // 034f5a3afd before this change — the reading the cases below turn green.
  const wrappedNoFamilyWf = [
    'name: scaffold-e2e',
    'on:',
    '  pull_request:',
    "    paths: ['packages/create-objectstack/**']",
    '# dispatch-gates: no-check-families -- steps are an install/build/boot pipeline, and the verdict is',
    '# whether the scaffolded app boots at all, which no named local check family covers',
    '',
    'jobs:',
    '  e2e:',
    '    steps:',
    '      - run: pnpm install',
  ].join('\n');
  {
    let refused = null;
    try {
      declaredNoCheckFamiliesReason(wrappedNoFamilyWf, '.github/workflows/scaffold-e2e.yml');
    } catch (error) {
      refused = String(error.message);
    }
    t(
      'a no-check-families reason that does not END on the marker line is REFUSED, naming the workflow, the line, the marker and the continuation',
      refused !== null
        && refused.includes('.github/workflows/scaffold-e2e.yml declares no-check-families')
        && refused.includes('.github/workflows/scaffold-e2e.yml:6 continues it with')
        && refused.includes('"whether the scaffolded app boots at all, which no named local check family covers"')
        && refused.includes('The capture stops at the FIRST NEWLINE'),
      refused,
    );
  }
  t(
    'and the refusal reaches the ONE consumer this marker has — the boolean read in checkFamilyCoverageGaps refuses rather than accepting half a sentence',
    (() => {
      try {
        checkFamilyCoverageGaps([{ file: '.github/workflows/scaffold-e2e.yml', text: wrappedNoFamilyWf }]);
        return false;
      } catch (error) {
        return String(error.message).includes('declares no-check-families and its reason does not END on the marker line');
      }
    })(),
  );
  t(
    'the WHOLE-reason control still reads back and is still not a gap — the repair refuses a cut, it does not refuse the marker',
    (() => {
      const whole = wrappedNoFamilyWf.replace(
        '# whether the scaffolded app boots at all, which no named local check family covers\n',
        '',
      );
      return declaredNoCheckFamiliesReason(whole, '.github/workflows/scaffold-e2e.yml')
        === 'steps are an install/build/boot pipeline, and the verdict is'
        && checkFamilyCoverageGaps([{ file: '.github/workflows/scaffold-e2e.yml', text: whole }]).length === 0;
    })(),
  );
  t(
    'nor is an unrelated comment separated by a blank line a continuation — the terminator the three live declarations already write',
    declaredNoCheckFamiliesReason(
      '# dispatch-gates: no-check-families -- an e2e pipeline, not named local checks\n\n# an unrelated remark\njobs:\n',
      'x.yml',
    ) === 'an e2e pipeline, not named local checks',
  );
  // ⛔ `#` is the ONLY comment form YAML has, so the forms #18661 added cannot
  // apply to THIS marker: a `//` or slash-star line in a workflow is document
  // content, not a remark. Both directions are pinned — the restriction holds,
  // and it is a restriction of the shared roster rather than a second grammar.
  t(
    'a // or block-form spelling in a workflow is NOT a declaration — those are not comments in YAML',
    declaredNoCheckFamiliesReason('// dispatch-gates: no-check-families -- not a YAML comment\n') === null
      && declaredNoCheckFamiliesReason('/* dispatch-gates: no-check-families -- not a YAML comment */\n') === null
      && declaredNoCheckFamiliesReason('/** dispatch-gates: no-check-families -- not a YAML comment */\n') === null,
  );
  t(
    "and that restriction is the shared roster FILTERED, not a second pattern: the key's head lists exactly the `#` form",
    populationMarkerPattern('no-check-families').source.startsWith('^[ \\t]*(#)[ \\t]*dispatch-gates:'),
    populationMarkerPattern('no-check-families').source,
  );
  t(
    'the restriction NARROWS and nothing else — a key the table does not name keeps the whole roster',
    markerFormsFor('no-check-families').map((f) => f.label).join(' ') === '#'
      && markerFormsFor('no-path-population').length === MARKER_COMMENT_FORMS.length,
  );
  t(
    'every label MARKER_KEY_FORMS restricts a key to is one MARKER_COMMENT_FORMS really carries (the live half)',
    Object.values(MARKER_KEY_FORMS)
      .every((labels) => labels.every((l) => MARKER_COMMENT_FORMS.some((f) => f.label === l))),
  );
  t(
    'and a restriction naming a label the roster does NOT carry REFUSES, rather than emptying the alternation silently — a form set that quietly emptied would make every declaration of that key parse as nothing',
    (() => {
      try {
        markerFormsFor('no-check-families', { 'no-check-families': ['rem'] });
        return false;
      } catch (error) {
        return String(error.message).includes('may only ever NARROW the roster');
      }
    })(),
  );
  t(
    'the wholeness reading now REACHES this marker, in the same shape it reaches the population three',
    (() => {
      const cut = populationReasonContinuation(wrappedNoFamilyWf, 'no-check-families', 'w.yml');
      return cut?.line === 6 && cut?.kind === 'line' && cut?.file === 'w.yml'
        && cut?.text === 'whether the scaffolded app boots at all, which no named local check family covers';
    })(),
  );

  // ── The gate-level no-population declaration (#10542) ─────────────────────
  //
  // The workflow-level marker above says "this workflow names no gate"; this
  // one says "this gate names no path, and here is why". Both directions are
  // pinned, and so is the live tree, because the whole value of the second is
  // that it separates families that have been READ from families nobody has
  // looked at — and a marker that quietly stopped parsing would merge them back
  // together while every count still printed.
  t(
    'a gate-level no-population declaration reads its reason back',
    declaredNoPathPopulation('// dispatch-gates: no-path-population -- CI runs the self-test only\n')
      === 'CI runs the self-test only',
  );
  t(
    'the shell comment spelling is read too (shell gates carry # comments, and the derivation discovers them)',
    declaredNoPathPopulation('#!/usr/bin/env bash\n# dispatch-gates: no-path-population -- a shell gate reason\n')
      === 'a shell gate reason',
  );
  t('no marker present reads as no declared no-population', declaredNoPathPopulation('// just a comment\n') === null);
  t(
    'the marker with no reason text does not count as declared (an opt-out with no reason reads exactly like a placeholder nobody will revisit)',
    declaredNoPathPopulation('// dispatch-gates: no-path-population\n') === null,
  );
  t(
    'the marker must be its OWN line — a mention inside prose is a discussion of the convention, not a declaration under it',
    declaredNoPathPopulation('// see the dispatch-gates: no-path-population -- marker for how to opt out\n') === null,
  );

  // ── The gate-level WHOLE-TREE declaration (#14189) ────────────────────────
  //
  // The marker above says "this gate names no path". This one says the exact
  // opposite — "this gate reads every path" — and it exists because a gate
  // whose population is the whole tree had no truthful thing to say: the
  // honest literal is "every file", which this file's header prices as 22
  // leads and refuses. Every pin below is paired with the failure it catches;
  // the placement pins are the discriminating ones, and the mutation that
  // reddens them is deleting the declaration branch from `placeFamily`.
  t(
    'a whole-tree declaration reads its reason back',
    declaredWholeTreePopulation('// dispatch-gates: whole-tree-population -- it sweeps git ls-files\n')
      === 'it sweeps git ls-files',
  );
  t(
    'the shell comment spelling is read too (the two markers tolerate the same comment forms, deliberately)',
    declaredWholeTreePopulation('#!/usr/bin/env bash\n# dispatch-gates: whole-tree-population -- a shell gate reason\n')
      === 'a shell gate reason',
  );
  t('no marker present reads as no declared whole-tree population', declaredWholeTreePopulation('// just a comment\n') === null);
  t(
    'the marker with no reason text does not count as declared (the same refusal both other markers make, and for the same reason)',
    declaredWholeTreePopulation('// dispatch-gates: whole-tree-population\n') === null,
  );
  t(
    'the marker must be its OWN line — prose ABOUT the convention is not a declaration under it',
    declaredWholeTreePopulation('// see the dispatch-gates: whole-tree-population -- marker for the inverse case\n') === null,
  );
  // The two markers are OPPOSITE claims and must never read as each other. A
  // shared prefix and a sibling regex is exactly the shape where one parser
  // quietly answers for both.
  t(
    'a no-path-population declaration does NOT read as a whole-tree one',
    declaredWholeTreePopulation('// dispatch-gates: no-path-population -- CI runs the self-test only\n') === null,
  );
  t(
    'and a whole-tree declaration does NOT read as a no-path one',
    declaredNoPathPopulation('// dispatch-gates: whole-tree-population -- it sweeps git ls-files\n') === null,
  );

  // The liveness half. Each published spelling is pinned to the shape it was
  // written for, and each pin names the gate it was read off.
  t(
    'limb A reads the git enumeration of the tracked corpus (check-nul-bytes, check-refd-timer-probe, check-closing-keyword-parity)',
    repoRootWalkSpelling("const out = execFileSync('git', ['ls-files', '-z'], { cwd: root });")
      === REPO_ROOT_WALK_SPELLINGS[0].label,
  );
  t(
    'limb B reads a walk CALLED on the repo-root binding (check-watch-hint-literal)',
    repoRootWalkSpelling('const { rows } = audit(walk(REPO_ROOT));') === REPO_ROOT_WALK_SPELLINGS[1].label,
  );
  t(
    'limb C reads a walk whose DEFAULT PARAMETER is the repo-root binding (check-comment-mask-corpus, check-refd-timer-probe)',
    repoRootWalkSpelling('export function collectSources(root = REPO_ROOT) { return walk(root); }')
      === REPO_ROOT_WALK_SPELLINGS[2].label,
  );
  // The measured tightening. Written to accept a trailing argument, limb B
  // selected `resolve(REPO_ROOT, maskerPath)` — a path BUILD — and would have
  // vouched for practically any gate holding a REPO_ROOT constant, which is a
  // liveness check that cannot fail.
  t(
    'a path BUILD off the repo root is not a walk — the root must be the WHOLE argument',
    repoRootWalkSpelling("const target = resolve(REPO_ROOT, maskerPath);\nconst dir = join(REPO_ROOT, 'scripts');") === null,
  );
  // What a gate SAYS is not what it READS — the same normalization
  // `payloadEnvDependence` applies, and the same two ways to fail it.
  t(
    'a gate that only DESCRIBES a whole-tree walk in prose does not pass liveness',
    repoRootWalkSpelling("// this gate used to run git ls-files over walk(REPO_ROOT)\nconst x = 1;\n") === null,
  );
  t(
    "nor does one whose --self-test body stages a fixture tree (the self-test is not the gate's work)",
    repoRootWalkSpelling("function selfTest() {\n  execFileSync('git', ['ls-files', '-z'], { cwd: tmp });\n}\n") === null,
  );
  // The NEGATIVE direction: a walk seeded at a bounded subtree, which is why
  // #14325's census of six is a census of five here.
  //
  // The fixture string below is data, not a read of any file, so it cannot go
  // stale — but it also cannot show that the shape still EXISTS in this tree,
  // and a specimen named in prose can rot while every case here stays green.
  // That is exactly what happened to the name this comment used to carry
  // (#15510): `check-self-test-workflow-commands.mjs` was cited as the live
  // specimen and then had its walk removed, leaving a sentence pointing at a
  // file with no walk in it. So the specimens below are MEASURED, and there
  // are two of them at two different walk roots, so one file's repair cannot
  // empty the claim again:
  //
  //   scripts/check-self-test-wired.mjs   `walkScripts(scriptsDir)`, seeded at
  //                                       `join(ROOT, 'scripts')`
  //   scripts/check-spec-parsed-alias.mjs `walkZodFiles(SPEC_SRC)`, seeded at
  //                                       `join(ROOT, 'packages/spec/src')`
  //
  // Both read `null` from this predicate on this tree — the reading is pinned
  // LIVE two cases down, against their real source rather than against a
  // string typed here.
  t(
    'a walk seeded at a bounded subtree is not a repo-root walk',
    repoRootWalkSpelling("const scriptsDir = join(ROOT, 'scripts');\nconst files = walkScripts(scriptsDir);") === null,
  );

  // LIVE, on this tree: the two specimens the comment above names, read off
  // their real source rather than typed here (#15510). This is the half a
  // fixture cannot carry — that the shape the negative direction is written
  // for still exists in this repo — and it is the half that went stale last
  // time. Their walk ROOTS are named in the case text, so a reader who opens
  // one is told what to look for; a file that has gone is NOT MEASURED rather
  // than a quiet pass, per the convention at the top of this battery.
  const SUBTREE_WALK_SPECIMENS = [
    ['scripts/check-self-test-wired.mjs', "walkScripts(scriptsDir), seeded at join(ROOT, 'scripts')"],
    ['scripts/check-spec-parsed-alias.mjs', "walkZodFiles(SPEC_SRC), seeded at join(ROOT, 'packages/spec/src')"],
  ];
  // The floor (#13799): a loop over an emptied table runs zero cases and reads
  // exactly like a pass, and this table's whole purpose is to not be down to
  // one name again.
  t('the bounded-subtree specimen table still names two files at two walk roots', SUBTREE_WALK_SPECIMENS.length === 2);
  for (const [file, walk] of SUBTREE_WALK_SPECIMENS) {
    const abs = nodePath.join(ROOT, file);
    if (!existsSync(abs)) {
      unmeasurable(
        `the bounded-subtree walk specimen ${file}`,
        'the file is not in this tree, so its source cannot be read — name a specimen that is, or say plainly that only the fixture backs this direction.',
      );
      continue;
    }
    const src = readFileSync(abs, 'utf8');
    t(
      `LIVE: ${file} still holds a bounded-subtree walk (${walk})`,
      /walk[A-Za-z]*\(/.test(src),
    );
    t(
      `LIVE: …and this predicate reads ${file} as NOT a repo-root walk, the negative direction the fixture above stands for`,
      repoRootWalkSpelling(src) === null,
    );
  }


  // The refusals — the two contradictions the derivation must not resolve on
  // the gate's behalf.
  const wtLive = { wholeTreeReason: 'sweeps the tree', rootWalk: REPO_ROOT_WALK_SPELLINGS[0].label, noPopulationReason: null };
  t('a family declaring nothing is refused nothing', wholeTreePopulationRefusal({ wholeTreeReason: null }) === null);
  t('a declaration backed by a root walk stands', wholeTreePopulationRefusal(wtLive) === null);
  t(
    'a declaration with NO root walk behind it is refused, and the refusal publishes the recognised spellings',
    (() => {
      const why = wholeTreePopulationRefusal({ ...wtLive, rootWalk: null });
      return typeof why === 'string'
        && REPO_ROOT_WALK_SPELLINGS.every((sp) => why.includes(sp.label))
        && why.includes('EVERY card');
    })(),
  );
  t(
    'declaring BOTH whole-tree and no-path population is a contradiction, refused rather than resolved by a coin toss',
    (wholeTreePopulationRefusal({ ...wtLive, noPopulationReason: 'CI runs the self-test only' }) ?? '')
      .includes('BOTH whole-tree-population and no-path-population'),
  );

  // Placement. These are the pins the mutation reddens: delete the
  // `wholeTreeReason` branch from `placeFamily` and every one of them fails.
  const wtEntry = { files: ['scripts/check-nul-bytes.mjs'], hints: ['scripts/check-nul-bytes.mjs'], wholeTreeReason: 'sweeps the tree' };
  t('a declaring family is placed as always-runs', placeFamily(wtEntry, ['packages/rest/src/server.ts']).verdict === 'always-runs');
  t(
    'and its placement does not vary by card — that is the whole claim',
    ['docs/adr/0001-x.md', 'content/docs/index.mdx', 'scripts/check-nul-bytes.mjs', 'pnpm-workspace.yaml']
      .every((p) => placeFamily(wtEntry, [p]).verdict === 'always-runs'),
  );
  t(
    'NOT matched even for a card editing the gate\'s own script, where the identity key would otherwise hit',
    classifyEntry(wtEntry, ['scripts/check-nul-bytes.mjs']).verdict === 'matched'
      && placeFamily(wtEntry, ['scripts/check-nul-bytes.mjs']).verdict !== 'matched',
  );
  t(
    'NOT silent and NOT undetermined either — the two buckets it used to fall into by accident',
    !['silent', 'undetermined'].includes(placeFamily(wtEntry, ['packages/rest/src/server.ts']).verdict),
  );
  t('a declaring family carries no hits, so no rendering can print a lead for it', placeFamily(wtEntry, ['scripts/check-nul-bytes.mjs']).hits.length === 0);
  // The byte-identity half, and it is the constraint the card carries: this
  // channel must not move a single NON-declaring family. `placeFamily`
  // delegates unchanged, and this pin is what holds it to that.
  t(
    'a family that declares nothing is placed byte-for-byte as classifyEntry places it',
    [
      { files: ['scripts/check-silent.mjs'], hints: ['packages/spec/src'] },
      { files: ['scripts/check-empty.mjs'], hints: [] },
      { files: ['scripts/check-hit.mjs'], hints: ['packages/rest'] },
    ].every((e) => ['packages/rest/src/server.ts', 'docs/adr/0001-x.md', 'scripts/check-hit.mjs', 'packages/spec/src/index.ts']
      .every((p) => JSON.stringify(placeFamily(e, [p])) === JSON.stringify(classifyEntry(e, [p])))),
  );

  // The union and the reconciliation.
  const wtRow = { check: 'check:nul-bytes', command: 'pnpm check:nul-bytes', workflows: ['lint.yml'], reason: 'sweeps the tree', rootWalk: REPO_ROOT_WALK_SPELLINGS[0].label, refused: null, ciOnly: null };
  t(
    'a declaring family IS in the runnable union --commands prints, on a card whose paths reach nothing else',
    commandsFor({ matchedRows: [], kindGroups: [], alwaysRunsRows: [wtRow] }).includes('pnpm check:nul-bytes'),
  );
  t(
    'a CI-MEASURED declaring family contributes NO command — the exclusion follows the command, not the section',
    commandsFor({ matchedRows: [], kindGroups: [], alwaysRunsRows: [{ ...wtRow, ciOnly: { env: 'GITHUB_EVENT_PATH' } }] }).length === 0,
  );
  const wtRecon = familyReconciliation({
    matchedRows: [{ check: 'check:x', command: 'pnpm check:x', workflows: [], via: [], ciOnly: null }],
    kindGroups: [],
    alwaysRunsRows: [wtRow],
  });
  t('the reconciliation counts the whole-tree channel as its own term and still closes', wtRecon.total === 2 && wtRecon.alwaysRuns === 1 && wtRecon.alwaysRunsOnly === 1);
  t(
    'and counts a command reached BOTH ways ONCE — the same dedupe the `both` term makes one column over',
    (() => {
      const r = familyReconciliation({
        matchedRows: [{ check: 'check:nul-bytes', command: 'pnpm check:nul-bytes', workflows: [], via: [], ciOnly: null }],
        kindGroups: [],
        alwaysRunsRows: [wtRow],
      });
      return r.total === 1 && r.alwaysRuns === 1 && r.alwaysRunsOnly === 0;
    })(),
  );
  t(
    'the reconciliation lines STATE the third term rather than leaving the arithmetic unexplained',
    familyReconciliationLines(wtRecon).some((l) => l.includes('DECLARED whole-tree (the always-runs block)'))
      && familyReconciliationLines(wtRecon).some((l) => l.includes('DECLARE that their population is the WHOLE TREE')),
  );

  // The rendering.
  const wtLines = alwaysRunsPopulationLines([wtRow]);
  t('the always-runs section names the gate, its reason and the liveness spelling that vouches for it', wtLines.some((l) => l.includes('pnpm check:nul-bytes') && l.includes('sweeps the tree')) && wtLines.some((l) => l.includes(REPO_ROOT_WALK_SPELLINGS[0].label)));
  t('and says out loud that these are NOT leads', wtLines.some((l) => l.includes('NOT leads')));
  t(
    'its heading cannot be confused with the always-runs STEP tail, which opens on the same three words',
    wtLines[0].includes('Always runs (declared population)') && wtLines[0].includes('Not the always-runs STEP tail'),
  );
  t(
    'a REFUSED declaration prints as refused rather than vanishing from every rendering',
    alwaysRunsPopulationLines([{ ...wtRow, refused: 'declares whole-tree-population and its own source carries no recognised repo-root walk' }])
      .some((l) => l.includes('REFUSED')),
  );
  t('no declaring family, no section', alwaysRunsPopulationLines([]).length === 0);

  // The residue partition. A fourth placement wired into the derivation and
  // not into this sum shrinks the residue silently, which is the exact failure
  // residueLines' own throw exists to catch.
  const wtResidue = residueLines({
    discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 50, alwaysRuns: 5,
    unfiltered: 80, unreachable: 5, swept: 6000, artifactRosters: 4, invertedRosters: 1,
  });
  t('the residue accounts for the whole-tree bucket as a fourth term', wtResidue.some((l) => l.includes('5 always-runs')));
  t(
    'and REFUSES a derivation that placed families it did not count',
    (() => {
      try {
        residueLines({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 50, alwaysRuns: 0, unfiltered: 80, unreachable: 5, swept: 6000, artifactRosters: 4, invertedRosters: 1 });
        return false;
      } catch (err) {
        return /residue accounting is short/.test(err.message) && /always-runs/.test(err.message);
      }
    })(),
  );

  // ── The gate-level WIDE-population declaration (#15341) ───────────────────
  //
  // The THIRD channel, and the pins below are written as the ruling framed it:
  // one column it must reach (DECLARED, with its reason) and one it must not
  // (MATCHED, on any card under the roots it walks). The discriminating pins
  // are the placement ones; the mutation that reddens them is deleting the
  // `widePopulationReason` branch from `placeFamily`.
  t(
    'a wide-population declaration reads its reason back',
    declaredWidePopulation('// dispatch-gates: wide-population -- walks packages/ entire\n')
      === 'walks packages/ entire',
  );
  t(
    'the shell comment spelling is read too (all three markers tolerate the same comment forms, deliberately)',
    declaredWidePopulation('#!/usr/bin/env bash\n# dispatch-gates: wide-population -- a shell gate reason\n')
      === 'a shell gate reason',
  );
  t('no marker present reads as no declared wide population', declaredWidePopulation('// just a comment\n') === null);
  t(
    'the marker with no reason text does not count as declared — and the reason carries MORE here than on either sibling, since it is the whole content of the channel',
    declaredWidePopulation('// dispatch-gates: wide-population\n') === null,
  );
  t(
    'the marker must be its OWN line — prose ABOUT the convention is not a declaration under it',
    declaredWidePopulation('// see the dispatch-gates: wide-population -- marker for the refused-wide case\n') === null,
  );
  // Three markers now share a prefix and a sibling regex, which is exactly the
  // shape where one parser quietly answers for another. Every pair, both ways.
  t(
    'a no-path-population declaration does NOT read as a wide one, and a wide one does NOT read as no-path',
    declaredWidePopulation('// dispatch-gates: no-path-population -- CI runs the self-test only\n') === null
      && declaredNoPathPopulation('// dispatch-gates: wide-population -- walks packages/ entire\n') === null,
  );
  t(
    'a whole-tree declaration does NOT read as a wide one, and a wide one does NOT read as whole-tree',
    declaredWidePopulation('// dispatch-gates: whole-tree-population -- it sweeps git ls-files\n') === null
      && declaredWholeTreePopulation('// dispatch-gates: wide-population -- walks packages/ entire\n') === null,
  );

  // The refusals — a gate declares exactly ONE population shape.
  const wpLive = { widePopulationReason: 'walks packages/ entire', hints: [], noPopulationReason: null, wholeTreeReason: null };
  t('a family declaring nothing is refused nothing', widePopulationRefusal({ widePopulationReason: null }) === null);
  t('a wide declaration over an empty hint set stands', widePopulationRefusal(wpLive) === null);
  t(
    'declaring BOTH wide and no-path population is a contradiction, refused rather than resolved by a coin toss',
    (widePopulationRefusal({ ...wpLive, noPopulationReason: 'CI runs the self-test only' }) ?? '')
      .includes('BOTH wide-population and no-path-population'),
  );
  t(
    'declaring BOTH wide and whole-tree population is refused too, and the refusal names the OPPOSITE dispositions that make it one',
    (() => {
      const why = widePopulationRefusal({ ...wpLive, wholeTreeReason: 'sweeps git ls-files' }) ?? '';
      return why.includes('BOTH wide-population and whole-tree-population') && why.includes('runnable total');
    })(),
  );
  t(
    'a wide declaration sitting above a live path population is refused, and the refusal NAMES the literals so the reader can decide which half is wrong',
    (() => {
      const why = widePopulationRefusal({ ...wpLive, hints: ['packages/rest/src', 'docs/adr'] }) ?? '';
      return why.includes('NAMES paths') && why.includes('packages/rest/src');
    })(),
  );
  // #16828: the line is NOT "does the gate name any path" — an enumerated
  // exact-file member never contradicts a wide declaration, because
  // `hintCovers` can only ever match one by equality. `check:route-envelope`
  // is the specimen: a `MODULES` table keyed by 30-plus exact file paths,
  // none of them a claim about the population's width.
  t(
    'a wide declaration over ONLY exact-file hints stands — an enumerated member is not a competing spelling of the population',
    widePopulationRefusal({
      ...wpLive,
      hints: ['packages/rest/src/storage-routes.ts', 'packages/rest/src/error-response.ts'],
    }) === null,
  );
  // A hint that reaches beyond itself (no extension — a bare directory) is
  // still compatible when the marker's own reason text names it: the second,
  // separately audited surface `check:route-envelope`'s DISPATCHER_DOMAIN_DIR
  // is, held to the same "the reason is what a reader trusts" bar
  // `wholeTreePopulationRefusal` holds a repo-root walk to.
  t(
    'a directory hint that reaches beyond itself stands when the reason text names it by name',
    widePopulationRefusal({
      ...wpLive,
      widePopulationReason: 'walks packages/ entire; packages/runtime/src/domains is a second, separately audited surface',
      hints: ['packages/runtime/src/domains'],
    }) === null,
  );
  // The SAME directory hint, unnamed in the reason, is still refused — the
  // exemption is not "any directory a real gate happens to carry", it is
  // "an account the reader can check", and a silent one is not that.
  t(
    'the same directory hint is still refused when the reason does not name it — silence is not an account',
    (() => {
      const why = widePopulationRefusal({ ...wpLive, hints: ['packages/runtime/src/domains'] }) ?? '';
      return why.includes('NAMES paths') && why.includes('packages/runtime/src/domains');
    })(),
  );
  // A glob is never exempt this way, even repeated verbatim in the reason:
  // `judgedAsPattern` marks it as ITSELF a population spelling, and a reason
  // that only echoes it back is the same contradiction typed twice, not an
  // account of it. A bare trailing `/**` does NOT qualify — it COLLAPSES to
  // the identical plain directory prefix (`collapseHint`'s own docblock:
  // `packages/**` -> `packages`), so it is judged exactly like the directory
  // case above, on purpose. The species this asserts against is the one
  // `judgedAsPattern` actually flags: a glob in a NON-final segment.
  t(
    'a glob hint is refused even when the reason text repeats it back verbatim',
    (() => {
      const why = widePopulationRefusal({
        ...wpLive,
        widePopulationReason: 'walks packages/ entire; packages/*/src is already covered',
        hints: ['packages/*/src'],
      }) ?? '';
      return why.includes('NAMES paths') && why.includes('packages/*/src');
    })(),
  );
  // The bare-trailing-`/**` spelling is the CONTRAST case: it is not a
  // `judgedAsPattern` glob at all (it collapses to a plain prefix), so it is
  // exempt under the SAME "reason names it" rule as any other directory hint.
  t(
    'a bare trailing /** hint is not a glob for this purpose — it stands when the reason names it, same as a plain directory',
    widePopulationRefusal({
      ...wpLive,
      widePopulationReason: 'walks packages/ entire; packages/runtime/src/domains/** is a second, separately audited surface',
      hints: ['packages/runtime/src/domains/**'],
    }) === null,
  );
  // A mix of the two compatible shapes together stands — the predicate is
  // per-hint, not "the whole set must be one shape".
  t(
    'a mix of exact-file hints and a reason-named directory hint stands together',
    widePopulationRefusal({
      ...wpLive,
      widePopulationReason: 'walks packages/ entire; packages/runtime/src/domains is a second, separately audited surface',
      hints: ['packages/rest/src/storage-routes.ts', 'packages/runtime/src/domains'],
    }) === null,
  );

  // ── A declaration's reason is WHOLE, or the declaration is RED (#18422) ──
  //
  // All three markers above capture their reason with `(\S.*)$` under the `m`
  // flag, so the capture ends at the FIRST NEWLINE — and no refusal ever asked
  // whether it ended where the AUTHOR did. Measured on card #17472: a reason
  // wrapped over three comment lines reached the seat as a sentence that simply
  // stops, and the reason is the one thing a seat reads off that row. The cases
  // below are the contract in the marker docblock, one per clause. The
  // mutation that reddens the refusal group is deleting the
  // `populationReasonCutRefusal` call from either refusal; the group under it
  // is the control that the repair did not buy its new answers by widening the
  // marker to swallow whatever sits below a declaration.
  //
  // The #17472 first-draft shape, in its failing form: what the author wrote,
  // and the fragment the capture hands a seat.
  const wrappedDraft = [
    '// dispatch-gates: whole-tree-population -- the population is `git ls-files --stage`, the whole index, and the verdict is',
    '// the count of entries whose mode this gate refuses',
    '',
    "const MODE = '100644';",
  ].join('\n');
  t(
    'the #17472 draft shape: the capture still ends at the first newline — pinned as the DEFECT, not as a claim it went away',
    declaredWholeTreePopulation(wrappedDraft)
      === 'the population is `git ls-files --stage`, the whole index, and the verdict is',
  );
  t(
    'and the wholeness reading NAMES the line that continues it, which is what makes the cut detectable at all',
    (() => {
      const cut = populationReasonContinuation(wrappedDraft, 'whole-tree-population', 'scripts/check-x.mjs');
      return cut?.line === 2 && cut?.file === 'scripts/check-x.mjs'
        && cut?.text === 'the count of entries whose mode this gate refuses';
    })(),
  );
  t(
    'a one-line reason is not continued by the code under it — the shape 26 of the 27 live declarations already use',
    populationReasonContinuation('// dispatch-gates: wide-population -- walks packages/ entire\nconst X = 1;\n', 'wide-population')
      === null,
  );
  t(
    'nor by a blank line, a blank comment line, or EOF — a declaration is TERMINATED by any of the three',
    populationReasonContinuation('// dispatch-gates: wide-population -- walks packages/ entire\n\n// a new paragraph\n', 'wide-population') === null
      && populationReasonContinuation('// dispatch-gates: wide-population -- walks packages/ entire\n//\n// a new paragraph\n', 'wide-population') === null
      && populationReasonContinuation('// dispatch-gates: wide-population -- walks packages/ entire', 'wide-population') === null,
  );
  t(
    'a comment line that starts a NEW dispatch-gates key is a SECOND declaration, never a continuation of the first',
    populationReasonContinuation(
      '// dispatch-gates: whole-tree-population -- it sweeps git ls-files\n// dispatch-gates: no-path-population -- CI runs the self-test only\n',
      'whole-tree-population',
    ) === null,
  );
  t(
    'the comment FORM has to match — a # line under a // declaration is not a comment in that language, so it is continuing nothing',
    populationReasonContinuation('// dispatch-gates: no-path-population -- CI runs the self-test only\n# a shell comment\n', 'no-path-population')
      === null,
  );
  t(
    'the shell spelling is read the same way, continuation and all (shell gates carry # comments, and the derivation discovers them)',
    (() => {
      const cut = populationReasonContinuation(
        '#!/usr/bin/env bash\n# dispatch-gates: no-path-population -- every path this file writes or reads\n# lives inside a mktemp -d checkout\n',
        'no-path-population',
        'scripts/x.sh',
      );
      return cut?.line === 3 && cut?.text === 'lives inside a mktemp -d checkout';
    })(),
  );
  t(
    'an unknown marker key is REFUSED by both readings rather than answering "nothing is cut" — a channel is added to the roster, never by a fourth copy of the pattern',
    (() => { try { populationReasonContinuation('', 'made-up-population'); return false; } catch { return true; } })()
      && (() => { try { populationReasonCutRefusal({}, 'made-up-population'); return false; } catch { return true; } })(),
  );
  t(
    'the field roster and the marker roster name the SAME three channels — neither can grow one alone',
    Object.keys(POPULATION_DECLARATION_FIELDS).sort().join(' ') === [...POPULATION_MARKER_KEYS].sort().join(' '),
  );
  // And the WHOLENESS roster covers every reason-bearing key BY CONSTRUCTION
  // (#18662). The three cases above are the population channels' half; this is
  // the half that closed the class. `no-check-families` and both path-list
  // markers carried the same first-newline capture and sat outside the #18422
  // reading for two cards, because the roster that decided who got the reading
  // was hand-written. Derived from the two grammar builders' own key rosters,
  // a key cannot be added to either without the reading arriving with it.
  t(
    'every key either grammar builder serves has a wholeness reading — the roster is derived, so none can be added without one',
    Object.keys(MARKER_REASON_GRAMMARS).sort().join(' ')
      === [...REASON_TAIL_MARKER_KEYS, ...PATH_LIST_MARKER_KEYS].sort().join(' '),
    Object.keys(MARKER_REASON_GRAMMARS).join(' '),
  );
  t(
    'and it names all SEVEN live marker keys, not the three the repair was filed on (`local-env` joined the path-list grammar with #20278)',
    Object.keys(MARKER_REASON_GRAMMARS).sort().join(' ')
      === 'inherited-population local-env no-check-families no-path-population self-test-reads whole-tree-population wide-population',
    Object.keys(MARKER_REASON_GRAMMARS).sort().join(' '),
  );
  t(
    'the reason GROUP is read off the roster rather than assumed — a path-list key carries its reason in group 3, a reason-tail key in group 2',
    REASON_TAIL_MARKER_KEYS.every((k) => MARKER_REASON_GRAMMARS[k].reasonGroup === 2)
      && PATH_LIST_MARKER_KEYS.every((k) => MARKER_REASON_GRAMMARS[k].reasonGroup === 3),
  );
  t(
    'an unknown key is REFUSED by the shared refusal TEXT too, so the three markers with no entry cannot reach it by a back door',
    (() => { try { markerReasonCutRefusal('made-up-marker', { line: 1, text: 'x', kind: 'line' }); return false; } catch { return true; } })()
      && markerReasonCutRefusal('no-check-families', null) === null,
  );
  t(
    'and the entry-shaped reading is that same text: one refusal, five keys, byte for byte',
    (() => {
      const cut = { file: 'scripts/probe.mjs', line: 9, text: 'and the rest of the sentence', kind: 'line' };
      return populationReasonCutRefusal({ widePopulationReason: 'r', widePopulationReasonCut: cut }, 'wide-population')
        === markerReasonCutRefusal('wide-population', cut);
    })(),
  );

  // ── The BLOCK comment forms, and where a reason written in one ENDS (#18661) ──
  //
  // The alternation listed `//` and `#` only, so a declaration written in the
  // file's own block-comment idiom parsed as NOTHING — the two live specimens
  // are pinned in the live half below. The cases here are the form roster's
  // contract, one per clause: the three block spellings, each of the five
  // places a block reason ends, and the one shape inside a block that is
  // refused instead. The control that the widening did not buy its answers by
  // swallowing whatever sits under a declaration is the group above, which is
  // unchanged, plus the terminator cases here.
  const blockOpener = [
    '/* dispatch-gates: no-path-population -- this module is the shared resolution',
    ' * core and reads NO population of its own: each corpus gate declares its',
    ' * own roots. */',
    'export const X = 1;',
  ].join('\n');
  t(
    'a slash-star opener declares, and the star lines under it are JOINED into the reason — the scripts/symbol-anchors.mjs shape, which used to parse as nothing',
    declaredNoPathPopulation(blockOpener)
      === 'this module is the shared resolution core and reads NO population of its own: each corpus gate declares its own roots.',
  );
  t(
    'and a joined block reason is NOT a cut one — the wholeness reading has nothing to refuse, because nothing was dropped',
    populationReasonContinuation(blockOpener, 'no-path-population') === null,
  );
  t(
    'a star-prefixed line INSIDE a docblock declares too — the scripts/release-verify-npm.mjs shape — and the closing delimiter ends the reason',
    declaredNoPathPopulation(
      '/**\n * Probes run SEQUENTIALLY.\n *\n * dispatch-gates: no-path-population -- the self-test drives synthetic package maps\n */\n',
    ) === 'the self-test drives synthetic package maps',
  );
  t(
    'the TWO-star opener captures whole rather than matching the one-star form and stranding a star in front of the key — the roster order is load-bearing',
    declaredWidePopulation('/** dispatch-gates: wide-population -- walks packages/ entire */\n')
      === 'walks packages/ entire',
  );
  t(
    'a blank star line ENDS the reason: the paragraph the author separated is not swallowed into it',
    declaredWholeTreePopulation(
      '/**\n * dispatch-gates: whole-tree-population -- it sweeps git ls-files\n *\n * An unrelated paragraph about something else entirely.\n */\n',
    ) === 'it sweeps git ls-files',
  );
  t(
    'the next star-@tag line ENDS it as well — a docblock tag section is never part of a seat-facing reason',
    declaredWholeTreePopulation(
      '/**\n * dispatch-gates: whole-tree-population -- it sweeps git ls-files\n * @param {string} p the path\n */\n',
    ) === 'it sweeps git ls-files',
  );
  t(
    'and a SECOND dispatch-gates key ENDS it, in a block exactly as in a line comment — two declarations, never one wrapped reason',
    declaredWholeTreePopulation(
      '/**\n * dispatch-gates: whole-tree-population -- it sweeps git ls-files\n * dispatch-gates: no-path-population -- CI runs the self-test only\n */\n',
    ) === 'it sweeps git ls-files',
  );
  t(
    'a one-line block declaration ends at its own closing delimiter, and the code under it continues nothing',
    declaredNoPathPopulation('/* dispatch-gates: no-path-population -- CI runs the self-test only */\nconst X = 1;\n')
      === 'CI runs the self-test only'
      && populationReasonContinuation('/* dispatch-gates: no-path-population -- CI runs the self-test only */\nconst X = 1;\n', 'no-path-population')
        === null,
  );
  t(
    'a line INSIDE the block with text and NO star prefix is the block form\'s CUT — the one shape a block walk cannot read, refused rather than silently dropped',
    (() => {
      const hangingIndent = [
        '/* dispatch-gates: no-path-population -- this module reads no population',
        '   of its own, and this line has no star prefix */',
      ].join('\n');
      const cut = populationReasonContinuation(hangingIndent, 'no-path-population', 'scripts/x.mjs');
      return cut?.line === 2 && cut?.kind === 'block'
        && cut?.text === 'of its own, and this line has no star prefix */';
    })(),
  );
  t(
    'and its refusal names the BLOCK repair, not the line forms\' one — the two kinds are cut by different shapes and send an author to different halves of their declaration',
    (() => {
      const why = populationReasonCutRefusal(
        {
          noPopulationReason: 'this module reads no population',
          noPopulationReasonCut: { file: 'scripts/x.mjs', line: 2, text: 'of its own', kind: 'block' },
        },
        'no-path-population',
      ) ?? '';
      return why.includes('scripts/x.mjs:2') && why.includes("block's star prefix")
        && !why.includes('Put the WHOLE reason on the marker line');
    })(),
  );
  t(
    'while the LINE forms\' refusal text is untouched by the widening — #18422\'s refusal is not loosened, it is left exactly where it was',
    (populationReasonCutRefusal(
      {
        noPopulationReason: 'CI runs the self-test only',
        noPopulationReasonCut: { file: 'scripts/x.mjs', line: 2, text: 'and the rest', kind: 'line' },
      },
      'no-path-population',
    ) ?? '').includes('Put the WHOLE reason on the marker line'),
  );
  t(
    'a line carrying TWO comment openers is documentation, not a declaration — which is the only reason this file can print examples of its own markers',
    declaredNoPathPopulation(' *   // dispatch-gates: no-path-population -- <reason>\n') === null
      && declaredNoPathPopulation(' *    * dispatch-gates: no-path-population -- <reason>\n') === null,
  );

  // ── A declaration the grammar could not read makes a SOUND (#18661) ────────
  //
  // The form widening above repairs the two forms this tree happens to use.
  // This is the half that outlives it: a line that READS as a declaration and
  // does not PARSE as one produced exactly the output of a file that declares
  // nothing — no reason, no refusal, no row, no count — so a dropped
  // declaration and one nobody ever wrote were indistinguishable in every
  // channel the tool has. The live half below is where this goes RED.
  t(
    'an unrecognised comment form is FOUND, with the file, the line and the form it was written in',
    (() => {
      const [only, ...rest] = unparsedPopulationMarkers(
        'const X = 1;\n<!-- dispatch-gates: no-path-population -- CI runs the self-test only -->\n',
        'scripts/x.mjs',
      );
      return rest.length === 0 && only?.file === 'scripts/x.mjs' && only?.line === 2
        && only?.key === 'no-path-population' && only?.form === '<!--';
    })(),
  );
  t(
    'a RECOGNISED form with no "-- <reason>" tail is found by the same reading — the author wrote a declaration and the tool behaved as though they had not, which is one defect and not two',
    unparsedPopulationMarkers('// dispatch-gates: wide-population\n', 'scripts/x.mjs').length === 1
      && unparsedPopulationMarkers('/* dispatch-gates: wide-population -- */\n', 'scripts/x.mjs').length === 1,
  );
  t(
    'every form the roster DOES list is silent here — a declaration that parses is not a finding, in any of the five spellings',
    MARKER_COMMENT_FORMS.every(
      (f) => unparsedPopulationMarkers(`${f.label} dispatch-gates: no-path-population -- CI runs the self-test only\n`).length === 0,
    ),
  );
  t(
    'and so is PROSE about these keys — the five live mention shapes in this tree, none of which was ever trying to declare anything',
    unparsedPopulationMarkers([
      ' * discipline the `dispatch-gates: no-path-population` note further down states',
      ' * `dispatch-gates: no-path-population` discipline the grammar block above',
      '// ⛔ NO `dispatch-gates: no-path-population` MARKER HERE — deliberately',
      "    '          `dispatch-gates: no-path-population -- <reason>` marker, and stop spelling the',",
      "      + 'the gate declares `dispatch-gates: '",
      "  '// dispatch-gates: no-path-population -- a fixture inside a self-test',",
    ].join('\n')).length === 0,
  );
  t(
    'the refusal names every dropped line rather than the first — a file with two of them has TWO authors\' declarations dropped',
    (() => {
      const why = unparsedPopulationMarkerRefusal(
        unparsedPopulationMarkers(
          '; dispatch-gates: no-path-population -- one\n% dispatch-gates: wide-population -- two\n',
          'scripts/x.mjs',
        ),
      ) ?? '';
      return why.includes('scripts/x.mjs:1') && why.includes('scripts/x.mjs:2')
        && why.includes('form ;') && why.includes('form %');
    })(),
  );
  t(
    'and it refuses NOTHING when nothing was dropped — the shape every refusal in this family takes',
    unparsedPopulationMarkerRefusal([]) === null && unparsedPopulationMarkerRefusal(null) === null,
  );

  // ── The probe's roster is the DERIVED one, and the forms are each key's own
  //    (#18825) ──────────────────────────────────────────────────────────────
  //
  // The reading this card was filed on, re-taken through the exported function
  // on `origin/main` 42f8df1723 before the change and re-taken here on every
  // run after it: the two population CONTROLS returned 1 row each, and the
  // same three shapes on `no-check-families`, `inherited-population` and
  // `self-test-reads` returned nothing at all. A dropped declaration on those
  // three printed exactly what a file that declares nothing prints — the
  // #18661 sentence above, measured on the keys its repair never reached — and
  // the `self-test-reads` one is the expensive member: a dropped declaration
  // takes a family out of the derived set, so `--ran` renders its
  // zero-NOT-MEASURED verdict over a set that no longer contains it.
  t(
    'the lookalike roster IS the derived grammar roster — neither can grow alone, and a seventh reason-bearing key is probed the day it is added',
    Object.keys(MARKER_LOOKALIKES).sort().join(' ') === Object.keys(MARKER_REASON_GRAMMARS).sort().join(' '),
    Object.keys(MARKER_LOOKALIKES).join(' '),
  );
  t(
    'CONTROL, unmoved by this card: a population key with no separator, and one opened with an unrecognised `--`, are 1 row each — the two readings that already sounded',
    (() => {
      const noTail = unparsedPopulationMarkers('// dispatch-gates: no-path-population reason without separator\n', 'scripts/x.mjs');
      const unknown = unparsedPopulationMarkers('-- dispatch-gates: no-path-population -- x\n', 'scripts/x.mjs');
      return noTail.length === 1 && noTail[0].key === 'no-path-population' && noTail[0].form === '//'
        && unknown.length === 1 && unknown[0].key === 'no-path-population' && unknown[0].form === '--';
    })(),
  );
  t(
    'and the three keys the old roster never reached now SOUND, each by file, line, form and text — the card\'s own three shapes, which returned NOTHING before this change',
    (() => {
      const shapes = [
        ['# dispatch-gates: no-check-families reason without separator', 'no-check-families', '#'],
        ['// dispatch-gates: inherited-population a b reason', 'inherited-population', '//'],
        ['-- dispatch-gates: self-test-reads a -- x', 'self-test-reads', '--'],
      ];
      return shapes.every(([line, key, form]) => {
        const [only, ...rest] = unparsedPopulationMarkers(`const X = 1;\n${line}\n`, 'scripts/x.mjs');
        return rest.length === 0 && only?.file === 'scripts/x.mjs' && only?.line === 2
          && only?.key === key && only?.form === form && only?.text === line;
      });
    })(),
  );
  // Derived over the roster rather than written out six times, for the reason
  // the roster itself is derived: a seventh key must arrive PROBED, and a pin
  // that names its six subjects by hand cannot make that true.
  t(
    'every key in the roster sounds on a dropped declaration written in its own first admissible form — one row, its key, its form, its line',
    Object.keys(MARKER_REASON_GRAMMARS).every((key) => {
      const form = markerFormsFor(key)[0].label;
      const rows = unparsedPopulationMarkers(`${form} dispatch-gates: ${key} a reason with no separator\n`, 'scripts/x.mjs');
      return rows.length === 1 && rows[0].key === key && rows[0].form === form && rows[0].line === 1;
    }),
  );
  t(
    'and every key in the roster stays SILENT on a declaration that parses — the probe is a reading about dropped declarations, never about the keys',
    Object.keys(MARKER_REASON_GRAMMARS).every((key) => {
      const form = markerFormsFor(key)[0].label;
      const paths = MARKER_REASON_GRAMMARS[key].reasonGroup === 2 ? '' : ' scripts/x.mjs';
      return unparsedPopulationMarkers(`${form} dispatch-gates: ${key}${paths} -- CI runs the self-test only\n`, 'scripts/x.mjs').length === 0;
    }),
  );
  // The triage's second blind spot, pinned as a NON-finding: a fix that keyed
  // the lookalike on six keys and kept the wide opener would report every
  // `//`-spelled line in a workflow as a dropped declaration — a line YAML
  // never treats as a comment at all, so there was no declaration to drop.
  t(
    'a `//` or block-form line on `no-check-families` is DOCUMENT CONTENT in a workflow and NOT a lookalike — the form restriction the parser honours, honoured by the probe',
    MARKER_COMMENT_FORMS.filter((f) => f.label !== '#').every(
      (f) => unparsedPopulationMarkers(`${f.label} dispatch-gates: no-check-families -- x\n`, '.github/workflows/x.yml').length === 0
        && unparsedPopulationMarkers(`${f.label} dispatch-gates: no-check-families reason without separator\n`, '.github/workflows/x.yml').length === 0,
    ),
  );
  t(
    'while those same four forms on an UNRESTRICTED key are each one row — the restriction is that key\'s language, not the probe going quiet',
    MARKER_COMMENT_FORMS.filter((f) => f.label !== '#').every(
      (f) => unparsedPopulationMarkers(`${f.label} dispatch-gates: no-path-population reason without separator\n`, 'scripts/x.mjs').length === 1,
    ),
  );
  t(
    'and the `#` form on `no-check-families` is the one that DOES sound — the restriction narrows which spellings are lookalikes, it does not empty them',
    unparsedPopulationMarkers('# dispatch-gates: no-check-families\n', '.github/workflows/x.yml').length === 1
      && unparsedPopulationMarkers('# dispatch-gates: no-check-families --\n', '.github/workflows/x.yml').length === 1,
  );
  t(
    'the refusal prescribes the forms of the KEY it names and not the whole roster — a remedy the author of a WORKFLOW can actually take',
    (() => {
      const yaml = unparsedPopulationMarkerRefusal(
        unparsedPopulationMarkers('# dispatch-gates: no-check-families reason without separator\n', '.github/workflows/x.yml'),
      ) ?? '';
      const js = unparsedPopulationMarkerRefusal(
        unparsedPopulationMarkers('; dispatch-gates: wide-population -- x\n', 'scripts/x.mjs'),
      ) ?? '';
      return yaml.includes('.github/workflows/x.yml:1') && yaml.includes('no-check-families may be written in: #')
        && !yaml.includes('written in: //')
        && js.includes(`wide-population may be written in: ${MARKER_COMMENT_FORMS.map((f) => f.label).join(', ')}`);
    })(),
  );

  // The refusal, once per channel. One capture shape means one defect: a
  // repair on one marker and not its siblings leaves this card alive twice.
  const cutAt = (file, line, text) => ({ file, line, text });
  const someCut = cutAt('scripts/check-x.mjs', 134, 'and the verdict is the count it refuses');
  t(
    'a cut WHOLE-TREE reason is refused, and the refusal names the declaration, the file and the line that continues it',
    (() => {
      const why = wholeTreePopulationRefusal({
        wholeTreeReason: 'sweeps the tree', wholeTreeReasonCut: someCut, rootWalk: REPO_ROOT_WALK_SPELLINGS[0].label,
      }) ?? '';
      return why.includes('whole-tree-population') && why.includes('scripts/check-x.mjs:134')
        && why.includes('and the verdict is the count it refuses');
    })(),
  );
  t(
    'a cut WIDE reason is refused through the same shared reading, naming its own channel',
    (() => {
      const why = widePopulationRefusal({
        widePopulationReason: 'walks packages/ entire', widePopulationReasonCut: someCut, hints: [],
      }) ?? '';
      return why.includes('wide-population') && why.includes('scripts/check-x.mjs:134');
    })(),
  );
  t(
    'and a cut NO-PATH reason is refused too — the channel with no refusal function of its own is not the channel without the contract',
    (() => {
      const why = populationReasonCutRefusal({
        noPopulationReason: 'CI runs the self-test only', noPopulationReasonCut: someCut,
      }, 'no-path-population') ?? '';
      return why.includes('no-path-population') && why.includes('scripts/check-x.mjs:134');
    })(),
  );
  t(
    'a WHOLE reason is refused nothing on any of the three — this refusal is about the cut, never about the marker',
    wholeTreePopulationRefusal({ wholeTreeReason: 'sweeps the tree', wholeTreeReasonCut: null, rootWalk: REPO_ROOT_WALK_SPELLINGS[0].label }) === null
      && widePopulationRefusal({ widePopulationReason: 'walks packages/ entire', widePopulationReasonCut: null, hints: [] }) === null
      && populationReasonCutRefusal({ noPopulationReason: 'CI runs the self-test only', noPopulationReasonCut: null }, 'no-path-population') === null,
  );
  t(
    'and a family declaring NOTHING is refused nothing even carrying a stray cut — no declaration, no reason to grade',
    populationReasonCutRefusal({ noPopulationReason: null, noPopulationReasonCut: someCut }, 'no-path-population') === null,
  );
  // The pair refusals are UNCHANGED: a declaration that contradicts a sibling
  // marker is refused for THAT, in the words a reader has been getting for it.
  t(
    'the two-marker pair refusals are unchanged by a cut reason — all three pairs still refuse as the contradiction they are',
    (() => {
      const wtWide = wholeTreePopulationRefusal({
        wholeTreeReason: 'sweeps the tree', wholeTreeReasonCut: someCut, widePopulationReason: 'walks packages/ entire',
        rootWalk: REPO_ROOT_WALK_SPELLINGS[0].label,
      }) ?? '';
      const wtNoPath = wholeTreePopulationRefusal({
        wholeTreeReason: 'sweeps the tree', wholeTreeReasonCut: someCut, noPopulationReason: 'CI runs the self-test only',
        rootWalk: REPO_ROOT_WALK_SPELLINGS[0].label,
      }) ?? '';
      const wpNoPath = widePopulationRefusal({
        widePopulationReason: 'walks packages/ entire', widePopulationReasonCut: someCut,
        noPopulationReason: 'CI runs the self-test only', hints: [],
      }) ?? '';
      return wtWide.includes('BOTH whole-tree-population and wide-population')
        && wtNoPath.includes('BOTH whole-tree-population and no-path-population')
        && wpNoPath.includes('BOTH wide-population and no-path-population');
    })(),
  );
  t(
    'but a cut reason IS named before the walk that would back it and before the hints it would be graded against — both of those read a reason this one calls half of one',
    (() => {
      const wt = wholeTreePopulationRefusal({ wholeTreeReason: 'sweeps the tree', wholeTreeReasonCut: someCut, rootWalk: null }) ?? '';
      const wp = widePopulationRefusal({
        widePopulationReason: 'walks packages/ entire', widePopulationReasonCut: someCut, hints: ['packages/rest/src'],
      }) ?? '';
      return wt.includes('does not END on the marker line') && !wt.includes('no recognised repo-root walk')
        && wp.includes('does not END on the marker line') && !wp.includes('NAMES paths');
    })(),
  );
  t(
    'the always-runs renderer prints a cut declaration as a REFUSED row rather than as the fragment it was cut down to',
    alwaysRunsPopulationLines([{
      check: 'check:x', command: 'pnpm check:x', workflows: ['lint.yml'], reason: 'sweeps the tree',
      rootWalk: REPO_ROOT_WALK_SPELLINGS[0].label,
      refused: wholeTreePopulationRefusal({
        wholeTreeReason: 'sweeps the tree', wholeTreeReasonCut: someCut, rootWalk: REPO_ROOT_WALK_SPELLINGS[0].label,
      }),
      ciOnly: null, notRunnable: null,
    }]).some((l) => l.includes('REFUSED') && l.includes('does not END on the marker line')),
  );

  // The discovery's half: reason and continuation off ONE source, so a refusal
  // can never grade one file's reason against another file's continuation.
  t(
    'the discovery keeps the FIRST declaration a family meets, and the cut travels with it from the SAME file',
    (() => {
      const entry = {};
      readPopulationDeclaration(entry, '// dispatch-gates: wide-population -- walks packages/ entire\n// and the rest of the sentence\n', 'scripts/a.mjs', 'wide-population');
      readPopulationDeclaration(entry, '// dispatch-gates: wide-population -- a second file declaring the same thing\n', 'scripts/b.mjs', 'wide-population');
      return entry.widePopulationReason === 'walks packages/ entire'
        && entry.widePopulationReasonCut?.file === 'scripts/a.mjs' && entry.widePopulationReasonCut?.line === 2;
    })(),
  );
  t(
    'a source that declares nothing leaves the entry untouched, so a later file of the same family can still declare',
    (() => {
      const entry = {};
      readPopulationDeclaration(entry, '// just a comment\n', 'scripts/a.mjs', 'no-path-population');
      const before = entry.noPopulationReason;
      readPopulationDeclaration(entry, '// dispatch-gates: no-path-population -- CI runs the self-test only\n', 'scripts/b.mjs', 'no-path-population');
      return before === undefined && entry.noPopulationReason === 'CI runs the self-test only'
        && entry.noPopulationReasonCut === null;
    })(),
  );

  // Placement, column by column. The card path is under the very root these
  // gates walk — the case the ruling is about.
  const wpEntry = { files: ['scripts/check-wildcard-fallthrough.mjs'], hints: [], widePopulationReason: 'walks packages/ entire' };
  t(
    'DECLARED column: a declaring family is placed as wide-population, not undetermined — it has been READ',
    placeFamily(wpEntry, ['README.md']).verdict === 'wide-population',
  );
  t(
    'MATCHED column: a card under the root it walks does NOT match it — the whole point of the ruling',
    placeFamily(wpEntry, ['packages/rest/src/server.ts']).verdict === 'wide-population'
      && placeFamily(wpEntry, ['packages/rest/src/server.ts']).hits.length === 0,
  );
  t(
    'NOT silent either: a gate that really does read your file must never print as a clearance',
    !['silent', 'undetermined', 'matched'].includes(placeFamily(wpEntry, ['packages/core/src/kernel.ts']).verdict),
  );
  t(
    'the IDENTITY key SURVIVES: a card editing the gate\'s own script still matches it, because the declaration is a claim about the POPULATION and not about that file',
    placeFamily(wpEntry, ['scripts/check-wildcard-fallthrough.mjs']).verdict === 'matched',
  );
  t(
    'and that is the DIFFERENCE from the whole-tree channel, which suppresses the identity match — pinned as a difference so neither can be "tidied" into the other',
    placeFamily({ ...wpEntry, widePopulationReason: null, wholeTreeReason: 'sweeps the tree' }, ['scripts/check-wildcard-fallthrough.mjs']).verdict === 'always-runs',
  );
  t(
    'a family that declares nothing is STILL placed byte-for-byte as classifyEntry places it, with the third channel wired in',
    [
      { files: ['scripts/check-silent.mjs'], hints: ['packages/spec/src'] },
      { files: ['scripts/check-empty.mjs'], hints: [] },
    ].every((e) => ['packages/rest/src/server.ts', 'scripts/check-empty.mjs', 'packages/spec/src/index.ts']
      .every((p) => JSON.stringify(placeFamily(e, [p])) === JSON.stringify(classifyEntry(e, [p])))),
  );

  // The union: a wide-population family contributes NO command, which is the
  // whole difference from the whole-tree rows one section up.
  const wpRow = { check: 'check:wildcard-fallthrough', command: 'pnpm check:wildcard-fallthrough', workflows: ['lint.yml'], reason: 'walks packages/ entire', refused: null };
  t(
    'a wide-population family is NOT in the runnable union --commands prints — no card owes it on the basis of a population no card can narrow',
    !commandsFor({ matchedRows: [], kindGroups: [], alwaysRunsRows: [] }).includes('pnpm check:wildcard-fallthrough'),
  );
  t(
    'and the union is unmoved by the presence of wide rows: they are not one of its inputs at all',
    commandsFor({ matchedRows: [{ check: 'check:x', command: 'pnpm check:x', ciOnly: null }], kindGroups: [], alwaysRunsRows: [] }).length === 1,
  );

  // The rendering — the DECLARED column the ruling names.
  const wpLines = widePopulationLines([wpRow]);
  t(
    'the wide-population section names the gate and its reason',
    wpLines.some((l) => l.includes('pnpm check:wildcard-fallthrough') && l.includes('walks packages/ entire')),
  );
  t('and says out loud that the absence from the matched block is not a clearance', wpLines.some((l) => l.includes('NOT a clearance')));
  t(
    'its heading cannot be confused with the whole-tree one, whose commands ARE in the total',
    wpLines[0].includes('Declared WIDE population') && !wpLines[0].includes('Always runs'),
  );
  t(
    'a REFUSED declaration prints as refused rather than vanishing from every rendering',
    widePopulationLines([{ ...wpRow, refused: 'declares BOTH wide-population and no-path-population' }]).some((l) => l.includes('REFUSED')),
  );
  t('no declaring family, no section', widePopulationLines([]).length === 0);

  // The residue partition. A FIFTH placement wired into the derivation and not
  // into this sum shrinks the residue silently — the exact failure residueLines'
  // own throw exists to catch, now one term further along.
  const wpResidue = residueLines({
    discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 30, silent: 50, alwaysRuns: 5, widePopulation: 5,
    unfiltered: 80, unreachable: 5, swept: 6000, artifactRosters: 4, invertedRosters: 1,
  });
  t('the residue accounts for the wide-population bucket as a fifth term', wpResidue.some((l) => l.includes('5 declared-wide')));
  t(
    'and REFUSES a derivation that placed wide families it did not count',
    (() => {
      try {
        residueLines({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 30, silent: 50, alwaysRuns: 5, widePopulation: 0, unfiltered: 80, unreachable: 5, swept: 6000, artifactRosters: 4, invertedRosters: 1 });
        return false;
      } catch (err) {
        return /residue accounting is short/.test(err.message) && /wide-population/.test(err.message);
      }
    })(),
  );
  t(
    'the residue prose states what the bucket IS — declared, unplaceable, and outside this card\'s runnable total',
    wpResidue.some((l) => /too wide to place/.test(l) && /not in this card's runnable total/.test(l)),
  );

  // ── The followed-module inherited-population declaration (#11556) ─────────
  //
  // The two markers above are a GATE's declarations about itself. This one is a
  // followed MODULE's declaration about what a gate inherits by importing it —
  // the half that had no mechanism at all, only prose in the one caller that
  // remembered to spawn instead of import.
  const inhFixture = [
    "const WF = '.github/workflows';",
    "const BASE = 'packages/plugins';",
    '// dispatch-gates: inherited-population .github/workflows -- the only tree this module opens',
  ].join('\n');
  t(
    'a followed module declares the population a caller inherits, and the reason reads back',
    (() => {
      const d = declaredInheritedPopulation(inhFixture);
      return d.population.length === 1
        && d.population[0] === '.github/workflows'
        && d.reason === 'the only tree this module opens';
    })(),
  );
  t(
    'and the literal it did NOT declare stops being inheritable, while still being a literal it spells',
    extractWatchHints(inhFixture).includes('packages/plugins')
      && !declaredInheritedPopulation(inhFixture).population.includes('packages/plugins'),
  );
  t(
    'the shell comment spelling is read too (a followed module can be a shell helper)',
    declaredInheritedPopulation("X='.github/workflows'\n# dispatch-gates: inherited-population .github/workflows -- shell reason\n")
      ?.reason === 'shell reason',
  );
  t(
    'several paths may be declared, space separated',
    (() => {
      const src = ["const A = '.github/workflows';", "const B = 'packages/spec/src/**';",
        '// dispatch-gates: inherited-population .github/workflows packages/spec/src/** -- two real reads'].join('\n');
      return declaredInheritedPopulation(src).population.length === 2;
    })(),
  );
  t('no marker present reads as no declaration — the module contributes everything it spells', declaredInheritedPopulation("const A = '.github/workflows';\n") === null);
  t(
    'a marker carrying only a reason does not parse as a declaration (it reads as no marker, so the module keeps contributing — never a silent blanket opt-out)',
    declaredInheritedPopulation("const A = '.github/workflows';\n// dispatch-gates: inherited-population -- everything here is a join base\n") === null,
  );
  t(
    'the marker must be its OWN line here too — a mention inside prose is a discussion of the convention, not a declaration under it',
    declaredInheritedPopulation("const A = '.github/workflows';\n// see dispatch-gates: inherited-population .github/workflows -- for how a module opts out\n") === null,
  );
  // NARROWING ONLY. This is the load-bearing invariant: an opt-out that could
  // also opt IN would be the hand-written path map this file's contract exists
  // to refuse, and it would be invisible — a declared path nothing spells reads
  // exactly like a real one in the MATCHED column.
  t(
    'a declared path the module does not spell is REFUSED, not silently inherited',
    (() => {
      try {
        declaredInheritedPopulation("const A = '.github/workflows';\n// dispatch-gates: inherited-population packages/spec/src/** -- invented\n");
        return false;
      } catch (e) {
        return /may only NARROW/.test(String(e.message));
      }
    })(),
  );
  t(
    'and the refusal names every invented path, not just the first',
    (() => {
      try {
        declaredInheritedPopulation("const A = '.github/workflows';\n// dispatch-gates: inherited-population packages/a packages/b -- invented\n");
        return false;
      } catch (e) {
        return /packages\/a, packages\/b/.test(String(e.message));
      }
    })(),
  );
  // The `--` separator is SPACE-delimited on purpose: a bare `--` would split a
  // path that legitimately carries one.
  t(
    'a declared path containing a double dash survives the reason separator',
    (() => {
      const src = ["const A = 'packages/a--b/src';", '// dispatch-gates: inherited-population packages/a--b/src -- a real subtree'].join('\n');
      const d = declaredInheritedPopulation(src);
      return d.population.length === 1 && d.population[0] === 'packages/a--b/src' && d.reason === 'a real subtree';
    })(),
  );

  // ── This marker's reason half is WHOLE, or the declaration is REFUSED (#18662) ──
  //
  // The path list is its own grammar and is untouched; only the reason after
  // the ` -- ` is in question. It captured with the same first-newline shape
  // #18422 repaired for the population three, and — measured on `origin/main`
  // 034f5a3afd — a wrapped reason read back as line one with no throw, no
  // refusal and no row. The path-list half is pinned unchanged above; these
  // are the reason half.
  const wrappedInherited = [
    "const WORKFLOWS = '.github/workflows';",
    '// dispatch-gates: inherited-population .github/workflows -- the workflow directory this module readdirs, and the verdict is',
    '// that every other literal here is a join base no caller ever opens',
    '',
    'export default WORKFLOWS;',
  ].join('\n');
  {
    let refused = null;
    try {
      declaredInheritedPopulation(wrappedInherited, null, 'scripts/x.mjs');
    } catch (error) {
      refused = String(error.message);
    }
    t(
      'an inherited-population reason that does not END on the marker line is REFUSED, naming the module, the line, the marker and the continuation',
      refused !== null
        && refused.includes('scripts/x.mjs declares inherited-population')
        && refused.includes('scripts/x.mjs:3 continues it with')
        && refused.includes('"that every other literal here is a join base no caller ever opens"'),
      refused,
    );
  }
  t(
    'the WHOLE-reason control still declares its population and its reason — the repair refuses a cut, it does not refuse the marker',
    (() => {
      const whole = wrappedInherited.replace(
        '// that every other literal here is a join base no caller ever opens\n',
        '',
      );
      const d = declaredInheritedPopulation(whole, null, 'scripts/x.mjs');
      return d?.population.join(' ') === '.github/workflows'
        && d?.reason === 'the workflow directory this module readdirs, and the verdict is';
    })(),
  );
  t(
    'the wholeness reading reaches this marker through the SAME helper the population three use, and reads its reason out of group 3',
    (() => {
      const cut = populationReasonContinuation(wrappedInherited, 'inherited-population', 'scripts/x.mjs');
      return cut?.line === 3 && cut?.kind === 'line'
        && cut?.text === 'that every other literal here is a join base no caller ever opens';
    })(),
  );
  t(
    'and the two refusals this marker now carries are INDEPENDENT — an invented path is still refused for being invented, not for being cut',
    (() => {
      try {
        declaredInheritedPopulation(
          "const A = '.github/workflows';\n// dispatch-gates: inherited-population packages/spec/src/** -- invented\n",
          null,
          'scripts/x.mjs',
        );
        return false;
      } catch (error) {
        return String(error.message).includes('never invent it');
      }
    })(),
  );
  // ── LIVE: this file's own declaration ─────────────────────────────────────
  //
  // Pinned against the real source, because the whole value of the marker is
  // that it holds for THIS module — the one measured specimen. Delete the
  // marker line and these cases redden instead of 2632 fabricated pairs coming
  // back silently for the next gate that imports the tool.
  const ownToolSource = readFileSync(nodePath.join(ROOT, 'scripts/pm/dispatch-gates.mjs'), 'utf8');
  const ownDeclared = declaredInheritedPopulation(ownToolSource, null, 'scripts/pm/dispatch-gates.mjs');
  // Read through `?.` on purpose: deleting the marker line must render as a
  // NAMED failing case, not as a TypeError that aborts the run and takes every
  // case after this one with it — a self-test that crashes reports one defect
  // where the tree may hold several.
  const ownPopulation = ownDeclared?.population ?? [];
  t('this module declares what a follower inherits', (ownDeclared?.reason ?? '').length > 0);
  t(
    'it declares exactly the two trees it opens — the workflow directory it readdirs and the composite actions those workflows use',
    ownPopulation.length === 2
      && ownPopulation[0] === '.github/workflows'
      && ownPopulation[1] === '.github/actions',
  );
  t('so a follower still reaches the workflow files this tool really opens', covers(ownPopulation, '.github/workflows/lint.yml'));
  t(
    '…and the composite action files it really opens through them (#19229)',
    covers(ownPopulation, '.github/actions/setup-pnpm/action.yml'),
  );
  // The four fabricating classes the card measured, each pinned as SPELLED but
  // NOT INHERITED — the two halves have to be asserted together, because the
  // literal disappearing from the file would also pass "not inherited" while
  // silently deleting the tier declaration this table is.
  for (const fabricated of ['packages/plugins', 'packages/drivers', 'packages/services']) {
    t(
      `the module still spells ${fabricated} (join base / tier glob) but no follower inherits it`,
      ownHints.includes(fabricated) && !ownPopulation.includes(fabricated),
    );
  }
  t(
    'the tier globs are no longer spelled by the engine at all — they are data beside it, which no follower reads',
    !ownHints.includes('packages/spec/src/**') && !ownHints.includes('skills/**')
      && SUSPECT_TIER_GLOBS.some((g) => g.glob === 'packages/spec/src/**') && MANDATORY_TIER_GLOBS.some((g) => g.glob === 'skills/**'),
  );
  t(
    'and the tier-table file globs are not inheritable either',
    ownPopulation.length > 0
      && !ownPopulation.includes('.claude/agents/os-dev.md')
      && !ownPopulation.includes('skills/**'),
  );
  // Cost of the mechanism on this tree, pinned so it cannot grow unnoticed: the
  // marker is an opt-out, and an opt-out that spreads is how a real population
  // goes quiet. TWO modules in the scripts tree declare one today, and this
  // case NAMES them rather than counting them — a bare count reddens for a
  // third module without saying which ones were already priced, and the price
  // is the whole admission criterion:
  //
  //   scripts/pm/dispatch-gates.mjs         2632 pairs — join bases and tier
  //                                         globs, nothing this tool opens
  //   scripts/cli-build-prerequisite.mjs    216 pairs — 108 files x 2 gates,
  //                                         each charging the card that touched
  //                                         one a full CLI closure build to
  //                                         measure gates it could not move
  //                                         (#12500)
  //
  // A third entry is not forbidden; it is required to arrive with its own
  // measured price, which is what re-pointing this case costs an author.
  const declaringModules = trackedFiles()
    .filter((f) => f.startsWith('scripts/') && /\.(mjs|mts|js|sh)$/.test(f))
    // Read from the MODULE BODY, so the fixture markers above — which live
    // inside this very self-test — are not counted as live declarations.
    .filter((f) => INHERITED_POPULATION_MARKER.test(maskSelfTests(readFileSync(nodePath.join(ROOT, f), 'utf8'))))
    .sort();
  t(
    `exactly the two priced modules in the scripts tree carry the declaration (${declaringModules.join(' · ') || 'none'})`,
    declaringModules.join(' · ') === 'scripts/cli-build-prerequisite.mjs · scripts/pm/dispatch-gates.mjs',
  );

  // ── LIVE CENSUS: the reason half of every marker outside the population
  //    three, measured WHOLE over the real tree (#18662) ────────────────────
  //
  // The population three are censused further down against the discovery's
  // entries; these three have no entry to be censused through, so the census
  // is taken off the files themselves. It is the half a fixture cannot give:
  // a fixture shows the refusal works, and only the tree shows that no live
  // declaration is being cut by it today. The reading this card was filed on
  // said every live declaration is a one-liner followed by a blank line — this
  // is that reading, re-taken on every run, so the day someone wraps one the
  // refusal lands here rather than in a seat's half-read sentence.
  //
  // Each row is NAMED, never counted: a bare count reddens for a seventh
  // declaration without saying which six were already read.
  const liveMarkerCensus = [];
  const censusRead = (file, key, read) => {
    liveMarkerCensus.push({ file, key, line: read.line, whole: read.cut === null, reason: read.reason });
  };
  // The corpus is RETAINED rather than read and dropped, because the LOOKALIKE
  // half of this census (#18825) has to be taken over exactly the files the
  // parsed half reads: a probe over a different corpus would be answering a
  // different question and could not be compared with the rows above.
  const censusCorpus = new Map();
  const censusWorkflows = readdirSync(nodePath.join(ROOT, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f));
  for (const wf of censusWorkflows) {
    const rel = `.github/workflows/${wf}`;
    censusCorpus.set(rel, readFileSync(nodePath.join(ROOT, rel), 'utf8'));
    const read = readPopulationMarker(censusCorpus.get(rel), 'no-check-families');
    if (read) censusRead(rel, 'no-check-families', read);
  }
  const censusScripts = trackedFiles().filter((x) => x.startsWith('scripts/') && /\.(mjs|mts|js|sh)$/.test(x)).sort();
  for (const f of censusScripts) {
    // Read from the MODULE BODY, so this self-test's own fixtures are not
    // counted as live declarations — the discipline `declaringModules` above
    // takes, and for the same reason. `maskSelfTests` blanks characters and
    // keeps every newline, so a line number read off the mask is the line
    // number in the file.
    const body = maskSelfTests(readFileSync(nodePath.join(ROOT, f), 'utf8'));
    censusCorpus.set(f, body);
    // The path-list ROSTER, not a hand list (#20278): a key added to that
    // grammar arrives censused, which is how `local-env` reached this row.
    for (const key of PATH_LIST_MARKER_KEYS) {
      const read = readPopulationMarker(body, key);
      if (read) censusRead(f, key, read);
    }
  }
  const censusRows = liveMarkerCensus.map((r) => `${r.file}:${r.line} ${r.key}`).sort();
  t(
    `the live tree carries the eight declarations measured for this census, and no others (${censusRows.join(' · ') || 'none'})`,
    censusRows.join(' · ') === [
      // Seventh row, added with the declaration it names: `checklist-status.yml`
      // is paths-filtered (its `pull_request:` trigger is filtered to itself) and
      // its only working step invokes the GENERATOR `pnpm gen:checklist-status`,
      // so it discovers no `check:` family and declares why. ⚠️ This roster is the
      // maintenance this pin exists to force: it is NAMED rather than counted
      // precisely so a seventh declaration reddens WITH the six already read
      // printed beside it, and the author adds their row instead of a number.
      '.github/workflows/checklist-status.yml:57 no-check-families',
      '.github/workflows/merged-branch-reaper.yml:212 no-check-families',
      '.github/workflows/os-create-smoke.yml:48 no-check-families',
      '.github/workflows/scaffold-e2e.yml:23 no-check-families',
      // Eighth row, added with the declaration it names (#20278): the checker's
      // bare diff-scoped run declares the two step-`env:` values it does not need.
      'scripts/check-issue-citations.mjs:204 local-env',
      'scripts/cli-build-prerequisite.mjs:111 inherited-population',
      'scripts/pm/check-expected-skips.mjs:131 self-test-reads',
      'scripts/pm/dispatch-gates.mjs:736 inherited-population',
    ].join(' · '),
    censusRows.join(' · '),
  );
  const censusCut = liveMarkerCensus.filter((r) => !r.whole).map((r) => `${r.file}:${r.line} ${r.key}`);
  t(
    `every live reason on those markers ENDS on its own marker line (cut: ${censusCut.join(', ') || 'none'})`,
    censusCut.length === 0 && liveMarkerCensus.length === 8,
  );
  t(
    'and every one of them carries a non-empty reason — whole is not the same claim as present, and both are owed',
    liveMarkerCensus.every((r) => typeof r.reason === 'string' && r.reason.length > 0),
  );
  t(
    'the census is not vacuous over this tree: put a continuation under a LIVE declaration and exactly that file is refused, by name',
    (() => {
      const specimen = liveMarkerCensus.find((r) => r.key === 'no-check-families');
      if (!specimen) return false;
      const lines = readFileSync(nodePath.join(ROOT, specimen.file), 'utf8').split('\n');
      lines.splice(specimen.line, 0, '# and the rest of the sentence');
      try {
        declaredNoCheckFamiliesReason(lines.join('\n'), specimen.file);
        return false;
      } catch (error) {
        return String(error.message).includes(`${specimen.file}:${specimen.line + 1} continues it with`)
          && String(error.message).includes('and the rest of the sentence');
      }
    })(),
  );

  // ── LIVE CENSUS, the LOOKALIKE half: does any file in that same corpus carry
  //    a declaration on these three keys that was DROPPED? (#18825) ──────────
  //
  // The half above reads the declarations that PARSED, and it cannot miss what
  // was never parsed. The probe beside it was keyed on the population three
  // until this card, so neither reading was looking: a dropped
  // `no-check-families`, `inherited-population` or `self-test-reads` line was
  // invisible to the census AND to the probe, which is the same silence one
  // level in. Same files, same masking, one question further back.
  //
  // ⚠️ The population three are deliberately filtered OUT of this row, not
  // because they are uninteresting but because they already have their own
  // live sweep further down over the discovery's gate sources — counting them
  // twice would make a red here ambiguous about which sweep found it.
  const censusLookalikes = [...censusCorpus]
    .flatMap(([f, text]) => unparsedPopulationMarkers(text, f))
    .filter((u) => !POPULATION_MARKER_KEYS.includes(u.key));
  t(
    `no live file carries a DROPPED declaration on the four keys outside the population roster `
      + `(${censusWorkflows.length} workflow(s) + ${censusScripts.length} script(s) swept; found `
      + `${censusLookalikes.map((u) => `${u.file}:${u.line} ${u.key}`).join(' · ') || 'none'})`,
    censusLookalikes.length === 0,
    unparsedPopulationMarkerRefusal(censusLookalikes),
  );
  // Two non-vacuity legs, because the two keys fail differently: one in a
  // WORKFLOW, where the only admissible form is `#`, and one in a SCRIPT,
  // where the path-list grammar wants ` -- ` with spaces on both sides. Each
  // puts a dropped line directly under a LIVE declaration, so the corpus, the
  // masking and the line numbering are all the real ones.
  t(
    'and that sweep is not vacuous: put a `#` line with no separator under the LIVE `no-check-families` declaration and exactly that line is refused, by file and line',
    (() => {
      const specimen = liveMarkerCensus.find((r) => r.key === 'no-check-families');
      if (!specimen) return false;
      const lines = censusCorpus.get(specimen.file).split('\n');
      lines.splice(specimen.line, 0, '# dispatch-gates: no-check-families and this one has no separator');
      const found = unparsedPopulationMarkers(lines.join('\n'), specimen.file);
      const why = unparsedPopulationMarkerRefusal(found) ?? '';
      return found.length === 1 && found[0].line === specimen.line + 1 && found[0].key === 'no-check-families'
        && found[0].form === '#' && why.includes(`${specimen.file}:${specimen.line + 1}`)
        && why.includes('no-check-families may be written in: #');
    })(),
  );
  t(
    'and the same in a SCRIPT, on the path-list key: a `//` line under the LIVE `self-test-reads` declaration with no ` -- ` separator is found, and nothing else is',
    (() => {
      const specimen = liveMarkerCensus.find((r) => r.key === 'self-test-reads');
      if (!specimen) return false;
      const lines = censusCorpus.get(specimen.file).split('\n');
      lines.splice(specimen.line, 0, '// dispatch-gates: self-test-reads .claude/skills/pm-dispatch/SKILL.md');
      const found = unparsedPopulationMarkers(lines.join('\n'), specimen.file);
      return found.length === 1 && found[0].line === specimen.line + 1 && found[0].key === 'self-test-reads'
        && found[0].form === '//';
    })(),
  );
  t(
    'and the SAME insertion spelled `//` in the WORKFLOW is found by NEITHER reading — document content in YAML is not a dropped declaration, and this census would be the first place a fix that forgot that went red',
    (() => {
      const specimen = liveMarkerCensus.find((r) => r.key === 'no-check-families');
      if (!specimen) return false;
      const lines = censusCorpus.get(specimen.file).split('\n');
      lines.splice(specimen.line, 0, '// dispatch-gates: no-check-families and this one has no separator');
      return unparsedPopulationMarkers(lines.join('\n'), specimen.file).length === 0;
    })(),
  );
  // The residue count that carries it refuses a missing or impossible value in
  // the same shape as every other count in that line: a subset that could go
  // absent quietly renders as `undefined` in the one line a reader needs.
  const residueArgs = {
    discovered: 3, matched: 1, undetermined: 1, silent: 1, unfiltered: 0,
    unreachable: 0, swept: 10, artifactRosters: 0, invertedRosters: 0,
  };
  t(
    'the residue REFUSES an omitted documented-no-population count',
    (() => {
      try {
        residueLines({ ...residueArgs });
        return false;
      } catch {
        return true;
      }
    })(),
  );
  t(
    'and refuses one larger than the undetermined bucket it is a subset of',
    (() => {
      try {
        residueLines({ ...residueArgs, documentedNoPopulation: 2 });
        return false;
      } catch {
        return true;
      }
    })(),
  );
  t(
    'and renders the count when it is derivable',
    residueLines({ ...residueArgs, documentedNoPopulation: 1 })
      .some((l) => /1 of those 1 undetermined famil\(ies\) DECLARE/.test(l)),
  );

  // The live half. A marker is a claim about a gate, so it is held against the
  // real derivation: a family that DOES name paths must not be carrying one.
  // Without this the marker rots in the direction that costs — a gate grows a
  // real population, keeps its old declaration, and the residue keeps vouching
  // that its emptiness was examined.
  // ONE tree for the discovery and for the reconstruction below. The extractor
  // judges a single-segment directory literal against the tracked corpus, so a
  // reconstruction that read a different corpus — or none — would report the
  // rule as a mismatch rather than checking it.
  const liveTree = watchHintTree();
  const liveDiscovery = discoverFamilies({ tree: liveTree });
  const declaredEmpty = [...liveDiscovery.byCheck].filter(([, e]) => e.noPopulationReason);
  t(
    `the live tree carries at least one no-population declaration (the guard is not vacuous; found ${declaredEmpty.length})`,
    declaredEmpty.length > 0,
  );
  const contradicted = declaredEmpty.filter(([, e]) => (e.hints ?? []).length > 0).map(([c]) => c);
  t(
    `no family both DECLARES no path population and names paths anyway (contradicted: ${contradicted.join(', ') || 'none'})`,
    contradicted.length === 0,
  );
  t(
    'every live declaration carries a non-empty reason',
    declaredEmpty.every(([, e]) => typeof e.noPopulationReason === 'string' && e.noPopulationReason.length > 0),
  );
  // And a non-empty reason is not yet a WHOLE one (#18422). This is the live
  // half of the cut reading, held over the same corpus: the capture ends at the
  // first newline, so a reason an author wrapped passes the case above while
  // reaching the seat cut off mid-sentence. `scripts/bump-objectui.selftest.sh`
  // is the specimen this card was landed on — a six-line reason that reached
  // the seat as "every path this file writes or reads", rewritten onto one line
  // in the same PR because a refusal cannot land red on main.
  const npCut = declaredEmpty.filter(([, e]) => populationReasonCutRefusal(e, 'no-path-population')).map(([c]) => c);
  t(
    `every live no-path reason ENDS on its own marker line (cut: ${npCut.join(', ') || 'none'})`,
    npCut.length === 0,
  );
  t(
    'and that reading is not vacuous over this tree: a live entry reds the moment a continuation is put on it',
    (() => {
      const [, live] = declaredEmpty[0] ?? [null, null];
      if (!live) return false;
      const why = populationReasonCutRefusal(
        { ...live, noPopulationReasonCut: { file: 'scripts/probe.mjs', line: 9, text: 'and the rest of the sentence' } },
        'no-path-population',
      ) ?? '';
      return why.includes('scripts/probe.mjs:9');
    })(),
  );

  // The live half of the FORM roster and of the sound (#18661), over the same
  // corpus and for the same reason: a form set is a claim about the idioms this
  // tree's gates actually write in, so it is held against the tree rather than
  // against fixtures alone. Two directions, and they fail differently — the
  // first goes red when a form the tree uses stops being read, the second the
  // moment anyone writes a declaration this grammar drops.
  const liveSources = [...new Set([...liveDiscovery.byCheck].flatMap(([, e]) => e.files ?? []))].sort();
  const liveSourceText = new Map(
    liveSources
      .filter((f) => existsSync(nodePath.join(ROOT, f)))
      .map((f) => [f, readFileSync(nodePath.join(ROOT, f), 'utf8')]),
  );
  const liveBlockDeclared = [...liveSourceText]
    .filter(([, src]) => POPULATION_MARKER_KEYS.some((k) => readPopulationMarker(src, k)?.kind === 'block'))
    .map(([f]) => f);
  t(
    `the live tree's BLOCK-form declarations are READ and not dropped (found ${liveBlockDeclared.length}: ${liveBlockDeclared.join(', ') || 'none'})`,
    liveBlockDeclared.length > 0,
  );
  // The sound itself, and the one place it is RED at author time: every gate
  // source the discovery reads, swept for a line that reads like a declaration
  // and did not parse as one. The boundary is that corpus, deliberately — a
  // marker in a file no family reads declares nothing to begin with — and it is
  // the same corpus every reading above is held over.
  const liveUnparsed = [...liveSourceText].flatMap(([f, src]) => unparsedPopulationMarkers(src, f));
  t(
    `no live gate source carries a declaration this grammar drops, on any of the ${Object.keys(MARKER_LOOKALIKES).length} reason-bearing keys `
      + `(${liveSourceText.size} source(s) swept)`,
    liveUnparsed.length === 0,
    unparsedPopulationMarkerRefusal(liveUnparsed),
  );
  t(
    'and that sweep is not vacuous over this tree: take one LIVE declaration, re-spell its opener in a form the roster does not list, and exactly that line is found',
    (() => {
      const hit = [...liveSourceText]
        .map(([f, s]) => [f, s, readPopulationMarker(s, 'no-path-population')])
        .find(([, , read]) => read !== null);
      if (!hit) return false;
      const [file, src, read] = hit;
      const openers = new RegExp(`^[ \\t]*(${MARKER_COMMENT_FORMS.map((f) => f.open).join('|')})`);
      const lines = src.split('\n');
      lines[read.line - 1] = lines[read.line - 1].replace(openers, ';;');
      return unparsedPopulationMarkers(lines.join('\n'), file)
        .some((u) => u.line === read.line && u.form === ';;' && u.key === 'no-path-population');
    })(),
  );

  // The live half of the WHOLE-TREE channel (#14189), held to the same
  // standard and for the same reason: a declaration is a claim about a gate,
  // so it is graded against the real tree. The direction that costs here is a
  // declaration that rots into a lie — the gate stops sweeping the tree, keeps
  // the marker, and a wrong row goes out on every card forever.
  const declaredWholeTree = [...liveDiscovery.byCheck].filter(([, e]) => e.wholeTreeReason);
  t(
    `the live tree carries at least one whole-tree declaration (the guard is not vacuous; found ${declaredWholeTree.length})`,
    declaredWholeTree.length > 0,
  );
  t(
    'every live whole-tree declaration carries a non-empty reason',
    declaredWholeTree.every(([, e]) => typeof e.wholeTreeReason === 'string' && e.wholeTreeReason.length > 0),
  );
  const wtRefused = declaredWholeTree
    .map(([c, e]) => [c, wholeTreePopulationRefusal(e)])
    .filter(([, why]) => why);
  t(
    `every live whole-tree declaration is BACKED by a repo-root walk in its own source and contradicts no other marker (refused: ${wtRefused.map(([c]) => c).join(', ') || 'none'})`,
    wtRefused.length === 0,
  );
  // The wholeness half, named apart from the refusal above it (#18422): the
  // refusal covers it, and a reader of a red run is owed which of the two
  // claims failed rather than one line covering both.
  const wtCut = declaredWholeTree.filter(([, e]) => populationReasonCutRefusal(e, 'whole-tree-population')).map(([c]) => c);
  t(
    `every live whole-tree reason ENDS on its own marker line (cut: ${wtCut.join(', ') || 'none'})`,
    wtCut.length === 0,
  );
  t(
    'and not vacuously: a live whole-tree entry reds the moment a continuation is put on it',
    (() => {
      const [, live] = declaredWholeTree[0] ?? [null, null];
      if (!live) return false;
      return (wholeTreePopulationRefusal({
        ...live, wholeTreeReasonCut: { file: 'scripts/probe.mjs', line: 9, text: 'and the rest of the sentence' },
      }) ?? '').includes('scripts/probe.mjs:9');
    })(),
  );
  // The placement claim, live: whatever card is being derived, a declaring
  // family is out of all three verdicts. Two unrelated probe surfaces, because
  // the claim is precisely that the answer does not depend on the card.
  t(
    'no live declaring family lands in matched, silent or undetermined for any card',
    ['packages/rest/src/server.ts', 'docs/adr/0112-x.md', 'scripts/check-nul-bytes.mjs'].every((p) =>
      declaredWholeTree.every(([, e]) => placeFamily(e, [p]).verdict === 'always-runs')),
  );

  // The live half of the WIDE-population channel (#15341), held to the same
  // standard as the two above and for the same reason: a declaration is a claim
  // about a gate, graded against the real tree. The direction that costs here
  // is the one the recorded triage is guarding — a marker that rots into a lie
  // by sitting above a population the gate later declares, so a reader is told
  // "nothing can narrow this" while the matched column narrows it.
  const declaredWide = [...liveDiscovery.byCheck].filter(([, e]) => e.widePopulationReason);
  t(
    `the live tree carries at least one wide-population declaration (the guard is not vacuous; found ${declaredWide.length})`,
    declaredWide.length > 0,
  );
  t(
    'every live wide-population declaration carries a non-empty reason',
    declaredWide.every(([, e]) => typeof e.widePopulationReason === 'string' && e.widePopulationReason.length > 0),
  );
  const wpRefused = declaredWide
    .map(([c, e]) => [c, widePopulationRefusal(e)])
    .filter(([, why]) => why);
  t(
    `every live wide-population declaration names ONE population shape — no sibling marker, no scanned path population (refused: ${wpRefused.map(([c]) => c).join(', ') || 'none'})`,
    wpRefused.length === 0,
  );
  // The wholeness half (#18422), and it matters most on THIS channel: the
  // refusal above grades the reason TEXT against the gate's own hints, so a
  // reason cut at the first newline would have the hints its wrapped half
  // accounts for read as unaccounted for — a confident refusal naming the
  // wrong defect. Wide reasons are also the longest in the tree (past 1200
  // characters on one line), which is exactly where an author reaches for a
  // wrap.
  const wpCut = declaredWide.filter(([, e]) => populationReasonCutRefusal(e, 'wide-population')).map(([c]) => c);
  t(
    `every live wide-population reason ENDS on its own marker line (cut: ${wpCut.join(', ') || 'none'})`,
    wpCut.length === 0,
  );
  t(
    'and not vacuously: a live wide-population entry reds the moment a continuation is put on it',
    (() => {
      const [, live] = declaredWide[0] ?? [null, null];
      if (!live) return false;
      return (widePopulationRefusal({
        ...live, widePopulationReasonCut: { file: 'scripts/probe.mjs', line: 9, text: 'and the rest of the sentence' },
      }) ?? '').includes('scripts/probe.mjs:9');
    })(),
  );
  // The two columns, live and per-card. The probe paths are under the roots
  // these gates actually walk, which is the case the ruling is about: the
  // family must be DECLARED there and must not be MATCHED there.
  t(
    'no live wide-population family is matched by a card under the roots it walks — it stays in its own declared column',
    ['packages/rest/src/server.ts', 'packages/core/src/kernel.ts', 'examples/app-crm/src/index.ts', 'apps/docs/next.config.mjs']
      .every((p) => declaredWide.every(([, e]) => placeFamily(e, [p]).verdict === 'wide-population')),
  );
  t(
    'and none of them is left in `undetermined` for a card that touches nothing of theirs — the bucket the ruling moved them OUT of',
    declaredWide.every(([, e]) => placeFamily(e, ['README.md']).verdict === 'wide-population'),
  );

  // ── The WHOLE-TREE RESIDUE (#15312) ───────────────────────────────────────
  //
  // The channel above says what a DECLARING family gets. This says what happens
  // to a family that should have declared and did not — the case the card was
  // filed on, where a gate CI runs appeared in no seat's runnable list and the
  // seat learned about it from CI a cycle later. Every fixture case below names
  // the limb it discriminates; the live case is the one that can go red on a
  // gate added tomorrow, which is the whole point of the table it grades.
  const rwEntry = (over = {}) => ({
    rootWalk: REPO_ROOT_WALK_SPELLINGS[0].label,
    wholeTreeReason: null,
    noPopulationReason: null,
    ...over,
  });
  t(
    'an undeclared, unplaceable repo-root walker IS a member, and comes back as the walk that made it one',
    unnamedRootWalk(rwEntry(), 'undetermined') === REPO_ROOT_WALK_SPELLINGS[0].label,
  );
  t(
    'a `silent` one is a member too — silent and undetermined are both "no card names it"',
    unnamedRootWalk(rwEntry(), 'silent') === REPO_ROOT_WALK_SPELLINGS[0].label,
  );
  t(
    'declaring the whole tree LEAVES the population — the repair this table exists to push toward',
    unnamedRootWalk(rwEntry({ wholeTreeReason: 'sweeps git ls-files' }), 'undetermined') === null,
  );
  t(
    'and so does declaring no path population — the opposite answer, but an examined one either way',
    unnamedRootWalk(rwEntry({ noPopulationReason: 'the self-test is the whole run' }), 'undetermined') === null,
  );
  t(
    'a family the derivation can place BY PATH is not a member: a seat is already told about it',
    unnamedRootWalk(rwEntry(), 'matched') === null,
  );
  t(
    'and neither is a gate whose source carries no repo-root walk at all — this population is one CLASS, not the whole residue',
    unnamedRootWalk(rwEntry({ rootWalk: null }), 'undetermined') === null,
  );
  // LIVE, against the real tree, and the case the next unnamed census gate reds
  // on. The probe card is every tracked file MINUS the family's own file
  // closure: without the subtraction every family matches the card that edits
  // the gate itself, through the identity key, and this whole population would
  // score empty while reading like a pass.
  {
    const liveAll = [...liveTree.files];
    const members = [];
    for (const [check, entry] of liveDiscovery.byCheck) {
      if (!entry.rootWalk || entry.wholeTreeReason || entry.noPopulationReason) continue;
      const own = new Set(entry.files ?? []);
      const probe = own.size ? liveAll.filter((f) => !own.has(f)) : liveAll;
      const walk = unnamedRootWalk(entry, placeFamily(entry, probe).verdict);
      if (walk) members.push(check);
    }
    const unlisted = members.filter((c) => !ROOT_WALK_RESIDUE_REASONS.has(c)).sort();
    const stale = [...ROOT_WALK_RESIDUE_REASONS.keys()].filter((c) => !members.includes(c)).sort();
    t(
      'every gate CI runs whose own source sweeps the repo root is DECLARED whole-tree, declared path-less, ' +
        'derivable by path, or a justified row in ROOT_WALK_RESIDUE_LEDGER' +
        (unlisted.length ? ` — unlisted: ${unlisted.join(', ')}` : '') +
        (stale.length ? ` — listed but no longer a member: ${stale.join(', ')}` : ''),
      unlisted.length === 0 && stale.length === 0,
    );
    // The control that makes the case above an instrument. A sweep that silently
    // found NOTHING — a renamed field, a discovery that stopped reading gate
    // sources — reports "nothing unlisted" and is indistinguishable from a pass,
    // which is #4690 pointed at this file's own guard. So the population has to
    // be seen to be non-empty, and the gate the card was filed on has to be seen
    // to have LEFT it by declaring rather than by going unmeasured.
    t(
      `control: the residue population is non-empty (${members.length} member(s)), so the case above is measuring something`,
      members.length > 0,
    );
    t(
      'control: the card\'s own specimen has left this population through the BUCKET, not through the ledger — ' +
        'check:driver-memory-census declares whole-tree, is backed by its walk, and is in no exclusion row',
      Boolean(liveDiscovery.byCheck.get('check:driver-memory-census')?.wholeTreeReason)
        && wholeTreePopulationRefusal(liveDiscovery.byCheck.get('check:driver-memory-census')) === null
        && !ROOT_WALK_RESIDUE_REASONS.has('check:driver-memory-census'),
    );
    t(
      'every ledger row carries a reason that says what the gate reads INSTEAD — a reason-less exclusion is the ' +
        'placeholder shape both markers refuse',
      ROOT_WALK_RESIDUE_LEDGER.every(([, why]) => typeof why === 'string' && why.trim().length > 40),
    );
  }

  // ── The CI-MEASURED-ONLY shape (#14004) ───────────────────────────────────
  //
  // The two markers above are DECLARATIONS a gate carries. This one is the
  // opposite kind of reading and the difference is the point: nothing is
  // declared anywhere, the classification is a SHAPE read off the gate's own
  // source, so a family added tomorrow classifies itself with nothing here to
  // update. What it buys is that a row whose only possible local outcome is a
  // nonzero exit stops being advertised as a runnable command.
  t('limb 1 reads the payload access in its dotted spelling', payloadEnvDependence('const p = process.env.GITHUB_EVENT_PATH;') === 'GITHUB_EVENT_PATH');
  t('and in the bracketed spelling, and through a local `env` alias — one read, two ways to write it', payloadEnvDependence("const env = process.env;\nconst p = env['GITHUB_EVENT_PATH'];") === 'GITHUB_EVENT_PATH');
  // What a gate SAYS is not what it READS, and the direction of this mistake
  // is the expensive one: a false positive here SUBTRACTS a real command from
  // --commands, silently.
  t('a gate that only MENTIONS the variable in a comment is not classified by its prose', payloadEnvDependence('// this gate does not read process.env.GITHUB_EVENT_PATH\nconst x = 1;\n') === null);
  t('nor is one that only names it in a message string', payloadEnvDependence('throw new Error("could not read GITHUB_EVENT_PATH");') === null);
  t('nor is one whose --self-test body stages it as a fixture (the self-test is not the gate\'s work)', payloadEnvDependence('function selfTest() {\n  process.env.GITHUB_EVENT_PATH = "/tmp/e.json";\n}\n') === null);
  t('an unrelated env read is not a payload dependence', payloadEnvDependence('const x = process.env.OS_LOG_LEVEL;') === null);
  // LIVE, against the real specimen the card was filed on: a fixture-only pin
  // would stay green if the gate were rewritten to read the payload some other
  // way, and the whole classification is about THAT file.
  t(
    'LIVE: the queue guard\'s own source still carries the payload dependence this reads',
    payloadEnvDependence(readFileSync(nodePath.join(ROOT, 'scripts/pm/check-governed-queue-guard.mjs'), 'utf8')) === 'GITHUB_EVENT_PATH',
  );

  // limb 2, both directions. It selects 43 families on this tree ALONE, so
  // every case below is about the conjunction: limb 1 is what discriminates,
  // limb 2 only ever refuses.
  const ciEntry = (over = {}) => ({
    direct: true,
    files: ['scripts/pm/check-a-payload-gate.mjs'],
    payloadEnv: 'GITHUB_EVENT_PATH',
    ...over,
  });
  t('both limbs together classify a direct, payload-reading family as CI-measured', ciOnlyMeasurement(ciEntry(), {})?.env === 'GITHUB_EVENT_PATH');
  t(
    'limb 2 REFUSES when a root manifest script names the gate\'s file — someone can run it here, so nothing may be subtracted',
    ciOnlyMeasurement(ciEntry(), { 'check:a-payload-gate': 'node scripts/pm/check-a-payload-gate.mjs' }) === null,
  );
  t(
    'and refuses a `check:*` family outright — an npm-script name IS a local invocation, whatever the gate reads',
    ciOnlyMeasurement(ciEntry({ direct: false, files: ['scripts/pm/check-a-payload-gate.mjs'] }), {}) === null,
  );
  t(
    'limb 1 is REQUIRED — without it limb 2 alone would subtract every directly-invoked gate in the repo',
    ciOnlyMeasurement(ciEntry({ payloadEnv: null }), {}) === null,
  );

  // LIVE: the classification against the real derivation, in BOTH directions.
  // The positive alone would pass on a rule that classified everything; the
  // negative alone would pass on a rule that classified nothing.
  const liveCiOnly = [...liveDiscovery.byCheck].filter(([, e]) => e.ciOnly);
  t(
    `LIVE: exactly one family classifies CI-measured, and it is the queue guard (got: ${liveCiOnly.map(([c]) => c).join(', ') || 'none'})`,
    liveCiOnly.length === 1 && liveCiOnly[0][0] === 'scripts/pm/check-governed-queue-guard.mjs',
  );
  t(
    'LIVE: an ordinary local family on the same card is NOT classified — the rule discriminates rather than sweeping',
    liveDiscovery.byCheck.get('check:nul-bytes') && !liveDiscovery.byCheck.get('check:nul-bytes').ciOnly,
  );
  t(
    'LIVE: and neither is a directly-invoked gate that reads no payload (limb 2 is not the classifier)',
    [...liveDiscovery.byCheck].some(([, e]) => e.direct && !e.ciOnly),
  );

  // The renderings, driven off rows of the shape `derive` builds. Each is the
  // half a consumer actually reads, and they must agree.
  {
    const ciRow = { check: 'g', command: 'node scripts/pm/check-a-payload-gate.mjs', workflows: ['w.yml'], via: [], ciOnly: { env: 'GITHUB_EVENT_PATH' } };
    const localRow = { check: 'check:b', command: 'pnpm check:b', workflows: ['lint.yml'], via: [], ciOnly: null };
    t('--commands omits the CI-measured row and keeps the runnable one', commandsFor({ matchedRows: [ciRow, localRow] }).join('|') === 'pnpm check:b');
    // The exclusion follows the COMMAND, not the section it arrived through.
    // Unreachable today — no CI-measured family sits in CHANGE_KIND_GATES —
    // and pinned anyway, because a rule that held in one section and not the
    // other would re-emit the row through the block the published snippet
    // cannot even harvest.
    {
      const kindEcho = [{ kind: 'a kind', gates: [{ name: 'g', why: 'because', command: ciRow.command }] }];
      t(
        'and it stays omitted when a change KIND names the same family, which is the other section it could arrive through',
        commandsFor({ matchedRows: [ciRow, localRow], kindGroups: kindEcho }).join('|') === 'pnpm check:b',
      );
      const kindRecon = familyReconciliation({ matchedRows: [ciRow, localRow], kindGroups: kindEcho });
      t('the reconciliation still CLOSES on that input rather than counting a term the union does not have', kindRecon.total === 1 && kindRecon.convention === 0);
      t(
        'and the rows-versus-commands note names that reason instead of charging it to a repeat',
        familyReconciliationLines(kindRecon).some((l) => l.includes('1 CI-measured only, contributing no runnable command')),
      );
    }
    const recon = familyReconciliation({ matchedRows: [ciRow, localRow] });
    t('the reconciliation total is the RUNNABLE answer — the CI-measured row is outside it', recon.total === 1 && recon.matched === 1);
    t('and the omission is a term it carries rather than a difference the reader has to notice', recon.ciOnly === 1 && recon.ciOnlyRows === 1);
    t(
      'the rendered reconciliation states that term out loud',
      familyReconciliationLines(recon).some((l) => l.includes('CI-MEASURED ONLY') && l.includes('omitted from --commands')),
    );
    // The reading that must not come out as a bare "nothing matched": a card
    // whose ONLY matched family is CI-measured.
    const ciAlone = familyReconciliation({ matchedRows: [ciRow] });
    t(
      'a card whose only match is CI-measured still says so at a total of zero',
      ciAlone.total === 0 && familyReconciliationLines(ciAlone).some((l) => l.includes('CI-MEASURED ONLY')),
    );
  }

  // ── Hints come from the COMMAND's named scripts AND, one level down, from
  //    the first-party modules those scripts import (#11190) ─────────────────
  //
  // Load-bearing, and pinned here because a decision rests on it (#10542).
  // Until #11190 this section asserted the OPPOSITE — "a family's hints are
  // exactly those of the scripts its COMMAND names" — and that was true:
  // `resolveCheckToFiles` reads script paths out of the npm script's COMMAND
  // STRING and `discoverFamilies` scanned exactly those files, so moving a
  // population declaration into a shared enumerator DELETED it from every gate
  // that imports it. That is the blocker #11190 removed, so the assertion is
  // INVERTED here rather than deleted: what a later author must measure is now
  // that imports ARE followed, exactly one level, and never into a module that
  // is itself a gate.
  //
  // ⚠️ The old pin did NOT go red on the change that falsified it, and that is
  // why every case below names its specimen with a COUNT. It took "the first
  // single-file family that imports a sibling" as its specimen; measured on
  // this tree, 80 families answer that description, only 3 of them would have
  // failed it, and the one it picks (`scripts/check-adr-links.mjs`, importing
  // `invoked-as.mjs`, which declares no path literal at all) is not among them.
  // A pin whose specimen is chosen by iteration order can be true of the tree
  // and silent about the rule.
  const liveGateFiles = new Set([...liveDiscovery.byCheck.values()].flatMap((e) => e.files ?? []));
  const liveSource = (rel) => readFileSync(nodePath.join(ROOT, rel), 'utf8');
  // A followed module's hints AS A FOLLOWER RECEIVES THEM. `discoverFamilies`
  // reads `declaredInheritedPopulation` at this seam (`hintsOfModule`), so a
  // reconstruction that re-scanned the raw literals instead would redden for
  // every family importing a module that narrows — while the case it feeds
  // asserts, in its own name, that a shared enumerator CAN carry a population
  // declaration for its callers. It was raw until #12500 put the second live
  // declaration in the tree, and the two i18n families are what found it.
  const liveModuleHints = (rel) => {
    const source = liveSource(rel);
    const spelled = extractWatchHints(source, rel, { tree: liveTree });
    return declaredInheritedPopulation(source, spelled, rel)?.population ?? spelled;
  };
  const liveTargets = (rel) => firstPartyImportTargets(rel, liveSource(rel));
  // The THIRD followed edge (#13518). Its population comes from the manifest's
  // own `exports` declaration rather than from a module's literals, so the
  // reconstruction reads it the same way `discoverFamilies` does instead of
  // routing it through `liveModuleHints`, which would ask a JSON file for
  // JavaScript literals.
  const liveManifestHints = (rel) => {
    const dir = rel.slice(0, Math.max(0, rel.length - 'package.json'.length - 1));
    if (!dir) return [];
    let exportsMap;
    try {
      exportsMap = JSON.parse(liveSource(rel))?.exports;
    } catch {
      return [];
    }
    if (!exportsMap || typeof exportsMap !== 'object' || Object.keys(exportsMap).length === 0) return [];
    const src = `${dir}/src`;
    return liveTree.prefixes.has(src) && !liveTree.files.has(src) ? [src] : [];
  };

  // The recogniser, on fixture source: one line per refusal, so a widening or
  // a narrowing of the rule fails HERE with its reason named, rather than as a
  // pair count nobody can attribute afterwards.
  const importFixture = [
    "import { isEntrypoint } from './invoked-as.mjs';", // followed
    "export { blank } from './js-comment-mask.mjs';", // export-from is the same edge
    "import './pm/git-history.mjs';", // so is the side-effect form
    "import { readFileSync } from 'node:fs';", // bare: a package, not a repo path
    "import { z } from '@objectstack/spec';", // bare, workspace link: node_modules
    "import pkg from '../package.json';", // first-party, but outside scripts/
    "import { x } from './does-not-exist.mjs';", // a specifier, not a module
    '// import { y } from "./adr-anchors.mjs";', // named in a comment, loaded by nobody
    'function selfTest() {',
    '  const fixture = "import { z } from \'./regen-artifacts.mjs\';";',
    '}',
  ].join('\n');
  t(
    'the follow reads the three static import forms, and refuses bare, out-of-tree, unresolvable, commented and self-test spellings',
    firstPartyImportTargets('scripts/fixture.mjs', importFixture).join(' · ') ===
      'scripts/invoked-as.mjs · scripts/js-comment-mask.mjs · scripts/pm/git-history.mjs',
    firstPartyImportTargets('scripts/fixture.mjs', importFixture).join(' · '),
  );

  // ── The per-CALLER half of an inherited population (#17991) ───────────────
  //
  // `declaredInheritedPopulation` is keyed on the MODULE, and whether a
  // contribution is fabricated is a property of the CALLER: the same module's
  // globs ARE a population for an importer that reads them and a fabrication
  // for one that takes a single constant out of the file. One declaration
  // cannot be both, so the caller's own BINDING decides. Fixtures first, in
  // both directions, then the live shape the card was filed for.
  const bindingOf = (clause) =>
    firstPartyImportBindings('scripts/fixture.mjs', `${clause} from './invoked-as.mjs';\n`)
      .get('scripts/invoked-as.mjs') ?? null;
  t(
    'a named import binds its names, read at the EXPORTER\'s spelling rather than the local alias',
    bindingOf('import { ALPHA, BETA as LOCAL }')?.names.join(' · ') === 'ALPHA · BETA'
      && bindingOf('import { ALPHA, BETA as LOCAL }')?.whole === false,
    JSON.stringify(bindingOf('import { ALPHA, BETA as LOCAL }')),
  );
  t(
    'and every clause with no name list to read binds the WHOLE module — namespace, default, mixed, re-export,'
      + ' side-effect — which is the inheriting direction and therefore the direction an unreadable clause takes',
    [
      bindingOf('import * as everything'),
      bindingOf('import theDefault'),
      bindingOf('import theDefault, { ALPHA }'),
      bindingOf('export { ALPHA }'),
      firstPartyImportBindings('scripts/fixture.mjs', "import './invoked-as.mjs';\n").get('scripts/invoked-as.mjs'),
    ].every((b) => b?.whole === true && b.names.length === 0),
  );

  // The exporter half. The fixture carries one declaration of every shape the
  // recogniser must answer, so a widening or a narrowing of it fails HERE with
  // the shape named rather than as a lead count nobody can attribute after.
  const valueExporterFixture = [
    "export const TIER_NAME = 'a-model-id';",
    'export const LIMIT = 12;',
    'export const OPEN = true;',
    'export const NOTHING = null;',
    "export const ANCHOR_DIR = 'scripts/adr-anchors';",
    'export const GLOBS = [',
    "  'packages/spec/src/**',",
    '];',
    'export const TABLE = { where: \'packages/plugins\' };',
    'export function covers(glob, candidate) {',
    '  return glob === candidate;',
    '}',
    'export class Walker {}',
    'export const JOINED = ANCHOR_DIR + \'/shards\';',
    'export const WRAPPED =',
    "  'scripts/adr-anchors';",
    'const NOT_EXPORTED = \'x\';',
    'export { NOT_EXPORTED };',
  ].join('\n');
  const valueOf = (name) => exportedValueConstant(valueExporterFixture, name);
  t(
    'exportedValueConstant reads a string, a number, a boolean and null as VALUES, and the string carries its own text',
    valueOf('TIER_NAME')?.literal === 'a-model-id'
      && valueOf('ANCHOR_DIR')?.literal === 'scripts/adr-anchors'
      && valueOf('LIMIT')?.literal === null
      && valueOf('OPEN')?.literal === null
      && valueOf('NOTHING')?.literal === null,
    JSON.stringify(['TIER_NAME', 'ANCHOR_DIR', 'LIMIT', 'OPEN', 'NOTHING'].map((n) => [n, valueOf(n)])),
  );
  t(
    'and refuses every other declaration — an array, an object, a function, a class, a computed initialiser,'
      + ' one wrapped onto a second line, a name re-exported rather than declared, and a name the module never declares',
    ['GLOBS', 'TABLE', 'covers', 'Walker', 'JOINED', 'WRAPPED', 'NOT_EXPORTED', 'ABSENT'].every((n) => valueOf(n) === null),
    JSON.stringify(['GLOBS', 'TABLE', 'covers', 'Walker', 'JOINED', 'WRAPPED', 'NOT_EXPORTED', 'ABSENT'].map((n) => [n, valueOf(n)])),
  );

  // The rule itself, over that one fixture module and one fixture population.
  const fixturePopulation = ['packages/spec/src/**', 'scripts/adr-anchors'];
  const binds = (...names) => ({ names, whole: false });
  t(
    'a caller that binds ONLY value constants inherits nothing — a value carries no behaviour and no table,'
      + ' so every pair the module would contribute to it is a fabricated lead',
    importBindsNoPopulation(binds('TIER_NAME'), valueExporterFixture, fixturePopulation) === true
      && importBindsNoPopulation(binds('TIER_NAME', 'LIMIT', 'OPEN'), valueExporterFixture, fixturePopulation) === true,
  );
  t(
    'and a table, a function, a class, an unreadable name, a WHOLE-module clause and a mixed list all keep inheriting'
      + ' — the follow exists because a population MOVED into a shared module, and it moves into exactly those shapes',
    [
      binds('GLOBS'),
      binds('covers'),
      binds('Walker'),
      binds('ABSENT'),
      binds('TIER_NAME', 'GLOBS'),
      { names: [], whole: true },
      { names: [], whole: false },
    ].every((b) => importBindsNoPopulation(b, valueExporterFixture, fixturePopulation) === false),
  );
  t(
    'but a string constant whose own text is one of the module\'s paths is NOT inert: a one-path population is a'
      + ' population, and binding it is reading it',
    importBindsNoPopulation(binds('ANCHOR_DIR'), valueExporterFixture, fixturePopulation) === false
      && importBindsNoPopulation(binds('ANCHOR_DIR'), valueExporterFixture, []) === true,
  );

  // The live halves. Counts in the names, for the reason the follow's own live
  // cases carry them: a case that can only be read as "something was found" is
  // the shape the old pin failed in.
  const inertEdges = [];
  const bearingEdges = [];
  for (const [check, entry] of liveDiscovery.byCheck) {
    if (entry.selfTest) continue;
    for (const f of entry.files ?? []) {
      if (!existsSync(nodePath.join(ROOT, f))) continue;
      for (const [mod, binding] of firstPartyImportBindings(f, liveSource(f))) {
        if (liveGateFiles.has(mod)) continue;
        const edge = [check, mod, binding.whole ? '*' : binding.names.join('+')];
        if (importBindsNoPopulation(binding, liveSource(mod), liveModuleHints(mod))) inertEdges.push(edge);
        else bearingEdges.push(edge);
      }
    }
  }
  t(
    `the narrowing is NOT vacuous on this tree — ${inertEdges.length} of ${inertEdges.length + bearingEdges.length}`
      + ` followed import edge(s) bind only value constants`
      + ` (${inertEdges.map(([c, m, n]) => `${c} -> ${m} {${n}}`).join(' · ') || 'none'})`,
    inertEdges.length > 0,
  );
  const stillFabricating = inertEdges.filter(([check, mod]) => {
    const entry = liveDiscovery.byCheck.get(check);
    // A family whose OTHER file reads the same module's population inherits it
    // on that file's account — the union is the rule, so only an edge no file
    // of the family bound population-bearingly is owed an empty origin here.
    if ((entry?.populationImports ?? new Set()).has(mod)) return false;
    return [...(entry?.hintOrigin ?? new Map())].some(([, origin]) => origin === mod);
  });
  t(
    'and not one of those edges contributes a hint to the family that binds it'
      + `${stillFabricating.length ? ` — STILL FABRICATING: ${stillFabricating.map(([c, m]) => `${c} <- ${m}`).join(' · ')}` : ''}`,
    stillFabricating.length === 0,
  );
  const bothWays = [...new Set(inertEdges.map(([, m]) => m))].filter((m) => bearingEdges.some(([, bm]) => bm === m));
  t(
    'the answer is a property of the CALLER and not of the module — the live tree has'
      + ` ${bothWays.length} module(s) answering BOTH ways (${bothWays.join(' · ') || 'none'}),`
      + ' which is the shape no per-module declaration can express',
    bothWays.length > 0,
  );
  const populationLost = bothWays.filter((mod) =>
    liveModuleHints(mod).length > 0
    && bearingEdges
      .filter(([, bm]) => bm === mod)
      .some(([check]) => !liveModuleHints(mod).every((h) => (liveDiscovery.byCheck.get(check)?.hints ?? []).includes(h))),
  );
  t(
    'and the caller that BINDS the population still inherits every path of it'
      + `${populationLost.length ? ` — LOST: ${populationLost.join(' · ')}` : ''}`,
    populationLost.length === 0,
  );

  // The live halves. Counts in the names: a case that can only be read as
  // "something was found" is the shape the old pin failed in.
  const inheriting = [...liveDiscovery.byCheck].filter(([, e]) => (e.hintOrigin?.size ?? 0) > 0);
  const inheritedHints = inheriting.reduce((n, [, e]) => n + e.hintOrigin.size, 0);
  t(
    `the live tree inherits hints through a FOLLOWED program at all (${inheriting.length} famil(ies), ${inheritedHints} hint(s):` +
      ` ${inheriting.map(([c, e]) => `${c} +${e.hintOrigin.size}`).join(', ') || 'none'})`,
    inheriting.length > 0,
  );

  const offReconstruction = [];
  const deeperOnly = [];
  for (const [check, entry] of liveDiscovery.byCheck) {
    const own = [];
    const direct = [];
    const manifests = [];
    for (const f of entry.files ?? []) {
      if (!existsSync(nodePath.join(ROOT, f))) continue;
      const source = liveSource(f);
      own.push(...extractWatchHints(source, f, { tree: liveTree }));
      // Modelled through the BINDING (#17991), never through the bare edge: a
      // reconstruction that summed every followed module would redden for the
      // one family whose import binds a value, while the case it feeds asserts
      // in its own name that a caller decides what it inherits.
      for (const [mod, binding] of firstPartyImportBindings(f, source)) {
        if (liveGateFiles.has(mod) || direct.includes(mod)) continue;
        if (importBindsNoPopulation(binding, liveSource(mod), liveModuleHints(mod))) continue;
        direct.push(mod);
      }
      // The second followed edge (#13511), reconstructed here for the same
      // reason as the first: the invariant is "own PLUS what the gate reaches",
      // and a reconstruction that models only one edge stops describing the
      // derivation the moment the other one fires.
      for (const ran of spawnedProgramTargets(f, source, (x) => liveTree.files.has(x))) {
        if (liveGateFiles.has(ran) || direct.includes(ran)) continue;
        direct.push(ran);
      }
      // The third followed edge (#13518), reconstructed for the same reason as
      // the other two. It is kept in its OWN list because its population is
      // read from the followed file's `exports` map, not from its literals.
      for (const pkg of packageManifestTargets(f, source, (x) => liveTree.files.has(x))) {
        if (manifests.includes(pkg)) continue;
        manifests.push(pkg);
      }
    }
    // A `--self-test` family follows NO edge at all (#11404, #13511, #13518),
    // so its expectation is its own hints and nothing else. Reconstructed from
    // the same `selfTest` flag `discoverFamilies` reads, never from a list here.
    const expected = new Set(
      entry.selfTest
        ? own
        : [...own, ...direct.flatMap(liveModuleHints), ...manifests.flatMap(liveManifestHints)],
    );
    const actual = new Set(entry.hints ?? []);
    if (expected.size !== actual.size || [...actual].some((h) => !expected.has(h))) offReconstruction.push(check);
    // The depth bound, family by family: a module reached only through another
    // module is not in the followed set. Non-vacuous wherever a followed
    // module imports something the family does not import itself.
    // "Reached ONLY through another module" is the claim, so a module the
    // family imports ITSELF is out of the two-hop set however it was bound: an
    // inert edge (#17991) is absent from `direct` and present in `entry.imports`,
    // and without this second filter it would read as a depth-2 follow.
    const twoHop = direct
      .flatMap((m) => liveTargets(m))
      .filter((m) => !direct.includes(m) && !(entry.imports ?? []).includes(m));
    if (twoHop.length > 0 && (entry.imports ?? []).some((m) => twoHop.includes(m))) deeperOnly.push(check);
  }
  t(
    "a family's hints are exactly those of the scripts its COMMAND names PLUS those of the first-party modules" +
      ' those scripts import AND the in-tree programs they run AND the export surface of the packages whose' +
      ' manifest they read — so a shared enumerator CAN carry a population' +
      ` declaration for its callers (off: ${offReconstruction.join(', ') || 'none'})`,
    offReconstruction.length === 0,
  );
  t(
    `and one level only: nothing a followed module imports in turn reaches the family (offenders: ${deeperOnly.join(', ') || 'none'})`,
    deeperOnly.length === 0,
  );
  const twoHopChains = [...new Set([...liveDiscovery.byCheck.values()].flatMap((e) => e.imports ?? []))]
    .map((m) => [m, liveTargets(m)])
    .filter(([, deeper]) => deeper.length > 0);
  t(
    `the depth bound is not vacuous: ${twoHopChains.length} followed module(s) import first-party modules of their own` +
      ` (${twoHopChains.map(([m, d]) => `${m} -> ${d.join(' · ')}`).join(' | ') || 'none'})`,
    twoHopChains.length > 0,
  );

  // The exclusion that decides the NUMBER. Measured on this tree: following
  // gate modules too takes the sweep from +893 (gate, file) pairs to +4907,
  // and 3065 of the extra 4014 are check:examples-live-imports inheriting the
  // repo-wide declaration table of a gate it imports one string helper from.
  // A gate module needs no caller to reach the tree — its own family declares
  // that population — so the follow leaves it to that family.
  const gateModuleEdges = [];
  for (const [check, entry] of liveDiscovery.byCheck) {
    for (const f of entry.files ?? []) {
      if (!existsSync(nodePath.join(ROOT, f))) continue;
      for (const mod of liveTargets(f)) {
        if (liveGateFiles.has(mod) && !(entry.files ?? []).includes(mod)) gateModuleEdges.push([check, mod]);
      }
    }
  }
  t(
    `the live tree HAS a gate script importing another gate's file, so the exclusion is not vacuous (${gateModuleEdges.length}:` +
      ` ${gateModuleEdges.map(([c, m]) => `${c} -> ${m}`).join(' · ') || 'none'})`,
    gateModuleEdges.length > 0,
  );
  t(
    'and not one of those edges is followed — a gate module is left to its OWN family, which already declares that population',
    gateModuleEdges.every(([check, mod]) => !(liveDiscovery.byCheck.get(check)?.imports ?? []).includes(mod)),
  );

  // Provenance travels with an inherited hint, for the reason `coveringKey`'s
  // docblock gives for the other two keys: "this gate declares that path" and
  // "a module this gate imports declares it" are different claims, and the
  // column that justifies a lead has to say which.
  // The specimen has to be a hint that DECIDES a lead. An inherited path that
  // the family's own gate script covers answers through the IDENTITY key
  // first, one CI schedules answers through the TRIGGER key, and one a
  // resolvable job `if:` reaches answers through the JOB-FILTER key (#12956) —
  // all correct, all silent about this label — so the specimen is picked from
  // the pairs where none of those can answer. (The third exclusion surfaced
  // when #13312's @-scope refusal thinned the inherited pairs and the find
  // landed on a job-filtered family first.)
  const inheritedLead = inheriting
    .flatMap(([, entry]) => [...entry.hintOrigin].map(([hint, mod]) => [entry, hint, mod]))
    .find(
      ([entry, hint]) =>
        // IMPORT-edge only. The run edge (#13511) renders a label of its own and
        // is pinned in its own section below; letting the find drift onto it
        // would silently turn this case into a test of the other edge.
        entry.hintEdge?.get(hint) !== 'run' &&
        !(entry.files ?? []).some((f) => hintCovers(f, hint)) &&
        !coveringTrigger(entry, hint) &&
        !coveringJobFilter(entry, hint) &&
        coveringKey(entry, hint)?.key === hint,
    );
  t(
    `an inherited hint reaches the matched column as a lead of its own (${inheritedLead ? `${inheritedLead[1]} from ${inheritedLead[2]}` : 'none'})`,
    Boolean(inheritedLead),
  );
  if (inheritedLead) {
    const [entry, hint, mod] = inheritedLead;
    t(
      `…and the via column names the module it came from, not the gate (${coveringKey(entry, hint)?.via})`,
      coveringKey(entry, hint)?.via === `gate source via ${mod}`,
    );
  }

  // ── The PROGRAM a gate opens by path (#13000) ─────────────────────────────
  //
  // The second undeclared dependency, beside the import above: a gate that
  // opens another script's source at a path anchored to its own location. The
  // card's instance is a STAGED COPY — the digest writes the ADR-0087 gate into
  // a throwaway repo and runs it — and the three shapes (stage it, execute it,
  // assert on it) are one dependency, so the recogniser reads the READ.
  //
  // The recogniser, on fixture source: one line per refusal, for the reason the
  // import fixture above gives — a widening or a narrowing fails HERE with its
  // reason named, rather than as a pair count nobody can attribute afterwards.
  const readFixture = [
    'const __dirname = dirname(fileURLToPath(import.meta.url));',
    "const staged = readFileSync(join(__dirname, 'invoked-as.mjs'), 'utf8');", // followed
    "copyFileSync(new URL('./js-comment-mask.mjs', import.meta.url), dest);", // copy, URL anchor
    "const up = readFileSync(join(__dirname, '..', 'eslint.config.mjs'), 'utf8');", // climbs, still tracked
    "const data = readFileSync(join(__dirname, '..', 'package.json'), 'utf8');", // DATA, not program text
    "const gone = readFileSync(join(__dirname, 'does-not-exist.mjs'), 'utf8');", // resolves, untracked
    "const self = readFileSync(join(__dirname, 'fixture.mjs'), 'utf8');", // itself: the identity key owns it
    "const out = readFileSync(join(tmpdir(), 'x.mjs'), 'utf8');", // outside the tree
    "const cwd = readFileSync('scripts/check-nul-bytes.mjs', 'utf8');", // bare literal, cwd unknown
    "// readFileSync(join(__dirname, 'check-doc-anchors.mjs'), 'utf8');", // a comment
    'const src = "readFileSync(join(__dirname, \'check-role-word.mjs\'), \'utf8\')";', // inside a string
    "const loop = ['bump-objectui.sh'].map((f) => readFileSync(join(__dirname, f), 'utf8'));", // loop variable
  ].join('\n');
  const readFixtureOut = readProgramTargetsInSource('scripts/fixture.mjs', readFixture, (f) =>
    liveTree.files.has(f),
  );
  t(
    'the read scan follows a directory-anchored read and a URL-anchored copy, and refuses data, untracked, self,' +
      ' out-of-tree, bare-literal, commented, string-literal and loop-variable spellings',
    readFixtureOut.join(' · ') === 'scripts/invoked-as.mjs · scripts/js-comment-mask.mjs · eslint.config.mjs',
    readFixtureOut.join(' · '),
  );

  // The live halves. Counts and names in every case, for the reason the import
  // section states: a case that can only be read as "something was found" is
  // the shape a pin fails in.
  const readEdges = [...liveDiscovery.byCheck]
    .flatMap(([check, e]) => (e.reads ?? []).map((r) => [check, r, e.readOrigin.get(r)]));
  t(
    `the live tree HAS a gate reading another script's source, so this key is not vacuous (${readEdges.length}:` +
      ` ${readEdges.map(([c, r, by]) => `${c} <- ${r} via ${by}`).join(' · ') || 'none'})`,
    readEdges.length > 0,
  );

  // The card's own specimen, end to end and by name. ⛔ Not "some family
  // matches": the miss was THIS family scoring `silent` for THIS path.
  const digestEntry = liveDiscovery.byCheck.get('check:objectui-changeset');
  const STAGED_GATE = 'scripts/check-adr-0087-registration.mjs';
  t(
    `the staged gate reaches the family that runs a copy of it (${coveringKey(digestEntry, STAGED_GATE)?.via ?? 'no key'})`,
    coveringKey(digestEntry, STAGED_GATE)?.key === STAGED_GATE &&
      coveringKey(digestEntry, STAGED_GATE)?.via === 'program text read by scripts/objectui-changeset-digest.mjs',
  );
  // …and green for the RIGHT reason. `extractWatchHints` masks self-tests, so
  // the staging literal is not a hint and cannot supply this lead — the case
  // above would otherwise pass on a key it is not testing.
  t(
    'and no watch hint of that family covers it, which is why the key was needed',
    !(digestEntry.hints ?? []).some((h) => hintCovers(h, STAGED_GATE)) &&
      !(digestEntry.files ?? []).some((f) => hintCovers(f, STAGED_GATE)),
  );

  // Reconstruction: `entry.reads` is what the scan says over the family's own
  // files, never a list kept here. TWO channels since #18673 — the program-text
  // scan and the `self-test-reads` declaration — reconstructed in the order
  // discovery appends them, so this case still fails when either one drifts.
  const offReads = [];
  for (const [check, entry] of liveDiscovery.byCheck) {
    const expected = [];
    for (const f of entry.files ?? []) {
      if (!existsSync(nodePath.join(ROOT, f))) continue;
      for (const r of readProgramTargetsInSource(f, liveSource(f), (x) => liveTree.files.has(x))) {
        if (!expected.includes(r)) expected.push(r);
      }
    }
    for (const f of entry.files ?? []) {
      if (!existsSync(nodePath.join(ROOT, f))) continue;
      const src = liveSource(f);
      const declared = declaredSelfTestReads(src, anchoredReadTargets(f, src, (x) => liveTree.files.has(x)), f);
      for (const r of declared?.population ?? []) if (!expected.includes(r)) expected.push(r);
    }
    if (expected.join(' · ') !== (entry.reads ?? []).join(' · ')) offReads.push(check);
  }
  t(
    `a family's reads are exactly what the two scans find in the scripts its COMMAND names (off: ${offReads.join(', ') || 'none'})`,
    offReads.length === 0,
  );

  // Additive BY CONSTRUCTION — the claim `coveringKey`'s comment makes. For
  // every read target, the family either had no key at all before, or keeps the
  // exact key and label it had: this one is consulted last and can only fill a
  // hole.
  const reattributed = [];
  for (const [check, entry, target] of readEdges.map(([c, r]) => [c, liveDiscovery.byCheck.get(c), r])) {
    const withKey = coveringKey(entry, target);
    const saved = entry.reads;
    entry.reads = [];
    const without = coveringKey(entry, target);
    entry.reads = saved;
    // Both halves, because only the pair is the claim. Without the first, a
    // derivation that answers NOTHING for every read edge satisfies "nothing
    // was re-attributed" perfectly.
    if (!withKey) reattributed.push(`${check} ${target}: no key at all`);
    else if (without && (without.key !== withKey.key || without.via !== withKey.via)) {
      reattributed.push(`${check} ${target}: ${without.via} -> ${withKey.via}`);
    }
  }
  t(
    `every read edge earns a key, and none is re-attributed — this key only fills a hole (${reattributed.join(' | ') || 'none'})`,
    readEdges.length > 0 && reattributed.length === 0,
  );

  // The DATA refusal, priced rather than asserted: the live tree really does
  // have gates reading tracked NON-program files at anchored paths, and the
  // boundary still refuses every one of them that is not DECLARED. #18673 cut
  // exactly one hole in it — the `self-test-reads` declaration — so the case is
  // read in both directions: the refusal is still doing work, and the declared
  // exception really is admitted. A widening that quietly dissolved the
  // boundary reds the first half; a declaration that stopped reaching the
  // derivation reds the second.
  const refusedDataReads = [];
  const declaredDataReads = [];
  for (const [check, entry] of liveDiscovery.byCheck) {
    for (const f of entry.files ?? []) {
      if (!existsSync(nodePath.join(ROOT, f))) continue;
      for (const r of anchoredReadTargets(f, liveSource(f), (x) => liveTree.files.has(x))) {
        if (PROGRAM_TEXT_TARGET.test(r)) continue;
        if (entry.readEdge?.get(r) === 'declared-self-test') declaredDataReads.push(`${check} <- ${r}`);
        else refusedDataReads.push(`${check} <- ${r}`);
      }
    }
  }
  t(
    `the program-text restriction is not vacuous: ${refusedDataReads.length} anchored read(s) of tracked DATA are refused` +
      ` (${refusedDataReads.slice(0, 4).join(' · ')}${refusedDataReads.length > 4 ? ` · +${refusedDataReads.length - 4} more` : ''})`,
    refusedDataReads.length > 0 && refusedDataReads.every((d) => !readEdges.some(([c, r]) => `${c} <- ${r}` === d)),
  );
  t(
    `…and the ${declaredDataReads.length} DECLARED data read(s) are the only hole in it, each one really carried` +
      ` (${declaredDataReads.join(' · ') || 'none'})`,
    declaredDataReads.length > 0 && declaredDataReads.every((d) => readEdges.some(([c, r]) => `${c} <- ${r}` === d)),
  );

  // ── A SELF-TEST that reads a GOVERNED file (#18673) ───────────────────────
  //
  // The declaration's grammar first, over fixtures, then the census over the
  // live tree, then this card's own specimen by name. The three answer
  // different questions and none of them substitutes for another: a grammar
  // that parses proves nothing about the tree, a census that matches its roster
  // proves nothing about the derivation, and a specimen that is matched proves
  // nothing about the class.
  const selfTestReadFixture = [
    '#!/usr/bin/env node',
    "// dispatch-gates: self-test-reads .claude/skills/pm-dispatch/SKILL.md -- the structural case reads the enqueue bar",
    "import { readFileSync } from 'node:fs';",
    'function selfTest() {',
    "  return readFileSync(join(ROOT, '.claude/skills/pm-dispatch/SKILL.md'), 'utf8');",
    '}',
  ].join('\n');
  const PINNED_SKILL = '.claude/skills/pm-dispatch/SKILL.md';
  const parsedSelfTestReads = declaredSelfTestReads(selfTestReadFixture, [PINNED_SKILL]);
  t(
    'a self-test-reads declaration parses its path list and its reason',
    parsedSelfTestReads?.population.join(' ') === PINNED_SKILL
      && parsedSelfTestReads?.reason === 'the structural case reads the enqueue bar',
    JSON.stringify(parsedSelfTestReads),
  );
  t(
    'the `#` comment form declares too, so a shell gate can carry one',
    declaredSelfTestReads(
      `#!/usr/bin/env bash\n# dispatch-gates: self-test-reads AGENTS.md -- a shell gate reason\n`,
      ['AGENTS.md'],
    )?.population.join(' ') === 'AGENTS.md',
  );
  t(
    'a marker carrying no path list does not parse as a declaration — the safe direction, since a blanket opt-in is what this marker must never be',
    declaredSelfTestReads('// dispatch-gates: self-test-reads -- a reason and nothing else\n', ['AGENTS.md']) === null,
  );
  t(
    'nor does one carrying no reason',
    declaredSelfTestReads('// dispatch-gates: self-test-reads AGENTS.md\n', ['AGENTS.md']) === null,
  );
  t(
    'a marker named inside prose is not a declaration',
    declaredSelfTestReads(
      '// see the dispatch-gates: self-test-reads AGENTS.md -- marker for how to declare one\n',
      ['AGENTS.md'],
    ) === null,
  );
  // ⭐ The refusal that makes the pin below unsatisfiable by DELETING the read:
  // a declaration is graded against the reads the source really performs, so a
  // path the file no longer opens is not "one fewer lead", it is RED.
  {
    let refused = null;
    try {
      declaredSelfTestReads(selfTestReadFixture, []);
    } catch (error) {
      refused = String(error.message);
    }
    t(
      'a declared path the source does NOT open refuses, naming it — deleting the read breaks the declaration rather than satisfying it',
      refused !== null && refused.includes(PINNED_SKILL) && refused.includes('never invent one'),
      refused,
    );
  }
  {
    let refused = null;
    try {
      declaredSelfTestReads(selfTestReadFixture, undefined);
    } catch (error) {
      refused = String(error.message);
    }
    t(
      'and a caller supplying NO read set refuses too — a declaration nothing can refuse is the one shape this marker must not have',
      refused !== null && refused.includes('must supply them'),
      refused,
    );
  }
  t(
    'a path-list marker key this file does not name refuses, rather than building a fourth copy of the pattern',
    (() => {
      try {
        pathListMarkerPattern('invented-population');
        return false;
      } catch (error) {
        return String(error.message).includes('unknown path-list marker key');
      }
    })(),
  );
  // The grammar is ONE spelling for both path-list markers, so a comment form
  // widened for one is widened for both. Pinned by identity of the head, not by
  // a retyped copy of it.
  t(
    "both path-list markers are built from one head, so their comment-form alternation cannot drift apart",
    pathListMarkerPattern('inherited-population').source.replace('inherited-population', '<key>')
      === pathListMarkerPattern('self-test-reads').source.replace('self-test-reads', '<key>'),
  );
  // One head means ONE wholeness reading too (#18662): this marker was never
  // named on that card, and it did not need to be — the roster is derived from
  // the two builders, so the sixth reason-bearing key got the reading in the
  // same line the two named ones did rather than becoming a third card on this
  // file.
  const wrappedSelfTestReads = [
    "import { readFileSync } from 'node:fs';",
    '// dispatch-gates: self-test-reads AGENTS.md -- the structural case asserts the bar still names this file, and the verdict is',
    '// whether that bar moved',
    '',
    "function selfTest() { readFileSync(join(ROOT, 'AGENTS.md'), 'utf8'); }",
  ].join('\n');
  {
    let refused = null;
    try {
      declaredSelfTestReads(wrappedSelfTestReads, ['AGENTS.md'], 'scripts/y.mjs');
    } catch (error) {
      refused = String(error.message);
    }
    t(
      'a self-test-reads reason that does not END on the marker line is REFUSED too, in the same words and naming the same four things',
      refused !== null
        && refused.includes('scripts/y.mjs declares self-test-reads')
        && refused.includes('scripts/y.mjs:3 continues it with')
        && refused.includes('"whether that bar moved"'),
      refused,
    );
  }
  t(
    'and its WHOLE-reason control is unmoved',
    (() => {
      const whole = wrappedSelfTestReads.replace('// whether that bar moved\n', '');
      const d = declaredSelfTestReads(whole, ['AGENTS.md'], 'scripts/y.mjs');
      return d?.population.join(' ') === 'AGENTS.md'
        && d?.reason === 'the structural case asserts the bar still names this file, and the verdict is';
    })(),
  );
  t(
    'the missing-read-set refusal still fires FIRST — a declaration nothing can refuse is refused before its reason is graded',
    (() => {
      try {
        declaredSelfTestReads(wrappedSelfTestReads, undefined, 'scripts/y.mjs');
        return false;
      } catch (error) {
        return String(error.message).includes('must supply them');
      }
    })(),
  );

  // The CENSUS, live over the tree, against `GOVERNED_READ_FLOOR`.
  {
    const census = governedReadCensus({ files: liveTree.files, read: liveSource });
    const key = (row) => `${row.script}::${row.file}`;
    const liveKeys = new Map(census.map((row) => [key(row), row]));
    const pinnedKeys = new Map(GOVERNED_READ_FLOOR.map((row) => [key(row), row]));
    const unpinned = [...liveKeys.keys()].filter((k) => !pinnedKeys.has(k)).sort();
    const gone = [...pinnedKeys.keys()].filter((k) => !liveKeys.has(k)).sort();
    t(
      'every structural read of a GOVERNED file under scripts/ is classified in GOVERNED_READ_FLOOR'
        + (unpinned.length ? ` — unpinned: ${unpinned.join(', ')}` : '')
        + (gone.length ? ` — pinned but gone: ${gone.join(', ')}` : ''),
      unpinned.length === 0 && gone.length === 0,
    );
    const flagDrift = [...pinnedKeys.entries()]
      .filter(([k, row]) => liveKeys.has(k) && liveKeys.get(k).declared !== row.declared)
      .map(([k, row]) => `${k}: pinned declared=${row.declared}, live declared=${liveKeys.get(k).declared}`);
    t(
      `each pinned row's DECLARED flag still reads off the file (${flagDrift.join(' | ') || 'no drift'})`,
      flagDrift.length === 0,
    );
    t(
      'the census is not vacuous — it finds the declared row AND undeclared ones, so neither half of the roster is empty',
      census.some((row) => row.declared) && census.some((row) => !row.declared),
      census.map((row) => `${key(row)}${row.declared ? ' [declared]' : ''}`).join(' · '),
    );
    // ⭐ The deliverable, stated over the whole class rather than over this
    // card's one gate: every governed file a script structurally reads is
    // DERIVED for the family that runs that script. However it is spelled —
    // a module-body literal, a CI trigger, or the declaration this card adds —
    // the derivation names the family for a card touching that file.
    const underived = [];
    for (const row of census) {
      for (const [check, entry] of liveDiscovery.byCheck) {
        if (!(entry.files ?? []).includes(row.script)) continue;
        const placed = placeFamily(entry, [row.file]);
        if (placed.verdict !== 'matched') underived.push(`${check} <- ${row.file} (${placed.verdict})`);
      }
    }
    t(
      `every governed read in the census is DERIVED for the file it reads (${underived.join(' | ') || 'none underived'})`,
      census.length > 0 && underived.length === 0,
    );
  }

  // This card's own specimen, end to end and BY NAME. ⛔ Not "some family
  // matches": the miss was THIS family scoring `silent` for THIS path, while a
  // dev's `--ran` reconciliation reported 0 NOT-MEASURED over a list without it.
  {
    const skipsEntry = liveDiscovery.byCheck.get('check:pm-expected-skips');
    const covering = skipsEntry ? coveringKey(skipsEntry, PINNED_SKILL) : null;
    t(
      `check:pm-expected-skips is derived for the SKILL.md its self-test reads (${covering?.via ?? 'no key'})`,
      covering?.key === PINNED_SKILL
        && covering?.via === 'declared self-test read by scripts/pm/check-expected-skips.mjs',
    );
    // …and green for the RIGHT reason. Nothing else that family declares covers
    // that path — which is exactly why the card was filed — so this case cannot
    // be passing on a key it is not testing.
    t(
      'and no hint, file or CI trigger of that family covers it, which is why the declaration was needed',
      Boolean(skipsEntry)
        && !(skipsEntry.hints ?? []).some((h) => hintCovers(h, PINNED_SKILL))
        && !(skipsEntry.files ?? []).some((f) => hintCovers(f, PINNED_SKILL))
        && !coveringTrigger(skipsEntry, PINNED_SKILL)
        && !coveringJobFilter(skipsEntry, PINNED_SKILL),
    );
    // The command really reaches a dev's list — a matched family that never
    // renders is the same miss one step later.
    const skipsCommands = commandsFor({
      matchedRows: [
        {
          check: 'check:pm-expected-skips',
          command: runnableInvocation(skipsEntry ?? {}),
          ciOnly: skipsEntry?.ciOnly ?? null,
          notRunnable: skipsEntry?.notRunnable ?? null,
        },
      ],
    });
    t(
      `…and it renders as a runnable command, not as a roster or checker-health row (${skipsCommands.join(' · ') || 'none'})`,
      skipsCommands.includes('pnpm check:pm-expected-skips'),
    );
  }

  // ── The PROGRAM a gate RUNS (#13511) ──────────────────────────────────────
  //
  // The third of the three spellings the section above names — "stage it,
  // execute it, assert on it" — and the one nothing recognised. Its live
  // instance is this card's: `check:pm-dispatch-gates` RUNS this very tool, and
  // running it reads every workflow file in the tree, but the derivation scored
  // that family `silent` for a workflows-only diff. A dev derived with the tool,
  // ran every family it named green, and reddened `Lint & Repo Gates` on the one
  // gate that judges the file the PR added.
  //
  // ⛔ Every case below pins the FAMILY BEING PRESENT FOR THE SURFACE, never
  // that a derivation ran. The defect does not crash and does not report
  // nothing: it hands a dev a coherent, plausible, INCOMPLETE list, and every
  // "it derived something" assertion passes straight through it.
  const runFixture = [
    "const ROOT = new URL('..', import.meta.url).pathname;", // the fixture sits one level down, so ONE hop up is the root
    "const TOOL = 'scripts/pm/dispatch-gates.mjs';",
    "const r1 = spawnSync(process.execPath, [join(ROOT, TOOL), '--self-test'], { stdio: 'inherit' });", // followed: argv array, component NAMED
    "const r2 = execFileSync('node', [join(ROOT, 'scripts/invoked-as.mjs')]);", // followed: component written out
    "const r3 = spawnSync('git', ['ls-files'], { cwd: ROOT });", // a program that is not in this tree
    'const r4 = execSync(`pnpm -s ${script}`);', // shell form: a command STRING, never scanned
    "const r5 = spawnSync(process.execPath, [join(ROOT, 'package.json')]);", // tracked, but not program text
    "const r6 = spawnSync(process.execPath, [join(ROOT, 'scripts/does-not-exist.mjs')]);", // resolves, untracked
    "const r7 = spawnSync(process.execPath, [join(ROOT, 'scripts/fixture.mjs')]);", // itself: the identity key owns it
    'const r8 = spawnSync(process.execPath, args);', // argv is a binding, not an array literal
    "let PICK = 'scripts/invoked-as.mjs';", // a REBOUND component has no single reading
    "PICK = 'scripts/js-comment-mask.mjs';",
    'const r9 = spawnSync(process.execPath, [join(ROOT, PICK)]);',
    "// spawnSync(process.execPath, [join(ROOT, 'scripts/check-nul-bytes.mjs')]);", // a comment
    'const src = "spawnSync(process.execPath, [join(ROOT, \'scripts/check-role-word.mjs\')])";', // inside a string
  ].join('\n');
  const runFixtureOut = spawnedProgramTargets('scripts/fixture.mjs', runFixture, (f) => liveTree.files.has(f));
  t(
    'the run scan follows an argv-array spawn whose program is a NAMED constant and one written out, and refuses the' +
      ' shell form, data, untracked, self, a bound argv, a rebound component, commented and string-literal spellings',
    runFixtureOut.join(' · ') === 'scripts/pm/dispatch-gates.mjs · scripts/invoked-as.mjs',
    runFixtureOut.join(' · '),
  );
  // The hop READS a binding; it never invents one. The fixture above already
  // isolates the hop itself — r1 names its program through a constant and r2
  // writes it out, so removing the hop reds that case while leaving r2 — and
  // this one pins the refusal side, which no count can show.
  t(
    'and an unbound component name is refused rather than guessed at',
    spawnedProgramTargets(
      'scripts/fixture.mjs',
      "const ROOT = new URL('..', import.meta.url).pathname;\nspawnSync(process.execPath, [join(ROOT, NOT_BOUND_HERE)]);",
      (f) => liveTree.files.has(f),
    ).length === 0,
  );
  t(
    'a spawn written inside a self-test body is a fixture the self-test drives, not the gate reaching a program',
    spawnedProgramTargets(
      'scripts/fixture.mjs',
      [
        "const ROOT = new URL('..', import.meta.url).pathname;",
        'function selfTest() {',
        "  spawnSync(process.execPath, [join(ROOT, 'scripts/invoked-as.mjs')]);",
        '}',
      ].join('\n'),
      (f) => liveTree.files.has(f),
    ).length === 0,
  );

  // ── LIVE: the card's own specimen, by name, on the surface that missed ─────
  const PM_GATE = 'check:pm-dispatch-gates';
  const pmEntry = liveDiscovery.byCheck.get(PM_GATE);
  const PM_TOOL = 'scripts/pm/dispatch-gates.mjs';
  const liveWorkflowFiles = [...liveTree.files].filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f)).sort();
  t(
    `the tree has workflow files to derive for (${liveWorkflowFiles.length})`,
    liveWorkflowFiles.length > 0 && Boolean(pmEntry),
  );
  t(
    `${PM_GATE} reaches the tool it runs over the RUN edge (runs: ${(pmEntry?.runs ?? []).join(' · ') || 'none'})`,
    (pmEntry?.runs ?? []).includes(PM_TOOL),
  );
  // ⭐ The regression itself. Not "a family matched" and not "the derivation
  // produced 18 rows": THIS family, MATCHED, for a workflow file.
  const pmSurface = liveWorkflowFiles.slice(0, 1);
  t(
    `⭐ a workflows-only surface derives ${PM_GATE} — the gate whose run reads that surface` +
      ` (${classifyEntry(pmEntry, pmSurface).verdict} for ${pmSurface[0]})`,
    classifyEntry(pmEntry, pmSurface).verdict === 'matched',
  );
  t(
    'and for EVERY workflow file in the tree, not just the one sampled',
    liveWorkflowFiles.every((f) => classifyEntry(pmEntry, [f]).verdict === 'matched'),
  );
  t(
    `and it is derived RUNNABLY, which is what a dev pastes (${runnableInvocation(pmEntry)})`,
    runnableInvocation(pmEntry) === 'pnpm check:pm-dispatch-gates',
  );
  t(
    `and the via column names the program it runs, not a population this gate declares` +
      ` (${coveringKey(pmEntry, pmSurface[0])?.via})`,
    coveringKey(pmEntry, pmSurface[0])?.key === '.github/workflows' &&
      coveringKey(pmEntry, pmSurface[0])?.via === `gate source via the program it runs, ${PM_TOOL}`,
  );
  // …and green for the RIGHT reason. Without this half the case above passes on
  // any key at all, including one the gate already had — which is exactly the
  // reading that would let someone "fix" this by widening an unrelated literal.
  t(
    'and no hint this gate spells ITSELF covers a workflow file, which is why the edge was needed',
    pmEntry.hints.filter((h) => !pmEntry.hintOrigin.has(h)).every((h) => !liveWorkflowFiles.some((f) => hintCovers(h, f))) &&
      !(pmEntry.files ?? []).some((f) => liveWorkflowFiles.includes(f)) &&
      !coveringTrigger(pmEntry, pmSurface[0]) &&
      !coveringJobFilter(pmEntry, pmSurface[0]),
  );
  // The narrowing on THIS edge, proven non-vacuous in both directions: the tool
  // really does spell more than a follower inherits, and what it does inherit
  // really does still reach every workflow file. A declaration that took the
  // real population with it would read exactly like a working one — fewer
  // pairs, every gate green.
  t(
    `the run target spells ${ownHints.length} literal(s) and a follower inherits ${ownPopulation.length} of them,` +
      ' so the declaration narrows rather than waves through',
    ownHints.length > ownPopulation.length && ownPopulation.length > 0,
  );
  t(
    'and the narrowing is not a coverage cut — every workflow file stays reachable through what is inherited',
    liveWorkflowFiles.every((f) => ownPopulation.some((h) => hintCovers(h, f))),
  );

  // Reconstruction: `entry.runs` is what the scan says over the family's own
  // files, never a list kept here — the same invariant the two edges above hold.
  const offRuns = [];
  for (const [check, entry] of liveDiscovery.byCheck) {
    const expected = [];
    if (!entry.selfTest) {
      for (const f of entry.files ?? []) {
        if (!existsSync(nodePath.join(ROOT, f))) continue;
        for (const r of spawnedProgramTargets(f, liveSource(f), (x) => liveTree.files.has(x))) {
          if (!liveGateFiles.has(r) && !expected.includes(r)) expected.push(r);
        }
      }
    }
    if (expected.join(' · ') !== (entry.runs ?? []).join(' · ')) offRuns.push(check);
  }
  t(
    `a family's run targets are exactly what the scan finds in the scripts its COMMAND names (off: ${offRuns.join(', ') || 'none'})`,
    offRuns.length === 0,
  );

  // The gate-file exclusion, on THIS edge, priced rather than assumed. It is
  // the same refusal the import follow makes and it is live here: two families
  // spawn `scripts/docs-audit/affected-docs.mjs`, which IS a discovered gate
  // file, so its population is left to its own family instead of inherited
  // twice under weaker provenance.
  const runGateEdges = [];
  for (const [check, entry] of liveDiscovery.byCheck) {
    for (const f of entry.files ?? []) {
      if (!existsSync(nodePath.join(ROOT, f))) continue;
      for (const r of spawnedProgramTargets(f, liveSource(f), (x) => liveTree.files.has(x))) {
        if (liveGateFiles.has(r) && !(entry.files ?? []).includes(r)) runGateEdges.push([check, r]);
      }
    }
  }
  t(
    `the live tree HAS a gate spawning another gate's file, so the exclusion is not vacuous (${runGateEdges.length}:` +
      ` ${runGateEdges.map(([c, r]) => `${c} -> ${r}`).join(' · ') || 'none'})`,
    runGateEdges.length > 0,
  );
  t(
    'and not one of those edges is followed — a gate script is left to its OWN family, exactly as on the import edge',
    runGateEdges.every(([check, r]) => !(liveDiscovery.byCheck.get(check)?.runs ?? []).includes(r)),
  );

  // Additive BY CONSTRUCTION, the claim the wiring comment makes: the run edge
  // appends AFTER own and imported hints, so it can only fill a hole. Both
  // halves again — "nothing was re-attributed" is satisfied perfectly by a
  // derivation that answers nothing at all.
  const runInherited = [...liveDiscovery.byCheck]
    .flatMap(([check, e]) => [...(e.hintEdge ?? new Map())].filter(([, kind]) => kind === 'run').map(([h]) => [check, e, h]));
  t(
    `the run edge contributes ${runInherited.length} inherited hint(s), so the cases below are not vacuous` +
      ` (${runInherited.map(([c, , h]) => `${c} <- ${h}`).join(' · ') || 'none'})`,
    runInherited.length > 0,
  );
  const runReattributed = [];
  for (const [check, entry, hint] of runInherited) {
    const ownAnswer = (entry.hints ?? []).find((h) => !entry.hintOrigin.has(h) && hintCovers(h, hint));
    if (ownAnswer) runReattributed.push(`${check}: ${hint} was already answered by ${ownAnswer}`);
  }
  t(
    `and no run-edge hint duplicates a population the gate already declared (${runReattributed.join(' | ') || 'none'})`,
    runReattributed.length === 0,
  );

  // ── The PACKAGE a gate re-derives from (#13518) ────────────────────────────
  //
  // Six gates re-derive their population from `@objectstack/spec`'s public
  // export surface, and every one of them was ABSENT from the derivation for
  // `packages/spec/src/index.ts` — the entry point that IS their subject. One
  // shape, one hole: the population is computed through the manifest's
  // `exports` map into an untracked `dist/`, so no literal carries it.
  //
  // ⛔ Every case below pins the FAMILY BEING PRESENT FOR THE SURFACE, never
  // that a derivation ran, and the class-level case pins a gate that is in no
  // table anywhere — because "the six now derive" is satisfied perfectly by six
  // names in a list, which is the repair this lane has ruled against three
  // times.
  const manifestFixture = [
    "const PKG_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');",
    "const pkg = JSON.parse(readFileSync(resolve(PKG_DIR, 'package.json'), 'utf8'));",
    'for (const sub of Object.keys(pkg.exports ?? {})) entries[sub] = sub;', // the `exports` read that makes it this class
    "readFileSync(resolve(PKG_DIR, 'dual-source-exports.baseline.json'), 'utf8');", // tracked, not a manifest
    "readFileSync(join(ROOT, 'packages/does-not-exist/package.json'), 'utf8');", // resolves, untracked
  ].join('\n');
  const manifestOut = packageManifestTargets(
    'packages/spec/scripts/fixture.ts',
    manifestFixture,
    (f) => liveTree.files.has(f),
  );
  t(
    'the manifest scan follows a package manifest read through a resolved package-root binding, and refuses a' +
      ` non-manifest read and an untracked one (${manifestOut.join(' · ') || 'none'})`,
    manifestOut.join(' · ') === 'packages/spec/package.json',
  );
  // The narrowing that decides the number, on fixture source: the SAME manifest
  // read, with the `exports` read removed, contributes nothing. No count can
  // show this — a rule that admitted it would simply look more generous.
  t(
    'and the identical manifest read with no `exports` read is refused — a version or scripts reader is not this class',
    packageManifestTargets(
      'packages/spec/scripts/fixture.ts',
      [
        "const PKG_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');",
        "const version = JSON.parse(readFileSync(resolve(PKG_DIR, 'package.json'), 'utf8')).version;",
      ].join('\n'),
      (f) => liveTree.files.has(f),
    ).length === 0,
  );
  t(
    'and a manifest read inside a self-test body is a fixture the self-test builds, not the gate reaching a package',
    packageManifestTargets(
      'packages/spec/scripts/fixture.ts',
      [
        "const PKG_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');",
        'function selfTest() {',
        "  const pkg = JSON.parse(readFileSync(resolve(PKG_DIR, 'package.json'), 'utf8'));",
        '  return pkg.exports;',
        '}',
      ].join('\n'),
      (f) => liveTree.files.has(f),
    ).length === 0,
  );
  // The parameter hop, isolated. The fixture above reaches the manifest through
  // a CONSTANT; this one reaches it only through a parameter, which is the
  // spelling `build-export-origins.ts` uses and the one member of the six that
  // no other rule here could reach.
  const paramFixture = (calls) =>
    [
      "const PKG_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');",
      'function collect(pkgDir: string) {',
      "  const pkg = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf8'));",
      '  return pkg.exports;',
      '}',
      ...calls,
    ].join('\n');
  t(
    'a package root held in a PARAMETER resolves when the function has exactly one call site',
    packageManifestTargets(
      'packages/spec/scripts/fixture.ts',
      paramFixture(['const entries = collect(PKG_DIR);']),
      (f) => liveTree.files.has(f),
    ).join(' · ') === 'packages/spec/package.json',
  );
  t(
    'and TWO call sites contribute nothing rather than a pick — a parameter with two values has no single reading',
    packageManifestTargets(
      'packages/spec/scripts/fixture.ts',
      paramFixture(['const a = collect(PKG_DIR);', "const b = collect('/somewhere/else');"]),
      (f) => liveTree.files.has(f),
    ).length === 0,
  );

  // ── LIVE: the card's six, by name, on the surface that missed ──────────────
  const SPEC_ENTRY = 'packages/spec/src/index.ts';
  const EXPORT_SURFACE_SIX = [
    'check:api-surface',
    'check:export-origins',
    'check:entry-nameability',
    'check:exported-any',
    'check:dual-source-exports',
    'check:browser-reachable-entries',
  ];
  // The positive control the card carried, and it is load-bearing: it is what
  // makes the six an ABSENCE rather than a dead query.
  const SPEC_CONTROL = 'check:strictness-ledger';
  t(
    `the tree still has ${SPEC_ENTRY} and all six families plus the control`,
    liveTree.files.has(SPEC_ENTRY) &&
      Boolean(liveDiscovery.byCheck.get(SPEC_CONTROL)) &&
      EXPORT_SURFACE_SIX.every((c) => liveDiscovery.byCheck.get(c)),
  );
  const sixVerdicts = EXPORT_SURFACE_SIX.map(
    (c) => [c, classifyEntry(liveDiscovery.byCheck.get(c), [SPEC_ENTRY]).verdict],
  );
  t(
    `⭐ the spec entry point derives every gate that re-derives from it (${sixVerdicts.map(([c, v]) => `${c}=${v}`).join(' · ')})`,
    sixVerdicts.every(([, v]) => v === 'matched'),
  );
  t(
    `and the control still derives, so the six are a reading and not a broken probe`,
    classifyEntry(liveDiscovery.byCheck.get(SPEC_CONTROL), [SPEC_ENTRY]).verdict === 'matched',
  );
  // …and green for the RIGHT reason. Without this half every case above passes
  // on a key the gate already had — the reading that would let someone "fix"
  // this by widening an unrelated literal.
  const sixOnOwn = EXPORT_SURFACE_SIX.filter((c) => {
    const e = liveDiscovery.byCheck.get(c);
    return (
      (e.files ?? []).some((f) => hintCovers(f, SPEC_ENTRY)) ||
      coveringTrigger(e, SPEC_ENTRY) ||
      coveringJobFilter(e, SPEC_ENTRY) ||
      (e.hints ?? []).some((h) => !e.hintOrigin.has(h) && hintCovers(h, SPEC_ENTRY))
    );
  });
  t(
    `and not one of the six reaches the entry point on anything it spells ITSELF, which is why the edge was needed` +
      ` (${sixOnOwn.join(', ') || 'none'})`,
    sixOnOwn.length === 0,
  );
  t(
    'and each of the six is derived RUNNABLY, which is what a dev pastes',
    EXPORT_SURFACE_SIX.every((c) => runnableInvocation(liveDiscovery.byCheck.get(c)).includes(c)),
  );
  t(
    'and the via column names the export surface it re-derives from, not a population the gate declares',
    EXPORT_SURFACE_SIX.every((c) => {
      const k = coveringKey(liveDiscovery.byCheck.get(c), SPEC_ENTRY);
      return (
        k?.key === 'packages/spec/src' &&
        k?.via === 'gate source via the export surface declared by packages/spec/package.json'
      );
    }),
  );

  // ⭐ THE CLASS, not the six. A SEVENTH gate of the same shape, written here
  // and named in no table in this file, reaches the same surface through the
  // same edge — which is the question the triage ruling asked and the one a
  // list of six names cannot answer. Deleting the edge reds this case exactly
  // as it reds the six above.
  const seventhGate = [
    "const PKG_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');",
    "const manifest = JSON.parse(readFileSync(resolve(PKG_DIR, 'package.json'), 'utf8'));",
    'const entries = Object.keys(manifest.exports);',
  ].join('\n');
  const seventhManifests = packageManifestTargets(
    'packages/spec/scripts/check-invented-for-this-case.ts',
    seventhGate,
    (f) => liveTree.files.has(f),
  );
  const seventhPopulation = seventhManifests.flatMap(liveManifestHints);
  t(
    `⭐ a SEVENTH gate of the class, in no table anywhere, inherits the same population automatically` +
      ` (${seventhManifests.join(' · ') || 'none'} -> ${seventhPopulation.join(' · ') || 'nothing'})`,
    seventhPopulation.some((h) => hintCovers(h, SPEC_ENTRY)),
  );

  // Reconstruction: `entry.manifests` is what the scan says over the family's
  // own files, never a list kept here — the invariant both other edges hold.
  const offManifests = [];
  for (const [check, entry] of liveDiscovery.byCheck) {
    const expected = [];
    if (!entry.selfTest) {
      for (const f of entry.files ?? []) {
        if (!existsSync(nodePath.join(ROOT, f))) continue;
        for (const p of packageManifestTargets(f, liveSource(f), (x) => liveTree.files.has(x))) {
          if (!expected.includes(p)) expected.push(p);
        }
      }
    }
    if (expected.join(' · ') !== (entry.manifests ?? []).join(' · ')) offManifests.push(check);
  }
  t(
    `a family's manifest targets are exactly what the scan finds in the scripts its COMMAND names` +
      ` (off: ${offManifests.join(', ') || 'none'})`,
    offManifests.length === 0,
  );

  // The `exports` narrowing, live and in both directions. The refusal is only
  // meaningful if the tree really HAS gates that read a manifest for something
  // else — and it has three, each verified at its own declaration site.
  const manifestReaders = [];
  const manifestNonReaders = [];
  for (const [check, entry] of liveDiscovery.byCheck) {
    for (const f of entry.files ?? []) {
      if (!existsSync(nodePath.join(ROOT, f))) continue;
      const source = liveSource(f);
      const bare = anchoredReadTargets(f, maskSelfTests(source), (x) => liveTree.files.has(x)).filter((x) =>
        /(?:^|\/)package\.json$/.test(x),
      );
      if (bare.length === 0) continue;
      if (packageManifestTargets(f, source, (x) => liveTree.files.has(x)).length > 0) manifestReaders.push(check);
      else manifestNonReaders.push(check);
    }
  }
  t(
    `the live tree HAS gates reading a manifest WITHOUT reading its exports, so the narrowing is not vacuous` +
      ` (${manifestNonReaders.length}: ${[...new Set(manifestNonReaders)].join(' · ') || 'none'})`,
    manifestNonReaders.length > 0,
  );
  t(
    'and not one of them inherits a package source — a version or scripts reader stays where it was',
    [...new Set(manifestNonReaders)].every(
      (c) => (liveDiscovery.byCheck.get(c)?.manifests ?? []).length === 0,
    ),
  );
  // ⚠️ The follow set is BROADER than the six and that is not a leak: a gate
  // reading the ROOT manifest's `exports`-shaped keys follows the edge and
  // inherits nothing (the root declares no `exports`), and two gates that read
  // the spec manifest already SPELL `packages/spec/src` themselves, so the edge
  // has nothing left to add for them. What must be exact is the population, not
  // the follow — so this asserts the six are all IN, and the count that moved
  // is checked against the six by name below.
  t(
    `every one of the six follows the edge (${[...new Set(manifestReaders)].join(' · ') || 'none'})`,
    EXPORT_SURFACE_SIX.every((c) => manifestReaders.includes(c)),
  );
  const manifestInherited = [...liveDiscovery.byCheck].flatMap(([check, e]) =>
    [...(e.hintEdge ?? new Map())].filter(([, kind]) => kind === 'manifest').map(([h]) => [check, e, h]),
  );
  // ⭐ THE CLASS, live. The edge gives a population to the six AND to one gate
  // the card never named: `check:dual-build-cjs-loads`, which walks the same
  // `exports` map and `require()`s every published entry (#12971), so the spec
  // export surface is its subject too. It is here because it re-derives from
  // that surface, not because anything lists it — which is the triage ruling's
  // question ("修完之后第七个同类 gate 会不会自动被覆盖") answered by a live
  // family rather than by an argument. It gains no PAIRS, because its CI job
  // filter is `packages/**` and already covered them; it gains the right
  // PROVENANCE, and it is what this case exists to keep honest.
  const CLASS_SEVENTH = 'check:dual-build-cjs-loads';
  t(
    `and every family the edge gives a population to really re-derives from an export surface` +
      ` (${[...new Set(manifestInherited.map(([c]) => c))].join(' · ') || 'none'})`,
    manifestInherited.every(([c]) => EXPORT_SURFACE_SIX.includes(c) || c === CLASS_SEVENTH),
  );
  t(
    `⭐ and a SEVENTH live gate the card never named is covered by the same edge (${CLASS_SEVENTH})`,
    manifestInherited.some(([c]) => c === CLASS_SEVENTH),
  );

  // Additive BY CONSTRUCTION, the claim the wiring comment makes: the manifest
  // edge appends AFTER own, imported and run hints, so it can only fill a hole.
  // Both halves again — "nothing was re-attributed" is satisfied perfectly by a
  // derivation that answers nothing at all.
  t(
    `the manifest edge contributes ${manifestInherited.length} inherited hint(s), so the cases here are not vacuous`,
    manifestInherited.length > 0,
  );
  const manifestReattributed = [];
  for (const [check, entry, hint] of manifestInherited) {
    const ownAnswer = (entry.hints ?? []).find((h) => !entry.hintOrigin.has(h) && hintCovers(h, hint));
    if (ownAnswer) manifestReattributed.push(`${check}: ${hint} was already answered by ${ownAnswer}`);
  }
  t(
    `and no manifest-edge hint duplicates a population the gate already declared (${manifestReattributed.join(' | ') || 'none'})`,
    manifestReattributed.length === 0,
  );

  // ── A followed module's JOIN BASE is not a population (#12500) ─────────────
  //
  // `cli-build-prerequisite.mjs` spells `packages/cli` because it joins paths
  // from it and writes it into every rerun command its two consumers print.
  // Inherited whole it reads as a subtree claim, and it handed check:i18n and
  // check:i18n-coverage all 322 tracked files of that package — 210 of them
  // (the 100-file test suite, the package docs, the vitest config, the sibling
  // app-nav gate script) unable to change a byte of the `dist/` those gates
  // spawn. The gates' refusal text is exemplary, so the cost was never a false
  // green: it was a full CLI closure build per card, bought to measure two
  // gates the diff provably could not move. Measured at the narrowing:
  // 322 -> 214 covered files per gate (108 x 2 = 216 fabricated pairs
  // withdrawn), and all 112 files the gates really read still named.
  //
  // BOTH directions, against real files. A narrowing that also dropped the CLI
  // source would be the under-naming mirror this card's pair exists to keep
  // apart — the source compiled into the spawned command must still derive.
  const CLI_PREREQ = 'scripts/cli-build-prerequisite.mjs';
  const cliPrereqSource = liveSource(CLI_PREREQ);
  const cliPrereqSpelled = extractWatchHints(cliPrereqSource, CLI_PREREQ, { tree: liveTree });
  const cliPrereqPopulation = declaredInheritedPopulation(cliPrereqSource, cliPrereqSpelled, CLI_PREREQ)?.population ?? [];
  t(
    `the CLI build-prerequisite module declares what its callers inherit (${cliPrereqPopulation.join(' ') || 'nothing'})`,
    cliPrereqPopulation.length === 3,
  );
  t(
    'and it still SPELLS the whole-package join base — the declaration narrows a live literal, not a deleted one',
    // The `length > 0` is not decoration: without it a DELETED marker satisfies
    // this case by the empty set (nothing is inherited, so nothing inherits the
    // join base) — the shape a pin that only asserts an absence always has.
    cliPrereqPopulation.length > 0
      && cliPrereqSpelled.includes('packages/cli')
      && !cliPrereqPopulation.includes('packages/cli'),
  );
  // Specimens, not classes: the extractor module whose edit really does move
  // the committed bundles, and a test file that compiles into nothing either
  // gate runs. Both live, so neither direction can pass over an empty set.
  const CLI_SRC_SPECIMEN = 'packages/cli/src/utils/i18n-extract.ts';
  const CLI_TEST_SPECIMEN = 'packages/cli/test/authoring-rule-command-parity.test.ts';
  t(
    'both CLI specimens are real tracked files, so the two directions below are live',
    existsSync(nodePath.join(ROOT, CLI_SRC_SPECIMEN)) && existsSync(nodePath.join(ROOT, CLI_TEST_SPECIMEN)),
  );
  for (const check of ['check:i18n', 'check:i18n-coverage']) {
    const cliEntry = liveDiscovery.byCheck.get(check);
    t(
      `${check} still derives the CLI source compiled into the command it spawns`,
      Boolean(cliEntry) && coveringKey(cliEntry, CLI_SRC_SPECIMEN)?.key === 'packages/cli/src',
    );
    t(
      `${check} no longer derives a CLI test file, which compiles into nothing it runs`,
      Boolean(cliEntry) && coveringKey(cliEntry, CLI_TEST_SPECIMEN) === null,
    );
  }

  // The live guard: every REAL paths-filtered workflow either discovers a
  // family or declares why not. This is what actually fails CI the day a new
  // paths-filtered workflow adds an undiscoverable verification step and
  // forgets both halves of the fix.
  const liveWfDir = nodePath.join(ROOT, '.github/workflows');
  const liveWorkflowEntries = readdirSync(liveWfDir)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((file) => ({ file, text: readFileSync(nodePath.join(liveWfDir, file), 'utf8') }));
  t('the live tree has at least one paths-filtered workflow (the guard is not vacuous)', liveWorkflowEntries.some((e) => extractTriggerPaths(e.text).length > 0));
  const liveGaps = checkFamilyCoverageGaps(liveWorkflowEntries);
  t(`every real paths-filtered workflow discovers a check family or declares why not (gaps: ${liveGaps.join(', ') || 'none'})`, liveGaps.length === 0);

  // ── ONE discovery pass per tree, and the collapse is OBSERVED (#18201) ────
  //
  // The memo's whole symptom is work that does NOT happen, and absent work is
  // invisible to every other case here: each of them asks what discovery
  // ANSWERS, and the answer is identical either way — which is the point of
  // the memo and also the reason nothing already in this file can tell a
  // collapsed pass from a repeated one. So the pass counter is read directly,
  // and both directions are pinned: the default tree is discovered once, and a
  // tree that is NOT that object is never served its answer.
  //
  // ⛔ The second half is not decoration. The cheap wrong memo is one module
  // slot ignoring the argument, and under it every fixture-tree case in this
  // file — the directory-landing tree, the class tree, the no-tree probe —
  // would be answered about the REAL tree while still reading as a pass on the
  // day their expectations happen to coincide. The pin that costs a pass is
  // what makes that unbuildable.
  const warmDiscovery = discoverFamilies();
  const passesWarm = discoveryPassCount();
  const defaultAgain = discoverFamilies();
  const defaultOnceMore = discoverFamilies();
  t(
    'the default tree is discovered ONCE per process — two further calls compute no pass',
    discoveryPassCount() === passesWarm,
    `passes before ${passesWarm}, after ${discoveryPassCount()}`,
  );
  t(
    'and those calls hand back the SAME object, so an entry ablated and restored is one entry',
    defaultAgain === warmDiscovery && defaultOnceMore === warmDiscovery,
  );
  t(
    'the corpus behind it is listed once too — one bundle, so the sweep and the discovery cannot describe different revisions',
    repoCorpus() === repoCorpus() && repoCorpus().tree === repoCorpus().tree,
  );
  t(
    "and that listing is the tracked corpus itself, not a trimmed copy of it",
    repoCorpus().files.length === trackedFiles().length && repoCorpus().tree.files.size === repoCorpus().files.length,
  );
  // The derivation's own collapse, pinned at the seam that used to pay twice:
  // `derive` takes this exact tree object and `gateFamilyFiles` — reached from
  // `changeKindGates`, a whole call chain away — asks for the default one. The
  // two are the same object, so the second ask is the first pass.
  const passesBeforeSeam = discoveryPassCount();
  const seamDiscovery = discoverFamilies({ tree: repoCorpus().tree });
  const seamFiles = gateFamilyFiles();
  t(
    'the tree `derive` hands down and the default `gateFamilyFiles` asks for are ONE pass, not two',
    discoveryPassCount() === passesBeforeSeam && seamDiscovery === warmDiscovery && seamFiles.size > 0,
    `passes before ${passesBeforeSeam}, after ${discoveryPassCount()}, gate files ${seamFiles.size}`,
  );
  // A DIFFERENT tree object, built from the very same listing: identical
  // content, and still its own pass. Content is not the key — the object is —
  // because a caller that built its own bundle is asking about ITS tree.
  const twinTree = watchHintTree(repoCorpus().files);
  const passesBeforeTwin = discoveryPassCount();
  const twinDiscovery = discoverFamilies({ tree: twinTree });
  t(
    'a tree object that is not the corpus’s is never served its answer — same content, its own pass',
    discoveryPassCount() === passesBeforeTwin + 1 && twinDiscovery !== warmDiscovery,
    `passes before ${passesBeforeTwin}, after ${discoveryPassCount()}`,
  );
  // The no-tree probe is not an object, so it cannot be a key at all — and a
  // memo that tried would throw rather than answer. It computes every time.
  const passesBeforeNull = discoveryPassCount();
  const nullDiscovery = discoverFamilies({ tree: null });
  t(
    'the no-tree probe is never memoised — it is not an object, and it still answers',
    discoveryPassCount() === passesBeforeNull + 1 && nullDiscovery !== warmDiscovery && nullDiscovery.byCheck.size > 0,
    `passes before ${passesBeforeNull}, after ${discoveryPassCount()}`,
  );

  // ── The reachability sweep — the third verdict (#9883) ────────────────────
  //
  // The verdict answers a question about the TREE, so both halves are pinned:
  // the judgment over a fixture corpus, and the corpus reader against the real
  // one. A fixture-only test passes just as happily when the reader is asking
  // git the wrong question — which is the defect the verdict exists to expose,
  // one level up.
  const treeFixture = [
    'AGENTS.md',
    'packages/spec/package.json',
    'packages/spec/src/index.ts',
    'examples/app-showcase/src/ui/view.ts',
  ];
  const fam = (hints, extra = {}) => ({ hints, files: [], workflows: new Set(['lint.yml']), ...extra });
  const sweepEntries = [
    // one dead literal and one live one: a family is only unreachable when its
    // WHOLE declared population is dead.
    ['check:reaches', fam(['application/json', 'packages/spec/src'])],
    ['check:moved', fam(['packages/spec/src/legacy/**'])],
    ['check:never-was', fam(['application/json'])],
    ['check:too-generic', fam(['examples'])],
    // `packages/spec/src/index.ts` is in the corpus; the gate spells it the way
    // an import does. Dead to `hintCovers`, and NOT a layout move.
    ['check:extensionless', fam(['packages/spec/src/index'])],
    ['check:declares-nothing', fam([], { files: ['scripts/check-declares-nothing.mjs'] })],
  ];
  const sweep = unreachableFamilies(sweepEntries, treeFixture);
  const sweptNames = sweep.map((u) => u.check);
  const reasonOf = (name) => unreachableReason(sweep.find((u) => u.check === name)?.dead ?? []);
  t('a family whose whole declared population is absent from the tree is unreachable', sweptNames.includes('check:never-was'));
  t('one live hint clears a family, however many dead ones it also names', !sweptNames.includes('check:reaches'));

  // ── The per-hint sweep: a live sibling no longer hides its dead ones (#13312) ──
  //
  // check:query-options-erasure printed three fixture filenames that have
  // never existed in this tree, verbatim and unannotated, because its live
  // baseline kept the family out of the unreachable listing — the survivor
  // class isNonPathNamespace's docblock names as the expensive direction.
  // These pin the finer grain: the dead literal is swept per family, the live
  // one is untouched, and a family with nothing dead earns no row at all.
  const perHint = deadHintSweep(sweepEntries, treeFixture);
  const mixedRow = perHint.byCheck.get('check:reaches');
  t('a dead literal is swept out of a REACHABLE family, not only an unreachable one', mixedRow?.dead.map((d) => d.hint).join() === 'application/json');
  t('...with the family total beside it, so the note can say N of M', mixedRow?.declared === 2);
  t('a fully-dead family carries the same row shape at both grains', perHint.byCheck.get('check:never-was')?.dead.length === 1);
  t('a family whose hints all reach earns no per-hint row', !perHint.byCheck.has('check:extensionless'));
  t('a family declaring nothing earns no per-hint row — that is undetermined, a different fact', !perHint.byCheck.has('check:declares-nothing'));
  t(
    'the family sweep answers the same from an injected per-hint sweep — one sweep, two grains, no disagreement',
    unreachableFamilies(sweepEntries, treeFixture, perHint).map((u) => u.check).join() === sweptNames.join(),
  );
  let perHintEmpty = false;
  try {
    deadHintSweep(sweepEntries, []);
  } catch {
    perHintEmpty = true;
  }
  t('the per-hint sweep refuses an empty corpus like the family sweep it feeds', perHintEmpty);

  // The renderer half, driven by a PLANTED dead literal in a reachable family
  // — the delivery control #13312's triage names: the planted literal is
  // marked where it is shown, the real hint beside it is NOT (the annotation
  // must not eat the hint set), and the note counts the dead against the
  // declared total in the unreachable listing's own voice.
  const planted = ['packages/spec/src', 'scripts/__planted_never_existed__.mjs'];
  const plantedRow = deadHintSweep([['check:planted', fam(planted)]], treeFixture).byCheck.get('check:planted');
  t('a planted dead literal in a reachable family IS swept', plantedRow?.dead.map((d) => d.hint).join() === 'scripts/__planted_never_existed__.mjs');
  const plantedNames = residueNames(planted, new Set(plantedRow.dead.map((d) => d.hint)));
  t('the names line marks the planted literal as dead', plantedNames.includes('scripts/__planted_never_existed__.mjs ✗'));
  t('...and leaves the real hint beside it unmarked', plantedNames.startsWith('packages/spec/src,') && !plantedNames.includes('packages/spec/src ✗'));
  const plantedNote = deadNamesNote(plantedRow);
  t('the note counts the dead against the declared total', plantedNote.includes('1 of 2 declared literal(s)'));
  t(
    "...and names WHY in the unreachable listing's own voice",
    /a base this scan did not resolve/.test(plantedNote),
    plantedNote,
  );
  t(
    'the note is capped like the listing it sits under, never an inventory',
    /…$/.test(deadNamesNote({ declared: 9, dead: [1, 2, 3, 4].map((n) => ({ hint: `no/such/p-${n}`, deepest: '' })) })),
  );
  t('a dead literal hidden behind the names cap is still counted, never silently dropped', residueNames(['a/b', 'c/d', 'e/f', 'g/h'], new Set(['g/h'])) === 'a/b, c/d, e/f, …');
  t(
    'a family that declares NO population is NOT unreachable — that is the undetermined verdict, a different fact',
    !sweptNames.includes('check:declares-nothing'),
  );
  // ⚠️ The claim asserted here is the FIRST clause — no tracked path begins
  // with the literal. The second used to read "never was a repo path", which
  // is a claim about every base made from evidence about one, and it printed
  // over three live files (#14208). Both halves are pinned so a regression to
  // the universal reds rather than passing on the surviving prefix.
  t(
    'the sweep names WHY: no tracked path begins with the literal, without claiming it never was one',
    /no tracked path under its first segment/.test(reasonOf('check:never-was')) &&
      /a base this scan did not resolve/.test(reasonOf('check:never-was')) &&
      !/never was a repo path/.test(reasonOf('check:never-was')),
    reasonOf('check:never-was'),
  );
  t('the sweep names WHY: the tree stops at a shorter prefix, so the layout moved under it', /stops at packages\/spec\/src/.test(reasonOf('check:moved')));
  // The third cause is the one a bare "matched nothing" would send a reader
  // hunting a directory that is sitting in front of them: the population is
  // right there and hintCovers refuses the literal as too generic. It is also
  // the pin that the sweep judges with hintCovers itself rather than with a
  // faster second rule that would answer this case differently.
  t('the sweep names WHY: the tree HAS the population and the covering rule refuses the literal', /the tree HAS it/.test(reasonOf('check:too-generic')));
  // The FOURTH cause used to be reached from HERE, and #12514 took that away on
  // purpose: `hintCovers` now follows a dropped extension, so a specifier that
  // names a file the tree HAS is MATCHED and never enters `dead` to be
  // described. That is the fix, so the pin asserts the ARRIVAL rather than
  // being deleted for going quiet — a departure pin cannot see an arrival, and
  // this section learned that the expensive way one card ago.
  t(
    'an extensionless specifier whose file the tree HAS is no longer unreachable at all — it is MATCHED',
    !sweptNames.includes('check:extensionless'),
  );
  t('...because the covering rule reaches the file itself', hintCovers('packages/spec/src/index', 'packages/spec/src/index.ts'));
  // The renderer is a pure function over `dead`, so it is still pinned — just
  // no longer from the live sweep for a hint that carries a separator. Handed
  // the entry the sweep used to build, it must still say the true thing; that
  // sentence is #12780's and this card does not move it.
  const extlessDead = [
    {
      hint: 'packages/spec/src/index',
      deepest: deepestTrackedPrefix('packages/spec/src/index', trackedPrefixes(treeFixture)),
      target: extensionlessModuleTarget('packages/spec/src/index', new Set(treeFixture), trackedPrefixes(treeFixture)),
    },
  ];
  t('the renderer still names WHY: the tree HAS the file under the extension the specifier drops', /extensionless module spelling/.test(unreachableReason(extlessDead)));
  t('...and it names the FILE, so the reader has no prefix to guess from', unreachableReason(extlessDead).includes('packages/spec/src/index.ts'));
  t('...never reporting the short prefix as a layout move', !/layout moved/.test(unreachableReason(extlessDead)));

  // ── The reason printed is the refusal that FIRED (#12797) ────────────────
  //
  // The sentence above is true only where the comparison really was a
  // whole-segment one. `hintCovers` refuses a separator-less literal BEFORE it
  // compares anything, so for a BARE hint that sentence describes a comparison
  // that never ran — and since #12514 that is the only population the branch
  // can still reach, because a separator-carrying hint whose file the tree HAS
  // is MATCHED and never dead. Measured on this tree when the reorder landed:
  // 236 dead hints, 0 of them reaching the `target` branch at all, so this is a
  // LATENT wrong sentence pinned before it can go live — exactly the state the
  // two closed cards of this species were in before a layout change woke them.
  const bareTreeFixture = ['conversions.ts', 'packages/spec/src/index.ts'];
  const bareDead = [
    {
      hint: 'conversions',
      deepest: deepestTrackedPrefix('conversions', trackedPrefixes(bareTreeFixture)),
      target: extensionlessModuleTarget('conversions', new Set(bareTreeFixture), trackedPrefixes(bareTreeFixture)),
    },
  ];
  t(
    'the fixture really is the residue population this is about: bare, dead, and extensionless-resolvable',
    bareDead[0].target === 'conversions.ts' && !hintCovers('conversions', 'conversions.ts'),
    JSON.stringify(bareDead[0]),
  );
  t(
    '⭐ a BARE hint is told which refusal fired — the separator, not the extension',
    /too generic \(no path separator\)/.test(unreachableReason(bareDead)),
    unreachableReason(bareDead),
  );
  t(
    '⛔ ...and is NOT told that no whole-segment comparison reaches it, which is a comparison that never ran',
    !/whole-segment comparison/.test(unreachableReason(bareDead)),
    unreachableReason(bareDead),
  );
  t(
    '...while still naming the FILE the tree has, so the reader is not left guessing at a prefix',
    unreachableReason(bareDead).includes('conversions.ts'),
    unreachableReason(bareDead),
  );
  // ⛔ The ordering is the repair, so the OTHER population must be untouched: a
  // separator-carrying hint still gets the extensionless sentence, byte for
  // byte. A reorder that swallowed both would have retired a true sentence.
  t(
    '⛔ a separator-carrying hint keeps the extensionless sentence — the reorder moved one population, not two',
    /extensionless module spelling/.test(unreachableReason(extlessDead)) && !/too generic/.test(unreachableReason(extlessDead)),
  );
  // One rule, one owner: the residue printer must refuse exactly what the
  // matcher refuses, or it reports a refusal that did not fire.
  t(
    'the refusal the printer names is the refusal the matcher applies',
    refusedAsTooGeneric('conversions') === true
      && refusedAsTooGeneric('packages/spec/src/index') === false
      && refusedAsTooGeneric('.changeset') === false,
  );
  t(
    '⛔ ...and a PATTERN is never read as a bare word, however its collapse spells out',
    refusedAsTooGeneric('.changeset/*.md') === false,
  );
  t(
    'a family whose only dead hints are extensionless specifiers is BY CONSTRUCTION, not a miss to triage',
    unreachableClass(extlessDead) === 'by construction',
  );
  // ...and the exception is exactly that narrow: a hint with no such file in
  // the tree is a layout move exactly as before.
  t('a genuine short prefix is still a layout move', unreachableClass(sweep.find((u) => u.check === 'check:moved').dead) === 'layout moved');
  // The predicate itself, both directions, over the same fixture corpus.
  const extlessFiles = new Set(treeFixture);
  const extlessPrefixes = trackedPrefixes(treeFixture);
  t(
    'the predicate finds the file an extensionless specifier names',
    extensionlessModuleTarget('packages/spec/src/index', extlessFiles, extlessPrefixes) === 'packages/spec/src/index.ts',
  );
  t(
    '...refuses a hint the tree already HAS as a path, leaving the too-generic message its case',
    extensionlessModuleTarget('examples', extlessFiles, extlessPrefixes) === null,
  );
  t(
    '...and invents nothing for a literal that never was a path',
    extensionlessModuleTarget('application/json', extlessFiles, extlessPrefixes) === null,
  );
  t('...and that case really is a population the tree has', trackedPrefixes(treeFixture).has('examples'));
  t('the reason list is capped rather than printed as an inventory', /…$/.test(unreachableReason([1, 2, 3, 4].map((n) => ({ hint: `no/such/path-${n}`, deepest: '' })))));
  // The verdict is CROSS-CUTTING, never a fourth bucket: an unreachable family
  // classifies exactly as it did before, including MATCHED for a card whose
  // surface is a file that does not exist yet.
  const unreachableFam = fam(['packages/spec/src/legacy/**']);
  t('an unreachable family is still silent for an unrelated card — the sweep moves no verdict', classifyEntry(unreachableFam, ['packages/rest/src/server.ts']).verdict === 'silent');
  t('and still MATCHED for a card surface that does not exist yet', classifyEntry(unreachableFam, ['packages/spec/src/legacy/new.ts']).verdict === 'matched');
  // #4690 one level up: the sweep must not report a broken scan as a clean
  // repo. Three refusals, at the corpus, at the answer, and at the summary.
  let emptyCorpus = false;
  try {
    unreachableFamilies(sweepEntries, []);
  } catch {
    emptyCorpus = true;
  }
  t('a sweep over an EMPTY corpus is refused, never answered as "nothing unreachable"', emptyCorpus);
  let allDead = false;
  try {
    unreachableFamilies([['check:never-was', fam(['application/json'])]], treeFixture);
  } catch {
    allDead = true;
  }
  t('an all-unreachable answer is refused as a broken recognizer, not printed as a defect count', allDead);
  // The corpus reader, against the real tree — a wrong git invocation is
  // invisible to every fixture above.
  const liveCorpus = trackedFiles();
  t('the corpus reader really reads this tree', liveCorpus.length > 1000 && liveCorpus.includes('AGENTS.md'));
  t('and reads it null-separated, so a non-ASCII path is not quoted into a name nothing can match', !liveCorpus.some((f) => f.startsWith('"')));
  t('the collapse the reason speaks in is the one hintCovers judges by', collapseHint('packages/spec/**') === 'packages/spec' && hintCovers('packages/spec/**', 'packages/spec/src/index.ts'));

  // ── The reason must speak in the form the COMPARISON used (#13448) ────────
  //
  // Every branch above used to reason from `collapseHint` unconditionally,
  // including for the hints `hintCovers` had already stopped judging that way.
  // A pattern-judged hint can never equal its own collapsed splice —
  // `.changeset` is not `.changeset/.md` — so "the tree stops at X; the layout
  // moved under it" was the ONLY reachable sentence for that whole shape class:
  // a specific wrong cause, printed under the heading that tells a reader to go
  // chase it. Repairing `hintCovers` alone would have retired the five live
  // instances and left the derivation that mints them intact, which is trading
  // one error for a better-hidden one.
  t('the form a pattern hint is judged by is its literal prefix, not its splice',
    comparedForm('.changeset/*.md') === '.changeset' && collapseHint('.changeset/*.md') === '.changeset/.md');
  t('...and a collapse-judged hint still speaks in the collapse', comparedForm('packages/spec/**') === 'packages/spec');
  t('...for the mid-segment shape too', comparedForm('skills/*/references/_index.md') === 'skills');
  t('...and it stops at the FIRST glob segment, however many follow', comparedForm('src/**/*') === 'src');
  t('...leaving nothing at all when the very first segment is the glob', comparedForm('**/package.json') === '');
  const patternRootPresent = [{ hint: '.changeset/*.md', deepest: '.changeset', target: null }];
  t('a dead glob pattern whose root is right there is NOT a layout move', unreachableClass(patternRootPresent) === 'by construction');
  t('...and never asserts a directory rename that never happened', !/layout moved/.test(unreachableReason(patternRootPresent)));
  t('...while the reason it does give is one the reader can check for themselves',
    /GLOB PATTERN and nothing under that root matches/.test(unreachableReason(patternRootPresent)) &&
      unreachableReason(patternRootPresent).includes("git ls-files '.changeset/*.md'"));
  // ...and the exception is exactly that narrow: a pattern whose own literal
  // prefix has gone IS a move, and still reads as one.
  const patternPrefixGone = [{ hint: 'packages/gone-away/*.ts', deepest: 'packages', target: null }];
  t('a glob pattern whose literal prefix is gone is still a layout move', unreachableClass(patternPrefixGone) === 'layout moved');
  t('...and its reason names the prefix that went missing', unreachableReason(patternPrefixGone).includes('packages/gone-away'));
  // The live half: the specimen is gone from the residue entirely, which is
  // what the card was filed for. A fixture cannot show that.
  //
  // It reads the same live population as the `globCarriesLiteralSuffix` block
  // above, so it takes the same exit when a version pass has consumed it
  // (#15255) — the second site, and the reason `unmeasurable` is a primitive
  // rather than one `if` written once. Left unguarded, this one case would have
  // kept the release-blocking red after the block above stopped producing it,
  // which is the shape a repair applied at only the site that was measured red
  // always has.
  const residueCorpus = trackedFiles();
  if (residueCorpus.some((f) => /^\.changeset\/[^/]+\.md$/.test(f))) {
    t('the live specimen is not a dead literal on this tree at all', hintReachesTree('.changeset/*.md', residueCorpus));
  } else {
    unmeasurable(
      "the residue block's live `.changeset/*.md` specimen",
      'a hint reaches the tree by matching a FILE, and a tree whose version pass has consumed the population has ' +
        'no file for this one to match. The judgment this case guards — that a pattern-judged hint is not read as a ' +
        'dead literal — is pinned on fixtures a few lines above and ran.',
    );
  }

  // ── A slash is not proof of a path (#10097, option C) ─────────────────────
  //
  // Two families declared a population that was never a population: a literal
  // scraped out of their operational constants and read as the corpus they
  // watch. Both directions are pinned, because a refusal this broad is only
  // safe if it can be shown NOT to eat real paths.
  t('a MIME type is not a path population', isNonPathNamespace('application/json'));
  t('nor is any of the other nine IANA top-level types', ['text/plain', 'image/png', 'font/woff2', 'video/mp4', 'multipart/form-data'].every(isNonPathNamespace));
  t('a full git ref is not a path population', isNonPathNamespace('refs/remotes/origin/main'));
  t('nor is the remote-tracking shorthand for one', isNonPathNamespace('origin/main'));
  // The negative half. These are the shapes a careless rule would take with it,
  // and each is a real spelling this repo's gates use.
  t('an ordinary package path is untouched', !isNonPathNamespace('packages/spec/src/index.ts'));
  t('a dotted top-level dir is untouched', !isNonPathNamespace('.claude/agents'));
  t('a declared subtree is untouched', !isNonPathNamespace('content/**'));
  t('a THREE-segment literal headed by a media type is a path, not a MIME type', !isNonPathNamespace('application/json/schema.ts'));
  t('a media-type head with a DOTTED second segment is a path, not a MIME type', !isNonPathNamespace('image/logo.png'));
  t('a bare word is left to the too-generic rule that already owns it', !isNonPathNamespace('examples'));
  t('a directory merely STARTING with a refused word is untouched', !isNonPathNamespace('origins/data.ts') && !isNonPathNamespace('refspec/x.ts'));
  // The third shape (#13312): an @-headed first segment is a scope marker —
  // npm's grammar, not this repo's layout — and 353 of the 598 dead literals
  // riding unannotated in reachable families were exactly this, package
  // specifiers scraped out of dependency ledgers and read as watched paths.
  t('an npm package specifier is not a path population', isNonPathNamespace('@objectstack/spec'));
  t('nor with a version suffix on it', isNonPathNamespace('@objectstack/spec@*'));
  t('nor a bundler alias whose bare @ is the whole first segment', isNonPathNamespace('@/lib/i18n'));
  t('nor the bare scope name a trailing-slash literal trims down to', isNonPathNamespace('@objectstack'));
  t('an owner/repo slug is NOT refusable by shape — two bare words are what a path looks like', !isNonPathNamespace('objectstack-ai/objectstack'));
  t('a LATER @-segment is untouched — only the first segment carries the namespace claim', !isNonPathNamespace('packages/@scope/x'));
  t('the extractor drops a scraped package specifier', extractWatchHints("const PKG = '@objectstack/driver-memory';").length === 0);
  t('while a real path beside a package specifier survives', extractWatchHints("const PKG = '@objectstack/spec'; const P = 'packages/spec/src';").join() === 'packages/spec/src');
  // Through the extractor, which is where it actually bites.
  t('the extractor drops a scraped MIME type', !extractWatchHints("const H = {'content-type': 'application/json'};").includes('application/json'));
  t('the extractor drops a scraped git ref', extractWatchHints("const R = 'refs/remotes/origin/main';").length === 0);
  t('while a real path beside it in the same source survives', extractWatchHints("const H = 'application/json'; const P = 'packages/spec/src';").includes('packages/spec/src'));
  // The two families the card named, read from the REAL sources. A fixture
  // cannot show that these particular gates were repaired — the literal has to
  // be gone from the file the derivation actually reads.
  const misparsedFamilySources = ['scripts/release-github-releases.mjs', 'scripts/check-skill-frame-freshness.mjs'];
  for (const rel of misparsedFamilySources) {
    const famHints = extractWatchHints(readFileSync(nodePath.join(ROOT, rel), 'utf8'), rel);
    t(`${rel} no longer declares a phantom population`, !famHints.some(isNonPathNamespace));
  }
  // The live pin that the repair CHANGED the verdict: neither family may sit in
  // the real tree's unreachable set any more. Measured, not assumed — both
  // turned out to have had the phantom as their ONLY hint, so both land in
  // `undetermined` ("names no path at all"), which is the honest bucket.
  const liveSweepEntries = [];
  for (const rel of misparsedFamilySources) {
    liveSweepEntries.push([rel, fam(extractWatchHints(readFileSync(nodePath.join(ROOT, rel), 'utf8'), rel))]);
  }
  t('the repaired families declare no population at all, so the sweep skips them', unreachableFamilies([...liveSweepEntries, ['check:anchor', fam(['packages/spec/src'])]], liveCorpus).length === 0);
  // The same live pin for the @-scope refusal (#13312): the two families whose
  // ENTIRE population was a package-name ledger — the shape os-elon's comment
  // measured — must be out of the unreachable listing, landed in `undetermined`
  // rather than renamed into a different phantom.
  const packageLedgerFamilySources = ['scripts/check-driver-memory-census.mjs', 'scripts/check-test-completeness.mjs'];
  const ledgerSweepEntries = [];
  for (const rel of packageLedgerFamilySources) {
    const famHints = extractWatchHints(readFileSync(nodePath.join(ROOT, rel), 'utf8'), rel);
    t(`${rel} no longer declares a phantom package-name population`, !famHints.some((h) => h.startsWith('@')));
    ledgerSweepEntries.push([rel, fam(famHints)]);
  }
  t(
    'the package-ledger families left the unreachable listing — the phantom is gone, not renamed',
    unreachableFamilies([...ledgerSweepEntries, ['check:anchor', fam(['packages/spec/src'])]], liveCorpus).length === 0,
  );

  // ── The unreachable listing prints by DEFAULT (#10097, option A) ──────────
  //
  // The disclosure existed; the reason to look did not. These pin the shape of
  // the default section and the class split that keeps a real miss from being
  // buried among the standing facts.
  t('a population that never was a path is unreachable BY CONSTRUCTION', unreachableClass([{ hint: 'application/json', deepest: '' }]) === 'by construction');
  t('so is one the covering rule refuses as too generic', unreachableClass([{ hint: 'examples', deepest: 'examples' }]) === 'by construction');
  t('a tree that stops at a shorter prefix is a LAYOUT MOVE — a real miss, not a standing fact', unreachableClass([{ hint: 'packages/spec/src/legacy/**', deepest: 'packages/spec/src' }]) === 'layout moved');
  t('one moved hint among by-construction ones still reads as a layout move', unreachableClass([{ hint: 'application/json', deepest: '' }, { hint: 'packages/spec/src/legacy/**', deepest: 'packages/spec/src' }]) === 'layout moved');

  const listed = unreachableLines(sweep, treeFixture.length);
  const listedText = listed.join('\n');
  // Three, not four: the fixture's extensionless family stopped being
  // unreachable when #12514 taught the matcher to follow a dropped extension.
  // The corpus size beside it is `treeFixture.length` and did not move.
  t('the listing heading carries the count and the corpus it swept', /3 famil\(ies\).*swept over 4 tracked file\(s\)/.test(listed[0]));
  // Re-pointed by #12956, not weakened: the ⛔ correction is still asserted, and
  // so is the sentence that used to carry it. What moved is that "CI runs these
  // on every pull request" became a per-entry fact once a job filter could
  // schedule an unreachable family — see the two cases below for the split.
  t('⛔ and states plainly that this is not a skip list — the one wrong reading', /NOT a skip list/.test(listedText));
  t('and that CI still schedules them on every PR, which is what makes the wrong reading wrong', /CI schedules (?:those|it) on EVERY pull request/.test(listedText));
  t(
    'with no job filter in the fixture, the listing says so of EVERY entry rather than counting exceptions',
    /Every one of them also sits outside any path filter/.test(listedText)
      && !/Nonetheless SCHEDULED/.test(listedText),
  );
  // The other branch: an unreachable family whose JOB carries a resolvable
  // filter is scheduled from a path population, so the blanket claim above is
  // false of it. Both halves are pinned — the count line and the per-entry mark
  // — because a count with no marked entry sends a reader looking for one.
  const scheduledSweep = sweep.map((u, i) => (i === 0
    ? { ...u, entry: { ...u.entry, jobFilters: [{ workflow: 'ci.yml', job: 'test', name: 'Test Core', outputs: ['filter.core'], paths: ['packages/**'], dropped: 0 }] } }
    : u));
  const scheduledText = unreachableLines(scheduledSweep, treeFixture.length).join('\n');
  t('a scheduled unreachable family is COUNTED as the exception it is', /Nonetheless SCHEDULED from a path population: 1 of the 3/.test(scheduledText));
  t('and the entry itself says which job schedules it', /SCHEDULED by 'Test Core' in ci\.yml/.test(scheduledText));
  t('while the blanket every-PR claim is withdrawn for the set that has one', !/Every one of them also sits outside any path filter/.test(scheduledText));
  t('the layout-moved family prints under its own heading', /THE LAYOUT MOVED under a gate that still spells the old path/.test(listedText));
  t('and the by-construction families under theirs', /unreachable BY CONSTRUCTION/.test(listedText));
  t('the real miss sorts BEFORE the standing facts, never buried among them', listedText.indexOf('THE LAYOUT MOVED') < listedText.indexOf('BY CONSTRUCTION'));
  t('every swept family is named in the listing, runnably', sweep.every((u) => listedText.includes(runnableInvocation(u.entry))));
  t('each entry still carries the reason it could not reach', /a base this scan did not resolve/.test(listedText) && /the tree HAS it/.test(listedText));
  // The empty case must not print as a missing section, and the corpus size is
  // required for the #4690 reason one level down.
  const emptyListing = unreachableLines([], 4).join('\n');
  t('an EMPTY unreachable set still prints a section, saying so in words', /0 famil\(ies\)/.test(emptyListing) && /every declaring family reaches something/.test(emptyListing));
  let listingNeedsCorpus = false;
  try {
    unreachableLines([], 0);
  } catch {
    listingNeedsCorpus = true;
  }
  t('the listing refuses to render without the corpus it swept', listingNeedsCorpus);

  // ── The residue accounting (#8632) ────────────────────────────────────────
  //
  // Two properties, both of which the deleted prose lacked: it accounts for
  // every discovered family, and it names no gate. The second is the one that
  // rots — a hand-written list of gate names in this paragraph is exactly what
  // was wrong with it — so it is asserted directly rather than by inspection.
  const residue = residueLines({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 55, unfiltered: 80, unreachable: 5, swept: 6000, artifactRosters: 4, invertedRosters: 1 });
  t('the residue summary states the discovered total', residue.some((l) => l.includes('98')));
  t('the residue summary states each bucket', residue.some((l) => l.includes('35 undetermined')) && residue.some((l) => l.includes('55 silent')));
  t('the residue summary points at the flag that lists the unplaced families', residue.some((l) => l.includes('--residue') && l.includes('90')));
  t('the residue summary names NO gate — the property the deleted prose lacked', !/check:[\w:-]+/.test(residue.join('\n')));
  // The silence split (#10784). The summary must SIZE the inverted part of
  // `silent`, not only describe the weak part in prose, and it must say so
  // differently when none of the rosters touches the caller's paths — a
  // constant sentence would be a line the reader learns to skip.
  t('the residue summary sizes the artifact rosters inside silent', residue.some((l) => l.includes('4 of those 55')));
  t('and calls out the ones whose roster sits where the card is', residue.some((l) => l.includes('For 1 of them') && l.includes('EITHER direction')));
  const noInverted = residueLines({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 55, unfiltered: 80, unreachable: 5, swept: 6000, artifactRosters: 4, invertedRosters: 0 });
  t('with none of them there it says THAT instead, rather than printing the warning at zero', noInverted.some((l) => l.includes('None of their rosters')) && !noInverted.join('\n').includes('EITHER direction'));
  // The same rot, one noun over (#10012). The top-level-FILE clause used to
  // illustrate the unreachable class with `README.md`, which was honest until
  // that gate declared `README.md/**` — after which the sentence offered, as
  // its example of a population nothing can reach, the one root file in this
  // repo that a card DOES derive. A specimen here is a claim about the tree
  // that this function has no way to keep true; the escape hatch is the half
  // that cannot go stale, because it restates the rule rather than the tree.
  // The first pin holds only the literal that actually rotted — a future
  // specimen spelled some other way would slip it, which is why the second
  // pin, that the durable half is present at all, is the load-bearing one.
  t('the residue names no repo-root file as an unreachable specimen', !residue.join('\n').includes('README.md'));
  t('and states the escape hatch instead, which restates the rule and cannot rot', residue.some((l) => l.includes('subtree spelling')));
  t('the residue summary still names the convention KINDS it derives', residue.some((l) => l.includes('adds or edits a test file')));
  // The schedule half (#9171). The count is the size of the answer this
  // derivation cannot give — families CI runs on every PR — and printing it is
  // what stops that from being an absence the reader never sees.
  t('the residue summary sizes the unfiltered-workflow families', residue.some((l) => l.includes('80 of the 98')));
  t('and says what their bucket verdict does NOT mean', residue.some((l) => l.includes('EVERY pull request')));
  // The partition must be a partition. A fourth bucket added to classifyEntry
  // and not wired into the summary would otherwise shrink the residue silently,
  // which is the failure class this whole card is about.
  let refused = false;
  try {
    residueLines({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 54, unfiltered: 80, unreachable: 5, swept: 6000, artifactRosters: 4, invertedRosters: 1 });
  } catch {
    refused = true;
  }
  t('a partition that does not account for every discovered family is REFUSED', refused);
  // ...and the schedule count is not allowed to go missing quietly either: an
  // omitted count would render as a line with `undefined` in it, which reads as
  // a derivation rather than as the absent measurement it is.
  let refusedUnfiltered = false;
  try {
    residueLines({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 55, unreachable: 5, swept: 6000, artifactRosters: 4, invertedRosters: 1 });
  } catch {
    refusedUnfiltered = true;
  }
  t('an omitted unfiltered-workflow count is REFUSED, never printed as undefined', refusedUnfiltered);
  // The third verdict is held to the same standard, and its corpus size with
  // it: "0 unreachable" and "the sweep matched nothing at all" print alike
  // unless the number of files swept is beside the count (#4690).
  t('the residue summary sizes the unreachable families', residue.some((l) => l.includes('5 of the 98') && l.includes('reaches NOTHING')));
  t('and states the corpus it swept, so a zero can be told from a broken scan', residue.some((l) => l.includes('6000 tracked file(s)')));
  const refusedFor = (args) => {
    try {
      residueLines(args);
      return false;
    } catch {
      return true;
    }
  };
  t(
    'an omitted unreachable count is REFUSED, never printed as undefined',
    refusedFor({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 55, unfiltered: 80, swept: 6000, artifactRosters: 4, invertedRosters: 1 }),
  );
  t(
    'an unreachable count with NO corpus size is REFUSED — the number is unreadable without it',
    refusedFor({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 55, unfiltered: 80, unreachable: 5, artifactRosters: 4, invertedRosters: 1 }),
  );
  t(
    'a sweep that swept zero files is REFUSED at the summary too, not printed as a clean repo',
    refusedFor({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 55, unfiltered: 80, unreachable: 0, swept: 0, artifactRosters: 4, invertedRosters: 1 }),
  );
  t(
    'zero unreachable over a real corpus is a legitimate answer, not a refusal',
    !refusedFor({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 55, unfiltered: 80, unreachable: 0, swept: 6000, artifactRosters: 4, invertedRosters: 1 }),
  );
  // The silence split is held to the same standard as the counts above: it is
  // a SUBSET count, so both directions of the subsetting are refused rather
  // than trusted, and an omitted one must not print as `undefined`.
  t(
    'an omitted artifact-roster count is REFUSED, never printed as undefined',
    refusedFor({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 55, unfiltered: 80, unreachable: 5, swept: 6000, invertedRosters: 0 }),
  );
  t(
    'a roster count larger than the silent bucket it subsets is REFUSED',
    refusedFor({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 55, unfiltered: 80, unreachable: 5, swept: 6000, artifactRosters: 56, invertedRosters: 0 }),
  );
  t(
    'and an inverted count larger than the rosters it subsets is REFUSED',
    refusedFor({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 55, unfiltered: 80, unreachable: 5, swept: 6000, artifactRosters: 4, invertedRosters: 5 }),
  );

  // ── The families a changeset will add (#10309) ────────────────────────────
  //
  // The measured defect: over one round of five dispatches, every dev's
  // re-derivation was longer than the PM's list by the SAME five families, and
  // on two of the five cards those five were the whole delta. They are
  // changeset-triggered, and the changeset does not exist when the PM derives.
  //
  // These cases pin the property rather than the five names. The fixtures below
  // invent gates this repo does not have — including a SIXTH changeset-
  // triggered family — because the one thing this section must never become is
  // a table: a hand-maintained list would pass a test written against today's
  // five and go quietly wrong on the day a sixth lands, which is the failure
  // mode the whole file is built against. A fixture family the script has never
  // heard of appearing in the output is the only assertion that can tell a
  // probe from a list.
  const csFam = (check, hints, extra = {}) => [
    check,
    { check, filter: null, direct: false, workflows: new Set(['lint.yml']), files: [], hints, triggers: [], ...extra },
  ];
  const csEntries = [
    csFam('check:invented-changeset-gate', ['.changeset']),
    csFam('check:invented-sixth-changeset-gate', ['.changeset/**']),
    csFam('check:invented-pre-mode-gate', ['.changeset/pre.json']),
    csFam('check:invented-unrelated-gate', ['packages/objectql/src']),
    csFam('check:invented-undetermined-gate', []),
  ];
  const pending = pendingChangesetFamilies(csEntries, new Set());
  const pendingNames = pending.map((p) => p.check);
  t('a family whose source names the changeset dir is pending for a card that has none yet', pendingNames.includes('check:invented-changeset-gate'));
  t(
    'a SIXTH changeset-triggered family the script has never heard of is pending too — the section is a probe, not a list',
    pendingNames.includes('check:invented-sixth-changeset-gate'),
  );
  // Coverage, not a name match: a gate that reads only the pre-mode file lives
  // in the changeset directory and is NOT moved by a new changeset. Widening
  // the probe to "mentions the changeset dir" would fabricate this lead in the
  // section a dispatch prompt pastes.
  t('a family naming only the pre-mode file is NOT pending — a new changeset is not that file', !pendingNames.includes('check:invented-pre-mode-gate'));
  t('a family naming an unrelated tree is NOT pending', !pendingNames.includes('check:invented-unrelated-gate'));
  t('nor is one whose source names no path at all — undetermined is not pending', !pendingNames.includes('check:invented-undetermined-gate'));
  t('and the probe path itself is the hypothetical one, never a file on disk', !existsSync(nodePath.join(ROOT, CHANGESET_PROBE_PATH)));
  // The subtraction: when the input really carries a changeset these families
  // are in the matched list already, and printing them twice would make two
  // sections claim different things about the same lead.
  const pendingAfterMatch = pendingChangesetFamilies(csEntries, new Set(['check:invented-changeset-gate']));
  t(
    'a family the matched list already printed is subtracted, never printed twice',
    !pendingAfterMatch.map((p) => p.check).includes('check:invented-changeset-gate'),
  );
  t('and subtraction leaves exactly the remainder, not the whole section', pendingAfterMatch.map((p) => p.check).includes('check:invented-sixth-changeset-gate'));
  // CI's own trigger reaches the probe too — the section asks the same question
  // of both authorities the matched list does, not of watch hints alone.
  const csTriggered = pendingChangesetFamilies(
    [csFam('check:invented-trigger-gate', [], { triggers: [{ workflow: 'invented.yml', paths: ['.changeset/**'] }] })],
    new Set(),
  );
  t('a family CI SCHEDULES for a changeset is pending on the trigger alone, with no watch hint', csTriggered.length === 1);
  // Optional-chained on purpose: an implementation that stops finding this
  // family must REDDEN this case, not throw out of the harness before the rest
  // of the suite runs (measured while ablating the probe into a hand list).
  t('and its provenance says so, rather than claiming a source literal', csTriggered[0]?.hits?.[0]?.via?.startsWith('CI trigger in') === true);
  // Rendering.
  const pendingOut = pendingChangesetLines(pending);
  t('the section heading counts the families and carries the publishes-nothing escape, stated as the os-dev clause states it', /^Once a changeset exists, 2 more famil\(ies\) apply — write one unless this card publishes nothing from any released package \(then the skip-changeset label instead, per the os-dev clause\):$/.test(pendingOut[0]));
  t('every row is a RUNNABLE invocation, the same as the matched list', pendingOut.filter((l) => l.startsWith('  - ')).every((l) => l.startsWith('  - pnpm ') || l.startsWith('  - node ')));
  t('every row prints the hypothetical path it would match, so the lead cannot read as a real one', pendingOut.filter((l) => l.startsWith('  - ')).every((l) => l.includes(CHANGESET_PROBE_PATH)));
  t('the section says out loud that it is not a fourth bucket', pendingOut.some((l) => l.includes('NOT a fourth bucket')));
  t('and that the dev writes the changeset AFTER this derivation runs — the temporal gap is the point', pendingOut.some((l) => l.includes('written by the DEV, after this derivation runs')));
  t('an empty pending set renders NOTHING — no zero heading to send a reader looking', pendingChangesetLines([]).length === 0);

  // ── The model-tier derivation (#8640) ─────────────────────────────────────
  //
  // The incident these originally pinned: a surface containing a pm-dispatch
  // REFERENCES file was claimed as "not under the fable-mandatory roots" and
  // dispatched at opus — nothing mechanical compared the claim to the globs.
  // The 2026-08-20 narrowing then made references paths genuinely non-mandatory
  // (opus execution, compensated by the fable-tier skill-face review), so the
  // references pin is now asserted in the OPPOSITE direction; the incident's
  // lesson — derive, never recall — is what survives unchanged. Every
  // direction is asserted: each protocol-semantic file, the references half
  // that dropped out, a mixed surface where ordinary paths must not dilute the
  // mandate, and the ordinary surface that must NOT be mandated (a tool that
  // mandates everything is ignored, which loses the guardrail by the other road).
  const fableOf = (paths) => deriveTier(paths);
  t('the pm-dispatch SKILL.md MAIN file is fable-mandatory', fableOf(['.claude/skills/pm-dispatch/SKILL.md']).tier === CONTRACT_REVIEW_TIER);
  t('the dev-agent definition is fable-mandatory', fableOf(['.claude/agents/os-dev.md']).tier === CONTRACT_REVIEW_TIER);
  t('a pm-dispatch REFERENCES path carries NO path mandate — the 2026-08-20 narrowing, inverted from the pre-narrowing pin', fableOf(['.claude/skills/pm-dispatch/references/review-checklist.md']).mandatory === false);
  const mixed = fableOf(['packages/spec/src/data/filter.zod.ts', '.claude/agents/os-dev.md']);
  t('a MIXED surface is mandatory — one mandatory path decides, ordinary paths do not dilute it', mixed.mandatory && mixed.tier === CONTRACT_REVIEW_TIER);
  t('the mixed verdict reports the offending path, not just the verdict', mixed.hits.length === 1 && mixed.hits[0].path.endsWith('.claude/agents/os-dev.md'));
  t('an ordinary surface carries no path-derived mandate', fableOf(['packages/spec/src/data/filter.zod.ts']).mandatory === false);
  t("this tool's own file is not mandatory — the card that added this section reads itself correctly", fableOf(['scripts/pm/dispatch-gates.mjs']).mandatory === false);
  // Segment boundaries, both directions of the shared matcher's asymmetry.
  t('a sibling directory sharing a name PREFIX is not mandated', fableOf(['.claude/skills/pm-dispatchers/notes.md']).mandatory === false);
  t('a bare string PREFIX of a mandatory file is not an ancestor of it, and is not mandated', fableOf(['.claude/skills/pm-disp']).mandatory === false);
  t('a surface declared as an ANCESTOR of a mandatory file IS mandated — the safe direction here', fableOf(['.claude/skills']).mandatory === true);
  t('the pm-dispatch DIRECTORY (ancestor of its SKILL.md) is mandated — a card declaring the directory may touch the main file', fableOf(['.claude/skills/pm-dispatch']).mandatory === true);
  t('another skill under the same parent is not mandated', fableOf(['.claude/skills/verify/SKILL.md']).mandatory === false);
  // The published catalog (2026-09-10 ruling): the whole `skills/` root is
  // mandated as data, it does not leak into the internal `.claude/skills` tree,
  // and it is the one surface whose one-line-class exit is closed by path.
  const catalogHit = fableOf(['skills/objectstack-data/SKILL.md']);
  t('a published catalog SKILL.md is mandated, by the skills/** entry', catalogHit.tier === CONTRACT_REVIEW_TIER && catalogHit.hits.some((h) => h.glob === 'skills/**'));
  t('a second published catalog file is mandated the same way', fableOf(['skills/objectstack-ai/SKILL.md']).tier === CONTRACT_REVIEW_TIER);
  t('a generated references file under a published skill is mandated too — the mandate is the ROOT, not the SKILL.md files', fableOf(['skills/objectstack-data/references/_index.md']).mandatory === true);
  // The published PM skill's own entry left with the file (2026-09-10 ruling,
  // 「发布版 skills/objectstack-pm-dispatch 删」): the "own entry AND skills/**"
  // shape has no subject any more, and what is pinned instead is that a
  // catalog file is covered by exactly ONE entry — the root — so no second
  // per-file entry under `skills/` has quietly returned.
  t('a catalog file is covered by exactly ONE entry — skills/** — now that the published PM skill and its own entry are gone', catalogHit.hits.length === 1 && catalogHit.hits[0].glob === 'skills/**');
  t('no per-file entry for the deleted published PM skill survives it, and its old path carries the root mandate only', !MANDATORY_TIER_GLOBS.some((g) => g.glob.includes('objectstack-pm-dispatch')) && fableOf(['skills/objectstack-pm-dispatch/SKILL.md']).hits.every((h) => h.glob === 'skills/**'));
  t('skills/** does NOT reach the internal .claude/skills tree — a pm-dispatch references file still carries no mandate', fableOf(['.claude/skills/pm-dispatch/references/state-machine.md']).mandatory === false);
  t('the skills/** entry is declared with its one-line exit switched off, as data', MANDATORY_TIER_GLOBS.some((g) => g.glob === 'skills/**' && g.oneLineExit === false && g.tier === CONTRACT_REVIEW_TIER));
  t('every other mandatory entry keeps the one-line exit open (the flag is an opt-out, absent by default)', MANDATORY_TIER_GLOBS.filter((g) => g.glob !== 'skills/**').every((g) => g.oneLineExit === undefined) && catalogHit.hits.every((h) => h.glob !== 'skills/**' || h.oneLineExit === false));
  const catalogLines = tierLines(catalogHit).join('\n');
  t('the published-catalog rendering refuses the one-line-class exit, in those words', catalogLines.includes('one-line-class') && catalogLines.includes('NOT available') && catalogLines.includes('no one-line exemption'));
  t('and does not offer the opus-execution drop the other mandated surfaces get', !catalogLines.includes('drops to opus execution'));
  t('while still naming the two exits that survive, so a downgrade needs a stated reason', catalogLines.includes('quota exemption') && catalogLines.includes('opus, never lower') && catalogLines.includes('proactive low-headroom'));
  const mixedCatalog = tierLines(fableOf(['.claude/skills/pm-dispatch/SKILL.md', 'skills/objectstack-ai/SKILL.md'])).join('\n');
  t('a mixed surface with ONE published-catalog path loses the one-line exit for the whole card', !mixedCatalog.includes('drops to opus execution') && mixedCatalog.includes('closes the exit for the whole card'));
  // The rendering is where the invariant is actually delivered: the claim
  // comment quotes THESE lines.
  const mandLines = tierLines(mixed).join('\n');
  t('the mandatory rendering names the tier', mandLines.includes(CONTRACT_REVIEW_TIER));
  t('the mandatory rendering says MANDATORY in a word a reader cannot skim past', mandLines.includes('MANDATORY'));
  t('the mandatory rendering shows its provenance — the path and the glob that covered it', mandLines.includes("- .claude/agents/os-dev.md ⇢ '.claude/agents/os-dev.md'"));
  t('the mandatory rendering names every sanctioned exit, so a downgrade needs a stated reason', mandLines.includes('quota exemption') && mandLines.includes('opus, never lower') && mandLines.includes('one-line-class') && mandLines.includes('proactive low-headroom'));
  t('the mechanical-edit exit names its compensating control from the single-source constant', mandLines.includes(`skill-face review at ${CONTRACT_REVIEW_TIER}`));
  const plainLines = tierLines(fableOf(['packages/spec/src/data/filter.zod.ts'])).join('\n');
  t('the no-mandate rendering claims no mandate', !plainLines.includes('MANDATORY'));
  t('the no-mandate rendering names the floor and the default, so the judgment call has its band', plainLines.includes(TIER_FLOOR) && plainLines.includes(TIER_DEFAULT));
  t('BOTH renderings state that clause ② is out of reach of paths — a no-mandate line is not a clearance', plainLines.includes('Clause ②') && mandLines.includes('Clause ②'));
  // The lane key (#18536): the maintainer's lane rule restated — the review is
  // owed in the spec and skills lanes, in-seat at tier or by the at-tier
  // subagent, and in no other lane; the 2026-09-10 SEAT key and the
  // 2026-09-16 TIER key are both retired spellings and must not come back.
  t('BOTH renderings key the clause-② review by LANE — the spec and skills lanes, in-seat at tier or by the at-tier subagent', [plainLines, mandLines].every((l) => l.includes('spec and skills lanes') && l.includes('at-tier subagent')));
  t('…and neither spells a retired key — no "spec seat" (2026-09-10) and no default-tier review or self-review (2026-09-16)', [plainLines, mandLines].every((l) => !l.includes('spec seat') && !l.includes('default-tier review') && !l.includes('self-review')));
  t('…and both say a clause-② hit outside those lanes is spec-lane work that MOVES there — lane routing, never a review demand on the lane that found it', [plainLines, mandLines].every((l) => l.includes('spec-lane work and moves there')));
  t('the no-mandate rendering says how many globs it checked, so an empty table cannot read as a clearance', plainLines.includes(`${MANDATORY_TIER_GLOBS.length} declared glob`));
  // Refusals: a contradiction is not printed, and an ambiguity is not guessed.
  let tierRefused = false;
  try {
    tierLines({ mandatory: false, tier: null, hits: [{ path: 'x', glob: 'y', why: 'z' }], declared: 1 });
  } catch {
    tierRefused = true;
  }
  t('a verdict with a hit but no mandate is REFUSED, never rendered', tierRefused);
  let ambiguityRefused = false;
  try {
    deriveTier(['.claude/skills/pm-dispatch/SKILL.md'], [
      { glob: '.claude/skills/pm-dispatch/**', tier: CONTRACT_REVIEW_TIER, why: 'a' },
      { glob: '.claude/skills/**', tier: 'opus', why: 'b' },
    ]);
  } catch {
    ambiguityRefused = true;
  }
  t('two globs mandating DIFFERENT tiers for one surface are REFUSED, not guessed between', ambiguityRefused);

  // ── The claim's `Container & model:` line, read against the ladder ───────
  //
  // The measured incident: a sister-repo seat hand-wrote the ceiling tier into
  // every claim of a whole shift after a quota wall, and nothing compared the
  // line to anything. `post-stamped.mjs` imports the reader below to refuse
  // that claim before the write: a ceiling cites the MANDATORY hit `--tier`
  // printed, or a per-card `reason:`, on the SAME line — or it is refused.
  const CM = (rest) => `Claim: PM loop round 1\nSession: \`session_x\`\nContainer & model: \`M\`, \`mode:subagent\`, ${rest}`;
  const ceilingIsItsOwnTier = TIER_CEILING !== TIER_DEFAULT && TIER_CEILING !== TIER_FLOOR;
  t('the constant NAME and its VALUE are ceiling spellings; the ladder word joins them only while the ceiling is a tier of its own', ceilingTierSpellings().includes(CONTRACT_REVIEW_TIER_NAME) && ceilingTierSpellings().includes(CONTRACT_REVIEW_TIER) && ceilingTierSpellings().includes(TIER_CEILING) === ceilingIsItsOwnTier);
  t('⭐ a ceiling claim quoting the MANDATORY line reads as the ceiling, with its mandate cited, and earns no refusal', (() => { const r = readContainerModelLine(CM(`\`model: ${CONTRACT_REVIEW_TIER_NAME}\` (\`--tier\` at \`abc1234\`: MANDATORY — SKILL.md ⇢ '.claude/skills/pm-dispatch/SKILL.md')`)); return r.present && r.ceiling && r.mandateCited && containerModelRefusal(CM(`\`model: ${CONTRACT_REVIEW_TIER_NAME}\` (--tier: MANDATORY)`)) === null; })());
  t('⭐ a ceiling claim carrying a per-card `reason:` reads too', containerModelRefusal(CM(`\`model: ${CONTRACT_REVIEW_TIER_NAME}\` (reason: the maintainer ruled it on the card)`)) === null);
  t('⛔ THE INCIDENT SHAPE — the ceiling by its ladder word, with nothing behind it — is REFUSED', !ceilingIsItsOwnTier || containerModelRefusal(CM(`model: ${TIER_CEILING} (the ceiling)`))?.key === 'Container & model');
  t('⛔ the ceiling by its constant NAME with nothing behind it is refused the same way', containerModelRefusal(CM(`\`model: ${CONTRACT_REVIEW_TIER_NAME}\``))?.key === 'Container & model');
  t('⛔ and by its VALUE — a claim must not carry the id at all, and the reader still recognises it as the ceiling', containerModelRefusal(CM(`model: ${CONTRACT_REVIEW_TIER}`))?.key === 'Container & model');
  t('the refusal names the ceiling by the constant\'s NAME and quotes no model identifier back', (() => { const r = containerModelRefusal(CM(`model: ${CONTRACT_REVIEW_TIER}`)); return r.why.includes(CONTRACT_REVIEW_TIER_NAME) && !r.why.includes(CONTRACT_REVIEW_TIER) && r.why.includes('MANDATORY') && r.why.includes('reason:'); })());
  t('the default and floor tiers cite nothing and pass — the reader judges the ceiling only', containerModelRefusal(CM(`\`model: ${TIER_DEFAULT}\` (no path-derived mandate)`)) === null && containerModelRefusal(CM(`model: ${TIER_FLOOR}`)) === null);
  t('the declared tier is the FIRST token after `model:` — the pasted ladder naming the ceiling further along declares nothing', containerModelRefusal(CM(`model: ${TIER_DEFAULT} — --tier: no path-derived mandate (floor ${TIER_FLOOR} · default ${TIER_DEFAULT} · ceiling ${TIER_CEILING})`)) === null && readContainerModelLine(CM(`model: ${TIER_DEFAULT} — ceiling ${TIER_CEILING}`)).tier === TIER_DEFAULT);
  t('the tier compares case-insensitively, as the ladder is quoted by hand', !ceilingIsItsOwnTier || readContainerModelLine(CM(`model: ${TIER_CEILING.toUpperCase()}`)).ceiling === true);
  t('the key is read at the START of a line, decoration tolerated — and off the line start it is prose, not a declaration', readContainerModelLine('Claim: x\n- **Container & model:** `M`, `mode:cloud`, `model: opus`').tier === 'opus' && readContainerModelLine(`Claim: x\nas said, Container & model: model: ${TIER_CEILING} earlier`).present === false);
  t('⛔ ABSENCE is nobody\'s refusal: no `Container & model:` line, or a `model:` slot reading no token, declares no ceiling', readContainerModelLine('Claim: x\nSeat: domain:skills#1').present === false && containerModelRefusal('Claim: x') === null && readContainerModelLine(CM('model:')).tier === null && containerModelRefusal(CM('model:')) === null);
  t('⛔ NOT a claim reader\'s business what a claim is — the reader reads any body; scoping to `Claim:` comments is post-stamped\'s', readContainerModelLine(`Round report\n\nContainer & model: \`M\`, \`mode:subagent\`, \`model: ${CONTRACT_REVIEW_TIER_NAME}\``).ceiling === true);

  // Hoisted out of the slow sections that used to declare them: a later section reads each one.
  const CLI = fileURLToPath(ENGINE_URL);
  const runCli = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: ROOT });
  const liveSlug = repoIdentity().slug;
  const runCliHypothetical = (args) => runCli(liveSlug ? [...args, REPO_FLAG, liveSlug] : args);

  slow("a governed sister repo's tier verdict on the real CLI (one child)", () => {
  // ── A governed sister repo's tier verdict, from the path globs alone ─────
  //
  // The gate half's cross-repo refusal was inherited by the tier half, which
  // reads no tree; measured cost: every sister-repo claim hand-wrote its
  // `model:` line. `sisterRepoTierRun` answers a slug the governed register
  // knows, from the two glob tables, and says so.
  const SISTER = GOVERNED_REPOS.find((r) => r.id !== SELF_REPO_ID);
  t('CONTROL: the governed register names a sister repo, so the cases below are not vacuous', SISTER !== undefined && String(SISTER.slug).includes('/') && governedSisterRepo(SISTER.slug)?.id === SISTER.id);
  const sisterHit = sisterRepoTierRun({ asserted: SISTER.slug, paths: ['skills/x/SKILL.md'], identity: { head: 'abc1234' } });
  t('⭐ a governed sister slug with paths ANSWERS from the globs — MANDATORY for its published catalog, and the provenance names the globs and the commit', sisterHit?.ok === true && sisterHit.stdout.join('\n').includes('MANDATORY') && sisterHit.stdout.join('\n').includes("'skills/**'") && sisterHit.stderr.join('\n').includes('path globs ALONE') && sisterHit.stderr.join('\n').includes('abc1234'));
  t('…the stderr says the sister tree was NOT read and that its gate families still need a checkout OF it', sisterHit.stderr.join('\n').includes('NOT read') && sisterHit.stderr.join('\n').includes('checkout OF'));
  t('…and the changed-lines line is NOT MEASURED, naming the sister — no diff of another repo is readable here', sisterHit.stdout.join('\n').includes('Changed lines — NOT MEASURED') && sisterHit.stdout.join('\n').includes(SISTER.slug));
  t('an ordinary sister path answers the no-mandate floor line this repo prints, glob count included', sisterRepoTierRun({ asserted: SISTER.slug, paths: ['src/components/button.tsx'] }).stdout.join('\n').includes(`no path-derived mandate: the surface hits none of the ${MANDATORY_TIER_GLOBS.length} declared glob`));
  t('the slug compares case-insensitively, as repo slugs do', sisterRepoTierRun({ asserted: SISTER.slug.toUpperCase(), paths: ['src/x.ts'] })?.ok === true);
  t('⛔ a governed sister with NO paths is refused — nothing here can read that repo\'s diff', (() => { const r = sisterRepoTierRun({ asserted: SISTER.slug, paths: [] }); return r !== null && r.ok === false && r.stdout.length === 0 && r.stderr.join('\n').includes('explicit paths'); })());
  t('⛔ this repo\'s own slug is not a sister — null, so the ordinary assertion path answers it', sisterRepoTierRun({ asserted: GOVERNED_REPOS.find((r) => r.id === SELF_REPO_ID).slug, paths: ['x'] }) === null && governedSisterRepo(GOVERNED_REPOS.find((r) => r.id === SELF_REPO_ID).slug) === null);
  t('⛔ an unknown slug or a checkout path is not a sister either — the wrong-repo refusal keeps its exit and its text', sisterRepoTierRun({ asserted: 'not-an-owner/not-a-repo', paths: ['x'] }) === null && sisterRepoTierRun({ asserted: '../a-sister-checkout', paths: ['x'] }) === null && sisterRepoTierRun({ asserted: null, paths: ['x'] }) === null);
  t('the register is INJECTED, never restated: a register naming no sister answers null for every slug', sisterRepoTierRun({ asserted: SISTER.slug, paths: ['x'], repos: [{ id: 'self', slug: SISTER.slug }], selfId: 'self' }) === null);
  // Live guards. A glob naming a path this tree does not have is dead data that
  // mandates nothing while reading as protection — the incident class itself.
  t('the mandatory table is not empty (the guard below is not vacuous)', MANDATORY_TIER_GLOBS.length > 0);
  const deadGlobs = MANDATORY_TIER_GLOBS.filter(
    (g) => !existsSync(nodePath.join(ROOT, g.glob.replace(/\*\*?/g, '').replace(/\/+$/, ''))),
  );
  t(`every declared mandatory glob names a path this tree really has (dead: ${deadGlobs.map((g) => g.glob).join(', ') || 'none'})`, deadGlobs.length === 0);
  t('every declared glob carries the tier it mandates and a reason', MANDATORY_TIER_GLOBS.every((g) => g.glob && g.tier && g.why));
  t('the incident file is a real file, so the references NON-mandate is a live claim and not a fixture', existsSync(nodePath.join(ROOT, '.claude/skills/pm-dispatch/references/review-checklist.md')));
  // The frame-copy half of the mandate is DEFINED by check:skill-frame-sync's
  // COPIES table (the 2026-08-20 ruling's own wording), so the coupling is
  // pinned mechanically: a copy added to that gate without a matching mandate
  // glob here would be exactly the prose-recall drift this section exists
  // against. Spawned rather than imported — selfTest is synchronous, and the
  // probe also proves the module stays import-safe from a cold process.
  const frameProbe = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const m = await import(${JSON.stringify(pathToFileURL(nodePath.join(ROOT, 'scripts/check-skill-frame-sync.mjs')).href)}); console.log(JSON.stringify([...new Set(m.COPIES.map((c) => c.file))]));`,
    ],
    { encoding: 'utf8', cwd: ROOT },
  );
  let frameFiles = [];
  try {
    frameFiles = JSON.parse((frameProbe.stdout ?? '').trim());
  } catch {
    /* frameFiles stays empty and the cases below fail loudly */
  }
  t('the frame-sync COPIES table is readable and non-empty, so the pin below is not vacuous', frameProbe.status === 0 && Array.isArray(frameFiles) && frameFiles.length > 0);
  t(`every frame-sync-enforced copy is fable-mandated (unmandated: ${frameFiles.filter((f) => !deriveTier([f]).mandatory).join(', ') || 'none'})`, frameFiles.length > 0 && frameFiles.every((f) => deriveTier([f]).tier === CONTRACT_REVIEW_TIER));
  t('the SKILL.md main file and the dev-agent definition are declared in their own right, not only via the frame table', MANDATORY_TIER_GLOBS.some((g) => g.glob === '.claude/skills/pm-dispatch/SKILL.md') && MANDATORY_TIER_GLOBS.some((g) => g.glob === '.claude/agents/os-dev.md'));
  });

  // ── The ladder's CEILING and the constant, pinned TOGETHER (#19544) ───────
  //
  // The ceiling used to be a WORD written beside the constant, and the pair
  // drifted in the one direction nothing could see: the harness stopped
  // serving the tier, the constant kept naming it, and the ladder went on
  // printing its family word as a LIVE rule for a tier no dispatch could
  // reach. The ceiling is derived now, so these cases hold the RENDERING
  // against the constant rather than against a remembered word — write the
  // ceiling by hand again and they red, whichever half was edited.
  // The provenance ROWS (`  - <path> ⇢ '<glob>' — <why>`) are excluded from the
  // retired-word guard below, and deliberately: several of them quote a
  // maintainer ruling verbatim, and a record of what was ruled AT THE TIME
  // stays true however the tier moves afterwards. What the guard covers is the
  // rules — the ladder, the exits, the clause-② note, the suspicion line.
  const liveRuleText = (rendered) => rendered.split('\n').filter((l) => !/^\s+- /.test(l)).join('\n');
  const ladderRenderings = [plainLines, mandLines, catalogLines, tierLines(fableOf(['packages/spec/src/api/error-code-ledger.zod.ts'])).join('\n')].map(liveRuleText);
  const ladderLine = plainLines.split('\n').find((l) => l.includes('The tier stays')) ?? '';
  t('the ladder prints a ceiling DERIVED from the contract-review constant, so the two cannot drift apart', ladderLine.includes(`ceiling ${tierWordOf(CONTRACT_REVIEW_TIER)})`), ladderLine || 'no ladder line was rendered at all');
  t("…in the ladder's own vocabulary — the constant's FAMILY word, so a parseable id NEVER reaches the ladder verbatim", /^claude-[a-z]+-/.test(CONTRACT_REVIEW_TIER) && TIER_CEILING === tierWordOf(CONTRACT_REVIEW_TIER) && !ladderLine.includes(CONTRACT_REVIEW_TIER), ladderLine);
  t('tierWordOf reads the family out of an id, and hands an unreadable one back VERBATIM rather than guessing a word', tierWordOf('claude-example-9-9') === 'example' && tierWordOf('an-unfamiliar-shape') === 'an-unfamiliar-shape' && tierWordOf(null) === '');
  // The guard is driven through ONE function so the live reading and its
  // control run the same search. RETIRED_TIER_WORDS is EMPTY — no ruling has
  // retired a tier word — so the live case below clears every rendering for
  // free, and a case asserting only that green would pass just as happily on a
  // search that had stopped matching anything. The non-vacuity case therefore
  // moved off the LIVE list, where it could only ever count entries, and onto
  // a MUTATED copy: feed the guard a word the ladder demonstrably prints and
  // it must red. That is the invariant an empty list has to keep provable — a
  // word still in the ladder can never be in this list.
  const retiredWordHits = (words) =>
    ladderRenderings.flatMap((l, i) => words.filter((w) => l.toLowerCase().includes(w)).map((w) => `${i}/${w}`));
  t(`⛔ no RETIRED tier word survives in any live RULE — ladder, exits, clause-② note and suspicion line all read the constant (dirty: ${retiredWordHits(RETIRED_TIER_WORDS).join(' ') || 'none'})`, retiredWordHits(RETIRED_TIER_WORDS).length === 0);
  t('…and the guard is not reading an empty string — every rendering it clears still carries its own rule text', ladderRenderings.every((l) => l.includes('Model tier')) && ladderRenderings.some((l) => l.includes('Exits,')));
  t(`no tier word is RETIRED today — the list is empty and frozen, which is what "a temporary lack of authorization is not a retirement" looks like in data (holds: ${[...RETIRED_TIER_WORDS].join(', ') || 'none'})`, Array.isArray(RETIRED_TIER_WORDS) && RETIRED_TIER_WORDS.length === 0 && Object.isFrozen(RETIRED_TIER_WORDS));
  t(`…and the guard is NOT vacuous, proved on a MUTATED copy: a list naming the ladder's own ceiling word (${TIER_CEILING}) REDS, so the green above is the empty list and not a broken search (mutated hits: ${retiredWordHits([TIER_CEILING]).join(' ') || 'NONE — the control never fired'})`, retiredWordHits([TIER_CEILING]).length > 0 && retiredWordHits(['a-word-no-rendering-prints']).length === 0);
  t('…and the invariant that copy stands for: no tier word still in the ladder may ever enter the live list', [TIER_FLOOR, TIER_DEFAULT, TIER_CEILING].every((w) => !RETIRED_TIER_WORDS.includes(w)));
  // A sibling case further down pins the constant's CURRENT value to exactly
  // one site under these roots. What that case cannot see is a RETIRED id left
  // behind — it is not the current value, so nothing compares it to anything,
  // and it reads to a grepping seat as a live tier rule. So this one asks the
  // rulebook root a different question: does it spell a model id AT ALL? The
  // skill's own rule is 「本文不写模型名」, and a retirement is the moment that
  // promise pays for itself — the tree needs no edit, so it cannot go stale.
  const walkFilesUnder = (dir, out = []) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = nodePath.join(dir, entry.name);
      if (entry.isDirectory()) walkFilesUnder(abs, out);
      else if (entry.isFile()) out.push(abs);
    }
    return out;
  };
  const SKILL_RULEBOOK_ROOT = '.claude/skills/pm-dispatch';
  const skillRulebookFiles = walkFilesUnder(nodePath.join(ROOT, SKILL_RULEBOOK_ROOT));
  const skillIdSpellings = [];
  for (const abs of skillRulebookFiles) {
    readFileSync(abs, 'utf8').split('\n').forEach((line, i) => {
      if (/\bclaude-[a-z]+-\d[\w.-]*/.test(line)) skillIdSpellings.push(`${nodePath.relative(ROOT, abs)}:${i + 1}`);
    });
  }
  t(`${SKILL_RULEBOOK_ROOT} spells NO model id at all — ${skillRulebookFiles.length} file(s) read, and a RETIRED id left there is caught HERE, where a current-value pin cannot see it (found: ${skillIdSpellings.join(', ') || 'none'})`, skillRulebookFiles.length > 0 && skillIdSpellings.length === 0);
  // The rulebook half of the same coupling: the skill names the constant. Its
  // downgrade-fuse section is retired (maintainer 2026-09-22 「降档保险丝 不留」,
  // #19061 comment 5772289798), so the guard below reds if that text creeps back.
  const fuseRules = readFileSync(nodePath.join(ROOT, '.claude/skills/pm-dispatch/references/contract-review.md'), 'utf8');
  t('the rulebook names the contract-review tier by its CONSTANT, so a retirement moves the value and the prose follows', fuseRules.includes('`CONTRACT_REVIEW_TIER`'));
  t('the rulebook no longer carries the retired 降档保险丝 lines (maintainer 2026-09-22 「降档保险丝 不留」, #19061 comment 5772289798)', !/额度耗尽豁免[^\n]*不及复核/.test(fuseRules) && !/档位退役[^\n]*≠[^\n]*耗尽/.test(fuseRules));

  // ── Clause-② suspicion (the enqueue-gate card): hit / no hit / wording ────
  //
  // The wording cases are not decoration — the suspicion line is quoted into
  // claim comments, and its one invariant is that a HINT must not be readable
  // as a verdict (nor harden the no-mandate line into a clearance).
  const suspectHit = fableOf(['packages/spec/src/api/error-code-ledger.zod.ts']);
  t('a spec contract path is a clause-② SUSPECT, with its provenance recorded', suspectHit.suspects.length === 1 && suspectHit.suspects[0].glob === 'packages/spec/src/**');
  t('a suspect is NOT a mandate — suspicion must not harden into a path verdict', suspectHit.mandatory === false && suspectHit.tier === null);
  const suspectRendered = tierLines(suspectHit).join('\n');
  t('the suspicion rendering says SUSPECT and names the offending path', suspectRendered.includes('SUSPECT') && suspectRendered.includes('packages/spec/src/api/error-code-ledger.zod.ts'));
  t('the suspicion rendering is a hint, not a verdict, in those words', suspectRendered.includes('a hint, not a verdict'));
  t('the suspicion rendering sends the seat to the card CONTENT for the tier call', suspectRendered.includes('judge the tier from the card CONTENT'));
  t('the suspicion rendering routes EVERY dispatch through the enqueue gate on the ACTUAL diff', suspectRendered.includes('whichever tier is dispatched') && suspectRendered.includes('enqueue gate'));
  t('the suspicion rendering names the contract-review tier from its single-source constant', suspectRendered.includes(CONTRACT_REVIEW_TIER));
  t('the suspicion rendering keys the review by LANE — "in the spec lane", the work being the spec lane\'s whichever seat found it — never by seat (#18536)', suspectRendered.includes('in the spec lane') && suspectRendered.includes('whichever seat found it') && !suspectRendered.includes('spec seat'));
  const noSuspicion = fableOf(['packages/runtime/src/kernel.ts']);
  t('an ordinary non-contract surface raises no suspicion', noSuspicion.suspects.length === 0);
  t('no suspicion ⇒ no suspect line — absence and clearance must not share a spelling with a hit', !tierLines(noSuspicion).join('\n').includes('SUSPECT'));
  const mandatedAndSuspect = fableOf(['.claude/skills/pm-dispatch/SKILL.md', 'packages/spec/src/data/filter.zod.ts']);
  t('a mandated surface still prints its suspect paths — the enqueue gate reads diffs, not dispatch tiers', mandatedAndSuspect.mandatory && mandatedAndSuspect.suspects.length === 1 && tierLines(mandatedAndSuspect).join('\n').includes('SUSPECT'));
  t('a verdict built without a suspects field still renders (suspicion defaults empty)', tierLines({ mandatory: false, tier: null, hits: [], declared: 1 }).length === 3);

  // ── Test files under the contract surface are EXCEPTED (#19936) ──────────
  //
  // The path limb must read what the review rule reads — non-test contract
  // files — or a test-only spec PR from an off-tier seat can never enqueue.
  // Ruling 5805897677 (letter A) names the pins: a test-only spec diff shows
  // no SUSPECT line, a `*.zod.ts` diff still does, and PR #19932's one file is
  // the lit case. The shapes are the four the ruling lists; the paths are
  // judged by the pure function, so a hypothetical one decides as well as a
  // tracked one does.
  const LIT_TEST_ONLY = 'packages/spec/src/type-alias-convention.pin.test.ts';
  const litTestOnly = fableOf([LIT_TEST_ONLY]);
  const litRendered = tierLines(litTestOnly).join('\n');
  t('⭐ the lit case — a test-only spec diff, PR #19932\'s one file — raises NO suspicion', litTestOnly.suspects.length === 0 && !litTestOnly.mandatory, litTestOnly.suspects);
  t('…renders no SUSPECT line, and still prints the clause-② note, so the silence is not a clearance', !litRendered.includes('SUSPECT') && litRendered.includes('Clause ② is NOT reachable from paths'), litRendered);
  const zodStill = fableOf(['packages/spec/src/ui/view.zod.ts']);
  t('⭐ a *.zod.ts contract schema is STILL a suspect and still renders the SUSPECT line', zodStill.suspects.length === 1 && tierLines(zodStill).join('\n').includes('SUSPECT'));
  for (const [shape, path] of [
    ['a plain *.test.ts', 'packages/spec/src/stack.test.ts'],
    ['a *.pin.test.ts', LIT_TEST_ONLY],
    ['a helper under __tests__/', 'packages/spec/src/data/__tests__/filter-helpers.ts'],
    ['a fixture under a __tests__/ directory', 'packages/spec/src/data/__tests__/fixtures/filter.fixture.json'],
    ['a fixture under a test/ directory', 'packages/spec/src/ui/test/fixtures/view-fixture.ts'],
  ]) {
    t(`${shape} on the contract surface is excepted — no suspicion`, fableOf([path]).suspects.length === 0, path);
  }
  const mixedDiff = fableOf([LIT_TEST_ONLY, 'packages/spec/src/ui/view.zod.ts']);
  t('a MIXED diff keeps its contract file\'s suspicion — the exception is per path, never per diff', mixedDiff.suspects.length === 1 && mixedDiff.suspects[0].path === 'packages/spec/src/ui/view.zod.ts', mixedDiff.suspects);
  t('⛔ a contract domain whose NAME reads test-flavoured is no test: qa/testing.zod.ts stays a suspect', fableOf(['packages/spec/src/qa/testing.zod.ts']).suspects.length === 1);
  t('…while the test file beside it is excepted', fableOf(['packages/spec/src/qa/testing.test.ts']).suspects.length === 0);
  t('an input that CONTAINS the contract surface is still a suspect — the exception narrows files, never the reverse match', fableOf(['packages/spec']).suspects.length === 1);
  t('a mandate is never excepted: a test-named file under a mandated root keeps its mandate', fableOf(['skills/objectstack-data/x.test.ts']).mandatory === true);
  const contractEntry = SUSPECT_TIER_GLOBS.find((g) => g.glob === 'packages/spec/src/**');
  t('the exception is the IMPORTED test-file predicate — the repo\'s own, never a respelling here', contractEntry?.except === isTestPath);
  t('…whose home is a gate script, so a card editing it derives this gate by gate-script identity', isGateScriptPath('scripts/check-undeclared-dep-imports.mjs', gateFamilyFiles()));
  t('every suspect entry that excepts carries a predicate and the reason for it', SUSPECT_TIER_GLOBS.every((g) => g.except === undefined || (typeof g.except === 'function' && typeof g.exceptWhy === 'string' && g.exceptWhy.length > 0)));
  // The subtraction held LIVE, because a subtraction fails silent: the
  // package's files[] ships every `*.zod.ts` under `src/` verbatim, so an
  // exception that dropped one would take a shipped contract off the limb.
  const specSrcTracked = trackedFiles().filter((f) => f.startsWith('packages/spec/src/'));
  const specSrcZod = specSrcTracked.filter((f) => f.endsWith('.zod.ts'));
  const exceptedZod = specSrcZod.filter((f) => fableOf([f]).suspects.length === 0);
  t(`no tracked *.zod.ts on the contract surface is excepted (${specSrcZod.length} read; excepted: ${exceptedZod.join(', ') || 'none'})`, specSrcZod.length > 0 && exceptedZod.length === 0);
  const exceptedTracked = specSrcTracked.filter((f) => fableOf([f]).suspects.length === 0);
  t('the exception is live, not vacuous: it drops tracked test files on this tree, and only what the predicate names', exceptedTracked.length > 0 && exceptedTracked.every((f) => isTestPath(f)), `${exceptedTracked.length} of ${specSrcTracked.length}`);

  // ── The changed-line reading beside the tier verdict (2026-09-18 ruling) ──
  const overLine = changedLineLines({ additions: HUMAN_MERGE_LINE_THRESHOLD, deletions: 1 }).join('\n');
  t('over the threshold, the line names BOTH landings — an authorized APPROVED review or a HUMAN MERGE — the governed terminal and the landing pre-check',
    overLine.includes('HUMAN MERGE') && overLine.includes('authorized APPROVED review (GOVERNED_APPROVERS, on ANY commit)') && !overLine.includes('lands only by') &&
      overLine.includes(`threshold ${HUMAN_MERGE_LINE_THRESHOLD}`) && overLine.includes('arms auto-merge') && overLine.includes('check-governed-merges.mjs --pr'), overLine);
  const atLine = changedLineLines({ additions: HUMAN_MERGE_LINE_THRESHOLD, deletions: 0 }).join('\n');
  t('exactly at the threshold is under it — strictly greater, as the gate reads it', atLine.includes('under.') && !atLine.includes('HUMAN MERGE'), atLine);
  const noneLine = changedLineLines(null).join('\n');
  t('an explicit path list is NOT MEASURED, said out loud, never a silent under', noneLine.includes('NOT MEASURED') && !noneLine.includes('under.') && noneLine.includes('--pr'), noneLine);
  t('the threshold is read from the gate — no second copy here — and it is the ruled 3000', HUMAN_MERGE_LINE_THRESHOLD === 3000 && changedLineLines({ additions: 3001, deletions: 0 }).join('\n').includes('OVER'));
  t('a text buffer counts its lines, an unterminated last line included', lineCountOf(Buffer.from('a\nb\n')) === 2 && lineCountOf(Buffer.from('a\nb')) === 2 && lineCountOf(Buffer.alloc(0)) === 0);
  t('a buffer with a NUL in its first 8000 bytes is binary: null, which the caller counts as zero lines', lineCountOf(Buffer.from([0x61, 0, 0x62])) === null);
  // Same liveness guards as the mandatory table: dead data reading as
  // protection is the incident class itself.
  const deadSuspects = SUSPECT_TIER_GLOBS.filter(
    (g) => !existsSync(nodePath.join(ROOT, g.glob.replace(/\*\*?/g, '').replace(/\/+$/, ''))),
  );
  t(`every declared suspect glob names a path this tree really has (dead: ${deadSuspects.map((g) => g.glob).join(', ') || 'none'})`, deadSuspects.length === 0);
  t('the suspect table is not empty and every entry carries its reason', SUSPECT_TIER_GLOBS.length > 0 && SUSPECT_TIER_GLOBS.every((g) => g.glob && g.why));
  t('the contract-review tier constant is a non-empty model id — the single source the PM skill points at', typeof CONTRACT_REVIEW_TIER === 'string' && CONTRACT_REVIEW_TIER.length > 0);

  // ── The tier constant's ONE-VALUE-SITE promise (#14616) ───────────────────
  //
  // The PM skill promises 「档位单源 … 模型升级只改一行一个文件」, and until this
  // case that promise was held by a `git grep` someone remembers to run. The
  // drift it exists against is measured rather than feared: the value was
  // spelled in SIXTEEN places across these same two roots — prose, mandate
  // rows, header comments, self-test fixtures — while the promise above read
  // as true, and a promise held by hand is what one model refresh erases.
  //
  // What is counted is the constant's OWN VALUE, read from the constant at run
  // time. Never a second literal — that spelling would BE the site the case
  // exists to forbid — and never a family or prefix pattern: a prefix scan
  // would be a family floor the human floor has not granted, and would itself
  // be a second spelling of the model family inside this tool, i.e. the defect
  // recreated by its own guard. One consequence is deliberate: the verbatim
  // maintainer rulings quoted in the skill's main file and in its dispatch
  // runbook name the model FAMILY as prose, not as this value, so an
  // exact-value scan does not reach them — and it must not be widened until it
  // would, because a gate that can demand edits to a maintainer's recorded
  // words is the wrong gate.
  //
  // Both roots are DERIVED, not spelled: the skill tree is the directory of the
  // mandate glob naming its main file, and the tool tree is this module's own
  // directory. The population therefore follows a rename instead of rotting,
  // and no fresh path literal enters this file's own watch-hint set — measured
  // over its own source, 23 hints before this case and 23 after (`maskSelfTests`
  // blanks this body, which is what makes a fixture path here inert at all).
  //
  // The walk takes its base directory as an argument, so the same code can be
  // pointed at a scratch copy of the population to prove it reds; a second
  // spelling anywhere under the roots is reported as `file:line`, never as a
  // bare count a reader cannot act on.
  const tierValueSites = (base, roots, value) => {
    const sites = [];
    const perRoot = [];
    for (const root of roots) {
      // An empty root would join to `base` and walk the whole tree — the one
      // way this case could turn a rename into a pass instead of a red.
      if (!root || root === '.') {
        sites.push('(a scan root derives from a mandate glob that is no longer in the table)');
        perRoot.push(0);
        continue;
      }
      let scanned = 0;
      const stack = [root];
      while (stack.length > 0) {
        const rel = stack.pop();
        const abs = nodePath.join(base, rel);
        if (!existsSync(abs)) {
          sites.push(`${rel} (MISSING)`);
          continue;
        }
        if (statSync(abs).isDirectory()) {
          for (const name of readdirSync(abs)) stack.push(nodePath.join(rel, name));
          continue;
        }
        scanned += 1;
        readFileSync(abs, 'utf8')
          .split('\n')
          .forEach((text, i) => {
            for (let at = text.indexOf(value); at >= 0; at = text.indexOf(value, at + value.length)) {
              sites.push(`${rel}:${i + 1}`);
            }
          });
      }
      perRoot.push(scanned);
    }
    return { sites, perRoot };
  };
  // The repo-relative spelling here comes from ROOT, the prefix every sibling
  // case in this block already joins against — the consistent spelling, not a
  // workaround. A prefix that stops holding yields an empty root, which the
  // walk above reports rather than turning into a pass.
  const tierOwnAbs = fileURLToPath(ENGINE_URL);
  const tierOwnRel = tierOwnAbs.startsWith(ROOT) ? tierOwnAbs.slice(ROOT.length) : '';
  // The definition line is FOUND, not remembered: the one line carrying both
  // the constant's name and its value. A line number in a case name that has
  // to be maintained by hand is the same species of promise as the one this
  // case replaces.
  const tierDefLine =
    readFileSync(new URL(ENGINE_URL), 'utf8')
      .split('\n')
      .findIndex((l) => l.includes('CONTRACT_REVIEW_TIER') && l.includes(CONTRACT_REVIEW_TIER)) + 1;
  const tierRoots = [
    nodePath.dirname(MANDATORY_TIER_GLOBS.find((g) => g.glob === '.claude/skills/pm-dispatch/SKILL.md')?.glob ?? ''),
    nodePath.dirname(tierOwnRel),
  ];
  const tierScan = tierValueSites(ROOT, tierRoots, CONTRACT_REVIEW_TIER);
  t(
    `the tier constant's VALUE is spelled in exactly ONE site under ${tierRoots.join(' + ')} — ` +
      `${tierScan.perRoot.join('+')} files read, the definition at ${tierOwnRel}:${tierDefLine} the only one allowed ` +
      `(found: ${tierScan.sites.join(', ') || 'NOTHING — this scan reached no occurrence at all'})`,
    tierDefLine > 0 &&
      tierScan.perRoot.every((n) => n > 0) &&
      tierScan.sites.length === 1 &&
      tierScan.sites[0] === `${tierOwnRel}:${tierDefLine}`,
  );

  slow("the change set derived from git — temporary repositories with real history", () => {
  // ── The change set derived from git (#9320) ───────────────────────────────
  //
  // These build a real repository and run the real derivation over it. A
  // fixture cannot stand in: the whole claim is about what a git RANGE means
  // when history moved underneath a branch, and that is a property of git, not
  // of a string this file could parse. Each scenario is built once and the
  // cases read from it, so the git cost is three small repos, not one per case.
  //
  // The control case is the load-bearing one. Asserting only that the sibling's
  // file is absent from the derived set would pass just as happily against a
  // fixture that never reproduced the incident — so the same tree is diffed the
  // WRONG way in the same breath, and the sibling has to show up there.
  const gitTmp = mkdtempSync(nodePath.join(tmpdir(), 'dispatch-gates-git-'));
  try {
    const g = (args, cwd) => {
      const r = spawnSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
        cwd,
        encoding: 'utf8',
      });
      if (r.status !== 0) throw new Error(`fixture git ${args.join(' ')} failed: ${r.stderr}`);
      return (r.stdout ?? '').trim();
    };
    const write = (repo, rel, text) => {
      mkdirSync(nodePath.dirname(nodePath.join(repo, rel)), { recursive: true });
      writeFileSync(nodePath.join(repo, rel), text);
    };
    const commit = (repo, rel, msg) => {
      write(repo, rel, `${msg}\n`);
      g(['add', '-A'], repo);
      g(['commit', '-m', msg], repo);
    };

    // Scenario: branch cut, THEN a sibling PR lands on the base branch.
    const up = nodePath.join(gitTmp, 'up');
    mkdirSync(up, { recursive: true });
    g(['init', '--initial-branch=main', '.'], up);
    commit(up, 'packages/spec/base.ts', 'root');
    commit(up, 'packages/spec/branch-point.ts', 'branch point');
    g(['checkout', '-b', 'feature'], up);
    commit(up, 'packages/objectql/mine.ts', 'my own work');
    g(['checkout', 'main'], up);
    commit(up, 'packages/runtime/sibling-landed.ts', 'a sibling PR lands after the cut');
    const mainSha = g(['rev-parse', 'main'], up);
    g(['checkout', 'feature'], up);
    // A local ref named like the remote-tracking one, so the derivation runs
    // against the exact ref name it uses in anger without needing a network.
    g(['update-ref', 'refs/remotes/origin/main', mainSha], up);

    const derived = changedPathsFromGit({ cwd: up });
    const twoDot = g(['diff', '--name-only', 'origin/main..HEAD'], up).split('\n').filter(Boolean);

    t(
      'the CONTROL reproduces the incident: the two-dot range really does claim the sibling PR file',
      twoDot.includes('packages/runtime/sibling-landed.ts'),
    );
    t(
      'the derived change set names this branch own commit',
      derived.paths.includes('packages/objectql/mine.ts'),
    );
    t(
      'the derived change set drops the sibling file the two-dot range attributed to us',
      !derived.paths.includes('packages/runtime/sibling-landed.ts'),
    );
    t('the derived set reports the merge base it measured from', /^[0-9a-f]{40}$/.test(derived.mergeBase));
    // The changed-line count (2026-09-18 human-merge threshold) rides the same
    // merge base: the sibling's landed line is not ours either.
    t('the derived set carries the changed-line count off the same merge base: +1 / -0 for this branch own committed line',
      derived.size.additions === 1 && derived.size.deletions === 0 && derived.size.untrackedFiles === 0 && derived.size.binaryFiles === 0, derived.size);

    // Uncommitted and untracked work counts: a dev re-deriving before the
    // commit must not be handed a SHORT list.
    write(up, 'packages/spec/base.ts', 'edited, not committed\n');
    write(up, 'packages/ddd/brand-new.ts', 'never added\n');
    const withDirty = changedPathsFromGit({ cwd: up });
    t('an uncommitted edit to a tracked file joins the change set', withDirty.paths.includes('packages/spec/base.ts'));
    t('an untracked new file joins the change set', withDirty.paths.includes('packages/ddd/brand-new.ts'));
    t('the sibling file stays out once the tree is dirty too', !withDirty.paths.includes('packages/runtime/sibling-landed.ts'));
    t('an uncommitted edit and an untracked file join the changed-line count too: +3 / -1, one untracked file counted from disk',
      withDirty.size.additions === 3 && withDirty.size.deletions === 1 && withDirty.size.untrackedFiles === 1, withDirty.size);
    write(up, 'packages/ddd/blob.bin', Buffer.from([0, 1, 2, 0]));
    const withBinary = changedPathsFromGit({ cwd: up });
    t('an untracked BINARY file is a file and zero lines, as GitHub counts it',
      withBinary.size.binaryFiles === 1 && withBinary.size.additions === 3 && withBinary.size.untrackedFiles === 2 && withBinary.size.files === 4, withBinary.size);
    t('and the provenance names the count, the threshold and the verdict beside the path list',
      derivationProvenance(withBinary).some((l) => l.includes('changed lines: 4 (+3 / -1') && l.includes(`threshold ${HUMAN_MERGE_LINE_THRESHOLD}: under`)), derivationProvenance(withBinary));

    // A branch that changes nothing derives an EMPTY set rather than the
    // base branch history — the CLI turns that into a refusal, not "no gates".
    const onBase = nodePath.join(gitTmp, 'on-base');
    mkdirSync(onBase, { recursive: true });
    g(['init', '--initial-branch=main', '.'], onBase);
    commit(onBase, 'packages/spec/only.ts', 'root');
    g(['update-ref', 'refs/remotes/origin/main', g(['rev-parse', 'main'], onBase)], onBase);
    t('a branch level with its base derives nothing at all', changedPathsFromGit({ cwd: onBase }).paths.length === 0);

    // The shallow boundary. Measured, not assumed: with the true base below the
    // graft, merge-base exits 1 EMPTY and the three-dot diff exits 128, while
    // the two-dot form exits 0 with the inflated list. So the derivation must
    // refuse — and must not quietly become the two-dot form it replaced.
    const shallow = nodePath.join(gitTmp, 'shallow');
    spawnSync('git', ['clone', '--quiet', '--no-single-branch', '--depth', '1', `file://${up}`, shallow], { encoding: 'utf8' });
    let shallowErr = null;
    if (existsSync(nodePath.join(shallow, '.git'))) {
      g(['checkout', '-B', 'feature', 'origin/feature'], shallow);
      t('the shallow fixture really is a shallow checkout', g(['rev-parse', '--is-shallow-repository'], shallow) === 'true');
      try {
        changedPathsFromGit({ cwd: shallow });
      } catch (err) {
        shallowErr = err;
      }
      t('a shallow checkout with no reachable merge base REFUSES instead of answering', shallowErr !== null);
      t(
        'and the refusal names the shallow cause and the deepen remedy',
        !!shallowErr && /SHALLOW/.test(shallowErr.message) && /unshallow|deepen/.test(shallowErr.message),
      );
      t(
        'and it says why it will not fall back to the two-dot range',
        !!shallowErr && /two-dot/.test(shallowErr.message),
      );
    }

    // An unresolvable base ref is the other input failure, and it must be told
    // apart from "no merge base" — the remedies are different commands.
    let missingBaseErr = null;
    try {
      changedPathsFromGit({ cwd: up, base: 'refs/remotes/origin/no-such-branch' });
    } catch (err) {
      missingBaseErr = err;
    }
    t('an unresolvable base ref is refused on its own terms', !!missingBaseErr && /does not resolve/.test(missingBaseErr.message));

    // ── A leftover in-tree test fixture must not reach the change set (#12632)
    //
    // The derivation reads untracked files on purpose, so `.gitignore` is the
    // only thing standing between a killed test run's leftover fixture and
    // every seat's gate list. `packages/cli` creates four fixtures inside the
    // tracked tree; the one that used to root in `packages/cli/test/` needed an
    // ignore entry written for it alone, and now roots at `packages/cli/tmp/`
    // with the other three, under the repo-wide `tmp/` rule.
    //
    // The CONTROL is the load-bearing half and it runs the SAME derivation on
    // the SAME repo: asserting only that the covered path is absent would pass
    // just as happily against a `.gitignore` that ignores the whole tree, or
    // against a fixture that never planted anything. So an UNCOVERED in-tree
    // path is planted alongside it and has to come back VISIBLE, and it has to
    // come back carrying gate families — a leftover that reached the change set
    // is not inert. Measured on the tree at the time of writing: a two-file
    // leftover (the `package.json` and `objectstack.config.ts` that fixture
    // writes) named 20 families the branch's own diff does not implicate.
    // The count is not asserted — the family inventory grows same-day, which is
    // this whole tool's premise — only that it is non-empty.
    //
    // The uncovered path is deliberately the fixture's FORMER root, so this
    // control also fails if the bespoke ignore entry is ever restored: a rule
    // covering a root nothing uses would make the control silently green and
    // take the pin with it.
    //
    // The repo's REAL `.gitignore` is copied in rather than an excerpt written
    // here: an excerpt would pin the excerpt.
    const ignoreRepo = nodePath.join(gitTmp, 'ignore-coverage');
    mkdirSync(ignoreRepo, { recursive: true });
    g(['init', '--initial-branch=main', '.'], ignoreRepo);
    write(ignoreRepo, '.gitignore', readFileSync(nodePath.join(ROOT, '.gitignore'), 'utf8'));
    g(['add', '-A'], ignoreRepo);
    g(['commit', '-m', 'the real ignore rules'], ignoreRepo);
    g(['update-ref', 'refs/remotes/origin/main', g(['rev-parse', 'main'], ignoreRepo)], ignoreRepo);

    const leftoverAtCoveredRoot = 'packages/cli/tmp/tmp-node-env-default-selftest/objectstack.config.ts';
    const leftoverAtUncoveredRoot = 'packages/cli/test/tmp-node-env-default-selftest/objectstack.config.ts';
    for (const rel of [leftoverAtCoveredRoot, leftoverAtUncoveredRoot]) {
      write(ignoreRepo, rel, "import { AuthPlugin } from '@objectstack/plugin-auth';\n");
      write(ignoreRepo, nodePath.join(nodePath.dirname(rel), 'package.json'), '{ "private": true, "type": "module" }\n');
    }
    const leftovers = changedPathsFromGit({ cwd: ignoreRepo });

    t(
      'the CONTROL reproduces the hazard: a leftover fixture at an UNCOVERED in-tree root does reach the change set',
      leftovers.paths.includes(leftoverAtUncoveredRoot),
    );
    t(
      'and reaching it is not free — the uncovered leftover names gate families of its own',
      [...discoverFamilies().byCheck.values()].some((e) => classifyEntry(e, [leftoverAtUncoveredRoot]).verdict === 'matched'),
    );
    t(
      'a leftover fixture at packages/cli/tmp/ is invisible to the derivation, under the same rules in the same repo',
      !leftovers.paths.includes(leftoverAtCoveredRoot),
    );
    t(
      'and it is the repo-wide tmp/ rule doing it, with no bespoke entry for the fixture former root',
      !readFileSync(nodePath.join(ROOT, '.gitignore'), 'utf8').includes('packages/cli/test/tmp-node-env-default'),
    );
    // ── The CLASS the pin above does not hold (#12749) ──────────────────────
    //
    // Everything above names TWO paths. A fifth fixture author who creates a
    // directory in the tracked tree at a root the ignore rules do not cover
    // reproduces the hazard exactly, and every case above stays green — not one
    // of them ever looks at their file. The cases below hold the class: the
    // tree's own sources are swept for the directories they create, and each is
    // asked about against the repo's REAL ignore rules.
    //
    // ⛔ No count is asserted below. The same hazard has three recorded readings
    // (17 / 18 / 20 families) because the family inventory grows same-day, and a
    // guard pinning a number reds on an unrelated Tuesday. What IS asserted is
    // NON-EMPTINESS: a sweep that found nothing satisfies "every root is
    // covered" perfectly, and would take the whole class-level guard with it.

    // The reader, on sources containing nothing else — hermetic, so a failure
    // here is the reader and not the tree.
    const seededFixtureSource = [
      'const HERE = path.dirname(fileURLToPath(import.meta.url));',
      "const SCRATCH = path.resolve(HERE, '../scratch');",
      'fs.mkdirSync(SCRATCH, { recursive: true });',
      "const dir = fs.mkdtempSync(path.join(SCRATCH, 'case-'));",
    ].join('\n');
    const seededScan = scratchDirSitesInSource('packages/thing/test/a.test.ts', seededFixtureSource);
    t(
      'the scan reads an in-tree fixture root through the binding that seeds it',
      seededScan.inTree.some((s) => s.call === 'mkdirSync' && s.dir === 'packages/thing/scratch'),
    );
    t(
      'and reads the mkdtemp child as a directory of its own, not as its base',
      seededScan.inTree.some((s) => s.call === 'mkdtempSync' && s.dir.startsWith('packages/thing/scratch/case-')),
    );
    t('nothing in that source is left unclassified', seededScan.unresolved.length === 0);

    const systemTempSource = [
      "const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'case-'));",
      "fs.mkdirSync(path.join(scratchDir, 'nested'), { recursive: true });",
    ].join('\n');
    const systemScan = scratchDirSitesInSource('packages/thing/test/b.test.ts', systemTempSource);
    t(
      'a fixture in the system temp directory is no in-tree root, and is not unresolved either',
      systemScan.inTree.length === 0 && systemScan.unresolved.length === 0,
    );

    // The third answer, and the reason silence from this scan can be read at
    // all: a base it cannot resolve is REPORTED. A detector that dropped what
    // it could not read would be this card's own defect one level up — green
    // over the sites nobody measured.
    const opaqueScan = scratchDirSitesInSource(
      'packages/thing/test/c.test.ts',
      "const dir = fs.mkdtempSync(path.join(rootFromSomewhereElse, 'case-'));",
    );
    t(
      'a base the scan cannot read comes back UNRESOLVED, never silently skipped',
      opaqueScan.inTree.length === 0 && opaqueScan.unresolved.length === 1,
    );
    t(
      'and a commented-out call is not a site at all',
      scratchDirSitesInSource('packages/thing/test/d.test.ts', "// fs.mkdtempSync(path.join(HERE, 'case-'));\n").scanned === 0,
    );
    t(
      'nor is one spelled inside a string — which is what this very self-test plants',
      scratchDirSitesInSource('packages/thing/test/e.test.ts', 'const src = "fs.mkdtempSync(join(HERE, x))";\n').scanned === 0,
    );

    // The CONTROL for the whole verdict, on a repo carrying the REAL ignore file
    // — an excerpt would pin the excerpt. Two fixture sources are planted, one
    // at a covered root and one at an uncovered one, and the uncovered one has
    // to come back EXPOSED. Without this arm every live-tree case below passes
    // just as happily against a verdict function that returns an empty list.
    const classRepo = nodePath.join(gitTmp, 'fixture-root-class');
    mkdirSync(classRepo, { recursive: true });
    g(['init', '--initial-branch=main', '.'], classRepo);
    const realIgnoreRules = readFileSync(nodePath.join(ROOT, '.gitignore'), 'utf8');
    write(classRepo, '.gitignore', realIgnoreRules);
    const fixtureSourceRootedAt = (rel) =>
      [
        'const HERE = path.dirname(fileURLToPath(import.meta.url));',
        `const SCRATCH = path.resolve(HERE, '${rel}');`,
        'fs.mkdirSync(SCRATCH, { recursive: true });',
        "const dir = fs.mkdtempSync(path.join(SCRATCH, 'case-'));",
      ].join('\n');
    write(classRepo, 'packages/cli/test/covered.test.ts', fixtureSourceRootedAt('../tmp'));
    write(classRepo, 'packages/cli/test/uncovered.test.ts', fixtureSourceRootedAt('../scratch-fixtures'));
    g(['add', '-A'], classRepo);
    g(['commit', '-m', 'two fixture sources under the real ignore rules'], classRepo);

    const uncoveredInControl = (r) => r.exposed.some((s) => s.dir.startsWith('packages/cli/scratch-fixtures'));
    const classControl = exposedScratchDirs({ cwd: classRepo });
    t(
      'the CONTROL reproduces the hazard at CLASS level: a fixture root no ignore rule covers is EXPOSED',
      uncoveredInControl(classControl),
    );
    t(
      'and the covered root beside it is not, under the same rules in the same repo',
      !classControl.exposed.some((s) => s.dir.startsWith('packages/cli/tmp'))
        && classControl.covered.some((s) => s.dir.startsWith('packages/cli/tmp')),
    );

    // A rule in `.git/info/exclude` covers the clone it lives in and nothing
    // else, so it is not coverage: the leftover still joins the change set on
    // every other machine, CI included. `git check-ignore` answers the same
    // either way, which is exactly why the SOURCE of the rule is read.
    write(classRepo, '.git/info/exclude', 'scratch-fixtures/\n');
    t(
      'a rule living only in .git/info/exclude is not coverage — the root stays EXPOSED',
      uncoveredInControl(exposedScratchDirs({ cwd: classRepo })),
    );

    // ... and the same instrument clears it once a TRACKED rule covers it, so
    // what the live cases below read is a reading and not a constant.
    write(classRepo, '.git/info/exclude', '');
    write(classRepo, '.gitignore', `${realIgnoreRules}\nscratch-fixtures/\n`);
    g(['add', '-A'], classRepo);
    g(['commit', '-m', 'cover the new root in the tracked ignore file'], classRepo);
    t(
      'a TRACKED rule covering it clears it, so the verdict moves in both directions',
      exposedScratchDirs({ cwd: classRepo }).exposed.length === 0,
    );

    // The live tree — the half a fifth fixture author's PR reds on.
    const liveScratch = exposedScratchDirs({});
    t(
      `the sweep really read this tree (${liveScratch.sites} directory-creating site(s) across ${liveScratch.scannedFiles} tracked source(s))`,
      liveScratch.sites > 0,
    );
    t(
      `and it really found in-tree fixture roots (${liveScratch.inTree.length}), so the coverage case below judges something`,
      liveScratch.inTree.length > 0,
    );
    t(
      `every in-tree directory this tree's sources create is covered by a tracked ignore rule, or is tracked itself${
        liveScratch.exposed.length
          ? ` — EXPOSED: ${liveScratch.exposed.map((s) => `${s.dir} (${s.file}:${s.line})`).join(', ')}`
          : ''
      }`,
      liveScratch.exposed.length === 0,
    );
    const unreadableTempSites = liveScratch.unresolved.filter((s) => s.call === 'mkdtempSync');
    t(
      `no mkdtempSync site in this tree takes a base the scan cannot read${
        unreadableTempSites.length
          ? ` — UNRESOLVED: ${unreadableTempSites.map((s) => `${s.file}:${s.line} (${s.why})`).join(', ')}`
          : ''
      }`,
      unreadableTempSites.length === 0,
    );
  } finally {
    rmSync(gitTmp, { recursive: true, force: true });
  }
  });

  // ── Whose repo the answer is about — the cross-repo guard ─────────────────
  //
  // The defect this pins is an answer that was RIGHT about the wrong tree, so
  // both directions have to be measured on the real CLI, not reasoned about:
  // a matching assertion must leave the answer byte-identical (otherwise the
  // guard taxes every correct dispatch), and a mismatching one must end the run
  // (otherwise it is the warning that was already measured as ignorable).
  t('a remote in URL form yields its owner and name', parseRepoSlug('https://github.com/an-owner/a-repo.git') === 'an-owner/a-repo');
  t('and in the SCP-like form git also writes', parseRepoSlug('git@github.com:an-owner/a-repo.git') === 'an-owner/a-repo');
  t('a suffixless URL with a trailing slash reads the same', parseRepoSlug('https://github.com/an-owner/a-repo/') === 'an-owner/a-repo');
  t('a remote that does not end in two name segments is UNKNOWN, never a guess', parseRepoSlug('some-bare-word') === null && parseRepoSlug('') === null);

  const splitWithValue = splitArgv([REPO_FLAG, 'an-owner/a-repo', 'packages/spec/src/index.ts', '--residue']);
  t('the assertion value never falls through into the path list', splitWithValue.paths.length === 1 && splitWithValue.paths[0] === 'packages/spec/src/index.ts');
  t('and the assertion and the other flags both survive the split', splitWithValue.assertion === 'an-owner/a-repo' && splitWithValue.flags.includes('--residue'));
  t('the joined spelling parses to the same thing', splitArgv([`${REPO_FLAG}=an-owner/a-repo`]).assertion === 'an-owner/a-repo');
  t('a valueless assertion is malformed, not silently dropped', !!splitArgv([REPO_FLAG]).malformed && !!splitArgv([REPO_FLAG, '--tier']).malformed);
  t('no assertion passed stays null, so the unasserted run is untouched', splitArgv(['packages/spec/src/index.ts']).assertion === null);

  const hereIdentity = { root: '/tmp/x', head: 'abc1234', remote: 'r', slug: 'an-owner/a-repo' };
  t('an assertion this checkout satisfies passes', repoAssertionVerdict({ asserted: 'an-owner/a-repo', identity: hereIdentity }).ok);
  t('and it passes case-insensitively, as repo slugs compare', repoAssertionVerdict({ asserted: 'An-Owner/A-Repo', identity: hereIdentity }).ok);
  const mismatch = repoAssertionVerdict({ asserted: 'other-owner/other-repo', identity: hereIdentity });
  t('an assertion this checkout contradicts is REFUSED', !mismatch.ok);
  const mismatchText = mismatch.lines.join('\n');
  t('and the refusal names BOTH repos — the defect was an answer that named neither', mismatchText.includes('other-owner/other-repo') && mismatchText.includes('an-owner/a-repo'));
  t('the refusal says repo-relative paths cannot tell the two apart', mismatchText.includes('Repo-relative paths cannot tell the two apart'));
  t('and it sends the reader to a checkout of the repo they asked about', mismatchText.includes('hand-derived'));
  const unverifiable = repoAssertionVerdict({ asserted: 'an-owner/a-repo', identity: { root: '/tmp/x', head: null, remote: null, slug: null } });
  t('an assertion that cannot be VERIFIED refuses too — an unverifiable pass is worth less than none', !unverifiable.ok && unverifiable.lines.join('\n').includes('UNKNOWN'));
  const retargetAttempt = repoAssertionVerdict({ asserted: '../a-sister-checkout', identity: hereIdentity });
  t('a value shaped like a checkout PATH is refused, so the retarget misreading fails loudly', !retargetAttempt.ok && retargetAttempt.lines.join('\n').includes('does not point the derivation at another checkout'));
  t('and so is a three-segment value', !repoAssertionVerdict({ asserted: 'a/b/c', identity: hereIdentity }).ok);
  const sisterMismatch = repoAssertionVerdict({ asserted: GOVERNED_REPOS.find((r) => r.id !== SELF_REPO_ID).slug, identity: hereIdentity });
  t('a governed SISTER\'s refusal points at the tier route — the one question a sister slug can be answered from here', !sisterMismatch.ok && sisterMismatch.lines.join('\n').includes(`--tier ${REPO_FLAG}`) && sisterMismatch.lines.join('\n').includes('hand-derived'));
  t('…and an UNKNOWN repo\'s refusal does not — it is not a sister the register knows', !mismatchText.includes('TIER half'));

  const bannerHit = bannerLines({ identity: hereIdentity, paths: [] });
  t('the banner names the repo and the commit the answer came from', bannerHit[0].includes('an-owner/a-repo') && bannerHit[0].includes('abc1234'));
  t('and it points at the assertion flag, so the tell is actionable', bannerHit.join('\n').includes(REPO_FLAG));
  t('an unreadable remote reads as UNVERIFIED in the banner, never as a repo name', bannerLines({ identity: { root: '/tmp/x', head: null, remote: null, slug: null }, paths: [] }).join('\n').includes('UNVERIFIED'));
  const bannerAbsent = bannerLines({ identity: { ...hereIdentity, root: ROOT }, paths: ['packages/spec/src/index.ts', 'packages/this-repo-has-no-such-package/src/index.ts'] });
  t('paths absent from this tree are counted and named', bannerAbsent.join('\n').includes('1 of 2 path(s) are absent'));
  t('and the count claims nothing in either direction', bannerAbsent.join('\n').includes('Not evidence either way'));
  const bannerPresent = bannerLines({ identity: { ...hereIdentity, root: ROOT }, paths: ['packages/spec/src/index.ts'] });
  t('all paths present prints NO clearance line — absence and clearance must not share a spelling', !bannerPresent.join('\n').includes('absent from this tree') && bannerPresent.length === 2);

  // ── An absent path with no assertion is NOT MEASURED ──────────────────────
  //
  // The banner above COUNTS absent paths and claims nothing; these pin that the
  // count now ends the run when nothing says whose tree the paths are from. The
  // pure half here, the three shapes end-to-end on the real CLI further down —
  // the defect was an EXIT CODE that read as an answer, and only a child
  // process measures one.
  const localIdentity = { ...hereIdentity, root: ROOT };
  const ABSENT = 'packages/this-repo-has-no-such-package/src/index.ts';
  const PRESENT = 'packages/spec/src/index.ts';
  t(
    'the absent set and the banner\'s count are ONE reading, so a refusal can never name a path the banner did not',
    absentDeclaredPaths({ identity: localIdentity, paths: [PRESENT, ABSENT] }).join() === ABSENT
      && bannerLines({ identity: localIdentity, paths: [PRESENT, ABSENT] }).join('\n').includes(ABSENT),
  );
  t(
    'a glob is a PATTERN, not an absent file — counting one would refuse every wildcard dispatch',
    absentDeclaredPaths({ identity: localIdentity, paths: ['packages/*/src/index.ts'] }).length === 0,
  );
  const unassertedAbsent = absentPathVerdict({ asserted: null, identity: localIdentity, paths: [PRESENT, ABSENT] });
  t('⭐ an absent path with no assertion REFUSES — the measured defect answered 0 here', !unassertedAbsent.ok);
  const unassertedText = unassertedAbsent.lines.join('\n');
  t('and it names the absent path, never just a count', unassertedText.includes(ABSENT) && unassertedAbsent.missing.join() === ABSENT);
  t('and it says NOT MEASURED in those words, so the exit code is not the only tell', unassertedText.includes('NOT MEASURED'));
  t(
    'and it carries BOTH resolving spellings, so the remedy is a copy rather than a deduction',
    unassertedText.includes(`${REPO_FLAG} ${hereIdentity.slug}`) && unassertedText.includes(`${REPO_FLAG} owner/the-other-repo`),
  );
  t(
    'CONTROL: all paths present is not a refusal — this guard must not tax an ordinary dispatch',
    absentPathVerdict({ asserted: null, identity: localIdentity, paths: [PRESENT] }).ok,
  );
  t(
    'CONTROL: an assertion present hands the run to the wrong-repo refusal instead — this branch is unreached',
    absentPathVerdict({ asserted: 'an-owner/a-repo', identity: localIdentity, paths: [ABSENT] }).ok
      && absentPathVerdict({ asserted: 'other-owner/other-repo', identity: localIdentity, paths: [ABSENT] }).ok,
  );
  t(
    'with the remote unreadable the refusal says the assertion cannot be CHECKED either, rather than printing a slug it does not have',
    absentPathVerdict({ asserted: null, identity: { root: ROOT, head: null, remote: null, slug: null }, paths: [ABSENT] })
      .lines.join('\n').includes('UNVERIFIABLE'),
  );

  slow("base drift — temporary repositories and spawned children", () => {
  // ── Base drift (#11540) ───────────────────────────────────────────────────
  // The banner names the commit an answer came from; on a stale checkout that
  // reads as ordinary provenance. These pin the loudness, and pin that the
  // quiet cases stay quiet — a warning on every honest run is a warning nobody
  // reads.
  // Unmeasured is not silence (#12411). These pin the ARRIVAL — the sentence a
  // reader actually gets — not merely that the old silence is gone: a pin
  // asserting "the output is not empty" passes against any garbage. The
  // previous assertion here read "no measurable base ref prints nothing rather
  // than guessing" and was green on the defect itself, which is what a
  // departure pin buys you.
  const level = driftLines({ base: 'aaaaaaa', behind: 0, changed: [] });
  const unmeasured = driftLines({ base: null, behind: null, changed: [], headDate: null, baseDate: null });
  const unmeasuredText = unmeasured.join('\n');
  t('an unresolvable base ref SAYS staleness was not measured, and names the ref it could not resolve',
    unmeasuredText.includes('STALENESS NOT MEASURED') && unmeasuredText.includes(DEFAULT_BASE_REF));
  t('and it spells the reading UNKNOWN, so the reader cannot land on zero by default',
    unmeasuredText.includes('UNKNOWN') && unmeasuredText.includes('Not zero'));
  t('it hands over the one action that would produce a reading',
    unmeasuredText.includes(`git fetch ${DEFAULT_BASE_REMOTE} ${DEFAULT_BASE_BRANCH}`));
  t('and it does NOT cry stale — a tree nobody measured is not a tree measured stale',
    !unmeasuredText.includes('STALE TREE'));
  t('a tree level with the base prints NO clearance — the failure would have passed one', level.length === 0);
  t('so the two readings no longer share one output — the defect, stated as the comparison that used to hold',
    unmeasuredText !== level.join('\n'));
  t('and a drift of null — no measurement ATTACHED, the caller never asked — still prints nothing', driftLines(null).length === 0);
  // The SECOND door to "no reading was taken" (#12815). The base ref resolves
  // and the DISTANCE is what could not be read, so this reached `!drift.behind`
  // carrying `behind: null` and printed nothing — byte-identical to the level
  // tree above, the same collapse as the case above it, one step further along.
  // These pin the arrival, and pin that ONE predicate serving both doors did
  // not flatten them into one sentence: the remedies do not overlap, so a
  // reader handed the other door's remedy is handed a lead they cannot act on.
  const uncounted = driftLines({ base: 'aaaaaaa', behind: null, changed: [], headDate: null, baseDate: null });
  const uncountedText = uncounted.join('\n');
  t('a base ref that RESOLVES but yields no distance also SAYS staleness was not measured',
    uncountedText.includes('STALENESS NOT MEASURED') && uncountedText.includes('UNKNOWN') && uncountedText.includes('Not zero'));
  t('and it names the base it DID resolve, so a reader can tell WHICH step failed', uncountedText.includes('aaaaaaa'));
  t('its remedy is the count, not the fetch — a fetch buys a base ref and buys nothing for a HEAD with no commit',
    uncountedText.includes(`git rev-list --count HEAD..${DEFAULT_BASE_REF}`)
      && !uncountedText.includes(`git fetch ${DEFAULT_BASE_REMOTE} ${DEFAULT_BASE_BRANCH}`));
  // The two assertions below carry a length conjunct on purpose. Both are
  // otherwise satisfied by the DEFECT — an empty list contains no 'STALE TREE'
  // and differs from state A's sentence — which is the species #12411 deleted
  // here: instrument intact, aimed at nothing. Measured under ablation: without
  // the conjunct they stay green with the fix reverted.
  t('and it does NOT cry stale either — a tree nobody counted is not a tree counted stale',
    uncounted.length === 2 && !uncountedText.includes('STALE TREE'));
  t('so this reading no longer shares one output with the level tree — the defect, stated as the comparison that used to hold',
    uncountedText !== level.join('\n'));
  t('and the two unmeasured doors are told apart rather than flattened by the shared predicate',
    uncounted.length === 2 && unmeasured.length === 2 && uncountedText !== unmeasuredText);
  t('a drift carrying no distance FIELD at all reads unmeasured too — absent is not a reading either',
    driftLines({ base: 'aaaaaaa', changed: [] }).join('\n').includes('STALENESS NOT MEASURED'));
  const benign = driftLines({ base: 'aaaaaaa', behind: 7, changed: [], headDate: '2026-01-01T00:00:00Z', baseDate: '2026-01-02T00:00:00Z' });
  const benignText = benign.join('\n');
  t('behind with the VISIBLE surface untouched states the distance, and scopes the claim to what the tree can see',
    benign.length === 2 && benign[0].includes('7 commit(s) behind') && benign[0].includes('can SEE'));
  t('and it states the unseen half as untellable instead of clear — the sentence a reader may safely comply with',
    benignText.includes('cannot tell') && benignText.includes('LOCAL snapshot'));
  // The departure pin for the measured false reassurance (#13392). The old
  // spelling asserted "nothing this answer derives from changed across that
  // range" from a reading whose range ends at the last fetch; a dev complied
  // with it and CI reddened on a family that landed upstream inside the gap
  // the sentence had vouched empty. The length-and-content conjunct is what
  // keeps this from passing vacuously — an empty render also contains no
  // reassurance, and that species of green pin is the one this block already
  // buried once.
  t('the reassurance spelling is GONE — no quiet line asserts that nothing this answer derives from changed',
    benign.length === 2 && benign[0].includes('none of the commit(s)') && !benignText.includes('nothing this answer derives from changed'));
  t('it hands over the fetch, the one action that strengthens the reading', benignText.includes(`git fetch ${DEFAULT_BASE_REMOTE} ${DEFAULT_BASE_BRANCH}`));
  t('and the quiet spelling still does not cry stale, so the loud spelling stays rare', !benignText.includes('STALE TREE'));
  // The THIRD unmeasured door (#13392): distance reads, changed set does not.
  // Under the old shape this state collapsed into `changed: []` and rendered
  // as the quiet clear sentence — a reassurance manufactured from a FAILED
  // read, the least earned of all.
  const unreadSet = driftLines({ base: 'aaaaaaa', behind: 7, changed: null, headDate: '2026-01-01T00:00:00Z', baseDate: '2026-01-02T00:00:00Z' });
  const unreadSetText = unreadSet.join('\n');
  t('a distance that READS beside a changed set that does NOT refuses as a third unmeasured door, never as quiet',
    unreadSet.length === 2 && unreadSetText.includes('STALENESS NOT MEASURED') && unreadSetText.includes('Not empty'));
  t('it names the base it resolved AND the distance it counted, so a reader can tell WHICH step failed this time',
    unreadSetText.includes('aaaaaaa') && unreadSetText.includes('7 commit(s)'));
  t('its remedy is the diff — not the fetch, not the count',
    unreadSetText.includes(`git diff --name-only HEAD...${DEFAULT_BASE_REF}`)
      && !unreadSetText.includes(`git fetch ${DEFAULT_BASE_REMOTE} ${DEFAULT_BASE_BRANCH}`)
      && !unreadSetText.includes('git rev-list --count'));
  t('and it neither reassures nor cries stale — no reading, no claim in either direction',
    unreadSet.length === 2 && !unreadSetText.includes('can SEE') && !unreadSetText.includes('STALE TREE'));
  t('so the three unmeasured doors are told apart rather than flattened by the shared predicate',
    new Set([unmeasuredText, uncountedText, unreadSetText]).size === 3);
  t('a drift carrying no changed FIELD at all reads unmeasured too — absent is not a reading either',
    driftLines({ base: 'aaaaaaa', behind: 7 }).join('\n').includes('STALENESS NOT MEASURED'));
  const loud = driftLines({ base: 'aaaaaaa', behind: 120, changed: ['scripts/pm/dispatch-gates.mjs', '.github/workflows/lint.yml'], headDate: '2026-01-01T00:00:00Z', baseDate: '2026-01-08T00:00:00Z' });
  const loudText = loud.join('\n');
  t('a changed derivation surface is LOUD, and names what it compared', loudText.includes('STALE TREE') && loudText.includes('HEAD') && loudText.includes(DEFAULT_BASE_REF) && loudText.includes('120 commit(s)'));
  t('it names the stale files themselves, not just a count', loudText.includes('scripts/pm/dispatch-gates.mjs') && loudText.includes('.github/workflows/lint.yml'));
  t('it says the exit code is no defence — the measured failure exited 0', loudText.includes('exited 0'));
  t('the count is a LOWER bound, because the base ref is local and only a fetch moves it', loudText.includes('At least') && loudText.includes(`git fetch ${DEFAULT_BASE_REMOTE} ${DEFAULT_BASE_BRANCH}`));
  t('drift reaches the banner, and stays behind the repo line that must come first', bannerLines({ identity: hereIdentity, paths: [], drift: { base: 'aaaaaaa', behind: 9, changed: ['scripts/x.mjs'] } })[0].includes('gate list derived from the tree of'));
  t('and a banner given no drift is byte-identical to before the flag existed', bannerLines({ identity: hereIdentity, paths: [], drift: null }).join('\n') === bannerLines({ identity: hereIdentity, paths: [] }).join('\n'));

  const driftTmp = mkdtempSync(nodePath.join(tmpdir(), 'dispatch-gates-drift-'));
  try {
    const gd = (args, cwd) => spawnSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });
    const up = nodePath.join(driftTmp, 'upstream');
    mkdirSync(up, { recursive: true });
    gd(['init', '-q', '-b', DEFAULT_BASE_BRANCH], up);
    writeFileSync(nodePath.join(up, 'seed.txt'), 'seed\n');
    gd(['add', '-A'], up); gd(['commit', '-qm', 'seed'], up);
    const clone = nodePath.join(driftTmp, 'clone');
    gd(['clone', '-q', up, clone], driftTmp);
    // Positive control: a clone level with its base must read zero, or a
    // non-zero reading below proves nothing.
    t('a checkout level with its base measures zero drift (positive control)', baseDrift({ cwd: clone }).behind === 0);
    // The other end of the distinction, measured rather than hand-built: `up`
    // was `git init`-ed and has no remote at all, so the base ref genuinely
    // does not resolve there — the fresh-checkout state the object literals
    // above only describe. Its reading must not be the zero the clone reads.
    const unresolvableRepo = baseDrift({ cwd: up });
    t('a checkout with no such remote measures NO base, and does not fall back to zero',
      unresolvableRepo.base === null && unresolvableRepo.behind === null && unresolvableRepo.changed === null);
    t('and from a real repo too it arrives as a sentence, not as the silence the level clone gets',
      driftLines(unresolvableRepo).join('\n').includes('STALENESS NOT MEASURED')
        && driftLines(baseDrift({ cwd: clone })).length === 0);
    // The OTHER door, also measured rather than hand-built (#12815): a checkout
    // whose base ref is fetched and RESOLVES, but whose own HEAD is unborn, so
    // `rev-list --count HEAD..<ref>` cannot answer. The literals above describe
    // that state; only a repo shows it is reachable, which is the whole reason
    // this fixture exists beside them.
    const unborn = nodePath.join(driftTmp, 'unborn');
    mkdirSync(unborn, { recursive: true });
    gd(['init', '-q', '-b', DEFAULT_BASE_BRANCH], unborn);
    gd(['remote', 'add', DEFAULT_BASE_REMOTE, up], unborn);
    gd(['fetch', '-q', DEFAULT_BASE_REMOTE, `${DEFAULT_BASE_BRANCH}:refs/remotes/${DEFAULT_BASE_REF}`], unborn);
    const unbornRepo = baseDrift({ cwd: unborn });
    t('a checkout whose base ref RESOLVES but whose own HEAD is unborn measures a base, NO distance and NO changed set',
      typeof unbornRepo.base === 'string' && unbornRepo.behind === null && unbornRepo.changed === null);
    t('and that door speaks from a real repo too, rather than reading as the silence the level clone gets',
      driftLines(unbornRepo).join('\n').includes('STALENESS NOT MEASURED')
        && driftLines(baseDrift({ cwd: clone })).length === 0);
    t('so the three REAL readings — level, no ref, no distance — no longer share one output',
      new Set([
        driftLines(baseDrift({ cwd: clone })).join('\n'),
        driftLines(unresolvableRepo).join('\n'),
        driftLines(unbornRepo).join('\n'),
      ]).size === 3);
    // Arrival, not just rendering: a sentence `driftLines` returns and the
    // banner drops is a sentence nobody reads, and the banner is the only
    // consumer there is. Pinned from the REAL reading rather than a literal,
    // because that is the half a literal cannot vouch for.
    t('and the banner a reader actually sees carries it, from that real reading',
      bannerLines({ identity: hereIdentity, paths: [], drift: unbornRepo }).join('\n').includes('STALENESS NOT MEASURED'));
    // Upstream moves in a file the answer is NOT derived from.
    writeFileSync(nodePath.join(up, 'seed.txt'), 'seed2\n');
    gd(['add', '-A'], up); gd(['commit', '-qm', 'unrelated'], up);
    gd(['fetch', '-q', DEFAULT_BASE_REMOTE], clone);
    const offSurface = baseDrift({ cwd: clone });
    t('drift against a real repo is measured from git, never assumed', offSurface.behind === 1 && !!offSurface.base);
    t('and a commit outside the derivation surface stays off the loud list — and the quiet render says what it can see',
      offSurface.changed.length === 0 && driftLines(offSurface).length === 2 && driftLines(offSurface)[0].includes('can SEE'));
    // Now upstream moves a file the answer IS derived from — the measured shape.
    mkdirSync(nodePath.join(up, 'scripts'), { recursive: true });
    writeFileSync(nodePath.join(up, 'scripts', 'check-thing.mjs'), 'export const a = 1;\n');
    gd(['add', '-A'], up); gd(['commit', '-qm', 'change a check script'], up);
    gd(['fetch', '-q', DEFAULT_BASE_REMOTE], clone);
    const onSurface = baseDrift({ cwd: clone });
    t('a commit INSIDE the derivation surface is caught and named', onSurface.behind === 2 && onSurface.changed.includes('scripts/check-thing.mjs'));
    t('and that is the case that goes loud', driftLines(onSurface).join('\n').includes('STALE TREE'));
    // Reachability from an ORDINARY checkout, which is what makes the door
    // above a state of working clones and not only of repos built to show it:
    // `clone` is fully fetched and has just measured a real distance, and one
    // ordinary command leaves its HEAD unborn with the base ref still
    // resolving. It runs last because it mutates `clone`; nothing below reads it.
    gd(['checkout', '-q', '--orphan', 'a-branch-with-no-commit'], clone);
    const orphaned = baseDrift({ cwd: clone });
    t('one ordinary command reaches the no-distance state in a fully fetched clone',
      typeof orphaned.base === 'string' && orphaned.behind === null);
    t('and the clone that measured a distance one command ago says so instead of falling silent',
      driftLines(orphaned).join('\n').includes('STALENESS NOT MEASURED'));
    // The THIRD door, measured from a real repo rather than hand-built
    // (#13392): a SHALLOW clone. Depth-1 cloning is how this fleet's own
    // containers arrive, which is what makes this door a state of production
    // checkouts and not of repos built to show it. One shallow fetch after
    // upstream moves leaves the distance countable — the fetched tip is
    // visible — while the three-dot diff dies with no merge base, because the
    // shallow boundary cut it out of the checkout. Under the pre-fix shape
    // this exact state collapsed into `changed: []` and rendered the quiet
    // clear sentence from a FAILED read — so the last assertion here is the
    // required red: it fails if a reassurance can ever again be manufactured
    // without an established reading.
    const shallow = nodePath.join(driftTmp, 'shallow');
    gd(['clone', '-q', '--depth', '1', `file://${up}`, shallow], driftTmp);
    t('a fresh shallow clone still counts a distance fine — shallowness alone breaks nothing (positive control)',
      baseDrift({ cwd: shallow }).behind === 0);
    writeFileSync(nodePath.join(up, 'scripts', 'check-thing.mjs'), 'export const a = 3;\n');
    gd(['add', '-A'], up); gd(['commit', '-qm', 'move a check script beyond the shallow boundary'], up);
    gd(['fetch', '-q', '--depth', '1', DEFAULT_BASE_REMOTE], shallow);
    const shallowRepo = baseDrift({ cwd: shallow });
    t('one shallow fetch later the distance still READS and the changed set does NOT — null, never an empty array',
      shallowRepo.behind >= 1 && shallowRepo.changed === null);
    const shallowText = driftLines(shallowRepo).join('\n');
    t('and that run REFUSES from the real repo too, naming the changed set as the step that failed',
      shallowText.includes('STALENESS NOT MEASURED') && shallowText.includes('Not empty'));
    t('with an upstream SURFACE commit sitting in the unreadable range right now, no line reassures — not the visible-range sentence, not the retired unqualified one',
      !shallowText.includes('can SEE') && !shallowText.includes('nothing this answer derives from changed'));
  } finally {
    rmSync(driftTmp, { recursive: true, force: true });
  }

  const idTmp = mkdtempSync(nodePath.join(tmpdir(), 'dispatch-gates-id-'));
  try {
    const gi = (args, cwd) => spawnSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });
    gi(['init', '-q', '-b', 'main', 'named'], idTmp);
    const named = nodePath.join(idTmp, 'named');
    gi(['remote', 'add', DEFAULT_BASE_REMOTE, 'https://github.com/an-owner/a-repo.git'], named);
    const namedIdentity = repoIdentity({ cwd: named });
    t('a checkout with a readable remote identifies itself from git, never from a constant', namedIdentity.slug === 'an-owner/a-repo');
    gi(['init', '-q', '-b', 'main', 'anonymous'], idTmp);
    const anonymous = repoIdentity({ cwd: nodePath.join(idTmp, 'anonymous') });
    t('a checkout with no such remote degrades to unverified and still names its tree', anonymous.slug === null && !!anonymous.root);
  } finally {
    rmSync(idTmp, { recursive: true, force: true });
  }

  // End to end, on the real CLI. The one card path is arbitrary; what is under
  // test is the guard around the answer, not the answer.
  });

  slow("the real CLI end to end: the noise floor, the sister-repo verdict, the three absent-path shapes, the entry guard", () => {
  // ── Why the runtime's noise floor is MEASURED and not pattern-matched ─────
  //
  // Every child spawned by this self-test inherits the run's `NODE_OPTIONS`,
  // and under some values the RUNTIME writes to the child's stderr before any
  // user code runs. The measured case: `check-required-contexts.mjs
  // --verify-required-set` exits 2 = NOT VERIFIED without `--use-env-proxy`
  // and prescribes exactly that flag, citing #9642 for why the inference it
  // prevents matters — so a seat that follows one gate's own remedy opens
  // EVERY child here with two lines:
  //
  //   (node:NNN) [UNDICI-EHPA] Warning: EnvHttpProxyAgent is experimental, ...
  //   (Use `node --trace-warnings ...` to show where the warning was created)
  //
  // Two cases below used to describe the child's stderr STREAM while meaning
  // this MODULE's output — one asserting the stream is literally empty, one
  // asserting the banner sits on its first line. Both are true statements
  // about the module and both went red for obeying the other gate's advice:
  // a reported regression that does not exist, in a self-test that runs past
  // the container's foreground cap and so is expensive to re-read.
  //
  // ⛔ The remedy is NOT to stop looking at these children's stderr — that
  // trades a true assertion for silence. ⛔ Nor is it to match node's warning
  // SHAPE: the hint line above carries no `[CODE] Warning:` at all, so a
  // filter written to that description leaves it behind and the cases stay
  // red, while swallowing a line the MODULE wrote in that same shape.
  //
  // So the floor is MEASURED. For each probe an identical child that does
  // NOTHING runs with the same argv shape, cwd and inherited env, and
  // whatever IT prints is what this runtime prints unprompted; anything the
  // probe prints BEYOND that came from the module. No pattern describes the
  // noise, so this cannot rot when node changes its warning text, and any
  // line the module writes still reds — including one disguised as a node
  // warning, which the controls in the entry-guard battery drive. The single
  // normalisation is node's pid, which differs between any two children by
  // construction; nothing else about the text is touched.
  const withoutPid = (stream) => (stream ?? '').replace(/^\(node:\d+\)/gm, '(node:PID)').trim();
  /** What `probe` wrote on stderr BEYOND what this runtime writes unprompted. */
  const stderrBeyondRuntime = (probe, baseline) => (
    withoutPid(probe.stderr) === withoutPid(baseline.stderr) ? '' : withoutPid(probe.stderr)
  );
  /**
   * `probe`'s stderr lines with this runtime's own opening noise removed, so a
   * case can speak about WHICH line the module wrote first. Only an exact
   * leading match of the measured floor is removed; anything else is kept.
   */
  const moduleStderrLines = (probe, baseline) => {
    const noise = withoutPid(baseline.stderr);
    const text = withoutPid(probe.stderr);
    const own = noise && text.startsWith(noise) ? text.slice(noise.length) : text;
    return own.split('\n').map((line) => line.trim()).filter(Boolean);
  };

  // The floor for the CLI children below: same argv shape, same cwd, same
  // inherited env, and an entry that does nothing at all.
  const cliNoiseTmp = mkdtempSync(nodePath.join(tmpdir(), 'dispatch-gates-noise-'));
  let cliBaseline;
  try {
    const quietEntry = nodePath.join(cliNoiseTmp, 'runtime-baseline.mjs');
    writeFileSync(quietEntry, 'export const nothing = 1;\n');
    cliBaseline = spawnSync(process.execPath, [quietEntry, '--tier', 'packages/spec/src/index.ts'], { encoding: 'utf8', cwd: ROOT });
  } finally {
    rmSync(cliNoiseTmp, { recursive: true, force: true });
  }

  const plainRun = runCli(['--tier', 'packages/spec/src/index.ts']);
  t('an unasserted explicit-path run still answers', plainRun.status === 0 && (plainRun.stdout ?? '').trim().length > 0);
  t(
    'and it opens with the banner, on the FIRST stderr line THIS module writes',
    (moduleStderrLines(plainRun, cliBaseline)[0] ?? '').includes('gate list derived from the tree of'),
  );
  // The control that keeps the case above from passing on an empty list: the
  // floor child writes nothing of its own, so subtracting it from ITSELF
  // leaves no line to mistake for a banner.
  t(
    'CONTROL: the floor child writes no stderr line of its own — the subtraction above cannot be vacuous',
    moduleStderrLines(cliBaseline, cliBaseline).length === 0 && moduleStderrLines(plainRun, cliBaseline).length > 0,
  );
  t('the banner stays OFF stdout, which is pasted verbatim into claim comments', !(plainRun.stdout ?? '').includes('gate list derived from the tree of'));
  t('--tier on an explicit path list prints the changed-lines line beside the tier verdict, as NOT MEASURED (a path list has no diff)',
    (plainRun.stdout ?? '').includes('Changed lines — NOT MEASURED'), plainRun.stdout);
  /**
   * A CLI run whose card names a path that is HYPOTHETICAL by design — the
   * pending-changeset probe's path, a surface not written yet. Those runs are
   * exactly what the absent-path refusal ends: unasserted, a path not in this
   * tree is NOT MEASURED and the run exits 3 before deriving anything. So the
   * assertion is spelled ONCE, here, and every probe of a hypothetical path
   * carries it — ⛔ never by weakening the refusal for the mode a probe happens
   * to use. With no readable remote there is no assertion to make and these
   * probes refuse; the cases that use this helper say so in their own branch
   * rather than passing over the empty output that comes back.
   */
  const assertedRun = runCli(['--tier', 'packages/spec/src/index.ts', REPO_FLAG, liveSlug ?? 'an-owner/a-repo']);
  t(
    liveSlug
      ? 'asserting the repo this checkout really is leaves the run green'
      : 'with no readable remote, ANY assertion refuses rather than passing unverified',
    liveSlug ? assertedRun.status === 0 : assertedRun.status === 2,
  );
  t('a satisfied assertion changes the answer not at all', !liveSlug || (assertedRun.stdout ?? '') === (plainRun.stdout ?? ''));
  const refusedRun = runCli(['--tier', 'packages/spec/src/index.ts', REPO_FLAG, 'not-an-owner/not-a-repo']);
  t('asserting a repo this checkout is not ENDS the run', refusedRun.status === 2);
  t('and it prints no answer at all — a refusal must not also be pasteable', (refusedRun.stdout ?? '').trim() === '');
  t('and the refusal names the repo that was asked for', (refusedRun.stderr ?? '').includes('not-an-owner/not-a-repo'));
  const wrongShapeRun = runCli(['--tier', 'packages/spec/src/index.ts', REPO_FLAG, '../a-sister-checkout']);
  t('and pointing the flag at a checkout refuses instead of retargeting', wrongShapeRun.status === 2 && (wrongShapeRun.stdout ?? '').trim() === '');
  const valuelessRun = runCli(['--tier', 'packages/spec/src/index.ts', REPO_FLAG]);
  t('a valueless assertion refuses rather than deriving as though it were absent', valuelessRun.status === 2);

  // ── A governed sister repo's tier verdict on the real CLI ────────────────
  //
  // Measured on the CLI and not on `sisterRepoTierRun` alone, because what
  // was wrong was the process: `--tier` over a sister slug exited 2 with the
  // gate half's refusal, and every sister-repo claim hand-wrote its line.
  const SISTER_SLUG = GOVERNED_REPOS.find((r) => r.id !== SELF_REPO_ID).slug;
  const sisterCatalog = runCli(['--tier', 'skills/objectui/SKILL.md', REPO_FLAG, SISTER_SLUG]);
  t('⭐ `--tier <path> --repo <sister>` ANSWERS at exit 0 — the tier half no longer inherits the gate half\'s refusal', sisterCatalog.status === 0 && (sisterCatalog.stdout ?? '').includes('MANDATORY') && (sisterCatalog.stdout ?? '').includes("'skills/**'"), `status ${sisterCatalog.status}: ${(sisterCatalog.stderr ?? '').split('\n')[0]}`);
  t('…its stderr says the answer is the globs\' ALONE, and that the gate families still need a checkout OF that repo', (sisterCatalog.stderr ?? '').includes('path globs ALONE') && (sisterCatalog.stderr ?? '').includes('checkout OF'));
  t('…and it prints NO gate-list banner: no gate list was derived, so none is claimed', !(sisterCatalog.stderr ?? '').includes('gate list derived from the tree of'));
  t('…and stdout stays paste-clean — the provenance is on stderr, as every other provenance is', !(sisterCatalog.stdout ?? '').includes('dispatch-gates:'));
  const sisterPlain = runCli(['--tier', 'src/components/button.tsx', REPO_FLAG, SISTER_SLUG]);
  t('an ordinary sister-repo path answers the no-mandate floor line and the NOT MEASURED changed-lines line', sisterPlain.status === 0 && (sisterPlain.stdout ?? '').includes('no path-derived mandate') && (sisterPlain.stdout ?? '').includes('Changed lines — NOT MEASURED'));
  const sisterNoPaths = runCli(['--tier', REPO_FLAG, SISTER_SLUG]);
  t('⛔ a sister slug with no paths refuses at exit 2 with nothing on stdout — there is no diff of that repo to derive them from', sisterNoPaths.status === 2 && (sisterNoPaths.stdout ?? '').trim() === '' && (sisterNoPaths.stderr ?? '').includes('explicit paths'));
  const sisterCommands = runCli(['--commands', 'skills/objectui/SKILL.md', REPO_FLAG, SISTER_SLUG]);
  t('⛔ the GATE half still refuses a sister repo with the wrong-repo text, now pointing at the tier route — only the tier question was freed from the tree', sisterCommands.status === 2 && (sisterCommands.stdout ?? '').trim() === '' && (sisterCommands.stderr ?? '').includes('REFUSING — asked for') && (sisterCommands.stderr ?? '').includes(`--tier ${REPO_FLAG}`));

  // ── The three shapes an absent path can arrive in, end to end ─────────────
  //
  // Measured on the real CLI and not on the verdict function, because what was
  // wrong was the process EXIT CODE: a seat read 0 and wrote "it refuses
  // objectui paths by design" into five dispatch texts. A pure function cannot
  // hold that, and the derivation the middle case restores is a full tree walk
  // no fixture stands in for.
  const ABSENT_CLI = 'packages/this-repo-has-no-such-package/src/index.ts';
  const absentUnasserted = runCli(['--commands', ABSENT_CLI]);
  t(
    `⭐ (a) an absent path with no ${REPO_FLAG} exits ${EXIT_PREREQUISITE_NOT_MET} = NOT MEASURED — it answered 0 before this guard`,
    absentUnasserted.status === EXIT_PREREQUISITE_NOT_MET,
  );
  t('and it names the absent path on stderr, where the dispatcher reads it', (absentUnasserted.stderr ?? '').includes(ABSENT_CLI));
  t(
    'and prints NOTHING on stdout — a refusal must not also be pasteable into a dispatch text',
    (absentUnasserted.stdout ?? '').trim() === '',
  );
  const absentAssertedHere = runCli(['--commands', ABSENT_CLI, REPO_FLAG, liveSlug ?? 'an-owner/a-repo']);
  t(
    liveSlug
      ? `⭐ (b) asserting THIS repo restores the derivation — the not-yet-written reading is still reachable, by one flag`
      : 'with no readable remote even the asserted form refuses, rather than passing unverified',
    liveSlug
      ? absentAssertedHere.status === 0 && (absentAssertedHere.stdout ?? '').trim().length > 0
      : absentAssertedHere.status === 2,
  );
  t(
    'and the restored derivation still files the absent path as a pending changeset, not as a clearance',
    !liveSlug || (absentAssertedHere.stderr ?? '').includes('apply once this card'),
  );
  const absentAssertedOther = runCli(['--commands', ABSENT_CLI, REPO_FLAG, 'not-an-owner/not-a-repo']);
  t(
    '⭐ (c) naming ANOTHER repo keeps its own exit 2 and its own text — this guard did not swallow the older refusal',
    absentAssertedOther.status === 2 && (absentAssertedOther.stderr ?? '').includes('REFUSING — asked for'),
  );
  t(
    `CONTROL: a path that EXISTS still derives at 0 with no ${REPO_FLAG} — the guard fires on absence, not on every unasserted run`,
    runCli(['--commands', 'packages/spec/src/index.ts']).status === 0,
  );
  // The published catalog on the real CLI (2026-09-10 ruling): the mandate
  // prints for a catalog file and stays absent for an internal references
  // file — the two acceptance paths, measured end to end rather than on the
  // pure function alone.
  const catalogCli = runCli(['--tier', 'skills/objectstack-data/SKILL.md']);
  t('⭐ --tier on a published catalog SKILL.md prints the MANDATE, naming the skills/** entry', catalogCli.status === 0 && (catalogCli.stdout ?? '').includes('MANDATORY') && (catalogCli.stdout ?? '').includes("'skills/**'"));
  t('and refuses the one-line-class exit on stdout, where the claim comment reads it', (catalogCli.stdout ?? '').includes('NOT available') && !(catalogCli.stdout ?? '').includes('drops to opus execution'));
  const catalogAiCli = runCli(['--tier', 'skills/objectstack-ai/SKILL.md']);
  t('⭐ a second catalog SKILL.md prints the same mandate', catalogAiCli.status === 0 && (catalogAiCli.stdout ?? '').includes('MANDATORY') && (catalogAiCli.stdout ?? '').includes("'skills/**'"));
  const internalRefsCli = runCli(['--tier', '.claude/skills/pm-dispatch/references/state-machine.md']);
  t('⭐ --tier on an internal pm-dispatch references file still prints NO mandate', internalRefsCli.status === 0 && (internalRefsCli.stdout ?? '').includes('no path-derived mandate') && !(internalRefsCli.stdout ?? '').includes('MANDATORY'));
  // The clause-② test exception on the real CLI (#19936): the ruling's pins are
  // on `--tier` OUTPUT, so both acceptance paths are measured end to end. The
  // lit case goes through the asserted helper, so a later rename of that file
  // leaves the pin deciding rather than refusing as an absent path.
  const litTierCli = runCliHypothetical(['--tier', 'packages/spec/src/type-alias-convention.pin.test.ts']);
  t('⭐ --tier on the lit case (a test-only spec diff) derives, and prints NO SUSPECT line', litTierCli.status === 0 && (litTierCli.stdout ?? '').includes('no path-derived mandate') && !(litTierCli.stdout ?? '').includes('SUSPECT'), litTierCli.stdout);
  const zodTierCli = runCliHypothetical(['--tier', 'packages/spec/src/ui/view.zod.ts']);
  t('⭐ --tier on a *.zod.ts contract schema still prints the SUSPECT line naming it', zodTierCli.status === 0 && (zodTierCli.stdout ?? '').includes('SUSPECT') && (zodTierCli.stdout ?? '').includes('packages/spec/src/ui/view.zod.ts'), zodTierCli.stdout);

  // ── The entry guard (#9757) ───────────────────────────────────────────────
  //
  // Both directions are measured by really spawning node, because the guard's
  // own failure direction is silent in BOTH of them. If the predicate wrongly
  // answered false, every CLI mode would print nothing and exit 0, and
  // `check:pm-dispatch-gates` — which holds the child's exit status only —
  // would report that no-op as a pass. If it wrongly answered true, the defect
  // this guard exists to remove is simply still here. Reasoning about argv
  // cannot tell those apart on the invocation forms that actually occur; a
  // child process can.
  const SELF = fileURLToPath(ENGINE_URL);
  t('the entry predicate answers true for this module named by its own path', invokedAs(SELF, SELF));
  t('and for the same file named relatively from the repo root, as the gate spells it', invokedAs(nodePath.join(ROOT, 'scripts/pm/dispatch-gates.mjs'), SELF));
  t('a different file in the same directory is not this module', !invokedAs(nodePath.join(ROOT, 'scripts/pm/check-dispatch-gates.mjs'), SELF));
  t('an absent argv[1] is not this module — the `node --eval` importer', !invokedAs(undefined, SELF) && !invokedAs('', SELF));

  const entryTmp = mkdtempSync(nodePath.join(tmpdir(), 'dispatch-gates-entry-'));
  try {
    // RUN DIRECTLY the modes must all still reach their branches. `--tier`
    // stands in for every one of them: the guard is a SINGLE site wrapping the
    // whole chain, so a form that reaches this branch reaches `--self-test`
    // too — and spawning `--self-test` from inside `--self-test` would recurse.
    const direct = spawnSync(process.execPath, [SELF, '--tier', 'packages/spec/src/data/filter.zod.ts'], {
      encoding: 'utf8',
      cwd: ROOT,
    });
    t(
      'invoked directly, --tier still answers rather than exiting 0 in silence',
      direct.status === 0 && (direct.stdout ?? '').trim().length > 0,
    );

    // #10097 option A, pinned END TO END. Every assertion above this one tests
    // `unreachableLines` in ISOLATION, and all of them stay green if the call
    // site drifts back behind `--residue` — which is the entire defect the
    // option was ruled to fix. Only a real run of the DEFAULT invocation, with
    // no flag, can tell the two apart.
    const plainRun = spawnSync(process.execPath, [SELF, 'packages/spec/src/data/filter.zod.ts'], {
      encoding: 'utf8',
      cwd: ROOT,
    });
    const plainOut = plainRun.stdout ?? '';
    t('the DEFAULT run answers at all', plainRun.status === 0 && plainOut.trim().length > 0);
    t('the DEFAULT run — no --residue — names the unreachable families itself', /^Unreachable — the \d+ famil\(ies\)/m.test(plainOut));
    t('and carries the ⛔ correction into the default output, where the wrong reading would be made', /NOT a skip list/.test(plainOut) && /CI schedules (?:those|it) on EVERY pull request/.test(plainOut));
    t('and the default run stays free of the residue listings the flag owns', !/^Silent \(source names paths/m.test(plainOut));
    // The two repaired families must not be named as unreachable by a REAL run.
    const unreachableBlock = plainOut.slice(plainOut.indexOf('Unreachable — the'), plainOut.indexOf('Residue — all'));
    t('a real default run no longer reports check:release-body as unreachable', !unreachableBlock.includes('check:release-body'));
    t('nor check-skill-frame-freshness.mjs', !unreachableBlock.includes('check-skill-frame-freshness.mjs'));
    t('and no phantom namespace literal survives into the printed reasons', !/'application\/json'|'refs\/remotes\/|'origin\/main'/.test(unreachableBlock));

    // #10309, pinned END TO END for the same reason #10097 is: every case above
    // drives `pendingChangesetFamilies`/`pendingChangesetLines` in isolation and
    // all of them stay green if the call site is dropped from `derive`, or hidden
    // behind a flag no dispatch brief tells anyone to pass. Only a real DEFAULT
    // run over a real non-changeset surface can tell those apart — and this is
    // also the one case that proves the LIVE tree still has such families at all,
    // so a probe that silently stopped reaching them cannot pass as "none
    // pending".
    t('the DEFAULT run names the families a changeset will add', /^Once a changeset exists, \d+ more famil\(ies\) apply/m.test(plainOut));
    const pendingBlock = plainOut.slice(plainOut.indexOf('Once a changeset exists,'), plainOut.indexOf('Unreachable — the'));
    t('and the live tree really has some — the probe reaching nothing must not read as "none pending"', /^ {2}- (pnpm|node) \S/m.test(pendingBlock));
    // `every` over an empty list is true, so the row count is asserted BESIDE
    // it: without that, dropping the call site leaves this case green on a slice
    // containing nothing at all (measured — it was the one live case ablating
    // the call site did not redden).
    const pendingRows = pendingBlock.split('\n').filter((l) => l.startsWith('  - '));
    t('every live row is runnable and carries the hypothetical path', pendingRows.length > 0 && pendingRows.every((l) => /^ {2}- (pnpm|node) /.test(l) && l.includes(CHANGESET_PROBE_PATH)));
    // The negative half: hand the SAME run a diff that already carries a
    // changeset. Those families must move into the matched list and the section
    // must stop printing — the double-print is the shape this section would be
    // worst as, since the two headings make different claims about time.
    // ⚠️ This probe's changeset path is HYPOTHETICAL — that is the whole point
    // of it — so it is the first caller in this tree to owe the assertion the
    // absent-path refusal now requires: unasserted, a path not in the tree is
    // NOT MEASURED and the run ends at exit 3 before any derivation. Measured
    // on this battery: adding the branch turned this case and the one below it
    // red, and asserting the repo is the whole repair. That is the migration
    // every dispatcher of a not-yet-written path owes, done here on the only
    // in-tree caller that has one.
    const assertHere = liveSlug ? [REPO_FLAG, liveSlug] : [];
    const withChangeset = spawnSync(
      process.execPath,
      [SELF, 'packages/spec/src/data/filter.zod.ts', `.${'changeset'}/pinned-by-the-self-test.md`, ...assertHere],
      { encoding: 'utf8', cwd: ROOT },
    );
    const withOut = withChangeset.stdout ?? '';
    // Both branches assert a SHAPE. With no readable remote the assertion above
    // cannot be built, so the hypothetical path stays ambiguous and the run
    // refuses — pinned as a refusal rather than skipped, so the no-remote case
    // can never pass by asserting nothing over empty output.
    t(
      liveSlug
        ? 'a run whose surface ALREADY carries a changeset answers at all'
        : 'with no readable remote its repo cannot be asserted, so the hypothetical path stays NOT MEASURED',
      liveSlug
        ? withChangeset.status === 0 && withOut.trim().length > 0
        : withChangeset.status === EXIT_PREREQUISITE_NOT_MET && withOut.trim() === '',
    );
    t('and prints no pending section — there is no temporal gap left to disclose', !/^Once a changeset exists,/m.test(withOut));
    // ⚠️ Counted per COMMAND, not per substring (#14880). `check-empty-changeset`
    // is invoked two ways by CI — `--self-test` beside a `--base` run — and
    // since the derivation key became (script, args) those are two families,
    // so a substring count of 2 is the tree being described correctly. The
    // invariant this case protects is unchanged and is what is asserted: each
    // family appears ONCE, in the matched list, and never also in the pending
    // section whose heading makes a different claim about time.
    const changesetCommands = withOut
      .split('\n')
      .filter((l) => l.startsWith('  - '))
      .map((l) => l.slice(4).split('   ')[0].trim())
      .filter((c) => c.includes('check-empty-changeset'));
    t(
      liveSlug
        ? 'because those families are in the MATCHED list instead, each one exactly once'
        : 'and with the run refused there is no matched list to check — it printed no command at all',
      !liveSlug
        ? changesetCommands.length === 0 && withOut.trim() === ''
        : changesetCommands.length > 0
        && new Set(changesetCommands).size === changesetCommands.length
        // The `--base` run is the one this section is ABOUT — it is the family
        // a changeset brings into scope. ⚠️ The SPELLING this looks for moved
        // once before and moves again here, and the subject and the invariant
        // are unchanged both times: #15083 took it off the bare path CI never
        // runs and onto the invocation CI does, spelled with the variable the
        // workflow pins; #15441 renders that same key as the invocation a DEV
        // can run, with the `origin/main` this script's own usage block
        // declares as its `--base` default filled into the value position. What
        // is asserted is still exactly what it was: the family is in the
        // matched list, exactly once, and never also in the pending section
        // whose heading makes a different claim about time. The expectation is
        // updated rather than the case dropped, for the reason the value-bearing
        // block above states when #15083 rewrote two of its own.
        && changesetCommands.filter((c) => c === 'node scripts/check-empty-changeset.mjs --base origin/main').length === 1,
    );

    // REACHED THROUGH A SYMLINK — the form a plain path equality gets wrong.
    // Node resolves the link for the module graph, so `import.meta.url` names
    // the real file while argv[1] names the link. Under the precedent's
    // one-comparison spelling this run goes inert, exit 0, no output: the
    // false-green the gate cannot see.
    const link = nodePath.join(entryTmp, 'linked-dispatch-gates.mjs');
    symlinkSync(SELF, link);
    const viaLink = spawnSync(process.execPath, [link, '--tier', 'packages/spec/src/data/filter.zod.ts'], {
      encoding: 'utf8',
      cwd: ROOT,
    });
    t(
      'invoked through a symlink to this file, --tier still answers',
      viaLink.status === 0 && (viaLink.stdout ?? '').trim().length > 0,
    );
    t('and it answers the SAME thing as the direct invocation', (viaLink.stdout ?? '') === (direct.stdout ?? ''));

    // IMPORTED the module must do nothing at all. The importer's argv carries
    // this tool's own flags on purpose: that is the shape that fired an
    // unrelated file's assertions inside the importer's self-test.
    const consumer = nodePath.join(entryTmp, 'consumer.mjs');
    const REACHED = 'CONSUMER-REACHED function function function';
    writeFileSync(
      consumer,
      `const m = await import(${JSON.stringify(pathToFileURL(SELF).href)});\n` +
        `console.log('CONSUMER-REACHED', typeof m.maskComments, typeof m.isExtractConfigPath, typeof m.deriveTier);\n`,
    );
    // ONE spawn helper for both children below, so the noise floor cannot
    // drift away from the probe it is the floor for: same argv shape, same
    // cwd, same inherited env, by construction rather than by two copies.
    const spawnEntryChild = (entry) => spawnSync(
      process.execPath,
      [entry, '--self-test', '--tier', 'packages/spec/src/index.ts'],
      { encoding: 'utf8', cwd: entryTmp },
    );
    const imported = spawnEntryChild(consumer);
    t(
      'imported, the importer reaches its own first statement and the re-exports are there',
      imported.status === 0 && (imported.stdout ?? '').trim() === REACHED,
    );

    // The measured noise floor again — see `stderrBeyondRuntime` above for why
    // this is subtracted rather than pattern-matched. The floor child here is
    // spawned through the SAME helper as the probe, so the two cannot drift
    // apart in argv shape, cwd or inherited env.
    const baselineEntry = nodePath.join(entryTmp, 'runtime-baseline.mjs');
    writeFileSync(baselineEntry, "console.log('BASELINE-REACHED');\n");
    const runtimeBaseline = spawnEntryChild(baselineEntry);
    t('imported, this module prints nothing of its own on either stream', stderrBeyondRuntime(imported, runtimeBaseline) === '');

    // The controls that keep the case above from passing by ignoring
    // everything. ⚠️ Without them, "prints nothing of its own" and "prints
    // nothing that is ever looked at" are the same green — and this battery
    // would have no way to tell a working subtraction from one that answers
    // '' for every input.
    const probeImporting = (name, source) => {
      const target = nodePath.join(entryTmp, name);
      writeFileSync(target, source);
      const importer = nodePath.join(entryTmp, `import-${name}`);
      writeFileSync(importer, `await import(${JSON.stringify(pathToFileURL(target).href)});\n`);
      return spawnEntryChild(importer);
    };
    t(
      'NEGATIVE CONTROL: importing a module that writes nothing is clean under THIS runtime',
      stderrBeyondRuntime(probeImporting('quiet.mjs', 'export const nothing = 1;\n'), runtimeBaseline) === '',
    );
    t(
      'POSITIVE CONTROL: one line the imported module writes to stderr still reds',
      stderrBeyondRuntime(
        probeImporting('noisy.mjs', "console.error('a line this module wrote itself');\n"),
        runtimeBaseline,
      ).includes('a line this module wrote itself'),
    );
    // The case that separates a MEASURED baseline from a shape filter: this
    // line is shaped exactly like one of node's own warnings, so a filter
    // written to that shape swallows it. Subtracting a measured baseline
    // cannot — the baseline child never wrote it.
    t(
      'POSITIVE CONTROL: an imported line DISGUISED as a node warning still reds',
      stderrBeyondRuntime(
        probeImporting(
          'disguised.mjs',
          "console.error('(node:4242) [FAKE-CODE] Warning: written by the MODULE, not the runtime');\n",
        ),
        runtimeBaseline,
      ).includes('written by the MODULE, not the runtime'),
    );
    t(
      "imported by a consumer whose own argv says --self-test, THIS file's self-test does not fire",
      !(imported.stdout ?? '').includes('dispatch-gates self-test:'),
    );
  } finally {
    rmSync(entryTmp, { recursive: true, force: true });
  }
  });

  // ── The always-runs tail (#13333) ────────────────────────────────────────
  //
  // Two halves, and the SECOND is the one that answers the card. The fixtures
  // pin the walk; the live pins below assert that the tail reaches the CLASS on
  // this tree — that it names a second member, invisible for a DIFFERENT reason
  // than the gate the card was filed about. A fix demonstrated only on
  // `check-reference-carrier-shape` is the instance fix triage refused, and the
  // way to keep that from rotting back in is to make the class assertion a
  // case, derived live, rather than a sentence in a docblock.
  const tailWf = [
    'name: Fixture',
    'on:',
    '  pull_request:',
    '    branches:',
    '      - main',
    'jobs:',
    '  gates:',
    '    steps:',
    '      - name: Setup',
    '        uses: actions/checkout@v4',
    '      - name: A discoverable family',
    '        run: pnpm check:engine-double-contract',
    '      - name: A package-local gate invoked by path',
    '        run: |',
    '          node packages/lint/scripts/check-fixture-shape.mjs --self-test',
    '          node packages/lint/scripts/check-fixture-shape.mjs',
    '      - name: A gate run by another interpreter',
    '        run: bash scripts/pm/os-fixture-lock.sh --self-test',
    '      - name: Conditional, so no claim is made about it',
    '        if: github.event_name == \'push\'',
    '        run: pnpm exec turbo run build',
    '      - name: A body carrying a dash line',
    '        run: |',
    '          printf \'%s\\n\' "- not a step"',
    '          pnpm lint',
    '  conditional-job:',
    '    if: needs.filter.outputs.console == \'true\'',
    '    steps:',
    '      - name: Never claimed as always-run',
    '        run: pnpm check:console-pin',
  ].join('\n');

  t('a pull_request trigger is distinguished from no trigger at all', declaresPullRequestTrigger(tailWf));
  t(
    'a workflow with no pull_request trigger is not read as unfiltered',
    !declaresPullRequestTrigger('on:\n  push:\n    branches:\n      - main\njobs:\n  x:\n    steps: []'),
  );

  const tailJob = extractJobBlocks(tailWf).find((j) => j.id === 'gates');
  const tailSteps = extractStepBlocks(tailJob.text);
  t('every step of the job is found, and only the steps', tailSteps.length === 6);
  t('a step name is read from its own key column', tailSteps[1].name === 'A discoverable family');
  t('a step `if:` is read', tailSteps[4].if === "github.event_name == 'push'");
  t('a step without an `if:` is not given one', tailSteps[2].if === null);
  t(
    'a dash line INSIDE a block-scalar body is not read as a step',
    tailSteps[5].name === 'A body carrying a dash line' && tailSteps[5].text.includes('- not a step'),
  );

  const tail = alwaysRunSteps([{ file: 'fixture.yml', text: tailWf }]);
  const tailNames = tail.rows.map((r) => r.step);
  t('a step whose family the derivation names is NOT in the tail', !tailNames.includes('A discoverable family'));
  // #15342 retired this member from the tail by giving the derivation the anchor
  // to discover it, so what is pinned is the RETIREMENT WITH ITS CAUSE: the step
  // has left the tail AND the derivation names a family for it. Either half
  // alone goes green for the wrong reason — a tail that stopped walking, or a
  // family list that claims the step while CI's step sits unaccounted for. The
  // tail's own class ("a step the derivation names NOTHING for is listed") is
  // unweakened: the interpreter member below still holds it, on this fixture and
  // on the live tree.
  t(
    'a package-local gate invoked by path is NOT in the tail any more (#15342) — the derivation names it',
    !tailNames.includes('A package-local gate invoked by path')
      && extractCheckInvocations(tailWf, 'fixture.yml')
        .some((i) => i.script === 'packages/lint/scripts/check-fixture-shape.mjs'),
  );
  t('a gate run by another interpreter IS in the tail', tailNames.includes('A gate run by another interpreter'));
  t('a conditional STEP is excluded and counted', !tailNames.includes('Conditional, so no claim is made about it') && tail.counts.conditionalSteps === 1);
  t('a conditional JOB is excluded and counted', !tailNames.includes('Never claimed as always-run') && tail.counts.conditionalJobs === 1);
  t('a `uses:` step with no command is neither counted nor listed', !tailNames.includes('Setup') && tail.counts.unconditional === 4);
  t('the tail accounts for every unconditional step it counted', tail.counts.accounted + tail.counts.unaccounted === tail.counts.unconditional);
  t(
    'a workflow CI can narrow by path is excluded from the tail entirely',
    alwaysRunSteps([{ file: 'f.yml', text: tailWf.replace('    branches:\n      - main', "    paths:\n      - 'packages/**'") }]).counts
      .filteredWorkflows === 1,
  );

  const tailLines = alwaysRunLines(tail.rows, tail.counts);
  t('the rendered tail sizes itself against the unconditional total', tailLines[0].includes(`${tail.counts.unaccounted} of the ${tail.counts.unconditional}`));
  t('the rendered tail refuses to be read as a per-card list', tailLines.some((l) => l.includes('EVERY pull request whatever your diff is')));
  t('the rendered tail refuses to classify its rows into gates and setup', tailLines.some((l) => l.includes('NOT classified into gates and setup')));

  const dedupeRows = [
    { workflow: 'a.yml', job: 'One', step: 'Install dependencies', commands: ['pnpm install --frozen-lockfile'] },
    { workflow: 'a.yml', job: 'Two', step: 'Install dependencies', commands: ['pnpm install --frozen-lockfile'] },
    { workflow: 'a.yml', job: 'Two', step: 'Install dependencies', commands: ['pnpm install --offline'] },
  ];
  const dedupeLines = alwaysRunLines(dedupeRows, { unconditional: 4, accounted: 1, unaccounted: 3, conditionalSteps: 0, conditionalJobs: 0 });
  t('rows are deduplicated by COMMAND, never by step name', dedupeLines.filter((l) => l.startsWith('  - ')).length === 2);
  t('a repeated command names how many other jobs also run it', dedupeLines.some((l) => l.includes('also run by 1 other job(s)')));

  const longRow = [{ workflow: 'a.yml', job: 'J', step: 'S', commands: Array.from({ length: 30 }, (_, i) => `line ${i}`) }];
  const longLines = alwaysRunLines(longRow, { unconditional: 2, accounted: 1, unaccounted: 1, conditionalSteps: 0, conditionalJobs: 0 });
  t('a long step is elided to a pointer rather than transcribed', longLines.some((l) => l.includes(`${30 - ALWAYS_RUN_COMMAND_CAP} more line(s) — read the step in a.yml`)));
  t('the elision still prints the capped head of the command', longLines.filter((l) => /^ {6}line \d+$/.test(l)).length === ALWAYS_RUN_COMMAND_CAP);

  const refusedTail = (rows, counts) => {
    try {
      alwaysRunLines(rows, counts);
      return false;
    } catch {
      return true;
    }
  };
  t('a tail that found NO unconditional step refuses rather than reads as a clean farm (#4690)', refusedTail([], { unconditional: 0, accounted: 0, unaccounted: 0 }));
  t('a tail whose counts do not add up refuses', refusedTail([], { unconditional: 5, accounted: 1, unaccounted: 1 }));
  t('a tail whose row count contradicts its own total refuses', refusedTail([], { unconditional: 5, accounted: 4, unaccounted: 1 }));

  // ── LIVE, on this tree: does the tail reach the CLASS? ────────────────────
  //
  // Re-derived on every run, so these fail when the workflows move rather than
  // when someone remembers to re-read them. ⛔ No count is pinned: the number
  // of unconditional steps moves with every workflow edit and a frozen one
  // would go stale with nothing failing — which is the defect this whole file
  // is about.
  const liveTail = alwaysRunSteps(
    readdirSync(nodePath.join(ROOT, '.github/workflows'))
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => ({ file: f, text: readFileSync(nodePath.join(ROOT, '.github/workflows', f), 'utf8') })),
  );
  const liveCommands = liveTail.rows.flatMap((r) => r.commands);
  t('the live tail is not empty — an empty one would mean the walk broke, not that CI runs nothing', liveTail.rows.length > 0);
  // #13333's first live instance was a package-local gate invoked by path. It
  // left the unmeasured tail when #15342 gave the derivation a family for it, and
  // it has since left the TREE: the gate was retired by maintainer ruling, so
  // there is no package-local by-path invocation left to be accounted for.
  //
  // The pin keeps the half that is still about this file's walk — the tail names
  // no such step — and states the second half as a zero with a control, because
  // "the derivation names a family for it" has no `it` any more. ⛔ The control is
  // not decoration: `liveDirectScripts` empty would satisfy the zero for the wrong
  // reason, which is this whole file's failure mode.
  const liveDirectScripts = new Set(
    readdirSync(nodePath.join(ROOT, '.github/workflows'))
      .filter((f) => /\.ya?ml$/.test(f))
      .flatMap((f) => extractCheckInvocations(readFileSync(nodePath.join(ROOT, '.github/workflows', f), 'utf8'), f))
      .filter((i) => i.direct)
      .map((i) => i.script),
  );
  t(
    'the INSTANCE the card was filed about has LEFT the live tail (#15342) and then the tree — the tail '
      + 'names no package-local step, and the derivation still reaches the direct invocations that remain',
    !liveCommands.some((c) => /^node\s+packages\/\S+\/check-[\w.-]+\.mjs/.test(c))
      && liveDirectScripts.size > 0
      && ![...liveDirectScripts].some((s) => s.startsWith('packages/')),
  );
  // The class assertion. The instance above is invisible because its path is
  // not under `scripts/`; this one is invisible because its INTERPRETER is not
  // `node` at all. Two different structural reasons, so a fix that reached only
  // the first would fail here.
  const otherInterpreter = liveCommands.filter((c) => /^(?:bash|sh|python3?)\s+\S+/.test(c));
  t(
    'the live tail reaches the CLASS: a second member invisible for a DIFFERENT reason (another interpreter)',
    otherInterpreter.length > 0,
  );
  t(
    'and that second member is not the card\'s own gate wearing a different name',
    otherInterpreter.some((c) => !c.includes('reference-carrier')),
  );
  // The partition. Every row is a step the family derivation names NOTHING for,
  // so a row that yields an invocation would mean the tail and the family list
  // are double-counting the same step — the two halves have to be disjoint for
  // either count to mean anything.
  t(
    'no row in the live tail yields a check invocation — the tail and the family list are disjoint',
    liveTail.rows.every((r) => extractCheckInvocations(r.commands.join('\n'), r.workflow).length === 0),
  );
  t(
    'every live row really sits in a workflow CI cannot narrow by path',
    liveTail.rows.every((r) => {
      const text = readFileSync(nodePath.join(ROOT, '.github/workflows', r.workflow), 'utf8');
      return declaresPullRequestTrigger(text) && extractTriggerPaths(text).length === 0;
    }),
  );
  t('the live tail renders without refusing', alwaysRunLines(liveTail.rows, liveTail.counts).length > 0);

  // ── The OTHER half of that partition: the jobs YOUR paths schedule (#16285) ─
  //
  // The tail above excludes a path-filtered workflow and every job carrying an
  // `if:` — which is every job a `dorny/paths-filter` output schedules. Those
  // exclusions are right for the claim the tail makes and they are exactly why
  // nothing reported what those jobs run: the family derivation looks INSIDE
  // them for `check:*` invocations, and the rest of their work had no reader.
  //
  // FIXTURE first, so every branch is pinned on input this tree may not hold
  // tomorrow; the LIVE half below is the card's own acceptance baseline and
  // cannot be faked by a fixture. ⛔ Neither half touches the network.
  const jobWf = [
    'name: Fixture',
    'on:',
    '  pull_request:',
    'jobs:',
    '  filter:',
    '    outputs:',
    "      core: ${{ steps.changes.outputs.core || 'true' }}",
    "      docs: ${{ steps.changes.outputs.docs || 'true' }}",
    '    steps:',
    '      - uses: dorny/paths-filter@v4',
    '        id: changes',
    '        with:',
    '          filters: |',
    '            core:',
    "              - 'packages/**'",
    '            docs:',
    "              - 'content/**'",
    '  suite:',
    '    name: Suite (1/2)',
    "    if: ${{ !cancelled() && needs.filter.outputs.core != 'false' }}",
    '    steps:',
    '      - name: Setup',
    '        uses: actions/checkout@v4',
    '      - name: A discoverable family',
    '        run: pnpm check:engine-double-contract',
    '      - name: Run the package suite',
    '        run: |',
    '          pnpm turbo run test \\',
    '            --filter=@objectstack/dogfood',
    '      - name: Conditional, so no claim is made about it',
    "        if: github.event_name == 'push'",
    '        run: pnpm exec turbo run build',
    '  docs-only:',
    '    name: Docs Only',
    "    if: ${{ !cancelled() && needs.filter.outputs.docs != 'false' }}",
    '    steps:',
    '      - name: Never claimed for a packages path',
    '        run: pnpm docs:build',
    '  unresolvable:',
    '    name: Unresolvable',
    "    if: github.event_name == 'push'",
    '    steps:',
    '      - name: Never claimed at all',
    '        run: pnpm lint',
  ].join('\n');

  const jobFixture = jobFilteredSteps([{ file: 'fixture.yml', text: jobWf }], ['packages/qa/dogfood/test/x.test.ts']);
  const jobRowNames = jobFixture.rows.map((r) => r.job);
  t('a job whose declared population covers one of your paths is named — by the name CI calls it', jobRowNames.includes('Suite (1/2)'));
  t('a job whose population covers NONE of your paths is not named', !jobRowNames.includes('Docs Only'));
  t(
    'a job whose `if:` resolves to no filter output contributes no population at all — a schedule guessed at would fabricate',
    !jobRowNames.includes('Unresolvable') && jobFixture.counts.populations === 2,
  );
  // ⛔ Every reader below DEGRADES to a failing case rather than a TypeError. The
  // ablation that proves these cases can fail removes the very row they read, and
  // a battery that throws there stops before the LIVE controls underneath it are
  // decided — turning "this pin can fail" into "this pin was never reached".
  const suiteRow = jobFixture.rows.find((r) => r.job === 'Suite (1/2)') ?? { steps: [], hits: [], outputs: [] };
  const suiteSteps = suiteRow.steps.map((s) => s.step);
  t('the step CI runs that no family names IS listed — the whole point of the block', suiteSteps.includes('Run the package suite'));
  t(
    'a step whose family the derivation names is NOT listed — the two halves are disjoint',
    !suiteSteps.includes('A discoverable family') && jobFixture.counts.accounted === 1,
  );
  t(
    'a conditional STEP is excluded and COUNTED, never silently dropped',
    !suiteSteps.includes('Conditional, so no claim is made about it') && jobFixture.counts.conditionalSteps === 1,
  );
  t(
    'a `uses:` step with no command is neither counted nor listed',
    !suiteSteps.includes('Setup') && jobFixture.counts.steps === 2,
  );
  t('the block accounts for every step it walked', jobFixture.counts.accounted + jobFixture.counts.unaccounted === jobFixture.counts.steps);
  t(
    'the row carries the provenance the claim rests on — YOUR path and the pattern that covered it',
    suiteRow.hits.length === 1
      && suiteRow.hits[0].path === 'packages/qa/dogfood/test/x.test.ts'
      && suiteRow.hits[0].pattern === 'packages/**'
      && suiteRow.outputs.includes('filter.core'),
  );
  const suiteRun = suiteRow.steps.find((s) => s.step === 'Run the package suite') ?? { commands: [] };
  t(
    'a shell line-continuation is spliced, so a row is the command the shell sees rather than a fragment of its argv',
    suiteRun.commands.length === 1 && suiteRun.commands[0] === 'pnpm turbo run test --filter=@objectstack/dogfood',
  );

  const jobLines = jobFilteredStepLines(jobFixture.rows, jobFixture.counts);
  t('the rendered block sizes itself against the jobs your paths schedule', (jobLines[0] ?? '').includes('1 job(s) CI runs because one of your paths'));
  t('the rendered block refuses to be read as runnable', jobLines.some((l) => l.includes('NOT in --commands')));
  t('the rendered block refuses to classify its rows into tests, builds and setup', jobLines.some((l) => l.includes('NOT classified into tests, builds and setup')));
  t('the rendered block names the always-runs tail as the other half of one partition', jobLines.some((l) => l.includes('OTHER half of this partition')));
  t('an excluded conditional step is sized in the rendering rather than left as an absence', jobLines.some((l) => l.includes('1 step(s) of these jobs carry an `if:`')));
  t('a block with no rows renders NOTHING — a zero heading would invite a hunt for rows that are not there', jobFilteredStepLines([], jobFixture.counts).length === 0);

  const longJobRow = [{
    workflow: 'a.yml',
    job: 'J',
    outputs: ['filter.core'],
    hits: [{ path: 'p/x.ts', pattern: 'p/**' }],
    dropped: 0,
    steps: [{ step: 'S', commands: Array.from({ length: 30 }, (_, i) => `line ${i}`) }],
  }];
  const longJobCounts = { covering: 1, named: 1, steps: 1, accounted: 0, unaccounted: 1, conditionalSteps: 0 };
  const longJobLines = jobFilteredStepLines(longJobRow, longJobCounts);
  t(
    'a long step is elided to a pointer rather than transcribed, on the TAIL\'s own cap and in its own words',
    longJobLines.some((l) => l.includes(`${30 - ALWAYS_RUN_COMMAND_CAP} more line(s) — read the step in a.yml`)),
  );
  t('the elision still prints the capped head of the command', longJobLines.filter((l) => /^ {10}line \d+$/.test(l)).length === ALWAYS_RUN_COMMAND_CAP);

  const refusedJobBlock = (rows, counts) => {
    try {
      jobFilteredStepLines(rows, counts);
      return false;
    } catch {
      return true;
    }
  };
  t(
    'a block whose row count contradicts its own job count refuses rather than prints a total nobody can trust (#4690)',
    refusedJobBlock(longJobRow, { ...longJobCounts, named: 2 }),
  );
  t('a block whose step counts do not add up refuses', refusedJobBlock(longJobRow, { ...longJobCounts, steps: 5 }));

  // ── LIVE, on this tree: the card's own acceptance baseline ────────────────
  //
  // ⛔ No count is pinned. The number of path-scheduled jobs moves with every
  // workflow edit and a frozen one would go stale with nothing failing — the
  // defect this whole file is about. What is pinned is the CLASS and its two
  // controls.
  const liveWorkflows = readdirSync(nodePath.join(ROOT, '.github/workflows'))
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => ({ file: f, text: readFileSync(nodePath.join(ROOT, '.github/workflows', f), 'utf8') }));
  const dogfoodCard = 'packages/qa/dogfood/test/authz-probe-blind-spot.census.ts';
  const liveJobFiltered = jobFilteredSteps(liveWorkflows, [dogfoodCard]);
  // ⭐ THE POSITIVE CONTROL. This exact change set derived 43 commands with zero
  // mentions of dogfood while `Dogfood Regression Gate (3/3)` was red on a test
  // file in the same package. Both halves are asserted, for the reason the tail's
  // own retirement case states: the job being named is only meaningful while the
  // family derivation still names nothing for the step that runs its suite —
  // either half alone goes green for the wrong reason.
  const dogfoodRow = liveJobFiltered.rows.find((r) => r.job.startsWith('Dogfood Regression Gate'));
  t(
    'LIVE: the change set that produced a false "authored to green" claim now names the CI job that runs the package it edits',
    Boolean(dogfoodRow),
  );
  t(
    '...and names the invocation itself, not just the job — the one line the reader came for',
    Boolean(dogfoodRow) && dogfoodRow.steps.some((s) => s.commands.some((c) => c.includes('run test') && c.includes('--filter=@objectstack/dogfood'))),
  );
  t(
    '...while the family derivation still names NO check family for that step, which is why the block has to exist',
    Boolean(dogfoodRow)
      && dogfoodRow.steps.every((s) => extractCheckInvocations(s.commands.join('\n'), dogfoodRow.workflow).length === 0),
  );
  // ⭐ THE NEGATIVE CONTROL. A path no job's declared population covers must be
  // pointed at NO job. Without it every case above is satisfied by a walk that
  // names every job for every card, which is the "22 leads is the same as none"
  // failure this file's header prices.
  t(
    'LIVE: a repo-root document no job filter covers is pointed at no job at all',
    jobFilteredSteps(liveWorkflows, ['ROADMAP.md']).rows.length === 0,
  );
  t(
    '...and that negative is not a broken walk — the same walk finds jobs for a packages path',
    liveJobFiltered.rows.length > 0,
  );
  // The partition, live: every row is a step the family derivation names nothing
  // for, so a row that yields an invocation would mean this block and the family
  // list double-count the same step.
  t(
    'LIVE: no row yields a check invocation — this block and the family list are disjoint',
    liveJobFiltered.rows.every((r) => r.steps.every((s) => extractCheckInvocations(s.commands.join('\n'), r.workflow).length === 0)),
  );
  t('the live block renders without refusing', jobFilteredStepLines(liveJobFiltered.rows, liveJobFiltered.counts).length > 0);
  // ⛔ The block sits OUTSIDE the runnable total, and the enumeration that says
  // so is `outsideBlockNames` — the one place the list of outside blocks exists.
  t(
    'the block is NAMED among what sits outside the runnable total, and only while it has rows',
    outsideBlockNames({ jobFilteredJobs: 3 }).includes('the 3 path-scheduled CI job(s)')
      && !outsideBlockNames({ jobFilteredJobs: 0 }).some((n) => n.includes('path-scheduled')),
  );
  t(
    'and the count reaches that enumeration off the ARRAY that renders the block, never a recount of it',
    outsideBlockCounts(familyReconciliation({ jobFilteredRows: [{}, {}] })).jobFilteredJobs === 2,
  );

  // ── Type-check lanes (#19172): the negatives are the live over-matches a SUBSTRING reading produces here ──
  t('a `tsc --noEmit` or `-p <config>` invocation is a lane',
    isTypeCheckInvocation('pnpm --filter @objectstack/spec exec tsc --noEmit') && isTypeCheckInvocation('npx tsc -p tsconfig.test.json'));
  t('a `run typecheck` task is a lane whoever runs it',
    isTypeCheckInvocation("pnpm exec turbo run typecheck --filter='./packages/*'") && isTypeCheckInvocation("pnpm --filter './examples/*' run typecheck"));
  t('⛔ the two LEDGER families are NOT lanes — the substitution this block exists to break',
    !isTypeCheckInvocation('pnpm check:type-check-coverage') && !isTypeCheckInvocation('pnpm check:type-check-debt'));
  t('⛔ nor is prose that merely carries the word, which is both live over-matches',
    !isTypeCheckInvocation('echo "::error::Compiled test files found. A tsc-built package is"')
      && !isTypeCheckInvocation('console.log(`::error::type-check lane ${id} concluded ${result}.`);'));
  const laneWf = tailWf.replace('run: pnpm check:engine-double-contract', "run: pnpm exec turbo run typecheck --filter='./packages/*'")
    .replace('run: pnpm check:console-pin', 'run: pnpm --filter @objectstack/spec exec tsc --noEmit');
  const laneFix = typeCheckLaneSteps([{ file: 'fixture.yml', text: laneWf }]);
  t('a lane in an unconditional job is a row, and one in a CONDITIONAL job is KEPT and marked',
    laneFix.rows.some((r) => r.job === 'gates' && !r.conditional)
      && laneFix.rows.some((r) => r.job === 'conditional-job' && r.conditional) && laneFix.counts.conditional === 1,
    laneFix.rows.map((r) => `${r.job}:${r.conditional}`).join(' · '));
  t('a workflow with no pull_request trigger contributes no lane and is sized rather than dropped',
    typeCheckLaneSteps([{ file: 'p.yml', text: 'on:\n  push:\njobs:\n  t:\n    steps:\n      - run: pnpm run typecheck' }]).counts.nonPullRequestWorkflows === 1);
  const laneLines = typeCheckLaneLines(laneFix.rows, laneFix.counts);
  t('the heading sizes the surface and the block prints the narrowed prescription',
    laneLines[0].includes('2 CI step(s)') && laneLines.some((l) => l.includes('pnpm --filter <pkg> run typecheck')));
  t('⭐ an EMPTY walk renders LOUD rather than dropping the block',
    typeCheckLaneLines([], { prWorkflows: 7 })[0].includes('CAME BACK EMPTY')
      && typeCheckLaneLines([], { prWorkflows: 7 }).some((l) => l.includes('7 pull-request workflow(s)')));
  t('the closing enumeration names the block UNCONDITIONALLY, so an empty walk cannot hide it',
    outsideBlockNames({}).includes('the type-check lanes'));
  // ⭐ THE POSITIVE CONTROL, live, pinned BY NAME and ⛔ never by row count: a
  // count stays green while three of four lanes vanish. `Type Check · debt
  // ledger` is deliberately absent — its only `run:` IS the ledger family.
  const liveLanes = typeCheckLaneSteps(liveWorkflows);
  const liveLaneJobs = liveLanes.rows.map((r) => r.job);
  t('LIVE: every lane behind the required aggregate is found BY NAME, and no ledger family is mistaken for one',
    ['Type Check · source gates', 'Type Check · workspace', 'Type Check · consumer gates'].every((j) => liveLaneJobs.includes(j))
      && liveLanes.rows.every((r) => r.commands.every((c) => !c.includes('check:type-check'))),
    `${liveLaneJobs.join(' · ')} - walked ${liveLanes.counts.steps} step(s) / ${liveLanes.counts.runLines} run line(s)`);

  // ── The seam between this tool and its caller (#13462) ────────────────────
  //
  // Unit half first: the split and the footer are pure, so their edge cases are
  // cheap to pin here rather than hunted for in a live tree that may not have
  // one today. The END TO END half below is the part that cannot be faked —
  // both remedies are about what a real run puts on a real stream.
  // The filtered fixture names a REAL workspace package on purpose.
  // `check-pnpm-filter-targets` scans the whole tree for `pnpm --filter TARGET`
  // and requires the target to be a live package — it does NOT mask self-tests,
  // so an invented one here reddens that gate from inside this file's fixtures
  // (measured: `@x` did exactly that). A fixture is still a literal in the tree.
  const mixedSplit = spellingSplit([
    'pnpm check:a',
    'pnpm --filter @objectstack/lint run check:b',
    'node scripts/check-c.mjs',
  ]);
  t('spellingSplit counts both spellings', mixedSplit.total === 3 && mixedSplit.pnpm === 2 && mixedSplit.node === 1);
  // A third interpreter must be COUNTED, not folded into either side. The gate
  // corpus already runs steps under bash and python3, and a split that answered
  // "0 direct node" for one of those would be a confident zero about a spelling
  // it cannot see — the same failure the footer exists to prevent.
  const thirdSplit = spellingSplit(['pnpm check:a', 'bash scripts/os-verify-lock.sh --self-test']);
  t('a third interpreter lands in `other` rather than being miscounted', thirdSplit.other === 1 && thirdSplit.node === 0 && thirdSplit.pnpm === 1);
  t('and the footer names it rather than dropping it', spellingFooterLines(thirdSplit)[0].includes('1 neither'));
  // ⭐ CONTROL 3, as a pin: the footer must not hardcode "there is always a
  // direct form". On an all-pnpm block it has to SAY `0 direct node`.
  const pureFooter = spellingFooterLines(spellingSplit(['pnpm check:a', 'pnpm check:b', 'pnpm check:c']));
  t('the footer prints the direct-node term at ZERO on a pure-pnpm block', pureFooter[0] === '3 matched families — 3 pnpm, 0 direct node.');
  // ⭐ #13642: the heading names its SCOPE. This count is the matched block
  // alone, and spelled as a bare `N families` it was a subtotal in the
  // vocabulary of a total, printed directly under the rows a consumer
  // harvests — the line the two devs who dropped the convention block
  // reconciled against, successfully, on the wrong list.
  t('and it names the block it counts rather than claiming to be the total', pureFooter[0].startsWith('3 matched families'));
  t('and no line of it claims a bare `N families` total any more', !pureFooter.some((l) => /^\d+ families /.test(l)));
  // ...and the ⛔ warning is the half that must NOT fire there: on a block with
  // no direct row a one-spelling grep really does lose nothing, and a warning
  // that fires anyway trains the reader on a claim this run measured as false.
  t('and it does not warn about a shortfall that this block does not have', !pureFooter.some((l) => l.includes('⛔')));
  t('while a mixed block DOES warn, with both figures in it', spellingFooterLines(mixedSplit).some((l) => l.includes('⛔') && l.includes('2 of the 3')));
  t('an empty block gets no footer at all — a zero heading invites a hunt for rows that do not exist', spellingFooterLines(spellingSplit([])).length === 0);
  // The published snippet must not become a fabricated watch hint in this
  // file's OWN source. Both lines carry spaces, so the admission test rejects
  // them whole; this pins the property instead of trusting the reading.
  t('the published harvest snippet contributes no watch hint to this file', extractWatchHints(HARVEST_SNIPPET.join('\n')).length === 0);

  // commandsFor: matched UNION convention, deduped, sorted, nulls dropped.
  const cfRows = [{ command: 'pnpm check:b' }, { command: 'node scripts/check-a.mjs' }];
  const cfKinds = [{ kind: 'k', hits: ['f'], gates: [{ name: 'check:b', why: 'w', command: 'pnpm check:b' }, { name: 'check:gone', why: 'w', command: null }] }];
  const cfOut = commandsFor({ matchedRows: cfRows, kindGroups: cfKinds });
  t('commandsFor unions matched with convention-triggered gates', cfOut.length === 2 && cfOut.includes('pnpm check:b'));
  t('and deduplicates a family reached BOTH ways rather than listing it twice', cfOut.filter((c) => c === 'pnpm check:b').length === 1);
  t('and emits NOTHING for a STALE kind entry no workflow runs — never a fabricated command', !cfOut.some((c) => c.includes('gone')));
  t('and sorts, so two harvests of one tree are byte-comparable', cfOut.join('\n') === [...cfOut].sort().join('\n'));

  // ── The count reconciliation (#13642) ────────────────────────────────────
  //
  // The card: the human rendering places this answer in TWO differently shaped
  // sections, and two independent devs each harvested one of them, ran it
  // green, and reddened CI on a family the other section named. The remedy is
  // a total a consumer can ASSERT against — so what has to be pinned is not
  // that a line prints, but that its numbers cannot drift from the sections
  // they claim to reconcile. A count computed independently of those sections
  // would be an instrument that cannot fail toward its own target.
  {
    const rRows = [{ command: 'pnpm check:b' }, { command: 'node scripts/check-a.mjs' }];
    const rKinds = [
      { kind: 'k', hits: ['f'], gates: [{ name: 'check:b', why: 'w', command: 'pnpm check:b' }, { name: 'check:k1', why: 'w', command: 'pnpm check:k1' }] },
    ];
    const r = familyReconciliation({ matchedRows: rRows, kindGroups: rKinds });
    // ⭐ THE identity: the total is commandsFor's own answer, not a second count.
    t('the reconciliation total IS the commandsFor union, not a recount of it', r.total === commandsFor({ matchedRows: rRows, kindGroups: rKinds }).length);
    t('and its parts close against that total', r.matched + r.convention - r.both === r.total && r.total === 3);
    t('and a family reached BOTH ways is disclosed rather than double-counted', r.both === 1 && r.conventionOnly === 1);

    // ⭐ BOTH DIRECTIONS, which is what makes this a reconciliation rather than
    // a decoration: a family added to either input must move the section's own
    // term AND the total together. Pinned by moving one input at a time.
    const plusKind = familyReconciliation({
      matchedRows: rRows,
      kindGroups: [{ kind: 'k', hits: ['f'], gates: [...rKinds[0].gates, { name: 'check:k2', why: 'w', command: 'pnpm check:k2' }] }],
    });
    t('adding a convention family moves the convention term AND the total', plusKind.convention === r.convention + 1 && plusKind.total === r.total + 1);
    const plusMatched = familyReconciliation({ matchedRows: [...rRows, { command: 'pnpm check:m2' }], kindGroups: rKinds });
    t('adding a matched family moves the matched term AND the total', plusMatched.matched === r.matched + 1 && plusMatched.total === r.total + 1);
    // ...and SUPPRESSING a section is the direction the card was filed on.
    const noKinds = familyReconciliation({ matchedRows: rRows, kindGroups: [] });
    t('suppressing the convention section moves the convention term AND the total', noKinds.convention === 0 && noKinds.total === 2);
    const noMatched = familyReconciliation({ matchedRows: [], kindGroups: rKinds });
    t('suppressing the matched section moves the matched term AND the total', noMatched.matched === 0 && noMatched.total === 2);

    // A STALE kind row prints and contributes no command. The gap between rows
    // printed and families counted is DISCLOSED, because a consumer counting
    // printed rows against this total would otherwise find a discrepancy with
    // no explanation — which is the failure mode this line exists to remove.
    const staleRecon = familyReconciliation({
      matchedRows: [],
      kindGroups: [{ kind: 'k', hits: ['f'], gates: [{ name: 'check:live', why: 'w', command: 'pnpm check:live' }, { name: 'check:gone', why: 'w', command: null }] }],
    });
    t('a STALE convention row is counted in rows but not in families', staleRecon.conventionRows === 2 && staleRecon.convention === 1 && staleRecon.staleRows === 1);
    t('and the rendering DISCLOSES that gap rather than leaving the reader to find it', familyReconciliationLines(staleRecon).some((l) => l.includes('prints 2 rows for those 1') && l.includes('STALE')));

    // The invariant is meant to be unreachable by construction — the parts are
    // built from the SAME two expressions commandsFor unions. This drives that
    // claim over every shape the two inputs can take rather than asserting it
    // once: any future refactor that replaces either set with a second
    // traversal reddens here, which is the only way this line can go wrong.
    const pool = ['pnpm check:x', 'pnpm check:y', 'node scripts/check-z.mjs'];
    let closures = 0;
    for (let m = 0; m < 8; m += 1) {
      for (let k = 0; k < 8; k += 1) {
        const rows = pool.filter((_, i) => m & (1 << i)).map((command) => ({ command }));
        const gates = pool.filter((_, i) => k & (1 << i)).map((command) => ({ name: command, why: 'w', command }));
        const got = familyReconciliation({ matchedRows: rows, kindGroups: gates.length ? [{ kind: 'k', hits: ['f'], gates }] : [] });
        if (got.matched + got.convention - got.both === got.total && got.total === commandsFor({ matchedRows: rows, kindGroups: gates.length ? [{ kind: 'k', hits: ['f'], gates }] : [] }).length) closures += 1;
      }
    }
    t('the total and its parts close over EVERY overlap of the two inputs — 64 of 64', closures === 64);

    // The line's SPELLING, pinned because a consumer may come to assert against
    // it — the very migration this line is asking readers to make.
    const rl = familyReconciliationLines(r);
    t('the reconciliation line leads with the total in an assertable shape', /^Reconciliation — 3 famil\(ies\): this card's WHOLE runnable answer/.test(rl[0]));
    t('and spells the arithmetic that ties it to both sections', /^ {2}2 named by PATH \(the matched block\) \+ 2 named by change KIND \(the convention block\), 1 of them the same family reached both ways ⇒ 3 distinct\.$/.test(rl[1]));
    t('and names the machine-readable escape hatch inline, where a harvesting consumer is looking', rl.some((l) => l.includes('--commands prints exactly these 3')));
    // ⛔ The new number must not become a second "complete account of what CI
    // runs" — that would reproduce this card's own defect one layer up. Same
    // disclosure machineReadableOutput already makes on stderr.
    //
    // ⭐ Pinned NAME BY NAME, because the weaker shape is what failed. This case
    // used to ask only for the substring `always-runs tail`, so the sentence
    // could name three of the five blocks the same run printed and stay green
    // here for the whole time a harvester following it was missing two of them
    // (#16398). Every name below is its own assertion: dropping ONE reds.
    // Three DISTINCT counts (2 / 1 / 3), so a name wired to the wrong array
    // reds here instead of reading right by coincidence.
    const outsideRecon = familyReconciliation({
      matchedRows: rRows,
      kindGroups: rKinds,
      rosterRows: [{ check: 'check:r1' }, { check: 'check:r2' }],
      widePopulationRows: [{ check: 'check:w1' }],
      pendingRows: [{ check: 'check:p1' }, { check: 'check:p2' }, { check: 'check:p3' }],
    });
    // The enumeration is read case-insensitively per NAME, because the leading
    // name is raised to open the sentence; the exact rendered phrase is pinned
    // once, below, where that capitalisation is part of the spelling.
    const namesOutside = (line, names) => names.every((n) => (line ?? '').toLowerCase().includes(n.toLowerCase()));
    const outsideLine = familyReconciliationLines(outsideRecon).find((l) => l.includes('NOT a complete account of what CI runs'));
    t('the disclaimer of what sits outside the total is printed at all', Boolean(outsideLine));
    for (const name of [
      'the 2 artifact-roster famil(ies)',
      'the 1 declared WIDE-population famil(ies)',
      'the 3 pending-changeset famil(ies)',
      'the unreachable listing',
      'the type-check lanes',
      'the always-runs tail',
    ]) {
      t(`and it names "${name}" — every block printed below it, not a subset`, namesOutside(outsideLine, [name]));
    }
    // The SPELLING of the whole enumeration, in print order, pinned for the
    // reason the reconciliation line's own spelling is: a consumer may come to
    // assert against it, and the order is the claim — a reader walking down the
    // output meets the blocks in the order this line promised them.
    t('and spells them in the order they are PRINTED below, as one phrase', (outsideLine ?? '').includes(
      'The 2 artifact-roster famil(ies), the 1 declared WIDE-population famil(ies), the 3 pending-changeset famil(ies),'
        + ' the unreachable listing, the type-check lanes and the always-runs tail below are each OUTSIDE it, each with its own count.',
    ));
    // The THREE counts are the lengths of the arrays that RENDER those blocks,
    // so the enumeration cannot name a block the run did not print: at zero rows
    // artifactRosterLines, widePopulationLines and pendingChangesetLines all
    // return nothing, and a name pointing "below" at an absent heading is this
    // same defect reversed.
    const noBlocksLine = familyReconciliationLines(r).find((l) => l.includes('NOT a complete account of what CI runs'));
    t('and names NEITHER block on a run that printed neither', !(noBlocksLine ?? '').toLowerCase().includes('artifact-roster') && !(noBlocksLine ?? '').toLowerCase().includes('wide-population'));
    // ⭐ The third name was the one still spelled unconditionally after #16398:
    // `pendingChangesetLines` returns nothing at zero, so on a card with no
    // pending family the sentence pointed below at a heading that is not there
    // (#16795). It is conditional on its own count now, like the two above it.
    t('nor the pending-changeset block, whose heading is absent at zero too', !(noBlocksLine ?? '').toLowerCase().includes('pending-changeset'));
    t('...while still naming the three blocks that print unconditionally', namesOutside(noBlocksLine, ['the unreachable listing', 'the type-check lanes', 'the always-runs tail']));
    // ...and the CONTROL for that pair: a run with pending families and nothing
    // else names the third block and neither of the other two, so the case
    // above cannot be passing because the name went away for good.
    const pendingOnlyLine = familyReconciliationLines(familyReconciliation({
      matchedRows: rRows, kindGroups: rKinds, pendingRows: [{ check: 'check:p1' }, { check: 'check:p2' }],
    })).find((l) => l.includes('NOT a complete account of what CI runs'));
    t('and a run that printed ONLY the pending block names exactly that one', namesOutside(pendingOnlyLine, ['the 2 pending-changeset famil(ies)'])
      && !(pendingOnlyLine ?? '').toLowerCase().includes('artifact-roster') && !(pendingOnlyLine ?? '').toLowerCase().includes('wide-population'));
    // The ZERO-total branch renders the SAME list from the SAME expression: a
    // card with no runnable family of its own still owes every block below, and
    // two branches spelling this claim separately is how it drifted before.
    const zeroOutside = familyReconciliationLines(familyReconciliation({
      matchedRows: [], kindGroups: [], rosterRows: [{ check: 'check:r1' }], widePopulationRows: [{ check: 'check:w1' }],
      pendingRows: [{ check: 'check:p1' }],
    }));
    t('the zero branch enumerates the same blocks rather than naming one of them', zeroOutside.some((l) => namesOutside(l, [
      'the 1 artifact-roster famil(ies)',
      'the 1 declared WIDE-population famil(ies)',
      'the 1 pending-changeset famil(ies)',
      'the unreachable listing',
      'the type-check lanes',
      'the always-runs tail',
    ])));
    // ...and the SHORT-harvest warning is conditional, on the rule the ⛔
    // spelling warning already follows: on a card with no convention-only
    // family, a warning that one section is short is a claim this run measured
    // as false.
    t('the short-harvest warning fires where a section really is droppable', rl.some((l) => l.includes('A harvest that ends at ONE section')));
    t('and NOT on a card whose whole answer is one section', !familyReconciliationLines(noKinds).some((l) => l.includes('A harvest that ends at ONE section')));

    // ⭐ Printed at ZERO, deliberately unlike spellingFooterLines. An absent
    // number is not assertable, and its absence would mean two things at once:
    // "this card owes no gates" and "this build has no reconciliation line".
    const zero = familyReconciliationLines(familyReconciliation({ matchedRows: [], kindGroups: [] }));
    t('the reconciliation prints at ZERO rather than falling silent', zero.length > 0 && zero[0].startsWith('Reconciliation — 0 famil(ies)'));
    t('and says the derivation COMPLETED, so an empty answer cannot read as a missing one', zero[0].includes('COMPLETED'));

    // The footer's forward pointer is fed the SAME structure, so the two
    // renderings cannot disagree about how many families sit outside the block.
    const fwd = spellingFooterLines(spellingSplit(['pnpm check:b', 'node scripts/check-a.mjs']), r);
    t('the matched footer names the whole total and the families outside its block', fwd.some((l) => l.includes('is 2 of the 3 this card owes') && l.includes('1 more famil(ies)')));
    t('and stays silent about a convention block that this card does not have', !spellingFooterLines(spellingSplit(['pnpm check:b']), noKinds).some((l) => l.includes('this card owes')));
  }

  // changeKindLines must be a RENDERING of changeKindGates, not a second walk.
  {
    const kinds = [{ kind: 'a kind', matches: (x) => x.endsWith('.ts'), gates: [{ name: 'check:x', why: 'because' }] }];
    const resolve = () => 'pnpm check:x';
    const groups = changeKindGates(['a.ts'], resolve, kinds);
    const rendered = changeKindLines(['a.ts'], resolve, kinds);
    t('changeKindGates and changeKindLines agree on the gate rows', groups[0].gates.length === rendered.filter((l) => l.startsWith('    - ')).length);
    t('and a STALE name still renders its warning through the shared shape', changeKindLines(['a.ts'], () => null, kinds).some((l) => l.includes('STALE')));
  }

  // The whole-tree channel is in `--commands` and NOT in the matched block
  // the published snippet harvests, so the two agree only once it is
  // subtracted (#14189). Read off the REAL rendering, like everything else
  // in this block: a hardcoded count here would be a second copy of a fact
  // the tool derives, drifting the day a gate declares or stops declaring.
  const declaredWholeTreeCommands = (humanText) => (humanText ?? '')
    .split('\n')
    .filter((l) => l.includes('   declared whole-tree population — '))
    .map((l) => l.replace(/^ {2}- (.*?) {3}\[.*$/, '$1'));

  slow("end to end on the real CLI and the real tree, the CI-measured family included", () => {
  // ── END TO END, on the real CLI and the real tree ─────────────────────────
  //
  // Everything above drives the pure halves, and all of it stays green if the
  // call site in `derive` is dropped or hidden behind a flag no brief tells
  // anyone to pass — which is the whole defect. Only a real run can tell them
  // apart, and only a real run can measure the two REMEDIES against each other.
  {
    // The card has to be one NO convention KIND hits, so the only difference
    // between the snippet's block harvest and `--commands` is the SPELLING
    // split this pair measures; the strictly-better direction is driven
    // separately, on `testCard` below, and conflating the two would leave
    // neither measured. This was `measure-durability-swallow-family.mjs` until
    // #13919 wired that instrument's controls as `check:swallow-census-controls`
    // — which made it a GATE SCRIPT, so the "adds or edits a GATE SCRIPT"
    // convention started hitting it and the two counts stopped agreeing for a
    // reason that is not about spelling at all. ⛔ Do not repair a future
    // recurrence by loosening the equality: repoint the card, and pick one that
    // no check family runs.
    const seamCard = 'scripts/measure-partial-retirement-annotation.mjs';
    const humanRun = runCli([seamCard]);
    const humanOut = humanRun.stdout ?? '';
    t('the seam card still derives at all', humanRun.status === 0 && humanOut.trim().length > 0);
    // 形 2, in the DEFAULT output. No flag: the footer is the control for
    // consumers who have not migrated, so it is worth nothing behind a flag.
    const footerLine = humanOut.split('\n').find((l) => /^\d+ matched families — \d+ pnpm, \d+ direct node\.$/.test(l));
    t('the DEFAULT run prints the spelling distribution in its own footer', Boolean(footerLine));
    t('and the distribution is a SPLIT, not a bare count — the count alone signs off on the wrong list', /\d+ pnpm, \d+ direct node/.test(footerLine ?? ''));

    // ⭐ The published snippet must SURVIVE the footer. It ends the block at the
    // first empty line, so a footer butted against the rows would be harvested
    // as rows — the remedy breaking the transition it exists to cover. Driven
    // with the real awk and sed, because a reimplementation in JS would be
    // pinning this file's idea of the snippet rather than the snippet.
    // The snippet reads `gates.txt`; feed it the same bytes under that name.
    const harvestTmp = mkdtempSync(nodePath.join(tmpdir(), 'dg-harvest-'));
    try {
      writeFileSync(nodePath.join(harvestTmp, 'gates.txt'), humanOut);
      const real = spawnSync('bash', ['-c', HARVEST_SNIPPET.join('\n')], { encoding: 'utf8', cwd: harvestTmp });
      const harvestedRows = (real.stdout ?? '').split('\n').filter(Boolean);
      t('the published snippet still runs against a real rendering', real.status === 0 && harvestedRows.length > 0);
      t(
        'and the footer did NOT leak into it — every harvested row is a runnable command',
        harvestedRows.every((l) => /^(pnpm|node) \S/.test(l)),
      );
      // 形 1 vs the transition, measured against each other on one input.
      const cmdRun = runCli(['--commands', seamCard]);
      const cmdRows = (cmdRun.stdout ?? '').split('\n').filter(Boolean);
      t('--commands answers', cmdRun.status === 0 && cmdRows.length > 0);
      t('and stdout is commands and NOTHING else — no heading, no annotation, no blank-line block to parse', cmdRows.every((l) => /^(pnpm|node) \S/.test(l)));
      // The declaring families are the ONE documented difference between the
      // two lists on a card no convention kind hits: they are in the union
      // because every card owes them, and out of the matched block because a
      // row on every card is not a lead. Subtracted here, and the subtraction
      // is pinned as NON-EMPTY below so this cannot quietly become a no-op.
      const seamAlwaysRuns = declaredWholeTreeCommands(humanOut);
      t(
        'the whole-tree channel really is on this card, so the subtraction below is not vacuous',
        seamAlwaysRuns.length > 0 && seamAlwaysRuns.every((c) => cmdRows.includes(c)),
      );
      t(
        'and none of them is in the matched block the snippet harvests — placed by declaration, never as a lead',
        seamAlwaysRuns.every((c) => !harvestedRows.includes(c)),
      );
      const cmdRowsNoAlwaysRuns = cmdRows.filter((l) => !seamAlwaysRuns.includes(l));
      t(
        'and it agrees exactly with the published snippet on this card, once the declared whole-tree families are subtracted',
        [...cmdRowsNoAlwaysRuns].sort().join('\n') === [...harvestedRows].sort().join('\n'),
      );
      // ⭐ CONTROL 1 and CONTROL 2 as ONE assertion pair, on ONE input. A new
      // mode returning the full list proves nothing on its own if the old
      // harvest would have too — the defect has to still be there for the
      // bypass to be the thing that fixed it.
      const blockRows = harvestedRows.length;
      const oldHarvest = harvestedRows.filter((l) => l.startsWith('pnpm check:')).length;
      t('CONTROL: the OLD one-spelling harvest is still SHORT on this input — the defect is real and untouched', oldHarvest < blockRows);
      t(
        'CONTROL: and --commands returns the FULL list on that same input — the block, plus the whole-tree families the block cannot carry',
        cmdRows.length === blockRows + seamAlwaysRuns.length,
      );
      t('and the rows the old harvest drops are exactly the ones spelled the other way', blockRows - oldHarvest === harvestedRows.filter((l) => l.startsWith('node ')).length);
    } finally {
      rmSync(harvestTmp, { recursive: true, force: true });
    }

    // ⭐ Where --commands is strictly BETTER than the snippet, not merely equal:
    // the snippet reads the matched block alone and drops the convention block
    // printed beneath it. Driven on a card KIND that really hits.
    const testCard = 'packages/spec/scripts/authorable-defaults.test.ts';
    const convCmd = (runCli(['--commands', testCard]).stdout ?? '').split('\n').filter(Boolean);
    const convHuman = runCli([testCard]).stdout ?? '';
    const convBlock = convHuman
      .slice(convHuman.indexOf('Local gates for this card'))
      .split('\n\n')[0]
      .split('\n')
      .filter((l) => l.startsWith('  - '))
      .map((l) => l.replace(/^ {2}- (.*) {3}\[.*$/, '$1'));
    t('a convention-triggered card is really convention-triggered', /^Convention-triggered gates/m.test(convHuman));
    t('--commands carries the convention gates the block-only harvest drops', convCmd.length > convBlock.length);
    t('and every one of the extra rows is runnable', convCmd.every((l) => /^(pnpm|node) \S/.test(l)));

    // ── The reconciliation, END TO END on that same card (#13642) ───────────
    //
    // Everything in the unit half stays green if the call site in `derive` is
    // dropped, printed behind a flag, or fed a structure the sections did not
    // come from. Only a real run can tell those apart, and this is the card
    // shape the two incidents happened on: a matched block AND a convention
    // block, with the answer split across them.
    const reconLine = convHuman.split('\n').find((l) => l.startsWith('Reconciliation — '));
    t('the DEFAULT run prints the reconciliation — no flag, because a control behind a flag is worth nothing', Boolean(reconLine));
    const reconTotal = Number((reconLine ?? '').match(/^Reconciliation — (\d+) famil/)?.[1] ?? NaN);
    // ⭐ THE assertion the card asks for: the stated total is the SAME number
    // --commands answers with. If the human block and the machine-readable
    // mode can disagree, the line is a second answer rather than a control.
    t('and its total is exactly what --commands returns for the same card', reconTotal === convCmd.length);
    // ...and each term is the section it names, counted off the REAL rendering.
    const reconParts = (convHuman.split('\n').find((l) => /named by PATH \(the matched block\)/.test(l)) ?? '').match(
      /^ {2}(\d+) named by PATH .* \+ (\d+) named by change KIND/,
    );
    t('the PATH term equals the rows the published snippet harvests from the matched block', Number(reconParts?.[1]) === convBlock.length);
    const convSectionCommands = new Set(
      convHuman
        .slice(convHuman.indexOf('Convention-triggered gates'))
        .split('\n')
        .filter((l) => /^ {4}- (pnpm|node) /.test(l))
        .map((l) => l.replace(/^ {4}- (.*?) {3}— .*$/, '$1')),
    );
    t('and the change-KIND term equals the distinct runnable rows the convention block really printed', Number(reconParts?.[2]) === convSectionCommands.size);

    // ⭐ CONTROL: the defect is STILL THERE and the line is what detects it.
    // A one-section harvest of this card is short — that is the untouched
    // defect — and the number a consumer would now assert against does not
    // match it. Both halves on one input: without the first, the second proves
    // nothing; without the second, the first is only a restatement of the bug.
    t('CONTROL: a matched-block-only harvest of this card is STILL short — the defect is real and untouched', convBlock.length < convCmd.length);
    // `Number.isInteger` is not decoration. Measured while ablating the call
    // site out of `derive`: with no line printed `reconTotal` is NaN, and
    // `NaN !== convBlock.length` is TRUE — so this case passed while the
    // remedy was absent, which is the instrument-cannot-fail-toward-its-target
    // shape the whole card is about. The detector has to have READ a number
    // before it can claim to have detected anything with it.
    t(
      'CONTROL: and the reconciliation total DETECTS that harvest as short rather than agreeing with it',
      Number.isInteger(reconTotal) && reconTotal !== convBlock.length,
    );
    // The same detection offered at the harvest SITE, where a consumer who
    // never scrolls past the matched block still meets it.
    t('the matched footer forward-points to that total from inside the block being harvested', convHuman.includes(`this card owes`) && convHuman.includes(`carries the ${reconTotal}`));
    // ⛔ ...and the footer must no longer spell its own subtotal as a total.
    t('and the footer no longer prints a bare `N families` line for a harvest to reconcile against', !/^\d+ families /m.test(convHuman));

    // --json: one document, and the omission it makes is DISCLOSED rather than
    // silent — which is the card's own subject matter.
    const jsonRun = runCli(['--json', seamCard]);
    let doc = null;
    try {
      doc = JSON.parse(jsonRun.stdout ?? '');
    } catch {
      doc = null;
    }
    t('--json puts a single parseable document on stdout', jsonRun.status === 0 && doc !== null);
    t('and it carries the runnable list, agreeing with --commands', Boolean(doc) && doc.commands.join('\n') === (runCli(['--commands', seamCard]).stdout ?? '').trim());
    t('and the spelling split travels with it', Boolean(doc) && doc.spelling.total === doc.commands.length);
    t('and it names the tree it is about, as the banner does', Boolean(doc) && doc.commit !== null);
    t(
      'the pending-changeset families are DISCLOSED under their own key rather than silently missing',
      Boolean(doc) && Array.isArray(doc.pendingChangeset.families),
    );
    t(
      'and they are kept OUT of commands — they name a path that does not exist yet',
      Boolean(doc) && doc.pendingChangeset.families.every((f) => !doc.commands.includes(f.command)),
    );
    // The machine modes must keep stdout clean in BOTH directions: the banner
    // and the accounting belong on stderr, or a consumer redirecting stdout
    // gets prose back and is filtering again — the hazard, reintroduced.
    const cmdRun2 = runCli(['--commands', seamCard]);
    t('the banner stays off stdout in --commands', !(cmdRun2.stdout ?? '').includes('gate list derived from the tree of'));
    t('and the accounting of what was left out is on stderr, where it cannot corrupt the harvest', (cmdRun2.stderr ?? '').includes('always-runs tail'));
    t('and that accounting names the pending families too, so the omission is out loud', (cmdRun2.stderr ?? '').includes("once this card's changeset exists"));
    // Two answers to "what shape is stdout" is no answer.
    const bothRun = runCli(['--commands', '--json', seamCard]);
    t('passing both stdout spellings refuses instead of silently preferring one', bothRun.status === 2 && (bothRun.stdout ?? '').trim() === '');
    // ⭐ The THIRD stdout shape (#14294). The pair above was enforced and this
    // one was not: `mode` was computed and then discarded, so these two exited
    // 0 with tier prose sitting in the file a consumer had redirected because
    // `--commands` promises commands and nothing else. Driven on the real CLI
    // for the same reason the pair above is — the defect was in the argv chain,
    // which no pure half reaches. Both halves of the refusal are asserted: the
    // STATUS, and the stdout a redirecting consumer would have kept, because a
    // refusal that still prints an answer is the bug wearing an exit code.
    const tierCmdRun = runCli(['--tier', '--commands', seamCard]);
    t('⭐ --tier against --commands refuses instead of silently preferring the tier', tierCmdRun.status === 2 && (tierCmdRun.stdout ?? '').trim() === '');
    t('and its refusal names BOTH flags, so the dropped one is never left to be guessed', (tierCmdRun.stderr ?? '').includes('--tier') && (tierCmdRun.stderr ?? '').includes('--commands'));
    const tierJsonRun = runCli(['--tier', '--json', seamCard]);
    t('⭐ --tier against --json refuses the same way, on the other machine-readable shape', tierJsonRun.status === 2 && (tierJsonRun.stdout ?? '').trim() === '');
    t('and that refusal names --json, never the flag this run is not about', (tierJsonRun.stderr ?? '').includes('--json') && !(tierJsonRun.stderr ?? '').includes('--commands'));
    // CONTROL: green before this fix and after it. The new branch is ordered
    // after the pair, so all three flags together still answer with the pair's
    // own message — the fix adds a refusal and rewords none.
    const allThreeRun = runCli(['--tier', '--commands', '--json', seamCard]);
    t('CONTROL: all three together keep the pair rule that was already enforced', allThreeRun.status === 2 && (allThreeRun.stderr ?? '').includes('--commands and --json'));
    // ⭐ The MODIFIER axis (#14753), which neither pair above reaches: --residue
    // is read only by the `derive` call the --tier branch never makes, so the
    // flag was evaluated nowhere at exit 0.
    //
    // ⛔ The CONTROL is not optional and must not be dropped as redundant: under
    // --tier the two runs are byte-IDENTICAL, and byte-identical is
    // indistinguishable from "the flag had nothing to add here" unless the same
    // flag is first shown to change the answer when the derivation does run.
    // The plain side of that control is `humanOut` above — the identical
    // invocation, already spawned; a second run of it would be a full
    // derivation of this tree to re-measure what that one measured, and two
    // runs could disagree.
    const residueRun = runCli(['--residue', seamCard]);
    t(
      'CONTROL: --residue changes the derivation output when the derivation runs',
      residueRun.status === 0 && (residueRun.stdout ?? '').length > 0 && (residueRun.stdout ?? '') !== humanOut,
    );
    const tierResidueRun = runCli(['--tier', '--residue', seamCard]);
    t('⭐ --tier against --residue refuses instead of dropping the modifier in silence', tierResidueRun.status === 2 && (tierResidueRun.stdout ?? '').trim() === '');
    t(
      'and that refusal names --tier AND --residue, so the dropped one is never left to be guessed',
      (tierResidueRun.stderr ?? '').includes('--tier') && (tierResidueRun.stderr ?? '').includes('--residue'),
    );
    // ⭐ #15036 — the OTHER half of that refusal, and the half a refusal cannot
    // carry: the usage line the tool prints when it cannot derive a change set
    // presented the pair above as legal. `--residue` sat outside the
    // alternation, which is this notation's way of saying it combines with
    // every member. Pinned on the constant rather than on a run, because the
    // print site is reached only where `changedPathsFromGit()` refuses.
    t(
      '⭐ the usage line no longer presents --residue as combinable with --tier (#15036)',
      !USAGE_LINE.includes('[--residue] [--tier'),
    );
    t(
      '…and it still offers --residue with the three modes it really does modify',
      USAGE_LINE.includes('[--tier | [--residue] [--commands | --json | --ran <file>]]'),
    );
    t(
      '…and every mode the argv chain accepts is still named in it, so the fix narrowed the grammar and dropped no flag',
      ['--tier', '--residue', '--commands', '--json', '--ran', '--repo', '--changed', '--self-test']
        .every((flag) => USAGE_LINE.includes(flag)),
    );
    // ⭐ #14870 — the mirror-image fix: `--changed` sat OUTSIDE the alternation
    // as a whole-invocation alternative, which reads as excluding every mode
    // beside it, though `--changed --commands` is legal and answers (CONTROL
    // below). Moved to the position `<path> ...` occupies, the other path
    // source it stands in for.
    t(
      '⭐ the usage line no longer presents --changed as a whole-invocation alternative that takes no other flag (#14870)',
      !USAGE_LINE.includes('] | --changed | --self-test'),
    );
    t(
      '…and it still offers --changed where <path> ... sits, combining with the modes before it',
      USAGE_LINE.includes('[<path> ... | --changed]'),
    );
    // CONTROL: --changed really does combine with a stdout-shape flag — the
    // usage-line fix above would otherwise be cosmetic on a refusal that does
    // not exist.
    //
    // ⛔ The claim is about the COMBINATION — that it PARSES and REACHES the
    // derivation — so it must not be hostage to whether the tree this run
    // happens to stand in has a diff. The first spelling demanded
    // `status === 0`, which made the verdict a property of the caller's tree:
    // where HEAD equals origin/main the derivation refuses BY DESIGN (exit 2,
    // the NO_DIFF_REFUSAL sentence) and the case went red with nothing wrong
    // with the tool. That is not only the fresh-worktree baseline it was found
    // on. `main`'s own `push` run of lint.yml has exactly that shape — the
    // pushed head IS origin/main — so every push to main was red at this
    // file's gate step from the commit that added this case until this one,
    // while the `merge_group` run of the same head stayed green because a
    // queue branch HAS a diff (#15278).
    //
    // Both outcomes prove the claim, and nothing else does: exit 0 with a
    // command list, or the exit-2 refusal that ONLY the derivation reaches. An
    // illegal combination never gets that far — argv refuses it first, with
    // its own sentence at the same exit code — which is why the predicate
    // matches on the sentence and never on the code alone, and why the
    // POSITIVE CONTROL below puts an illegal run through the SAME predicate
    // and requires it to FAIL. A case widened to accept a second outcome is
    // one reading away from accepting every outcome; that reading is made
    // here, mechanically, instead of being left to the next author's eye.
    const reachedDerivation = (run) =>
      (run.status === 0 && (run.stdout ?? '').length > 0)
      || (run.status === 2 && (run.stderr ?? '').includes(NO_DIFF_REFUSAL));
    const changedCommandsRun = runCli(['--changed', '--commands']);
    t(
      'CONTROL: --changed --commands parses and REACHES the derivation, so the moved usage line describes a real combination'
        + ' — exit 0 with commands, or the exit-2 no-diff refusal on a tree that has nothing to derive (#15278)',
      reachedDerivation(changedCommandsRun),
    );
    // POSITIVE CONTROL: the predicate above still REJECTS a combination the
    // argv chain refuses before any derivation runs. `--changed` with a path is
    // that combination — the two input modes answer different questions — and
    // its refusal carries a different sentence at the same exit 2, which is
    // exactly the confusion the predicate has to survive.
    // The changed-line reading on a DERIVED run, end to end (2026-09-18
    // ruling): stdout carries the measured line beside the tier verdict and
    // stderr's provenance carries the count — or the same no-diff refusal.
    const tierDerivedRun = runCli(['--tier']);
    t(
      '--tier with no paths derives the change set and prints the MEASURED changed-lines line beside the tier verdict'
        + ' — or the exit-2 no-diff refusal on a tree that has nothing to derive',
      (tierDerivedRun.status === 0 && (tierDerivedRun.stdout ?? '').includes('Changed lines — ')
        && !(tierDerivedRun.stdout ?? '').includes('NOT MEASURED') && (tierDerivedRun.stderr ?? '').includes('changed lines:'))
        || (tierDerivedRun.status === 2 && (tierDerivedRun.stderr ?? '').includes(NO_DIFF_REFUSAL)),
      { status: tierDerivedRun.status, out: (tierDerivedRun.stdout ?? '').slice(0, 300), err: (tierDerivedRun.stderr ?? '').slice(0, 300) },
    );
    const jsonExplicitRun = runCli(['--json', 'packages/spec/src/index.ts']);
    let jsonExplicitDoc = null;
    try { jsonExplicitDoc = JSON.parse(jsonExplicitRun.stdout ?? ''); } catch { /* asserted below */ }
    t('--json on an explicit path list carries changedLines as NOT MEASURED with the ruled threshold, never as a zero',
      jsonExplicitRun.status === 0 && jsonExplicitDoc?.changedLines?.measured === false && jsonExplicitDoc?.changedLines?.threshold === HUMAN_MERGE_LINE_THRESHOLD
        && jsonExplicitDoc?.changedLines?.changedLines === null,
      (jsonExplicitRun.stdout ?? '').slice(0, 200));
    const changedPathRun = runCli(['--changed', '--commands', seamCard]);
    t(
      '…and that same predicate REJECTS the illegal --changed-with-a-path combination, so no parse failure can satisfy the control above',
      !reachedDerivation(changedPathRun)
        && changedPathRun.status === 2
        && (changedPathRun.stderr ?? '').includes('--changed derives the paths itself')
        && !(changedPathRun.stderr ?? '').includes(NO_DIFF_REFUSAL),
    );
  }

  // ── END TO END: the CI-measured family, on the card it was measured on (#14004)
  //
  // Everything in the unit half above stays green if the split in `derive` is
  // dropped, or if the row is filtered out of `--commands` but left in the
  // block a dev pastes. Only a real run on a real card can tell those apart,
  // and this is the card the defect was measured on: `.claude/agents/**` is the
  // highest-traffic governed surface here, so every dev on it met the row.
  {
    const guardCard = '.claude/agents/os-dev.md';
    const guardCommand = 'node scripts/pm/check-governed-queue-guard.mjs';
    const run = runCli([guardCard]);
    const out = run.stdout ?? '';
    t('the card still derives at all', run.status === 0 && out.includes('Local gates for this card'));
    // ⭐ CONTROL: the family is still MATCHED — the fix is a marking, not a
    // disappearance. Without this case, a rule that dropped the family from the
    // derivation entirely would pass every case below it.
    t('CONTROL: the queue-guard family is still derived for this card', out.includes(guardCommand));
    // The block a dev pastes, harvested with the REAL published snippet, must
    // no longer contain it.
    // ONE `--commands` run, read by three cases below. Each CLI spawn is a
    // full derivation of this tree (~30s on a contended box), so a second run
    // for a second reading would be a minute of fleet compute to answer a
    // question this run already answered — and two runs could disagree.
    const cmdRun = runCli(['--commands', guardCard]);
    const harvestTmp = mkdtempSync(nodePath.join(tmpdir(), 'dg-cionly-'));
    try {
      writeFileSync(nodePath.join(harvestTmp, 'gates.txt'), out);
      const harvested = (spawnSync('bash', ['-c', HARVEST_SNIPPET.join('\n')], { encoding: 'utf8', cwd: harvestTmp }).stdout ?? '')
        .split('\n')
        .filter(Boolean);
      t('the published harvest of the pasted block no longer yields the CI-measured command', harvested.length > 0 && !harvested.includes(guardCommand));
      const cmdRows = (cmdRun.stdout ?? '').split('\n').filter(Boolean);
      t(
        '--commands omits it too, and the two renderings still agree exactly once the declared whole-tree families are subtracted',
        !cmdRows.includes(guardCommand)
          && [...cmdRows.filter((l) => !declaredWholeTreeCommands(out).includes(l))].sort().join('\n')
            === [...harvested].sort().join('\n'),
      );
      t('and every command still on the list is one a dev can actually run here', cmdRows.length > 0 && cmdRows.every((l) => /^(pnpm|node) \S/.test(l)));
      t('the stderr accounting says the omission out loud, where it cannot corrupt the harvest', (cmdRun.stderr ?? '').includes('CI-MEASURED ONLY'));
      // ⭐ #14880's block, on the same real run. Three claims, and the third is
      // the one a unit case cannot make: the block exists, it is on STDERR, and
      // not one of the families it names leaked into the stream a consumer
      // executes. A block on stdout would be prose in the harvest — the exact
      // hazard `--commands` exists to make unreachable.
      const rosterBlockStart = (cmdRun.stderr ?? '').indexOf('Artifact rosters —');
      t('⭐ the artifact-roster block is printed for a real card (#14880)', rosterBlockStart >= 0);
      t('…on stderr, never in the stream a harvest executes', !(cmdRun.stdout ?? '').includes('Artifact rosters —'));
      const rosterBlockCommands = (cmdRun.stderr ?? '')
        .slice(rosterBlockStart < 0 ? 0 : rosterBlockStart)
        .split('\n')
        .filter((l) => /^\s+- (pnpm|node) /.test(l))
        .map((l) => l.trim().slice(2).split('   ')[0].trim());
      t('…and it really names families, so the two cases above judge something', rosterBlockCommands.length > 0);
      t(
        '⛔ and not one of them is in the runnable list — the block sits BESIDE the derivation, never inside it',
        rosterBlockCommands.every((c) => !cmdRows.includes(c)),
        rosterBlockCommands.filter((c) => cmdRows.includes(c)).join(', '),
      );
    } finally {
      rmSync(harvestTmp, { recursive: true, force: true });
    }
    // ...and the family is still NAMED, under its own heading, with the reason
    // a reader can check against the gate. Dropping a gate quietly is the
    // failure this whole file refuses; marking it is the remedy.
    const ciSection = out.slice(out.indexOf('CI-measured only —'));
    t('the human rendering names it under its own CI-measured heading', out.includes('CI-measured only — matched by path'));
    t('with its command, its workflow and its matched-via provenance intact', ciSection.includes(guardCommand) && ciSection.includes('governed-surface-guard.yml') && ciSection.includes(`matched via ${guardCard}`));
    t('and the reason names the payload variable the classification was read from', ciSection.includes('GITHUB_EVENT_PATH'));
    // --json: the same row, flagged rather than absent.
    const jsonRun = runCli(['--json', guardCard]);
    let guardDoc = null;
    try {
      guardDoc = JSON.parse(jsonRun.stdout ?? '');
    } catch {
      guardDoc = null;
    }
    const guardRow = guardDoc?.matched?.find((r) => r.command === guardCommand);
    t('--json carries the family as a matched row rather than dropping it', Boolean(guardRow));
    t('and flags it, so a machine consumer reads the omission instead of inferring it', guardRow?.ciOnly?.env === 'GITHUB_EVENT_PATH');
    t('and keeps it out of the runnable list, which is the same list --commands prints', Boolean(guardDoc) && !guardDoc.commands.includes(guardCommand));
  }
  });


  // ── The RUN reconciliation: harvested ⟶ EXECUTED (#13774) ─────────────────
  //
  // Three measured mechanisms produced three confident, well-formed, FALSE
  // claims of complete coverage, and each one has cases here: no comparison at
  // all, a fuzzy comparison, and an arithmetic over the runner's own counter.
  // The unit half below drives the pure functions; the end-to-end half at the
  // bottom builds the record BY CONSTRUCTION from a real `--commands` run,
  // which is the property the whole design rests on.
  {
    const marker = RUN_RECORD_UNMEASURED_MARKER;
    const sep = RUN_RECORD_REASON_SEPARATOR;

    // ── The record format: what is decoded, and what is content ─────────────
    const parsed = parseRunRecord(
      [
        'pnpm check:a',
        '',
        '   ',
        '# a comment the runner left for itself',
        'node scripts/check-b.mjs\r',
        `${marker} pnpm check:c${sep}refuses without a built dist — its own stated prerequisite`,
      ].join('\n'),
    );
    t('a plain line is a ran claim, byte for byte', parsed[0].command === 'pnpm check:a' && parsed[0].claim === 'ran');
    t('blank and whitespace-only lines carry no command and are skipped', parsed.length === 3);
    t('a comment line is skipped — no runnable invocation starts with a hash', !parsed.some((e) => e.raw.startsWith('#')));
    t(
      'a CRLF line loses its terminator and NOTHING else',
      parsed[1].command === 'node scripts/check-b.mjs' && !parsed[1].command.includes('\r'),
    );
    t(
      `a ${marker} claim parses into its command and its reason`,
      parsed[2].claim === 'not-measured' && parsed[2].command === 'pnpm check:c' && parsed[2].reason.startsWith('refuses without'),
    );
    // ⭐ The exactness rule, in the parser: whitespace INSIDE a line is content,
    // and trimming it would be a normalisation applied to one side of the
    // comparison only — the fuzzy shape wearing a smaller hat.
    t('leading whitespace is NOT trimmed away into a match', parseRunRecord('  pnpm check:a')[0].command === '  pnpm check:a');
    t(
      `the ${marker} marker is exact and case-sensitive — a command merely containing the word is a ran claim`,
      parseRunRecord('pnpm check:not-measured-things')[0].claim === 'ran'
        && parseRunRecord(`not-measured pnpm check:a${sep}x`)[0].claim === 'ran',
    );
    const unreasoned = parseRunRecord([`${marker} pnpm check:a`, `${marker} pnpm check:b${sep}   `].join('\n'));
    t(
      `a ${marker} claim with no reason, and one with an empty reason, are both MALFORMED and still name their command`,
      unreasoned.every((e) => e.malformed && e.reason === null) && unreasoned[0].command === 'pnpm check:a' && unreasoned[1].command === 'pnpm check:b',
    );

    // ── The OPTIONAL exit-code annotation (#17204) ──────────────────────────
    //
    // ⭐ The compatibility property FIRST, because it is the condition the
    // shape was chosen under: the record format is written BY HAND by other
    // seats, so a field that re-read any line they have already written would
    // not be a fix. Every case below is about a line NOT changing.
    const preExisting = parseRunRecord(
      ['pnpm check:a', '  pnpm check:b', `${marker} pnpm check:c${sep}refuses without a built dist`, '# note', ''].join('\n'),
    );
    t(
      '⭐ a record written before this field existed parses byte-identically — same commands, same classes, no exit code',
      preExisting.length === 3
        && preExisting[0].command === 'pnpm check:a' && preExisting[0].claim === 'ran' && preExisting[0].exitCode === null
        && preExisting[1].command === '  pnpm check:b' && preExisting[1].exitCode === null
        && preExisting[2].claim === 'not-measured' && preExisting[2].command === 'pnpm check:c' && preExisting[2].reason === 'refuses without a built dist',
    );
    const coded = parseRunRecord(['pnpm check:a :: exit 0', 'pnpm check:b :: exit 3', 'node scripts/check-c.mjs --flag :: exit 143'].join('\n'));
    t(
      'a recorded exit code is split off the tail, leaving the command byte-exact on the left of it',
      coded.map((e) => e.command).join('|') === 'pnpm check:a|pnpm check:b|node scripts/check-c.mjs --flag'
        && coded.map((e) => e.exitCode).join('|') === '0|3|143',
    );
    t('and the line is still a ran claim — the annotation is a datum, not a class', coded.every((e) => e.claim === 'ran' && !e.malformed));
    // ⛔ The lenient reader, refused. A second dialect of a field whose whole
    // purpose is to be unambiguous is worse than no field.
    for (const tail of ['EXIT 3', 'exit=3', 'exit 3 ', '3', 'exit three', 'exit 1234']) {
      const bad = parseRunRecord(`pnpm check:a${sep}${tail}`)[0];
      t(
        `a '${tail}' tail is MALFORMED, and the line keeps its pre-field reading in full`,
        bad.malformed !== null && bad.exitCode === null && bad.command === `pnpm check:a${sep}${tail}`,
      );
    }
    t(
      'the separator is found from the RIGHT, so only the tail is ever read as an annotation',
      parseRunRecord(`pnpm check:a${sep}note${sep}exit 3`)[0].command === `pnpm check:a${sep}note`,
    );

    // ── The classes ────────────────────────────────────────────────────────
    const derived = ['node scripts/check-b.mjs', 'pnpm check:a', 'pnpm check:c'];
    const full = runReconciliation({ derived, record: parseRunRecord(derived.join('\n')) });
    t('a complete record reconciles green, with every derived family run', full.ok && full.ran.length === 3 && full.unrun.length === 0);
    const short = runReconciliation({ derived, record: parseRunRecord(['pnpm check:a', 'node scripts/check-b.mjs'].join('\n')) });
    t('a record missing one family NAMES it rather than counting it', !short.ok && short.unrun.length === 1 && short.unrun[0].command === 'pnpm check:c');
    t('and the reason it gives is the absence itself', short.unrun[0].why.includes('absent from the run record'));

    // ⭐ MECHANISM 3, at its limit: the denominator is this tree's derivation,
    // so an EMPTY record cannot balance against it. An arithmetic over the
    // runner's own list would have reported 0 of 0 and closed.
    const nothingRan = runReconciliation({ derived, record: parseRunRecord('') });
    t(
      'an EMPTY record over a non-empty derivation reports EVERY family unrun, never a balanced nothing',
      !nothingRan.ok && nothingRan.unrun.length === 3 && nothingRan.derivedTotal === 3,
    );
    const junkOnly = runReconciliation({ derived, record: parseRunRecord(['pnpm check:something-else', '# note'].join('\n')) });
    t(
      'and a record of entries that name nothing derived does the same — the total cannot be lowered from the record side',
      junkOnly.derivedTotal === 3 && junkOnly.unrun.length === 3 && junkOnly.extra.length === 1,
    );
    t('an entry outside the derivation is reported and is NOT an error on its own', junkOnly.extra[0] === 'pnpm check:something-else');

    // ⭐ MECHANISM 2, structurally: no prefix, substring or whitespace
    // relation is ever a pairing.
    const prefixish = runReconciliation({
      derived: ['pnpm check:foo'],
      record: parseRunRecord(['pnpm check:foo-extra', 'check:foo', 'pnpm check:fo'].join('\n')),
    });
    t(
      'a prefix, a substring and a truncation of a derived command pair with NOTHING',
      !prefixish.ok && prefixish.unrun.length === 1 && prefixish.extra.length === 3,
    );
    const nearMiss = runReconciliation({ derived: ['pnpm check:foo'], record: parseRunRecord('pnpm check:foo  ') });
    t(
      'a whitespace-only difference is REPORTED and still leaves the family unrun — the diagnostic can never move a verdict',
      !nearMiss.ok && nearMiss.unrun[0].command === 'pnpm check:foo' && nearMiss.nearMiss.length === 1,
    );
    t('and the near-miss names both spellings, so the repair is mechanical', nearMiss.nearMiss[0].recorded === 'pnpm check:foo  ' && nearMiss.nearMiss[0].derived === 'pnpm check:foo');

    // ── NOT-MEASURED is its own class, and it costs a reason ────────────────
    const claimed = runReconciliation({
      derived: ['pnpm check:a', 'pnpm check:b'],
      record: parseRunRecord(['pnpm check:a', `${marker} pnpm check:b${sep}refuses without a built dist`].join('\n')),
    });
    t(
      `a reasoned ${marker} family is neither run nor unrun — it is its own class, and the verdict stays green`,
      claimed.ok && claimed.ran.length === 1 && claimed.unrun.length === 0 && claimed.notMeasured.length === 1,
    );
    t('and the reason travels with it, because the report is what it is for', claimed.notMeasured[0].reason === 'refuses without a built dist');
    // ⭐ The cap-kill conflation, mechanically refused: the category exists for
    // a gate that refuses with its own prerequisite, and it is exactly where a
    // family you merely did not FINISH running goes to hide.
    const unexplained = runReconciliation({ derived: ['pnpm check:a'], record: parseRunRecord(`${marker} pnpm check:a`) });
    t(
      `an unexplained ${marker} claim is read as UNRUN, not as a refusal`,
      !unexplained.ok && unexplained.unrun.length === 1 && unexplained.notMeasured.length === 0,
    );
    t('and the run says why, naming the cap kill it would otherwise absorb', unexplained.unrun[0].why.includes('cap-killed'));
    t('the malformed line is reported against its line number too', unexplained.malformed.length === 1 && unexplained.malformed[0].line === 1);

    // ── ⭐ DERIVED from the recorded code, not declared by the runner (#17204) ──
    //
    // ONE world, recorded three ways. The gate `pnpm check:c` refused with its
    // own unmet prerequisite in every one of them; what differs is only what
    // the runner wrote down. Measured across four consecutive deliveries, the
    // first shape — the sloppy one — printed `0 NOT-MEASURED` while 2, 2, 1 and
    // 2 gates had exited 3.
    const world = ['pnpm check:a', 'pnpm check:b', 'pnpm check:c'];
    const sloppyRecord = world.join('\n');
    const codedRecord = ['pnpm check:a :: exit 0', 'pnpm check:b :: exit 1', 'pnpm check:c :: exit 3'].join('\n');
    const claimedRecord = ['pnpm check:a', 'pnpm check:b', `${marker} pnpm check:c${sep}refuses on an unbuilt tree`].join('\n');
    const sloppyRun = runReconciliation({ derived: world, record: parseRunRecord(sloppyRecord) });
    const codedRun = runReconciliation({ derived: world, record: parseRunRecord(codedRecord) });
    const claimedRun = runReconciliation({ derived: world, record: parseRunRecord(claimedRecord) });
    t(
      '⭐ POSITIVE: a run CONTAINING an exit-3 gate reports it, and the class came off the code rather than a declaration',
      codedRun.notMeasured.length === 1 && codedRun.notMeasured[0].command === 'pnpm check:c' && codedRun.notMeasured[0].source === 'exit-code',
    );
    t(
      'a RED gate is still RUN — this mode answers what you RAN, never whether it passed, and only the refusal class moves',
      codedRun.ran.join('|') === 'pnpm check:a|pnpm check:b' && codedRun.ok,
    );
    // ⭐ THE NEGATIVE CONTROL, and it is half the card: a change that reported
    // everything as NOT-MEASURED would look "more careful" and pass a
    // positive-only acceptance while being exactly as useless as a zero.
    const noRefusal = runReconciliation({
      derived: world,
      record: parseRunRecord(['pnpm check:a :: exit 0', 'pnpm check:b :: exit 1', 'pnpm check:c :: exit 0'].join('\n')),
    });
    t(
      '⭐ NEGATIVE CONTROL: a run genuinely WITHOUT a refusal still reports ZERO, with every family run',
      noRefusal.notMeasured.length === 0 && noRefusal.ran.length === 3 && noRefusal.evidence.kind === 'derived',
    );
    t(
      'the sloppy record reports the same zero it always did — this field cannot invent a refusal out of a bare line',
      sloppyRun.notMeasured.length === 0 && sloppyRun.ran.length === 3 && sloppyRun.ok,
    );
    t(
      '...and the difference between those two zeroes is the EVIDENCE class, which is where it belongs',
      sloppyRun.evidence.kind === 'claimed' && sloppyRun.evidence.silent === 3 && sloppyRun.evidence.coded === 0
        && noRefusal.evidence.coded === 3 && noRefusal.evidence.silent === 0,
    );
    t(
      'a hand-written claim stays CLAIMED and is counted apart from a derived one, in the same run',
      claimedRun.notMeasured.length === 1 && claimedRun.notMeasured[0].source === 'claim'
        && claimedRun.evidence.claimed === 1 && claimedRun.evidence.derivedFromExit === 0,
    );
    const floor = runReconciliation({
      derived: world,
      record: parseRunRecord(['pnpm check:a :: exit 3', 'pnpm check:b', 'pnpm check:c :: exit 0'].join('\n')),
    });
    t(
      'a PARTLY annotated record is a floor, not a total, and the two halves are counted separately',
      floor.evidence.kind === 'floor' && floor.evidence.coded === 2 && floor.evidence.silent === 1 && floor.notMeasured.length === 1,
    );

    // Two lines disagreeing about one family: reported, and resolved toward the
    // rerun in BOTH orders — a first-wins rule would make the resolution depend
    // on which line the runner happened to append first.
    for (const [first, second] of [['exit 0', 'exit 3'], ['exit 3', 'exit 0']]) {
      const twoCodes = runReconciliation({
        derived: ['pnpm check:a'],
        record: parseRunRecord([`pnpm check:a${sep}${first}`, `pnpm check:a${sep}${second}`].join('\n')),
      });
      t(
        `a family recorded '${first}' then '${second}' reads as ${marker} and the contradiction is REPORTED, not resolved silently`,
        twoCodes.notMeasured.length === 1 && twoCodes.notMeasured[0].source === 'exit-code' && twoCodes.exitContradictions.length === 1,
      );
    }
    const bothChannels = runReconciliation({
      derived: ['pnpm check:a'],
      record: parseRunRecord([`pnpm check:a${sep}exit 3`, `${marker} pnpm check:a${sep}refuses without a built dist`].join('\n')),
    });
    t(
      'a family recorded through BOTH channels reads as the derived class, and the contradiction is still reported',
      bothChannels.notMeasured.length === 1 && bothChannels.notMeasured[0].source === 'exit-code' && bothChannels.conflicts.length === 1,
    );

    // ── A KILL is not a verdict (#18074) ────────────────────────────────────
    // ⭐ The four readings on the card are four readings of ONE instrument: the
    // same command, the same derivation, and ONLY the record's spelling differs
    // between them. They are pinned here in that shape, so a future edit that
    // moves one of them has to say which.
    const killRecord = (code, reason) => parseRunRecord(
      [`pnpm check:a${sep}${RUN_RECORD_EXIT_PREFIX}${code}`, ...(reason ? [`${marker} pnpm check:a${sep}${reason}`] : [])].join('\n'),
    );
    const readingA = runReconciliation({ derived: ['pnpm check:a'], record: killRecord(RUN_RECORD_KILL_EXITS.TIMEOUT) });
    t(
      'READING A — a bare cap-kill code is UNRUN, never run: the run left no verdict to read',
      !readingA.ok && readingA.ran.length === 0 && readingA.notMeasured.length === 0 && readingA.unrun.length === 1,
    );
    // ⛔ `?.` and not `[0].why`: when this classification regresses the array is
    // EMPTY, and a pin that throws on the regression it exists to catch takes
    // the whole battery down with it — every case after it stops reporting, so
    // an ablation can no longer show which of them the regression moved. A pin
    // must FAIL, and be named while failing.
    const why0 = (entry) => entry?.why ?? '';
    const reason0 = (entry) => entry?.reason ?? '';
    t(
      '...and the unrun row NAMES the recorded code, so the runner can see what this tool read',
      why0(readingA.unrun[0]).includes(`${RUN_RECORD_EXIT_PREFIX}${RUN_RECORD_KILL_EXITS.TIMEOUT}`) && why0(readingA.unrun[0]).includes('no verdict'),
    );
    const capReason = 'cap-killed at the container foreground ceiling';
    const readingD = runReconciliation({ derived: ['pnpm check:a'], record: killRecord(RUN_RECORD_KILL_EXITS.TIMEOUT, capReason) });
    t(
      `READING D — a kill code PLUS a reasoned claim is ${marker}: the honest runner's declaration WINS over the run line beside it`,
      readingD.ok && readingD.ran.length === 0 && readingD.unrun.length === 0 && readingD.notMeasured.length === 1
        && readingD.notMeasured[0]?.source === RUN_RECORD_NOT_MEASURED_KILL_SOURCE
        && readingD.notMeasured[0]?.exitCode === RUN_RECORD_KILL_EXITS.TIMEOUT,
    );
    t(
      '...and its row carries BOTH halves of the record — the code this tool read and the reason the runner stated',
      reason0(readingD.notMeasured[0]).includes(`${RUN_RECORD_EXIT_PREFIX}${RUN_RECORD_KILL_EXITS.TIMEOUT}`)
        && reason0(readingD.notMeasured[0]).includes(capReason),
    );
    // ⭐ The double-count control. Reading D accounts for ONE family through two
    // doors, and `accounted` must still be 1 — a total that counted it twice
    // would be wrong by exactly the number of the most careful records in it.
    t(
      '...and the evidence counts that ONE family once: it is inside `coded`, and `killClaimed` is reported beside the others, not added to them',
      readingD.evidence.accounted === 1 && readingD.evidence.coded === 1 && readingD.evidence.killClaimed === 1
        && readingD.evidence.claimed === 0 && readingD.evidence.derivedFromExit === 0,
    );
    // Every member of the set, both ways round — the floor is a FLOOR, not the
    // four signals that happen to have been met so far.
    for (const code of [RUN_RECORD_KILL_EXITS.TIMEOUT, 130, 137, 141, 143, RUN_RECORD_KILL_EXITS.SIGNAL_FLOOR, 149]) {
      const bare = runReconciliation({ derived: ['pnpm check:a'], record: killRecord(code) });
      const declared = runReconciliation({ derived: ['pnpm check:a'], record: killRecord(code, 'the OS ended it') });
      t(
        `a recorded ${RUN_RECORD_EXIT_PREFIX}${code} is a kill: UNRUN bare, ${marker} when declared — and run in neither`,
        bare.ran.length === 0 && bare.unrun.length === 1 && bare.notMeasured.length === 0
          && declared.ran.length === 0 && declared.unrun.length === 0 && declared.notMeasured.length === 1
          && declared.notMeasured[0]?.source === RUN_RECORD_NOT_MEASURED_KILL_SOURCE,
      );
    }
    // CONTROL, and it is the load-bearing half: a VERDICT still reads as run.
    // 127 is the discriminating one — an unusual number, below the floor and
    // not the timeout wrapper's, so a rule that fired on "looks like trouble"
    // rather than on this set would fail here.
    for (const code of [0, 1, 2, 127]) {
      const verdict = runReconciliation({ derived: ['pnpm check:a'], record: killRecord(code) });
      t(
        `CONTROL: a recorded ${RUN_RECORD_EXIT_PREFIX}${code} is a verdict and still reads as run`,
        verdict.ok && verdict.ran.length === 1 && verdict.notMeasured.length === 0 && verdict.unrun.length === 0,
      );
      t(`CONTROL: runRecordKillLabel(${code}) is null — the label is the ONE place a code is judged`, runRecordKillLabel(code) === null);
    }
    t(
      'CONTROL: the prerequisite code keeps its own class, ahead of the kill test',
      runRecordKillLabel(EXIT_PREREQUISITE_NOT_MET) === null,
    );
    t(
      'the label names the signal where one is known, and the signal NUMBER where it is not',
      (runRecordKillLabel(143) ?? '').includes('SIGTERM') && (runRecordKillLabel(137) ?? '').includes('SIGKILL')
        && (runRecordKillLabel(149) ?? '').includes('signal 21')
        && (runRecordKillLabel(RUN_RECORD_KILL_EXITS.TIMEOUT) ?? '').includes('timeout'),
    );
    // A kill code beside a claim with NO reason is the shape the docblock above
    // refuses by name: an unexplained refusal is what a cap-killed run wears.
    const killUnreasoned = runReconciliation({
      derived: ['pnpm check:a'],
      record: parseRunRecord([`pnpm check:a${sep}${RUN_RECORD_EXIT_PREFIX}143`, `${marker} pnpm check:a`].join('\n')),
    });
    t(
      'a kill code beside an UNREASONED claim stays UNRUN — the claim costs a reason here exactly as it does alone',
      !killUnreasoned.ok && killUnreasoned.unrun.length === 1 && killUnreasoned.notMeasured.length === 0
        && why0(killUnreasoned.unrun[0]).includes(`${RUN_RECORD_EXIT_PREFIX}143`),
    );
    // ── The contradiction line, read off the RENDERING ──────────────────────
    // ⭐ Read from the rendered text and not from `conflicts`: the array being
    // non-empty says the tool NOTICED, and the card's own reproduction filtered
    // the output down to the count line and therefore could not tell whether
    // anything was ever PRINTED about it.
    const verdictPlusClaim = runReconciliation({
      derived: ['pnpm check:a'],
      record: parseRunRecord([`pnpm check:a${sep}${RUN_RECORD_EXIT_PREFIX}0`, `${marker} pnpm check:a${sep}also claimed`].join('\n')),
    });
    const verdictPlusClaimText = runReconciliationLines(verdictPlusClaim).join('\n');
    t(
      'a VERDICT code plus a claim is a genuine contradiction: run still wins, unchanged',
      verdictPlusClaim.ok && verdictPlusClaim.ran.length === 1 && verdictPlusClaim.notMeasured.length === 0 && verdictPlusClaim.conflicts.length === 1,
    );
    t(
      '...and the contradiction is PRINTED on the default output, not merely held in an array',
      verdictPlusClaimText.includes('is recorded BOTH as run and as ' + marker) && verdictPlusClaimText.includes('Read as run; fix the record'),
    );
    const readingDText = runReconciliationLines(readingD).join('\n');
    t(
      `the ${marker} · KILLED block prints, and names the code and the reason on the family's own row`,
      readingDText.includes(`${marker} · KILLED (1)`) && readingDText.includes(capReason)
        && readingDText.includes(`${RUN_RECORD_EXIT_PREFIX}${RUN_RECORD_KILL_EXITS.TIMEOUT}`),
    );
    t(
      '...and reading D is reported as the two channels AGREEING — ⛔ never as a record to repair',
      readingDText.includes('The two AGREE') && !readingDText.includes('Read as run; fix the record'),
    );
    const readingAText = runReconciliationLines(readingA).join('\n');
    t(
      'reading A names its kill in the UNRUN block and prescribes the spelling that would declare it',
      readingAText.includes('⛔ UNRUN (1)') && readingAText.includes(`${RUN_RECORD_EXIT_PREFIX}${RUN_RECORD_KILL_EXITS.TIMEOUT}`)
        && readingAText.includes(`${marker} <command>`),
    );
    // READINGS B and C — the two controls the card names, unchanged by this
    // edit. They are the evidence that the kill branch was inserted BESIDE the
    // two existing channels rather than over either of them.
    const readingB = runReconciliation({ derived: ['pnpm check:a'], record: killRecord(EXIT_PREREQUISITE_NOT_MET) });
    t(
      `READING B — ${RUN_RECORD_EXIT_PREFIX}${EXIT_PREREQUISITE_NOT_MET} is still DERIVED ${marker}, unchanged`,
      readingB.ok && readingB.notMeasured.length === 1 && readingB.notMeasured[0].source === 'exit-code' && readingB.evidence.derivedFromExit === 1,
    );
    const readingC = runReconciliation({
      derived: ['pnpm check:a'],
      record: parseRunRecord(`${marker} pnpm check:a${sep}${capReason}`),
    });
    t(
      `READING C — a claim with a reason and no run line is still CLAIMED ${marker}, unchanged`,
      readingC.ok && readingC.notMeasured.length === 1 && readingC.notMeasured[0].source === 'claim'
        && readingC.evidence.claimed === 1 && readingC.evidence.killClaimed === 0,
    );

    // The malformed tail is reported like the malformed claim beside it, and it
    // costs the family: the line stays whole, so it pairs with nothing.
    const badTail = runReconciliation({ derived: ['pnpm check:a'], record: parseRunRecord(`pnpm check:a${sep}EXIT 3`) });
    t(
      'a malformed exit tail leaves the family UNRUN and says so — the direction that costs a rerun, never a false green',
      !badTail.ok && badTail.unrun.length === 1 && badTail.malformed.length === 1 && badTail.malformed[0].kind === 'exit',
    );

    // ── What the TOOL classifies, so no prose has to ────────────────────────
    // ⭐ The value-bearing spelling is the LIVE one — `pr-automation.yml`
    // really passes `--base "$MERGE_BASE"` to this script — for the reason the
    // neighbouring cases take theirs from the live workflows: a fixture
    // invented here would keep passing after the renderer that produces the
    // real one changed shape, which is the failure this whole file is about.
    const valueBearing = 'node scripts/check-empty-changeset.mjs --base "$MERGE_BASE"';
    const explained = runReconciliation({
      derived: ['pnpm check:a'],
      ciOnlyCommands: new Set(['node scripts/check-payload-guard.mjs']),
      notRunnableCommands: new Set([valueBearing]),
      pendingCommands: new Set(['pnpm check:changeset-shape']),
      record: parseRunRecord(['pnpm check:a', 'node scripts/check-payload-guard.mjs', valueBearing, 'pnpm check:changeset-shape'].join('\n')),
    });
    t(
      'a CI-measured-only entry and a pending-changeset entry are classified by the tool, not dumped into the remainder',
      explained.ok && explained.explainedCiOnly.length === 1 && explained.explainedPending.length === 1 && explained.extra.length === 0,
    );
    // ⭐ #15115: the THIRD class `commandsFor` withholds gets the same
    // courtesy. Recorded, derived by this run, classified out of the union —
    // so `extra`'s caption ("named by nothing this run derived") would be the
    // one sentence that is false about it.
    t(
      'a recorded VALUE-BEARING family is classified by the tool too, never folded into the remainder',
      explained.explainedNotRunnable.length === 1 && explained.explainedNotRunnable[0] === valueBearing && !explained.extra.includes(valueBearing),
    );
    // CONTROL, and it is the load-bearing half: the bucket explains the class
    // it was given and nothing else. A command named by no set is still
    // `extra` — a third bucket that swallowed unknowns would have deleted the
    // remainder rather than shrunk it.
    const unknownBeside = runReconciliation({
      derived: ['pnpm check:a'],
      notRunnableCommands: new Set([valueBearing]),
      record: parseRunRecord(['pnpm check:a', valueBearing, 'pnpm check:not-a-family'].join('\n')),
    });
    t(
      'and an unknown command beside it still reads `extra` — the new bucket explains its class only',
      unknownBeside.explainedNotRunnable.length === 1 && unknownBeside.extra.length === 1 && unknownBeside.extra[0] === 'pnpm check:not-a-family',
    );
    // The bucket is DIAGNOSTIC, exactly like the two beside it: the verdict
    // reads `unrun` and nothing else, so classifying an entry can never move
    // it in either direction (#15115).
    t(
      'the new bucket cannot move the verdict — it is diagnostic, like the two beside it',
      unknownBeside.ok && unknownBeside.unrun.length === 0 && unknownBeside.ran.length === 1,
    );

    // ── Bookkeeping the classes cannot lose ─────────────────────────────────
    const dupes = runReconciliation({ derived: ['pnpm check:a'], record: parseRunRecord(['pnpm check:a', 'pnpm check:a'].join('\n')) });
    t('a duplicated record line cannot double-count a family', dupes.ok && dupes.ran.length === 1 && dupes.derivedTotal === 1);
    const contradicted = runReconciliation({
      derived: ['pnpm check:a'],
      record: parseRunRecord(['pnpm check:a', `${marker} pnpm check:a${sep}also claimed`].join('\n')),
    });
    // ⭐ Re-spelled, not weakened (#18074): the expectation is byte-for-byte the
    // one it always asserted, and the sentence now says which run lines it
    // covers. A BARE line carries no code at all, so no kill can be read out of
    // it and the runner's "I ran it" stands — the kill branch above is about
    // lines that DO carry a code, and this case is the control beside it.
    t(
      'a family claimed BOTH ways over a run line carrying no kill code reads as run, and the contradiction is reported, not resolved silently',
      contradicted.ok && contradicted.conflicts.length === 1 && contradicted.ran.length === 1,
    );
    const zero = runReconciliation({ derived: [], record: parseRunRecord('') });
    t('an empty derivation and an empty record is a green EMPTY answer, not a missing one', zero.ok && zero.derivedTotal === 0);

    // ⭐ The closure assertion, driven: the three classes partition the derived
    // set, and an instrument that could not fail toward its own target is the
    // defect this file keeps finding one level up.
    for (const n of [0, 1, 5]) {
      const many = Array.from({ length: n }, (_, i) => `pnpm check:g${i}`);
      const half = many.filter((_, i) => i % 2 === 0);
      const r = runReconciliation({ derived: many, record: parseRunRecord(half.join('\n')) });
      t(
        `the classes partition the derived set exactly (${n} derived, ${half.length} recorded)`,
        r.ran.length + r.unrun.length + r.notMeasured.length === r.derivedTotal && r.derivedTotal === n,
      );
    }

    // ── The rendering, and the ONE bit at the end of it ─────────────────────
    const redLines = runReconciliationLines(short);
    const redText = redLines.join('\n');
    t('the rendering leads with the four counts in an assertable shape', /^Run reconciliation — 3 derived, 2 run, 0 NOT-MEASURED, 1 UNRUN\.$/.test(redLines[0]));
    t('it states where the denominator came from — the claim an arithmetic cannot make', redText.includes('recomputed in this process'));
    t('every unrun family is NAMED, never just counted', short.unrun.every(({ command }) => redText.includes(command)));
    t('the verdict is one line and it is the LAST one', redLines[redLines.length - 1].startsWith('✗ dispatch-gates --ran:'));
    const greenLines = runReconciliationLines(full);
    const greenText = greenLines.join('\n');
    t(
      'and the green verdict is the same line in the same place, still naming the derived total and the two counts',
      greenLines[greenLines.length - 1].startsWith('✓ dispatch-gates --ran: 3 derived famil(ies) accounted for — 3 run, 0 NOT-MEASURED'),
    );
    t('the rendering discloses what this number does NOT cover', greenText.includes('always-runs tail'));

    // ── ⭐ #17204: the zero says WHICH KIND OF ZERO IT IS ────────────────────
    //
    // `full`'s record is the idiom every seat writes today: the command, bare.
    // Its zero is therefore the runner's silence, and the verdict line — the
    // one a reviewer's eye lands on, beside a ✓ — has to say so in the same
    // stroke. It printed `0 NOT-MEASURED.` full stop, on four consecutive
    // deliveries where 2, 2, 1 and 2 gates had exited 3.
    t(
      '⭐ a zero over a record with no exit codes is marked CLAIMED on the verdict line itself',
      greenLines[greenLines.length - 1].endsWith(
        '0 NOT-MEASURED (⛔ CLAIMED — 3 of 3 recorded no exit code, so this zero is what the runner declared, not what the record shows).',
      ),
    );
    t(
      'and the block above it says the same thing where the counts are, naming the spelling that fixes it',
      greenText.includes('⛔ EXIT CODES — 0 of the 3 accounted famil(ies) carry one')
        && greenText.includes('`<command> :: exit <code>`'),
    );

    // ⭐⭐ THE INCENTIVE INVERSION, PINNED — the defect this card is really
    // about. Three renderings of ONE world (`pnpm check:c` refused in all
    // three), side by side, as a reviewer would read them:
    //
    //   sloppy   — no annotation at all           → today: the CLEANEST line
    //   claimed  — annotated by hand, with reason → today: `1 NOT-MEASURED`
    //   coded    — the exit codes recorded        → today: indistinguishable
    //                                               from sloppy, since the
    //                                               field did not exist
    //
    // ⛔ Rewarding the first with the tidiest output is what trained seats to
    // stop annotating. The assertion is not that the words changed: it is that
    // the sloppy rendering is no longer the clean one, and that the ONLY
    // rendering with no warning on it is the one that recorded the evidence.
    const verdictOf = (recon) => runReconciliationLines(recon).at(-1);
    const sloppyVerdict = verdictOf(sloppyRun);
    const codedVerdict = verdictOf(codedRun);
    const claimedVerdict = verdictOf(claimedRun);
    t(
      '⭐ the SLOPPY run — the one that annotated nothing — no longer gets the clean line: its zero carries ⛔ CLAIMED',
      sloppyVerdict.includes('0 NOT-MEASURED (⛔ CLAIMED') && sloppyVerdict.includes('3 of 3 recorded no exit code'),
    );
    t(
      '⭐ the CODED run — the same world, evidence recorded — is the only one of the three with no ⛔ on its verdict',
      !codedVerdict.includes('⛔') && codedVerdict.includes('1 NOT-MEASURED (1 DERIVED from a recorded exit 3)')
        && sloppyVerdict.includes('⛔') && claimedVerdict.includes('⛔'),
    );
    t(
      'and the hand-written claim still counts — it is marked CLAIMED, not erased, because the path an exit code cannot express survives',
      claimedVerdict.includes('1 NOT-MEASURED (⛔ CLAIMED') && runReconciliationLines(claimedRun).join('\n').includes(`${marker} · CLAIMED (1)`),
    );
    t(
      'the derived refusal gets its own block, naming the recorded code and the line it was read from',
      runReconciliationLines(codedRun).join('\n').includes(`${marker} · DERIVED (1)`)
        && runReconciliationLines(codedRun).join('\n').includes('recorded exit 3 on line 3 — PREREQUISITE NOT MET'),
    );
    // The NEGATIVE beside every positive, in the rendering too: an honest zero
    // must still read as a zero, and it must read as a BETTER one.
    const noRefusalVerdict = verdictOf(noRefusal);
    t(
      '⭐ NEGATIVE CONTROL, rendered: a run genuinely without a refusal still ends in a zero — and it is a DERIVED zero, with no ⛔',
      noRefusalVerdict.endsWith('3 run, 0 NOT-MEASURED (a DERIVED zero — all 3 recorded an exit code and none of them is 3).')
        && !noRefusalVerdict.includes('⛔'),
    );
    t(
      'a partly annotated record calls its count a FLOOR on both lines, and names how many are silent',
      verdictOf(floor).includes('⛔ a FLOOR') && runReconciliationLines(floor).join('\n').includes('⚠️ EXIT CODES — 2 of the 3 accounted famil(ies) carry one'),
    );
    t(
      'the malformed exit tail is reported with the spelling that repairs it, and is never read as a claim',
      runReconciliationLines(badTail).join('\n').includes(`Spelling: <command>${sep}exit <code>.`),
    );
    t(
      `the ${marker} block warns about the cap kill the category absorbs`,
      runReconciliationLines(claimed).join('\n').includes('exit 143'),
    );
    t(
      'the near-miss line refuses the pairing out loud rather than quietly',
      runReconciliationLines(nearMiss).join('\n').includes('is NOT paired with it'),
    );
    // ⭐ #15115, in the rendering: a bucket that classified an entry and then
    // printed nothing would leave the runner exactly where `extra` left them.
    const explainedText = runReconciliationLines(explained).join('\n');
    t(
      'the value-bearing bucket gets its OWN labelled line, naming the reason and the command',
      explainedText.includes('VALUE-BEARING famil(ies)')
        && explainedText.includes("its argv or its step's `env:` takes a value from the workflow")
        && explainedText.includes(valueBearing),
    );
    t(
      'and the two buckets beside it keep their own lines, with the remainder heading absent entirely',
      explainedText.includes('CI-MEASURED ONLY')
        && explainedText.includes('pending-changeset famil(ies)')
        && !explainedText.includes("Outside this card's derivation"),
    );

    // ── ⭐ The OUTSIDE enumeration on the OTHER TWO lanes (#16795) ──────────
    //
    // The same claim as the human line's, and it was short on both. `--ran`
    // named three of the five blocks a plain run prints — omitting the artifact
    // rosters and the declared WIDE population, exactly the pair #16398
    // measured a CI round trip for on the human lane. Both lanes read
    // `outsideBlockNames` now, so a name here can neither drift from that list
    // nor survive the block it points at being absent.
    //
    // ⭐ Pinned NAME BY NAME and with a NEGATIVE beside every positive, because
    // the weak shape is what failed before: a case asking only for a substring
    // stayed green for the whole time the sentence was naming three of five.
    const laneCounts = { artifactRosters: 2, widePopulation: 1, pendingChangeset: 3, jobFilteredJobs: 4 };
    const outsideOf = (lines) => (lines.find((l) => l.includes('This answers ONE link')) ?? '');
    const ranAllBlocks = outsideOf(runReconciliationLines(full, laneCounts));
    for (const name of [
      'the 2 artifact-roster famil(ies)',
      'the 1 declared WIDE-population famil(ies)',
      'the 3 pending-changeset famil(ies)',
      'the unreachable listing',
      'the 4 path-scheduled CI job(s)',
      'the always-runs tail',
    ]) {
      t(`--ran's disclaimer names "${name}" — every block a plain run prints, not a subset`, ranAllBlocks.includes(name));
    }
    t('and spells them in PRINT order, as the one phrase the human lane spells', ranAllBlocks.includes(
      'the 2 artifact-roster famil(ies), the 1 declared WIDE-population famil(ies), the 3 pending-changeset famil(ies),'
        + ' the unreachable listing, the 4 path-scheduled CI job(s), the type-check lanes and the always-runs tail are each outside the derived total',
    ));
    // The NEGATIVE: at zero rows those three blocks are not printed by the run
    // this sentence points at, so naming them would send a reader to headings
    // that are not there — the same defect facing the other way.
    const ranNoBlocks = outsideOf(runReconciliationLines(full, { artifactRosters: 0, widePopulation: 0, pendingChangeset: 0, jobFilteredJobs: 0 }));
    t(
      '--ran names NONE of the four conditional blocks on a derivation that has none',
      !ranNoBlocks.toLowerCase().includes('artifact-roster')
        && !ranNoBlocks.toLowerCase().includes('wide-population')
        && !ranNoBlocks.toLowerCase().includes('pending-changeset')
        && !ranNoBlocks.toLowerCase().includes('path-scheduled'),
    );
    t('...while still naming the three that print unconditionally', ranNoBlocks.includes('the unreachable listing, the type-check lanes and the always-runs tail'));

    // ── Lane 2: the `--commands` / `--json` stderr accounting ───────────────
    //
    // Driven through `machineReadableOutput` itself rather than through a
    // helper, because the defect was in what that function PRINTS: it named the
    // always-runs tail alone, and a `--commands` consumer — the reader this
    // file's own header sends here INSTEAD of the prose — was never told the
    // declared WIDE population exists at all. A case against the helper would
    // have stayed green through exactly that.
    const captureStderr = (run) => {
      const captured = [];
      const realError = console.error;
      const realLog = console.log;
      console.error = (...args) => captured.push(args.join(' '));
      console.log = () => {};
      try {
        run();
      } finally {
        console.error = realError;
        console.log = realLog;
      }
      return captured;
    };
    const laneTwo = (over = {}) => captureStderr(() => machineReadableOutput('commands', {
      paths: ['scripts/pm/dispatch-gates.mjs'],
      matchedRows: [{ check: 'check:m1', command: 'pnpm check:m1' }],
      kindGroups: [],
      pending: [{ check: 'check:p1' }, { check: 'check:p2' }, { check: 'check:p3' }],
      counts: {},
      alwaysRunsRows: [],
      widePopulationRows: [{ check: 'check:w1', command: 'pnpm check:w1', workflows: ['w.yml'], reason: 'whole root', refused: null }],
      rosters: [
        { check: 'check:r1', command: 'pnpm check:r1', workflows: ['w.yml'], artifacts: [], dir: 'scripts', coversYourPath: false, checkerHealth: null },
        { check: 'check:r2', command: 'pnpm check:r2', workflows: ['w.yml'], artifacts: [], dir: 'scripts', coversYourPath: false, checkerHealth: null },
      ],
      jobFiltered: {
        rows: Array.from({ length: 4 }, (_, i) => ({
          workflow: 'w.yml',
          job: `Job ${i}`,
          outputs: ['filter.core'],
          hits: [{ path: 'scripts/pm/dispatch-gates.mjs', pattern: 'scripts/**' }],
          dropped: 0,
          steps: [{ step: 'Run it', commands: ['pnpm turbo run test'] }],
        })),
        counts: { populations: 4, covering: 4, named: 4, steps: 4, accounted: 0, unaccounted: 4, conditionalSteps: 0 },
      },
      ...over,
    })).find((l) => l.includes('Not a complete account of what CI runs')) ?? '';
    const commandsAllBlocks = laneTwo();
    for (const name of [
      'the 2 artifact-roster famil(ies)',
      'the 1 declared WIDE-population famil(ies)',
      'the 3 pending-changeset famil(ies)',
      'the unreachable listing',
      'the 4 path-scheduled CI job(s)',
      'the always-runs tail',
    ]) {
      t(`--commands' closing disclaimer names "${name}" — every block outside the command list, where it used to name one`, commandsAllBlocks.includes(name));
    }
    // ⭐ The card's own repro, as a case: `grep -c 'WIDE' commands.err` read 0.
    // The token is what a consumer greps for, and it was absent from the whole
    // stream because the one line that could carry it named a different block.
    t("...so the stream a --commands consumer reads carries the token 'WIDE' at all", commandsAllBlocks.includes('WIDE'));
    // The NEGATIVE, for the reason the --ran one is there: a sentence that
    // cannot drop a name is the same broken instrument as one that cannot add
    // one, pointed the other way.
    const commandsNoBlocks = laneTwo({
      rosters: [], widePopulationRows: [], pending: [], jobFiltered: { rows: [], counts: {} },
    });
    t(
      '--commands names NONE of the four conditional blocks when the run has none of them',
      !commandsNoBlocks.toLowerCase().includes('artifact-roster')
        && !commandsNoBlocks.toLowerCase().includes('wide-population')
        && !commandsNoBlocks.toLowerCase().includes('pending-changeset')
        && !commandsNoBlocks.toLowerCase().includes('path-scheduled'),
    );
    t('...while still naming the three that print unconditionally', commandsNoBlocks.includes('the unreachable listing, the type-check lanes and the always-runs tail'));
    // ⛔ And the stream stays a STREAM: the accounting is stderr-only, so a
    // consumer redirecting stdout gets commands with no prose in front of them.
    // That is the property the whole mode exists for, and a disclaimer that
    // grew onto stdout would delete it.
    const laneTwoStdout = [];
    {
      const realLog = console.log;
      const realError = console.error;
      console.log = (...args) => laneTwoStdout.push(args.join(' '));
      console.error = () => {};
      try {
        machineReadableOutput('commands', {
          paths: ['scripts/pm/dispatch-gates.mjs'],
          matchedRows: [{ check: 'check:m1', command: 'pnpm check:m1' }],
          kindGroups: [], pending: [{ check: 'check:p1' }], counts: {}, alwaysRunsRows: [],
          widePopulationRows: [{ check: 'check:w1', command: 'pnpm check:w1', workflows: ['w.yml'], reason: 'whole root', refused: null }],
          rosters: [],
          jobFiltered: {
            rows: [{
              workflow: 'w.yml', job: 'Job 0', outputs: ['filter.core'], dropped: 0,
              hits: [{ path: 'scripts/pm/dispatch-gates.mjs', pattern: 'scripts/**' }],
              steps: [{ step: 'Run it', commands: ['pnpm turbo run test'] }],
            }],
            counts: { populations: 1, covering: 1, named: 1, steps: 1, accounted: 0, unaccounted: 1, conditionalSteps: 0 },
          },
        });
      } finally {
        console.log = realLog;
        console.error = realError;
      }
    }
    t('and the enumeration never reaches stdout, which carries the commands and nothing else', laneTwoStdout.join('\n') === 'pnpm check:m1');

    // ── argv: a two-token flag's value must not become a path ───────────────
    const ranSplit = splitArgv([RAN_FLAG, 'ran.list', 'packages/spec/src/index.ts', '--residue']);
    t('the run record value never falls through into the path list', ranSplit.paths.length === 1 && ranSplit.runRecord === 'ran.list');
    t('and the two value-taking flags coexist', splitArgv([RAN_FLAG, 'ran.list', REPO_FLAG, 'an-owner/a-repo']).assertion === 'an-owner/a-repo');
    t('the joined spelling parses to the same thing', splitArgv([`${RAN_FLAG}=ran.list`]).runRecord === 'ran.list');
    t('no run record passed stays null, so every other run is untouched', splitArgv(['packages/spec/src/index.ts']).runRecord === null);
    // ⭐ The message that would LIE: with one value-taking flag the hint was a
    // constant, and a second flag turned that constant into a sentence naming
    // the wrong argument.
    const ranMalformed = splitArgv([RAN_FLAG]).malformed ?? '';
    t('a valueless run record is malformed, and the message names THIS flag', ranMalformed.includes(RAN_FLAG) && !ranMalformed.includes('repo'));
    t('and the assertion keeps its own hint', (splitArgv([REPO_FLAG]).malformed ?? '').includes('owner'));
  }

  slow("end to end: the run record built from --commands, the value-bearing bucket, NOT MEASURED in both renderings, the env-carried half", () => {
  // ── END TO END: the record built BY CONSTRUCTION from --commands (#13774) ──
  //
  // Everything above stays green if `--ran` is never wired into the CLI, or if
  // the mode reads a derivation of its own rather than the one `--commands`
  // prints. Only a real run can tell those apart — and only a real run can
  // demonstrate the property the whole design rests on: the two sides of the
  // comparison are the SAME strings, because the record is this tool's own
  // output copied line for line. That is what makes the comparison exact
  // without a normaliser, which is the condition triage attached to this shape.
  {
    const ranCard = 'scripts/measure-durability-swallow-family.mjs';
    const ranTmp = mkdtempSync(nodePath.join(tmpdir(), 'dg-ran-'));
    try {
      const cmdRun = runCli(['--commands', ranCard]);
      const rows = (cmdRun.stdout ?? '').split('\n').filter(Boolean);
      t('CONTROL: the card derives a runnable union at all', cmdRun.status === 0 && rows.length >= 2);

      const completePath = nodePath.join(ranTmp, 'ran-complete.list');
      writeFileSync(completePath, `${rows.join('\n')}\n`);
      const green = runCli([RAN_FLAG, completePath, ranCard]);
      const greenOut = green.stdout ?? '';
      t(
        '⭐ a record that is --commands output copied verbatim reconciles GREEN and exits 0',
        green.status === 0 && greenOut.includes(`${rows.length} derived famil(ies) accounted for`),
      );
      t('and it needed no normalisation to do it — the two lists are the same strings', greenOut.includes(`${rows.length} derived, ${rows.length} run`));

      const dropped = rows[rows.length - 1];
      const shortPath = nodePath.join(ranTmp, 'ran-short.list');
      writeFileSync(shortPath, `${rows.slice(0, -1).join('\n')}\n`);
      const red = runCli([RAN_FLAG, shortPath, ranCard]);
      const redOut = red.stdout ?? '';
      t('⭐ dropping ONE line from that record exits 1 — a verdict a report cannot paraphrase', red.status === 1);
      t('and the run names exactly the family that was dropped', redOut.includes('UNRUN (1)') && redOut.includes(dropped));

      // ── ⭐ #17204 END TO END: the exit code reaches the verdict ────────────
      //
      // Every unit case above stays green if the MODE never passes the parsed
      // codes through — the same shape #15115 measured one bucket over, where
      // a defaulted parameter kept a class's own tests green while the live run
      // still got it wrong. Only a real run reads the wiring, and the record
      // here is this tool's own `--commands` output with a code appended to
      // each line, which is the capture idiom the header prescribes.
      const codedPath = nodePath.join(ranTmp, 'ran-coded.list');
      writeFileSync(codedPath, `${rows.map((cmd) => `${cmd} :: exit 0`).join('\n')}\n`);
      const codedRun = runCli([RAN_FLAG, codedPath, ranCard]);
      const codedOut = codedRun.stdout ?? '';
      t(
        '⭐ NEGATIVE CONTROL, end to end: a real record whose codes are all 0 still reconciles green with a ZERO',
        codedRun.status === 0 && codedOut.includes(`${rows.length} run, 0 NOT-MEASURED`),
      );
      t(
        'and the zero is marked DERIVED — the reward for recording the evidence is the clean line',
        codedOut.includes(`(a DERIVED zero — all ${rows.length} recorded an exit code and none of them is 3)`),
      );
      const refusedPath = nodePath.join(ranTmp, 'ran-refused.list');
      const refused = rows[0];
      writeFileSync(
        refusedPath,
        `${rows.map((cmd) => `${cmd} :: exit ${cmd === refused ? 3 : 0}`).join('\n')}\n`,
      );
      const refusedRun = runCli([RAN_FLAG, refusedPath, ranCard]);
      const refusedOut = refusedRun.stdout ?? '';
      t(
        '⭐ POSITIVE, end to end: one recorded exit 3 in a real run reaches the HEADLINE — ⛔ never a zero',
        refusedRun.status === 0
          && refusedOut.includes(`${rows.length - 1} run, 1 NOT-MEASURED (1 DERIVED from a recorded exit 3)`)
          && !refusedOut.includes('0 NOT-MEASURED'),
      );
      t(
        'and the refusing family is NAMED under its own block, with the line the code was read from',
        refusedOut.includes(`${RUN_RECORD_UNMEASURED_MARKER} · DERIVED (1)`) && refusedOut.includes(refused),
      );
      t(
        'the SAME real run recorded bare — today\'s idiom — reports a zero that says CLAIMED on the verdict line',
        greenOut.includes(`0 NOT-MEASURED (⛔ CLAIMED — ${rows.length} of ${rows.length} recorded no exit code`),
      );

      // The refusals, and the unreadable input. All three exit before the tree
      // walk, so they cost nothing to assert.
      t(
        'combining the verdict mode with a derivation mode is REFUSED, not blended',
        runCli([RAN_FLAG, completePath, '--commands', ranCard]).status === 2
          && runCli([RAN_FLAG, completePath, '--json', ranCard]).status === 2,
      );
      t('and so is asking for a tier verdict there is nothing to reconcile against', runCli([RAN_FLAG, completePath, '--tier', ranCard]).status === 2);
      const missing = runCli([RAN_FLAG, nodePath.join(ranTmp, 'no-such-record.list'), ranCard]);
      t('an unreadable record REFUSES rather than reconciling against nothing (#4690)', missing.status === 2 && (missing.stdout ?? '').trim() === '');
      t('and the refusal names the file it could not read', (missing.stderr ?? '').includes('no-such-record.list'));
      const valueless = runCli([RAN_FLAG]);
      t('a valueless run record refuses, and its message does not name the OTHER flag', valueless.status === 2 && !(valueless.stderr ?? '').includes('as an owner and a name'));
    } finally {
      rmSync(ranTmp, { recursive: true, force: true });
    }
  }

  // The gate whose CI invocation takes a value from the workflow, spelled once
  // for the two blocks below. It lives INSIDE the self-test on purpose: a path
  // literal at module scope would be read by this tool's own extractor and
  // become a ninth hint on this file — the fabrication `CHANGESET_PROBE_PATH`'s
  // docblock measured and refused, one class over.
  const VALUE_BEARING_PROBE_SCRIPT = 'scripts/pm/check-half-states.mjs';

  // ── END TO END: the VALUE-BEARING bucket is WIRED, not merely present (#15115) ──
  //
  // Every unit case above stays green if the `--ran` call site never PASSES
  // the value-bearing set — a parameter that defaults to empty is exactly the
  // shape that keeps its own tests green while the live mode still dumps the
  // class in the remainder, which is the state this card was filed about.
  // Only a real run reads the wiring.
  //
  // The fixture is this tool's OWN answer on this tree, read from `--json`,
  // rather than an invocation typed here: a hardcoded spelling would keep
  // passing after the renderer that produces the real one changed shape, and
  // the two sides of the comparison would stop being the same strings — the
  // property the whole `--ran` design rests on.
  {
    const vbTmp = mkdtempSync(nodePath.join(tmpdir(), 'dg-ran-vb-'));
    try {
      // A changeset path AND the gate script whose value-bearing invocation the
      // rows below are judged on. The changeset path alone used to reach that
      // family, through the noise-floor literal #15753 stopped reading as a
      // watch surface; the CONTROL beside the NOT MEASURED block pins that it
      // no longer does, so the derivation this change removed is recorded as an
      // assertion rather than lost along with the probe. The second path is the
      // gate's own script, which is how a card honestly reaches this family.
      const vbCard = [CHANGESET_PROBE_PATH, VALUE_BEARING_PROBE_SCRIPT];
      const jsonRun = runCliHypothetical(['--json', ...vbCard]);
      const doc = jsonRun.status === 0 ? JSON.parse(jsonRun.stdout ?? '{}') : null;
      const vbRows = [...(doc?.matched ?? []), ...(doc?.alwaysRunsPopulation ?? [])].filter((row) => row.notRunnable);
      t('CONTROL: this tree still derives at least one VALUE-BEARING family for a changeset path', Boolean(doc) && vbRows.length >= 1);
      if (doc && vbRows.length >= 1) {
        const vbCommand = vbRows[0].command;
        t('CONTROL: and the runnable union WITHHOLDS it — which is the whole reason the bucket exists', !doc.commands.includes(vbCommand));
        const vbRecord = nodePath.join(vbTmp, 'ran-value-bearing.list');
        writeFileSync(vbRecord, `${[...doc.commands, vbCommand].join('\n')}\n`);
        const vbRun = runCliHypothetical([RAN_FLAG, vbRecord, ...vbCard]);
        const vbOut = vbRun.stdout ?? '';
        t(
          '⭐ a real run that RECORDS it lands it in the VALUE-BEARING bucket, with the remainder heading gone entirely',
          vbRun.status === 0
            && vbOut.includes('VALUE-BEARING famil(ies)')
            && vbOut.includes(vbCommand)
            && !vbOut.includes("Outside this card's derivation"),
        );
        t(
          'and the reason travels with it, so the runner learns why this invocation is not one they could have derived',
          vbOut.includes("its argv or its step's `env:` takes a value from the workflow"),
        );
        t(
          'while the verdict is unmoved — the bucket is diagnostic, and every derived family is still accounted for',
          vbOut.includes(`${doc.commands.length} derived famil(ies) accounted for`),
        );
      }
    } finally {
      rmSync(vbTmp, { recursive: true, force: true });
    }
  }

  // ── NOT MEASURED is said out loud, in both renderings (#15441) ─────────────
  //
  // The half of the repair that is not about the three `--base` gates: a family
  // this tool CANNOT run must not have a sibling invocation of the same script
  // standing in for it unlabelled. A count of omissions does not say that the
  // `--self-test` in the list above is not the thing that is missing, and that
  // substitution is what the card was filed on.
  {
    // The probe card names the changeset path AND the gate script, for the
    // reason the value-bearing block above states: this family was reached from
    // a changeset path alone only through the gate's own exclusion constant,
    // which #15753 stopped reading as a watch surface. The first case below is
    // that removal, pinned; the second is the card as it must now be spelled.
    const changesetOnlyRun = runCliHypothetical([CHANGESET_PROBE_PATH]);
    t(
      '⭐ a changeset path alone reaches NO value-bearing family any more — the noise floor it used to be derived through is an exclusion, not a surface (#15753)',
      changesetOnlyRun.status === 0 && !(changesetOnlyRun.stdout ?? '').includes('Value-bearing argv'),
    );
    const notMeasuredRun = runCliHypothetical([CHANGESET_PROBE_PATH, VALUE_BEARING_PROBE_SCRIPT]);
    const notMeasuredOut = notMeasuredRun.stdout ?? '';
    t(
      'CONTROL: this card still reaches a family this tool cannot run, so the wording below is judged on a live row',
      notMeasuredRun.status === 0 && notMeasuredOut.includes('Value-bearing argv'),
    );
    t(
      '⭐ the human rendering names the unanswered question NOT MEASURED, by the invocation CI runs',
      /⊘ NOT MEASURED — nothing this card can run answers node scripts\/pm\/check-half-states\.mjs/.test(notMeasuredOut),
    );
    t(
      '⭐ and the block a dev pastes carries the REAL --base checks, each stating the value CI pins in its place',
      notMeasuredOut.includes('node scripts/check-adr-0087-registration.mjs --base origin/main')
        && notMeasuredOut.includes("is this script's own documented default; CI pins it to $MERGE_BASE"),
    );
    const notMeasuredCommands = runCliHypothetical(['--commands', CHANGESET_PROBE_PATH, VALUE_BEARING_PROBE_SCRIPT]);
    t(
      '⭐ --commands says it on stderr too, one line per family, where it cannot corrupt the harvest',
      (notMeasuredCommands.stderr ?? '').includes('⊘ NOT MEASURED — scripts/pm/check-half-states.mjs')
        && !(notMeasuredCommands.stdout ?? '').includes('NOT MEASURED'),
    );
    t(
      '⭐ …and the real --base check IS in the union now, which is the whole finding',
      (notMeasuredCommands.stdout ?? '').includes('node scripts/check-adr-0087-registration.mjs --base origin/main'),
    );
    t(
      'CONTROL: stdout is still commands and nothing else — the NOT MEASURED lines never reach the stream a consumer executes',
      (notMeasuredCommands.stdout ?? '').split('\n').filter(Boolean).every((l) => /^(pnpm|node) \S/.test(l)),
    );
  }

  // ── The env-carried half of that bucket, on the LIVE tree (#15761) ─────────
  //
  // The fixture cases above judge the reader; this one judges the tree. The
  // change set is the specimen workflow itself, so the card, the docblock and
  // this pin all name one file. Before the env read, stdout carried
  // `node scripts/check-partof-closing-keyword.mjs` under a caption promising
  // a runnable command, and running it here exits 2 with the gate's own
  // "NOT WIRED" refusal.
  {
    const envLive = runCli(['--commands', '.github/workflows/partof-closing-keyword-guard.yml']);
    const envLiveOut = (envLive.stdout ?? '').split('\n');
    const envLiveErr = envLive.stderr ?? '';
    t(
      'CONTROL: the specimen workflow really is a change set that derives this family, so the cases below judge a live row',
      envLive.status === 0 && (envLiveOut.join('\n') + envLiveErr).includes('partof-closing-keyword'),
    );
    t(
      '⭐ the bare invocation whose input arrives through `env:` is NO LONGER offered as runnable',
      !envLiveOut.includes('node scripts/check-partof-closing-keyword.mjs'),
    );
    t(
      '⭐ …it is NAMED as NOT MEASURED instead, on the stream that cannot corrupt the harvest',
      envLiveErr.includes('⊘ NOT MEASURED — scripts/check-partof-closing-keyword.mjs'),
    );
    t(
      '⭐ CONTROL: the `pnpm check:` form of the same gate takes nothing from the workflow and is still in the list',
      envLiveOut.includes('pnpm check:partof-closing-keyword'),
    );
    t(
      'CONTROL: the accounting line stays true of both carriers, so a reader is not told to look only at argv',
      envLiveErr.includes("their argv or their step's `env:` carries a variable with no value outside a CI run"),
    );
  }
  });


  // ── The DECLARED half of that bucket, on the LIVE tree (#20278) ──────────
  //
  // The fixture cases beside `workflowEnvValues`' limbs judge the reader; these
  // judge the tree, in-process off the discovery this self-test already holds
  // (no extra CLI spawn). The card's specimen path is the one whose CI run went
  // red: a change to `rls.zod.ts` owes the diff-scoped citation verdict.
  {
    const citations = 'scripts/check-issue-citations.mjs';
    const specimenPath = 'packages/spec/src/security/rls.zod.ts';
    const bare = liveDiscovery.byCheck.get(citations);
    const census = liveDiscovery.byCheck.get(`${citations} --census`);
    const liveDeclaration = declaredLocalEnv(readFileSync(nodePath.join(ROOT, citations), 'utf8'), citations);
    const liveRow = (entry) => ({
      check: entry?.check ?? null,
      command: entry ? runnableInvocation(entry) : null,
      ciOnly: entry?.ciOnly ?? null,
      notRunnable: entry?.notRunnable ?? null,
    });
    t(
      'CONTROL: the live checker declares local-env, and a workflow still runs its bare invocation and its census, so the cases below judge live rows',
      Boolean(liveDeclaration) && Boolean(bare) && Boolean(census)
        && liveDeclaration.names.every((name) => (bare.envVariables ?? []).includes(name)),
    );
    t(
      `⭐ the bare diff-scoped run is placed for ${specimenPath} and reaches the runnable union`,
      Boolean(bare) && placeFamily(bare, [specimenPath]).verdict === 'matched'
        && commandsFor({ matchedRows: [liveRow(bare)] }).includes(`node ${citations}`),
    );
    t(
      '⭐ …and it is NOT in the NOT MEASURED set any more — no workflow value is left on it',
      Boolean(bare) && bare.notRunnable === null && !notRunnableCommandSet([liveRow(bare)]).has(`node ${citations}`),
    );
    t(
      '⭐ the census of the same script is placed for the same path and STAYS NOT MEASURED, on the token its step passes',
      Boolean(census) && placeFamily(census, [specimenPath]).verdict === 'matched'
        && notRunnableCommandSet([liveRow(census)]).has(`node ${citations} --census`)
        && (census.notRunnable?.variables ?? []).includes('env GITHUB_TOKEN'),
    );
    t(
      'the names the live bare run is admitted without are exactly the ones its script declares — nothing inferred',
      Boolean(bare) && Boolean(liveDeclaration)
        && localEnvAdmitted(bare).join(',') === liveDeclaration.names.join(','),
    );
  }

  // ── Every derivation path a case drives, measured before the split ────────
  //
  // Condition 1 of the lift that let this battery be split: before anything
  // moved, V8 block coverage of a full run of this battery was read over the
  // engine's own declarations (this self-test excluded) — every one of the 245
  // declarations with code was invoked; 338 of 2,259 blocks inside them were
  // not — and the branches below are the derivation paths among those: the
  // marker grammars' refusals, the path matcher's floor, the tier renderer's
  // two exits, the changed-line reading's three states, the sister-repo tier
  // run, the claim-line reader, the argv splitter's joined and valueless
  // forms, the repo assertion's three refusals, the absent-path verdict with
  // no identity, and every class the run-record reconciliation can land a
  // family in. Each case names the function and the branch it drives, so the
  // next reading is taken against this block and not against memory. All of
  // them are in-process on fixtures: no tree walk, no child.
  {
    const throwsWith = (fn, needle) => {
      try {
        fn();
        return false;
      } catch (error) {
        return String(error.message).includes(needle);
      }
    };
    // The marker grammars — the refusals a wrong key or form reaches.
    t('markerFormKind: an unrecognised comment form throws and names the table it is added to', throwsWith(() => markerFormKind('bogus'), "unrecognised comment form 'bogus'"));
    t('populationMarkerPattern: an unknown key throws and lists the known ones', throwsWith(() => populationMarkerPattern('not-a-key'), "unknown population marker key 'not-a-key'"));
    const twoKeys = ['// dispatch-gates: no-path-population -- first', '// dispatch-gates: whole-tree-population -- second'];
    t('lineFormReason: a NEW key under a declaration is a second declaration, never a cut', lineFormReason(twoKeys, 1, '//', ' first').cut === null);
    t('lineFormReason: a declaration on the last line has nothing under it to cut it', lineFormReason(['// dispatch-gates: no-path-population -- only'], 1, '//', ' only').cut === null);
    const cutLines = ['// dispatch-gates: no-path-population -- cut', '// off mid-sentence'];
    const cut = lineFormReason(cutLines, 1, '//', ' cut').cut;
    t('CONTROL: a plain continuation line IS a cut, with its line and text', cut?.kind === 'line' && cut.line === 2 && cut.text === 'off mid-sentence');
    t('markerReasonCutRefusal: an unknown key throws before any text is built', throwsWith(() => markerReasonCutRefusal('bogus', null), "unknown marker key 'bogus'"));
    const blockCut = markerReasonCutRefusal('inherited-population', { kind: 'block', line: 3, text: 'tail', file: 'x.mjs' }) ?? '';
    t('markerReasonCutRefusal: a BLOCK cut gets the block repair, located', blockCut.includes('inside a block comment') && blockCut.includes('x.mjs:3') && blockCut.includes('"tail"'));
    const lineCut = markerReasonCutRefusal('inherited-population', { kind: 'line', line: 2, text: 'more', file: 'x.mjs' }) ?? '';
    t('…and a LINE cut gets the marker-line repair, byte for byte the older text', lineCut.includes('does not END on the marker line') && lineCut.includes('x.mjs:2'));
    t('refuseCutMarkerReason: a read with a cut THROWS, naming the file and the key', throwsWith(() => refuseCutMarkerReason({ cut: { kind: 'line', line: 2, text: 'more' } }, 'local-env', 'y.mjs'), 'y.mjs declares local-env'));
    t('…and a read with no cut returns quietly', refuseCutMarkerReason({ cut: null }, 'local-env', 'y.mjs') === undefined);
    const lookalike = unparsedPopulationMarkers('// dispatch-gates: no-path-population\n', 'z.mjs');
    t('unparsedPopulationMarkers: a declaration with no reason tail is READ but does not PARSE, and is located', lookalike.length === 1 && lookalike[0].key === 'no-path-population' && lookalike[0].line === 1 && lookalike[0].file === 'z.mjs');
    const lookalikeRefusal = unparsedPopulationMarkerRefusal(lookalike) ?? '';
    t('unparsedPopulationMarkerRefusal: the refusal names the row and the forms the key may be written in', lookalikeRefusal.includes('did not PARSE') && lookalikeRefusal.includes('z.mjs:1') && lookalikeRefusal.includes('no-path-population may be written in'));
    t('…and an empty list is no refusal', unparsedPopulationMarkerRefusal([]) === null);
    t('readPopulationDeclaration: an unknown key throws and lists the declared fields', throwsWith(() => readPopulationDeclaration({}, '', 'f.mjs', 'bogus'), "unknown population marker key 'bogus'"));

    // The path matcher's floor.
    t('hintCovers: a one-character hint covers nothing, even itself', hintCovers('x', 'x') === false);
    t('CONTROL: a two-segment hint covers its subtree', hintCovers('scripts/pm', 'scripts/pm/x.mjs') === true);

    // The tier renderer's two one-line-class exits, and the changed-line reading's three states.
    t('tierLines: a mandated surface with the one-line exit OPEN says it drops to the default tier', tierLines(deriveTier(['.claude/agents/os-dev.md'])).join('\n').includes('drops to opus execution'));
    t('tierLines: a mandated surface whose glob BARS the exit says so, naming the glob', tierLines(deriveTier(['skills/x/SKILL.md'])).join('\n').includes("NOT available for this surface — 'skills/**'"));
    t('changedLineLines: no size is NOT MEASURED', changedLineLines(null).join('\n').includes('NOT MEASURED'));
    t('changedLineLines: one line is under', changedLineLines({ additions: 1, deletions: 0 }).join('\n').includes('under.'));
    t('changedLineLines: one over the threshold is OVER, and the threshold is the gate\'s', changedLineLines({ additions: HUMAN_MERGE_LINE_THRESHOLD + 1, deletions: 0 }).join('\n').includes(`threshold ${HUMAN_MERGE_LINE_THRESHOLD}: ⛔ OVER`));

    // The sister-repo tier run, in process.
    const pinSelf = GOVERNED_REPOS.find((r) => r.id === SELF_REPO_ID).slug;
    const pinSister = GOVERNED_REPOS.find((r) => r.id !== SELF_REPO_ID).slug;
    t('sisterRepoTierRun: this repo is not a sister — null, so the ordinary assertion answers', sisterRepoTierRun({ asserted: pinSelf, paths: ['x'] }) === null);
    const sisterNoPaths = sisterRepoTierRun({ asserted: pinSister, paths: [] });
    t('sisterRepoTierRun: a sister with no paths REFUSES — nothing to derive them from', sisterNoPaths?.ok === false && sisterNoPaths.stderr.join('\n').includes('REFUSING') && sisterNoPaths.stdout.length === 0);
    const sisterRun = sisterRepoTierRun({ asserted: pinSister, paths: ['skills/x/SKILL.md'], identity: { head: 'abc1234' } });
    t('sisterRepoTierRun: a sister with paths answers the tier from the globs and the changed lines as NOT MEASURED, naming the commit', sisterRun?.ok === true && sisterRun.stdout[0].startsWith('Model tier') && sisterRun.stdout[sisterRun.stdout.length - 1].includes(`NOT MEASURED`) && sisterRun.stdout[sisterRun.stdout.length - 1].includes(String(HUMAN_MERGE_LINE_THRESHOLD)) && sisterRun.stderr[0].includes('at commit abc1234'));

    // The claim's model line.
    t('readContainerModelLine: no key line is absent', readContainerModelLine('no such line here').present === false);
    const noSlot = readContainerModelLine('Container & model: `L`, mode:subagent');
    t('readContainerModelLine: a key line with no model slot is present and declares no tier', noSlot.present === true && (noSlot.tier ?? null) === null);

    // The argv splitter's joined and valueless forms.
    t('splitArgv: a value flag followed by another flag is malformed, naming the flag', String(splitArgv(['--repo', '--tier']).malformed).includes('--repo needs a value'));
    t('splitArgv: the joined spelling binds the value', splitArgv(['--repo=o/r']).assertion === 'o/r' && splitArgv(['--ran=rec.list', 'p']).runRecord === 'rec.list');
    t('splitArgv: the joined spelling with nothing after the sign is malformed', String(splitArgv(['--ran=']).malformed).includes('--ran needs a value'));

    // The repo assertion's three refusals and its case-insensitive pass.
    const idHere = { slug: 'o/r', root: '/t' };
    t('repoAssertionVerdict: a slug that is not owner/name is refused as usage', repoAssertionVerdict({ asserted: 'nonsense', identity: idHere }).lines[0].includes('expects an owner and a repository name'));
    t('repoAssertionVerdict: an unreadable identity refuses rather than assuming', repoAssertionVerdict({ asserted: 'o/r', identity: { slug: null, root: '/t' } }).lines[0].includes('UNKNOWN'));
    const mismatch = repoAssertionVerdict({ asserted: 'not-an-owner/not-a-repo', identity: idHere });
    t('repoAssertionVerdict: a mismatch REFUSES and names both repos, with no tier hint for a stranger', mismatch.ok === false && mismatch.lines[0].includes('REFUSING') && !mismatch.lines.join('\n').includes('The TIER half alone'));
    t('…and a mismatch that names a governed sister adds the tier-half hint', repoAssertionVerdict({ asserted: pinSister, identity: idHere }).lines.join('\n').includes('The TIER half alone needs no tree'));
    t('repoAssertionVerdict: the comparison ignores case', repoAssertionVerdict({ asserted: 'O/R', identity: idHere }).ok === true);

    // The absent-path verdict with and without an identity.
    const noRoot = { root: '/no-such-root-for-this-pin', slug: null };
    const absentNoId = absentPathVerdict({ asserted: null, identity: noRoot, paths: ['docs/x.md'] });
    t('absentPathVerdict: with no readable identity the copy line is marked UNVERIFIABLE', absentNoId.ok === false && absentNoId.lines.join('\n').includes('UNVERIFIABLE') && absentNoId.lines.join('\n').includes('owner/this-repo'));
    t('absentPathVerdict: with an identity the copy line names this repo', absentPathVerdict({ asserted: null, identity: { ...noRoot, slug: 'o/r' }, paths: ['docs/x.md'] }).lines.join('\n').includes(`${REPO_FLAG} o/r`));
    t('absentPathVerdict: an assertion settles it', absentPathVerdict({ asserted: 'o/r', identity: noRoot, paths: ['docs/x.md'] }).ok === true);

    // The run record: every class the reconciliation can land a family in.
    const floor = RUN_RECORD_KILL_EXITS.SIGNAL_FLOOR;
    const namedCodes = Object.keys(RUN_RECORD_KILL_EXITS.SIGNAL_NAMES).map(Number);
    const unnamed = Array.from({ length: 60 }, (_, k) => floor + k + 1).find((c) => !namedCodes.includes(c));
    t('runRecordKillLabel: not an integer, and a code under the signal floor, are no kill', runRecordKillLabel('x') === null && runRecordKillLabel(1.5) === null && runRecordKillLabel(1) === null);
    t('runRecordKillLabel: the timeout wrapper\'s code is named as such', String(runRecordKillLabel(RUN_RECORD_KILL_EXITS.TIMEOUT)).includes('timeout'));
    t('runRecordKillLabel: a named signal is named, an unnamed one is numbered', runRecordKillLabel(namedCodes[0]) === `killed by ${RUN_RECORD_KILL_EXITS.SIGNAL_NAMES[namedCodes[0]]}` && runRecordKillLabel(unnamed) === `killed by signal ${unnamed - floor}`);
    t('parseRunRecord: a separator tail that is not an exit code is malformed, read as a command in full', String(parseRunRecord('cmd :: exit abc')[0].malformed).includes('not an exit code') && parseRunRecord('cmd :: 7')[0].command === 'cmd :: 7');
    t('parseRunRecord: a bare line has no exit code and no fault', parseRunRecord('cmd')[0].exitCode === null && parseRunRecord('cmd')[0].malformed === null);
    t('parseRunRecord: a claim with no separator, and one with an empty reason, are each malformed by name', String(parseRunRecord('NOT-MEASURED cmd')[0].malformed).includes("no '::'") && parseRunRecord('NOT-MEASURED cmd :: ')[0].malformed === 'an empty reason');
    t('parseRunRecord: comments, blank lines and CRLF are tolerated', parseRunRecord('# note\n\ncmd :: exit 0\r\n').length === 1 && parseRunRecord('# note\n\ncmd :: exit 0\r\n')[0].exitCode === 0);
    const recRecord = parseRunRecord([
      'a :: exit 0',
      `a :: exit ${EXIT_PREREQUISITE_NOT_MET}`,
      `b :: exit ${namedCodes[0]}`,
      'NOT-MEASURED b :: the cap killed it',
      `c :: exit ${namedCodes[0]}`,
      `d :: exit ${namedCodes[0]}`,
      'NOT-MEASURED d :: ',
      'NOT-MEASURED e :: never reached — the box has no docker',
      'NOT-MEASURED f',
      'g :: exit zz',
      'ci-only :: exit 0',
      'not-runnable :: exit 0',
      'pending :: exit 0',
      'h  :: exit 0',
      'i',
    ].join('\n'));
    const recon = runReconciliation({ derived: ['a', 'b', 'c', 'd', 'e', 'h', 'i'], record: recRecord, ciOnlyCommands: new Set(['ci-only']), notRunnableCommands: new Set(['not-runnable']), pendingCommands: new Set(['pending']) });
    const landed = (cmd) => (recon.notMeasured.find((x) => x.command === cmd) ? `nm:${recon.notMeasured.find((x) => x.command === cmd).source}` : recon.unrun.find((x) => x.command === cmd) ? 'unrun' : recon.ran.includes(cmd) ? 'ran' : 'none');
    t(`runReconciliation: two codes for one command contradict, and ${EXIT_PREREQUISITE_NOT_MET} wins — NOT-MEASURED from the exit code`, recon.exitContradictions.length === 1 && recon.exitContradictions[0].command === 'a' && landed('a') === 'nm:exit-code');
    t('runReconciliation: a kill code with a stated reason beside it is NOT-MEASURED from the kill claim', landed('b') === `nm:${RUN_RECORD_NOT_MEASURED_KILL_SOURCE}`);
    t('runReconciliation: a kill code with no claim is UNRUN, told how to declare it', landed('c') === 'unrun' && recon.unrun.find((x) => x.command === 'c').why.includes('declare it as'));
    t('runReconciliation: a kill code with a reasonless claim is UNRUN — a kill without a stated reason', landed('d') === 'unrun' && recon.unrun.find((x) => x.command === 'd').why.includes('a kill without a stated reason'));
    t('runReconciliation: a reasoned claim with no exit code is NOT-MEASURED from the claim', landed('e') === 'nm:claim');
    t('runReconciliation: the three explained extras land in their own lists, not as unknown extras', recon.explainedCiOnly?.includes('ci-only') && recon.explainedNotRunnable?.includes('not-runnable') && recon.explainedPending?.includes('pending'));
    t('runReconciliation: a recorded command that is derived only once trimmed is a NEAR MISS, and still an extra', recon.nearMiss?.some((n) => n.recorded === 'h ' && n.derived === 'h') && recon.extra.includes('h ') && landed('h') === 'unrun');
    t('runReconciliation: both malformed kinds are carried, by line', recon.malformed.some((m) => m.kind === 'claim') && recon.malformed.some((m) => m.kind === 'exit'));
    t('runReconciliation: a bare line is RAN with no code — the silent class', landed('i') === 'ran');
    t('runReconciliation: the classes close over the derived total', recon.ran.length + recon.unrun.length + recon.notMeasured.length === 7);
    const rendered = runReconciliationLines(recon).join('\n');
    t('runReconciliationLines: the contradiction, the agreeing kill claim, and both malformed shapes are each rendered', rendered.includes('TWO different exit codes') && rendered.includes('The two AGREE') && rendered.includes('carries') && rendered.includes('claims NOT-MEASURED with'));
    t('runReconciliationLines: a mixed record renders the evidence as a FLOOR', rendered.includes('a FLOOR'));
    const claimedOnly = runReconciliation({ derived: ['x'], record: parseRunRecord('x') });
    t('runReconciliationLines: a record with no exit codes renders the count as the RUNNER\'S CLAIM', runReconciliationLines(claimedOnly).join('\n').includes("RUNNER'S CLAIM"));
    const derivedZero = runReconciliation({ derived: ['x'], record: parseRunRecord('x :: exit 0') });
    t('runReconciliationLines: an all-coded record with nothing refused renders a DERIVED zero', runReconciliationLines(derivedZero).join('\n').includes('a DERIVED zero'));
    const nothing = runReconciliation({ derived: [], record: [] });
    t('runReconciliation: nothing derived and nothing recorded closes at zero', nothing.ran.length === 0 && nothing.unrun.length === 0 && nothing.notMeasured.length === 0);
  }

  // The two tiers partition the battery: in a full run every case is in exactly one of them and
  // nothing was deferred; in a fast run every deferred section is named, so a reader of the log
  // can never mistake the fast tier for the whole. Pinned here, after every section has run.
  tierMillis.fast = Date.now() - tierStarted - tierMillis.slow;
  t(
    `the tiers partition the battery: ${tierCases.fast} fast + ${tierCases.slow} slow = ${cases.length} cases, ` +
      `${deferred.length} section(s) deferred`,
    tierCases.fast + tierCases.slow === cases.length
      && tierCases.fast > 0
      && (tiers.slow ? tierCases.slow > 0 && deferred.length === 0 : tierCases.slow === 0 && deferred.length > 0),
  );

  // ── The paths the second coverage reading still showed at zero ───────────
  //
  // Taken after the split with the merge read the way V8 means it (a block is
  // listed only when its count differs from the enclosing range), these are
  // the branches no case had driven: the three data-row refusals the split
  // introduced, the suspect row with no exception, and the fallback fragments
  // a caller reaches only by handing in nothing.
  {
    const throwsWith = (fn, needle) => {
      try {
        fn();
        return false;
      } catch (error) {
        return String(error.message).includes(needle);
      }
    };
    t('bindChangeKindRows: a row naming a predicate the engine does not define REFUSES at load, listing the known keys', throwsWith(() => bindChangeKindRows([{ kind: 'k', matches: 'bogus', gates: [] }]), "names the predicate 'bogus', which this engine does not define — known: test-file"));
    t('bindMandatoryTierRows: a row naming a tier the engine does not serve REFUSES at load', throwsWith(() => bindMandatoryTierRows([{ glob: 'g', tier: 'BOGUS_TIER' }]), "names the tier 'BOGUS_TIER'"));
    t('bindSuspectTierRows: a row naming an exception the engine does not define REFUSES at load', throwsWith(() => bindSuspectTierRows([{ glob: 'g', except: 'bogus' }]), "names the exception 'bogus'"));
    t('bindSuspectTierRows: a row with no exception binds as it is', bindSuspectTierRows([{ glob: 'g', why: 'w' }])[0].except === undefined && bindSuspectTierRows([{ glob: 'g', why: 'w' }])[0].glob === 'g');
    t('CONTROL: the live tables are the bound rows — same globs, same kinds, resolved to functions and the model id', MANDATORY_TIER_GLOBS.every((g) => typeof g.tier === 'string') && SUSPECT_TIER_GLOBS.every((g) => g.except === undefined || typeof g.except === 'function') && CHANGE_KIND_GATES.every((k) => typeof k.matches === 'function'));
    t('markerReasonCutRefusal: a cut with no file names the declaring file', String(markerReasonCutRefusal('local-env', { kind: 'line', line: 4, text: 'more' })).includes('the declaring file:4'));
    t('refuseCutMarkerReason: a cut with no file throws naming the declaring file', throwsWith(() => refuseCutMarkerReason({ cut: { kind: 'line', line: 4, text: 'more' } }, 'local-env'), 'the declaring file declares local-env'));
    const bareLookalike = unparsedPopulationMarkers('dispatch-gates: no-path-population\n');
    t('unparsedPopulationMarkers: a lookalike with no comment opener is read, and says so', bareLookalike.length === 1 && bareLookalike[0].form === '(no comment opener)' && bareLookalike[0].file === null);
    t('readContainerModelLine: nothing is absent; a key line with an empty value declares no tier', readContainerModelLine(null).present === false && readContainerModelLine('Container & model:').present === true && (readContainerModelLine('Container & model:').tier ?? null) === null);
    t('parseRunRecord: nothing parses to no entries', parseRunRecord(null).length === 0 && parseRunRecord(undefined).length === 0);
    const bareEntries = [
      { command: 'a', claim: 'ran', reason: null, exitCode: null, line: 1, raw: 'a :: exit x', malformed: 'a bad tail' },
      { command: 'b', claim: 'not-measured', reason: null, exitCode: null, line: 2, raw: 'NOT-MEASURED b', malformed: 'no reason' },
    ];
    const bareRecon = runReconciliation({ derived: ['a', 'b'], record: bareEntries });
    t('runReconciliation: an entry with no malformedKind defaults to exit for a run line and claim for a claim line', bareRecon.malformed.find((m) => m.line === 1)?.kind === 'exit' && bareRecon.malformed.find((m) => m.line === 2)?.kind === 'claim');
    const noIdentity = repoAssertionVerdict({ asserted: null, identity: null });
    t('repoAssertionVerdict: nothing asserted against no identity is refused as usage, with no repo named and an unknown tree', noIdentity.ok === false && noIdentity.lines[0].includes("got ''") && noIdentity.lines[2].endsWith('runs in and from no other.'));
    t('repoAssertionVerdict: a slug asserted against an identity with no slug and no root names an unknown tree', repoAssertionVerdict({ asserted: 'o/r', identity: {} }).lines.join('\n').includes('Tree: unknown'));
    t('absentPathVerdict: with no identity at all the tree reads unknown and the copy line is UNVERIFIABLE', absentPathVerdict({ asserted: null, identity: null, paths: ['docs/no-such-file-for-this-pin.md'] }).lines.join('\n').includes('Tree: unknown'));
  }

  // The non-vacuity half of #15539, read at the tail because that is where
  // every call site passing a reading has already run. The card named six; the
  // assertion is a FLOOR rather than an equality, so adding a seventh is not a
  // red and deleting the class is.
  t(
    `⭐ ${detailedCases} case(s) really handed this harness a diagnostic reading, and it now has a parameter to receive them`,
    detailedCases >= 6,
    JSON.stringify({ detailedCases, floor: 6 }),
  );

  // The per-case line already printed inside `t()`, streamed as each verdict
  // was decided (#14281) — this tail is the summary only, unchanged in shape
  // and wording from the pre-streaming version.
  let failed = 0;
  for (const [, cond] of cases) {
    if (!cond) failed++;
  }
  // The NOT-MEASURED tally rides on BOTH verdicts (#15255). A reader who sees
  // only the pass count cannot tell a run that measured everything from one
  // that skipped a subject, and that indistinguishability is the whole failure
  // mode a silent skip introduces — so the count is repeated here, next to the
  // number it would otherwise be hiding inside. It never moves the exit code:
  // "this tree cannot decide it" is not a defect in this tool, and a gate that
  // reds for it is the release blocker this replaced.
  const skipped = notMeasuredSuffix(notMeasured);
  if (failed) {
    console.error(`✗ dispatch-gates self-test${tiers.slow ? '' : ' (fast tier)'}: ${failed} of ${cases.length} case(s) failed.${skipped}`);
    process.exit(1);
  }
  console.error(
    `dispatch-gates self-test tiers: fast ${tierCases.fast} case(s) in ${(tierMillis.fast / 1000).toFixed(1)}s · ` +
      (tiers.slow ? `slow ${tierCases.slow} case(s) in ${(tierMillis.slow / 1000).toFixed(1)}s.` : `slow tier deferred (${deferred.length} section(s)) — run without --fast for both.`),
  );
  if (!tiers.slow) console.log(`✓ dispatch-gates self-test (fast tier): ${cases.length} cases pass; ${deferred.length} slow section(s) deferred.${skipped}`);
  else console.log(`✓ dispatch-gates self-test: ${cases.length} cases pass.${skipped}`);

  return SELF_TEST_VERDICT;
}
