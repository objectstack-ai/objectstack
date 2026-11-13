// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The user-facing sentences of `lint-autonumber-formats.ts`'s advisory
 * findings, in every platform locale (`PLATFORM_LOCALE_TAGS`,
 * `@objectstack/spec/system`). The finding mechanism and the locale ladder are
 * `finding-user-text.ts`'s; this file is the rule's own half of it, kept beside
 * the rule so its wording and its translations change together.
 *
 * Who reads these: the person who saved an object in Studio, in their own
 * language, once the save door composes `RuntimeAuthoringIssueSchema.userMessage`
 * from them. So each sentence says what the Auto Number field's record numbers
 * will look like (or fail to get) and the one change that fixes it, in the
 * object designer's words (object, field, Auto Number, record number, required);
 * the developer-facing detail stays in the finding's `message`, `hint` and
 * `os explain` entry.
 *
 * Both advisory ids reach the publish door: the rule runs there on an `object`
 * write (`lintAutonumberFormats` in `authoring-rules.ts`, `runtimeTypes:
 * ['object']`). The two errors (`autonumber-references-unknown-field`,
 * `autonumber-references-self`) refuse the write and have no sentence here.
 *
 * Each entry reads the `userTextParams` its finding carries, set at the push
 * site in `lint-autonumber-formats.ts`:
 *
 * | rule id | params |
 * |---|---|
 * | `autonumber-unrecognized-token` | `object`, `field`, `token` (the braced group as written), `kind` (`unknown-token` · `second-counter`) |
 * | `autonumber-references-optional-field` | `object`, `field`, `ref` (the optional field the format interpolates) |
 *
 * `kind` is the rule's own split: its `message` tells a second `{0..0}` counter
 * apart from any other unrecognized group, so the sentence has one arm per
 * value. Names are the API names the rule saw, not labels, for the reason
 * `validate-security-posture.user-text.ts` gives.
 *
 * `finding-user-text.data-model.test.ts` renders every entry from the rule's
 * real findings in every platform locale.
 */

import type { UserTextCatalog } from './finding-user-text.js';
import { AUTONUMBER_LITERAL_TOKEN, AUTONUMBER_OPTIONAL_FIELD } from './lint-autonumber-formats.js';

/** `kind` of an `autonumber-unrecognized-token` finding: a second `{0..0}` counter. */
const SECOND_COUNTER = 'second-counter';

