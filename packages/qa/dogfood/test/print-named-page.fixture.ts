// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The print page the named-page print dogfood files save (#26583): a project
// brief for `showcase_project`, beside the project's own default record page
// (`showcase_project_detail`, a working page with no `print`). Every block is
// from the printable subset, so the metadata save door accepts it.

/** The project's print page: not its default record page, which stays the working page. */
export const PROJECT_BRIEF_PAGE = {
  name: 'showcase_project_brief',
  label: 'Project brief',
  type: 'record',
  object: 'showcase_project',
  kind: 'full',
  print: { paperSize: 'A4', orientation: 'portrait', pageNumbers: true },
  regions: [
    { name: 'header', components: [{ type: 'element:text', properties: { content: 'Project brief' } }] },
    {
      name: 'main',
      components: [
        {
          type: 'record:details',
          properties: {
            sections: [{ name: 'brief', label: 'Brief', columns: 2, fields: ['name', 'status', 'start_date', 'end_date'] }],
          },
        },
      ],
    },
  ],
} as const;
