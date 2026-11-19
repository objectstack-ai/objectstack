// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The user-facing sentences of the post-publish build probes
 * (`build-probes.ts`, ADR-0038 L3), in every platform locale
 * (`PLATFORM_LOCALE_TAGS`, `@objectstack/spec/system`).
 *
 * ## Why the probe writes them
 *
 * Ruling records 6819749037 and 6929121584: the producer of a finding composes
 * the sentence its user reads, in the request's language, and no consumer
 * keeps a per-code translation table. A probe finding has two readers. The
 * agent that published reads `message` and `fix`, which stay English and
 * unchanged; the person who asked for the app reads `userMessage`
 * (`RuntimeBuildIssueSchema.userMessage`, `@objectstack/spec/api`), which is
 * rendered from this catalog. The probe holds the request's locales
 * (`RunBuildProbesOptions.userTextLocales`), so it composes the sentence
 * itself: there is no door between it and the wire.
 *
 * ## The ladder is the lint package's
 *
 * `renderUserText` / `userTextLocaleOf` from `@objectstack/lint/runtime`: the
 * request's locale, else the workspace default, else `en`, each read through
 * the platform locale table. This file holds sentences only. The pin in
 * `build-probes-user-message.test.ts` requires every entry to answer in every
 * platform locale, so the ladder never reaches the `en` floor for a table
 * language, and one entry answers for the locale of all of them
 * ({@link buildProbeUserTextLocale}).
 *
 * ## Who reads these
 *
 * The person in the build chat or in Studio who published the app, usually
 * not a developer. So each sentence says what they will see (a widget with no
 * data, a view that shows an error), in the product's own words, and the next
 * step they can take where there is one. Nothing in a sentence addresses the
 * agent, and none carries an error code, a file path or a thrown message.
 *
 * ## Names: the label where the probe can read one
 *
 * | code | params | names |
 * |---|---|---|
 * | `seed_not_applied` | `object`, `cause` (`no-rows` · `unreadable` · `missing`) | the seeded object's label; the seed has none. `missing` names the object by the API name the seed carries: there is no object to read a label from |
 * | `view_read_failed` | `view`, `object` | both labels |
 * | `object_field_ref_unknown` | `object` | the object's label |
 * | `object_field_ref_rule_failed` | `object` | the object's label |
 * | `widget_not_probed` | `dashboard`, `widget`, `dataset`, `cause` (`outside-closure` · `ambiguous-in-closure` · `several-holders`) | dashboard label, widget title; the dataset by its API name |
 * | `empty_query` | `dashboard`, `widget`, `dataset`, `object` | all four by label |
 * | `widget_query_failed` | `dashboard`, `widget`, `dataset`, `object`, `cause` (`access` · `field-access` · `unavailable` · `query`) | dashboard, widget and dataset by label; `object` by label for `query`, and by the API name the refusal names for `access` · `field-access` · `unavailable` (the caller was not admitted to it, so nothing of it is read); empty when there is none |
 * | `probes_unavailable` | `count` | no name: one finding covers every dashboard of the publish |
 * | `widget_empty_result` | `dashboard`, `widget`, `dataset` | all three by label |
 * | `rollup_never_computed` | `object`, `field`, `child`, `cause` (`fills` · `named`) | the parent object, the roll-up field and the child object by label |
 * | `seed_reference_unresolved` | `object`, `field`, `target`, `count`, `cause` (`seed` · `mode` · `stored`) | the seeded object, its reference field and the target object by label |
 * | `flow_connector_action_unresolved` | `flow`, `step`, `connector`, `cause` (`refused` · `no-action` · `degraded`) | flow and step by label; the connector by its name (the step names it so) |
 *
 * A label is the published body's own (`label`, a widget's `title`), read
 * through the probe's item reader and resolved for the sentence's locale. An
 * artifact whose body the probe cannot read, or that carries no label, shows
 * its API name. `widget_not_probed` names its dataset by API name on purpose:
 * the read of that dataset was refused, so there is no body to take a label
 * from, and the name is the subject of the sentence (two datasets share it).
 */

import { renderUserText, userTextLocaleOf } from '@objectstack/lint/runtime';
import type { UserTextEntry, UserTextParams } from '@objectstack/lint/runtime';
import type { PlatformLocaleTag } from '@objectstack/spec/system';
import type { RuntimeBuildIssueCode } from './build-probes.js';

/** One locale's wording of "the widget W on dashboard D", the subject of every widget sentence. */
const WIDGET_ON_DASHBOARD: Readonly<Record<PlatformLocaleTag, (p: UserTextParams) => string>> = {
  en: (p) => `The widget "${p.widget}" on dashboard "${p.dashboard}"`,
  'zh-Hans': (p) => `仪表盘“${p.dashboard}”中的组件“${p.widget}”`,
  'zh-Hant': (p) => `儀表盤「${p.dashboard}」中的元件「${p.widget}」`,
  es: (p) => `El widget "${p.widget}" del panel de control "${p.dashboard}"`,
  ar: (p) => `العنصر "${p.widget}" في لوحة القيادة "${p.dashboard}"`,
  fr: (p) => `Le widget « ${p.widget} » du tableau de bord « ${p.dashboard} »`,
  'pt-BR': (p) => `O widget "${p.widget}" do painel "${p.dashboard}"`,
  ru: (p) => `Виджет «${p.widget}» на дашборде «${p.dashboard}»`,
  de: (p) => `Das Widget „${p.widget}“ im Dashboard „${p.dashboard}“`,
  ja: (p) => `ダッシュボード「${p.dashboard}」のウィジェット「${p.widget}」`,
  ko: (p) => `대시보드 "${p.dashboard}"의 위젯 "${p.widget}"`,
};

/**
 * `seed_not_applied`: the sample data did not land (`no-rows`), the probe could not look (`unreadable`), or
 * [#34864] the object the seed names does not exist (`missing`), so publishing again cannot help.
 */
const SEED_NOT_APPLIED: UserTextEntry = {
  en: (p) =>
    p.cause === 'missing'
      ? `The sample data could not load, because "${p.object}" does not exist. Correct the object the sample ` +
        `data names, or create and publish "${p.object}", then publish again.`
      : p.cause === 'unreadable'
      ? `The sample data for "${p.object}" could not be checked, because "${p.object}" could not be read after ` +
        `publishing. Publish again, and contact your administrator if it happens again.`
      : `The sample data for "${p.object}" did not load, so "${p.object}" has no records yet. Check the sample ` +
        `data, then publish again.`,
  'zh-Hans': (p) =>
    p.cause === 'missing'
      ? `示例数据无法加载，因为“${p.object}”不存在。请更正示例数据所指的对象，或先创建并发布“${p.object}”，然后重新发布。`
      : p.cause === 'unreadable'
      ? `无法检查“${p.object}”的示例数据，因为发布后无法读取“${p.object}”。请重新发布；如果问题再次出现，请联系管理员。`
      : `“${p.object}”的示例数据没有加载成功，所以“${p.object}”中还没有任何记录。请检查示例数据，然后重新发布。`,
  'zh-Hant': (p) =>
    p.cause === 'missing'
      ? `示例資料無法載入，因為「${p.object}」不存在。請更正示例資料所指的物件，或先建立並發布「${p.object}」，然後重新發布。`
      : p.cause === 'unreadable'
      ? `無法檢查「${p.object}」的示例資料，因為發布後無法讀取「${p.object}」。請重新發布；如果問題再次出現，請聯絡管理員。`
      : `「${p.object}」的示例資料沒有載入成功，所以「${p.object}」中還沒有任何記錄。請檢查示例資料，然後重新發布。`,
  es: (p) =>
    p.cause === 'missing'
      ? `Los datos de ejemplo no se pudieron cargar, porque "${p.object}" no existe. Corrija el objeto que indican ` +
        `los datos de ejemplo, o cree y publique "${p.object}", y vuelva a publicar.`
      : p.cause === 'unreadable'
      ? `No se pudieron comprobar los datos de ejemplo de "${p.object}", porque no se pudo leer "${p.object}" ` +
        `después de publicar. Vuelva a publicar y, si ocurre de nuevo, póngase en contacto con su administrador.`
      : `Los datos de ejemplo de "${p.object}" no se cargaron, por lo que "${p.object}" aún no tiene registros. ` +
        `Revise los datos de ejemplo y vuelva a publicar.`,
  ar: (p) =>
    p.cause === 'missing'
      ? `تعذّر تحميل البيانات التجريبية، لأن "${p.object}" غير موجود. صحّح الكائن الذي تشير إليه البيانات التجريبية، ` +
        `أو أنشئ "${p.object}" وانشره، ثم أعد النشر.`
      : p.cause === 'unreadable'
      ? `تعذّر التحقق من البيانات التجريبية لـ "${p.object}"، لأنه تعذّرت قراءة "${p.object}" بعد النشر. ` +
        `أعد النشر، وإذا تكرر ذلك فتواصل مع المسؤول.`
      : `لم يتم تحميل البيانات التجريبية لـ "${p.object}"، لذلك لا يحتوي "${p.object}" على أي سجلات بعد. ` +
        `راجع البيانات التجريبية ثم أعد النشر.`,
  fr: (p) =>
    p.cause === 'missing'
      ? `Les données d’exemple n’ont pas pu être chargées, car « ${p.object} » n’existe pas. Corrigez l’objet ` +
        `indiqué par les données d’exemple, ou créez et publiez « ${p.object} », puis publiez à nouveau.`
      : p.cause === 'unreadable'
      ? `Les données d’exemple de « ${p.object} » n’ont pas pu être vérifiées, car « ${p.object} » n’a pas pu ` +
        `être lu après la publication. Publiez à nouveau et, si cela se reproduit, contactez votre administrateur.`
      : `Les données d’exemple de « ${p.object} » n’ont pas été chargées ; « ${p.object} » ne contient donc ` +
        `encore aucun enregistrement. Vérifiez les données d’exemple, puis publiez à nouveau.`,
  'pt-BR': (p) =>
    p.cause === 'missing'
      ? `Os dados de exemplo não puderam ser carregados, porque "${p.object}" não existe. Corrija o objeto ` +
        `indicado nos dados de exemplo, ou crie e publique "${p.object}", e publique novamente.`
      : p.cause === 'unreadable'
      ? `Não foi possível verificar os dados de exemplo de "${p.object}", porque não foi possível ler ` +
        `"${p.object}" após a publicação. Publique novamente e, se acontecer de novo, entre em contato com o ` +
        `administrador.`
      : `Os dados de exemplo de "${p.object}" não foram carregados, então "${p.object}" ainda não tem registros. ` +
        `Verifique os dados de exemplo e publique novamente.`,
  ru: (p) =>
    p.cause === 'missing'
      ? `Примеры данных не удалось загрузить: объекта «${p.object}» не существует. Исправьте объект, указанный ` +
        `в примерах данных, или создайте и опубликуйте «${p.object}», затем опубликуйте снова.`
      : p.cause === 'unreadable'
      ? `Не удалось проверить примеры данных для объекта «${p.object}»: после публикации объект «${p.object}» ` +
        `не удалось прочитать. Опубликуйте снова, а если это повторится, обратитесь к администратору.`
      : `Примеры данных для объекта «${p.object}» не загрузились, поэтому в объекте «${p.object}» пока нет ` +
        `записей. Проверьте примеры данных и опубликуйте снова.`,
  de: (p) =>
    p.cause === 'missing'
      ? `Die Beispieldaten konnten nicht geladen werden, weil „${p.object}“ nicht existiert. Korrigieren Sie das ` +
        `Objekt, das die Beispieldaten nennen, oder erstellen und veröffentlichen Sie „${p.object}“, und ` +
        `veröffentlichen Sie dann erneut.`
      : p.cause === 'unreadable'
      ? `Die Beispieldaten für „${p.object}“ konnten nicht geprüft werden, weil „${p.object}“ nach dem ` +
        `Veröffentlichen nicht gelesen werden konnte. Veröffentlichen Sie erneut und wenden Sie sich an Ihren ` +
        `Administrator, wenn das wieder passiert.`
      : `Die Beispieldaten für „${p.object}“ wurden nicht geladen, daher enthält „${p.object}“ noch keine ` +
        `Datensätze. Prüfen Sie die Beispieldaten und veröffentlichen Sie dann erneut.`,
  ja: (p) =>
    p.cause === 'missing'
      ? `「${p.object}」が存在しないため、サンプルデータを読み込めませんでした。サンプルデータが指すオブジェクトを` +
        `修正するか、「${p.object}」を作成して公開してから、もう一度公開してください。`
      : p.cause === 'unreadable'
      ? `公開後に「${p.object}」を読み取れなかったため、「${p.object}」のサンプルデータを確認できませんでした。` +
        `もう一度公開し、再び発生する場合は管理者にお問い合わせください。`
      : `「${p.object}」のサンプルデータが読み込まれなかったため、「${p.object}」にはまだレコードがありません。` +
        `サンプルデータを確認してから、もう一度公開してください。`,
  ko: (p) =>
    p.cause === 'missing'
      ? `"${p.object}"이(가) 존재하지 않아 샘플 데이터를 불러오지 못했습니다. 샘플 데이터가 가리키는 개체를 ` +
        `수정하거나 "${p.object}"을(를) 만들어 게시한 다음 다시 게시하세요.`
      : p.cause === 'unreadable'
      ? `게시 후 "${p.object}"을(를) 읽을 수 없어 "${p.object}"의 샘플 데이터를 확인하지 못했습니다. ` +
        `다시 게시하고, 문제가 반복되면 관리자에게 문의하세요.`
      : `"${p.object}"의 샘플 데이터를 불러오지 못해 "${p.object}"에 아직 레코드가 없습니다. ` +
        `샘플 데이터를 확인한 다음 다시 게시하세요.`,
};

