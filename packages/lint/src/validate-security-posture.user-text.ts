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
 * | `security-superuser-field-mask-inert` | `permissionSet`, `field`, `object`, `bypass` (`view` · `modify`), `inert` (`read` · `edit` · `both`) |
 * | `security-controlled-by-parent-master-reference-hidden` | `permissionSet`, `field` |
 * | `security-update-policy-no-check` | `permissionSet`, `policy` |
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
  SECURITY_MASTER_DETAIL_UNGRANTED,
  SECURITY_PRIVATE_NO_READSCOPE,
  SECURITY_SUPERUSER_FIELD_MASK_INERT,
  SECURITY_UPDATE_POLICY_NO_CHECK,
} from './validate-security-posture.js';

/** `bypass` → the console's own label for that permission, per locale. */
const BYPASS_LABEL = {
  en: { view: 'View All Records', modify: 'Modify All Records' },
  'zh-Hans': { view: '查看所有记录', modify: '修改所有记录' },
  'zh-Hant': { view: '檢視所有記錄', modify: '修改所有記錄' },
  es: { view: 'Ver todos los registros', modify: 'Modificar todos los registros' },
  ar: { view: 'عرض كل السجلات', modify: 'تعديل كل السجلات' },
  fr: { view: 'Afficher tous les enregistrements', modify: 'Modifier tous les enregistrements' },
  'pt-BR': { view: 'Ver todos os registros', modify: 'Modificar todos os registros' },
  ru: { view: 'Просмотр всех записей', modify: 'Изменение всех записей' },
  de: { view: 'Alle Datensätze anzeigen', modify: 'Alle Datensätze ändern' },
  ja: { view: 'すべてのレコードの参照', modify: 'すべてのレコードの変更' },
  ko: { view: '모든 레코드 보기', modify: '모든 레코드 수정' },
} as const;

