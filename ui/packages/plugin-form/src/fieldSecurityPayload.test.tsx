/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A form never submits — nor offers — a field the CALLER may read but not edit
 * (objectui#10120).
 *
 * ## The defect, and the control that makes the absence readable
 *
 * The platform refuses a write to a field the caller's permission set marks
 * `editable: false`, and it cannot tell a round-trip of the value it just
 * served from an attempted write: a form echoing an UNCHANGED `score` back is
 * a 403 for the whole save, even when the user touched only a field they are
 * allowed to edit. The card's three REST controls isolate that to one
 * variable — `{actual_value}` succeeds, `{actual_value, …unchanged, no deny}`
 * succeeds, `{actual_value, score}` refuses — so "send less" is NOT the fix
 * and an assertion that only checked for a smaller payload would pass on a
 * form that had stopped sending anything. Every row below therefore carries
 * that lit control in the SAME payload: the unchanged, un-denied columns are
 * still on the wire.
 *
 * ## Why the filter rows submit with nothing changed (objectui#10156)
 *
 * An edit now writes only the fields that differ from the record the form
 * read. After a real edit, an unchanged `score` is kept off the wire by that
 * dirty diff alone — so a row that edited `actual_value` and then asserted
 * `score` absent would stay green with the field-level filter deleted. The
 * rows that read the FILTER therefore submit with nothing changed: a save with
 * no changes sends the full sanitized payload, the one edit route where the
 * filter is the only thing between `score` and the server, and where the lit
 * control above is still on the wire to be read.
 *
 * ## Why all three containers, and why they are pinned in one file
 *
 * `ObjectForm`, `ModalForm` and `DrawerForm` are one family reached from one
 * authored key (`formType`). Measured before the fix, on the same record with
 * the same permission set: the simple form and the modal withheld `score`,
 * the drawer sent it — and the drawer rendered it as a live input while the
 * other two rendered it disabled. Each container carried its own copy of the
 * strip and of the render gate, and the third had neither. The disagreement
 * between them IS the bug, so a change that re-opens any one of them has to
 * fail a row here.
 *
 * ## Distinct from objectui#10108
 *
 * That card was the form injecting a SERVER-MANAGED column (`owner_id`) it
 * never displayed — provenance, answerable from the object's own metadata,
 * pinned in `systemManagedPayload.test.tsx`. This one is a BUSINESS field the
 * caller may read but not edit — field-level security, a property of the
 * principal that no schema can answer. They meet at the same outbound filter,
 * which is why the verdict arrives there as a predicate rather than as more
 * schema.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

import { MePermissionsProvider } from '@object-ui/permissions';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from './ObjectForm';
import { ModalForm } from './ModalForm';
import { DrawerForm } from './DrawerForm';
import { sanitizeFormData } from './sanitize';

registerAllFields();
afterEach(cleanup);

/**
 * The card's object. `score` is an ordinary business column — nothing in this
 * metadata marks it unwritable, which is the whole point: only the CALLER's
 * permission set does. `adjusted_score` and `sheet` are `readonly` on the
 * field definition, the half the sanitizer already refused before this card.
 */
const OBJECT_SCHEMA = {
  name: 'kpi_entry_line',
  fields: {
    sheet: { type: 'master_detail', label: 'Sheet', reference: 'kpi_entry_sheet', readonly: true },
    indicator_name: { type: 'text', label: 'Indicator' },
    target_value: { type: 'number', label: 'Target' },
    weight: { type: 'number', label: 'Weight' },
    actual_value: { type: 'number', label: 'Actual' },
    score: { type: 'number', label: 'Score' },
    adjusted_score: { type: 'number', label: 'Adjusted', readonly: true },
  },
};

/** The record exactly as `dataSource.findOne` returns it. */
const RECORD = {
  id: 'LINE1',
  sheet: 'SHEET1',
  indicator_name: 'Revenue',
  target_value: 100,
  weight: 20,
  actual_value: 4000,
  score: 0,
  adjusted_score: 0,
};

/** `/me/permissions` for the card's `reporter`: may read `score`, not edit it. */
const REPORTER: any = {
  authenticated: true,
  userId: 'u-reporter',
  tenantId: null,
  roles: ['kpi_dept_reporter'],
  permissionSets: ['kpi_dept_reporter'],
  objects: { kpi_entry_line: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: false } },
  fields: {
    'kpi_entry_line.score': { readable: true, editable: false },
    'kpi_entry_line.adjusted_score': { readable: true, editable: false },
  },
};

