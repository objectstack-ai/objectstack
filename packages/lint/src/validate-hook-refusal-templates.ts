// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33214] Judge the template sentences of a hook's refusal catalogue — an
 * entry's `message` and each of its `reasons[*].message` — for an entry that
 * declares `params` (`HookRefusalSchema`, `@objectstack/spec/data`).
 *
 * The save-time parse judges only the ROOTS of such a sentence's holes
 * (`closedScopeTemplateRefusal`: a hole over a name the entry does not declare,
 * a single-brace token). That reading skips every hole that does not compile as
 * a path, so a hole holding logic (`{{ state + 1 }}`), an unknown formatter
 * (`{{ state | shout }}`) or nothing at all (`{{ }}`) parsed — and the runtime,
 * which cannot render it, serves the declared sentence as written, braces and
 * all, to the person the hook refused. This pass is the compile half the
 * action copy slots already have (`validate-action-copy-templates.ts`): each
 * sentence is compiled as the `template` it is (`validateExpression('template',
 * …)`), which names logic, an unknown formatter and an empty hole.
 *
 * And one rule that is the hook refusal's own: a `{{ amount | currency }}` hole
 * with no argument formats in the organization's default currency, which a
 * flow run carries and a hook refusal does not, so the runtime cannot render
 * it either. It is refused with the spelling that names the code.
 *
 * Every finding is an ERROR: `objectstack validate` and `compile` fail, and the
 * publish gate refuses a `hook` write carrying one (the `hook` write type runs
 * this pass with the hook-`condition` walk it sits beside). An entry that
 * declares no `params` is plain text and the parse refuses every hole in it,
 * so it is not read here.
 */

import { validateExpression } from '@objectstack/formula';
import { recordsOf } from './object-graph.js';
import type { ExprIssue } from './validate-expressions.js';

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Every `{{ … }}` hole of a sentence, its inner text as written. */
const HOLE = /\{\{([^{}]*)\}\}/g;

/** The declared params of an entry, or none. */
function paramsOf(entry: AnyRec): string[] {
  return Array.isArray(entry.params) ? entry.params.filter((p): p is string => typeof p === 'string') : [];
}

/** The refusal of an argument-less `currency` formatter in one hole, or `undefined`. */
function currencyWithoutCode(holeText: string, inner: string): string | undefined {
  const bar = inner.indexOf('|');
  if (bar === -1) return undefined;
  const formatter = inner.slice(bar + 1).trim();
  if (formatter !== 'currency') return undefined;
  const path = inner.slice(0, bar).trim() || 'amount';
  return (
    `\`${holeText}\` formats in the organization's default currency, which a hook refusal does not carry, so the `
    + 'sentence would be served with its braces. Name the code in the hole: '
    + `\`{{ ${path} | currency:EUR }}\`.`
  );
}

/**
 * The findings for every hook refusal sentence of `stack` whose entry declares
 * `params` (see the module header).
 */
export function hookRefusalTemplateIssues(stack: AnyRec): ExprIssue[] {
  const issues: ExprIssue[] = [];
  for (const hook of recordsOf(stack.hooks)) {
    const hookName = typeof hook.name === 'string' ? hook.name : '?';
    if (!isRec(hook.refusals)) continue;
    for (const [code, entry] of Object.entries(hook.refusals)) {
      if (!isRec(entry)) continue;
      const params = paramsOf(entry);
      if (params.length === 0) continue;
      const sentences: Array<{ path: string; text: unknown }> = [{ path: `refusals.${code}.message`, text: entry.message }];
      if (isRec(entry.reasons)) {
        for (const [reason, sentence] of Object.entries(entry.reasons)) {
          sentences.push({ path: `refusals.${code}.reasons.${reason}.message`, text: isRec(sentence) ? sentence.message : undefined });
        }
      }
      for (const { path, text } of sentences) {
        if (typeof text !== 'string') continue;
        const where = `hook '${hookName}' ${path}`;
        const refuse = (message: string, source: string): void => {
          issues.push({ where, message, source, severity: 'error' });
        };
        for (const m of text.matchAll(HOLE)) {
          const refusal = currencyWithoutCode(m[0], m[1]!);
          if (refusal !== undefined) refuse(refusal, m[0]);
        }
        for (const e of validateExpression('template', text).errors) refuse(e.message, e.source);
      }
    }
  }
  return issues;
}
