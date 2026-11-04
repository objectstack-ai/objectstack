// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_user.locale` is stored in its BCP-47 case: `zh-cn` and `ZH-CN` are
 * written as `zh-CN`, on every ObjectQL write path that reaches the column.
 *
 * ## The disagreement this removes
 *
 * The column's `locale_bcp47_shape` rule checks the SHAPE of a tag, and the
 * shape is case-blind, so `zh-cn` passed and was stored as written. Two readers
 * of that one value then disagreed: the server's i18n routes and
 * `Accept-Language` matching resolve case-insensitively, while the console
 * picks its UI language by exact match, so a user whose preference was written
 * `zh-cn` by an import, an identity-provider sync or an admin script got an
 * English console with no error anywhere. The console's own language switcher
 * writes `zh-CN`, which is why only API and import writers hit it.
 *
 * #29833 fixed the same disagreement for translation locales by correcting
 * case at the parse (`LocaleSchema` in `@objectstack/spec/system`). This module
 * gives the user-preference column the same answer, through the same parse:
 * the fold is {@link LocaleSchema}'s own, never a second spelling of it (that
 * schema's case helper is package-internal on purpose, and its public face is
 * the parse).
 *
 * ## Fold only, never refuse
 *
 * A value {@link LocaleSchema} does not accept is left exactly as written, so
 * this hook changes the spelling of values the column already accepted and
 * nothing else:
 *
 *  - `zh_CN`, `Chinese`, `zh CN` stay as sent, and the column's own shape rule
 *    refuses them with the same 400 as before;
 *  - `''`, `null` and an absent key stay as sent (clearing the column is how a
 *    user goes back to the deployment default);
 *  - a shape-valid tag no platform locale serves (`xx-YY`) is folded and
 *    stored, as it was stored before. Refusing it would narrow the door, which
 *    is a separate decision.
 *
 * The fold is case only, so a value the shape rule accepts before the fold it
 * accepts after it: the rule's verdict never moves.
 *
 * ## Where it runs
 *
 * Engine `beforeInsert` / `beforeUpdate` hooks on `sys_user`, for EVERY
 * context, `isSystem` included. The write paths that reach the column are the
 * data door (`PATCH /api/v1/data/sys_user/:id` and its bulk form, a user
 * context), the admin bulk identity import (`admin-import-users.ts`, a system
 * context) and the IdP locale claim (`idp-locale-claim.ts`, a system context);
 * better-auth's own adapter never writes the column. Every one of them is an
 * ObjectQL write, so one pair of hooks covers them all. `beforeUpdate`'s
 * predicate path dispatches per matched row over the shared payload
 * (ADR-0058 D3), so a payload folded here binds the whole batch.
 *
 * Priority 5, ahead of the ADR-0092 identity write guard at 10, the same slot
 * `member-role-canonical.ts` holds for `sys_member.role`: the fold decides
 * nothing and performs no I/O, so every judging hook after it sees the stored
 * spelling.
 *
 * ## Rows stored before this
 *
 * Not migrated. A row already stored as `zh-cn` reads back as `zh-cn`, and the
 * console's exact-match pick still renders English for that user until the
 * next write of the column, which this hook folds.
 */

import { LocaleSchema, SystemObjectName } from '@objectstack/spec/system';

const LOCALE_FIELD = 'locale';

/**
 * The value to store for a `sys_user.locale` write: a tag {@link LocaleSchema}
 * accepts, in its BCP-47 case; any other value as given, for the column's shape
 * rule to judge.
 */
export function canonicalUserLocale(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const parsed = LocaleSchema.safeParse(value);
  return parsed.success ? parsed.data : value;
}

export interface UserLocaleCaseFoldOptions {
  packageId: string;
  logger?: { debug?(msg: string, meta?: Record<string, unknown>): void };
}

/** Register the `sys_user.locale` case fold on an ObjectQL engine. */
export function registerUserLocaleCaseFold(engine: any, opts: UserLocaleCaseFoldOptions): void {
  const { packageId, logger } = opts;

  const fold = (event: 'insert' | 'update') => async (ctx: any): Promise<void> => {
    const data = ctx?.input?.data;
    if (!data || typeof data !== 'object') return;
    if (!Object.prototype.hasOwnProperty.call(data, LOCALE_FIELD)) return;
    const before = (data as Record<string, unknown>)[LOCALE_FIELD];
    const after = canonicalUserLocale(before);
    if (after === before) return;
    (data as Record<string, unknown>)[LOCALE_FIELD] = after;
    // Not a degradation: the write proceeds with the spelling every reader
    // matches. `debug` because an import can fold a great many rows.
    logger?.debug?.(
      `[UserLocaleCase] stored sys_user.locale on ${event} in BCP-47 case: ` +
        `${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
    );
  };

  engine.registerHook('beforeInsert', fold('insert'), {
    object: SystemObjectName.USER,
    priority: 5,
    packageId,
  });
  engine.registerHook('beforeUpdate', fold('update'), {
    object: SystemObjectName.USER,
    priority: 5,
    packageId,
  });
}
