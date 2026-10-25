/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { createContext, useContext, useCallback, useMemo, useEffect, useRef, useState } from 'react';
import type { CollaborationConfig, CollaborationPresence, CollaborationOperation } from '@object-ui/types';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | false)[]) {
  return twMerge(clsx(inputs));
}

export interface CollaborationContextValue {
  /** Active users in the session */
  users: CollaborationPresence[];
  /** Whether collaboration is connected */
  isConnected: boolean;
  /** Send an operation to collaborators */
  sendOperation: (operation: Omit<CollaborationOperation, 'id' | 'timestamp' | 'version'>) => void;
  /** Current user ID */
  currentUserId?: string;
  /** Connection state */
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'error';
  /** Version history entries (when versionHistory is enabled) */
  versionCount: number;
}

const CollabCtx = createContext<CollaborationContextValue | null>(null);
CollabCtx.displayName = 'CollaborationContext';

export interface CollaborationProviderProps {
  /** Collaboration configuration */
  config: CollaborationConfig;
  /** Current user info */
  user?: {
    id: string;
    name: string;
    avatar?: string;
  };
  /** Callback when an operation is received from another user */
  onOperation?: (operation: CollaborationOperation) => void;
  /** Callback when a remote user joins or leaves */
  onPresenceChange?: (users: CollaborationPresence[]) => void;
  /** Children */
  children: React.ReactNode;
}

/**
 * Provider for multi-user collaborative editing.
 * Manages WebSocket connection, presence, and operation broadcasting.
 * Supports real-time collaboration via WebSocket when serverUrl is configured.
 */
export function CollaborationProvider({
  config,
  user,
  onOperation,
  onPresenceChange,
  children,
}: CollaborationProviderProps) {
  const wsRef = useRef<WebSocket | null>(null);
  const [remoteUsers, setRemoteUsers] = useState<CollaborationPresence[]>([]);
  const [connectionState, setConnectionState] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const versionRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Connect via WebSocket when serverUrl is provided
  useEffect(() => {
    if (!config.enabled || !user || !config.serverUrl) return;

    const canUseWS = typeof WebSocket !== 'undefined';
    if (!canUseWS) return;

    function connect() {
      // Validate WebSocket URL protocol (only ws: or wss: allowed)
      let url: URL;
      try {
        url = new URL(config.serverUrl!);
        if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return;
      } catch {
        return;
      }
      if (config.roomId) url.searchParams.set('room', config.roomId);
      url.searchParams.set('userId', user!.id);

      setConnectionState('connecting');
      const ws = new WebSocket(url.toString());

      ws.onopen = () => {
        setConnectionState('connected');
        // Send join message
        ws.send(JSON.stringify({
          type: 'join',
          userId: user!.id,
          userName: user!.name,
          avatar: user!.avatar,
        }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'presence') {
            const users = (msg.users || []) as CollaborationPresence[];
            setRemoteUsers(users.filter((u: CollaborationPresence) => u.userId !== user!.id));
            onPresenceChange?.(users);
          } else if (msg.type === 'operation') {
            onOperation?.(msg.operation as CollaborationOperation);
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        setConnectionState('disconnected');
        wsRef.current = null;
        // Auto-reconnect
        if (config.enabled) {
          reconnectTimerRef.current = setTimeout(connect, config.autoSaveInterval ?? 3000);
        }
      };

      ws.onerror = () => {
        setConnectionState('error');
      };

      wsRef.current = ws;
    }

    connect();

    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // Prevent reconnect on intentional close
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnectionState('disconnected');
    };
  }, [config.enabled, config.serverUrl, config.roomId, config.autoSaveInterval, user, onOperation, onPresenceChange]);

  const users = useMemo<CollaborationPresence[]>(() => {
    if (!config.enabled || !user) return [];
    const currentUser: CollaborationPresence = {
      userId: user.id,
      userName: user.name,
      avatar: user.avatar,
      color: generateColor(user.id),
      status: 'active' as const,
      lastActivity: new Date().toISOString(),
    };
    return [currentUser, ...remoteUsers];
  }, [config.enabled, user, remoteUsers]);

  const isConnected = config.enabled && !!user && (config.serverUrl ? connectionState === 'connected' : true);

  const sendOperation = useCallback(
    (operation: Omit<CollaborationOperation, 'id' | 'timestamp' | 'version'>) => {
      if (!config.enabled || !user) return;

      versionRef.current += 1;
      const fullOp: CollaborationOperation = {
        ...operation,
        id: `op-${Date.now()}-${versionRef.current}`,
        userId: user.id,
        timestamp: new Date().toISOString(),
        version: versionRef.current,
      };

      // Send via WebSocket if connected
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'operation', operation: fullOp }));
      }

      // Always notify local listeners
      onOperation?.(fullOp);
    },
    [config.enabled, user, onOperation],
  );

  const value = useMemo<CollaborationContextValue>(
    () => ({
      users,
      isConnected,
      sendOperation,
      currentUserId: user?.id,
      connectionState,
      versionCount: versionRef.current,
    }),
    [users, isConnected, sendOperation, user?.id, connectionState],
  );

  return <CollabCtx.Provider value={value}>{children}</CollabCtx.Provider>;
}

/**
 * Hook to access the collaboration context.
 */
export function useCollaboration(): CollaborationContextValue | null {
  return useContext(CollabCtx);
}

/**
 * Connection status indicator component.
 * Shows the current collaboration connection state with a colored dot and label.
 */
export function ConnectionStatusIndicator({ className }: { className?: string }) {
  const ctx = useContext(CollabCtx);
  if (!ctx) return null;

  const { connectionState, users } = ctx;
  const stateConfig: Record<string, { color: string; label: string }> = {
    connected: { color: 'bg-green-500', label: 'Connected' },
    connecting: { color: 'bg-yellow-500 animate-pulse', label: 'Connecting…' },
    disconnected: { color: 'bg-gray-400', label: 'Disconnected' },
    error: { color: 'bg-red-500', label: 'Connection error' },
  };
  const { color, label } = stateConfig[connectionState] ?? stateConfig.disconnected;

  return (
    <div className={cn('flex items-center gap-2 text-xs', className)} role="status" aria-live="polite" aria-label={`Collaboration: ${label}`}>
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
      <span>{label}</span>
      {connectionState === 'connected' && users.length > 1 && (
        <span className="text-muted-foreground">({users.length} users)</span>
      )}
    </div>
  );
}

/**
 * Generate a consistent color for a user ID.
 */
function generateColor(userId: string): string {
  const colors = [
    '#3b82f6', '#ef4444', '#22c55e', '#f59e0b',
    '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
    '#14b8a6', '#f43f5e', '#a855f7', '#84cc16',
    '#0ea5e9', '#e879f9', '#fb923c', '#facc15',
  ];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  }
  return colors[Math.abs(hash) % colors.length];
}
