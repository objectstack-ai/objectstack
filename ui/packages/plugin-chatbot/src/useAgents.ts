/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * useAgents — fetch the list of active AI agents from a framework
 * (`@objectstack/service-ai`) backend.
 *
 * The hook hits `GET {apiBase}/agents` (the canonical endpoint exposed by
 * `buildAgentRoutes`) and returns a normalized list. It is intentionally
 * dependency-free (uses `fetch`) so the chatbot package can stay light.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { resolveAgentParam, isBuildAgent } from './agentAliases';

/**
 * cloud#816 / ADR-0057 "B+" — per-agent capabilities DECLARED by the server
 * (`GET /api/v1/ai/agents`), so hosts render agent-specific behavior (debug
 * drawer, Live Canvas, resume-vs-fresh) by capability instead of hard-coded
 * `isBuildAgent(name)` checks. Optional: older servers omit it, and consumers
 * fall back to the name check via {@link agentHasCapability}.
 */
export interface AgentCapabilities {
  /** Authors app metadata — the Builder product. */
  authoring: boolean;
  /** Drives the ADR-0037 Live Canvas split view. */
  canvas: boolean;
  /** Exposes the build-doctor debug drawer. */
  debug: boolean;
  /** Turns resume durable multi-step runs. */
  resume: boolean;
}

export interface AgentDescriptor {
  /** Stable identifier used in the chat URL (e.g. "sales_assistant"). */
  name: string;
  /** Human-readable label shown in pickers. Falls back to `name`. */
  label: string;
  /** Short description / tooltip. */
  description?: string;
  /** Agent role (assistant, planner, etc.) — informational. */
  role?: string;
  /** Whether this agent is currently active on the server. */
  active?: boolean;
  /** Declared capabilities (cloud#816); absent on older servers. */
  capabilities?: AgentCapabilities;
}

export interface UseAgentsOptions {
  /**
   * Base URL of the AI service, e.g. "http://localhost:3000/api/v1/ai".
   * If omitted, the hook returns an empty list and no fetch is performed.
   */
  apiBase?: string;
  /** Additional headers (auth tokens, conversation IDs, etc.). */
  headers?: Record<string, string>;
  /** Disable the fetch (useful while the URL is still resolving). */
  enabled?: boolean;
  /** Static fallback list returned when the request fails or is disabled. */
  fallback?: AgentDescriptor[];
}

export interface UseAgentsReturn {
  agents: AgentDescriptor[];
  isLoading: boolean;
  error: Error | undefined;
  refetch: () => void;
}

interface RawAgent {
  name?: string;
  label?: string;
  description?: string;
  role?: string;
  active?: boolean;
  capabilities?: Partial<Record<keyof AgentCapabilities, unknown>>;
  [key: string]: unknown;
}

/** Coerce a served `capabilities` object to strict booleans; undefined if absent. */
function normalizeCapabilities(raw: RawAgent['capabilities']): AgentCapabilities | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  return {
    authoring: raw.authoring === true,
    canvas: raw.canvas === true,
    debug: raw.debug === true,
    resume: raw.resume === true,
  };
}

/**
 * Whether `name`'s agent declares `cap` (cloud#816). Falls back to the legacy
 * `isBuildAgent(name)` name check when the catalog entry carries no
 * `capabilities` (older server) or the agent isn't in the list yet — so
 * behavior is unchanged until the server ships the field, and degrades the
 * same way afterwards.
 */
export function agentHasCapability(
  agents: readonly AgentDescriptor[],
  name: string | undefined,
  cap: keyof AgentCapabilities,
): boolean {
  if (!name) return false;
  const found = agents.find((a) => a.name === name);
  if (found?.capabilities) return found.capabilities[cap];
  return isBuildAgent(name);
}

/**
 * Canonical name of the platform's data-query agent.
 *
 * Mirrors `DEFAULT_DATA_AGENT_NAME` in `@objectstack/service-ai`. This is
 * the implicit copilot bound to every application that does not pin its own
 * `app.defaultAgent` (Studio is the only built-in that overrides it, → the
 * `build` authoring agent). The UI prefers it so end users land on the data
 * assistant without having to choose from a list.
 *
 * Path A renamed `data_chat`→`ask`; resolution below is alias-aware, so a
 * catalog still serving the legacy `data_chat` id resolves correctly too.
 */
