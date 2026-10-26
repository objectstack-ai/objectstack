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
 * sentence changes, re-translate its three entries here in the same change:
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
