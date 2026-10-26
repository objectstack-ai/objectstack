// framework#2782 — identity import adapter unit tests (pure logic, no DOM).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  splitIntoBatches,
  resolveIdentityWriteOptions,
  mergeIdentityBatchResults,
  createIdentityImportDataSource,
  collectTemporaryPasswords,
  buildTemporaryPasswordCsv,
  IDENTITY_IMPORT_BATCH_SIZE,
  IDENTITY_IMPORT_OBJECT,
} from '../identityImport';
import { ObjectStackAdapter, clearSharedDiscoveryCache } from '@object-ui/data-objectstack';
import type { ImportRecordsResult } from '@object-ui/types';

const okResponse = (rows: Array<Record<string, unknown>>, overrides: Record<string, unknown> = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({
    success: true,
    data: {
      summary: { total: rows.length, created: rows.length, updated: 0, skipped: 0, errors: 0, dryRun: false },
      rows: rows.map((_, i) => ({ row: i + 1, ok: true, action: 'created', id: `u-${i}` })),
      ...overrides,
    },
  }),
});

describe('splitIntoBatches', () => {
  it('splits at the endpoint cap and keeps order', () => {
    const rows = Array.from({ length: 1201 }, (_, i) => i);
    const batches = splitIntoBatches(rows);
    expect(batches.map((b) => b.length)).toEqual([500, 500, 201]);
    expect(batches[1][0]).toBe(500);
    expect(IDENTITY_IMPORT_BATCH_SIZE).toBe(500);
  });

  it('handles fewer rows than one batch', () => {
    expect(splitIntoBatches([1, 2, 3]).length).toBe(1);
  });
});

describe('resolveIdentityWriteOptions', () => {
  it('maps insert and upsert-by-email/phone', () => {
    expect(resolveIdentityWriteOptions({})).toEqual({ mode: 'insert' });
    expect(resolveIdentityWriteOptions({ writeMode: 'upsert', matchFields: ['email'] }))
      .toEqual({ mode: 'upsert', matchBy: 'email' });
    expect(resolveIdentityWriteOptions({ writeMode: 'upsert', matchFields: ['phone_number'] }))
      .toEqual({ mode: 'upsert', matchBy: 'phone' });
  });

  it('rejects update mode and unsupported match fields before any batch is sent', () => {
    expect(() => resolveIdentityWriteOptions({ writeMode: 'update', matchFields: ['email'] })).toThrow(/insert and upsert/);
    expect(() => resolveIdentityWriteOptions({ writeMode: 'upsert', matchFields: ['name'] })).toThrow(/email.*phone_number/);
  });
});

describe('mergeIdentityBatchResults', () => {
  it('renumbers batch-local rows onto the whole file and enriches identity', () => {
    const batch1 = [{ email: 'a@x.co' }, { email: 'b@x.co' }];
    const batch2 = [{ phone_number: '+8613800000000' }];
    const merged = mergeIdentityBatchResults(
      [
        {
          summary: { total: 2, created: 2, updated: 0, skipped: 0, errors: 0, dryRun: false },
          rows: [
            { row: 1, ok: true, action: 'created', id: 'u1' },
            { row: 2, ok: true, action: 'created', id: 'u2', temporaryPassword: 'Pw-Two!234567890' },
          ],
        },
        {
          summary: { total: 1, created: 0, updated: 0, skipped: 0, errors: 1, dryRun: false },
          rows: [{ row: 1, ok: false, action: 'failed', code: 'INVALID_PHONE', error: 'bad phone' }],
        },
      ],
      [batch1, batch2],
      { dryRun: false, writeMode: 'insert' },
    );
    expect(merged.total).toBe(3);
    expect(merged.created).toBe(2);
    expect(merged.errors).toBe(1);
    expect(merged.ok).toBe(2);
    expect(merged.results.map((r) => r.row)).toEqual([1, 2, 3]);
    const withPw = merged.results[1] as any;
    expect(withPw.temporaryPassword).toBe('Pw-Two!234567890');
    expect(withPw.identity).toBe('b@x.co');
    const failed = merged.results[2] as any;
    expect(failed.code).toBe('INVALID_PHONE');
    expect(failed.identity).toBe('+8613800000000');
  });
});