/** `view_read_failed`: the view's read of its object throws, so the view shows an error. */
const VIEW_READ_FAILED: UserTextEntry = {
  en: (p) =>
    `The view "${p.view}" cannot read "${p.object}", so it shows an error instead of records. Make sure ` +
    `"${p.object}" is published, then publish again.`,
  'zh-Hans': (p) =>
    `视图“${p.view}”无法读取“${p.object}”，因此它会显示错误而不是记录。请确认“${p.object}”已发布，然后重新发布。`,
  'zh-Hant': (p) =>
    `檢視「${p.view}」無法讀取「${p.object}」，因此它會顯示錯誤而不是記錄。請確認「${p.object}」已發布，然後重新發布。`,
  es: (p) =>
    `La vista "${p.view}" no puede leer "${p.object}", por lo que muestra un error en lugar de registros. ` +
    `Asegúrese de que "${p.object}" esté publicado y vuelva a publicar.`,
  ar: (p) =>
    `لا يستطيع العرض "${p.view}" قراءة "${p.object}"، لذلك يظهر خطأ بدلًا من السجلات. تأكد من أن ` +
    `"${p.object}" منشور، ثم أعد النشر.`,
  fr: (p) =>
    `La vue « ${p.view} » ne peut pas lire « ${p.object} » ; elle affiche donc une erreur au lieu des ` +
    `enregistrements. Vérifiez que « ${p.object} » est publié, puis publiez à nouveau.`,
  'pt-BR': (p) =>
    `A visualização "${p.view}" não consegue ler "${p.object}", então mostra um erro em vez de registros. ` +
    `Verifique se "${p.object}" está publicado e publique novamente.`,
  ru: (p) =>
    `Представление «${p.view}» не может прочитать объект «${p.object}», поэтому вместо записей оно показывает ` +
    `ошибку. Убедитесь, что объект «${p.object}» опубликован, и опубликуйте снова.`,
  de: (p) =>
    `Die Ansicht „${p.view}“ kann „${p.object}“ nicht lesen und zeigt deshalb einen Fehler statt Datensätze. ` +
    `Stellen Sie sicher, dass „${p.object}“ veröffentlicht ist, und veröffentlichen Sie dann erneut.`,
  ja: (p) =>
    `ビュー「${p.view}」は「${p.object}」を読み取れないため、レコードの代わりにエラーが表示されます。` +
    `「${p.object}」が公開されていることを確認してから、もう一度公開してください。`,
  ko: (p) =>
    `뷰 "${p.view}"이(가) "${p.object}"을(를) 읽을 수 없어 레코드 대신 오류가 표시됩니다. ` +
    `"${p.object}"이(가) 게시되었는지 확인한 다음 다시 게시하세요.`,
};

/**
 * `object_field_ref_unknown`: a setting of the object names a field the
 * setting cannot use. Worded for the whole family the rule reports under this
 * code: a name that is no field of the object, and a field that exists but
 * cannot stand at that position (a path through a relation, a field computed
 * on read). The position itself stays in `message`, which carries the path.
 */
const OBJECT_FIELD_REF_UNKNOWN: UserTextEntry = {
  en: (p) =>
    `One of the settings of "${p.object}" names a field that does not exist or cannot be used there, so that ` +
    `setting does not work. Correct the field it names, then publish again.`,
  'zh-Hans': (p) =>
    `“${p.object}”的某项设置引用了一个不存在或不能在该处使用的字段，因此这项设置不会生效。请更正它引用的字段，然后重新发布。`,
  'zh-Hant': (p) =>
    `「${p.object}」的某項設定參照了一個不存在或不能在該處使用的欄位，因此這項設定不會生效。請更正它參照的欄位，然後重新發布。`,
  es: (p) =>
    `Uno de los ajustes de "${p.object}" nombra un campo que no existe o que no se puede usar ahí, por lo que ` +
    `ese ajuste no funciona. Corrija el campo que nombra y vuelva a publicar.`,
  ar: (p) =>
    `أحد إعدادات "${p.object}" يشير إلى حقل غير موجود أو لا يمكن استخدامه هناك، لذلك لا يعمل هذا الإعداد. ` +
    `صحّح الحقل الذي يشير إليه ثم أعد النشر.`,
  fr: (p) =>
    `L’un des paramètres de « ${p.object} » désigne un champ qui n’existe pas ou qui ne peut pas être utilisé à ` +
    `cet endroit ; ce paramètre ne fonctionne donc pas. Corrigez le champ qu’il désigne, puis publiez à nouveau.`,
  'pt-BR': (p) =>
    `Uma das configurações de "${p.object}" cita um campo que não existe ou que não pode ser usado ali, então ` +
    `essa configuração não funciona. Corrija o campo citado e publique novamente.`,
  ru: (p) =>
    `Одна из настроек объекта «${p.object}» ссылается на поле, которого нет или которое нельзя использовать в ` +
    `этом месте, поэтому эта настройка не работает. Исправьте поле, на которое она ссылается, и опубликуйте снова.`,
  de: (p) =>
    `Eine der Einstellungen von „${p.object}“ nennt ein Feld, das nicht existiert oder dort nicht verwendet ` +
    `werden kann; diese Einstellung funktioniert deshalb nicht. Korrigieren Sie das genannte Feld und ` +
    `veröffentlichen Sie dann erneut.`,
  ja: (p) =>
    `「${p.object}」の設定の 1 つが、存在しないフィールド、またはその場所では使用できないフィールドを指定しているため、` +
    `その設定は機能しません。指定されているフィールドを修正してから、もう一度公開してください。`,
  ko: (p) =>
    `"${p.object}"의 설정 중 하나가 존재하지 않거나 해당 위치에서 사용할 수 없는 필드를 지정하고 있어 그 설정이 ` +
    `작동하지 않습니다. 지정된 필드를 수정한 다음 다시 게시하세요.`,
};

/** `object_field_ref_rule_failed`: the check itself failed, so the object's field settings are unverified. */
const OBJECT_FIELD_REF_RULE_FAILED: UserTextEntry = {
  en: (p) =>
    `"${p.object}" was published, but its field settings could not be checked. The problem is in the check ` +
    `itself, not necessarily in "${p.object}"; contact your administrator if it happens again.`,
  'zh-Hans': (p) =>
    `“${p.object}”已发布，但无法检查它的字段设置。问题出在检查本身，不一定出在“${p.object}”上；如果再次出现，请联系管理员。`,
  'zh-Hant': (p) =>
    `「${p.object}」已發布，但無法檢查它的欄位設定。問題出在檢查本身，不一定出在「${p.object}」上；如果再次出現，請聯絡管理員。`,
  es: (p) =>
    `"${p.object}" se publicó, pero no se pudo comprobar la configuración de sus campos. El problema está en la ` +
    `comprobación, no necesariamente en "${p.object}"; si ocurre de nuevo, póngase en contacto con su administrador.`,
  ar: (p) =>
    `تم نشر "${p.object}"، لكن تعذّر التحقق من إعدادات حقوله. المشكلة في عملية التحقق نفسها وليست بالضرورة في ` +
    `"${p.object}"؛ إذا تكرر ذلك فتواصل مع المسؤول.`,
  fr: (p) =>
    `« ${p.object} » a été publié, mais les paramètres de ses champs n’ont pas pu être vérifiés. Le problème ` +
    `vient de la vérification elle-même, pas nécessairement de « ${p.object} » ; si cela se reproduit, contactez ` +
    `votre administrateur.`,
  'pt-BR': (p) =>
    `"${p.object}" foi publicado, mas não foi possível verificar as configurações dos campos dele. O problema ` +
    `está na verificação, não necessariamente em "${p.object}"; se acontecer de novo, entre em contato com o ` +
    `administrador.`,
  ru: (p) =>
    `Объект «${p.object}» опубликован, но настройки его полей проверить не удалось. Проблема в самой проверке, ` +
    `а не обязательно в объекте «${p.object}»; если это повторится, обратитесь к администратору.`,
  de: (p) =>
    `„${p.object}“ wurde veröffentlicht, aber seine Feldeinstellungen konnten nicht geprüft werden. Das Problem ` +
    `liegt in der Prüfung selbst, nicht unbedingt in „${p.object}“; wenden Sie sich an Ihren Administrator, ` +
    `wenn das wieder passiert.`,
  ja: (p) =>
    `「${p.object}」は公開されましたが、フィールド設定を確認できませんでした。問題は確認処理そのものにあり、` +
    `「${p.object}」にあるとは限りません。再び発生する場合は管理者にお問い合わせください。`,
  ko: (p) =>
    `"${p.object}"은(는) 게시되었지만 필드 설정을 확인하지 못했습니다. 문제는 확인 과정 자체에 있으며 ` +
    `"${p.object}"에 있다고 단정할 수 없습니다. 문제가 반복되면 관리자에게 문의하세요.`,
};

