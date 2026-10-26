// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12507 — a branch edge's pill reads the author's own label first,
 * otherwise `if ` and the condition clamped to 32 characters plus an
 * ellipsis; `else` is unchanged. The full wording rides in the pill's
 * `title`, and the pill's box is never wider than a node card nor wide
 * enough to reach a sibling pill.
 *
 * Measured on HotCRM `campaign_enrollment` before the fix: both outcomes of
 * "Campaign Open?" carry a ~150-character CEL condition and their own labels
 * ("Open · Leads" / "Open · Contacts"); the canvas printed the condition, and
 * the two truncated pills read the same `if has(vars.campaign…` prefix.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { FlowCanvas } from './FlowCanvas';
import { NODE_W, type FlowDesignerEdge, type FlowDesignerNode } from './flow-canvas-layout';

afterEach(cleanup);

// The palette's engine overlay answers "engine absent" (its offline answer).
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('not found', { status: 404 })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** The open-campaign gate from HotCRM `campaign_enrollment`, padded to 150 characters. */
const LONG_COND = (
  'has(vars.campaignRecord) && has(vars.campaignRecord.status) && ' +
  '(vars.campaignRecord.status == "planning" || vars.campaignRecord.status == "in_progress") && '
).padEnd(150, 'x').slice(0, 150);

const nodes: FlowDesignerNode[] = [
  { id: 'start', type: 'start', label: 'Start' },
  { id: 'gate', type: 'decision', label: 'Campaign Open?' },
  { id: 'leads', type: 'get_record', label: 'Find Eligible Leads' },
  { id: 'contacts', type: 'get_record', label: 'Find Eligible Contacts' },
  { id: 'end', type: 'end', label: 'End' },
];

function mount(edges: FlowDesignerEdge[], editable = false) {
  return render(
    <FlowCanvas
      nodes={nodes}
      edges={edges}
      editable={editable}
      designMode={editable}
      selectedId={null}
      onSelect={() => {}}
      onPatch={() => {}}
    />,
  );
}

function pills(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-branch-label]'));
}

function boxOf(pill: HTMLElement) {
  const fo = pill.closest('foreignObject')!;
  const x = Number(fo.getAttribute('x'));
  const width = Number(fo.getAttribute('width'));
  return { x, width, centre: x + width / 2 };
}

describe('flow canvas branch-edge pills (objectui#12507)', () => {
  it('clamps a 150-character condition to 32 characters plus an ellipsis, the full condition in title', () => {
    expect(LONG_COND).toHaveLength(150);
    const { container } = mount([
      { id: 'e1', source: 'start', target: 'gate' },
      { id: 'e2', source: 'gate', target: 'leads', condition: LONG_COND },
    ]);
    const [pill] = pills(container);
    const text = pill.textContent!;
    expect(text.endsWith('…')).toBe(true);
    expect(Array.from(text)).toHaveLength(33);
    expect(text).toBe(`${`if ${LONG_COND}`.slice(0, 32)}…`);
    expect(pill.getAttribute('title')).toBe(`if ${LONG_COND}`);
  });

  it('shows an edge’s own label unclamped when it fits, its condition in title', () => {
    const { container } = mount([
      { id: 'e1', source: 'start', target: 'gate' },
      { id: 'e4', source: 'gate', target: 'leads', condition: `${LONG_COND} != "contacts"`, label: 'Open · Leads' },
      { id: 'e7', source: 'gate', target: 'contacts', condition: `${LONG_COND} == "contacts"`, label: 'Open · Contacts' },
    ]);
    const [leads, contacts] = pills(container);
    expect(leads.textContent).toBe('Open · Leads');
    expect(contacts.textContent).toBe('Open · Contacts');
    expect(leads.getAttribute('title')).toBe(`Open · Leads\nif ${LONG_COND} != "contacts"`);
  });

  it('clamps an own label longer than 32 characters the same way', () => {
    const label = 'Open campaign with leads and contacts still pending';
    const { container } = mount([
      { id: 'e1', source: 'start', target: 'gate' },
      { id: 'e2', source: 'gate', target: 'leads', label },
    ]);
    const [pill] = pills(container);
    expect(pill.textContent).toBe(`${label.slice(0, 32)}…`);
    expect(pill.getAttribute('title')).toBe(label);
  });

  it('leaves a default edge reading else', () => {
    const { container } = mount([
      { id: 'e1', source: 'start', target: 'gate' },
      { id: 'e2', source: 'gate', target: 'leads', condition: 'a > 1', label: 'Leads' },
      { id: 'e3', source: 'gate', target: 'contacts', isDefault: true },
    ]);
    const texts = pills(container).map((p) => p.textContent);
    expect(texts).toEqual(['Leads', 'else']);
    expect(pills(container)[1].hasAttribute('title')).toBe(false);
  });

  it('caps a lone pill at the node width and keeps sibling pills from reaching each other', () => {
    const lone = mount([
      { id: 'e1', source: 'start', target: 'gate', label: 'Go' },
    ]);
    expect(boxOf(pills(lone.container)[0]).width).toBe(NODE_W);
    lone.unmount();

    const { container } = mount([
      { id: 'e1', source: 'start', target: 'gate' },
      { id: 'e4', source: 'gate', target: 'leads', condition: LONG_COND },
      { id: 'e7', source: 'gate', target: 'contacts', condition: LONG_COND },
    ]);
    const [a, b] = pills(container).map(boxOf);
    expect(a.width).toBeLessThan(NODE_W);
    // Each box is centred on its edge; the two boxes leave clear space between them.
    const [left, right] = a.centre < b.centre ? [a, b] : [b, a];
    expect(left.x + left.width).toBeLessThan(right.x);
  });

  it('slides the insert handle clear of the pill', () => {
    const { container } = mount(
      [
        { id: 'e1', source: 'start', target: 'gate' },
        { id: 'e2', source: 'gate', target: 'leads', condition: LONG_COND },
      ],
      true,
    );
    const [pill] = pills(container);
    const box = boxOf(pill);
    const handle = pill.closest('g')!.querySelector('button[aria-label]')!.closest('foreignObject')!;
    // The clamped pill is drawn ~33 characters (at least 5px each) wide around
    // the edge; the handle starts past its right edge, where a 120px pill ended.
    expect(Number(handle.getAttribute('x'))).toBeGreaterThan(box.centre + (33 * 5) / 2);
  });
});
