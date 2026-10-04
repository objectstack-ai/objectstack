// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The author-time rule stage `os verify` runs FIRST — the pipeline `os validate`
 * runs, as one function that prints nothing and returns a verdict (#21323).
 *
 * ## The defect this exists to close
 *
 * `docs/NORTH-STAR.md` defines "done" as `objectstack verify` green. `verify`
 * booted the stack and exercised CRUD fidelity and the RLS invariant, and never
 * asked the author-time rule registry, so it answered green — exit 0, `✓ verify
 * passed` — on a stack `os validate`, `os build` and `os lint` all refuse. The
 * done-bar handed a false green to every author who used it, human or AI.
 *
 * ## The pipeline, step for step
 *
 * Each step is the one `commands/validate.ts` takes, through the same function,
 * in the same order:
 *
 *   1. `normalizeStackInput` — the `normalized` tier's source (step 2);
 *   2. `lowerCallables` BEFORE the parse — inline handlers become metadata
 *      bodies, so the `hook-body-*` family reads them (step 2b, #16544);
 *   3. `ObjectStackDefinitionSchema.safeParse` — the `parsed` tier's source.
 *      A stack that does not parse is refused HERE: the rules read the parsed
 *      stack, so there is no rule verdict to give about one that has none;
 *   4. `resolveJsxGateManifest` beside the CONFIG, never the invoker's working
 *      directory (step 3, #20113 / #20166);
 *   5. the union run — both tiers through `authoringRuleUnionStack`, so an
 *      option-B project whose definitions live only in `packages[]` is not
 *      judged as an empty stack (#17069), with the engine's own filter judge
 *      (#20158) and the lowered hook refs (#16546);
 *   6. the per-package pass, `runPerPackageAuthoringRules` — the one loop every
 *      door calls (step 3a-ii, #18677 / #18778).
 *
 * ⛔ No rule is named here, and no list of rules: which rules run is
 * `authoringRulesFor(command)` in `@objectstack/lint`'s one table, so a rule
 * added there reaches `os verify` the moment it reaches `os validate`.
 *
 * ## Why the doors do not call this function
 *
 * `os validate`, `os build` and `os lint` each wire these seams in their own
 * file, and four source-scan pins hold them there: the registry call with its
 * folded tiers (`test/validate-build-gate-parity.test.ts`,
 * `@objectstack/lint`'s `authoring-rule-wiring.test.ts`), the per-package pass
 * (`test/lint-per-package-authoring-seam.test.ts`) and the manifest read beside
 * the config (`src/utils/sdui-manifest.test.ts`). Lifting their stage into this
 * module moves the text those pins read, and retargeting them is a decision of
 * its own. Their output also interleaves with the stage — step lines, the JSX
 * notice, an exit between the union run and the per-package pass — which a
 * caller of a function that returns one verdict cannot reproduce byte for byte.
 * `os verify` has no such face to keep, so it takes the verdict whole.
 *
 * What holds THIS copy of the wiring to the doors' is behaviour, not source:
 * `test/verify-author-time-stage.test.ts` runs `os validate --json` and
 * `os verify --json` over one stack and requires the same gating findings,
 * and `author-time-rules.test.ts` beside this file pins the union fold on a
 * stack whose definitions live only in `packages[]` and the per-package pass
 * on a two-package artifact — the two seams a single-package stack cannot
 * tell apart.
 */

import type { ZodError } from 'zod';
import { ObjectStackDefinitionSchema, normalizeStackInput } from '@objectstack/spec';
import {
  runAuthoringRules,
  splitBySeverity,
  type AuthoringCommand,
  type AuthoringFinding,
} from '@objectstack/lint';
import { lowerCallables } from './lower-callables.js';
import { authoringRuleUnionStack } from './stack-collections.js';
import { stackFilterJudge } from './authoring-filter-judge.js';
import { resolveJsxGateManifest } from './sdui-manifest.js';
import { artifactPackages, runPerPackageAuthoringRules } from './artifact-packages.js';

/**
 * The registry door `os verify`'s rule stage runs.
 *
 * `'validate'`, read from what a door MEANS in `authoring-rules.ts`: every
 * gating rule runs on all three doors (the registry's own wiring guard fails
 * otherwise), so the doors differ only in advisories and in how they prepare
 * the stack. `'lint'` never parses — it hands the rules the normalized stack on
 * both tiers — and leaves out three advisories it reports through its own
 * data-model sweep. `'build'` and `'validate'` run the identical rule list over
 * a parsed stack. This stage prepares its tiers the way `os validate` does, and
 * the ruling asks for the findings `os validate` reports, so it asks that door.
 * Exported so `os verify` and the pins read the door from one place.
 */
export const VERIFY_RULE_COMMAND: AuthoringCommand = 'validate';

/** What refused the stack, when something did. */
export type AuthorTimeRefusal =
  /** The stack does not parse against the protocol — `os validate`'s schema exit. */
  | { stage: 'schema'; error: ZodError }
  /** The union run raised `error` findings — `os validate`'s step 3 exit. */
  | { stage: 'rules'; errors: AuthoringFinding[] }
  /** The per-package pass raised `error` findings — `os validate`'s step 3a-ii exit. */
  | { stage: 'package-rules'; errors: Array<{ package: string } & AuthoringFinding> };

export interface AuthorTimeVerdict {
  /** `null` when the stack passed every gating rule. */
  refusal: AuthorTimeRefusal | null;
  /**
   * The `warning` / `info` findings the stage reached before it stopped — the
   * JSX gate's parse-level notice, then the union run's, then the per-package
   * pass's. Never gating.
   */
  advisories: AuthoringFinding[];
}

/**
 * Run the author-time rule stage over a loaded config.
 *
 * `configDir` is the directory of the config `loadConfig` resolved — where the
 * project's SDUI component manifest is read (#20166). A project manifest that
 * exists but cannot be used is refused by `resolveJsxGateManifest` exactly as
 * on the doors: reported on stderr, then thrown.
 *
 * Reads `config` and never writes it: `normalizeStackInput` and
 * `lowerCallables` each return a new top-level object, so the config a caller
 * boots afterwards is the one it loaded.
 */
export function judgeAuthorTimeRules(
  command: AuthoringCommand,
  config: Record<string, unknown>,
  configDir: string,
): AuthorTimeVerdict {
  const normalized = normalizeStackInput(config) as Record<string, unknown>;
  const lowering = lowerCallables(normalized);
  const result = ObjectStackDefinitionSchema.safeParse(lowering.lowered);
  if (!result.success) {
    return { refusal: { stage: 'schema', error: result.error as unknown as ZodError }, advisories: [] };
  }
  const parsed = result.data as Record<string, unknown>;

  const jsxGate = resolveJsxGateManifest(parsed, configDir);
  const parsedUnion = authoringRuleUnionStack(parsed);
  const judgeFilter = stackFilterJudge(parsedUnion);
  const findings = runAuthoringRules(command, {
    normalized: authoringRuleUnionStack(normalized),
    parsed: parsedUnion,
    sduiManifest: jsxGate.sduiManifest,
    loweredHookRefs: lowering.loweredHookRefs,
    judgeFilter,
  });
  const union = splitBySeverity(findings);
  const advisories = [...jsxGate.notices, ...union.advisories];
  if (union.errors.length > 0) {
    return { refusal: { stage: 'rules', errors: union.errors }, advisories };
  }

  if (artifactPackages(parsed).length === 0) return { refusal: null, advisories };
  const perPackage = runPerPackageAuthoringRules({
    command,
    parsed,
    unionFindings: findings,
    sduiManifest: jsxGate.sduiManifest,
    loweredHookRefs: lowering.loweredHookRefs,
    judgeFilter,
  });
  advisories.push(...perPackage.advisories);
  if (perPackage.errors.length > 0) {
    return { refusal: { stage: 'package-rules', errors: perPackage.errors }, advisories };
  }
  return { refusal: null, advisories };
}