/**
 * `widget_not_probed`: the widget's dataset name could not be read, so the
 * widget was not exercised. Three causes, the refusal's own: the publishing
 * package does not depend on the holder (`outside-closure`), it depends on
 * several holders (`ambiguous-in-closure`), or the read had no package and
 * the name has several holders (`several-holders`).
 */
const WIDGET_NOT_PROBED: UserTextEntry = {
  en: (p) => {
    const head = `${WIDGET_ON_DASHBOARD.en(p)} was not checked: `;
    if (p.cause === 'outside-closure') {
      return (
        `${head}its dataset "${p.dataset}" belongs to a package that this one does not depend on. Add that ` +
        `package as a dependency, or keep the dataset in this package, then publish again.`
      );
    }
    if (p.cause === 'ambiguous-in-closure') {
      return (
        `${head}more than one package that this one depends on has a dataset named "${p.dataset}", so the ` +
        `dashboard cannot tell which one it means. Depend on only one of them, or keep the dataset in this ` +
        `package, then publish again.`
      );
    }
    return (
      `${head}more than one dataset is named "${p.dataset}", so the dashboard cannot tell which one it means. ` +
      `Rename or remove the others, then publish again.`
    );
  },
  'zh-Hans': (p) => {
    const head = `${WIDGET_ON_DASHBOARD['zh-Hans'](p)}未被检查：`;
    if (p.cause === 'outside-closure') {
      return (
        `${head}它的数据集“${p.dataset}”属于当前软件包未依赖的软件包。请把那个软件包添加为依赖，` +
        `或把该数据集放在当前软件包中，然后重新发布。`
      );
    }
    if (p.cause === 'ambiguous-in-closure') {
      return (
        `${head}当前软件包依赖的多个软件包中都有名为“${p.dataset}”的数据集，仪表盘无法确定用的是哪一个。` +
        `请只依赖其中一个软件包，或把该数据集放在当前软件包中，然后重新发布。`
      );
    }
    return `${head}有多个数据集都叫“${p.dataset}”，仪表盘无法确定用的是哪一个。请重命名或删除其余的数据集，然后重新发布。`;
  },
  'zh-Hant': (p) => {
    const head = `${WIDGET_ON_DASHBOARD['zh-Hant'](p)}未被檢查：`;
    if (p.cause === 'outside-closure') {
      return (
        `${head}它的資料集「${p.dataset}」屬於目前軟體包未依賴的軟體包。請把那個軟體包新增為依賴，` +
        `或把該資料集放在目前軟體包中，然後重新發布。`
      );
    }
    if (p.cause === 'ambiguous-in-closure') {
      return (
        `${head}目前軟體包依賴的多個軟體包中都有名為「${p.dataset}」的資料集，儀表盤無法確定用的是哪一個。` +
        `請只依賴其中一個軟體包，或把該資料集放在目前軟體包中，然後重新發布。`
      );
    }
    return `${head}有多個資料集都叫「${p.dataset}」，儀表盤無法確定用的是哪一個。請重新命名或刪除其餘的資料集，然後重新發布。`;
  },
  es: (p) => {
    const head = `${WIDGET_ON_DASHBOARD.es(p)} no se comprobó: `;
    if (p.cause === 'outside-closure') {
      return (
        `${head}su conjunto de datos "${p.dataset}" pertenece a un paquete del que este no depende. Agregue ese ` +
        `paquete como dependencia, o mantenga el conjunto de datos en este paquete, y vuelva a publicar.`
      );
    }
    if (p.cause === 'ambiguous-in-closure') {
      return (
        `${head}más de un paquete del que este depende tiene un conjunto de datos llamado "${p.dataset}", por lo ` +
        `que el panel no puede saber a cuál se refiere. Dependa solo de uno de ellos, o mantenga el conjunto de ` +
        `datos en este paquete, y vuelva a publicar.`
      );
    }
    return (
      `${head}hay más de un conjunto de datos llamado "${p.dataset}", por lo que el panel no puede saber a cuál ` +
      `se refiere. Cambie el nombre de los demás o elimínelos, y vuelva a publicar.`
    );
  },
  ar: (p) => {
    const head = `لم يتم التحقق من ${WIDGET_ON_DASHBOARD.ar(p)}: `;
    if (p.cause === 'outside-closure') {
      return (
        `${head}مجموعة البيانات "${p.dataset}" التي يستخدمها تتبع حزمة لا تعتمد عليها هذه الحزمة. أضف تلك ` +
        `الحزمة كتبعية، أو احتفظ بمجموعة البيانات في هذه الحزمة، ثم أعد النشر.`
      );
    }
    if (p.cause === 'ambiguous-in-closure') {
      return (
        `${head}أكثر من حزمة تعتمد عليها هذه الحزمة تحتوي على مجموعة بيانات باسم "${p.dataset}"، لذلك لا ` +
        `تستطيع لوحة القيادة تحديد المقصودة. اعتمد على واحدة منها فقط، أو احتفظ بمجموعة البيانات في هذه ` +
        `الحزمة، ثم أعد النشر.`
      );
    }
    return (
      `${head}توجد أكثر من مجموعة بيانات باسم "${p.dataset}"، لذلك لا تستطيع لوحة القيادة تحديد المقصودة. ` +
      `أعد تسمية المجموعات الأخرى أو احذفها، ثم أعد النشر.`
    );
  },
  fr: (p) => {
    const head = `${WIDGET_ON_DASHBOARD.fr(p)} n’a pas été vérifié : `;
    if (p.cause === 'outside-closure') {
      return (
        `${head}son jeu de données « ${p.dataset} » appartient à un paquet dont celui-ci ne dépend pas. Ajoutez ` +
        `ce paquet comme dépendance, ou conservez le jeu de données dans ce paquet-ci, puis publiez à nouveau.`
      );
    }
    if (p.cause === 'ambiguous-in-closure') {
      return (
        `${head}plusieurs paquets dont celui-ci dépend contiennent un jeu de données nommé « ${p.dataset} » ; le ` +
        `tableau de bord ne peut donc pas savoir lequel est visé. Ne dépendez que de l’un d’eux, ou conservez le ` +
        `jeu de données dans ce paquet-ci, puis publiez à nouveau.`
      );
    }
    return (
      `${head}plusieurs jeux de données s’appellent « ${p.dataset} » ; le tableau de bord ne peut donc pas ` +
      `savoir lequel est visé. Renommez ou supprimez les autres, puis publiez à nouveau.`
    );
  },
  'pt-BR': (p) => {
    const head = `${WIDGET_ON_DASHBOARD['pt-BR'](p)} não foi verificado: `;
    if (p.cause === 'outside-closure') {
      return (
        `${head}o conjunto de dados "${p.dataset}" dele pertence a um pacote do qual este não depende. Adicione ` +
        `esse pacote como dependência, ou mantenha o conjunto de dados neste pacote, e publique novamente.`
      );
    }
    if (p.cause === 'ambiguous-in-closure') {
      return (
        `${head}mais de um pacote do qual este depende tem um conjunto de dados chamado "${p.dataset}", então o ` +
        `painel não consegue saber qual deles usar. Dependa de apenas um deles, ou mantenha o conjunto de dados ` +
        `neste pacote, e publique novamente.`
      );
    }
    return (
      `${head}há mais de um conjunto de dados chamado "${p.dataset}", então o painel não consegue saber qual ` +
      `deles usar. Renomeie ou remova os outros e publique novamente.`
    );
  },
  ru: (p) => {
    const head = `${WIDGET_ON_DASHBOARD.ru(p)} не проверен: `;
    if (p.cause === 'outside-closure') {
      return (
        `${head}его набор данных «${p.dataset}» принадлежит пакету, от которого этот пакет не зависит. Добавьте ` +
        `тот пакет в зависимости или держите набор данных в этом пакете, затем опубликуйте снова.`
      );
    }
    if (p.cause === 'ambiguous-in-closure') {
      return (
        `${head}набор данных с именем «${p.dataset}» есть в нескольких пакетах, от которых зависит этот пакет, ` +
        `поэтому дашборд не может определить, какой из них имеется в виду. Оставьте зависимость только от одного ` +
        `из них или держите набор данных в этом пакете, затем опубликуйте снова.`
      );
    }
    return (
      `${head}имя «${p.dataset}» носят несколько наборов данных, поэтому дашборд не может определить, какой из ` +
      `них имеется в виду. Переименуйте или удалите остальные, затем опубликуйте снова.`
    );
  },
  de: (p) => {
    const head = `${WIDGET_ON_DASHBOARD.de(p)} wurde nicht geprüft: `;
    if (p.cause === 'outside-closure') {
      return (
        `${head}Sein Datensatz „${p.dataset}“ gehört zu einem Paket, von dem dieses Paket nicht abhängt. Fügen ` +
        `Sie jenes Paket als Abhängigkeit hinzu oder behalten Sie den Datensatz in diesem Paket, und ` +
        `veröffentlichen Sie dann erneut.`
      );
    }
    if (p.cause === 'ambiguous-in-closure') {
      return (
        `${head}Mehrere Pakete, von denen dieses Paket abhängt, enthalten einen Datensatz namens ` +
        `„${p.dataset}“, sodass das Dashboard nicht erkennen kann, welcher gemeint ist. Hängen Sie nur von einem ` +
        `davon ab oder behalten Sie den Datensatz in diesem Paket, und veröffentlichen Sie dann erneut.`
      );
    }
    return (
      `${head}Mehrere Datensätze heißen „${p.dataset}“, sodass das Dashboard nicht erkennen kann, welcher ` +
      `gemeint ist. Benennen Sie die anderen um oder entfernen Sie sie, und veröffentlichen Sie dann erneut.`
    );
  },
  ja: (p) => {
    const head = `${WIDGET_ON_DASHBOARD.ja(p)}は確認されませんでした。`;
    if (p.cause === 'outside-closure') {
      return (
        `${head}このウィジェットのデータセット「${p.dataset}」は、このパッケージが依存していないパッケージに属しています。` +
        `そのパッケージを依存関係に追加するか、データセットをこのパッケージ内に置いてから、もう一度公開してください。`
      );
    }
    if (p.cause === 'ambiguous-in-closure') {
      return (
        `${head}このパッケージが依存している複数のパッケージに「${p.dataset}」という名前のデータセットがあり、` +
        `ダッシュボードがどれを指しているか判断できません。そのうち 1 つのパッケージだけに依存するか、` +
        `データセットをこのパッケージ内に置いてから、もう一度公開してください。`
      );
    }
    return (
      `${head}「${p.dataset}」という名前のデータセットが複数あり、ダッシュボードがどれを指しているか判断できません。` +
      `ほかのデータセットの名前を変更するか削除してから、もう一度公開してください。`
    );
  },
  ko: (p) => {
    const head = `${WIDGET_ON_DASHBOARD.ko(p)}이(가) 확인되지 않았습니다. `;
    if (p.cause === 'outside-closure') {
      return (
        `${head}이 위젯의 데이터 세트 "${p.dataset}"이(가) 이 패키지가 종속되지 않은 패키지에 속해 있습니다. ` +
        `해당 패키지를 종속성으로 추가하거나 데이터 세트를 이 패키지에 둔 다음 다시 게시하세요.`
      );
    }
    if (p.cause === 'ambiguous-in-closure') {
      return (
        `${head}이 패키지가 종속된 여러 패키지에 "${p.dataset}"(이)라는 이름의 데이터 세트가 있어 대시보드가 ` +
        `어느 것을 가리키는지 알 수 없습니다. 그중 하나의 패키지에만 종속되게 하거나 데이터 세트를 이 패키지에 둔 ` +
        `다음 다시 게시하세요.`
      );
    }
    return (
      `${head}"${p.dataset}"(이)라는 이름의 데이터 세트가 여러 개 있어 대시보드가 어느 것을 가리키는지 알 수 ` +
      `없습니다. 나머지 데이터 세트의 이름을 바꾸거나 삭제한 다음 다시 게시하세요.`
    );
  },
};

