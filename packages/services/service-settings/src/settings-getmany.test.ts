// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10826] `getMany` — one grouped row load instead of one per key.
 *
 * `resolveLocalizationContext` called `get()` three times for one namespace,
 * and each call ran `loadRows` over the whole namespace: three identical
 * `sys_setting` reads inside one request (queries 16–18 of 24 on a live rig,
 * PR #10824). `getMany` resolves N same-namespace keys with AT MOST two row
 * loads (one per required `loadRows` argument — `user`-scoped keys read
 * `(ns, userId)`, everything else `(ns, null)`).
 *
 * The contract pinned here is EQUIVALENCE: for every key, `getMany`'s answer
 * deep-equals what per-key `get()` returns — same value, same source, same
 * lock, same cascadeChain — across env overrides, scope mixes, and the
 * unknown-key refusal. Plus the read-count contract itself, measured at the
 * engine: same-scope keys collapse to ONE find, mixed scopes to TWO, and a
 * fully env-overridden set to ZERO.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SettingsService } from './settings-service.js';
import { UnknownKeyError } from './settings-service.types.js';

// WHERE-matcher gate: implement exactly the combinators the service emits and
// THROW on the rest — a bare field-equality read of `$or` would silently match
// nothing, which is how a fake matcher lies (#11228 hid behind exactly that).
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === '$or') {
      return (v as Array<Record<string, unknown>>).some((b) => matches(row, b));
    }
    if (k.startsWith('$')) throw new Error(`fake matcher: unimplemented combinator ${k}`);
    return (row as any)[k] === v;
  });
}

function makeEngine(rows: Array<Record<string, unknown>>) {
  const find = vi.fn(async (_obj: string, opts: any) =>
    rows.filter((r) => matches(r, opts?.where ?? {})),
  );
  return {
    find,
    insert: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn(),
  };
}

const MANIFEST = {
  namespace: 'localization',
  label: 'Localization',
  specifiers: [
    { key: 'timezone', type: 'string', scope: 'user', default: 'UTC' },
    { key: 'locale', type: 'string', scope: 'user', default: 'en' },
    { key: 'currency', type: 'string', scope: 'tenant', default: null },
  ],
} as any;

// [#12172] Values are stored DECODED, exactly as the persist path writes them
// and as a real driver hands them back — not as JSON text. `sys_setting.value`
// is a `Field.json` column, but the SERVICE is verbatim in both directions
// (`setMany` writes `storedValue = rawValue`; `materialiseRow`'s non-encrypted
// branch is `return row.value ?? null`), so the DRIVER owns the codec and the
// round trip lands back on the raw value on both dialects. The fake engine
// below skips that codec and returns rows exactly as written, so anything
// spelled '"America/New_York"' here would resolve one JSON encoding deep.
// (Matches the sibling fixture in `settings-loadrows-scope.test.ts`.)
const ROWS = [
  { namespace: 'localization', key: 'timezone', scope: 'global', value: 'America/New_York', user_id: null },
  { namespace: 'localization', key: 'locale', scope: 'user', value: 'zh-CN', user_id: 'u1' },
  { namespace: 'localization', key: 'currency', scope: 'tenant', value: 'USD', user_id: null },
];

async function makeService(rows = ROWS) {
  const engine = makeEngine(rows);
  const svc = new SettingsService();
  svc.registerManifest(MANIFEST);
  svc.bindEngine(engine as any);
  return { svc, engine };
}

const prevEnv: Record<string, string | undefined> = {};
beforeEach(() => { prevEnv.OS_LOCALIZATION_TIMEZONE = process.env.OS_LOCALIZATION_TIMEZONE; });
afterEach(() => {
  if (prevEnv.OS_LOCALIZATION_TIMEZONE === undefined) delete process.env.OS_LOCALIZATION_TIMEZONE;
  else process.env.OS_LOCALIZATION_TIMEZONE = prevEnv.OS_LOCALIZATION_TIMEZONE;
});

