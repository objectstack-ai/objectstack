// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24814, ruling A] Judge an action's person-facing copy — the ADR-0032
 * `template` slots `confirmText`, `successMessage` and `errorMessage`
 * (`@objectstack/spec`'s `ui/action-copy-template.ts`) — wherever an action is
 * authored:
 *
 *  - a registered action (`stack.actions[]`, and an object's own `actions[]`):
 *    `confirmText` and `successMessage`, each a bare string, the parsed
 *    envelope, or an inline locale map whose every value is such a sentence —
 *    and, since #27948 (ruling A, step 2), `description`, each
 *    `outcomeMessages` entry (both with the locale map) and each
 *    `params[].helpText` (without it);
 *  - a page action row — `action:button` / `action:icon` `properties`, and
 *    each `properties.actions[]` member of an `action:group` / `action:menu` —
 *    all three keys;
 *  - a page component's inline `properties.action` (`InlineActionSchema`, the
 *    pick of `ActionSchema` an `element:button` carries): `confirmText`,
 *    `successMessage` and each `params[].helpText`.
 *
 * The same two steps the bulk `confirmText` pass takes, through the same
 * judge: `closedScopeTemplateRefusal` names a `${…}` or single-brace token
 * (with its `{{ }}` spelling where a bound root spells it) and a hole over a
 * root the runner does not bind; a text carrying neither is compiled as the
 * `template` it is (`validateExpression('template', …)`), which names a hole
 * holding logic or an unknown formatter. A blank sentence is named too. Each
 * key's roots are the spec's, measured at the console's runner:
 * `actionConfirmTemplateRoots(action)` (also for `description` and
 * `helpText`, the param dialog's copy), `ACTION_SUCCESS_TEMPLATE_ROOTS` (also
 * for an `outcomeMessages` entry, the success toast of one outcome),
 * `ACTION_ERROR_TEMPLATE_ROOTS` (none — the runner shows an `errorMessage` as
 * written).
 *
 * Every finding is an ERROR (#25680): `objectstack validate` and `compile`
 * fail, and the publish gate answers its 422. Each of these texts parsed while
 * the keys were plain strings, and it still parses (the slot keeps its blank
 * arm), so a stored row keeps loading until its next save; the save is judged.
 * A `${…}` token is one of them in every sentence (#25709): the console's
 * runner shows it as written, a sentence with no `{{ }}` hole included, so
 * there is no transitional reading left to warn about.
 */

import { validateExpression } from '@objectstack/formula';
import { closedScopeTemplateRefusal, templateSlotSource } from '@objectstack/spec/automation';
import {
  ACTION_ERROR_TEMPLATE_ROOTS,
  ACTION_SUCCESS_TEMPLATE_ROOTS,
  actionConfirmTemplateRoots,
} from '@objectstack/spec/ui';
import type { ExprIssue } from './validate-expressions.js';
import { recordsOf } from './object-graph.js';
import { walkPageComponents } from './page-walk.js';

type AnyRec = Record<string, unknown>;

type CopyKey = 'confirmText' | 'successMessage' | 'errorMessage' | 'description' | 'helpText' | 'outcomeMessages';

/** The keys a registered or inline action carries as `template` slots (`ActionSchema`'s `errorMessage` is not one). */
const ACTION_KEYS: readonly CopyKey[] = ['confirmText', 'successMessage'];

/**
 * [#27948] The keys only a REGISTERED action carries as `template` slots, past
 * {@link ACTION_KEYS}: the param dialog's `description`, each
 * `outcomeMessages` entry, each `params[].helpText`. An inline action's pick
 * has `params` but neither of the other two, so it is judged on `helpText`
 * alone ({@link INLINE_KEYS}).
 */
const REGISTERED_KEYS: readonly CopyKey[] = [...ACTION_KEYS, 'description', 'outcomeMessages', 'helpText'];

/** The keys an inline `properties.action` carries as `template` slots. */
const INLINE_KEYS: readonly CopyKey[] = [...ACTION_KEYS, 'helpText'];

/** The keys a page action row carries as `template` slots. */
const ROW_KEYS: readonly CopyKey[] = ['confirmText', 'successMessage', 'errorMessage'];

/** How a finding names the slot. */
const SLOT_NAME: Record<CopyKey, string> = {
  confirmText: "An action's `confirmText`",
  successMessage: "An action's `successMessage`",
  errorMessage: "An action's `errorMessage`",
  description: "An action's `description`",
  helpText: "An action param's `helpText`",
  outcomeMessages: "An action's `outcomeMessages` entry",
};

/** The page components whose own `properties` are an action row. */
const ROW_COMPONENTS: ReadonlySet<string> = new Set(['action:button', 'action:icon']);

/** The page components whose `properties.actions[]` members are action rows. */
const CONTAINER_COMPONENTS: ReadonlySet<string> = new Set(['action:group', 'action:menu']);

/** A blank sentence — `trim()`'s whitespace set is exactly `\s`. */
const BLANK_TEXT = /^\s*$/;

/** What a blank sentence costs, per key, at the console's runner. */
const BLANK_COST: Record<CopyKey, string> = {
  confirmText: 'so no question is asked (an empty sentence declares no confirmation, and a whitespace one shows an '
    + 'empty dialog): write the question, or remove the key.',
  successMessage: 'so the success toast shows the runner\'s default text: write the sentence, or remove the key.',
  errorMessage: 'so the failure toast shows the raw error (or an empty toast, for a whitespace sentence): write the '
    + 'sentence, or remove the key.',
  description: 'so the param dialog shows no line under its title: write the sentence, or remove the key.',
  helpText: 'so the input shows no hint: write the hint, or remove the key.',
  outcomeMessages: 'so that outcome\'s toast falls back to `successMessage` (or the runner\'s default text): write the '
    + 'sentence, or remove the entry.',
};

/** The roots one key's holes may name, for the action that carries it. */
function rootsOf(key: CopyKey, action: AnyRec): readonly string[] {
  switch (key) {
    case 'confirmText':
    case 'description':
    case 'helpText':
      return actionConfirmTemplateRoots(action);
    case 'successMessage':
    case 'outcomeMessages':
      return ACTION_SUCCESS_TEMPLATE_ROOTS;
    default:
      return ACTION_ERROR_TEMPLATE_ROOTS;
  }
}

/**
 * The copy values one key carries on `action`, each with the path it is named
 * at: the key itself, or — for the two keys that are maps of slots — each
 * `outcomeMessages.<outcome>` entry and each `params[<i>].helpText`.
 */
function valuesOf(action: AnyRec, key: CopyKey): Array<{ path: string; value: unknown }> {
  if (key === 'outcomeMessages') {
    const messages = action.outcomeMessages;
    if (!isRec(messages)) return [];
    return Object.entries(messages).map(([outcome, value]) => ({ path: `outcomeMessages.${outcome}`, value }));
  }
  if (key === 'helpText') {
    if (!Array.isArray(action.params)) return [];
    return action.params.flatMap((param: unknown, i: number) =>
      isRec(param) && param.helpText !== undefined ? [{ path: `params[${i}].helpText`, value: param.helpText }] : []);
  }
  return [{ path: key, value: action[key] }];
}

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * The sentences one copy value carries, each with the location suffix it is
 * named at: the value itself (a string or the `template` envelope), or — where
 * the key takes an inline locale map — each string value of the map, at
 * `.<locale>`. Anything else carries no sentence: the parse refuses its shape.
 */
function sentencesOf(value: unknown, localeMap: boolean): Array<{ at: string; text: string }> {
  const text = templateSlotSource(value);
  if (text !== undefined) return [{ at: '', text }];
  if (!localeMap || !isRec(value) || 'dialect' in value || 'source' in value) return [];
  const out: Array<{ at: string; text: string }> = [];
  for (const [locale, entry] of Object.entries(value)) {
    if (typeof entry === 'string') out.push({ at: `.${locale}`, text: entry });
  }
  return out;
}

/** Every finding one action's copy keys draw, at `where`. */
function judgeAction(
  issues: ExprIssue[],
  action: AnyRec,
  where: string,
  keys: readonly CopyKey[],
  localeMap: boolean,
): void {
  for (const key of keys) {
    // A param's `helpText` was a plain string, never a locale map (#27948).
    const takesMap = localeMap && key !== 'helpText';
    const slot = SLOT_NAME[key];
    const roots = rootsOf(key, action);
    for (const { path, value } of valuesOf(action, key)) {
      for (const { at, text } of sentencesOf(value, takesMap)) {
        const located = `${where} ${path}${at}`;
        const refuse = (message: string, quoted: string): void => {
          issues.push({ where: located, message, source: quoted, severity: 'error' });
        };
        if (BLANK_TEXT.test(text)) {
          refuse(`${slot} is blank, ${BLANK_COST[key]}`, text);
          continue;
        }
        const refusal = closedScopeTemplateRefusal(text, { slot, roots });
        if (refusal !== undefined) {
          refuse(refusal, text);
          continue;
        }
        for (const e of validateExpression('template', text).errors) refuse(e.message, e.source);
      }
    }
  }
}

/** Which collections one run judges — the publish gate narrows them per write type. */
export interface ActionCopyTemplateScope {
  /** The stack's top-level `actions[]`. */
  readonly actions: boolean;
  /** Each object's own `actions[]`. */
  readonly objects: boolean;
  /** Each page's action rows and inline actions. */
  readonly pages: boolean;
}

/**
 * Every finding an action's copy draws across the collections `scope` names
 * (see the module note). An action declared both top-level and on its object
 * (`defineStack` merges one onto the other) is judged once, at the first place
 * it is met — the de-duplication the expression pass's `checkAction` applies.
 */
export function actionCopyTemplateIssues(stack: AnyRec, scope: ActionCopyTemplateScope): ExprIssue[] {
  const issues: ExprIssue[] = [];
  const seen = new Set<string>();
  const registered = (owner: string, action: AnyRec, objectName?: string): void => {
    const name = typeof action.name === 'string' ? action.name : '?';
    const bound = objectName ?? (typeof action.objectName === 'string' ? action.objectName : '');
    const key = `${bound}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    judgeAction(issues, action, `${owner} · action '${name}'`, REGISTERED_KEYS, true);
  };
  if (scope.actions) {
    for (const action of recordsOf(stack.actions)) registered('stack', action);
  }
  if (scope.objects) {
    for (const object of recordsOf(stack.objects)) {
      const objectName = typeof object.name === 'string' ? object.name : undefined;
      for (const action of recordsOf(object.actions)) registered(`object '${objectName ?? '?'}'`, action, objectName);
    }
  }
  if (scope.pages) {
    let pi = -1;
    for (const page of recordsOf(stack.pages)) {
      pi += 1;
      const pageName = typeof page.name === 'string' ? page.name : `#${pi}`;
      for (const { component, path } of walkPageComponents(page, `page '${pageName}'`)) {
        const type = typeof component.type === 'string' ? component.type : '';
        const props = isRec(component.properties) ? component.properties : undefined;
        if (!props) continue;
        if (ROW_COMPONENTS.has(type)) judgeAction(issues, props, `${path} (${type}) ·`, ROW_KEYS, false);
        if (CONTAINER_COMPONENTS.has(type) && Array.isArray(props.actions)) {
          props.actions.forEach((member: unknown, mi: number) => {
            if (isRec(member)) judgeAction(issues, member, `${path} (${type}) · actions[${mi}]`, ROW_KEYS, false);
          });
        }
        if (isRec(props.action)) judgeAction(issues, props.action, `${path} (${type}) · action`, INLINE_KEYS, true);
      }
    }
  }
  return issues;
}
