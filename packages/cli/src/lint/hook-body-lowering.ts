// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os lint` rule: a registered handler that cannot be lowered to a
 * metadata-only body (#13651).
 *
 * ## The defect this closes
 *
 * An L2 hook handler is lowered to a metadata-only `body.source` and evaluated
 * in QuickJS with no module scope. When the handler reaches out of that scope,
 * `extractHookBody` refuses — and `lowerCallables` catches the refusal, records
 * it, and ships the callable through the back-compat `.mjs` bundle instead.
 * `os build` exits 0. The hook keeps working locally. What changed silently is
 * the DEPLOYMENT SHAPE: the app has stopped being shippable as pure metadata.
 *
 * The refusal was never the missing piece — `extractHookBody` had already
 * computed the exact free-identifier list. What was missing is that nothing
 * said NO to the recorded array. This rule is that "no".
 *
 * ## Why a lint `error` and not a build failure
 *
 * `os lint` exits 1 on an `error`, so a gate can fail on this — which is what
 * the card asked for — WITHOUT changing what `os build` accepts. That
 * separation is deliberate and load-bearing:
 *
 *   - `os build`'s warn-and-bundle is a published behaviour that downstream
 *     apps this repo cannot measure depend on. Flipping its default to a hard
 *     failure is a contract act, and the in-tree note at `compile.ts` step 2c
 *     already records that position.
 *   - `os lint`'s own rubric, by contrast, is explicitly "a lint verdict, not a
 *     publish gate" (see `lintConfig`), which is exactly the tier this belongs
 *     in. The shared authoring-rule registry could not host it either way: its
 *     `gating` tier must be run by all three commands (so it WOULD move the
 *     build's accept set) and its `advisory` tier can never emit an `error`.
 *
 * ## What separates an author's mistake from a deliberate bundle
 *
 * Today both arrive through one catch, so they share one fate. They are not
 * the same event, and the refusal kind already tells them apart:
 *
 *   `free-identifiers`  ACCIDENTAL. The handler IS expressible as a metadata
 *                       body; it merely names a module-scope const/helper/
 *                       import. The author wrote something that reads
 *                       self-contained, and the platform quietly re-shaped the
 *                       deployment behind them — its own message even says "no
 *                       behavior change", which is true of behaviour and false
 *                       of shape. Remedy is local: inline the value. => `error`.
 *   `forbidden-token`   STRUCTURAL. `fetch`/`require`/`process`/`eval`/… are
 *                       capabilities the sandbox does not have, so the handler
 *                       can NEVER be a metadata body. Writing one IS choosing a
 *                       bundled closure, and the bundle is the designed answer
 *                       (the refusal text says "declare a Connector recipe
 *                       instead"). Reporting it is right; failing on it would
 *                       punish the legitimate path. => `warning`.
 *   `unparseable`       An instrument limit, not a verdict about the author.
 *                       => `warning`.
 *
 * An author who deliberately wants a bundled closure for the ACCIDENTAL class
 * is not cornered: two declarative channels already exist and are already
 * silent here, and neither needs a new spec key.
 *
 *   1. Give the hook an explicit `body` — extraction is skipped entirely
 *      (`lowerCallables` only extracts `if (!hook.body)`).
 *   2. Move the function into the top-level `functions:` map and reference it
 *      from the hook by NAME (`handler` accepts a string). That path registers
 *      the callable for bundling and never attempts extraction at all — which
 *      is measurably how three callables in this repo's own examples already
 *      ship, warning-free.
 *
 * So the inline-function form means "I intend this to be a hook body" and the
 * named-`functions:` form means "I intend this to be bundled code". That
 * distinction already existed in the authoring surface; nothing was reading it.
 *
 * ## Parity
 *
 * This rule calls the SAME `extractHookBody` that `lowerCallables` calls, on
 * the same normalized input. It therefore cannot drift from what `os build`
 * would do to the same handler — the #3782 class (two surfaces disagreeing
 * about what an author is told) is closed by construction here, not by a
 * second implementation kept in sync by hand.
 */

import { extractHookBody, HookBodyExtractionError } from '../utils/extract-hook-body.js';

/** Mirrors `LintIssue` in `../commands/lint.ts` (structurally compatible). */
export interface HookBodyLintIssue {
  severity: 'error' | 'warning' | 'suggestion';
  rule: string;
  message: string;
  path: string;
  fix?: string;
}

/** The rule name a gate greps for when the handler could have been metadata. */
export const NOT_LOWERABLE_RULE = 'hook-body/not-lowerable';
/** The rule name for a refusal whose designed answer is the bundle. */
export const BUNDLED_FALLBACK_RULE = 'hook-body/bundled-fallback';

const DELIBERATE_BUNDLE_REMEDY =
  'If a bundled closure is what you want, say so: give the hook an explicit `body`, ' +
  'or move the function into the top-level `functions:` map and reference it by name ' +
  '(`handler: \'<fn_name>\'`) — neither is lowered to a metadata body.';

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

type AnyFn = (...args: unknown[]) => unknown;

/**
 * Run `extractHookBody` over one callable and turn a refusal into an issue.
 * Returns `null` when the body extracts cleanly — i.e. the callable really does
 * ship as metadata.
 */
function judge(fn: AnyFn, originLabel: string, path: string): HookBodyLintIssue | null {
  try {
    extractHookBody(fn, originLabel);
    return null;
  } catch (err: unknown) {
    const kind = err instanceof HookBodyExtractionError ? err.kind : 'unknown';
    const free = err instanceof HookBodyExtractionError ? err.freeIdentifiers : [];
    // Only the first line: the refusal text carries a multi-line offending-source
    // dump for `--strict-body`'s per-callable diagnostic, which would swamp a
    // lint report. `os build --strict-body` remains the place to read it whole.
    const firstLine = String((err as Error)?.message ?? err).split('\n')[0];

    if (kind === 'free-identifiers') {
      return {
        severity: 'error',
        rule: NOT_LOWERABLE_RULE,
        message:
          `${originLabel} cannot be lowered to a metadata-only body: it references ` +
          `${free.length === 1 ? 'the identifier' : 'identifiers'} ${free.join(', ')}, which ` +
          `${free.length === 1 ? 'is' : 'are'} not in scope inside the sandbox. The handler is ` +
          `BUNDLED instead, so this app is no longer shippable as pure metadata — a change of ` +
          `deployment shape, not of behaviour. Inline the value(s) into the handler, or reach ` +
          `them through \`ctx\`. ${DELIBERATE_BUNDLE_REMEDY}`,
        path,
      };
    }

    return {
      severity: 'warning',
      rule: BUNDLED_FALLBACK_RULE,
      message:
        `${originLabel} is bundled rather than shipped as a metadata-only body. ${firstLine} ` +
        `This is the designed fallback — the body uses something the sandbox cannot provide — ` +
        `but the app is not pure metadata while it is here.`,
      path,
    };
  }
}

/**
 * Every registered callable `lowerCallables` would attempt to extract, judged.
 *
 * Deliberately mirrors that function's walk (hooks, object actions, top-level
 * actions) and its skip conditions (a string handler is already a bundle
 * reference; an explicit `body` opts out of extraction). A callable this rule
 * does not visit is one `os build` never attempts to lower either.
 */
export function checkHookBodyLowering(config: Record<string, unknown>): HookBodyLintIssue[] {
  const issues: HookBodyLintIssue[] = [];

  if (Array.isArray(config.hooks)) {
    config.hooks.forEach((raw, i) => {
      if (!isPlainObject(raw)) return;
      if (typeof raw.handler !== 'function') return; // string ref = deliberate bundle
      if (raw.body) return; // author supplied the body themselves
      const name =
        typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : 'anon_hook';
      const issue = judge(raw.handler as AnyFn, `hook '${name}'`, `hooks[${i}].handler`);
      if (issue) issues.push(issue);
    });
  }

  const judgeActions = (actions: unknown[], ownerLabel: string, pathPrefix: string): void => {
    actions.forEach((raw, i) => {
      if (!isPlainObject(raw)) return;
      if (typeof raw.target !== 'function') return;
      if (raw.body) return;
      const baseName =
        typeof raw.name === 'string' && raw.name.length > 0
          ? `${ownerLabel}_${raw.name}`
          : `${ownerLabel}_anon_action`;
      const issue = judge(
        raw.target as AnyFn,
        `action '${baseName}'`,
        `${pathPrefix}[${i}].target`,
      );
      if (issue) issues.push(issue);
    });
  };

  if (Array.isArray(config.objects)) {
    config.objects.forEach((rawObj, oi) => {
      if (!isPlainObject(rawObj)) return;
      if (!Array.isArray(rawObj.actions)) return;
      judgeActions(
        rawObj.actions,
        String(rawObj.name ?? 'object'),
        `objects[${oi}].actions`,
      );
    });
  }

  if (Array.isArray(config.actions)) {
    judgeActions(config.actions, 'global', 'actions');
  }

  return issues;
}
