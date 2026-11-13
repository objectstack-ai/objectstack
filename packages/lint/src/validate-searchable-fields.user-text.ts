// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The user-facing sentence of `validate-searchable-fields.ts`'s advisory, in
 * every platform locale (`PLATFORM_LOCALE_TAGS`, `@objectstack/spec/system`).
 * The finding mechanism and the locale ladder are `finding-user-text.ts`'s;
 * this file is the rule's own half of it, kept beside the rule so its wording
 * and its translations change together.
 *
 * Who reads it: the person who saved an object, or a list view, in Studio, in
 * their own language, once the save door composes
 * `RuntimeAuthoringIssueSchema.userMessage` from it. So the sentence says what
 * search does and the one change that fixes it, in the console's words
 * (external object, searchable fields, list, search, fields, remote table); the
 * developer-facing detail stays in the finding's `message`, `hint` and
 * `os explain` entry.
 *
 * `searchable-field-unprovisioned` reaches the publish door on `object` and
 * `view` writes (the reference-integrity suite member
 * `validateSearchableFields`); the file's other ids are errors.
 *
 * The entry reads the `userTextParams` its finding carries, set at the push
 * site in `checkSearchableFieldList` (so every caller of that core carries
 * them, the page-component one in `validate-react-page-props.ts` included):
 *
 * | rule id | params |
 * |---|---|
 * | `searchable-field-unprovisioned` | `object` (the external object), `field` (the injected column), `role` (`canonical` · `narrowing`) |
 *
 * `role` is the rule's own split: the object's own `searchableFields`
 * (`canonical`) against a list's narrowing of them (`narrowing`), whose
 * `message` names a different consequence, so the sentence has one arm per
 * value. Names are the API names the rule saw, not labels, for the reason
 * `validate-security-posture.user-text.ts` gives.
 *
 * `finding-user-text.data-model.test.ts` renders the entry from the rule's
 * real findings in every platform locale.
 */

import type { UserTextCatalog } from './finding-user-text.js';
import { SEARCHABLE_FIELD_UNPROVISIONED } from './validate-searchable-fields.js';

/** `role` of a finding on the object's own `searchableFields`. */
const CANONICAL = 'canonical';

