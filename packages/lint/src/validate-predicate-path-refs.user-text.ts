// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The user-facing sentence of `validate-predicate-path-refs.ts`'s one advisory
 * finding: the bare-word arm of `predicate-rhs-path-shaped`, in every platform
 * locale (`PLATFORM_LOCALE_TAGS`, `@objectstack/spec/system`). The finding
 * mechanism and the locale ladder are `finding-user-text.ts`'s; this file is
 * the rule's own half of it, kept beside the rule so its wording and its
 * translations change together. The dotted arm of the same id refuses the
 * write (`error`) and has no sentence here.
 *
 * Who reads it: the person who saved a schema-bound form view in Studio, in
 * their own language, once the save door composes
 * `RuntimeAuthoringIssueSchema.userMessage` from it.
 *
 * ⛔ Which reading the author meant is not decided (the rule's module note,
 * §One position, one prescription), so the sentence names BOTH readings and
 * the supported spelling of each: the quoted word (`== 'active'`, what the
 * form does today) or the field on the LEFT of a comparison with a quoted
 * value (`data.active == 'yes'`). It never tells the user to put the root in
 * front of the word where it stands: `== data.active` is a path on the right,
 * the arm this same rule refuses.
 *
 * Params, set at the push site in `validate-predicate-path-refs.ts`: `view`
 * (the view's name), `word` (the unquoted word) and `op` (`==` or `!=`).
 *
 * `finding-user-text.connector-permission-form.test.ts` renders it from the rule's
 * real findings in every platform locale and pins both readings in each.
 */

import type { UserTextCatalog } from './finding-user-text.js';
import { PREDICATE_RHS_PATH_SHAPED } from './validate-predicate-path-refs.js';

export const PREDICATE_PATH_REFS_USER_TEXT: UserTextCatalog = Object.freeze({
  [PREDICATE_RHS_PATH_SHAPED]: {
    en: (p) =>
      `A visibility condition in form "${p.view}" compares with the unquoted word ${p.word} after ${p.op}. Today it ` +
      `is read as the text "${p.word}", but that spelling is not supported and will stop working. If you meant the ` +
      `text, put it in quotes: ${p.op} '${p.word}'. If you meant a field of the record, put the field on the left and ` +
      `compare it with a quoted value, for example data.${p.word} == 'yes'.`,
    'zh-Hans': (p) =>
      `表单“${p.view}”中的显示条件在 ${p.op} 后面与未加引号的单词 ${p.word} 比较。目前它被当作文本“${p.word}”读取，` +
      `但这种写法不受支持，将来会失效。如果指的是这段文本，请加上引号：${p.op} '${p.word}'。如果指的是记录中的字段，` +
      `请把字段放在左边，并与带引号的值比较，例如 data.${p.word} == 'yes'。`,
    'zh-Hant': (p) =>
      `表單「${p.view}」中的顯示條件在 ${p.op} 後面與未加引號的單字 ${p.word} 比較。目前它被當作文字「${p.word}」讀取，` +
      `但這種寫法不受支援，將來會失效。如果指的是這段文字，請加上引號：${p.op} '${p.word}'。如果指的是記錄中的欄位，` +
      `請把欄位放在左邊，並與加上引號的值比較，例如 data.${p.word} == 'yes'。`,
    es: (p) =>
      `Una condición de visibilidad del formulario "${p.view}" compara con la palabra sin comillas ${p.word} después ` +
      `de ${p.op}. Hoy se lee como el texto "${p.word}", pero esa escritura no está admitida y dejará de funcionar. ` +
      `Si se refería al texto, póngalo entre comillas: ${p.op} '${p.word}'. Si se refería a un campo del registro, ` +
      `ponga el campo a la izquierda y compárelo con un valor entre comillas, por ejemplo data.${p.word} == 'yes'.`,
    ar: (p) =>
      `يقارن شرط ظهور في النموذج "${p.view}" بالكلمة غير المحاطة بعلامتي اقتباس ${p.word} بعد ${p.op}. تُقرأ ` +
      `اليوم على أنها النص "${p.word}"، لكن هذه الكتابة غير مدعومة وستتوقف عن العمل. إذا كنت تقصد النص، فضعه بين ` +
      `علامتي اقتباس: ${p.op} '${p.word}'. وإذا كنت تقصد حقلًا من السجل، فضع الحقل على اليسار وقارنه بقيمة بين ` +
      `علامتي اقتباس، مثل data.${p.word} == 'yes'.`,
    fr: (p) =>
      `Une condition de visibilité du formulaire « ${p.view} » compare avec le mot sans guillemets ${p.word} après ` +
      `${p.op}. Aujourd’hui, il est lu comme le texte « ${p.word} », mais cette écriture n’est pas prise en charge et ` +
      `cessera de fonctionner. Si vous visiez le texte, mettez-le entre guillemets : ${p.op} '${p.word}'. Si vous ` +
      `visiez un champ de l’enregistrement, placez le champ à gauche et comparez-le à une valeur entre guillemets, ` +
      `par exemple data.${p.word} == 'yes'.`,
    'pt-BR': (p) =>
      `Uma condição de visibilidade do formulário "${p.view}" compara com a palavra sem aspas ${p.word} depois de ` +
      `${p.op}. Hoje ela é lida como o texto "${p.word}", mas essa escrita não é suportada e vai parar de funcionar. ` +
      `Se você quis dizer o texto, coloque-o entre aspas: ${p.op} '${p.word}'. Se quis dizer um campo do registro, ` +
      `coloque o campo à esquerda e compare-o com um valor entre aspas, por exemplo data.${p.word} == 'yes'.`,
    ru: (p) =>
      `Условие видимости в форме «${p.view}» сравнивает со словом без кавычек ${p.word} после ${p.op}. Сейчас оно ` +
      `читается как текст «${p.word}», но такая запись не поддерживается и перестанет работать. Если имелся в виду ` +
      `текст, возьмите его в кавычки: ${p.op} '${p.word}'. Если имелось в виду поле записи, поставьте поле слева и ` +
      `сравните его со значением в кавычках, например data.${p.word} == 'yes'.`,
    de: (p) =>
      `Eine Sichtbarkeitsbedingung im Formular „${p.view}“ vergleicht nach ${p.op} mit dem Wort ${p.word} ohne ` +
      `Anführungszeichen. Heute wird es als der Text „${p.word}“ gelesen, aber diese Schreibweise wird nicht ` +
      `unterstützt und wird nicht mehr funktionieren. Wenn Sie den Text meinen, setzen Sie ihn in ` +
      `Anführungszeichen: ${p.op} '${p.word}'. Wenn Sie ein Feld des Datensatzes meinen, setzen Sie das Feld nach ` +
      `links und vergleichen Sie es mit einem Wert in Anführungszeichen, zum Beispiel data.${p.word} == 'yes'.`,
    ja: (p) =>
      `フォーム「${p.view}」の表示条件が、${p.op} の後ろで引用符のない単語 ${p.word} と比較しています。現在はテキスト「${p.word}」として` +
      `読み取られますが、この書き方はサポートされておらず、今後動作しなくなります。テキストのつもりなら引用符で囲んでください: ` +
      `${p.op} '${p.word}'。レコードの項目のつもりなら、項目を左側に置き、引用符で囲んだ値と比較してください。例: data.${p.word} == 'yes'。`,
    ko: (p) =>
      `폼 "${p.view}"의 표시 조건이 ${p.op} 뒤에서 따옴표 없는 단어 ${p.word}와(과) 비교합니다. 지금은 텍스트 ` +
      `"${p.word}"(으)로 읽히지만, 이 표기는 지원되지 않으며 앞으로 동작하지 않게 됩니다. 텍스트를 의도했다면 따옴표로 ` +
      `감싸세요: ${p.op} '${p.word}'. 레코드의 필드를 의도했다면 필드를 왼쪽에 두고 따옴표로 감싼 값과 비교하세요. ` +
      `예: data.${p.word} == 'yes'.`,
  },
});
