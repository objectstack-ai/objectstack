/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * A form view section naming a field the object does not have draws NOTHING
 * for it (objectstack#29021).
 *
 * ## What went wrong
 *
 * `fromObjectSchema` (`sectionFields.ts`) answered a name the object does not
 * declare with a bare `{ name, label: name, type: 'input' }` stub. Every arm
 * that builds a section without a field pool — `tabbed`, `wizard`, `drawer`,
 * `modal` — drew it as a live text box labelled with the raw name, so a form
 * view naming a mistyped or deleted field showed the user an editable box.
 * Whatever was typed there never reached the record: the save writes only
 * declared fields, so it was dropped behind a 200 with no error. The lint
 * already calls such an entry `FORM_FIELD_UNKNOWN` — "silently skipped and
 * never renders on the form" — and the default arm's pool already dropped it;
 * these four arms disagreed with both.
 *
 * ## The rows
 *
 * Per arm, on an EDIT form of a real record, a section listing a known field
 * beside an unknown one in BOTH named shapes (a bare name and the spec
 * `{ field }` object):
 *
 *   1. only the known field is drawn — no control, no label for the unknown
 *      name (the known field's own input is the non-vacuity control);
 *   2. editing the known field and saving sends no key for the unknown name,
 *      and the known field's edit does arrive.
 *
 * A section whose EVERY member is unknown builds no field; what each arm does
 * with an empty section is its own existing behaviour and not re-pinned here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, fireEvent, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectFormContainer } from '../ObjectFormContainer';
import '../index';

vi.mock('@object-ui/components/ui/sonner', async (orig) => {
  const actual = await (orig as any)();
  return { ...actual, toast: { ...actual.toast, success: vi.fn(), error: vi.fn() } };
});

registerAllFields();

const TASK_OBJECT = {
  name: 'task',
  fields: {
    title: { type: 'text', label: 'Title' },
    notes: { type: 'text', label: 'Notes' },
  },
};

const RECORD = { id: 't1', title: 'Old title', notes: 'kept' };

/** The four arms that build a section with no field pool. */
const ARMS = ['tabbed', 'wizard', 'drawer', 'modal'] as const;

let dataSource: any;

beforeEach(() => {
  dataSource = {
    getObjectSchema: vi.fn().mockResolvedValue(TASK_OBJECT),
    find: vi.fn().mockResolvedValue({ data: [] }),
    findOne: vi.fn().mockResolvedValue({ ...RECORD }),
    create: vi.fn().mockResolvedValue({ id: 't1' }),
    update: vi.fn().mockResolvedValue({ ...RECORD }),
    delete: vi.fn(),
    bulk: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderArm(formType: (typeof ARMS)[number]) {
  render(
    <ObjectFormContainer
      schema={{
        type: 'object-form',
        objectName: 'task',
        mode: 'edit',
        recordId: 't1',
        formType,
        open: true,
        submitText: 'Save Now',
        sections: [
          {
            name: 'overview',
            label: 'Overview',
            fields: ['title', 'no_such_field', { field: 'other_ghost', label: 'Other ghost' }],
          },
        ],
      } as any}
      dataSource={dataSource}
    />,
  );
}

async function knownInput(): Promise<HTMLInputElement> {
  return waitFor(() => {
    const el = document.querySelector('input[name="title"]') as HTMLInputElement | null;
    if (!el) throw new Error('the known field never rendered — the absences below would pass vacuously');
    expect(el.value).toBe('Old title');
    return el;
  });
}

describe.each(ARMS)('formType `%s`: a section member the object does not have', (formType) => {
  it('draws only the known field — no control and no label for the unknown names', async () => {
    renderArm(formType);
    await knownInput();

    expect(document.querySelector('[name="no_such_field"]')).toBeNull();
    expect(document.querySelector('[name="other_ghost"]')).toBeNull();
    expect(screen.queryByText('no_such_field')).toBeNull();
    expect(screen.queryByText('Other ghost')).toBeNull();
  });

  it('editing and saving the record sends no key for the unknown names', async () => {
    renderArm(formType);
    const title = await knownInput();

    fireEvent.change(title, { target: { value: 'New title' } });
    fireEvent.click(screen.getByRole('button', { name: /save now/i }));

    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));
    const [objectName, id, payload] = dataSource.update.mock.calls[0];
    expect(objectName).toBe('task');
    expect(id).toBe('t1');
    expect(payload).toMatchObject({ title: 'New title' });
    expect(payload).not.toHaveProperty('no_such_field');
    expect(payload).not.toHaveProperty('other_ghost');
  });
});