describe('createIdentityImportDataSource', () => {
  const makeAdapter = (fetchImpl: ReturnType<typeof vi.fn>, policy: 'auto' | 'none' | 'invite' | 'temporary' = 'auto') =>
    createIdentityImportDataSource({
      base: { find: 'passthrough-marker', createImportJob: () => {}, undoImportJob: () => {} },
      authFetch: fetchImpl as any,
      baseUrl: 'http://srv',
      getPasswordPolicy: () => policy,
    }) as any;

  it('POSTs batches to the identity endpoint with the selected policy', async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({ email: `u${i}@x.co` }));
    const fetchImpl = vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      return okResponse(body.rows) as any;
    });
    const ds = makeAdapter(fetchImpl, 'temporary');
    const res: ImportRecordsResult = await ds.importRecords('sys_user', { format: 'json', rows });

    expect(fetchImpl).toHaveBeenCalledTimes(2); // 500 + 1
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://srv/api/v1/auth/admin/import-users');
    const body = JSON.parse(init.body);
    expect(body.passwordPolicy).toBe('temporary');
    expect(body.mode).toBe('insert');
    expect(body.rows.length).toBe(500);
    expect(res.total).toBe(501);
    expect(res.results.length).toBe(501);
    expect(res.results[500].row).toBe(501); // renumbered across batches
  });

  it('sends the default `auto` policy (framework#3236) when the admin leaves the selector untouched', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: any) => okResponse(JSON.parse(init.body).rows) as any);
    const ds = makeAdapter(fetchImpl); // default policy
    await ds.importRecords('sys_user', { format: 'json', rows: [{ email: 'a@x.co' }] });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).passwordPolicy).toBe('auto');
  });

  it('passes dryRun and upsert options through', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: any) => okResponse(JSON.parse(init.body).rows) as any);
    const ds = makeAdapter(fetchImpl);
    await ds.importRecords('sys_user', {
      format: 'json',
      rows: [{ email: 'a@x.co' }],
      dryRun: true,
      writeMode: 'upsert',
      matchFields: ['email'],
    });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.dryRun).toBe(true);
    expect(body.mode).toBe('upsert');
    expect(body.matchBy).toBe('email');
  });

  it('aborts remaining batches on a request-level failure and surfaces the server message', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ success: false, error: { code: 'EMAIL_SERVICE_REQUIRED', message: 'needs email service' } }),
    }) as any);
    const ds = makeAdapter(fetchImpl, 'invite');
    const rows = Array.from({ length: 1000 }, (_, i) => ({ email: `u${i}@x.co` }));
    await expect(ds.importRecords('sys_user', { format: 'json', rows })).rejects.toThrow('needs email service');
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no second batch
  });

  it('hides the async-job and undo surfaces the wizard feature-detects', () => {
    const ds = makeAdapter(vi.fn());
    expect(ds.createImportJob).toBeUndefined();
    expect(ds.undoImportJob).toBeUndefined();
    expect(ds.cancelImportJob).toBeUndefined();
    expect(ds.find).toBe('passthrough-marker'); // reads pass through
  });
});

/**
 * Saved mappings ARE offered for identity import (objectui#7740) — director
 * seat, decision batch #68, ledger on objectstack#12708.
 *
 * ## What these pins are for, and why not the shape right above them
 *
 * The suite above asserts the six withheld job methods with `toBeUndefined()`.
 * That shape is fine THERE (those keys are written by the object literal, so
 * the only question is their value) but it must not be copied here: it passes
 * both when a key is MISSING and when it is present-and-undefined, which are
 * precisely the two worlds this card is about. Before the fix the wrapper's
 * `listImportMappings` was missing — dropped by the object spread, because
 * `ObjectStackAdapter` declares it in its class body and the spread copies own
 * enumerable properties only. `toBeUndefined()` is green in both worlds and so
 * cannot tell the defect from the fix.
 *
 * What is asserted instead is the fact the wizard actually reads — the exact
 * predicate at `plugin-grid/src/ImportWizard.tsx`, `typeof list === 'function'`
 * — in BOTH directions: offered when the base has it, not fabricated when the
 * base does not.
 */
