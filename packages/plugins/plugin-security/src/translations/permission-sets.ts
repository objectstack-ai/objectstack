// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Translations of the built-in permission sets' labels and descriptions — the
 * `permissions.<name>.label` / `.description` group of the translation bundle,
 * which `translatePermissionSet` overlays on every served `permission` document
 * (`GET /meta/permission`, the list Setup → Permission Sets shows).
 *
 * HAND-AUTHORED, not generated: this package's extract runs objects-only, so
 * `os i18n extract` writes no `permissions` group here. The English source is
 * each set's own `label` and `description` in
 * `../objects/default-permission-sets.ts`; `en` needs no entry, because an
 * untranslated locale serves the set's own text. When a source label or
 * sentence changes, re-translate its entry in every locale here in the same change:
 * nothing marks a translation stale (no provenance table judges this section).
 * `permission-set-descriptions.test.ts` pins one label and one description per
 * built-in set per locale.
 *
 * A label is a short noun phrase in the English label's shape (the same
 * ` — ` split), using the terms its description chose, so the two agree on one
 * row of the list.
 */

import type { TranslationData } from '@objectstack/spec/system';

type PermissionSetTranslations = NonNullable<TranslationData['permissions']>;

export const zhCNPermissionSets: PermissionSetTranslations = {
  admin_full_access: {
    label: '管理员 — 完全访问',
    description: '平台运维人员：可读取和修改所有组织中的每条记录，管理全部用户与设置，并在 Studio 中构建应用。',
  },
  organization_admin: {
    label: '组织管理员',
    description: '组织的所有者和管理员：在设置中全面管理本组织的记录和成员，但不能构建应用或修改平台级设置。',
  },
  organization_admin_no_bypass: {
    label: '组织管理员（不绕过记录权限）',
    description: '组织之间未设隔离墙的部署中的组织管理员：管理权限相同，但只能访问其所有权和共享范围内的记录。',
  },
  member_default: {
    label: '成员 — 标准访问',
    description: '每位已登录成员的基础权限：本人的资料、密钥、收件箱和成员目录；业务记录的访问来自其他权限集。',
  },
  viewer_readonly: {
    label: '查看者 — 只读',
    description: '只读用户：在共享允许的范围内查看所有对象的记录，但不能新建、编辑或删除任何内容。',
  },
  external_default: {
    label: '外部成员 — 仅本人记录',
    description: '组织外部人员（如客户或供应商）：仅限本人的资料和记录，以及与其共享的内容。',
  },
  mcp_agent_data_read: {
    label: 'MCP AI 助手 — 只读',
    description: '用户以只读权限连接的 AI 助手：可读取该用户能读取的内容，不做任何修改。',
  },
  mcp_agent_data_write: {
    label: 'MCP AI 助手 — 读写',
    description: '用户以读写权限连接的 AI 助手：可读取和修改该用户能访问的内容，但用户与登录数据除外。',
  },
  mcp_agent_restricted: {
    label: 'MCP AI 助手 — 无数据权限',
    description: '用户在无数据权限下连接的 AI 助手：可执行已获准的操作，但不能读取或修改任何记录。',
  },
};

