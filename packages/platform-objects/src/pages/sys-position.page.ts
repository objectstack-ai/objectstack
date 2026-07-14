// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Page } from '@objectstack/spec/ui';

/**
 * sys_position — Record Detail Page (slotted, default for ALL sys_position
 * records)
 *
 * **Audience**: admins managing capability distribution from Setup.
 *
 * A position (岗位, ADR-0090 D3) is the flat distribution group: users hold
 * it (`sys_user_position`), and it binds permission sets
 * (`sys_position_permission_set`). This page makes both edges manageable
 * as PURE SDUI — two `record:related_list` tabs with Add pickers; no
 * bespoke React:
 *
 *  - **Holders** — who holds this position. `sys_user_position.position`
 *    stores the position's MACHINE NAME, so the list keys on
 *    `relationshipValueField: 'name'` (the generic name-keyed-junction
 *    affordance this page motivated). Assigning here inserts an ordinary
 *    assignment row; the ADR-0090 D12 delegated-admin gate governs the
 *    write and its denial reason surfaces in the Add dialog. The
 *    `business_unit_id` column is the assignment-level BU anchor
 *    (ADR-0090 Addendum); `valid_from`/`valid_until` columns join it when
 *    ADR-0091 L1 lands.
 *  - **Permission Sets** — what the position distributes
 *    (`sys_position_permission_set`, ordinary id-keyed junction). Binding
 *    is guarded by BOTH the audience-anchor gate (D5/D9 — high-privilege
 *    sets never bind to everyone/guest) and the D12 gate.
 *
 * Header/actions fall through to the synthesizer, so the object's declared
 * row actions (activate/deactivate/clone/set-default) keep working.
 */
export const SysPositionDetailPage: Page = {
  name: 'sys_position_detail',
  label: 'Position',
  type: 'record',
  object: 'sys_position',
  template: 'default',
  kind: 'slotted',
  isDefault: true,

  regions: [],

  slots: {
    tabs: {
      type: 'page:tabs',
      properties: {
        type: 'line',
        position: 'top',
        items: [
          {
            label: { en: 'Holders', 'zh-CN': '任职人员', 'ja-JP': '在任者', 'es-ES': 'Titulares' },
            icon: 'users',
            children: [
              {
                type: 'record:related_list',
                properties: {
                  objectName: 'sys_user_position',
                  relationshipField: 'position',
                  relationshipValueField: 'name',
                  columns: ['user_id', 'business_unit_id', 'granted_by', 'created_at'],
                  sort: [{ field: 'created_at', order: 'desc' }],
                  limit: 25,
                  showViewAll: true,
                  title: { en: 'Holders', 'zh-CN': '任职人员', 'ja-JP': '在任者', 'es-ES': 'Titulares' },
                  add: {
                    picker: {
                      object: 'sys_user',
                      labelField: 'name',
                    },
                    linkField: 'user_id',
                    label: { en: 'Assign user', 'zh-CN': '分配用户', 'ja-JP': 'ユーザーを割り当て', 'es-ES': 'Asignar usuario' },
                  },
                },
              },
            ],
          },
          {
            label: { en: 'Permission Sets', 'zh-CN': '权限集', 'ja-JP': '権限セット', 'es-ES': 'Conjuntos de permisos' },
            icon: 'lock',
            children: [
              {
                type: 'record:related_list',
                properties: {
                  objectName: 'sys_position_permission_set',
                  relationshipField: 'position_id',
                  columns: ['permission_set_id', 'created_at'],
                  sort: [{ field: 'created_at', order: 'desc' }],
                  limit: 25,
                  showViewAll: true,
                  title: { en: 'Permission Sets', 'zh-CN': '权限集', 'ja-JP': '権限セット', 'es-ES': 'Conjuntos de permisos' },
                  add: {
                    picker: {
                      object: 'sys_permission_set',
                      labelField: 'label',
                    },
                    linkField: 'permission_set_id',
                    label: { en: 'Bind permission set', 'zh-CN': '绑定权限集', 'ja-JP': '権限セットをバインド', 'es-ES': 'Vincular conjunto de permisos' },
                  },
                },
              },
            ],
          },
        ],
      },
    },

    // No Chatter feed on an RBAC primitive.
    discussion: [],
  },
};