describe('createIdentityImportDataSource — saved mappings are expressed, not inherited (objectui#7740)', () => {
  const wrap = (base: unknown) =>
    createIdentityImportDataSource({
      base,
      authFetch: vi.fn() as any,
      baseUrl: 'http://srv',
      getPasswordPolicy: () => 'auto',
    }) as any;

  /**
   * A base whose method lives on the PROTOTYPE, exactly like the real
   * `ObjectStackAdapter`. This is the arm that was red before the fix: a plain
   * object base would have carried the method across on the spread and hidden
   * the whole defect.
   */
  class PrototypeBase {
    seen: string[] = [];
    find = 'passthrough-marker';
    async listImportMappings(objectName: string): Promise<unknown[]> {
      this.seen.push(objectName);
      return [{ name: 'user_feed', targetObject: objectName }];
    }
  }

  it('offers `listImportMappings` off a class-instance base — the wizard predicate passes', async () => {
    const base = new PrototypeBase();
    expect(Object.hasOwn(base, 'listImportMappings')).toBe(false); // it is on the prototype
    const ds = wrap(base);

    // The wizard's own probe, verbatim (ImportWizard.tsx).
    expect(typeof ds.listImportMappings).toBe('function');
    // ...and the wrapper says so itself rather than inheriting it: the key is
    // written by the object literal, not carried over by the spread.
    expect(Object.hasOwn(ds, 'listImportMappings')).toBe(true);
  });

  it('binds the forward to the base, so `this` survives the hand-off', async () => {
    const base = new PrototypeBase();
    const ds = wrap(base);

    // Detached exactly the way the wizard detaches it before calling.
    const list = ds.listImportMappings;
    await expect(list(IDENTITY_IMPORT_OBJECT)).resolves.toEqual([
      { name: 'user_feed', targetObject: 'sys_user' },
    ]);
    expect(base.seen).toEqual(['sys_user']); // `this` was still the base
  });

  it('does not fabricate the capability when the base has none', () => {
    // Green before the fix as well as after — its discriminating power is
    // against the WRONG fix (an unconditional forward, or widening the spread
    // to copy the prototype), not against the defect.
    const ds = wrap({ find: 'passthrough-marker' });
    expect(typeof ds.listImportMappings).not.toBe('function');
  });

  it('still withholds the six job surfaces — the forward is one method, not a widened spread', () => {
    const base = new PrototypeBase();
    const ds = wrap(base);
    for (const withheld of [
      'createImportJob',
      'getImportJobProgress',
      'getImportJobResults',
      'listImportJobs',
      'cancelImportJob',
      'undoImportJob',
    ]) {
      expect(typeof ds[withheld]).not.toBe('function');
    }
  });

  it('withholds the generic import template even when the base carries it as an own property (objectui#9600)', () => {
    // A plain-object base: the spread WOULD copy an own method across, so this
    // arm is the one that fails without the explicit `undefined`. The template
    // describes the object's generic import door, not the identity pipeline.
    const ds = wrap({ downloadImportTemplate: async () => new Blob(['x']) });
    expect(typeof ds.downloadImportTemplate).not.toBe('function');
  });
});

/**
 * The three states objectui#7741 gave `listImportMappings` — mappings present /
 * none / the door refused — now actually REACH `sys_user`.
 *
 * #7741 pinned them on the adapter (`data-objectstack/src/listImportMappings.test.ts`).
 * On identity import they were unreachable regardless: the wrapper dropped the
 * method, so the wizard never called it and all three states collapsed into the
 * same "no selector". This drives the real adapter through the real wrapper, so
 * the pin is about the seam between them and not about either end again.
 *
 * The wire body is the shape `data-objectstack`'s own pin measured off the
 * framework's REST list door, retargeted at `sys_user`.
 */
