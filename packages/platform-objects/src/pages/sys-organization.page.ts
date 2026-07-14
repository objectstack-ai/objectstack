// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Page } from '@objectstack/spec/ui';

/**
 * sys_organization — Record Detail Page (slotted)
 *
 * Adds Members / Invitations / Teams tabs to the organization detail
 * page so an admin can manage the membership graph from a single place
 * instead of switching between three separate Setup list views.
 *
 * The page is `kind: 'slotted'` and overrides only the `tabs` slot —
 * header, actions, highlights, details and discussion fall through to
 * the synthesized default, so the organization's own fields and the
 * existing record-header actions (Set Active, Edit, Delete, Leave) are
 * preserved.
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
  kind: 'slotted',
  isDefault: true,
  // `regions` is required by the Page schema even for slotted pages —
  // empty array lets the synthesizer fill in header/details/discussion
  // while the `slots.tabs` override below replaces the synthesized
  // tabs strip.
  regions: [],
  slots: {
    tabs: {
      type: 'page:tabs',
      properties: {
        type: 'line',
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
  },
};
