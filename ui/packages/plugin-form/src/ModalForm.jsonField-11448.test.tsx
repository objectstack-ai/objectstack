/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A `json` field edits as JSON in the record Edit dialog (objectui#11448).
 *
 * Driven through the dialog the console mounts for More actions > Edit — the
 * global `ModalForm`, whose body is a real `SchemaRenderer` form — with the
 * real registered widgets and a click on the real submit button. The click
 * matters: `fireEvent.submit` dispatches the submit event directly and skips
 * the browser's constraint validation, which is the channel the refusal below
 * travels on, so a pin that submitted that way could not see the refusal.
 *
 * ## What the base commit did
 *
 * `json` resolved to the code editor (`field:code`), which shows `value || ''`
 * and emits the textarea's text unparsed. Measured on `990a2d616` through this
 * same dialog: the box read `[object Object]`, an edit to `{"a":1}` was saved as
 * the STRING `'{"a":1}'`, and unparsable text was saved as a string too.
 *
 * The card's open question — does a save that never touches the field send
 * `[object Object]`? — measured NO on the base commit as well: with another
 * field edited the update omits `f_json`, and with nothing edited it carries
 * the stored object unchanged. That answer is pinned below, so a future face
 * that echoes its display text back into the form fails here.
 *
 * ## The control
 *
 * A `code` field in the same dialog round-trips its text, including text that
 * happens to be valid JSON: `code` keeps its raw-text semantics.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, fireEvent, screen, act } from '@testing-library/react';
import React from 'react';

import { registerAllFields } from '@object-ui/fields';
import { ModalForm } from './ModalForm';

registerAllFields();

const STORED = {
  id: 'z1',
  name: 'Specimen — Full',
  f_json: { nested: { k: 'v' }, list: [1, 2, 3] },
  f_composite: { a: 1 },
  f_code: 'x = 1',
};

function makeDS() {
  return {
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'field_zoo',
      fields: {
        name: { type: 'text', label: 'Name' },
        f_json: { type: 'json', label: 'JSON' },
        f_composite: { type: 'composite', label: 'Composite' },
        f_code: { type: 'code', label: 'Code' },
      },
    }),
    findOne: vi.fn().mockResolvedValue({ ...STORED }),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(async (_o: string, d: any) => ({ id: 'n1', ...d })),
    update: vi.fn(async (_o: string, _id: string, d: any) => ({ ...STORED, ...d })),
  };
}

function openEditDialog() {
  const ds = makeDS();
  render(
    <ModalForm
      schema={{
        type: 'object-form',
        formType: 'modal',
        objectName: 'field_zoo',
        mode: 'edit',
        recordId: 'z1',
        open: true,
      } as any}
      dataSource={ds as any}
    />,
  );
  return ds;
}

const box = (name: string) =>
  waitFor(() => {
    const el = document.querySelector(`textarea[name="${name}"]`) as HTMLTextAreaElement | null;
    if (!el) throw new Error(`${name} not ready`);
    return el;
  });

const type = async (el: HTMLElement, text: string) => {
  await act(async () => {
    fireEvent.change(el, { target: { value: text } });
  });
};

/** Click the dialog's own submit button, then let the save settle. */
const clickUpdate = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
};

/** Everything the field row draws, so a diagnostic the field renders is seen. */
function rowText(name: string): string {
  const row = document.querySelector(`[data-field="${name}"]`);
  return (row?.textContent || '').trim();
}

const payloads = (ds: ReturnType<typeof makeDS>) => ds.update.mock.calls.map((call) => call[2]);

