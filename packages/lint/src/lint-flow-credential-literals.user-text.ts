// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The user-facing sentence of `lint-flow-credential-literals.ts`'s advisory
 * finding (`flow-credential-literal`), in every platform locale
 * (`PLATFORM_LOCALE_TAGS`, `@objectstack/spec/system`). The finding mechanism
 * and the locale ladder are `finding-user-text.ts`'s; this file is the rule's
 * own half of it, kept beside the rule so its wording and its translations
 * change together.
 *
 * Who reads it: the person who saved a flow in Studio, in their own language,
 * once the save door composes `RuntimeAuthoringIssueSchema.userMessage` from
 * it. It says who can read the credential and where it belongs instead.
 *
 * Params, set at the push site in `lint-flow-credential-literals.ts`: `flow`,
 * `node`, `name` (the header, query parameter or connector input the value
 * sits under) and `position` (`header` · `query` · `input`). ⛔ Never the value
 * itself, for the rule's module-note reason: the sentence travels into the
 * save response too.
 *
 * `validate-flow-writes.user-text.test.ts` renders it from the rule's real
 * findings in every platform locale, one per position.
 */

import type { UserTextCatalog, UserTextParams } from './finding-user-text.js';
import { FLOW_CREDENTIAL_LITERAL } from './lint-flow-credential-literals.js';

/** Where the credential sits, per locale: `header`, `query` or `input`, the entry named. */
const POSITION = {
  en: { header: 'header', query: 'URL query parameter', input: 'connector input' },
  'zh-Hans': { header: '请求头', query: 'URL 查询参数', input: '连接器输入' },
  'zh-Hant': { header: '請求標頭', query: 'URL 查詢參數', input: '連接器輸入' },
  es: { header: 'el encabezado', query: 'el parámetro de consulta de la URL', input: 'la entrada del conector' },
  ar: { header: 'الترويسة', query: 'معامل الاستعلام في عنوان URL', input: 'مُدخل الموصل' },
  fr: { header: 'l’en-tête', query: 'le paramètre de requête de l’URL', input: 'l’entrée du connecteur' },
  'pt-BR': { header: 'o cabeçalho', query: 'o parâmetro de consulta da URL', input: 'a entrada do conector' },
  ru: { header: 'заголовок', query: 'параметр запроса URL', input: 'входной параметр коннектора' },
  de: { header: 'den Header', query: 'den URL-Abfrageparameter', input: 'die Connector-Eingabe' },
  ja: { header: 'ヘッダー', query: 'URL のクエリパラメーター', input: 'コネクタの入力' },
  ko: { header: '헤더', query: 'URL 쿼리 매개변수', input: '커넥터 입력' },
} as const;

const position = (locale: keyof typeof POSITION, p: UserTextParams): string =>
  POSITION[locale][p.position === 'query' ? 'query' : p.position === 'input' ? 'input' : 'header'];

export const FLOW_CREDENTIAL_LITERALS_USER_TEXT: UserTextCatalog = Object.freeze({
  [FLOW_CREDENTIAL_LITERAL]: {
    en: (p) =>
      `Node "${p.node}" in flow "${p.flow}" has a credential written directly into ${position('en', p)} ` +
      `"${p.name}", so everyone who can view flows can read it. Store it in a connector's credentials and have ` +
      `the flow call that connector instead.`,
    'zh-Hans': (p) =>
      `流程“${p.flow}”的节点“${p.node}”在${position('zh-Hans', p)}“${p.name}”中直接写入了凭据，因此所有能查看流程的人都能读到它。` +
      `请把它存放到连接器的凭据中，并改为让流程调用该连接器。`,
    'zh-Hant': (p) =>
      `流程「${p.flow}」的節點「${p.node}」在${position('zh-Hant', p)}「${p.name}」中直接寫入了憑證，因此所有能檢視流程的人都能讀到它。` +
      `請把它存放到連接器的憑證中，並改為讓流程呼叫該連接器。`,
    es: (p) =>
      `El nodo "${p.node}" del flujo "${p.flow}" tiene una credencial escrita directamente en ` +
      `${position('es', p)} "${p.name}", así que cualquiera que pueda ver los flujos puede leerla. Guárdela en ` +
      `las credenciales de un conector y haga que el flujo llame a ese conector.`,
    ar: (p) =>
      `تحتوي العقدة "${p.node}" في التدفق "${p.flow}" على بيانات اعتماد مكتوبة مباشرة في ${position('ar', p)} ` +
      `"${p.name}"، لذلك يستطيع كل من يمكنه عرض التدفقات قراءتها. خزّنها في بيانات اعتماد موصل، واجعل التدفق ` +
      `يستدعي ذلك الموصل بدلًا من ذلك.`,
    fr: (p) =>
      `Le nœud « ${p.node} » du flux « ${p.flow} » contient un identifiant secret écrit directement dans ` +
      `${position('fr', p)} « ${p.name} » : toute personne pouvant consulter les flux peut donc le lire. ` +
      `Stockez-le dans les identifiants d’un connecteur et faites appeler ce connecteur par le flux.`,
    'pt-BR': (p) =>
      `O nó "${p.node}" do fluxo "${p.flow}" tem uma credencial escrita diretamente em ${position('pt-BR', p)} ` +
      `"${p.name}", então qualquer pessoa que possa ver fluxos consegue lê-la. Guarde-a nas credenciais de um ` +
      `conector e faça o fluxo chamar esse conector.`,
    ru: (p) =>
      `В узле «${p.node}» потока «${p.flow}» учётные данные записаны прямо в ${position('ru', p)} «${p.name}», ` +
      `поэтому их может прочитать любой, кто видит потоки. Сохраните их в учётных данных коннектора и вызывайте ` +
      `этот коннектор из потока.`,
    de: (p) =>
      `Der Knoten „${p.node}“ im Flow „${p.flow}“ enthält Zugangsdaten, die direkt in ${position('de', p)} ` +
      `„${p.name}“ geschrieben sind. Jeder, der Flows sehen darf, kann sie daher lesen. Speichern Sie sie in den ` +
      `Zugangsdaten eines Connectors, und lassen Sie den Flow stattdessen diesen Connector aufrufen.`,
    ja: (p) =>
      `フロー「${p.flow}」のノード「${p.node}」で、${position('ja', p)}「${p.name}」に認証情報が直接書き込まれているため、` +
      `フローを閲覧できる人なら誰でも読み取れます。認証情報はコネクタに保存し、フローからはそのコネクタを呼び出してください。`,
    ko: (p) =>
      `플로우 "${p.flow}"의 노드 "${p.node}"에서 ${position('ko', p)} "${p.name}"에 자격 증명이 직접 작성되어 있어, ` +
      `플로우를 볼 수 있는 사람은 누구나 읽을 수 있습니다. 자격 증명은 커넥터에 저장하고, 플로우가 그 커넥터를 ` +
      `호출하도록 바꾸세요.`,
  },
});
