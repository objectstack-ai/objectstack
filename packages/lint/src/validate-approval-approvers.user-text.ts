// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The user-facing sentences of `validate-approval-approvers.ts`'s advisory
 * findings, in every platform locale (`PLATFORM_LOCALE_TAGS`,
 * `@objectstack/spec/system`). The finding mechanism and the locale ladder are
 * `finding-user-text.ts`'s; this file is the rule's own half of it, kept beside
 * the rule so its wording and its translations change together.
 *
 * Who reads these: the person who saved an approval flow in Studio, in their
 * own language, once the save door composes
 * `RuntimeAuthoringIssueSchema.userMessage` from them. So each sentence says
 * what the approver setting does to the request and the one change that fixes
 * it, in the console's words for approvals (approver, position, request); the
 * developer-facing detail stays in the finding's `message`, `hint` and
 * `os explain` entry.
 *
 * Each entry reads the `userTextParams` its finding carries, set at the push
 * site in `validate-approval-approvers.ts`. Every entry reads `flow` and `node`
 * (the flow's and the approval node's names, as the rule's `where` shows them):
 *
 * | rule id | further params |
 * |---|---|
 * | `approval-approver-type-unknown` | `type`, `suggested` (the spec value an off-spec spelling maps to, `''` when none) |
 * | `approval-expression-invalid` (the `info` arm only) | `type` |
 * | `approval-approver-not-membership-tier` | `value` |
 * | `approval-approver-type-deprecated` | `type`, `replacement` |
 * | `approval-approver-type-unsupported` | `type`, `routes` (the expandable group types, comma-joined) |
 * | `approval-approvers-may-resolve-empty` | `slate` (`group` · `manager`), `locked` (`yes` · `no`) |
 * | `approval-expression-no-empty-policy` | — |
 * | `approval-escalation-reassign-no-target` | — |
 *
 * `approval-expression-invalid` is also this rule's `error` id for an
 * expression that cannot run; those push sites carry no params, so a refusal
 * never renders the advisory's sentence. Like the rule's own `message`, no
 * sentence names what an empty slate does beyond what the finding states.
 *
 * `finding-user-text.test.ts` renders every entry from the rule's real
 * findings in every platform locale; the unsupported-type arm, which no
 * shipped binding reaches, is rendered against a mocked binding table in
 * `validate-approval-approvers.unsupported-type.test.ts`.
 */

import type { UserTextCatalog, UserTextParams } from './finding-user-text.js';
import {
  APPROVAL_APPROVER_NOT_MEMBERSHIP_TIER,
  APPROVAL_APPROVER_TYPE_DEPRECATED,
  APPROVAL_APPROVER_TYPE_UNKNOWN,
  APPROVAL_APPROVER_TYPE_UNSUPPORTED,
  APPROVAL_APPROVERS_MAY_RESOLVE_EMPTY,
  APPROVAL_ESCALATION_REASSIGN_NO_TARGET,
  APPROVAL_EXPRESSION_INVALID,
  APPROVAL_EXPRESSION_NO_EMPTY_POLICY,
} from './validate-approval-approvers.js';

/** The `locked: 'yes'` clause of the empty-slate sentence, per locale. */
const STAYS_LOCKED = {
  en: ', and the record stays locked',
  'zh-Hans': '，且该记录会保持锁定',
  'zh-Hant': '，且該記錄會保持鎖定',
  es: ', y el registro permanece bloqueado',
  ar: '، ويظل السجل مقفلًا',
  fr: ', et l’enregistrement reste verrouillé',
  'pt-BR': ', e o registro permanece bloqueado',
  ru: ', а запись остаётся заблокированной',
  de: ', und der Datensatz bleibt gesperrt',
  ja: '。その間、レコードはロックされたままになります',
  ko: ', 레코드는 잠긴 상태로 유지됩니다',
} as const;

const locked = (locale: keyof typeof STAYS_LOCKED, p: UserTextParams): string =>
  p.locked === 'yes' ? STAYS_LOCKED[locale] : '';

export const APPROVAL_APPROVERS_USER_TEXT: UserTextCatalog = Object.freeze({
  [APPROVAL_APPROVER_TYPE_UNKNOWN]: {
    en: (p) =>
      `Approval node "${p.node}" in flow "${p.flow}" has an approver of type "${p.type}", which is not an ` +
      `approver type, so it reaches no one. ` +
      (p.suggested ? `Change the type to "${p.suggested}".` : `Choose one of the approver types the editor offers.`),
    'zh-Hans': (p) =>
      `流程“${p.flow}”的审批节点“${p.node}”中有一个类型为“${p.type}”的审批人，但这不是有效的审批人类型，因此不会分配给任何人。` +
      (p.suggested ? `请将类型改为“${p.suggested}”。` : `请从编辑器提供的审批人类型中选择一种。`),
    'zh-Hant': (p) =>
      `流程「${p.flow}」的審批節點「${p.node}」中有一個類型為「${p.type}」的審批人，但這不是有效的審批人類型，因此不會分派給任何人。` +
      (p.suggested ? `請將類型改為「${p.suggested}」。` : `請從編輯器提供的審批人類型中選擇一種。`),
    es: (p) =>
      `El nodo de aprobación "${p.node}" del flujo "${p.flow}" tiene un aprobador de tipo "${p.type}", que no es ` +
      `un tipo de aprobador, así que no llega a nadie. ` +
      (p.suggested ? `Cambie el tipo a "${p.suggested}".` : `Elija uno de los tipos de aprobador que ofrece el editor.`),
    ar: (p) =>
      `تحتوي عقدة الموافقة "${p.node}" في التدفق "${p.flow}" على موافق من النوع "${p.type}"، وهو ليس نوع موافق ` +
      `صالحًا، لذلك لا يصل إلى أي شخص. ` +
      (p.suggested ? `غيّر النوع إلى "${p.suggested}".` : `اختر أحد أنواع الموافقين التي يعرضها المحرر.`),
    fr: (p) =>
      `Le nœud d’approbation « ${p.node} » du flux « ${p.flow} » a un approbateur de type « ${p.type} », qui ` +
      `n’est pas un type d’approbateur : il n’atteint donc personne. ` +
      (p.suggested
        ? `Remplacez le type par « ${p.suggested} ».`
        : `Choisissez l’un des types d’approbateur proposés par l’éditeur.`),
    'pt-BR': (p) =>
      `O nó de aprovação "${p.node}" do fluxo "${p.flow}" tem um aprovador do tipo "${p.type}", que não é um ` +
      `tipo de aprovador, então ele não chega a ninguém. ` +
      (p.suggested ? `Altere o tipo para "${p.suggested}".` : `Escolha um dos tipos de aprovador que o editor oferece.`),
    ru: (p) =>
      `В узле согласования «${p.node}» потока «${p.flow}» есть согласующий типа «${p.type}», но такого типа ` +
      `согласующих не существует, поэтому он никому не назначается. ` +
      (p.suggested ? `Измените тип на «${p.suggested}».` : `Выберите один из типов согласующих, которые предлагает редактор.`),
    de: (p) =>
      `Der Genehmigungsknoten „${p.node}“ im Flow „${p.flow}“ hat einen Genehmiger vom Typ „${p.type}“. Das ist ` +
      `kein Genehmigertyp, daher erreicht er niemanden. ` +
      (p.suggested ? `Ändern Sie den Typ in „${p.suggested}“.` : `Wählen Sie einen der Genehmigertypen, die der Editor anbietet.`),
    ja: (p) =>
      `フロー「${p.flow}」の承認ノード「${p.node}」に、種類が「${p.type}」の承認者があります。これは承認者の種類ではないため、` +
      `誰にも割り当てられません。` +
      (p.suggested ? `種類を「${p.suggested}」に変更してください。` : `エディターに表示される承認者の種類から選んでください。`),
    ko: (p) =>
      `플로우 "${p.flow}"의 승인 노드 "${p.node}"에 유형이 "${p.type}"인 승인자가 있습니다. 이는 승인자 유형이 아니므로 ` +
      `아무에게도 배정되지 않습니다. ` +
      (p.suggested ? `유형을 "${p.suggested}"(으)로 바꾸세요.` : `편집기에서 제공하는 승인자 유형 중 하나를 선택하세요.`),
  },
  [APPROVAL_EXPRESSION_INVALID]: {
    en: (p) =>
      `An approver of type "${p.type}" on approval node "${p.node}" in flow "${p.flow}" has a resolve-as ` +
      `setting, which only expression approvers use, so it has no effect. Remove the setting, or make the ` +
      `approver an expression approver.`,
    'zh-Hans': (p) =>
      `流程“${p.flow}”的审批节点“${p.node}”中，类型为“${p.type}”的审批人设置了解析方式（resolveAs），但只有表达式审批人会使用该设置，` +
      `因此它不起作用。请删除该设置，或将该审批人改为表达式审批人。`,
    'zh-Hant': (p) =>
      `流程「${p.flow}」的審批節點「${p.node}」中，類型為「${p.type}」的審批人設定了解析方式（resolveAs），但只有運算式審批人會使用該設定，` +
      `因此它不起作用。請刪除該設定，或將該審批人改為運算式審批人。`,
    es: (p) =>
      `Un aprobador de tipo "${p.type}" del nodo de aprobación "${p.node}" del flujo "${p.flow}" tiene un ajuste ` +
      `de resolución (resolveAs), que solo usan los aprobadores de expresión, así que no tiene efecto. Quite el ` +
      `ajuste o convierta el aprobador en un aprobador de expresión.`,
    ar: (p) =>
      `يحتوي موافق من النوع "${p.type}" في عقدة الموافقة "${p.node}" في التدفق "${p.flow}" على إعداد طريقة الحل ` +
      `(resolveAs)، ولا تستخدمه إلا موافقات التعبير، لذلك لا أثر له. أزل الإعداد، أو اجعل الموافق موافق تعبير.`,
    fr: (p) =>
      `Un approbateur de type « ${p.type} » du nœud d’approbation « ${p.node} » du flux « ${p.flow} » a un ` +
      `réglage de résolution (resolveAs), que seuls les approbateurs par expression utilisent : il n’a donc aucun ` +
      `effet. Supprimez ce réglage ou faites de cet approbateur un approbateur par expression.`,
    'pt-BR': (p) =>
      `Um aprovador do tipo "${p.type}" no nó de aprovação "${p.node}" do fluxo "${p.flow}" tem uma configuração ` +
      `de resolução (resolveAs), que só aprovadores de expressão usam, então ela não tem efeito. Remova a ` +
      `configuração ou transforme o aprovador em um aprovador de expressão.`,
    ru: (p) =>
      `У согласующего типа «${p.type}» в узле согласования «${p.node}» потока «${p.flow}» задан способ разрешения ` +
      `(resolveAs), который используют только согласующие-выражения, поэтому он ни на что не влияет. Удалите эту ` +
      `настройку или сделайте согласующего выражением.`,
    de: (p) =>
      `Ein Genehmiger vom Typ „${p.type}“ im Genehmigungsknoten „${p.node}“ des Flows „${p.flow}“ hat eine ` +
      `Auflösungseinstellung (resolveAs), die nur Ausdrucksgenehmiger verwenden, daher bleibt sie wirkungslos. ` +
      `Entfernen Sie die Einstellung, oder machen Sie den Genehmiger zu einem Ausdrucksgenehmiger.`,
    ja: (p) =>
      `フロー「${p.flow}」の承認ノード「${p.node}」で、種類が「${p.type}」の承認者に解決方法（resolveAs）が設定されていますが、` +
      `この設定を使うのは式の承認者だけなので効果はありません。設定を削除するか、この承認者を式の承認者にしてください。`,
    ko: (p) =>
      `플로우 "${p.flow}"의 승인 노드 "${p.node}"에서 유형이 "${p.type}"인 승인자에 확인 방식(resolveAs)이 설정되어 ` +
      `있지만, 이 설정은 표현식 승인자만 사용하므로 효과가 없습니다. 설정을 제거하거나 이 승인자를 표현식 승인자로 바꾸세요.`,
  },
  [APPROVAL_APPROVER_NOT_MEMBERSHIP_TIER]: {
    en: (p) =>
      `An approver on approval node "${p.node}" in flow "${p.flow}" is set to membership level "${p.value}", ` +
      `which is not a membership level, so it matches no one. If "${p.value}" is a position, change the ` +
      `approver type to position.`,
    'zh-Hans': (p) =>
      `流程“${p.flow}”的审批节点“${p.node}”中，有一个审批人被设为成员级别“${p.value}”，但这不是成员级别，因此匹配不到任何人。` +
      `如果“${p.value}”是一个岗位，请把审批人类型改为岗位。`,
    'zh-Hant': (p) =>
      `流程「${p.flow}」的審批節點「${p.node}」中，有一個審批人被設為成員級別「${p.value}」，但這不是成員級別，因此比對不到任何人。` +
      `如果「${p.value}」是一個崗位，請把審批人類型改為崗位。`,
    es: (p) =>
      `Un aprobador del nodo de aprobación "${p.node}" del flujo "${p.flow}" tiene el nivel de membresía ` +
      `"${p.value}", que no es un nivel de membresía, así que no coincide con nadie. Si "${p.value}" es un ` +
      `puesto, cambie el tipo de aprobador a puesto.`,
    ar: (p) =>
      `تم تعيين موافق في عقدة الموافقة "${p.node}" في التدفق "${p.flow}" على مستوى العضوية "${p.value}"، وهو ليس ` +
      `مستوى عضوية، لذلك لا يطابق أي شخص. إذا كان "${p.value}" منصبًا، فغيّر نوع الموافق إلى منصب.`,
    fr: (p) =>
      `Un approbateur du nœud d’approbation « ${p.node} » du flux « ${p.flow} » est défini sur le niveau ` +
      `d’adhésion « ${p.value} », qui n’est pas un niveau d’adhésion : il ne correspond donc à personne. Si ` +
      `« ${p.value} » est un poste, changez le type d’approbateur en poste.`,
    'pt-BR': (p) =>
      `Um aprovador no nó de aprovação "${p.node}" do fluxo "${p.flow}" está definido com o nível de associação ` +
      `"${p.value}", que não é um nível de associação, então não corresponde a ninguém. Se "${p.value}" for um ` +
      `cargo, altere o tipo de aprovador para cargo.`,
    ru: (p) =>
      `Согласующему в узле согласования «${p.node}» потока «${p.flow}» задан уровень участника «${p.value}», но ` +
      `такого уровня нет, поэтому он никому не соответствует. Если «${p.value}» — это должность, измените тип ` +
      `согласующего на «должность».`,
    de: (p) =>
      `Ein Genehmiger im Genehmigungsknoten „${p.node}“ des Flows „${p.flow}“ ist auf die Mitgliedsstufe ` +
      `„${p.value}“ gesetzt. Das ist keine Mitgliedsstufe, daher passt er auf niemanden. Wenn „${p.value}“ eine ` +
      `Position ist, ändern Sie den Genehmigertyp in Position.`,
    ja: (p) =>
      `フロー「${p.flow}」の承認ノード「${p.node}」で、承認者にメンバーシップレベル「${p.value}」が設定されていますが、` +
      `これはメンバーシップレベルではないため、誰にも一致しません。「${p.value}」がポジションなら、承認者の種類をポジションに変更してください。`,
    ko: (p) =>
      `플로우 "${p.flow}"의 승인 노드 "${p.node}"에서 승인자가 멤버십 수준 "${p.value}"(으)로 설정되어 있지만, ` +
      `이는 멤버십 수준이 아니므로 아무와도 일치하지 않습니다. "${p.value}"이(가) 직책이라면 승인자 유형을 직책으로 바꾸세요.`,
  },
  [APPROVAL_APPROVER_TYPE_DEPRECATED]: {
    en: (p) =>
      `An approver on approval node "${p.node}" in flow "${p.flow}" uses the old approver type "${p.type}". It ` +
      `still works, but it will be removed in the next major version: change it to "${p.replacement}".`,
    'zh-Hans': (p) =>
      `流程“${p.flow}”的审批节点“${p.node}”中，有一个审批人使用了旧的审批人类型“${p.type}”。它目前仍然可用，` +
      `但会在下一个主版本中移除：请改为“${p.replacement}”。`,
    'zh-Hant': (p) =>
      `流程「${p.flow}」的審批節點「${p.node}」中，有一個審批人使用了舊的審批人類型「${p.type}」。它目前仍然可用，` +
      `但會在下一個主版本中移除：請改為「${p.replacement}」。`,
    es: (p) =>
      `Un aprobador del nodo de aprobación "${p.node}" del flujo "${p.flow}" usa el tipo de aprobador antiguo ` +
      `"${p.type}". Todavía funciona, pero se eliminará en la próxima versión principal: cámbielo a ` +
      `"${p.replacement}".`,
    ar: (p) =>
      `يستخدم موافق في عقدة الموافقة "${p.node}" في التدفق "${p.flow}" نوع الموافق القديم "${p.type}". لا يزال ` +
      `يعمل، لكنه سيُزال في الإصدار الرئيسي التالي: غيّره إلى "${p.replacement}".`,
    fr: (p) =>
      `Un approbateur du nœud d’approbation « ${p.node} » du flux « ${p.flow} » utilise l’ancien type ` +
      `d’approbateur « ${p.type} ». Il fonctionne encore, mais il sera supprimé dans la prochaine version ` +
      `majeure : remplacez-le par « ${p.replacement} ».`,
    'pt-BR': (p) =>
      `Um aprovador no nó de aprovação "${p.node}" do fluxo "${p.flow}" usa o tipo de aprovador antigo ` +
      `"${p.type}". Ele ainda funciona, mas será removido na próxima versão principal: altere-o para ` +
      `"${p.replacement}".`,
    ru: (p) =>
      `Согласующий в узле согласования «${p.node}» потока «${p.flow}» использует устаревший тип «${p.type}». ` +
      `Он пока работает, но будет удалён в следующей мажорной версии: замените его на «${p.replacement}».`,
    de: (p) =>
      `Ein Genehmiger im Genehmigungsknoten „${p.node}“ des Flows „${p.flow}“ verwendet den alten Genehmigertyp ` +
      `„${p.type}“. Er funktioniert noch, wird aber in der nächsten Hauptversion entfernt: Ändern Sie ihn in ` +
      `„${p.replacement}“.`,
    ja: (p) =>
      `フロー「${p.flow}」の承認ノード「${p.node}」の承認者が、古い承認者の種類「${p.type}」を使っています。` +
      `現在は動作しますが、次のメジャーバージョンで削除されます。「${p.replacement}」に変更してください。`,
    ko: (p) =>
      `플로우 "${p.flow}"의 승인 노드 "${p.node}"에 있는 승인자가 이전 승인자 유형 "${p.type}"을(를) 사용합니다. ` +
      `지금은 동작하지만 다음 주 버전에서 제거됩니다. "${p.replacement}"(으)로 바꾸세요.`,
  },
  [APPROVAL_APPROVER_TYPE_UNSUPPORTED]: {
    en: (p) =>
      `An approver on approval node "${p.node}" in flow "${p.flow}" has type "${p.type}", which the platform ` +
      `does not support, so it reaches no one. Change it to one of these approver types: ${p.routes}.`,
    'zh-Hans': (p) =>
      `流程“${p.flow}”的审批节点“${p.node}”中，有一个审批人的类型是“${p.type}”，平台不支持该类型，因此不会分配给任何人。` +
      `请改为以下审批人类型之一：${p.routes}。`,
    'zh-Hant': (p) =>
      `流程「${p.flow}」的審批節點「${p.node}」中，有一個審批人的類型是「${p.type}」，平台不支援該類型，因此不會分派給任何人。` +
      `請改為以下審批人類型之一：${p.routes}。`,
    es: (p) =>
      `Un aprobador del nodo de aprobación "${p.node}" del flujo "${p.flow}" es de tipo "${p.type}", que la ` +
      `plataforma no admite, así que no llega a nadie. Cámbielo a uno de estos tipos de aprobador: ${p.routes}.`,
    ar: (p) =>
      `موافق في عقدة الموافقة "${p.node}" في التدفق "${p.flow}" من النوع "${p.type}"، وهو نوع لا تدعمه المنصة، ` +
      `لذلك لا يصل إلى أي شخص. غيّره إلى أحد أنواع الموافقين هذه: ${p.routes}.`,
    fr: (p) =>
      `Un approbateur du nœud d’approbation « ${p.node} » du flux « ${p.flow} » est de type « ${p.type} », que ` +
      `la plateforme ne prend pas en charge : il n’atteint donc personne. Remplacez-le par l’un de ces types ` +
      `d’approbateur : ${p.routes}.`,
    'pt-BR': (p) =>
      `Um aprovador no nó de aprovação "${p.node}" do fluxo "${p.flow}" é do tipo "${p.type}", que a plataforma ` +
      `não suporta, então ele não chega a ninguém. Altere-o para um destes tipos de aprovador: ${p.routes}.`,
    ru: (p) =>
      `Согласующий в узле согласования «${p.node}» потока «${p.flow}» имеет тип «${p.type}», который платформа ` +
      `не поддерживает, поэтому он никому не назначается. Выберите один из этих типов: ${p.routes}.`,
    de: (p) =>
      `Ein Genehmiger im Genehmigungsknoten „${p.node}“ des Flows „${p.flow}“ hat den Typ „${p.type}“, den die ` +
      `Plattform nicht unterstützt, daher erreicht er niemanden. Ändern Sie ihn in einen dieser Genehmigertypen: ` +
      `${p.routes}.`,
    ja: (p) =>
      `フロー「${p.flow}」の承認ノード「${p.node}」の承認者の種類「${p.type}」はプラットフォームでサポートされていないため、` +
      `誰にも割り当てられません。次の承認者の種類のいずれかに変更してください: ${p.routes}。`,
    ko: (p) =>
      `플로우 "${p.flow}"의 승인 노드 "${p.node}"에 있는 승인자의 유형 "${p.type}"은(는) 플랫폼에서 지원하지 않으므로 ` +
      `아무에게도 배정되지 않습니다. 다음 승인자 유형 중 하나로 바꾸세요: ${p.routes}.`,
  },
  [APPROVAL_APPROVERS_MAY_RESOLVE_EMPTY]: {
    en: (p) =>
      p.slate === 'manager'
        ? `Every approver on approval node "${p.node}" in flow "${p.flow}" is a manager, so when the user it ` +
          `looks up has no manager set, the request goes to the organization's administrators${locked('en', p)}. ` +
          `Set the users' managers, or add an approver who is always there.`
        : `Every approver on approval node "${p.node}" in flow "${p.flow}" is a position, team, department or ` +
          `queue, so if none of them has anyone in it, the request goes to the organization's ` +
          `administrators${locked('en', p)}. Add an approver who is always there, or name fallback approvers.`,
    'zh-Hans': (p) =>
      p.slate === 'manager'
        ? `流程“${p.flow}”的审批节点“${p.node}”中的审批人全部是上级经理，因此当所查找的用户没有设置经理时，` +
          `申请会转给组织的管理员${locked('zh-Hans', p)}。请为这些用户设置经理，或添加一个始终有人的审批人。`
        : `流程“${p.flow}”的审批节点“${p.node}”中的审批人全部是岗位、团队、部门或队列，因此如果其中都没有人，` +
          `申请会转给组织的管理员${locked('zh-Hans', p)}。请添加一个始终有人的审批人，或指定备用审批人。`,
    'zh-Hant': (p) =>
      p.slate === 'manager'
        ? `流程「${p.flow}」的審批節點「${p.node}」中的審批人全部是上級經理，因此當所查找的使用者沒有設定經理時，` +
          `申請會轉給組織的管理員${locked('zh-Hant', p)}。請為這些使用者設定經理，或新增一個始終有人的審批人。`
        : `流程「${p.flow}」的審批節點「${p.node}」中的審批人全部是崗位、團隊、部門或佇列，因此如果其中都沒有人，` +
          `申請會轉給組織的管理員${locked('zh-Hant', p)}。請新增一個始終有人的審批人，或指定備用審批人。`,
    es: (p) =>
      p.slate === 'manager'
        ? `Todos los aprobadores del nodo de aprobación "${p.node}" del flujo "${p.flow}" son gerentes, así que ` +
          `cuando el usuario consultado no tiene gerente asignado, la solicitud pasa a los administradores de la ` +
          `organización${locked('es', p)}. Asigne gerente a esos usuarios o añada un aprobador que siempre esté ` +
          `disponible.`
        : `Todos los aprobadores del nodo de aprobación "${p.node}" del flujo "${p.flow}" son puestos, equipos, ` +
          `departamentos o colas, así que si ninguno tiene a nadie asignado, la solicitud pasa a los ` +
          `administradores de la organización${locked('es', p)}. Añada un aprobador que siempre esté disponible ` +
          `o indique aprobadores de respaldo.`,
    ar: (p) =>
      p.slate === 'manager'
        ? `كل الموافقين في عقدة الموافقة "${p.node}" في التدفق "${p.flow}" مديرون، لذلك عندما لا يكون للمستخدم ` +
          `الذي يُبحث عنه مدير محدد، ينتقل الطلب إلى مسؤولي المؤسسة${locked('ar', p)}. حدّد مديري المستخدمين، أو ` +
          `أضف موافقًا متاحًا دائمًا.`
        : `كل الموافقين في عقدة الموافقة "${p.node}" في التدفق "${p.flow}" مناصب أو فرق أو أقسام أو قوائم انتظار، ` +
          `لذلك إذا لم يكن في أي منها أحد، ينتقل الطلب إلى مسؤولي المؤسسة${locked('ar', p)}. أضف موافقًا متاحًا ` +
          `دائمًا، أو حدّد موافقين احتياطيين.`,
    fr: (p) =>
      p.slate === 'manager'
        ? `Tous les approbateurs du nœud d’approbation « ${p.node} » du flux « ${p.flow} » sont des managers : ` +
          `quand l’utilisateur concerné n’a pas de manager défini, la demande va aux administrateurs de ` +
          `l’organisation${locked('fr', p)}. Définissez le manager de ces utilisateurs ou ajoutez un approbateur ` +
          `toujours disponible.`
        : `Tous les approbateurs du nœud d’approbation « ${p.node} » du flux « ${p.flow} » sont des postes, des ` +
          `équipes, des services ou des files d’attente : si aucun n’a de titulaire, la demande va aux ` +
          `administrateurs de l’organisation${locked('fr', p)}. Ajoutez un approbateur toujours disponible ou ` +
          `désignez des approbateurs de secours.`,
    'pt-BR': (p) =>
      p.slate === 'manager'
        ? `Todos os aprovadores do nó de aprovação "${p.node}" do fluxo "${p.flow}" são gerentes, então quando o ` +
          `usuário consultado não tem gerente definido, a solicitação vai para os administradores da ` +
          `organização${locked('pt-BR', p)}. Defina o gerente desses usuários ou adicione um aprovador que esteja ` +
          `sempre disponível.`
        : `Todos os aprovadores do nó de aprovação "${p.node}" do fluxo "${p.flow}" são cargos, equipes, ` +
          `departamentos ou filas, então se nenhum deles tiver alguém, a solicitação vai para os administradores ` +
          `da organização${locked('pt-BR', p)}. Adicione um aprovador que esteja sempre disponível ou indique ` +
          `aprovadores substitutos.`,
    ru: (p) =>
      p.slate === 'manager'
        ? `Все согласующие в узле согласования «${p.node}» потока «${p.flow}» — руководители, поэтому если у ` +
          `найденного пользователя руководитель не указан, заявка переходит к администраторам ` +
          `организации${locked('ru', p)}. Укажите пользователям руководителей или добавьте согласующего, который ` +
          `доступен всегда.`
        : `Все согласующие в узле согласования «${p.node}» потока «${p.flow}» — должности, команды, отделы или ` +
          `очереди, поэтому если ни в одной из них никого нет, заявка переходит к администраторам ` +
          `организации${locked('ru', p)}. Добавьте согласующего, который доступен всегда, или укажите резервных ` +
          `согласующих.`,
    de: (p) =>
      p.slate === 'manager'
        ? `Alle Genehmiger im Genehmigungsknoten „${p.node}“ des Flows „${p.flow}“ sind Vorgesetzte. Hat der ` +
          `ermittelte Benutzer keinen Vorgesetzten, geht die Anfrage an die Administratoren der ` +
          `Organisation${locked('de', p)}. Hinterlegen Sie die Vorgesetzten der Benutzer, oder fügen Sie einen ` +
          `Genehmiger hinzu, der immer verfügbar ist.`
        : `Alle Genehmiger im Genehmigungsknoten „${p.node}“ des Flows „${p.flow}“ sind Positionen, Teams, ` +
          `Abteilungen oder Warteschlangen. Ist keine davon besetzt, geht die Anfrage an die Administratoren der ` +
          `Organisation${locked('de', p)}. Fügen Sie einen Genehmiger hinzu, der immer verfügbar ist, oder ` +
          `benennen Sie Ersatzgenehmiger.`,
    ja: (p) =>
      p.slate === 'manager'
        ? `フロー「${p.flow}」の承認ノード「${p.node}」の承認者はすべてマネージャーです。参照するユーザーにマネージャーが` +
          `設定されていない場合、申請は組織の管理者に回されます${locked('ja', p)}。ユーザーのマネージャーを設定するか、` +
          `常に対応できる承認者を追加してください。`
        : `フロー「${p.flow}」の承認ノード「${p.node}」の承認者はすべてポジション、チーム、部門、またはキューです。` +
          `どれにも担当者がいない場合、申請は組織の管理者に回されます${locked('ja', p)}。常に対応できる承認者を追加するか、` +
          `代替の承認者を指定してください。`,
    ko: (p) =>
      p.slate === 'manager'
        ? `플로우 "${p.flow}"의 승인 노드 "${p.node}"에 있는 승인자가 모두 관리자이므로, 조회한 사용자에게 관리자가 ` +
          `설정되어 있지 않으면 요청이 조직 관리자에게 넘어갑니다${locked('ko', p)}. 사용자의 관리자를 설정하거나 ` +
          `항상 처리할 수 있는 승인자를 추가하세요.`
        : `플로우 "${p.flow}"의 승인 노드 "${p.node}"에 있는 승인자가 모두 직책, 팀, 부서 또는 대기열이므로, 어디에도 ` +
          `사람이 없으면 요청이 조직 관리자에게 넘어갑니다${locked('ko', p)}. 항상 처리할 수 있는 승인자를 추가하거나 ` +
          `대체 승인자를 지정하세요.`,
  },
  [APPROVAL_EXPRESSION_NO_EMPTY_POLICY]: {
    en: (p) =>
      `Approval node "${p.node}" in flow "${p.flow}" finds its approvers with an expression but does not say ` +
      `what happens when the expression finds no one, so an empty result goes to an administrator to decide. ` +
      `Choose what the node does when it finds no approver.`,
    'zh-Hans': (p) =>
      `流程“${p.flow}”的审批节点“${p.node}”通过表达式查找审批人，但没有指定表达式找不到人时该怎么办，因此结果为空时会交由管理员处理。` +
      `请选择该节点找不到审批人时的处理方式。`,
    'zh-Hant': (p) =>
      `流程「${p.flow}」的審批節點「${p.node}」透過運算式查找審批人，但沒有指定運算式找不到人時該怎麼辦，因此結果為空時會交由管理員處理。` +
      `請選擇該節點找不到審批人時的處理方式。`,
    es: (p) =>
      `El nodo de aprobación "${p.node}" del flujo "${p.flow}" busca sus aprobadores con una expresión, pero no ` +
      `indica qué hacer cuando la expresión no encuentra a nadie, así que un resultado vacío pasa a un ` +
      `administrador para que decida. Elija qué hace el nodo cuando no encuentra ningún aprobador.`,
    ar: (p) =>
      `تبحث عقدة الموافقة "${p.node}" في التدفق "${p.flow}" عن موافقيها بتعبير، لكنها لا تحدد ما يحدث عندما لا ` +
      `يجد التعبير أحدًا، لذلك تنتقل النتيجة الفارغة إلى مسؤول ليقرر. اختر ما تفعله العقدة عندما لا تجد موافقًا.`,
    fr: (p) =>
      `Le nœud d’approbation « ${p.node} » du flux « ${p.flow} » trouve ses approbateurs par une expression, mais ` +
      `n’indique pas ce qui se passe quand l’expression ne trouve personne : un résultat vide est alors confié à ` +
      `un administrateur. Choisissez ce que fait le nœud quand il ne trouve aucun approbateur.`,
    'pt-BR': (p) =>
      `O nó de aprovação "${p.node}" do fluxo "${p.flow}" encontra seus aprovadores com uma expressão, mas não ` +
      `diz o que acontece quando a expressão não encontra ninguém, então um resultado vazio vai para um ` +
      `administrador decidir. Escolha o que o nó faz quando não encontra nenhum aprovador.`,
    ru: (p) =>
      `Узел согласования «${p.node}» потока «${p.flow}» находит согласующих с помощью выражения, но не указывает, ` +
      `что делать, если выражение никого не нашло, поэтому пустой результат передаётся на решение ` +
      `администратору. Выберите, что делает узел, если согласующий не найден.`,
    de: (p) =>
      `Der Genehmigungsknoten „${p.node}“ im Flow „${p.flow}“ ermittelt seine Genehmiger über einen Ausdruck, ` +
      `legt aber nicht fest, was geschieht, wenn der Ausdruck niemanden findet. Ein leeres Ergebnis geht daher ` +
      `zur Entscheidung an einen Administrator. Legen Sie fest, was der Knoten tut, wenn er keinen Genehmiger ` +
      `findet.`,
    ja: (p) =>
      `フロー「${p.flow}」の承認ノード「${p.node}」は式で承認者を探しますが、式が誰も見つけなかった場合の動作が指定されていないため、` +
      `結果が空のときは管理者の判断に委ねられます。承認者が見つからないときのノードの動作を選んでください。`,
    ko: (p) =>
      `플로우 "${p.flow}"의 승인 노드 "${p.node}"는 표현식으로 승인자를 찾지만, 표현식이 아무도 찾지 못했을 때의 동작을 ` +
      `지정하지 않았으므로 결과가 비면 관리자가 결정하게 됩니다. 승인자를 찾지 못했을 때 노드가 할 동작을 선택하세요.`,
  },
  [APPROVAL_ESCALATION_REASSIGN_NO_TARGET]: {
    en: (p) =>
      `Approval node "${p.node}" in flow "${p.flow}" escalates by reassigning the request but names no one to ` +
      `reassign it to, so the escalation only sends a notification and the request stays with the original ` +
      `approvers. Set who it escalates to, or change the escalation to a notification.`,
    'zh-Hans': (p) =>
      `流程“${p.flow}”的审批节点“${p.node}”的升级方式是转交申请，但没有指定转交给谁，因此升级时只会发送通知，申请仍由原审批人处理。` +
      `请指定升级对象，或将升级方式改为通知。`,
    'zh-Hant': (p) =>
      `流程「${p.flow}」的審批節點「${p.node}」的升級方式是轉交申請，但沒有指定轉交給誰，因此升級時只會傳送通知，申請仍由原審批人處理。` +
      `請指定升級對象，或將升級方式改為通知。`,
    es: (p) =>
      `El nodo de aprobación "${p.node}" del flujo "${p.flow}" escala reasignando la solicitud, pero no indica a ` +
      `quién, así que el escalado solo envía una notificación y la solicitud sigue con los aprobadores ` +
      `originales. Indique a quién se escala o cambie el escalado a una notificación.`,
    ar: (p) =>
      `تُصعّد عقدة الموافقة "${p.node}" في التدفق "${p.flow}" بإعادة تعيين الطلب لكنها لا تحدد لمن، لذلك يكتفي ` +
      `التصعيد بإرسال إشعار ويبقى الطلب لدى الموافقين الأصليين. حدّد الجهة التي يُصعَّد إليها، أو غيّر التصعيد إلى إشعار.`,
    fr: (p) =>
      `Le nœud d’approbation « ${p.node} » du flux « ${p.flow} » escalade en réattribuant la demande, mais ne ` +
      `désigne personne à qui la réattribuer : l’escalade envoie donc seulement une notification et la demande ` +
      `reste aux approbateurs d’origine. Indiquez vers qui escalader ou changez l’escalade en notification.`,
    'pt-BR': (p) =>
      `O nó de aprovação "${p.node}" do fluxo "${p.flow}" escalona reatribuindo a solicitação, mas não indica ` +
      `para quem, então o escalonamento apenas envia uma notificação e a solicitação continua com os ` +
      `aprovadores originais. Defina para quem escalonar ou mude o escalonamento para uma notificação.`,
    ru: (p) =>
      `Узел согласования «${p.node}» потока «${p.flow}» эскалирует заявку переназначением, но не указывает, ` +
      `кому её переназначить, поэтому эскалация лишь отправляет уведомление, а заявка остаётся у прежних ` +
      `согласующих. Укажите, кому эскалировать, или замените эскалацию уведомлением.`,
    de: (p) =>
      `Der Genehmigungsknoten „${p.node}“ im Flow „${p.flow}“ eskaliert durch Neuzuweisung der Anfrage, nennt ` +
      `aber niemanden, dem sie zugewiesen wird. Die Eskalation sendet daher nur eine Benachrichtigung, und die ` +
      `Anfrage bleibt bei den ursprünglichen Genehmigern. Legen Sie fest, an wen eskaliert wird, oder ändern Sie ` +
      `die Eskalation in eine Benachrichtigung.`,
    ja: (p) =>
      `フロー「${p.flow}」の承認ノード「${p.node}」は申請の再割り当てでエスカレーションしますが、再割り当て先が指定されていないため、` +
      `エスカレーションでは通知が送られるだけで、申請は元の承認者に残ります。エスカレーション先を指定するか、エスカレーションを通知に変更してください。`,
    ko: (p) =>
      `플로우 "${p.flow}"의 승인 노드 "${p.node}"는 요청을 재배정하는 방식으로 에스컬레이션하지만 재배정할 대상을 ` +
      `지정하지 않았으므로, 에스컬레이션 시 알림만 보내고 요청은 원래 승인자에게 남습니다. 에스컬레이션 대상을 ` +
      `지정하거나 에스컬레이션을 알림으로 바꾸세요.`,
  },
});