/** `empty_query`: the widget's query runs and returns nothing, although its object has records. */
const EMPTY_QUERY: UserTextEntry = {
  en: (p) =>
    `${WIDGET_ON_DASHBOARD.en(p)} shows no data, although "${p.object}" has records. Check the fields that its ` +
    `dataset "${p.dataset}" measures and groups by, then publish again.`,
  'zh-Hans': (p) =>
    `${WIDGET_ON_DASHBOARD['zh-Hans'](p)}没有显示任何数据，但“${p.object}”中有记录。` +
    `请检查它的数据集“${p.dataset}”用于度量和分组的字段，然后重新发布。`,
  'zh-Hant': (p) =>
    `${WIDGET_ON_DASHBOARD['zh-Hant'](p)}沒有顯示任何資料，但「${p.object}」中有記錄。` +
    `請檢查它的資料集「${p.dataset}」用於度量和分組的欄位，然後重新發布。`,
  es: (p) =>
    `${WIDGET_ON_DASHBOARD.es(p)} no muestra datos, aunque "${p.object}" tiene registros. Revise los campos que ` +
    `su conjunto de datos "${p.dataset}" mide y agrupa, y vuelva a publicar.`,
  ar: (p) =>
    `${WIDGET_ON_DASHBOARD.ar(p)} لا يعرض أي بيانات مع أن "${p.object}" يحتوي على سجلات. راجع الحقول التي ` +
    `تقيسها مجموعة البيانات "${p.dataset}" الخاصة به وتجمّع حسبها، ثم أعد النشر.`,
  fr: (p) =>
    `${WIDGET_ON_DASHBOARD.fr(p)} n’affiche aucune donnée, alors que « ${p.object} » contient des ` +
    `enregistrements. Vérifiez les champs que son jeu de données « ${p.dataset} » mesure et regroupe, puis ` +
    `publiez à nouveau.`,
  'pt-BR': (p) =>
    `${WIDGET_ON_DASHBOARD['pt-BR'](p)} não mostra dados, embora "${p.object}" tenha registros. Verifique os ` +
    `campos que o conjunto de dados "${p.dataset}" dele mede e agrupa, e publique novamente.`,
  ru: (p) =>
    `${WIDGET_ON_DASHBOARD.ru(p)} не показывает данных, хотя в объекте «${p.object}» есть записи. Проверьте ` +
    `поля, которые измеряет и по которым группирует его набор данных «${p.dataset}», затем опубликуйте снова.`,
  de: (p) =>
    `${WIDGET_ON_DASHBOARD.de(p)} zeigt keine Daten, obwohl „${p.object}“ nicht leer ist. Prüfen Sie die ` +
    `Felder, die sein Datensatz „${p.dataset}“ misst und nach denen er gruppiert, und veröffentlichen Sie dann ` +
    `erneut.`,
  ja: (p) =>
    `${WIDGET_ON_DASHBOARD.ja(p)}には、「${p.object}」にレコードがあるにもかかわらずデータが表示されません。` +
    `このウィジェットのデータセット「${p.dataset}」が集計とグループ化に使うフィールドを確認してから、` +
    `もう一度公開してください。`,
  ko: (p) =>
    `"${p.object}"에 레코드가 있는데도 ${WIDGET_ON_DASHBOARD.ko(p)}에 데이터가 표시되지 않습니다. ` +
    `이 위젯의 데이터 세트 "${p.dataset}"이(가) 측정하고 그룹화하는 필드를 확인한 다음 다시 게시하세요.`,
};

/**
 * `widget_query_failed`: the widget's query threw. Four causes, read from the
 * thrown error's code by the probe:
 *
 *  - `access` / `field-access`: read admission refused the publishing account
 *    for the object, or for fields of it. The dataset is fine, so the sentence
 *    names the access and never asks for a dataset change;
 *  - `unavailable`: the server could not decide read access at all. Nothing
 *    to change; the sentence says to publish again later;
 *  - `query`: everything else, a dataset or widget selection that does not run.
 *
 * `object` is empty when the error named no object and the dataset has none;
 * each locale then says "the data it reads".
 */
