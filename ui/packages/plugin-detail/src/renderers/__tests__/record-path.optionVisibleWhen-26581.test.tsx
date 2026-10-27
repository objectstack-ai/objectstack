/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A stage the record's own columns rule out is not drawn (objectstack#26581)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * hotclm's order contracts skip legal review by type, yet their path drew
 * 草稿 ✓ 已提交 ✓ 审查中 ✓ 审批中 ✓ 已批准: every stage before the current one
 * ticks by position. The status option already says which records it applies
 * to — `visibleWhen`, "offered only when TRUE (else omitted)", refused on write
 * by the server when false — so `record:path` omits a stage whose option's
 * predicate is FALSE for the record. Ruling 6442747364, letter A with its
 * guardrail.
 *
 * Rows:
 *   (a) the card's contract: an ORD contract's path omits 审查中 on both rows;
 *       CONTROL, a type the rule admits keeps it;
 *   (b) a predicate that reads the acting user hides nothing, even where its
 *       record half alone is FALSE;
 *   (c) a predicate that cannot be evaluated keeps its stage (fail-open);
 *   (d) the stage the record stands on is kept even when its rule is FALSE;
 *   (e) authored `stages[]` are matched to the options by value;
 *   (f) a quoted `'user'` is a literal, not the acting user.
 *
 * Resolution: `../../index` is this package's own source, and
 * `@object-ui/react` / `@object-ui/core` / `@object-ui/i18n` map to their `src`
 * through the root `vitest.config.mts` alias table, so no `dist/` sits between
 * this file and the renderer.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, cleanup, within, type RenderResult } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { RecordContextProvider, SchemaRenderer } from '@object-ui/react';
// Registers `record:path`, the block under test.
import '../../index';

const OBJECT_NAME = 'clm_contract';

const NOT_ORD = "record.contract_type != 'ORD'";

const contractDef = (reviewGate: string | undefined) => ({
  name: OBJECT_NAME,
  label: 'Contract',
  fields: {
    contract_type: { name: 'contract_type', label: 'Type', type: 'text' },
    status: {
      name: 'status',
      label: 'Status',
      type: 'select',
      options: [
        { value: 'draft', label: '草稿' },
        { value: 'submitted', label: '已提交' },
        { value: 'in_review', label: '审查中', ...(reviewGate !== undefined ? { visibleWhen: reviewGate } : {}) },
        { value: 'in_approval', label: '审批中' },
        { value: 'approved', label: '已批准' },
      ],
    },
  },
});

const doc = (properties: Record<string, unknown>) => ({ type: 'record:path', properties });

function mount(node: unknown, objectSchema: unknown, data: Record<string, unknown>): RenderResult {
  return render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
      <RecordContextProvider
        objectName={OBJECT_NAME}
        recordId="c1"
        data={{ id: 'c1', ...data }}
        objectSchema={objectSchema as never}
      >
        <SchemaRenderer schema={node as never} />
      </RecordContextProvider>
    </I18nProvider>,
  );
}

/** Both rows (desktop and mobile), in DOM order. */
function rowsOf(r: RenderResult): [HTMLElement, HTMLElement] {
  const text = r.container.textContent ?? '';
  expect(text).not.toContain('failed to render');
  expect(text).not.toContain('no stages configured');
  const rows = Array.from(r.container.querySelectorAll('[role="list"]')) as HTMLElement[];
  expect(rows).toHaveLength(2);
  return [rows[0], rows[1]];
}

const stagesOf = (row: HTMLElement): HTMLElement[] => within(row).getAllByRole('listitem');
const textOf = (stage: HTMLElement): string => (stage.textContent ?? '').replace(/[✓✗]/g, '').trim();
/** `label:state` per stage, so one assertion pins what is drawn AND how. */
const pathOf = (row: HTMLElement): string[] =>
  stagesOf(row).map((s) => `${textOf(s)}:${s.getAttribute('data-stage-state')}`);

