// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The user-facing sentences of `lint-flow-patterns.ts`'s findings, in every
 * platform locale (`PLATFORM_LOCALE_TAGS`, `@objectstack/spec/system`). The
 * finding mechanism and the locale ladder are `finding-user-text.ts`'s; this
 * file is the rule file's own half of it, kept beside the rules so their
 * wording and their translations change together.
 *
 * Who reads these: the person building the flow in Studio, in their own
 * language, in the flow designer's Problems tab and the publish drawer
 * (#34818), once a door composes `RuntimeAuthoringIssueSchema.userMessage` from
 * them. So each sentence names the flow and its steps by the labels the builder
 * sees, says what the shape does to a run, and names the one change that fixes
 * it. The developer-facing detail stays in the finding's `message`, `hint` and
 * `os explain` entry.
 *
 * Each entry reads the `userTextParams` its finding carries, set at the push
 * site in `lint-flow-patterns.ts`:
 *
 * | rule id | params |
 * |---|---|
 * | `flow-decision-unconditional-branch` | `flow`, `node` (labels), `shape` (`none`: no out-edge is gated · `mixed`: some are, these are not), `targets` (the successors' labels, one per line) |
 *
 * `finding-user-text.test.ts` renders every entry from the rule's real
 * findings in every platform locale.
 */

import type { UserTextCatalog, UserTextParams } from './finding-user-text.js';
import { FLOW_DECISION_UNCONDITIONAL_BRANCH } from './lint-flow-patterns.js';

/** The successors' labels, quoted and joined the way one locale writes a list. */
function targetList(p: UserTextParams, open: string, close: string, separator: string): string {
  return (p.targets ?? '')
    .split('\n')
    .filter((label) => label !== '')
    .map((label) => `${open}${label}${close}`)
    .join(separator);
}

export const FLOW_PATTERNS_USER_TEXT: UserTextCatalog = Object.freeze({
  [FLOW_DECISION_UNCONDITIONAL_BRANCH]: {
    en: (p) =>
      p.shape === 'none'
        ? `The branch step "${p.node}" in flow "${p.flow}" sets no condition on any of its paths ` +
          `(${targetList(p, '"', '"', ', ')}), so every path runs every time and the step chooses nothing. ` +
          `Give each path a condition, and mark one of them as the default path.`
        : `The branch step "${p.node}" in flow "${p.flow}" has a path to ${targetList(p, '"', '"', ', ')} with ` +
          `no condition, so that path runs every time, alongside whichever path matched. Give it a ` +
          `condition, or mark it as the default path.`,
    'zh-Hans': (p) =>
      p.shape === 'none'
        ? `流程“${p.flow}”中的条件分支“${p.node}”没有为任何一条连线（${targetList(p, '“', '”', '、')}）设置条件，` +
          `因此每次运行都会走所有连线，这个分支起不到选择作用。请为每条连线设置条件，并把其中一条设为默认分支。`
        : `流程“${p.flow}”中的条件分支“${p.node}”通往${targetList(p, '“', '”', '、')}的连线没有设置条件，` +
          `因此每次运行都会走这条连线，同时还会走条件成立的那一条。请为它设置条件，或把它设为默认分支。`,
    'zh-Hant': (p) =>
      p.shape === 'none'
        ? `流程「${p.flow}」中的條件分支「${p.node}」沒有為任何一條連線（${targetList(p, '「', '」', '、')}）設定條件，` +
          `因此每次執行都會走所有連線，這個分支起不到選擇作用。請為每條連線設定條件，並把其中一條設為預設分支。`
        : `流程「${p.flow}」中的條件分支「${p.node}」通往${targetList(p, '「', '」', '、')}的連線沒有設定條件，` +
          `因此每次執行都會走這條連線，同時還會走條件成立的那一條。請為它設定條件，或把它設為預設分支。`,
    es: (p) =>
      p.shape === 'none'
        ? `El paso de bifurcación "${p.node}" del flujo "${p.flow}" no pone condición en ninguno de sus caminos ` +
          `(${targetList(p, '"', '"', ', ')}), así que todos los caminos se recorren siempre y el paso no elige ` +
          `nada. Ponga una condición a cada camino y marque uno de ellos como camino predeterminado.`
        : `El paso de bifurcación "${p.node}" del flujo "${p.flow}" tiene un camino hacia ` +
          `${targetList(p, '"', '"', ', ')} sin condición, así que ese camino se recorre siempre, junto con el ` +
          `que haya coincidido. Póngale una condición o márquelo como camino predeterminado.`,
    ar: (p) =>
      p.shape === 'none'
        ? `خطوة التفرّع "${p.node}" في التدفق "${p.flow}" لا تضع شرطًا على أي من مساراتها ` +
          `(${targetList(p, '"', '"', '، ')})، لذلك تُسلك كل المسارات في كل مرة ولا تختار الخطوة شيئًا. ` +
          `ضع شرطًا لكل مسار، واجعل أحدها المسار الافتراضي.`
        : `خطوة التفرّع "${p.node}" في التدفق "${p.flow}" لها مسار إلى ${targetList(p, '"', '"', '، ')} بلا ` +
          `شرط، لذلك يُسلك هذا المسار في كل مرة إلى جانب المسار الذي تحقق شرطه. ضع له شرطًا، أو اجعله ` +
          `المسار الافتراضي.`,
    fr: (p) =>
      p.shape === 'none'
        ? `L’étape d’embranchement « ${p.node} » du flux « ${p.flow} » ne pose de condition sur aucun de ses ` +
          `chemins (${targetList(p, '« ', ' »', ', ')}) : tous les chemins sont suivis à chaque fois et l’étape ` +
          `ne choisit rien. Donnez une condition à chaque chemin et marquez l’un d’eux comme chemin par défaut.`
        : `L’étape d’embranchement « ${p.node} » du flux « ${p.flow} » a un chemin vers ` +
          `${targetList(p, '« ', ' »', ', ')} sans condition : ce chemin est suivi à chaque fois, en plus de ` +
          `celui dont la condition est vraie. Donnez-lui une condition, ou marquez-le comme chemin par défaut.`,
    'pt-BR': (p) =>
      p.shape === 'none'
        ? `A etapa de ramificação "${p.node}" do fluxo "${p.flow}" não define condição em nenhum dos seus ` +
          `caminhos (${targetList(p, '"', '"', ', ')}), então todos os caminhos são percorridos sempre e a ` +
          `etapa não escolhe nada. Dê uma condição a cada caminho e marque um deles como caminho padrão.`
        : `A etapa de ramificação "${p.node}" do fluxo "${p.flow}" tem um caminho para ` +
          `${targetList(p, '"', '"', ', ')} sem condição, então esse caminho é percorrido sempre, junto com ` +
          `aquele cuja condição foi atendida. Dê a ele uma condição ou marque-o como caminho padrão.`,
    ru: (p) =>
      p.shape === 'none'
        ? `Шаг ветвления «${p.node}» в потоке «${p.flow}» не задаёт условия ни для одного из своих путей ` +
          `(${targetList(p, '«', '»', ', ')}), поэтому каждый раз выполняются все пути и шаг ничего не ` +
          `выбирает. Задайте условие для каждого пути и отметьте один из них как путь по умолчанию.`
        : `У шага ветвления «${p.node}» в потоке «${p.flow}» есть путь к ${targetList(p, '«', '»', ', ')} без ` +
          `условия, поэтому этот путь выполняется каждый раз, вместе с тем, чьё условие выполнилось. Задайте ` +
          `для него условие или отметьте его как путь по умолчанию.`,
    de: (p) =>
      p.shape === 'none'
        ? `Der Verzweigungsschritt „${p.node}“ im Flow „${p.flow}“ setzt auf keinem seiner Pfade ` +
          `(${targetList(p, '„', '“', ', ')}) eine Bedingung, daher laufen bei jedem Durchlauf alle Pfade und ` +
          `der Schritt wählt nichts aus. Geben Sie jedem Pfad eine Bedingung und markieren Sie einen davon als ` +
          `Standardpfad.`
        : `Der Verzweigungsschritt „${p.node}“ im Flow „${p.flow}“ hat einen Pfad zu ` +
          `${targetList(p, '„', '“', ', ')} ohne Bedingung, daher läuft dieser Pfad jedes Mal, zusätzlich zu ` +
          `dem Pfad, dessen Bedingung zutrifft. Geben Sie ihm eine Bedingung oder markieren Sie ihn als ` +
          `Standardpfad.`,
    ja: (p) =>
      p.shape === 'none'
        ? `フロー「${p.flow}」の分岐ステップ「${p.node}」は、どの経路（${targetList(p, '「', '」', '、')}）にも` +
          `条件を設定していないため、毎回すべての経路が実行され、このステップは何も選択しません。` +
          `各経路に条件を設定し、そのうち 1 つを既定の経路にしてください。`
        : `フロー「${p.flow}」の分岐ステップ「${p.node}」には、条件のない${targetList(p, '「', '」', '、')}への` +
          `経路があるため、その経路は条件が一致した経路と並んで毎回実行されます。条件を設定するか、既定の経路に` +
          `してください。`,
    ko: (p) =>
      p.shape === 'none'
        ? `플로우 "${p.flow}"의 분기 단계 "${p.node}"는 어떤 경로(${targetList(p, '"', '"', ', ')})에도 조건을 ` +
          `설정하지 않아 매번 모든 경로가 실행되고, 이 단계는 아무것도 선택하지 않습니다. 각 경로에 조건을 ` +
          `설정하고 그중 하나를 기본 경로로 지정하세요.`
        : `플로우 "${p.flow}"의 분기 단계 "${p.node}"에는 조건 없이 ${targetList(p, '"', '"', ', ')}(으)로 ` +
          `가는 경로가 있어, 조건이 맞은 경로와 함께 매번 실행됩니다. 조건을 설정하거나 기본 경로로 ` +
          `지정하세요.`,
  },
});
