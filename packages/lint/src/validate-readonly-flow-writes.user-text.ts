// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The user-facing sentence of `validate-readonly-flow-writes.ts`'s advisory
 * finding (`flow-update-readonly-when-field`), in every platform locale
 * (`PLATFORM_LOCALE_TAGS`, `@objectstack/spec/system`). The finding mechanism
 * and the locale ladder are `finding-user-text.ts`'s; this file is the rule's
 * own half of it, kept beside the rule so its wording and its translations
 * change together.
 *
 * Who reads it: the person who saved the flow in Studio, or the object whose
 * field gained the condition while a live flow writes it (the rule also judges
 * carried flows on an object write), in their own language, once the save door
 * composes `RuntimeAuthoringIssueSchema.userMessage` from it. The condition is
 * named by the field designer's own label ("Read-only when"). The rule's other
 * id, `flow-update-readonly-field`, refuses the write (`error`) and carries no
 * params.
 *
 * Params, set at the push site in `validate-readonly-flow-writes.ts`: `flow`,
 * `node` (the node's label, as the rule's `where` shows it), `field`, `object`.
 *
 * `finding-user-text.test.ts` renders it from the rule's real
 * finding in every platform locale.
 */

import type { UserTextCatalog } from './finding-user-text.js';
import { FLOW_UPDATE_READONLY_WHEN_FIELD } from './validate-readonly-flow-writes.js';

export const READONLY_FLOW_WRITES_USER_TEXT: UserTextCatalog = Object.freeze({
  [FLOW_UPDATE_READONLY_WHEN_FIELD]: {
    en: (p) =>
      `Node "${p.node}" in flow "${p.flow}" updates field "${p.field}" of "${p.object}", which has a "Read-only ` +
      `when" condition, so the change is silently dropped on records where that condition is true. Set the value ` +
      `in a before-update hook on "${p.object}", or update only records where the condition is false.`,
    'zh-Hans': (p) =>
      `流程“${p.flow}”的节点“${p.node}”更新“${p.object}”的字段“${p.field}”，而该字段设置了“只读条件”，因此在满足该条件的记录上，` +
      `这次更改会被静默丢弃。请在“${p.object}”的更新前钩子中设置该值，或只更新不满足该条件的记录。`,
    'zh-Hant': (p) =>
      `流程「${p.flow}」的節點「${p.node}」更新「${p.object}」的欄位「${p.field}」，而該欄位設定了「唯讀條件」，因此在符合該條件的記錄上，` +
      `這次變更會被靜默捨棄。請在「${p.object}」的更新前鉤子中設定該值，或只更新不符合該條件的記錄。`,
    es: (p) =>
      `El nodo "${p.node}" del flujo "${p.flow}" actualiza el campo "${p.field}" de "${p.object}", que tiene una ` +
      `condición "Solo lectura cuando", así que el cambio se descarta sin aviso en los registros donde esa ` +
      `condición se cumple. Asigne el valor en un hook previo a la actualización de "${p.object}", o actualice ` +
      `solo registros donde la condición no se cumpla.`,
    ar: (p) =>
      `تحدّث العقدة "${p.node}" في التدفق "${p.flow}" الحقل "${p.field}" في "${p.object}"، وله شرط "للقراءة فقط ` +
      `عندما"، لذلك يُتجاهل التغيير بصمت في السجلات التي يتحقق فيها هذا الشرط. اضبط القيمة في خطاف قبل التحديث ` +
      `على "${p.object}"، أو حدّث فقط السجلات التي لا يتحقق فيها الشرط.`,
    fr: (p) =>
      `Le nœud « ${p.node} » du flux « ${p.flow} » met à jour le champ « ${p.field} » de « ${p.object} », qui a ` +
      `une condition « Lecture seule si » : la modification est donc ignorée sans avertissement sur les ` +
      `enregistrements où cette condition est vraie. Définissez la valeur dans un hook avant mise à jour sur ` +
      `« ${p.object} », ou ne mettez à jour que les enregistrements où la condition est fausse.`,
    'pt-BR': (p) =>
      `O nó "${p.node}" do fluxo "${p.flow}" atualiza o campo "${p.field}" de "${p.object}", que tem uma condição ` +
      `"Somente leitura quando", então a alteração é descartada silenciosamente nos registros em que essa ` +
      `condição é verdadeira. Defina o valor em um hook antes da atualização em "${p.object}", ou atualize apenas ` +
      `registros em que a condição seja falsa.`,
    ru: (p) =>
      `Узел «${p.node}» потока «${p.flow}» обновляет поле «${p.field}» объекта «${p.object}», у которого есть ` +
      `условие «Только для чтения, если», поэтому изменение молча отбрасывается в записях, где это условие ` +
      `выполняется. Задайте значение в хуке перед обновлением «${p.object}» или обновляйте только записи, где ` +
      `условие не выполняется.`,
    de: (p) =>
      `Der Knoten „${p.node}“ im Flow „${p.flow}“ aktualisiert das Feld „${p.field}“ von „${p.object}“, das eine ` +
      `Bedingung „Schreibgeschützt, wenn“ hat. Die Änderung wird daher bei Datensätzen, für die diese Bedingung ` +
      `zutrifft, stillschweigend verworfen. Setzen Sie den Wert in einem Hook vor der Aktualisierung von ` +
      `„${p.object}“, oder aktualisieren Sie nur Datensätze, für die die Bedingung nicht zutrifft.`,
    ja: (p) =>
      `フロー「${p.flow}」のノード「${p.node}」は「${p.object}」の項目「${p.field}」を更新しますが、この項目には読み取り専用の条件が` +
      `設定されているため、その条件を満たすレコードでは変更が通知なく破棄されます。「${p.object}」の更新前フックで値を設定するか、` +
      `条件を満たさないレコードだけを更新してください。`,
    ko: (p) =>
      `플로우 "${p.flow}"의 노드 "${p.node}"는 "${p.object}"의 필드 "${p.field}"을(를) 업데이트하지만, 이 필드에는 ` +
      `읽기 전용 조건이 있으므로 조건이 참인 레코드에서는 변경이 알림 없이 버려집니다. "${p.object}"의 업데이트 전 ` +
      `후크에서 값을 설정하거나, 조건이 거짓인 레코드만 업데이트하세요.`,
  },
});
