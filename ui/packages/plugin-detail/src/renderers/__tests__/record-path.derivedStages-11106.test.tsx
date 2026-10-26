/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * An authored `record:path` with no `stages` derives them from the status
 * field's picklist (objectui#11106)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `@objectstack/spec` makes `stages` optional on `ComponentPropsMap['record:path']`
 * and describes it as "Explicit stage definitions (if not using field
 * metadata)"; this package's registration repeats the promise. Only the
 * synthesized default page kept it: `buildDefaultHighlights` ran
 * `deriveStages(def, statusField)` and wrote the result into the node it
 * emitted. An AUTHORED node that set only `statusField` rendered
 * "record:path — no stages configured", with zero stages, while its object
 * declared the picklist.
 *
 * The renderer now derives the stages itself when `stages` is absent, through
 * that same `deriveStages`, from the record context's `objectSchema`.
 *
 * Every row mounts the node as a JSON document (`{ type, properties }`)
 * through the real `SchemaRenderer` and this package's registration, inside an
 * `I18nProvider` and a `RecordContextProvider` that binds the object
 * definition the way `RecordDetailView` does. The zh rows load an app bundle
 * whose `fieldOptions` translate the picklist, the channel a picklist label is
 * localized through; `SelectOptionSchema` in the spec types an option `label`
 * as a plain string, so there is no inline-map arm to cover on this path.
 *
 * The control rows: the same node with NO object definition bound still shows
 * the placeholder (so the stages really come from `objectSchema`), and the
 * synthesized default page's own `record:path` node renders the same stages
 * the authored one derives (so there is one rule, not two).
 *
 * Resolution: `../../index` and `../../synth/buildDefaultPageSchema` are this
 * package's own source, and `@object-ui/react` / `@object-ui/i18n` map to their
 * `src` through the root `vitest.config.mts` alias table, so no `dist/` sits
 * between this file and the renderer.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, cleanup, within, type RenderResult } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { RecordContextProvider, SchemaRenderer } from '@object-ui/react';
import { buildDefaultHighlights } from '../../synth/buildDefaultPageSchema';
// Registers `record:path`, the block under test.
import '../../index';

const OBJECT_NAME = 'crm_opportunity';

/** The object definition a host binds: one picklist, one plain text field. */
const OPPORTUNITY = {
  name: OBJECT_NAME,
  label: 'Opportunity',
  fields: {
    stage: {
      name: 'stage',
      label: 'Stage',
      type: 'select',
      options: [
        { value: 'prospecting', label: 'Prospecting' },
        { value: 'proposal', label: 'Proposal' },
        { value: 'negotiation', label: 'Negotiation' },
        { value: 'closed_won', label: 'Closed Won' },
        { value: 'closed_lost', label: 'Closed Lost' },
      ],
    },
    stage_note: { name: 'stage_note', label: 'Stage note', type: 'text' },
  },
};

const EN_LABELS = ['Prospecting', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'];
const ZH_LABELS = ['潜在客户', '方案', '谈判', '赢单', '丢单'];

/**
 * A zh app bundle, shaped the way an app ships one. The `objects` entry is what
 * makes `crm` discoverable as an app namespace at all; `fieldOptions` carries
 * the picklist translation.
 */
const BUNDLE = {
  zh: {
    crm: {
      objects: { [OBJECT_NAME]: { label: '商机' } },
      fieldOptions: {
        [OBJECT_NAME]: {
          stage: {
            prospecting: ZH_LABELS[0],
            proposal: ZH_LABELS[1],
            negotiation: ZH_LABELS[2],
            closed_won: ZH_LABELS[3],
            closed_lost: ZH_LABELS[4],
          },
        },
      },
    },
  },
};

/** A JSON document: the node and its `properties` bag, nothing a host adds. */
const doc = (properties: Record<string, unknown>) => ({ type: 'record:path', properties });

/**
 * `objectSchema: null` binds NO object definition. It is `null` rather than
 * `undefined` because a destructuring default replaces `undefined`, which
 * would quietly bind `OPPORTUNITY` again.
 */
function mount(
  node: unknown,
  { language = 'en', objectSchema = OPPORTUNITY as unknown, stage = 'proposal' } = {},
): RenderResult {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false, resources: BUNDLE }}>
      <RecordContextProvider
        objectName={OBJECT_NAME}
        recordId="o1"
        data={{ id: 'o1', stage, stage_note: 'call back' }}
        objectSchema={objectSchema ?? undefined}
      >
        <SchemaRenderer schema={node as never} />
      </RecordContextProvider>
    </I18nProvider>,
  );
}

/** Both rows (desktop and mobile), in DOM order. */
const rowsOf = (r: RenderResult): HTMLElement[] =>
  Array.from(r.container.querySelectorAll('[role="list"]')) as HTMLElement[];

const stagesOf = (row: HTMLElement): HTMLElement[] => within(row).getAllByRole('listitem');

/** The visible text of every stage in one row. */
const textsOf = (row: HTMLElement): string[] =>
  stagesOf(row).map((stage) => (stage.textContent ?? '').replace(/[✓✗]/g, '').trim());

const PLACEHOLDER = 'record:path — no stages configured';

