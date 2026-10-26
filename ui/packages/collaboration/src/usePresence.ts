/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

export interface PresenceUser {
  userId: string;
  userName: string;
  avatar?: string;
  color: string;
  cursor?: { x: number; y: number; elementId?: string };
  selection?: { start: number; end: number; elementId?: string };
  status: 'active' | 'idle' | 'away';
  lastActivity: string;
}

export interface PresenceConfig {
  /** Current user info */
  user: { id: string; name: string; avatar?: string };
  /** Update throttle in ms (default: 50) */
  throttleMs?: number;
  /** Idle timeout in ms (default: 60000) */
  idleTimeout?: number;
  /** Away timeout in ms (default: 300000) */
  awayTimeout?: number;
}

export interface PresenceResult {
  /** All users present (excluding current user) */
  users: PresenceUser[];
  /** Total user count (including current) */
  userCount: number;
  /** Update current user's cursor position */
  updateCursor: (position: { x: number; y: number; elementId?: string }) => void;
  /** Update current user's selection */
  updateSelection: (selection: { start: number; end: number; elementId?: string }) => void;
  /** Current user's presence data */
  currentUser: PresenceUser;
}

/** Deterministic color assignment based on user ID */
function userIdToColor(userId: string): string {
  const colors = [
    '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
    '#1abc9c', '#e67e22', '#2980b9', '#27ae60', '#8e44ad',
    '#d35400', '#c0392b', '#16a085', '#f1c40f', '#7f8c8d',
  ];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  }
  return colors[Math.abs(hash) % colors.length];
}

/**
 * Hook for live cursors and presence tracking.
 *
 * Tracks cursor position with throttled updates, detects idle/away status
 * through activity monitoring, and manages a set of remote users.
 *
 * @param sendPresence - Callback to broadcast presence updates to other users
 * @param config - Presence configuration
 */
export function usePresence(
  sendPresence: (user: PresenceUser) => void,
  config: PresenceConfig,
): PresenceResult {
  const {
    user,
    throttleMs = 50,
    idleTimeout = 60000,
    awayTimeout = 300000,
  } = config;

  const color = useMemo(() => userIdToColor(user.id), [user.id]);

  const [remoteUsers, setRemoteUsers] = useState<Map<string, PresenceUser>>(new Map());
  const [currentUser, setCurrentUser] = useState<PresenceUser>(() => ({
    userId: user.id,
    userName: user.name,
    avatar: user.avatar,
    color,
    status: 'active',
    lastActivity: new Date().toISOString(),
  }));

  const lastSendRef = useRef(0);
  const activityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const awayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentUserRef = useRef(currentUser);
  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);
  const sendPresenceRef = useRef(sendPresence);
  useEffect(() => {
    sendPresenceRef.current = sendPresence;
  }, [sendPresence]);

  const throttledSend = useCallback((updated: PresenceUser) => {
    const now = Date.now();
    if (now - lastSendRef.current >= throttleMs) {
      lastSendRef.current = now;
      sendPresenceRef.current(updated);
    }
  }, [throttleMs]);

  const resetActivityTimers = useCallback(() => {
    if (activityTimerRef.current !== null) clearTimeout(activityTimerRef.current);
    if (awayTimerRef.current !== null) clearTimeout(awayTimerRef.current);

    const now = new Date().toISOString();

    setCurrentUser(prev => {
      if (prev.status !== 'active' || prev.lastActivity !== now) {
        const updated = { ...prev, status: 'active' as const, lastActivity: now };
        throttledSend(updated);
        return updated;
      }
      return prev;
    });

    activityTimerRef.current = setTimeout(() => {
      setCurrentUser(prev => {
        const updated = { ...prev, status: 'idle' as const, lastActivity: new Date().toISOString() };
        sendPresenceRef.current(updated);
        return updated;
      });

      awayTimerRef.current = setTimeout(() => {
        setCurrentUser(prev => {
          const updated = { ...prev, status: 'away' as const, lastActivity: new Date().toISOString() };
          sendPresenceRef.current(updated);
          return updated;
        });
      }, awayTimeout - idleTimeout);
    }, idleTimeout);
  }, [idleTimeout, awayTimeout, throttledSend]);

  // Listen for user activity (mouse, keyboard, touch)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleActivity = () => resetActivityTimers();
    const events = ['mousemove', 'keydown', 'touchstart', 'scroll', 'click'] as const;

    events.forEach(event => window.addEventListener(event, handleActivity, { passive: true }));
    resetActivityTimers();

    return () => {
      events.forEach(event => window.removeEventListener(event, handleActivity));
      if (activityTimerRef.current !== null) clearTimeout(activityTimerRef.current);
      if (awayTimerRef.current !== null) clearTimeout(awayTimerRef.current);
    };
  }, [resetActivityTimers]);

  const updateCursor = useCallback((position: { x: number; y: number; elementId?: string }) => {
    setCurrentUser(prev => {
      const updated: PresenceUser = {
        ...prev,
        cursor: position,
        lastActivity: new Date().toISOString(),
        status: 'active',
      };
      throttledSend(updated);
      return updated;
    });
  }, [throttledSend]);

  const updateSelection = useCallback((selection: { start: number; end: number; elementId?: string }) => {
    setCurrentUser(prev => {
      const updated: PresenceUser = {
        ...prev,
        selection,
        lastActivity: new Date().toISOString(),
        status: 'active',
      };
      throttledSend(updated);
      return updated;
    });
  }, [throttledSend]);

  // Keep currentUser in sync with config changes
  useEffect(() => {
    setCurrentUser(prev => ({
      ...prev,
      userId: user.id,
      userName: user.name,
      avatar: user.avatar,
      color,
    }));
  }, [user.id, user.name, user.avatar, color]);

  const users = useMemo(() => Array.from(remoteUsers.values()), [remoteUsers]);

  return {
    users,
    userCount: users.length + 1,
    updateCursor,
    updateSelection,
    currentUser,
  };
}

/**
 * Update remote user presence. Call this when receiving presence data
 * from other users via the realtime channel.
 *
 * @returns A function to update or remove a remote user from the presence set.
 */
export function createPresenceUpdater(): {
  updateUser: (user: PresenceUser) => void;
  removeUser: (userId: string) => void;
  getUsers: () => PresenceUser[];
  onUsersChange: (callback: (users: Map<string, PresenceUser>) => void) => () => void;
} {
  const users = new Map<string, PresenceUser>();
  const listeners = new Set<(users: Map<string, PresenceUser>) => void>();

  const notify = () => {
    listeners.forEach(cb => cb(new Map(users)));
  };

  return {
    updateUser(user: PresenceUser) {
      users.set(user.userId, user);
      notify();
    },
    removeUser(userId: string) {
      users.delete(userId);
      notify();
    },
    getUsers() {
      return Array.from(users.values());
    },
    onUsersChange(callback: (users: Map<string, PresenceUser>) => void) {
      listeners.add(callback);
      return () => { listeners.delete(callback); };
    },
  };
}
