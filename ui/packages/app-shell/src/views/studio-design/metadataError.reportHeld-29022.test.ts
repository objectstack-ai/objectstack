// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29022 — a report switched to Joined before its first block is
 * HELD by the Interfaces pillar's leaf autosave, not sent.
 *
 * The card: Properties → Report type = Joined sent `type: 'joined'` with the
 * container's dataset and measures cleared (objectui#10746) and no `blocks`;
 * the draft door answered 422 at `blocks` ("a `joined` report needs
 * `blocks`"), and every later edit carried the same body and was refused too,
 * then lost on reload. `reportHeldEdit` held list items and the chart
 * (objectstack#27785) but not a joined report with no list at all.
 *
 * Every "held" case is paired with the spec's own `ReportSchema` verdict on the
 * same body (it refuses it at `blocks` alone), and every "not held" control
 * with a body that judge accepts, or refuses for something the author wrote.
 * The pillar that acts on it is pinned in
 * `InterfacesPillar.reportJoined-29022.test.tsx`.
 */

import { describe, expect, it } from 'vitest';
import { ReportSchema } from '@objectstack/spec/ui';
import { reportHeldEdit } from './metadataError';
import { tFormat } from '../metadata-admin/i18n';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';

// The studio zh catalogue loads on demand; the locale case below reads it.
await loadStudioCatalogue('zh');

/** The issue paths the spec's report parse refuses `report` at, as the door reports them. */
function reportRefusals(report: Record<string, unknown>): string[] {
  const result = ReportSchema.safeParse(report);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

/** A summary report as Save as draft wrote it in the card's step 1. */
const SUMMARY = {
  name: 'pipeline_report',
  label: 'Pipeline',
  type: 'summary',
  dataset: 'sales_ds',
  values: ['revenue'],
  drilldown: true,
};

/**
 * The body the type picker's switch leaves (`ReportDefaultInspector`'s
 * `commitType`): `type: 'joined'`, the selection keys present and `undefined`.
 */
const SWITCHED = {
  ...SUMMARY,
  type: 'joined',
  dataset: undefined,
  values: undefined,
};

const joinedClause = (list: string, locale = 'en') =>
  tFormat('engine.studio.held.reportJoinedNeedsBlock', locale, { list });

describe('a report switched to Joined before its first block is held (objectstack#29022)', () => {
  it('the switch itself: held, as the door refuses it at blocks, placed on the report properties', () => {
    expect(reportRefusals(SWITCHED)).toEqual(['blocks']);
    expect(reportHeldEdit(SWITCHED, 'en')).toEqual({
      clause: joinedClause('Blocks'),
      target: null,
      input: 'Blocks',
    });
  });

  it('a later edit (the card step 3 Description) stays held with it', () => {
    const body = { ...SWITCHED, description: 'Won and lost, side by side' };
    expect(reportRefusals(body)).toEqual(['blocks']);
    expect(reportHeldEdit(body, 'en')?.clause).toBe(joinedClause('Blocks'));
  });

  it('every block removed again: held the same way', () => {
    const body = { ...SWITCHED, blocks: [] };
    expect(reportRefusals(body)).toEqual(['blocks']);
    expect(reportHeldEdit(body, 'en')?.clause).toBe(joinedClause('Blocks'));
  });

  it('a first block added but not bound is held as a list item, by the 27785 rule', () => {
    const body = { ...SWITCHED, blocks: [{ name: 'won' }] };
    expect(reportRefusals(body)).toEqual(['blocks.0.dataset']);
    expect(reportHeldEdit(body, 'en')?.clause).toBe(
      tFormat('engine.studio.held.listItemNeedsInput', 'en', { input: 'Dataset', n: 1, list: 'Blocks' }),
    );
  });

  it('names the list in the designer locale', () => {
    const held = reportHeldEdit(SWITCHED, 'zh-CN');
    expect(held?.clause).toBe(joinedClause(held?.input ?? '', 'zh-CN'));
    expect(held?.clause).toMatch(/^联合报表/);
  });

  // CONTROL: the hold is never stricter than the contract.
  it('a joined report with a bound block: not held, and the spec accepts it', () => {
    const body = { ...SWITCHED, blocks: [{ name: 'won', dataset: 'sales_ds' }] };
    expect(reportRefusals(body)).toEqual([]);
    expect(reportHeldEdit(body, 'en')).toBeNull();
  });

  it('a summary report with no blocks: not held, and the spec accepts it', () => {
    expect(reportRefusals(SUMMARY)).toEqual([]);
    expect(reportHeldEdit(SUMMARY, 'en')).toBeNull();
  });

  // CONTROL: errors stay for finished work.
  it('a joined report with no blocks that also keeps a container key it refuses is not held', () => {
    const body = { ...SWITCHED, dataset: 'sales_ds' };
    expect(reportRefusals(body)).toEqual(['blocks', 'dataset']);
    expect(reportHeldEdit(body, 'en')).toBeNull();
  });
});