const WIDGET_QUERY_FAILED: UserTextEntry = {
  en: (p) => {
    const head = WIDGET_ON_DASHBOARD.en(p);
    if (p.cause === 'access' || p.cause === 'field-access') {
      const what =
        p.cause === 'field-access'
          ? p.object ? `some fields of "${p.object}"` : 'some of the fields it reads'
          : p.object ? `"${p.object}"` : 'the data it reads';
      return (
        `${head} could not load its data: the account that published it does not have read access to ${what}. ` +
        `Ask an administrator for that access, then publish again. People who already have it can see the widget.`
      );
    }
    if (p.cause === 'unavailable') {
      return (
        `${head} was not checked: the server could not confirm read access to ` +
        `${p.object ? `"${p.object}"` : 'the data it reads'} this time. The widget needs no change; publish ` +
        `again later, and contact your administrator if it happens again.`
      );
    }
    return (
      `${head} cannot load its data, so it shows an error. Check its dataset "${p.dataset}" and the values the ` +
      `widget shows, then publish again.`
    );
  },
  'zh-Hans': (p) => {
    const head = WIDGET_ON_DASHBOARD['zh-Hans'](p);
    if (p.cause === 'access' || p.cause === 'field-access') {
      const what =
        p.cause === 'field-access'
          ? p.object ? `“${p.object}”中部分字段` : '它所读取的部分字段'
          : p.object ? `“${p.object}”` : '它所读取数据';
      return (
        `${head}无法加载数据：发布时使用的账号没有${what}的读取权限。请让管理员授予该权限，然后重新发布。` +
        `已有该权限的人可以正常看到这个组件。`
      );
    }
    if (p.cause === 'unavailable') {
      return (
        `${head}未被检查：服务器这次无法确认${p.object ? `“${p.object}”` : '它所读取数据'}的读取权限。` +
        `该组件无需修改；请稍后重新发布，如果再次出现，请联系管理员。`
      );
    }
    return `${head}无法加载数据，因此会显示错误。请检查它的数据集“${p.dataset}”以及该组件显示的值，然后重新发布。`;
  },
  'zh-Hant': (p) => {
    const head = WIDGET_ON_DASHBOARD['zh-Hant'](p);
    if (p.cause === 'access' || p.cause === 'field-access') {
      const what =
        p.cause === 'field-access'
          ? p.object ? `「${p.object}」中部分欄位` : '它所讀取的部分欄位'
          : p.object ? `「${p.object}」` : '它所讀取資料';
      return (
        `${head}無法載入資料：發布時使用的賬號沒有${what}的讀取權限。請讓管理員授予該權限，然後重新發布。` +
        `已有該權限的人可以正常看到這個元件。`
      );
    }
    if (p.cause === 'unavailable') {
      return (
        `${head}未被檢查：伺服器這次無法確認${p.object ? `「${p.object}」` : '它所讀取資料'}的讀取權限。` +
        `該元件無需修改；請稍後重新發布，如果再次出現，請聯絡管理員。`
      );
    }
    return `${head}無法載入資料，因此會顯示錯誤。請檢查它的資料集「${p.dataset}」以及該元件顯示的值，然後重新發布。`;
  },
  es: (p) => {
    const head = WIDGET_ON_DASHBOARD.es(p);
    if (p.cause === 'access' || p.cause === 'field-access') {
      const what =
        p.cause === 'field-access'
          ? p.object ? `algunos campos de "${p.object}"` : 'algunos de los campos que lee'
          : p.object ? `"${p.object}"` : 'los datos que lee';
      return (
        `${head} no pudo cargar sus datos: la cuenta que lo publicó no tiene acceso de lectura a ${what}. Pida ` +
        `ese acceso a un administrador y vuelva a publicar. Quienes ya lo tienen pueden ver el widget.`
      );
    }
    if (p.cause === 'unavailable') {
      return (
        `${head} no se comprobó: esta vez el servidor no pudo confirmar el acceso de lectura a ` +
        `${p.object ? `"${p.object}"` : 'los datos que lee'}. El widget no necesita cambios; vuelva a publicar ` +
        `más tarde y, si ocurre de nuevo, póngase en contacto con su administrador.`
      );
    }
    return (
      `${head} no puede cargar sus datos, por lo que muestra un error. Revise su conjunto de datos ` +
      `"${p.dataset}" y los valores que muestra el widget, y vuelva a publicar.`
    );
  },
  ar: (p) => {
    const head = WIDGET_ON_DASHBOARD.ar(p);
    if (p.cause === 'access' || p.cause === 'field-access') {
      const what =
        p.cause === 'field-access'
          ? p.object ? `بعض حقول "${p.object}"` : 'بعض الحقول التي يقرؤها'
          : p.object ? `"${p.object}"` : 'البيانات التي يقرؤها';
      return (
        `تعذّر على ${head} تحميل بياناته: الحساب الذي نشره لا يملك صلاحية قراءة ${what}. اطلب هذه الصلاحية من ` +
        `المسؤول ثم أعد النشر. من يملك هذه الصلاحية يستطيع رؤية العنصر.`
      );
    }
    if (p.cause === 'unavailable') {
      return (
        `لم يتم التحقق من ${head}: تعذّر على الخادم هذه المرة تأكيد صلاحية قراءة ` +
        `${p.object ? `"${p.object}"` : 'البيانات التي يقرؤها'}. لا يحتاج العنصر إلى أي تغيير؛ أعد النشر ` +
        `لاحقًا، وإذا تكرر ذلك فتواصل مع المسؤول.`
      );
    }
    return (
      `لا يستطيع ${head} تحميل بياناته، لذلك يعرض خطأ. راجع مجموعة البيانات "${p.dataset}" الخاصة به والقيم ` +
      `التي يعرضها العنصر، ثم أعد النشر.`
    );
  },
  fr: (p) => {
    const head = WIDGET_ON_DASHBOARD.fr(p);
    if (p.cause === 'access' || p.cause === 'field-access') {
      const what =
        p.cause === 'field-access'
          ? p.object ? `à certains champs de « ${p.object} »` : 'à certains des champs qu’il lit'
          : p.object ? `à « ${p.object} »` : 'aux données qu’il lit';
      return (
        `${head} n’a pas pu charger ses données : le compte qui l’a publié n’a pas d’accès en lecture ${what}. ` +
        `Demandez cet accès à un administrateur, puis publiez à nouveau. Les personnes qui l’ont déjà peuvent ` +
        `voir le widget.`
      );
    }
    if (p.cause === 'unavailable') {
      return (
        `${head} n’a pas été vérifié : cette fois, le serveur n’a pas pu confirmer l’accès en lecture ` +
        `${p.object ? `à « ${p.object} »` : 'aux données qu’il lit'}. Le widget n’a besoin d’aucune ` +
        `modification ; publiez à nouveau plus tard et, si cela se reproduit, contactez votre administrateur.`
      );
    }
    return (
      `${head} ne peut pas charger ses données ; il affiche donc une erreur. Vérifiez son jeu de données ` +
      `« ${p.dataset} » et les valeurs que le widget affiche, puis publiez à nouveau.`
    );
  },
  'pt-BR': (p) => {
    const head = WIDGET_ON_DASHBOARD['pt-BR'](p);
    if (p.cause === 'access' || p.cause === 'field-access') {
      const what =
        p.cause === 'field-access'
          ? p.object ? `a alguns campos de "${p.object}"` : 'a alguns dos campos que ele lê'
          : p.object ? `a "${p.object}"` : 'aos dados que ele lê';
      return (
        `${head} não conseguiu carregar os dados: a conta que o publicou não tem acesso de leitura ${what}. ` +
        `Peça esse acesso a um administrador e publique novamente. Quem já tem esse acesso consegue ver o widget.`
      );
    }
    if (p.cause === 'unavailable') {
      return (
        `${head} não foi verificado: desta vez o servidor não conseguiu confirmar o acesso de leitura ` +
        `${p.object ? `a "${p.object}"` : 'aos dados que ele lê'}. O widget não precisa de alterações; publique ` +
        `novamente mais tarde e, se acontecer de novo, entre em contato com o administrador.`
      );
    }
    return (
      `${head} não consegue carregar os dados, então mostra um erro. Verifique o conjunto de dados ` +
      `"${p.dataset}" dele e os valores que o widget mostra, e publique novamente.`
    );
  },
  ru: (p) => {
    const head = WIDGET_ON_DASHBOARD.ru(p);
    if (p.cause === 'access' || p.cause === 'field-access') {
      const what =
        p.cause === 'field-access'
          ? p.object ? `к некоторым полям объекта «${p.object}»` : 'к некоторым полям, которые он читает'
          : p.object ? `к объекту «${p.object}»` : 'к данным, которые он читает';
      return (
        `${head} не смог загрузить данные: у учётной записи, выполнившей публикацию, нет доступа на чтение ` +
        `${what}. Попросите администратора выдать этот доступ и опубликуйте снова. Те, у кого он уже есть, ` +
        `видят виджет.`
      );
    }
    if (p.cause === 'unavailable') {
      return (
        `${head} не проверен: в этот раз сервер не смог подтвердить доступ на чтение ` +
        `${p.object ? `к объекту «${p.object}»` : 'к данным, которые он читает'}. Менять виджет не нужно; ` +
        `опубликуйте снова позже, а если это повторится, обратитесь к администратору.`
      );
    }
    return (
      `${head} не может загрузить данные и поэтому показывает ошибку. Проверьте его набор данных ` +
      `«${p.dataset}» и значения, которые показывает виджет, затем опубликуйте снова.`
    );
  },
  de: (p) => {
    const head = WIDGET_ON_DASHBOARD.de(p);
    if (p.cause === 'access' || p.cause === 'field-access') {
      const what =
        p.cause === 'field-access'
          ? p.object ? `einige Felder von „${p.object}“` : 'einige der Felder, die es liest'
          : p.object ? `„${p.object}“` : 'die Daten, die es liest';
      return (
        `${head} konnte seine Daten nicht laden: Das Konto, das veröffentlicht hat, hat keinen Lesezugriff auf ` +
        `${what}. Bitten Sie einen Administrator um diesen Zugriff und veröffentlichen Sie dann erneut. Wer ihn ` +
        `bereits hat, kann das Widget sehen.`
      );
    }
    if (p.cause === 'unavailable') {
      return (
        `${head} wurde nicht geprüft: Der Server konnte den Lesezugriff auf ` +
        `${p.object ? `„${p.object}“` : 'die Daten, die es liest'} diesmal nicht bestätigen. Das Widget muss ` +
        `nicht geändert werden; veröffentlichen Sie später erneut und wenden Sie sich an Ihren Administrator, ` +
        `wenn das wieder passiert.`
      );
    }
    return (
      `${head} kann seine Daten nicht laden und zeigt deshalb einen Fehler. Prüfen Sie seinen Datensatz ` +
      `„${p.dataset}“ und die Werte, die das Widget anzeigt, und veröffentlichen Sie dann erneut.`
    );
  },
  ja: (p) => {
    const head = WIDGET_ON_DASHBOARD.ja(p);
    if (p.cause === 'access' || p.cause === 'field-access') {
      const what =
        p.cause === 'field-access'
          ? p.object ? `「${p.object}」の一部のフィールド` : 'このウィジェットが読み取る一部のフィールド'
          : p.object ? `「${p.object}」` : 'このウィジェットが読み取るデータ';
      return (
        `${head}はデータを読み込めませんでした。公開に使用したアカウントに${what}の読み取り権限がありません。` +
        `管理者にその権限を依頼してから、もう一度公開してください。すでに権限を持っているユーザーにはウィジェットが表示されます。`
      );
    }
    if (p.cause === 'unavailable') {
      return (
        `${head}は確認されませんでした。今回はサーバーが` +
        `${p.object ? `「${p.object}」` : 'このウィジェットが読み取るデータ'}の読み取り権限を確認できませんでした。` +
        `ウィジェットを変更する必要はありません。しばらくしてからもう一度公開し、再び発生する場合は管理者にお問い合わせください。`
      );
    }
    return (
      `${head}はデータを読み込めないため、エラーが表示されます。このウィジェットのデータセット「${p.dataset}」と` +
      `ウィジェットに表示する値を確認してから、もう一度公開してください。`
    );
  },
  ko: (p) => {
    const head = WIDGET_ON_DASHBOARD.ko(p);
    if (p.cause === 'access' || p.cause === 'field-access') {
      const what =
        p.cause === 'field-access'
          ? p.object ? `"${p.object}"의 일부 필드` : '이 위젯이 읽는 일부 필드'
          : p.object ? `"${p.object}"` : '이 위젯이 읽는 데이터';
      return (
        `${head}이(가) 데이터를 불러오지 못했습니다. 게시에 사용한 계정에 ${what}에 대한 읽기 권한이 없습니다. ` +
        `관리자에게 해당 권한을 요청한 다음 다시 게시하세요. 이미 권한이 있는 사용자는 위젯을 볼 수 있습니다.`
      );
    }
    if (p.cause === 'unavailable') {
      return (
        `${head}이(가) 확인되지 않았습니다. 이번에는 서버가 ` +
        `${p.object ? `"${p.object}"` : '이 위젯이 읽는 데이터'}에 대한 읽기 권한을 확인하지 못했습니다. ` +
        `위젯을 변경할 필요는 없습니다. 나중에 다시 게시하고, 문제가 반복되면 관리자에게 문의하세요.`
      );
    }
    return (
      `${head}이(가) 데이터를 불러올 수 없어 오류가 표시됩니다. 이 위젯의 데이터 세트 "${p.dataset}"과(와) ` +
      `위젯에 표시하는 값을 확인한 다음 다시 게시하세요.`
    );
  },
};

/**
 * `probes_unavailable`: the publish has dataset widgets and no analytics
 * service to run them through, so none was exercised. One finding for the
 * whole publish, so the sentence names no dashboard, and it is worded so the
 * count needs no plural form in any locale.
 */
const PROBES_UNAVAILABLE: UserTextEntry = {
  en: (p) =>
    `Dashboard widgets were not checked (${p.count} in total), because analytics is not available in this ` +
    `environment. Open each published dashboard to see whether its widgets load.`,
  'zh-Hans': (p) =>
    `仪表盘组件未被检查（共 ${p.count} 个），因为当前环境中没有可用的分析服务。` +
    `请打开每个已发布的仪表盘，确认其中的组件能否正常加载。`,
  'zh-Hant': (p) =>
    `儀表盤元件未被檢查（共 ${p.count} 個），因為目前環境中沒有可用的分析服務。` +
    `請開啟每個已發布的儀表盤，確認其中的元件能否正常載入。`,
  es: (p) =>
    `No se comprobaron los widgets de los paneles de control (${p.count} en total), porque el análisis no está ` +
    `disponible en este entorno. Abra cada panel publicado para ver si sus widgets se cargan.`,
  ar: (p) =>
    `لم يتم التحقق من عناصر لوحات القيادة (المجموع: ${p.count})، لأن خدمة التحليلات غير متاحة في هذه البيئة. ` +
    `افتح كل لوحة قيادة منشورة للتأكد من تحميل عناصرها.`,
  fr: (p) =>
    `Les widgets des tableaux de bord n’ont pas été vérifiés (${p.count} au total), car l’analyse n’est pas ` +
    `disponible dans cet environnement. Ouvrez chaque tableau de bord publié pour voir si ses widgets se chargent.`,
  'pt-BR': (p) =>
    `Os widgets dos painéis não foram verificados (${p.count} no total), porque a análise não está disponível ` +
    `neste ambiente. Abra cada painel publicado para ver se os widgets dele carregam.`,
  ru: (p) =>
    `Виджеты дашбордов не проверены (всего: ${p.count}), потому что аналитика недоступна в этой среде. ` +
    `Откройте каждый опубликованный дашборд и посмотрите, загружаются ли его виджеты.`,
  de: (p) =>
    `Die Dashboard-Widgets wurden nicht geprüft (insgesamt ${p.count}), weil die Analysefunktion in dieser ` +
    `Umgebung nicht verfügbar ist. Öffnen Sie jedes veröffentlichte Dashboard, um zu sehen, ob seine Widgets ` +
    `geladen werden.`,
  ja: (p) =>
    `この環境では分析機能を利用できないため、ダッシュボードのウィジェットは確認されませんでした（合計 ${p.count} 件）。` +
    `公開した各ダッシュボードを開いて、ウィジェットが読み込まれるか確認してください。`,
  ko: (p) =>
    `이 환경에서는 분석 기능을 사용할 수 없어 대시보드 위젯이 확인되지 않았습니다(총 ${p.count}개). ` +
    `게시된 각 대시보드를 열어 위젯이 로드되는지 확인하세요.`,
};

