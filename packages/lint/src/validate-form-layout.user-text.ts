// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The user-facing sentences of `validate-form-layout.ts`'s advisory findings,
 * in every platform locale (`PLATFORM_LOCALE_TAGS`, `@objectstack/spec/system`).
 * The finding mechanism and the locale ladder are `finding-user-text.ts`'s;
 * this file is the rule's own half of it, kept beside the rule so its wording
 * and its translations change together.
 *
 * Who reads these: the person who saved a form view in Studio, in their own
 * language, once the save door composes `RuntimeAuthoringIssueSchema.userMessage`
 * from them. So each sentence says what the form fails to show and the one
 * change that fixes it, in the form designer's own words (view, form, section,
 * field, field group, object); the developer-facing detail stays in the
 * finding's `message`, `hint` and `os explain` entry.
 *
 * Both of the rule's ids are advisory and both reach the publish door, on a
 * `view` write. Each entry reads the `userTextParams` its finding carries:
 *
 * | rule id | params | set at |
 * |---|---|---|
 * | `form-field-unknown` | `view`, `object`, `field` | the section-field push site |
 * | `form-section-group-unknown` | `view`, `object`, `group` | the `checkSectionGroupRefs` call site |
 *
 * The group finding is built by the shared `object-field-groups.ts` helper,
 * so its params are added where this rule calls it, not in the helper: the
 * helper's other host (`validate-page-field-bindings`) emits its group id on
 * no write the door judges.
 *
 * Names in a sentence are the API names the rule saw (`contract_form`, a
 * field's name), not labels, for the reason `validate-security-posture.user-text.ts`
 * gives: the rule is a pure function of the stack with no label lookup in the
 * request's language. A view with no name shows the rule's own stand-in, as
 * its `message` does.
 *
 * `finding-user-text.pages-forms.test.ts` renders every entry from the rule's
 * real findings in every platform locale.
 */

import type { UserTextCatalog } from './finding-user-text.js';
import { FORM_FIELD_UNKNOWN, FORM_SECTION_GROUP_UNKNOWN } from './validate-form-layout.js';

export const FORM_LAYOUT_USER_TEXT: UserTextCatalog = Object.freeze({
  [FORM_FIELD_UNKNOWN]: {
    en: (p) =>
      `The form in view "${p.view}" lists the field "${p.field}", which object "${p.object}" does not have, so ` +
      `it is skipped and never appears on the form. Correct the field name, or add the field to "${p.object}".`,
    'zh-Hans': (p) =>
      `视图“${p.view}”的表单列出了字段“${p.field}”，但对象“${p.object}”没有这个字段，因此它会被跳过，` +
      `不会出现在表单上。请更正字段名称，或在“${p.object}”中添加该字段。`,
    'zh-Hant': (p) =>
      `檢視「${p.view}」的表單列出了欄位「${p.field}」，但物件「${p.object}」沒有這個欄位，因此它會被略過，` +
      `不會出現在表單上。請更正欄位名稱，或在「${p.object}」中新增該欄位。`,
    es: (p) =>
      `El formulario de la vista "${p.view}" incluye el campo "${p.field}", que el objeto "${p.object}" no ` +
      `tiene, así que se omite y nunca aparece en el formulario. Corrija el nombre del campo o agregue el ` +
      `campo a "${p.object}".`,
    ar: (p) =>
      `يتضمن النموذج في طريقة العرض "${p.view}" الحقل "${p.field}"، وهو غير موجود في الكائن "${p.object}"، ` +
      `لذلك يتم تخطيه ولا يظهر في النموذج أبدًا. صحّح اسم الحقل، أو أضف الحقل إلى "${p.object}".`,
    fr: (p) =>
      `Le formulaire de la vue « ${p.view} » liste le champ « ${p.field} », que l'objet « ${p.object} » ne ` +
      `possède pas : il est donc ignoré et n'apparaît jamais dans le formulaire. Corrigez le nom du champ, ou ` +
      `ajoutez ce champ à « ${p.object} ».`,
    'pt-BR': (p) =>
      `O formulário da visualização "${p.view}" lista o campo "${p.field}", que o objeto "${p.object}" não ` +
      `tem, então ele é ignorado e nunca aparece no formulário. Corrija o nome do campo ou adicione o campo a ` +
      `"${p.object}".`,
    ru: (p) =>
      `Форма в представлении «${p.view}» содержит поле «${p.field}», которого нет у объекта «${p.object}», ` +
      `поэтому оно пропускается и никогда не отображается в форме. Исправьте имя поля или добавьте это поле ` +
      `в «${p.object}».`,
    de: (p) =>
      `Das Formular in der Ansicht „${p.view}“ führt das Feld „${p.field}“ auf, das das Objekt „${p.object}“ ` +
      `nicht hat. Es wird daher übersprungen und erscheint nie im Formular. Korrigieren Sie den Feldnamen, oder ` +
      `fügen Sie das Feld zu „${p.object}“ hinzu.`,
    ja: (p) =>
      `ビュー「${p.view}」のフォームには項目「${p.field}」が含まれていますが、オブジェクト「${p.object}」には` +
      `この項目がないため、スキップされてフォームに表示されません。項目名を修正するか、「${p.object}」に` +
      `この項目を追加してください。`,
    ko: (p) =>
      `보기 "${p.view}"의 양식에 필드 "${p.field}"이(가) 있지만 개체 "${p.object}"에는 이 필드가 없으므로, ` +
      `건너뛰어지고 양식에 표시되지 않습니다. 필드 이름을 수정하거나 "${p.object}"에 이 필드를 추가하세요.`,
  },
  [FORM_SECTION_GROUP_UNKNOWN]: {
    en: (p) =>
      `A section of the form in view "${p.view}" takes its fields from the field group "${p.group}", which ` +
      `object "${p.object}" does not declare, so the section has no fields and does not appear. Correct the ` +
      `group name, or add the group to "${p.object}" and assign fields to it.`,
    'zh-Hans': (p) =>
      `视图“${p.view}”的表单中有一个分区从字段分组“${p.group}”获取字段，但对象“${p.object}”没有声明这个分组，` +
      `因此该分区没有字段，也不会显示。请更正分组名称，或在“${p.object}”中添加该分组并为其分配字段。`,
    'zh-Hant': (p) =>
      `檢視「${p.view}」的表單中有一個區段從欄位分組「${p.group}」取得欄位，但物件「${p.object}」沒有宣告這個分組，` +
      `因此該區段沒有欄位，也不會顯示。請更正分組名稱，或在「${p.object}」中新增該分組並為其指派欄位。`,
    es: (p) =>
      `Una sección del formulario de la vista "${p.view}" toma sus campos del grupo de campos "${p.group}", que ` +
      `el objeto "${p.object}" no declara, así que la sección no tiene campos y no aparece. Corrija el nombre ` +
      `del grupo, o agregue el grupo a "${p.object}" y asígnele campos.`,
    ar: (p) =>
      `يأخذ قسم في النموذج ضمن طريقة العرض "${p.view}" حقوله من مجموعة الحقول "${p.group}"، التي لا يعرّفها ` +
      `الكائن "${p.object}"، لذلك لا يحتوي القسم على أي حقول ولا يظهر. صحّح اسم المجموعة، أو أضف المجموعة ` +
      `إلى "${p.object}" وعيّن لها حقولًا.`,
    fr: (p) =>
      `Une section du formulaire de la vue « ${p.view} » tire ses champs du groupe de champs « ${p.group} », ` +
      `que l'objet « ${p.object} » ne déclare pas : la section n'a donc aucun champ et ne s'affiche pas. ` +
      `Corrigez le nom du groupe, ou ajoutez ce groupe à « ${p.object} » et attribuez-lui des champs.`,
    'pt-BR': (p) =>
      `Uma seção do formulário da visualização "${p.view}" obtém seus campos do grupo de campos "${p.group}", ` +
      `que o objeto "${p.object}" não declara, então a seção não tem campos e não aparece. Corrija o nome do ` +
      `grupo ou adicione o grupo a "${p.object}" e atribua campos a ele.`,
    ru: (p) =>
      `Раздел формы в представлении «${p.view}» берёт поля из группы полей «${p.group}», которую объект ` +
      `«${p.object}» не объявляет, поэтому в разделе нет полей и он не отображается. Исправьте имя группы или ` +
      `добавьте эту группу в «${p.object}» и назначьте ей поля.`,
    de: (p) =>
      `Ein Abschnitt des Formulars in der Ansicht „${p.view}“ bezieht seine Felder aus der Feldgruppe ` +
      `„${p.group}“, die das Objekt „${p.object}“ nicht deklariert. Der Abschnitt hat daher keine Felder und ` +
      `wird nicht angezeigt. Korrigieren Sie den Gruppennamen, oder fügen Sie die Gruppe zu „${p.object}“ ` +
      `hinzu und ordnen Sie ihr Felder zu.`,
    ja: (p) =>
      `ビュー「${p.view}」のフォームのセクションが項目グループ「${p.group}」から項目を取得していますが、` +
      `オブジェクト「${p.object}」はこのグループを宣言していないため、セクションに項目がなく表示されません。` +
      `グループ名を修正するか、「${p.object}」にこのグループを追加して項目を割り当ててください。`,
    ko: (p) =>
      `보기 "${p.view}"의 양식에 있는 섹션이 필드 그룹 "${p.group}"에서 필드를 가져오지만, 개체 ` +
      `"${p.object}"은(는) 이 그룹을 선언하지 않으므로 섹션에 필드가 없고 표시되지 않습니다. 그룹 이름을 ` +
      `수정하거나 "${p.object}"에 이 그룹을 추가하고 필드를 할당하세요.`,
  },
});
