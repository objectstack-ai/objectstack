// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24863] The approvals door's display labels, the flow's, the step's and the
 * subject object's, in the READER's language, picked when the row is read.
 *
 * ## What was wrong
 *
 * A request snapshots the flow's and the Approval node's authored labels when
 * it opens (`process_label` / `current_step_label`, `openNodeRequest`), and
 * `rowFromRequest` served that snapshot to every reader. An app's language pack
 * already carries `flows.<flow>.label` and, since the face gained it,
 * `flows.<flow>.approvals.<node_id>.label`, yet no approval reader consulted
 * either, so a zh-CN, ja-JP or es-ES reader saw the authoring language on the
 * inbox, the record's approval panel and the request page. The inbox row's
 * `object_label` was the object's schema label, untranslated, for the same
 * reason.
 *
 * ## The mechanism, reused
 *
 * This is how the server already renders a user-read string in the caller's
 * language, and ⛔ nothing here is a second way to do it:
 *
 *  - the locale is the door's already-resolved `ExecutionContext.locale` (the
 *    request's `Accept-Language`, else the `localization` settings);
 *  - it is negotiated against the locales the `i18n` service holds by
 *    `resolveBundleLocale` (`@objectstack/spec/system`), the one negotiation
 *    rule, so a bare `zh` reaches a `zh-CN` pack;
 *  - the text is `II18nService.t(key, locale)`; a miss is the key echoed back,
 *    and then the authored text stands.
 *
 * objectql names a refused write's object this way (`objectDisplayLabel`,
 * through `objectLabelKey`), the REST door names a NOT NULL field this way
 * (`not-null-refusal-label.ts`), and the automation engine picks a refusal's
 * and a screen's template this way (`renderFlowTextSlot`). The negotiation
 * glue below is the same few lines each of those consumers carries around the
 * one rule; the rule itself is not restated.
 *
 * ## The keys
 *
 *  - the flow: `flows.<flow>.label`, the `flows` face's own `label`;
 *  - the step: `flows.<flow>.approvals.<node_id>.label`, the face's key for an
 *    `approval` node's step label (`translation.zod.ts`, `approvals`);
 *  - the object: `objects.<object>.label` (`objectLabelKey`).
 *
 * `<flow>` is the request's `process_name` without its `flow:` prefix, the
 * `Flow.name` the engine hands the node (`$flowName`), and `<node_id>` is its
 * `current_step`, the Approval node's `FlowNode.id`. Both are on the stored
 * row, so no flow definition is read. `@objectstack/spec/system` exports no
 * helper spelling either flow key, so they are spelled here, beside the face's
 * own docblock address; `reader-locale-labels.test.ts` holds both spellings to
 * `TranslationDataSchema`, so a key the face does not declare cannot be asked.
 *
 * ## What stays
 *
 * The stored columns are not touched. `process_label` and `current_step_label`
 * stay the authored text as it stood when the request opened: the audit record,
 * what a system read is served, and the text this read falls back to whenever
 * nothing is picked. [#27041] The generic data door (Setup's request list, the
 * record page, the export) overlays the same two columns by this same pair,
 * `readerLabelsFor` and `localizeRequestLabels`, at its engine read seam
 * (`reader-locale-labels-middleware.ts`). Nothing is picked when the read
 * carries no locale (a system context, the token-bearing action page), when no
 * `i18n` service is registered, when the pack holds no entry for the key, or
 * when the service throws. A process name without the `flow:` prefix names no
 * flow, so its labels stay as stored.
 */

import type { II18nService } from '@objectstack/spec/contracts';
import { objectLabelKey, resolveBundleLocale } from '@objectstack/spec/system';

/** The slice of `II18nService` this read asks: `t()`, and `getLocales()` to negotiate when offered. */
export type ReaderLabelI18n = Pick<II18nService, 't'> & Partial<Pick<II18nService, 'getLocales'>>;

/** The `flows` face's flow label, `flows.<flow>.label`. */
export function flowLabelKey(flowName: string): string {
  return `flows.${flowName}.label`;
}

/** The `flows` face's step label of an `approval` node, `flows.<flow>.approvals.<node_id>.label`. */
export function approvalStepLabelKey(flowName: string, nodeId: string): string {
  return `flows.${flowName}.approvals.${nodeId}.label`;
}

/**
 * The flow a request's `process_name` names: `flow:account_approval` →
 * `account_approval`. `undefined` for anything without the prefix, or with
 * nothing after it.
 */
