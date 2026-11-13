// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The user-facing sentence of `validate-flow-node-writes.ts`'s advisory finding
 * (`flow-node-write-unprovisioned-anchor`), in every platform locale
 * (`PLATFORM_LOCALE_TAGS`, `@objectstack/spec/system`). The finding mechanism
 * and the locale ladder are `finding-user-text.ts`'s; this file is the rule's
 * own half of it, kept beside the rule so its wording and its translations
 * change together.
 *
 * Who reads it: the person who saved a flow in Studio, in their own language,
 * once the save door composes `RuntimeAuthoringIssueSchema.userMessage` from
 * it. The rule's other id, `flow-node-write-unknown-field`, refuses the write
 * (`error`) and carries no params.
 *
 * Params, set at the push site in `validate-flow-node-writes.ts`: `flow`,
 * `node` (the node's label, as the rule's `where` shows it), `field`, `object`.
 *
 * `finding-user-text.test.ts` renders it from the rule's real
 * finding in every platform locale.
 */

import type { UserTextCatalog } from './finding-user-text.js';
import { FLOW_NODE_WRITE_UNPROVISIONED_ANCHOR } from './validate-flow-node-writes.js';

export const FLOW_NODE_WRITES_USER_TEXT: UserTextCatalog = Object.freeze({
  [FLOW_NODE_WRITE_UNPROVISIONED_ANCHOR]: {
    en: (p) =>
      `Node "${p.node}" in flow "${p.flow}" writes "${p.field}", a system field that external object ` +
      `"${p.object}" has no storage for, so the value is never saved. If the external table has this column, add ` +
      `"${p.field}" to the object's fields; otherwise remove it from the node.`,
    'zh-Hans': (p) =>
      `流程“${p.flow}”的节点“${p.node}”写入“${p.field}”，这是一个系统字段，而外部对象“${p.object}”没有为它提供存储，因此该值永远不会被保存。` +
      `如果外部表中有这一列，请把“${p.field}”添加到该对象的字段中；否则请从该节点中删除它。`,
    'zh-Hant': (p) =>
      `流程「${p.flow}」的節點「${p.node}」寫入「${p.field}」，這是一個系統欄位，而外部物件「${p.object}」沒有為它提供儲存，因此該值永遠不會被儲存。` +
      `如果外部資料表中有這一欄，請把「${p.field}」新增到該物件的欄位中；否則請從該節點中刪除它。`,
    es: (p) =>
      `El nodo "${p.node}" del flujo "${p.flow}" escribe "${p.field}", un campo del sistema para el que el objeto ` +
      `externo "${p.object}" no tiene almacenamiento, así que el valor nunca se guarda. Si la tabla externa tiene ` +
      `esa columna, añada "${p.field}" a los campos del objeto; si no, quítelo del nodo.`,
    ar: (p) =>
      `تكتب العقدة "${p.node}" في التدفق "${p.flow}" الحقل "${p.field}"، وهو حقل نظام لا يملك الكائن الخارجي ` +
      `"${p.object}" تخزينًا له، لذلك لا تُحفظ القيمة أبدًا. إذا كان الجدول الخارجي يحتوي على هذا العمود، فأضف ` +
      `"${p.field}" إلى حقول الكائن؛ وإلا فأزله من العقدة.`,
    fr: (p) =>
      `Le nœud « ${p.node} » du flux « ${p.flow} » écrit « ${p.field} », un champ système pour lequel l’objet ` +
      `externe « ${p.object} » n’a pas de stockage : la valeur n’est donc jamais enregistrée. Si la table externe ` +
      `possède cette colonne, ajoutez « ${p.field} » aux champs de l’objet ; sinon, retirez-le du nœud.`,
    'pt-BR': (p) =>
      `O nó "${p.node}" do fluxo "${p.flow}" grava "${p.field}", um campo do sistema para o qual o objeto externo ` +
      `"${p.object}" não tem armazenamento, então o valor nunca é salvo. Se a tabela externa tiver essa coluna, ` +
      `adicione "${p.field}" aos campos do objeto; caso contrário, remova-o do nó.`,
    ru: (p) =>
      `Узел «${p.node}» потока «${p.flow}» записывает «${p.field}» — системное поле, для которого у внешнего объекта ` +
      `«${p.object}» нет хранилища, поэтому значение никогда не сохраняется. Если во внешней таблице есть такой ` +
      `столбец, добавьте «${p.field}» в поля объекта; иначе удалите его из узла.`,
    de: (p) =>
      `Der Knoten „${p.node}“ im Flow „${p.flow}“ schreibt „${p.field}“, ein Systemfeld, für das das externe Objekt ` +
      `„${p.object}“ keinen Speicher hat. Der Wert wird daher nie gespeichert. Hat die externe Tabelle diese ` +
      `Spalte, fügen Sie „${p.field}“ zu den Feldern des Objekts hinzu; andernfalls entfernen Sie es aus dem Knoten.`,
    ja: (p) =>
      `フロー「${p.flow}」のノード「${p.node}」はシステム項目「${p.field}」に書き込みますが、外部オブジェクト「${p.object}」には` +
      `この項目の保存先がないため、値は保存されません。外部テーブルにこの列がある場合は「${p.field}」をオブジェクトの項目に追加し、` +
      `ない場合はノードから削除してください。`,
    ko: (p) =>
      `플로우 "${p.flow}"의 노드 "${p.node}"는 시스템 필드 "${p.field}"에 쓰지만, 외부 개체 "${p.object}"에는 이 필드의 ` +
      `저장 공간이 없으므로 값이 저장되지 않습니다. 외부 테이블에 이 열이 있다면 "${p.field}"을(를) 개체의 필드에 ` +
      `추가하고, 없다면 노드에서 제거하세요.`,
  },
});
