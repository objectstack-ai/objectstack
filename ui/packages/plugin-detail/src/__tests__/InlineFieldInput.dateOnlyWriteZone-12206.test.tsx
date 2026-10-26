/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12206 — an inline edit of a `date` field saves the day the user
 * picked, as the plain `YYYY-MM-DD` the Edit form writes, in every zone.
 *
 * ── What was measured ───────────────────────────────────────────────────────
 * `InlineFieldInput` (the editor the record highlights and the details body
 * share) handed a `date` field's picked day to `new Date(day + 'T00:00:00')`
 * and wrote back its `toISOString()`: local midnight as a UTC instant. The
 * server keeps a date-only field's UTC calendar day, so east of UTC that is the
 * day BEFORE — measured on HotCRM in `Asia/Taipei`, picking 2026-10-16 sent
 * `{"due_date":"2026-10-15T16:00:00.000Z"}` and stored 2026-10-15, while the
 * Edit form sent `{"due_date":"2026-10-22"}` for the same field. West of UTC
 * the instant still names the right UTC day (`…T05:00:00.000Z` at UTC-5), but it
 * is an instant, not the day — so every case below asserts the payload is
 * EXACTLY the plain day, never a day extracted from it.
 *
 * The cases drive the whole record-page write: the highlights strip's inline
 * editor stages the pick into the shared draft, and `<InlineEditSaveBar>` hands
 * that draft to `dataSource.update` — the PATCH body the card measured.
 *
 * The control is the Edit form's own `date` widget (`getLazyFieldWidget`, the
 * loaders the form registers): it already wrote the plain day, and the inline
 * write is asserted to be that same value.
 *
 * ── ⚠️ The zone cases run ONLY when driven, in a FORKS child ────────────────
 * `process.env.TZ` written inside a test of the normal run does not move the
 * zone (the root config runs `pool: 'threads'`), so the zone cases are skipped
 * there and `scripts/__tests__/date-only-zone-pins-10183.test.ts` runs them on
 * the forks pool and fails unless every one ran and passed. Each zone opens
 * with a rig case — the zone `Intl` resolved, and the local hour of a fixed
 * INSTANT — so a child whose zone did not move reds instead of going quietly
 * green. The suite-zone case runs in the normal run too: at UTC the old write
 * was `…T00:00:00.000Z`, which is not the plain day either.
 */
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { InlineEditProvider, useInlineEdit } from '@object-ui/react';
import { getLazyFieldWidget } from '@object-ui/fields';
import type { HighlightField } from '@object-ui/types';
import { HeaderHighlight } from '../HeaderHighlight';
import { InlineEditSaveBar } from '../InlineEditSaveBar';

const DRIVEN = process.env.OBJECTUI_DATE_ZONE_CHILD === '1';

/** UTC+8, no DST — the zone the card measured in. */
const EAST = 'Asia/Taipei';
/** UTC-5, no DST — the negative offset the triage named. */
const WEST = 'America/Bogota';

/** A fixed instant: 20:00 in the east, 07:00 in the west. */
const INSTANT = '2026-10-15T12:00:00.000Z';
/** The day the record holds before the edit. */
const STORED = '2026-10-14';
/** The day the user picks — the card's first measured row. */
const PICKED = '2026-10-16';

const FIELDS: HighlightField[] = [{ name: 'due_date', label: 'Due date', type: 'date' }];
const OBJECT_SCHEMA = { fields: { due_date: { type: 'date' } } };

afterEach(() => {
  cleanup();
});

/** Opens the shared edit session the way the strip's pencil does. */
function EnterEdit() {
  const inline = useInlineEdit()!;
  return (
    <button type="button" onClick={() => inline.enter('due_date')}>
      enter-edit
    </button>
  );
}

/**
 * Pick `day` in the highlights strip's inline editor, press Save, and return
 * the record patch the save bar handed to `dataSource.update`.
 */
