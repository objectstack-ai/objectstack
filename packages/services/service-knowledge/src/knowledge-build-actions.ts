// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The administrator's rebuild entry (ADR-0161 K7, "What starts a rebuild":
 * the operator's rebuild), on the `knowledge` settings namespace beside its
 * `test` action:
 *
 * - `rebuild` — payload `{ "source": "ID" }`. Starts one complete build of
 *   that source (`KnowledgeService.rebuildSource`, trigger `operator`) in the
 *   background and answers at once with the build's record; a build of the
 *   source already running on the node that answers is refused, not doubled.
 * - `index_status` — payload `{}` or `{ "source": "ID" }`. Answers, per
 *   source, what its adapter holds against what the service expects
 *   (`readIndexState`) and the last build this node ran (`buildRecord`):
 *   its progress while it runs, its result once it ended.
 *
 * Both run through the settings action door (`POST /api/settings/knowledge/ACTION`),
 * which gates an HTTP caller on the namespace's write permission,
 * `manage_platform_settings`: an administrator's. `os knowledge rebuild` and
 * `os knowledge status` are their command-line callers.
 *
 * A payload key other than `source` is refused, so a misspelt key is never
 * read as "every source". A build record lives on the node that ran the
 * build; behind a load balancer `index_status` answers for the node that
 * took the request, while the adapter's state it reads is the store's own.
 */

import type { SettingsActionHandler } from '@objectstack/service-settings';
import type { KnowledgeSource } from '@objectstack/spec/ai';
import type { KnowledgeBuildRecord, KnowledgeIndexReading } from './knowledge-build.js';
import type { KnowledgeService } from './knowledge-service.js';

/** The `knowledge` settings action that starts a rebuild of one source. */
export const KNOWLEDGE_REBUILD_ACTION = 'rebuild';

/** The `knowledge` settings action that reads each source's index state and last build. */
export const KNOWLEDGE_INDEX_STATUS_ACTION = 'index_status';

/** The part of `KnowledgeService` the two actions use. */
export type KnowledgeBuildActionsService = Pick<
  KnowledgeService,
  'listSources' | 'getSource' | 'readIndexState' | 'rebuildSource' | 'buildRecord'
>;

/** One source in an `index_status` answer. */
export interface KnowledgeIndexStatusEntry {
  id: string;
  label: string;
  adapter: string;
  kind: KnowledgeSource['source']['kind'];
  /** What the adapter holds against what the service expects. */
  index: KnowledgeIndexReading;
  /** The last build this node ran of the source, or `null`. */
  build: KnowledgeBuildRecord | null;
}

/** The payload keys both actions read. */
const PAYLOAD_KEYS: ReadonlySet<string> = new Set(['source']);

/** `{ source? }` from an action payload, or why the payload is refused. */
function readSourcePayload(payload: unknown): { source?: string } | { refused: string } {
  if (payload === undefined || payload === null) return {};
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    return { refused: 'The payload must be an object: { "source": "ID" }.' };
  }
  const unknown = Object.keys(payload).filter((key) => !PAYLOAD_KEYS.has(key));
  if (unknown.length > 0) {
    return { refused: `Unknown payload key(s): ${unknown.join(', ')}. The only key is "source".` };
  }
  const source = (payload as { source?: unknown }).source;
  if (source === undefined) return {};
  if (typeof source !== 'string' || source.trim() === '') {
    return { refused: '"source" must be a source id: a non-empty string.' };
  }
  return { source: source.trim() };
}

function sourceIds(service: KnowledgeBuildActionsService): string {
  const ids = service.listSources().map((s) => s.id);
  return ids.length === 0 ? 'none is registered' : ids.join(', ');
}

/** The `rebuild` action, bound to `service`. */
export function knowledgeRebuildActionHandler(service: KnowledgeBuildActionsService): SettingsActionHandler {
  return async ({ payload }) => {
    const read = readSourcePayload(payload);
    if ('refused' in read) return { ok: false, severity: 'error', message: read.refused };
    if (read.source === undefined) {
      return { ok: false, severity: 'error', message: `Name the source to rebuild: { "source": "ID" } (${sourceIds(service)}).` };
    }
    const source = service.getSource(read.source);
    if (!source) {
      return { ok: false, severity: 'error', message: `No knowledge source '${read.source}' is registered (${sourceIds(service)}).` };
    }
    if (source.source.kind !== 'object') {
      return {
        ok: false,
        severity: 'error',
        message: `Source '${source.id}' is a ${source.source.kind} source: its adapter (${source.adapter}) ingests it, and the knowledge service does not build it.`,
      };
    }
    const running = service.buildRecord(source.id);
    if (running?.status === 'running') {
      return {
        ok: false,
        severity: 'warning',
        message:
          `A build of source '${source.id}' is already running on this node (started ${running.startedAt}, ` +
          `${running.progress.discovered} row(s) read so far); it was not started again.`,
        details: { source: source.id, build: running },
      };
    }
    // Started, not awaited: a complete build can outlast the request. The
    // promise answers a record and never rejects for a registered source.
    void service.rebuildSource(source.id, { trigger: 'operator' }).catch(() => undefined);
    const build = service.buildRecord(source.id) ?? null;
    return {
      ok: true,
      severity: 'info',
      message:
        `Rebuild of source '${source.id}' started. Every row its where matches is read, and the content fields of ` +
        'each one the index does not already hold unchanged are sent to the embedding provider, which bills for them. ' +
        'Read its progress with os knowledge status.',
      details: { source: source.id, build },
    };
  };
}

/** The `index_status` action, bound to `service`. */
export function knowledgeIndexStatusActionHandler(service: KnowledgeBuildActionsService): SettingsActionHandler {
  return async ({ payload }) => {
    const read = readSourcePayload(payload);
    if ('refused' in read) return { ok: false, severity: 'error', message: read.refused };
    let targets: KnowledgeSource[];
    if (read.source !== undefined) {
      const source = service.getSource(read.source);
      if (!source) {
        return { ok: false, severity: 'error', message: `No knowledge source '${read.source}' is registered (${sourceIds(service)}).` };
      }
      targets = [source];
    } else {
      targets = service.listSources();
    }
    const sources: KnowledgeIndexStatusEntry[] = [];
    for (const source of targets) {
      sources.push({
        id: source.id,
        label: source.label,
        adapter: source.adapter,
        kind: source.source.kind,
        index: await service.readIndexState(source.id),
        build: service.buildRecord(source.id) ?? null,
      });
    }
    const due = sources.filter((s) => s.index.due).length;
    const running = sources.filter((s) => s.build?.status === 'running').length;
    return {
      ok: true,
      severity: 'info',
      message: `${sources.length} source(s): ${due} need a build, ${running} building on this node.`,
      details: { sources },
    };
  };
}
