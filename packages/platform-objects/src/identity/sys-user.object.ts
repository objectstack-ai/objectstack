// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { INVITATION_ROLE_OPTIONS } from '@objectstack/spec/identity';
import { INVITE_USER_OUTCOME_MESSAGES } from './invite-outcome-messages.js';

/**
 * The BCP-47 shape `sys_user.locale` accepts — a 2–3 letter language subtag
 * followed by any number of 1–8 alphanumeric subtags (`zh`, `zh-CN`,
 * `zh-Hans-CN`, `es-419`). Shape only: membership in a shipped template bundle
 * is the bundle's business, and the delivery-time ladders handle a
 * shipped-nowhere tag by falling to their floor. The primary subtag is held to
 * the 2–3 letters of the ISO 639 codes real tags start with, so a language
 * name (`Japanese`) or a stringified nothing (`null`) is refused as
 * malformed: BCP-47 reserves 4 letters and registers no 5–8 letter language.
 * The same pattern as `LOCALE_TAG_SHAPE` behind `LocaleSchema` in
 * `@objectstack/spec/system`, so a translation is stored only under a tag a
 * user can hold.
 *
 * A JS regex SOURCE string, because that is what a `format` validation rule
 * carries (`new RegExp(rule.regex)` in objectql's rule validator) — anchored at
 * both ends on purpose, since the rule compiles it unanchored.
 *
 * ## Why this is exported rather than inlined
 *
 * There are two readers of this shape and they live in different packages: the
 * WRITE side is the `locale_bcp47_shape` rule below, and the READ side is
 * `LOCALE_TAG_SHAPE` in `@objectstack/service-messaging`'s
 * `recipient-locale.ts`, which refuses anything non-tag-shaped before it
 * reaches a template lookup. The two must not drift — a write path that
 * accepts what the read path discards would store values that silently fall
 * back to the deployment default forever. service-messaging keeps its own
 * compiled copy rather than importing this one (that module is documented as
 * pure and total, and pulling the identity barrel into it for a regex would
 * make a per-recipient normalizer pay a package barrel's load), so the
 * agreement is held by a PIN instead of by a shared binding:
 * `recipient-locale-shape-parity.test.ts` in service-messaging asserts the two
 * spellings are byte-identical and names what breaks if they are not.
 */
export const SYS_USER_LOCALE_TAG_PATTERN = '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$';

/**
 * The label of the `temporaryPassword` field on the `create_user` and
 * `set_user_password` result dialogs. It carries the copy-it-now instruction
 * because the dialog skips a field absent from the response, and the server
 * returns `temporaryPassword` only when it generated one: the instruction
 * shows exactly when there is a password to copy.
 */
const TEMPORARY_PASSWORD_LABEL = 'Temporary password: copy it now, it is shown only once and never stored';

/**
 * sys_user — System User Object
 *
 * Canonical user identity record for the ObjectStack platform.
 * Backed by better-auth's `user` model with ObjectStack field conventions.
 *
 * Field order drives default list/form layout: identity first, then profile,
 * then system-managed audit fields (hidden from create/edit forms).
 *
 * @namespace sys
 */