/** The same principal with no field-level restriction anywhere. */
const UNRESTRICTED: any = { ...REPORTER, fields: {} };

/** The columns the reporter may read but not write. */
const DENIED = ['score', 'adjusted_score'] as const;
/**
 * The lit control: on the wire, unchanged, and carrying no deny. If these ever
 * vanish the payload assertions above them stop meaning "the FLS filter fired"
 * and start meaning "the form sent nothing".
 */
const UNCHANGED_ALLOWED = { indicator_name: 'Revenue', target_value: 100, weight: 20 };

const FIELDS = ['sheet', 'indicator_name', 'target_value', 'weight', 'actual_value', 'score', 'adjusted_score'];

const makeDataSource = () => {
  const update = vi.fn(async (_o: string, _id: string, d: any) => ({ id: 'LINE1', ...d }));
  return {
    update,
    ds: {
      getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
      findOne: vi.fn().mockResolvedValue(RECORD),
      find: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn(),
      update,
    } as any,
  };
};

const schemaFor = (formType?: 'modal' | 'drawer') => ({
  type: 'object-form',
  ...(formType ? { formType, open: true, showSubmit: true } : {}),
  objectName: 'kpi_entry_line',
  mode: 'edit',
  recordId: 'LINE1',
  fields: FIELDS,
}) as any;

/**
 * Type into the ONE field the caller is allowed to edit, then submit.
 *
 * Waits for the RECORD to be on screen, not merely for the input to exist
 * (objectui#10190): a container that paints its form before `findOne` lands
 * replaces the typed value when the record arrives, and the payload then
 * carries `RECORD.actual_value` instead of the edit — an order-dependent red
 * about load timing, not about field-level security.
 */
async function editAllowedFieldAndSubmit(root: HTMLElement, update: any) {
  const input = await waitFor(() => {
    const el = root.querySelector('input[name="actual_value"]') as HTMLInputElement | null;
    if (!el) throw new Error('actual_value not rendered');
    if (el.value !== String(RECORD.actual_value)) throw new Error('record not on screen yet');
    return el;
  });
  fireEvent.change(input, { target: { value: '5000' } });
  const form = root.querySelector('form');
  if (!form) throw new Error('no form element');
  fireEvent.submit(form);
  await waitFor(() => expect(update).toHaveBeenCalled());
  return update.mock.calls[0][2] as Record<string, unknown>;
}

/**
 * Submit with NOTHING changed, once the record is on screen, and return the
 * payload: the full sanitized set, which is what the filter rows read (see the
 * header for why an edited submit cannot carry them any more).
 */
async function submitUnchanged(root: HTMLElement, update: any) {
  await waitFor(() => {
    const el = root.querySelector('input[name="actual_value"]') as HTMLInputElement | null;
    if (!el) throw new Error('actual_value not rendered');
    if (el.value !== String(RECORD.actual_value)) throw new Error('record not on screen yet');
  });
  const form = root.querySelector('form');
  if (!form) throw new Error('no form element');
  fireEvent.submit(form);
  await waitFor(() => expect(update).toHaveBeenCalled());
  return update.mock.calls[0][2] as Record<string, unknown>;
}

/** The three containers, each mounted under the same principal. */
const CONTAINERS: Array<{
  name: string;
  mount: (perms: any, ds: any) => HTMLElement;
}> = [
  {
    name: 'ObjectForm (record page)',
    mount: (perms, ds) => render(
      <MePermissionsProvider initialPermissions={perms}>
        <ObjectForm schema={schemaFor()} dataSource={ds} />
      </MePermissionsProvider>,
    ).container,
  },
  {
    name: 'ModalForm (record edit dialog)',
    mount: (perms, ds) => render(
      <MePermissionsProvider initialPermissions={perms}>
        <ModalForm schema={schemaFor('modal')} dataSource={ds} />
      </MePermissionsProvider>,
    ).baseElement as HTMLElement,
  },
  {
    name: 'DrawerForm',
    mount: (perms, ds) => render(
      <MePermissionsProvider initialPermissions={perms}>
        <DrawerForm schema={schemaFor('drawer')} dataSource={ds} />
      </MePermissionsProvider>,
    ).baseElement as HTMLElement,
  },
];