/** `widget_empty_result`: the widget's real query answered only zeros, so the card shows an empty "0" tile. */
const WIDGET_EMPTY_RESULT: UserTextEntry = {
  en: (p) =>
    `${WIDGET_ON_DASHBOARD.en(p)} shows only zeros: its data source "${p.dataset}" has nothing to count right now. ` +
    `If that is not expected, check the records it reads (their dates and values), then publish again.`,
  'zh-Hans': (p) =>
    `${WIDGET_ON_DASHBOARD['zh-Hans'](p)}只显示 0：它的数据源“${p.dataset}”目前没有可统计的内容。` +
    `如果这不符合预期，请检查它读取的记录（日期和数值），然后重新发布。`,
  'zh-Hant': (p) =>
    `${WIDGET_ON_DASHBOARD['zh-Hant'](p)}只顯示 0：它的資料來源「${p.dataset}」目前沒有可統計的內容。` +
    `如果這不符合預期，請檢查它讀取的記錄（日期和數值），然後重新發布。`,
  es: (p) =>
    `${WIDGET_ON_DASHBOARD.es(p)} solo muestra ceros: su origen de datos "${p.dataset}" no tiene nada que contar ` +
    `por ahora. Si no es lo esperado, revise los registros que lee (sus fechas y valores) y vuelva a publicar.`,
  ar: (p) =>
    `${WIDGET_ON_DASHBOARD.ar(p)} لا يعرض سوى أصفار: مصدر بياناته "${p.dataset}" لا يحتوي حاليًا على ما يمكن ` +
    `احتسابه. إذا لم يكن ذلك متوقعًا، فراجع السجلات التي يقرؤها (تواريخها وقيمها) ثم أعد النشر.`,
  fr: (p) =>
    `${WIDGET_ON_DASHBOARD.fr(p)} n’affiche que des zéros : sa source de données « ${p.dataset} » n’a rien à ` +
    `compter pour l’instant. Si ce n’est pas attendu, vérifiez les enregistrements qu’il lit (leurs dates et ` +
    `valeurs), puis publiez à nouveau.`,
  'pt-BR': (p) =>
    `${WIDGET_ON_DASHBOARD['pt-BR'](p)} mostra apenas zeros: sua fonte de dados "${p.dataset}" não tem nada a ` +
    `contar no momento. Se isso não for o esperado, verifique os registros que ele lê (datas e valores) e publique novamente.`,
  ru: (p) =>
    `${WIDGET_ON_DASHBOARD.ru(p)} показывает только нули: в его источнике данных «${p.dataset}» сейчас нечего ` +
    `считать. Если это неожиданно, проверьте записи, которые он читает (их даты и значения), и опубликуйте снова.`,
  de: (p) =>
    `${WIDGET_ON_DASHBOARD.de(p)} zeigt nur Nullen: Seine Datenquelle „${p.dataset}“ hat derzeit nichts zu zählen. ` +
    `Wenn das nicht erwartet ist, prüfen Sie die Datensätze, die es liest (Datumswerte und Werte), und ` +
    `veröffentlichen Sie dann erneut.`,
  ja: (p) =>
    `${WIDGET_ON_DASHBOARD.ja(p)}は 0 しか表示していません。データソース「${p.dataset}」には現在集計する内容がありません。` +
    `想定外の場合は、読み取るレコード（日付と値）を確認してから、もう一度公開してください。`,
  ko: (p) =>
    `${WIDGET_ON_DASHBOARD.ko(p)}에 0만 표시됩니다. 데이터 소스 "${p.dataset}"에 현재 집계할 내용이 없습니다. ` +
    `예상과 다르다면 읽어 오는 레코드(날짜와 값)를 확인한 후 다시 게시하세요.`,
};

/** `rollup_never_computed`: a roll-up field reads blank on the records checked that have related records (one organization's sampled parents); `cause` `named` is a min, max or avg roll-up, which the plain run does not fill. */
const ROLLUP_NEVER_COMPUTED: UserTextEntry = {
  en: (p) =>
    `The roll-up field "${p.field}" on "${p.object}" is blank on the records checked that have related "${p.child}" ` +
    `records: its stored value was never calculated for them. ` +
    (p.cause === 'named'
      ? `Ask whoever runs this environment to recalculate it by name (\`os migrate summary-nulls --apply --recompute-undefined-on-empty\`, naming this field): a minimum, ` +
        `maximum or average roll-up is not filled by the plain recalculation.`
      : `Ask whoever runs this environment to recalculate the roll-ups (\`os migrate summary-nulls --apply\`).`),
  'zh-Hans': (p) =>
    `“${p.object}”的汇总字段“${p.field}”在所检查的、有相关“${p.child}”记录的记录上都是空的：它的存储值从未为这些记录计算过。` +
    (p.cause === 'named'
      ? `请让负责此环境的人按名称重新计算它（\`os migrate summary-nulls --apply --recompute-undefined-on-empty\`，并指明此字段）：最小值、最大值或平均值汇总不会被普通的重新计算填充。`
      : `请让负责此环境的人重新计算汇总字段（\`os migrate summary-nulls --apply\`）。`),
  'zh-Hant': (p) =>
    `「${p.object}」的匯總欄位「${p.field}」在所檢查的、有相關「${p.child}」記錄的記錄上都是空的：它的儲存值從未為這些記錄計算過。` +
    (p.cause === 'named'
      ? `請讓負責此環境的人按名稱重新計算它（\`os migrate summary-nulls --apply --recompute-undefined-on-empty\`，並指明此欄位）：最小值、最大值或平均值匯總不會被一般的重新計算填入。`
      : `請讓負責此環境的人重新計算匯總欄位（\`os migrate summary-nulls --apply\`）。`),
  es: (p) =>
    `El campo de resumen "${p.field}" de "${p.object}" está vacío en los registros revisados que tienen registros ` +
    `relacionados de "${p.child}": su valor almacenado nunca se calculó para ellos. ` +
    (p.cause === 'named'
      ? `Pida a quien administra este entorno que lo recalcule por nombre (\`os migrate summary-nulls --apply --recompute-undefined-on-empty\`, indicando este campo): ` +
        `un resumen de mínimo, máximo o promedio no se rellena con el recálculo normal.`
      : `Pida a quien administra este entorno que recalcule los resúmenes (\`os migrate summary-nulls --apply\`).`),
  ar: (p) =>
    `حقل التجميع "${p.field}" في "${p.object}" فارغ في السجلات التي فُحصت ولها سجلات "${p.child}" مرتبطة: لم تُحسب قيمته المخزنة لها قط. ` +
    (p.cause === 'named'
      ? `اطلب من مسؤول هذه البيئة إعادة حسابه بالاسم (\`os migrate summary-nulls --apply --recompute-undefined-on-empty\` مع تسمية هذا الحقل): ` +
        `حقل تجميع الحد الأدنى أو الأقصى أو المتوسط لا تملؤه إعادة الحساب العادية.`
      : `اطلب من مسؤول هذه البيئة إعادة حساب حقول التجميع (\`os migrate summary-nulls --apply\`).`),
  fr: (p) =>
    `Le champ de synthèse « ${p.field} » de « ${p.object} » est vide sur les enregistrements vérifiés qui ont des ` +
    `enregistrements « ${p.child} » liés : sa valeur stockée n’a jamais été calculée pour eux. ` +
    (p.cause === 'named'
      ? `Demandez à la personne qui gère cet environnement de le recalculer nommément (\`os migrate summary-nulls --apply --recompute-undefined-on-empty\`, en nommant ce ` +
        `champ) : une synthèse minimum, maximum ou moyenne n’est pas remplie par le recalcul ordinaire.`
      : `Demandez à la personne qui gère cet environnement de recalculer les synthèses (\`os migrate summary-nulls --apply\`).`),
  'pt-BR': (p) =>
    `O campo de resumo "${p.field}" de "${p.object}" está vazio nos registros verificados que têm registros ` +
    `relacionados de "${p.child}": seu valor armazenado nunca foi calculado para eles. ` +
    (p.cause === 'named'
      ? `Peça a quem administra este ambiente que o recalcule pelo nome (\`os migrate summary-nulls --apply --recompute-undefined-on-empty\`, indicando este campo): ` +
        `um resumo de mínimo, máximo ou média não é preenchido pelo recálculo comum.`
      : `Peça a quem administra este ambiente que recalcule os resumos (\`os migrate summary-nulls --apply\`).`),
  ru: (p) =>
    `Сводное поле «${p.field}» объекта «${p.object}» пустое в проверенных записях, у которых есть связанные записи ` +
    `«${p.child}»: его сохранённое значение для них ни разу не рассчитывалось. ` +
    (p.cause === 'named'
      ? `Попросите администратора этой среды пересчитать его по имени (\`os migrate summary-nulls --apply --recompute-undefined-on-empty\` с указанием этого поля): ` +
        `сводное поле минимума, максимума или среднего обычный пересчёт не заполняет.`
      : `Попросите администратора этой среды пересчитать сводные поля (\`os migrate summary-nulls --apply\`).`),
  de: (p) =>
    `Das Rollup-Feld „${p.field}“ in „${p.object}“ ist bei den geprüften Datensätzen mit verknüpften „${p.child}“-Datensätzen ` +
    `leer: Sein gespeicherter Wert wurde für sie nie berechnet. ` +
    (p.cause === 'named'
      ? `Bitten Sie die Person, die diese Umgebung betreibt, es namentlich neu zu berechnen (\`os migrate summary-nulls --apply --recompute-undefined-on-empty\` mit diesem ` +
        `Feld): Ein Minimum-, Maximum- oder Durchschnitts-Rollup füllt die normale Neuberechnung nicht.`
      : `Bitten Sie die Person, die diese Umgebung betreibt, die Rollups neu zu berechnen (\`os migrate summary-nulls --apply\`).`),
  ja: (p) =>
    `「${p.object}」の積み上げ集計項目「${p.field}」は、関連する「${p.child}」レコードを持つ、確認したレコードで空です。` +
    `保存値がこれらのレコードについて一度も計算されていません。` +
    (p.cause === 'named'
      ? `この環境の管理者に、この項目を指定した再計算（\`os migrate summary-nulls --apply --recompute-undefined-on-empty\`）を依頼してください。` +
        `最小・最大・平均の集計は通常の再計算では埋まりません。`
      : `この環境の管理者に集計の再計算（\`os migrate summary-nulls --apply\`）を依頼してください。`),
  ko: (p) =>
    `"${p.object}"의 롤업 필드 "${p.field}"가 관련 "${p.child}" 레코드가 있는, 확인한 레코드에서 비어 있습니다. ` +
    `저장된 값이 이 레코드들에 대해 한 번도 계산되지 않았습니다. ` +
    (p.cause === 'named'
      ? `이 환경의 관리자에게 이 필드를 지정한 재계산(\`os migrate summary-nulls --apply --recompute-undefined-on-empty\`)을 요청하세요. ` +
        `최소·최대·평균 롤업은 일반 재계산으로 채워지지 않습니다.`
      : `이 환경의 관리자에게 롤업 재계산(\`os migrate summary-nulls --apply\`)을 요청하세요.`),
};

