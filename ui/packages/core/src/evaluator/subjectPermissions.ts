/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The acting subject's effective object permissions, carried to the one place
 * this repo hands a predicate to the CEL engine (objectui#4421).
 *
 * ## What it is for
 *
 * `@objectstack/formula` registers `current_user.can(object, verb)` as a
 * receiver method on the acting subject, and answers it from
 * `EvalContext.permissions` — the verbatim `objects` map of the
 * `/auth/me/permissions` response. That map is a separate field of the engine
 * context, and the engine is explicit that it is ⛔ NOT a CEL variable: an
 * authored predicate must not be able to read `permissions.crm_lead.allowEdit`
 * and step around the closed verb table.
 *
 * This repo's evaluation seam (`evalFieldPredicate`) is not handed an engine
 * context by its callers, though. Every action surface — the row menu, the
 * record header, the `action:*` renderers, `DeclaredActionsBar` — hands it a
 * variable BAG (the host's predicate scope, spread, merged, pushed through an
 * `ExpressionContext`), and the bag's string keys all become CEL roots. So the
 * permissions cannot ride on the bag under a name: any name would be a root.
 *
 * They ride on the SUBJECT instead, under a symbol:
 *
 *  - The engine models the map as the subject's own answer sheet — it binds
 *    `permissions` only alongside a user, and `can` refuses any receiver that
 *    is not that user (`receiver !== subject`). The subject is the one object
 *    every bag already carries by reference under `current_user` (and the
 *    `user` / `ctx.user` / `os.user` aliases of it), through every spread and
 *    every `ExpressionContext` scope, so no surface needs its own copy of the
 *    hand-off.
 *  - A symbol is the one kind of key no predicate dialect can name: CEL
 *    identifiers and member names are strings, and so are the legacy
 *    evaluator's. `current_user.permissions` still faults as an unknown key.
 *
 * ## Absent is not empty
 *
 * A subject that carries NO map — the payload has not loaded, no permission
 * provider is mounted, or the provider has no `/auth/me/permissions` answer at
 * all — hands the engine no `permissions`, and `can` then refuses loudly
 * (`ok: false`, `kind: 'runtime'`). That refusal is a FAULT, so each surface
 * applies its own fault policy to it; it is never turned into a quiet `false`
 * here, because the engine's contract is that an empty map means "holds
 * nothing" and a caller that has no data must not claim it has that answer.
 */

import type { EvalPermissions, EvalSystemPermissions } from '@objectstack/formula';

/**
 * The key the subject carries its effective object permissions under.
 *
 * `Symbol.for` rather than `Symbol()` so two copies of this module in one page
 * (a host that bundles `@object-ui/core` twice) still agree on the key; the
 * namespace keeps it from colliding with anyone else's registry entry.
 */
export const SUBJECT_PERMISSIONS: unique symbol = Symbol.for(
  '@object-ui/core:subject-permissions',
) as never;

type PermissionBearing = { [SUBJECT_PERMISSIONS]?: EvalPermissions };

/**
 * The subject to publish as `current_user`, carrying `permissions` when there
 * are any.
 *
 * Returns a shallow copy so the caller's own user object is never mutated; the
 * copy is what the whole predicate scope must use for every alias of the
 * subject, because the engine compares the `can` receiver by IDENTITY. With no
 * `permissions` the result carries none — a subject built from one that did is
 * stripped rather than left answering from a stale map.
 */
export function bindSubjectPermissions<T extends object>(
  subject: T,
  permissions: EvalPermissions | undefined,
): T {
  if (permissions === undefined) {
    if (!Object.prototype.hasOwnProperty.call(subject, SUBJECT_PERMISSIONS)) return subject;
    const stripped = { ...subject } as T & PermissionBearing;
    delete stripped[SUBJECT_PERMISSIONS];
    return stripped;
  }
  return { ...subject, [SUBJECT_PERMISSIONS]: permissions };
}

/**
 * The effective object permissions a subject carries, or `undefined` when it
 * carries none (see "Absent is not empty" above).
 */
export function subjectPermissionsOf(subject: unknown): EvalPermissions | undefined {
  if (subject === null || typeof subject !== 'object') return undefined;
  return (subject as PermissionBearing)[SUBJECT_PERMISSIONS];
}

/**
 * The key the subject carries its held system capabilities under — the
 * `systemPermissions` list of the `/auth/me/permissions` response, the one
 * input `current_user.hasCapability(name)` is answered from (objectui#13006).
 *
 * It rides beside {@link SUBJECT_PERMISSIONS} for the same reasons: the engine
 * reads it from `EvalContext.systemPermissions`, ⛔ never from a CEL variable,
 * so it can be neither a scope key (every scope key is a root) nor a string
 * member of `current_user` (`current_user.systemPermissions` would be a
 * readable member reaching around the function). A symbol is neither.
 *
 * Absent is not empty, exactly as for the permissions map: a subject carrying
 * no list hands the engine none, and `hasCapability` refuses loudly; an empty
 * list is a real answer ("holds no capability") and evaluates to `false`.
 */
export const SUBJECT_CAPABILITIES: unique symbol = Symbol.for(
  '@object-ui/core:subject-capabilities',
) as never;

type CapabilityBearing = { [SUBJECT_CAPABILITIES]?: EvalSystemPermissions };

/**
 * The subject to publish as `current_user`, carrying `systemPermissions` when
 * there is a list — the sibling of {@link bindSubjectPermissions}, on the same
 * terms: a shallow copy (the caller's object is never mutated, and every alias
 * must be the returned object), and with no list a subject built from one that
 * had a list is stripped rather than left answering from a stale one.
 */
export function bindSubjectCapabilities<T extends object>(
  subject: T,
  systemPermissions: EvalSystemPermissions | undefined,
): T {
  if (systemPermissions === undefined) {
    if (!Object.prototype.hasOwnProperty.call(subject, SUBJECT_CAPABILITIES)) return subject;
    const stripped = { ...subject } as T & CapabilityBearing;
    delete stripped[SUBJECT_CAPABILITIES];
    return stripped;
  }
  return { ...subject, [SUBJECT_CAPABILITIES]: systemPermissions };
}

/**
 * The held system capabilities a subject carries, or `undefined` when it
 * carries none (absent is not empty — see {@link SUBJECT_CAPABILITIES}).
 */
export function subjectCapabilitiesOf(subject: unknown): EvalSystemPermissions | undefined {
  if (subject === null || typeof subject !== 'object') return undefined;
  return (subject as CapabilityBearing)[SUBJECT_CAPABILITIES];
}