export const jaJPPermissionSets: PermissionSetTranslations = {
  admin_full_access: {
    label: '管理者 — フルアクセス',
    description: 'プラットフォーム運用者：すべての組織のすべてのレコードを参照・変更し、全ユーザーと設定を管理し、Studio でアプリを作成できます。',
  },
  organization_admin: {
    label: '組織管理者',
    description: '組織のオーナーと管理者：設定画面で自組織のレコードとメンバーを全面的に管理できますが、アプリ作成やプラットフォーム全体の設定はできません。',
  },
  organization_admin_no_bypass: {
    label: '組織管理者（レコード権限のバイパスなし）',
    description: '組織間に壁のないデプロイの組織管理者：管理権限は同じですが、所有権と共有で開かれたレコードだけを扱えます。',
  },
  member_default: {
    label: 'メンバー — 標準アクセス',
    description: 'サインインしたすべてのメンバーの基本権限：自分のプロフィール・キー・受信箱とメンバー一覧のみで、業務レコードは他の権限セットで付与されます。',
  },
  viewer_readonly: {
    label: '閲覧者 — 読み取り専用',
    description: '閲覧専用ユーザー：共有で許される範囲ですべてのオブジェクトのレコードを参照できますが、作成・編集・削除はできません。',
  },
  external_default: {
    label: '外部メンバー — 自分のレコードのみ',
    description: '顧客や仕入先など組織外の人：自分のプロフィールとレコード、および共有されたものだけを扱えます。',
  },
  mcp_agent_data_read: {
    label: 'MCP AI アシスタント — 読み取り専用',
    description: 'ユーザーが読み取り権限で接続した AI アシスタント：そのユーザーが参照できるものを参照し、何も変更しません。',
  },
  mcp_agent_data_write: {
    label: 'MCP AI アシスタント — 読み書き',
    description: 'ユーザーが読み書き権限で接続した AI アシスタント：そのユーザーが扱えるものを参照・変更できますが、ユーザーとサインインのデータは除きます。',
  },
  mcp_agent_restricted: {
    label: 'MCP AI アシスタント — データ権限なし',
    description: 'ユーザーがデータ権限なしで接続した AI アシスタント：許可されたアクションは実行できますが、レコードの参照や変更はできません。',
  },
};

export const esESPermissionSets: PermissionSetTranslations = {
  admin_full_access: {
    label: 'Administrador — Acceso total',
    description: 'Operadores de la plataforma: leen y cambian todos los registros de todas las organizaciones, gestionan usuarios y ajustes y crean apps en Studio.',
  },
  organization_admin: {
    label: 'Administrador de organización',
    description: 'Propietarios y administradores de una organización: control total de sus registros y miembros en Configuración, sin crear apps ni cambiar ajustes globales.',
  },
  organization_admin_no_bypass: {
    label: 'Administrador de organización (sin omitir permisos de registro)',
    description: 'Administradores de organización sin muro entre organizaciones: la misma administración, pero solo los registros que abren su propiedad y el uso compartido.',
  },
  member_default: {
    label: 'Miembro — Acceso estándar',
    description: 'Base de todo miembro con sesión: su perfil, claves, bandeja de entrada y el directorio de miembros; los registros de negocio llegan por otros conjuntos.',
  },
  viewer_readonly: {
    label: 'Lector — Solo lectura',
    description: 'Usuarios de solo lectura: leen registros de todos los objetos, hasta donde lo permite el uso compartido, pero no crean, editan ni eliminan nada.',
  },
  external_default: {
    label: 'Miembro externo — Solo sus registros',
    description: 'Personas ajenas a la organización, como clientes o proveedores: su propio perfil y registros, y solo lo que se comparte con ellas.',
  },
  mcp_agent_data_read: {
    label: 'Asistente de IA MCP — Solo lectura',
    description: 'Asistentes de IA que un usuario conecta con acceso de lectura: leen lo que ese usuario puede leer y no cambian nada.',
  },
  mcp_agent_data_write: {
    label: 'Asistente de IA MCP — Lectura y escritura',
    description: 'Asistentes de IA que un usuario conecta con lectura y escritura: leen y cambian lo que ese usuario puede, salvo datos de usuario y de inicio de sesión.',
  },
  mcp_agent_restricted: {
    label: 'Asistente de IA MCP — Sin acceso a datos',
    description: 'Asistentes de IA que un usuario conecta sin acceso a datos: ejecutan las acciones permitidas, pero no leen ni cambian ningún registro.',
  },
};

