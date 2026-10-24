// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24978] The approval notifications' sentences — the catalog entries the
 * messaging service renders, per recipient and at delivery, in that
 * recipient's language (`EmitInput.keyedText`).
 *
 * HAND-AUTHORED, in the shape `@objectstack/plugin-audit`'s `messages.ts` gives
 * its notification titles: this bundle's `messages` face, loaded into the
 * `i18n` service with the rest of `ApprovalsTranslations` (ADR-0029 D8), and
 * read by `t('messages.<id>', locale, params)`.
 *
 * ## Keeping the copy honest
 *
 * - Ids are single-segment: both `II18nService` implementations resolve a key
 *   by walking NESTED objects, so an id holding a dot would never resolve.
 * - `en` IS the literal text. `approval-notification-text.ts` builds the
 *   `payload.title` / `payload.body` every emit still carries — the fallback a
 *   recipient reads whenever a key cannot be rendered — by interpolating these
 *   `en` entries, so the English a recipient reads is one string whichever
 *   path delivered it, and it is the sentence each notification carried before
 *   it was keyed.
 * - Every locale carries every id with the same `{{holes}}`:
 *   `approval-notification-text.test.ts` pins both.
 *
 * ## The holes
 *
 *  - `{{object}} {{record}}` — the record the notification is about, named by
 *    its object's label and its id (`Deal D_123`, the #23556 / #23594 ruling B
 *    form). `object` is itself rendered in the recipient's language from
 *    `objects.<object>.label` when the app's language pack holds it, else the
 *    schema label;
 *  - `{{person}}` — a display name; `{{action}}` — the escalation action's
 *    configured token; `{{limit}}` — the revision limit; `{{comment}}` — the
 *    decider's comment, as they wrote it.
 *
 * ## The administrators' routing note
 *
 * [#25576] `approvalAdminRescue*` are not notifications: they are the system
 * note an `admin_rescue` request writes on its own timeline, rendered by the
 * approvals door in the READER's language (`admin-rescue-note.ts`). The note
 * is `approvalAdminRescueNote` around `{{reason}}`, and the reason is one
 * clause per approver entry that resolved to no one (`{{type}}` is the
 * approver type's machine token, `{{value}}` its configured value), joined by
 * `approvalAdminRescueReasonSeparator`. The `en` note, rendered, is the
 * `comment` the row stores.
 */

import type { TranslationData } from '@objectstack/spec/system';

type Messages = NonNullable<TranslationData['messages']>;

/** The ids, as `en` spells them — every other locale carries exactly these. */
export const enMessages = {
  approvalRequestedTitle: 'Approval requested',
  approvalRequestedBody: 'A decision on {{object}} {{record}} is waiting on you.',
  approvalReminderTitle: 'Approval reminder',
  approvalReminderBody: 'A decision on {{object}} {{record}} is still waiting on you.',
  approvalSlaBreachedTitle: 'Approval SLA breached',
  approvalSlaBreachedBody: 'A decision on {{object}} {{record}} is overdue.',
  approvalSlaBreachedSubmitterTitle: 'Your approval request breached its SLA',
  approvalSlaBreachedSubmitterBody: "{{object}} {{record}}: escalation action '{{action}}' was taken.",
  approvalApprovedTitle: 'Request approved',
  approvalApprovedBody: 'Your {{object}} {{record}} was approved.',
  approvalApprovedWithCommentBody: 'Your {{object}} {{record}} was approved.\n\n{{comment}}',
  approvalRejectedTitle: 'Request rejected',
  approvalRejectedBody: 'Your {{object}} {{record}} was rejected.',
  approvalRejectedWithCommentBody: 'Your {{object}} {{record}} was rejected.\n\n{{comment}}',
  approvalOooSubstitutedTitle: 'Approval routed to you (out-of-office cover)',
  approvalOooSubstitutedBody: 'You are covering an approval on {{object}} {{record}} while {{person}} is out of office.',
  approvalOooSkippedTitle: 'Approval routed to your delegate',
  approvalOooSkippedBody: 'An approval on {{object}} {{record}} was routed to {{person}} while you are out of office.',
  approvalEscalatedTitle: 'Approval escalated to you',
  approvalEscalatedBody: 'An overdue approval on {{object}} {{record}} was escalated to you.',
  approvalReassignedTitle: 'Approval handed to you',
  approvalReassignedBody: 'You are now an approver on {{object}} {{record}}.',
  approvalAutoRejectedTitle: 'Approval auto-rejected',
  approvalAutoRejectedBody: 'Your {{object}} {{record}} exceeded the revision limit ({{limit}}) and was rejected.',
  approvalReturnedTitle: 'Sent back for revision',
  approvalReturnedBody: 'Your {{object}} {{record}} needs rework before it can be approved.',
  approvalRequestInfoTitle: 'More information requested',
  approvalCommentTitle: 'New comment on an approval',
  approvalAdminRescueNote: "Routed to this organization's administrators because the approver slate named no one: {{reason}}.",
  approvalAdminRescuePositionUnheld: "position '{{value}}' has no holder",
  approvalAdminRescueSlotUnresolved: "{{type}} '{{value}}' resolved to no one",
  approvalAdminRescueNoApprover: 'no approver on the node resolved to a person',
  approvalAdminRescueFallbackUnresolved: 'the declared fallbackApprovers resolved to no one either',
  approvalAdminRescueFallbackUndeclared: "onEmptyApprovers is 'fallback' but no fallbackApprovers are declared",
  approvalAdminRescueReasonSeparator: '; ',
} as const satisfies Messages;

/** One approval notification sentence's id. */
export type ApprovalMessageId = keyof typeof enMessages;

type ApprovalMessages = Readonly<Record<ApprovalMessageId, string>>;

export const zhCNMessages: ApprovalMessages = {
  approvalRequestedTitle: '新的审批请求',
  approvalRequestedBody: '{{object}} {{record}} 正在等待您的审批决定。',
  approvalReminderTitle: '审批提醒',
  approvalReminderBody: '{{object}} {{record}} 仍在等待您的审批决定。',
  approvalSlaBreachedTitle: '审批已超出时限',
  approvalSlaBreachedBody: '{{object}} {{record}} 的审批决定已逾期。',
  approvalSlaBreachedSubmitterTitle: '您的审批请求已超出时限',
  approvalSlaBreachedSubmitterBody: '{{object}} {{record}}：已执行升级操作「{{action}}」。',
  approvalApprovedTitle: '请求已批准',
  approvalApprovedBody: '您的{{object}} {{record}} 已获批准。',
  approvalApprovedWithCommentBody: '您的{{object}} {{record}} 已获批准。\n\n{{comment}}',
  approvalRejectedTitle: '请求已驳回',
  approvalRejectedBody: '您的{{object}} {{record}} 已被驳回。',
  approvalRejectedWithCommentBody: '您的{{object}} {{record}} 已被驳回。\n\n{{comment}}',
  approvalOooSubstitutedTitle: '审批已转交给您（外出代理）',
  approvalOooSubstitutedBody: '{{person}} 外出期间，由您代为处理 {{object}} {{record}} 的审批。',
  approvalOooSkippedTitle: '审批已转交给您的代理人',
  approvalOooSkippedBody: '您外出期间，{{object}} {{record}} 的审批已转交给 {{person}}。',
  approvalEscalatedTitle: '审批已升级给您',
  approvalEscalatedBody: '{{object}} {{record}} 的一项逾期审批已升级给您。',
  approvalReassignedTitle: '审批已移交给您',
  approvalReassignedBody: '您现在是 {{object}} {{record}} 的审批人。',
  approvalAutoRejectedTitle: '审批已自动驳回',
  approvalAutoRejectedBody: '您的{{object}} {{record}} 已超过退回修改次数上限（{{limit}}），已被驳回。',
  approvalReturnedTitle: '已退回修改',
  approvalReturnedBody: '您的{{object}} {{record}} 需要修改后才能获批。',
  approvalRequestInfoTitle: '需要补充信息',
  approvalCommentTitle: '审批有新评论',
  approvalAdminRescueNote: '审批人名单未指向任何人，因此已转交本组织管理员处理：{{reason}}。',
  approvalAdminRescuePositionUnheld: '岗位「{{value}}」无人任职',
  approvalAdminRescueSlotUnresolved: '{{type}}「{{value}}」未解析到任何人',
  approvalAdminRescueNoApprover: '节点上没有任何审批人解析到具体人员',
  approvalAdminRescueFallbackUnresolved: '声明的 fallbackApprovers 也未解析到任何人',
  approvalAdminRescueFallbackUndeclared: "onEmptyApprovers 为 'fallback'，但未声明 fallbackApprovers",
  approvalAdminRescueReasonSeparator: '；',
};

export const jaJPMessages: ApprovalMessages = {
  approvalRequestedTitle: '承認依頼',
  approvalRequestedBody: '{{object}} {{record}} について、あなたの承認判断が必要です。',
  approvalReminderTitle: '承認のリマインダー',
  approvalReminderBody: '{{object}} {{record}} について、引き続きあなたの承認判断をお待ちしています。',
  approvalSlaBreachedTitle: '承認の期限超過',
  approvalSlaBreachedBody: '{{object}} {{record}} の承認判断が期限を過ぎています。',
  approvalSlaBreachedSubmitterTitle: 'あなたの承認申請が期限を超過しました',
  approvalSlaBreachedSubmitterBody: '{{object}} {{record}}：エスカレーション操作「{{action}}」が実行されました。',
  approvalApprovedTitle: '申請が承認されました',
  approvalApprovedBody: 'あなたの{{object}} {{record}} は承認されました。',
  approvalApprovedWithCommentBody: 'あなたの{{object}} {{record}} は承認されました。\n\n{{comment}}',
  approvalRejectedTitle: '申請が却下されました',
  approvalRejectedBody: 'あなたの{{object}} {{record}} は却下されました。',
  approvalRejectedWithCommentBody: 'あなたの{{object}} {{record}} は却下されました。\n\n{{comment}}',
  approvalOooSubstitutedTitle: '承認が割り当てられました（不在時の代理）',
  approvalOooSubstitutedBody: '{{person}} さんの不在中、{{object}} {{record}} の承認をあなたが代理で担当します。',
  approvalOooSkippedTitle: '承認が代理人に回されました',
  approvalOooSkippedBody: 'あなたの不在中、{{object}} {{record}} の承認は {{person}} さんに回されました。',
  approvalEscalatedTitle: '承認がエスカレーションされました',
  approvalEscalatedBody: '期限を過ぎた {{object}} {{record}} の承認があなたにエスカレーションされました。',
  approvalReassignedTitle: '承認が引き継がれました',
  approvalReassignedBody: 'あなたは {{object}} {{record}} の承認者になりました。',
  approvalAutoRejectedTitle: '承認が自動的に却下されました',
  approvalAutoRejectedBody: 'あなたの{{object}} {{record}} は差し戻し回数の上限（{{limit}}）を超えたため却下されました。',
  approvalReturnedTitle: '修正のため差し戻されました',
  approvalReturnedBody: 'あなたの{{object}} {{record}} は、承認を受ける前に修正が必要です。',
  approvalRequestInfoTitle: '追加情報が求められています',
  approvalCommentTitle: '承認に新しいコメントがあります',
  approvalAdminRescueNote: '承認者リストが誰も指していなかったため、この組織の管理者に回されました：{{reason}}。',
  approvalAdminRescuePositionUnheld: '役職「{{value}}」に就いている人がいません',
  approvalAdminRescueSlotUnresolved: '{{type}}「{{value}}」は誰にも解決されませんでした',
  approvalAdminRescueNoApprover: 'ノード上のどの承認者も個人に解決されませんでした',
  approvalAdminRescueFallbackUnresolved: '宣言された fallbackApprovers も誰にも解決されませんでした',
  approvalAdminRescueFallbackUndeclared: "onEmptyApprovers は 'fallback' ですが、fallbackApprovers が宣言されていません",
  approvalAdminRescueReasonSeparator: '；',
};

export const esESMessages: ApprovalMessages = {
  approvalRequestedTitle: 'Aprobación solicitada',
  approvalRequestedBody: 'Una decisión sobre {{object}} {{record}} está pendiente de usted.',
  approvalReminderTitle: 'Recordatorio de aprobación',
  approvalReminderBody: 'Una decisión sobre {{object}} {{record}} sigue pendiente de usted.',
  approvalSlaBreachedTitle: 'Plazo de aprobación incumplido',
  approvalSlaBreachedBody: 'La decisión sobre {{object}} {{record}} está vencida.',
  approvalSlaBreachedSubmitterTitle: 'Su solicitud de aprobación ha superado su plazo',
  approvalSlaBreachedSubmitterBody: "{{object}} {{record}}: se ha ejecutado la acción de escalado '{{action}}'.",
  approvalApprovedTitle: 'Solicitud aprobada',
  approvalApprovedBody: 'Se ha aprobado su {{object}} {{record}}.',
  approvalApprovedWithCommentBody: 'Se ha aprobado su {{object}} {{record}}.\n\n{{comment}}',
  approvalRejectedTitle: 'Solicitud rechazada',
  approvalRejectedBody: 'Se ha rechazado su {{object}} {{record}}.',
  approvalRejectedWithCommentBody: 'Se ha rechazado su {{object}} {{record}}.\n\n{{comment}}',
  approvalOooSubstitutedTitle: 'Aprobación asignada a usted (suplencia por ausencia)',
  approvalOooSubstitutedBody: 'Está cubriendo una aprobación de {{object}} {{record}} mientras {{person}} está ausente.',
  approvalOooSkippedTitle: 'Aprobación derivada a su suplente',
  approvalOooSkippedBody: 'Una aprobación de {{object}} {{record}} se ha derivado a {{person}} mientras usted está ausente.',
  approvalEscalatedTitle: 'Aprobación escalada a usted',
  approvalEscalatedBody: 'Se le ha escalado una aprobación vencida de {{object}} {{record}}.',
  approvalReassignedTitle: 'Aprobación transferida a usted',
  approvalReassignedBody: 'Ahora es aprobador de {{object}} {{record}}.',
  approvalAutoRejectedTitle: 'Aprobación rechazada automáticamente',
  approvalAutoRejectedBody: 'Su {{object}} {{record}} superó el límite de revisiones ({{limit}}) y se ha rechazado.',
  approvalReturnedTitle: 'Devuelto para revisión',
  approvalReturnedBody: 'Su {{object}} {{record}} necesita cambios antes de poder aprobarse.',
  approvalRequestInfoTitle: 'Se solicita más información',
  approvalCommentTitle: 'Nuevo comentario en una aprobación',
  approvalAdminRescueNote: 'Asignada a los administradores de esta organización porque la lista de aprobadores no nombraba a nadie: {{reason}}.',
  approvalAdminRescuePositionUnheld: "el puesto '{{value}}' no tiene titular",
  approvalAdminRescueSlotUnresolved: "{{type}} '{{value}}' no se resolvió a nadie",
  approvalAdminRescueNoApprover: 'ningún aprobador del nodo se resolvió a una persona',
  approvalAdminRescueFallbackUnresolved: 'los fallbackApprovers declarados tampoco se resolvieron a nadie',
  approvalAdminRescueFallbackUndeclared: "onEmptyApprovers es 'fallback' pero no se han declarado fallbackApprovers",
  approvalAdminRescueReasonSeparator: '; ',
};

/** The four shipped locales, keyed as the bundle beside this file keys them. */
export const approvalMessages: Readonly<Record<'en' | 'zh-CN' | 'ja-JP' | 'es-ES', ApprovalMessages>> = {
  en: enMessages,
  'zh-CN': zhCNMessages,
  'ja-JP': jaJPMessages,
  'es-ES': esESMessages,
};
