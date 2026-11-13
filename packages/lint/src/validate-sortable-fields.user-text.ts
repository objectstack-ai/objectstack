// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The user-facing sentence of `validate-sortable-fields.ts`'s list-view
 * advisory, in every platform locale (`PLATFORM_LOCALE_TAGS`,
 * `@objectstack/spec/system`). The finding mechanism and the locale ladder are
 * `finding-user-text.ts`'s; this file is the rule's own half of it, kept beside
 * the rule so its wording and its translations change together.
 *
 * Who reads it: the person who saved an object's list view, or a standalone
 * list view, in Studio, in their own language, once the save door composes
 * `RuntimeAuthoringIssueSchema.userMessage` from it. So the sentence says what
 * the list shows and the one change that fixes it, in the console's words
 * (list view, external object, sort, fields, remote table); the developer-facing
 * detail stays in the finding's `message`, `hint` and `os explain` entry.
 *
 * `sort-field-unprovisioned` reaches the publish door on `object` and `view`
 * writes (the reference-integrity suite member `validateSortableFields`). Every
 * other id this file emits is an `error`, except the page-sort warning
 * `page-field-unprovisioned`: that id's constant, its other push site and its
 * sentences belong to `validate-page-field-bindings.ts`, so its catalog is that
 * file's (a rule id has one owner), and the page-sort push site here carries
 * no params until that catalog sets them.
 *
 * The entry reads the `userTextParams` its finding carries, set at the push
 * site in `checkSortDeclaration`:
 *
 * | rule id | params |
 * |---|---|
 * | `sort-field-unprovisioned` | `object` (the external object), `field` (the injected column the sort names) |
 *
 * Names are the API names the rule saw, not labels, for the reason
 * `validate-security-posture.user-text.ts` gives.
 *
 * `finding-user-text.data-model.test.ts` renders the entry from the rule's
 * real findings in every platform locale.
 */

import type { UserTextCatalog } from './finding-user-text.js';
import { SORT_FIELD_UNPROVISIONED } from './validate-sortable-fields.js';

export const SORTABLE_FIELDS_USER_TEXT: UserTextCatalog = Object.freeze({
  [SORT_FIELD_UNPROVISIONED]: {
    en: (p) =>
      `A list view of external object "${p.object}" sorts by "${p.field}", a column the platform adds to the ` +
      `object without storing it, so the sort is ignored and records come back in no particular order. If the ` +
      `remote table has "${p.field}", add it to the fields of "${p.object}"; otherwise sort by another field.`,
    'zh-Hans': (p) =>
      `外部对象“${p.object}”的列表视图按“${p.field}”排序，这是平台为该对象添加但并不存储的列，因此该排序会被忽略，` +
      `记录以任意顺序返回。如果远程表中有“${p.field}”，请将其添加到“${p.object}”的字段中；否则请改用其他字段排序。`,
    'zh-Hant': (p) =>
      `外部物件「${p.object}」的列表檢視依「${p.field}」排序，這是平台為該物件新增但並不儲存的欄位，因此該排序會被` +
      `忽略，記錄以任意順序傳回。如果遠端資料表中有「${p.field}」，請將其加入「${p.object}」的欄位；否則請改用其他` +
      `欄位排序。`,
    es: (p) =>
      `Una vista de lista del objeto externo "${p.object}" ordena por "${p.field}", una columna que la plataforma ` +
      `añade al objeto sin almacenarla, así que el orden se ignora y los registros llegan sin un orden concreto. Si ` +
      `la tabla remota tiene "${p.field}", agréguela a los campos de "${p.object}"; de lo contrario, ordene por ` +
      `otro campo.`,
    ar: (p) =>
      `يرتّب عرض قائمة للكائن الخارجي "${p.object}" حسب "${p.field}"، وهو عمود تضيفه المنصة إلى الكائن دون ` +
      `تخزينه، لذا يُتجاهل الترتيب وتُعاد السجلات بترتيب عشوائي. إذا كان الجدول البعيد يحتوي على "${p.field}"، ` +
      `فأضفه إلى حقول "${p.object}"؛ وإلا فرتّب حسب حقل آخر.`,
    fr: (p) =>
      `Une vue de liste de l’objet externe « ${p.object} » trie par « ${p.field} », une colonne que la plateforme ` +
      `ajoute à l’objet sans la stocker : le tri est ignoré et les enregistrements arrivent dans un ordre ` +
      `quelconque. Si la table distante contient « ${p.field} », ajoutez-la aux champs de « ${p.object} » ; sinon, ` +
      `triez par un autre champ.`,
    'pt-BR': (p) =>
      `Uma visualização de lista do objeto externo "${p.object}" ordena por "${p.field}", uma coluna que a ` +
      `plataforma adiciona ao objeto sem armazená-la, então a ordenação é ignorada e os registros vêm em ordem ` +
      `aleatória. Se a tabela remota tiver "${p.field}", adicione-a aos campos de "${p.object}"; caso contrário, ` +
      `ordene por outro campo.`,
    ru: (p) =>
      `Представление списка внешнего объекта «${p.object}» сортирует по «${p.field}» — столбцу, который платформа ` +
      `добавляет к объекту, но не хранит, поэтому сортировка игнорируется и записи приходят в произвольном ` +
      `порядке. Если в удалённой таблице есть «${p.field}», добавьте его в поля «${p.object}»; иначе сортируйте ` +
      `по другому полю.`,
    de: (p) =>
      `Eine Listenansicht des externen Objekts „${p.object}“ sortiert nach „${p.field}“, einer Spalte, die die ` +
      `Plattform dem Objekt hinzufügt, ohne sie zu speichern. Die Sortierung wird daher ignoriert, und die ` +
      `Datensätze kommen in beliebiger Reihenfolge. Wenn die entfernte Tabelle „${p.field}“ enthält, fügen Sie die ` +
      `Spalte den Feldern von „${p.object}“ hinzu; andernfalls sortieren Sie nach einem anderen Feld.`,
    ja: (p) =>
      `外部オブジェクト「${p.object}」のリストビューは「${p.field}」で並べ替えますが、これはプラットフォームが` +
      `オブジェクトに追加するだけで保存しない列のため、並べ替えは無視され、レコードは順不同で返されます。` +
      `リモートテーブルに「${p.field}」がある場合は「${p.object}」のフィールドに追加し、ない場合は別のフィールドで` +
      `並べ替えてください。`,
    ko: (p) =>
      `외부 개체 "${p.object}"의 목록 보기는 "${p.field}"(으)로 정렬하는데, 이는 플랫폼이 개체에 추가하지만 ` +
      `저장하지 않는 열이므로 정렬이 무시되고 레코드가 임의의 순서로 반환됩니다. 원격 테이블에 ` +
      `"${p.field}"이(가) 있으면 "${p.object}"의 필드에 추가하고, 없으면 다른 필드로 정렬하세요.`,
  },
});
