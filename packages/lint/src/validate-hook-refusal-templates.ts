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
 * [#34374] A hook's declared texts (`HookSchema.texts`) are the same kind of
 * sentence, filled by the same engine from the same closed scope, so an entry
 * of `texts` that declares `params` is judged here too, at `texts.<key>.message`
 * — a text that cannot render would otherwise reach the business record with
 * its braces.
 *
 * Every finding is an ERROR: `objectstack validate` and `compile` fail, and the
 * publish gate refuses a `hook` write carrying one (the `hook` write type runs
 * this pass with the hook-`condition` walk it sits beside). An entry that
 * declares no `params` is plain text and the parse refuses every hole in it,
 * so it is not read here.
 *
 * [#34273] An action's refusal catalogue (`ActionSchema.refusals`) is the same
 * entry, so {@link actionRefusalTemplateIssues} judges it by the same rules,
 * on the action collections the action copy pass reads.
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
function currencyWithoutCode(holeText: string, inner: string, noun: 'hook' | 'action'): string | undefined {
  const bar = inner.indexOf('|');
  if (bar === -1) return undefined;
  const formatter = inner.slice(bar + 1).trim();
  if (formatter !== 'currency') return undefined;
  const path = inner.slice(0, bar).trim() || 'amount';
  return (
<<<<<<< HEAD
    `\`${holeText}\` formats in the organization's default currency, which a hook sentence does not carry, so the `
=======
    `\`${holeText}\` formats in the organization's default currency, which a ${noun} refusal does not carry, so the `
>>>>>>> f0e42de65 (wip(runtime,lint): answer an action body's throw against its refusal catalogue)
    + 'sentence would be served with its braces. Name the code in the hole: '
    + `\`{{ ${path} | currency:EUR }}\`.`
  );
}

/** Every finding one refusal catalogue draws, each located at `owner` + the sentence's path. */
function judgeCatalogue(issues: ExprIssue[], refusals: AnyRec, owner: string, noun: 'hook' | 'action'): void {
  for (const [code, entry] of Object.entries(refusals)) {
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
      const where = `${owner} ${path}`;
      const refuse = (message: string, source: string): void => {
        issues.push({ where, message, source, severity: 'error' });
      };
      for (const m of text.matchAll(HOLE)) {
        const refusal = currencyWithoutCode(m[0], m[1]!, noun);
        if (refusal !== undefined) refuse(refusal, m[0]);
      }
      for (const e of validateExpression('template', text).errors) refuse(e.message, e.source);
    }
  }
}

/**
 * The findings for every hook sentence of `stack` whose entry declares
 * `params` — each refusal entry's `message` and `reasons[*].message`, and
 * (#34374) each declared text's `message` (see the module header).
 */
export function hookRefusalTemplateIssues(stack: AnyRec): ExprIssue[] {
  const issues: ExprIssue[] = [];
  for (const hook of recordsOf(stack.hooks)) {
    const hookName = typeof hook.name === 'string' ? hook.name : '?';
<<<<<<< HEAD
    const sentences: Array<{ path: string; text: unknown }> = [];
    if (isRec(hook.refusals)) {
      for (const [code, entry] of Object.entries(hook.refusals)) {
        if (!isRec(entry) || paramsOf(entry).length === 0) continue;
        sentences.push({ path: `refusals.${code}.message`, text: entry.message });
        if (isRec(entry.reasons)) {
          for (const [reason, sentence] of Object.entries(entry.reasons)) {
            sentences.push({ path: `refusals.${code}.reasons.${reason}.message`, text: isRec(sentence) ? sentence.message : undefined });
          }
        }
      }
    }
    if (isRec(hook.texts)) {
      for (const [key, entry] of Object.entries(hook.texts)) {
        if (!isRec(entry) || paramsOf(entry).length === 0) continue;
        sentences.push({ path: `texts.${key}.message`, text: entry.message });
      }
=======
    if (!isRec(hook.refusals)) continue;
    judgeCatalogue(issues, hook.refusals, `hook '${hookName}'`, 'hook');
  }
  return issues;
}

/** Which action collections one run judges — the publish gate narrows them per write type. */
export interface ActionRefusalTemplateScope {
  /** The stack's top-level `actions[]`. */
  readonly actions: boolean;
  /** Each object's own `actions[]`. */
  readonly objects: boolean;
}

/**
 * [#34273] The same findings for an action's refusal catalogue
 * (`ActionSchema.refusals`, the hook catalogue's twin), across the
 * collections `scope` names. An action declared both top-level and on its
 * object is judged once, at the first place it is met — the de-duplication
 * the action copy pass applies.
 */
export function actionRefusalTemplateIssues(stack: AnyRec, scope: ActionRefusalTemplateScope): ExprIssue[] {
  const issues: ExprIssue[] = [];
  const seen = new Set<string>();
  const judge = (owner: string, action: AnyRec, objectName?: string): void => {
    const name = typeof action.name === 'string' ? action.name : '?';
    const bound = objectName ?? (typeof action.objectName === 'string' ? action.objectName : '');
    const key = `${bound}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (isRec(action.refusals)) judgeCatalogue(issues, action.refusals, `${owner} · action '${name}'`, 'action');
  };
  if (scope.actions) {
    for (const action of recordsOf(stack.actions)) judge('stack', action);
  }
  if (scope.objects) {
    for (const object of recordsOf(stack.objects)) {
      const objectName = typeof object.name === 'string' ? object.name : undefined;
      for (const action of recordsOf(object.actions)) judge(`object '${objectName ?? '?'}'`, action, objectName);
>>>>>>> f0e42de65 (wip(runtime,lint): answer an action body's throw against its refusal catalogue)
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
  return issues;
}
