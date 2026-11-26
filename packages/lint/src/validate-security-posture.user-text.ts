// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The user-facing sentences of `validate-security-posture.ts`'s advisory
 * findings, in every platform locale (`PLATFORM_LOCALE_TAGS`,
 * `@objectstack/spec/system`). The finding mechanism and the locale ladder are
 * `finding-user-text.ts`'s; this file is the rule's own half of it, kept beside
 * the rule so its wording and its translations change together.
 *
 * Who reads these: the person who saved a permission set, object or book in
 * Studio, in their own language, once the save door composes
 * `RuntimeAuthoringIssueSchema.userMessage` from them. So each sentence says
 * what the setting does to people and the one change that fixes it, in the
 * console's own words for these settings (permission set, View All Records,
 * read scope); the developer-facing detail stays in the finding's `message`,
 * `hint` and `os explain` entry.
 *
 * Each entry reads the `userTextParams` its finding carries, set at the push
 * site in `validate-security-posture.ts`:
 *
 * | rule id | params |
 * |---|---|
 * | `security-private-no-readscope` | `permissionSet`, `object` |
 * | `security-master-detail-ungranted` | `object`, `master` (`''` when the runtime's parent names none) |
 * | `security-book-audience-unknown-set` | `book`, `permissionSet` |
 * | `security-controlled-by-parent-master-reference-hidden` | `permissionSet`, `field` |
 * | `security-update-policy-no-check` | `permissionSet`, `policy` |
 * | `security-cross-set-field-reopen` | `permissionSet` (the set that hides the field), `otherSet` (the set whose `viewAllFields` re-opens it), `field`, `object` |
 * | `security-controlled-by-parent-owner-policy-without-opt-in` | `permissionSet`, `policy`, `object`, `remedy` (`allow-owner-edit` · `key-owner-id` · `add-owner-id`) |
 *
 * Names in a sentence are the API names the rule saw (`crm_deal`, `owner_id`),
 * not labels: the reader is the Studio author who wrote those names, and the
 * rule is a pure function of the stack with no label lookup in the request's
 * language. A document with no name shows the rule's own stand-in (`(permission
 * set 0)`, a book's index), as its `message` does.
 *
 * `finding-user-text.test.ts` renders every entry from the
 * rule's real findings in every platform locale.
 */

import type { UserTextCatalog, UserTextParams } from './finding-user-text.js';
import {
  SECURITY_BOOK_AUDIENCE_UNKNOWN_SET,
  SECURITY_CBP_MASTER_REFERENCE_HIDDEN,
  SECURITY_CBP_OWNER_POLICY_WITHOUT_OPT_IN,
  SECURITY_CROSS_SET_FIELD_REOPEN,
  SECURITY_MASTER_DETAIL_UNGRANTED,
  SECURITY_PRIVATE_NO_READSCOPE,
  SECURITY_UPDATE_POLICY_NO_CHECK,
} from './validate-security-posture.js';

/**
 * The console's own label for `viewAllFields`, per locale: the one object-wide
 * bit `security-cross-set-field-reopen` reports (View All and Modify All cast
 * no field vote since the field-axis split, ruling of record 6912661484, step
 * 3). Translated where the console translates its own labels, kept as the
 * console's English label elsewhere.
 */
const VIEW_ALL_FIELDS_LABEL = {
  en: 'View All Fields',
  'zh-Hans': '查看所有字段',
  'zh-Hant': '查看所有欄位',
  es: 'View All Fields',
  ar: 'View All Fields',
  fr: 'View All Fields',
  'pt-BR': 'View All Fields',
  ru: 'View All Fields',
  de: 'View All Fields',
  ja: 'View All Fields',
  ko: 'View All Fields',
} as const;

export const SECURITY_POSTURE_USER_TEXT: UserTextCatalog = Object.freeze({
  [SECURITY_PRIVATE_NO_READSCOPE]: {
    en: (p) =>
      `Holders of permission set "${p.permissionSet}" see only the "${p.object}" records they own or that are ` +
      `shared with them: "${p.object}" is private, and the set grants read access without a read scope. If they ` +
      `should see more, give the set a read scope or widen the object's sharing.`,
    'zh-Hans': (p) =>
      `权限集“${p.permissionSet}”的持有者只能看到自己拥有或被共享给他们的“${p.object}”记录：“${p.object}”是私有对象，` +
      `而该权限集授予了读取权限却没有设置读取范围。如果他们应当看到更多记录，请为该权限集设置读取范围，或放宽该对象的共享设置。`,
    'zh-Hant': (p) =>
      `權限集「${p.permissionSet}」的持有者只能看到自己擁有或被共用給他們的「${p.object}」記錄：「${p.object}」是私有物件，` +
      `而該權限集授予了讀取權限卻沒有設定讀取範圍。如果他們應該看到更多記錄，請為該權限集設定讀取範圍，或放寬該物件的共用設定。`,
    es: (p) =>
      `Los titulares del conjunto de permisos "${p.permissionSet}" solo ven los registros de "${p.object}" que poseen ` +
      `o que se comparten con ellos: "${p.object}" es privado y el conjunto concede lectura sin un ámbito de lectura. ` +
      `Si deben ver más, asigne un ámbito de lectura (Read scope) al conjunto o amplíe el uso compartido del objeto.`,
    ar: (p) =>
      `لا يرى حاملو مجموعة الأذونات "${p.permissionSet}" إلا سجلات "${p.object}" التي يملكونها أو التي تمت مشاركتها ` +
      `معهم: الكائن "${p.object}" خاص، والمجموعة تمنح القراءة دون نطاق قراءة. إذا كان ينبغي أن يروا المزيد، فحدّد ` +
      `نطاق قراءة (Read scope) للمجموعة أو وسّع مشاركة الكائن.`,
    fr: (p) =>
      `Les détenteurs de l’ensemble d’autorisations « ${p.permissionSet} » ne voient que les enregistrements de ` +
      `« ${p.object} » qui leur appartiennent ou qui sont partagés avec eux : « ${p.object} » est privé et ` +
      `l’ensemble accorde la lecture sans portée de lecture. S’ils doivent en voir davantage, définissez une portée ` +
      `de lecture (Read scope) sur l’ensemble ou élargissez le partage de l’objet.`,
    'pt-BR': (p) =>
      `Os titulares do conjunto de permissões "${p.permissionSet}" veem apenas os registros de "${p.object}" que ` +
      `possuem ou que foram compartilhados com eles: "${p.object}" é privado e o conjunto concede leitura sem um ` +
      `escopo de leitura. Se eles devem ver mais, defina um escopo de leitura (Read scope) no conjunto ou amplie o ` +
      `compartilhamento do objeto.`,
    ru: (p) =>
      `Владельцы набора разрешений «${p.permissionSet}» видят только те записи «${p.object}», которыми владеют ` +
      `сами или которые им предоставлены: объект «${p.object}» закрытый, а набор даёт право чтения без области ` +
      `чтения. Если им нужно видеть больше, задайте набору область чтения (Read scope) или расширьте общий доступ к объекту.`,
    de: (p) =>
      `Inhaber des Berechtigungssatzes „${p.permissionSet}“ sehen nur die Datensätze von „${p.object}“, die ihnen ` +
      `gehören oder für sie freigegeben sind: „${p.object}“ ist privat, und der Satz gewährt Lesezugriff ohne ` +
      `Lesebereich. Sollen sie mehr sehen, legen Sie für den Satz einen Lesebereich (Read scope) fest oder erweitern Sie die ` +
      `Freigabe des Objekts.`,
    ja: (p) =>
      `権限セット「${p.permissionSet}」の保持者には、自分が所有しているか共有されている「${p.object}」のレコードしか` +
      `表示されません。「${p.object}」は非公開で、この権限セットは読み取り範囲なしで読み取り権限を付与しているためです。` +
      `より多くのレコードを表示させる場合は、権限セットに読み取り範囲（Read scope）を設定するか、オブジェクトの共有設定を広げてください。`,
    ko: (p) =>
      `권한 세트 "${p.permissionSet}"의 보유자는 자신이 소유하거나 공유받은 "${p.object}" 레코드만 볼 수 있습니다. ` +
      `"${p.object}"은(는) 비공개이고, 이 권한 세트는 읽기 범위 없이 읽기 권한을 부여합니다. 더 많은 레코드를 ` +
      `보아야 한다면 권한 세트에 읽기 범위(Read scope)를 지정하거나 개체의 공유 설정을 넓히세요.`,
  },
  [SECURITY_MASTER_DETAIL_UNGRANTED]: {
    en: (p) =>
      p.master
        ? `No permission set grants access to "${p.object}", a detail of "${p.master}", so everyone except ` +
          `administrators is refused it. Grant it in the permission sets that grant "${p.master}".`
        : `No permission set grants access to detail object "${p.object}", so everyone except administrators is ` +
          `refused it. Grant it in the permission sets that grant its master object.`,
    'zh-Hans': (p) =>
      p.master
        ? `没有任何权限集授予对“${p.object}”（“${p.master}”的子对象）的访问权限，因此除管理员外的所有用户都会被拒绝。` +
          `请在授予“${p.master}”的权限集中同时授予它。`
        : `没有任何权限集授予对子对象“${p.object}”的访问权限，因此除管理员外的所有用户都会被拒绝。` +
          `请在授予其父对象的权限集中同时授予它。`,
    'zh-Hant': (p) =>
      p.master
        ? `沒有任何權限集授予對「${p.object}」（「${p.master}」的子物件）的存取權限，因此除管理員外的所有使用者都會被拒絕。` +
          `請在授予「${p.master}」的權限集中一併授予它。`
        : `沒有任何權限集授予對子物件「${p.object}」的存取權限，因此除管理員外的所有使用者都會被拒絕。` +
          `請在授予其父物件的權限集中一併授予它。`,
    es: (p) =>
      p.master
        ? `Ningún conjunto de permisos concede acceso a "${p.object}", un objeto secundario de "${p.master}", así que se ` +
          `deniega a todos excepto a los administradores. Concédalo en los conjuntos de permisos que conceden ` +
          `"${p.master}".`
        : `Ningún conjunto de permisos concede acceso al objeto secundario "${p.object}", así que se deniega a ` +
          `todos excepto a los administradores. Concédalo en los conjuntos de permisos que conceden su objeto principal.`,
    ar: (p) =>
      p.master
        ? `لا تمنح أي مجموعة أذونات حق الوصول إلى "${p.object}"، وهو كائن فرعي للكائن "${p.master}"، لذا يُرفض ` +
          `وصول الجميع باستثناء المسؤولين. امنح الوصول إليه في مجموعات الأذونات التي تمنح "${p.master}".`
        : `لا تمنح أي مجموعة أذونات حق الوصول إلى الكائن الفرعي "${p.object}"، لذا يُرفض وصول الجميع باستثناء ` +
          `المسؤولين. امنح الوصول إليه في مجموعات الأذونات التي تمنح الكائن الأصل له.`,
    fr: (p) =>
      p.master
        ? `Aucun ensemble d’autorisations n’accorde l’accès à « ${p.object} », un objet enfant de « ${p.master} » : il ` +
          `est donc refusé à tous sauf aux administrateurs. Accordez-le dans les ensembles d’autorisations qui ` +
          `accordent « ${p.master} ».`
        : `Aucun ensemble d’autorisations n’accorde l’accès à l’objet enfant « ${p.object} » : il est donc ` +
          `refusé à tous sauf aux administrateurs. Accordez-le dans les ensembles d’autorisations qui accordent son ` +
          `objet parent.`,
    'pt-BR': (p) =>
      p.master
        ? `Nenhum conjunto de permissões concede acesso a "${p.object}", um objeto filho de "${p.master}", então ele é ` +
          `negado a todos, exceto administradores. Conceda-o nos conjuntos de permissões que concedem "${p.master}".`
        : `Nenhum conjunto de permissões concede acesso ao objeto filho "${p.object}", então ele é negado a ` +
          `todos, exceto administradores. Conceda-o nos conjuntos de permissões que concedem seu objeto pai.`,
    ru: (p) =>
      p.master
        ? `Ни один набор разрешений не даёт доступа к «${p.object}» (дочернему объекту «${p.master}»), поэтому ` +
          `всем, кроме администраторов, в доступе отказано. Предоставьте доступ в тех наборах разрешений, которые ` +
          `дают доступ к «${p.master}».`
        : `Ни один набор разрешений не даёт доступа к дочернему объекту «${p.object}», поэтому всем, кроме ` +
          `администраторов, в доступе отказано. Предоставьте доступ в тех наборах разрешений, которые дают доступ к ` +
          `его родительскому объекту.`,
    de: (p) =>
      p.master
        ? `Kein Berechtigungssatz gewährt Zugriff auf „${p.object}“, ein untergeordnetes Objekt von „${p.master}“, daher wird er ` +
          `allen außer Administratoren verweigert. Gewähren Sie ihn in den Berechtigungssätzen, die „${p.master}“ ` +
          `gewähren.`
        : `Kein Berechtigungssatz gewährt Zugriff auf das untergeordnete Objekt „${p.object}“, daher wird er allen außer ` +
          `Administratoren verweigert. Gewähren Sie ihn in den Berechtigungssätzen, die sein übergeordnetes Objekt gewähren.`,
    ja: (p) =>
      p.master
        ? `「${p.object}」（「${p.master}」の子オブジェクト）へのアクセスを付与している権限セットがないため、` +
          `管理者以外のユーザーはアクセスを拒否されます。「${p.master}」を付与している権限セットで、このオブジェクトも付与してください。`
        : `子オブジェクト「${p.object}」へのアクセスを付与している権限セットがないため、管理者以外のユーザーは` +
          `アクセスを拒否されます。親オブジェクトを付与している権限セットで、このオブジェクトも付与してください。`,
    ko: (p) =>
      p.master
        ? `"${p.object}"("${p.master}"의 하위 개체)에 대한 액세스를 부여하는 권한 세트가 없어 관리자를 제외한 모든 ` +
          `사용자가 거부됩니다. "${p.master}"을(를) 부여하는 권한 세트에서 이 개체도 부여하세요.`
        : `하위 개체 "${p.object}"에 대한 액세스를 부여하는 권한 세트가 없어 관리자를 제외한 모든 사용자가 ` +
          `거부됩니다. 상위 개체를 부여하는 권한 세트에서 이 개체도 부여하세요.`,
  },
  [SECURITY_BOOK_AUDIENCE_UNKNOWN_SET]: {
    en: (p) =>
      `Book "${p.book}" is restricted to permission set "${p.permissionSet}", which is not defined, so no one can ` +
      `open the book. Restrict it to an existing permission set, or ignore this if another installed package ` +
      `provides "${p.permissionSet}".`,
    'zh-Hans': (p) =>
      `文档手册“${p.book}”限定为权限集“${p.permissionSet}”的持有者，但该权限集并不存在，因此没有人能打开这本手册。` +
      `请改为限定一个已存在的权限集；如果“${p.permissionSet}”由另一个已安装的软件包提供，可忽略此提示。`,
    'zh-Hant': (p) =>
      `文件手冊「${p.book}」限定為權限集「${p.permissionSet}」的持有者，但該權限集並不存在，因此沒有人能開啟這本手冊。` +
      `請改為限定一個已存在的權限集；如果「${p.permissionSet}」由另一個已安裝的套件提供，可忽略此提示。`,
    es: (p) =>
      `El libro de documentación "${p.book}" está restringido al conjunto de permisos "${p.permissionSet}", que no ` +
      `está definido, así que nadie puede abrirlo. Restrínjalo a un conjunto de permisos existente, o ignore este ` +
      `aviso si otro paquete instalado proporciona "${p.permissionSet}".`,
    ar: (p) =>
      `كتاب التوثيق "${p.book}" مقيّد بمجموعة الأذونات "${p.permissionSet}"، وهي غير معرّفة، لذا لا يستطيع أحد ` +
      `فتحه. قيّده بمجموعة أذونات موجودة، أو تجاهل هذه الرسالة إذا كانت حزمة مثبتة أخرى توفر "${p.permissionSet}".`,
    fr: (p) =>
      `Le livre de documentation « ${p.book} » est réservé à l’ensemble d’autorisations « ${p.permissionSet} », ` +
      `qui n’est pas défini : personne ne peut donc l’ouvrir. Réservez-le à un ensemble d’autorisations existant, ` +
      `ou ignorez ce message si un autre package installé fournit « ${p.permissionSet} ».`,
    'pt-BR': (p) =>
      `O livro de documentação "${p.book}" está restrito ao conjunto de permissões "${p.permissionSet}", que não ` +
      `está definido, então ninguém consegue abri-lo. Restrinja-o a um conjunto de permissões existente ou ignore ` +
      `este aviso se outro pacote instalado fornecer "${p.permissionSet}".`,
    ru: (p) =>
      `Книга документации «${p.book}» доступна только владельцам набора разрешений «${p.permissionSet}», но такой ` +
      `набор не определён, поэтому открыть книгу не может никто. Ограничьте её существующим набором разрешений или ` +
      `не обращайте внимания на это сообщение, если «${p.permissionSet}» предоставляет другой установленный пакет.`,
    de: (p) =>
      `Das Dokumentationsbuch „${p.book}“ ist auf den Berechtigungssatz „${p.permissionSet}“ beschränkt, der nicht ` +
      `definiert ist, daher kann niemand es öffnen. Beschränken Sie es auf einen vorhandenen Berechtigungssatz oder ` +
      `ignorieren Sie diesen Hinweis, wenn ein anderes installiertes Paket „${p.permissionSet}“ bereitstellt.`,
    ja: (p) =>
      `ドキュメントブック「${p.book}」は権限セット「${p.permissionSet}」に限定されていますが、この権限セットは定義されて` +
      `いないため、誰もこのブックを開けません。既存の権限セットに限定するか、「${p.permissionSet}」を別のインストール済み` +
      `パッケージが提供している場合はこのメッセージを無視してください。`,
    ko: (p) =>
      `문서 북 "${p.book}"은(는) 권한 세트 "${p.permissionSet}"(으)로 제한되어 있지만 이 권한 세트가 정의되어 있지 ` +
      `않아 아무도 이 북을 열 수 없습니다. 기존 권한 세트로 제한하거나, "${p.permissionSet}"을(를) 설치된 다른 ` +
      `패키지가 제공한다면 이 메시지를 무시하세요.`,
  },
  [SECURITY_CBP_MASTER_REFERENCE_HIDDEN]: {
    en: (p) =>
      `Permission set "${p.permissionSet}" hides field "${p.field}", the link to the master record. That link still ` +
      `decides whether the set's holders may change the record, and a holder who is refused is not told which ` +
      `master record the change needs. Make the field readable, or keep it hidden if a generic refusal is intended.`,
    'zh-Hans': (p) =>
      `权限集“${p.permissionSet}”隐藏了字段“${p.field}”，即指向主记录的关联字段。该字段仍决定持有者能否修改记录；` +
      `被拒绝的持有者不会被告知这次修改需要哪条主记录。请将该字段设为可读；如果本就希望给出笼统的拒绝提示，可保持隐藏。`,
    'zh-Hant': (p) =>
      `權限集「${p.permissionSet}」隱藏了欄位「${p.field}」，即指向主記錄的關聯欄位。該欄位仍決定持有者能否修改記錄；` +
      `被拒絕的持有者不會被告知這次修改需要哪筆主記錄。請將該欄位設為可讀；如果本就希望給出籠統的拒絕提示，可保持隱藏。`,
    es: (p) =>
      `El conjunto de permisos "${p.permissionSet}" oculta el campo "${p.field}", el vínculo con el registro ` +
      `principal. Ese vínculo sigue decidiendo si los titulares pueden modificar el registro, y a quien se le ` +
      `deniega no se le indica qué registro principal necesita el cambio. Haga el campo legible, o manténgalo ` +
      `oculto si se pretende un rechazo genérico.`,
    ar: (p) =>
      `تُخفي مجموعة الأذونات "${p.permissionSet}" الحقل "${p.field}"، وهو الرابط إلى السجل الأصل. لا يزال هذا ` +
      `الرابط يحدد ما إذا كان بإمكان حامليها تعديل السجل، ولا يُبلَّغ من يُرفض طلبه بالسجل الأصل الذي يتطلبه ` +
      `التعديل. اجعل الحقل قابلاً للقراءة، أو أبقِه مخفياً إذا كان الرفض العام مقصوداً.`,
    fr: (p) =>
      `L’ensemble d’autorisations « ${p.permissionSet} » masque le champ « ${p.field} », le lien vers ` +
      `l’enregistrement parent. Ce lien décide toujours si ses détenteurs peuvent modifier l’enregistrement, et ` +
      `un détenteur refusé n’apprend pas quel enregistrement parent la modification exige. Rendez le champ ` +
      `lisible, ou laissez-le masqué si un refus générique est voulu.`,
    'pt-BR': (p) =>
      `O conjunto de permissões "${p.permissionSet}" oculta o campo "${p.field}", o vínculo com o registro pai. ` +
      `Esse vínculo ainda decide se os titulares podem alterar o registro, e quem for recusado não fica sabendo ` +
      `qual registro pai a alteração exige. Torne o campo legível ou mantenha-o oculto se uma recusa genérica ` +
      `for intencional.`,
    ru: (p) =>
      `Набор разрешений «${p.permissionSet}» скрывает поле «${p.field}» — ссылку на родительскую запись. Эта ссылка ` +
      `по-прежнему определяет, могут ли владельцы набора изменять запись, а получивший отказ не узнает, какая ` +
      `родительская запись нужна для изменения. Сделайте поле доступным для чтения или оставьте его скрытым, если ` +
      `задуман общий отказ.`,
    de: (p) =>
      `Der Berechtigungssatz „${p.permissionSet}“ blendet das Feld „${p.field}“ aus, die Verknüpfung zum ` +
      `übergeordneten Datensatz. Diese Verknüpfung entscheidet weiterhin, ob die Inhaber den Datensatz ändern dürfen, und ` +
      `ein abgewiesener Inhaber erfährt nicht, welchen übergeordneten Datensatz die Änderung erfordert. Machen Sie das Feld ` +
      `lesbar oder lassen Sie es ausgeblendet, wenn eine allgemeine Ablehnung beabsichtigt ist.`,
    ja: (p) =>
      `権限セット「${p.permissionSet}」は、親レコードへの参照である項目「${p.field}」を非表示にしています。` +
      `この項目は保持者がレコードを変更できるかどうかを引き続き決定しており、拒否された保持者には、変更に必要な` +
      `親レコードが伝えられません。項目を読み取り可能にするか、一般的な拒否メッセージで構わない場合は非表示のままにしてください。`,
    ko: (p) =>
      `권한 세트 "${p.permissionSet}"은(는) 상위 레코드에 대한 연결인 필드 "${p.field}"을(를) 숨깁니다. 이 필드는 ` +
      `여전히 보유자가 레코드를 변경할 수 있는지를 결정하며, 거부된 보유자는 변경에 필요한 상위 레코드가 무엇인지 ` +
      `안내받지 못합니다. 필드를 읽을 수 있게 하거나, 일반적인 거부 메시지를 의도했다면 숨긴 상태로 두세요.`,
  },
  [SECURITY_UPDATE_POLICY_NO_CHECK]: {
    en: (p) =>
      `Policy "${p.policy}" in permission set "${p.permissionSet}" sets no check condition, so an update may also ` +
      `save rows that the default ownership rule allows. Add a check condition to limit what an update may write.`,
    'zh-Hans': (p) =>
      `权限集“${p.permissionSet}”中的策略“${p.policy}”没有设置 CHECK（写入过滤）条件，因此更新时也可能写入默认所有权规则所允许的行。` +
      `请添加 CHECK 条件，以限制更新可以写入的内容。`,
    'zh-Hant': (p) =>
      `權限集「${p.permissionSet}」中的策略「${p.policy}」沒有設定 CHECK（寫入過濾）條件，因此更新時也可能寫入預設擁有權規則所允許的資料列。` +
      `請新增 CHECK 條件，以限制更新可以寫入的內容。`,
    es: (p) =>
      `La política "${p.policy}" del conjunto de permisos "${p.permissionSet}" no define ninguna condición de ` +
      `comprobación, así que una actualización también puede guardar filas que la regla de propiedad ` +
      `predeterminada permite. Añada una condición de comprobación (CHECK) para limitar lo que puede escribir una actualización.`,
    ar: (p) =>
      `لا تحدد السياسة "${p.policy}" في مجموعة الأذونات "${p.permissionSet}" أي شرط تحقق، لذا قد يحفظ التحديث ` +
      `أيضاً صفوفاً تسمح بها قاعدة الملكية الافتراضية. أضف شرط تحقق (CHECK) لتقييد ما يمكن أن يكتبه التحديث.`,
    fr: (p) =>
      `La politique « ${p.policy} » de l’ensemble d’autorisations « ${p.permissionSet} » ne définit aucune ` +
      `condition de vérification : une mise à jour peut donc aussi enregistrer des lignes que la règle de propriété ` +
      `par défaut autorise. Ajoutez une condition de vérification (CHECK) pour limiter ce qu’une mise à jour peut écrire.`,
    'pt-BR': (p) =>
      `A política "${p.policy}" do conjunto de permissões "${p.permissionSet}" não define condição de verificação, ` +
      `então uma atualização também pode gravar linhas que a regra de propriedade padrão permite. Adicione uma ` +
      `condição de verificação (CHECK) para limitar o que uma atualização pode gravar.`,
    ru: (p) =>
      `Политика «${p.policy}» в наборе разрешений «${p.permissionSet}» не задаёт условия проверки, поэтому ` +
      `обновление может сохранить и строки, которые допускает правило владения по умолчанию. Добавьте условие ` +
      `проверки (CHECK), чтобы ограничить то, что может записать обновление.`,
    de: (p) =>
      `Die Richtlinie „${p.policy}“ im Berechtigungssatz „${p.permissionSet}“ legt keine Prüfbedingung fest, daher ` +
      `kann eine Aktualisierung auch Zeilen speichern, die die Standard-Besitzregel zulässt. Fügen Sie eine ` +
      `Prüfbedingung (CHECK) hinzu, um zu begrenzen, was eine Aktualisierung schreiben darf.`,
    ja: (p) =>
      `権限セット「${p.permissionSet}」のポリシー「${p.policy}」にはチェック条件がないため、更新時に既定の所有権ルールが` +
      `許可する行も書き込まれる可能性があります。チェック条件（CHECK）を追加して、更新で書き込める内容を制限してください。`,
    ko: (p) =>
      `권한 세트 "${p.permissionSet}"의 정책 "${p.policy}"에는 검사 조건이 없어, 업데이트가 기본 소유권 규칙이 ` +
      `허용하는 행까지 저장할 수 있습니다. 검사 조건(CHECK)을 추가해 업데이트가 쓸 수 있는 내용을 제한하세요.`,
  },
  [SECURITY_CBP_OWNER_POLICY_WITHOUT_OPT_IN]: {
    en: (p) =>
      `Update policy "${p.policy}" in permission set "${p.permissionSet}" never lets the user it names edit ` +
      `"${p.object}" on its own: "${p.object}" takes its edit access from its master record, so the policy can only ` +
      `narrow who may edit it. ` +
      ownerPolicyRemedy(p, {
        'allow-owner-edit': `Allow record owners to edit "${p.object}" in its sharing settings, or remove the policy.`,
        'key-owner-id':
          'Key the policy on the record owner (owner_id), the one user the master check compares, or remove the policy.',
        'add-owner-id': `Give "${p.object}" a record owner (owner_id) and key the policy on it, or remove the policy.`,
      }),
    'zh-Hans': (p) =>
      `权限集“${p.permissionSet}”中的更新策略“${p.policy}”永远无法让它所指的用户单独获得“${p.object}”的编辑权限：` +
      `“${p.object}”的编辑权限来自其主记录，因此该策略只能缩小可编辑的人员范围。` +
      ownerPolicyRemedy(p, {
        'allow-owner-edit': `请在“${p.object}”的共享设置中开启“所有者可编辑”，或删除该策略。`,
        'key-owner-id': '请让该策略以记录所有者（owner_id）为条件——这是主记录检查唯一比对的用户——或删除该策略。',
        'add-owner-id': `请为“${p.object}”添加记录所有者（owner_id）并让该策略以它为条件，或删除该策略。`,
      }),
    'zh-Hant': (p) =>
      `權限集「${p.permissionSet}」中的更新策略「${p.policy}」永遠無法讓它所指的使用者單獨取得「${p.object}」的編輯權限：` +
      `「${p.object}」的編輯權限來自其主記錄，因此該策略只能縮小可編輯的人員範圍。` +
      ownerPolicyRemedy(p, {
        'allow-owner-edit': `請在「${p.object}」的共用設定中開啟「擁有者可編輯」，或刪除該策略。`,
        'key-owner-id': '請讓該策略以記錄擁有者（owner_id）為條件——這是主記錄檢查唯一比對的使用者——或刪除該策略。',
        'add-owner-id': `請為「${p.object}」新增記錄擁有者（owner_id）並讓該策略以它為條件，或刪除該策略。`,
      }),
    es: (p) =>
      `La política de actualización "${p.policy}" del conjunto de permisos "${p.permissionSet}" nunca permite por ` +
      `sí sola que el usuario que nombra edite "${p.object}": "${p.object}" recibe su acceso de edición de su ` +
      `registro principal, así que la política solo puede restringir quién puede editarlo. ` +
      ownerPolicyRemedy(p, {
        'allow-owner-edit':
          `Active "El propietario puede editar" en la configuración de uso compartido de "${p.object}", ` +
          'o elimine la política.',
        'key-owner-id':
          'Base la política en el propietario del registro (owner_id), el único usuario que compara la ' +
          'comprobación del registro principal, o elimine la política.',
        'add-owner-id':
          `Dé a "${p.object}" un propietario de registro (owner_id) y base la política en él, o elimine la política.`,
      }),
    ar: (p) =>
      `لا تسمح سياسة التحديث "${p.policy}" في مجموعة الأذونات "${p.permissionSet}" بمفردها أبداً للمستخدم الذي ` +
      `تحدده بتعديل "${p.object}": إذ يُستمد حق تعديل "${p.object}" من سجله الأصل، لذا لا يمكن للسياسة إلا ` +
      `تضييق نطاق من يمكنهم تعديله. ` +
      ownerPolicyRemedy(p, {
        'allow-owner-edit': `فعّل "يجوز للمالك التعديل" في إعدادات المشاركة الخاصة بـ "${p.object}"، أو احذف السياسة.`,
        'key-owner-id':
          'اربط السياسة بمالك السجل (owner_id)، وهو المستخدم الوحيد الذي يقارنه تحقق السجل الأصل، أو احذف السياسة.',
        'add-owner-id': `أضف مالك سجل (owner_id) إلى "${p.object}" واربط السياسة به، أو احذف السياسة.`,
      }),
    fr: (p) =>
      `La politique de mise à jour « ${p.policy} » de l’ensemble d’autorisations « ${p.permissionSet} » ne permet ` +
      `jamais à elle seule à l’utilisateur qu’elle désigne de modifier « ${p.object} » : « ${p.object} » tient son ` +
      `accès en modification de son enregistrement parent, donc la politique ne peut que restreindre qui peut le ` +
      `modifier. ` +
      ownerPolicyRemedy(p, {
        'allow-owner-edit':
          `Activez « Le propriétaire peut modifier » dans les paramètres de partage de « ${p.object} », ` +
          'ou supprimez la politique.',
        'key-owner-id':
          'Fondez la politique sur le propriétaire de l’enregistrement (owner_id), le seul utilisateur que compare ' +
          'la vérification de l’enregistrement parent, ou supprimez la politique.',
        'add-owner-id':
          `Donnez à « ${p.object} » un propriétaire d’enregistrement (owner_id) et fondez la politique dessus, ou ` +
          'supprimez la politique.',
      }),
    'pt-BR': (p) =>
      `A política de atualização "${p.policy}" do conjunto de permissões "${p.permissionSet}" nunca permite, ` +
      `sozinha, que o usuário que ela indica edite "${p.object}": "${p.object}" recebe o acesso de edição do seu ` +
      `registro pai, então a política só pode restringir quem pode editá-lo. ` +
      ownerPolicyRemedy(p, {
        'allow-owner-edit':
          `Ative "Proprietário pode editar" nas configurações de compartilhamento de "${p.object}" ` +
          'ou remova a política.',
        'key-owner-id':
          'Baseie a política no proprietário do registro (owner_id), o único usuário que a verificação do registro ' +
          'pai compara, ou remova a política.',
        'add-owner-id':
          `Dê a "${p.object}" um proprietário de registro (owner_id) e baseie a política nele, ou remova a política.`,
      }),
    ru: (p) =>
      `Политика обновления «${p.policy}» в наборе разрешений «${p.permissionSet}» сама по себе никогда не ` +
      `позволяет указанному в ней пользователю редактировать «${p.object}»: право на редактирование «${p.object}» ` +
      `определяется его родительской записью, поэтому политика может только сузить круг тех, кто может его редактировать. ` +
      ownerPolicyRemedy(p, {
        'allow-owner-edit':
          `Включите «Владелец может редактировать» в настройках общего доступа объекта «${p.object}» или удалите политику.`,
        'key-owner-id':
          'Привяжите политику к владельцу записи (owner_id) — единственному пользователю, которого сравнивает ' +
          'проверка родительской записи, — или удалите политику.',
        'add-owner-id':
          `Добавьте объекту «${p.object}» владельца записи (owner_id) и привяжите к нему политику или удалите политику.`,
      }),
    de: (p) =>
      `Die Aktualisierungsrichtlinie „${p.policy}“ im Berechtigungssatz „${p.permissionSet}“ erlaubt dem ` +
      `Benutzer, den sie nennt, allein nie, „${p.object}“ zu bearbeiten: „${p.object}“ erhält seinen ` +
      `Bearbeitungszugriff vom übergeordneten Datensatz, daher kann die Richtlinie nur einschränken, wer es bearbeiten darf. ` +
      ownerPolicyRemedy(p, {
        'allow-owner-edit':
          `Aktivieren Sie in den Freigabeeinstellungen von „${p.object}“ die Option „Eigentümer darf bearbeiten“, oder ` +
          'entfernen Sie die Richtlinie.',
        'key-owner-id':
          'Knüpfen Sie die Richtlinie an den Datensatzeigentümer (owner_id), den einzigen Benutzer, den die ' +
          'Prüfung des übergeordneten Datensatzes vergleicht, oder entfernen Sie die Richtlinie.',
        'add-owner-id':
          `Geben Sie „${p.object}“ einen Datensatzeigentümer (owner_id) und knüpfen Sie die Richtlinie daran, oder ` +
          'entfernen Sie die Richtlinie.',
      }),
    ja: (p) =>
      `権限セット「${p.permissionSet}」の更新ポリシー「${p.policy}」だけでは、対象のユーザーが「${p.object}」を` +
      `編集できるようにはなりません。「${p.object}」の編集権限は親レコードから決まるため、このポリシーは` +
      `編集できるユーザーを絞り込むことしかできません。` +
      ownerPolicyRemedy(p, {
        'allow-owner-edit': `「${p.object}」の共有設定で「所有者は編集可」をオンにするか、このポリシーを削除してください。`,
        'key-owner-id':
          'ポリシーの条件をレコード所有者（owner_id）にするか（親レコードのチェックが比較する唯一のユーザーです）、' +
          'このポリシーを削除してください。',
        'add-owner-id':
          `「${p.object}」にレコード所有者（owner_id）を追加してポリシーの条件にするか、このポリシーを削除してください。`,
      }),
    ko: (p) =>
      `권한 세트 "${p.permissionSet}"의 업데이트 정책 "${p.policy}"만으로는 해당 사용자가 "${p.object}"을(를) ` +
      `편집할 수 없습니다. "${p.object}"의 편집 권한은 상위 레코드에서 결정되므로, 이 정책은 편집할 수 있는 ` +
      `사용자를 좁힐 수만 있습니다. ` +
      ownerPolicyRemedy(p, {
        'allow-owner-edit': `"${p.object}"의 공유 설정에서 "소유자 편집 허용"을 켜거나, 이 정책을 삭제하세요.`,
        'key-owner-id':
          '정책 조건을 레코드 소유자(owner_id)로 지정하거나(상위 레코드 검사가 비교하는 유일한 사용자입니다), 이 정책을 삭제하세요.',
        'add-owner-id':
          `"${p.object}"에 레코드 소유자(owner_id)를 추가하고 정책 조건으로 지정하거나, 이 정책을 삭제하세요.`,
      }),
  },
  // [Field-axis split, ruling of record 6912661484, steps 2 and 3] Each
  // sentence names the two sets, the field and the bit (by its console
  // label), says that a holder of both can still read the field, and gives
  // the two fixes the rule's hint leads with: remove the bit, or protect the
  // field on the field itself (Required permissions, ADR-0066 D3). The bit
  // votes no edit, so a read-only field is never re-opened.
  [SECURITY_CROSS_SET_FIELD_REOPEN]: {
    en: (p) => {
      const b = VIEW_ALL_FIELDS_LABEL['en'];
      const opens = `"${p.otherSet}" has ${b} on "${p.object}", which opens every field of that object.`;
      const hidden = `Remove ${b} from "${p.otherSet}", or, if the field must stay hidden from everyone without a specific permission, set required permissions on the field itself.`;
      return `Field "${p.field}" is hidden in permission set "${p.permissionSet}", but anyone who also holds permission set "${p.otherSet}" can still read it: ${opens} ${hidden}`;
    },
    'zh-Hans': (p) => {
      const b = VIEW_ALL_FIELDS_LABEL['zh-Hans'];
      const opens = `“${p.otherSet}”对“${p.object}”拥有“${b}”，会开放该对象的每个字段。`;
      const hidden = `请从“${p.otherSet}”移除“${b}”；如果该字段必须对所有没有特定权限的人隐藏，请直接在字段上设置所需权限。`;
      return `字段“${p.field}”在权限集“${p.permissionSet}”中被隐藏，但同时持有权限集“${p.otherSet}”的人仍能读取它：${opens}${hidden}`;
    },
    'zh-Hant': (p) => {
      const b = VIEW_ALL_FIELDS_LABEL['zh-Hant'];
      const opens = `「${p.otherSet}」對「${p.object}」擁有「${b}」，會開放該物件的每個欄位。`;
      const hidden = `請從「${p.otherSet}」移除「${b}」；如果該欄位必須對所有沒有特定權限的人隱藏，請直接在欄位上設定所需權限。`;
      return `欄位「${p.field}」在權限集「${p.permissionSet}」中被隱藏，但同時持有權限集「${p.otherSet}」的人仍能讀取它：${opens}${hidden}`;
    },
    es: (p) => {
      const b = VIEW_ALL_FIELDS_LABEL['es'];
      const opens = `"${p.otherSet}" tiene "${b}" sobre "${p.object}", que abre todos los campos de ese objeto.`;
      const hidden = `Quite "${b}" de "${p.otherSet}" o, si el campo debe permanecer oculto para todos los que no tengan un permiso específico, defina los permisos requeridos en el propio campo.`;
      return `El campo "${p.field}" está oculto en el conjunto de permisos "${p.permissionSet}", pero quien también tenga el conjunto de permisos "${p.otherSet}" aún puede leerlo: ${opens} ${hidden}`;
    },
    ar: (p) => {
      const b = VIEW_ALL_FIELDS_LABEL['ar'];
      const opens = `لدى "${p.otherSet}" الإذن "${b}" على "${p.object}"، وهو يفتح كل حقول هذا الكائن.`;
      const hidden = `أزل "${b}" من "${p.otherSet}"، أو إذا كان يجب أن يبقى الحقل مخفيًا عن كل من لا يملك إذنًا محددًا، فحدّد الأذونات المطلوبة على الحقل نفسه.`;
      return `الحقل "${p.field}" مخفي في مجموعة الأذونات "${p.permissionSet}"، لكن من يحمل أيضًا مجموعة الأذونات "${p.otherSet}" لا يزال يستطيع قراءته: ${opens} ${hidden}`;
    },
    fr: (p) => {
      const b = VIEW_ALL_FIELDS_LABEL['fr'];
      const opens = `« ${p.otherSet} » dispose de « ${b} » sur « ${p.object} », ce qui ouvre tous les champs de cet objet.`;
      const hidden = `Retirez « ${b} » de « ${p.otherSet} » ou, si le champ doit rester masqué pour toute personne sans autorisation spécifique, définissez les autorisations requises sur le champ lui-même.`;
      return `Le champ « ${p.field} » est masqué dans l’ensemble d’autorisations « ${p.permissionSet} », mais quiconque détient aussi l’ensemble d’autorisations « ${p.otherSet} » peut encore le lire : ${opens} ${hidden}`;
    },
    'pt-BR': (p) => {
      const b = VIEW_ALL_FIELDS_LABEL['pt-BR'];
      const opens = `"${p.otherSet}" tem "${b}" em "${p.object}", o que abre todos os campos desse objeto.`;
      const hidden = `Remova "${b}" de "${p.otherSet}" ou, se o campo precisa ficar oculto para todos que não têm uma permissão específica, defina as permissões exigidas no próprio campo.`;
      return `O campo "${p.field}" está oculto no conjunto de permissões "${p.permissionSet}", mas quem também tem o conjunto de permissões "${p.otherSet}" ainda pode lê-lo: ${opens} ${hidden}`;
    },
    ru: (p) => {
      const b = VIEW_ALL_FIELDS_LABEL['ru'];
      const opens = `у «${p.otherSet}» есть «${b}» для «${p.object}», что открывает все поля этого объекта.`;
      const hidden = `Уберите «${b}» из «${p.otherSet}» или, если поле должно оставаться скрытым от всех, у кого нет определённого разрешения, задайте требуемые разрешения в самом поле.`;
      return `Поле «${p.field}» скрыто в наборе разрешений «${p.permissionSet}», но тот, у кого есть ещё и набор разрешений «${p.otherSet}», по-прежнему может его читать: ${opens} ${hidden}`;
    },
    de: (p) => {
      const b = VIEW_ALL_FIELDS_LABEL['de'];
      const opens = `„${p.otherSet}“ hat „${b}“ auf „${p.object}“, was jedes Feld dieses Objekts öffnet.`;
      const hidden = `Entfernen Sie „${b}“ aus „${p.otherSet}“, oder legen Sie, wenn das Feld für alle ohne eine bestimmte Berechtigung verborgen bleiben muss, die erforderlichen Berechtigungen am Feld selbst fest.`;
      return `Das Feld „${p.field}“ ist im Berechtigungssatz „${p.permissionSet}“ ausgeblendet, aber wer zusätzlich den Berechtigungssatz „${p.otherSet}“ hat, kann es weiterhin lesen: ${opens} ${hidden}`;
    },
    ja: (p) => {
      const b = VIEW_ALL_FIELDS_LABEL['ja'];
      const opens = `「${p.otherSet}」は「${p.object}」に対して「${b}」を持ち、このオブジェクトのすべてのフィールドを開くためです。`;
      const hidden = `「${p.otherSet}」から「${b}」を外すか、特定の権限を持たない全員からこのフィールドを隠す必要がある場合は、フィールド自体に必要な権限を設定してください。`;
      return `フィールド「${p.field}」は権限セット「${p.permissionSet}」で非表示になっていますが、権限セット「${p.otherSet}」も持つユーザーは引き続き読み取れます。${opens}${hidden}`;
    },
    ko: (p) => {
      const b = VIEW_ALL_FIELDS_LABEL['ko'];
      const opens = `"${p.otherSet}"이(가) "${p.object}"에 대해 "${b}"을(를) 가지고 있어 이 개체의 모든 필드를 열기 때문입니다.`;
      const hidden = `"${p.otherSet}"에서 "${b}"을(를) 제거하거나, 특정 권한이 없는 모든 사람에게 이 필드를 계속 숨겨야 한다면 필드 자체에 필요한 권한을 설정하세요.`;
      return `필드 "${p.field}"은(는) 권한 세트 "${p.permissionSet}"에서 숨겨져 있지만, 권한 세트 "${p.otherSet}"도 보유한 사람은 여전히 이 필드를 읽을 수 있습니다. ${opens} ${hidden}`;
    },
  },
});

/**
 * The remedy sentence of `security-controlled-by-parent-owner-policy-without-opt-in`,
 * by the `remedy` param its push site sets: the opt-in where it serves the
 * policy, otherwise the `owner_id` keying that does. ⛔ An unknown `remedy`
 * prescribes nothing rather than the opt-in: prescribing the opt-in where the
 * runtime does not honour it is the defect the rule's own hint was narrowed for.
 */
type OwnerPolicyRemedy = 'allow-owner-edit' | 'key-owner-id' | 'add-owner-id';

function ownerPolicyRemedy(p: UserTextParams, sentences: Readonly<Record<OwnerPolicyRemedy, string>>): string {
  return Object.prototype.hasOwnProperty.call(sentences, p.remedy) ? sentences[p.remedy as OwnerPolicyRemedy] : '';
}
