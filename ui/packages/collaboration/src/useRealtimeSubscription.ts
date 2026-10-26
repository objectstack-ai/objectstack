/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ConnectionState } from '@object-ui/types';

/**
 * WebSocket connection configuration for {@link useRealtimeSubscription}.
 *
 * Named `RealtimeSubscriptionConfig`, not `RealtimeConfig` (objectui#3161,
 * objectstack#4115 ledger batch 7). The spec's `RealtimeConfig`
 * (`@objectstack/spec/api`) is the app-level realtime DECLARATION — `enabled`,
 * a `transport` of `websocket | sse | polling`, and a `subscriptions[]` array
 * whose entries name the record events to deliver. This is one browser socket's
 * dial settings: which URL, which channel, how to back off when it drops. The
 * two share no declared key at all — measured against the spec's own schema
 * shape in `__tests__/spec-symbol-batch7.test.ts` rather than assumed, because
 * the spec declares that schema as a PASSTHROUGH object and a type-level key
 * comparison against a bag answers nothing. So there was no dialect to
 * reconcile here, only a name to hand back.
 */
export interface RealtimeSubscriptionConfig {
  /** WebSocket URL */
  url?: string;
  /** Room/channel to subscribe to */
  channel: string;
  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean;
  /** Reconnect interval in ms */
  reconnectInterval?: number;
  /** Max reconnect attempts */
  maxReconnectAttempts?: number;
  /** Auth token for WebSocket */
  authToken?: string;
}

/**
 * The socket's connection state. Declared once in `@object-ui/types`, which
 * `@object-ui/data-objectstack` re-exports too, for its adapter's connection
 * (objectui#6349, batch 10); this package's entry keeps publishing it under
 * the same name.
 */
export type { ConnectionState } from '@object-ui/types';

export interface RealtimeMessage<T = unknown> {
  type: string;
  channel: string;
  data: T;
  sender?: string;
  timestamp: string;
}

export interface RealtimeResult<T = unknown> {
  /** Current connection state */
  connectionState: ConnectionState;
  /** Whether connected */
  isConnected: boolean;
  /** Last received message */
  lastMessage: RealtimeMessage<T> | null;
  /** All messages received since subscription */
  messages: RealtimeMessage<T>[];
  /** Send a message to the channel */
  send: (type: string, data: T) => void;
  /** Subscribe to specific message types */
  subscribe: (type: string, handler: (data: T) => void) => () => void;
  /** Disconnect from the channel */
  disconnect: () => void;
  /** Reconnect to the channel */
  reconnect: () => void;
  /** Error if any */
  error: Error | null;
}

/**
 * Hook for real-time data subscriptions via WebSocket.
 * Aligned with @objectstack/client realtime API.
 *
 * Provides automatic reconnection with exponential backoff,
 * message buffering, and typed message subscriptions.
 */
