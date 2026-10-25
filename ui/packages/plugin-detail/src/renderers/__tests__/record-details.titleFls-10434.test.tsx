/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record:details` builds its title, and picks the row that duplicates it,
 * from the record as the viewer may read it (objectui#10434).
 *
 * ## Two halves, one row
 *
 * With `showHeader: true` the block draws `DetailView`'s own header, whose H1
 * is built from the record with the fields the loaded policy denies removed
 * (`DetailView.titleFls-10434.test.tsx` pins that half on its own). The block
 * also hides the ONE body row that repeats the H1 (Phase P.0), and that
 * dedupe ran on the raw row. So when the policy denied the field the title
 * would have printed, the H1 fell through to the next rung, `name`, while the
 * dedupe still matched the denied field: the `name` row printed directly
 * under an H1 showing the same value. The dedupe now reads the same gated
 * row, so it hides the row the H1 shows.
 *
 * A denied field's own row is hidden by `DetailView`'s field gate whichever
 * row the dedupe picks, so no pin here reads a denied value in the body.
 *
 * ## What is pinned, against the real `PermissionProvider`
 *
 *  - WITH THE BLOCK'S OWN HEADER: a denied `titleFormat` token (alone or in a
 *    composite) or a denied declared `nameField` does not print in the H1,
 *    the H1 falls through to `name`, and the `name` value prints once, in the
 *    H1, not again as a row beneath it;
 *  - DENIED READS AS ABSENT, header or not: the body the block renders over a
 *    non-stripping backend under the policy is byte-identical to the body it
 *    renders when the backend strips the denied field, as ObjectStack's
 *    `FieldMasker` does;
 *  - CONTROLS: a loaded policy denying a field the title does not read, and
 *    no provider at all, leave the H1 and the dedupe as they were.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import * as React from 'react';
import { PermissionProvider } from '@object-ui/permissions';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';
import { RecordDetailsRenderer } from '../record-details';

const OBJECT = 'contact_10434';

const FIELDS = {
  name: { type: 'text', label: 'Name' },
  email: { type: 'text', label: 'Email' },
  phone: { type: 'text', label: 'Phone' },
};

const BODY_FIELDS = ['name', 'email', 'phone'];

const RECORD = { id: 'K1', name: 'Ada Lovelace', email: 'ada@example.com', phone: '555-0100' };

/**
 * Pinned, for the reason `record-details.dedupeEmptinessTrims-8350.test.tsx`
 * states: `DetailSection`'s auto-hide heuristic depends on the viewport. On
 * the desktop branch no fixture here reaches its row minimum, so a row can
 * only be missing because the dedupe or the field gate dropped it.
 */
const DESKTOP_WIDTH = 1280;

type Wrap = (node: React.ReactElement) => React.ReactElement;
const bare: Wrap = (node) => node;

/** The real role-based provider, denying the named fields of the object to `viewer`. */
function denying(...fields: string[]): Wrap {
  const permissions = [
    {
      object: OBJECT,
      roles: {
        viewer: { actions: ['read'], fieldPermissions: fields.map((field) => ({ field, read: false })) },
      },
    },
  ];
  const userRoles = ['viewer'];
  return (node) => (
    <PermissionProvider roles={[]} userRoles={userRoles} permissions={permissions as never}>
      {node}
    </PermissionProvider>
  );
}

/** How many times `needle` occurs in `haystack`. */
const occurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

/**
 * Render the block over one record and read its H1 (when it draws one) and
 * its whole text. `strip` removes fields from the row, as a stripping backend
 * serves it.
 */
async function renderBlock(
  objectSchema: Record<string, unknown>,
  wrap: Wrap,
  { strip = [], showHeader = false }: { strip?: string[]; showHeader?: boolean } = {},
): Promise<{ h1: string | null | undefined; text: string }> {
  const schema = { name: OBJECT, label: 'Contact', fields: FIELDS, ...objectSchema };
  const record: Record<string, unknown> = { ...RECORD };
  for (const f of strip) delete record[f];
  // `DetailView` reads the object schema through the record's data source.
  const ds: any = { getObjectSchema: vi.fn(async () => schema) };
  const { container } = render(
    wrap(
      <ActionProvider>
        <RecordContextProvider
          objectName={OBJECT}
          recordId={RECORD.id}
          data={record}
          objectSchema={schema}
          dataSource={ds}
        >
          <div data-testid="block">
            <RecordDetailsRenderer schema={{ fields: BODY_FIELDS, showHeader } as never} />
          </div>
        </RecordContextProvider>
      </ActionProvider>,
    ),
  );
  // `titleFormat` and `nameField` reach the H1 through the fetched object
  // schema, so let that request answer before anything is read.
  await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
  await act(async () => {
    await ds.getObjectSchema.mock.results[0].value;
  });
  // The body has rendered once a readable value is on screen. Which one
  // depends on the row the dedupe hid, so either counts.
  await waitFor(() => expect(container.textContent).toMatch(/Ada Lovelace|555-0100/));
  const block = container.querySelector('[data-testid="block"]');
  if (showHeader) expect(block?.querySelector('h1')).not.toBeNull();
  const out = { h1: block?.querySelector('h1')?.textContent, text: block?.textContent ?? '' };
  cleanup();
  return out;
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: DESKTOP_WIDTH });
  // `useRecordEditable` probes `POST /api/v1/security/explain`; happy-dom
  // would resolve that to a REAL socket (objectui#6640).
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

describe('record:details — the title and its dedupe read the fields the viewer may read (#10434)', () => {
  it.each([
    ['a denied `titleFormat` token', { titleFormat: '{email}' }],
    ['a composite `titleFormat` with a denied token', { titleFormat: '{name} - {email}' }],
    ['a denied declared `nameField`', { nameField: 'email' }],
  ])('WITH ITS OWN HEADER — %s: the H1 falls through to `name`, printed once', async (_label, objectSchema) => {
    const { h1, text } = await renderBlock(objectSchema, denying('email'), { showHeader: true });
    expect(h1).toBe('Ada Lovelace');
    expect(text).not.toContain('ada@example.com');
    // Once, in the H1: the `name` row is the H1's duplicate and is not drawn.
    expect(occurrences(text, 'Ada Lovelace')).toBe(1);
    expect(text).toContain('555-0100'); // CONTROL: the body rendered at all
  });

  it.each([
    ['{email}', false],
    ['{name} - {email}', false],
    ['{email} - {phone}', false],
    ['{email}', true],
    ['{name} - {email}', true],
  ])('DENIED READS AS ABSENT — `%s` (own header: %s): the block equals the stripping backend’s', async (titleFormat, showHeader) => {
    const denied = await renderBlock({ titleFormat }, denying('email'), { showHeader });
    const stripped = await renderBlock({ titleFormat }, denying('email'), { showHeader, strip: ['email'] });
    expect(denied.text).not.toContain('ada@example.com');
    expect(denied.text).toBe(stripped.text);
  });

  it('CONTROL — a loaded policy denying a field the title does not read changes neither the H1 nor the dedupe', async () => {
    const { h1, text } = await renderBlock({ titleFormat: '{email}' }, denying('phone'), { showHeader: true });
    expect(h1).toBe('ada@example.com');
    expect(occurrences(text, 'ada@example.com')).toBe(1);
    expect(text).toContain('Ada Lovelace');
  });

  it('CONTROL — with no provider nothing is filtered: the template is the H1 and its row is the one hidden', async () => {
    const { h1, text } = await renderBlock({ titleFormat: '{email}' }, bare, { showHeader: true });
    expect(h1).toBe('ada@example.com');
    expect(occurrences(text, 'ada@example.com')).toBe(1);
    expect(text).toContain('Ada Lovelace');
  });
});
