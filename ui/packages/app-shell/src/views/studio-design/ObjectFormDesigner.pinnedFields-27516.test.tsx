// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The form canvas never shows a field above one the platform puts back first —
 * objectstack#27516.
 *
 * The defect: an author dragged Condition above Owner, the canvas showed it
 * there and the draft write carried that order, but the write strips a column
 * that is exactly the platform's own (`stripInjectedSystemColumns`) and every
 * `/meta` read puts it back AHEAD of the declared fields
 * (`applyInjectedSystemColumns`). After a reload Owner was first again. The
 * canvas now settles such a field first in the ungrouped section, so what it
 * shows is what the reload shows.
 *
 * The instrument is the one `ObjectFormDesigner.dndAnnouncements-11802.test.tsx`
 * uses: the real `DndContext`, sensors and handlers, with only the collision
 * detection replaced by a band geometry (the test DOM measures every box as
 * zero). `reload` replays the round trip with the spec's own helpers: the
 * write's strip, then the read's injection, ahead of the declared fields.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OWNER_FIELD_DEF, injectedSystemColumnDefs, isInjectedColumnDefinition } from '@objectstack/spec/data';

const geometry = vi.hoisted(() => ({ bands: [] as Array<string | null> }));

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  const ReactMod = await import('react');
  const byBand: import('@dnd-kit/core').CollisionDetection = ({ pointerCoordinates }) => {
    const id = pointerCoordinates ? (geometry.bands[Math.floor(pointerCoordinates.x / 100)] ?? null) : null;
    return id ? [{ id }] : [];
  };
  const GeometryDndContext = (props: Record<string, unknown>) =>
    ReactMod.createElement(actual.DndContext, { ...props, collisionDetection: byBand } as never);
  return { ...actual, DndContext: GeometryDndContext };
});

import { ObjectFormDesigner } from './ObjectFormDesigner';

type Fields = Record<string, Record<string, unknown>>;

const condition = { type: 'select', label: 'Condition' };
const notes = { type: 'text', label: 'Notes' };

/** The draft as the read serves it: the platform's `owner_id` ahead of the declared fields. */
const served = (fields: Fields) => ({
  name: 'asset',
  fields,
  fieldGroups: [{ key: 'details', label: 'Details' }],
});

/** The audit and tenant names the Studio host keeps off the canvas (`STUDIO_SYSTEM_FIELD_NAMES`). */
const HOST_SYSTEM_NAMES = new Set(['organization_id', 'created_at', 'created_by', 'updated_at', 'updated_by']);

/** Every `fields` the designer committed, in order. */
let commits: Fields[] = [];

function Host({ initial }: { initial: Record<string, unknown> }): React.ReactElement {
  const [draft, setDraft] = React.useState<Record<string, unknown>>(initial);
  return (
    <ObjectFormDesigner
      draft={draft}
      systemFieldNames={HOST_SYSTEM_NAMES}
      onChange={(patch) => {
        if (patch.fields) commits.push(patch.fields as Fields);
        setDraft((d) => ({ ...d, ...patch }));
      }}
      onSelectField={() => {}}
    />
  );
}

function renderDesigner(draft: Record<string, unknown>) {
  commits = [];
  return render(<Host initial={draft} />);
}

/**
 * The draft round trip: the write strips a column that is exactly the
 * platform's, the read puts every undeclared one back ahead of the declared
 * fields — the order `applyInjectedSystemColumns` builds.
 */
function reload(fields: Fields): Fields {
  const body = { name: 'asset', fields };
  const injected = injectedSystemColumnDefs(body);
  const declared = Object.fromEntries(
    Object.entries(fields).filter(([name, def]) => !(injected[name] && isInjectedColumnDefinition(def, injected[name]))),
  );
  const additions = Object.fromEntries(Object.entries(injected).filter(([name]) => declared[name] === undefined));
  return { ...additions, ...declared } as Fields;
}

afterEach(() => {
  cleanup();
  geometry.bands = [];
});