/** Reachability first: the block rendered its two rails, not a placeholder or the error fallback. */
function expectRendered(r: RenderResult): HTMLElement[] {
  const text = r.container.textContent ?? '';
  expect(text).not.toContain('failed to render');
  expect(text).not.toContain(PLACEHOLDER);
  const rows = rowsOf(r);
  expect(rows).toHaveLength(2);
  return rows;
}

afterEach(() => cleanup());

describe('record:path with only statusField derives its stages from the picklist (objectui#11106)', () => {
  it('en: the picklist options are the stages, in declared order, on both rows', () => {
    const r = mount(doc({ statusField: 'stage' }));
    for (const row of expectRendered(r)) {
      expect(textsOf(row)).toEqual(EN_LABELS);
    }
  });

  it('en: the record\'s current value is the highlighted stage', () => {
    const [desktop] = expectRendered(mount(doc({ statusField: 'stage' }), { stage: 'negotiation' }));
    const stages = stagesOf(desktop);
    expect(stages.map((s) => s.getAttribute('data-stage-state'))).toEqual([
      'completed',
      'completed',
      'current',
      'upcoming',
      'upcoming',
    ]);
    expect(stages[2]).toHaveAttribute('aria-current', 'step');
    expect(stages[2]).toHaveAccessibleName('Negotiation, current stage');
  });

  it('zh: the derived stages take the picklist translation, and the current one is highlighted', () => {
    const r = mount(doc({ statusField: 'stage' }), { language: 'zh' });
    const rows = expectRendered(r);
    for (const row of rows) {
      expect(textsOf(row)).toEqual(ZH_LABELS);
    }
    const stages = stagesOf(rows[0]);
    expect(stages[1]).toHaveAttribute('data-stage-state', 'current');
    expect(stages[1]).toHaveAttribute('aria-current', 'step');
    expect(stages[1]).toHaveAccessibleName('方案，当前阶段');
    expect(stages[0]).toHaveAccessibleName('潜在客户，已完成');
  });

  it('derived stages are classified like authored ones: the lost option leaves the forward path', () => {
    const [desktop] = expectRendered(mount(doc({ statusField: 'stage' })));
    const stages = stagesOf(desktop);
    expect(stages[3]).toHaveAttribute('data-stage-terminal', 'won');
    expect(stages[4]).toHaveAttribute('data-stage-terminal', 'lost');
  });

  it('ONE RULE: the synthesized default page\'s record:path node renders the stages the authored node derives', () => {
    const synthesized = buildDefaultHighlights(OPPORTUNITY, { statusField: 'stage', hideHighlights: true });
    expect(synthesized).toHaveLength(1);
    expect(synthesized[0].type).toBe('record:path');

    const [fromSynth] = expectRendered(mount(synthesized[0]));
    const synthTexts = textsOf(fromSynth);
    cleanup();
    const [fromAuthored] = expectRendered(mount(doc({ statusField: 'stage' })));
    expect(textsOf(fromAuthored)).toEqual(synthTexts);
  });

  it('CONTROL: with no object definition bound, the same node keeps the placeholder', () => {
    const r = mount(doc({ statusField: 'stage' }), { objectSchema: null });
    expect(r.container.textContent ?? '').toContain(PLACEHOLDER);
    expect(r.container.querySelectorAll('[role="listitem"]')).toHaveLength(0);
  });
});

describe('record:path authored stages still win over the derivation (objectui#11106)', () => {
  const AUTHORED = [
    { value: 'draft', label: 'Draft' },
    { value: 'proposal', label: 'Sent to customer' },
  ];

  it('explicit stages render as authored, not the picklist', () => {
    const r = mount(doc({ statusField: 'stage', stages: AUTHORED }));
    for (const row of expectRendered(r)) {
      expect(textsOf(row)).toEqual(['Draft', 'Sent to customer']);
    }
    const [desktop] = rowsOf(r);
    expect(stagesOf(desktop)[1]).toHaveAttribute('data-stage-state', 'current');
  });

  it('an authored EMPTY list is the author\'s answer: the placeholder, not the picklist', () => {
    const r = mount(doc({ statusField: 'stage', stages: [] }));
    expect(r.container.textContent ?? '').toContain(PLACEHOLDER);
    expect(r.container.textContent ?? '').not.toContain('picklist');
    expect(r.container.querySelectorAll('[role="listitem"]')).toHaveLength(0);
  });
});

describe('record:path on a field with no picklist keeps the placeholder, naming the field (objectui#11106)', () => {
  it('a text field: no stages, and the placeholder names the field', () => {
    const r = mount(doc({ statusField: 'stage_note' }));
    const text = r.container.textContent ?? '';
    expect(text).toContain(PLACEHOLDER);
    expect(text).toContain('"stage_note"');
    expect(r.container.querySelectorAll('[role="listitem"]')).toHaveLength(0);
  });

  it('a field the object does not declare: the same placeholder, naming the field', () => {
    const r = mount(doc({ statusField: 'phase' }));
    const text = r.container.textContent ?? '';
    expect(text).toContain(PLACEHOLDER);
    expect(text).toContain('"phase"');
    expect(r.container.querySelectorAll('[role="listitem"]')).toHaveLength(0);
  });
});
