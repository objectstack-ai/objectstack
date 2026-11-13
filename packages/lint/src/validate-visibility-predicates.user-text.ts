// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The user-facing sentence of `validate-visibility-predicates.ts`'s one
 * advisory, `visibility-root-mislayered`, in every platform locale
 * (`PLATFORM_LOCALE_TAGS`, `@objectstack/spec/system`). The finding mechanism
 * and the locale ladder are `finding-user-text.ts`'s; this file is the rule's
 * own half of it, kept beside the rule so its wording and its translations
 * change together.
 *
 * Who reads it: the person who saved a view or a page in Studio, in their own
 * language, once the save door composes `RuntimeAuthoringIssueSchema.userMessage`
 * from it. So it says what the element does (it always shows) and the one
 * change that fixes it, in the console's own words: the `visibleWhen` rule, as
 * the record form names it. The developer-facing detail stays in the finding's
 * `message`, `hint` and `os explain` entry.
 *
 * Every other id of the family gates (it is an error, refused at the door with
 * its own English `message`), so this is the only entry. It reaches the
 * publish door on a `view` and on a `page` write.
 *
 * The entry reads the `userTextParams` set at the push site (`checkElement`):
 *
 * | param | value |
 * |---|---|
 * | `surface` | `view` · `page` — the element's owner, which picks the noun |
 * | `name` | the view's or page's name, as the finding's `where` shows it |
 * | `root` | the root the predicate wrongly uses: `data` on a runtime view or page (write `record.`), `record` on a metadata-editing form (write `data.`) |
 *
 * `finding-user-text.pages-forms.test.ts` renders the entry from the rule's
 * real findings, for each surface and each root, in every platform locale.
 */

import type { UserTextCatalog, UserTextParams } from './finding-user-text.js';
import { VISIBILITY_ROOT_MISLAYERED } from './validate-visibility-predicates.js';

/** The noun for the element's owner, per locale. */
type SurfaceNouns = { readonly view: string; readonly page: string };
const noun = (nouns: SurfaceNouns, p: UserTextParams): string => (p.surface === 'page' ? nouns.page : nouns.view);
/** A metadata-editing form binds `data`; its predicate used `record`. */
const onMetadataForm = (p: UserTextParams): boolean => p.root === 'record';

