// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Page } from '@objectstack/spec/ui';

/**
 * sys_audit_log — Record Detail Page (`kind: 'full'`, default for ALL
 * sys_audit_log records).
 *
 * **Audience**: an administrator opening one ledger row from Setup → 审计日志
 * to find out what changed.
 *
 * ## Why the page exists: the other rows about the same record
 *
 * A settings write records a `config_change` row whose `old_value` and
 * `new_value` carry the setting's readable before and after for a key that
 * is not secret-valued, and only its digest for a secret-valued key
 * (`service-settings`' `config-change-audit.ts`). The CRUD mirror
 * (`audit-writers.ts`) writes its own row about the same write, on the stored
 * settings row: a non-secret value's old and new state, a secret's only as
 * the mirror's ledger view masks it. Both rows name the same settings row as
 * `record_id` (the `config_change` writer records the id of the row the write
 * landed on), so this page lists every ledger row whose `record_id` is this
 * row's: the `config_change` row and the mirror's rows sit side by side, the
 * history of that settings row in one list.
 *
 * The list is the ledger itself, keyed on the pointer's id half on both sides
 * (`relationshipField` and `relationshipValueField` both `record_id`): the
 * console filters `sys_audit_log` on `record_id` equal to this row's
 * `record_id`. Every ledger row about a record gets the same list: the
 * history of that record as the ledger holds it, this row included. A row
 * about no record (an `import` run, a platform-admin standing change, a
 * `config_change` written before its writer recorded the settings row) has no
 * `record_id`, and the console lists nothing for a parent value it does not
 * have.
 *
 * What a reader is served is the ledger's read gate's answer, unchanged: each
 * listed row passes the parent-record gate and the field redaction
 * (`audit-log-read-visibility.ts`, `audit-log-field-redaction.ts`) exactly as
 * it does on the list views.
 *
 * ## The nodes
 *
 *  - `page:header` with `placedActions: true`: the synthesized header's
 *    action set, read live. The ledger places no actions of its own.
 *  - `record:highlights` over the object's `highlightFields` minus the title
 *    field `action` (the H1). Neither half of the `record_id` / `object_name`
 *    pointer pair is in the strip: the details grid draws `record_id` as the
 *    target record's card, headed by its object's label
 *    (`sys-audit-log-pointer-pair.test.ts`).
 *  - `record:details` with the object's fields in its declared groups. A
 *    `full` page draws only what it authors, and a bare node draws the
 *    object's `highlightFields`, so the groups are spelled out. The type half
 *    `object_name` is listed beside its id half; the console folds it into
 *    the card.
 *  - the `record:related_list` above, newest first, with no "New": the ledger
 *    is append-only (`enable.apiMethods: ['get', 'list']`).
 *  - `record:discussion`, the synthesized discussion footer.
 *
 * Copy inside the components is authored as inline locale maps in the
 * locales this plugin's bundles ship, the ruled route for page prose; the
 * page-level `label` is the one key a translation bundle reaches
 * (`pages.sys_audit_log_detail.label`, in `translations/pages.ts`).
 */
export const SysAuditLogDetailPage: Page = {
  name: 'sys_audit_log_detail',
  label: 'Audit Log',
  type: 'record',
  object: 'sys_audit_log',
  template: 'default',
  kind: 'full',
  isDefault: true,

  regions: [
    {
      name: 'main',
      width: 'full',
      components: [
        { type: 'page:header', properties: { placedActions: true } },

        { type: 'record:highlights', properties: { fields: ['created_at', 'user_id'] } },

        {
          type: 'record:details',
          properties: {
            sections: [
              {
                label: {
                  en: 'Event', 'zh-CN': '事件', 'zh-Hant': '事件', 'ja-JP': 'イベント', ko: '이벤트', de: 'Ereignis',
                  fr: 'Événement', 'es-ES': 'Evento', 'pt-BR': 'Evento', ru: 'Событие', ar: 'الحدث',
                },
                fields: ['created_at', 'action', 'user_id', 'actor'],
              },
              {
                label: {
                  en: 'Target', 'zh-CN': '目标记录', 'zh-Hant': '目標記錄', 'ja-JP': '対象レコード', ko: '대상 레코드',
                  de: 'Zieldatensatz', fr: 'Enregistrement cible', 'es-ES': 'Registro de destino',
                  'pt-BR': 'Registro de destino', ru: 'Целевая запись', ar: 'السجل المستهدف',
                },
                fields: ['object_name', 'record_id'],
              },
              {
                label: {
                  en: 'Changes', 'zh-CN': '变更内容', 'zh-Hant': '變更內容', 'ja-JP': '変更内容', ko: '변경 내용',
                  de: 'Änderungen', fr: 'Modifications', 'es-ES': 'Cambios', 'pt-BR': 'Alterações', ru: 'Изменения',
                  ar: 'التغييرات',
                },
                fields: ['old_value', 'new_value'],
              },
              {
                label: {
                  en: 'Client', 'zh-CN': '客户端', 'zh-Hant': '用戶端', 'ja-JP': 'クライアント', ko: '클라이언트', de: 'Client',
                  fr: 'Client', 'es-ES': 'Cliente', 'pt-BR': 'Cliente', ru: 'Клиент', ar: 'العميل',
                },
                fields: ['ip_address', 'user_agent'],
              },
              {
                label: {
                  en: 'Context', 'zh-CN': '上下文', 'zh-Hant': '上下文', 'ja-JP': 'コンテキスト', ko: '컨텍스트', de: 'Kontext',
                  fr: 'Contexte', 'es-ES': 'Contexto', 'pt-BR': 'Contexto', ru: 'Контекст', ar: 'السياق',
                },
                fields: ['tenant_id', 'metadata'],
              },
            ],
          },
        },

        {
          type: 'record:related_list',
          properties: {
            objectName: 'sys_audit_log',
            relationshipField: 'record_id',
            relationshipValueField: 'record_id',
            columns: ['created_at', 'action', 'user_id', 'old_value', 'new_value'],
            sort: [{ field: 'created_at', order: 'desc' }],
            limit: 25,
            showViewAll: true,
            // Append-only: no "New" on this list.
            actions: [],
            title: {
              en: 'Changes to the same record',
              'zh-CN': '同一记录的变更',
              'zh-Hant': '同一記錄的變更',
              'ja-JP': '同じレコードへの変更',
              ko: '같은 레코드의 변경',
              de: 'Änderungen am selben Datensatz',
              fr: 'Modifications du même enregistrement',
              'es-ES': 'Cambios en el mismo registro',
              'pt-BR': 'Alterações no mesmo registro',
              ru: 'Изменения той же записи',
              ar: 'التغييرات على السجل نفسه',
            },
          },
        },

        { type: 'record:discussion' },
      ],
    },
  ],
};
