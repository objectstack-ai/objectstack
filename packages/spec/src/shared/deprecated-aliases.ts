// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PRE-PARSE authoring lint for DEPRECATED ALIASES (#3743).
 *
 * A deprecated alias is resolved by the parse itself: `ActionSchema`'s transform
 * folds `execute` into `target` and DROPS it from the output (#3713 / #3742). So
 * every check that runs on parsed metadata — the CLI's `lintFlowPatterns`,
 * `lintViewRefs`, `@objectstack/lint`'s validators, a renderer, the runtime — is
 * structurally blind to the one thing worth reporting here: that the author
 * declared the alias at all, let alone that they put a *different* handler in it.
 *
 * That leaves exactly one window: **after `normalizeStackInput`, before the
 * parse.** This module is the rule set for that window, kept in `spec` rather
 * than in a lint package because the two places that own that window both live
 * upstream of `@objectstack/lint`:
 *
 *   1. `defineStack` (`stack.zod.ts`) — the dominant authoring path, and the one
 *      that consumes the alias EARLIEST. It parses inside the author's own
 *      config module, so by the time `os build` loads that module the alias is
 *      already gone. A CLI-only warning would therefore never fire for a
 *      `defineStack` app — i.e. for almost every app.
 *   2. The CLI's `os build` / `os validate` pre-parse pass — which is where a
 *      stack that did NOT go through strict `defineStack` gets caught: a plain
 *      object default-export, `defineStack(…, { strict: false })`, or an inline
 *      function handler (`z.string()` rejects those, so they cannot pass through
 *      strict `defineStack` at all and are lowered by the CLI instead).
 *
 * Each layer warns only for the discards IT performs, so an authored conflict
 * produces exactly one warning no matter which path the stack takes.
 *
 * Rules:
 *
 *   action-target-execute-conflict — WARNING
 *     An action declares BOTH the canonical `target` and its deprecated alias
 *     `execute`, with different values. `target` wins everywhere (#3742) and
 *     `execute` is discarded — silently, until now: the author wrote two
 *     handlers and one of them is thrown away with no signal (Prime Directive
 *     #12). Advisory rather than fatal, because the resulting stack is
 *     well-defined and shippable; the cost is a handler that never runs, not a
 *     broken build. Identical values in both slots are harmless duplication and
 *     stay quiet.
 *
 * Advisory-only today, but `severity` is modelled and honoured by every call
 * site, so a future rule here can gate the build without rewiring any of them.
 */

export interface DeprecatedAliasFinding {
  /** Author-facing location, e.g. `action 'convert' on object 'crm_deal'`. */
  where: string;
  /** What was discarded and why — states the precedence explicitly. */
  message: string;
  /** The one-line fix. */
  hint: string;
  /** Stable rule id, e.g. {@link ACTION_TARGET_EXECUTE_CONFLICT}. */
  rule: string;
  /**
   * `'error'` FAILS the build; `'warning'` (the default when absent) prints and
   * continues. `os build` and `os validate` both filter on this field, so a rule
   * promoted here gates both surfaces at once (#3782).
   */
  severity?: 'error' | 'warning';
}

type AnyRec = Record<string, unknown>;

/** Normalise a record-or-map metadata slot into an array, injecting `name` from
 *  the map key (mirrors the helper in the CLI's sibling authoring lints). */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  return [];
}

export const ACTION_TARGET_EXECUTE_CONFLICT = 'action-target-execute-conflict';

/** A handler slot counts as declared when it holds a non-empty string ref or an
 *  inline callable. Both forms are authorable and both resolve by the same
 *  `target`-wins precedence. */
function isDeclaredHandler(v: unknown): boolean {
  return typeof v === 'function' || (typeof v === 'string' && v.length > 0);
}

/** Render a handler slot for an author-facing message. An inline function has no
 *  useful printable value — naming the shape is what makes the message land. */
function describeHandler(v: unknown): string {
  return typeof v === 'function' ? 'an inline function' : `'${String(v)}'`;
}

/**
 * Collect deprecated-alias findings from a NORMALIZED (not yet parsed) stack.
 *
 * Pure and side-effect free: callers decide how to surface the findings —
 * `defineStack` warns on the console, the CLI folds them into its authoring-lint
 * block. Safe to call on a stack that still holds inline functions.
 */
export function lintDeprecatedAliases(stack: AnyRec): DeprecatedAliasFinding[] {
  const findings: DeprecatedAliasFinding[] = [];

  // An action commonly appears BOTH top-level and nested under its object (the
  // loader auto-populates `objects[*].actions` from `actions[*].objectName`), so
  // dedupe by identity + both slot values: one authored mistake, one finding.
  const seen = new Set<string>();

  const checkAction = (action: AnyRec, ownerObject?: string) => {
    if (!action) return;
    const { target, execute } = action;
    if (!isDeclaredHandler(target) || !isDeclaredHandler(execute)) return;
    // Same value in both slots (equal strings, or the very same function): the
    // alias is redundant, not contradictory, and nothing the author wrote is
    // lost. Staying quiet keeps the rule's signal-to-noise at 1.
    if (target === execute) return;

    const actionName = typeof action.name === 'string' && action.name ? action.name : '(unnamed)';
    // `\u0000` written as an escape, never as a raw byte: a literal NUL makes
    // ripgrep treat the whole file as binary and silently drop it from every
    // grep-based lint (`scripts/check-nul-bytes.mjs` enforces this).
    const dedupeKey = `${actionName}\u0000${describeHandler(target)}\u0000${describeHandler(execute)}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    findings.push({
      where: ownerObject ? `action '${actionName}' on object '${ownerObject}'` : `action '${actionName}'`,
      message:
        `Action declares both 'target' (${describeHandler(target)}) and the deprecated alias 'execute' ` +
        `(${describeHandler(execute)}). 'target' wins: 'execute' is dropped while the stack is compiled and ` +
        `never reaches the runtime or a renderer, so ${describeHandler(execute)} never runs.`,
      hint:
        `Delete 'execute' — it is a deprecated alias of 'target', not a second handler. If ` +
        `${describeHandler(execute)} is the handler you meant to bind, put it in 'target' instead.`,
      rule: ACTION_TARGET_EXECUTE_CONFLICT,
      severity: 'warning',
    });
  };

  // Object-nested first so the retained (deduped) finding keeps object context.
  for (const obj of asArray(stack.objects)) {
    const object = typeof obj.name === 'string' ? obj.name : undefined;
    for (const action of asArray(obj.actions)) checkAction(action, object);
  }
  for (const action of asArray(stack.actions)) checkAction(action);

  return findings;
}

/** One-line console rendering, shared so `defineStack` and any other
 *  console-bound caller phrase the warning identically. */
export function formatDeprecatedAliasFinding(f: DeprecatedAliasFinding): string {
  return `${f.where}: ${f.message}\n  ${f.hint}\n  rule: ${f.rule}`;
}