describe('the #7741 three-state read now fires on sys_user through the wrapper (objectui#7740)', () => {
  const BASE_URL = 'http://identity-import-mappings-pin.local';

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  const SYS_USER_MAPPING = {
    name: 'staff_roster',
    label: 'Staff roster',
    sourceFormat: 'csv',
    targetObject: 'sys_user',
    fieldMapping: [
      { source: 'Work Email', target: 'email', transform: 'none' },
      { source: 'Full Name', target: 'name', transform: 'none' },
    ],
    mode: 'insert',
    _diagnostics: { valid: true },
  };

  /** Real adapter + real identity wrapper; only `fetch` is a stub. */
  const wrapReal = (metaAnswer: () => Response) => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/discovery')) {
        return json({ success: true, data: { capabilities: {}, routes: {} } });
      }
      if (url.endsWith('/api/v1/meta/mapping')) return metaAnswer();
      return json({ success: false, error: { code: 'NOT_FOUND', message: `unexpected ${url}` } }, 404);
    });
    const adapter = new ObjectStackAdapter({ baseUrl: BASE_URL, fetch: fetchImpl as any, autoReconnect: false });
    const warnings: unknown[] = [];
    adapter.onMetadataReadWarning((ev) => warnings.push(ev));
    return {
      adapter,
      warnings,
      ds: createIdentityImportDataSource({
        base: adapter,
        authFetch: vi.fn() as any,
        baseUrl: BASE_URL,
        getPasswordPolicy: () => 'auto',
      }) as any,
    };
  };

  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    clearSharedDiscoveryCache();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  it('PRESENT — a mapping registered against sys_user reaches the wizard', async () => {
    const { ds } = wrapReal(() => json({ type: 'mapping', items: [SYS_USER_MAPPING] }));
    expect(typeof ds.listImportMappings).toBe('function');
    const mappings = await ds.listImportMappings(IDENTITY_IMPORT_OBJECT);
    expect(mappings).toHaveLength(1);
    expect(mappings[0]).toMatchObject({ name: 'staff_roster', targetObject: 'sys_user' });
  });

  it('NONE — mappings exist, but none target sys_user', async () => {
    const { ds, warnings } = wrapReal(() =>
      json({ type: 'mapping', items: [{ ...SYS_USER_MAPPING, name: 'task_feed', targetObject: 'task' }] }),
    );
    expect(await ds.listImportMappings(IDENTITY_IMPORT_OBJECT)).toEqual([]);
    expect(warnings).toEqual([]); // an empty answer is not a failure
  });

  it('REFUSED — the door said no; the read still answers [] and the warning still travels', async () => {
    const { ds, warnings } = wrapReal(() =>
      json({ code: 'UNAUTHENTICATED', message: 'authentication required' }, 401),
    );
    // The return contract #7741 deliberately did not move.
    expect(await ds.listImportMappings(IDENTITY_IMPORT_OBJECT)).toEqual([]);
    // ...and the discriminator that card ADDED is what separates this from the
    // NONE arm above. The wrapper does not carry the channel (it is a prototype
    // method too), and it does not have to: `AdapterProvider` subscribes to the
    // adapter itself, which is what production does.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      operation: 'listImportMappings',
      kind: 'mapping',
      objectName: 'sys_user',
      reason: 'refused',
      status: 401,
    });
  });
});

describe('temporary password reveal helpers', () => {
  const result = {
    object: 'sys_user', dryRun: false, writeMode: 'insert',
    total: 2, ok: 2, errors: 0, created: 2, updated: 0, skipped: 0,
    results: [
      { row: 1, ok: true, action: 'created', identity: 'a@x.co', temporaryPassword: 'Aa1!aaaaaaaaaaaa' },
      { row: 2, ok: true, action: 'created' },
    ],
  } as unknown as ImportRecordsResult;

  it('collects only rows that carry a password', () => {
    const entries = collectTemporaryPasswords(result);
    expect(entries).toEqual([{ row: 1, identity: 'a@x.co', temporaryPassword: 'Aa1!aaaaaaaaaaaa' }]);
    expect(collectTemporaryPasswords(undefined)).toEqual([]);
  });

  it('builds a CSV with escaping', () => {
    const csv = buildTemporaryPasswordCsv([
      { row: 1, identity: 'a@x.co', temporaryPassword: 'p,w"1' },
    ]);
    expect(csv.split('\n')[0]).toBe('row,identity,temporary_password');
    expect(csv).toContain('"p,w""1"');
  });
});
