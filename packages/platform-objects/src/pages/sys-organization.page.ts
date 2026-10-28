// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Page } from '@objectstack/spec/ui';

/**
 * sys_organization — Record Detail Page (`kind: 'full'`)
 *
 * Adds Members / Invitations / Teams tabs to the organization detail
 * page so an admin can manage the membership graph from a single place
 * instead of switching between three separate Setup list views.
 *
 * The page is `kind: 'full'`: it owns its own tab strip, so it is drawn as
 * authored at every width. It was a `kind: 'slotted'` page overriding only
 * the `tabs` slot until that slot retired (#27053 — the record page now
 * composes its strip from the object's roles and relationship flags, and a
 * page that needs its own strip is `kind: 'full'`). The rebuild is faithful
 * to what the slotted page rendered — the synthesized default with the strip
 * swapped in — node for node:
 *
 *  - `page:header` carrying the object's `record_header` actions (Set Active,
 *    Invite User, Leave Organization, Rename Organization — Edit and Delete are
 *    row actions only), the list the synthesized header carried. A full page
 *    renders exactly the nodes it declares, so the header is spelled out.
 *  - `record:highlights` over the object's `highlightFields` minus the title
 *    field (`slug`; `name` is the page H1).
 *  - the Members / Invitations / Teams strip, unchanged, Members at index 0
 *    (ADR-0133).
 *  - `record:discussion`, the synthesized discussion footer.
 *
 * Each tab is a `record:related_list` over a child object that already
 * has `organization_id` as a `Field.lookup('sys_organization')` — the
 * renderer scopes the list to the current organization automatically
 * (the related-list runtime uses the parent record id from the page
 * context as the filter value for `relationshipField`). The per-row
 * actions defined on each child object (invite_user, cancel_invitation,
 * remove_member, transfer_ownership, create_team, …) are inherited
 * unchanged — no admin endpoint has to be re-declared here.
 *
 * Notable omissions:
 *  - **OAuth Apps**: `sys_oauth_application` is owned by `user_id`, not
 *    `organization_id`. They surface on the user's Account → Developer
 *    section instead of the org detail.
 *  - **SSO**: no `sys_sso*` object exists yet. When the SSO plugin lands,
 *    add a fourth tab here.
 */
export const SysOrganizationDetailPage: Page = {
  name: 'sys_organization_detail',
  label: 'Organization',
  type: 'record',
  object: 'sys_organization',
  template: 'default',
  kind: 'full',
  isDefault: true,
  regions: [
    {
      name: 'main',
      width: 'full',
      components: [
        // The synthesized header's action list: every `sys_organization`
        // action declaring `record_header` or `record_more`, in declaration
        // order. The host appends its own system actions after these.
        {
          type: 'page:header',
          properties: {
            actions: ['set_active_organization', 'invite_user', 'leave_organization', 'rename_organization'],
          },
        },
        { type: 'record:highlights', properties: { fields: ['slug'] } },
        {
          type: 'page:tabs',
          properties: {
            // `tabStyle`, not `type` (#6776): the node's own dispatch key is
            // already `type`, so the old spelling was unauthorable in the flat and
            // JSX carriers and unvalidated everywhere.
            tabStyle: 'line',
            position: 'top',
            items: [
              {
                label: { en: 'Members', 'zh-CN': '成员', 'ja-JP': 'メンバー', 'es-ES': 'Miembros' },
                icon: 'users',
                children: [
                  {
                    type: 'record:related_list',
                    properties: {
                      objectName: 'sys_member',
                      relationshipField: 'organization_id',
                      columns: ['user_id', 'role', 'created_at'],
                      sort: [{ field: 'created_at', order: 'desc' }],
                      limit: 25,
                      showViewAll: true,
                      title: { en: 'Members', 'zh-CN': '成员', 'ja-JP': 'メンバー', 'es-ES': 'Miembros' },
                    },
                  },
                ],
              },
              {
                label: { en: 'Invitations', 'zh-CN': '邀请', 'ja-JP': '招待', 'es-ES': 'Invitaciones' },
                icon: 'mail',
                children: [
                  {
                    type: 'record:related_list',
                    properties: {
                      objectName: 'sys_invitation',
                      relationshipField: 'organization_id',
                      columns: ['email', 'role', 'status', 'expires_at', 'inviter_id'],
                      sort: [{ field: 'created_at', order: 'desc' }],
                      limit: 25,
                      showViewAll: true,
                      title: { en: 'Invitations', 'zh-CN': '邀请', 'ja-JP': '招待', 'es-ES': 'Invitaciones' },
                    },
                  },
                ],
              },
              {
                label: { en: 'Teams', 'zh-CN': '团队', 'ja-JP': 'チーム', 'es-ES': 'Equipos' },
                icon: 'users-round',
                children: [
                  {
                    type: 'record:related_list',
                    properties: {
                      objectName: 'sys_team',
                      relationshipField: 'organization_id',
                      columns: ['name', 'created_at', 'updated_at'],
                      sort: [{ field: 'name', order: 'asc' }],
                      limit: 25,
                      showViewAll: true,
                      title: { en: 'Teams', 'zh-CN': '团队', 'ja-JP': 'チーム', 'es-ES': 'Equipos' },
                    },
                  },
                ],
              },
            ],
          },
        },
        { type: 'record:discussion' },
      ],
    },
  ],
};