const said = () => document.querySelector('[id^="DndLiveRegion"]')?.textContent ?? null;
const card = (label: string) => screen.getByText(label, { exact: true }).closest('.cursor-grab') as HTMLElement;
/** The card labels on the canvas, top to bottom (the cases below fill the ungrouped section only). */
const ungroupedCards = () =>
  ([...document.querySelectorAll('.cursor-grab')] as HTMLElement[]).map(
    (c) => c.querySelector('.truncate')?.textContent ?? '',
  );

function pointerDrag(cardEl: HTMLElement, bands: Array<string | null>): void {
  geometry.bands = [null, ...bands];
  fireEvent.pointerDown(cardEl, { isPrimary: true, button: 0, clientX: 50, clientY: 10 });
  fireEvent.pointerMove(document, { isPrimary: true, clientX: 60, clientY: 10 });
  bands.forEach((_, i) => fireEvent.pointerMove(document, { isPrimary: true, clientX: (i + 1) * 100 + 50, clientY: 10 }));
  fireEvent.pointerUp(document, { isPrimary: true, button: 0 });
}

describe('the form canvas settles the platform’s pinned fields first (objectstack#27516)', () => {
  it('a field dropped above Owner lands below it, and the canvas equals the reload', () => {
    renderDesigner(served({ owner_id: { ...OWNER_FIELD_DEF }, condition, notes }));
    expect(ungroupedCards()).toEqual(['Owner', 'Condition', 'Notes']);

    pointerDrag(card('Condition'), ['f:owner_id']);
    // The drop is announced where it lands, under Owner.
    expect(said()).toBe('Condition moved to Ungrouped, position 2 of 3.');
    const shown = ungroupedCards();
    expect(shown).toEqual(['Owner', 'Condition', 'Notes']);
    expect(Object.keys(commits.at(-1)!).filter((n) => !HOST_SYSTEM_NAMES.has(n))).toEqual([
      'owner_id',
      'condition',
      'notes',
    ]);

    // After the round trip the canvas shows the same order.
    cleanup();
    renderDesigner(served(reload(commits.at(-1)!)));
    expect(ungroupedCards()).toEqual(shown);
  });

  it('reorders the author’s fields below Owner as before', () => {
    renderDesigner(served({ owner_id: { ...OWNER_FIELD_DEF }, condition, notes }));
    pointerDrag(card('Notes'), ['f:condition']);
    expect(said()).toBe('Notes moved to Ungrouped, position 2 of 3.');
    expect(ungroupedCards()).toEqual(['Owner', 'Notes', 'Condition']);

    cleanup();
    renderDesigner(served(reload(commits.at(-1)!)));
    expect(ungroupedCards()).toEqual(['Owner', 'Notes', 'Condition']);
  });

  it('CONTROL: an `owner_id` the author changed is theirs, and keeps the place it is given', () => {
    const owner = { ...OWNER_FIELD_DEF, label: 'Account manager' };
    renderDesigner(served({ owner_id: owner, condition, notes }));
    pointerDrag(card('Condition'), ['f:owner_id']);
    expect(said()).toBe('Condition moved to Ungrouped, position 1 of 3.');
    expect(ungroupedCards()).toEqual(['Condition', 'Account manager', 'Notes']);

    cleanup();
    renderDesigner(served(reload(commits.at(-1)!)));
    expect(ungroupedCards()).toEqual(['Condition', 'Account manager', 'Notes']);
  });

  it('Owner moved into a section carries the section and keeps its place there', () => {
    renderDesigner(served({ owner_id: { ...OWNER_FIELD_DEF }, condition: { ...condition, group: 'details' }, notes }));
    pointerDrag(card('Owner'), ['f:condition']);
    const committed = commits.at(-1)!;
    expect(committed.owner_id.group).toBe('details');
    const authored = (fields: Fields) => Object.keys(fields).filter((n) => ['owner_id', 'condition', 'notes'].includes(n));
    // The section's order is the author's, so the round trip keeps it.
    expect(authored(reload(committed))).toEqual(authored(committed));
  });
});
