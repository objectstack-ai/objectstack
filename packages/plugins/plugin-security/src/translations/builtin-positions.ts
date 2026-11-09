// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Translations of the built-in positions' labels and descriptions — the
 * `positions.<name>.label` / `.description` group of the translation bundle,
 * which `translatePosition` overlays on every served `position` document
 * (`GET /meta/position`, the list Setup → Positions shows).
 *
 * HAND-AUTHORED, not generated, for the reason `permission-sets.ts` gives: this
 * package's extract runs objects-only, so `os i18n extract` writes no
 * `positions` group here. The English source is each declaration in
 * `../builtin-positions.ts` (the identity names' text comes from the spec's
 * `BUILTIN_IDENTITY_METADATA`, the audience anchors' from that module); `en`
 * needs no entry, because an untranslated locale serves the declaration's own
 * text. When a source label or sentence changes, re-translate its entry
 * in every locale here in the same change: nothing marks a translation stale.
 * `builtin-positions.test.ts` pins both strings per built-in position per
 * locale, and the served overlay.
 *
 * Terms follow this bundle's objects: a position is 岗位 / ポジション /
 * puesto, and the organization roles read as the member record's role options
 * do (所有者, 外部成员 …).
 */

import type { TranslationData } from '@objectstack/spec/system';

type PositionTranslations = NonNullable<TranslationData['positions']>;

export const zhCNBuiltinPositions: PositionTranslations = {
  platform_admin: {
    label: '平台管理员',
    description: '平台运维人员（SaaS 管理员），不是租户内的用户角色。',
  },
  org_owner: {
    label: '组织所有者',
    description: '租户内组织的所有者。',
  },
  org_admin: {
    label: '组织管理员',
    description: '租户内组织的管理员。',
  },
  org_member: {
    label: '组织成员',
    description: '租户内组织的成员。',
  },
  org_external: {
    label: '组织外部成员',
    description: '租户内的外部成员（门户用户）：只能看到本人的身份记录，仅通过明确授予的权限访问数据。',
  },
  everyone: {
    label: '全体成员',
    description: '内置受众锚点：每位已登录成员都隐式担任此岗位。绑定到此岗位的权限集就是租户的默认授权。高权限的权限集不能绑定到这里。',
  },
  guest: {
    label: '访客',
    description: '内置受众锚点：未登录的访问者隐式且唯一地担任此岗位。这里的绑定受最严格的检查 — 只能指定具体对象、以只读为主、绝不允许通配符。',
  },
};

export const jaJPBuiltinPositions: PositionTranslations = {
  platform_admin: {
    label: 'プラットフォーム管理者',
    description: 'プラットフォーム運用者（SaaS 管理者）。テナント内のユーザーの役割ではありません。',
  },
  org_owner: {
    label: '組織オーナー',
    description: 'テナント内の組織のオーナー。',
  },
  org_admin: {
    label: '組織管理者',
    description: 'テナント内の組織の管理者。',
  },
  org_member: {
    label: '組織メンバー',
    description: 'テナント内の組織のメンバー。',
  },
  org_external: {
    label: '組織外部メンバー',
    description: 'テナント内の外部メンバー（ポータルユーザー）：自分の ID レコードだけを参照でき、データには明示的に付与された権限でのみアクセスします。',
  },
  everyone: {
    label: '全メンバー',
    description: '組み込みの対象者アンカー：サインインしたすべてのメンバーが暗黙的にこのポジションを持ちます。ここに割り当てた権限セットがテナントの既定の付与になります。高権限のセットはここに割り当てられません。',
  },
  guest: {
    label: 'ゲスト',
    description: '組み込みの対象者アンカー：サインインしていないアクセス者だけが暗黙的にこのポジションを持ちます。ここへの割り当ては最も厳しく検査されます — 名前を指定したオブジェクトのみ、読み取り中心、ワイルドカードは不可。',
  },
};

export const esESBuiltinPositions: PositionTranslations = {
  platform_admin: {
    label: 'Administrador de la plataforma',
    description: 'Operador de la plataforma (administrador SaaS). No es un rol de usuario dentro del inquilino.',
  },
  org_owner: {
    label: 'Propietario de la organización',
    description: 'Propietario de una organización dentro de un inquilino.',
  },
  org_admin: {
    label: 'Administrador de la organización',
    description: 'Administrador de una organización dentro de un inquilino.',
  },
  org_member: {
    label: 'Miembro de la organización',
    description: 'Miembro de una organización dentro de un inquilino.',
  },
  org_external: {
    label: 'Miembro externo de la organización',
    description: 'Miembro externo dentro de un inquilino (usuario del portal): solo ve sus propios registros de identidad y accede a los datos únicamente mediante concesiones explícitas.',
  },
  everyone: {
    label: 'Todos',
    description: 'Ancla de audiencia integrada: todo miembro con sesión iniciada ocupa este puesto de forma implícita. Los conjuntos de permisos vinculados a él son las concesiones predeterminadas del inquilino. Aquí no se pueden vincular conjuntos de privilegios elevados.',
  },
  guest: {
    label: 'Invitado',
    description: 'Ancla de audiencia integrada: quienes no han iniciado sesión ocupan este puesto de forma implícita y exclusiva. Sus vínculos pasan los controles más estrictos: solo objetos con nombre, sobre todo lectura y nunca un comodín.',
  },
};

export const zhHantBuiltinPositions: PositionTranslations = {
  platform_admin: {
    label: '平台管理員',
    description: '平台維運人員（SaaS 管理員），不是租戶內的使用者角色。',
  },
  org_owner: {
    label: '組織擁有者',
    description: '租戶內組織的擁有者。',
  },
  org_admin: {
    label: '組織管理員',
    description: '租戶內組織的管理員。',
  },
  org_member: {
    label: '組織成員',
    description: '租戶內組織的成員。',
  },
  org_external: {
    label: '組織外部成員',
    description: '租戶內的外部成員（入口網站使用者）：只能看到本人的身分記錄，僅透過明確授予的權限存取資料。',
  },
  everyone: {
    label: '所有人',
    description: '內建對象錨點：每位已登入成員都隱含擔任此職位。綁定到此職位的權限集就是租戶的預設授權。高權限的權限集不能綁定到這裡。',
  },
  guest: {
    label: '訪客',
    description: '內建對象錨點：未登入的存取者隱含且唯一地擔任此職位。這裡的綁定受到最嚴格的檢查 — 只能指定具名物件、以唯讀為主、絕不允許萬用字元。',
  },
};

export const arBuiltinPositions: PositionTranslations = {
  platform_admin: {
    label: 'مسؤول المنصة',
    description: 'مشغّل المنصة (مسؤول SaaS)، وليس دور مستخدم داخل المستأجر.',
  },
  org_owner: {
    label: 'مالك المؤسسة',
    description: 'مالك مؤسسة داخل المستأجر.',
  },
  org_admin: {
    label: 'مسؤول المؤسسة',
    description: 'مسؤول مؤسسة داخل المستأجر.',
  },
  org_member: {
    label: 'عضو المؤسسة',
    description: 'عضو في مؤسسة داخل المستأجر.',
  },
  org_external: {
    label: 'عضو خارجي في المؤسسة',
    description: 'عضو خارجي داخل المستأجر (مستخدم بوابة): لا يرى إلا سجلات هويته، ولا يصل إلى البيانات إلا عبر منح صريحة.',
  },
  everyone: {
    label: 'الجميع',
    description: 'مرساة جمهور مدمجة: كل عضو مسجّل الدخول يشغل هذا المنصب ضمنيًا. مجموعات الأذونات المرتبطة به هي المنح الافتراضية للمستأجر. ولا يمكن ربط مجموعات ذات صلاحيات عالية هنا.',
  },
  guest: {
    label: 'ضيف',
    description: 'مرساة جمهور مدمجة: يشغل غير المسجّلين هذا المنصب ضمنيًا وحصريًا. تخضع الروابط هنا لأشد الفحوص — كائنات مسمّاة فقط، وقراءة في الغالب، ولا أحرف بدل أبدًا.',
  },
};

export const frBuiltinPositions: PositionTranslations = {
  platform_admin: {
    label: 'Administrateur de la plateforme',
    description: 'Opérateur de la plateforme (administrateur SaaS). Ce n’est pas un rôle d’utilisateur au sein du locataire.',
  },
  org_owner: {
    label: 'Propriétaire de l’organisation',
    description: 'Propriétaire d’une organisation au sein d’un locataire.',
  },
  org_admin: {
    label: 'Administrateur de l’organisation',
    description: 'Administrateur d’une organisation au sein d’un locataire.',
  },
  org_member: {
    label: 'Membre de l’organisation',
    description: 'Membre d’une organisation au sein d’un locataire.',
  },
  org_external: {
    label: 'Membre externe de l’organisation',
    description: 'Membre externe au sein d’un locataire (utilisateur du portail) : ne voit que ses propres enregistrements d’identité et n’accède aux données que par des octrois explicites.',
  },
  everyone: {
    label: 'Tout le monde',
    description: 'Ancre d’audience intégrée : chaque membre connecté occupe implicitement ce poste. Les ensembles d’autorisations qui y sont liés sont les octrois par défaut du locataire. Les ensembles à privilèges élevés ne peuvent pas y être liés.',
  },
  guest: {
    label: 'Invité',
    description: 'Ancre d’audience intégrée : les visiteurs non connectés occupent implicitement et exclusivement ce poste. Ses liaisons subissent les contrôles les plus stricts — objets nommés uniquement, surtout en lecture, jamais de caractère générique.',
  },
};

export const ptBRBuiltinPositions: PositionTranslations = {
  platform_admin: {
    label: 'Administrador da plataforma',
    description: 'Operador da plataforma (administrador SaaS). Não é uma função de usuário dentro do locatário.',
  },
  org_owner: {
    label: 'Proprietário da organização',
    description: 'Proprietário de uma organização dentro de um locatário.',
  },
  org_admin: {
    label: 'Administrador da organização',
    description: 'Administrador de uma organização dentro de um locatário.',
  },
  org_member: {
    label: 'Membro da organização',
    description: 'Membro de uma organização dentro de um locatário.',
  },
  org_external: {
    label: 'Membro externo da organização',
    description: 'Membro externo dentro de um locatário (usuário do portal): vê apenas os próprios registros de identidade e acessa dados só por concessões explícitas.',
  },
  everyone: {
    label: 'Todos',
    description: 'Âncora de público integrada: todo membro conectado ocupa este cargo implicitamente. Os conjuntos de permissões vinculados a ele são as concessões padrão do locatário. Conjuntos de privilégio elevado não podem ser vinculados aqui.',
  },
  guest: {
    label: 'Convidado',
    description: 'Âncora de público integrada: quem não está conectado ocupa este cargo de forma implícita e exclusiva. Os vínculos passam pelas verificações mais rígidas — só objetos nomeados, principalmente leitura, nunca curinga.',
  },
};

export const ruBuiltinPositions: PositionTranslations = {
  platform_admin: {
    label: 'Администратор платформы',
    description: 'Оператор платформы (администратор SaaS). Это не роль пользователя внутри арендатора.',
  },
  org_owner: {
    label: 'Владелец организации',
    description: 'Владелец организации внутри арендатора.',
  },
  org_admin: {
    label: 'Администратор организации',
    description: 'Администратор организации внутри арендатора.',
  },
  org_member: {
    label: 'Участник организации',
    description: 'Участник организации внутри арендатора.',
  },
  org_external: {
    label: 'Внешний участник организации',
    description: 'Внешний участник внутри арендатора (пользователь портала): видит только свои записи идентичности и получает доступ к данным лишь через явные предоставления.',
  },
  everyone: {
    label: 'Все',
    description: 'Встроенный якорь аудитории: каждый вошедший участник неявно занимает эту должность. Привязанные к ней наборы разрешений — это выдачи арендатора по умолчанию. Наборы с высокими привилегиями сюда привязать нельзя.',
  },
  guest: {
    label: 'Гость',
    description: 'Встроенный якорь аудитории: не вошедшие в систему неявно и исключительно занимают эту должность. Привязки проходят самые строгие проверки — только именованные объекты, преимущественно чтение, никаких подстановочных знаков.',
  },
};

export const deBuiltinPositions: PositionTranslations = {
  platform_admin: {
    label: 'Plattformadministrator',
    description: 'Plattformbetreiber (SaaS-Administrator). Keine Benutzerrolle innerhalb des Mandanten.',
  },
  org_owner: {
    label: 'Organisationseigentümer',
    description: 'Eigentümer einer Organisation innerhalb eines Mandanten.',
  },
  org_admin: {
    label: 'Organisationsadministrator',
    description: 'Administrator einer Organisation innerhalb eines Mandanten.',
  },
  org_member: {
    label: 'Organisationsmitglied',
    description: 'Mitglied einer Organisation innerhalb eines Mandanten.',
  },
  org_external: {
    label: 'Externes Organisationsmitglied',
    description: 'Externes Mitglied innerhalb eines Mandanten (Portalbenutzer): sieht nur die eigenen Identitätsdatensätze und greift nur über ausdrückliche Gewährungen auf Daten zu.',
  },
  everyone: {
    label: 'Alle',
    description: 'Integrierter Zielgruppenanker: Jedes angemeldete Mitglied hat diese Position implizit inne. Daran gebundene Berechtigungssätze sind die Standardgewährungen des Mandanten. Hochprivilegierte Sätze können hier nicht gebunden werden.',
  },
  guest: {
    label: 'Gast',
    description: 'Integrierter Zielgruppenanker: Nicht angemeldete Zugreifende haben diese Position implizit und ausschließlich inne. Bindungen unterliegen den strengsten Prüfungen — nur benannte Objekte, überwiegend lesend, nie ein Platzhalter.',
  },
};

export const koBuiltinPositions: PositionTranslations = {
  platform_admin: {
    label: '플랫폼 관리자',
    description: '플랫폼 운영자(SaaS 관리자)이며, 테넌트 안의 사용자 역할이 아닙니다.',
  },
  org_owner: {
    label: '조직 소유자',
    description: '테넌트 안에 있는 조직의 소유자입니다.',
  },
  org_admin: {
    label: '조직 관리자',
    description: '테넌트 안에 있는 조직의 관리자입니다.',
  },
  org_member: {
    label: '조직 구성원',
    description: '테넌트 안에 있는 조직의 구성원입니다.',
  },
  org_external: {
    label: '조직 외부 구성원',
    description: '테넌트 안의 외부 구성원(포털 사용자): 본인의 ID 레코드만 볼 수 있고, 명시적으로 부여된 권한으로만 데이터에 접근합니다.',
  },
  everyone: {
    label: '모든 사람',
    description: '기본 제공 대상 앵커: 로그인한 모든 구성원이 이 직위를 암묵적으로 갖습니다. 여기에 연결한 권한 세트가 테넌트의 기본 부여가 됩니다. 높은 권한의 세트는 여기에 연결할 수 없습니다.',
  },
  guest: {
    label: '게스트',
    description: '기본 제공 대상 앵커: 로그인하지 않은 접근자만이 이 직위를 암묵적으로 갖습니다. 여기의 연결은 가장 엄격한 검사를 받습니다 — 이름을 지정한 객체만, 주로 읽기, 와일드카드는 절대 불가.',
  },
};