export const zhHantPermissionSets: PermissionSetTranslations = {
  admin_full_access: {
    label: '管理員 — 完整存取',
    description: '平台維運人員：可讀取並變更所有組織的每一筆記錄、管理全部使用者與設定，並在 Studio 中建置應用程式。',
  },
  organization_admin: {
    label: '組織管理員',
    description: '組織的擁有者與管理員：可在設定中全面管理本組織的記錄與成員，但不能建置應用程式或變更平台層級設定。',
  },
  organization_admin_no_bypass: {
    label: '組織管理員（不略過記錄權限）',
    description: '組織之間未設隔離牆之部署中的組織管理員：管理權限相同，但只能存取其擁有權與共用範圍內的記錄。',
  },
  member_default: {
    label: '成員 — 標準存取',
    description: '每位已登入成員的基本權限：本人的個人資料、金鑰、收件匣與成員目錄；業務記錄的存取來自其他權限集。',
  },
  viewer_readonly: {
    label: '檢視者 — 唯讀',
    description: '唯讀使用者：在共用允許的範圍內檢視所有物件的記錄，但不能建立、編輯或刪除任何內容。',
  },
  external_default: {
    label: '外部成員 — 僅限本人記錄',
    description: '組織外部人員（例如客戶或供應商）：僅限本人的個人資料與記錄，以及與其共用的內容。',
  },
  mcp_agent_data_read: {
    label: 'MCP AI 助理 — 唯讀',
    description: '使用者以讀取權限連接的 AI 助理：可讀取該使用者能讀取的內容，不做任何變更。',
  },
  mcp_agent_data_write: {
    label: 'MCP AI 助理 — 讀寫',
    description: '使用者以讀寫權限連接的 AI 助理：可讀取並變更該使用者能存取的內容，但使用者與登入資料除外。',
  },
  mcp_agent_restricted: {
    label: 'MCP AI 助理 — 無資料權限',
    description: '使用者在無資料權限下連接的 AI 助理：可執行已核准的動作，但不能讀取或變更任何記錄。',
  },
};

export const arPermissionSets: PermissionSetTranslations = {
  admin_full_access: {
    label: 'المسؤول — وصول كامل',
    description: 'مشغّلو المنصة: يقرؤون كل سجل في كل مؤسسة ويغيّرونه، ويديرون جميع المستخدمين والإعدادات، ويبنون التطبيقات في Studio.',
  },
  organization_admin: {
    label: 'مسؤول المؤسسة',
    description: 'مالكو المؤسسة ومسؤولوها: تحكّم كامل في سجلات مؤسستهم وأعضائها من الإعداد، دون بناء التطبيقات أو تغيير إعدادات المنصة.',
  },
  organization_admin_no_bypass: {
    label: 'مسؤول المؤسسة (دون تجاوز أذونات السجلات)',
    description: 'مسؤولو المؤسسات في نشر بلا جدار بين المؤسسات: الإدارة نفسها، لكن فقط السجلات التي تتيحها ملكيتهم والمشاركة.',
  },
  member_default: {
    label: 'عضو — وصول قياسي',
    description: 'الأساس لكل عضو مسجّل الدخول: ملفه الشخصي ومفاتيحه وصندوق وارده ودليل الأعضاء؛ ويأتي الوصول إلى سجلات الأعمال من مجموعات أذونات أخرى.',
  },
  viewer_readonly: {
    label: 'مُشاهد — قراءة فقط',
    description: 'مستخدمو القراءة فقط: يقرؤون سجلات كل الكائنات بالقدر الذي تسمح به المشاركة، ولا ينشئون أو يحررون أو يحذفون أي شيء.',
  },
  external_default: {
    label: 'عضو خارجي — سجلاته فقط',
    description: 'أشخاص من خارج المؤسسة، مثل العملاء أو المورّدين: ملفهم الشخصي وسجلاتهم فقط، وما يُشارَك معهم.',
  },
  mcp_agent_data_read: {
    label: 'مساعد MCP للذكاء الاصطناعي — قراءة فقط',
    description: 'مساعدو الذكاء الاصطناعي الذين يربطهم المستخدم بصلاحية القراءة: يقرؤون ما يستطيع ذلك المستخدم قراءته ولا يغيّرون شيئًا.',
  },
  mcp_agent_data_write: {
    label: 'مساعد MCP للذكاء الاصطناعي — قراءة وكتابة',
    description: 'مساعدو الذكاء الاصطناعي الذين يربطهم المستخدم بصلاحية القراءة والكتابة: يقرؤون ويغيّرون ما يستطيعه ذلك المستخدم، باستثناء بيانات المستخدمين وتسجيل الدخول.',
  },
  mcp_agent_restricted: {
    label: 'مساعد MCP للذكاء الاصطناعي — دون وصول إلى البيانات',
    description: 'مساعدو الذكاء الاصطناعي الذين يربطهم المستخدم دون وصول إلى البيانات: ينفّذون الإجراءات المسموح بها، لكن لا يقرؤون أي سجل ولا يغيّرونه.',
  },
};