export const VISIBILITY_PREDICATES_USER_TEXT: UserTextCatalog = Object.freeze({
  [VISIBILITY_ROOT_MISLAYERED]: {
    en: (p) => {
      const where = `${noun({ view: 'view', page: 'page' }, p)} "${p.name}"`;
      return onMetadataForm(p)
        ? `A visibleWhen rule on ${where} starts with "record.", but this form edits metadata and provides ` +
          `"data." instead, so the rule never matches and the element is always shown. Start the rule with ` +
          `"data." (for example data.type == 'grid').`
        : `A visibleWhen rule on ${where} starts with "data.", which only a metadata-editing form provides, so ` +
          `the rule never matches and the element is always shown. Start the rule with "record." (for example ` +
          `record.status == 'open').`;
    },
    'zh-Hans': (p) => {
      const where = `${noun({ view: '视图', page: '页面' }, p)}“${p.name}”`;
      return onMetadataForm(p)
        ? `${where}上的 visibleWhen 规则以“record.”开头，但这个表单编辑的是元数据，提供的是“data.”，` +
          `因此该规则永远不会匹配，元素始终显示。请让规则以“data.”开头（例如 data.type == 'grid'）。`
        : `${where}上的 visibleWhen 规则以“data.”开头，而只有编辑元数据的表单才提供“data.”，` +
          `因此该规则永远不会匹配，元素始终显示。请让规则以“record.”开头（例如 record.status == 'open'）。`;
    },
    'zh-Hant': (p) => {
      const where = `${noun({ view: '檢視', page: '頁面' }, p)}「${p.name}」`;
      return onMetadataForm(p)
        ? `${where}上的 visibleWhen 規則以「record.」開頭，但這個表單編輯的是中繼資料，提供的是「data.」，` +
          `因此該規則永遠不會符合，元素始終顯示。請讓規則以「data.」開頭（例如 data.type == 'grid'）。`
        : `${where}上的 visibleWhen 規則以「data.」開頭，而只有編輯中繼資料的表單才提供「data.」，` +
          `因此該規則永遠不會符合，元素始終顯示。請讓規則以「record.」開頭（例如 record.status == 'open'）。`;
    },
    es: (p) => {
      const where = `${noun({ view: 'la vista', page: 'la página' }, p)} "${p.name}"`;
      return onMetadataForm(p)
        ? `Una regla visibleWhen de ${where} empieza por "record.", pero este formulario edita metadatos y ` +
          `ofrece "data.", así que la regla nunca coincide y el elemento se muestra siempre. Empiece la regla por ` +
          `"data." (por ejemplo, data.type == 'grid').`
        : `Una regla visibleWhen de ${where} empieza por "data.", que solo ofrece un formulario de edición de ` +
          `metadatos, así que la regla nunca coincide y el elemento se muestra siempre. Empiece la regla por ` +
          `"record." (por ejemplo, record.status == 'open').`;
    },
    ar: (p) => {
      const where = `${noun({ view: 'العرض', page: 'الصفحة' }, p)} "${p.name}"`;
      return onMetadataForm(p)
        ? `تبدأ قاعدة visibleWhen في ${where} بـ "record."، لكن هذا النموذج يحرّر البيانات الوصفية ويوفّر "data." ` +
          `بدلًا منها، لذلك لا تتطابق القاعدة أبدًا ويظهر العنصر دائمًا. ابدأ القاعدة بـ "data." ` +
          `(مثلًا data.type == 'grid').`
        : `تبدأ قاعدة visibleWhen في ${where} بـ "data."، ولا يوفّرها إلا نموذج تحرير البيانات الوصفية، لذلك ` +
          `لا تتطابق القاعدة أبدًا ويظهر العنصر دائمًا. ابدأ القاعدة بـ "record." ` +
          `(مثلًا record.status == 'open').`;
    },
    fr: (p) => {
      const where = `${noun({ view: 'la vue', page: 'la page' }, p)} « ${p.name} »`;
      return onMetadataForm(p)
        ? `Une règle visibleWhen de ${where} commence par « record. », mais ce formulaire modifie des ` +
          `métadonnées et fournit « data. » : la règle ne correspond donc jamais et l'élément est toujours ` +
          `affiché. Commencez la règle par « data. » (par exemple data.type == 'grid').`
        : `Une règle visibleWhen de ${where} commence par « data. », que seul un formulaire d'édition de ` +
          `métadonnées fournit : la règle ne correspond donc jamais et l'élément est toujours affiché. ` +
          `Commencez la règle par « record. » (par exemple record.status == 'open').`;
    },
    'pt-BR': (p) => {
      const where = `${noun({ view: 'da visualização', page: 'da página' }, p)} "${p.name}"`;
      return onMetadataForm(p)
        ? `Uma regra visibleWhen ${where} começa com "record.", mas este formulário edita metadados e ` +
          `oferece "data.", então a regra nunca corresponde e o elemento é sempre exibido. Comece a regra com ` +
          `"data." (por exemplo, data.type == 'grid').`
        : `Uma regra visibleWhen ${where} começa com "data.", que só um formulário de edição de metadados ` +
          `oferece, então a regra nunca corresponde e o elemento é sempre exibido. Comece a regra com ` +
          `"record." (por exemplo, record.status == 'open').`;
    },
    ru: (p) => {
      const where = `${noun({ view: 'в представлении', page: 'на странице' }, p)} «${p.name}»`;
      return onMetadataForm(p)
        ? `Правило visibleWhen ${where} начинается с «record.», но эта форма редактирует метаданные и ` +
          `предоставляет «data.», поэтому правило никогда не срабатывает и элемент отображается всегда. ` +
          `Начните правило с «data.» (например, data.type == 'grid').`
        : `Правило visibleWhen ${where} начинается с «data.», которое предоставляет только форма ` +
          `редактирования метаданных, поэтому правило никогда не срабатывает и элемент отображается всегда. ` +
          `Начните правило с «record.» (например, record.status == 'open').`;
    },
    de: (p) => {
      const where = `${noun({ view: 'der Ansicht', page: 'der Seite' }, p)} „${p.name}“`;
      return onMetadataForm(p)
        ? `Eine visibleWhen-Regel in ${where} beginnt mit „record.“, aber dieses Formular bearbeitet Metadaten ` +
          `und stellt „data.“ bereit. Die Regel trifft daher nie zu, und das Element wird immer angezeigt. ` +
          `Beginnen Sie die Regel mit „data.“ (zum Beispiel data.type == 'grid').`
        : `Eine visibleWhen-Regel in ${where} beginnt mit „data.“, das nur ein Formular zum Bearbeiten von ` +
          `Metadaten bereitstellt. Die Regel trifft daher nie zu, und das Element wird immer angezeigt. ` +
          `Beginnen Sie die Regel mit „record.“ (zum Beispiel record.status == 'open').`;
    },
    ja: (p) => {
      const where = `${noun({ view: 'ビュー', page: 'ページ' }, p)}「${p.name}」`;
      return onMetadataForm(p)
        ? `${where}の visibleWhen ルールは「record.」で始まっていますが、このフォームはメタデータを編集する` +
          `フォームで「data.」を提供するため、ルールは一致せず、要素は常に表示されます。ルールを「data.」で` +
          `始めてください（例: data.type == 'grid'）。`
        : `${where}の visibleWhen ルールは「data.」で始まっていますが、「data.」を提供するのはメタデータを` +
          `編集するフォームだけのため、ルールは一致せず、要素は常に表示されます。ルールを「record.」で` +
          `始めてください（例: record.status == 'open'）。`;
    },
    ko: (p) => {
      const where = `${noun({ view: '보기', page: '페이지' }, p)} "${p.name}"`;
      return onMetadataForm(p)
        ? `${where}의 visibleWhen 규칙이 "record."로 시작하지만, 이 양식은 메타데이터를 편집하는 양식이라 ` +
          `"data."를 제공하므로 규칙이 일치하지 않고 요소가 항상 표시됩니다. 규칙을 "data."로 시작하세요 ` +
          `(예: data.type == 'grid').`
        : `${where}의 visibleWhen 규칙이 "data."로 시작하지만, "data."는 메타데이터를 편집하는 양식에서만 ` +
          `제공되므로 규칙이 일치하지 않고 요소가 항상 표시됩니다. 규칙을 "record."로 시작하세요 ` +
          `(예: record.status == 'open').`;
    },
  },
});
