/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7070 step ③ — `generateViewSchema`'s TIMELINE branch stops flooring
 * the date axis at `'created_at'`.
 *
 * Maintainer ruling 2026-09-01 (总监批 #28, objectui#7070): house posture
 * 日期轴永不虚构 — a date axis is never fabricated. The ruling sequenced three
 * steps and forbade reordering them, because the floors and the refusal are
 * only meaningful together:
 *
 *   ① `ObjectTimeline` gains a refusal screen for an absent date axis;
 *   ② the renderer's own `|| 'date'` floor is retired;
 *   ③ — THIS — the two plugin faces stop supplying `'created_at'`.
 *
 * ①② landed as `20cb8db9b` (PR #7467). With them in and this floor still
 * standing, nothing in the product refuses: this branch answers "the axis is
 * bound" for every view, so the screen ① installed is unreachable from here.
 * `ObjectTimeline` reads this FLAT prop (`schema.startDateField`) at the tail of
 * its own resolver chain, which is exactly why a floor here is load-bearing.
 *
 * The sibling of `ObjectView.ganttBinding-7070` and `ObjectView.calendarBinding
 * -7029` next door — the same one-rung fabrication, the same face, the third
 * and last of its date axes to be retired.
 *
 * REVERSE VERIFICATION — direction predicted before running, then observed:
 * restore `|| 'created_at'` on the single line this step deletes and the two
 * "invents NO binding" cases go RED (the recorded schema carries the fabricated
 * name) while every CONTROL below stays GREEN in both worlds. That asymmetry is
 * the whole claim: this branch stopped INVENTING, it did not stop FORWARDING.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ObjectView } from '../ObjectView';
import type { ObjectViewSchema } from '@object-ui/types';

/** Every schema the view hands to SchemaRenderer, in order. */
const rendered: any[] = [];

vi.mock('@object-ui/react', async (importOriginal) => {
  const React = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: ({ schema }: any) => {
      rendered.push(schema);
      return <div data-testid="schema-renderer">{schema?.type}</div>;
    },
    SchemaRendererContext: React.createContext(null),
    subscribeDataChanges: () => () => {},
    notifyDataChanged: () => {},
  };
});
vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectGrid: () => <div data-testid="object-grid" />,
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: () => <div data-testid="object-form" />,
}));

async function renderTimelineView(view: Record<string, unknown>) {
  rendered.length = 0;
  const ds: any = {
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'crm_campaign', fields: {} }),
  };
  render(
    <ObjectView
      schema={{ type: 'object-view', objectName: 'crm_campaign' } as ObjectViewSchema}
      views={[{ id: 't', label: 'Timeline', type: 'timeline' as any, ...view }]}
      dataSource={ds}
    />,
  );
  await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
  return rendered[rendered.length - 1];
}

describe('ObjectView.generateViewSchema — timeline restates only a DECLARED axis (objectui#7070 step ③)', () => {
  it('RENDER PROOF: this harness reaches the timeline branch at all', async () => {
    // First, and deliberately: every "is undefined" below reads a key off the
    // recorded schema, and an absent key is indistinguishable from a branch that
    // never ran. This row is what makes the rest measurements — it fails loudly
    // if the mount, the mock or the `views` shape stops producing an
    // `object-timeline` schema, instead of letting the file pass vacuously.
    const schema = await renderTimelineView({ timeline: { startDateField: 'start_date' } });
    expect(schema.type).toBe('object-timeline');
    expect(schema.startDateField).toBe('start_date');
  });

  it('invents NO date axis for a timeline view that declares no config', async () => {
    // THE DEFECT. `startDateField` used to read `'created_at'` here — a name
    // this view never wrote, and one most objects DO carry, so downstream it is
    // indistinguishable from a real binding and it never resolves to nothing.
    // Absence is the only route to `ObjectTimeline`'s refusal screen.
    const schema = await renderTimelineView({});
    expect(schema.type).toBe('object-timeline');
    expect(schema.startDateField).toBeUndefined();
  });

  it('invents no date axis for an EMPTY timeline block', async () => {
    // ⚠️ `timeline` sits at the VIEW's top level, not under `options`:
    // `viewOptions` is `currentNamedViewConfig?.options || activeView`, and a raw
    // `views` entry takes the `activeView` leg. The sibling gantt file records
    // measuring that the hard way — written as `{ options: { timeline } }` this
    // case AND the controls below all read `undefined`, and the controls are
    // what exposes it.
    const schema = await renderTimelineView({ timeline: {} });
    expect(schema.startDateField).toBeUndefined();
  });

  it('a timeline block with no date key does not become a binding', async () => {
    // The bag app-shell's object page emits for a view that declared nothing:
    // `timelineViewOptions` floors the TITLE at `'name'` and emits no axis. "The
    // config object exists" must not be read as "the axis is bound".
    const schema = await renderTimelineView({ timeline: { titleField: 'name' } });
    expect(schema.startDateField).toBeUndefined();
    expect(schema.titleField).toBe('name');
  });

  it('CONTROL: forwards the spec-canonical `timeline.startDateField`', async () => {
    const schema = await renderTimelineView({
      timeline: { startDateField: 'start_date', endDateField: 'end_date', titleField: 'subject' },
    });
    expect(schema.startDateField).toBe('start_date');
    expect(schema.endDateField).toBe('end_date');
    expect(schema.titleField).toBe('subject');
  });

  it('the retired LEGACY `timeline.dateField` alias binds no axis, under either flat name (objectui#6152 round 14)', async () => {
    // This arm pinned that the alias still resolved: the flat prop was the one
    // place it was translated into the spec key, and the raw block spread also
    // put it on the node's FLAT `dateField`, which `ObjectTimeline` reads as a
    // declared prop. objectui#6152 round 14 retired both, so a stored alias
    // reaches neither, and the renderer's refusal answers instead.
    const schema = await renderTimelineView({ timeline: { dateField: 'start_date' } });
    expect(schema.startDateField).toBeUndefined();
    expect(schema).not.toHaveProperty('dateField');
  });

  it('CONTROL: the spec key still WINS over the legacy alias', async () => {
    const schema = await renderTimelineView({
      timeline: { startDateField: 'start_date', dateField: 'end_date' },
    });
    expect(schema.startDateField).toBe('start_date');
  });

  it('CONTROL: `titleField` is NOT a date axis and keeps its floor', async () => {
    // ⛔ Scope, made visible. The ruling retires FABRICATED DATE AXES; `'name'`
    // is the display-name rung every sibling branch on this face carries
    // (gallery, kanban, gantt) and `timelineViewOptions` carries at app-shell.
    // If a later card retires it, this is where that card declares it did.
    const schema = await renderTimelineView({});
    expect(schema.titleField).toBe('name');
  });
});