const bypassLabel = (locale: keyof typeof BYPASS_LABEL, p: UserTextParams): string =>
  BYPASS_LABEL[locale][p.bypass === 'modify' ? 'modify' : 'view'];

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
      `Si deben ver más, asigne un ámbito de lectura al conjunto o amplíe el uso compartido del objeto.`,
    ar: (p) =>
      `لا يرى حاملو مجموعة الأذونات "${p.permissionSet}" إلا سجلات "${p.object}" التي يملكونها أو التي تمت مشاركتها ` +
      `معهم: الكائن "${p.object}" خاص، والمجموعة تمنح القراءة دون نطاق قراءة. إذا كان ينبغي أن يروا المزيد، فحدّد ` +
      `نطاق قراءة للمجموعة أو وسّع مشاركة الكائن.`,
    fr: (p) =>
      `Les détenteurs de l’ensemble d’autorisations « ${p.permissionSet} » ne voient que les enregistrements de ` +
      `« ${p.object} » qui leur appartiennent ou qui sont partagés avec eux : « ${p.object} » est privé et ` +
      `l’ensemble accorde la lecture sans portée de lecture. S’ils doivent en voir davantage, définissez une portée ` +
      `de lecture sur l’ensemble ou élargissez le partage de l’objet.`,
    'pt-BR': (p) =>
      `Os titulares do conjunto de permissões "${p.permissionSet}" veem apenas os registros de "${p.object}" que ` +
      `possuem ou que foram compartilhados com eles: "${p.object}" é privado e o conjunto concede leitura sem um ` +
      `escopo de leitura. Se eles devem ver mais, defina um escopo de leitura no conjunto ou amplie o ` +
      `compartilhamento do objeto.`,
    ru: (p) =>
      `Владельцы набора разрешений «${p.permissionSet}» видят только те записи «${p.object}», которыми владеют ` +
      `сами или которые им предоставлены: объект «${p.object}» закрытый, а набор даёт право чтения без области ` +
      `чтения. Если им нужно видеть больше, задайте набору область чтения или расширьте общий доступ к объекту.`,
    de: (p) =>
      `Inhaber des Berechtigungssatzes „${p.permissionSet}“ sehen nur die Datensätze von „${p.object}“, die ihnen ` +
      `gehören oder für sie freigegeben sind: „${p.object}“ ist privat, und der Satz gewährt Lesezugriff ohne ` +
      `Lesebereich. Sollen sie mehr sehen, legen Sie für den Satz einen Lesebereich fest oder erweitern Sie die ` +
      `Freigabe des Objekts.`,
    ja: (p) =>
      `権限セット「${p.permissionSet}」の保持者には、自分が所有しているか共有されている「${p.object}」のレコードしか` +
      `表示されません。「${p.object}」は非公開で、この権限セットは参照範囲なしで参照権限を付与しているためです。` +
      `より多くのレコードを表示させる場合は、権限セットに参照範囲を設定するか、オブジェクトの共有設定を広げてください。`,
    ko: (p) =>
      `권한 집합 "${p.permissionSet}"의 보유자는 자신이 소유하거나 공유받은 "${p.object}" 레코드만 볼 수 있습니다. ` +
      `"${p.object}"은(는) 비공개이고, 이 권한 집합은 읽기 범위 없이 읽기 권한을 부여합니다. 더 많은 레코드를 ` +
      `보아야 한다면 권한 집합에 읽기 범위를 지정하거나 개체의 공유 설정을 넓히세요.`,
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
        ? `没有任何权限集授予对“${p.object}”（“${p.master}”的明细对象）的访问权限，因此除管理员外的所有用户都会被拒绝。` +
          `请在授予“${p.master}”的权限集中同时授予它。`
        : `没有任何权限集授予对明细对象“${p.object}”的访问权限，因此除管理员外的所有用户都会被拒绝。` +
          `请在授予其主对象的权限集中同时授予它。`,
    'zh-Hant': (p) =>
      p.master
        ? `沒有任何權限集授予對「${p.object}」（「${p.master}」的明細物件）的存取權限，因此除管理員外的所有使用者都會被拒絕。` +
          `請在授予「${p.master}」的權限集中一併授予它。`
        : `沒有任何權限集授予對明細物件「${p.object}」的存取權限，因此除管理員外的所有使用者都會被拒絕。` +
          `請在授予其主物件的權限集中一併授予它。`,
    es: (p) =>
      p.master
        ? `Ningún conjunto de permisos concede acceso a "${p.object}", un detalle de "${p.master}", así que se ` +
          `deniega a todos excepto a los administradores. Concédalo en los conjuntos de permisos que conceden ` +
          `"${p.master}".`
        : `Ningún conjunto de permisos concede acceso al objeto de detalle "${p.object}", así que se deniega a ` +
          `todos excepto a los administradores. Concédalo en los conjuntos de permisos que conceden su objeto principal.`,
    ar: (p) =>
      p.master
        ? `لا تمنح أي مجموعة أذونات حق الوصول إلى "${p.object}"، وهو كائن تفاصيل للكائن "${p.master}"، لذا يُرفض ` +
          `وصول الجميع باستثناء المسؤولين. امنح الوصول إليه في مجموعات الأذونات التي تمنح "${p.master}".`
        : `لا تمنح أي مجموعة أذونات حق الوصول إلى كائن التفاصيل "${p.object}"، لذا يُرفض وصول الجميع باستثناء ` +
          `المسؤولين. امنح الوصول إليه في مجموعات الأذونات التي تمنح الكائن الرئيسي له.`,
    fr: (p) =>
      p.master
        ? `Aucun ensemble d’autorisations n’accorde l’accès à « ${p.object} », un détail de « ${p.master} » : il ` +
          `est donc refusé à tous sauf aux administrateurs. Accordez-le dans les ensembles d’autorisations qui ` +
          `accordent « ${p.master} ».`
        : `Aucun ensemble d’autorisations n’accorde l’accès à l’objet de détail « ${p.object} » : il est donc ` +
          `refusé à tous sauf aux administrateurs. Accordez-le dans les ensembles d’autorisations qui accordent son ` +
          `objet principal.`,
    'pt-BR': (p) =>
      p.master
        ? `Nenhum conjunto de permissões concede acesso a "${p.object}", um detalhe de "${p.master}", então ele é ` +
          `negado a todos, exceto administradores. Conceda-o nos conjuntos de permissões que concedem "${p.master}".`
        : `Nenhum conjunto de permissões concede acesso ao objeto de detalhe "${p.object}", então ele é negado a ` +
          `todos, exceto administradores. Conceda-o nos conjuntos de permissões que concedem seu objeto mestre.`,
    ru: (p) =>
      p.master
        ? `Ни один набор разрешений не даёт доступа к «${p.object}» (подчинённому объекту «${p.master}»), поэтому ` +
          `всем, кроме администраторов, в доступе отказано. Предоставьте доступ в тех наборах разрешений, которые ` +
          `дают доступ к «${p.master}».`
        : `Ни один набор разрешений не даёт доступа к подчинённому объекту «${p.object}», поэтому всем, кроме ` +
          `администраторов, в доступе отказано. Предоставьте доступ в тех наборах разрешений, которые дают доступ к ` +
          `его главному объекту.`,
    de: (p) =>
      p.master
        ? `Kein Berechtigungssatz gewährt Zugriff auf „${p.object}“, ein Detail von „${p.master}“, daher wird er ` +
          `allen außer Administratoren verweigert. Gewähren Sie ihn in den Berechtigungssätzen, die „${p.master}“ ` +
          `gewähren.`
        : `Kein Berechtigungssatz gewährt Zugriff auf das Detailobjekt „${p.object}“, daher wird er allen außer ` +
          `Administratoren verweigert. Gewähren Sie ihn in den Berechtigungssätzen, die sein Masterobjekt gewähren.`,
    ja: (p) =>
      p.master
        ? `「${p.object}」（「${p.master}」の詳細オブジェクト）へのアクセスを付与している権限セットがないため、` +
          `管理者以外のユーザーはアクセスを拒否されます。「${p.master}」を付与している権限セットで、このオブジェクトも付与してください。`
        : `詳細オブジェクト「${p.object}」へのアクセスを付与している権限セットがないため、管理者以外のユーザーは` +
          `アクセスを拒否されます。マスターオブジェクトを付与している権限セットで、このオブジェクトも付与してください。`,
    ko: (p) =>
      p.master
        ? `"${p.object}"("${p.master}"의 세부 개체)에 대한 액세스를 부여하는 권한 집합이 없어 관리자를 제외한 모든 ` +
          `사용자가 거부됩니다. "${p.master}"을(를) 부여하는 권한 집합에서 이 개체도 부여하세요.`
        : `세부 개체 "${p.object}"에 대한 액세스를 부여하는 권한 집합이 없어 관리자를 제외한 모든 사용자가 ` +
          `거부됩니다. 마스터 개체를 부여하는 권한 집합에서 이 개체도 부여하세요.`,
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
      `문서 북 "${p.book}"은(는) 권한 집합 "${p.permissionSet}"(으)로 제한되어 있지만 이 권한 집합이 정의되어 있지 ` +
      `않아 아무도 이 북을 열 수 없습니다. 기존 권한 집합으로 제한하거나, "${p.permissionSet}"을(를) 설치된 다른 ` +
      `패키지가 제공한다면 이 메시지를 무시하세요.`,
  },
  [SECURITY_SUPERUSER_FIELD_MASK_INERT]: {
    en: (p) => {
      const b = bypassLabel('en', p);
      return fieldMaskSentence(p, {
        read:
          `In permission set "${p.permissionSet}", hiding field "${p.field}" has no effect: the set's ${b} on ` +
          `"${p.object}" lets all its holders read every field of that object. Remove ${b} and grant record ` +
          `access with a read or write scope, or let the set read the field if that access is meant.`,
        edit:
          `In permission set "${p.permissionSet}", making field "${p.field}" read-only has no effect: the set's ` +
          `${b} on "${p.object}" lets all its holders edit every field of that object. Remove ${b} and grant ` +
          `record access with a read or write scope, or delete the field restriction if that access is meant.`,
        both:
          `In permission set "${p.permissionSet}", hiding field "${p.field}" and making it read-only have no ` +
          `effect: the set's ${b} on "${p.object}" lets all its holders read and edit every field of that object. ` +
          `Remove ${b} and grant record access with a read or write scope, or delete the field restriction if ` +
          `that access is meant.`,
      });
    },
    'zh-Hans': (p) => {
      const b = bypassLabel('zh-Hans', p);
      return fieldMaskSentence(p, {
        read:
          `在权限集“${p.permissionSet}”中，隐藏字段“${p.field}”不起作用：该权限集对“${p.object}”拥有“${b}”，` +
          `所有持有者都能读取该对象的每个字段。请移除“${b}”并改用读取或写入范围授予记录访问权限；` +
          `如果本就打算让他们看到该字段，请允许该权限集读取它。`,
        edit:
          `在权限集“${p.permissionSet}”中，将字段“${p.field}”设为只读不起作用：该权限集对“${p.object}”拥有“${b}”，` +
          `所有持有者都能编辑该对象的每个字段。请移除“${b}”并改用读取或写入范围授予记录访问权限；` +
          `如果本就打算允许这种访问，请删除这条字段限制。`,
        both:
          `在权限集“${p.permissionSet}”中，隐藏字段“${p.field}”并将其设为只读都不起作用：该权限集对“${p.object}”` +
          `拥有“${b}”，所有持有者都能读取和编辑该对象的每个字段。请移除“${b}”并改用读取或写入范围授予记录访问权限；` +
          `如果本就打算允许这种访问，请删除这条字段限制。`,
      });
    },
    'zh-Hant': (p) => {
      const b = bypassLabel('zh-Hant', p);
      return fieldMaskSentence(p, {
        read:
          `在權限集「${p.permissionSet}」中，隱藏欄位「${p.field}」不起作用：該權限集對「${p.object}」擁有「${b}」，` +
          `所有持有者都能讀取該物件的每個欄位。請移除「${b}」並改用讀取或寫入範圍授予記錄存取權限；` +
          `如果本就打算讓他們看到該欄位，請允許該權限集讀取它。`,
        edit:
          `在權限集「${p.permissionSet}」中，將欄位「${p.field}」設為只讀不起作用：該權限集對「${p.object}」擁有「${b}」，` +
          `所有持有者都能編輯該物件的每個欄位。請移除「${b}」並改用讀取或寫入範圍授予記錄存取權限；` +
          `如果本就打算允許這種存取，請刪除這條欄位限制。`,
        both:
          `在權限集「${p.permissionSet}」中，隱藏欄位「${p.field}」並將其設為只讀都不起作用：該權限集對「${p.object}」` +
          `擁有「${b}」，所有持有者都能讀取和編輯該物件的每個欄位。請移除「${b}」並改用讀取或寫入範圍授予記錄存取權限；` +
          `如果本就打算允許這種存取，請刪除這條欄位限制。`,
      });
    },
    es: (p) => {
      const b = bypassLabel('es', p);
      return fieldMaskSentence(p, {
        read:
          `En el conjunto de permisos "${p.permissionSet}", ocultar el campo "${p.field}" no tiene efecto: el ` +
          `permiso "${b}" del conjunto sobre "${p.object}" permite a todos sus titulares leer todos los campos de ` +
          `ese objeto. Quite "${b}" y conceda el acceso a los registros con un ámbito de lectura o escritura, o ` +
          `permita que el conjunto lea el campo si ese acceso es intencionado.`,
        edit:
          `En el conjunto de permisos "${p.permissionSet}", dejar el campo "${p.field}" en solo lectura no tiene ` +
          `efecto: el permiso "${b}" del conjunto sobre "${p.object}" permite a todos sus titulares editar todos ` +
          `los campos de ese objeto. Quite "${b}" y conceda el acceso a los registros con un ámbito de lectura o ` +
          `escritura, o elimine la restricción del campo si ese acceso es intencionado.`,
        both:
          `En el conjunto de permisos "${p.permissionSet}", ocultar el campo "${p.field}" y dejarlo en solo lectura ` +
          `no tiene efecto: el permiso "${b}" del conjunto sobre "${p.object}" permite a todos sus titulares leer y ` +
          `editar todos los campos de ese objeto. Quite "${b}" y conceda el acceso a los registros con un ámbito de ` +
          `lectura o escritura, o elimine la restricción del campo si ese acceso es intencionado.`,
      });
    },
    ar: (p) => {
      const b = bypassLabel('ar', p);
      return fieldMaskSentence(p, {
        read:
          `في مجموعة الأذونات "${p.permissionSet}"، لا يكون لإخفاء الحقل "${p.field}" أي أثر: إذن "${b}" الذي ` +
          `تملكه المجموعة على "${p.object}" يتيح لجميع حامليها قراءة كل حقول هذا الكائن. أزل "${b}" وامنح الوصول ` +
          `إلى السجلات عبر نطاق قراءة أو كتابة، أو اسمح للمجموعة بقراءة الحقل إذا كان هذا الوصول مقصودًا.`,
        edit:
          `في مجموعة الأذونات "${p.permissionSet}"، لا يكون لجعل الحقل "${p.field}" للقراءة فقط أي أثر: إذن "${b}" ` +
          `الذي تملكه المجموعة على "${p.object}" يتيح لجميع حامليها تعديل كل حقول هذا الكائن. أزل "${b}" وامنح ` +
          `الوصول إلى السجلات عبر نطاق قراءة أو كتابة، أو احذف تقييد الحقل إذا كان هذا الوصول مقصودًا.`,
        both:
          `في مجموعة الأذونات "${p.permissionSet}"، لا يكون لإخفاء الحقل "${p.field}" وجعله للقراءة فقط أي أثر: ` +
          `إذن "${b}" الذي تملكه المجموعة على "${p.object}" يتيح لجميع حامليها قراءة كل حقول هذا الكائن وتعديلها. ` +
          `أزل "${b}" وامنح الوصول إلى السجلات عبر نطاق قراءة أو كتابة، أو احذف تقييد الحقل إذا كان هذا الوصول مقصودًا.`,
      });
    },
    fr: (p) => {
      const b = bypassLabel('fr', p);
      return fieldMaskSentence(p, {
        read:
          `Dans l’ensemble d’autorisations « ${p.permissionSet} », masquer le champ « ${p.field} » n’a aucun effet : ` +
          `l’autorisation « ${b} » de l’ensemble sur « ${p.object} » permet à tous ses détenteurs de lire tous les ` +
          `champs de cet objet. Retirez « ${b} » et accordez l’accès aux enregistrements avec une portée de lecture ` +
          `ou d’écriture, ou autorisez l’ensemble à lire le champ si cet accès est voulu.`,
        edit:
          `Dans l’ensemble d’autorisations « ${p.permissionSet} », mettre le champ « ${p.field} » en lecture seule ` +
          `n’a aucun effet : l’autorisation « ${b} » de l’ensemble sur « ${p.object} » permet à tous ses détenteurs ` +
          `de modifier tous les champs de cet objet. Retirez « ${b} » et accordez l’accès aux enregistrements avec ` +
          `une portée de lecture ou d’écriture, ou supprimez la restriction du champ si cet accès est voulu.`,
        both:
          `Dans l’ensemble d’autorisations « ${p.permissionSet} », masquer le champ « ${p.field} » et le mettre en ` +
          `lecture seule n’a aucun effet : l’autorisation « ${b} » de l’ensemble sur « ${p.object} » permet à tous ` +
          `ses détenteurs de lire et de modifier tous les champs de cet objet. Retirez « ${b} » et accordez l’accès ` +
          `aux enregistrements avec une portée de lecture ou d’écriture, ou supprimez la restriction du champ si cet ` +
          `accès est voulu.`,
      });
    },
    'pt-BR': (p) => {
      const b = bypassLabel('pt-BR', p);
      return fieldMaskSentence(p, {
        read:
          `No conjunto de permissões "${p.permissionSet}", ocultar o campo "${p.field}" não tem efeito: a permissão ` +
          `"${b}" do conjunto em "${p.object}" permite que todos os seus titulares leiam todos os campos desse ` +
          `objeto. Remova "${b}" e conceda o acesso aos registros com um escopo de leitura ou gravação, ou permita ` +
          `que o conjunto leia o campo se esse acesso for intencional.`,
        edit:
          `No conjunto de permissões "${p.permissionSet}", deixar o campo "${p.field}" como somente leitura não tem ` +
          `efeito: a permissão "${b}" do conjunto em "${p.object}" permite que todos os seus titulares editem todos os ` +
          `campos desse objeto. Remova "${b}" e conceda o acesso aos registros com um escopo de leitura ou ` +
          `gravação, ou exclua a restrição do campo se esse acesso for intencional.`,
        both:
          `No conjunto de permissões "${p.permissionSet}", ocultar o campo "${p.field}" e deixá-lo como somente ` +
          `leitura não tem efeito: a permissão "${b}" do conjunto em "${p.object}" permite que todos os seus ` +
          `titulares leiam e editem todos os campos desse objeto. Remova "${b}" e conceda o acesso aos registros ` +
          `com um escopo de leitura ou gravação, ou exclua a restrição do campo se esse acesso for intencional.`,
      });
    },
    ru: (p) => {
      const b = bypassLabel('ru', p);
      return fieldMaskSentence(p, {
        read:
          `В наборе разрешений «${p.permissionSet}» скрытие поля «${p.field}» не действует: право «${b}» этого ` +
          `набора для «${p.object}» позволяет всем его владельцам читать все поля этого объекта. Уберите «${b}» и ` +
          `предоставьте доступ к записям через область чтения или записи либо разрешите набору читать это поле, ` +
          `если такой доступ задуман.`,
        edit:
          `В наборе разрешений «${p.permissionSet}» режим «только чтение» для поля «${p.field}» не действует: право ` +
          `«${b}» этого набора для «${p.object}» позволяет всем его владельцам изменять все поля этого объекта. ` +
          `Уберите «${b}» и предоставьте доступ к записям через область чтения или записи либо удалите ограничение ` +
          `поля, если такой доступ задуман.`,
        both:
          `В наборе разрешений «${p.permissionSet}» скрытие поля «${p.field}» и режим «только чтение» для него не ` +
          `действуют: право «${b}» этого набора для «${p.object}» позволяет всем его владельцам читать и изменять ` +
          `все поля этого объекта. Уберите «${b}» и предоставьте доступ к записям через область чтения или записи ` +
          `либо удалите ограничение поля, если такой доступ задуман.`,
      });
    },
    de: (p) => {
      const b = bypassLabel('de', p);
      return fieldMaskSentence(p, {
        read:
          `Im Berechtigungssatz „${p.permissionSet}“ ist das Ausblenden des Felds „${p.field}“ wirkungslos: Die ` +
          `Berechtigung „${b}“ des Satzes für „${p.object}“ lässt alle Inhaber jedes Feld dieses Objekts lesen. ` +
          `Entfernen Sie „${b}“ und gewähren Sie den Zugriff auf Datensätze über einen Lese- oder Schreibbereich, ` +
          `oder erlauben Sie dem Satz, das Feld zu lesen, wenn dieser Zugriff beabsichtigt ist.`,
        edit:
          `Im Berechtigungssatz „${p.permissionSet}“ ist der Schreibschutz des Felds „${p.field}“ wirkungslos: Die ` +
          `Berechtigung „${b}“ des Satzes für „${p.object}“ lässt alle Inhaber jedes Feld dieses Objekts ` +
          `bearbeiten. Entfernen Sie „${b}“ und gewähren Sie den Zugriff auf Datensätze über einen Lese- oder ` +
          `Schreibbereich, oder löschen Sie die Feldeinschränkung, wenn dieser Zugriff beabsichtigt ist.`,
        both:
          `Im Berechtigungssatz „${p.permissionSet}“ sind das Ausblenden des Felds „${p.field}“ und sein ` +
          `Schreibschutz wirkungslos: Die Berechtigung „${b}“ des Satzes für „${p.object}“ lässt alle Inhaber jedes ` +
          `Feld dieses Objekts lesen und bearbeiten. Entfernen Sie „${b}“ und gewähren Sie den Zugriff auf ` +
          `Datensätze über einen Lese- oder Schreibbereich, oder löschen Sie die Feldeinschränkung, wenn dieser ` +
          `Zugriff beabsichtigt ist.`,
      });
    },
    ja: (p) => {
      const b = bypassLabel('ja', p);
      return fieldMaskSentence(p, {
        read:
          `権限セット「${p.permissionSet}」では、項目「${p.field}」を非表示にする設定が効いていません。この権限セットは` +
          `「${p.object}」に「${b}」を持っており、すべての保持者がこのオブジェクトのすべての項目を参照できるためです。` +
          `「${b}」を外して参照範囲または書き込み範囲でレコードへのアクセスを付与するか、このアクセスが意図したもので` +
          `あれば、この権限セットにこの項目の参照を許可してください。`,
        edit:
          `権限セット「${p.permissionSet}」では、項目「${p.field}」を読み取り専用にする設定が効いていません。この権限` +
          `セットは「${p.object}」に「${b}」を持っており、すべての保持者がこのオブジェクトのすべての項目を編集できる` +
          `ためです。「${b}」を外して参照範囲または書き込み範囲でレコードへのアクセスを付与するか、このアクセスが` +
          `意図したものであれば、この項目の制限を削除してください。`,
        both:
          `権限セット「${p.permissionSet}」では、項目「${p.field}」を非表示かつ読み取り専用にする設定が効いていません。` +
          `この権限セットは「${p.object}」に「${b}」を持っており、すべての保持者がこのオブジェクトのすべての項目を` +
          `参照・編集できるためです。「${b}」を外して参照範囲または書き込み範囲でレコードへのアクセスを付与するか、` +
          `このアクセスが意図したものであれば、この項目の制限を削除してください。`,
      });
    },
    ko: (p) => {
      const b = bypassLabel('ko', p);
      return fieldMaskSentence(p, {
        read:
          `권한 집합 "${p.permissionSet}"에서 필드 "${p.field}"을(를) 숨기는 설정은 효과가 없습니다. 이 권한 집합은 ` +
          `"${p.object}"에 대해 "${b}" 권한을 가지므로 모든 보유자가 이 개체의 모든 필드를 읽을 수 있습니다. ` +
          `"${b}"을(를) 제거하고 읽기 또는 쓰기 범위로 레코드 액세스를 부여하거나, 이 액세스가 의도된 것이라면 ` +
          `권한 집합이 이 필드를 읽을 수 있도록 하세요.`,
        edit:
          `권한 집합 "${p.permissionSet}"에서 필드 "${p.field}"을(를) 읽기 전용으로 하는 설정은 효과가 없습니다. ` +
          `이 권한 집합은 "${p.object}"에 대해 "${b}" 권한을 가지므로 모든 보유자가 이 개체의 모든 필드를 편집할 수 ` +
          `있습니다. "${b}"을(를) 제거하고 읽기 또는 쓰기 범위로 레코드 액세스를 부여하거나, 이 액세스가 의도된 ` +
          `것이라면 이 필드 제한을 삭제하세요.`,
        both:
          `권한 집합 "${p.permissionSet}"에서 필드 "${p.field}"을(를) 숨기고 읽기 전용으로 하는 설정은 효과가 ` +
          `없습니다. 이 권한 집합은 "${p.object}"에 대해 "${b}" 권한을 가지므로 모든 보유자가 이 개체의 모든 필드를 ` +
          `읽고 편집할 수 있습니다. "${b}"을(를) 제거하고 읽기 또는 쓰기 범위로 레코드 액세스를 부여하거나, 이 ` +
          `액세스가 의도된 것이라면 이 필드 제한을 삭제하세요.`,
      });
    },
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
      `تُخفي مجموعة الأذونات "${p.permissionSet}" الحقل "${p.field}"، وهو الرابط إلى السجل الرئيسي. لا يزال هذا ` +
      `الرابط يحدد ما إذا كان بإمكان حامليها تعديل السجل، ولا يُبلَّغ من يُرفض طلبه بالسجل الرئيسي الذي يتطلبه ` +
      `التعديل. اجعل الحقل قابلاً للقراءة، أو أبقِه مخفياً إذا كان الرفض العام مقصوداً.`,
    fr: (p) =>
      `L’ensemble d’autorisations « ${p.permissionSet} » masque le champ « ${p.field} », le lien vers ` +
      `l’enregistrement principal. Ce lien décide toujours si ses détenteurs peuvent modifier l’enregistrement, et ` +
      `un détenteur refusé n’apprend pas quel enregistrement principal la modification exige. Rendez le champ ` +
      `lisible, ou laissez-le masqué si un refus générique est voulu.`,
    'pt-BR': (p) =>
      `O conjunto de permissões "${p.permissionSet}" oculta o campo "${p.field}", o vínculo com o registro mestre. ` +
      `Esse vínculo ainda decide se os titulares podem alterar o registro, e quem for recusado não fica sabendo ` +
      `qual registro mestre a alteração exige. Torne o campo legível ou mantenha-o oculto se uma recusa genérica ` +
      `for intencional.`,
    ru: (p) =>
      `Набор разрешений «${p.permissionSet}» скрывает поле «${p.field}» — ссылку на главную запись. Эта ссылка ` +
      `по-прежнему определяет, могут ли владельцы набора изменять запись, а получивший отказ не узнает, какая ` +
      `главная запись нужна для изменения. Сделайте поле доступным для чтения или оставьте его скрытым, если ` +
      `задуман общий отказ.`,
    de: (p) =>
      `Der Berechtigungssatz „${p.permissionSet}“ blendet das Feld „${p.field}“ aus, die Verknüpfung zum ` +
      `Masterdatensatz. Diese Verknüpfung entscheidet weiterhin, ob die Inhaber den Datensatz ändern dürfen, und ` +
      `ein abgewiesener Inhaber erfährt nicht, welchen Masterdatensatz die Änderung erfordert. Machen Sie das Feld ` +
      `lesbar oder lassen Sie es ausgeblendet, wenn eine allgemeine Ablehnung beabsichtigt ist.`,
    ja: (p) =>
      `権限セット「${p.permissionSet}」は、マスターレコードへの参照である項目「${p.field}」を非表示にしています。` +
      `この項目は保持者がレコードを変更できるかどうかを引き続き決定しており、拒否された保持者には、変更に必要な` +
      `マスターレコードが伝えられません。項目を参照可能にするか、一般的な拒否メッセージで構わない場合は非表示のままにしてください。`,
    ko: (p) =>
      `권한 집합 "${p.permissionSet}"은(는) 마스터 레코드에 대한 연결인 필드 "${p.field}"을(를) 숨깁니다. 이 필드는 ` +
      `여전히 보유자가 레코드를 변경할 수 있는지를 결정하며, 거부된 보유자는 변경에 필요한 마스터 레코드가 무엇인지 ` +
      `안내받지 못합니다. 필드를 읽을 수 있게 하거나, 일반적인 거부 메시지를 의도했다면 숨긴 상태로 두세요.`,
  },
  [SECURITY_UPDATE_POLICY_NO_CHECK]: {
    en: (p) =>
      `Policy "${p.policy}" in permission set "${p.permissionSet}" sets no check condition, so an update may also ` +
      `save rows that the default ownership rule allows. Add a check condition to limit what an update may write.`,
    'zh-Hans': (p) =>
      `权限集“${p.permissionSet}”中的策略“${p.policy}”没有设置检查条件，因此更新时也可能写入默认所有权规则所允许的行。` +
      `请添加检查条件，以限制更新可以写入的内容。`,
    'zh-Hant': (p) =>
      `權限集「${p.permissionSet}」中的策略「${p.policy}」沒有設定檢查條件，因此更新時也可能寫入預設擁有權規則所允許的資料列。` +
      `請新增檢查條件，以限制更新可以寫入的內容。`,
    es: (p) =>
      `La política "${p.policy}" del conjunto de permisos "${p.permissionSet}" no define ninguna condición de ` +
      `comprobación, así que una actualización también puede guardar filas que la regla de propiedad ` +
      `predeterminada permite. Añada una condición de comprobación para limitar lo que puede escribir una actualización.`,
    ar: (p) =>
      `لا تحدد السياسة "${p.policy}" في مجموعة الأذونات "${p.permissionSet}" أي شرط تحقق، لذا قد يحفظ التحديث ` +
      `أيضاً صفوفاً تسمح بها قاعدة الملكية الافتراضية. أضف شرط تحقق لتقييد ما يمكن أن يكتبه التحديث.`,
    fr: (p) =>
      `La politique « ${p.policy} » de l’ensemble d’autorisations « ${p.permissionSet} » ne définit aucune ` +
      `condition de vérification : une mise à jour peut donc aussi enregistrer des lignes que la règle de propriété ` +
      `par défaut autorise. Ajoutez une condition de vérification pour limiter ce qu’une mise à jour peut écrire.`,
    'pt-BR': (p) =>
      `A política "${p.policy}" do conjunto de permissões "${p.permissionSet}" não define condição de verificação, ` +
      `então uma atualização também pode gravar linhas que a regra de propriedade padrão permite. Adicione uma ` +
      `condição de verificação para limitar o que uma atualização pode gravar.`,
    ru: (p) =>
      `Политика «${p.policy}» в наборе разрешений «${p.permissionSet}» не задаёт условия проверки, поэтому ` +
      `обновление может сохранить и строки, которые допускает правило владения по умолчанию. Добавьте условие ` +
      `проверки, чтобы ограничить то, что может записать обновление.`,
    de: (p) =>
      `Die Richtlinie „${p.policy}“ im Berechtigungssatz „${p.permissionSet}“ legt keine Prüfbedingung fest, daher ` +
      `kann eine Aktualisierung auch Zeilen speichern, die die Standard-Besitzregel zulässt. Fügen Sie eine ` +
      `Prüfbedingung hinzu, um zu begrenzen, was eine Aktualisierung schreiben darf.`,
    ja: (p) =>
      `権限セット「${p.permissionSet}」のポリシー「${p.policy}」にはチェック条件がないため、更新時に既定の所有権ルールが` +
      `許可する行も書き込まれる可能性があります。チェック条件を追加して、更新で書き込める内容を制限してください。`,
    ko: (p) =>
      `권한 집합 "${p.permissionSet}"의 정책 "${p.policy}"에는 검사 조건이 없어, 업데이트가 기본 소유권 규칙이 ` +
      `허용하는 행까지 저장할 수 있습니다. 검사 조건을 추가해 업데이트가 쓸 수 있는 내용을 제한하세요.`,
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
        'allow-owner-edit': `请在“${p.object}”的共享设置中允许记录所有者编辑，或删除该策略。`,
        'key-owner-id': '请让该策略以记录所有者（owner_id）为条件——这是主记录检查唯一比对的用户——或删除该策略。',
        'add-owner-id': `请为“${p.object}”添加记录所有者（owner_id）并让该策略以它为条件，或删除该策略。`,
      }),
    'zh-Hant': (p) =>
      `權限集「${p.permissionSet}」中的更新策略「${p.policy}」永遠無法讓它所指的使用者單獨取得「${p.object}」的編輯權限：` +
      `「${p.object}」的編輯權限來自其主記錄，因此該策略只能縮小可編輯的人員範圍。` +
      ownerPolicyRemedy(p, {
        'allow-owner-edit': `請在「${p.object}」的共用設定中允許記錄擁有者編輯，或刪除該策略。`,
        'key-owner-id': '請讓該策略以記錄擁有者（owner_id）為條件——這是主記錄檢查唯一比對的使用者——或刪除該策略。',
        'add-owner-id': `請為「${p.object}」新增記錄擁有者（owner_id）並讓該策略以它為條件，或刪除該策略。`,
      }),
    es: (p) =>
      `La política de actualización "${p.policy}" del conjunto de permisos "${p.permissionSet}" nunca permite por ` +
      `sí sola que el usuario que nombra edite "${p.object}": "${p.object}" recibe su acceso de edición de su ` +
      `registro principal, así que la política solo puede restringir quién puede editarlo. ` +
      ownerPolicyRemedy(p, {
        'allow-owner-edit':
          `Permita que los propietarios del registro editen "${p.object}" en su configuración de uso compartido, ` +
          'o elimine la política.',
        'key-owner-id':
          'Base la política en el propietario del registro (owner_id), el único usuario que compara la ' +
          'comprobación del registro principal, o elimine la política.',
        'add-owner-id':
          `Dé a "${p.object}" un propietario de registro (owner_id) y base la política en él, o elimine la política.`,
      }),
    ar: (p) =>
      `لا تسمح سياسة التحديث "${p.policy}" في مجموعة الأذونات "${p.permissionSet}" بمفردها أبداً للمستخدم الذي ` +
      `تحدده بتعديل "${p.object}": إذ يُستمد حق تعديل "${p.object}" من سجله الرئيسي، لذا لا يمكن للسياسة إلا ` +
      `تضييق نطاق من يمكنهم تعديله. ` +
      ownerPolicyRemedy(p, {
        'allow-owner-edit': `اسمح لمالكي السجلات بتعديل "${p.object}" في إعدادات المشاركة الخاصة به، أو احذف السياسة.`,
        'key-owner-id':
          'اربط السياسة بمالك السجل (owner_id)، وهو المستخدم الوحيد الذي يقارنه تحقق السجل الرئيسي، أو احذف السياسة.',
        'add-owner-id': `أضف مالك سجل (owner_id) إلى "${p.object}" واربط السياسة به، أو احذف السياسة.`,
      }),
    fr: (p) =>
      `La politique de mise à jour « ${p.policy} » de l’ensemble d’autorisations « ${p.permissionSet} » ne permet ` +
      `jamais à elle seule à l’utilisateur qu’elle désigne de modifier « ${p.object} » : « ${p.object} » tient son ` +
      `accès en modification de son enregistrement principal, donc la politique ne peut que restreindre qui peut le ` +
      `modifier. ` +
      ownerPolicyRemedy(p, {
        'allow-owner-edit':
          `Autorisez les propriétaires d’enregistrement à modifier « ${p.object} » dans ses paramètres de partage, ` +
          'ou supprimez la politique.',
        'key-owner-id':
          'Fondez la politique sur le propriétaire de l’enregistrement (owner_id), le seul utilisateur que compare ' +
          'la vérification de l’enregistrement principal, ou supprimez la politique.',
        'add-owner-id':
          `Donnez à « ${p.object} » un propriétaire d’enregistrement (owner_id) et fondez la politique dessus, ou ` +
          'supprimez la politique.',
      }),
    'pt-BR': (p) =>
      `A política de atualização "${p.policy}" do conjunto de permissões "${p.permissionSet}" nunca permite, ` +
      `sozinha, que o usuário que ela indica edite "${p.object}": "${p.object}" recebe o acesso de edição do seu ` +
      `registro mestre, então a política só pode restringir quem pode editá-lo. ` +
      ownerPolicyRemedy(p, {
        'allow-owner-edit':
          `Permita que os proprietários do registro editem "${p.object}" nas configurações de compartilhamento ` +
          'dele ou remova a política.',
        'key-owner-id':
          'Baseie a política no proprietário do registro (owner_id), o único usuário que a verificação do registro ' +
          'mestre compara, ou remova a política.',
        'add-owner-id':
          `Dê a "${p.object}" um proprietário de registro (owner_id) e baseie a política nele, ou remova a política.`,
      }),
    ru: (p) =>
      `Политика обновления «${p.policy}» в наборе разрешений «${p.permissionSet}» сама по себе никогда не ` +
      `позволяет указанному в ней пользователю редактировать «${p.object}»: право на редактирование «${p.object}» ` +
      `определяется его главной записью, поэтому политика может только сузить круг тех, кто может его редактировать. ` +
      ownerPolicyRemedy(p, {
        'allow-owner-edit':
          `Разрешите владельцам записей редактировать «${p.object}» в его настройках общего доступа или удалите политику.`,
        'key-owner-id':
          'Привяжите политику к владельцу записи (owner_id) — единственному пользователю, которого сравнивает ' +
          'проверка главной записи, — или удалите политику.',
        'add-owner-id':
          `Добавьте объекту «${p.object}» владельца записи (owner_id) и привяжите к нему политику или удалите политику.`,
      }),
    de: (p) =>
      `Die Aktualisierungsrichtlinie „${p.policy}“ im Berechtigungssatz „${p.permissionSet}“ erlaubt dem ` +
      `Benutzer, den sie nennt, allein nie, „${p.object}“ zu bearbeiten: „${p.object}“ erhält seinen ` +
      `Bearbeitungszugriff vom Masterdatensatz, daher kann die Richtlinie nur einschränken, wer es bearbeiten darf. ` +
      ownerPolicyRemedy(p, {
        'allow-owner-edit':
          `Erlauben Sie in den Freigabeeinstellungen von „${p.object}“ den Datensatzbesitzern das Bearbeiten, oder ` +
          'entfernen Sie die Richtlinie.',
        'key-owner-id':
          'Knüpfen Sie die Richtlinie an den Datensatzbesitzer (owner_id), den einzigen Benutzer, den die ' +
          'Master-Prüfung vergleicht, oder entfernen Sie die Richtlinie.',
        'add-owner-id':
          `Geben Sie „${p.object}“ einen Datensatzbesitzer (owner_id) und knüpfen Sie die Richtlinie daran, oder ` +
          'entfernen Sie die Richtlinie.',
      }),
    ja: (p) =>
      `権限セット「${p.permissionSet}」の更新ポリシー「${p.policy}」だけでは、対象のユーザーが「${p.object}」を` +
      `編集できるようにはなりません。「${p.object}」の編集権限はマスターレコードから決まるため、このポリシーは` +
      `編集できるユーザーを絞り込むことしかできません。` +
      ownerPolicyRemedy(p, {
        'allow-owner-edit': `「${p.object}」の共有設定でレコード所有者による編集を許可するか、このポリシーを削除してください。`,
        'key-owner-id':
          'ポリシーの条件をレコード所有者（owner_id）にするか（マスターのチェックが比較する唯一のユーザーです）、' +
          'このポリシーを削除してください。',
        'add-owner-id':
          `「${p.object}」にレコード所有者（owner_id）を追加してポリシーの条件にするか、このポリシーを削除してください。`,
      }),
    ko: (p) =>
      `권한 집합 "${p.permissionSet}"의 업데이트 정책 "${p.policy}"만으로는 해당 사용자가 "${p.object}"을(를) ` +
      `편집할 수 없습니다. "${p.object}"의 편집 권한은 마스터 레코드에서 결정되므로, 이 정책은 편집할 수 있는 ` +
      `사용자를 좁힐 수만 있습니다. ` +
      ownerPolicyRemedy(p, {
        'allow-owner-edit': `"${p.object}"의 공유 설정에서 레코드 소유자의 편집을 허용하거나, 이 정책을 삭제하세요.`,
        'key-owner-id':
          '정책 조건을 레코드 소유자(owner_id)로 지정하거나(마스터 검사가 비교하는 유일한 사용자입니다), 이 정책을 삭제하세요.',
        'add-owner-id':
          `"${p.object}"에 레코드 소유자(owner_id)를 추가하고 정책 조건으로 지정하거나, 이 정책을 삭제하세요.`,
      }),
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

/**
 * The sentence of `security-superuser-field-mask-inert`, by the `inert` param
 * its push site sets: the half of the field restriction the set's bypass
 * unbinds. Beside View All only the read mask is inert (`read`) and the edit
 * lock still binds, so that sentence never calls the whole restriction
 * ineffective nor prescribes deleting it; beside Modify All the edit lock is
 * inert (`edit`), or both halves are (`both`). An `inert` the push site did not
 * set is read from `bypass`: View All can only unbind the read mask.
 */
type FieldMaskInert = 'read' | 'edit' | 'both';

function fieldMaskSentence(p: UserTextParams, sentences: Readonly<Record<FieldMaskInert, string>>): string {
  if (p.inert === 'read' || p.inert === 'edit' || p.inert === 'both') return sentences[p.inert];
  return p.bypass === 'modify' ? sentences.both : sentences.read;
}
