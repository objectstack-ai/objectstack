/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/auth
 *
 * Authentication system for Object UI providing:
 * - AuthProvider context for React apps
 * - useAuth hook for accessing auth state and methods
 * - AuthGuard component for route protection
 * - LoginForm, RegisterForm, ForgotPasswordForm UI components
 * - UserMenu component for authenticated user display
 * - createAuthClient factory for auth backend integration
 * - createAuthenticatedFetch for DataSource token injection
 *
 * @packageDocumentation
 */

export { AuthProvider, type AuthProviderProps } from './AuthProvider.js';
export { useAuth } from './useAuth.js';
// objectui#5619 — replaces `useIsWorkspaceAdmin(): boolean`, which had no way
// to say "not resolved yet" and so answered "not an admin" about an
// administrator whose adminship lives only in the active member row. The old
// name is REMOVED rather than kept alongside: a caller that misses the third
// state is the whole defect, and a deleted export makes that a compile error
// instead of a silent access-denied screen.
export { useWorkspaceAdminStatus, type WorkspaceAdminStatus } from './useWorkspaceAdminStatus.js';
export { AuthGuard, type AuthGuardProps } from './AuthGuard.js';
export { AuthShell, type AuthShellProps, type AuthShellBrandPanel } from './AuthShell.js';
export { LoginForm, type LoginFormProps, type LoginFormLabels } from './LoginForm.js';
export { RegisterForm, type RegisterFormProps, type RegisterFormLabels } from './RegisterForm.js';
export { ForgotPasswordForm, type ForgotPasswordFormProps, type ForgotPasswordFormLabels } from './ForgotPasswordForm.js';
export { SocialSignInButtons, type SocialSignInButtonsProps } from './SocialSignInButtons.js';
export { UserMenu, type UserMenuProps } from './UserMenu.js';
export { PreviewBanner, type PreviewBannerProps } from './PreviewBanner.js';
export { createAuthClient, TokenStorage } from './createAuthClient.js';
export { normalizePhoneIdentifier, looksLikePhoneIdentifier } from './phone-identifier.js';
export { createAuthenticatedFetch, ActiveOrganizationStorage, type AuthenticatedAdapterOptions } from './createAuthenticatedFetch.js';
// objectui#10193 — "the browser changed hands in this page-load". The purge on a
// change of session user clears storage; state already derived from it in
// memory (the UI language, first of all) is re-derived by whoever owns it, and
// these two are how that owner finds out — including one that mounts after the
// purge fired.
export { getSessionOwnerChangeCount, subscribeSessionOwnerChange } from './ActiveOrganizationStorage.js';
export { getUserInitials } from './types.js';

// Organization membership-role vocabulary — a CLOSED, framework-owned list of
// four (framework ADR-0108), re-exported from `@objectstack/spec`'s
// `BUILTIN_MEMBERSHIP_ROLES` so it cannot drift — plus the labels and
// narrowing helpers every org screen shares, which stay console-owned
// (see `org-roles.ts` for the boundary).
export {
  ORG_ROLE_OWNER,
  ORG_ROLE_ADMIN,
  ORG_ROLE_DELEGATED_ADMIN,
  ORG_ROLE_MEMBER,
  ORG_ROLES,
  ORG_ROLE_LABELS,
  orgRoleGrade,
  invitableOrgRoles,
  assignableOrgRoles,
  type OrgRole,
} from './org-roles.js';

// Invitation lifecycle vocabulary — a CLOSED set of four, bound to better-auth's
// own `InvitationStatus` so it cannot drift, plus the narrowing guard the wire
// boundary uses. Exported because a screen switching on `AuthInvitation.status`
// needs the union by name (objectui#3879).
export {
  AUTH_INVITATION_STATUSES,
  isAuthInvitationStatus,
  type AuthInvitationStatus,
} from './invitation-status.js';

// Shared auth form primitives — exposed so consumers can build custom forms
// that match the look of LoginForm / RegisterForm / ForgotPasswordForm.
export {
  AUTH_FIELD_LABEL_CLASS,
  AUTH_INPUT_CLASS,
  AUTH_LINK_CLASS,
  AUTH_PRIMARY_BUTTON_CLASS,
  AuthAlertIcon,
  AuthCheckIcon,
  AuthDivider,
  AuthErrorBanner,
  AuthFormHeader,
  AuthMailIcon,
  AuthSpinner,
} from './authStyles.js';

// Re-export types for convenience
export type {
  AuthUser,
  AuthClientSession,
  AuthState,
  AuthClient,
  AuthClientConfig,
  AuthLinkComponentProps,
  AuthProviderOptions,
  PreviewModeOptions,
  SignInCredentials,
  SignUpData,
  AuthOrganization,
  AuthOrganizationMember,
  AuthInvitation,
  AuthSocialProvider,
  AuthPublicConfig,
  SignInWithProviderOptions,
  TenancyPosture,
  DelegableScope,
} from './types.js';

export type { AuthContextValue } from './AuthContext.js';