describe('field-level security — the form neither sends nor offers a refused field (objectui#10120)', () => {
  describe.each(CONTAINERS)('$name', ({ mount }) => {
    it('omits the FLS-refused field from the PATCH while every un-denied one still goes', async () => {
      const { ds, update } = makeDataSource();
      const payload = await submitUnchanged(mount(REPORTER, ds), update);

      for (const key of DENIED) expect(payload).not.toHaveProperty(key);
      // The card's lit control reached the wire in the same payload: unchanged
      // columns with no deny on them are NOT what makes the save fail, so the
      // fix is not "send less".
      expect(payload).toMatchObject({ actual_value: RECORD.actual_value, ...UNCHANGED_ALLOWED });
    });

    it('an edit writes the edited field alone — never the FLS-refused one', async () => {
      const { ds, update } = makeDataSource();
      const payload = await editAllowedFieldAndSubmit(mount(REPORTER, ds), update);
      expect(payload).toEqual({ actual_value: 5000 });
    });

    it('renders the FLS-refused field non-editable, so the refusal is never invited', async () => {
      const { ds } = makeDataSource();
      const root = mount(REPORTER, ds);
      await waitFor(() => {
        const el = root.querySelector('input[name="actual_value"]') as HTMLInputElement | null;
        if (!el) throw new Error('form not ready');
        expect(el.disabled).toBe(false);
      });
      const score = root.querySelector('input[name="score"]') as HTMLInputElement | null;
      // Readable, so it is still SHOWN — the card's role may read `score`.
      expect(score).not.toBeNull();
      expect(score!.disabled).toBe(true);
    });

    it('CONTROL — a fully-permitted caller\'s form is unchanged: every column goes, nothing is disabled', async () => {
      const { ds, update } = makeDataSource();
      const root = mount(UNRESTRICTED, ds);
      const score = await waitFor(() => {
        const el = root.querySelector('input[name="score"]') as HTMLInputElement | null;
        if (!el) throw new Error('score not rendered');
        return el;
      });
      expect(score.disabled).toBe(false);
      // The same route as the filter row above; only the principal differs.
      const payload = await submitUnchanged(root, update);
      expect(payload).toHaveProperty('score');
      expect(payload).toMatchObject({ actual_value: RECORD.actual_value, ...UNCHANGED_ALLOWED });
      // `adjusted_score` and `sheet` stay absent for EVERY caller: they are
      // `readonly` on the field definition, which this card does not move.
      expect(payload).not.toHaveProperty('adjusted_score');
      expect(payload).not.toHaveProperty('sheet');
    });
  });

  describe('the filter itself', () => {
    it('drops what the predicate refuses and keeps everything it allows', () => {
      const out = sanitizeFormData(
        { indicator_name: 'Revenue', actual_value: 5000, score: 0 },
        OBJECT_SCHEMA,
        { canEdit: (name) => name !== 'score' },
      );
      expect(out).toEqual({ indicator_name: 'Revenue', actual_value: 5000 });
    });

    it('is a no-op when no predicate is supplied, so an unpermissioned surface is byte-identical', () => {
      const data = { indicator_name: 'Revenue', actual_value: 5000, score: 0 };
      expect(sanitizeFormData(data, OBJECT_SCHEMA)).toEqual(data);
    });

    it('applies with no object schema at all — an inline form passes null and its caller is still gated', () => {
      const out = sanitizeFormData(
        { actual_value: 5000, score: 0 },
        null,
        { canEdit: (name) => name !== 'score' },
      );
      expect(out).toEqual({ actual_value: 5000 });
    });
  });
});