export const PLATFORM_DEFAULT_AGENT = 'ask';

/**
 * Resolve which agent the chat surface should open with, mirroring the
 * backend's `resolveDefaultAgent` precedence so the UI and server agree
 * on the default even before the first request:
 *
 * 1. `preferred` — the app's `defaultAgent` (or a `VITE_AI_DEFAULT_AGENT`
 *    override), when it (or an alias of it) exists in the fetched catalog.
 * 2. The platform data-query agent (`ask`, alias `data_chat`).
 * 3. The first agent in the catalog (last-resort fallback).
 *
 * Resolution is alias-aware ({@link resolveAgentParam}) so the friendly name,
 * the new id, and the legacy id all map to whichever the catalog serves.
 * Returns `undefined` only when the catalog is empty.
 */
export function resolveDefaultAgentName(
  agents: AgentDescriptor[],
  preferred?: string,
): string | undefined {
  if (agents.length === 0) return undefined;
  const catalog = agents.map((a) => a.name);
  if (preferred) {
    const match = resolveAgentParam(preferred, catalog);
    if (match) return match;
  }
  const platform = resolveAgentParam(PLATFORM_DEFAULT_AGENT, catalog);
  if (platform) return platform;
  return agents[0].name;
}

/**
 * Pull the agent list out of whatever `GET /api/v1/ai/agents` answered.
 *
 * This route is served by more than one producer, and the conversion onto the
 * platform's declared `{ success: true, data }` envelope (objectstack#4053) has
 * now landed on BOTH — the framework's degraded fallback in objectstack#4124,
 * cloud's `service-ai` in cloud#929. Four shapes still read the same:
 *
 *   { success: true, data: { agents } }    what both producers serve today
 *   { success: true, data: [ … ] }         the envelope flattened — no producer
 *                                          emits it; read so that one doing so
 *                                          fails loudly upstream, not here
 *   { agents: [ … ] }                      pre-conversion servers
 *   [ … ]                                  a bare array
 *
 * The last two are back-compat, not the current wire: a console release is not
 * pinned to the server it runs against, so a deployment from before the
 * conversion is ordinary. Do not read them as evidence the servers are
 * unenveloped — they are not, and a "cleanup" that re-narrows this to the bare
 * shape would break exactly the deployments it looks like it is following.
 *
 * The envelope is detected the way `ObjectStackClient.unwrapResponse` detects
 * it — a **boolean** `success` — so the two agree on what counts as one.
 *
 * Why tolerance here rather than one shape and a parse error: an unrecognised
 * shape does not throw or warn. It yields an empty list, and `useAiSurfaceEnabled`
 * turns an empty list into "hide the entire AI surface". That is also the CORRECT
 * behaviour for a seat-less user or a Community-Edition deployment with no
 * `service-ai` — so a parse miss is indistinguishable from the legitimate hidden
 * state, with no error, no 403 and no log to notice it by. Reading every shape
 * this route has ever answered in is what kept the server conversions from having
 * to land in lockstep with a console release.
 */
export function extractAgentList(payload: unknown): RawAgent[] {
  const isEnvelope =
    !!payload && typeof payload === 'object' && !Array.isArray(payload) &&
    typeof (payload as { success?: unknown }).success === 'boolean';

  const body = isEnvelope ? (payload as { data?: unknown }).data : payload;

  if (Array.isArray(body)) return body as RawAgent[];
  const agents = (body as { agents?: unknown } | null | undefined)?.agents;
  return Array.isArray(agents) ? (agents as RawAgent[]) : [];
}

function normalize(raw: RawAgent[]): AgentDescriptor[] {
  return raw
    .filter((a) => typeof a?.name === 'string' && a.name.length > 0)
    .map((a) => ({
      name: a.name as string,
      label: a.label || (a.name as string),
      description: a.description,
      role: a.role,
      active: a.active !== false,
      capabilities: normalizeCapabilities(a.capabilities),
    }));
}

/**
 * Module-level cache + in-flight dedup keyed by `apiBase`, so remounting a
 * chat surface on every navigation doesn't re-hit `GET /agents` — the catalog
 * rarely changes within a session. `refetch()` bypasses both.
 */
const AGENTS_CACHE_TTL_MS = 30_000;
const agentsCache = new Map<string, { data: AgentDescriptor[]; timestamp: number }>();
const agentsInFlight = new Map<string, Promise<AgentDescriptor[]>>();

