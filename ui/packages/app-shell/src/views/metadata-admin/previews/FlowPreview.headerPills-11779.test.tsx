// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11779 — the flow header's Trigger and Status pills, on a host that
 * reads no runtime state (the metadata-admin page renders this same preview,
 * with no `FlowRuntimeContext` provider).
 *
 *   - Trigger is read from the Start node, never from the flow-level `type`
 *     alone: a record trigger reads its event and object; a time-relative sweep
 *     reads as one.
 *   - Status, with no runtime reading, is the draft's own switch as the engine
 *     reads it: a flow with no `status` key (or `draft`) is armed like `active`,
 *     so it reads "Enabled" — the old header read it "draft".
 *
 * The Studio-hosted readings (runtime rows through the real pillar) are pinned
 * in `StudioDesignSurface.flowStatusTruth-11779.test.tsx`.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('./useFlowNodePalette', () => ({
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('not found', { status: 404 })),
);

import { FlowPreview } from './FlowPreview';
import { t } from '../i18n';

afterEach(cleanup);

const end = { id: 'end', type: 'end', label: 'End' };
const edges = [{ id: 'e1', source: 'start', target: 'end' }];

function flow(start: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: 'f1', label: 'F1', type: 'autolaunched', nodes: [{ id: 'start', type: 'start', label: 'Start', ...start }, end], edges, ...extra };
}

function pill(label: string, draft: Record<string, unknown>, locale = 'en-US'): { value: string; pill: HTMLElement } {
  render(<FlowPreview type="flow" name="f1" draft={draft} locale={locale} />);
  const labelEl = screen.getByText(`${label}:`);
  return { value: labelEl.nextElementSibling?.textContent ?? '', pill: labelEl.parentElement as HTMLElement };
}

describe('the Trigger pill reads the Start node (objectui#11779)', () => {
  it('a record trigger reads its event and object, not "autolaunched"', () => {
    const { value } = pill('Trigger', flow({ config: { triggerType: 'record-after-update', objectName: 'task' } }));
    expect(value).toBe('Record updated · task');
  });

  it('in zh, the same words the Start node inspector uses', () => {
    const { value } = pill('触发', flow({ config: { triggerType: 'record-after-update', objectName: 'task' } }), 'zh-CN');
    expect(value).toBe('记录更新后 · task');
  });

  it('a time-relative sweep reads as one, with the object it sweeps', () => {
    const { value } = pill(
      'Trigger',
      flow({ config: { timeRelative: { object: 'contract', dateField: 'end_date', withinDays: 30 }, schedule: { type: 'cron', expression: '0 7 * * *' } } }),
    );
    expect(value).toBe('Time-relative (date sweep) · contract');
  });

  it('a flow with no trigger on its Start node falls back to the flow type — the control', () => {
    expect(pill('Trigger', flow({})).value).toBe('autolaunched');
  });
});

describe('the Status pill without a runtime reading (objectui#11779)', () => {
  it('a flow with no `status` key reads Enabled, not "draft"', () => {
    const { value } = pill('Status', flow({}));
    expect(value).toBe(t('engine.studio.auto.enabled', 'en'));
    expect(value).not.toMatch(/draft/i);
  });

  it('`status: draft` reads Enabled too — the engine arms a draft flow', () => {
    expect(pill('Status', flow({}, { status: 'draft' })).value).toBe(t('engine.studio.auto.enabled', 'en'));
  });

  it('`status: obsolete` reads Disabled — the control', () => {
    expect(pill('Status', flow({}, { status: 'obsolete' })).value).toBe(t('engine.studio.auto.disabled', 'en'));
  });
});
