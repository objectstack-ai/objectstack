// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The form designer's drag live region speaks the author's labels, never the
 * canvas's ids — objectui#11802.
 *
 * The defect: the designer's `DndContext` passed no `accessibility`, so
 * dnd-kit's default sentences read its ids to a screen reader, in English
 * whatever the locale ("Draggable item f:name was dropped over droppable area
 * g:new_group"). Every case below reads the REAL live region and the REAL
 * screen-reader instructions dnd-kit renders.
 *
 * The instrument: the real `DndContext`, the real sensors and the real
 * handlers run. Only `collisionDetection` is replaced, by a test geometry in
 * which the pointer's x picks the droppable (one band per 100px), because the
 * test DOM measures every box as zero. Band 0 is where the pointer goes down.
 * The browser reading that the bands copy is on the pull request: a pointer
 * that carries a field into another group is over that group first, then over
 * the moved field's own card once the canvas has moved it.
 *
 * The control rides every drop: the place the region announces is compared
 * with the place the committed `fields` give the field, so a sentence cannot
 * stay green while the drop lands somewhere else.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider, createI18n } from '@object-ui/i18n';

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

type Field = { name: string; type: string; label: string; group?: string };

const DRAFT = {
  name: 'account',
  fields: [
    { name: 'name', type: 'text', label: 'Name' },
    { name: 'industry', type: 'text', label: 'Industry' },
    { name: 'phone', type: 'text', label: 'Phone', group: 'contact' },
    { name: 'email', type: 'text', label: 'Email', group: 'contact' },
  ] as Field[],
  fieldGroups: [
    { key: 'contact', label: 'Contact' },
    { key: 'new_group', label: 'New group' },
  ],
};

/** The zh object translations the cards and section headers resolve through. */
const zh = () =>
  createI18n({
    defaultLanguage: 'zh',
    detectBrowserLanguage: false,
    resources: {
      zh: {
        app: {
          objects: { account: { _sections: { contact: { label: '联系方式' }, new_group: { label: '新分组' } } } },
          fields: { account: { name: '名称', industry: '行业', phone: '电话', email: '邮箱' } },
        },
      },
    },
  });

/** Every `fields` the designer committed, in order. */
let commits: Field[][] = [];

function Host(): React.ReactElement {
  const [draft, setDraft] = React.useState<Record<string, unknown>>(DRAFT);
  return (
    <ObjectFormDesigner
      draft={draft}
      systemFieldNames={new Set()}
      onChange={(patch) => {
        if (patch.fields) commits.push(patch.fields as Field[]);
        setDraft((d) => ({ ...d, ...patch }));
      }}
      onSelectField={() => {}}
    />
  );
}

function renderDesigner(lang: 'en' | 'zh' = 'en') {
  commits = [];
  return render(lang === 'zh' ? <I18nProvider instance={zh()}><Host /></I18nProvider> : <Host />);
}

afterEach(() => {
  cleanup();
  geometry.bands = [];
});

/** What the live region says now. */
const said = () => document.querySelector('[id^="DndLiveRegion"]')?.textContent ?? null;
const card = (label: string) => screen.getByText(label, { exact: true }).closest('.cursor-grab') as HTMLElement;
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

/**
 * Pick the card up with the pointer, then move it through `bands` (band 1, 2,
 * …), recording what the region says after the pick-up and after each move.
 */
function pointerDrag(cardEl: HTMLElement, bands: Array<string | null>): string[] {
  geometry.bands = [null, ...bands];
  const heard: string[] = [];
  fireEvent.pointerDown(cardEl, { isPrimary: true, button: 0, clientX: 50, clientY: 10 });
  // Past the designer's 4px activation distance: the drag starts at band 0.
  fireEvent.pointerMove(document, { isPrimary: true, clientX: 60, clientY: 10 });
  heard.push(said() ?? '');
  bands.forEach((_, i) => {
    fireEvent.pointerMove(document, { isPrimary: true, clientX: (i + 1) * 100 + 50, clientY: 10 });
    heard.push(said() ?? '');
  });
  return heard;
}
const pointerDrop = () => fireEvent.pointerUp(document, { isPrimary: true, button: 0 });

/** Where the last commit put a field: its group key and its 1-based place in that group. */
function landed(name: string): { group: string; position: number; total: number } {
  const fields = commits.at(-1)!;
  const group = fields.find((f) => f.name === name)?.group ?? '';
  const members = fields.filter((f) => (f.group ?? '') === group).map((f) => f.name);
  return { group, position: members.indexOf(name) + 1, total: members.length };
}

const NO_ID = /\b[fg]:\w/;

