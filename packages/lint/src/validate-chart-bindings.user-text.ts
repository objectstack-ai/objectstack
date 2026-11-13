// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The user-facing sentences of `validate-chart-bindings.ts`'s advisory
 * findings, in every platform locale (`PLATFORM_LOCALE_TAGS`,
 * `@objectstack/spec/system`). The finding mechanism and the locale ladder are
 * `finding-user-text.ts`'s; this file is the rule's own half of it, kept beside
 * the rule so its wording and its translations change together.
 *
 * Who reads these: the person who saved a report in Studio, in their own
 * language, once the save door composes `RuntimeAuthoringIssueSchema.userMessage`
 * from them. So each sentence names the report's chart series entry, what it
 * does (nothing) and the one change that fixes it, in the console's words
 * (report, chart, series, dataset, measure).
 *
 * Both ids are advisory only at a PRESENTATION position, and the publish door
 * reaches exactly one of those: a report chart's `series[]` entry, on a
 * `report` write. The page-chart positions (`page-series`, `page-axis`) are
 * judged on pages, which no per-write snapshot carries, so those findings carry
 * no `userTextParams` and keep the English `message`. At a query position
 * `chart-measure-unknown` is an error, not advice, and carries none either.
 *
 * Each entry reads the `userTextParams` its finding carries, set at the push
 * site in `validate-chart-bindings.ts`:
 *
 * | rule id | params |
 * |---|---|
 * | `chart-measure-unknown` | `report`, `measure`, `dataset` |
 * | `chart-axis-not-selected` | `report`, `measure`, `dataset`, `plotted` (the measure the chart plots) |
 *
 * Names are the API names the rule saw, for the reason
 * `validate-security-posture.user-text.ts` gives.
 *
 * `finding-user-text.dashboards.test.ts` renders every entry from the rule's
 * real findings in every platform locale.
 */

import type { UserTextCatalog } from './finding-user-text.js';
import { CHART_AXIS_NOT_SELECTED, CHART_MEASURE_UNKNOWN } from './validate-chart-bindings.js';

