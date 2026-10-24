/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DetailView } from '../DetailView';
import { PermissionProvider } from '@object-ui/permissions';
import type { DetailViewSchema } from '@object-ui/types';
import type { ObjectPermissionConfig, RoleDefinition } from '@object-ui/types';

/**
 * Field-level read deny — negative tests.
 *
 * These act as the automated counterpart to the manual repro called out
 * in the Sprint 3-A "Known limitations" section. We mount DetailView
 * inside a PermissionProvider that explicitly denies read access to a
 * single field, then assert that field never reaches the DOM in any of
 * the surfaces that previously leaked it (sections, top-level fields,
 * summary chips). Tests run against a tiny in-memory permission config
 * so they're independent of the /auth/me endpoint.
 */

// Every grant this role uses comes from the `ObjectPermissionConfig` below —
// the only wired home for role grants. (`RoleDefinition` used to require a
// second, never-read `permissions` array; retired in objectui#4288.)
const roles: RoleDefinition[] = [
  { name: 'restricted', label: 'Restricted', description: 'denies one field' },
];

function makeRestrictedConfig(deniedField: string): ObjectPermissionConfig {
  return {
    object: 'account',
    roles: {
      restricted: {
        // `actions` is the declared channel for a role's object-level grants and
        // the only one `evaluatePermission` reads. This entry used to spell them
        // `objectPermissions: { read: true, create: false, … }` beside a
        // `roleName` echo of its own map key — neither key exists on
        // `ObjectPermissionConfig['roles'][string]`, so both were inert, and the
        // role in fact granted nothing at all. The rewrite says what the old
        // shape meant: read allowed, no writes.
        //
        // No assertion in this file moves as a result, which is the point worth
        // recording rather than hiding: the field gate below runs through
        // `checkField`, which reads `fieldPermissions` directly and never
        // consults `actions`, so these cases were testing what they claim to
        // test even while the object grant was empty. The DetailView write gate
        // (`perms.can(object,'update'|'delete')`) reads `actions` and stays
        // false either way — 'update'/'delete' are absent before and after.
        actions: ['read'],
        fieldPermissions: [{ field: deniedField, read: false, write: false }],
      },
    },
  };
}

function renderWithPerms(ui: React.ReactElement, deniedField: string) {
  return render(
    <PermissionProvider
      roles={roles}
      permissions={[makeRestrictedConfig(deniedField)]}
      userRoles={['restricted']}
    >
      {ui}
    </PermissionProvider>,
  );
}

const baseSchema: DetailViewSchema = {
  type: 'detail-view',
  title: 'Account',
  objectName: 'account',
  data: {
    id: 'A1',
    name: 'Acme Co',
    annual_revenue: 1_000_000,
    industry: 'Tech',
  },
  sections: [
    {
      title: 'Basics',
      fields: [
        { name: 'name', label: 'Name' },
        { name: 'industry', label: 'Industry' },
        { name: 'annual_revenue', label: 'Annual Revenue' },
      ],
    },
  ],
};

describe('DetailView – field-level permission gating (negative)', () => {
  it('omits a section field the current user cannot read', () => {
    renderWithPerms(<DetailView schema={baseSchema} />, 'annual_revenue');

    expect(screen.queryByText('Annual Revenue')).not.toBeInTheDocument();
    // Sibling fields still render — we only deny the one.
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Industry')).toBeInTheDocument();
  });

  it('does not leak the denied value into the rendered DOM', () => {
    const { container } = renderWithPerms(
      <DetailView schema={baseSchema} />,
      'annual_revenue',
    );
    // The raw value must not appear anywhere — header chips, body, etc.
    expect(container.textContent).not.toMatch(/1,000,000|1000000/);
  });

  it('omits a denied field referenced from a top-level fields[] schema', () => {
    const schema: DetailViewSchema = {
      type: 'detail-view',
      title: 'Account',
      objectName: 'account',
      data: { name: 'Acme', industry: 'Tech', annual_revenue: 500 },
      fields: [
        { name: 'name', label: 'Name' },
        { name: 'annual_revenue', label: 'Annual Revenue' },
      ],
    };
    renderWithPerms(<DetailView schema={schema} />, 'annual_revenue');

    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.queryByText('Annual Revenue')).not.toBeInTheDocument();
  });

  it('omits a denied field from summaryFields[]', () => {
    const schema: DetailViewSchema = {
      ...baseSchema,
      summaryFields: ['industry', 'annual_revenue'],
    };
    renderWithPerms(<DetailView schema={schema} />, 'annual_revenue');

    // Summary chips render labels (or values) via formatted spans; the
    // denied field shouldn't have a visible value chip. We assert on the
    // raw value to keep this test independent of summary-chip markup.
    const { container } = render(
      <PermissionProvider
        roles={roles}
        permissions={[makeRestrictedConfig('annual_revenue')]}
        userRoles={['restricted']}
      >
        <DetailView schema={schema} />
      </PermissionProvider>,
    );
    expect(container.textContent).not.toMatch(/1,000,000|1000000/);
  });

  it('passes through unchanged when no PermissionProvider is mounted', () => {
    render(<DetailView schema={baseSchema} />);
    expect(screen.getByText('Annual Revenue')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
  });
});
