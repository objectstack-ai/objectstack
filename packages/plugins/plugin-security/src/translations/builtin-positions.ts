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
 * text. When a source label or sentence changes, re-translate its three
 * entries here in the same change: nothing marks a translation stale.
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