export const frPermissionSets: PermissionSetTranslations = {
  admin_full_access: {
    label: 'Administrateur — Accès complet',
    description: 'Opérateurs de la plateforme : lisent et modifient tout enregistrement de toute organisation, gèrent utilisateurs et réglages et créent des apps dans Studio.',
  },
  organization_admin: {
    label: 'Administrateur d’organisation',
    description: 'Propriétaires et administrateurs d’une organisation : contrôle total de ses enregistrements et membres dans Configuration, sans apps ni réglages globaux.',
  },
  organization_admin_no_bypass: {
    label: 'Administrateur d’organisation (sans contourner les droits d’enregistrement)',
    description: 'Administrateurs d’organisation sans cloison entre organisations : la même administration, mais seuls les enregistrements ouverts par la propriété et le partage.',
  },
  member_default: {
    label: 'Membre — Accès standard',
    description: 'Socle de tout membre connecté : son profil, ses clés, sa boîte de réception et l’annuaire ; les enregistrements métier viennent d’autres ensembles.',
  },
  viewer_readonly: {
    label: 'Lecteur — Lecture seule',
    description: 'Utilisateurs en lecture seule : lisent les enregistrements de tous les objets dans la limite du partage, sans rien créer, modifier ni supprimer.',
  },
  external_default: {
    label: 'Membre externe — Ses propres enregistrements',
    description: 'Personnes extérieures à l’organisation, comme clients ou fournisseurs : leur profil et leurs enregistrements, et seulement ce qui est partagé avec elles.',
  },
  mcp_agent_data_read: {
    label: 'Assistant IA MCP — Lecture seule',
    description: 'Assistants IA qu’un utilisateur connecte avec un accès en lecture : lisent ce que cet utilisateur peut lire et ne modifient rien.',
  },
  mcp_agent_data_write: {
    label: 'Assistant IA MCP — Lecture et écriture',
    description: 'Assistants IA qu’un utilisateur connecte en lecture et écriture : lisent et modifient ce que cet utilisateur peut, sauf données d’utilisateur et de connexion.',
  },
  mcp_agent_restricted: {
    label: 'Assistant IA MCP — Sans accès aux données',
    description: 'Assistants IA qu’un utilisateur connecte sans accès aux données : exécutent les actions autorisées, mais ne lisent ni ne modifient aucun enregistrement.',
  },
};

export const ptBRPermissionSets: PermissionSetTranslations = {
  admin_full_access: {
    label: 'Administrador — Acesso total',
    description: 'Operadores da plataforma: leem e alteram todos os registros de todas as organizações, gerenciam todos os usuários e configurações e criam aplicativos no Studio.',
  },
  organization_admin: {
    label: 'Administrador da organização',
    description: 'Proprietários e administradores de uma organização: controle total dos registros e membros dela na Configuração, sem criar apps nem alterar a plataforma.',
  },
  organization_admin_no_bypass: {
    label: 'Administrador da organização (sem ignorar permissões de registro)',
    description: 'Administradores de organização sem barreira entre organizações: a mesma administração, mas só os registros liberados por propriedade e compartilhamento.',
  },
  member_default: {
    label: 'Membro — Acesso padrão',
    description: 'Base de todo membro conectado: o próprio perfil, chaves, caixa de entrada e o diretório de membros; o acesso aos registros de negócio vem de outros conjuntos.',
  },
  viewer_readonly: {
    label: 'Leitor — Somente leitura',
    description: 'Usuários somente leitura: leem registros de todos os objetos até onde o compartilhamento permite, mas não criam, editam nem excluem nada.',
  },
  external_default: {
    label: 'Membro externo — Somente os próprios registros',
    description: 'Pessoas de fora da organização, como clientes ou fornecedores: o próprio perfil e registros, e só o que é compartilhado com elas.',
  },
  mcp_agent_data_read: {
    label: 'Assistente de IA MCP — Somente leitura',
    description: 'Assistentes de IA que um usuário conecta com acesso de leitura: leem o que esse usuário pode ler e não alteram nada.',
  },
  mcp_agent_data_write: {
    label: 'Assistente de IA MCP — Leitura e gravação',
    description: 'Assistentes de IA que um usuário conecta com leitura e gravação: leem e alteram o que esse usuário pode, exceto dados de usuário e de login.',
  },
  mcp_agent_restricted: {
    label: 'Assistente de IA MCP — Sem acesso a dados',
    description: 'Assistentes de IA que um usuário conecta sem acesso a dados: executam as ações permitidas, mas não leem nem alteram nenhum registro.',
  },
};

