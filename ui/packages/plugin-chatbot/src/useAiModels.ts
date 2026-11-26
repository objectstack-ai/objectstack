/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * useAiModels — fetch the AI-model picker allowlist (ADR-0028) from a framework
 * (`@objectstack/service-ai`) backend.
 *
 * Hits `GET {apiBase}/models` (exposed by `buildAgentRoutes`) → the plan-filtered
 * set of models THIS environment offers in the build/ask model picker, plus the
 * default model id. Free / single-model envs return one entry, so the footer
 * picker (which `ChatbotEnhanced` renders only for 2+ models) stays hidden.
 *
 * It asks through the host's `apiFetch`, else the global `fetch`, and imports no
 * HTTP client, mirroring {@link useAgents}.
 */

import { useContext, useEffect, useRef, useState, useCallback } from 'react';
import { SchemaRendererContext, type ApiFetch } from '@object-ui/react';
import type { ChatbotModelOption } from './ChatbotEnhanced';

export interface UseAiModelsOptions {
  /** Base URL of the AI service, e.g. "http://localhost:3000/api/v1/ai". */
  apiBase?: string;
  /** Additional headers (auth tokens, conversation IDs, etc.). */
  headers?: Record<string, string>;
  /** Disable the fetch (useful while the URL is still resolving). */
  enabled?: boolean;
}

export interface UseAiModelsReturn {
  /** The plan-filtered models offered in the picker. Empty until resolved. */
  models: ChatbotModelOption[];
  /** The default / fallback model id reported by the backend. */
  defaultModelId: string | undefined;
  isLoading: boolean;
  error: Error | undefined;
  refetch: () => void;
}

interface RawModel {
  id?: string;
  label?: string;
  default?: boolean;
  costMultiplier?: unknown;
  tierLabel?: unknown;
  [key: string]: unknown;
}

/**
 * objectui#12508 — the model URLs that answered 501 Not Implemented in this
 * session: the server mounts no AI service there (`@objectstack/service-ai`
 * is absent). Unlike the cold-boot answers the retry below waits out, a 501
 * does not change while the page lives, so such a URL is asked once per
 * session and never again: not retried, not on a remount, not on a route
 * change.
 */
const noAiServiceUrls = new Set<string>();

/** Test-only: forget the session's 501 answers. Not exported from the package. */
export function resetAiModelsSession(): void {
  noAiServiceUrls.clear();
}

/**
 * objectstack#33660 — `costMultiplier` is kept only as the spec declares it
 * (`AiModelsResponseSchema`: a positive number). Anything else is not a
 * multiplier, so the model shows none rather than a guessed one.
 */
function costMultiplierOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * objectstack#35578 — `tierLabel` is kept only as the spec declares it
 * (`AiModelsResponseSchema`: a non-empty string). Anything else is no tier
 * name, so the closed picker shows the label rather than a blank.
 */
function tierLabelOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function normalize(raw: RawModel[]): ChatbotModelOption[] {
  return raw
    .filter((m) => typeof m?.id === 'string' && (m.id as string).length > 0)
    .map((m) => {
      const costMultiplier = costMultiplierOf(m.costMultiplier);
      const tierLabel = tierLabelOf(m.tierLabel);
      return {
        id: m.id as string,
        label: m.label || (m.id as string),
        ...(costMultiplier !== undefined ? { costMultiplier } : {}),
        ...(tierLabel !== undefined ? { tierLabel } : {}),
      };
    });
}

/**
 * Fetch the AI-model allowlist for the current environment.
 *
 * Every request rides the host's AUTHENTICATED fetch (`SchemaRendererProvider`'s
 * `apiFetch`), the channel the renderers' own reads use: a session held by its
 * bearer token alone carries no cookie, so `credentials: 'include'` on the bare
 * global fetch read as anonymous, and a `401` never reached the host's
 * session-ended check. A host that mounts no provider keeps the global fetch,
 * cookies included.
 *
 * @example
 * const { models, defaultModelId } = useAiModels({ apiBase: '/api/v1/ai' });
 */
export function useAiModels(options: UseAiModelsOptions = {}): UseAiModelsReturn {
  const { apiBase, headers, enabled = true } = options;

  const [models, setModels] = useState<ChatbotModelOption[]>([]);
  const [defaultModelId, setDefaultModelId] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [reloadToken, setReloadToken] = useState(0);

  // Stash latest headers in a ref so consumers can pass inline objects without
  // triggering a refetch on every render.
  const headersRef = useRef(headers);
  headersRef.current = headers;
  // The host's authenticated fetch, or the global one with no provider (see the
  // hook's doc). Held in a ref like the headers.
  const apiFetch = useContext(SchemaRendererContext)?.apiFetch;
  const fetchRef = useRef<ApiFetch>(apiFetch ?? fetch);
  fetchRef.current = apiFetch ?? fetch;

  useEffect(() => {
    if (!enabled || !apiBase) return;

    const controller = new AbortController();
    let cancelled = false;
    const url = `${apiBase.replace(/\/$/, '')}/models`;
    // No AI service here, already answered this session: nothing to ask.
    if (noAiServiceUrls.has(url)) return;

    // The env runtime may cold-boot its per-env kernel on first access, so the
    // very first /models hit can transiently 404/503 or return an empty set
    // before the AI plugin is mounted. Retry a few times (short backoff) so the
    // picker self-heals instead of being permanently empty after one race.
    const MAX_ATTEMPTS = 5;
    let attempt = 0;

    const load = async (): Promise<void> => {
      if (cancelled) return;
      setIsLoading(true);
      setError(undefined);
      try {
        const res = await fetchRef.current(url, {
          method: 'GET',
          headers: { Accept: 'application/json', ...(headersRef.current ?? {}) },
          credentials: 'include',
          signal: controller.signal,
        });
        if (res.status === 501) {
          // No AI service: an empty picker, not an error, and never asked again.
          noAiServiceUrls.add(url);
          if (cancelled) return;
          setModels([]);
          setDefaultModelId(undefined);
          setIsLoading(false);
          return;
        }
        if (!res.ok) throw new Error(`Failed to load AI models (${res.status})`);
        const payload = (await res.json()) as { models?: RawModel[]; defaultModel?: string } | RawModel[];
        if (cancelled) return;
        const list = Array.isArray(payload) ? payload : payload?.models ?? [];
        const reportedDefault = Array.isArray(payload) ? undefined : payload?.defaultModel;
        const normalized = normalize(list);
        setModels(normalized);
        setDefaultModelId(reportedDefault ?? list.find((m) => m?.default)?.id ?? list[0]?.id);
        setIsLoading(false);
        // Empty while the kernel is still warming → try again shortly.
        if (normalized.length === 0 && attempt < MAX_ATTEMPTS && !cancelled) {
          attempt += 1;
          setTimeout(() => { void load(); }, 1200);
        }
      } catch (err) {
        if (cancelled || (err as Error)?.name === 'AbortError') return;
        if (attempt < MAX_ATTEMPTS) {
          attempt += 1;
          setTimeout(() => { void load(); }, 1200);
        } else {
          setError(err as Error);
          setModels([]);
          setDefaultModelId(undefined);
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiBase, enabled, reloadToken]);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  return { models, defaultModelId, isLoading, error, refetch };
}
