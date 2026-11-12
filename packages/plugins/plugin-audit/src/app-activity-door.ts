// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The activity door's writer: one timeline entry an app adds to a record's
 * activity feed, written by this plugin, which owns `sys_activity`.
 *
 * An app adds an entry through `ctx.activity.append(input)` in a script body
 * (`@objectstack/runtime`). The runtime door parses the body's input against
 * `BodyActivityAppendInputSchema`, reads the record (and `source`) in the
 * caller's scope, and hands the entry here with what the platform stamps: the
 * acting user, the organization and the origin. This writer then holds the
 * ledger's own rules and writes the row as the platform:
 *
 *  - `type` may not be one only the platform records
 *    (`SYS_ACTIVITY_PLATFORM_TYPES`, `@objectstack/spec/data`).
 *  - `metadata` may not use a key the platform's own entries carry
 *    ({@link PLATFORM_ACTIVITY_METADATA_KEYS}): those keys render a recorded
 *    change, an impersonation or a localized summary.
 *  - the record must be of an object whose activity the timeline shows: not one
 *    of `ACTIVITY_FEED_EXCLUDED_OBJECTS`, and not an append-only ledger.
 *  - the actor's name and avatar are the platform's snapshot of the acting user
 *    (the one resolution every activity row is written with), and the time is
 *    the write's.
 *  - `origin` names the package and the body that wrote the entry, so a reader
 *    tells an app's entry from one the platform recorded, whose `origin` is
 *    empty.
 *
 * A refusal is `PERMISSION_DENIED` (403) for a value only the platform may
 * write, and `VALIDATION_ERROR` (400) for an entry with no organization to
 * belong to where the feed is organization-scoped.
 */

import { SYS_ACTIVITY_PLATFORM_TYPES } from '@objectstack/spec/data';
import type { IDataEngine } from '@objectstack/spec/contracts';
import { createFieldPresenceProbe } from '@objectstack/metadata-core';
import { ACTIVITY_FEED_EXCLUDED_OBJECTS } from './objects/sys-activity.object.js';
import { ACTIVITY_TEXT_SOURCES_KEY } from './activity-changed-fields.js';
import { ACTIVITY_SUMMARY_MESSAGE_KEY } from './activity-summary-message.js';
import { IMPERSONATED_BY_KEY, IMPERSONATED_BY_NAME_KEY } from './impersonation-attribution.js';
import type { AuditActorSnapshot } from './audit-writers.js';

/**
 * The `metadata` keys the platform's own activity entries carry, which an app's
 * entry may not use: the recorded change (`old` / `new`), the impersonation
 * attribution, the declaration of where the text columns came from, and the
 * localized summary.
 */
export const PLATFORM_ACTIVITY_METADATA_KEYS: readonly string[] = Object.freeze([
  'old',
  'new',
  IMPERSONATED_BY_KEY,
  IMPERSONATED_BY_NAME_KEY,
  ACTIVITY_TEXT_SOURCES_KEY,
  ACTIVITY_SUMMARY_MESSAGE_KEY,
]);

const PLATFORM_TYPES: ReadonlySet<string> = new Set(SYS_ACTIVITY_PLATFORM_TYPES);

/** One entry as the body asked for it, already parsed by the runtime door. */
export interface AppActivityEntry {
  object: string;
  recordId: string;
  type: string;
  summary: string;
  recordLabel?: string;
  source?: { object: string; id: string };
  metadata?: Record<string, unknown>;
}

/** What the door stamps — never what the body said. */
export interface AppActivityStamp {
  /** The acting user, or `undefined` for a body with none (a scheduled job). */
  actorId: string | undefined;
  /** The caller's organization, or `undefined` when it has none. */
  organizationId: string | undefined;
  /** `<package>/<kind>:<name>` of the body that wrote the entry. */
  origin: string;
}

/** The writer's dependencies, resolved at each call. */
export interface AppActivityWriterDeps {
  getEngine: () => IDataEngine | undefined;
  /**
   * The platform's display snapshot of a user (`installAuditWriters`'
   * `resolveActorSnapshot`), or `undefined` before the writers are installed;
   * the entry is then written with the actor id alone.
   */
  getActorSnapshot: () => ((api: unknown, userId: string) => Promise<AuditActorSnapshot>) | undefined;
}

function refusal(code: 'PERMISSION_DENIED' | 'VALIDATION_ERROR', message: string): Error {
  const status = code === 'PERMISSION_DENIED' ? 403 : 400;
  return Object.assign(new Error(message), { code, status, statusCode: status });
}

