// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21841] A destructive re-import's refusal prescribes a remedy that works
// from where the caller stands, over the real showcase composition.
//
// ## What was broken
//
// "Import as Object" (`POST /datasources/:name/external/tables/:remote/import`)
// saves through the metadata door's own `saveMetaItem`, so a re-import that
// would drop a field the stored object still carries is refused by that
// door's destructive-change gate, and the import route relays the refusal as
// `400 EXTERNAL_IMPORT_ERROR`. The refusal ended "re-submit with ?force=true to
// proceed." The import route reads no `force`, so a caller who did exactly
// that got the identical refusal back.
//
// The import now states its own write face, and the refusal names the two
// remedies that exist: import the table under a new `name`, or save the changed
// definition through the metadata door, `PUT /api/v1/meta/object/:name?force=true`,
// which accepts the destructive change on purpose. The refusal itself stays:
// nothing here overwrites a stored definition silently.
//
// ## What each case pins
//
// Every remedy the refusal names is FOLLOWED here, and each reaches a
// different answer than the refusal. The one it no longer names (`?force=true`
// on the import route) is followed too, and still answers the refusal: that is
// the fact the refusal's denial states.
//
// The verify harness does not mount the federation service, so this file
// mounts `ExternalDatasourceServicePlugin` itself, as `objectstack dev` and
// `serve` do. The working directory is a temporary one because the showcase's
// external datasource and its fixture both name a cwd-relative SQLite file.
//
// [#21889] Both imported names carry the showcase's ADR-0028 prefix:
// `showcase_external` is declared by the showcase package (namespace
// `showcase`), so an import over it is held to that namespace.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack, { onEnable } from '@objectstack/example-showcase';
import { ExternalDatasourceServicePlugin } from '@objectstack/service-datasource';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The showcase's external datasource and its `customers` table (`external-fixture.ts`). */
const DATASOURCE = 'showcase_external';
const REMOTE = 'customers';
/** The object the first import creates and the re-import would shrink. */
const NAME = 'showcase_dogfood_ext_cust_21841';
/** The remedy's "new `name`". */
const NEW_NAME = 'showcase_dogfood_ext_cust_21841_v2';
/** The column the re-import leaves out, so the stored object would lose its field. */
const DROPPED = 'region';
/** The re-import's options: the same table, one column fewer. */
const SHRINKING = { name: NAME, excludeColumns: [DROPPED] };

const importPath = `/datasources/${DATASOURCE}/external/tables/${REMOTE}/import`;
const draftPath = `/datasources/${DATASOURCE}/external/tables/${REMOTE}/draft`;

interface Envelope {
  success?: boolean;
  error?: { code?: string; message?: string };
  item?: { fields?: Record<string, unknown> };
  data?: { draft?: { definition?: Record<string, unknown> } };
  records?: Array<Record<string, unknown>>;
}