export const ruPermissionSets: PermissionSetTranslations = {
  admin_full_access: {
    label: 'Администратор — полный доступ',
    description: 'Операторы платформы: читают и изменяют каждую запись во всех организациях, управляют всеми пользователями и настройками и создают приложения в Studio.',
  },
  organization_admin: {
    label: 'Администратор организации',
    description: 'Владельцы и администраторы организации: полное управление её записями и участниками в настройках, без создания приложений и изменения настроек платформы.',
  },
  organization_admin_no_bypass: {
    label: 'Администратор организации (без обхода прав на записи)',
    description: 'Администраторы организаций в развёртывании без стены между организациями: то же администрирование, но только записи, открытые владением и общим доступом.',
  },
  member_default: {
    label: 'Участник — стандартный доступ',
    description: 'Основа для каждого вошедшего участника: его профиль, ключи, входящие и каталог участников; доступ к бизнес-записям дают другие наборы.',
  },
  viewer_readonly: {
    label: 'Наблюдатель — только чтение',
    description: 'Пользователи только для чтения: читают записи всех объектов в пределах общего доступа, но ничего не создают, не изменяют и не удаляют.',
  },
  external_default: {
    label: 'Внешний участник — только свои записи',
    description: 'Люди вне организации, например клиенты или поставщики: только их профиль и записи, а также то, чем с ними поделились.',
  },
  mcp_agent_data_read: {
    label: 'ИИ-помощник MCP — только чтение',
    description: 'ИИ-помощники, подключённые пользователем с доступом на чтение: читают то, что может читать этот пользователь, и ничего не меняют.',
  },
  mcp_agent_data_write: {
    label: 'ИИ-помощник MCP — чтение и запись',
    description: 'ИИ-помощники, подключённые пользователем с доступом на чтение и запись: читают и изменяют то, что может этот пользователь, кроме данных пользователей и входа.',
  },
  mcp_agent_restricted: {
    label: 'ИИ-помощник MCP — без доступа к данным',
    description: 'ИИ-помощники, подключённые пользователем без доступа к данным: выполняют разрешённые действия, но не читают и не изменяют никаких записей.',
  },
};