export const CHART_BINDINGS_USER_TEXT: UserTextCatalog = Object.freeze({
  [CHART_MEASURE_UNKNOWN]: {
    en: (p) =>
      `In report "${p.report}", the chart series entry "${p.measure}" names no measure of dataset "${p.dataset}", ` +
      `so it changes nothing and the series is still drawn. Correct the name to a measure the dataset declares, or ` +
      `remove the entry.`,
    'zh-Hans': (p) =>
      `在报表“${p.report}”中，图表系列条目“${p.measure}”并非数据集“${p.dataset}”的度量，因此不起任何作用，该系列仍会` +
      `照常绘制。请把名称改为该数据集声明的度量，或删除该条目。`,
    'zh-Hant': (p) =>
      `在報表「${p.report}」中，圖表系列項目「${p.measure}」並非資料集「${p.dataset}」的度量，因此不起任何作用，該系列仍會` +
      `照常繪製。請把名稱改為該資料集宣告的度量，或刪除該項目。`,
    es: (p) =>
      `En el informe "${p.report}", la entrada de serie del gráfico "${p.measure}" no corresponde a ninguna medida ` +
      `del conjunto de datos "${p.dataset}", por lo que no cambia nada y la serie se sigue dibujando. Corrija el ` +
      `nombre por una medida que declare el conjunto de datos o elimine la entrada.`,
    ar: (p) =>
      `في التقرير "${p.report}"، لا يطابق إدخال سلسلة المخطط "${p.measure}" أي مقياس في مجموعة البيانات ` +
      `"${p.dataset}"، لذا لا يغيّر شيئًا وتظل السلسلة مرسومة. صحّح الاسم إلى مقياس تعلنه مجموعة البيانات، أو ` +
      `احذف الإدخال.`,
    fr: (p) =>
      `Dans le rapport « ${p.report} », l’entrée de série du graphique « ${p.measure} » ne désigne aucune mesure du ` +
      `jeu de données « ${p.dataset} » : elle ne change donc rien et la série est quand même tracée. Corrigez le nom ` +
      `pour indiquer une mesure déclarée par le jeu de données, ou supprimez l’entrée.`,
    'pt-BR': (p) =>
      `No relatório "${p.report}", a entrada de série do gráfico "${p.measure}" não corresponde a nenhuma medida do ` +
      `conjunto de dados "${p.dataset}"; por isso, não muda nada e a série continua sendo desenhada. Corrija o nome ` +
      `para uma medida declarada pelo conjunto de dados ou remova a entrada.`,
    ru: (p) =>
      `В отчёте «${p.report}» элемент ряда диаграммы «${p.measure}» не соответствует ни одной мере набора данных ` +
      `«${p.dataset}», поэтому ничего не меняет, а ряд всё равно строится. Исправьте имя на меру, объявленную в ` +
      `наборе данных, или удалите элемент.`,
    de: (p) =>
      `Im Bericht „${p.report}“ nennt der Reiheneintrag „${p.measure}“ des Diagramms keine Kennzahl des Datensatzes ` +
      `„${p.dataset}“. Er bewirkt daher nichts, und die Reihe wird trotzdem gezeichnet. Ändern Sie den Namen in eine ` +
      `Kennzahl, die der Datensatz deklariert, oder entfernen Sie den Eintrag.`,
    ja: (p) =>
      `レポート「${p.report}」で、グラフの系列エントリ「${p.measure}」はデータセット「${p.dataset}」のどの指標にも` +
      `当たらないため何も変わらず、系列はそのまま描画されます。名前をデータセットが宣言している指標に修正するか、` +
      `このエントリを削除してください。`,
    ko: (p) =>
      `보고서 "${p.report}"에서 차트 계열 항목 "${p.measure}"은(는) 데이터 세트 "${p.dataset}"의 어떤 측정값과도 ` +
      `일치하지 않으므로 아무것도 바뀌지 않으며 계열은 그대로 그려집니다. 이름을 데이터 세트에 선언된 측정값으로 ` +
      `고치거나 항목을 삭제하세요.`,
  },
  [CHART_AXIS_NOT_SELECTED]: {
    en: (p) =>
      `In report "${p.report}", the chart series entry "${p.measure}" names a measure of dataset "${p.dataset}" that ` +
      `the chart does not plot (it plots "${p.plotted}"), so it changes nothing. Point the entry at ` +
      `"${p.plotted}", or remove it.`,
    'zh-Hans': (p) =>
      `在报表“${p.report}”中，图表系列条目“${p.measure}”是数据集“${p.dataset}”的度量，但图表并不绘制它（图表绘制的是` +
      `“${p.plotted}”），因此不起任何作用。请将该条目指向“${p.plotted}”，或将其删除。`,
    'zh-Hant': (p) =>
      `在報表「${p.report}」中，圖表系列項目「${p.measure}」是資料集「${p.dataset}」的度量，但圖表並不繪製它（圖表繪製的是` +
      `「${p.plotted}」），因此不起任何作用。請將該項目指向「${p.plotted}」，或將其刪除。`,
    es: (p) =>
      `En el informe "${p.report}", la entrada de serie del gráfico "${p.measure}" es una medida del conjunto de ` +
      `datos "${p.dataset}" que el gráfico no traza (traza "${p.plotted}"), por lo que no cambia nada. Haga que la ` +
      `entrada apunte a "${p.plotted}" o elimínela.`,
    ar: (p) =>
      `في التقرير "${p.report}"، يشير إدخال سلسلة المخطط "${p.measure}" إلى مقياس في مجموعة البيانات ` +
      `"${p.dataset}" لا يرسمه المخطط (فهو يرسم "${p.plotted}")، لذا لا يغيّر شيئًا. اجعل الإدخال يشير إلى ` +
      `"${p.plotted}"، أو احذفه.`,
    fr: (p) =>
      `Dans le rapport « ${p.report} », l’entrée de série du graphique « ${p.measure} » désigne une mesure du jeu de ` +
      `données « ${p.dataset} » que le graphique ne trace pas (il trace « ${p.plotted} ») : elle ne change donc ` +
      `rien. Faites pointer l’entrée vers « ${p.plotted} », ou supprimez-la.`,
    'pt-BR': (p) =>
      `No relatório "${p.report}", a entrada de série do gráfico "${p.measure}" é uma medida do conjunto de dados ` +
      `"${p.dataset}" que o gráfico não traça (ele traça "${p.plotted}"); por isso, não muda nada. Aponte a entrada ` +
      `para "${p.plotted}" ou remova-a.`,
    ru: (p) =>
      `В отчёте «${p.report}» элемент ряда диаграммы «${p.measure}» указывает на меру набора данных ` +
      `«${p.dataset}», которую диаграмма не строит (она строит «${p.plotted}»), поэтому ничего не меняет. Укажите в ` +
      `элементе «${p.plotted}» или удалите его.`,
    de: (p) =>
      `Im Bericht „${p.report}“ nennt der Reiheneintrag „${p.measure}“ des Diagramms eine Kennzahl des Datensatzes ` +
      `„${p.dataset}“, die das Diagramm nicht darstellt (es stellt „${p.plotted}“ dar). Er bewirkt daher nichts. ` +
      `Richten Sie den Eintrag auf „${p.plotted}“ aus, oder entfernen Sie ihn.`,
    ja: (p) =>
      `レポート「${p.report}」で、グラフの系列エントリ「${p.measure}」はデータセット「${p.dataset}」の指標ですが、` +
      `グラフはこれを描画しない（描画するのは「${p.plotted}」）ため、何も変わりません。エントリを「${p.plotted}」に` +
      `向けるか、削除してください。`,
    ko: (p) =>
      `보고서 "${p.report}"에서 차트 계열 항목 "${p.measure}"은(는) 데이터 세트 "${p.dataset}"의 측정값이지만 ` +
      `차트가 이를 그리지 않으므로(차트는 "${p.plotted}"을(를) 그립니다) 아무것도 바뀌지 않습니다. 항목이 ` +
      `"${p.plotted}"을(를) 가리키게 하거나 삭제하세요.`,
  },
});
