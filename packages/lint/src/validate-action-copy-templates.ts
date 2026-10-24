// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24814, ruling A] Judge an action's person-facing copy — the ADR-0032
 * `template` slots `confirmText`, `successMessage` and `errorMessage`
 * (`@objectstack/spec`'s `ui/action-copy-template.ts`) — wherever an action is
 * authored:
 *
 *  - a registered action (`stack.actions[]`, and an object's own `actions[]`):
 *    `confirmText` and `successMessage`, each a bare string, the parsed
 *    envelope, or an inline locale map whose every value is such a sentence;
 *  - a page action row — `action:button` / `action:icon` `properties`, and
 *    each `properties.actions[]` member of an `action:group` / `action:menu` —
 *    all three keys;
 *  - a page component's inline `properties.action` (`InlineActionSchema`, the
 *    pick of `ActionSchema` an `element:button` carries): `confirmText` and
 *    `successMessage`.
 *
 * The same two steps the bulk `confirmText` pass takes, through the same
 * judge: `closedScopeTemplateRefusal` names a `${…}` or single-brace token
 * (with its `{{ }}` spelling where a bound root spells it) and a hole over a
 * root the runner does not bind; a text carrying neither is compiled as the
 * `template` it is (`validateExpression('template', …)`), which names a hole
 * holding logic or an unknown formatter. A blank sentence is named too. Each
 * key's roots are the spec's, measured at the console's runner:
 * `actionConfirmTemplateRoots(action)`, `ACTION_SUCCESS_TEMPLATE_ROOTS`,
 * `ACTION_ERROR_TEMPLATE_ROOTS` (none — the runner shows an `errorMessage` as
 * written).
 *
 * ⚠️ Every finding is a WARNING: an advisory at the publish gate, never a
 * refusal, so no command's exit code changes. Each of these texts parsed while
 * the keys were plain strings; refusing them is a narrowing no ADR-0087
 * conversion carries, and it ships as its own card, as the bulk slot's did.
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

type CopyKey = 'confirmText' | 'successMessage' | 'errorMessage';

/** The keys a registered or inline action carries as `template` slots (`ActionSchema`'s `errorMessage` is not one). */
const ACTION_KEYS: readonly CopyKey[] = ['confirmText', 'successMessage'];

/** The keys a page action row carries as `template` slots. */
const ROW_KEYS: readonly CopyKey[] = ['confirmText', 'successMessage', 'errorMessage'];

/** The page components whose own `properties` are an action row. */
const ROW_COMPONENTS: ReadonlySet<string> = new Set(['action:button', 'action:icon']);

/** The page components whose `properties.actions[]` members are action rows. */
const CONTAINER_COMPONENTS: ReadonlySet<string> = new Set(['action:group', 'action:menu']);

/** A blank sentence — `trim()`'s whitespace set is exactly `\s`. */
const BLANK_TEXT = /^\s*$/;

/** What every finding ends with: it is advice, and why. */
const ADVISORY = ' A warning, not a refusal: this text parsed while the key was a plain string.';

/** What a blank sentence costs, per key, at the console's runner. */
const BLANK_COST: Record<CopyKey, string> = {
  confirmText: 'so no question is asked (an empty sentence declares no confirmation, and a whitespace one shows an '
    + 'empty dialog): write the question, or remove the key.',
  successMessage: 'so the success toast shows the runner\'s default text: write the sentence, or remove the key.',
  errorMessage: 'so the failure toast shows the raw error (or an empty toast, for a whitespace sentence): write the '
    + 'sentence, or remove the key.',
};

/** The roots one key's holes may name, for the action that carries it. */
function rootsOf(key: CopyKey, action: AnyRec): readonly string[] {
  if (key === 'confirmText') return actionConfirmTemplateRoots(action);
  return key === 'successMessage' ? ACTION_SUCCESS_TEMPLATE_ROOTS : ACTION_ERROR_TEMPLATE_ROOTS;
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
    for (const { at, text } of sentencesOf(action[key], localeMap)) {
      const located = `${where} ${key}${at}`;
      const slot = `An action's \`${key}\``;
      const warn = (message: string, quoted: string): void => {
        issues.push({ where: located, message: `${message}${ADVISORY}`, source: quoted, severity: 'warning' });
      };
      if (BLANK_TEXT.test(text)) {
        warn(`${slot} is blank, ${BLANK_COST[key]}`, text);
        continue;
      }
      const refusal = closedScopeTemplateRefusal(text, { slot, roots: rootsOf(key, action) });
      if (refusal !== undefined) {
        warn(refusal, text);
        continue;
      }
      for (const e of validateExpression('template', text).errors) warn(e.message, e.source);
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
 * Every warning an action's copy draws across the collections `scope` names
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
    judgeAction(issues, action, `${owner} · action '${name}'`, ACTION_KEYS, true);
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
        if (isRec(props.action)) judgeAction(issues, props.action, `${path} (${type}) · action`, ACTION_KEYS, true);
      }
    }
  }
  return issues;
}
