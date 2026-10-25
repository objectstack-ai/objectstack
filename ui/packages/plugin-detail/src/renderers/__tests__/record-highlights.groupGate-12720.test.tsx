/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12720 — the synthesized record page's strip and body agree on a
 * gated field group, rendered.
 *
 * The card's reproduction: an object with no `highlightFields` and a group
 * `pro_details` gated by `record.kind == 'pro'`. On a `basic` record the body
 * hid the group (objectui#11630) and the derived strip drew
 * `pro_secret_note` with its value.
 *
 * Each leg renders the two nodes `buildDefaultPageSchema` emits for the
 * object — `record:highlights` and the Details tab's `record:details` — on
 * one record context and one highlight registry, as the record page mounts
 * them, and counts a member's value across the WHOLE page:
 *
 *  - group hidden (`basic`): zero, in the strip and in the body;
 *  - group shown (`pro`): exactly one, in the body;
 *  - predicate faulted: zero — the body answers a fault the way the form
 *    does for a field group, fail-CLOSED (hides the group; objectui#13055),
 *    and the strip never draws a gated group's member at all.
 *
 * Every leg first finds the `kind` chip in the strip and the ungrouped
 * `code` value in the body, so a page that rendered nothing cannot pass a
 * "hidden" leg.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { HighlightFieldsProvider, RecordContextProvider } from '@object-ui/react';
import { RecordDetailsRenderer } from '../record-details';
import { RecordHighlightsRenderer } from '../record-highlights';
import { buildDefaultPageSchema } from '../../synth/buildDefaultPageSchema';

const OBJECT = 'recheck_gate';
const GATE = "record.kind == 'pro'";

const cardObject = (visibleWhen: unknown): any => ({
  name: OBJECT,
  label: 'QA Gate',
  fields: {
    name: { type: 'text', label: 'Name' },
    kind: {
      type: 'select',
      label: 'Kind',
      options: [
        { value: 'basic', label: 'Basic plan' },
        { value: 'pro', label: 'Pro plan' },
      ],
    },
    // Ungrouped, and a type the strip never picks: the body's live control.
    code: { type: 'textarea', label: 'Code' },
    pro_secret_note: { type: 'text', label: 'Pro secret note', group: 'pro_details' },
    pro_budget: { type: 'number', label: 'Pro budget', group: 'pro_details' },
  },
  fieldGroups: [{ key: 'pro_details', label: 'Pro details', visibleWhen }],
});

const row = (kind: string) => ({
  id: `R-${kind}`,
  name: 'One',
  kind,
  code: `code-of-${kind}`,
  pro_secret_note: 'only-for-pro',
  pro_budget: 4242,
});

function nodeOfType(node: any, type: string): any {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = nodeOfType(n, type);
      if (hit) return hit;
    }
    return undefined;
  }
  if (!node || typeof node !== 'object') return undefined;
  if (node.type === type) return node;
  for (const value of Object.values(node)) {
    const hit = nodeOfType(value, type);
    if (hit) return hit;
  }
  return undefined;
}

function renderSynthesizedPage(objectSchema: any, data: Record<string, unknown>) {
  const page = buildDefaultPageSchema(objectSchema);
  const strip = nodeOfType(page, 'record:highlights');
  const details = nodeOfType(page, 'record:details');
  if (!strip || !details) throw new Error('HARNESS DEAD: the synthesized page lost a node');
  const dataSource = { getObjectSchema: async () => objectSchema };
  render(
    <RecordContextProvider
      objectName={OBJECT}
      recordId={String(data.id)}
      data={data}
      objectSchema={objectSchema}
      dataSource={dataSource as never}
    >
      <HighlightFieldsProvider>
        <div data-testid="strip">
          <RecordHighlightsRenderer schema={strip.properties as never} />
        </div>
        <div data-testid="body">
          <RecordDetailsRenderer schema={details.properties as never} />
        </div>
      </HighlightFieldsProvider>
    </RecordContextProvider>,
  );
  const stripRegion = within(screen.getByTestId('strip'));
  const bodyRegion = within(screen.getByTestId('body'));
  // Live controls: the strip drew the `kind` chip (its option label), the
  // body drew its ungrouped bucket.
  const kindLabel = data.kind === 'pro' ? 'Pro plan' : 'Basic plan';
  if (stripRegion.queryAllByText(kindLabel).length === 0) throw new Error('HARNESS DEAD: no strip');
  if (bodyRegion.queryAllByText(String(data.code)).length === 0) throw new Error('HARNESS DEAD: no body');
  return { strip: stripRegion, body: bodyRegion };
}

const onPage = (text: string) => screen.queryAllByText(text).length;

beforeAll(() => Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 }));

beforeEach(() => {
  // `useRecordEditable` probes `POST /api/v1/security/explain`; a double keeps
  // the socket closed. Its answer is orthogonal to which fields are drawn.
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ allowed: true }),
    text: async () => '{"allowed":true}',
  })) as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the synthesized strip and body agree on a gated field group (objectui#12720)', () => {
  it('kind = basic: no pro_details member anywhere on the page, strip included', () => {
    const { strip, body } = renderSynthesizedPage(cardObject(GATE), row('basic'));
    expect(strip.queryByText('only-for-pro')).not.toBeInTheDocument();
    expect(body.queryByText('Pro details')).not.toBeInTheDocument();
    expect(onPage('only-for-pro')).toBe(0);
  });

  it('kind = pro: the group is drawn in the body, and its member is shown exactly once', () => {
    const { strip, body } = renderSynthesizedPage(cardObject(GATE), row('pro'));
    expect(body.getByText('Pro details')).toBeInTheDocument();
    expect(body.getByText('only-for-pro')).toBeInTheDocument();
    expect(strip.queryByText('only-for-pro')).not.toBeInTheDocument();
    expect(onPage('only-for-pro')).toBe(1);
  });

  it('a faulted predicate: the body hides the group as the form does (fail-closed), the strip still declines it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { strip, body } = renderSynthesizedPage(cardObject('record.kind =='), row('basic'));
      expect(body.queryByText('Pro details')).not.toBeInTheDocument();
      expect(strip.queryByText('only-for-pro')).not.toBeInTheDocument();
      expect(onPage('only-for-pro')).toBe(0);
    } finally {
      warn.mockRestore();
    }
  });
});