async function saveInlinePick(day: string): Promise<unknown> {
  const update = vi.fn().mockResolvedValue({});
  const { container } = render(
    <InlineEditProvider canEdit>
      <EnterEdit />
      <HeaderHighlight fields={FIELDS} data={{ due_date: STORED }} objectSchema={OBJECT_SCHEMA} />
      <InlineEditSaveBar
        dataSource={{ update }}
        objectName="crm_task"
        recordId="t1"
        data={{ updated_at: 'v1' }}
        refresh={vi.fn().mockResolvedValue(undefined)}
      />
    </InlineEditProvider>,
  );
  fireEvent.click(screen.getByText('enter-edit'));
  // The strip's editor is the platform date picker (objectui#12759), the
  // form's own face: a text box that commits on blur, and an ISO day reads in
  // every locale. It loads lazily.
  const input = await waitFor(() => {
    const el = container.querySelector('[data-slot="date-picker"] input');
    if (!el) throw new Error('the strip opened no date editor');
    return el as HTMLInputElement;
  });
  expect(input.value).toBe(formatShown(STORED));
  fireEvent.change(input, { target: { value: day } });
  fireEvent.blur(input);
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  const [objectName, recordId, patch] = update.mock.calls[0];
  expect([objectName, recordId]).toEqual(['crm_task', 't1']);
  cleanup();
  return patch;
}

/** How the picker shows a stored `YYYY-MM-DD` in the default `en` locale. */
function formatShown(day: string): string {
  const [y, m, d] = day.split('-');
  return `${m}/${d}/${y}`;
}

/** Pick `day` in the Edit form's own `date` widget and return what it emits. */
async function formPick(day: string): Promise<unknown> {
  const FormDateWidget = getLazyFieldWidget('date');
  const onChange = vi.fn();
  const { container } = render(
    <React.Suspense fallback={null}>
      <FormDateWidget field={{ name: 'due_date', type: 'date' }} value={STORED} onChange={onChange} />
    </React.Suspense>,
  );
  // The form's `date` widget is the platform date picker (objectui#12642): a
  // text box that commits on blur, and an ISO day reads in every locale.
  const box = '[data-slot="date-picker"] input';
  await waitFor(() => expect(container.querySelector(box)).not.toBeNull());
  fireEvent.change(container.querySelector(box)!, { target: { value: day } });
  fireEvent.blur(container.querySelector(box)!);
  expect(onChange).toHaveBeenCalledTimes(1);
  cleanup();
  return onChange.mock.calls[0][0];
}

describe('inline `date` write, in the suite zone (objectui#12206)', () => {
  it('the highlights inline edit saves the picked day as the plain `YYYY-MM-DD`', async () => {
    expect(await saveInlinePick(PICKED)).toEqual({ due_date: PICKED });
  });
});

describe.runIf(DRIVEN)('inline `date` write east of UTC, at UTC+8 (objectui#12206)', () => {
  it('rig: the zone really moved', () => {
    process.env.TZ = EAST;
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(EAST);
    expect(new Date(INSTANT).getHours()).toBe(20);
  });

  it('the highlights inline edit saves `2026-10-16`, where it saved the 15th as `…T16:00:00.000Z`', async () => {
    process.env.TZ = EAST;
    expect(await saveInlinePick(PICKED)).toEqual({ due_date: PICKED });
  });

  it('control: the Edit form writes the same plain day', async () => {
    process.env.TZ = EAST;
    expect(await formPick(PICKED)).toBe(PICKED);
  });
});

describe.runIf(DRIVEN)('inline `date` write west of UTC, at UTC-5 (objectui#12206)', () => {
  it('rig: the zone really moved', () => {
    process.env.TZ = WEST;
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(WEST);
    expect(new Date(INSTANT).getHours()).toBe(7);
  });

  it('the highlights inline edit saves `2026-10-16`, where it sent the instant `…T05:00:00.000Z`', async () => {
    process.env.TZ = WEST;
    expect(await saveInlinePick(PICKED)).toEqual({ due_date: PICKED });
  });

  it('control: the Edit form writes the same plain day', async () => {
    process.env.TZ = WEST;
    expect(await formPick(PICKED)).toBe(PICKED);
  });
});
