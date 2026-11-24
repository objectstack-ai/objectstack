// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The user-facing sentences of `validate-record-page-header.ts`'s two advisory
 * findings, in every platform locale (`PLATFORM_LOCALE_TAGS`,
 * `@objectstack/spec/system`). The finding mechanism and the locale ladder are
 * `finding-user-text.ts`'s; this file is the rule's own half of it.
 *
 * Who reads these: the person who published a record page in Studio. Each
 * sentence says what the record's user sees differ between the desktop full
 * page and the phone or drawer, and where the one declaration goes instead.
 * Both ids reach the publish door, on a `page` write:
 *
 * | rule id | params |
 * |---|---|
 * | `record-page-header-title-differs` | `page`, `object`, `field` |
 * | `record-page-header-actions-differ` | `page`, `object` |
 *
 * Names are the API names the rule saw, not labels, for the reason
 * `validate-security-posture.user-text.ts` gives.
 *
 * `validate-record-page-header.test.ts` renders every entry from the rule's
 * real findings in every platform locale.
 */

import type { UserTextCatalog } from './finding-user-text.js';
import {
  RECORD_PAGE_HEADER_ACTIONS_DIFFER,
  RECORD_PAGE_HEADER_TITLE_DIFFERS,
} from './validate-record-page-header.js';

