// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The user-facing sentences of `validate-widget-bindings.ts`'s advisory
 * findings, in every platform locale (`PLATFORM_LOCALE_TAGS`,
 * `@objectstack/spec/system`). The finding mechanism and the locale ladder are
 * `finding-user-text.ts`'s; this file is the rule's own half of it, kept beside
 * the rule so its wording and its translations change together.
 *
 * Who reads these: the person who saved a dashboard in Studio, in their own
 * language, once the save door composes `RuntimeAuthoringIssueSchema.userMessage`
 * from them. So each sentence says what the widget shows (or fails to show) and
 * the one change that fixes it, in the dashboard editor's own words (dashboard,
 * widget, dataset, dimensions, values, measure); the developer-facing detail
 * stays in the finding's `message`, `hint` and `os explain` entry.
 *
 * Only the advisory ids the publish door can actually return have a sentence:
 * the rule runs there on a `dashboard` write. `measure-aggregate-incoherent`
 * has none: it judges `datasets[]`, which a dashboard write carries as
 * context on both sides of the door's differential (so it cancels), and a
 * `dataset` write does not run this rule. It stays on the English `message`.
 *
 * Each entry reads the `userTextParams` its finding carries, set at the push
 * site in `validate-widget-bindings.ts`:
 *
 * | rule id | params |
 * |---|---|
 * | `widget-legacy-analytics-shape` | `dashboard`, `widget`, `keys` (the legacy key names, comma-separated) |
 * | `dashboard-filter-field-unprovisioned` | `dashboard`, `widget`, `filter`, `field`, `object` |
 * | `chart-field-unknown` | `dashboard`, `widget`, `dataset`, `field`, `axis` (`x` · `y` · `series`) |
 * | `chart-measures-missing` | `dashboard`, `widget`, `dataset` |
 * | `widget-measures-missing` | `dashboard`, `widget`, `dataset`, `shows` (`number` · `table`) |
 * | `chart-dimensions-missing` | `dashboard`, `widget`, `dataset` |
 * | `table-count-only` | `dashboard`, `widget`, `dataset` |
 *
 * Names in a sentence are the API names the rule saw (`spend_dashboard`, a
 * widget's `id`), not labels, for the reason `validate-security-posture.user-text.ts`
 * gives: the rule is a pure function of the stack with no label lookup in the
 * request's language. A widget or dashboard with no name shows the rule's own
 * stand-in, as its `message` does.
 *
 * `finding-user-text.dashboards.test.ts` renders every entry from the rule's
 * real findings in every platform locale.
 */

import type { UserTextCatalog } from './finding-user-text.js';
import {
  CHART_DIMENSIONS_MISSING,
  CHART_FIELD_UNKNOWN,
  CHART_MEASURES_MISSING,
  DASHBOARD_FILTER_FIELD_UNPROVISIONED,
  TABLE_COUNT_ONLY,
  WIDGET_LEGACY_ANALYTICS_SHAPE,
  WIDGET_MEASURES_MISSING,
} from './validate-widget-bindings.js';

export const WIDGET_BINDINGS_USER_TEXT: UserTextCatalog = Object.freeze({
  [WIDGET_LEGACY_ANALYTICS_SHAPE]: {
    en: (p) =>
      `Widget "${p.widget}" on dashboard "${p.dashboard}" still uses the old chart settings ${p.keys}, which the ` +
      `dashboard ignores. Remove them and choose the widget's dimensions and values from its dataset.`,
    'zh-Hans': (p) =>
      `仪表盘“${p.dashboard}”中的组件“${p.widget}”仍在使用旧的图表设置 ${p.keys}，仪表盘会忽略这些设置。` +
      `请删除它们，并从该组件的数据集中选择维度和度量值。`,
    'zh-Hant': (p) =>
      `儀表盤「${p.dashboard}」中的元件「${p.widget}」仍在使用舊的圖表設定 ${p.keys}，儀表盤會忽略這些設定。` +
      `請刪除它們，並從該元件的資料集中選擇維度和度量值。`,
    es: (p) =>
      `El widget "${p.widget}" del panel de control "${p.dashboard}" todavía usa la configuración de gráfico ` +
      `antigua ${p.keys}, que el panel ignora. Elimínela y elija las dimensiones y los valores del widget a partir ` +
      `de su conjunto de datos.`,
    ar: (p) =>
      `لا يزال العنصر "${p.widget}" في لوحة القيادة "${p.dashboard}" يستخدم إعدادات المخطط القديمة ${p.keys}، ` +
      `وتتجاهلها لوحة القيادة. احذفها واختر أبعاد العنصر وقيمه من مجموعة البيانات الخاصة به.`,
    fr: (p) =>
      `Le widget « ${p.widget} » du tableau de bord « ${p.dashboard} » utilise encore les anciens paramètres de ` +
      `graphique ${p.keys}, que le tableau de bord ignore. Supprimez-les et choisissez les dimensions et les valeurs ` +
      `du widget dans son jeu de données.`,
    'pt-BR': (p) =>
      `O widget "${p.widget}" do painel "${p.dashboard}" ainda usa as configurações de gráfico antigas ${p.keys}, ` +
      `que o painel ignora. Remova-as e escolha as dimensões e os valores do widget a partir do conjunto de dados dele.`,
    ru: (p) =>
      `Виджет «${p.widget}» на дашборде «${p.dashboard}» всё ещё использует старые настройки диаграммы ${p.keys}, ` +
      `которые дашборд игнорирует. Удалите их и выберите измерения и значения виджета из его набора данных.`,
    de: (p) =>
      `Das Widget „${p.widget}“ im Dashboard „${p.dashboard}“ verwendet noch die alten Diagrammeinstellungen ` +
      `${p.keys}, die das Dashboard ignoriert. Entfernen Sie sie und wählen Sie die Dimensionen und Werte des ` +
      `Widgets aus seinem Datensatz.`,
    ja: (p) =>
      `ダッシュボード「${p.dashboard}」のウィジェット「${p.widget}」は、ダッシュボードが無視する古いグラフ設定 ` +
      `${p.keys} をまだ使用しています。これらを削除し、ウィジェットのデータセットからディメンションと値を選択してください。`,
    ko: (p) =>
      `대시보드 "${p.dashboard}"의 위젯 "${p.widget}"이(가) 대시보드에서 무시되는 이전 차트 설정 ${p.keys}을(를) ` +
      `아직 사용하고 있습니다. 이 설정을 삭제하고 위젯의 데이터 세트에서 차원과 값을 선택하세요.`,
  },
  [DASHBOARD_FILTER_FIELD_UNPROVISIONED]: {
    en: (p) =>
      `Widget "${p.widget}" on dashboard "${p.dashboard}" shows no data while dashboard filter "${p.filter}" ` +
      `applies: it filters on "${p.field}", a column the platform adds to external object "${p.object}" without ` +
      `storing it. If the remote table has "${p.field}", add it to the fields of "${p.object}"; otherwise stop ` +
      `applying the filter to this widget.`,
    'zh-Hans': (p) =>
      `仪表盘“${p.dashboard}”中的组件“${p.widget}”在应用仪表盘筛选“${p.filter}”时不显示任何数据：该筛选作用于` +
      `“${p.field}”，这是平台为外部对象“${p.object}”添加但并不存储的列。如果远程表中有“${p.field}”，请将其添加到` +
      `“${p.object}”的字段中；否则请让该筛选不再作用于此组件。`,
    'zh-Hant': (p) =>
      `儀表盤「${p.dashboard}」中的元件「${p.widget}」在套用儀表盤篩選「${p.filter}」時不顯示任何資料：該篩選作用於` +
      `「${p.field}」，這是平台為外部物件「${p.object}」新增但並不儲存的欄位。如果遠端資料表中有「${p.field}」，` +
      `請將其加入「${p.object}」的欄位；否則請讓該篩選不再作用於此元件。`,
    es: (p) =>
      `El widget "${p.widget}" del panel de control "${p.dashboard}" no muestra datos mientras se aplica el filtro ` +
      `del panel "${p.filter}": filtra por "${p.field}", una columna que la plataforma añade al objeto externo ` +
      `"${p.object}" sin almacenarla. Si la tabla remota tiene "${p.field}", agréguela a los campos de ` +
      `"${p.object}"; de lo contrario, deje de aplicar el filtro a este widget.`,
    ar: (p) =>
      `لا يعرض العنصر "${p.widget}" في لوحة القيادة "${p.dashboard}" أي بيانات أثناء تطبيق عامل تصفية اللوحة ` +
      `"${p.filter}": فهو يصفّي حسب "${p.field}"، وهو عمود تضيفه المنصة إلى الكائن الخارجي "${p.object}" دون ` +
      `تخزينه. إذا كان الجدول البعيد يحتوي على "${p.field}"، فأضفه إلى حقول "${p.object}"؛ وإلا فأوقف تطبيق عامل ` +
      `التصفية على هذا العنصر.`,
    fr: (p) =>
      `Le widget « ${p.widget} » du tableau de bord « ${p.dashboard} » n’affiche aucune donnée lorsque le filtre ` +
      `du tableau de bord « ${p.filter} » s’applique : il filtre sur « ${p.field} », une colonne que la plateforme ` +
      `ajoute à l’objet externe « ${p.object} » sans la stocker. Si la table distante contient « ${p.field} », ` +
      `ajoutez-la aux champs de « ${p.object} » ; sinon, n’appliquez plus ce filtre à ce widget.`,
    'pt-BR': (p) =>
      `O widget "${p.widget}" do painel "${p.dashboard}" não mostra dados enquanto o filtro do painel ` +
      `"${p.filter}" se aplica: ele filtra por "${p.field}", uma coluna que a plataforma adiciona ao objeto externo ` +
      `"${p.object}" sem armazená-la. Se a tabela remota tiver "${p.field}", adicione-a aos campos de ` +
      `"${p.object}"; caso contrário, deixe de aplicar o filtro a este widget.`,
    ru: (p) =>
      `Виджет «${p.widget}» на дашборде «${p.dashboard}» не показывает данных, пока действует фильтр дашборда ` +
      `«${p.filter}»: он фильтрует по «${p.field}» — столбцу, который платформа добавляет к внешнему объекту ` +
      `«${p.object}», но не хранит. Если в удалённой таблице есть «${p.field}», добавьте его в поля ` +
      `«${p.object}»; иначе перестаньте применять этот фильтр к виджету.`,
    de: (p) =>
      `Das Widget „${p.widget}“ im Dashboard „${p.dashboard}“ zeigt keine Daten, solange der Dashboard-Filter ` +
      `„${p.filter}“ gilt: Er filtert nach „${p.field}“, einer Spalte, die die Plattform dem externen Objekt ` +
      `„${p.object}“ hinzufügt, ohne sie zu speichern. Wenn die entfernte Tabelle „${p.field}“ enthält, fügen Sie ` +
      `die Spalte den Feldern von „${p.object}“ hinzu; andernfalls wenden Sie den Filter nicht mehr auf dieses ` +
      `Widget an.`,
    ja: (p) =>
      `ダッシュボード「${p.dashboard}」のウィジェット「${p.widget}」は、ダッシュボードフィルター「${p.filter}」が` +
      `適用されている間データを表示しません。このフィルターは「${p.field}」で絞り込みますが、これはプラットフォームが` +
      `外部オブジェクト「${p.object}」に追加するだけで保存しない列です。リモートテーブルに「${p.field}」がある場合は` +
      `「${p.object}」のフィールドに追加し、ない場合はこのウィジェットにフィルターを適用しないようにしてください。`,
    ko: (p) =>
      `대시보드 "${p.dashboard}"의 위젯 "${p.widget}"은(는) 대시보드 필터 "${p.filter}"이(가) 적용되는 동안 ` +
      `데이터를 표시하지 않습니다. 이 필터는 "${p.field}"(으)로 필터링하는데, 이는 플랫폼이 외부 개체 ` +
      `"${p.object}"에 추가하지만 저장하지 않는 열입니다. 원격 테이블에 "${p.field}"이(가) 있으면 ` +
      `"${p.object}"의 필드에 추가하고, 없으면 이 위젯에 필터를 적용하지 마세요.`,
  },
  [CHART_FIELD_UNKNOWN]: {
    en: (p) =>
      p.axis === 'x'
        ? `The x-axis setting of widget "${p.widget}" on dashboard "${p.dashboard}" names "${p.field}", which is ` +
          `not a dimension of dataset "${p.dataset}", so it is ignored and the x-axis shows the widget's first ` +
          `dimension. Remove the setting and choose the x-axis through the widget's dimensions.`
        : p.axis === 'y'
          ? `The y-axis setting of widget "${p.widget}" on dashboard "${p.dashboard}" names "${p.field}", which is ` +
            `not a measure this widget shows from dataset "${p.dataset}", so it changes nothing. Remove the setting ` +
            `and choose what the chart plots through the widget's values.`
          : `A series setting of widget "${p.widget}" on dashboard "${p.dashboard}" names "${p.field}", which is ` +
            `not a measure this widget shows from dataset "${p.dataset}", so it applies to no series. Remove the ` +
            `setting and choose what the chart plots through the widget's values.`,
    'zh-Hans': (p) =>
      p.axis === 'x'
        ? `仪表盘“${p.dashboard}”中组件“${p.widget}”的 X 轴设置指定了“${p.field}”，但它不是数据集“${p.dataset}”的` +
          `维度，因此会被忽略，X 轴显示的是该组件的第一个维度。请删除该设置，并通过组件的维度来选择 X 轴。`
        : p.axis === 'y'
          ? `仪表盘“${p.dashboard}”中组件“${p.widget}”的 Y 轴设置指定了“${p.field}”，但它不是该组件从数据集` +
            `“${p.dataset}”中展示的度量，因此不起任何作用。请删除该设置，并通过组件的度量值来选择图表绘制的内容。`
          : `仪表盘“${p.dashboard}”中组件“${p.widget}”的一项系列设置指定了“${p.field}”，但它不是该组件从数据集` +
            `“${p.dataset}”中展示的度量，因此不会作用于任何系列。请删除该设置，并通过组件的度量值来选择图表绘制的内容。`,
    'zh-Hant': (p) =>
      p.axis === 'x'
        ? `儀表盤「${p.dashboard}」中元件「${p.widget}」的 X 軸設定指定了「${p.field}」，但它不是資料集「${p.dataset}」的` +
          `維度，因此會被忽略，X 軸顯示的是該元件的第一個維度。請刪除該設定，並透過元件的維度來選擇 X 軸。`
        : p.axis === 'y'
          ? `儀表盤「${p.dashboard}」中元件「${p.widget}」的 Y 軸設定指定了「${p.field}」，但它不是該元件從資料集` +
            `「${p.dataset}」中展示的度量，因此不起任何作用。請刪除該設定，並透過元件的度量值來選擇圖表繪製的內容。`
          : `儀表盤「${p.dashboard}」中元件「${p.widget}」的一項系列設定指定了「${p.field}」，但它不是該元件從資料集` +
            `「${p.dataset}」中展示的度量，因此不會作用於任何系列。請刪除該設定，並透過元件的度量值來選擇圖表繪製的內容。`,
    es: (p) =>
      p.axis === 'x'
        ? `La configuración del eje X del widget "${p.widget}" del panel de control "${p.dashboard}" indica ` +
          `"${p.field}", que no es una dimensión del conjunto de datos "${p.dataset}", por lo que se ignora y el eje ` +
          `X muestra la primera dimensión del widget. Elimine la configuración y elija el eje X mediante las ` +
          `dimensiones del widget.`
        : p.axis === 'y'
          ? `La configuración del eje Y del widget "${p.widget}" del panel de control "${p.dashboard}" indica ` +
            `"${p.field}", que no es una medida que este widget muestre del conjunto de datos "${p.dataset}", por lo ` +
            `que no cambia nada. Elimine la configuración y elija lo que traza el gráfico mediante los valores del widget.`
          : `Una configuración de serie del widget "${p.widget}" del panel de control "${p.dashboard}" indica ` +
            `"${p.field}", que no es una medida que este widget muestre del conjunto de datos "${p.dataset}", por lo ` +
            `que no se aplica a ninguna serie. Elimine la configuración y elija lo que traza el gráfico mediante los ` +
            `valores del widget.`,
    ar: (p) =>
      p.axis === 'x'
        ? `يشير إعداد المحور السيني للعنصر "${p.widget}" في لوحة القيادة "${p.dashboard}" إلى "${p.field}"، وهو ` +
          `ليس بُعدًا في مجموعة البيانات "${p.dataset}"، لذا يتم تجاهله ويعرض المحور السيني البُعد الأول للعنصر. ` +
          `احذف الإعداد واختر المحور السيني من خلال أبعاد العنصر.`
        : p.axis === 'y'
          ? `يشير إعداد المحور الصادي للعنصر "${p.widget}" في لوحة القيادة "${p.dashboard}" إلى "${p.field}"، وهو ` +
            `ليس مقياسًا يعرضه هذا العنصر من مجموعة البيانات "${p.dataset}"، لذا لا يغيّر شيئًا. احذف الإعداد واختر ` +
            `ما يرسمه المخطط من خلال قيم العنصر.`
          : `يشير أحد إعدادات السلاسل للعنصر "${p.widget}" في لوحة القيادة "${p.dashboard}" إلى "${p.field}"، وهو ` +
            `ليس مقياسًا يعرضه هذا العنصر من مجموعة البيانات "${p.dataset}"، لذا لا ينطبق على أي سلسلة. احذف ` +
            `الإعداد واختر ما يرسمه المخطط من خلال قيم العنصر.`,
    fr: (p) =>
      p.axis === 'x'
        ? `Le paramètre d’axe X du widget « ${p.widget} » du tableau de bord « ${p.dashboard} » indique ` +
          `« ${p.field} », qui n’est pas une dimension du jeu de données « ${p.dataset} » : il est donc ignoré et ` +
          `l’axe X affiche la première dimension du widget. Supprimez ce paramètre et choisissez l’axe X via les ` +
          `dimensions du widget.`
        : p.axis === 'y'
          ? `Le paramètre d’axe Y du widget « ${p.widget} » du tableau de bord « ${p.dashboard} » indique ` +
            `« ${p.field} », qui n’est pas une mesure que ce widget affiche du jeu de données « ${p.dataset} » : il ` +
            `ne change donc rien. Supprimez ce paramètre et choisissez ce que trace le graphique via les valeurs du ` +
            `widget.`
          : `Un paramètre de série du widget « ${p.widget} » du tableau de bord « ${p.dashboard} » indique ` +
            `« ${p.field} », qui n’est pas une mesure que ce widget affiche du jeu de données « ${p.dataset} » : il ` +
            `ne s’applique donc à aucune série. Supprimez ce paramètre et choisissez ce que trace le graphique via ` +
            `les valeurs du widget.`,
    'pt-BR': (p) =>
      p.axis === 'x'
        ? `A configuração do eixo X do widget "${p.widget}" do painel "${p.dashboard}" indica "${p.field}", que não ` +
          `é uma dimensão do conjunto de dados "${p.dataset}"; por isso, ela é ignorada e o eixo X mostra a primeira ` +
          `dimensão do widget. Remova a configuração e escolha o eixo X pelas dimensões do widget.`
        : p.axis === 'y'
          ? `A configuração do eixo Y do widget "${p.widget}" do painel "${p.dashboard}" indica "${p.field}", que ` +
            `não é uma medida que este widget mostra do conjunto de dados "${p.dataset}"; por isso, ela não muda nada. ` +
            `Remova a configuração e escolha o que o gráfico traça pelos valores do widget.`
          : `Uma configuração de série do widget "${p.widget}" do painel "${p.dashboard}" indica "${p.field}", que ` +
            `não é uma medida que este widget mostra do conjunto de dados "${p.dataset}"; por isso, ela não se aplica ` +
            `a nenhuma série. Remova a configuração e escolha o que o gráfico traça pelos valores do widget.`,
    ru: (p) =>
      p.axis === 'x'
        ? `Настройка оси X виджета «${p.widget}» на дашборде «${p.dashboard}» указывает «${p.field}», но это не ` +
          `измерение набора данных «${p.dataset}», поэтому она игнорируется, а ось X показывает первое измерение ` +
          `виджета. Удалите настройку и выбирайте ось X через измерения виджета.`
        : p.axis === 'y'
          ? `Настройка оси Y виджета «${p.widget}» на дашборде «${p.dashboard}» указывает «${p.field}», но это не ` +
            `мера, которую виджет показывает из набора данных «${p.dataset}», поэтому она ничего не меняет. Удалите ` +
            `настройку и выбирайте, что строит диаграмма, через значения виджета.`
          : `Настройка ряда виджета «${p.widget}» на дашборде «${p.dashboard}» указывает «${p.field}», но это не ` +
            `мера, которую виджет показывает из набора данных «${p.dataset}», поэтому она не применяется ни к одному ` +
            `ряду. Удалите настройку и выбирайте, что строит диаграмма, через значения виджета.`,
    de: (p) =>
      p.axis === 'x'
        ? `Die X-Achsen-Einstellung des Widgets „${p.widget}“ im Dashboard „${p.dashboard}“ nennt „${p.field}“, das ` +
          `keine Dimension des Datensatzes „${p.dataset}“ ist. Sie wird daher ignoriert, und die X-Achse zeigt die ` +
          `erste Dimension des Widgets. Entfernen Sie die Einstellung und wählen Sie die X-Achse über die ` +
          `Dimensionen des Widgets.`
        : p.axis === 'y'
          ? `Die Y-Achsen-Einstellung des Widgets „${p.widget}“ im Dashboard „${p.dashboard}“ nennt „${p.field}“, das ` +
            `keine Kennzahl ist, die dieses Widget aus dem Datensatz „${p.dataset}“ anzeigt. Sie bewirkt daher ` +
            `nichts. Entfernen Sie die Einstellung und wählen Sie über die Werte des Widgets, was das Diagramm darstellt.`
          : `Eine Reiheneinstellung des Widgets „${p.widget}“ im Dashboard „${p.dashboard}“ nennt „${p.field}“, das ` +
            `keine Kennzahl ist, die dieses Widget aus dem Datensatz „${p.dataset}“ anzeigt. Sie gilt daher für keine ` +
            `Reihe. Entfernen Sie die Einstellung und wählen Sie über die Werte des Widgets, was das Diagramm darstellt.`,
    ja: (p) =>
      p.axis === 'x'
        ? `ダッシュボード「${p.dashboard}」のウィジェット「${p.widget}」の X 軸設定は「${p.field}」を指定していますが、` +
          `これはデータセット「${p.dataset}」のディメンションではないため無視され、X 軸にはウィジェットの最初の` +
          `ディメンションが表示されます。この設定を削除し、ウィジェットのディメンションで X 軸を選択してください。`
        : p.axis === 'y'
          ? `ダッシュボード「${p.dashboard}」のウィジェット「${p.widget}」の Y 軸設定は「${p.field}」を指定していますが、` +
            `これはこのウィジェットがデータセット「${p.dataset}」から表示する指標ではないため、何も変わりません。` +
            `この設定を削除し、ウィジェットの値でグラフに描画する内容を選択してください。`
          : `ダッシュボード「${p.dashboard}」のウィジェット「${p.widget}」の系列設定は「${p.field}」を指定していますが、` +
            `これはこのウィジェットがデータセット「${p.dataset}」から表示する指標ではないため、どの系列にも適用されません。` +
            `この設定を削除し、ウィジェットの値でグラフに描画する内容を選択してください。`,
    ko: (p) =>
      p.axis === 'x'
        ? `대시보드 "${p.dashboard}"의 위젯 "${p.widget}"의 X축 설정이 "${p.field}"을(를) 지정하지만, 이는 데이터 ` +
          `세트 "${p.dataset}"의 차원이 아니므로 무시되고 X축에는 위젯의 첫 번째 차원이 표시됩니다. 이 설정을 ` +
          `삭제하고 위젯의 차원에서 X축을 선택하세요.`
        : p.axis === 'y'
          ? `대시보드 "${p.dashboard}"의 위젯 "${p.widget}"의 Y축 설정이 "${p.field}"을(를) 지정하지만, 이는 이 ` +
            `위젯이 데이터 세트 "${p.dataset}"에서 표시하는 측정값이 아니므로 아무것도 바뀌지 않습니다. 이 설정을 ` +
            `삭제하고 위젯의 값에서 차트에 그릴 항목을 선택하세요.`
          : `대시보드 "${p.dashboard}"의 위젯 "${p.widget}"의 계열 설정이 "${p.field}"을(를) 지정하지만, 이는 이 ` +
            `위젯이 데이터 세트 "${p.dataset}"에서 표시하는 측정값이 아니므로 어떤 계열에도 적용되지 않습니다. ` +
            `이 설정을 삭제하고 위젯의 값에서 차트에 그릴 항목을 선택하세요.`,
  },
  [CHART_MEASURES_MISSING]: {
    en: (p) =>
      `Chart widget "${p.widget}" on dashboard "${p.dashboard}" draws no chart because it has no values selected. ` +
      `Choose at least one measure of dataset "${p.dataset}" in the widget's values.`,
    'zh-Hans': (p) =>
      `仪表盘“${p.dashboard}”中的图表组件“${p.widget}”没有选择任何度量值，因此不会绘制图表。请在该组件的度量值中` +
      `至少选择数据集“${p.dataset}”的一个度量。`,
    'zh-Hant': (p) =>
      `儀表盤「${p.dashboard}」中的圖表元件「${p.widget}」沒有選擇任何度量值，因此不會繪製圖表。請在該元件的度量值中` +
      `至少選擇資料集「${p.dataset}」的一個度量。`,
    es: (p) =>
      `El widget de gráfico "${p.widget}" del panel de control "${p.dashboard}" no dibuja ningún gráfico porque no ` +
      `tiene valores seleccionados. Elija al menos una medida del conjunto de datos "${p.dataset}" en los valores ` +
      `del widget.`,
    ar: (p) =>
      `لا يرسم عنصر المخطط "${p.widget}" في لوحة القيادة "${p.dashboard}" أي مخطط لأنه لا توجد قيم محددة له. ` +
      `اختر مقياسًا واحدًا على الأقل من مجموعة البيانات "${p.dataset}" في قيم العنصر.`,
    fr: (p) =>
      `Le widget graphique « ${p.widget} » du tableau de bord « ${p.dashboard} » ne trace aucun graphique, car ` +
      `aucune valeur n’est sélectionnée. Choisissez au moins une mesure du jeu de données « ${p.dataset} » dans ` +
      `les valeurs du widget.`,
    'pt-BR': (p) =>
      `O widget de gráfico "${p.widget}" do painel "${p.dashboard}" não desenha nenhum gráfico porque não tem ` +
      `valores selecionados. Escolha pelo menos uma medida do conjunto de dados "${p.dataset}" nos valores do widget.`,
    ru: (p) =>
      `Виджет-диаграмма «${p.widget}» на дашборде «${p.dashboard}» не строит диаграмму, потому что у него не ` +
      `выбрано ни одного значения. Выберите в значениях виджета хотя бы одну меру набора данных «${p.dataset}».`,
    de: (p) =>
      `Das Diagramm-Widget „${p.widget}“ im Dashboard „${p.dashboard}“ zeichnet kein Diagramm, weil keine Werte ` +
      `ausgewählt sind. Wählen Sie in den Werten des Widgets mindestens eine Kennzahl des Datensatzes „${p.dataset}“.`,
    ja: (p) =>
      `ダッシュボード「${p.dashboard}」のグラフウィジェット「${p.widget}」は値が選択されていないため、グラフを` +
      `描画しません。ウィジェットの値で、データセット「${p.dataset}」の指標を少なくとも 1 つ選択してください。`,
    ko: (p) =>
      `대시보드 "${p.dashboard}"의 차트 위젯 "${p.widget}"은(는) 선택된 값이 없어 차트를 그리지 않습니다. ` +
      `위젯의 값에서 데이터 세트 "${p.dataset}"의 측정값을 하나 이상 선택하세요.`,
  },
  [WIDGET_MEASURES_MISSING]: {
    en: (p) =>
      p.shows === 'number'
        ? `Widget "${p.widget}" on dashboard "${p.dashboard}" shows no number because it has no values selected. ` +
          `Choose a measure of dataset "${p.dataset}" in the widget's values; this widget needs no dimensions.`
        : `Widget "${p.widget}" on dashboard "${p.dashboard}" shows no table because it has no values selected. ` +
          `Choose at least one measure of dataset "${p.dataset}" in the widget's values; this widget needs no ` +
          `dimensions.`,
    'zh-Hans': (p) =>
      p.shows === 'number'
        ? `仪表盘“${p.dashboard}”中的组件“${p.widget}”没有选择任何度量值，因此不显示数字。请在该组件的度量值中选择` +
          `数据集“${p.dataset}”的一个度量；此组件不需要维度。`
        : `仪表盘“${p.dashboard}”中的组件“${p.widget}”没有选择任何度量值，因此不显示表格。请在该组件的度量值中至少` +
          `选择数据集“${p.dataset}”的一个度量；此组件不需要维度。`,
    'zh-Hant': (p) =>
      p.shows === 'number'
        ? `儀表盤「${p.dashboard}」中的元件「${p.widget}」沒有選擇任何度量值，因此不顯示數字。請在該元件的度量值中選擇` +
          `資料集「${p.dataset}」的一個度量；此元件不需要維度。`
        : `儀表盤「${p.dashboard}」中的元件「${p.widget}」沒有選擇任何度量值，因此不顯示表格。請在該元件的度量值中至少` +
          `選擇資料集「${p.dataset}」的一個度量；此元件不需要維度。`,
    es: (p) =>
      p.shows === 'number'
        ? `El widget "${p.widget}" del panel de control "${p.dashboard}" no muestra ningún número porque no tiene ` +
          `valores seleccionados. Elija una medida del conjunto de datos "${p.dataset}" en los valores del widget; ` +
          `este widget no necesita dimensiones.`
        : `El widget "${p.widget}" del panel de control "${p.dashboard}" no muestra ninguna tabla porque no tiene ` +
          `valores seleccionados. Elija al menos una medida del conjunto de datos "${p.dataset}" en los valores del ` +
          `widget; este widget no necesita dimensiones.`,
    ar: (p) =>
      p.shows === 'number'
        ? `لا يعرض العنصر "${p.widget}" في لوحة القيادة "${p.dashboard}" أي رقم لأنه لا توجد قيم محددة له. اختر ` +
          `مقياسًا من مجموعة البيانات "${p.dataset}" في قيم العنصر؛ لا يحتاج هذا العنصر إلى أبعاد.`
        : `لا يعرض العنصر "${p.widget}" في لوحة القيادة "${p.dashboard}" أي جدول لأنه لا توجد قيم محددة له. اختر ` +
          `مقياسًا واحدًا على الأقل من مجموعة البيانات "${p.dataset}" في قيم العنصر؛ لا يحتاج هذا العنصر إلى أبعاد.`,
    fr: (p) =>
      p.shows === 'number'
        ? `Le widget « ${p.widget} » du tableau de bord « ${p.dashboard} » n’affiche aucun nombre, car aucune valeur ` +
          `n’est sélectionnée. Choisissez une mesure du jeu de données « ${p.dataset} » dans les valeurs du widget ; ` +
          `ce widget n’a besoin d’aucune dimension.`
        : `Le widget « ${p.widget} » du tableau de bord « ${p.dashboard} » n’affiche aucun tableau, car aucune valeur ` +
          `n’est sélectionnée. Choisissez au moins une mesure du jeu de données « ${p.dataset} » dans les valeurs du ` +
          `widget ; ce widget n’a besoin d’aucune dimension.`,
    'pt-BR': (p) =>
      p.shows === 'number'
        ? `O widget "${p.widget}" do painel "${p.dashboard}" não mostra nenhum número porque não tem valores ` +
          `selecionados. Escolha uma medida do conjunto de dados "${p.dataset}" nos valores do widget; este widget ` +
          `não precisa de dimensões.`
        : `O widget "${p.widget}" do painel "${p.dashboard}" não mostra nenhuma tabela porque não tem valores ` +
          `selecionados. Escolha pelo menos uma medida do conjunto de dados "${p.dataset}" nos valores do widget; ` +
          `este widget não precisa de dimensões.`,
    ru: (p) =>
      p.shows === 'number'
        ? `Виджет «${p.widget}» на дашборде «${p.dashboard}» не показывает число, потому что у него не выбрано ни ` +
          `одного значения. Выберите в значениях виджета меру набора данных «${p.dataset}»; измерения этому виджету ` +
          `не нужны.`
        : `Виджет «${p.widget}» на дашборде «${p.dashboard}» не показывает таблицу, потому что у него не выбрано ни ` +
          `одного значения. Выберите в значениях виджета хотя бы одну меру набора данных «${p.dataset}»; измерения ` +
          `этому виджету не нужны.`,
    de: (p) =>
      p.shows === 'number'
        ? `Das Widget „${p.widget}“ im Dashboard „${p.dashboard}“ zeigt keine Zahl, weil keine Werte ausgewählt sind. ` +
          `Wählen Sie in den Werten des Widgets eine Kennzahl des Datensatzes „${p.dataset}“; dieses Widget braucht ` +
          `keine Dimensionen.`
        : `Das Widget „${p.widget}“ im Dashboard „${p.dashboard}“ zeigt keine Tabelle, weil keine Werte ausgewählt ` +
          `sind. Wählen Sie in den Werten des Widgets mindestens eine Kennzahl des Datensatzes „${p.dataset}“; ` +
          `dieses Widget braucht keine Dimensionen.`,
    ja: (p) =>
      p.shows === 'number'
        ? `ダッシュボード「${p.dashboard}」のウィジェット「${p.widget}」は値が選択されていないため、数値を表示しません。` +
          `ウィジェットの値で、データセット「${p.dataset}」の指標を選択してください。このウィジェットにディメンションは不要です。`
        : `ダッシュボード「${p.dashboard}」のウィジェット「${p.widget}」は値が選択されていないため、テーブルを表示しません。` +
          `ウィジェットの値で、データセット「${p.dataset}」の指標を少なくとも 1 つ選択してください。このウィジェットに` +
          `ディメンションは不要です。`,
    ko: (p) =>
      p.shows === 'number'
        ? `대시보드 "${p.dashboard}"의 위젯 "${p.widget}"은(는) 선택된 값이 없어 숫자를 표시하지 않습니다. 위젯의 ` +
          `값에서 데이터 세트 "${p.dataset}"의 측정값을 선택하세요. 이 위젯에는 차원이 필요하지 않습니다.`
        : `대시보드 "${p.dashboard}"의 위젯 "${p.widget}"은(는) 선택된 값이 없어 테이블을 표시하지 않습니다. 위젯의 ` +
          `값에서 데이터 세트 "${p.dataset}"의 측정값을 하나 이상 선택하세요. 이 위젯에는 차원이 필요하지 않습니다.`,
  },
  [CHART_DIMENSIONS_MISSING]: {
    en: (p) =>
      `Chart widget "${p.widget}" on dashboard "${p.dashboard}" has no dimensions selected, so it shows a single ` +
      `number instead of a chart. Choose a dimension of dataset "${p.dataset}" in the widget's dimensions, or make ` +
      `it a metric widget if one number is what it should show.`,
    'zh-Hans': (p) =>
      `仪表盘“${p.dashboard}”中的图表组件“${p.widget}”没有选择任何维度，因此显示的是单个数字而不是图表。请在该组件的` +
      `维度中选择数据集“${p.dataset}”的一个维度；如果它本就应该只显示一个数字，请将其改为指标组件。`,
    'zh-Hant': (p) =>
      `儀表盤「${p.dashboard}」中的圖表元件「${p.widget}」沒有選擇任何維度，因此顯示的是單一數字而不是圖表。請在該元件的` +
      `維度中選擇資料集「${p.dataset}」的一個維度；如果它本就應該只顯示一個數字，請將其改為指標元件。`,
    es: (p) =>
      `El widget de gráfico "${p.widget}" del panel de control "${p.dashboard}" no tiene dimensiones seleccionadas, ` +
      `por lo que muestra un solo número en lugar de un gráfico. Elija una dimensión del conjunto de datos ` +
      `"${p.dataset}" en las dimensiones del widget, o conviértalo en un widget de métrica si debe mostrar un solo ` +
      `número.`,
    ar: (p) =>
      `لا توجد أبعاد محددة لعنصر المخطط "${p.widget}" في لوحة القيادة "${p.dashboard}"، لذا يعرض رقمًا واحدًا ` +
      `بدلًا من مخطط. اختر بُعدًا من مجموعة البيانات "${p.dataset}" في أبعاد العنصر، أو حوّله إلى عنصر من نوع ` +
      `مقياس إذا كان ينبغي أن يعرض رقمًا واحدًا.`,
    fr: (p) =>
      `Le widget graphique « ${p.widget} » du tableau de bord « ${p.dashboard} » n’a aucune dimension sélectionnée : ` +
      `il affiche donc un seul nombre au lieu d’un graphique. Choisissez une dimension du jeu de données ` +
      `« ${p.dataset} » dans les dimensions du widget, ou faites-en un widget d’indicateur s’il doit afficher un ` +
      `seul nombre.`,
    'pt-BR': (p) =>
      `O widget de gráfico "${p.widget}" do painel "${p.dashboard}" não tem dimensões selecionadas; por isso, ` +
      `mostra um único número em vez de um gráfico. Escolha uma dimensão do conjunto de dados "${p.dataset}" nas ` +
      `dimensões do widget ou transforme-o em um widget de métrica se ele deve mostrar um único número.`,
    ru: (p) =>
      `У виджета-диаграммы «${p.widget}» на дашборде «${p.dashboard}» не выбрано ни одного измерения, поэтому он ` +
      `показывает одно число вместо диаграммы. Выберите в измерениях виджета измерение набора данных ` +
      `«${p.dataset}» или сделайте его виджетом-метрикой, если он должен показывать одно число.`,
    de: (p) =>
      `Für das Diagramm-Widget „${p.widget}“ im Dashboard „${p.dashboard}“ ist keine Dimension ausgewählt, daher ` +
      `zeigt es eine einzelne Zahl statt eines Diagramms. Wählen Sie in den Dimensionen des Widgets eine Dimension ` +
      `des Datensatzes „${p.dataset}“, oder machen Sie es zu einem Kennzahl-Widget, wenn es eine einzelne Zahl ` +
      `zeigen soll.`,
    ja: (p) =>
      `ダッシュボード「${p.dashboard}」のグラフウィジェット「${p.widget}」はディメンションが選択されていないため、` +
      `グラフではなく 1 つの数値を表示します。ウィジェットのディメンションでデータセット「${p.dataset}」の` +
      `ディメンションを選択するか、1 つの数値を表示するのが目的であればメトリックウィジェットに変更してください。`,
    ko: (p) =>
      `대시보드 "${p.dashboard}"의 차트 위젯 "${p.widget}"에 선택된 차원이 없어 차트 대신 숫자 하나가 표시됩니다. ` +
      `위젯의 차원에서 데이터 세트 "${p.dataset}"의 차원을 선택하거나, 숫자 하나를 표시하는 것이 목적이라면 ` +
      `지표 위젯으로 바꾸세요.`,
  },
  [TABLE_COUNT_ONLY]: {
    en: (p) =>
      `Widget "${p.widget}" on dashboard "${p.dashboard}" shows only counts from dataset "${p.dataset}" and no ` +
      `dimension, so it shows one summary row, not a list of records. Add a dimension to group the rows, use a ` +
      `metric widget for the count, or list the records in a list view.`,
    'zh-Hans': (p) =>
      `仪表盘“${p.dashboard}”中的组件“${p.widget}”只展示数据集“${p.dataset}”的计数且没有维度，因此只显示一行汇总，` +
      `而不是记录列表。请添加维度对行进行分组、用指标组件显示该计数，或改用列表视图列出记录。`,
    'zh-Hant': (p) =>
      `儀表盤「${p.dashboard}」中的元件「${p.widget}」只展示資料集「${p.dataset}」的計數且沒有維度，因此只顯示一行彙總，` +
      `而不是記錄清單。請新增維度對列進行分組、用指標元件顯示該計數，或改用清單檢視列出記錄。`,
    es: (p) =>
      `El widget "${p.widget}" del panel de control "${p.dashboard}" muestra solo recuentos del conjunto de datos ` +
      `"${p.dataset}" y ninguna dimensión, por lo que muestra una sola fila de resumen y no una lista de registros. ` +
      `Agregue una dimensión para agrupar las filas, use un widget de métrica para el recuento o liste los ` +
      `registros en una vista de lista.`,
    ar: (p) =>
      `يعرض العنصر "${p.widget}" في لوحة القيادة "${p.dashboard}" أعدادًا فقط من مجموعة البيانات "${p.dataset}" ` +
      `دون أي بُعد، لذا يعرض صف ملخص واحدًا لا قائمة سجلات. أضف بُعدًا لتجميع الصفوف، أو استخدم عنصرًا من نوع ` +
      `مقياس لعرض العدد، أو اعرض السجلات في عرض قائمة.`,
    fr: (p) =>
      `Le widget « ${p.widget} » du tableau de bord « ${p.dashboard} » n’affiche que des décomptes du jeu de données ` +
      `« ${p.dataset} » sans aucune dimension : il affiche donc une seule ligne de synthèse et non une liste ` +
      `d’enregistrements. Ajoutez une dimension pour regrouper les lignes, utilisez un widget d’indicateur pour le ` +
      `décompte, ou listez les enregistrements dans une vue de liste.`,
    'pt-BR': (p) =>
      `O widget "${p.widget}" do painel "${p.dashboard}" mostra apenas contagens do conjunto de dados ` +
      `"${p.dataset}" e nenhuma dimensão; por isso, mostra uma única linha de resumo, e não uma lista de registros. ` +
      `Adicione uma dimensão para agrupar as linhas, use um widget de métrica para a contagem ou liste os ` +
      `registros em uma exibição de lista.`,
    ru: (p) =>
      `Виджет «${p.widget}» на дашборде «${p.dashboard}» показывает только количества из набора данных ` +
      `«${p.dataset}» без измерений, поэтому выводит одну итоговую строку, а не список записей. Добавьте измерение ` +
      `для группировки строк, используйте виджет-метрику для количества или выведите записи в представлении списка.`,
    de: (p) =>
      `Das Widget „${p.widget}“ im Dashboard „${p.dashboard}“ zeigt nur Anzahlen aus dem Datensatz „${p.dataset}“ ` +
      `und keine Dimension, daher zeigt es eine einzige Zusammenfassungszeile statt einer Liste einzelner Einträge. ` +
      `Fügen Sie eine Dimension hinzu, um die Zeilen zu gruppieren, verwenden Sie für die Anzahl ein ` +
      `Kennzahl-Widget, oder listen Sie die Einträge in einer Listenansicht auf.`,
    ja: (p) =>
      `ダッシュボード「${p.dashboard}」のウィジェット「${p.widget}」は、データセット「${p.dataset}」の件数だけを` +
      `ディメンションなしで表示しているため、レコードの一覧ではなく集計行が 1 行だけ表示されます。行をグループ化する` +
      `ディメンションを追加するか、件数にはメトリックウィジェットを使うか、レコードをリストビューで一覧表示してください。`,
    ko: (p) =>
      `대시보드 "${p.dashboard}"의 위젯 "${p.widget}"은(는) 데이터 세트 "${p.dataset}"의 개수만 차원 없이 ` +
      `표시하므로, 레코드 목록이 아닌 요약 행 하나만 표시됩니다. 행을 그룹화할 차원을 추가하거나, 개수에는 지표 ` +
      `위젯을 사용하거나, 목록 보기에서 레코드를 나열하세요.`,
  },
});