export const SEARCHABLE_FIELDS_USER_TEXT: UserTextCatalog = Object.freeze({
  [SEARCHABLE_FIELD_UNPROVISIONED]: {
    en: (p) =>
      p.role === CANONICAL
        ? `The searchable fields of external object "${p.object}" include "${p.field}", a column the platform adds ` +
          `to the object without storing it, so search never matches it. If the remote table has "${p.field}", add ` +
          `it to the fields of "${p.object}"; otherwise remove it from the searchable fields.`
        : `A list of external object "${p.object}" searches "${p.field}", a column the platform adds to the object ` +
          `without storing it, so the list's search finds nothing there. If the remote table has "${p.field}", add ` +
          `it to the fields of "${p.object}"; otherwise remove it from the list's search fields.`,
    'zh-Hans': (p) =>
      p.role === CANONICAL
        ? `外部对象“${p.object}”的可搜索字段包含“${p.field}”，这是平台为该对象添加但并不存储的列，因此搜索永远` +
          `不会匹配到它。如果远程表中有“${p.field}”，请将其添加到“${p.object}”的字段中；否则请将其从可搜索字段中删除。`
        : `外部对象“${p.object}”的列表会搜索“${p.field}”，这是平台为该对象添加但并不存储的列，因此列表搜索在其中` +
          `找不到任何内容。如果远程表中有“${p.field}”，请将其添加到“${p.object}”的字段中；否则请将其从列表的搜索字段中删除。`,
    'zh-Hant': (p) =>
      p.role === CANONICAL
        ? `外部物件「${p.object}」的可搜尋欄位包含「${p.field}」，這是平台為該物件新增但並不儲存的欄位，因此搜尋永遠` +
          `不會比對到它。如果遠端資料表中有「${p.field}」，請將其加入「${p.object}」的欄位；否則請將其從可搜尋欄位中刪除。`
        : `外部物件「${p.object}」的清單會搜尋「${p.field}」，這是平台為該物件新增但並不儲存的欄位，因此清單搜尋在其中` +
          `找不到任何內容。如果遠端資料表中有「${p.field}」，請將其加入「${p.object}」的欄位；否則請將其從清單的搜尋欄位中刪除。`,
    es: (p) =>
      p.role === CANONICAL
        ? `Los campos de búsqueda del objeto externo "${p.object}" incluyen "${p.field}", una columna que la ` +
          `plataforma añade al objeto sin almacenarla, así que la búsqueda nunca la encuentra. Si la tabla remota ` +
          `tiene "${p.field}", agréguela a los campos de "${p.object}"; de lo contrario, quítela de los campos de búsqueda.`
        : `Una lista del objeto externo "${p.object}" busca en "${p.field}", una columna que la plataforma añade al ` +
          `objeto sin almacenarla, así que la búsqueda de la lista no encuentra nada ahí. Si la tabla remota tiene ` +
          `"${p.field}", agréguela a los campos de "${p.object}"; de lo contrario, quítela de los campos de búsqueda ` +
          `de la lista.`,
    ar: (p) =>
      p.role === CANONICAL
        ? `تتضمن حقول البحث للكائن الخارجي "${p.object}" الحقل "${p.field}"، وهو عمود تضيفه المنصة إلى الكائن دون ` +
          `تخزينه، لذا لا يطابقه البحث أبدًا. إذا كان الجدول البعيد يحتوي على "${p.field}"، فأضفه إلى حقول ` +
          `"${p.object}"؛ وإلا فأزله من حقول البحث.`
        : `تبحث قائمة للكائن الخارجي "${p.object}" في "${p.field}"، وهو عمود تضيفه المنصة إلى الكائن دون تخزينه، ` +
          `لذا لا يجد بحث القائمة فيه شيئًا. إذا كان الجدول البعيد يحتوي على "${p.field}"، فأضفه إلى حقول ` +
          `"${p.object}"؛ وإلا فأزله من حقول البحث في القائمة.`,
    fr: (p) =>
      p.role === CANONICAL
        ? `Les champs de recherche de l’objet externe « ${p.object} » incluent « ${p.field} », une colonne que la ` +
          `plateforme ajoute à l’objet sans la stocker : la recherche ne la trouve jamais. Si la table distante ` +
          `contient « ${p.field} », ajoutez-la aux champs de « ${p.object} » ; sinon, retirez-la des champs de recherche.`
        : `Une liste de l’objet externe « ${p.object} » recherche dans « ${p.field} », une colonne que la plateforme ` +
          `ajoute à l’objet sans la stocker : la recherche de la liste n’y trouve rien. Si la table distante contient ` +
          `« ${p.field} », ajoutez-la aux champs de « ${p.object} » ; sinon, retirez-la des champs de recherche de la liste.`,
    'pt-BR': (p) =>
      p.role === CANONICAL
        ? `Os campos de pesquisa do objeto externo "${p.object}" incluem "${p.field}", uma coluna que a plataforma ` +
          `adiciona ao objeto sem armazená-la, então a pesquisa nunca a encontra. Se a tabela remota tiver ` +
          `"${p.field}", adicione-a aos campos de "${p.object}"; caso contrário, remova-a dos campos de pesquisa.`
        : `Uma lista do objeto externo "${p.object}" pesquisa em "${p.field}", uma coluna que a plataforma adiciona ` +
          `ao objeto sem armazená-la, então a pesquisa da lista não encontra nada ali. Se a tabela remota tiver ` +
          `"${p.field}", adicione-a aos campos de "${p.object}"; caso contrário, remova-a dos campos de pesquisa da lista.`,
    ru: (p) =>
      p.role === CANONICAL
        ? `Поля поиска внешнего объекта «${p.object}» включают «${p.field}» — столбец, который платформа добавляет к ` +
          `объекту, но не хранит, поэтому поиск никогда его не находит. Если в удалённой таблице есть «${p.field}», ` +
          `добавьте его в поля «${p.object}»; иначе уберите его из полей поиска.`
        : `Список внешнего объекта «${p.object}» ищет по «${p.field}» — столбцу, который платформа добавляет к ` +
          `объекту, но не хранит, поэтому поиск в списке ничего в нём не находит. Если в удалённой таблице есть ` +
          `«${p.field}», добавьте его в поля «${p.object}»; иначе уберите его из полей поиска списка.`,
    de: (p) =>
      p.role === CANONICAL
        ? `Die Suchfelder des externen Objekts „${p.object}“ enthalten „${p.field}“, eine Spalte, die die Plattform ` +
          `dem Objekt hinzufügt, ohne sie zu speichern. Die Suche findet darin daher nie etwas. Wenn die entfernte ` +
          `Tabelle „${p.field}“ enthält, fügen Sie die Spalte den Feldern von „${p.object}“ hinzu; andernfalls ` +
          `entfernen Sie sie aus den Suchfeldern.`
        : `Eine Liste des externen Objekts „${p.object}“ durchsucht „${p.field}“, eine Spalte, die die Plattform dem ` +
          `Objekt hinzufügt, ohne sie zu speichern. Die Suche der Liste findet darin daher nichts. Wenn die entfernte ` +
          `Tabelle „${p.field}“ enthält, fügen Sie die Spalte den Feldern von „${p.object}“ hinzu; andernfalls ` +
          `entfernen Sie sie aus den Suchfeldern der Liste.`,
    ja: (p) =>
      p.role === CANONICAL
        ? `外部オブジェクト「${p.object}」の検索対象フィールドに「${p.field}」が含まれていますが、これはプラットフォームが` +
          `オブジェクトに追加するだけで保存しない列のため、検索で一致することはありません。リモートテーブルに` +
          `「${p.field}」がある場合は「${p.object}」のフィールドに追加し、ない場合は検索対象フィールドから削除してください。`
        : `外部オブジェクト「${p.object}」のリストは「${p.field}」を検索しますが、これはプラットフォームがオブジェクトに` +
          `追加するだけで保存しない列のため、リストの検索ではそこから何も見つかりません。リモートテーブルに` +
          `「${p.field}」がある場合は「${p.object}」のフィールドに追加し、ない場合はリストの検索フィールドから削除してください。`,
    ko: (p) =>
      p.role === CANONICAL
        ? `외부 개체 "${p.object}"의 검색 필드에 "${p.field}"이(가) 포함되어 있는데, 이는 플랫폼이 개체에 추가하지만 ` +
          `저장하지 않는 열이므로 검색에서 일치하는 항목이 없습니다. 원격 테이블에 "${p.field}"이(가) 있으면 ` +
          `"${p.object}"의 필드에 추가하고, 없으면 검색 필드에서 제거하세요.`
        : `외부 개체 "${p.object}"의 목록은 "${p.field}"을(를) 검색하는데, 이는 플랫폼이 개체에 추가하지만 저장하지 ` +
          `않는 열이므로 목록 검색에서 아무것도 찾지 못합니다. 원격 테이블에 "${p.field}"이(가) 있으면 ` +
          `"${p.object}"의 필드에 추가하고, 없으면 목록의 검색 필드에서 제거하세요.`,
  },
});
