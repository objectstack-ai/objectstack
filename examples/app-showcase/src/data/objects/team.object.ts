// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * Team and ProjectMembership — a many-to-many relationship modelled with a
 * junction object. A Team can staff many Projects and a Project can be
 * staffed by many Teams; `showcase_project_membership` is the join row.
 */
export const Team = ObjectSchema.create({
  name: 'showcase_team',
  // [ADR-0090 D1] Explicit grandfather stamp: record isolation for this demo
  // object is RLS-owned / intentionally public; without this the new secure
  // default (unset OWD => private) would owner-filter it.
  sharingModel: 'public_read_write',
  label: 'Team',
  pluralLabel: 'Teams',
  icon: 'users',
  description: 'A delivery team that can be assigned to many projects.',

  fields: {
    name: Field.text({ label: 'Team Name', required: true, searchable: true, maxLength: 120, group: 'team' }),
    lead: Field.text({ label: 'Team Lead', maxLength: 200, group: 'team' }),
    capacity_hours: Field.number({ label: 'Weekly Capacity (h)', min: 0, defaultValue: 160, group: 'team' }),
  },

  // ADR-0085 §5: the form, detail and drawer layout is derived from these
  // groups, so each field is placed in a named section rather than left to the
  // untitled fallback, which the field-no-consumers rule credits to no one (#32168).
  fieldGroups: [
    { key: 'team', label: 'Team' },
  ],
});

/** Junction row joining Team ↔ Project (many-to-many). */
export const ProjectMembership = ObjectSchema.create({
  name: 'showcase_project_membership',
  // [ADR-0090 D1] Explicit grandfather stamp: record isolation for this demo
  // object is RLS-owned / intentionally public; without this the new secure
  // default (unset OWD => private) would owner-filter it.
  sharingModel: 'public_read_write',
  label: 'Project Membership',
  pluralLabel: 'Project Memberships',
  icon: 'link',
  description: 'Join object linking teams to projects (many-to-many).',

  fields: {
    team: Field.masterDetail('showcase_team', { label: 'Team', required: true, group: 'membership' }),
    project: Field.masterDetail('showcase_project', { label: 'Project', required: true, group: 'membership' }),
    // [ADR-0090 D3] Formerly `role` — reserved word; this is the team's
    // engagement on the project, not a capability container.
    engagement: Field.select({
      label: 'Engagement',
      options: [
        { label: 'Owner', value: 'owner', default: true },
        { label: 'Contributor', value: 'contributor' },
        { label: 'Reviewer', value: 'reviewer' },
      ],
      group: 'membership',
    }),
    allocation_percent: Field.percent({ label: 'Allocation', min: 0, max: 100, defaultValue: 100, group: 'membership' }),
  },

  // ADR-0085 §5: the form, detail and drawer layout is derived from these
  // groups, so each field is placed in a named section rather than left to the
  // untitled fallback, which the field-no-consumers rule credits to no one (#32168).
  fieldGroups: [
    { key: 'membership', label: 'Membership' },
  ],
});
