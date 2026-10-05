// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The turso/libSQL config contract (commit e2798fab7).
 *
 * These assertions are what "`validateDriverConfig('turso')` flipped from
 * `{ known: false }` to `{ known: true }`" MEANS in practice: before this file
 * every one of the rejections below was an acceptance, because the platform had
 * no shape to judge a libSQL `config` against.
 */

import { describe, expect, it } from 'vitest';

import { findClosestMatches } from '../../shared/suggestions.zod';
import { DatasourceSchema } from '../datasource.zod';
import { validateDriverConfig } from './config-registry.zod';
import { TursoConfigSchema, TursoDriverSpec } from './turso.zod';

describe('TursoConfigSchema', () => {
  it('accepts the shapes the driver actually connects with', () => {
    // `{ url, authToken }` left this list in #7990: an inline `authToken` is
    // refused at authoring (driver-credential-refusal.test.ts pins it). The
    // remote-with-credential shape is authored as `{ url }` +
    // `external.credentialsRef`; the boot hosts' env-resolved token never
    // passes through this schema.
    for (const config of [
      { url: 'libsql://my-db.turso.io' },
      { url: 'file:./data/objectstack.db' },
      { url: ':memory:' },
      { url: 'file:./local.db', syncUrl: 'libsql://my-db.turso.io', sync: { intervalSeconds: 60 } },
      { url: 'libsql://x.turso.io', concurrency: 10, timeoutMs: 5000, mode: 'remote' },
      // #19977 preservation: what the driver accepts stays accepted.
      { url: 'LIBSQL://x.turso.io' },
      { url: 'FILE:./data/replica.db', syncUrl: 'libsql://x.turso.io' },
      { url: 'file:./data/replica.db', mode: 'replica', syncUrl: 'libsql://x.turso.io' },
      // #20586: a forced `mode: 'local'` beside a NON-empty `syncUrl` left this
      // list (refused on `mode`, below); an empty `syncUrl` is unset, so this stays.
      { url: 'file:./data/app.db', mode: 'local', syncUrl: '' },
      { url: 'file:./data/app.db', mode: 'remote' },
      { url: './data/app.db', mode: 'remote' },
      { url: 'wss://x.turso.io' },
      { url: 'https://x.turso.io', timeoutMs: 5000 },
      { url: 'file:./data/replica.db', syncUrl: 'wss://x.turso.io', timeoutMs: 5000 },
      { url: ' file:./data/app.db' },
      { url: 'libsql://x.turso.io', syncUrl: '' },
    ]) {
      const result = TursoConfigSchema.safeParse(config);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    }
  });

  // `url` is the fact that makes `hasLocalDefault: false` true for turso, and
  // the reason both boot hosts refuse a turso selection with no URL.
  it('REQUIRES url — there is no libSQL endpoint to guess', () => {
    expect(TursoConfigSchema.safeParse({}).success).toBe(false);
    expect(TursoConfigSchema.safeParse({ authToken: 'jwt' }).success).toBe(false);
  });

  // The exact failure this contract was written for: `token` is the plausible
  // spelling, `authToken` is the real one, and before commit e2798fab7 the misspelling was
  // accepted in silence and the connection attempted unauthenticated. Until
  // #7990 the fix was a rename hint onto `authToken`; now that `authToken` is
  // itself unwritable the same spelling gets the credential refusal directly —
  // a rename hint would send the author into a second rejection.
  it('rejects `token` with the inline-credential refusal, not a rename hint', () => {
    const result = TursoConfigSchema.safeParse({ url: 'libsql://x.turso.io', token: 'jwt' });
    expect(result.success).toBe(false);
    const issues = JSON.stringify(result.error?.issues);
    expect(issues).toContain('credentialsRef');
    expect(issues).toContain('sys_secret');
    expect(issues).not.toContain('Did you mean');
  });

  it('rejects `sync` without `syncUrl` — on its own it configures nothing', () => {
    const result = TursoConfigSchema.safeParse({
      url: 'file:./local.db',
      sync: { intervalSeconds: 60 },
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('syncUrl');
  });

  it('points a sqlite-style `filename` at `url` rather than accepting it', () => {
    const result = TursoConfigSchema.safeParse({ filename: './data/objectstack.db' });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('url');
  });

  // The alias block above this shape's keys used to be headed "the spellings
  // edit distance cannot reach", which is true of five of its six rows and
  // false of `uri`. The two roles are pinned separately because they fail
  // differently: drop a GAP row and the author gets silence, drop the `uri`
  // row and nothing observable changes today — its value is that it keeps
  // answering `url` if this shape ever gains a key within 2 of `uri`.
  describe('the alias table, by role', () => {
    const rename = (key: string, value: unknown) => {
      const result = TursoConfigSchema.safeParse({ url: 'libsql://x.turso.io', [key]: value });
      expect(result.success).toBe(false);
      const issue = result.error!.issues.find((i) => i.code === 'unrecognized_keys');
      expect(issue, 'the refusal carries an unrecognized-keys issue').toBeDefined();
      return issue!.message;
    };

    it('`dsn` is the GAP case — 3 edits from `url` against a budget of 2', () => {
      // Nothing declared on this shape is within 2 of `dsn`, so without the
      // row the refusal names the key and stops.
      expect(rename('dsn', 'libsql://x.turso.io')).toContain('`dsn` → `url`');
    });

    it('`uri` is NOT — the bare fallback already reaches `url` at distance 1', () => {
      // `uri` is 3 characters, so the budget is `Math.max(2, floor(3 / 3))` = 2
      // and `uri`/`url` differ by exactly 1. The row and the fallback agree, so
      // this message is what an author sees either way — which is the whole
      // point: the entry is not what makes the suggestion possible.
      //
      // `shape` is a conservative SUPERSET of the candidate list the error map
      // spends (that one drops the `authToken`/`timeout` tombstones via
      // `acceptsNothing`); extra candidates can only crowd `url` out, never
      // help it, so a pass here holds for the real list too.
      expect(findClosestMatches('uri', Object.keys(TursoConfigSchema.shape), 2, 1)).toEqual(['url']);
      expect(rename('uri', 'libsql://x.turso.io')).toContain('`uri` → `url`');
    });
  });
});

describe('turso is a known driver to the config registry now', () => {
  it('validateDriverConfig answers `known: true` for both spellings', () => {
    expect(validateDriverConfig('turso', { url: 'libsql://x.turso.io' }))
      .toEqual({ known: true, issues: [] });
    expect(validateDriverConfig('libsql', { url: 'libsql://x.turso.io' }))
      .toEqual({ known: true, issues: [] });
  });

  it('a bad turso config now produces ISSUES instead of `{ known: false }`', () => {
    const result = validateDriverConfig('turso', { token: 'jwt' });
    expect(result.known).toBe(true);
    expect(result.known && result.issues.length).toBeGreaterThan(0);
  });

  // The consumer that matters most: `DatasourceSchema` replays the driver-config
  // parse onto its own issue list, so the flip reaches authored metadata.
  it('DatasourceSchema now judges a turso datasource config', () => {
    expect(DatasourceSchema.safeParse({
      name: 'edge', driver: 'turso', config: { url: 'libsql://x.turso.io' },
    }).success).toBe(true);
    // An inline `authToken` is refused (#7990), re-pathed under the config slot
    // it was written in — driver-credential-refusal.test.ts pins the message.
    expect(DatasourceSchema.safeParse({
      name: 'edge', driver: 'turso', config: { url: 'libsql://x.turso.io', authToken: 'jwt' },
    }).success).toBe(false);
    expect(DatasourceSchema.safeParse({
      name: 'edge', driver: 'turso', config: { token: 'jwt' },
    }).success).toBe(false);
  });
});

describe('TursoDriverSpec', () => {
  it('publishes the canonical id and a projected config schema', () => {
    expect(TursoDriverSpec.id).toBe('turso');
    expect(TursoDriverSpec.label).toBe('Turso / libSQL');
    const json = TursoDriverSpec.configSchema as { type?: string; properties?: Record<string, unknown> };
    expect(json.type).toBe('object');
    expect(Object.keys(json.properties ?? {})).toContain('url');
  });
});

// #15680 (stack card 5/6 of #14478) — ruling B. The old spelling is a
// `retiredKey()` tombstone; asserted on the issue CODE and the prescription,
// never on a bare `toThrow()` — this shape IS `strictObject`, so a bare throw
// assertion passes identically on the unrecognized-key error, which is precisely
// the error that cannot carry a FROM → TO mapping.
describe('TursoConfig.timeout carries its unit', () => {
  const base = { url: 'libsql://app.turso.io' };

  it('REFUSES the retired `timeout` with the rename in the message', () => {
    const result = TursoConfigSchema.safeParse({ ...base, timeout: 30000 });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'timeout');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain('`turso config.timeout` was renamed to `timeoutMs`');
  });

  it('accepts `timeoutMs` at the same magnitude and still refuses a non-positive one', () => {
    expect(TursoConfigSchema.parse({ ...base, timeoutMs: 30000 }).timeoutMs).toBe(30000);
    expect(TursoConfigSchema.safeParse({ ...base, timeoutMs: 0 }).success).toBe(false);
  });

  it('leaves `sync.intervalSeconds` alone — it already carried its unit, and is the neighbour that made the bare `timeout` a collision', () => {
    // A replica on a local file (#19977): `syncUrl` beside the remote `base`
    // url is a configuration the driver refuses, and this schema now does too.
    const parsed = TursoConfigSchema.parse({
      url: 'file:./data/replica.db',
      syncUrl: 'libsql://replica.turso.io',
      sync: { intervalSeconds: 60 },
    });
    expect(parsed.sync!.intervalSeconds).toBe(60);
  });
});

// #19977 — the transport refusals: every combination `new TursoDriver` refuses
// at construction (since #20200 that includes `syncUrl` under a forced
// `mode: 'remote'`, which it used to construct and ignore; since #20437 a
// forced `mode: 'replica'` with no `syncUrl`, which it used to construct as a
// replica that never synced; since #20586 a forced `mode: 'local'` beside a
// `syncUrl`, which it used to construct as a `local` database and then sync
// anyway), refused at authoring. Asserted on the envelope — the
// issue code, the key it sits on, and the spelling it prescribes — never on a
// bare `success: false`, which a schema refusing for some OTHER reason (a
// credential, a placeholder) would satisfy identically. The driver-local mirror
// and the constructor are held to the same table in
// `packages/drivers/driver-turso/src/spec/turso-config-constructor-parity.test.ts`.
describe('TursoConfigSchema refuses what the turso driver refuses', () => {
  /** The one refusal a config earns, asserted to be the only issue there is. */
  const refusal = (config: Record<string, unknown>) => {
    const result = TursoConfigSchema.safeParse(config);
    expect(result.success, 'the config is refused').toBe(false);
    const issues = result.error!.issues;
    expect(issues, JSON.stringify(issues)).toHaveLength(1);
    expect(issues[0].code).toBe('custom');
    return { path: issues[0].path.join('.'), message: issues[0].message };
  };

  describe('a remote url in a local or replica mode — refused on `url`', () => {
    it('beside `syncUrl`: drop `syncUrl`, or put the replica on a local file', () => {
      for (const url of ['libsql://db.turso.io', 'https://db.turso.io', 'http://127.0.0.1:8080', 'wss://db.turso.io', 'Ws://127.0.0.1:8080', 'LIBSQL://db.turso.io']) {
        const { path, message } = refusal({ url, syncUrl: 'libsql://db.turso.io' });
        expect(path).toBe('url');
        expect(message).toContain('is a remote');
        expect(message).toContain('`syncUrl` makes this datasource an embedded replica');
        expect(message).toContain('For a remote database, drop `syncUrl` (and `sync`) and keep the remote url alone.');
        expect(message).toContain("keep the remote in `syncUrl`: `url: 'file:./data/replica.db'`.");
      }
    });

    it('echoes the scheme as written and nothing else of the url', () => {
      const { message } = refusal({ url: 'LIBSQL://secret-host.turso.io', syncUrl: 'libsql://db.turso.io' });
      expect(message).toContain('`url` is a remote `LIBSQL://` url');
      expect(message).not.toContain('secret-host');
    });

    it("under a forced `mode: 'replica'`: drop `mode` or set it remote", () => {
      const { path, message } = refusal({ url: 'libsql://db.turso.io', mode: 'replica' });
      expect(path).toBe('url');
      expect(message).toContain("`mode: 'replica'` makes this datasource an embedded replica");
      expect(message).toContain("For a remote database, drop `mode` (a `libsql://` url is detected as remote) or set `mode: 'remote'`.");
      expect(message).toContain("name the remote in `syncUrl`: `url: 'file:./data/replica.db'`.");
    });

    it("under a forced `mode: 'replica'` with `syncUrl`: the remote way out drops `syncUrl` too", () => {
      const { message } = refusal({ url: 'libsql://db.turso.io', mode: 'replica', syncUrl: 'libsql://db.turso.io' });
      expect(message).toContain("or set `mode: 'remote'`, and drop `syncUrl` (and `sync`).");
    });

    it("under a forced `mode: 'local'`: the local way out is a `file:` url", () => {
      const { path, message } = refusal({ url: 'https://db.turso.io', mode: 'local' });
      expect(path).toBe('url');
      expect(message).toContain("`mode: 'local'` makes this datasource a local database");
      expect(message).toContain("For a local database, point `url` at a file: `url: 'file:./data/app.db'`.");
    });
  });

  describe('a url that is none of `file:`, `:memory:` or remote, in a local or replica mode — refused on `url`', () => {
    it('with no `mode` and no `syncUrl`: a bare path, another scheme, `:MEMORY:`, a scheme with no `//`', () => {
      for (const url of ['./data/app.db', 'data/app.db', '/var/lib/app.db', 'sqlite:./x.db', 'memory://', ':MEMORY:', 'libsql:db.turso.io']) {
        const { path, message } = refusal({ url });
        expect(path, url).toBe('url');
        expect(message).toContain('`url` is not a url the turso driver can open');
        expect(message).toContain('With no `mode` and no remote scheme, this datasource is a local database');
        expect(message).toContain("spell the path as a `file:` url: `url: 'file:./data/app.db'`.");
        expect(message).toContain("For a throwaway in-memory database, `url: ':memory:'`.");
        expect(message).toContain('For a remote database, use one of the remote schemes above.');
      }
    });

    it('beside `syncUrl`: the replica spelling, and `syncUrl` named in the remote way out', () => {
      const { path, message } = refusal({ url: './data/replica.db', syncUrl: 'libsql://db.turso.io' });
      expect(path).toBe('url');
      expect(message).toContain('`syncUrl` makes this datasource an embedded replica');
      expect(message).toContain("keep the remote in `syncUrl`: `url: 'file:./data/replica.db'`.");
      expect(message).toContain('For a remote database, drop `syncUrl` (and `sync`) and use one of the remote schemes above.');
    });

    it("under a forced `mode: 'local'`: `mode` named in the remote way out", () => {
      const { message } = refusal({ url: './data/app.db', mode: 'local' });
      expect(message).toContain("`mode: 'local'` makes this datasource a local database");
      expect(message).toContain("For a remote database, drop `mode: 'local'` and use one of the remote schemes above.");
    });
  });

  describe('a replica on an in-memory url — refused on `url`', () => {
    it('`:memory:`, `file::memory:` in any case, and a `:memory:?` query, beside `syncUrl`', () => {
      for (const url of [':memory:', 'file::memory:', 'FILE::memory:', 'file::memory:?cache=shared']) {
        const { path, message } = refusal({ url, syncUrl: 'libsql://db.turso.io' });
        expect(path, url).toBe('url');
        expect(message).toContain('`url` names an in-memory database, so it cannot hold the embedded replica `syncUrl` asks for');
        expect(message).toContain("Point `url` at a local file (`url: 'file:./data/replica.db'` beside `syncUrl`), or drop `syncUrl` (and `sync`) for a plain in-memory local database.");
      }
    });

    it("under a forced `mode: 'replica'`: dropping `mode` is the in-memory way out", () => {
      const { message } = refusal({ url: ':memory:', mode: 'replica' });
      expect(message).toContain("cannot hold the embedded replica `mode: 'replica'` asks for");
      expect(message).toContain("or drop `mode: 'replica'` for a plain in-memory local database.");
    });
  });

  it('`timeoutMs` beside a WebSocket url in remote mode — refused on `timeoutMs`', () => {
    for (const config of [
      { url: 'wss://db.turso.io', timeoutMs: 5000 },
      { url: 'WS://127.0.0.1:8080', timeoutMs: 5000 },
      { url: 'wss://db.turso.io', timeoutMs: 5000, mode: 'remote' },
    ]) {
      const { path, message } = refusal(config);
      expect(path, config.url).toBe('timeoutMs');
      expect(message).toContain('rides @libsql/client\'s WebSocket transport');
      expect(message).toContain('Either drop `timeoutMs` and run this remote database unbounded, or keep it and spell the url `libsql://` or `https://`');
    }
  });

  it("`syncUrl` under a forced `mode: 'remote'` — the driver refuses it when it starts, so it is refused on `syncUrl`", () => {
    for (const config of [
      { url: 'libsql://db.turso.io', mode: 'remote', syncUrl: 'libsql://db.turso.io' },
      { url: 'libsql://db.turso.io', mode: 'remote', syncUrl: 'libsql://db.turso.io', sync: { intervalSeconds: 60 } },
      { url: 'file:./data/replica.db', mode: 'remote', syncUrl: 'libsql://db.turso.io' },
    ]) {
      const { path, message } = refusal(config);
      expect(path).toBe('syncUrl');
      expect(message).toContain("`syncUrl` configures an embedded replica, but `mode: 'remote'`");
      expect(message).toContain('builds no replica: the turso driver refuses this configuration when it starts.');
      expect(message).toContain('For a remote database, drop `syncUrl` (and `sync`).');
      expect(message).toContain("For an embedded replica, drop `mode` and point `url` at a local file beside `syncUrl`: `url: 'file:./data/replica.db'`.");
    }
  });

  // #20437 — a forced replica with nothing to replicate from. The driver used to
  // build it as a replica and run it as a plain local database that never
  // synced; both now refuse it, on `mode`, in one message.
  describe("a forced `mode: 'replica'` with no `syncUrl` — refused on `mode`", () => {
    const FIRST_SENTENCE =
      "`mode: 'replica'` makes this datasource an embedded replica, a local file kept in sync with "
      + 'the remote named in `syncUrl`, but no `syncUrl` is set: nothing would ever sync, so it would '
      + 'run as a plain local database that never replicates — the turso driver refuses this '
      + 'configuration when it starts.';

    it('on a `file:` url in any case, beside an empty `syncUrl` or `timeoutMs`: add `syncUrl`, or drop `mode`', () => {
      for (const config of [
        { url: 'file:./data/replica.db', mode: 'replica' },
        { url: 'FILE:./data/replica.db', mode: 'replica' },
        { url: 'file:./data/replica.db', mode: 'replica', syncUrl: '' },
        { url: ' file:./data/replica.db', mode: 'replica', timeoutMs: 5000 },
      ]) {
        const { path, message } = refusal(config);
        expect(path, JSON.stringify(config)).toBe('mode');
        expect(message.startsWith(FIRST_SENTENCE), message).toBe(true);
        expect(message).toContain(
          "For an embedded replica, name the remote in `syncUrl` beside the local file: "
          + "`url: 'file:./data/replica.db'` with `syncUrl` set to the `libsql://` or `https://` Turso endpoint.",
        );
        expect(message).toContain("For a plain local database, drop `mode: 'replica'`.");
      }
    });

    it('a url another refusal takes keeps that refusal, on `url`', () => {
      for (const url of ['libsql://db.turso.io', ':memory:', './data/replica.db']) {
        const { path, message } = refusal({ url, mode: 'replica' });
        expect(path, url).toBe('url');
        expect(message.startsWith(FIRST_SENTENCE)).toBe(false);
      }
    });

    it('beside `sync`: both refusals stand, `sync` first — the one the constructor throws', () => {
      const result = TursoConfigSchema.safeParse({ url: 'file:./data/replica.db', mode: 'replica', sync: { intervalSeconds: 60 } });
      expect(result.success).toBe(false);
      expect(result.error!.issues.map((i) => i.path.join('.'))).toEqual(['sync', 'mode']);
      expect(result.error!.issues[1].message.startsWith(FIRST_SENTENCE)).toBe(true);
    });

    it('reaches both authoring doors: `DatasourceSchema` (re-pathed under `config`) and `validateDriverConfig`', () => {
      const config = { url: 'file:./data/replica.db', mode: 'replica' };
      const datasource = DatasourceSchema.safeParse({ name: 'edge', driver: 'turso', config });
      expect(datasource.success).toBe(false);
      const issue = datasource.error!.issues.find((i) => i.path.join('.') === 'config.mode');
      expect(issue, JSON.stringify(datasource.error!.issues)).toBeDefined();
      expect(issue!.message.startsWith(FIRST_SENTENCE)).toBe(true);

      const verdict = validateDriverConfig('turso', config);
      expect(verdict.known).toBe(true);
      expect(verdict.known && verdict.issues.map((i) => i.path.join('.'))).toEqual(['mode']);
    });

    it('controls: a forced replica beside `syncUrl`, and a `file:` url with no `mode`, stay accepted', () => {
      for (const config of [
        { url: 'file:./data/replica.db', mode: 'replica', syncUrl: 'libsql://db.turso.io' },
        { url: 'file:./data/app.db' },
        { url: 'file:./data/app.db', mode: 'local' },
      ]) {
        const result = TursoConfigSchema.safeParse(config);
        expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
      }
    });
  });

  // #20586 — the same defect the other way round: a forced local mode beside a
  // remote to replicate from. The driver used to label it local and sync it
  // anyway; both now refuse it, on `mode`, in one message.
  describe("a forced `mode: 'local'` beside a `syncUrl` — refused on `mode`", () => {
    const FIRST_SENTENCE =
      "`mode: 'local'` makes this datasource a plain local database, but `syncUrl` names a remote to "
      + 'replicate from: the database would still be synced with that remote as an embedded replica, '
      + 'so the declared local mode would be ignored — the turso driver refuses this configuration '
      + 'when it starts.';

    it('on a `file:` url in any case or an in-memory url, beside `sync` or `timeoutMs`: drop `mode`, or drop `syncUrl`', () => {
      for (const config of [
        { url: 'file:./data/app.db', mode: 'local', syncUrl: 'libsql://db.turso.io' },
        { url: 'FILE:./data/app.db', mode: 'local', syncUrl: 'libsql://db.turso.io' },
        { url: ' file:./data/app.db', mode: 'local', syncUrl: 'https://db.turso.io', timeoutMs: 5000 },
        { url: 'file:./data/app.db', mode: 'local', syncUrl: 'libsql://db.turso.io', sync: { intervalSeconds: 60 } },
        { url: ':memory:', mode: 'local', syncUrl: 'libsql://db.turso.io' },
        { url: 'file::memory:', mode: 'local', syncUrl: 'libsql://db.turso.io' },
      ]) {
        const { path, message } = refusal(config);
        expect(path, JSON.stringify(config)).toBe('mode');
        expect(message.startsWith(FIRST_SENTENCE), message).toBe(true);
        expect(message).toContain(
          "For an embedded replica, drop `mode` and keep `syncUrl` beside the local file: `url: 'file:./data/replica.db'`.",
        );
        expect(message).toContain('For a plain local database, drop `syncUrl` (and `sync`).');
      }
    });

    it('never echoes either url', () => {
      const { message } = refusal({ url: 'file:./private-dir/app.db', mode: 'local', syncUrl: 'libsql://private-host.turso.io' });
      expect(message).not.toContain('private-dir');
      expect(message).not.toContain('private-host');
    });

    it('a url another refusal takes keeps that refusal, on `url`', () => {
      for (const url of ['libsql://db.turso.io', 'https://db.turso.io', './data/app.db']) {
        const { path, message } = refusal({ url, mode: 'local', syncUrl: 'libsql://db.turso.io' });
        expect(path, url).toBe('url');
        expect(message.startsWith(FIRST_SENTENCE)).toBe(false);
      }
    });

    it('reaches both authoring doors: `DatasourceSchema` (re-pathed under `config`) and `validateDriverConfig`', () => {
      const config = { url: 'file:./data/app.db', mode: 'local', syncUrl: 'libsql://db.turso.io' };
      const datasource = DatasourceSchema.safeParse({ name: 'edge', driver: 'turso', config });
      expect(datasource.success).toBe(false);
      const issue = datasource.error!.issues.find((i) => i.path.join('.') === 'config.mode');
      expect(issue, JSON.stringify(datasource.error!.issues)).toBeDefined();
      expect(issue!.message.startsWith(FIRST_SENTENCE)).toBe(true);

      const verdict = validateDriverConfig('turso', config);
      expect(verdict.known).toBe(true);
      expect(verdict.known && verdict.issues.map((i) => i.path.join('.'))).toEqual(['mode']);
    });

    it('controls: the unforced `file:` + `syncUrl` replica, and a forced local mode with no or an empty `syncUrl`, stay accepted', () => {
      for (const config of [
        { url: 'file:./data/replica.db', syncUrl: 'libsql://db.turso.io' },
        { url: 'file:./data/replica.db', syncUrl: 'libsql://db.turso.io', sync: { intervalSeconds: 60 } },
        { url: 'file:./data/app.db', mode: 'local' },
        { url: 'file:./data/app.db', mode: 'local', syncUrl: '' },
        { url: ':memory:', mode: 'local' },
      ]) {
        const result = TursoConfigSchema.safeParse(config);
        expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
      }
    });
  });

  it('the pre-existing `sync`-without-`syncUrl` refusal is unchanged, and stands beside a transport refusal', () => {
    const result = TursoConfigSchema.safeParse({ url: './data/app.db', sync: { intervalSeconds: 60 } });
    expect(result.success).toBe(false);
    const byPath = Object.fromEntries(result.error!.issues.map((i) => [i.path.join('.'), i]));
    expect(Object.keys(byPath).sort()).toEqual(['sync', 'url']);
    expect(byPath.sync.message).toBe(
      '`sync` configures embedded-replica syncing, which only runs when `syncUrl` names the '
      + 'remote to replicate from. Set `syncUrl`, or remove `sync` — on its own it configures '
      + 'nothing.',
    );
  });

  it('reaches both authoring doors: `DatasourceSchema` (re-pathed under `config`) and `validateDriverConfig`', () => {
    const config = { url: 'libsql://db.turso.io', syncUrl: 'libsql://db.turso.io' };
    const datasource = DatasourceSchema.safeParse({ name: 'edge', driver: 'turso', config });
    expect(datasource.success).toBe(false);
    const issue = datasource.error!.issues.find((i) => i.path.join('.') === 'config.url');
    expect(issue, JSON.stringify(datasource.error!.issues)).toBeDefined();
    expect(issue!.message).toContain("keep the remote in `syncUrl`: `url: 'file:./data/replica.db'`.");

    const verdict = validateDriverConfig('turso', config);
    expect(verdict.known).toBe(true);
    expect(verdict.known && verdict.issues.map((i) => i.path.join('.'))).toEqual(['url']);
  });

  it('the `url` describe names the `file:` spelling, never a bare path', () => {
    const description = TursoConfigSchema.shape.url.description ?? '';
    expect(description).toContain('file: URL');
    expect(description).not.toContain('a file path');
  });
});
