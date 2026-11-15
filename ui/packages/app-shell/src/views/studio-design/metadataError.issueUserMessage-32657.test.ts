// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#32657 — a refused metadata save shows the producer's localized
 * sentence for each issue that carries one.
 *
 * The runtime authoring gate's 422 `issues[]` carry `userMessage`
 * (`RuntimeAuthoringIssueSchema.userMessage`) in the caller's language. The one
 * issue reader (`formatMetadataIssue`, behind `formatMetadataError` and the
 * publish formatter) and Studio's refusal sentence (`issueRefusal`) render it
 * in place of the developer-facing English `message`; an issue without one —
 * every spec-validation issue — keeps today's face, and only that one is read
 * through the console's validation-message table.
 */

import { describe, expect, it } from 'vitest';
import { formatMetadataError, formatMetadataIssue } from '@object-ui/data-objectstack';
import { flowSaveRefusal, formatPublishFailures } from './metadataError';
import { t, tFormat } from '../metadata-admin/i18n';

import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

const MESSAGE = 'flow "approval" node "tell" config.title is required by the notify step';
const USER_TEXT_ZH = '通知步骤“Notify approver”缺少标题，请填写后再保存。';
const MISSING = 'Invalid input: expected string, received undefined';

function serverRefusal(issues: Array<{ path: string; message: string; userMessage?: string }>): Error {
  return Object.assign(new Error(`${issues.length} issue(s)`), { status: 422, code: 'INVALID_METADATA', issues });
}

const FLOW = {
  name: 'approval',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'route', type: 'decision', label: 'Route' },
    { id: 'tell', type: 'notify', label: 'Notify approver' },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'route' }],
};

describe('the issue line reads the producer’s userMessage (objectstack#32657)', () => {
  it('an issue with a userMessage: the line is the path and that sentence, not the English message', () => {
    const line = formatMetadataIssue({ path: 'nodes.2.config.title', message: MESSAGE, userMessage: USER_TEXT_ZH });
    expect(line).toBe(`• nodes.2.config.title — ${USER_TEXT_ZH}`);
  });

  it('CONTROL: an issue without one keeps the message face', () => {
    expect(formatMetadataIssue({ path: 'fields.amount.type', message: 'Required' })).toBe('• fields.amount.type — Required');
  });

  it('the banner reader and the publish formatter carry the sentence through', () => {
    const e = serverRefusal([{ path: 'nodes.2.config.title', message: MESSAGE, userMessage: USER_TEXT_ZH }]);
    expect(formatMetadataError(e)).toContain(USER_TEXT_ZH);
    expect(formatMetadataError(e)).not.toContain(MESSAGE);

    const published = formatPublishFailures([
      {
        type: 'flow',
        name: 'approval',
        error: 'failed the authoring check',
        issues: [{ path: 'nodes.2.config.title', message: MESSAGE, userMessage: USER_TEXT_ZH }],
      },
    ]);
    expect(published).toContain(USER_TEXT_ZH);
    expect(published).not.toContain(MESSAGE);
  });
});

describe('Studio’s refusal sentence reads the producer’s userMessage (objectstack#32657)', () => {
  const where = (locale: string) =>
    tFormat('engine.studio.refusal.stepInput', locale, { input: locale === 'zh' ? '标题' : 'Title', step: 'Notify approver' });

  it('an issue with a userMessage: the sentence carries it verbatim, never a console translation', () => {
    const e = serverRefusal([{ path: 'nodes.2.config.title', message: MISSING, userMessage: USER_TEXT_ZH }]);
    const refusal = flowSaveRefusal(e, FLOW, 'zh');

    expect(refusal.message).toContain(USER_TEXT_ZH);
    expect(refusal.message).not.toContain(t('engine.validation.expectedStringUndefined', 'zh'));
    expect(refusal.target).toEqual({ kind: 'node', id: 'tell' });
  });

  it('CONTROL: an issue without one keeps the console’s reading of its message', () => {
    const e = serverRefusal([{ path: 'nodes.2.config.title', message: MISSING }]);
    const refusal = flowSaveRefusal(e, FLOW, 'en');

    expect(refusal.message).toBe(
      tFormat('engine.studio.refusal.issue', 'en', {
        where: where('en'),
        problem: t('engine.validation.expectedStringUndefined', 'en'),
      }),
    );
  });
});