describe('the form designer announces labels, not ids (objectui#11802)', () => {
  it('dragging Name into New group: picked up, over and dropped, each by label and place', () => {
    renderDesigner();
    const heard = pointerDrag(card('Name'), ['g:new_group', 'f:name']);
    expect(heard[0]).toBe('Picked up Name. It is in Ungrouped, position 1 of 2.');
    expect(heard[1]).toBe('Name is over New group, position 1 of 1.');
    // The field over its own moved card names no new place, so the region keeps
    // the sentence about the group rather than repeating it.
    expect(heard[2]).toBe('Name is over New group, position 1 of 1.');

    pointerDrop();
    expect(said()).toBe('Name moved to New group, position 1 of 1.');
    for (const sentence of [...heard, said()]) expect(sentence).not.toMatch(NO_ID);

    // Control: the drop landed where the region says it did.
    expect(landed('name')).toEqual({ group: 'new_group', position: 1, total: 1 });
  });

  it('says it in zh, with the zh labels the cards show', () => {
    renderDesigner('zh');
    const heard = pointerDrag(card('名称'), ['g:new_group', 'f:name']);
    expect(heard[0]).toBe('已拿起 名称，当前在 未分组，第 1 个，共 2 个。');
    expect(heard[1]).toBe('名称 正移到 新分组，第 1 个，共 1 个。');

    pointerDrop();
    expect(said()).toBe('名称 已移到 新分组，第 1 个，共 1 个。');
    for (const sentence of [...heard, said()]) expect(sentence).not.toMatch(NO_ID);
    expect(landed('name')).toEqual({ group: 'new_group', position: 1, total: 1 });
  });

  it('the screen-reader instructions every card points at are the localized ones', () => {
    renderDesigner();
    const describedBy = card('Name').getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe(
      'To pick up a field, press Space or Enter. While dragging, use the arrow keys to move it. Press Space or Enter again to drop it in its new place, or press Escape to cancel.',
    );
    cleanup();

    renderDesigner('zh');
    const zhDescribedBy = card('名称').getAttribute('aria-describedby');
    expect(document.getElementById(zhDescribedBy!)?.textContent).toBe(
      '按空格键或回车键拿起字段。拖动时用方向键移动，再按空格键或回车键放到新位置，按 Esc 键取消。',
    );
  });

  it('a reorder inside one group announces the place the drop commits', () => {
    renderDesigner();
    const heard = pointerDrag(card('Phone'), ['f:email']);
    expect(heard[0]).toBe('Picked up Phone. It is in Contact, position 1 of 2.');
    expect(heard[1]).toBe('Phone is over Contact, position 2 of 2.');

    pointerDrop();
    expect(said()).toBe('Phone moved to Contact, position 2 of 2.');
    expect(landed('phone')).toEqual({ group: 'contact', position: 2, total: 2 });
  });

  it('a drop on a field of another group announces the place the drop commits, after the canvas moved the field', () => {
    renderDesigner();
    const heard = pointerDrag(card('Name'), ['f:email', 'f:name']);
    expect(heard[1]).toBe('Name is over Contact, position 2 of 3.');

    pointerDrop();
    expect(said()).toBe('Name moved to Contact, position 2 of 3.');
    expect(landed('name')).toEqual({ group: 'contact', position: 2, total: 3 });
  });

  it('a drop that is still over the field it was carried onto announces where the handler puts it', () => {
    // No band for the moved card: the drop arrives while the pointer is still
    // over Email, and the drop handler places Name after it.
    renderDesigner();
    pointerDrag(card('Name'), ['f:email']);

    pointerDrop();
    const place = landed('name');
    expect(place).toEqual({ group: 'contact', position: 3, total: 3 });
    expect(said()).toBe(`Name moved to Contact, position ${place.position} of ${place.total}.`);
  });

  it('leaving every group, then dropping, says so and names where the field stays', () => {
    renderDesigner();
    const heard = pointerDrag(card('Name'), ['g:new_group', null]);
    expect(heard[2]).toBe('Name is not over a group.');

    pointerDrop();
    expect(said()).toBe('Name was dropped outside the groups and is back in Ungrouped, position 1 of 2.');
    // Control: nothing was committed, and the card is back in its section.
    expect(commits).toHaveLength(0);
  });

  it('a keyboard pick-up and cancel each announce by label', async () => {
    renderDesigner();
    const industry = card('Industry');
    industry.focus();
    fireEvent.keyDown(industry, { code: 'Space', key: ' ' });
    expect(said()).toBe('Picked up Industry. It is in Ungrouped, position 2 of 2.');

    // dnd-kit's keyboard sensor listens for the next key one tick later.
    await tick();
    fireEvent.keyDown(document, { code: 'Escape', key: 'Escape' });
    expect(said()).toBe('Dragging cancelled. Industry is back in Ungrouped, position 2 of 2.');
    expect(said()).not.toMatch(NO_ID);
    expect(commits).toHaveLength(0);
  });
});