/**
 * `seed_reference_unresolved`: sample records point at records that do not exist. The repair is the one a
 * republish actually reaches: `seed` — the sample data writes the field back onto the records it finds again,
 * so it is fixed there; `mode` — the sample data leaves the records it finds as they are (the default), so the
 * stored records are fixed, or the sample data is set to update them; `stored` — the sample data never writes
 * that field onto a record it finds again, so only the stored records can be fixed.
 */
const SEED_REFERENCE_UNRESOLVED: UserTextEntry = {
  en: (p) =>
    `Some sample "${p.object}" records (${p.count} value(s) in "${p.field}") point to "${p.target}" records that ` +
    `do not exist, so on those records "${p.field}" leads nowhere. ` +
    (p.cause === 'mode'
      ? `Publishing again does not change records that already exist. Fix or clear "${p.field}" on those records, ` +
        `or delete them and publish the corrected sample data again, or set the sample data to update the records ` +
        `it finds (upsert) and fix "${p.field}" there.`
      : p.cause === 'stored'
      ? `Publishing again does not change "${p.field}" on records that already exist. Fix or clear "${p.field}" on ` +
        `those records, or delete them and publish the corrected sample data again.`
      : `Fix or clear "${p.field}" in the sample data, then publish again.`),
  'zh-Hans': (p) =>
    `部分“${p.object}”示例记录（“${p.field}”中有 ${p.count} 个值）指向不存在的“${p.target}”记录，因此这些记录上的“${p.field}”指向空处。` +
    (p.cause === 'mode'
      ? `重新发布不会更改已存在的记录。请在这些记录上修正或清空“${p.field}”，或删除它们后重新发布修正后的示例数据；` +
        `也可以把示例数据设为更新它找到的记录（upsert），并在其中修正“${p.field}”。`
      : p.cause === 'stored'
      ? `重新发布不会更改已存在记录上的“${p.field}”。请在这些记录上修正或清空“${p.field}”，或删除它们后重新发布修正后的示例数据。`
      : `请在示例数据中修正或清空“${p.field}”，然后重新发布。`),
  'zh-Hant': (p) =>
    `部分「${p.object}」示例記錄（「${p.field}」中有 ${p.count} 個值）指向不存在的「${p.target}」記錄，因此這些記錄上的「${p.field}」指向空處。` +
    (p.cause === 'mode'
      ? `重新發布不會變更已存在的記錄。請在這些記錄上修正或清空「${p.field}」，或刪除它們後重新發布修正後的示例資料；` +
        `也可以把示例資料設為更新它找到的記錄（upsert），並在其中修正「${p.field}」。`
      : p.cause === 'stored'
      ? `重新發布不會變更已存在記錄上的「${p.field}」。請在這些記錄上修正或清空「${p.field}」，或刪除它們後重新發布修正後的示例資料。`
      : `請在示例資料中修正或清空「${p.field}」，然後重新發布。`),
  es: (p) =>
    `Algunos registros de ejemplo de "${p.object}" (${p.count} valor(es) en "${p.field}") apuntan a registros de ` +
    `"${p.target}" que no existen, así que en esos registros "${p.field}" no lleva a ninguna parte. ` +
    (p.cause === 'mode'
      ? `Volver a publicar no cambia los registros que ya existen. Corrija o vacíe "${p.field}" en esos registros, ` +
        `o elimínelos y vuelva a publicar los datos de ejemplo corregidos, o configure los datos de ejemplo para ` +
        `actualizar los registros que encuentran (upsert) y corrija "${p.field}" en ellos.`
      : p.cause === 'stored'
      ? `Volver a publicar no cambia "${p.field}" en los registros que ya existen. Corrija o vacíe "${p.field}" en ` +
        `esos registros, o elimínelos y vuelva a publicar los datos de ejemplo corregidos.`
      : `Corrija o vacíe "${p.field}" en los datos de ejemplo y vuelva a publicar.`),
  ar: (p) =>
    `بعض سجلات "${p.object}" التجريبية (${p.count} قيمة في "${p.field}") تشير إلى سجلات "${p.target}" غير موجودة، ` +
    `لذلك لا يؤدي "${p.field}" في هذه السجلات إلى أي مكان. ` +
    (p.cause === 'mode'
      ? `إعادة النشر لا تغيّر السجلات الموجودة بالفعل. صحّح "${p.field}" في تلك السجلات أو أفرغه، أو احذفها ثم أعد نشر ` +
        `البيانات التجريبية المصحّحة، أو اضبط البيانات التجريبية لتحديث السجلات التي تجدها (upsert) وصحّح "${p.field}" فيها.`
      : p.cause === 'stored'
      ? `إعادة النشر لا تغيّر "${p.field}" في السجلات الموجودة بالفعل. صحّح "${p.field}" في تلك السجلات أو أفرغه، ` +
        `أو احذفها ثم أعد نشر البيانات التجريبية المصحّحة.`
      : `صحّح "${p.field}" في البيانات التجريبية أو أفرغه، ثم أعد النشر.`),
  fr: (p) =>
    `Certains enregistrements d’exemple « ${p.object} » (${p.count} valeur(s) dans « ${p.field} ») pointent vers ` +
    `des enregistrements « ${p.target} » inexistants : sur ces enregistrements, « ${p.field} » ne mène nulle part. ` +
    (p.cause === 'mode'
      ? `Publier à nouveau ne modifie pas les enregistrements qui existent déjà. Corrigez ou videz « ${p.field} » sur ` +
        `ces enregistrements, ou supprimez-les et publiez à nouveau les données d’exemple corrigées, ou réglez les ` +
        `données d’exemple pour qu’elles mettent à jour les enregistrements qu’elles retrouvent (upsert) et corrigez-y « ${p.field} ».`
      : p.cause === 'stored'
      ? `Publier à nouveau ne modifie pas « ${p.field} » sur les enregistrements qui existent déjà. Corrigez ou videz ` +
        `« ${p.field} » sur ces enregistrements, ou supprimez-les et publiez à nouveau les données d’exemple corrigées.`
      : `Corrigez ou videz « ${p.field} » dans les données d’exemple, puis publiez à nouveau.`),
  'pt-BR': (p) =>
    `Alguns registros de exemplo de "${p.object}" (${p.count} valor(es) em "${p.field}") apontam para registros de ` +
    `"${p.target}" que não existem, então nesses registros "${p.field}" não leva a lugar nenhum. ` +
    (p.cause === 'mode'
      ? `Publicar novamente não altera registros que já existem. Corrija ou limpe "${p.field}" nesses registros, ` +
        `ou exclua-os e publique novamente os dados de exemplo corrigidos, ou configure os dados de exemplo para ` +
        `atualizar os registros que encontram (upsert) e corrija "${p.field}" neles.`
      : p.cause === 'stored'
      ? `Publicar novamente não altera "${p.field}" em registros que já existem. Corrija ou limpe "${p.field}" ` +
        `nesses registros, ou exclua-os e publique novamente os dados de exemplo corrigidos.`
      : `Corrija ou limpe "${p.field}" nos dados de exemplo e publique novamente.`),
  ru: (p) =>
    `Некоторые примеры записей «${p.object}» (значений в поле «${p.field}»: ${p.count}) ссылаются на ` +
    `несуществующие записи «${p.target}», поэтому в этих записях «${p.field}» никуда не ведёт. ` +
    (p.cause === 'mode'
      ? `Повторная публикация не меняет уже существующие записи. Исправьте или очистите «${p.field}» в этих записях, ` +
        `либо удалите их и снова опубликуйте исправленные примеры данных, либо настройте примеры данных на ` +
        `обновление найденных записей (upsert) и исправьте «${p.field}» в них.`
      : p.cause === 'stored'
      ? `Повторная публикация не меняет «${p.field}» в уже существующих записях. Исправьте или очистите ` +
        `«${p.field}» в этих записях, либо удалите их и снова опубликуйте исправленные примеры данных.`
      : `Исправьте или очистите «${p.field}» в примерах данных и опубликуйте снова.`),
  de: (p) =>
    `Einige Beispieldatensätze von „${p.object}“ (${p.count} Wert(e) in „${p.field}“) verweisen auf „${p.target}“-` +
    `Datensätze, die nicht existieren, sodass „${p.field}“ bei diesen Datensätzen ins Leere führt. ` +
    (p.cause === 'mode'
      ? `Erneutes Veröffentlichen ändert bereits vorhandene Datensätze nicht. Korrigieren oder leeren Sie „${p.field}“ ` +
        `in diesen Datensätzen, oder löschen Sie sie und veröffentlichen Sie die korrigierten Beispieldaten erneut, ` +
        `oder stellen Sie die Beispieldaten so ein, dass sie gefundene Datensätze aktualisieren (upsert), und ` +
        `korrigieren Sie „${p.field}“ dort.`
      : p.cause === 'stored'
      ? `Erneutes Veröffentlichen ändert „${p.field}“ in bereits vorhandenen Datensätzen nicht. Korrigieren oder ` +
        `leeren Sie „${p.field}“ in diesen Datensätzen, oder löschen Sie sie und veröffentlichen Sie die korrigierten ` +
        `Beispieldaten erneut.`
      : `Korrigieren oder leeren Sie „${p.field}“ in den Beispieldaten und veröffentlichen Sie dann erneut.`),
  ja: (p) =>
    `「${p.object}」のサンプルレコードの一部（「${p.field}」の値 ${p.count} 件）が存在しない「${p.target}」レコードを参照しているため、` +
    `それらのレコードの「${p.field}」はどこにもつながりません。` +
    (p.cause === 'mode'
      ? `もう一度公開しても、既に存在するレコードは変わりません。それらのレコードの「${p.field}」を修正するか空にするか、` +
        `レコードを削除して修正したサンプルデータをもう一度公開するか、サンプルデータを見つかったレコードを更新する設定（upsert）にして` +
        `そこで「${p.field}」を修正してください。`
      : p.cause === 'stored'
      ? `もう一度公開しても、既に存在するレコードの「${p.field}」は変わりません。それらのレコードの「${p.field}」を修正するか空にするか、` +
        `レコードを削除して修正したサンプルデータをもう一度公開してください。`
      : `サンプルデータの「${p.field}」を修正するか空にしてから、もう一度公開してください。`),
  ko: (p) =>
    `일부 "${p.object}" 샘플 레코드("${p.field}"의 값 ${p.count}개)가 존재하지 않는 "${p.target}" 레코드를 가리키므로 ` +
    `해당 레코드의 "${p.field}"는 아무 곳으로도 연결되지 않습니다. ` +
    (p.cause === 'mode'
      ? `다시 게시해도 이미 있는 레코드는 바뀌지 않습니다. 해당 레코드에서 "${p.field}"를 수정하거나 비우거나, ` +
        `레코드를 삭제한 후 수정한 샘플 데이터를 다시 게시하거나, 샘플 데이터가 찾은 레코드를 업데이트하도록(upsert) ` +
        `설정하고 거기서 "${p.field}"를 수정하세요.`
      : p.cause === 'stored'
      ? `다시 게시해도 이미 있는 레코드의 "${p.field}"는 바뀌지 않습니다. 해당 레코드에서 "${p.field}"를 수정하거나 ` +
        `비우거나, 레코드를 삭제한 후 수정한 샘플 데이터를 다시 게시하세요.`
      : `샘플 데이터에서 "${p.field}"를 수정하거나 비운 후 다시 게시하세요.`),
};

