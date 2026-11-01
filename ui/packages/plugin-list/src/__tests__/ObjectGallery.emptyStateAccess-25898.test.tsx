/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#25898 — a standalone gallery's empty state says what the caller
 * may see, through the same `ListEmptyState` decision `ListView` makes.
 *
 * A gallery that issues its own query, for a caller known not to hold the
 * create grant, reads "No records you can see" instead of inviting them to
 * create the first record; its own filter naming the signed-in user reads
 * "Nothing of yours yet". The zh row reads the built-in pack, so the new keys
 * resolve there and not to their English defaults.
 *
 * SUITE DIRECTION, predicted before running: the read-only, "my" and zh rows
 * are RED against the base commit; the create-grant control is green in both.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { SchemaRendererProvider, FilterScopeProvider } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsResponse, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';
import type { DataSource, ObjectGallerySchema } from '@object-ui/types';
import { ObjectGallery } from '../ObjectGallery';

afterEach(cleanup);

const OBJECT = 'crm_case';
const USER = 'u-rep';
const READ_ONLY = { allowCreate: false, allowRead: true, allowEdit: false, allowDelete: false };
const FULL = { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true };

const envelope = (bits: Record<string, boolean>): MePermissionsAuthenticatedResponse => ({
  authenticated: true,
  userId: USER,
  tenantId: null,
  hasAnyQueue: false,
  positions: ['member'],
  permissionSets: ['member'],
  objects: { [OBJECT]: bits },
  fields: {},
});

const emptySource = () => ({
  find: vi.fn().mockResolvedValue([]),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({ name: OBJECT, fields: { name: { type: 'text', label: 'Name' } } }),
});

async function galleryEmptyState(
  schema: Omit<ObjectGallerySchema, 'type'>,
  bits: Record<string, boolean>,
  { zh = false }: { zh?: boolean } = {},
): Promise<HTMLElement> {
  const ds = emptySource();
  let tree: React.ReactNode = (
    <MePermissionsProvider initialPermissions={envelope(bits)}>
      <FilterScopeProvider currentUserId={USER}>
        <SchemaRendererProvider dataSource={ds as unknown as DataSource}>
          <ObjectGallery schema={{ type: 'object-gallery', ...schema }} />
        </SchemaRendererProvider>
      </FilterScopeProvider>
    </MePermissionsProvider>
  );
  if (zh) {
    tree = (
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
        {tree}
      </I18nProvider>
    );
  }
  const { container } = render(<>{tree}</>);
  await waitFor(() => expect(container.querySelector('[data-testid="empty-state"]')).not.toBeNull());
  return container.querySelector('[data-testid="empty-state"]') as HTMLElement;
}

const heading = (state: Element) => state.querySelector('h3')?.textContent ?? null;

describe('standalone gallery empty state — no access vs no records (objectstack#25898)', () => {
  it('a caller without the create grant: "No records you can see"', async () => {
    const state = await galleryEmptyState({ objectName: OBJECT }, READ_ONLY);
    expect(heading(state)).toBe('No records you can see');
    expect(state.textContent).not.toMatch(/Create your first record/);
  });

  it('CONTROL: a caller with the create grant: the first-run copy', async () => {
    const state = await galleryEmptyState({ objectName: OBJECT }, FULL);
    expect(heading(state)).toBe('Nothing here yet');
  });

  it('its own filter naming the signed-in user: "Nothing of yours yet"', async () => {
    const state = await galleryEmptyState(
      { objectName: OBJECT, filter: [['owner', '=', '{current_user_id}']] } as Omit<ObjectGallerySchema, 'type'>,
      FULL,
    );
    expect(heading(state)).toBe('Nothing of yours yet');
  });

  it('under the zh pack the new keys resolve to the pack', async () => {
    const state = await galleryEmptyState({ objectName: OBJECT }, READ_ONLY, { zh: true });
    expect(heading(state)).toBe('没有你可查看的记录');
  });
});