describe('a destructive re-import is refused with a remedy that works (showcase)', () => {
  let stack: VerifyStack;
  let token: string;
  let prevCwd: string;
  let dir: string;
  /** The stored definition right after the first import, before any refusal. */
  let before: Envelope['item'];

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await stack.apiAs(token, method, path, body);
    const json = (await res.json().catch(() => ({}))) as Envelope;
    return { status: res.status, json };
  };

  const stored = async () => {
    const read = await call('GET', `/meta/object/${NAME}`);
    expect(read.status, JSON.stringify(read.json)).toBe(200);
    return read.json.item;
  };

  /** The destructive re-import, asserted refused with the envelope it has always had. */
  const refusedReimport = async (query = '') => {
    const refused = await call('POST', `${importPath}${query}`, SHRINKING);
    expect(refused.status, JSON.stringify(refused.json)).toBe(400);
    expect(refused.json.error?.code).toBe('EXTERNAL_IMPORT_ERROR');
    expect(refused.json.error?.message).toContain('would drop or transform existing data');
    return refused.json.error?.message ?? '';
  };

  beforeAll(async () => {
    prevCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'dogfood-21841-'));
    process.chdir(dir);
    // Provision the remote tables, exactly as `os dev` does at boot.
    await onEnable({ logger: { info() {}, warn() {} } } as never);
    stack = await bootStack(showcaseStack, {
      databaseFile: join(dir, 'showcase.db'),
      extraPlugins: [new ExternalDatasourceServicePlugin()],
    });
    token = await stack.signIn();

    const first = await call('POST', importPath, { name: NAME });
    expect(first.status, JSON.stringify(first.json)).toBe(201);
    before = await stored();
    // Premise: the field the re-import would drop is really on the stored object.
    expect(Object.keys(before?.fields ?? {})).toContain(DROPPED);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
    if (prevCwd) process.chdir(prevCwd);
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('the destructive re-import is still refused, and the stored definition does not move', async () => {
    const message = await refusedReimport();

    expect(message).toContain(`'${DROPPED}' removed`);
    expect(await stored()).toEqual(before);
  });

  it('⛔ the refusal does not prescribe `?force=true` on the import route, which reads none', async () => {
    const message = await refusedReimport();

    // The prescription this refusal used to end with, followed: the import
    // with `?force=true` answers the identical refusal and writes nothing.
    // That is the fact the refusal's denial now states.
    const followed = await refusedReimport('?force=true');
    expect(followed).toBe(message);
    expect(await stored()).toEqual(before);

    expect(message).not.toContain('re-submit with ?force=true');
    expect(message).toContain('accepts no `force`');
  });

  it('following the first remedy, an import under a new `name`, answers 201 and serves the rows', async () => {
    const message = await refusedReimport();
    expect(message).toContain('under a new `name`');

    const renamed = await call('POST', importPath, { ...SHRINKING, name: NEW_NAME });
    expect(renamed.status, JSON.stringify(renamed.json)).toBe(201);

    const rows = await call('GET', `/data/${NEW_NAME}`);
    expect(rows.status, JSON.stringify(rows.json)).toBe(200);
    expect(rows.json.records).toHaveLength(3);
    // …and the object it was refused for is untouched by it.
    expect(await stored()).toEqual(before);
  });

  it('following the second remedy, `PUT /api/v1/meta/object/:name?force=true`, saves the change', async () => {
    const message = await refusedReimport();
    expect(message).toContain(`PUT /api/v1/meta/object/${NAME}?force=true`);

    // The changed definition, from the import's own draft step with the same
    // options: the definition the refused re-import would have saved.
    const draft = await call('POST', draftPath, SHRINKING);
    expect(draft.status, JSON.stringify(draft.json)).toBe(200);
    const drafted = draft.json.data?.draft?.definition;
    // Premise: the draft really is the shrunk definition, not an empty body.
    expect(Object.keys((drafted?.fields ?? {}) as object)).toEqual(expect.arrayContaining(['name', 'email']));
    expect(Object.keys((drafted?.fields ?? {}) as object)).not.toContain(DROPPED);
    const definition = { ...drafted, name: NAME };

    // Control: on that door it is `force` that lifts the refusal.
    const unforced = await call('PUT', `/meta/object/${NAME}`, definition);
    expect(unforced.status, JSON.stringify(unforced.json)).toBe(409);
    expect(JSON.stringify(unforced.json)).toContain('DESTRUCTIVE_CHANGE');
    expect(await stored()).toEqual(before);

    const forced = await call('PUT', `/meta/object/${NAME}?force=true`, definition);
    expect(forced.status, JSON.stringify(forced.json)).toBe(200);

    const after = await stored();
    expect(Object.keys(after?.fields ?? {})).not.toContain(DROPPED);
    expect(Object.keys(after?.fields ?? {})).toEqual(expect.arrayContaining(['name', 'email']));
    const rows = await call('GET', `/data/${NAME}`);
    expect(rows.status, JSON.stringify(rows.json)).toBe(200);
    expect(rows.json.records).toHaveLength(3);
  });
});
