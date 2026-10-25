/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { useAuth } from './useAuth.js';
import { getUserInitials } from './types.js';

export interface UserMenuProps {
  /** Custom avatar URL override */
  avatarUrl?: string;
  /** Callback for profile navigation */
  onProfile?: () => void;
  /** Callback for settings navigation */
  onSettings?: () => void;
  /** Custom menu items */
  children?: React.ReactNode;
}

/**
 * User menu component displaying the authenticated user's info.
 * Shows avatar, name, email, and common actions (profile, settings, sign out).
 *
 * This is a headless component that provides the user data and actions.
 * The actual dropdown rendering is handled by the consumer.
 *
 * @example
 * ```tsx
 * <UserMenu onProfile={() => navigate('/profile')} />
 * ```
 */
export function UserMenu({
  avatarUrl,
  onProfile,
  onSettings,
}: UserMenuProps) {
  const { user, signOut, isAuthenticated } = useAuth();

  if (!isAuthenticated || !user) {
    return null;
  }

  const initials = getUserInitials(user);

  const imageUrl = avatarUrl ?? user.image;

  return (
    <div className="flex items-center gap-2 text-left text-sm">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground overflow-hidden">
        {imageUrl ? (
          <img src={imageUrl} alt={user.name} className="h-full w-full object-cover" />
        ) : (
          <span className="text-xs font-medium">{initials}</span>
        )}
      </div>
      <div className="grid flex-1 leading-tight">
        <span className="truncate font-semibold">{user.name}</span>
        <span className="truncate text-xs text-muted-foreground">{user.email}</span>
      </div>
      {(onProfile || onSettings) && (
        <div className="flex items-center gap-1">
          {onProfile && (
            <button
              type="button"
              onClick={onProfile}
              className="rounded-md p-1 text-muted-foreground hover:text-foreground"
              aria-label="Profile"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </button>
          )}
          {onSettings && (
            <button
              type="button"
              onClick={onSettings}
              className="rounded-md p-1 text-muted-foreground hover:text-foreground"
              aria-label="Settings"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={() => signOut()}
        className="rounded-md p-1 text-muted-foreground hover:text-destructive"
        aria-label="Sign out"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
      </button>
    </div>
  );
}
