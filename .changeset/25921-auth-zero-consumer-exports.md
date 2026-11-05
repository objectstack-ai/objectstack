---
'@object-ui/auth': patch
---

refactor(auth)!: retire twelve zero-consumer exports (the Turnstile script URL, the two phone-identifier helpers, the authenticated-fetch options type, the org-role list, the invitation-status list and guard, and five form primitives)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/auth#TURNSTILE_SCRIPT_URL, @object-ui/auth#normalizePhoneIdentifier, @object-ui/auth#looksLikePhoneIdentifier, @object-ui/auth#AuthenticatedAdapterOptions, @object-ui/auth#ORG_ROLES, @object-ui/auth#AUTH_INVITATION_STATUSES, @object-ui/auth#isAuthInvitationStatus, @object-ui/auth#AUTH_FIELD_LABEL_CLASS, @object-ui/auth#AUTH_INPUT_CLASS, @object-ui/auth#AuthCheckIcon, @object-ui/auth#AuthDivider, @object-ui/auth#AuthMailIcon) the retired operands are a script URL constant, two sign-in identifier helpers, an options interface, two closed vocabulary lists with one narrowing guard, two class-name strings and three presentational components; nothing in the workspace or in hotcrm imports any of them from the package entry, and no packages/spec schema, registered node type, conversion surface or stored shape names them, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports any of these twelve names from `@object-ui/auth`. None had an importer anywhere in the workspace or in hotcrm, so the Console and every `@object-ui/*` package are unaffected. Every module stays in the package: `TurnstileWidget` keeps loading its script, `LoginForm` keeps reading phone identifiers, `createAuthClient` keeps narrowing invitation statuses, `org-roles.ts` keeps building its pickers from the role list, and `LoginForm` / `RegisterForm` / `ForgotPasswordForm` keep drawing with the form primitives. Only the entry stops publishing them. `TurnstileWidget`, `createAuthenticatedFetch`, `ORG_ROLE_OWNER` / `ORG_ROLE_ADMIN` / `ORG_ROLE_DELEGATED_ADMIN` / `ORG_ROLE_MEMBER`, `ORG_ROLE_LABELS`, `orgRoleGrade`, `invitableOrgRoles`, `assignableOrgRoles`, the `OrgRole` and `AuthInvitationStatus` types, `AUTH_LINK_CLASS`, `AUTH_PRIMARY_BUTTON_CLASS`, `AuthAlertIcon`, `AuthErrorBanner`, `AuthFormHeader` and `AuthSpinner` stay exported unchanged.

What leaves, and what to write instead:

- FROM `TURNSTILE_SCRIPT_URL` TO `TurnstileWidget`, which loads the Cloudflare Turnstile script itself.
- FROM `normalizePhoneIdentifier`, `looksLikePhoneIdentifier` TO `LoginForm`, which accepts a phone number as the identifier and normalizes it; keep a local copy if your own sign-in form needs them.
- FROM `AuthenticatedAdapterOptions` TO a local interface: no function in the package takes it (`createAuthenticatedFetch` has its own options).
- FROM `ORG_ROLES` TO `invitableOrgRoles` / `assignableOrgRoles` for the roles a picker offers, or the four `ORG_ROLE_*` constants.
- FROM `AUTH_INVITATION_STATUSES`, `isAuthInvitationStatus` TO the `AuthInvitationStatus` type; `AuthInvitation.status` already arrives narrowed from `createAuthClient`.
- FROM `AUTH_FIELD_LABEL_CLASS`, `AUTH_INPUT_CLASS`, `AuthCheckIcon`, `AuthDivider`, `AuthMailIcon` TO no replacement: the built-in forms apply them themselves; copy the class strings or icons if a custom form needs the same look.