export function flowNameOfProcess(processName: unknown): string | undefined {
  if (typeof processName !== 'string' || !processName.startsWith('flow:')) return undefined;
  const name = processName.slice('flow:'.length).trim();
  return name || undefined;
}

/** The labels one read picks for its reader; each answers `undefined` when nothing is picked. */
export interface ReaderLabels {
  flowLabel(flowName: string): string | undefined;
  stepLabel(flowName: string, nodeId: string): string | undefined;
  objectLabel(objectName: string): string | undefined;
  /**
   * [#25576] A catalog sentence (`messages.<id>`) rendered with `params`, by
   * the same `t()` and the same negotiated locale. Not memoised: the params
   * differ per row.
   */
  sentence(key: string, params: Readonly<Record<string, string>>): string | undefined;
}

/**
 * The locale `service` can ANSWER in, for the locale the reader asked for:
 * `resolveBundleLocale` over what `getLocales()` reports. The requested tag
 * passes through untouched when there is nothing to negotiate against (no
 * `getLocales`, a throwing or empty answer, no match).
 */
function negotiatedLocale(service: ReaderLabelI18n, requested: string): string {
  if (typeof service.getLocales !== 'function') return requested;
  let available: unknown;
  try {
    available = service.getLocales();
  } catch {
    return requested;
  }
  if (!Array.isArray(available) || available.length === 0) return requested;
  const offered: Record<string, true> = {};
  for (const code of available) {
    if (typeof code === 'string' && code.length > 0) offered[code] = true;
  }
  return resolveBundleLocale(offered, requested) ?? requested;
}

/**
 * The labels for a reader whose `ExecutionContext.locale` is `requested`, or
 * `undefined` when this read can pick nothing: no locale, or no service with a
 * `t()`. Each answer is memoised for the life of the returned object, which is
 * one read.
 */
export function readerLabelsFor(
  service: ReaderLabelI18n | undefined,
  requested: string | undefined,
): ReaderLabels | undefined {
  if (typeof requested !== 'string' || requested.length === 0) return undefined;
  if (!service || typeof service.t !== 'function') return undefined;
  const locale = negotiatedLocale(service, requested);
  const render = (key: string, params?: Readonly<Record<string, string>>): string | undefined => {
    try {
      const text = service.t(key, locale, params);
      // `II18nService.t` echoes the key back on a miss.
      if (typeof text === 'string' && text.trim().length > 0 && text !== key) return text;
    } catch {
      // A misbehaving i18n service must not fail the read: the stored label stands.
    }
    return undefined;
  };
  const picked = new Map<string, string | undefined>();
  const pick = (key: string): string | undefined => {
    if (picked.has(key)) return picked.get(key);
    const answer = render(key);
    picked.set(key, answer);
    return answer;
  };
  return {
    flowLabel: (flowName) => pick(flowLabelKey(flowName)),
    stepLabel: (flowName, nodeId) => pick(approvalStepLabelKey(flowName, nodeId)),
    objectLabel: (objectName) => pick(objectLabelKey(objectName)),
    sentence: (key, params) => render(key, params),
  };
}

/** The members of a served request row this read localizes. */
export interface LocalizableRequestRow {
  process_name?: string;
  current_step?: string;
  object_name?: string;
  process_label?: string;
  step_label?: string;
  current_step_label?: string;
  object_label?: string;
}

/**
 * Overlay `row`'s served display labels with the ones `labels` picks, in
 * place. The step's label is served under two names of one value (`step_label`
 * and `current_step_label`), and both move together. A label nothing is picked
 * for keeps the value the row already carries.
 */
export function localizeRequestLabels(row: LocalizableRequestRow, labels: ReaderLabels): void {
  const flow = flowNameOfProcess(row.process_name);
  if (flow) {
    const flowLabel = labels.flowLabel(flow);
    if (flowLabel) row.process_label = flowLabel;
    const node = typeof row.current_step === 'string' && row.current_step ? row.current_step : undefined;
    const stepLabel = node ? labels.stepLabel(flow, node) : undefined;
    if (stepLabel) {
      row.step_label = stepLabel;
      row.current_step_label = stepLabel;
    }
  }
  const object = typeof row.object_name === 'string' && row.object_name ? row.object_name : undefined;
  const objectLabel = object ? labels.objectLabel(object) : undefined;
  if (objectLabel) row.object_label = objectLabel;
}