function fetchAgentsCached(
  apiBase: string,
  headers: Record<string, string> | undefined,
  force: boolean,
): Promise<AgentDescriptor[]> {
  if (force) {
    agentsCache.delete(apiBase);
  } else {
    const cached = agentsCache.get(apiBase);
    if (cached && Date.now() - cached.timestamp < AGENTS_CACHE_TTL_MS) {
      return Promise.resolve(cached.data);
    }
  }

  const inFlight = agentsInFlight.get(apiBase);
  if (inFlight && !force) return inFlight;

  const url = `${apiBase.replace(/\/$/, '')}/agents`;
  const promise = fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json', ...(headers ?? {}) },
    credentials: 'include',
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`Failed to load agents (${res.status})`);
      // Bare array, `{ agents }`, or the declared envelope — see `extractAgentList`.
      return normalize(extractAgentList(await res.json()));
    })
    .then((normalized) => {
      agentsCache.set(apiBase, { data: normalized, timestamp: Date.now() });
      return normalized;
    })
    .finally(() => {
      agentsInFlight.delete(apiBase);
    });

  agentsInFlight.set(apiBase, promise);
  return promise;
}

/**
 * Whether a frame has painted since the first catalog consumer mounted
 * (objectui#12980). One-way and module-wide, like the cache above: a surface
 * that remounts on navigation reads at once.
 */
let catalogFramePainted = false;

/**
 * Run `fn` once the frame after this mount has painted — at once when one
 * already has. Returns a cancel.
 *
 * The catalog decides whether the AI entry points DRAW (`useAiSurfaceEnabled`:
 * no agent, no button), so it is read on every console open — but nothing
 * draws until after the page's first paint, because every entry point stays
 * hidden while the catalog loads. So the read waits for that paint instead of
 * starting in the mount effects beside the page's own reads. It waits ONE
 * frame and never for the boot splash: the `/ai` route guard asks for the
 * catalog under the splash, and waiting the splash out there would wait
 * forever. A tab opened in the background paints no frame, so its read waits
 * until the tab is first shown.
 */
function afterCatalogFrame(fn: () => void): () => void {
  if (catalogFramePainted) {
    fn();
    return () => {};
  }
  let live = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    if (!live) return;
    catalogFramePainted = true;
    fn();
  };
  const frame =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(() => {
          timer = setTimeout(run, 0);
        })
      : undefined;
  if (frame === undefined) timer = setTimeout(run, 0);
  return () => {
    live = false;
    if (frame !== undefined && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
    if (timer !== undefined) clearTimeout(timer);
  };
}

/** Test seam: forget the painted frame and the cached catalog. Not public. */
export function __resetAgentsCatalog(): void {
  catalogFramePainted = false;
  agentsCache.clear();
  agentsInFlight.clear();
}

/**
 * Fetches the active agent catalog from the backend.
 *
 * The request leaves after the first frame has painted (objectui#12980), not
 * in the mounting commit — see {@link afterCatalogFrame}.
 *
 * @example
 * const { agents } = useAgents({ apiBase: '/api/v1/ai' });
 */
export function useAgents(options: UseAgentsOptions = {}): UseAgentsReturn {
  const { apiBase, headers, enabled = true, fallback = [] } = options;

  const [agents, setAgents] = useState<AgentDescriptor[]>(fallback);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [reloadToken, setReloadToken] = useState(0);

  // Stash latest headers in a ref so consumers can pass inline objects without
  // triggering a refetch on every render.
  const headersRef = useRef(headers);
  headersRef.current = headers;

  useEffect(() => {
    if (!enabled || !apiBase) return;

    let cancelled = false;
    const cancelFrame = afterCatalogFrame(() => {
      if (cancelled) return;
      setIsLoading(true);
      setError(undefined);

      fetchAgentsCached(apiBase, headersRef.current, reloadToken > 0)
        .then((normalized) => {
          if (cancelled) return;
          setAgents(normalized.length > 0 ? normalized : fallback);
        })
        .catch((err: Error) => {
          if (cancelled) return;
          setError(err);
          setAgents(fallback);
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
    });

    return () => {
      cancelled = true;
      cancelFrame();
    };
    // `fallback` is intentionally excluded — callers usually pass a fresh array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, enabled, reloadToken]);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  return { agents, isLoading, error, refetch };
}
