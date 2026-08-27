// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12313 — the OAuth resource-identifier pair declares a SOURCED bound, and
 * the referrer declares the SAME one as the referent.
 *
 * ## The defect this pins
 *
 * `sys_oauth_resource.identifier` declared `maxLength: 1024`. That number cited
 * no producer: it arrived with the object wholesale (#3080) as generous slack
 * for "a URI". Meanwhile #11701 narrowed the REFERRING column
 * `sys_oauth_client_resource.resource_id` to 768 so its declared index could
 * exist on MySQL at all. The two halves of one foreign key then disagreed about
 * what a legitimate resource identifier is, and only one of them was sourced.
 *
 * The user-visible shape of that disagreement is a SILENT dead end. On
 * PostgreSQL or SQLite — neither of which has MySQL's key-width ceiling — an
 * operator could register a resource whose `identifier` was 900 characters,
 * because the referent's declared contract admitted it, and then no client
 * could ever be granted that resource, because the referring column refused it.
 * Registration succeeds; authorization fails forever; nothing says why.
 *
 * ## What the maintainer ruled (2026-08-26, verbatim 「同意」 on option B)
 *
 * Both columns narrow to **255**, each carrying a producer citation. 255 is not
 * an alignment convenience — it is what the sole writer can physically store.
 * better-auth 1.7.1 (`managedBy: 'better-auth'`, `protection.lock: 'full'`)
 * emits `oauthResource.identifier` as `varchar(255)` on MySQL. Measured, not
 * read: running better-auth's own migration generator against live MySQL 8.0.46
 * and reading `information_schema.COLUMNS` as its own query returns
 * `varchar(255)`, 1020 octets under utf8mb4.
 *
 * Options A (768, unsourced alignment) and C (keep 1024 and merely document it)
 * were weighed and rejected — A because 768 derives from nothing either, C
 * because it preserves the dead end.
 *
 * ## Why the third test is the one that matters
 *
 * Pinning two integers pins two integers. The INVARIANT is that a referring
 * column and its referent admit the same domain, because any gap between them
 * is a register-then-never-authorize dead end by construction. That assertion
 * is what a future re-narrowing of either column has to stay honest against —
 * change one side alone and this file goes red naming the band that just became
 * unreachable.
 */

import { describe, it, expect } from 'vitest';
import { SysOauthResource } from './sys-oauth-resource.object';
import { SysOauthClientResource } from './sys-oauth-client-resource.object';

/**
 * MySQL's utf8mb4 key-part ceiling in CHARACTERS (768 × 4 = 3072 bytes), the
 * same constant `SqlDriver.MAX_KEYABLE_VARCHAR_CHARS` enforces. At or under it
 * a bounded text column is emitted `varchar(n)` and keyed DIRECTLY; above it
 * the column stays TEXT and a UNIQUE index has to be carried on #11627's
 * hash-shadow column instead.
 */
const MAX_KEYABLE_CHARS = 768;

/** What better-auth 1.7.1 physically emits for `oauthResource.identifier`. */
const UPSTREAM_IDENTIFIER_CHARS = 255;

const identifier = () => SysOauthResource.fields.identifier as { maxLength?: unknown };
const resourceId = () => SysOauthClientResource.fields.resource_id as { maxLength?: unknown };

describe('#12313 — sys_oauth_resource.identifier and its referrer carry a sourced bound', () => {
  it('reads the real declarations, not an empty probe', () => {
    // Vacuity control: a renamed field or a changed export would otherwise let
    // every assertion below pass over `undefined`.
    expect(SysOauthResource.name).toBe('sys_oauth_resource');
    expect(SysOauthClientResource.name).toBe('sys_oauth_client_resource');
    expect(identifier()).toBeTypeOf('object');
    expect(resourceId()).toBeTypeOf('object');
    expect(SysOauthResource.indexes).toContainEqual({ fields: ['identifier'], unique: true });
  });

  it('the referent declares the width its sole producer can store', () => {
    expect(
      identifier().maxLength,
      'sys_oauth_resource.identifier must declare the bound better-auth 1.7.1 actually emits ' +
        '(varchar(255) on MySQL, from get-migration.mjs getType’s `field.unique` arm). A wider ' +
        'bound promises a width the only writer of this table cannot store; a narrower one ' +
        'rejects identifiers upstream can legitimately register. Change it only with a new ' +
        'producer measurement in the field’s own citation.',
    ).toBe(UPSTREAM_IDENTIFIER_CHARS);
  });

  it('the referrer admits exactly the referent’s domain — no dead-end band', () => {
    // THE invariant. A referring column narrower than its referent means values
    // the referent accepts can be registered and then never linked; a wider one
    // means the FK admits values that can never have a referent row.
    expect(
      resourceId().maxLength,
      'sys_oauth_client_resource.resource_id is the FK side of ' +
        'sys_oauth_resource.identifier, so it must admit exactly the same domain. Any gap ' +
        'between the two is a silent register-then-never-authorize dead end: the resource ' +
        'registers because the referent accepts the value, and no client can ever be granted ' +
        'it because the referrer refuses it (#12313). Narrow BOTH or neither.',
    ).toBe(identifier().maxLength);
  });

  it('both bounds stay directly keyable, so neither column needs a hash shadow', () => {
    for (const [column, def] of [
      ['sys_oauth_resource.identifier', identifier()],
      ['sys_oauth_client_resource.resource_id', resourceId()],
    ] as const) {
      const n = def.maxLength;
      expect(typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= MAX_KEYABLE_CHARS, `${column} (maxLength: ${String(n)}) must be keyable at or under ${MAX_KEYABLE_CHARS} utf8mb4 characters`).toBe(true);
    }
  });
});
