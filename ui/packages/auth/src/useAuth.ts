/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useContext } from 'react';
import { AuthCtx, type AuthContextValue } from './AuthContext.js';

/**
 * Hook to access authentication state and methods.
 * Must be used within an AuthProvider.
 *
 * @example
 * ```tsx
 * function UserProfile() {
 *   const { user, isAuthenticated, signOut } = useAuth();
 *   if (!isAuthenticated) return null;
 *   return <span>{user.name}</span>;
 * }
 * ```
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthCtx);

  if (!ctx) {
    // Return a safe default when used outside AuthProvider
    return {
      user: null,
      session: null,
      isAuthenticated: false,
      isAuthEnabled: false,
      isLoading: false,
      error: null,
      isPreviewMode: false,
      previewMode: null,
      signIn: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      signUp: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      signOut: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      refreshSession: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      updateUser: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      forgotPassword: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      sendVerificationEmail: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      resetPassword: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      sendPhoneOtp: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      signInWithPhoneOtp: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      signInWithPhonePassword: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      requestPhonePasswordReset: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      resetPasswordWithPhoneOtp: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      changePassword: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      remediationRequired: null,
      setRemediationRequired: () => { /* no-op outside a provider */ },
      enrollTotp: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      verifyTotp: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      setInitialPassword: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      hasLocalPassword: async () => false,
      getAuthConfig: async () => ({}),
      describeDelegableScope: async () => null,
      signInWithProvider: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      organizations: [],
      activeOrganization: null,
      activeMember: null,
      isOrganizationsLoading: false,
      // Nothing to resolve without a provider — same reasoning as `isLoading`
      // above, which is `false` here for the same reason. A consumer gating on
      // this must render through in a provider-less embed, not hang.
      isMembershipResolved: true,
      switchOrganization: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      createOrganization: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      refreshOrganizations: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      updateOrganization: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      deleteOrganization: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      leaveOrganization: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      getMembers: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      inviteMember: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      removeMember: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      updateMemberRole: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      listInvitations: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      cancelInvitation: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      getInvitation: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      acceptInvitation: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      rejectInvitation: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
      listUserInvitations: async () => { throw new Error('useAuth must be used within an AuthProvider'); },
    };
  }

  return ctx;
}
