// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { isStoredMetadataBodyObject, STORED_METADATA_BODY_OBJECTS } from '../kernel/stored-metadata-body-objects';

/**
 * The per-object, READ-ONLY AI exposure declaration, `enable.aiReadable`: its
 * one reading and its one refusal.
 *
 * ## What the key is (ruling A on the read half of #32442)
 *
 * The MCP record tools refuse every system object (`sys_*`) by name, fail
 * closed, and the only switch that lifts the refusal is a host-wide option no
 * deployment opens. Actions on a `sys_*` object are opened per action by their
 * author's own `ai.exposed` (ADR-0011; ADR-0066 D4, note of 2026-10-30). This
 * key is the read counterpart, declared by the system object's own author:
 * `enable.aiReadable: true` lets the read tools (query, get one, aggregate,
 * describe, list) reach the object, with every gate after admission unchanged
 * (the caller's permissions, row-level security, field masking). It never
 * opens a write: a write on a system object stays on its declared actions,
 * each opened by its own `ai.exposed`. There is no write arm, and no
 * deployment switch.
 *
 * ## Where it means something, and where it is refused
 *
 * 1. **The stored-metadata family** ({@link STORED_METADATA_BODY_OBJECTS},
 *    `stored-metadata-body-objects.ts`, the one list) is judged FIRST, before
 *    the key is read: its rows carry serialized metadata bodies, which can
 *    carry credentials, and no declaration opens them. The same order the
 *    action surface keeps (`systemObjectActionExposureError` in the runtime).
 * 2. **A system object** (a `sys_` name: the one predicate the MCP guards
 *    apply, `/^sys_/i`) is where the key has a reader.
 * 3. **Any other object** is refused: the MCP record tools already read a
 *    business object as the caller, under its permissions and its API
 *    exposure (`apiEnabled`, `apiMethods`), so the key would change nothing —
 *    `true` opens nothing new and `false` closes nothing — and an author
 *    reading `false` as a lock is misled (ADR-0049: a key is enforced or it is
 *    not declared).
 *
 * The refusal is judged at parse, in `ObjectSchema`'s refinement
 * (`object.zod.ts`), so every door that parses an object inherits it:
 * `ObjectSchema.create` at module load, `defineStack`, `os validate` and the
 * object save door. The key is new, so no stored object carries it.
 *
 * ## The one reading
 *
 * {@link isAiReadExposed} is the ONE reading every surface that admits an
 * object to the AI read tools asks, exported beside the declaration so no
 * consumer re-derives the order above (the same shape as
 * `isPublicSharingEnabled` in `object.zod.ts`).
 */

/**
 * Whether `objectName` names a system object: a `sys_` name. The predicate the
 * MCP record tools refuse by (`/^sys_/i`); object names are lowercase
 * snake_case, so the flag changes nothing for a parsed name.
 */
function isSystemObjectName(objectName: string): boolean {
  return /^sys_/i.test(objectName);
}

/** Why an object's `enable.aiReadable` is refused — see {@link aiReadExposureRefusal}. */
export interface AiReadExposureRefusal {
  /** Where the refusal is reported: the declaration itself. */
  readonly path: readonly ['enable', 'aiReadable'];
  /** The author-facing sentence. */
  readonly message: string;
}

const AI_READ_EXPOSURE_PATH = ['enable', 'aiReadable'] as const;

/**
 * The refusal of an `enable.aiReadable` declaration on an object where it means
 * nothing, or `undefined` when it is accepted (absent, or declared on a system
 * object outside the stored-metadata family). Any declared value is judged,
 * `false` included: on a business object `false` is a lock that locks nothing.
 */
export function aiReadExposureRefusal(objectName: unknown, enable: unknown): AiReadExposureRefusal | undefined {
  if (enable === null || typeof enable !== 'object') return undefined;
  if (!Object.prototype.hasOwnProperty.call(enable, 'aiReadable')) return undefined;
  if ((enable as { aiReadable?: unknown }).aiReadable === undefined) return undefined;
  const name = typeof objectName === 'string' && objectName.length > 0 ? objectName : 'this object';
  if (typeof objectName === 'string' && isStoredMetadataBodyObject(objectName)) {
    return {
      path: AI_READ_EXPOSURE_PATH,
      message:
        `Object '${name}' stores serialized metadata bodies (${[...STORED_METADATA_BODY_OBJECTS].join(', ')}), ` +
        'and no declaration opens it to AI reads: a stored body can carry credentials, and every read of one ' +
        'goes through the metadata API, which redacts it. Remove enable.aiReadable.',
    };
  }
  if (typeof objectName === 'string' && isSystemObjectName(objectName)) return undefined;
  return {
    path: AI_READ_EXPOSURE_PATH,
    message:
      `Object '${name}' is not a system object, and enable.aiReadable has a meaning only on one (a name ` +
      "starting with 'sys_'): the AI read tools already read a business object as the caller, under the " +
      "caller's permissions and the object's API exposure (enable.apiEnabled, enable.apiMethods), so this " +
      'key would change nothing — true opens nothing and false locks nothing. Remove it; to keep this ' +
      "object's records off every API, agents included, use enable.apiEnabled: false.",
  };
}

/**
 * Has this object opted its records into the AI READ tools —
 * `enable.aiReadable: true` on a system object outside the stored-metadata
 * family?
 *
 * The ONE reading of the declaration: the stored-metadata family is refused
 * before the key is read, a non-system object never answers `true` (the key
 * has no meaning there), and only the boolean `true` opens — a truthy `'true'`
 * or `1` that never went through the schema does not. Fail-closed: an
 * unreadable schema answers `false`. It answers reads only; nothing here opens
 * a write.
 */
export function isAiReadExposed(schema: unknown): boolean {
  if (schema === null || typeof schema !== 'object') return false;
  const { name, enable } = schema as { name?: unknown; enable?: unknown };
  if (typeof name !== 'string' || isStoredMetadataBodyObject(name)) return false;
  if (!isSystemObjectName(name)) return false;
  return (enable as { aiReadable?: unknown } | null | undefined)?.aiReadable === true;
}