export const RECORD_PAGE_HEADER_USER_TEXT: UserTextCatalog = Object.freeze({
  [RECORD_PAGE_HEADER_TITLE_DIFFERS]: {
    en: (p) =>
      `The header of page "${p.page}" sets its own title, so on the desktop full page a record of "${p.object}" ` +
      `is titled differently than on a phone, in the side drawer and in lists, which use the field "${p.field}". ` +
      `Remove the header title, or change the record's name field on "${p.object}".`,
    'zh-Hans': (p) =>
      `页面“${p.page}”的页头自己写了标题，所以“${p.object}”的记录在电脑整页上的标题，和手机、右侧抽屉、列表里` +
      `用字段“${p.field}”显示的不一样。请删掉页头标题，或在“${p.object}”上修改记录的名称字段。`,
    'zh-Hant': (p) =>
      `頁面「${p.page}」的頁首自行設定了標題，因此「${p.object}」的記錄在電腦完整頁面上的標題，與手機、右側抽屜和` +
      `清單中以欄位「${p.field}」顯示的不同。請刪除頁首標題，或在「${p.object}」上變更記錄的名稱欄位。`,
    es: (p) =>
      `El encabezado de la página "${p.page}" define su propio título, así que en la página completa de escritorio ` +
      `un registro de "${p.object}" tiene un título distinto que en el teléfono, en el panel lateral y en las ` +
      `listas, que usan el campo "${p.field}". Quite el título del encabezado o cambie el campo de nombre del ` +
      `registro en "${p.object}".`,
    ar: (p) =>
      `يحدد رأس الصفحة "${p.page}" عنوانًا خاصًا به، لذلك يظهر سجل "${p.object}" في الصفحة الكاملة على سطح المكتب ` +
      `بعنوان مختلف عنه على الهاتف وفي اللوحة الجانبية وفي القوائم التي تستخدم الحقل "${p.field}". احذف عنوان ` +
      `الرأس، أو غيّر حقل اسم السجل في "${p.object}".`,
    fr: (p) =>
      `L'en-tête de la page « ${p.page} » définit son propre titre : sur la page complète du bureau, un ` +
      `enregistrement de « ${p.object} » porte donc un autre titre que sur un téléphone, dans le panneau latéral et ` +
      `dans les listes, qui utilisent le champ « ${p.field} ». Supprimez le titre de l'en-tête, ou modifiez le ` +
      `champ de nom de l'enregistrement sur « ${p.object} ».`,
    'pt-BR': (p) =>
      `O cabeçalho da página "${p.page}" define o próprio título, então na página completa do desktop um registro ` +
      `de "${p.object}" tem um título diferente do que aparece no celular, no painel lateral e nas listas, que ` +
      `usam o campo "${p.field}". Remova o título do cabeçalho ou altere o campo de nome do registro em ` +
      `"${p.object}".`,
    ru: (p) =>
      `Заголовок страницы «${p.page}» задаёт собственное название, поэтому на полной странице на компьютере запись ` +
      `«${p.object}» называется иначе, чем на телефоне, в боковой панели и в списках, где используется поле ` +
      `«${p.field}». Удалите название из заголовка или измените поле имени записи в «${p.object}».`,
    de: (p) =>
      `Der Kopfbereich der Seite „${p.page}“ setzt einen eigenen Titel. Auf der vollständigen Desktop-Seite heißt ` +
      `ein Datensatz von „${p.object}“ daher anders als auf dem Telefon, im Seitenbereich und in Listen, die das ` +
      `Feld „${p.field}“ verwenden. Entfernen Sie den Titel aus dem Kopfbereich, oder ändern Sie das Namensfeld ` +
      `des Datensatzes in „${p.object}“.`,
    ja: (p) =>
      `ページ「${p.page}」のヘッダーが独自のタイトルを設定しているため、デスクトップの全画面ページでは` +
      `「${p.object}」のレコードのタイトルが、項目「${p.field}」を使うスマートフォン、サイドドロワー、一覧と` +
      `異なります。ヘッダーのタイトルを削除するか、「${p.object}」でレコードの名前項目を変更してください。`,
    ko: (p) =>
      `페이지 "${p.page}"의 헤더가 자체 제목을 설정하므로, 데스크톱 전체 페이지에서 "${p.object}" 레코드의 ` +
      `제목이 필드 "${p.field}"를 사용하는 휴대폰, 측면 서랍, 목록과 다르게 표시됩니다. 헤더 제목을 삭제하거나 ` +
      `"${p.object}"에서 레코드의 이름 필드를 변경하세요.`,
  },
  [RECORD_PAGE_HEADER_ACTIONS_DIFFER]: {
    en: (p) =>
      `The header of page "${p.page}" lists the actions of "${p.object}" in an order the actions themselves do ` +
      `not declare, so the desktop full page shows a different main button or button order than a phone and ` +
      `the side drawer. Set the order on each action, and mark the main one as primary.`,
    'zh-Hans': (p) =>
      `页面“${p.page}”的页头列出“${p.object}”的动作时，用的顺序和动作自己声明的不同，所以电脑整页上的主按钮或` +
      `按钮顺序和手机、右侧抽屉里不一样。请在每个动作上设置排序，并把主要的那个标为主按钮。`,
    'zh-Hant': (p) =>
      `頁面「${p.page}」的頁首列出「${p.object}」的動作時，使用的順序與動作本身宣告的不同，因此電腦完整頁面上的` +
      `主按鈕或按鈕順序與手機、右側抽屜中不一樣。請在每個動作上設定排序，並將主要的那個標為主按鈕。`,
    es: (p) =>
      `El encabezado de la página "${p.page}" enumera las acciones de "${p.object}" en un orden que las propias ` +
      `acciones no declaran, así que la página completa de escritorio muestra otro botón principal u otro orden ` +
      `de botones que el teléfono y el panel lateral. Defina el orden en cada acción y marque la principal como ` +
      `primaria.`,
    ar: (p) =>
      `يسرد رأس الصفحة "${p.page}" إجراءات "${p.object}" بترتيب لا تعلنه الإجراءات نفسها، لذلك تعرض الصفحة الكاملة ` +
      `على سطح المكتب زرًا رئيسيًا أو ترتيب أزرار مختلفًا عما يظهر على الهاتف وفي اللوحة الجانبية. حدّد الترتيب ` +
      `في كل إجراء، وعيّن الإجراء الرئيسي كإجراء أساسي.`,
    fr: (p) =>
      `L'en-tête de la page « ${p.page} » liste les actions de « ${p.object} » dans un ordre que les actions ` +
      `elles-mêmes ne déclarent pas : la page complète du bureau affiche donc un autre bouton principal ou un autre ` +
      `ordre de boutons qu'un téléphone et le panneau latéral. Définissez l'ordre sur chaque action, et marquez ` +
      `l'action principale comme primaire.`,
    'pt-BR': (p) =>
      `O cabeçalho da página "${p.page}" lista as ações de "${p.object}" em uma ordem que as próprias ações não ` +
      `declaram, então a página completa do desktop mostra outro botão principal ou outra ordem de botões do que ` +
      `o celular e o painel lateral. Defina a ordem em cada ação e marque a principal como primária.`,
    ru: (p) =>
      `Заголовок страницы «${p.page}» перечисляет действия «${p.object}» в порядке, который сами действия не ` +
      `объявляют, поэтому на полной странице на компьютере главная кнопка или порядок кнопок отличаются от ` +
      `телефона и боковой панели. Задайте порядок в каждом действии и отметьте главное как основное.`,
    de: (p) =>
      `Der Kopfbereich der Seite „${p.page}“ führt die Aktionen von „${p.object}“ in einer Reihenfolge auf, die ` +
      `die Aktionen selbst nicht deklarieren. Die vollständige Desktop-Seite zeigt daher eine andere Hauptschaltfläche ` +
      `oder Reihenfolge als das Telefon und der Seitenbereich. Legen Sie die Reihenfolge an jeder Aktion fest, und ` +
      `markieren Sie die wichtigste als primär.`,
    ja: (p) =>
      `ページ「${p.page}」のヘッダーは「${p.object}」のアクションを、アクション自身が宣言していない順序で並べているため、` +
      `デスクトップの全画面ページではメインボタンまたはボタンの順序がスマートフォンやサイドドロワーと異なります。` +
      `各アクションに順序を設定し、メインのアクションをプライマリにしてください。`,
    ko: (p) =>
      `페이지 "${p.page}"의 헤더가 "${p.object}"의 작업을 작업 자체가 선언하지 않은 순서로 나열하므로, 데스크톱 ` +
      `전체 페이지의 기본 버튼이나 버튼 순서가 휴대폰 및 측면 서랍과 다릅니다. 각 작업에 순서를 설정하고 주요 ` +
      `작업을 기본으로 표시하세요.`,
  },
});
