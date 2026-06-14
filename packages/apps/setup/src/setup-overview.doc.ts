// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Doc } from '@objectstack/spec/system';

/**
 * Setup app overview doc (ADR-0046), registered in this package's manifest so
 * it groups under "Setup" in the `/_console/docs` index.
 *
 * Authored inline rather than as a flat `src/docs/*.md` file because this is a
 * TS-first code package built by tsup, not a user app built by `os build` —
 * `defineStack({ docs })` / manifest `docs[]` is the supported path for those
 * (see `DocSchema` in `@objectstack/spec/system`). Plain CommonMark + GFM, no
 * images/MDX, per ADR-0046 §3.4.
 *
 * Principle (from the HotCRM reference docs): document only the *invisible*
 * rules, not what the Setup UI already shows. Deliberately three short bullets —
 * the Users/Roles/Permission-set screens cover the rest; this page exists for
 * the handful of behaviours those screens don't reveal.
 *
 * `translations` carries per-locale variants (ADR-0046 i18n); the REST layer
 * collapses the doc to the request's `Accept-Language` and serves one body.
 */
export const SETUP_OVERVIEW_DOC: Doc = {
  name: 'setup_overview',
  label: 'Setup overview',
  description: 'The non-obvious rules behind Setup: identity vs access, additive permissions, and record visibility.',
  content: `# Setup overview

Setup is the administrator app. Its screens are mostly self-explanatory — these
are the few rules behind them that the UI does not show. For everything else,
see <https://docs.objectstack.ai>.

- **A user is identity, not access.** Creating a \`sys_user\` lets someone sign
  in; *what* they can do comes entirely from the roles and permission sets you
  then assign. Deactivating a user revokes sign-in without deleting their
  records, so ownership and history survive.
- **Access is additive.** A user's effective permissions are the *union* of
  every permission set granted to them — you grant capability, you never
  subtract it.
- **"Can't see a record" is almost always sharing, not permissions.**
  Object-level permissions decide which *kinds* of records a user can touch;
  sharing decides *which rows*. Visibility starts from the org-wide default and
  is only ever widened by the role hierarchy and sharing rules — never silently
  narrowed.

See <https://docs.objectstack.ai> for the full security model.
`,
  translations: {
    zh: {
      label: 'Setup 概览',
      description: 'Setup 背后看不见的几条规则:身份≠权限、权限叠加、记录可见性。',
      content: `# Setup 概览

Setup 是管理员应用。它的界面大多一目了然——下面这几条是界面背后、UI 没有明说的
规则。其余内容见 <https://docs.objectstack.ai>。

- **用户是身份,不是权限。** 创建一条 \`sys_user\` 只是让人能登录;他*能做什么*
  完全由你随后分配的角色和权限集决定。停用用户会收回登录权,但不删除其记录,
  归属与历史因此得以保留。
- **权限是叠加的。** 用户的最终权限是其所有权限集的*并集*——你是在授予能力,
  从不做减法。
- **"看不到某条记录"几乎总是共享问题,不是权限问题。** 对象级权限决定用户能碰
  *哪类*记录;共享决定*哪些行*。可见性从组织级默认出发,只会被角色层级和共享规则
  *放宽*,绝不会被悄悄收窄。

完整安全模型见 <https://docs.objectstack.ai>。
`,
    },
  },
};
