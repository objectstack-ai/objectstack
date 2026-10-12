// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os lint` rule: a registered handler that cannot be lowered to a
 * metadata-only body (commit ada3834ad).
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
 *   `free-identifiers`  ACCIDENTAL. The author wrote something that reads
 *                       self-contained, and the platform quietly re-shaped the
 *                       deployment behind them — its own message even says "no
 *                       behavior change", which is true of behaviour and false
 *                       of shape. => `error`, for both sub-cases:
 *                         · a module-scope const/helper/import — remedy is
 *                           local: inline the value.
 *                         · a global the NODE HOST has and the sandbox does not
 *                           (#14301, `Intl`) — NOT inlinable, and still
 *                           accidental rather than a chosen bundle: `Intl` is a
 *                           standard global in every browser and in Node, so
 *                           writing it is not the recognisable "I am reaching
 *                           for the host" act that `fetch(`/`process.` are.
 *                           That is why it is an `error` here and not the
 *                           `warning` its structural cousin gets — and why the
 *                           remedy sentence below is CHOSEN per sub-case.
 *   `forbidden-token`   STRUCTURAL. `fetch`/`require`/`process`/`eval`/… are
 *                       capabilities the sandbox does not have, so the handler
 *                       can NEVER be a metadata body. Writing one IS choosing a
 *                       bundled closure, and the bundle is the designed answer
 *                       (the refusal text says "declare a Connector recipe
 *                       instead"). Reporting it is right; failing on it would
 *                       punish the legitimate path. => `warning`.
 *   `unparseable`       An instrument LIMIT: the extractor found no body it
 *                       could judge. Not a verdict about the author — reported
 *                       under its own rule, with prose that names the
 *                       instrument, never as the author choosing a bundle.
 *                       => `warning`.
 *   `unknown`           An instrument FAILURE (a non-`HookBodyExtractionError`
 *                       throw — the extractor itself broke). Same discipline,
 *                       its own rule; kept distinct from `unparseable` on
 *                       purpose. => `warning`.
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
 * This rule calls the SAME `extractLoweredBody` that `lowerCallables` calls, on
 * the same normalized input and with the same face (`hook` for a hook handler,
 * `action` for an action target — #22837 made the two lower differently). It
 * therefore cannot drift from what `os build` would do to the same handler — the
 * #3782 class (two surfaces disagreeing about what an author is told) is closed
 * by construction here, not by a second implementation kept in sync by hand.
 */

import { extractLoweredBody, HookBodyExtractionError, type LoweringFace } from '../utils/extract-hook-body.js';

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
/** The rule name when the extractor found no body it could judge (`unparseable`). */
export const UNPARSEABLE_BODY_RULE = 'hook-body/unparseable';
/** The rule name when the extraction instrument itself threw (kind `unknown`). */
export const EXTRACTION_FAILED_RULE = 'hook-body/extraction-failed';

// [#22161] Each finding prints one verdict sentence of at most this many
// characters and one `fix:` line; the reasoning — why a bundle is a change of
// deployment shape, the two ways to bundle on purpose, why an instrument limit
// is not a verdict — is each rule's `RULE_EXPLANATIONS` entry in
// `@objectstack/lint`, behind `os explain <rule-id>`.
const VERDICT_LIMIT = 200;

/** How many names a verdict quotes before it counts the rest. */
const MAX_QUOTED_NAMES = 3;

const nameList = (names: readonly string[]): string =>
  names.length <= MAX_QUOTED_NAMES
    ? names.join(', ')
    : `${names.slice(0, MAX_QUOTED_NAMES).join(', ')} and ${names.length - MAX_QUOTED_NAMES} more`;

/** `text` cut to `limit` characters at a word boundary, marked `…` when it was cut. */
function bounded(text: string, limit: number = VERDICT_LIMIT): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const space = cut.lastIndexOf(' ');
  return `${space > limit / 2 ? cut.slice(0, space) : cut}…`;
}

/**
 * The extractor's verdict on a refused handler, as one clause: the first line
 * of its refusal without the `[hook-body-extract] <origin>: ` lead the
 * finding's own subject already carries, cut where the verdict clause ends.
 *
 * The extractor writes each refusal verdict first — what the sandbox cannot
 * supply, then ` — ` and why, the remedy and the bundled alternative — so its
 * first ` — ` (or first full stop) ends the verdict. Nothing the cut drops is
 * lost: `os build` prints the whole first line for every bundled handler, and
 * `os build --strict-body` the full diagnostic.
 */
function refusalVerdict(firstLine: string, originLabel: string): string {
  const lead = `[hook-body-extract] ${originLabel}: `;
  const reason = firstLine.startsWith(lead) ? firstLine.slice(lead.length) : firstLine;
  const ends = [reason.indexOf(' — '), reason.indexOf('. ')].filter((i) => i > 0);
  return ends.length > 0 ? reason.slice(0, Math.min(...ends)) : reason.replace(/\.\s*$/, '');
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

type AnyFn = (...args: unknown[]) => unknown;

/**
 * Run `extractLoweredBody` over one callable and turn a refusal into an issue.
 * Returns `null` when the body extracts cleanly — i.e. the callable really does
 * ship as metadata.
 */
function judge(fn: AnyFn, originLabel: string, path: string, face: LoweringFace): HookBodyLintIssue | null {
  try {
    extractLoweredBody(fn, originLabel, face);
    return null;
  } catch (err: unknown) {
    const kind = err instanceof HookBodyExtractionError ? err.kind : 'unknown';
    const free = err instanceof HookBodyExtractionError ? err.freeIdentifiers : [];
    // [#14301] The half of `free` the Node HOST provides and the sandbox does
    // not. Read off the refusal rather than re-derived here: this rule's whole
    // parity claim is that it cannot disagree with what `os build` did to the
    // same handler, and a second membership table in this file would be exactly
    // such a disagreement waiting to happen.
    const nodeOnly = err instanceof HookBodyExtractionError ? err.nodeOnlyIdentifiers : [];
    // Only the first line: the refusal text carries a multi-line offending-source
    // dump for `--strict-body`'s per-callable diagnostic, which would swamp a
    // lint report. `os build --strict-body` remains the place to read it whole.
    const firstLine = String((err as Error)?.message ?? err).split('\n')[0];

    if (kind === 'free-identifiers') {
      // The remedy sentence is chosen, not fixed. "Inline the value(s)" is
      // right for a module-scope helper and IMPOSSIBLE for a host global —
      // there is nothing to inline `Intl` from — so printing it for both would
      // send an author (or a code-writing model) after a second broken shape.
      const moduleScope = free.filter((n) => !nodeOnly.includes(n));
      const hostRemedy =
        `${nameList(nodeOnly)} ${nodeOnly.length === 1 ? 'is' : 'are'} provided by the Node host, ` +
        `not by the sandbox, so ${nodeOnly.length === 1 ? 'it' : 'they'} cannot be inlined: ` +
        `keep the check in a string handler ref, or move it to a validation rule.`;
      const inlineRemedy =
        `Inline the value(s) into the handler, or reach them through \`ctx\`.`;
      const remedy =
        nodeOnly.length === 0
          ? inlineRemedy
          : moduleScope.length === 0
            ? hostRemedy
            : `${hostRemedy} Inline ${nameList(moduleScope)} into the handler, ` +
              `or reach ${moduleScope.length === 1 ? 'it' : 'them'} through \`ctx\`.`;
      return {
        severity: 'error',
        rule: NOT_LOWERABLE_RULE,
        message: bounded(
          `${originLabel} cannot be lowered to a metadata-only body, so it is bundled (a change of ` +
            `deployment shape, not of behaviour): ${nameList(free)} ` +
            `${free.length === 1 ? 'is' : 'are'} not in scope inside the sandbox`,
        ),
        fix: bounded(remedy),
        path,
      };
    }

    if (kind === 'unparseable' || kind === 'unknown') {
      // An instrument LIMIT (`unparseable`: the extractor found no body it
      // could judge) or an instrument FAILURE (`unknown`: the extractor itself
      // threw something that is not a refusal). In both cases the tool is what
      // fell short — the event says nothing about what the author chose, so it
      // must not borrow the bundled-fallback prose below ("the body uses
      // something the sandbox cannot provide"), which asserts a verdict about
      // the handler. Kept distinct on purpose (commit ada3834ad): an instrument failure
      // must not read as a verdict about the author.
      if (kind === 'unparseable') {
        // The extractor's own line says only that it could not parse the body
        // and asks for a rewrite, which is this finding's verdict and fix.
        return {
          severity: 'warning',
          rule: UNPARSEABLE_BODY_RULE,
          message: bounded(
            `${originLabel} could not be analysed: the extractor found no function body it could judge, ` +
              `which is a limit of the instrument, not a verdict about the handler`,
          ),
          fix: 'Rewrite it as a single arrow function or named function expression; until then `os build` bundles it.',
          path,
        };
      }
      // The thrown error is the only clue to what broke, so the verdict quotes
      // its first line, cut to the room the sentence leaves.
      const frame = (thrown: string): string =>
        `${originLabel} could not be analysed: the extraction instrument itself failed (${thrown}), ` +
        `which is not a verdict about the handler`;
      return {
        severity: 'warning',
        rule: EXTRACTION_FAILED_RULE,
        message: frame(bounded(firstLine, Math.max(40, VERDICT_LIMIT - frame('').length))),
        fix: 'Nothing to change in the handler: `os build` bundles it, and `os build --strict-body` prints the error in full.',
        path,
      };
    }

    // `forbidden-token` — the only kind left, and the only one whose prose may
    // assert the author's choice: the sandbox genuinely cannot provide what the
    // body uses, so the bundle is the designed answer.
    return {
      severity: 'warning',
      rule: BUNDLED_FALLBACK_RULE,
      message: bounded(
        `${originLabel} is bundled, not shipped as a metadata-only body: ${refusalVerdict(firstLine, originLabel)}`,
      ),
      fix:
        'None, if the bundle is intended; to ship it as metadata, remove what the refusal names ' +
        '(`os build` prints the refusal and its remedy in full).',
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
      const issue = judge(raw.handler as AnyFn, `hook '${name}'`, `hooks[${i}].handler`, 'hook');
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
        'action',
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
