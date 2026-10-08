// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The GENERIC read door of the settings stores — each namespace's declared
 * `readPermission`, applied to the data API's read of the rows that hold it.
 *
 * ## What it closes
 *
 * The settings door (`GET /api/settings/:namespace`) refuses a caller who lacks
 * the manifest's `readPermission` (`SettingsService.assertPermitted`). The same
 * values, and their audit trail, are rows of `sys_setting`,
 * `sys_setting_audit` and `sys_platform_setting`, and each of those objects
 * exposes `get` / `list` on the generic data API as a diagnostic grid. That
 * door applied the OBJECT's grants only — never the namespace's — so a
 * principal the settings door refused read the namespace's rows there instead.
 *
 * ## The seam
 *
 * An engine middleware the settings plugin registers for exactly those three
 * objects. It ANDs a `namespace` predicate into the operation's `where` for
 * every READ (`find`, `findOne`, `count`, `aggregate`) — a filter, never a
 * pass over the result, so a count, an aggregate and a page see exactly the
 * rows a list returns, and a by-id read of a withheld row answers "not found".
 * The predicate is {@link SettingsService.namespaceReadScope}: the same
 * capability table, from the same `requiredCapability`, the settings door
 * enforces — one rule at two doors.
 *
 * What it does not touch:
 *
 *  - a SYSTEM context — the settings service's own plumbing and every other
 *    platform reader that elevates on purpose;
 *  - writes — the three objects expose no write on the data API, and the
 *    settings door owns every write.
 *
 * A context that is not system and carries no capability holds none, so it
 * reads no namespace at all: the deny baseline, not a hand-through.
 */

import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import type { SettingsService } from './settings-service.js';

/** The objects whose rows carry a settings `namespace`. */
export const SETTINGS_READ_DOOR_OBJECTS: readonly string[] = Object.freeze([
  'sys_setting',
  'sys_setting_audit',
  'sys_platform_setting',
]);

/** The engine verbs that read rows — the four that carry a `where` to scope. */
const READ_OPERATIONS: ReadonlySet<string> = new Set(['find', 'findOne', 'count', 'aggregate']);

/** The engine middleware signature, as `IObjectQLEngine.registerMiddleware` declares it. */
type EngineMiddleware = Parameters<IObjectQLEngine['registerMiddleware']>[0];

/** The capabilities a principal holds, read the way the settings door reads them. */
function capabilitiesOf(context: Record<string, unknown> | undefined): string[] {
  const out: string[] = [];
  for (const field of ['systemPermissions', 'permissions'] as const) {
    const held = context?.[field];
    if (Array.isArray(held)) for (const c of held) if (typeof c === 'string') out.push(c);
  }
  return out;
}

/**
 * The middleware. Exported for the pin that drives it on a real engine; the
 * plugin installs it through {@link registerSettingsReadDoor}.
 */
export function settingsReadDoorMiddleware(service: SettingsService): EngineMiddleware {
  return async (opCtx: any, next: () => Promise<void>): Promise<void> => {
    if (!READ_OPERATIONS.has(opCtx?.operation)) return next();
    const context = opCtx.context as Record<string, unknown> | undefined;
    if (context?.isSystem === true) return next();
    const ast = opCtx.ast as { where?: unknown } | undefined;
    if (!ast || typeof ast !== 'object') {
      // Every engine read carries its query on `opCtx.ast`; one that does not
      // cannot be scoped, so it is refused rather than served unscoped.
      throw new Error(
        `[SettingsService] refused a '${String(opCtx?.operation)}' on '${String(opCtx?.object)}': ` +
          'the operation carries no query to scope by namespace, so the namespace read ' +
          'permissions this object\'s rows are governed by could not be applied.',
      );
    }
    const scope = service.namespaceReadScope(capabilitiesOf(context));
    if (scope) {
      ast.where = ast.where ? { $and: [ast.where, scope] } : scope;
    }
    return next();
  };
}

/**
 * Install the read door on the engine. Answers `false` when the engine offers
 * no middleware seam — the caller reports that, loudly, because the generic
 * read door is then ungated by namespace.
 */
export function registerSettingsReadDoor(engine: unknown, service: SettingsService): boolean {
  const register = (engine as Partial<IObjectQLEngine> | null | undefined)?.registerMiddleware;
  if (typeof register !== 'function') return false;
  const middleware = settingsReadDoorMiddleware(service);
  for (const object of SETTINGS_READ_DOOR_OBJECTS) {
    register.call(engine, middleware, { object });
  }
  return true;
}
