// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Page } from '@objectstack/spec/ui';

/**
 * sys_queue — Record Detail Page (`kind: 'full'`, default for ALL sys_queue
 * records).
 *
 * **Audience**: an administrator managing an organization's own queue in
 * Setup → Queues, who needs to see and change who is in it without switching
 * to the separate Queue Members list.
 *
 * ## The members list, keyed by NAME
 *
 * A member row names its queue by the queue's machine name:
 * `sys_queue_member.queue` is a text column holding `sys_queue.name`, the key
 * every queue reference uses (ADR-0142 D1/D2), and it stays that. So the list
 * declares `relationshipValueField: 'name'`: the console filters
 * `sys_queue_member` on `queue` equal to this queue's `name`, and its "New"
 * opens the member form with `queue` filled in with that name. A member added
 * here is the row the ownership-queue service expands, under the same name.
 *
 * Declared queues are out: a package's queue is a registry item with no
 * `sys_queue` row (ADR-0131 D6, regime C), so it has no record page. An
 * organization's member rows under a declared queue's name are listed on the
 * Queue Members list, as before.
 *
 * ## The nodes
 *
 *  - `page:header` with `placedActions: true`: the synthesized header's
 *    action set, read live.
 *  - `record:highlights` over the object's `highlightFields` minus the title
 *    field `name` (the H1).
 *  - `record:details` with the queue's fields. A `full` page draws only what
 *    it authors, and a bare node draws the object's `highlightFields`, so the
 *    fields are spelled out.
 *  - the members `record:related_list` above.
 *  - `record:discussion`, the synthesized discussion footer.
 *
 * Copy inside the components is authored as inline locale maps, the ruled
 * route for page prose; the page-level `label` is the one key a translation
 * bundle reaches (`pages.sys_queue_detail.label`, in `translations/pages.ts`).
 */
export const SysQueueDetailPage: Page = {
  name: 'sys_queue_detail',
  label: 'Queue',
  type: 'record',
  object: 'sys_queue',
  template: 'default',
  kind: 'full',
  isDefault: true,

  regions: [
    {
      name: 'main',
      width: 'full',
      components: [
        { type: 'page:header', properties: { placedActions: true } },

        { type: 'record:highlights', properties: { fields: ['label'] } },

        { type: 'record:details', properties: { fields: ['name', 'label', 'description'] } },

        {
          type: 'record:related_list',
          properties: {
            objectName: 'sys_queue_member',
            relationshipField: 'queue',
            // The member row stores the queue's NAME, not its id.
            relationshipValueField: 'name',
            columns: ['recipient_type', 'recipient_id', 'updated_at'],
            sort: [{ field: 'recipient_type', order: 'asc' }],
            limit: 50,
            showViewAll: true,
            title: { en: 'Members', 'zh-CN': '成员', 'ja-JP': 'メンバー', 'es-ES': 'Miembros' },
          },
        },

        { type: 'record:discussion' },
      ],
    },
  ],
};
