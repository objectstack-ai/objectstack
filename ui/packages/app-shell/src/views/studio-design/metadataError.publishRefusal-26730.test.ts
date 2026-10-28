// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26730 — a refused publish, read in the designer's words.
 *
 * A package publish answers each draft that did not go live in `failed[]`,
 * and each failure's `issues` are the runtime authoring gate's findings: their
 * path is rooted at the gate's snapshot entry (`objects.NAME.…`, `flows[0].…`)
 * and their message is the publish rules' own prose, written for the command
 * line. The card's measured case was a summary field without
 * `summaryOperations`, whose message quotes the engine's source. The reader
 * places each failure on the input it names, as a refused save is placed, and
 * keeps the server's text, verbatim, under Details.
 */

import { describe, expect, it } from 'vitest';
import { formatMetadataError } from '@object-ui/data-objectstack';
import {
  BATCH_ABORTED_CODE,
  causalPublishFailures,
  publishRefusal,
  type PublishFailure,
} from './metadataError';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
import { t, tFormat } from '../metadata-admin/i18n';

/** The functional-completeness rule's message for a summary field with no operations, as the gate sends it. */
const ENGINE_TEXT =
  "A `summary` field with no `summaryOperations` reads 0/null everywhere: the engine's summary index skips it " +
  '(`engine.ts` — `if (!d.summaryOperations) continue`)';

const INVOICE = {
  name: 'invoice',
  label: 'Invoice',
  fields: {
    number: { name: 'number', label: 'Number', type: 'text' },
    total: { name: 'total', label: 'Line total', type: 'summary' },
  },
};

const rollupRefused: PublishFailure = {
  type: 'object',
  name: 'invoice',
  error: 'object/invoice failed the authoring gate',
  code: 'invalid_metadata',
  issues: [{ path: 'objects.invoice.fields.total.summaryOperations', message: ENGINE_TEXT }],
};

describe('a refused publish reads in the designer\'s words (objectstack#26730)', () => {
  it('names the field and its input, with no engine text, and keeps the raw line under Details', () => {
    const refusal = publishRefusal(rollupRefused, 'object', INVOICE, 'en');
    expect(refusal.message).toBe(
      tFormat('engine.studio.refusal.publishWhere', 'en', {
        where: tFormat('engine.studio.refusal.field', 'en', { field: 'Line total' }),
      }),
    );
    expect(refusal.message).not.toMatch(/engine\.ts|summaryOperations|objects\.|`/);
    expect(refusal.target).toEqual({ kind: 'field', id: 'total' });
    expect(refusal.input).toBe(t('designer.field.summary.object', 'en'));
    expect(refusal.detail).toBe(formatMetadataError({ issues: rollupRefused.issues }));
    expect(refusal.detail).toContain(ENGINE_TEXT);
  });

  it('a flow failure, rooted at `flows[0]`, names the step and its input', () => {
    const flow = {
      name: 'approval',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'tell', type: 'notify', label: 'Notify approver', config: {} },
      ],
    };
    const refusal = publishRefusal(
      {
        type: 'flows',
        name: 'approval',
        error: 'flow/approval failed the authoring gate',
        issues: [{ path: 'flows[0].nodes[1].config.title', message: 'Invalid input: expected string, received undefined' }],
      },
      'flow',
      flow,
      'en',
    );
    // The designer has its own words for this message, so it joins the sentence.
    expect(refusal.message).toBe(
      tFormat('engine.studio.refusal.publishIssue', 'en', {
        where: tFormat('engine.studio.refusal.stepInput', 'en', { input: 'Title', step: 'Notify approver' }),
        problem: t('engine.validation.expectedStringUndefined', 'en'),
      }),
    );
    expect(refusal.target).toEqual({ kind: 'node', id: 'tell' });
    expect(refusal.input).toBe('Title');
  });

  it('a dashboard widget and a report input are placed as their pillar opens them', () => {
    const widget = publishRefusal(
      {
        type: 'dashboard',
        name: 'ops',
        error: 'dashboard/ops failed the authoring gate',
        issues: [{ path: 'dashboards[0].widgets[0].title', message: ENGINE_TEXT }],
      },
      'dashboard',
      { name: 'ops', widgets: [{ id: 'w_open', title: 'Open tickets', type: 'metric' }] },
      'en',
    );
    expect(widget.target).toEqual({ kind: 'widget', id: 'w_open' });
    expect(widget.input).toBe(t('engine.inspector.widget.title', 'en'));

    const report = publishRefusal(
      {
        type: 'report',
        name: 'by_owner',
        error: 'report/by_owner failed the authoring gate',
        issues: [{ path: 'reports[0].dataset', message: ENGINE_TEXT }],
      },
      'report',
      { name: 'by_owner' },
      'en',
    );
    // A report has no canvas selection: the target is its own properties.
    expect(report.target).toBeNull();
    expect(report.input).toBe(t('engine.inspector.report.dataset', 'en'));
  });

  it('without the draft it judged, nothing is placed and Details keep every line', () => {
    const refusal = publishRefusal(rollupRefused, 'object', null, 'en');
    expect(refusal.message).toBe(t('engine.studio.refusal.publishUnlocated', 'en'));
    expect(refusal.target).toBeUndefined();
    expect(refusal.detail).toContain(ENGINE_TEXT);
  });

  it('a failure with no issues reads as its text', () => {
    const refusal = publishRefusal(
      { type: 'object', name: 'visit', error: 'sharingModel is not set', code: 'SECURITY_OWD_UNSET' },
      'object',
      null,
      'en',
    );
    expect(refusal).toEqual({
      message: tFormat('engine.studio.refusal.publishPlain', 'en', { reason: 'sharingModel is not set' }),
    });
  });

  it('reads in the designer locale', async () => {
    await loadStudioCatalogue('zh');
    const refusal = publishRefusal(rollupRefused, 'object', INVOICE, 'zh');
    expect(refusal.message).toBe(
      tFormat('engine.studio.refusal.publishWhere', 'zh', {
        where: tFormat('engine.studio.refusal.field', 'zh', { field: 'Line total' }),
      }),
    );
    expect(refusal.message).toMatch(/^未发布/);
  });
});

describe('only the causal failures are kept (ADR-0067 D2)', () => {
  const aborted = (name: string): PublishFailure => ({
    type: 'object',
    name,
    error: 'rolled back with the batch',
    code: BATCH_ABORTED_CODE,
  });

  it('a rolled-back batch keeps the causal item, never its siblings', () => {
    expect(causalPublishFailures([aborted('visit'), rollupRefused, aborted('ticket')])).toEqual([rollupRefused]);
  });

  it('a batch with every element aborted keeps the first, which stands for it', () => {
    expect(causalPublishFailures([aborted('visit'), aborted('ticket')])).toEqual([aborted('visit')]);
  });
});
