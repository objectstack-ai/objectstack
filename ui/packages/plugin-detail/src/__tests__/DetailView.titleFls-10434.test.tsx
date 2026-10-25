/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `DetailView`'s header title is built from the record as the viewer may read
 * it (objectui#10434).
 *
 * The component's `gatedSchema` hides every field ROW the loaded policy denies
 * (`perms.checkField(objectName, field, 'read')`), but `resolveDisplayTitle`
 * read the record itself. So on a backend that does not strip denied fields,
 * a denied `titleFormat` token, name pointer or view `primaryField` printed in
 * the H1 while its row was hidden. Under the renderer-side FLS rulings
 * (objectui#7215 / objectui#7230) field-level security gates the OUTPUT, and
 * objectui#10373 already builds the lookup label and the picker title this
 * way.
 *
 * What is pinned, against the real `PermissionProvider` (not a stub):
 *
 *  - a denied field named by `titleFormat`, by the declared `nameField` or by
 *    the view's `primaryField` does not print, and the heading falls through
 *    to the next rung (here the derived `name` field);
 *  - DENIED READS AS ABSENT: for every template below, the heading on a
 *    non-stripping backend under the policy equals the heading a stripping
 *    backend (ObjectStack's `FieldMasker`) yields with no policy at all. That
 *    covers a partly denied template without pinning what it renders;
 *  - `id` is never judged: with every field denied, `id` included, the
 *    heading is the `Record #<id>` floor, not the "Details" fallback;
 *  - CONTROLS: a loaded policy that denies a field the title does not read
 *    leaves the heading unchanged, and with no provider mounted (`isLoaded`
 *    false) nothing is filtered.
 *
 * The fixture's derived title field is `name`, and the record carries it, so
 * a fall-through lands on a value, not on the floor.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup, act } from '@testing-library/react';
import * as React from 'react';
import { PermissionProvider } from '@object-ui/permissions';
import { DetailView } from '../DetailView';
import { __clearRecordEditableCache } from '../useRecordEditable';

const OBJECT = 'contact_10434';

const FIELDS = {
  name: { type: 'text', label: 'Name' },
  email: { type: 'text', label: 'Email' },
  phone: { type: 'text', label: 'Phone' },
};

const RECORD = { id: 'K1', name: 'Ada Lovelace', email: 'ada@example.com', phone: '555-0100' };

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

/**
 * Render a `detail-view` over one record, let both requests answer, and return
 * the heading's text. `strip` removes fields from the served row, as
 * ObjectStack's `FieldMasker` does; by default nothing is stripped.
 */
async function heading(
  objectSchema: Record<string, unknown>,
  wrap: Wrap,
  { strip = [], view = {} }: { strip?: string[]; view?: Record<string, unknown> } = {},
): Promise<string | null | undefined> {
  const served: Record<string, unknown> = { ...RECORD };
  for (const f of strip) delete served[f];
  const ds: any = {
    getObjectSchema: vi.fn(async () => ({ name: OBJECT, label: 'Contact', fields: FIELDS, ...objectSchema })),
    findOne: vi.fn(async () => served),
  };
  const { container } = render(
    wrap(
      <DetailView
        schema={{
          type: 'detail-view',
          objectName: OBJECT,
          resourceId: RECORD.id,
          fields: [{ name: 'phone', label: 'Phone' }],
          ...view,
        } as any}
        dataSource={ds}
      />,
    ),
  );
  await waitFor(() => {
    expect(ds.getObjectSchema).toHaveBeenCalled();
    expect(ds.findOne).toHaveBeenCalled();
  });
  await act(async () => {
    await ds.getObjectSchema.mock.results[0].value;
    await ds.findOne.mock.results[0].value;
  });
  // The heading renders once the record has loaded.
  await waitFor(() => expect(container.querySelector('h1')).not.toBeNull());
  const text = container.querySelector('h1')?.textContent;
  cleanup();
  return text;
}

beforeEach(() => {
  __clearRecordEditableCache();
  // `useRecordEditable` probes `POST /api/v1/security/explain`; happy-dom
  // would resolve that to a REAL socket (objectui#6640).
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ record: { visible: true } }) })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DetailView — the header title is built from the fields the viewer may read (#10434)', () => {
  it('a denied `titleFormat` token does not print; the heading falls through to the next rung', async () => {
    const h = await heading({ titleFormat: '{email}' }, denying('email'));
    expect(h).not.toContain('ada@example.com');
    expect(h).toBe('Ada Lovelace');
  });

  it('a denied declared `nameField` does not print; the heading falls through to the next rung', async () => {
    const h = await heading({ nameField: 'email' }, denying('email'));
    expect(h).not.toContain('ada@example.com');
    expect(h).toBe('Ada Lovelace');
  });

  it("a denied view `primaryField` does not print; the heading falls through to the next rung", async () => {
    const h = await heading({ titleFormat: '{name}' }, denying('email'), { view: { primaryField: 'email' } });
    expect(h).not.toContain('ada@example.com');
    expect(h).toBe('Ada Lovelace');
  });

  it.each([
    ['{email}'],
    ['{name} - {email}'],
    ['{email} - {phone}'],
    ['{name} ({email})'],
  ])('DENIED READS AS ABSENT — %s: the heading equals the stripping backend’s', async (titleFormat) => {
    const denied = await heading({ titleFormat }, denying('email'));
    const stripped = await heading({ titleFormat }, bare, { strip: ['email'] });
    expect(denied).not.toContain('ada@example.com');
    expect(denied).toBe(stripped);
  });

  it('`id` is never judged: with every field denied, `id` included, the heading is the id floor', async () => {
    const h = await heading({ titleFormat: '{email}' }, denying('id', 'name', 'email', 'phone'));
    expect(h).toBe('Record #K1');
  });

  it('CONTROL — a loaded policy denying a field the title does not read leaves the heading unchanged', async () => {
    expect(await heading({ titleFormat: '{email}' }, denying('phone'))).toBe('ada@example.com');
    expect(await heading({ nameField: 'email' }, denying('phone'))).toBe('ada@example.com');
  });

  it('CONTROL — with no provider mounted nothing is filtered, and the heading is the served row’s', async () => {
    expect(await heading({ titleFormat: '{email}' }, bare)).toBe('ada@example.com');
    expect(await heading({ titleFormat: '{name} - {email}' }, bare)).toBe('Ada Lovelace - ada@example.com');
  });
});