export const dePermissionSets: PermissionSetTranslations = {
  admin_full_access: {
    label: 'Administrator — Vollzugriff',
    description: 'Plattformbetreiber: lesen und ändern jeden Datensatz in allen Organisationen, verwalten alle Benutzer und Einstellungen und erstellen Apps in Studio.',
  },
  organization_admin: {
    label: 'Organisationsadministrator',
    description: 'Eigentümer und Admins einer Organisation: volle Kontrolle über ihre Datensätze und Mitglieder im Setup, ohne Apps zu bauen oder die Plattform zu ändern.',
  },
  organization_admin_no_bypass: {
    label: 'Organisationsadministrator (ohne Umgehung der Datensatzrechte)',
    description: 'Organisationsadministratoren ohne Trennwand zwischen Organisationen: dieselbe Verwaltung, aber nur die Datensätze, die Eigentum und Freigabe öffnen.',
  },
  member_default: {
    label: 'Mitglied — Standardzugriff',
    description: 'Grundlage jedes angemeldeten Mitglieds: eigenes Profil, Schlüssel, Posteingang und Mitgliederverzeichnis; Geschäftsdatensätze kommen aus anderen Sätzen.',
  },
  viewer_readonly: {
    label: 'Betrachter — Nur Lesen',
    description: 'Nur-Lese-Benutzer: lesen Datensätze aller Objekte, soweit die Freigabe es erlaubt, erstellen, bearbeiten oder löschen aber nichts.',
  },
  external_default: {
    label: 'Externes Mitglied — Nur eigene Datensätze',
    description: 'Personen außerhalb der Organisation, etwa Kunden oder Lieferanten: das eigene Profil und die eigenen Datensätze sowie nur das, was mit ihnen geteilt wird.',
  },
  mcp_agent_data_read: {
    label: 'MCP-KI-Assistent — Nur Lesen',
    description: 'KI-Assistenten, die ein Benutzer mit Lesezugriff verbindet: lesen, was dieser Benutzer lesen darf, und ändern nichts.',
  },
  mcp_agent_data_write: {
    label: 'MCP-KI-Assistent — Lesen und Schreiben',
    description: 'KI-Assistenten, die ein Benutzer mit Lese- und Schreibzugriff verbindet: lesen und ändern, was dieser Benutzer darf, außer Benutzer- und Anmeldedaten.',
  },
  mcp_agent_restricted: {
    label: 'MCP-KI-Assistent — Ohne Datenzugriff',
    description: 'KI-Assistenten, die ein Benutzer ohne Datenzugriff verbindet: führen erlaubte Aktionen aus, lesen oder ändern aber keinen Datensatz.',
  },
};

export const koPermissionSets: PermissionSetTranslations = {
  admin_full_access: {
    label: '관리자 — 전체 접근',
    description: '플랫폼 운영자: 모든 조직의 모든 레코드를 읽고 변경하며, 전체 사용자와 설정을 관리하고, Studio에서 앱을 만듭니다.',
  },
  organization_admin: {
    label: '조직 관리자',
    description: '조직의 소유자와 관리자: 설정에서 자기 조직의 레코드와 구성원을 모두 관리하지만, 앱을 만들거나 플랫폼 설정을 바꿀 수는 없습니다.',
  },
  organization_admin_no_bypass: {
    label: '조직 관리자(레코드 권한 우회 없음)',
    description: '조직 간 벽이 없는 배포의 조직 관리자: 관리 권한은 같지만, 소유권과 공유로 열린 레코드만 다룹니다.',
  },
  member_default: {
    label: '구성원 — 표준 접근',
    description: '로그인한 모든 구성원의 기본 권한으로 본인의 프로필, 키, 받은편지함, 구성원 디렉터리를 다루며, 업무 레코드 접근은 다른 권한 세트에서 받습니다.',
  },
  viewer_readonly: {
    label: '보기 전용 — 읽기 전용',
    description: '읽기 전용 사용자: 공유가 허용하는 범위에서 모든 객체의 레코드를 읽지만, 아무것도 만들거나 편집하거나 삭제하지 않습니다.',
  },
  external_default: {
    label: '외부 구성원 — 본인 레코드만',
    description: '고객이나 공급업체처럼 조직 외부의 사람: 본인의 프로필과 레코드, 그리고 그들과 공유된 것만 다룹니다.',
  },
  mcp_agent_data_read: {
    label: 'MCP AI 도우미 — 읽기 전용',
    description: '사용자가 읽기 권한으로 연결한 AI 도우미: 그 사용자가 읽을 수 있는 것을 읽고, 아무것도 바꾸지 않습니다.',
  },
  mcp_agent_data_write: {
    label: 'MCP AI 도우미 — 읽기/쓰기',
    description: '사용자가 읽기/쓰기 권한으로 연결한 AI 도우미: 그 사용자가 다룰 수 있는 것을 읽고 바꾸지만, 사용자 및 로그인 데이터는 제외합니다.',
  },
  mcp_agent_restricted: {
    label: 'MCP AI 도우미 — 데이터 접근 없음',
    description: '사용자가 데이터 접근 없이 연결한 AI 도우미: 허용된 작업은 실행하지만, 어떤 레코드도 읽거나 바꾸지 않습니다.',
  },
};