export const SysUser = ObjectSchema.create({
  name: 'sys_user',
  label: 'User',
  pluralLabel: 'Users',
  icon: 'user',
  isSystem: true,
  managedBy: 'better-auth',
  // ADR-0092 D4 — the ONE generic affordance opened on an identity table:
  // standard row editing. Safe because the plugin-auth identity write guard
  // (ADR-0092 D2) enforces the profile whitelist server-side — a user-context
  // update may only touch SYS_USER_PROFILE_EDIT_FIELDS ({name, image, locale}
  // since the 2026-09-03 ruling; see the `locale` field below);
  // everything else is stripped/rejected regardless of what a form submits.
  // The permission layer still decides WHO may edit (platform admins only by
  // default; member/org-admin sets keep allowEdit: false). create / import /
  // delete stay bucket-default (off).
  userActions: { edit: true },
  // ADR-0010 §3.7 — identity table is managed by better-auth; schema must not drift.
  protection: {
    lock: 'full',
    reason: 'Identity table managed by better-auth — see ADR-0010.',
    docsUrl: 'https://objectstack.ai/docs/references/shared/protection',
  },
  description: 'User accounts for authentication',
  displayNameField: 'name',
  nameField: 'name', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{name}',
  highlightFields: ['name', 'email', 'email_verified'],

  // Custom actions — generic CRUD is suppressed because user accounts are
  // managed by better-auth, but we still need first-class affordances for
  // common operations. Each action delegates to a Console-side named script
  // registered on the ActionRunner (see objectui `AppContent.tsx`). Adding
  // new affordances (reset password, revoke session, …) is now a pure
  // schema + script-registration change — no per-view code.
  actions: [
    {
      name: 'invite_user',
      label: 'Invite User',
      // The parameter dialog's subtitle. Same wording on all three mirrors
      // (sys_member, sys_invitation) so one translation serves each.
      description:
        'Invite someone by email address. They join this organization with the chosen role when they accept the invitation.',
      icon: 'user-plus',
      variant: 'primary',
      locations: ['list_toolbar'],
      type: 'api',
      target: '/api/v1/auth/organization/invite-member',
      // Gated on the org CAPABILITY, not multi-org (cloud ADR-0081 D1): the
      // better-auth organization plugin is always mounted, and single-org
      // mode now bootstraps a Default Organization (plugin-auth) so the
      // endpoint's active-org resolution works there too. This is THE
      // "add a teammate" affordance — the Users list is always reachable —
      // and every add flows through better-auth invitations, never bespoke
      // sys_user CRUD.
      // Hidden while the environment is cloud-managed (`features.cloudManaged`,
      // hide-when-on): its people arrive from the organisation's identity
      // provider, never by invitation (ruling 6341690661 on #25083, Q3 A).
      // Written here rather than as `requiresFeature`, which names one flag
      // and already carries `organization`.
      visible: 'features.cloudManaged != true',
      requiresFeature: 'organization',
      requiresMembershipReach: 'invite_member',
      // `{{ result.email }}`: invite-member answers the bare invitation row,
      // whose top-level `email` is the invitee's address as stored (lowercased).
      successMessage: 'Invitation sent to {{ result.email }}',
      // [#27843] The copy per delivery outcome invite-member answers: `sent`,
      // or `link_only` when this deployment does not deliver mail. The
      // `successMessage` above stays the fallback for an answer without one.
      outcomeMessages: { ...INVITE_USER_OUTCOME_MESSAGES },
      refreshAfter: true,
      params: [
        { field: 'email', required: true },
        // [ADR-0105 D8] The role picker offers only what this caller may
        // grant: each option's `visibleWhen` is built from the same grant
        // table the server's invitation role cap enforces
        // (`INVITATION_ROLE_GRANTORS`), so a delegated_admin is offered
        // `member` alone. Declared on the param, not inherited from the
        // field, so the gate narrows this dialog and no other picker.
        { field: 'role', objectOverride: 'sys_member', required: true, options: [...INVITATION_ROLE_OPTIONS] },
      ],
    },

    // ── Platform admin operations (require better-auth `admin` plugin) ─
    //
    // These actions hit /api/v1/auth/admin/* endpoints that are only
    // wired when `auth.plugins.admin` is enabled, so each one is gated on
    // `requiresFeature: 'admin'` (#2874) — when the plugin is off the UI
    // hides them instead of rendering buttons that 404. SCIM deployments
    // keep them: SCIM forces the admin plugin (and `features.admin`) on
    // (ADR-0134). UI surfaces them under the row menu AND the
    // record-detail header (`record_header`, overflowing into the ⋯
    // "More" menu) so platform admins can manage an account from either
    // the Users list or an open user record — without dropping to SQL or
    // a custom Setup wizard.
    //
    // Every action in this block, and `set_user_manager` below, is OFFERED
    // only to the one standing its door admits (ADR-0068 D4): each endpoint
    // runs the platform-admin gate first and answers every other caller —
    // org owners and admins included — 403 `PERMISSION_DENIED`. So each one
    // authors `visible: 'current_user.isPlatformAdmin == true'`, the ADR-0095
    // D3 PLATFORM_ADMIN posture rung that the session payload emits and the
    // gate judges; `requiresFeature` composes onto it at parse time, e.g.
    // `(current_user.isPlatformAdmin == true) && features.admin == true`.
    // ⛔ Never `'platform_admin' in current_user.positions`: `EvalUserSchema`
    // rules that standing is read from this key, never from the array. The
    // repo-wide pin is `platform-admin-affordance-standing.test.ts`.
    //
    // Ban / Unban / Unlock also read the ROW's state after the standing, in
    // the form of `sys_oauth_application`'s Disable / Enable pair, so a pair
    // that undoes each other is never offered together. Display only: no door
    // reads `visible` (the routes still answer whatever they are sent). On a
    // list row the console projects every `record.<field>` an object action's
    // predicate reads (objectui `listViewPredicates`), so the default Users
    // view carries `banned` without showing it; the record header reads the
    // whole row. `banned` stays true past `ban_expires` until better-auth
    // clears it at the user's next sign-in, so Unban is offered while the row
    // says banned. Pinned in `action-state-visibility.test.ts`.
    {
      name: 'ban_user',
      label: 'Ban User',
      icon: 'ban',
      variant: 'danger',
      locations: ['list_item', 'record_header'],
      type: 'api',
      target: '/api/v1/auth/admin/ban-user',
      // Platform-admin standing (ADR-0068 D4), then a user not banned yet —
      // see the block header above. A null `banned` reads as not banned.
      visible: 'current_user.isPlatformAdmin == true && has(record.banned) && record.banned != true',
      requiresFeature: 'admin',
      recordIdParam: 'userId',
      successMessage: 'User banned',
      refreshAfter: true,
      // The confirm question rides `description`, not `confirmText`: this action
      // collects params, and the console action runner chains confirmation THEN
      // param collection (both awaited), so pairing the two keys opens two
      // dialogs for one decision — and the first already reads as "it ran".
      // Maintainer ruling on #7278 (2026-08-10), swept across the remaining
      // in-repo sites by #7309. The param dialog renders this under its title,
      // and nothing is POSTed until that one dialog's own Confirm.
      // NB: the top-level `description` (#7367), never `ai.description` — that
      // one is the LLM-facing tool contract and is shown to no user.
      description: 'Ban this user? They will be signed out and unable to sign in until unbanned.',
      params: [
        { name: 'banReason', label: 'Ban Reason', type: 'text', required: false },
      ],
    },
    {
      name: 'unban_user',
      label: 'Unban User',
      icon: 'check-circle-2',
      variant: 'secondary',
      locations: ['list_item', 'record_header'],
      type: 'api',
      target: '/api/v1/auth/admin/unban-user',
      // Platform-admin standing (ADR-0068 D4), then a banned user — see the
      // block header above.
      visible: 'current_user.isPlatformAdmin == true && has(record.banned) && record.banned == true',
      requiresFeature: 'admin',
      recordIdParam: 'userId',
      successMessage: 'User unbanned',
      refreshAfter: true,
    },
    {
      // ADR-0069 D2 — clear a brute-force lockout early (locked_until auto-
      // expires, but an admin can release a user immediately). Hits the
      // plugin-auth custom route, which is admin-guarded server-side.
      name: 'unlock_user',
      label: 'Unlock Account',
      icon: 'lock-open',
      variant: 'secondary',
      locations: ['list_item', 'record_header'],
      type: 'api',
      target: '/api/v1/auth/admin/unlock-user',
      // Platform-admin standing (ADR-0068 D4), then an account that can hold
      // a lock. `unlockUser` clears TWO stages: this row's `locked_until`
      // (the password check) and `sys_two_factor.locked_until` (the second
      // factor), which this row does not carry. So the button is offered when
      // `locked_until` is set, or when the user has two-factor enabled and may
      // be locked at the second factor; gating on `locked_until` alone would
      // take away the only early release of a second-factor lock. The stamp is
      // not compared with now() on purpose: an expired lock leaves
      // `failed_login_count` at the threshold, so one more failure re-locks,
      // and Unlock is what resets that counter.
      visible: 'current_user.isPlatformAdmin == true && ((has(record.locked_until) && record.locked_until != null) || (has(record.two_factor_enabled) && record.two_factor_enabled == true))',
      requiresFeature: 'admin',
      recordIdParam: 'userId',
      successMessage: 'Account unlocked',
      refreshAfter: true,
    },
    {
      // #2766 V1 — a platform admin can add a login-capable teammate without
      // the email-dependent invite flow. Hits the plugin-auth wrapper route
      // (NOT better-auth's stock /admin/create-user): the wrapper runs the
      // ADR-0068 admin gate, drives the better-auth pipeline (scrypt hash +
      // credential sys_account), stamps must_change_password, and — when the
      // password is left empty — returns a generated temporary password ONCE
      // in the response for the result dialog. It is never persisted or logged.
      name: 'create_user',
      label: 'Create User',
      icon: 'user-plus',
      variant: 'secondary',
      locations: ['list_toolbar'],
      type: 'api',
      target: '/api/v1/auth/admin/create-user',
      // Platform-admin standing (ADR-0068 D4) — see the block header above —
      // and hidden while cloud-managed (`features.cloudManaged`, hide-when-on):
      // a managed environment's users come from the identity provider.
      visible: 'current_user.isPlatformAdmin == true && features.cloudManaged != true',
      requiresFeature: 'admin',
      successMessage: 'User created',
      refreshAfter: true,
      // One rule for the admin: the password field's own label, "leave empty
      // to generate". `generatePassword` is therefore a constant the dialog
      // never offers, not a param: the endpoint lets a non-empty explicit
      // password win over it and generates only when the password is empty,
      // which is exactly what the label says. A ticked box beside a typed
      // password was a control the server ignored. It is not a hidden param
      // either — `visible: false` drops the value from the submission too, and
      // the endpoint answers an empty password without `generatePassword: true`
      // with a 400 (its contract for other callers, unchanged).
      bodyExtra: { generatePassword: true },
      params: [
        // The endpoint requires email OR phone (phone-only users get a
        // placeholder address; requires auth.plugins.phoneNumber).
        { field: 'email', required: false },
        {
          name: 'phoneNumber',
          label: 'Phone Number',
          type: 'text',
          required: false,
          helpText: 'Sign-in phone number (E.164, e.g. +8613800000000). Required when no email is given.',
          // Only offer phone when the opt-in phoneNumber auth plugin is loaded —
          // otherwise the create-user endpoint rejects a phone with
          // "Phone numbers require the phoneNumber auth plugin". `features.phoneNumber`
          // is served in /api/v1/auth/config (getPublicConfig).
          requiresFeature: 'phoneNumber',
        },
        { field: 'name', required: false },
        { name: 'password', label: 'Password (leave empty to generate)', type: 'password', required: false },
        {
          name: 'mustChangePassword',
          label: 'Require Password Change On First Login',
          type: 'boolean',
          required: false,
          defaultValue: true,
        },
        // [#25338] Optional: grant one permission set in the same step, so a
        // new user does not sign in to a screen of refusals. INLINE, not
        // field-backed: the grant object lives in plugin-security, whose
        // metadata the console need not have loaded on this list, and an
        // unresolvable field-backed param makes the dialog refuse the whole
        // action. The grant column is a text field anyway (its picker is a
        // widget hint params do not inherit), so nothing is lost.
        // The route writes the grant under the administrator's OWN context in
        // the same transaction as the account: the delegated-administration
        // gate and the catalog name check judge it as they judge Setup's
        // grant form, and a refusal creates no user.
        {
          name: 'permissionSet',
          type: 'text',
          label: 'Permission Set',
          required: false,
          helpText: 'Optional. Grants this permission set to the new user, so they can open their apps on first sign-in.',
        },
      ],
      resultDialog: {
        title: 'User Created',
        // No dialog-level description: it shows on both outcomes, and a typed
        // password returns no `temporaryPassword`, so any copy-it-now sentence
        // there talks about a password that is not on screen. The instruction
        // rides the `temporaryPassword` field's own label instead, which the
        // dialog draws only when the server minted one. Same shape and button
        // as `set_user_password` below.
        acknowledge: 'Done',
        fields: [
          // The dialog skips fields whose path is absent from the response, so
          // conditional keys are safe to declare: phoneNumber only exists for
          // phone-based users, temporaryPassword only when the server minted one.
          { path: 'user.email', label: 'Email', format: 'text' },
          { path: 'user.phoneNumber', label: 'Phone Number', format: 'text' },
          { path: 'permissionSet', label: 'Permission Set', format: 'text' },
          { path: 'temporaryPassword', label: TEMPORARY_PASSWORD_LABEL, format: 'secret' },
        ],
      },
    },
    {
      name: 'set_user_password',
      label: 'Set Password',
      icon: 'key-round',
      variant: 'secondary',
      locations: ['list_item', 'record_header'],
      type: 'api',
      // #2766 V1 — same path as better-auth's stock route, but served by the
      // plugin-auth wrapper registered ahead of the catch-all: it accepts the
      // ADR-0068 platform-admin signals (the stock handler only honors the
      // legacy role scalar), can mint a temporary password, and stamps
      // must_change_password.
      target: '/api/v1/auth/admin/set-user-password',
      // Platform-admin standing (ADR-0068 D4) — see the block header above —
      // and hidden while cloud-managed (`features.cloudManaged`, hide-when-on).
      // Console only: the server keeps answering it on an `env_native` row, so
      // the break-glass admin stays editable (ruling 6341690661, Q4 A).
      visible: 'current_user.isPlatformAdmin == true && features.cloudManaged != true',
      requiresFeature: 'admin',
      recordIdParam: 'userId',
      successMessage: 'Password updated',
      refreshAfter: false,
      // Same one rule as `create_user` above: the new-password field's label
      // ("leave empty to generate") is the whole instruction, and
      // `generatePassword` rides as a constant so an empty field generates.
      bodyExtra: { generatePassword: true },
      params: [
        { name: 'newPassword', label: 'New Password (leave empty to generate)', type: 'password', required: false },
        {
          name: 'mustChangePassword',
          label: 'Require Password Change On Next Login',
          type: 'boolean',
          required: false,
          defaultValue: true,
        },
        {
          // [#23287 — ruling C′ item 2] The forced reset's explicit revocation
          // switch. ON by default: the act records no reason, and the default
          // is the one for a suspected compromise, where a surviving session
          // or API key is exactly what the reset must not leave behind. Turn it
          // off for a routine reset.
          name: 'revokeSessionsAndKeys',
          label: 'Sign Out Everywhere and Revoke API Keys',
          type: 'boolean',
          required: false,
          defaultValue: true,
          helpText:
            'Ends every session of this user and revokes every API key they own. Leave on when the account may be '
            + 'compromised; turn off for a routine reset. Revoked keys stay revoked after the password change.',
        },
      ],
      resultDialog: {
        title: 'Password Updated',
        // No description, for the reason given on `create_user` above.
        acknowledge: 'Done',
        fields: [
          { path: 'temporaryPassword', label: TEMPORARY_PASSWORD_LABEL, format: 'secret' },
        ],
      },
    },
    // #9968 — `set_user_role` (target: /api/v1/auth/admin/set-role) retired
    // from here. Its only effect was `internalAdapter.updateUser(userId, {
    // role })` — a gated, UI-driven writer for the legacy `sys_user.role`
    // scalar ADR-0068 D2 stopped synthesizing. Platform-admin membership is
    // granted through `sys_user_permission_set` / `admin_full_access`; a
    // working "Set Platform Role" button was a supported, one-user-at-a-time
    // resurrection channel for the dual identity representation the
    // 2026-08-18 ruling permanently vetoed (Option 3). Removal, not a
    // narrowed re-implementation — the vendor route itself stays mounted
    // and vendor-gated, unchanged; only this action/button is gone.
    {
      name: 'impersonate_user',
      label: 'Impersonate User',
      icon: 'user-cog',
      variant: 'secondary',
      locations: ['list_item', 'record_header'],
      type: 'api',
      target: '/api/v1/auth/admin/impersonate-user',
      // Platform-admin standing (ADR-0068 D4) — see the block header above.
      visible: 'current_user.isPlatformAdmin == true',
      requiresFeature: 'admin',
      recordIdParam: 'userId',
      successMessage: 'Now impersonating user',
      refreshAfter: true,
      confirmText: 'Start an impersonation session for this user? Use only for legitimate support cases — actions will be logged.',
    },
    {
      // #16678 Phase 2 — set (or re-point) a user's manager. The ruling
      // (decision batch #127 item 1, maintainer 2026-09-13) is verbatim:
      // 「同意 经理 = 管理员在用户上显式设置的 manager_id;部门负责人 = 单元
      // 上的 manager_user_id,两者独立。」 — so this writes `sys_user.manager_id`
      // ONLY, and derives nothing from (and nothing for)
      // `sys_business_unit.manager_user_id`, the Business Unit Head.
      //
      // ⛔ NOT a picker that writes `manager_id` through the generic data API.
      // `sys_user` is `managedBy: 'better-auth'` and the ADR-0092 D2
      // managed-update whitelist is `{name, image, locale}`, so the identity
      // write guard refuses that write — correctly — and the refusal would
      // read as a Console bug. The endpoint below reaches the column by SYSTEM
      // CONTEXT instead, which is why the field keeps `readonly: true` and no
      // Tier-1 list moves (`plugin-auth/src/admin-set-user-manager.ts`).
      //
      // Every refusal — self-assignment, cycle, depth, cross-organization and
      // directory-owned identity — is enforced AT THE WRITE and surfaces from
      // there. ⛔ No second copy of any of them is declared here: the
      // endpoint's `applyUserManagerLink` is the ONE derivation (the bulk
      // importer already routes onto it rather than re-deriving), and a
      // client-side duplicate is the drift, not the safety net.
      //
      // ⛔ No `requiresFeature: 'admin'`, deliberately — the ONE key where
      // this action departs from its `unlock_user` / `set_user_password`
      // precedent, and the reason is the gate's own: the block header above
      // gates those on `admin` because they hit endpoints "only wired when
      // `auth.plugins.admin` is enabled", i.e. to avoid rendering a button
      // that 404s. This route is not one of them — it is an ObjectStack mount
      // registered unconditionally beside `unlock-user` (`auth-plugin.ts`)
      // and authorized by the ADR-0068 platform-admin gate
      // (`judgePlatformAdmin`), never by the better-auth admin plugin. So
      // `features.admin == true` would hide a working affordance on every host
      // that has not opted into that plugin — precisely the population #16678
      // measured as having no write surface for this column at all.
      name: 'set_user_manager',
      label: 'Set Manager',
      icon: 'network',
      variant: 'secondary',
      locations: ['list_item', 'record_header'],
      type: 'api',
      target: '/api/v1/auth/admin/set-user-manager',
      recordIdParam: 'userId',
      successMessage: 'Manager updated',
      refreshAfter: true,
      // Hidden for a directory-managed identity, whose manager the IdP owns:
      // the endpoint's refusal 5 answers 403 / `idp_provisioned`, so the
      // button would be an affordance the server side refuses by design.
      // This carries the SAME `record.source` term the three self-service
      // identity actions below carry — and only that term: this is an admin
      // action on someone else's row, so their `record.id == ctx.user.id`
      // half is deliberately NOT copied (it would hide the button from every
      // admin). `has()` per operand for the sparse action face (#8990) — the
      // rationale is on the self-service block below.
      //
      // ANDed ahead of it, the platform-admin standing the door's gate judges
      // (ADR-0068 D4, the admin block header above): without it the button
      // was offered to every caller who could open a user row, and the door
      // refused each one 403 `PERMISSION_DENIED`. One flat conjunction, the
      // principal term first, the way the self-service predicates below lead
      // with theirs.
      visible: 'current_user.isPlatformAdmin == true && has(record.source) && record.source != "idp_provisioned"',
      // The action collects a param, so its explanatory line rides
      // `description` and ⛔ never `confirmText` — pairing the two shows two
      // dialogs for one decision (#7278/#7309).
      description: "Set this user's manager. The reporting chain drives approval routing and the own_and_reports record scope.",
      params: [
        {
          // INLINE, not field-backed. A field-backed `{ field: 'manager_id' }`
          // param inherits the referenced field's metadata, and that field is
          // `readonly: true` (ADR-0092 D4 — it must stay non-editable in the
          // standard edit form), so inheriting it here is a picker that may
          // render read-only. `name` is the request-body key, and it is the
          // camelCase spelling the endpoint reads first (`readId(body,
          // 'managerId', 'manager_id')`).
          name: 'managerId',
          label: 'Manager',
          type: 'lookup',
          reference: 'sys_user',
          // Required, because the endpoint refuses an ABSENT or empty key by
          // design — "managerId is required — send null to clear the link,
          // never omit the key" — so a dialog that could submit nothing would
          // turn a normal click into a 400 about a key the user never saw.
          // Required means a value is collected before anything is POSTed.
          // ⚠️ Clearing the link (`managerId: null`) is a real endpoint
          // capability that this action therefore does not reach; it is
          // recorded in the PR's acceptance notes rather than half-declared
          // here.
          required: true,
          helpText: 'The user this person reports to. The server refuses a manager outside their organization, a self-assignment, and a link that would close or over-deepen the reporting chain.',
        },
      ],
    },

    // ── Self-service actions (the row owner only) ─────────────────────
    //
    // These four actions are the "account settings" surfaces the standalone
    // Account SPA used to own (`/account/profile`, `/account/security`).
    // They are visible only when the current row is the signed-in user —
    // i.e. opened from the user's own detail page or a "My Account" view —
    // via the `visible` CEL predicate. Admin equivalents (set_user_password
    // for any account) are above and stay separate.
    //
    // Each predicate opens with `has()` per operand for the SPARSE action face
    // (#8990): the action binding is whatever record the client already
    // fetched, so a column the caller did not project is ABSENT, and CEL
    // aborts the whole expression at key resolution (`No such key: source`)
    // rather than reading null. The fault is fail-closed, so the button just
    // stops being offered — indistinguishable from the gate saying no.
    // `has()` alone is the guard here and the `!= null` half is deliberately
    // NOT added: every operand below is compared by bare equality against a
    // literal, and CEL compares heterogeneously, so a projected-null column
    // answers false instead of faulting (measured). The canonical rule lives
    // on `materializeDeclaredFields` in `@objectstack/objectql`; the second
    // half is required only before traversal, a method call, ordering or
    // arithmetic.
    {
      name: 'update_my_profile',
      label: 'Update Profile',
      icon: 'user-pen',
      variant: 'primary',
      mode: 'edit',
      locations: ['record_header'],
      type: 'api',
      target: '/api/v1/auth/update-user',
      visible: 'has(record.id) && record.id == ctx.user.id',
      successMessage: 'Profile updated',
      refreshAfter: true,
      params: [
        { field: 'name', required: false, defaultFromRow: true },
        { field: 'image', required: false, defaultFromRow: true },
      ],
    },
    {
      name: 'change_my_password',
      label: 'Change Password',
      icon: 'key',
      variant: 'secondary',
      locations: ['record_header', 'record_more', 'record_section'],
      type: 'api',
      target: '/api/v1/auth/change-password',
      // Managed (IdP-provisioned) users hold no local credential — hide the
      // password form so they can't self-mint a password that bypasses
      // enforced SSO. The break-glass owner (env-native, or flipped back when
      // their break-glass password is set) keeps it. ADR-0135 D4/D5.2.
      visible: 'has(record.id) && record.id == ctx.user.id && has(record.source) && record.source != "idp_provisioned"',
      successMessage: 'Password changed',
      refreshAfter: false,
      params: [
        { name: 'currentPassword', label: 'Current Password', type: 'password', required: true },
        { name: 'newPassword', label: 'New Password', type: 'password', required: true },
        { name: 'revokeOtherSessions', label: 'Sign out other devices', type: 'boolean', required: false, defaultValue: true },
      ],
    },
    {
      name: 'change_my_email',
      label: 'Change Email',
      icon: 'mail',
      variant: 'secondary',
      locations: ['record_header', 'record_more', 'record_section'],
      type: 'api',
      target: '/api/v1/auth/change-email',
      // A managed user's email is owned by the IdP — a local change would
      // desync. Hide for IdP-provisioned; env-native users keep it.
      visible: 'has(record.id) && record.id == ctx.user.id && has(record.source) && record.source != "idp_provisioned"',
      successMessage: 'Verification email sent — check the new address to confirm.',
      refreshAfter: false,
      params: [
        { name: 'newEmail', label: 'New Email', type: 'email', required: true },
      ],
    },
    {
      name: 'resend_verification_email',
      label: 'Resend Verification Email',
      icon: 'mail-check',
      variant: 'secondary',
      locations: ['record_header', 'record_more', 'record_section'],
      type: 'api',
      target: '/api/v1/auth/send-verification-email',
      // Only render for the row owner AND when their email is still
      // unverified — there's nothing to resend once verified.
      visible: 'has(record.id) && record.id == ctx.user.id && has(record.email_verified) && record.email_verified == false',
      successMessage: 'Verification email sent — check your inbox.',
      refreshAfter: false,
      params: [],
    },
    {
      name: 'delete_my_account',
      label: 'Delete My Account',
      icon: 'user-x',
      variant: 'danger',
      mode: 'delete',
      locations: ['record_more', 'record_section'],
      type: 'api',
      target: '/api/v1/auth/delete-user',
      // Self-delete needs a local password; managed users are deprovisioned
      // via the IdP (org-removal / SCIM), not local self-service. Hide for them.
      visible: 'has(record.id) && record.id == ctx.user.id && has(record.source) && record.source != "idp_provisioned"',
      // Confirm question on `description` — one dialog, not two (#7278/#7309).
      description: 'Permanently delete your account? This cannot be undone — all your sessions will be terminated and all data you own will be removed per the configured retention policy.',
      successMessage: 'Account deleted',
      refreshAfter: false,
      params: [
        { name: 'password', label: 'Current Password', type: 'password', required: true },
      ],
    },
    // ── Two-factor authentication ─────────────────────────────────
    // These three are the ONLY 2FA surface a user can actually reach: the
    // `sys_two_factor` variants that carry the same declarations are mounted
    // in no app (`setup-nav.contributions.ts` has no `sys_two_factor` entry),
    // so this record page — Setup → People & Organization → Users, Security
    // tab, via `record:quick_actions { location: 'record_section' }` in
    // `pages/sys-user.page.ts` — is where these run in production.
    //
    // Both `enable` and `generate-backup-codes` return values that CANNOT be
    // retrieved afterwards: better-auth mints backup codes and stores only
    // `symmetricEncrypt(JSON.stringify(codes))` (its `twoFactor()` default is
    // `storeBackupCodes: 'encrypted'`, which we do not override), and it
    // publishes no re-reveal route — `auth-route-ledger.ts` lists
    // `generate-backup-codes` and nothing that reads them back. So the
    // response is the user's ONE sight of these values, and a `successMessage`
    // toast discards them: the old codes are already dead by then, which turns
    // the reachable path into a lockout. `resultDialog` is what makes the
    // one-shot reveal an actual reveal — the runtime suppresses the toast and
    // opens an acknowledge-only dialog instead. Same shape as the
    // `sys_two_factor` declarations; deliberately not a fourth spelling.
    {
      name: 'enable_two_factor',
      label: 'Enable Two-Factor Auth',
      icon: 'shield-plus',
      variant: 'primary',
      locations: ['record_section'],
      type: 'api',
      target: '/api/v1/auth/two-factor/enable',
      visible: 'has(record.id) && record.id == ctx.user.id && has(record.two_factor_enabled) && record.two_factor_enabled != true',
      requiresFeature: 'twoFactor',
      refreshAfter: true,
      params: [
        { name: 'password', label: 'Current Password', type: 'password', required: true },
      ],
      // No `successMessage`: `resultDialog` suppresses it, so one declared
      // here would be unreachable text that still ships to every translator.
      resultDialog: {
        title: 'Two-factor authentication enabled',
        description: 'Scan the QR code with your authenticator app, then save the backup codes somewhere safe. The backup codes are shown only once.',
        acknowledge: 'I have saved my backup codes',
        fields: [
          { path: 'totpURI', label: 'Authenticator URI', format: 'qrcode' },
          { path: 'backupCodes', label: 'Backup Codes', format: 'code-list' },
        ],
      },
    },
    {
      name: 'disable_two_factor',
      label: 'Disable Two-Factor Auth',
      icon: 'shield-off',
      variant: 'danger',
      locations: ['record_section'],
      type: 'api',
      target: '/api/v1/auth/two-factor/disable',
      visible: 'has(record.id) && record.id == ctx.user.id && has(record.two_factor_enabled) && record.two_factor_enabled == true',
      requiresFeature: 'twoFactor',
      // Confirm question on `description` — one dialog, not two (#7278/#7309).
      description: 'Turn off two-factor authentication? Your account will be less secure.',
      successMessage: 'Two-factor authentication disabled.',
      refreshAfter: true,
      params: [
        { name: 'password', label: 'Current Password', type: 'password', required: true },
      ],
    },
    {
      name: 'generate_backup_codes',
      label: 'Regenerate Backup Codes',
      icon: 'list-restart',
      variant: 'secondary',
      locations: ['record_section'],
      type: 'api',
      target: '/api/v1/auth/two-factor/generate-backup-codes',
      visible: 'has(record.id) && record.id == ctx.user.id && has(record.two_factor_enabled) && record.two_factor_enabled == true',
      requiresFeature: 'twoFactor',
      // Confirm question on `description` — one dialog, not two (#7278/#7309).
      // The confirm dialog and the reveal dialog are NOT that pair: they are
      // two different moments (decide, then save), which is exactly the shape
      // `sys_two_factor.regenerate_backup_codes` already carries.
      description: 'Generate a new set of backup codes? Any previously generated codes will stop working.',
      refreshAfter: false,
      params: [
        { name: 'password', label: 'Current Password', type: 'password', required: true },
      ],
      // No `successMessage` — see the note above `enable_two_factor`. The toast
      // this replaces ("New backup codes generated — save them somewhere safe")
      // told the user to save codes it never showed them.
      resultDialog: {
        title: 'New backup codes generated',
        description: 'Previous backup codes are now invalid. Save these new codes somewhere safe — they are shown only once.',
        acknowledge: 'I have saved the new codes',
        fields: [
          { path: 'backupCodes', label: 'Backup Codes', format: 'code-list' },
        ],
      },
    },
  ],

  listViews: {
    // [#21972] Declared FIRST on purpose: a route that names no view opens the
    // first declared list view — Setup's Users entry, which names this view
    // explicitly (#21960), and the bare-object doors (the record page's
    // object breadcrumb, the object switcher), which name none. So the
    // caller-scoped `me` is never first.
    all_users: {
      type: 'grid',
      name: 'all_users',
      label: 'All Users',
      data: { provider: 'object', object: 'sys_user' },
      // No `two_factor_enabled` column here or in `me` (#25287): a list column
      // has no feature gate, and on a deployment with 2FA off (the default)
      // it read a dead "No" on every row. The state is shown on the user's
      // own record page, in the Security tab, behind the `twoFactor` gate.
      // `banned` and `role` sit beside the email so a banned user or an
      // admin is spotted from the list, without opening each record.
      columns: ['name', 'email', 'phone_number', 'email_verified', 'banned', 'role', 'source', 'created_at'],
      sort: [{ field: 'name', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
    // The caller's own row, as a tab of this object's view switcher.
    // Filtered to a single row via the `{current_user_id}` template
    // variable — presentation scope only; which other users' rows a caller
    // may read is RLS's decision (`member_default` admits the caller's own
    // row and their organization's users). No navigation entry names this
    // view: the Account App's profile entry is the `account:profile_card`
    // component (`account.app.ts`), which reads the signed-in user from the
    // session, not from this list.
    me: {
      type: 'grid',
      name: 'me',
      label: 'My Profile',
      data: { provider: 'object', object: 'sys_user' },
      columns: ['name', 'email', 'phone_number', 'email_verified', 'updated_at'],
      filter: [{ field: 'id', operator: 'equals', value: '{current_user_id}' }],
      sort: [{ field: 'name', order: 'asc' }],
      pagination: { pageSize: 1 },
    },
    unverified: {
      type: 'grid',
      name: 'unverified',
      label: 'Unverified',
      data: { provider: 'object', object: 'sys_user' },
      columns: ['name', 'email', 'created_at'],
      filter: [{ field: 'email_verified', operator: 'equals', value: false }],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
    // No "2FA Enabled" view (#25287): a list view has no feature gate, so on
    // a deployment with 2FA off it was a tab that could only ever be empty.
    // Retired rather than gated — gating it would need a new authorable key.
    banned: {
      type: 'grid',
      name: 'banned',
      label: 'Banned',
      data: { provider: 'object', object: 'sys_user' },
      columns: ['name', 'email', 'banned', 'ban_reason', 'ban_expires'],
      filter: [{ field: 'banned', operator: 'equals', value: true }],
      sort: [{ field: 'updated_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
  },

  // [ADR-0095 D1, 2026-10-18 note] This object's default row scope: plugin-security's
  // shipped permission sets carry TWO policies for it (`sys_user_self` and
  // `sys_user_org_members` in `default-permission-sets.ts`), and the key holds one, so
  // the two predicates are joined with `||` here: a principal reads its own row plus its
  // organization's members. Layer 0 is inert on this table (no organization column), so
  // Layer 1 silence means this scope, not no filter. `select`, the operation both arms
  // share in the organization-admin and viewer sets: the peer arm must never reach a
  // write, because OR-combined under `all` it would let a member edit any colleague's
  // profile. The baseline set's self-service write scope (`sys_user_self` under `all`)
  // stays the set's own policy. The rows are the union of the two arms whenever
  // `current_user.org_user_ids` is resolved, which every user-context producer does
  // (ruling A′ on #24449: the request's core resolver, and the seeding of a `runAs:
  // 'user'` flow run and hook; `[userId]` with no organization); unresolved, which only
  // a grants-resolver failure leaves (or a flow run suspended before its run setup
  // seeded the list), the whole predicate fails closed, own row included. The security
  // plugin's row-policy collection applies it when no set the caller holds carries a row
  // policy for the object and operation; the shipped sets still carry both literals, so
  // their holders read as before. An `extend` contribution cannot set or loosen it
  // (refused at registration).
  defaultRowScope: {
    name: 'sys_user_self_or_org_members',
    operation: 'select',
    using: 'id == current_user.id || id in current_user.org_user_ids',
  },

  fields: {
    // ── Identity (primary business fields) ───────────────────────
    name: Field.text({
      label: 'Name',
      required: true,
      searchable: true,
      maxLength: 255,
      group: 'Identity',
    }),

    // ADR-0092 D4 — with the generic edit affordance open, every non-profile
    // field is readonly so the standard edit form renders it non-editable.
    // This is UX only; the server boundary is the plugin-auth identity write
    // guard (ADR-0092 D2), which strips/rejects these regardless.
    email: Field.email({
      label: 'Email',
      required: true,
      readonly: true, // login identity — change flows through better-auth change-email verification
      searchable: true,
      group: 'Identity',
    }),

    email_verified: Field.boolean({
      label: 'Email Verified',
      defaultValue: false,
      readonly: true,
      group: 'Identity',
    }),

    two_factor_enabled: Field.boolean({
      label: 'Two-Factor Enabled',
      defaultValue: false,
      readonly: true,
      group: 'Identity',
      description: 'Whether two-factor authentication is enabled for this user. Maintained by the better-auth `twoFactor` plugin.',
    }),

    // ── Admin (managed by better-auth `admin` plugin when enabled) ───
    role: Field.text({
      label: 'Platform Role',
      required: false,
      readonly: true, // ADR-0092 — never the edit form; no writer since #9968 (platform admin: `sys_user_permission_set` / `admin_full_access`)
      maxLength: 64,
      group: 'Admin',
      // ADR-0068 D2 stopped writing this scalar; the reference stays here, not in the copy.
      description:
        'Legacy better-auth role scalar (admin, user, …). ObjectStack no longer writes it. To grant platform-admin standing, list the user\'s verified email in `OS_PLATFORM_OWNER_EMAIL`; under the `single` tenancy posture an unscoped `admin_full_access` assignment in `sys_user_permission_set` also confers it.',
    }),

    banned: Field.boolean({
      label: 'Banned',
      defaultValue: false,
      readonly: true, // ADR-0092 — toggled via Ban/Unban actions (session side effects)
      group: 'Account',
      description: 'When true, the user cannot sign in. Toggle via Ban User / Unban User actions.',
    }),

    ban_reason: Field.text({
      label: 'Ban Reason',
      required: false,
      readonly: true, // ADR-0092 — written by the Ban User action
      maxLength: 255,
      group: 'Admin',
    }),

    ban_expires: Field.datetime({
      label: 'Ban Expires',
      required: false,
      readonly: true, // ADR-0092 — written by the Ban User action
      group: 'Admin',
      description: 'When set, the ban auto-clears at this time.',
    }),

    // ── Anti-brute-force (ADR-0069 D2) — owned by objectql, better-auth is
    //    oblivious. The auth manager's sign-in hooks maintain these: failures
    //    increment the counter; crossing `lockout_threshold` stamps
    //    `locked_until`; a successful sign-in resets both. Admins can clear
    //    them early via the Unlock action.
    failed_login_count: Field.number({
      label: 'Failed Login Count',
      required: false,
      defaultValue: 0,
      readonly: true,
      group: 'Admin',
      description: 'Consecutive failed sign-in attempts; reset to 0 on success. Maintained by the auth manager.',
    }),

    locked_until: Field.datetime({
      label: 'Locked Until',
      required: false,
      readonly: true,
      group: 'Admin',
      description: 'When set and in the future, sign-in is rejected (brute-force lockout). Auto-clears past this time; an admin can clear it early via Unlock.',
    }),

    // ADR-0069 D1 — last password change; drives password-expiry enforcement.
    // Stamped on sign-up / change-password / reset-password. Null = never
    // expires (until the user next changes their password).
    password_changed_at: Field.datetime({
      label: 'Password Changed At',
      required: false,
      readonly: true,
      group: 'Admin',
      description: 'Timestamp of the last password change. Backs password_expiry_days; system-managed.',
    }),

    // #2766 V1.5 — phone-number sign-in identifier (better-auth phoneNumber
    // plugin, mapped via buildPhoneNumberPluginSchema). Unique when present;
    // null for email-only accounts. Written through better-auth, not CRUD.
    //
    // Declared in the `Admin` group, with `phone_number_verified` below, on
    // purpose: a sign-in identifier is account-administration data, not
    // directory data. The group is the declaration the shipped permission sets
    // read (`identityAdminFieldSecurity` in plugin-security's
    // `default-permission-sets.ts`): the non-admin sets (`member_default`,
    // `viewer_readonly`, `external_default`) mark every group field
    // `readable: false` and the admin sets keep it, so an org member reading
    // the user directory is served a colleague's name and email but not their
    // sign-in phone number. Field-level read security is row-blind (ADR-0066,
    // 2026-10-26 note), so the member's OWN row on the generic data API is
    // withheld it too; the holder's own number is read through auth context
    // (better-auth's session user, which returns both phone fields), as every
    // other group field is. Moving either field out of the group serves it to
    // every org peer again.
    phone_number: Field.text({
      label: 'Phone Number',
      required: false,
      readonly: true,
      searchable: true,
      maxLength: 32,
      group: 'Admin',
      description:
        'Sign-in phone number (E.164 recommended). Unique per user; managed by ' +
        'better-auth when the phoneNumber plugin is enabled.',
    }),

    phone_number_verified: Field.boolean({
      label: 'Phone Verified',
      defaultValue: false,
      readonly: true,
      group: 'Admin', // withheld from org peers with `phone_number` (see the note above it)
      description:
        'Whether the phone number has been verified (OTP verification requires ' +
        'SMS infrastructure; false until that ships). System-managed.',
    }),

    // #2766 V1 — admin-issued "must change password on next sign-in" flag.
    // Set by the /admin/create-user and /admin/set-user-password routes when
    // a temporary password is issued; enforced through the ADR-0069 authGate
    // (surfaces as PASSWORD_RESET_REQUIRED, its own code since #23287 ruling
    // C′ item 2, scope `credential`); cleared by stampPasswordChangedAt once
    // the user completes a password change.
    must_change_password: Field.boolean({
      label: 'Must Change Password',
      defaultValue: false,
      readonly: true,
      group: 'Admin',
      description:
        'When true, the user is blocked (403 PASSWORD_RESET_REQUIRED) until they change ' +
        'their password. Stamped by the admin user-management routes; system-managed.',
    }),

    // ADR-0069 D3 — when enforced MFA first applied to this user; starts the
    // grace clock. Stamped lazily at session validation; system-managed.
    mfa_required_at: Field.datetime({
      label: 'MFA Required At',
      required: false,
      readonly: true,
      group: 'Admin',
      description: 'When enforced MFA first applied to this user (grace-period clock). Backs mfa_required; system-managed.',
    }),

    // ADR-0069 D7 — login audit. Stamped on every successful `/sign-in/email`
    // by the auth manager's after-hook (independent of lockout config). Backs
    // the admin "last seen" surface + anomaly review; system-managed, read-only.
    last_login_at: Field.datetime({
      label: 'Last Login At',
      required: false,
      readonly: true,
      group: 'Admin',
      description: 'Timestamp of the last successful sign-in. Stamped by the auth manager; system-managed.',
    }),

    last_login_ip: Field.text({
      label: 'Last Login IP',
      required: false,
      readonly: true,
      maxLength: 45, // IPv6 max textual length
      group: 'Admin',
      description: 'Client IP of the last successful sign-in (from the trusted proxy forwarded header). System-managed.',
    }),

    ai_access: Field.boolean({
      label: 'AI Access',
      defaultValue: false,
      readonly: true, // ADR-0092 — a licensed-seat grant; flows through the AiSeatPlugin enforcement path
      group: 'Admin',
      // The framework synthesizes the `ai_seat` capability from this flag
      // (plugin-hono-server resolveCtx); the seat cap is enforced by
      // @objectstack/security-enterprise AiSeatPlugin. Owned by objectql
      // (better-auth is oblivious to this column).
      description:
        'Whether this user holds an AI seat. A seat grants the `ai_seat` ' +
        'capability, which opens the AI assistants in the app (build and ask). ' +
        'How many users can hold one is limited by the seats your license includes.',
    }),

    // ── Profile ──────────────────────────────────────────────────
    image: Field.url({
      label: 'Profile Image',
      required: false,
      group: 'Profile',
    }),

    // #13881 — the user's own notification language, a first-class column
    // (maintainer ruling 2026-09-01: 「`sys_user` 加 `locale` 一等列」; the
    // preference-bag shape was rejected, so nothing falls back to
    // sys_user_preference). BCP-47 tag (`zh-CN`, `ja-JP`). Read PER RECIPIENT
    // by the messaging channels after fan-out (`service-messaging/src/
    // recipient-locale.ts` — the one read point), with the deployment default
    // (`II18nService.getDefaultLocale()`) underneath: absent / empty /
    // malformed always falls back, never dead-letters a delivery.
    //
    // Owned by objectql, exactly like `ai_access`: better-auth is oblivious
    // to this column, and it is DELIBERATELY not a better-auth
    // `additionalFields` entry — better-auth SELECTs explicit columns, so
    // declaring it there would make getSession query a column an env that has
    // not yet run schema-sync does not have (the `ai_access` note in
    // auth-manager.ts). Registered as an extension field in plugin-auth's
    // MANAGED_EXTENSION_FIELDS, whose ADR-0105 D7 guard proves the name does
    // not collide with better-auth's own user schema at the pinned version.
    //
    // WRITABLE, and `readonly` is deliberately absent (maintainer ruling
    // 2026-09-03, option B — quoted verbatim and untranslated on the ruling
    // card): 「同意」to widening the ADR-0092 D2 self-service whitelist from
    // {name, image} to {name, image, locale}. The column landed `readonly`
    // three weeks earlier because the whitelist did NOT carry it and a
    // readonly-but-not-whitelisted column would have advertised a write the
    // runtime strips; the ruling moved the whitelist, so the `readonly` that
    // mirrored it goes with it. Option A (system-context writes only) was
    // considered and rejected: it would make every application build its own
    // stamping route for a first-class user attribute.
    //
    // ⚠️ `readonly` here is a UI/strip affordance, never the boundary — the
    // boundary is plugin-auth's identity write guard (ADR-0092 D2), whose
    // whitelist is `SYS_USER_PROFILE_EDIT_FIELDS`. Removing `readonly`
    // without that entry would change nothing; adding that entry without
    // removing `readonly` would strip the value before the guard ever saw it
    // (`stripReadonlyFields` runs on the update path). The two move together
    // or not at all, and `sys-user-locale-write-contract.test.ts` in
    // plugin-auth is what says so out loud.
    //
    // A malformed tag is REFUSED, not stored and not silently dropped: the
    // `locale_bcp47_shape` rule in `validations` below is evaluated
    // server-side on insert, by-id update and bulk update, so the only value
    // that can reach the column is one the delivery-time reader
    // (`service-messaging/src/recipient-locale.ts`) recognises. An unset or
    // cleared column keeps falling back to the deployment default.
    locale: Field.text({
      label: 'Locale',
      required: false,
      maxLength: 35,
      group: 'Profile',
      description:
        'Preferred language for this user\'s notifications, as a language tag such as zh-CN or ja-JP. ' +
        'When unset, the deployment\'s default language applies.',
    }),

    // ── Organization ─────────────────────────────────────────────
    manager_id: Field.lookup('sys_user', {
      label: 'Manager',
      required: false,
      readonly: true, // ADR-0092 — drives own_and_reports RLS scope; org-structure maintenance is its own surface
      group: 'Organization',
      // ADR-0057 / @objectstack/security-enterprise walk this chain.
      description: "This user's direct manager. Forms the reporting chain the `own_and_reports` hierarchy scope walks.",
    }),

    primary_business_unit_id: Field.lookup('sys_business_unit', {
      label: 'Primary Business Unit',
      required: false,
      readonly: true, // ADR-0092 — denormalised projection maintained by plugin-sharing; never hand-edited
      group: 'Organization',
      // ADR-0057 addendum D12 — the projection's design reference.
      description: "The user's primary business unit — a denormalised projection of sys_business_unit_member.is_primary, maintained by plugin-sharing. Lets a user-lookup filter candidates by business unit without traversing the membership junction. Do not edit directly; set it via business-unit membership.",
    }),

    // ── System (auto-managed, hidden from create/edit forms) ─────
    // Identity provenance (ADR-0135 D4). `idp_provisioned` users were
    // JIT-created on first federated login (a `sys_account` exists for an
    // external/OIDC provider — e.g. the cloud-as-IdP `objectstack-cloud`
    // provider, or a customer's own IdP); `env_native` users registered
    // locally (email/password) or are app end-users. Stamped automatically by
    // the AuthManager `account.create.after` hook — never edited by hand.
    // Drives the managed-vs-native user-mgmt UI gating (the password /
    // identity-edit actions hide for managed users, who hold no local
    // credential) and is the marker SCIM lifecycle keys off. Owned by objectql
    // (better-auth is oblivious to this column — like `ai_access`).
    source: Field.select({
      label: 'Identity Source',
      required: false,
      readonly: true,
      group: 'System',
      defaultValue: 'env_native',
      options: [
        { label: 'IdP-Provisioned', value: 'idp_provisioned' },
        { label: 'Env-Native', value: 'env_native' },
      ],
      description: 'How this identity was created — idp_provisioned (federated SSO JIT) or env_native (local signup / app end-user). System-managed; do not edit.',
    }),

    id: Field.text({
      label: 'User ID',
      required: true,
      readonly: true,
      group: 'System',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),
  },

  indexes: [
    { fields: ['email'], unique: 'global' },
    { fields: ['created_at'], unique: false },
    // #2766 V1.5 — phone sign-in identifier; unique when present (null for
    // email-only accounts), also the upsert match key for identity import.
    { fields: ['phone_number'], unique: 'global' },
  ],

  enable: {
    trackHistory: true,
    searchable: true,
    apiEnabled: true,
    // Setup's identity records are not discussion surfaces (objectui#12614 item 1):
    // no Discussion feed, and a comment create on one answers 403 FEEDS_DISABLED.
    feeds: false,
    // #1591 — create/delete are refused by the identity write guard
    // (ADR-0092 D2) and owned by better-auth (Invite / Create User / admin
    // actions), so they are not exposed. `update` stays: it is the ONE
    // generic write opened on an identity table (ADR-0092 D4), server-side
    // clamped to the profile-field whitelist ({name, image, locale}) by the guard —
    // `userActions.edit: true` above declares the affordance. `bulk` grants the
    // updateMany surface (bulk ∧ update after #3391); paired with the sole
    // `update` write, only bulk-update is admitted (createMany/deleteMany still
    // 405). `bulk` is a primitive — a permanent, legitimate declaration.
    apiMethods: ['get', 'list', 'update', 'bulk'],
  },

  // Email uniqueness is enforced by the unique index above (and better-auth's
  // managed user table). A declarative `unique` validation rule is intentionally
  // not used — uniqueness needs a DB lookup, not a synchronous validation, so it
  // is not one of the declarable validation-rule types.
  //
  // What IS declarable — and is the whole reason this array exists — is the
  // shape of a column a user may now set for themselves.
  validations: [
    {
      // The loud half of the 2026-09-03 ruling that made `locale` writable:
      // "a malformed value is refused loudly … and never dead-letters a
      // notification". Enforcement, not decoration — objectql's rule validator
      // runs `validations` on insert, by-id update AND bulk update, so there is
      // no write shape that reaches the column without passing here.
      //
      // Why a `format` rule and not a field-level flag: field-level `readonly`
      // is a strip, `maxLength` bounds length only, and the field schema's
      // `format` key is authoring metadata no write path reads. The object's
      // `validations` array is the platform's one server-enforced channel for
      // "this column's values must look like X" (ADR-0049 declared = enforced).
      //
      // An absent, null or empty value is NOT a violation (`checkFormat`
      // returns early) — clearing the column is how a user goes back to the
      // deployment default, which the ruling preserves as the fallback for an
      // unset column.
      type: 'format',
      name: 'locale_bcp47_shape',
      field: 'locale',
      regex: SYS_USER_LOCALE_TAG_PATTERN,
      severity: 'error',
      message: 'Locale must be a BCP-47 language tag, such as zh-CN or ja-JP.',
    },
  ],
});
