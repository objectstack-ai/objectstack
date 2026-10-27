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
