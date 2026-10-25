/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `record:path` `stages[].label` is an `I18nLabel` (objectui#10993, batch 2)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `@objectstack/spec` types each stage's `label` in
 * `ComponentPropsMap['record:path']` as `I18nLabel`: a plain string or an
 * inline per-locale map (`{ en, 'zh-CN' }`), and the spec row accepts the map.
 * `RecordPathRenderer` used to read the member raw, as the stage's visible text
 * node and as the `stage` value of its composed accessible name. A map threw
 * "Objects are not valid as a React child", and the node rendered
 * `Component "record:path" failed to render` instead of the path. The renderer
 * now resolves the map with `pickLocalized` against the active UI language
 * (`useObjectTranslation().language`) before anything reads the stage, which
 * is the source this package's other visible `record:*` labels resolve
 * against (`record:related_list.title`, `record:alert.title`) and the
 * language the composed name's own state words come from.
 *
 * Every row mounts the node through the real `SchemaRenderer` and this
 * package's registration, in the `{ type, properties }` form, inside an
 * `I18nProvider`. Every map lists `en` FIRST, so under `zh` a resolver that
 * fell back to `en` or to the first entry would paint English and fail the
 * row: the `zh` rows can pass only by following the active language.
 *
 * The plain-string rows are the controls: a string stage renders exactly as
 * authored, under both languages.
 *
 * The classification row is the reason the map is resolved BEFORE the stages
 * are classified rather than at the two text sinks: `classify()` probes
 * `value + label` against its won/lost tokens when a stage declares no
 * `terminal`, so a map read raw there probes `[object Object]` and a lost
 * stage authored as a map would stop reading as lost. The row's `value` is
 * neutral on purpose, so only the resolved label can classify it.
 *
 * Resolution: `../../index` is this package's own source, and
 * `@object-ui/react` / `@object-ui/i18n` map to their `src` through the root
 * `vitest.config.mts` alias table, so no `dist/` sits between this file and
 * the renderer.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, cleanup, within, type RenderResult } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { RecordContextProvider, SchemaRenderer } from '@object-ui/react';
// Registers `record:path`, the block under test.
import '../../index';

/** `en` first on purpose; see the file header. */
const DRAFT = { en: 'Draft', 'zh-CN': '草稿' };
const REVIEW = { en: 'In review', 'zh-CN': '审核中' };
const WON = { en: 'Signed', 'zh-CN': '已签约' };

const MAP_STAGES = [
  { value: 'draft', label: DRAFT },
  { value: 'in_review', label: REVIEW },
  { value: 'signed', label: WON },
];

const STRING_STAGES = [
  { value: 'draft', label: 'Draft' },
  { value: 'in_review', label: 'In review' },
  { value: 'signed', label: 'Signed' },
];

/** A JSON document: the node and its `properties` bag, nothing a host adds. */
const doc = (stages: unknown) => ({
  type: 'record:path',
  properties: { statusField: 'status', stages },
});

function mountIn(language: string, stages: unknown, status = 'in_review'): RenderResult {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <RecordContextProvider objectName="crm_quote" recordId="q1" data={{ id: 'q1', status }}>
        <SchemaRenderer schema={doc(stages) as never} />
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

/** Reachability first: the block rendered its two rails, not the error fallback. */
function expectRendered(r: RenderResult): HTMLElement[] {
  expect(r.container.textContent ?? '').not.toContain('failed to render');
  const rows = rowsOf(r);
  expect(rows).toHaveLength(2);
  return rows;
}

afterEach(() => cleanup());

describe('record:path stages[].label resolves an inline locale map (objectui#10993)', () => {
  it('zh: every stage paints its zh-CN entry, on both rows', () => {
    const r = mountIn('zh', MAP_STAGES);
    for (const row of expectRendered(r)) {
      expect(textsOf(row)).toEqual(['草稿', '审核中', '已签约']);
    }
    expect(r.container.textContent ?? '').not.toContain('[object Object]');
  });

  it('en: the same maps paint their en entries', () => {
    const r = mountIn('en', MAP_STAGES);
    for (const row of expectRendered(r)) {
      expect(textsOf(row)).toEqual(['Draft', 'In review', 'Signed']);
    }
  });

  it('zh: the composed accessible name carries the resolved label, in one language', () => {
    const r = mountIn('zh', MAP_STAGES);
    const [desktop] = expectRendered(r);
    const stages = stagesOf(desktop);
    expect(stages[0]).toHaveAccessibleName('草稿，已完成');
    expect(stages[1]).toHaveAccessibleName('审核中，当前阶段');
    for (const stage of stages) {
      expect(stage.getAttribute('aria-label') ?? '').not.toContain('[object Object]');
    }
  });

  it('en: the composed accessible name carries the en entry', () => {
    const r = mountIn('en', MAP_STAGES);
    const [desktop] = expectRendered(r);
    expect(stagesOf(desktop)[1]).toHaveAccessibleName('In review, current stage');
  });

  it('a lost stage authored as a map still classifies as lost from its resolved label', () => {
    // `value` is neutral, and no `terminal` is declared, so only the label can
    // classify the stage: '丢单' and 'Closed Lost' are both LOST_TOKENS.
    const stages = [...MAP_STAGES, { value: 'stage_x', label: { en: 'Closed Lost', 'zh-CN': '丢单' } }];
    for (const language of ['zh', 'en']) {
      const r = mountIn(language, stages);
      const [desktop] = expectRendered(r);
      const last = stagesOf(desktop).at(-1) as HTMLElement;
      expect(last).toHaveAttribute('data-stage-terminal', 'lost');
      cleanup();
    }
  });

  it('CONTROL: plain-string stages render exactly as authored, under zh and en', () => {
    for (const language of ['zh', 'en']) {
      const r = mountIn(language, STRING_STAGES);
      for (const row of expectRendered(r)) {
        expect(textsOf(row)).toEqual(['Draft', 'In review', 'Signed']);
      }
      cleanup();
    }
  });
});