/**
 * The refusal for an entry this writer does not write, or `undefined`. Reads
 * the target object's registered schema for its bucket.
 */
export function appActivityEntryRefusal(
  entry: AppActivityEntry,
  schemaOf: (object: string) => { managedBy?: unknown } | null | undefined,
): Error | undefined {
  if (PLATFORM_TYPES.has(entry.type)) {
    return refusal(
      'PERMISSION_DENIED',
      `An app cannot add a '${entry.type}' activity entry: '${entry.type}' is recorded by the platform itself. ` +
        `Use a type of your own (for example 'completed', 'scheduled' or one your app declares).`,
    );
  }
  for (const key of Object.keys(entry.metadata ?? {})) {
    if (PLATFORM_ACTIVITY_METADATA_KEYS.includes(key)) {
      return refusal(
        'PERMISSION_DENIED',
        `An app's activity entry cannot carry metadata key '${key}': the platform's own entries use it. Rename the key.`,
      );
    }
  }
  if (ACTIVITY_FEED_EXCLUDED_OBJECTS.includes(entry.object)) {
    return refusal(
      'PERMISSION_DENIED',
      `An app cannot add an activity entry about a '${entry.object}' record: the activity feed does not show that object's activity.`,
    );
  }
  if (schemaOf(entry.object)?.managedBy === 'append-only') {
    return refusal(
      'PERMISSION_DENIED',
      `An app cannot add an activity entry about a '${entry.object}' record: '${entry.object}' is an append-only ledger.`,
    );
  }
  return undefined;
}

/**
 * Create the activity door's writer. Registered on the `audit` service as
 * `appendAppActivity`.
 */
export function createAppActivityWriter(deps: AppActivityWriterDeps) {
  let probe: ((object: string, field: string) => boolean) | undefined;
  let probedEngine: IDataEngine | undefined;
  return {
    async appendAppActivity(entry: AppActivityEntry, stamp: AppActivityStamp): Promise<{ id: string }> {
      const engine = deps.getEngine();
      if (!engine) throw new Error('The activity feed is not available: no data engine is registered.');
      if (probe === undefined || probedEngine !== engine) {
        probe = createFieldPresenceProbe(engine);
        probedEngine = engine;
      }
      const schemaOf = (object: string): { managedBy?: unknown } | null | undefined => {
        try {
          return typeof (engine as any).getSchema === 'function' ? (engine as any).getSchema(object) : null;
        } catch {
          return null;
        }
      };
      const refused = appActivityEntryRefusal(entry, schemaOf);
      if (refused) throw refused;

      const organizationScoped = probe('sys_activity', 'organization_id');
      if (organizationScoped && !stamp.organizationId) {
        throw refusal(
          'VALIDATION_ERROR',
          'This activity entry has no organization to belong to: the call has no active organization.',
        );
      }

      const context = { isSystem: true, ...(stamp.organizationId ? { tenantId: stamp.organizationId } : {}) };
      const snapshotOf = deps.getActorSnapshot();
      const actor: AuditActorSnapshot =
        stamp.actorId && snapshotOf
          ? await snapshotOf((engine as any).createContext?.(context) ?? engine, stamp.actorId)
          : { name: null, avatarUrl: null };

      const row: Record<string, unknown> = {
        type: entry.type,
        timestamp: new Date().toISOString(),
        summary: entry.summary,
        actor_id: stamp.actorId ?? null,
        ...(actor.name ? { actor_name: actor.name } : {}),
        ...(actor.avatarUrl ? { actor_avatar_url: actor.avatarUrl } : {}),
        object_name: entry.object,
        record_id: entry.recordId,
        record_label: entry.recordLabel ?? null,
        ...(entry.source ? { source_object: entry.source.object, source_id: entry.source.id } : {}),
        ...(entry.metadata ? { metadata: JSON.stringify(entry.metadata) } : {}),
        ...(probe('sys_activity', 'origin') ? { origin: stamp.origin } : {}),
        ...(organizationScoped ? { organization_id: stamp.organizationId } : {}),
      };
      const created: any = await engine.insert('sys_activity', row, { context } as any);
      const id = created?.id ?? created?.data?.id;
      return { id: id != null ? String(id) : '' };
    },
  };
}

/** The writer {@link createAppActivityWriter} answers. */
export type AppActivityWriter = ReturnType<typeof createAppActivityWriter>;
