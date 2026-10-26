/**
 * ObjectForm `groups` → `sections` normalization (#2545).
 *
 * `@objectstack/spec` FormViewSchema defines `groups` as a legacy alias of
 * `sections`, but ObjectForm only ever consumed `sections` — so a schema that
 * declared only `groups` silently rendered an ungrouped form. These tests lock
 * in the normalization (legacy shape: `title`→`label`,
 * `defaultCollapsed`→`collapsed`) and its precedence (`sections` wins).
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from '../ObjectForm';

registerAllFields();

function buildMockDataSource() {
  return {
    create: vi.fn(async (_obj: string, data: Record<string, unknown>) => ({ id: '1', ...data })),
    update: vi.fn(),
    delete: vi.fn(),
    findOne: vi.fn(),
    find: vi.fn(async () => ({ data: [], total: 0 })),
    getObjectSchema: vi.fn(async (name: string) => ({
      name,
      label: name,
      fields: {
        name: { type: 'text', label: 'Name' },
        email: { type: 'text', label: 'Email' },
      },
    })),
  } as any;
}

describe('ObjectForm groups → sections normalization (#2545)', () => {
  it('renders legacy groups-only schema as sections (was silently ignored)', async () => {
    render(
      <ObjectForm
        schema={{
          type: 'object-form',
          objectName: 'lead',
          mode: 'create',
          groups: [
            { title: 'Legacy Group Title', fields: ['name', 'email'] },
          ],
        } as any}
        dataSource={buildMockDataSource()}
      />,
    );

    // The legacy group's `title` must surface as a section label.
    expect(await screen.findByText('Legacy Group Title')).toBeTruthy();
  });

  it('prefers sections over groups when both are declared', async () => {
    render(
      <ObjectForm
        schema={{
          type: 'object-form',
          objectName: 'lead',
          mode: 'create',
          sections: [{ label: 'Canonical Section', fields: ['name'] }],
          groups: [{ title: 'Legacy Group', fields: ['email'] }],
        } as any}
        dataSource={buildMockDataSource()}
      />,
    );

    expect(await screen.findByText('Canonical Section')).toBeTruthy();
    expect(screen.queryByText('Legacy Group')).toBeNull();
  });
});
