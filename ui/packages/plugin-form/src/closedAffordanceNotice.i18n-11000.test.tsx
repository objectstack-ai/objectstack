/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The closed-affordance notice speaks the session locale and names the object
 * by its localized label (objectui#11000).
 *
 * The notice resolves through the i18n catalogue (`form.noPermissionToCreate` /
 * `form.noPermissionToEdit`) and names the object the way the console does
 * (objectstack#30390): the label the server serves, already translated for
 * the session, else the app's translation of it, else its name. A `zh`
 * session's definitions serve the `zh` answer. The English defaults and the full
 * layout × principal table are `closedAffordanceNotice-11000.test.tsx`; this
 * file is kept apart because a mounted provider leaves react-i18next's global
 * instance behind.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { MePermissionsProvider } from '@object-ui/permissions';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from './ObjectForm';

registerAllFields();
afterEach(() => cleanup());

const FIELDS = { customer: { type: 'text', label: 'Customer' } };

/** A member whose effective API operation set on `object` is `apiOperations`. */
const member = (object: string, apiOperations: string[]): any => ({
  authenticated: true,
  userId: 'u-1',
  tenantId: null,
  roles: ['member'],
  permissionSets: ['member'],
  objects: {
    [object]: {
      allowCreate: apiOperations.includes('create'),
      allowRead: true,
      allowEdit: apiOperations.includes('update'),
      allowDelete: false,
      apiOperations,
    },
  },
  fields: {},
});

const makeDS = (name: string, label?: string) => ({
  getObjectSchema: vi.fn().mockResolvedValue({ name, label, fields: FIELDS }),
  findOne: vi.fn().mockResolvedValue({ id: 'r1', customer: 'Acme' }),
  find: vi.fn().mockResolvedValue({ data: [] }),
  create: vi.fn(),
  update: vi.fn(),
});

/** An app bundle translating `invoice`'s label, the convention key `useObjectLabel` reads. */
const APP_RESOURCES = { zh: { showcase: { objects: { invoice: { label: '发票' } } } } };

function mount(schema: Record<string, unknown>, principal: any, ds: ReturnType<typeof makeDS>) {
  return render(
    <I18nProvider
      config={{ defaultLanguage: 'zh', detectBrowserLanguage: false, resources: APP_RESOURCES }}
    >
      <MePermissionsProvider initialPermissions={principal}>
        <ObjectForm schema={{ type: 'object-form', ...schema } as any} dataSource={ds as any} />
      </MePermissionsProvider>
    </I18nProvider>,
  );
}

describe('The closed-affordance notice in zh (objectui#11000)', () => {
  it('wizard, member without create: the notice names the translated object label, Next (下一步) is disabled', async () => {
    mount(
      {
        objectName: 'invoice',
        formType: 'wizard',
        mode: 'create',
        sections: [
          { name: 'a', label: 'A', fields: ['customer'] },
          { name: 'b', label: 'B', fields: [] },
        ],
      },
      member('invoice', ['read', 'update']),
      makeDS('invoice', '发票'),
    );

    const notice = await screen.findByText('您没有创建发票的权限，字段均为只读。');
    expect(notice.closest('[role="status"]')).toBeTruthy();
    const next = screen.getByRole('button', { name: '下一步' }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });

  it('simple form, member without edit: the notice names edit and the declared label when no translation is loaded', async () => {
    mount(
      { objectName: 'project', mode: 'edit', recordId: 'r1', fields: ['customer'] },
      member('project', ['create', 'read']),
      makeDS('project', '项目'),
    );

    await screen.findByText('您没有编辑项目的权限，字段均为只读。');
    await waitFor(() => {
      const input = document.querySelector('input[name="customer"]') as HTMLInputElement | null;
      expect(input?.disabled).toBe(true);
    });
  });
});

/**
 * objectstack#30390 — a renamed object is named as served, never by the
 * packaged catalog string. Directions, written before the run: the renamed
 * cell RED before the change (`发票`), GREEN after; the control GREEN on both.
 */
describe('The closed-affordance notice names a served object as served (objectstack#30390)', () => {
  it('zh: a renamed object is named by its served label, not the packaged translation', async () => {
    mount(
      { objectName: 'invoice', mode: 'edit', recordId: 'r1', fields: ['customer'] },
      member('invoice', ['create', 'read']),
      makeDS('invoice', '账单'),
    );
    await screen.findByText('您没有编辑账单的权限，字段均为只读。');
  });

  it('zh: control — an object served with no label is named by the app bundle', async () => {
    mount(
      { objectName: 'invoice', mode: 'edit', recordId: 'r1', fields: ['customer'] },
      member('invoice', ['create', 'read']),
      makeDS('invoice'),
    );
    await screen.findByText('您没有编辑发票的权限，字段均为只读。');
  });
});
