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
 *
 * ## The `/dev/` in the path is ENFORCED, not merely declared (#12140)
 *
 * `registerMetadataHmrRoutes` mounts NOTHING and returns `null` unless the
 * process is running an explicit `NODE_ENV=development` posture — see
 * {@link isDevMetadataEndpointEnabled}. Before that gate existed, this module's
 * dev-only posture was carried by two sentences of prose (this header, and
 * `MetadataPlugin`'s "production deployments simply won't have a CLI POSTing to
 * this endpoint"), and a sentence about who will call a route is not a gate that
 * stops them. The measured consequence: the official container image runs
 * `os start` under `NODE_ENV=production` (`docker/Dockerfile`), that boot reaches
 * `createStandaloneStack`, and the stack composes `MetadataPlugin`
 * UNCONDITIONALLY (`packages/runtime/src/standalone-stack.ts`) onto a kernel that
 * always registers `HonoServerPlugin` when serving — so both routes below were
 * mounted, and answering, on a production-shaped boot.
 *
 * What an unauthenticated caller got there: `POST` re-reads the artifact from
 * disk and broadcasts a reload frame to every connected client — a write-shaped
 * side effect plus a broadcast — and `GET` streams metadata-change frames whose
 * `path` field is a server-side filesystem path. Neither sits behind REST's
 * `enforceAuth` seam, and neither can: the caller reaches this registrar by
 * taking the host's framework-native app handle off the HTTP-server contract's
 * raw-app escape hatch, and routes mounted on that handle are outside the auth
 * seam BY CONSTRUCTION — the contract's own words, quoted with the spelling in
 * `metadata-route-ledger.ts`. (The spelling is deliberately not repeated in this
 * module: the ledger's conformance guard asserts as an IDENTITY that `plugin.ts`
 * is the only file in this package reaching for the host app, and it reads raw
 * source, so a prose mention here would read as a second reacher.) #9391 closed
 * the same structural class for the `datasource-admin` family.
 *
 * WHY AN ENVIRONMENT GATE HERE AND AUTHENTICATION THERE, since the two fixes are
 * not interchangeable. `datasource-admin` is the Setup → Datasources backend: it
 * MUST answer on a production deployment, so the only available repair was to
 * make it answer to authenticated callers. This door must not answer on a
 * production deployment at all — its sole caller is a build tool (`os dev`'s
 * watch-recompile loop, `packages/cli/src/commands/dev.ts`), the SDK never builds
 * this URL (measured: zero `metadata-events` hits in `@objectstack/client`), and
 * a reload broadcast has no meaning on a deployment that is not recompiling. So
 * the fix is to close the door rather than to put a lock on it: bolting auth on
 * instead would have made an unadvertised dev door into a supported production
 * surface, which is a widening, not a hardening.
 */

import type { MetadataManager } from '../metadata-manager.js';

interface ChangeEvent {
  kind: 'metadata-change';
  type: 'added' | 'changed' | 'deleted';
  metadataType: string;
  name: string;
  path?: string;
  timestamp: number;
  /** Canonical repo seq (ADR-0008); absent for legacy chokidar events. */
  seq?: number;
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

/**
 * The one decision behind this module's dev-only posture (#12140): may this
 * process serve `/api/v1/dev/metadata-events` at all?
 *
 * ## Only a literal `development` opens it — everything else is closed
 *
 * Unset is CLOSED, and that is the load-bearing half. The maintainer's
 * 2026-08-06 ruling (#5673) settled what an absent `NODE_ENV` means for this
 * repo: `production`. "An operator who never exported NODE_ENV is booting a real
 * deployment, not asking to be treated as development" — `os serve`'s own words
 * where it normalises the variable (`packages/cli/src/commands/serve.ts`), which
 * is also why the `os dev` workflow keeps working across this gate: `os dev`
 * spawns `os serve --dev`, and that branch sets `NODE_ENV='development'` when the
 * operator left it unset, BEFORE any plugin starts.
 *
 * `test` is closed too, deliberately. Nothing about a vitest process makes an
 * open reload door correct, and a suite that wants this surface says so by
 * stubbing the posture it is exercising — which is what the gate's own pins do.
 *
 * ## Why not `resolveDiscoveryEnvironment`, the repo's other NODE_ENV reader
 *
 * That mapper is right for its job and wrong for this one. It degrades a value it
 * does not recognise (`qa`, `preview`, `staging`) to `development`, because a
 * DISCOVERY field that guesses `production` would let a client skip production
 * warnings it needed. A GATE fails the opposite way: for it, "a spelling nobody
 * recognises" must not be a key that opens the door. Same variable, opposite safe
 * direction — so this predicate reads the variable directly and admits exactly
 * one spelling. Trimmed and lower-cased first, matching how that mapper
 * normalises (`'  Production '` → `'production'`), so a stray space in a
 * `.env` file cannot decide a security question.
 *
 * @param env Injectable for tests; defaults to the live process environment.
 */
export function isDevMetadataEndpointEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (env.NODE_ENV ?? '').trim().toLowerCase() === 'development';
}

/**
 * Mount the HMR routes on the host's framework-native app handle — or mount
 * NOTHING and return `null` when this process is not running a development
 * posture ({@link isDevMetadataEndpointEnabled}).
 *
 * The refusal is the FIRST statement, ahead of every side effect this registrar
 * performs (the broadcast hub, the `manager.subscribe` fan-out, the route
 * registrations): a gate that runs after the wiring is a gate on the answer, not
 * on the door. `null` rather than an inert hub, because a caller that keeps a
 * handle it cannot use is a caller that will one day broadcast into nothing and
 * report success; the nullable return makes "nothing was mounted" a fact the
 * compiler forces every caller to handle.
 */
export function registerMetadataHmrRoutes(
  app: any,
  manager: MetadataManager,
  options: { path?: string } = {},
): MetadataHmrHub | null {
  if (!isDevMetadataEndpointEnabled()) return null;
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
          // Forward the canonical server-side sequence number when the
          // event originated from a MetadataRepository (ADR-0008). Legacy
          // chokidar-driven events have no seq — clients fall back to
          // their local counter in that case.
          ...(typeof evt.seq === 'number' ? { seq: evt.seq } : {}),
        } as BroadcastEvent);
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
