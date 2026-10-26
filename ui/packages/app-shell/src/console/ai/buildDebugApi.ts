// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Client for the admin build-debug endpoint
 * (`GET /api/v1/ai/conversations/:id/debug`, service-ai).
 *
 * The chat renders the build agent's self-report, never what actually landed.
 * This fetches the server-side reconciliation — agent-CLAIMED vs LIVE
 * `sys_metadata` — so a signed-in admin can diagnose a build that "went wrong"
 * from the browser, with no DB credentials. Mirrors `fetchConversation`'s
 * same-origin cookie auth.
 */

export interface ArtifactRef {
  type: string;
  name: string;
}

export interface MutationFinding {
  t?: string;
  tool: string;
  status: string;
  artifact: ArtifactRef;
}

export interface VerifyIssue {
  severity: string;
  code: string;
  artifact?: ArtifactRef;
}

export interface VerifySummary {
  status: string;
  errors: number;
  warnings: number;
  userIssues: VerifyIssue[];
  platformNoise: number;
}

export type TimelineEntry =
  | { t: string; kind: 'user'; text: string }
  | { t: string; kind: 'assistant-text'; text: string; model?: string; tokens?: number; ms?: number }
  | { t: string; kind: 'assistant-calls'; calls: Array<{ name: string; args: unknown }>; model?: string; tokens?: number; ms?: number }
  | { t: string; kind: 'tool-result'; name: string; isError: boolean; status?: string; preview: string };

export interface BuildDebugReport {
  conversationId: string;
  title: string | null;
  summary: {
    models: string[];
    userTurns: number;
    messages: number;
    totalTokens: number;
    llmMs: number;
  };
  reconciliation: {
    orphaned: MutationFinding[];
    missing: MutationFinding[];
    errors: MutationFinding[];
    liveCount: number;
    ok: boolean;
  };
  verify: VerifySummary | null;
  timeline: TimelineEntry[];
  pendingActions: Array<{
    tool: string | null;
    object: string | null;
    status: string | null;
    error: string | null;
    createdAt: string | null;
  }>;
}

/**
 * Fetch the reconciliation report for a build conversation. Returns null on
 * 403/404 (not authorized / unknown conversation) so the caller can show an
 * empty state instead of throwing.
 */
export async function fetchBuildDebug(apiBase: string, conversationId: string): Promise<BuildDebugReport | null> {
  const res = await fetch(`${apiBase}/conversations/${encodeURIComponent(conversationId)}/debug`, {
    credentials: 'include',
  });
  if (res.status === 404 || res.status === 403 || res.status === 401) return null;
  if (!res.ok) throw new Error(`GET build debug failed: ${res.status}`);
  return (await res.json()) as BuildDebugReport;
}
