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

/** A build's progress, as the server reports it. */
export interface KnowledgeBuildProgressView {
  pages?: number;
  discovered?: number;
  indexed?: number;
  skipped?: number;
  failed?: number;
}

/** A build record, as the server reports it. */
export interface KnowledgeBuildView {
  trigger?: string;
  status?: 'running' | 'done' | 'failed' | 'not-run' | 'lease-lost' | 'timed-out';
  startedAt?: string;
  finishedAt?: string;
  progress?: KnowledgeBuildProgressView;
  result?: { ok?: boolean; discovered?: number; indexed?: number; skipped?: number; purged?: number | null; failed?: number; message?: string };
  message?: string;
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
  const p = build.progress ?? {};
  const purged = build.result?.purged;
  const purgedPart = build.status === 'running' ? '' : `${purged === undefined || purged === null ? 'none' : purged} purged, `;
  const counts =
    `${p.discovered ?? 0} row(s) read, ${p.indexed ?? 0} written, ${p.skipped ?? 0} unchanged, ` +
    `${purgedPart}${p.failed ?? 0} cannot be indexed`;
  const when = build.status === 'running' ? `started ${build.startedAt ?? '?'}` : `ended ${build.finishedAt ?? '?'}`;
  return `${build.status ?? 'unknown'} (${build.trigger ?? '?'}, ${when}): ${counts}`;
}
