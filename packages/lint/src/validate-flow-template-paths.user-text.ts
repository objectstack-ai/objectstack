// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The user-facing sentences of `validate-flow-template-paths.ts`'s advisory
 * findings, in every platform locale (`PLATFORM_LOCALE_TAGS`,
 * `@objectstack/spec/system`). The finding mechanism and the locale ladder are
 * `finding-user-text.ts`'s; this file is the rule's own half of it, kept beside
 * the rule so its wording and its translations change together.
 *
 * Who reads these: the person who saved a flow in Studio, in their own
 * language, once the save door composes `RuntimeAuthoringIssueSchema.userMessage`
 * from them. So each sentence names the placeholder, says it renders blank and
 * gives the one change that fixes it; the developer-facing detail stays in the
 * finding's `message`, `hint` and `os explain` entry.
 *
 * Each entry reads the `userTextParams` its finding carries, set at the push
 * site in `validate-flow-template-paths.ts`: `flow`, `reference` (the
 * placeholder's path as written, without its braces, e.g.
 * `record.crm_account.name`), `field` (its first segment, the field it reads),
 * `object` (the object the placeholder's root is bound to), and, on
 * `flow-template-lookup-traversal` only, `root` (`trigger` · `variable`: the
 * flow's own record, or a record a node bound to a variable), which decides
 * the remedy as the rule's hint does.
 *
 * `finding-user-text.test.ts` renders every entry from
 * the rule's real findings in every platform locale.
 */

import type { UserTextCatalog } from './finding-user-text.js';
import {
  FLOW_TEMPLATE_FIELD_UNPROVISIONED,
  FLOW_TEMPLATE_LOOKUP_TRAVERSAL,
  FLOW_TEMPLATE_UNKNOWN_FIELD,
} from './validate-flow-template-paths.js';

export const FLOW_TEMPLATE_PATHS_USER_TEXT: UserTextCatalog = Object.freeze({
  [FLOW_TEMPLATE_UNKNOWN_FIELD]: {
    en: (p) =>
      `In flow "${p.flow}", the placeholder {{ ${p.reference} }} refers to "${p.field}", which is not a field of ` +
      `object "${p.object}", so it is always blank. Check the field name against the object's fields.`,
    'zh-Hans': (p) =>
      `在流程“${p.flow}”中，占位符 {{ ${p.reference} }} 引用了“${p.field}”，但它不是对象“${p.object}”的字段，因此始终为空。` +
      `请对照该对象的字段检查字段名称。`,
    'zh-Hant': (p) =>
      `在流程「${p.flow}」中，預留位置 {{ ${p.reference} }} 參照了「${p.field}」，但它不是物件「${p.object}」的欄位，因此始終為空。` +
      `請對照該物件的欄位檢查欄位名稱。`,
    es: (p) =>
      `En el flujo "${p.flow}", el marcador {{ ${p.reference} }} hace referencia a "${p.field}", que no es un ` +
      `campo del objeto "${p.object}", así que siempre queda vacío. Compruebe el nombre del campo con los campos ` +
      `del objeto.`,
    ar: (p) =>
      `في التدفق "${p.flow}"، يشير العنصر النائب {{ ${p.reference} }} إلى "${p.field}"، وهو ليس حقلًا في الكائن ` +
      `"${p.object}"، لذلك يظهر فارغًا دائمًا. تحقق من اسم الحقل مقارنةً بحقول الكائن.`,
    fr: (p) =>
      `Dans le flux « ${p.flow} », l’espace réservé {{ ${p.reference} }} fait référence à « ${p.field} », qui ` +
      `n’est pas un champ de l’objet « ${p.object} » : il reste donc toujours vide. Vérifiez le nom du champ par ` +
      `rapport aux champs de l’objet.`,
    'pt-BR': (p) =>
      `No fluxo "${p.flow}", o marcador {{ ${p.reference} }} se refere a "${p.field}", que não é um campo do ` +
      `objeto "${p.object}", então ele fica sempre em branco. Confira o nome do campo com os campos do objeto.`,
    ru: (p) =>
      `В потоке «${p.flow}» заполнитель {{ ${p.reference} }} ссылается на «${p.field}», но это не поле объекта ` +
      `«${p.object}», поэтому он всегда пуст. Сверьте имя поля с полями объекта.`,
    de: (p) =>
      `Im Flow „${p.flow}“ verweist der Platzhalter {{ ${p.reference} }} auf „${p.field}“, das kein Feld des ` +
      `Objekts „${p.object}“ ist. Er bleibt daher immer leer. Prüfen Sie den Feldnamen anhand der Felder des ` +
      `Objekts.`,
    ja: (p) =>
      `フロー「${p.flow}」で、プレースホルダー {{ ${p.reference} }} は「${p.field}」を参照していますが、これはオブジェクト` +
      `「${p.object}」の項目ではないため、常に空になります。オブジェクトの項目と照らし合わせて項目名を確認してください。`,
    ko: (p) =>
      `플로우 "${p.flow}"에서 자리 표시자 {{ ${p.reference} }}는 "${p.field}"을(를) 참조하지만, 이는 개체 ` +
      `"${p.object}"의 필드가 아니므로 항상 비어 있습니다. 개체의 필드와 비교해 필드 이름을 확인하세요.`,
  },
  [FLOW_TEMPLATE_LOOKUP_TRAVERSAL]: {
    en: (p) =>
      `In flow "${p.flow}", the placeholder {{ ${p.reference} }} reads through relationship field "${p.field}", ` +
      `but the record there holds only the related record's ID, so it is always blank. ` +
      (p.root === 'variable'
        ? `Read the related record with a get-record node, or use a formula field on "${p.object}".`
        : `Expand "${p.field}" on the start node, or use a formula field on "${p.object}".`),
    'zh-Hans': (p) =>
      `在流程“${p.flow}”中，占位符 {{ ${p.reference} }} 通过关联字段“${p.field}”读取数据，但该记录中只保存了关联记录的 ID，因此始终为空。` +
      (p.root === 'variable'
        ? `请用“获取记录”节点读取关联记录，或在“${p.object}”上使用公式字段。`
        : `请在开始节点中展开“${p.field}”，或在“${p.object}”上使用公式字段。`),
    'zh-Hant': (p) =>
      `在流程「${p.flow}」中，預留位置 {{ ${p.reference} }} 透過關聯欄位「${p.field}」讀取資料，但該記錄中只保存了關聯記錄的 ID，因此始終為空。` +
      (p.root === 'variable'
        ? `請用「取得記錄」節點讀取關聯記錄，或在「${p.object}」上使用公式欄位。`
        : `請在開始節點中展開「${p.field}」，或在「${p.object}」上使用公式欄位。`),
    es: (p) =>
      `En el flujo "${p.flow}", el marcador {{ ${p.reference} }} lee a través del campo de relación ` +
      `"${p.field}", pero ese registro solo guarda el ID del registro relacionado, así que siempre queda vacío. ` +
      (p.root === 'variable'
        ? `Lea el registro relacionado con un nodo de obtener registro, o use un campo de fórmula en "${p.object}".`
        : `Expanda "${p.field}" en el nodo de inicio, o use un campo de fórmula en "${p.object}".`),
    ar: (p) =>
      `في التدفق "${p.flow}"، يقرأ العنصر النائب {{ ${p.reference} }} عبر حقل العلاقة "${p.field}"، لكن ذلك ` +
      `السجل لا يحمل إلا معرّف السجل المرتبط، لذلك يظهر فارغًا دائمًا. ` +
      (p.root === 'variable'
        ? `اقرأ السجل المرتبط بعقدة جلب سجل، أو استخدم حقل صيغة في "${p.object}".`
        : `وسّع "${p.field}" في عقدة البدء، أو استخدم حقل صيغة في "${p.object}".`),
    fr: (p) =>
      `Dans le flux « ${p.flow} », l’espace réservé {{ ${p.reference} }} lit à travers le champ de relation ` +
      `« ${p.field} », mais cet enregistrement ne contient que l’ID de l’enregistrement lié : il reste donc ` +
      `toujours vide. ` +
      (p.root === 'variable'
        ? `Lisez l’enregistrement lié avec un nœud de lecture d’enregistrement, ou utilisez un champ formule sur ` +
          `« ${p.object} ».`
        : `Développez « ${p.field} » sur le nœud de départ, ou utilisez un champ formule sur « ${p.object} ».`),
    'pt-BR': (p) =>
      `No fluxo "${p.flow}", o marcador {{ ${p.reference} }} lê através do campo de relacionamento ` +
      `"${p.field}", mas esse registro guarda apenas o ID do registro relacionado, então ele fica sempre em ` +
      `branco. ` +
      (p.root === 'variable'
        ? `Leia o registro relacionado com um nó de obter registro, ou use um campo de fórmula em "${p.object}".`
        : `Expanda "${p.field}" no nó inicial, ou use um campo de fórmula em "${p.object}".`),
    ru: (p) =>
      `В потоке «${p.flow}» заполнитель {{ ${p.reference} }} читает данные через поле связи «${p.field}», но эта ` +
      `запись хранит только ID связанной записи, поэтому он всегда пуст. ` +
      (p.root === 'variable'
        ? `Прочитайте связанную запись узлом получения записи или используйте поле-формулу в «${p.object}».`
        : `Раскройте «${p.field}» в начальном узле или используйте поле-формулу в «${p.object}».`),
    de: (p) =>
      `Im Flow „${p.flow}“ liest der Platzhalter {{ ${p.reference} }} über das Beziehungsfeld „${p.field}“, aber ` +
      `dieser Datensatz enthält nur die ID des verknüpften Datensatzes. Er bleibt daher immer leer. ` +
      (p.root === 'variable'
        ? `Lesen Sie den verknüpften Datensatz mit einem Knoten zum Abrufen eines Datensatzes, oder verwenden Sie ` +
          `ein Formelfeld auf „${p.object}“.`
        : `Erweitern Sie „${p.field}“ im Startknoten, oder verwenden Sie ein Formelfeld auf „${p.object}“.`),
    ja: (p) =>
      `フロー「${p.flow}」で、プレースホルダー {{ ${p.reference} }} は関連項目「${p.field}」を経由して読み取りますが、` +
      `そのレコードには関連レコードの ID しかないため、常に空になります。` +
      (p.root === 'variable'
        ? `レコード取得ノードで関連レコードを読み取るか、「${p.object}」の数式項目を使用してください。`
        : `開始ノードで「${p.field}」を展開するか、「${p.object}」の数式項目を使用してください。`),
    ko: (p) =>
      `플로우 "${p.flow}"에서 자리 표시자 {{ ${p.reference} }}는 관계 필드 "${p.field}"을(를) 거쳐 읽지만, 그 레코드에는 ` +
      `관련 레코드의 ID만 있으므로 항상 비어 있습니다. ` +
      (p.root === 'variable'
        ? `레코드 가져오기 노드로 관련 레코드를 읽거나 "${p.object}"의 수식 필드를 사용하세요.`
        : `시작 노드에서 "${p.field}"을(를) 확장하거나 "${p.object}"의 수식 필드를 사용하세요.`),
  },
  [FLOW_TEMPLATE_FIELD_UNPROVISIONED]: {
    en: (p) =>
      `In flow "${p.flow}", the placeholder {{ ${p.reference} }} reads "${p.field}", a system field that ` +
      `external object "${p.object}" has no storage for, so it is always blank. If the external table has this ` +
      `column, add "${p.field}" to the object's fields; otherwise remove the placeholder.`,
    'zh-Hans': (p) =>
      `在流程“${p.flow}”中，占位符 {{ ${p.reference} }} 读取“${p.field}”，这是一个系统字段，而外部对象“${p.object}”没有为它提供存储，` +
      `因此始终为空。如果外部表中有这一列，请把“${p.field}”添加到该对象的字段中；否则请删除该占位符。`,
    'zh-Hant': (p) =>
      `在流程「${p.flow}」中，預留位置 {{ ${p.reference} }} 讀取「${p.field}」，這是一個系統欄位，而外部物件「${p.object}」沒有為它提供儲存，` +
      `因此始終為空。如果外部資料表中有這一欄，請把「${p.field}」新增到該物件的欄位中；否則請刪除該預留位置。`,
    es: (p) =>
      `En el flujo "${p.flow}", el marcador {{ ${p.reference} }} lee "${p.field}", un campo del sistema para el ` +
      `que el objeto externo "${p.object}" no tiene almacenamiento, así que siempre queda vacío. Si la tabla ` +
      `externa tiene esa columna, añada "${p.field}" a los campos del objeto; si no, quite el marcador.`,
    ar: (p) =>
      `في التدفق "${p.flow}"، يقرأ العنصر النائب {{ ${p.reference} }} الحقل "${p.field}"، وهو حقل نظام لا يملك ` +
      `الكائن الخارجي "${p.object}" تخزينًا له، لذلك يظهر فارغًا دائمًا. إذا كان الجدول الخارجي يحتوي على هذا ` +
      `العمود، فأضف "${p.field}" إلى حقول الكائن؛ وإلا فأزل العنصر النائب.`,
    fr: (p) =>
      `Dans le flux « ${p.flow} », l’espace réservé {{ ${p.reference} }} lit « ${p.field} », un champ système ` +
      `pour lequel l’objet externe « ${p.object} » n’a pas de stockage : il reste donc toujours vide. Si la table ` +
      `externe possède cette colonne, ajoutez « ${p.field} » aux champs de l’objet ; sinon, supprimez l’espace ` +
      `réservé.`,
    'pt-BR': (p) =>
      `No fluxo "${p.flow}", o marcador {{ ${p.reference} }} lê "${p.field}", um campo do sistema para o qual o ` +
      `objeto externo "${p.object}" não tem armazenamento, então ele fica sempre em branco. Se a tabela externa ` +
      `tiver essa coluna, adicione "${p.field}" aos campos do objeto; caso contrário, remova o marcador.`,
    ru: (p) =>
      `В потоке «${p.flow}» заполнитель {{ ${p.reference} }} читает «${p.field}» — системное поле, для которого у ` +
      `внешнего объекта «${p.object}» нет хранилища, поэтому он всегда пуст. Если во внешней таблице есть такой ` +
      `столбец, добавьте «${p.field}» в поля объекта; иначе удалите заполнитель.`,
    de: (p) =>
      `Im Flow „${p.flow}“ liest der Platzhalter {{ ${p.reference} }} „${p.field}“, ein Systemfeld, für das das ` +
      `externe Objekt „${p.object}“ keinen Speicher hat. Er bleibt daher immer leer. Hat die externe Tabelle diese ` +
      `Spalte, fügen Sie „${p.field}“ zu den Feldern des Objekts hinzu; andernfalls entfernen Sie den Platzhalter.`,
    ja: (p) =>
      `フロー「${p.flow}」で、プレースホルダー {{ ${p.reference} }} はシステム項目「${p.field}」を読み取りますが、外部オブジェクト` +
      `「${p.object}」にはこの項目の保存先がないため、常に空になります。外部テーブルにこの列がある場合は「${p.field}」を` +
      `オブジェクトの項目に追加し、ない場合はプレースホルダーを削除してください。`,
    ko: (p) =>
      `플로우 "${p.flow}"에서 자리 표시자 {{ ${p.reference} }}는 시스템 필드 "${p.field}"을(를) 읽지만, 외부 개체 ` +
      `"${p.object}"에는 이 필드의 저장 공간이 없으므로 항상 비어 있습니다. 외부 테이블에 이 열이 있다면 ` +
      `"${p.field}"을(를) 개체의 필드에 추가하고, 없다면 자리 표시자를 제거하세요.`,
  },
});
