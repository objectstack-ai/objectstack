// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Metadata HMR (Hot Module Replacement) SSE endpoint
 *
 * Streams metadata change events to connected clients (Studio) over
 * Server-Sent Events. Closes the "agent edits a source file → Studio
 * preview refreshes" loop without requiring a manual page reload.
 *
 * Routes:
 *   GET  /api/v1/dev/metadata-events    — stream of events
 *   POST /api/v1/dev/metadata-events    — manual reload trigger
 *                                          body (optional): { reason?: string,
 *                                          changed?: string[] }
 *
 * Event payloads (JSON):
 *   - metadata-change: { type, metadataType, name, path?, timestamp }
 *   - reload:          { reason, timestamp, changed?: string[] }
 *
 * Heartbeat: `: ping` SSE comment lines every 15s.
 *
 * Two event sources feed the same in-process broadcast hub:
 *   1. The MetadataManager filesystem watcher (when `watch: true`).
 *   2. POST /api/v1/dev/metadata-events — used by external watch-recompile
 *      pipelines (e.g. `os dev` watching TS sources) to invalidate
 *      previews after rebuilding the artifact.
 */

import type { MetadataManager } from '../metadata-manager.js';

interface ChangeEvent {
  kind: 'metadata-change';
  type: 'added' | 'changed' | 'deleted';
  metadataType: string;
  name: string;
  path?: string;
  timestamp: number;
}

interface ReloadEvent {
  kind: 'reload';
  reason: string;
  changed?: string[];
  timestamp: number;
}

type BroadcastEvent = ChangeEvent | ReloadEvent;

type Listener = (evt: BroadcastEvent) => void;

/**
 * Hub returned by `registerMetadataHmrRoutes`. Callers (e.g. MetadataPlugin)
 * can use `broadcastReload()` from elsewhere — for example, after reloading
 * an artifact from disk — to push a reload event to all connected clients.
 */
export interface MetadataHmrHub {
  broadcastReload(reason: string, changed?: string[]): void;
  /**
   * Hook a custom handler that runs when POST is called. Useful for
   * triggering an artifact reload before the broadcast goes out.
   * Receives the parsed request body. May be async.
   */
  setOnPostReload(fn: (body: { reason?: string; changed?: string[] }) => void | Promise<void>): void;
  listenerCount(): number;
}

export function registerMetadataHmrRoutes(
  app: any,
  manager: MetadataManager,
  options: { path?: string } = {},
): MetadataHmrHub {
  const routePath = options.path ?? '/api/v1/dev/metadata-events';

  // In-process broadcast hub. Each SSE connection registers a listener;
  // both the FS watcher and the POST handler call into the hub.
  const listeners = new Set<Listener>();
  const broadcast = (evt: BroadcastEvent) => {
    for (const l of listeners) {
      try { l(evt); } catch { /* swallow — one bad listener shouldn't break others */ }
    }
  };

  // Wire FS watcher → hub for every currently-registered metadata type.
  // Captures `subscribe` once; if MetadataManager lacks it (older build)
  // we silently degrade to POST-only.
  let fsHookInstalled = false;
  const installFsHooks = async () => {
    if (fsHookInstalled) return;
    const mgr = manager as any;
    if (typeof mgr.subscribe !== 'function') {
      fsHookInstalled = true;
      return;
    }
    const types = await manager.getRegisteredTypes();
    for (const type of types) {
      mgr.subscribe(type, (evt: any) => {
        const ts = typeof evt.timestamp === 'string'
          ? Date.parse(evt.timestamp)
          : (evt.timestamp ?? Date.now());
        broadcast({
          kind: 'metadata-change',
          type: evt.type ?? 'changed',
          metadataType: evt.metadataType ?? type,
          name: evt.name ?? '',
          path: evt.path,
          timestamp: Number.isFinite(ts) ? ts : Date.now(),
        });
      });
    }
    fsHookInstalled = true;
  };
  // Fire-and-forget; the first connection will await it in its handler
  // anyway via getRegisteredTypes().
  installFsHooks().catch(() => { /* noop */ });

  let onPostReload: ((body: { reason?: string; changed?: string[] }) => void | Promise<void>) | null = null;

  // ── GET: SSE stream ────────────────────────────────────────────────
  app.get(routePath, async (c: any) => {
    // Make sure FS hooks are installed even if installFsHooks() raced.
    await installFsHooks().catch(() => { /* noop */ });
    const types = await manager.getRegisteredTypes().catch(() => [] as string[]);

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder();
        let closed = false;

        const safeEnqueue = (chunk: string) => {
          if (closed) return;
          try { controller.enqueue(enc.encode(chunk)); }
          catch { closed = true; }
        };

        const listener: Listener = (evt) => {
          if (closed) return;
          const eventName = evt.kind === 'reload' ? 'reload' : 'metadata-change';
          safeEnqueue(`event: ${eventName}\ndata: ${JSON.stringify(evt)}\n\n`);
        };
        listeners.add(listener);

        safeEnqueue(`event: ready\ndata: ${JSON.stringify({ types, timestamp: Date.now() })}\n\n`);

        const heartbeat = setInterval(() => {
          safeEnqueue(`: ping ${Date.now()}\n\n`);
        }, 15_000);

        const cleanup = () => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          listeners.delete(listener);
          try { controller.close(); } catch { /* noop */ }
        };

        const signal: AbortSignal | undefined = c.req?.raw?.signal;
        if (signal) {
          if (signal.aborted) cleanup();
          else signal.addEventListener('abort', cleanup, { once: true });
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  });

  // ── POST: manual reload trigger ────────────────────────────────────
  // The CLI's watch-recompile loop posts here after rebuilding the
  // artifact. Optional body: { reason?: string, changed?: string[] }.
  app.post(routePath, async (c: any) => {
    let body: { reason?: string; changed?: string[] } = {};
    try {
      // Hono: c.req.json() throws on empty body — guard it.
      const ct = c.req?.header?.('content-type') ?? '';
      if (typeof c.req?.json === 'function' && ct.includes('json')) {
        body = await c.req.json();
      }
    } catch { /* empty / invalid body OK */ }

    try {
      if (onPostReload) await onPostReload(body);
    } catch (e: any) {
      return new Response(
        JSON.stringify({ ok: false, error: e?.message ?? 'reload handler failed' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const reason = body.reason ?? 'manual-trigger';
    broadcast({
      kind: 'reload',
      reason,
      changed: body.changed,
      timestamp: Date.now(),
    });
    return new Response(
      JSON.stringify({ ok: true, listeners: listeners.size, reason }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });

  return {
    broadcastReload(reason, changed) {
      broadcast({ kind: 'reload', reason, changed, timestamp: Date.now() });
    },
    setOnPostReload(fn) { onPostReload = fn; },
    listenerCount: () => listeners.size,
  };
}