export function useRealtimeSubscription<T = unknown>(config: RealtimeSubscriptionConfig): RealtimeResult<T> {
  const {
    url,
    channel,
    autoReconnect = true,
    reconnectInterval = 1000,
    maxReconnectAttempts = 10,
    authToken,
  } = config;

  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [lastMessage, setLastMessage] = useState<RealtimeMessage<T> | null>(null);
  const [messages, setMessages] = useState<RealtimeMessage<T>[]>([]);
  const [error, setError] = useState<Error | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlersRef = useRef<Map<string, Set<(data: T) => void>>>(new Map());
  const sendBufferRef = useRef<Array<{ type: string; data: T }>>([]);
  const mountedRef = useRef(true);
  const intentionalCloseRef = useRef(false);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const flushSendBuffer = useCallback((ws: WebSocket) => {
    while (sendBufferRef.current.length > 0) {
      const msg = sendBufferRef.current.shift()!;
      const payload: RealtimeMessage<T> = {
        type: msg.type,
        channel,
        data: msg.data,
        timestamp: new Date().toISOString(),
      };
      ws.send(JSON.stringify(payload));
    }
  }, [channel]);

  const connect = useCallback(() => {
    if (typeof WebSocket === 'undefined') {
      setError(new Error('WebSocket is not available in this environment'));
      setConnectionState('error');
      return;
    }

    if (!url) {
      setError(new Error('WebSocket URL is required'));
      setConnectionState('error');
      return;
    }

    // Validate WebSocket URL protocol (only ws: or wss: allowed)
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
        setError(new Error('WebSocket URL must use ws: or wss: protocol'));
        setConnectionState('error');
        return;
      }
    } catch {
      setError(new Error('Invalid WebSocket URL'));
      setConnectionState('error');
      return;
    }

    // Close existing connection
    if (wsRef.current) {
      intentionalCloseRef.current = true;
      wsRef.current.close();
      wsRef.current = null;
    }

    intentionalCloseRef.current = false;
    setConnectionState('connecting');
    setError(null);

    const wsUrl = authToken ? `${url}?token=${encodeURIComponent(authToken)}&channel=${encodeURIComponent(channel)}` : `${url}?channel=${encodeURIComponent(channel)}`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      if (!mountedRef.current) return;
      const connectError = err instanceof Error ? err : new Error('Failed to create WebSocket connection');
      setError(connectError);
      setConnectionState('error');
      return;
    }

    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setConnectionState('connected');
      setError(null);
      reconnectAttemptsRef.current = 0;
      flushSendBuffer(ws);
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!mountedRef.current) return;
      try {
        const message = JSON.parse(String(event.data)) as RealtimeMessage<T>;
        if (message.channel !== channel) return;

        setLastMessage(message);
        setMessages(prev => [...prev, message]);

        // Notify type-specific handlers
        const typeHandlers = handlersRef.current.get(message.type);
        if (typeHandlers) {
          typeHandlers.forEach(handler => handler(message.data));
        }
      } catch {
        // Ignore unparseable messages
      }
    };

    ws.onerror = () => {
      if (!mountedRef.current) return;
      setError(new Error('WebSocket connection error'));
      setConnectionState('error');
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      wsRef.current = null;

      if (intentionalCloseRef.current) {
        setConnectionState('disconnected');
        return;
      }

      if (autoReconnect && reconnectAttemptsRef.current < maxReconnectAttempts) {
        setConnectionState('reconnecting');
        const backoff = Math.min(
          reconnectInterval * Math.pow(2, reconnectAttemptsRef.current),
          30000
        );
        reconnectAttemptsRef.current += 1;
        reconnectTimerRef.current = setTimeout(() => {
          if (mountedRef.current) {
            connect();
          }
        }, backoff);
      } else {
        setConnectionState('disconnected');
      }
    };
  }, [url, channel, authToken, autoReconnect, reconnectInterval, maxReconnectAttempts, flushSendBuffer]);

  const disconnect = useCallback(() => {
    clearReconnectTimer();
    intentionalCloseRef.current = true;
    reconnectAttemptsRef.current = 0;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnectionState('disconnected');
  }, [clearReconnectTimer]);

  const reconnectFn = useCallback(() => {
    clearReconnectTimer();
    reconnectAttemptsRef.current = 0;
    connect();
  }, [connect, clearReconnectTimer]);

  const send = useCallback((type: string, data: T) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const payload: RealtimeMessage<T> = {
        type,
        channel,
        data,
        timestamp: new Date().toISOString(),
      };
      ws.send(JSON.stringify(payload));
    } else {
      // Buffer message for when connection is restored
      sendBufferRef.current.push({ type, data });
    }
  }, [channel]);

  const subscribe = useCallback((type: string, handler: (data: T) => void): (() => void) => {
    if (!handlersRef.current.has(type)) {
      handlersRef.current.set(type, new Set());
    }
    handlersRef.current.get(type)!.add(handler);

    return () => {
      const handlers = handlersRef.current.get(type);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          handlersRef.current.delete(type);
        }
      }
    };
  }, []);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    mountedRef.current = true;
    if (url) {
      connect();
    }
    return () => {
      mountedRef.current = false;
      clearReconnectTimer();
      intentionalCloseRef.current = true;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [url, channel, authToken]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    connectionState,
    isConnected: connectionState === 'connected',
    lastMessage,
    messages,
    send,
    subscribe,
    disconnect,
    reconnect: reconnectFn,
    error,
  };
}