describe('a json field in the record Edit dialog (objectui#11448)', () => {
  it('shows the stored object as pretty-printed JSON, never [object Object]', async () => {
    openEditDialog();
    const json = await box('f_json');
    await waitFor(() => expect(json.value).toBe(JSON.stringify(STORED.f_json, null, 2)));
    expect(json.value).not.toContain('[object Object]');
  });

  it('saves an edit to {"a":1} as the object { a: 1 }, not the string', async () => {
    const ds = openEditDialog();
    await type(await box('f_json'), '{"a":1}');
    await clickUpdate();
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(payloads(ds)[0].f_json).toEqual({ a: 1 });
    expect(typeof payloads(ds)[0].f_json).toBe('object');
  });

  it('keeps every keystroke of a draft typed one character at a time', async () => {
    const ds = openEditDialog();
    const json = await box('f_json');
    for (const draft of ['{', '{"a"', '{"a":', '{"a":1', '{"a":1}']) {
      await type(json, draft);
      expect(json.value, `the box lost the draft ${draft}`).toBe(draft);
    }
    await clickUpdate();
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(payloads(ds)[0].f_json).toEqual({ a: 1 });
  });

  it('an untouched save never writes the field as text (the card\'s open question)', async () => {
    // Another field edited: the edit diff leaves the untouched json field out.
    const ds = openEditDialog();
    await box('f_json');
    await type(document.querySelector('input[name="name"]') as HTMLElement, 'Renamed');
    await clickUpdate();
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(payloads(ds)[0]).toEqual({ name: 'Renamed' });
  });

  it('an untouched save with nothing edited carries the stored object unchanged', async () => {
    const ds = openEditDialog();
    await box('f_json');
    await clickUpdate();
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    const sent = payloads(ds)[0];
    // Present or absent are both safe; a string in this slot is the defect.
    if ('f_json' in sent) expect(sent.f_json).toEqual(STORED.f_json);
    expect(typeof sent.f_json === 'string').toBe(false);
  });

  it('refuses unparsable text with a message, and sends nothing while it stands', async () => {
    const ds = openEditDialog();
    const json = await box('f_json');
    await type(json, '{"a":');

    expect(json.value).toBe('{"a":');
    expect(json.getAttribute('aria-invalid')).toBe('true');
    expect(rowText('f_json')).toContain('Invalid JSON');

    await clickUpdate();
    expect(ds.update).not.toHaveBeenCalled();

    // The same click path is live: correct the text and the save goes through.
    await type(json, '{"a":2}');
    expect(rowText('f_json')).not.toContain('Invalid JSON');
    await clickUpdate();
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(payloads(ds)[0].f_json).toEqual({ a: 2 });
  });

  it('does not send the last valid draft when the current one is unparsable', async () => {
    const ds = openEditDialog();
    const json = await box('f_json');
    await type(json, '{"a":1}');
    await type(json, '{"a":1');
    expect(json.value).toBe('{"a":1');
    await clickUpdate();
    expect(ds.update).not.toHaveBeenCalled();
  });
});

describe('the shared JSON editor, as `composite` reaches it (objectui#11448)', () => {
  // `json` now resolves to the editor `object` / `composite` / `record` already
  // used, so the draft and refusal fixes reach them too. On the base commit this
  // exact sequence reverted the box to `{ "a": 2 }` while still saying "Invalid
  // JSON", and the click saved `{ a: 2 }`.
  it('holds an unparsable draft and blocks the save instead of sending the stale value', async () => {
    const ds = openEditDialog();
    const composite = await box('f_composite');
    await type(composite, '{"a":2}');
    await type(composite, '{"a":2');
    expect(composite.value).toBe('{"a":2');
    expect(rowText('f_composite')).toContain('Invalid JSON');
    await clickUpdate();
    expect(ds.update).not.toHaveBeenCalled();
  });
});

describe('the control: a code field keeps raw-text semantics (objectui#11448)', () => {
  it('round-trips its text, including text that parses as JSON', async () => {
    const ds = openEditDialog();
    const code = await box('f_code');
    expect(code.value).toBe('x = 1');
    await type(code, '{"a":1}');
    await clickUpdate();
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(payloads(ds)[0]).toEqual({ f_code: '{"a":1}' });
  });
});