/**
 * `flow_connector_action_unresolved`: a flow step calls a connector this
 * environment cannot use — two candidates or none in reach (`refused`), no such
 * connector or action (`no-action`), or the connector is down (`degraded`).
 */
const FLOW_CONNECTOR_ACTION_UNRESOLVED: UserTextEntry = {
  en: (p) =>
    `The step "${p.step}" in automation "${p.flow}" calls the connector "${p.connector}", ` +
    (p.cause === 'degraded'
      ? `which is not working right now, so the automation stops at that step until the connector is fixed.`
      : p.cause === 'refused'
      ? `but more than one connector, or none this app may use, has that name, so the automation stops at that step every time.`
      : `which this environment does not have, so the automation stops at that step every time. Install the connector, or change the step.`),
  'zh-Hans': (p) =>
    `自动化“${p.flow}”中的步骤“${p.step}”调用了连接器“${p.connector}”，` +
    (p.cause === 'degraded'
      ? `但该连接器目前无法工作，所以在修复之前自动化会停在这一步。`
      : p.cause === 'refused'
      ? `但有多个同名连接器，或者没有本应用可用的同名连接器，所以自动化每次都会停在这一步。`
      : `但当前环境没有这个连接器，所以自动化每次都会停在这一步。请安装该连接器，或修改这一步。`),
  'zh-Hant': (p) =>
    `自動化「${p.flow}」中的步驟「${p.step}」呼叫了連接器「${p.connector}」，` +
    (p.cause === 'degraded'
      ? `但該連接器目前無法運作，所以在修復之前自動化會停在這一步。`
      : p.cause === 'refused'
      ? `但有多個同名連接器，或沒有本應用可用的同名連接器，所以自動化每次都會停在這一步。`
      : `但目前環境沒有這個連接器，所以自動化每次都會停在這一步。請安裝該連接器，或修改這一步。`),
  es: (p) =>
    `El paso "${p.step}" de la automatización "${p.flow}" llama al conector "${p.connector}", ` +
    (p.cause === 'degraded'
      ? `que ahora no funciona, así que la automatización se detiene en ese paso hasta que se repare.`
      : p.cause === 'refused'
      ? `pero hay más de un conector con ese nombre, o ninguno que esta aplicación pueda usar, así que la automatización se detiene en ese paso cada vez.`
      : `que este entorno no tiene, así que la automatización se detiene en ese paso cada vez. Instale el conector o cambie el paso.`),
  ar: (p) =>
    `الخطوة "${p.step}" في الأتمتة "${p.flow}" تستدعي الموصل "${p.connector}"، ` +
    (p.cause === 'degraded'
      ? `وهو لا يعمل حاليًا، لذلك تتوقف الأتمتة عند هذه الخطوة حتى يتم إصلاحه.`
      : p.cause === 'refused'
      ? `لكن هناك أكثر من موصل بهذا الاسم، أو لا يوجد موصل يمكن لهذا التطبيق استخدامه، لذلك تتوقف الأتمتة عند هذه الخطوة في كل مرة.`
      : `وهو غير موجود في هذه البيئة، لذلك تتوقف الأتمتة عند هذه الخطوة في كل مرة. ثبّت الموصل أو غيّر الخطوة.`),
  fr: (p) =>
    `L’étape « ${p.step} » de l’automatisation « ${p.flow} » appelle le connecteur « ${p.connector} », ` +
    (p.cause === 'degraded'
      ? `qui ne fonctionne pas pour le moment : l’automatisation s’arrête à cette étape jusqu’à sa réparation.`
      : p.cause === 'refused'
      ? `mais plusieurs connecteurs portent ce nom, ou aucun que cette application peut utiliser : l’automatisation s’arrête à cette étape à chaque fois.`
      : `que cet environnement n’a pas : l’automatisation s’arrête à cette étape à chaque fois. Installez le connecteur ou modifiez l’étape.`),
  'pt-BR': (p) =>
    `A etapa "${p.step}" da automação "${p.flow}" chama o conector "${p.connector}", ` +
    (p.cause === 'degraded'
      ? `que não está funcionando agora, então a automação para nessa etapa até que ele seja corrigido.`
      : p.cause === 'refused'
      ? `mas há mais de um conector com esse nome, ou nenhum que este aplicativo possa usar, então a automação para nessa etapa toda vez.`
      : `que este ambiente não tem, então a automação para nessa etapa toda vez. Instale o conector ou altere a etapa.`),
  ru: (p) =>
    `Шаг «${p.step}» автоматизации «${p.flow}» вызывает коннектор «${p.connector}», ` +
    (p.cause === 'degraded'
      ? `который сейчас не работает, поэтому автоматизация останавливается на этом шаге, пока его не исправят.`
      : p.cause === 'refused'
      ? `но коннекторов с таким именем несколько или нет ни одного, доступного этому приложению, поэтому автоматизация каждый раз останавливается на этом шаге.`
      : `которого нет в этой среде, поэтому автоматизация каждый раз останавливается на этом шаге. Установите коннектор или измените шаг.`),
  de: (p) =>
    `Der Schritt „${p.step}“ in der Automatisierung „${p.flow}“ ruft den Connector „${p.connector}“ auf, ` +
    (p.cause === 'degraded'
      ? `der gerade nicht funktioniert, daher hält die Automatisierung an diesem Schritt an, bis er behoben ist.`
      : p.cause === 'refused'
      ? `aber es gibt mehrere Connectoren mit diesem Namen oder keinen, den diese App verwenden darf, daher hält die Automatisierung jedes Mal an diesem Schritt an.`
      : `den diese Umgebung nicht hat, daher hält die Automatisierung jedes Mal an diesem Schritt an. Installieren Sie den Connector oder ändern Sie den Schritt.`),
  ja: (p) =>
    `自動化「${p.flow}」のステップ「${p.step}」はコネクタ「${p.connector}」を呼び出しますが、` +
    (p.cause === 'degraded'
      ? `このコネクタは現在動作していないため、修正されるまで自動化はこのステップで止まります。`
      : p.cause === 'refused'
      ? `この名前のコネクタが複数あるか、このアプリで使えるものがないため、自動化は毎回このステップで止まります。`
      : `この環境にはこのコネクタがないため、自動化は毎回このステップで止まります。コネクタをインストールするか、ステップを変更してください。`),
  ko: (p) =>
    `자동화 "${p.flow}"의 단계 "${p.step}"가 커넥터 "${p.connector}"를 호출하지만, ` +
    (p.cause === 'degraded'
      ? `이 커넥터가 현재 작동하지 않아 수정될 때까지 자동화가 이 단계에서 멈춥니다.`
      : p.cause === 'refused'
      ? `같은 이름의 커넥터가 여러 개이거나 이 앱에서 사용할 수 있는 것이 없어 자동화가 매번 이 단계에서 멈춥니다.`
      : `이 환경에는 해당 커넥터가 없어 자동화가 매번 이 단계에서 멈춥니다. 커넥터를 설치하거나 단계를 변경하세요.`),
};

/**
 * Every probe code's sentences. Typed by the probe's own code union, so a
 * code added to `RuntimeBuildIssueCode` without sentences does not compile.
 */
export const BUILD_PROBE_USER_TEXT: Readonly<Record<RuntimeBuildIssueCode, UserTextEntry>> = Object.freeze({
  seed_not_applied: SEED_NOT_APPLIED,
  view_read_failed: VIEW_READ_FAILED,
  object_field_ref_unknown: OBJECT_FIELD_REF_UNKNOWN,
  object_field_ref_rule_failed: OBJECT_FIELD_REF_RULE_FAILED,
  widget_not_probed: WIDGET_NOT_PROBED,
  empty_query: EMPTY_QUERY,
  widget_query_failed: WIDGET_QUERY_FAILED,
  probes_unavailable: PROBES_UNAVAILABLE,
  widget_empty_result: WIDGET_EMPTY_RESULT,
  rollup_never_computed: ROLLUP_NEVER_COMPUTED,
  seed_reference_unresolved: SEED_REFERENCE_UNRESOLVED,
  flow_connector_action_unresolved: FLOW_CONNECTOR_ACTION_UNRESOLVED,
});

/**
 * One finding's user sentence, under the ladder: `locales` is the request's
 * locale then the workspace default, in that order, as the publish request
 * carries them (`userTextLocales`); `en` answers when neither names a
 * platform locale.
 */
export function buildProbeUserMessage(
  code: RuntimeBuildIssueCode,
  params: UserTextParams,
  locales: readonly (string | null | undefined)[],
): string {
  return renderUserText(BUILD_PROBE_USER_TEXT[code], params, locales);
}

/**
 * The platform locale the sentences of one probe run are written in, so the
 * probe resolves an artifact's label for the same language. Every entry
 * answers in every platform locale, so any entry gives the run's answer.
 */
export function buildProbeUserTextLocale(locales: readonly (string | null | undefined)[]): PlatformLocaleTag {
  return userTextLocaleOf(BUILD_PROBE_USER_TEXT.probes_unavailable, locales);
}
