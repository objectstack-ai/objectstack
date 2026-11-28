// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The client half of `os knowledge rebuild` and `os knowledge status`: the
 * `knowledge` settings namespace's `rebuild` and `index_status` actions
 * (`@objectstack/service-knowledge`, `knowledge-build-actions.ts`), reached
 * through the settings action door, `POST /api/settings/knowledge/ACTION`,
 * which admits an administrator only (`manage_platform_settings`).
 *
 * The shapes below are the fields these commands read of the action's
 * `details`, not a copy of the service's types: the CLI does not depend on the
 * knowledge service package, and a field the server stops sending reads as
 * absent and is printed as such, never guessed.
 */

import { readEnvelopeFrom } from './response-envelope.js';

/** Where the commands send their request. */
export interface KnowledgeTarget {
  url: string;
  token?: string;
}

/** Resolve server URL + token from flags, then the environment (mirrors `createApiClient`). */
export function resolveKnowledgeTarget(flags: { url?: string; token?: string }): KnowledgeTarget {
  const url = (flags.url || process.env.OS_CLOUD_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const token = flags.token || process.env.OS_TOKEN;
  return { url, ...(token ? { token } : {}) };
}

/** A build's counts, as the source's sync state records them. */
export interface KnowledgeBuildCountsView {
  discovered?: number;
  indexed?: number;
  skipped?: number;
  /** `null` while the build runs, and for a build that purged nothing. */
  purged?: number | null;
  failed?: number;
}

/**
 * A source's last build, as its sync state records it: one durable record per
 * source, the same on every node, kept across restarts.
 */
export interface KnowledgeBuildView {
  trigger?: string;
  /** `interrupted`: the node running it stopped before it ended. */
  status?: 'running' | 'done' | 'failed' | 'lease-lost' | 'timed-out' | 'interrupted';
  startedAt?: string;
  finishedAt?: string;
  counts?: KnowledgeBuildCountsView;
  message?: string;
}

/** A source's record syncs that spent every attempt and are not yet repaired. */
export interface KnowledgeFailuresView {
  count?: number;
  firstFailedAt?: string;
  lastFailedAt?: string;
  lastError?: string;
}

/** One source of an `index_status` answer. */
export interface KnowledgeSourceView {
  /** The source as `search_knowledge` lists it: `NAMESPACE-NAME` for a package's source, the bare name otherwise. */
  id: string;
  label?: string;
  adapter?: string;
  /** The package that holds the source; absent for a source no package holds. */
  packageId?: string;
  index?: { state?: string; due?: boolean; detail?: string };
  build?: KnowledgeBuildView | null;
  /** `null` when the sync state could not be read (`syncStateError` says why). */
  failures?: KnowledgeFailuresView | null;
  syncStateError?: string;
}

/** The record-sync queue of an `index_status` answer. */
export interface KnowledgeQueueView {
  queue?: string;
  /** Record syncs waiting, every source's together. */
  pending?: number;
  error?: string;
}

/** What one action answered: its result, or the server's refusal text. */
export type KnowledgeActionAnswer =
  | { ok: true; message?: string; details: Record<string, unknown> }
  | { ok: false; message: string };

/** Run one `knowledge` settings action. */
export async function runKnowledgeAction(
  target: KnowledgeTarget,
  action: 'rebuild' | 'index_status',
  payload: Record<string, unknown>,
): Promise<KnowledgeActionAnswer> {
  let res: Response;
  try {
    res = await fetch(`${target.url}/api/settings/knowledge/${action}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(target.token ? { authorization: `Bearer ${target.token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { ok: false, message: `The server at ${target.url} could not be reached (${err instanceof Error ? err.message : String(err)}).` };
  }
  const envelope = await readEnvelopeFrom<{ ok?: boolean; message?: string; details?: unknown }>(res);
  if (!envelope.ok) return { ok: false, message: envelope.message };
  const details = envelope.data.details;
  return {
    ok: true,
    ...(typeof envelope.data.message === 'string' ? { message: envelope.data.message } : {}),
    details: typeof details === 'object' && details !== null ? (details as Record<string, unknown>) : {},
  };
}

/** One line of a build's counts. */
export function describeBuild(build: KnowledgeBuildView): string {
  const c = build.counts ?? {};
  const purgedPart = build.status === 'running' ? '' : `${c.purged === undefined || c.purged === null ? 'none' : c.purged} purged, `;
  const counts =
    `${c.discovered ?? 0} row(s) read, ${c.indexed ?? 0} written, ${c.skipped ?? 0} unchanged, ` +
    `${purgedPart}${c.failed ?? 0} cannot be indexed`;
  const when = build.status === 'running' ? `started ${build.startedAt ?? '?'}` : `ended ${build.finishedAt ?? '?'}`;
  return `${build.status ?? 'unknown'} (${build.trigger ?? '?'}, ${when}): ${counts}`;
}

/** One line of a source's failed record syncs. */
export function describeFailures(failures: KnowledgeFailuresView): string {
  const count = failures.count ?? 0;
  if (count === 0) return 'none';
  return `${count} not yet repaired (first ${failures.firstFailedAt ?? '?'}, last ${failures.lastFailedAt ?? '?'})`;
}