export const AUTONUMBER_FORMATS_USER_TEXT: UserTextCatalog = Object.freeze({
  [AUTONUMBER_LITERAL_TOKEN]: {
    en: (p) =>
      p.kind === SECOND_COUNTER
        ? `The format of Auto Number field "${p.field}" on object "${p.object}" contains a second counter ` +
          `${p.token}. Only the first counter counts, so this one appears as typed in every record number. Keep a ` +
          `single counter, such as {0000}.`
        : `The format of Auto Number field "${p.field}" on object "${p.object}" contains ${p.token}, which is not a ` +
          `counter, date or field token, so it appears as typed in every record number. Correct its spelling (date ` +
          `tokens are exact, such as {YYYY}) or remove it.`,
    'zh-Hans': (p) =>
      p.kind === SECOND_COUNTER
        ? `对象“${p.object}”的自动编号字段“${p.field}”的格式中包含第二个计数器 ${p.token}。只有第一个计数器生效，` +
          `因此这个会原样出现在每条记录的编号中。请只保留一个计数器，例如 {0000}。`
        : `对象“${p.object}”的自动编号字段“${p.field}”的格式中包含 ${p.token}，它不是计数器、日期或字段标记，` +
          `因此会原样出现在每条记录的编号中。请更正其拼写（日期标记须完全一致，例如 {YYYY}），或将其删除。`,
    'zh-Hant': (p) =>
      p.kind === SECOND_COUNTER
        ? `物件「${p.object}」的自動編號欄位「${p.field}」的格式中包含第二個計數器 ${p.token}。只有第一個計數器有效，` +
          `因此這個會原樣出現在每筆記錄的編號中。請只保留一個計數器，例如 {0000}。`
        : `物件「${p.object}」的自動編號欄位「${p.field}」的格式中包含 ${p.token}，它不是計數器、日期或欄位標記，` +
          `因此會原樣出現在每筆記錄的編號中。請更正其拼寫（日期標記須完全一致，例如 {YYYY}），或將其刪除。`,
    es: (p) =>
      p.kind === SECOND_COUNTER
        ? `El formato del campo de numeración automática "${p.field}" del objeto "${p.object}" contiene un segundo ` +
          `contador ${p.token}. Solo cuenta el primero, así que este aparece tal cual en cada número de registro. ` +
          `Deje un único contador, como {0000}.`
        : `El formato del campo de numeración automática "${p.field}" del objeto "${p.object}" contiene ${p.token}, ` +
          `que no es un contador, una fecha ni un campo, así que aparece tal cual en cada número de registro. ` +
          `Corrija cómo está escrito (los tokens de fecha son exactos, como {YYYY}) o elimínelo.`,
    ar: (p) =>
      p.kind === SECOND_COUNTER
        ? `يحتوي تنسيق حقل الترقيم التلقائي "${p.field}" في الكائن "${p.object}" على عدّاد ثانٍ ${p.token}. ` +
          `لا يُحتسب إلا العدّاد الأول، لذا يظهر هذا كما هو في كل رقم سجل. أبقِ عدّادًا واحدًا فقط، مثل {0000}.`
        : `يحتوي تنسيق حقل الترقيم التلقائي "${p.field}" في الكائن "${p.object}" على ${p.token}، وهو ليس عدّادًا ` +
          `ولا تاريخًا ولا حقلًا، لذا يظهر كما هو في كل رقم سجل. صحّح كتابته (رموز التاريخ دقيقة، مثل {YYYY}) أو احذفه.`,
    fr: (p) =>
      p.kind === SECOND_COUNTER
        ? `Le format du champ à numérotation automatique « ${p.field} » de l’objet « ${p.object} » contient un ` +
          `second compteur ${p.token}. Seul le premier compte, donc celui-ci apparaît tel quel dans chaque numéro ` +
          `d’enregistrement. Gardez un seul compteur, comme {0000}.`
        : `Le format du champ à numérotation automatique « ${p.field} » de l’objet « ${p.object} » contient ` +
          `${p.token}, qui n’est ni un compteur, ni une date, ni un champ : il apparaît tel quel dans chaque numéro ` +
          `d’enregistrement. Corrigez son orthographe (les jetons de date sont exacts, comme {YYYY}) ou supprimez-le.`,
    'pt-BR': (p) =>
      p.kind === SECOND_COUNTER
        ? `O formato do campo de numeração automática "${p.field}" do objeto "${p.object}" contém um segundo ` +
          `contador ${p.token}. Só o primeiro conta, então este aparece literalmente em cada número de registro. ` +
          `Mantenha um único contador, como {0000}.`
        : `O formato do campo de numeração automática "${p.field}" do objeto "${p.object}" contém ${p.token}, que ` +
          `não é um contador, uma data nem um campo, então aparece literalmente em cada número de registro. Corrija ` +
          `a grafia (tokens de data são exatos, como {YYYY}) ou remova-o.`,
    ru: (p) =>
      p.kind === SECOND_COUNTER
        ? `Формат поля автонумерации «${p.field}» объекта «${p.object}» содержит второй счётчик ${p.token}. ` +
          `Учитывается только первый, поэтому этот выводится как есть в каждом номере записи. Оставьте один ` +
          `счётчик, например {0000}.`
        : `Формат поля автонумерации «${p.field}» объекта «${p.object}» содержит ${p.token} — это не счётчик, не ` +
          `дата и не поле, поэтому он выводится как есть в каждом номере записи. Исправьте написание (токены даты ` +
          `точные, например {YYYY}) или удалите его.`,
    de: (p) =>
      p.kind === SECOND_COUNTER
        ? `Das Format des Autonummernfelds „${p.field}“ im Objekt „${p.object}“ enthält einen zweiten Zähler ` +
          `${p.token}. Nur der erste Zähler zählt, daher erscheint dieser unverändert in jeder Datensatznummer. ` +
          `Behalten Sie nur einen Zähler, etwa {0000}.`
        : `Das Format des Autonummernfelds „${p.field}“ im Objekt „${p.object}“ enthält ${p.token}, das weder ein ` +
          `Zähler noch ein Datum noch ein Feld ist, und erscheint daher unverändert in jeder Datensatznummer. ` +
          `Korrigieren Sie die Schreibweise (Datumstoken sind exakt, etwa {YYYY}) oder entfernen Sie es.`,
    ja: (p) =>
      p.kind === SECOND_COUNTER
        ? `オブジェクト「${p.object}」の自動採番フィールド「${p.field}」の書式に 2 つ目のカウンター ${p.token} が` +
          `含まれています。有効なのは最初のカウンターだけなので、これはすべてのレコード番号にそのまま表示されます。` +
          `カウンターは {0000} のように 1 つだけにしてください。`
        : `オブジェクト「${p.object}」の自動採番フィールド「${p.field}」の書式に ${p.token} が含まれています。` +
          `これはカウンター、日付、フィールドのいずれのトークンでもないため、すべてのレコード番号にそのまま表示されます。` +
          `綴りを修正する（日付トークンは {YYYY} のように完全に一致させます）か、削除してください。`,
    ko: (p) =>
      p.kind === SECOND_COUNTER
        ? `개체 "${p.object}"의 자동 번호 필드 "${p.field}" 형식에 두 번째 카운터 ${p.token}이(가) 들어 있습니다. ` +
          `첫 번째 카운터만 적용되므로 이 카운터는 모든 레코드 번호에 그대로 표시됩니다. {0000}처럼 카운터를 ` +
          `하나만 두세요.`
        : `개체 "${p.object}"의 자동 번호 필드 "${p.field}" 형식에 ${p.token}이(가) 들어 있습니다. 이는 카운터, ` +
          `날짜, 필드 토큰이 아니므로 모든 레코드 번호에 그대로 표시됩니다. 철자를 고치거나({YYYY}처럼 날짜 ` +
          `토큰은 정확해야 합니다) 삭제하세요.`,
  },
  [AUTONUMBER_OPTIONAL_FIELD]: {
    en: (p) =>
      `Auto Number field "${p.field}" on object "${p.object}" puts the value of "${p.ref}" into each record ` +
      `number, but "${p.ref}" is not required, so creating a record with "${p.ref}" left blank fails. Make ` +
      `"${p.ref}" a required field.`,
    'zh-Hans': (p) =>
      `对象“${p.object}”的自动编号字段“${p.field}”会把“${p.ref}”的值放进每条记录的编号，但“${p.ref}”不是必填` +
      `字段，因此创建记录时若“${p.ref}”留空就会失败。请将“${p.ref}”设为必填字段。`,
    'zh-Hant': (p) =>
      `物件「${p.object}」的自動編號欄位「${p.field}」會把「${p.ref}」的值放進每筆記錄的編號，但「${p.ref}」不是必填` +
      `欄位，因此建立記錄時若「${p.ref}」留空就會失敗。請將「${p.ref}」設為必填欄位。`,
    es: (p) =>
      `El campo de numeración automática "${p.field}" del objeto "${p.object}" pone el valor de "${p.ref}" en cada ` +
      `número de registro, pero "${p.ref}" no es obligatorio, así que crear un registro con "${p.ref}" vacío ` +
      `falla. Haga que "${p.ref}" sea un campo obligatorio.`,
    ar: (p) =>
      `يضع حقل الترقيم التلقائي "${p.field}" في الكائن "${p.object}" قيمة "${p.ref}" في كل رقم سجل، لكن ` +
      `"${p.ref}" ليس حقلًا مطلوبًا، لذا يفشل إنشاء سجل يُترك فيه "${p.ref}" فارغًا. اجعل "${p.ref}" حقلًا مطلوبًا.`,
    fr: (p) =>
      `Le champ à numérotation automatique « ${p.field} » de l’objet « ${p.object} » insère la valeur de ` +
      `« ${p.ref} » dans chaque numéro d’enregistrement, mais « ${p.ref} » n’est pas obligatoire : créer un ` +
      `enregistrement où « ${p.ref} » est vide échoue. Rendez « ${p.ref} » obligatoire.`,
    'pt-BR': (p) =>
      `O campo de numeração automática "${p.field}" do objeto "${p.object}" coloca o valor de "${p.ref}" em cada ` +
      `número de registro, mas "${p.ref}" não é obrigatório, então criar um registro com "${p.ref}" em branco ` +
      `falha. Torne "${p.ref}" um campo obrigatório.`,
    ru: (p) =>
      `Поле автонумерации «${p.field}» объекта «${p.object}» подставляет значение «${p.ref}» в каждый номер ` +
      `записи, но поле «${p.ref}» не обязательное, поэтому создание записи с пустым «${p.ref}» завершается ` +
      `ошибкой. Сделайте «${p.ref}» обязательным полем.`,
    de: (p) =>
      `Das Autonummernfeld „${p.field}“ im Objekt „${p.object}“ setzt den Wert von „${p.ref}“ in jede ` +
      `Datensatznummer ein, aber „${p.ref}“ ist kein Pflichtfeld. Daher schlägt das Anlegen eines Datensatzes ` +
      `fehl, bei dem „${p.ref}“ leer bleibt. Machen Sie „${p.ref}“ zu einem Pflichtfeld.`,
    ja: (p) =>
      `オブジェクト「${p.object}」の自動採番フィールド「${p.field}」は「${p.ref}」の値を各レコード番号に入れますが、` +
      `「${p.ref}」は必須ではないため、「${p.ref}」を空のままにしたレコードの作成は失敗します。` +
      `「${p.ref}」を必須フィールドにしてください。`,
    ko: (p) =>
      `개체 "${p.object}"의 자동 번호 필드 "${p.field}"은(는) "${p.ref}" 값을 각 레코드 번호에 넣지만 ` +
      `"${p.ref}"은(는) 필수 필드가 아니므로 "${p.ref}"을(를) 비워 둔 레코드는 만들 수 없습니다. ` +
      `"${p.ref}"을(를) 필수 필드로 만드세요.`,
  },
});
