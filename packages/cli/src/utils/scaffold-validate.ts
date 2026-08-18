// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Hold a freshly generated scaffold to the SAME author-time bar the user's
 * very next command holds it to.
 *
 * ## The defect this exists to close
 *
 * `objectstack init my-app -t app --install` printed `✓ Scaffold validated`
 * and the next command, `npm run dev`, failed to compile — the CLI's own
 * shipped template was refused by the CLI's own shipped rule set
 * (`security-owd-unset`: the template's object declared no `sharingModel`).
 * `init`'s self-test only checked that the rendered config *loaded* and
 * carried a `manifest.namespace`, so every author-time rule was unread at the
 * one moment the CLI is generating the metadata itself. The documented
 * on-ramp was dead and nothing in the CLI noticed.
 *
 * ## Why `'build'` and not `'validate'`
 *
 * `os dev` auto-compiles by spawning `os compile`, and `compile` runs
 * `authoringRulesFor('build')`. Running the *same* command's rule set here is
 * what keeps this a shift-left rather than a new, stricter gate: everything
 * that survives `init` is exactly what survives the `dev` the user runs
 * moments later. Picking a different command from the registry would let
 * `init` refuse a scaffold `dev` accepts (or the reverse) — a second bar, the
 * drift class `authoring-rules.ts` exists to prevent.
 *
 * The pipeline below mirrors `compile.ts` step-for-step for the same reason:
 * normalize → lower callables → Zod parse → registry. A rule reading a
 * differently-prepared stack is the same drift wearing a different hat.
 */

import { join } from 'node:path';
import { ObjectStackDefinitionSchema, normalizeStackInput } from '@objectstack/spec';
import type { ZodError } from 'zod';
import {
  runAuthoringRules,
  splitBySeverity,
  authoringRulesFor,
  type AuthoringCommand,
  type AuthoringFinding,
} from '@objectstack/lint';
import { lowerCallables } from './lower-callables.js';
import { resolveSduiManifest } from './sdui-manifest.js';

/**
 * The registry command whose rule set a generated scaffold is held to.
 *
 * Pinned to what `os dev` reaches through `os compile`. Exported so the pin
 * test asserts the coupling instead of restating the string.
 */
export const SCAFFOLD_RULE_COMMAND: AuthoringCommand = 'build';

export interface ScaffoldRuleReport {
  /** How many registry rules ran (for the progress line). */
  ruleCount: number;
  /** Protocol-schema failure, if the stack did not parse at all. */
  schemaError: ZodError | null;
  /** Gating findings — a non-empty list means `dev` would refuse this scaffold. */
  errors: AuthoringFinding[];
  /** `warning` / `info` findings — reported, never gating. */
  advisories: AuthoringFinding[];
}

/**
 * Run the author-time rule set over an already-loaded stack config.
 *
 * Takes the config *object* rather than a path so the caller owns module
 * loading (`init` bundle-requires the rendered config from the target dir,
 * which is not `process.cwd()`), and so the pin test can drive real template
 * output through the real rules without spawning a CLI.
 */
export function runScaffoldAuthoringRules(config: unknown): ScaffoldRuleReport {
  const normalized = normalizeStackInput(config as Record<string, unknown>);
  const lowering = lowerCallables(normalized as Record<string, unknown>);
  const result = ObjectStackDefinitionSchema.safeParse(lowering.lowered);

  if (!result.success) {
    return {
      ruleCount: authoringRulesFor(SCAFFOLD_RULE_COMMAND).length,
      schemaError: result.error as unknown as ZodError,
      errors: [],
      advisories: [],
    };
  }

  const findings = runAuthoringRules(SCAFFOLD_RULE_COMMAND, {
    normalized: normalized as Record<string, unknown>,
    parsed: result.data as Record<string, unknown>,
    sduiManifest: resolveSduiManifest(),
  });
  const { errors, advisories } = splitBySeverity(findings);

  return {
    ruleCount: authoringRulesFor(SCAFFOLD_RULE_COMMAND).length,
    schemaError: null,
    errors,
    advisories,
  };
}

/**
 * Load a generated scaffold's `objectstack.config.ts` and run the author-time
 * rule set over it.
 *
 * Module loading lives here — rather than in `init.ts` — so the pin test that
 * sweeps every built-in template drives the SAME loader the command does. A
 * test that re-implemented the load would be free to drift from it, and the
 * drift would land precisely in the "the CLI's own template does not compile"
 * class this whole file exists to close.
 *
 * The load is deliberately unchanged from what `init`'s self-test always did
 * (no `external` list): only the checking after it is stronger.
 *
 * Note on `resolveSduiManifest()`: it reads `process.cwd()`, which for `init`
 * is the directory the user invoked from, not `targetDir`. A freshly generated
 * scaffold has no `sdui.manifest.json` either way, so both resolve to the copy
 * shipped in `@objectstack/console` — the same input `os compile` gets when the
 * user runs `dev` inside the new project.
 */
export async function validateScaffold(targetDir: string): Promise<ScaffoldRuleReport & { namespace: string }> {
  const { bundleRequire } = await import('bundle-require');
  const { mod } = await bundleRequire({
    filepath: join(targetDir, 'objectstack.config.ts'),
    cwd: targetDir,
  });
  const stack = mod.default ?? mod;
  if (!stack?.manifest?.namespace) {
    throw new Error('Rendered config has no manifest.namespace');
  }
  return { namespace: String(stack.manifest.namespace), ...runScaffoldAuthoringRules(stack) };
}
