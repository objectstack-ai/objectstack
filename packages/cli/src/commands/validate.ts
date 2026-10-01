// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import { dirname } from 'node:path';
import chalk from 'chalk';
import { ZodError } from 'zod';
import {
  ObjectStackDefinitionSchema,
  normalizeStackInput,
  lintUnknownAuthoringKeys,
  lintUnknownStackKeys,
  formatUnknownAuthoringKey,
  stackConversionsOf,
  type ConversionNotice,
} from '@objectstack/spec';
import { loadConfig, namedExportRejectionHints } from '../utils/config.js';
import { refuseUnbuiltStack } from '../utils/stack-provenance-refusal.js';
import { lowerCallables } from '../utils/lower-callables.js';
import { authoringRuleUnionStack } from '../utils/stack-collections.js';
// [#18677] The per-package half of the author-time rule run, shared with
// `os compile` — ⛔ the loop is not re-written here; see that module's header.
import { artifactPackages, runPerPackageAuthoringRules } from '../utils/artifact-packages.js';
import { stackFilterJudge } from '../utils/authoring-filter-judge.js';
import { runAuthoringRules, splitBySeverity, authoringRulesFor } from '@objectstack/lint';
import { resolveJsxGateManifest, printJsxGateNotices } from '../utils/sdui-manifest.js';
import { preflightRequiredCapabilities, renderCapabilityMessage } from '../utils/capability-preflight.js';
import { collectAndLintDocs, type DocIssue } from '../utils/collect-docs.js';
import {
  printHeader,
  printKV,
  printSuccess,
  printError,
  printStep,
  formatConversionNotice,
  printAuthoringRuleErrors,
  printDocIssueErrors,
  JSON_FULL_LIST_REMEDY,
  createTimer,
  formatZodErrors,
  collectMetadataStats,
  printMetadataStats,
  printWarning,
  printBulletList,
  emitJson,
  isExitSignal,
  errorCodeFields,
  isReportedError,
} from '../utils/format.js';
import { checkProtocolVersionGap } from '../utils/protocol-version-gap.js';
import { readSpecReleaseChanges } from '../utils/spec-release-changes.js';
// [#14553] The navigation-contribution group check, shared with `os compile`.
// Reports; never refuses — the runtime still relocates, deliberately.
import { findNavGroupDiagnostics } from '../utils/nav-contribution-groups.js';
import type { NavContributionGroupDiagnostic } from '@objectstack/objectql';
// [#18024] The permission-set name-collision check, shared with `os compile`.
// Reports; never refuses — the runtime still drops the foreign set, correctly
// (ADR-0086 D4); what was missing was the author hearing about it.
import {
  findPermissionSetNameCollisions,
  formatPermissionSetNameCollisions,
} from '../utils/permission-set-name-collisions.js';
import type { PermissionSetNameCollisionDiagnostic } from '@objectstack/plugin-security';
// [#20331] The boot registrar's divergent view-container `name` refusal, walked
// over the parsed stack the way the load path registers it. The verdict is
// `@objectstack/objectql`'s; see the module header.
import { findViewContainerNameRefusals } from '../utils/view-container-names.js';
// A field `picklist` that names no picklist the stack declares — refused, or
// reported when the declaring package depends on packages outside the stack.
// Walked the way the load path registers, like the refusal above.
import { judgePicklistReferences, printPicklistReferenceNotices } from '../utils/picklist-references.js';

export default class Validate extends Command {
  static override description =
    'Validate ObjectStack configuration against the protocol schema, CEL expressions, and widget bindings (no artifact emitted)';

  static override args = {
    config: Args.string({ description: 'Configuration file path', required: false }),
  };