describe('[#10826] SettingsService.getMany', () => {
  it('answers each key exactly as per-key get() does (value/source/lock/cascade)', async () => {
    const { svc } = await makeService();
    const ctx = { userId: 'u1', tenantId: 't1' };
    const many = await svc.getMany('localization', ['timezone', 'locale', 'currency'], ctx);
    for (const key of ['timezone', 'locale', 'currency']) {
      expect(many[key]).toEqual(await svc.get('localization', key, ctx));
    }
  });

  it('collapses same-namespace reads: mixed scopes → TWO engine finds, not one per key', async () => {
    const { svc, engine } = await makeService();
    engine.find.mockClear();
    await svc.getMany('localization', ['timezone', 'locale', 'currency'], { userId: 'u1' });
    // user-scoped keys share one load, the tenant-scoped key the other.
    expect(engine.find).toHaveBeenCalledTimes(2);
  });

  it('same-scope keys → ONE engine find', async () => {
    const { svc, engine } = await makeService();
    engine.find.mockClear();
    await svc.getMany('localization', ['timezone', 'locale'], { userId: 'u1' });
    expect(engine.find).toHaveBeenCalledTimes(1);
  });

  it('an env-overridden key answers without any row load, exactly like get()', async () => {
    process.env.OS_LOCALIZATION_TIMEZONE = 'Asia/Tokyo';
    const { svc, engine } = await makeService();
    const ctx = { userId: 'u1' };
    engine.find.mockClear();
    const many = await svc.getMany('localization', ['timezone'], ctx);
    expect(engine.find).toHaveBeenCalledTimes(0);
    expect(many.timezone).toEqual(await svc.get('localization', 'timezone', ctx));
    expect(many.timezone.source).toBe('env');
    expect(many.timezone.locked).toBe(true);
  });

  it('refuses an unknown key up front, same error class as get()', async () => {
    const { svc } = await makeService();
    await expect(svc.getMany('localization', ['timezone', 'nope'])).rejects.toThrow(/nope/);
    await expect(svc.get('localization', 'nope')).rejects.toThrow(/nope/);
  });

  // [#11680] The rule the doc comment now states, pinned as a PROPERTY rather
  // than as "it throws": the refusal is TOTAL (no partial Record), it lands
  // BEFORE any row load, and it is the one input on which `getMany` and N
  // per-key `get()` calls part ways. The sibling above asserts only that the
  // message names the bad key — which stays green whatever the blast radius is.
  it('one undeclared key rejects the WHOLE call — before any row load, no partial result', async () => {
    const { svc, engine } = await makeService();
    engine.find.mockClear();

    const err: unknown = await svc
      .getMany('localization', ['timezone', 'currency', 'nope'])
      .then(() => null, (e: unknown) => e);

    // The envelope, not just the throw. This is a service-layer error class:
    // it carries `code` and no `status` (no HTTP boundary here), so `code` is
    // the whole machine-readable envelope there is to assert.
    expect(err).toBeInstanceOf(UnknownKeyError);
    expect((err as UnknownKeyError).code).toBe('SETTINGS_UNKNOWN_KEY');
    expect((err as Error).message).toMatch(
      /Key 'nope' is not declared in manifest 'localization'/,
    );

    // TOTAL and UP-FRONT: the two DECLARED keys were neither answered nor even
    // loaded — validation runs ahead of the grouped `loadRows`.
    expect(engine.find).toHaveBeenCalledTimes(0);

    // ...and here is the non-equivalence: per-key `get()` still answers every
    // declared key on the same input; only the undeclared one throws. Asserted
    // on the resolved cascade LAYER, not on the literal — this fixture stores
    // JSON text in `value` while the service persists values verbatim, so a
    // literal here would pin the fixture's encoding rather than the rule.
    expect((await svc.get('localization', 'timezone')).source).toBe('global');
    expect((await svc.get('localization', 'currency')).source).toBe('tenant');
    await expect(svc.get('localization', 'nope')).rejects.toBeInstanceOf(UnknownKeyError);
  });

  it('getNamespace resolves through the grouped path with unchanged answers', async () => {
    const { svc, engine } = await makeService();
    const ctx = { userId: 'u1' };
    const ns = await svc.getNamespace('localization', ctx);
    expect(ns.values.timezone).toEqual(await svc.get('localization', 'timezone', ctx));
    expect(ns.values.currency).toEqual(await svc.get('localization', 'currency', ctx));
    // and it no longer costs one load per key
    engine.find.mockClear();
    await svc.getNamespace('localization', ctx);
    expect(engine.find.mock.calls.length).toBeLessThanOrEqual(2);
  });

  // [#12172] The ENCODING pin — the one assertion in this file that reads a
  // LITERAL resolved value.
  //
  // Every other assertion here compares `getMany` against `get`, so both sides
  // move together and a fixture stored one JSON encoding deep stays invisible:
  // the same "a fake that lies consistently" shape this file's header already
  // warns about for `$or` matchers. That insensitivity is BY CONSTRUCTION, so
  // "the suite is green" proves nothing about the encoding — only a literal can.
  //
  // Why the literal is the decoded string and not JSON text: `sys_setting.value`
  // is a `Field.json` column, and the SERVICE is verbatim in both directions
  // (`setMany` writes `storedValue = rawValue`; `materialiseRow`'s non-encrypted
  // branch is `return row.value ?? null`). The DRIVER owns the JSON codec and it
  // round-trips to the RAW value on both dialects — SQLite stores primitives
  // as-is and re-parses on read, Postgres stringifies into the `jsonb` column and
  // the client parses it back. So a row handed back by a real driver carries
  // 'America/New_York', never '"America/New_York"'. The fake engine skips that
  // codec, which is why the fixture must already hold the decoded value.
  it('[#12172] resolves the LITERAL stored value — no doubled JSON encoding', async () => {
    const { svc } = await makeService();
    const ctx = { userId: 'u1', tenantId: 't1' };
    const many = await svc.getMany('localization', ['timezone', 'locale', 'currency'], ctx);

    // Global row, user-scope key, no user/tenant override.
    expect(many.timezone.value).toBe('America/New_York');
    // User row for u1.
    expect(many.locale.value).toBe('zh-CN');
    // Tenant row.
    expect(many.currency.value).toBe('USD');

    // ...and the per-key path agrees on the same literal, so the pin holds the
    // ENCODING rather than a `getMany`-only quirk.
    expect((await svc.get('localization', 'timezone', ctx)).value).toBe('America/New_York');
  });
});
