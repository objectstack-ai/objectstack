// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * Team and ProjectMembership — a many-to-many relationship modelled with a
 * junction object. A Team can staff many Projects and a Project can be
 * staffed by many Teams; `showcase_project_membership` is the join row.
 */
export const Team = ObjectSchema.create({
  name: 'showcase_team',
  label: 'Team',
  pluralLabel: 'Teams',
  icon: 'users',
  description: 'A delivery team that can be assigned to many projects.',

  fields: {
    name: Field.text({ label: 'Team Name', required: true, searchable: true, maxLength: 120 }),
    lead: Field.text({ label: 'Team Lead', maxLength: 200 }),
    capacity_hours: Field.number({ label: 'Weekly Capacity (h)', min: 0, defaultValue: 160 }),
  },
});

/** Junction row joining Team ↔ Project (many-to-many). */
export const ProjectMembership = ObjectSchema.create({
  name: 'showcase_project_membership',
  label: 'Project Membership',
  pluralLabel: 'Project Memberships',
  icon: 'link',
  description: 'Join object linking teams to projects (many-to-many).',

  fields: {
    team: Field.masterDetail('showcase_team', { label: 'Team', required: true }),
    project: Field.masterDetail('showcase_project', { label: 'Project', required: true }),
    role: Field.select({
      label: 'Role',
      options: [
        { label: 'Owner', value: 'owner', default: true },
        { label: 'Contributor', value: 'contributor' },
        { label: 'Reviewer', value: 'reviewer' },
      ],
    }),
    allocation_percent: Field.percent({ label: 'Allocation', min: 0, max: 100, defaultValue: 100 }),
  },
});
