// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The user-facing sentence of `page-field-unprovisioned`, the advisory id
 * `validate-page-field-bindings.ts` owns, in every platform locale
 * (`PLATFORM_LOCALE_TAGS`, `@objectstack/spec/system`). The finding mechanism
 * and the locale ladder are `finding-user-text.ts`'s; this file is the id
 * owner's half of it, kept beside the rule that declares the id.
 *
 * Who reads it: the person who saved a page in Studio, in their own language,
 * once the save door composes `RuntimeAuthoringIssueSchema.userMessage` from
 * it. So it says what the page does wrong (its sort is ignored) and the change
 * that fixes it; the developer-facing detail (ADR-0015 injection, `columnMap`)
 * stays in the finding's `message`, `hint` and `os explain` entry.
 *
 * The one push site that sets `userTextParams` is the page-sort site in
 * `validate-sortable-fields.ts` (`checkPageSortDeclaration`): that rule judges
 * page sorts and runs on a `page` write, so it is the only site of this id the
 * publish door returns. This rule's own sites of the id (a page component
 * that BINDS an injected column, which then renders blank) run only as a
 * reference-integrity member on the frozen `flow` default, and a flow
 * write's snapshot carries no pages, so they carry no params and stay on the
 * English `message`. The rule's other advisories (`page-field-unknown` at its
 * `skipped` grade, `page-section-group-unknown`) are absent for the same
 * reason.
 *
 * | rule id | params | set at |
 * |---|---|---|
 * | `page-field-unprovisioned` | `page`, `object`, `field` | the page-sort push site in `validate-sortable-fields.ts` |
 *
 * Names in the sentence are the API names the rule saw, not labels, for the
 * reason `validate-security-posture.user-text.ts` gives. `finding-user-text.pages-forms.test.ts`
 * renders the entry from real findings at every page-sort position in every
 * platform locale.
 */

import type { UserTextCatalog } from './finding-user-text.js';
import { PAGE_FIELD_UNPROVISIONED } from './validate-page-field-bindings.js';

export const PAGE_FIELD_BINDINGS_USER_TEXT: UserTextCatalog = Object.freeze({
  [PAGE_FIELD_UNPROVISIONED]: {
    en: (p) =>
      `Page "${p.page}" sorts by "${p.field}", a column that the external object "${p.object}" does not ` +
      `store, so the sort is ignored and the rows appear in no particular order. If the external table has ` +
      `this column, add it to the object's fields; otherwise sort by another field.`,
    'zh-Hans': (p) =>
      `页面“${p.page}”按“${p.field}”排序，但外部对象“${p.object}”并不存储这一列，因此排序会被忽略，` +
      `记录以任意顺序显示。如果外部表确实有这一列，请将它添加到该对象的字段中；否则请按其他字段排序。`,
    'zh-Hant': (p) =>
      `頁面「${p.page}」依「${p.field}」排序，但外部物件「${p.object}」並不儲存這一欄，因此排序會被忽略，` +
      `記錄以任意順序顯示。如果外部資料表確實有這一欄，請將它新增到該物件的欄位中；否則請依其他欄位排序。`,
    es: (p) =>
      `La página "${p.page}" ordena por "${p.field}", una columna que el objeto externo "${p.object}" no ` +
      `almacena, así que el orden se ignora y las filas aparecen sin un orden concreto. Si la tabla externa ` +
      `tiene esa columna, agréguela a los campos del objeto; si no, ordene por otro campo.`,
    ar: (p) =>
      `ترتّب الصفحة "${p.page}" حسب "${p.field}"، وهو عمود لا يخزّنه الكائن الخارجي "${p.object}"، لذلك ` +
      `يتم تجاهل الترتيب وتظهر الصفوف بلا ترتيب محدد. إذا كان الجدول الخارجي يحتوي على هذا العمود، فأضفه ` +
      `إلى حقول الكائن؛ وإلا فرتّب حسب حقل آخر.`,
    fr: (p) =>
      `La page « ${p.page} » trie par « ${p.field} », une colonne que l'objet externe « ${p.object} » ne ` +
      `stocke pas : le tri est donc ignoré et les lignes s'affichent dans un ordre quelconque. Si la table ` +
      `externe possède cette colonne, ajoutez-la aux champs de l'objet ; sinon, triez par un autre champ.`,
    'pt-BR': (p) =>
      `A página "${p.page}" ordena por "${p.field}", uma coluna que o objeto externo "${p.object}" não ` +
      `armazena, então a ordenação é ignorada e as linhas aparecem sem ordem definida. Se a tabela externa ` +
      `tiver essa coluna, adicione-a aos campos do objeto; caso contrário, ordene por outro campo.`,
    ru: (p) =>
      `Страница «${p.page}» сортирует по «${p.field}» — столбцу, который внешний объект «${p.object}» не ` +
      `хранит, поэтому сортировка игнорируется и строки выводятся в произвольном порядке. Если во внешней ` +
      `таблице есть этот столбец, добавьте его в поля объекта; иначе сортируйте по другому полю.`,
    de: (p) =>
      `Die Seite „${p.page}“ sortiert nach „${p.field}“, einer Spalte, die das externe Objekt „${p.object}“ ` +
      `nicht speichert. Die Sortierung wird daher ignoriert, und die Zeilen erscheinen in beliebiger ` +
      `Reihenfolge. Wenn die externe Tabelle diese Spalte hat, fügen Sie sie den Feldern des Objekts hinzu; ` +
      `andernfalls sortieren Sie nach einem anderen Feld.`,
    ja: (p) =>
      `ページ「${p.page}」は「${p.field}」で並べ替えていますが、外部オブジェクト「${p.object}」はこの列を` +
      `保存していないため、並べ替えは無視され、行は不定の順序で表示されます。外部テーブルにこの列がある場合は` +
      `オブジェクトの項目に追加し、ない場合は別の項目で並べ替えてください。`,
    ko: (p) =>
      `페이지 "${p.page}"이(가) "${p.field}" 기준으로 정렬하지만, 외부 개체 "${p.object}"은(는) 이 열을 ` +
      `저장하지 않으므로 정렬이 무시되고 행이 임의의 순서로 표시됩니다. 외부 테이블에 이 열이 있으면 개체의 ` +
      `필드에 추가하고, 없으면 다른 필드로 정렬하세요.`,
  },
});