const ORD_APPROVED_PATH = ['草稿:completed', '已提交:completed', '审批中:completed', '已批准:current'];
const FULL_APPROVED_PATH = ['草稿:completed', '已提交:completed', '审查中:completed', '审批中:completed', '已批准:current'];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('(a) a stage the option rules out for this record is not drawn (objectstack#26581)', () => {
  it('an ORD contract that was approved: 审查中 is omitted on both rows, not ticked', () => {
    const [desktop, mobile] = rowsOf(
      mount(doc({ statusField: 'status' }), contractDef(NOT_ORD), { contract_type: 'ORD', status: 'approved' }),
    );
    expect(pathOf(desktop)).toEqual(ORD_APPROVED_PATH);
    expect(pathOf(mobile)).toEqual(ORD_APPROVED_PATH);
  });

  it('CONTROL: a contract type the rule admits keeps 审查中 as a passed stage', () => {
    const [desktop, mobile] = rowsOf(
      mount(doc({ statusField: 'status' }), contractDef(NOT_ORD), { contract_type: 'SVC', status: 'approved' }),
    );
    expect(pathOf(desktop)).toEqual(FULL_APPROVED_PATH);
    expect(pathOf(mobile)).toEqual(FULL_APPROVED_PATH);
  });
});

describe('(b) a predicate that reads the acting user hides nothing', () => {
  it("FALSE on its record half alone, it still keeps 审查中: it says who may pick, not the record's route", () => {
    const gate = `${NOT_ORD} && 'legal' in current_user.positions`;
    const [desktop, mobile] = rowsOf(
      mount(doc({ statusField: 'status' }), contractDef(gate), { contract_type: 'ORD', status: 'approved' }),
    );
    expect(pathOf(desktop)).toEqual(FULL_APPROVED_PATH);
    expect(pathOf(mobile)).toEqual(FULL_APPROVED_PATH);
  });
});

describe('(c) a predicate that cannot be evaluated keeps its stage (render fail-open, ADR-0137 D3)', () => {
  it('a predicate that does not parse leaves 审查中 drawn', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [desktop, mobile] = rowsOf(
      mount(doc({ statusField: 'status' }), contractDef('record.contract_type !='), {
        contract_type: 'ORD',
        status: 'approved',
      }),
    );
    expect(pathOf(desktop)).toEqual(FULL_APPROVED_PATH);
    expect(pathOf(mobile)).toEqual(FULL_APPROVED_PATH);
  });
});

describe('(d) the stage the record stands on is always drawn', () => {
  it('an ORD contract standing on 审查中 shows it as current, though its rule is FALSE now', () => {
    const [desktop, mobile] = rowsOf(
      mount(doc({ statusField: 'status' }), contractDef(NOT_ORD), { contract_type: 'ORD', status: 'in_review' }),
    );
    const expected = ['草稿:completed', '已提交:completed', '审查中:current', '审批中:upcoming', '已批准:upcoming'];
    expect(pathOf(desktop)).toEqual(expected);
    expect(pathOf(mobile)).toEqual(expected);
  });
});

describe('(e) authored stages are matched to the status options by value', () => {
  it('an authored 审查中 stage is omitted for an ORD contract, as the derived one is', () => {
    const stages = [
      { value: 'draft', label: 'Draft' },
      { value: 'in_review', label: 'Legal review' },
      { value: 'approved', label: 'Approved' },
    ];
    const [desktop, mobile] = rowsOf(
      mount(doc({ statusField: 'status', stages }), contractDef(NOT_ORD), { contract_type: 'ORD', status: 'approved' }),
    );
    expect(stagesOf(desktop).map(textOf)).toEqual(['Draft', 'Approved']);
    expect(stagesOf(mobile).map(textOf)).toEqual(['Draft', 'Approved']);
  });
});

describe("(f) a quoted 'user' is a literal, not the acting user", () => {
  it('a record-only predicate comparing against the string "user" still hides its stage', () => {
    const [desktop] = rowsOf(
      mount(doc({ statusField: 'status' }), contractDef("record.contract_type != 'user'"), {
        contract_type: 'user',
        status: 'approved',
      }),
    );
    expect(stagesOf(desktop).map(textOf)).toEqual(['草稿', '已提交', '审批中', '已批准']);
  });
});
