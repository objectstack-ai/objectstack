// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A record-level action's success toast names the record it wrote
 * (`ux-conventions.write-feedback` acceptance[1]: a record-level write names
 * the record — its title — or the count).
 *
 * The console's action runner shows an authored `successMessage` as written
 * unless it carries a template hole; then it fills the holes through
 * `@objectstack/formula`'s `templateEngine` over exactly two roots, `result`
 * (the handler's payload) and `record` (the record the dispatch ran against:
 * the clicked row, else the page's record). A hole naming anything the roots
 * do not bind prints EMPTY (objectui `ActionRunner.composeSuccessMessage` →
 * `actionCopyTemplate.fillTemplateHoles`). So a sentence that names the
 * record must say what it prints for a record whose title the dispatch does
 * not carry (a list row whose view does not project the column): each one
 * here falls back, through the `default` formatter, to the object wording the
 * toast used before.
 *
 * `fillAsTheRunnerDoes` restates that one call (same engine, same roots, same
 * "no hole ⇒ as written" rule) so these assertions read the toast the user
 * would see. The engine is aliased to source in `vitest.config.ts`.
 */

import { describe, expect, it } from 'vitest';
import { templateEngine } from '@objectstack/formula';
import {
  ArchiveTaskAction,
  MarkDoneAction,
  RecalcEstimateAction,
  RecalcSelectionAction,
  SubmitForSignoffAction,
} from '../src/ui/actions/index.js';
import { ShowcaseTranslationBundle } from '../src/system/translations/index.js';

/** The copy's text: a bare string, or the `template` envelope's `source`. */
function sourceOf(copy: unknown): string {
  if (typeof copy === 'string') return copy;
  const source = (copy as { source?: unknown } | undefined)?.source;
  if (typeof source !== 'string') throw new Error(`successMessage carries no text: ${JSON.stringify(copy)}`);
  return source;
}

/** The success toast the runner composes for `action` run against `record`. */
function fillAsTheRunnerDoes(action: { successMessage?: unknown }, record: Record<string, unknown>): string {
  const source = sourceOf(action.successMessage);
  if (!/\{\{[^}]*\}\}/.test(source)) return source;
  const filled = templateEngine.evaluate<string>(
    { dialect: 'template', source },
    { extra: { result: { success: true }, record } } as never,
  );
  if (!filled.ok) throw new Error(`template refused: ${filled.error.message}`);
  return filled.value;
}

const task = { id: 't1', title: 'PII access review', done: false };
/** A list row whose view does not project `title`. */
const sparseTask = { id: 't1', done: false };
const invoice = { id: 'i1', name: 'INV-1002', status: 'draft' };
const sparseInvoice = { id: 'i1', status: 'draft' };

describe('showcase record actions — the success toast names the record', () => {
  it.each([
    ['Mark Done', MarkDoneAction, task, 'PII access review marked done.'],
    ['Recalculate Estimate', RecalcEstimateAction, task, 'Estimate recalculated for PII access review.'],
    ['Recalculate Selection (record overflow menu)', RecalcSelectionAction, task, 'Estimates recalculated for PII access review.'],
    ['Archive', ArchiveTaskAction, task, 'PII access review archived (demo — no data changed).'],
    ['Submit for Sign-off', SubmitForSignoffAction, invoice, 'INV-1002 submitted for finance + legal sign-off.'],
  ] as const)('%s names the record by its title', (_label, action, record, expected) => {
    expect(fillAsTheRunnerDoes(action, record)).toBe(expected);
  });

  it.each([
    ['Mark Done', MarkDoneAction, sparseTask, 'Task marked done.'],
    ['Recalculate Estimate', RecalcEstimateAction, sparseTask, 'Estimate recalculated for the task.'],
    ['Recalculate Selection', RecalcSelectionAction, sparseTask, 'Estimates recalculated for the whole selection.'],
    ['Archive', ArchiveTaskAction, sparseTask, 'Task archived (demo — no data changed).'],
    ['Submit for Sign-off', SubmitForSignoffAction, sparseInvoice, 'Invoice submitted for finance + legal sign-off.'],
  ] as const)('%s falls back to the object wording when the dispatch carries no title', (_label, action, record, expected) => {
    expect(fillAsTheRunnerDoes(action, record)).toBe(expected);
  });
});

/**
 * The zh-CN bundle's entry REPLACES the authored copy before dispatch (the
 * console's `useActionTextLocalizer` resolves
 * `objects.<object>._actions.<name>.successMessage`, and i18next leaves a
 * template hole it cannot bind untouched), and the runner then fills that
 * entry's holes exactly as it fills the authored ones. So a zh-CN viewer is
 * only told which record changed when the bundle entry carries the hole too.
 * Every one of the five actions that HAS a zh-CN entry is held here.
 */
describe('showcase record actions — the zh-CN success toast names the record', () => {
  const zhActions = (ShowcaseTranslationBundle['zh-CN'] as {
    objects: Record<string, { _actions?: Record<string, { successMessage?: unknown }> }>;
  }).objects.showcase_task._actions ?? {};
  const zh = (name: string) => {
    const entry = zhActions[name];
    if (!entry?.successMessage) throw new Error(`no zh-CN successMessage for ${name}`);
    return entry;
  };
  const zhTask = { id: 't1', title: '个人信息访问审查', done: false };

  it.each([
    ['showcase_mark_done', zhTask, '个人信息访问审查已标记为完成。'],
    ['showcase_recalc_estimate', zhTask, '已重算个人信息访问审查的工时。'],
    ['showcase_recalc_selection', zhTask, '已为个人信息访问审查重算工时。'],
    ['showcase_archive_task', zhTask, '个人信息访问审查已归档（演示——未修改任何数据）。'],
  ] as const)('%s names the record by its title', (name, record, expected) => {
    expect(fillAsTheRunnerDoes(zh(name), record)).toBe(expected);
  });

  it.each([
    ['showcase_mark_done', sparseTask, '任务已标记为完成。'],
    ['showcase_recalc_estimate', sparseTask, '已重算该任务的工时。'],
    ['showcase_recalc_selection', sparseTask, '已为整个选中集重算工时。'],
    ['showcase_archive_task', sparseTask, '任务已归档（演示——未修改任何数据）。'],
  ] as const)('%s falls back to the object wording when the dispatch carries no title', (name, record, expected) => {
    expect(fillAsTheRunnerDoes(zh(name), record)).toBe(expected);
  });
});