  static override flags = {
    strict: Flags.boolean({ description: 'Treat warnings as errors' }),
    json: Flags.boolean({ description: 'Output results as JSON' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Validate);

    const timer = createTimer();

    if (!flags.json) {
      printHeader('Validate');
    }

    // [#12047] THE ADVISORY LISTS THIS RUN HAS COMPUTED SO FAR, hoisted out of
    // the `try` so that EVERY `emitJson` exit can read them — not the terminal
    // success payload alone.
    //
    // The defect: all five failure exits published strictly less than the run
    // had already computed. Two carried `ruleAdvisories` and nothing else; the
    // other three carried no advisory list at all. The text face prints these
    // blocks ending `— re-run with --json for the full list`, so an author
    // whose tree failed a LATER gate was told to re-run with `--json` and got
    // a payload without the withheld entries in it — the "the remedy named is
    // unreachable" shape of #11643 and #11391.
    //
    // The strongest instance is the parse-failure exit. `unknownKeyWarnings`
    // is computed PRE-parse (see its own note below) precisely so the finding
    // survives an unrelated schema error — and then that exit dropped it
    // anyway, defeating the one hoist that existed to prevent exactly this.
    //
    // Maintainer ruling 2026-08-25 on #11772, inherited here under the
    // same-family rule: every failure exit carries the lists the run has
    // ALREADY COMPUTED, so `warnings` means the same thing on every exit and a
    // machine consumer has exactly one way to read it. Option 2 — carry them
    // only where the text face printed them, making the payload's SHAPE depend
    // on how far the run got — was rejected as the hardest contract to
    // declare. Option 3 (weaken the pointer) was rejected as making the
    // product worse.
    //
    // ⛔ CARRYING, NOT COMPUTING. Every list stays computed at exactly the step
    // that owns it; these bindings only make the value visible to the exits
    // DOWNSTREAM of that step. An exit that runs before a given step therefore
    // still reports that list empty, and that is the honest reading of "what
    // the run has already computed". Hoisting a computation earlier so an
    // early exit looks fuller would be option 2 wearing option 1's clothes,
    // and it would change what the command costs on its failure paths too.
    //
    // ⛔ `structuralWarnings` is the member that is measured, not assumed. It
    // is computed LAST — below every one of the five failure exits — so it
    // rides `warningsSoFar()` as an empty list on all of them, and the only
    // exit that can ever see it non-empty is the success payload. It is a
    // member of the same class as the other four (a non-blocking advisory
    // about the stack, gated by `--strict`, already in the success payload's
    // `warnings`); it differs only in WHEN it becomes available, which is the
    // same axis `docWarnings` and `capProviderWarnings` already differ on. It
    // is included here rather than special-cased so the order lives at ONE
    // site — ⛔ do not "fix" its emptiness by moving its computation up.
    //
    // ORDER IS THE SUCCESS PAYLOAD'S, stated ONCE here and read by that
    // payload too — the "one list cannot drift from itself" idiom this file
    // has already had to apply three times. The spread used to be written out
    // at the payload, so a seventh exit could have been added with a different
    // member order and nothing would have caught it.
    // Typed off `splitBySeverity` rather than by naming `AuthoringFinding`: the
    // #4409 import scan (packages/lint/src/authoring-rule-wiring.test.ts) reads
    // every symbol this file names from `@objectstack/lint` and strips `type `
    // rather than exempting it, and `splitBySeverity` — which produces this
    // list — is already ratcheted there. Binding the annotation to the producer
    // is also the tighter statement: the list cannot disagree with the function
    // that fills it.
    let ruleAdvisories: ReturnType<typeof splitBySeverity>['advisories'] = [];
    let capProviderWarnings: Array<{ token: string; message: string }> = [];
    let unknownKeyWarnings: string[] = [];
    let docWarnings: DocIssue[] = [];
    let structuralWarnings: string[] = [];
    // [#14553] Computed HERE as well as in `os compile`, not only there. The
    // #11727 residue pin asserts that nothing rides in build's `warnings` that
    // validate does not also report, and the two commands being one wall with
    // two doors is the #4409 / #4463 discipline this list already follows.
    let navGroupWarnings: NavContributionGroupDiagnostic[] = [];
    // [#18024] Computed HERE as well as in `os compile`, and for the same
    // reason the line above it gives: the #11727 residue pin asserts that
    // nothing rides in build's `warnings` that validate does not also report.
    let permissionSetCollisionWarnings: PermissionSetNameCollisionDiagnostic[] = [];
    // [#20113] The JSX gate's parse-level notice: empty, or ONE `info` record
    // saying `kind:'html'` pages were checked at parse level only because no
    // SDUI component manifest resolved, and where one was looked for. Same
    // class as the two members above it — reports, never refuses, and is NOT
    // in the `warnings` list `--strict` reads (see step 3), so the exit status
    // of a project without a manifest is unchanged on both faces. `os compile`
    // computes the identical record, so the residue pin keeps holding.
    let jsxGateNotices: ReturnType<typeof resolveJsxGateManifest>['notices'] = [];
    // The `info` records of a field `picklist` reference that resolves nowhere
    // in the stack while the declaring package depends on packages outside it
    // (step 2d). Same class as the notice above — reports, never refuses, and
    // is NOT in the `warnings` list `--strict` reads: the reference may be
    // right, and `--strict` failing on it would refuse a correct stack. `os
    // compile` computes the identical records, so the residue pin keeps holding.
    let picklistReferenceNotices: ReturnType<typeof judgePicklistReferences>['notices'] = [];
    const warningsSoFar = () => [
      ...ruleAdvisories,
      ...docWarnings,
      ...unknownKeyWarnings,
      ...capProviderWarnings,
      ...structuralWarnings,
      // [#14553] APPENDED, and the position is load-bearing. #12047's
      // `the order lives at ONE site` pin matches the five members above as
      // CONTIGUOUS source text — that is how it proves the order is defined
      // once rather than re-spelled per exit. Slotting a sixth member (or even
      // a comment) between them breaks that match, so a new member goes on the
      // end and the pin keeps guarding exactly what it was written to guard.
      // ⛔ Do not "fix" that pin by loosening its regex.
      ...navGroupWarnings,
      // [#18024] APPENDED for the same reason, one member later.
      ...permissionSetCollisionWarnings,
      // [#20113] APPENDED for the same reason, one member later again.
      ...jsxGateNotices,
      // APPENDED for the same reason, one member later again.
      ...picklistReferenceNotices,
    ];
    // [commit 79cf692b0] The ADR-0087 D2 conversion notices, hoisted for the SAME reason
    // and under the SAME ruling as the five lists above — one field over. The
    // notices were computed at step 2 (below) and reached the terminal SUCCESS
    // payload alone, so all five failure exits dropped a list already in hand.
    //
    // ⛔ CARRYING, NOT COMPUTING — and here that is a pure SCOPE change. This is
    // the same `const` array the `onConversionNotice` sink pushes into, moved
    // above the `try` only so the catch-all exit can read it. `normalizeStackInput`
    // still runs at exactly step 2, so a run that throws in `loadConfig` — above
    // it — reports `[]` honestly, exactly as `warningsSoFar()` does there,
    // unless what it threw is a stack producer's refusal: that carries the
    // conversions the producer applied before refusing, which the run HAS
    // already computed, and the catch-all folds them (#20583).
    //
    // ⛔ NOT FOLDED INTO `warningsSoFar()`, in either direction. The two fields
    // are separate on the success payload by an explicit decision recorded at
    // that call site: the text face folds these notices into its `⚠` block (so
    // `--strict` gates on them) while the payload carries them under their own
    // key with their structured `conversionId`/`retiresIn` fields intact — the
    // one advisory class that carries an EXPIRY. Whether the two should become
    // one field is an open question this change was explicitly not given the
    // authority to settle, so the shape is mirrored, not merged.
    //
    // No `conversionsSoFar()` wrapper: `warningsSoFar()` exists because five
    // producers had to be concatenated in ONE stated order. This list has three
    // fillers, and each pushes into this ONE array in the order the run reaches
    // it — step 1b folds the record the stack producer left on the default
    // export (`loaded.stackConversions`), step 2's own pass appends what it
    // converts on the merged stack, and the catch-all folds the record a
    // producer's REFUSAL carries when the load threw one (so on that run the
    // other two never ran) — so reading the binding directly already is the
    // "a list cannot drift from itself" idiom the wrapper was built to buy.
    const conversionNotices: ConversionNotice[] = [];

    try {
      // 1. Load configuration
      if (!flags.json) printStep('Loading configuration...');
      const loaded = await loadConfig(args.config);
      const { config, absolutePath, duration, namedExports } = loaded;
      // 1a. [#20367 ruling B] One authoring shape: refuse a default export no
      //     stack producer built, BEFORE any other judgement — the `STACK_*`
      //     cross-field refusals run inside `defineStack` only, so an unbuilt
      //     export would otherwise pass this door unjudged. Throws into the
      //     catch-all below (`--json`: `error` + `code`, exit 1), the same
      //     envelope a `defineStack` refusal raised at load reaches.
      refuseUnbuiltStack(loaded);
      // 1b. The ADR-0087 D2 conversions the PRODUCER applied. `defineStack`
      //     converts at load (either mode), so the stack this door received is
      //     already canonical and step 2's pass below has nothing of it left to
      //     convert: without this fold `conversions` read `[]` and `--strict`
      //     passed on every `defineStack` config carrying a retiring spelling.
      //     Read by `loadConfig` off the default export before its named-export
      //     merge (`stackConversionsOf`, beside the provenance mark). ⛔ Folded,
      //     never recomputed: a second conversion pass here would disagree with
      //     what was loaded. After 1a, so a refused export reports none.
      conversionNotices.push(...loaded.stackConversions);

      if (!flags.json) {
        printKV('Config', absolutePath);
        printKV('Load time', `${duration}ms`);
      }

      // 2. Normalize map-formatted stack definition and validate against schema.
      //    The ADR-0087 D2 conversion layer runs here (inside normalizeStackInput);
      //    surface each applied conversion as a non-blocking deprecation notice so
      //    the author knows the source still carries an old-shape key that will
      //    retire from the load path in a future major. What it can still find
      //    after step 1b is what the producer never saw: a key `loadConfig`
      //    merged onto the stack from a NAMED export of the config module.
      if (!flags.json) printStep('Validating against ObjectStack Protocol...');
      // The sink is declared above the `try` (see its note there); the CALL that
      // fills it stays right here, at the step that owns it.
      const normalized = normalizeStackInput(config as Record<string, unknown>, {
        onConversionNotice: (n) => conversionNotices.push(n),
      });
      // [#3786] Keys `ObjectSchema` / `FieldSchema` do not declare, and so drop
      // silently. PRE-parse for the same reason the registry's `normalized`-tier
      // rules are: the parse is what strips them, so `result.data` no longer
      // carries the key the author actually wrote. Computed here rather than
      // down in the warnings section so the `--json` path reports it too — the
      // "computed, then discarded" shape this file already had to fix once.
      unknownKeyWarnings = [
        ...lintUnknownStackKeys(normalized as Record<string, unknown>, ObjectStackDefinitionSchema),
        ...lintUnknownAuthoringKeys(normalized as Record<string, unknown>, ObjectStackDefinitionSchema),
      ].map(formatUnknownAuthoringKey);
      // 2b. [#16544] Lower inline `function` handlers (Hook.handler, action
      //     `target`, top-level `functions`) to a metadata `body` + string ref
      //     BEFORE the parse — the same `lowerCallables` call `os build` makes
      //     at its step 2b and `os lint` makes in `lintConfig`, not a copy.
      //
      //     Every rule in the `hook-body-*` / `hook-api-update-readonly-*`
      //     family opens on `body.language === 'js'`. A hook authored as
      //     `handler: async (ctx) => { … }` carries no `body`, so on the
      //     un-lowered stack the whole family returned before reading
      //     anything, and this command passed (exit 0, no finding) a stack
      //     `os build` refuses with `hook-api-update-readonly-field` — the
      //     #3782 / #4409 class one door over, on the shape the reference app
      //     uses for 39 of 39 hooks. The body-authored control fired here all
      //     along, so the silence was the door, not the rule.
      //
      //     POSITION IS LOAD-BEARING: after the two pre-parse unknown-key
      //     lints above, which keep reading `normalized` exactly as before,
      //     and before the parse, which now reads the lowered view. That is
      //     `compile.ts`'s lower-BEFORE-parse order exactly; its key lints sit
      //     AFTER its parse, so on both doors what protects the lints' input
      //     is non-mutation, not ordering: `lowerCallables` returns a NEW
      //     top-level object and never mutates its input, so `normalized` —
      //     the registry's `normalized` tier below, `collectMetadataStats(
      //     config)`, the structural advisories — is byte-for-byte what it
      //     was; only what the parse and the registry's `parsed` tier see
      //     changes.
      //
      //     NOT A PURE NARROWING. The same pass also lowers an inline action
      //     `target` callable (`actions[*]`, `objects[*].actions[*]`) to a ref
      //     string plus `body`, and names a nameless `functions` ARRAY entry
      //     (`[{ handler: fn }]`) `anon_fn`. `ActionSchema.target` is
      //     `z.string()`, the array entry requires `name`, and
      //     `normalizeStackInput` touches neither, so before this step the
      //     un-lowered parse REFUSED both configs (`invalid_type` at
      //     `actions.0.target`; `invalid_union` at `functions`; exit 1) while
      //     `os build` accepted them all along. Both are accepted here now —
      //     accepted-set relaxations on this command, each measured through
      //     the real CLI on both sides and pinned in
      //     `test/lint-hook-rules-reach-handler-hooks.e2e.test.ts`. Not
      //     limbs: `hooks[*].handler` accepts a function un-lowered, and the
      //     `functions` MAP forms parse either way. Parity with the build is
      //     the intent, and it is declared rather than assumed because a
      //     sibling's acceptance is evidence of intent, not a declaration on
      //     this command's face.
      //
      //     Nothing is emitted, so `lowering.functions` is unused here, and
      //     the extraction refusals in `bodyExtractionWarnings` are NOT
      //     surfaced: a handler the extractor refuses is left with no `body`
      //     on every door, the family stays silent on it, and the refusal is
      //     `os lint`'s `hook-body/*` rules' to report. Publishing it here
      //     would add a key to this command's `--json` payload, which is its
      //     own contract decision (`compile.ts` records why the key is
      //     build's alone). No step line is printed either: the text face is
      //     byte-for-byte what it was, and the docs transcripts stay true.
      const lowering = lowerCallables(normalized as Record<string, unknown>);
      const result = ObjectStackDefinitionSchema.safeParse(lowering.lowered);

      if (!result.success) {
        if (flags.json) {
          await emitJson({
            valid: false,
            errors: (result.error as unknown as ZodError).issues,
            // [#12047] The list computed at `unknownKeyWarnings` above — six
            // lines up, and dropped here until now. This is the exit the card
            // called the strongest instance: the hoist exists so the finding
            // SURVIVES a schema error, and this payload discarded it anyway.
            warnings: warningsSoFar(),
            // [commit 79cf692b0] Filled by `normalizeStackInput` two statements above this
            // exit — the tightest instance of that defect, and the one the commit measured.
            conversions: conversionNotices,
            duration: timer.elapsed(),
          });
          this.exit(1);
        }

        console.log('');
        printError('Validation failed');
        formatZodErrors(result.error as unknown as ZodError);
        // [#18171] …and, when one of those unrecognised top-level keys got
        // there by being a NAMED EXPORT of the config module rather than a key
        // the author wrote inside `defineStack()`, the rule that makes it one.
        // Text face only: the `--json` branch above is untouched, so no field
        // is added to a published envelope.
        for (const line of namedExportRejectionHints(
          (result.error as unknown as ZodError).issues,
          namedExports,
        )) {
          console.log(chalk.dim(line));
        }
        this.exit(1);
      }

      // 2c. [#20331] The boot registrar's divergent view-container `name`
      //     refusal, judged here by the SAME function
      //     `ObjectQL.registerMetadataCollections` throws the answer of
      //     (`viewContainerNameRefusal`, `@objectstack/objectql`). This door
      //     used to pass `{ name: 'order_line', object: 'my_app_order_line',
      //     list: {…} }` at exit 0 while `os serve` refused the same stack at
      //     boot — the silent-validator shape, on the command whose whole job
      //     is to say what the runtime will accept.
      //
      //     ⛔ One judge, not a second rule: not an `@objectstack/lint`
      //     registry member and not a re-spelling of the check. The helper
      //     owns only the WALK (which `views:` entries boot registers, under
      //     which package id); the verdict and its words are the runtime's,
      //     so the author reads here exactly what the server would print.
      //
      //     Right after the parse, ahead of the rule table: this is the
      //     runtime's own accept set, the same class as the schema, and
      //     nothing below it is worth reading about a stack the server will
      //     not load. `os build` runs the same call at its step 3a (#20393);
      //     `test/validate-build-gate-parity.test.ts` holds both doors to it.
      const containerNameRefusals = findViewContainerNameRefusals(result.data as Record<string, unknown>);
      if (containerNameRefusals.length > 0) {
        if (flags.json) {
          await emitJson({
            valid: false,
            errors: containerNameRefusals,
            // [#12047] Every exit carries the lists the run has computed so
            // far — here the pre-parse ones only, and the conversion notices
            // `normalizeStackInput` filled at step 2.
            warnings: warningsSoFar(),
            conversions: conversionNotices,
            duration: timer.elapsed(),
          });
          this.exit(1);
        }
        const n = containerNameRefusals.length;
        console.log('');
        printError(`The server would refuse this stack at boot (${n} view container${n > 1 ? 's' : ''})`);
        printBulletList(
          containerNameRefusals.map((r) => r.message),
          { noun: 'view-container refusal(s)', remedy: JSON_FULL_LIST_REMEDY },
        );
        this.exit(1);
      }

      // 2d. A field `picklist`, or a `picklistExtensions` entry's `extend`, that
      //     names no picklist the stack declares is REFUSED, naming the field
      //     (or the extension) and the list. `FieldSchema` and
      //     `PicklistExtensionSchema` judge the name's spelling only, so a
      //     misspelt reference parsed, passed this door at exit 0 and reached
      //     the runtime as a choice with nothing to choose — the silence a NAMED
      //     list exists to remove.
      //
      //     The walk is the load path's (see `utils/picklist-references.ts`):
      //     each `packages[]` body's fields and extensions, or the top level's
      //     when there is no `packages[]`, resolved against every picklist the
      //     stack declares.
      //     A reference that resolves nowhere is refused only when the
      //     declaring package depends on no package outside the stack; when it
      //     does, the list may live there, and this command cannot read it — so
      //     that case is an `info` notice, printed here and carried in
      //     `warningsSoFar()`, never gating.
      //
      //     Right after the parse, ahead of the rule table, for the reason
      //     step 2c gives. `os build` runs the same call at its step 3a-bis.
      const picklistJudgement = judgePicklistReferences(result.data as Record<string, unknown>);
      picklistReferenceNotices = [...picklistJudgement.notices];
      if (!flags.json) printPicklistReferenceNotices(picklistReferenceNotices);
      if (picklistJudgement.refusals.length > 0) {
        if (flags.json) {
          await emitJson({
            valid: false,
            errors: picklistJudgement.refusals,
            // Every exit carries the lists the run has computed so far — the
            // pre-parse ones and the notices above.
            warnings: warningsSoFar(),
            conversions: conversionNotices,
            duration: timer.elapsed(),
          });
          this.exit(1);
        }
        const n = picklistJudgement.refusals.length;
        console.log('');
        printError(`A picklist reference names a picklist this stack does not declare (${n} reference${n > 1 ? 's' : ''})`);
        printAuthoringRuleErrors(picklistJudgement.refusals, { remedy: JSON_FULL_LIST_REMEDY });
        this.exit(1);
      }

      // 3. The author-time rule registry (#4409). Every rule the three authoring
      //    commands share — expressions, view shape, widget/action/filter/name
      //    references, SDUI styling, page sources, security posture, the CLI's
      //    own authoring lints — runs from ONE table, so `os validate`,
      //    `os build` and `os lint` hold a stack to the same bar by construction.
      //    Before it, each command hand-wired its own subset: 23 of 26 rules ran
      //    on some strict subset of the three, and `os build` — the command that
      //    PUBLISHES — was the weakest gate of the three.
      //
      //    Which rules run, on which stack tier, and why any of them is scoped
      //    is declared in `lint/authoring-rules.ts`. Do not add a call site here.
      const registered = authoringRulesFor('validate');
      if (!flags.json) printStep(`Running author-time rules (${registered.length})...`);
      //    [ADR-0130 D4 / option B, #17069] Judged on the SAME folded stack
      //    `os build` judges (`compile.ts` step 3b), through the one helper
      //    both doors call. Under option B every definition lives in
      //    `packages[]` and the top level carries none, so this run's input
      //    was an EMPTY stack: `os validate` printed `✓ Validation passed` and
      //    exited 0 having judged nothing, on a stack `os build` refuses. That
      //    is the weakest-gate class #4409 was filed for, and the direction it
      //    arrived in here is the worst one — the fast inner-loop check is
      //    what an author runs BEFORE shipping, so its clean bill of health is
      //    the strongest false assurance the three commands can give.
      //
      //    Rule INPUT only, exactly as in `compile.ts`: this command emits no
      //    artifact at all, and the folded stack reaches neither the metadata
      //    stats below nor the `--json` payload. A stack that still carries
      //    its collections is returned by identity, so every single-package
      //    project is unaffected by construction.
      //
      //    [#20113] The SDUI manifest is resolved ONCE, and both rule runs below
      //    are handed the same answer. Its pages are counted over EVERY stack
      //    the JSX gate is handed — the union fold AND each package body the
      //    per-package pass judges — so html pages carried only in `packages[]`
      //    count beside a top-level `pages` key the fold keeps.
      //    With `kind:'html'` pages to check and no manifest, the gate runs at
      //    parse level and SAYS so — here, at its step, so the line shows on
      //    the failing paths below too, and in `warningsSoFar()` for `--json`.
      //    It stays out of the `warnings` list `--strict` reads, exactly like
      //    the navigation and permission-set advisories: a project with no
      //    manifest of its own has no remedy but to author one, so promoting
      //    this to a failure under `--strict` would break every such project.
      //    A project manifest that exists but cannot be used is REFUSED
      //    instead (thrown, already reported on stderr; the catch-all exits 1).
      //    [#20166] The project's manifest is the one beside the config this
      //    run was given — the directory the capability preflight below reads
      //    too — never the invoker's working directory.
      const jsxGate = resolveJsxGateManifest(result.data as Record<string, unknown>, dirname(absolutePath));
      jsxGateNotices = [...jsxGate.notices];
      if (!flags.json) printJsxGateNotices(jsxGateNotices);
      const parsedUnion = authoringRuleUnionStack(result.data as Record<string, unknown>);
      // [#20158] The engine's own filter admission over this stack's objects —
      // built lazily, driverless; see `utils/authoring-filter-judge.ts`. ONE
      // judge for the union run and the per-package pass below, because the
      // runtime judges every package's policies against one registry.
      const judgeFilter = stackFilterJudge(parsedUnion);
      const findings = runAuthoringRules('validate', {
        normalized: authoringRuleUnionStack(normalized as Record<string, unknown>),
        parsed: parsedUnion,
        sduiManifest: jsxGate.sduiManifest,
        // [#16546] Same ref set `os build` / `os lint` compute — keeps this
        // door's hook write-set findings at the same `path` as the other two.
        loweredHookRefs: lowering.loweredHookRefs,
        judgeFilter,
      });
      const { errors: ruleErrors, advisories } = splitBySeverity(findings);
      ruleAdvisories = advisories;

      if (ruleErrors.length > 0) {
        // Every failing rule reports at once. The command used to exit at the
        // first failing gate, so an author with three unrelated problems fixed
        // them in three round trips and could not see how deep the hole went.
        if (flags.json) {
          await emitJson({
            valid: false,
            errors: ruleErrors,
            // [#12047] Was `ruleAdvisories` alone. Reading the shared site adds
            // the pre-parse `unknownKeyWarnings` — computed long before this
            // gate — and keeps the member ORDER identical to every other exit.
            warnings: warningsSoFar(),
            // [commit 79cf692b0] Computed at step 2, above this gate.
            conversions: conversionNotices,
            duration: timer.elapsed(),
          });
          this.exit(1);
        }
        console.log('');
        printError(`Author-time rules failed (${ruleErrors.length} issue${ruleErrors.length > 1 ? 's' : ''})`);
        // [#11642] The comment above is the reason this render may not be
        // silently capped: reporting every failing rule at once is the whole
        // point of the block, and a cut with no notice restores a smaller
        // version of the round-trip it removed. `--json` on this same exit
        // publishes all of them as `errors`, so the pointer resolves.
        printAuthoringRuleErrors(ruleErrors, { remedy: JSON_FULL_LIST_REMEDY });
        this.exit(1);
      }

      // 3a-ii. [ADR-0130 D4, #18677] The SAME rule table, once per PACKAGE —
      //     the second half of the run above, and the half this door ran
      //     without.
      //
      //     `os build` has run it since #16611; `os validate` ran the union
      //     fold and stopped, importing neither `artifactPackages` nor
      //     `packageBodyAsStack`. Every finding this pass yields is therefore
      //     one `os build` reported and this command structurally could not.
      //     Same FALSE-CLEAN direction #17069 fixed one layer up, and the worse
      //     door for it: the fast inner-loop check is what an author runs
      //     BEFORE shipping, so its clean bill of health is the strongest false
      //     assurance the three commands can give.
      //
      //     ⚠️ [#18779] This step used to size that gap by quoting `compile.ts`
      //     step 3b-ii — "exactly the set the union could not see" — and that
      //     sentence was FALSE when it was copied here: the de-duplication key
      //     carried the POSITIONAL `path`, so a package-local finding and its
      //     flattened twin got two keys and the ECHO survived. Part of every
      //     survivor set was therefore something THIS door's own union run
      //     already reported. The key was corrected in
      //     `utils/artifact-packages.ts`; the gap this step closed is real and
      //     its direction is unchanged, but ⛔ do not re-derive its size from
      //     that sentence — it was quoted, never measured.
      //
      //     ⛔ Not a second copy of the loop — `runPerPackageAuthoringRules` is
      //     the one the build door calls, so the de-duplication key, the
      //     severity split and the `where` prefix cannot drift between the two
      //     doors. That drift is the defect this step closes, one layer down.
      //
      //     The SEVERITY MAPPING is `os build`'s, unchanged and deliberately:
      //     an `error` refuses (exit 1), an advisory joins `ruleAdvisories` and
      //     rides `warningsSoFar()`. The card asked for the asymmetry, ⛔ not
      //     for a severity judgement, and a per-package `error` is one
      //     `os build` ALREADY refuses — so this narrows `os validate` to the
      //     bar the command that ships already holds, never past it.
      //
      //     Skipped entirely for a stack with no `packages[]`: one package by
      //     definition, already judged whole by the union run above.
      const packageEntries = artifactPackages(result.data as Record<string, unknown>);
      if (packageEntries.length > 0) {
        if (!flags.json) {
          printStep(`Running author-time rules per package (${packageEntries.length})...`);
        }
        const perPackage = runPerPackageAuthoringRules({
          command: 'validate',
          parsed: result.data as Record<string, unknown>,
          unionFindings: findings,
          sduiManifest: jsxGate.sduiManifest,
          // [#16546] The same ref set the union run above was handed, so a
          // per-package hook write-set finding reports at the same `path` the
          // other two doors report it at.
          loweredHookRefs: lowering.loweredHookRefs,
          judgeFilter,
        });
        ruleAdvisories = [...ruleAdvisories, ...perPackage.advisories];
        if (perPackage.errors.length > 0) {
          if (flags.json) {
            await emitJson({
              valid: false,
              errors: perPackage.errors,
              warnings: warningsSoFar(),
              conversions: conversionNotices,
              duration: timer.elapsed(),
            });
            this.exit(1);
          }
          console.log('');
          printError(
            `Author-time rules failed inside the artifact's packages (${perPackage.errors.length} issue${perPackage.errors.length > 1 ? 's' : ''})`,
          );
          printAuthoringRuleErrors(perPackage.errors, { remedy: JSON_FULL_LIST_REMEDY });
          this.exit(1);
        }
      }

      // 3b. [#3366] Installable-provider preflight — the shift-left of the
      //     `serve`-time capability check. `os validate` previously only checked
      //     the `requires` tokens against the vocabulary (ADR-0066), never
      //     whether each token's provider is resolvable in the active edition. A
      //     token whose provider has NO installable version here (e.g. `ai` →
      //     @objectstack/service-ai, cloud-only) fails; absent-but-installable is
      //     an advisory `pnpm add` hint. Mirrors the `os build` gate exactly.
      //
      //     Not a registry rule: it reads `node_modules`, not the stack.
      // [#14553] Navigation contributions whose `group` names no group in an
      //     app this same compilation unit ships. Reports, never refuses: the
      //     runtime relocates the items to the app's top level deliberately
      //     (the read-time fold stays order-independent, contributions into
      //     optional groups keep working), so what was missing was visibility,
      //     not a gate. A contribution aimed at an app no package here ships is
      //     NOT reported — that is the supported cross-artifact case.
      navGroupWarnings = await findNavGroupDiagnostics(result.data as Record<string, unknown>);
      if (navGroupWarnings.length > 0 && !flags.json) {
        console.log('');
        printWarning(
          `Navigation contributions aimed at a group the target app does not declare ` +
            `(${navGroupWarnings.length}) — the items still install, RELOCATED to the app's top level`,
        );
        printBulletList(
          navGroupWarnings.map((d) => `[${d.code}] ${d.message} Fix: ${d.fix}`),
          { noun: 'navigation-contribution diagnostic' },
        );
      }

      // [#18024] Permission sets declared under a name another package in this
      //     same compilation unit already owns. Reports, never refuses, and
      //     ⛔ changes nothing about the skip: refusing to write into a foreign
      //     row is correct under ADR-0086 D4 and unchanged — the whole declared
      //     set is dropped at runtime and until now no door said so before the
      //     deployment. A name owned by a package some OTHER artifact installed
      //     is NOT reported: that is the cross-artifact case a build cannot see.
      permissionSetCollisionWarnings =
        await findPermissionSetNameCollisions(result.data as Record<string, unknown>);
      if (permissionSetCollisionWarnings.length > 0 && !flags.json) {
        console.log('');
        printWarning(
          `Permission sets declared under a name another package in this artifact owns ` +
            `(${permissionSetCollisionWarnings.length}) — at runtime the ENTIRE declared set is ` +
            `dropped, not merged (ADR-0086 D4)`,
        );
        printBulletList(
          await formatPermissionSetNameCollisions(permissionSetCollisionWarnings),
          { noun: 'permission-set collision diagnostic' },
        );
      }

      if (!flags.json) printStep('Checking that every required capability has a provider installable in this edition...');
      const capProviderPreflight = preflightRequiredCapabilities({
        requires: Array.isArray((config as { requires?: unknown[] }).requires)
          ? ((config as { requires?: unknown[] }).requires as unknown[])
          : [],
        projectDir: dirname(absolutePath),
      });
      const capProviderErrors = capProviderPreflight.errors;
      capProviderWarnings = capProviderPreflight.warnings.map((c) => ({
        token: c.token,
        message: renderCapabilityMessage(c),
      }));
      if (capProviderErrors.length > 0) {
        if (flags.json) {
          await emitJson({
            valid: false,
            errors: capProviderErrors.map((c) => ({ token: c.token, message: renderCapabilityMessage(c) })),
            // [#12047] The FATAL tokens ride `errors`; the advisory ones ride
            // `warnings` beside the two lists computed before this gate. The
            // two classes being separate is the whole point of the split.
            warnings: warningsSoFar(),
            // [commit 79cf692b0] Computed at step 2, above this gate.
            conversions: conversionNotices,
            duration: timer.elapsed(),
          });
          this.exit(1);
        }
        console.log('');
        printError(`Capability provider check failed (${capProviderErrors.length} issue${capProviderErrors.length > 1 ? 's' : ''})`);
        for (const c of capProviderErrors) {
          console.log(`  • ${renderCapabilityMessage(c)}`);
        }
        this.exit(1);
      }

      // 3c. Package docs (ADR-0046) — flatness, namespace-prefixed names, the
      //     MDX/image ban, same-package link resolution. `os build` has always
      //     FAILED on a doc error (the artifact is the publish unit, so that is
      //     the publish lint for docs) while this command never ran it: the same
      //     "build rejects what validate accepts" hole #4409 found among the
      //     metadata rules, one gate over. It went unnoticed because the parity
      //     guard keyed on the `lint*`/`validate*` naming convention and this
      //     one is called `collectAndLintDocs`.
      //
      //     Not a registry rule: it reads `src/docs/*.md` off disk.
      if (!flags.json) printStep('Checking package docs (ADR-0046)...');
      const docsResult = collectAndLintDocs(absolutePath, result.data as Record<string, unknown>);
      const docErrors = docsResult.issues.filter((i) => i.severity === 'error');
      docWarnings = docsResult.issues.filter((i) => i.severity !== 'error');
      if (docErrors.length > 0) {
        if (flags.json) {
          await emitJson({
            valid: false,
            errors: docErrors,
            // [#12047] Was `ruleAdvisories` alone, on the very exit that had
            // the most computed: the doc advisories from this same call, the
            // capability hints, and the pre-parse key findings were all in
            // hand and none of them reached the payload.
            warnings: warningsSoFar(),
            // [commit 79cf692b0] Computed at step 2, above this gate.
            conversions: conversionNotices,
            duration: timer.elapsed(),
          });
          this.exit(1);
        }
        console.log('');
        printError(`Package docs validation failed (${docErrors.length} issue${docErrors.length > 1 ? 's' : ''})`);
        // [#11642] `--json` on this same exit publishes them all as `errors`.
        printDocIssueErrors(docErrors, { remedy: JSON_FULL_LIST_REMEDY });
        this.exit(1);
      }

      // 4. Collect and display stats
      const stats = collectMetadataStats(config);

      // Protocol drift advisory (non-blocking): if the installed platform is a
      // newer major than the app's declared `engines.protocol` range admits,
      // point at the migration guide.
      const protocolGap = checkProtocolVersionGap(config.manifest);

      // The minor-resolution half of the same question. `protocolGap` is null
      // for an app on `^17` running spec 17.4.0 — compatible at the major, and
      // silent about a release that narrowed accept-sets under the launch-window
      // convention. This reads the installed artifact's own per-release delta
      // (ADR-0087 D4), so `--json` answers "what moved in the release I have"
      // without a second worktree and a hand diff of two node_modules trees.
      const specReleaseChanges = readSpecReleaseChanges();

      // 4b. Structural advisories (non-blocking) — computed HERE, above the
      //     `if (flags.json)` branch, for exactly the reason `unknownKeyWarnings`
      //     is computed up beside `normalized`: everything below that branch only
      //     ever feeds the text path. These four were in that state — printed for
      //     a human, structurally unreachable for `--json`, which is the one
      //     audience the flag exists for. A CI script gating on
      //     `os validate --json` advisories saw `warnings: []` however true the
      //     conditions were. Computed once and consumed by BOTH faces below, so
      //     the two cannot disagree by construction — the same "a single list
      //     cannot drift from itself" move this file already had to make twice.
      structuralWarnings = [];
      if (stats.objects === 0) {
        structuralWarnings.push('No objects defined — this stack has no data model');
      }
      if (stats.apps === 0 && stats.plugins === 0) {
        structuralWarnings.push('No apps or plugins defined — this stack may not do much');
      }
      if (!config.manifest?.id) {
        structuralWarnings.push('Missing manifest.id — required for deployment');
      }
      if (!config.manifest?.namespace) {
        structuralWarnings.push('Missing manifest.namespace — required for multi-app hosting');
      }

      // 5. Warnings (non-blocking) — assembled HERE, above the `if (flags.json)`
      //    branch, because this is the list `--strict` gates on and the JSON
      //    face has to reach the SAME verdict from it. It could not: the payload
      //    was emitted and `return`ed above the only `flags.strict` reader, so
      //    `os validate --json --strict` exited 0 on the very configs
      //    `os validate --strict` exited 1 for. The flag was accepted,
      //    documented (`content/docs/deployment/cli.mdx` spells the pair twice
      //    in its CI/CD section, once as a GitHub Actions step) and inert — a
      //    pipeline gating on the exit status of the documented invocation read
      //    0 and called the stack clean.
      //
      //    Hoisting the assembly rather than restating the condition is the same
      //    move `structuralWarnings` just above and `unknownKeyWarnings` up
      //    beside `normalized` already made, for the third time in this file:
      //    ONE list, consumed by both faces, so the two exit codes cannot drift
      //    from each other by construction. The push ORDER is unchanged, so the
      //    text face's warning output is byte-for-byte what it was.
      const warnings: string[] = [];

      // [#3366] Installable-provider hints — a declared capability whose provider
      // is absent but addable (`pnpm add`), or an unknown token (typo).
      for (const w of capProviderWarnings) {
        warnings.push(w.message);
      }

      // [#3786] Undeclared object/field keys — computed pre-parse above,
      // alongside `normalized`, for the same reason.
      warnings.push(...unknownKeyWarnings);

      // ADR-0087 D2 conversion notices: the source used a deprecated shape that
      // was auto-converted at load. No action is required to keep loading, but
      // the notice steers the author to the canonical key before it retires.
      for (const n of conversionNotices) {
        warnings.push(formatConversionNotice(n));
      }

      // Every advisory the registry raised. All of them feed `--strict` now:
      // before, roughly half were printed inline and invisible to it, so
      // `--strict` failed or passed depending on which gate happened to raise
      // the finding — a second, quieter version of the same coverage drift.
      for (const f of ruleAdvisories) {
        warnings.push(`${f.where}: ${f.message}`);
      }
      for (const w of docWarnings) {
        warnings.push(`${w.path}: ${w.message}`);
      }

      // The four structural advisories, computed further up so the `--json`
      // payload can carry them too. Appended HERE, last, in the position the
      // four inline `if` blocks used to occupy, so the text face's warning ORDER
      // is byte-for-byte what it was.
      warnings.push(...structuralWarnings);

      if (flags.json) {
        await emitJson(
          {
            valid: true,
            manifest: config.manifest,
            stats,
            // One advisory list for the whole registry. This used to be a
            // hand-maintained concatenation of per-gate arrays, and it leaked
            // twice: warnings computed and then dropped from `--json` while the
            // console printed them. A single list cannot drift from itself.
            // [#12047] The spread that used to be written out here now lives
            // at `warningsSoFar()` above, which every one of the six exits
            // reads. Content is unchanged on this payload — what changed is
            // that a seventh exit cannot be added with a different member
            // order, and the five failure exits no longer publish less than
            // this one.
            warnings: warningsSoFar(),
            conversions: conversionNotices,
            // [#14261] The key now spells the axis it reports. That axis
            // moved from the undeclared `manifest.specVersion` to
            // `manifest.engines.protocol` in #13860, and the published key
            // name lagged one release behind it. A key spelled `specVersion*`
            // invites the inference that `manifest.specVersion` is writable;
            // `ManifestSchema` was not `.strict()` and dropped unknown keys with
            // nothing said until commit 4d0d9445a, so acting on that inference produced a
            // manifest that looked fine and whose line never took effect. The
            // rename is one stroke, no alias, no dual-key window; its value
            // shape is unchanged.
            protocolVersionGap: protocolGap,
            // A sibling key, deliberately, rather than a widening of the one
            // above: `protocolVersionGap` non-null means "the platform on disk
            // is outside the range you declared", and a consumer gating CI on
            // that must not start failing because an ordinary minor shipped
            // exports. One key, one question.
            specReleaseChanges,
            duration: timer.elapsed(),
          },
          // `--strict` means one thing — "treat warnings as errors" — and it now
          // means it on both faces. The gate reads `warnings`, the text face's
          // OWN list, rather than the payload's `warnings` field: the two differ
          // by the ADR-0087 conversion notices, which the text face folds into
          // its `⚠` block while the payload carries them under `conversions`.
          // Gating on the payload field would have left `--json --strict` at 0
          // for a config whose only advisories are conversion notices — the
          // same divergence one collection narrower. `protocolVersionGap` stays
          // out on both faces; it is never gated by `--strict` (see below).
          //
          // [#20113] The difference runs the other way too, and that half is
          // deliberate: the navigation-contribution and permission-set
          // advisories (#14553, #18024) and the JSX gate's parse-level notice
          // ride the payload's `warnings` but not this list, so none of them
          // is gated by `--strict` on either face — each has its own text
          // block rather than a `⚠` line in the one below.
          //
          // `valid: true` beside a 1 is not a contradiction, it is the text
          // face verbatim: that path prints "Validation passed" and THEN fails
          // for strict. The stack IS schema-valid; `--strict` is what promotes
          // its advisories to a failure.
          //
          // The status rides in `emitJson`'s `CliExitCode` slot rather than a
          // following `this.exit(1)`, unlike the failure paths above: those
          // must stop a fall-through into the text rendering, while here the
          // payload is complete and the `return` is right there. The slot is
          // the declared channel for pairing a `--json` document with the
          // status the shell reads (`utils/format.ts`; pinned by
          // `utils/format.exit-code.test.ts` and `test/migrate-exit-code.e2e.test.ts`),
          // and it emits the one document without an ExitError unwinding
          // through the catch below.
          flags.strict && warnings.length > 0 ? 1 : 0,
        );
        return;
      }

      // 6. Display results
      console.log('');
      printSuccess(`Validation passed ${chalk.dim(`(${timer.display()})`)}`);
      console.log('');

      if (config.manifest) {
        console.log(`  ${chalk.bold(config.manifest.name || config.manifest.id || 'Unnamed')} ${chalk.dim(`v${config.manifest.version || '0.0.0'}`)}`);
        if (config.manifest.description) {
          console.log(chalk.dim(`  ${config.manifest.description}`));
        }
        console.log('');
      }

      printMetadataStats(stats);

      if (warnings.length > 0) {
        console.log('');
        for (const w of warnings) {
          console.log(chalk.yellow(`  ⚠ ${w}`));
        }
        // The text face's half of the `--strict` gate. Its JSON counterpart is
        // the `CliExitCode` argument at the `emitJson` call above, reading this
        // same `warnings` list — change one and change the other, or the two
        // faces start disagreeing about the exit status again.
        if (flags.strict) {
          console.log('');
          printError('Strict mode: warnings treated as errors');
          this.exit(1);
        }
      }

      // Non-blocking upgrade advisory — never gated by --strict.
      if (protocolGap) {
        console.log('');
        console.log(chalk.yellow(`  ⚠ ${protocolGap.message}`));
        console.log(chalk.dim(`      → ${protocolGap.hint}`));
      }

      console.log('');
    } catch (error: any) {
      if (isExitSignal(error)) throw error;
      if (flags.json) {
        // [#20583] The ADR-0087 D2 conversions a stack PRODUCER applied before
        // it REFUSED — step 1b's fold, for the run whose load threw. A refusing
        // `defineStack` / `composeStacks` returns no stack, so step 1b never
        // ran; the producer stamps what it had applied on the ADR-0112 refusal
        // it throws instead, and `stackConversionsOf` reads it off the caught
        // error — `[]` for any other throw (a plain `Error`, this command's own
        // refusals). ⛔ Folded, never recomputed: no second conversion pass
        // over the authored source, no reading of the producer's stderr line
        // (warn-once per process, so it can be missing). Cannot double-count:
        // this command calls no producer itself, so only the config module's
        // load can raise a stamped refusal, and a throwing load precedes both
        // other fillers of this list.
        conversionNotices.push(...stackConversionsOf(error));
        await emitJson({
          valid: false,
          error: error.message,
          ...errorCodeFields(error),
          // [#12047] Whatever the run had reached before the throw. A config
          // that dies in `loadConfig` reports `[]` here honestly — nothing was
          // computed yet — while a throw from a later step (a `src/docs` that
          // is a FILE, say, which makes `readdirSync` raise ENOTDIR) carries
          // the three lists already in hand.
          warnings: warningsSoFar(),
          // [commit 79cf692b0] Same reading, one field over: `[]` for a throw at load —
          // step 2 had not run — except a producer's refusal, which carries the
          // conversions it applied (folded just above); the notices in hand for
          // any later throw.
          conversions: conversionNotices,
          duration: timer.elapsed(),
        });
        this.exit(1);
      }
      // [#15547] `resolveConfigPath()` already wrote its refusal and hint
      // lines to stderr before throwing; printing the sentence again here
      // would put a second copy on stdout.
      if (!isReportedError(error)) {
        console.log('');
        printError(error.message || String(error));
      }
      this.exit(1);
    }
  }
}
