// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19977] One case table for the three places a turso config is judged:
 *
 *  1. `new TursoDriver(...)` — the runtime's refused set, `VALIDATION_ERROR` / 400;
 *  2. `@objectstack/spec`'s `TursoConfigSchema` — the authoring contract a
 *     `datasource.config` is parsed against (`DatasourceSchema`, the Setup
 *     wizard's `validateDriverConfig`);
 *  3. this package's own `TursoConfigSchema` mirror (`./turso.zod.ts`).
 *
 * The two schemas used to accept every combination below, so a datasource the
 * driver refuses at construction (or, until #20200, constructed and ignored)
 * was accepted at authoring and failed a boot later. Each row states the constructor's verdict
 * and the schemas' verdict, and the test asserts all three against it:
 *
 *  - a row the constructor REFUSES is refused by both schemas, on the key the
 *    row names, with one `custom` issue;
 *  - a row the constructor ACCEPTS is accepted by both — except an `inert`
 *    row, one the constructor would build and then ignore a key of, refused at
 *    authoring only. [#20200] There are none left, and the table pins that at
 *    exactly zero: the four there were (`syncUrl` under a forced
 *    `mode: 'remote'`; `sync` with no `syncUrl`) are refused by the
 *    constructor now, because a declared setting that changes nothing is the
 *    shape ADR-0049 does not ship. A new `inert` row is a new ignored key —
 *    fix the constructor, or argue it on the card, before moving the floor;
 *  - the two schemas' messages are byte-identical wherever both judge a row;
 *  - [#20200] where the constructor refuses on `syncUrl` or `sync`, its message
 *    is the spec contract's issue message, byte for byte: those two texts are
 *    copies in `../turso-driver.ts`, and this is the pin that holds them equal.
 *    [#20437] The same holds for a forced `mode: 'replica'` with no `syncUrl`,
 *    refused on `mode` — the third copy. That row used to be accepted
 *    everywhere, as a replica that never synced.
 *
 * ⚠️ The mirror declares no `mode`, so zod strips an authored one before its
 * refinement runs: rows that FORCE a mode are judged by the constructor and the
 * spec contract only. That shortness is the mirror's, documented in
 * `docs/design/driver-turso.md` §10, and is not this card's to change.
 *
 * ⚠️ The spec half resolves `@objectstack/spec/data` through its `exports`, i.e.
 * the BUILT `packages/spec/dist` (this package has no source alias for it —
 * `KNOWN_UNALIASED_TEST_IMPORTS` in `scripts/check-test-source-alias.mjs`).
 * Rebuild the spec before reading this file's verdict on a spec edit.
 *
 * Not in the table, deliberately: `timeout` beside a pre-built `client` (also
 * refused by the constructor) — `client` is a live object, not authorable
 * config, so neither schema can see it.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import { TursoConfigSchema as SpecTursoConfigSchema } from '@objectstack/spec/data';

import { TursoDriver, type TursoDriverConfig } from '../turso-driver';
import { TursoConfigSchema as MirrorTursoConfigSchema } from './turso.zod';

const DIR = mkdtempSync(join(tmpdir(), 'turso-19977-parity-'));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const FILE = `file:${DIR}/app.db`;
const REMOTE = 'libsql://db.example.turso.io';

type Authored = {
  url: string;
  syncUrl?: string;
  sync?: { intervalSeconds?: number; onConnect?: boolean };
  mode?: 'local' | 'replica' | 'remote';
  timeoutMs?: number;
};

interface Row {
  name: string;
  config: Authored;
  /** The constructor's verdict on this config. */
  ctor: 'accept' | 'refuse';
  /** The key both schemas refuse on, or `undefined` when they accept. */
  refusedOn?: 'url' | 'syncUrl' | 'timeoutMs' | 'sync' | 'mode';
  /** How many issues the spec contract raises on a refused row; 1 unless stated. */
  issues?: number;
  /** The constructor accepts it and ignores a key: refused at authoring only. None today (#20200). */
  inert?: true;
}

const ROWS: Row[] = [
  // ── accepted everywhere ─────────────────────────────────────────────────
  { name: 'a file: url', config: { url: FILE }, ctor: 'accept' },
  { name: ':memory:', config: { url: ':memory:' }, ctor: 'accept' },
  { name: 'a libsql:// url', config: { url: REMOTE }, ctor: 'accept' },
  { name: 'an uppercase LIBSQL:// url', config: { url: 'LIBSQL://db.example.turso.io' }, ctor: 'accept' },
  { name: 'an https:// url', config: { url: 'https://db.example.turso.io' }, ctor: 'accept' },
  { name: 'an http:// url', config: { url: 'http://127.0.0.1:8080' }, ctor: 'accept' },
  { name: 'a wss:// url', config: { url: 'wss://db.example.turso.io' }, ctor: 'accept' },
  { name: 'a ws:// url', config: { url: 'ws://127.0.0.1:8080' }, ctor: 'accept' },
  { name: 'a replica: file: + syncUrl', config: { url: FILE, syncUrl: REMOTE, sync: { onConnect: false } }, ctor: 'accept' },
  { name: 'a replica on an uppercase FILE: url', config: { url: `FILE:${DIR}/upper.db`, syncUrl: REMOTE }, ctor: 'accept' },
  { name: 'a replica bounded by timeoutMs, syncing from wss://', config: { url: FILE, syncUrl: 'wss://db.example.turso.io', timeoutMs: 5000 }, ctor: 'accept' },
  { name: 'timeoutMs beside libsql://', config: { url: REMOTE, timeoutMs: 5000 }, ctor: 'accept' },
  { name: 'timeoutMs beside https://', config: { url: 'https://db.example.turso.io', timeoutMs: 5000 }, ctor: 'accept' },
  { name: 'a url behind whitespace (the loaders trim it)', config: { url: `  ${FILE}` }, ctor: 'accept' },
  { name: 'a remote url behind whitespace', config: { url: ` ${REMOTE}` }, ctor: 'accept' },
  { name: 'an empty syncUrl (unset)', config: { url: REMOTE, syncUrl: '' }, ctor: 'accept' },
  { name: "file: + syncUrl under a forced mode: 'replica'", config: { url: FILE, mode: 'replica', syncUrl: REMOTE, sync: { onConnect: false } }, ctor: 'accept' },
  { name: "file: + syncUrl under a forced mode: 'local'", config: { url: FILE, mode: 'local', syncUrl: REMOTE, sync: { onConnect: false } }, ctor: 'accept' },
  { name: "libsql:// under a forced mode: 'remote'", config: { url: REMOTE, mode: 'remote' }, ctor: 'accept' },
  { name: "file: under a forced mode: 'remote'", config: { url: FILE, mode: 'remote' }, ctor: 'accept' },
  { name: "a bare path under a forced mode: 'remote' (the client refuses it at connect)", config: { url: './data/app.db', mode: 'remote' }, ctor: 'accept' },

  // ── a remote url in a local or replica mode ─────────────────────────────
  { name: 'libsql:// beside syncUrl', config: { url: REMOTE, syncUrl: REMOTE }, ctor: 'refuse', refusedOn: 'url' },
  { name: 'https:// beside syncUrl', config: { url: 'https://db.example.turso.io', syncUrl: REMOTE }, ctor: 'refuse', refusedOn: 'url' },
  { name: 'http:// beside syncUrl', config: { url: 'http://127.0.0.1:8080', syncUrl: REMOTE }, ctor: 'refuse', refusedOn: 'url' },
  { name: 'wss:// beside syncUrl', config: { url: 'wss://db.example.turso.io', syncUrl: REMOTE }, ctor: 'refuse', refusedOn: 'url' },
  { name: 'Ws:// beside syncUrl', config: { url: 'Ws://127.0.0.1:8080', syncUrl: REMOTE }, ctor: 'refuse', refusedOn: 'url' },
  { name: 'LIBSQL:// beside syncUrl', config: { url: 'LIBSQL://db.example.turso.io', syncUrl: REMOTE }, ctor: 'refuse', refusedOn: 'url' },
  { name: "libsql:// under a forced mode: 'replica'", config: { url: REMOTE, mode: 'replica' }, ctor: 'refuse', refusedOn: 'url' },
  { name: "libsql:// + syncUrl under a forced mode: 'replica'", config: { url: REMOTE, mode: 'replica', syncUrl: REMOTE }, ctor: 'refuse', refusedOn: 'url' },
  { name: "libsql:// under a forced mode: 'local'", config: { url: REMOTE, mode: 'local' }, ctor: 'refuse', refusedOn: 'url' },
  { name: "https:// under a forced mode: 'local'", config: { url: 'https://db.example.turso.io', mode: 'local' }, ctor: 'refuse', refusedOn: 'url' },

  // ── a url that is none of file:, :memory: or remote, in a local or replica mode ──
  { name: 'a bare relative path', config: { url: './data/app.db' }, ctor: 'refuse', refusedOn: 'url' },
  { name: 'a bare path with no dot', config: { url: 'data/app.db' }, ctor: 'refuse', refusedOn: 'url' },
  { name: 'a bare absolute path', config: { url: '/var/lib/app.db' }, ctor: 'refuse', refusedOn: 'url' },
  { name: 'an unsupported sqlite: scheme', config: { url: 'sqlite:./x.db' }, ctor: 'refuse', refusedOn: 'url' },
  { name: 'memory://', config: { url: 'memory://' }, ctor: 'refuse', refusedOn: 'url' },
  { name: ':MEMORY: (matched exactly, like the client)', config: { url: ':MEMORY:' }, ctor: 'refuse', refusedOn: 'url' },
  { name: 'a remote scheme with no //', config: { url: 'libsql:db.example.turso.io' }, ctor: 'refuse', refusedOn: 'url' },
  { name: 'a whitespace-only url', config: { url: '   ' }, ctor: 'refuse', refusedOn: 'url' },
  { name: 'a bare path beside syncUrl', config: { url: './data/replica.db', syncUrl: REMOTE }, ctor: 'refuse', refusedOn: 'url' },
  { name: "a bare path under a forced mode: 'local'", config: { url: './data/app.db', mode: 'local' }, ctor: 'refuse', refusedOn: 'url' },
  { name: "a bare path under a forced mode: 'replica'", config: { url: './data/replica.db', mode: 'replica' }, ctor: 'refuse', refusedOn: 'url' },

  // ── a replica on an in-memory url ───────────────────────────────────────
  { name: ':memory: beside syncUrl', config: { url: ':memory:', syncUrl: REMOTE }, ctor: 'refuse', refusedOn: 'url' },
  { name: 'file::memory: beside syncUrl', config: { url: 'file::memory:', syncUrl: REMOTE }, ctor: 'refuse', refusedOn: 'url' },
  { name: 'FILE::memory: beside syncUrl', config: { url: 'FILE::memory:', syncUrl: REMOTE }, ctor: 'refuse', refusedOn: 'url' },
  { name: 'file::memory:?cache=shared beside syncUrl', config: { url: 'file::memory:?cache=shared', syncUrl: REMOTE }, ctor: 'refuse', refusedOn: 'url' },
  { name: ":memory: under a forced mode: 'replica'", config: { url: ':memory:', mode: 'replica' }, ctor: 'refuse', refusedOn: 'url' },

  // ── timeoutMs beside a WebSocket url in remote mode ─────────────────────
  { name: 'timeoutMs beside wss://', config: { url: 'wss://db.example.turso.io', timeoutMs: 5000 }, ctor: 'refuse', refusedOn: 'timeoutMs' },
  { name: 'timeoutMs beside an uppercase WS://', config: { url: 'WS://127.0.0.1:8080', timeoutMs: 5000 }, ctor: 'refuse', refusedOn: 'timeoutMs' },
  { name: "timeoutMs beside wss:// under a forced mode: 'remote'", config: { url: 'wss://db.example.turso.io', timeoutMs: 5000, mode: 'remote' }, ctor: 'refuse', refusedOn: 'timeoutMs' },

  // ── sync keys the driver would ignore: refused at construction and at authoring (#20200) ──
  { name: "syncUrl under a forced mode: 'remote'", config: { url: REMOTE, mode: 'remote', syncUrl: REMOTE }, ctor: 'refuse', refusedOn: 'syncUrl' },
  { name: "syncUrl + sync under a forced mode: 'remote'", config: { url: REMOTE, mode: 'remote', syncUrl: REMOTE, sync: { intervalSeconds: 60 } }, ctor: 'refuse', refusedOn: 'syncUrl' },
  { name: "file: + syncUrl under a forced mode: 'remote'", config: { url: FILE, mode: 'remote', syncUrl: REMOTE }, ctor: 'refuse', refusedOn: 'syncUrl' },
  { name: 'sync with no syncUrl', config: { url: FILE, sync: { intervalSeconds: 60 } }, ctor: 'refuse', refusedOn: 'sync' },
  { name: 'sync with no syncUrl on a remote url', config: { url: REMOTE, sync: { intervalSeconds: 60 } }, ctor: 'refuse', refusedOn: 'sync' },
  { name: "sync with no syncUrl under a forced mode: 'remote'", config: { url: REMOTE, mode: 'remote', sync: { onConnect: true } }, ctor: 'refuse', refusedOn: 'sync' },
  // The spec contract raises BOTH issues here (`sync`, then `mode`); the
  // constructor throws one, the `sync` refusal, which is the spec's first.
  { name: "sync with no syncUrl under a forced mode: 'replica'", config: { url: FILE, mode: 'replica', sync: { intervalSeconds: 60 } }, ctor: 'refuse', refusedOn: 'sync', issues: 2 },
  { name: 'sync beside an empty syncUrl (unset)', config: { url: FILE, syncUrl: '', sync: { intervalSeconds: 60 } }, ctor: 'refuse', refusedOn: 'sync' },

  // ── a forced replica with no remote to replicate from: refused on `mode` (#20437) ──
  { name: "file: under a forced mode: 'replica'", config: { url: FILE, mode: 'replica' }, ctor: 'refuse', refusedOn: 'mode' },
  { name: "an uppercase FILE: url under a forced mode: 'replica'", config: { url: `FILE:${DIR}/upper-replica.db`, mode: 'replica' }, ctor: 'refuse', refusedOn: 'mode' },
  { name: "file: + an empty syncUrl (unset) under a forced mode: 'replica'", config: { url: FILE, mode: 'replica', syncUrl: '' }, ctor: 'refuse', refusedOn: 'mode' },
  { name: "file: + timeoutMs under a forced mode: 'replica'", config: { url: FILE, mode: 'replica', timeoutMs: 5000 }, ctor: 'refuse', refusedOn: 'mode' },
];

/**
 * The rows the constructor refuses on a sync key, or on a forced replica with
 * no `syncUrl`: its message is a copy of the spec's (#20200, #20437).
 */
const SYNC_KEY_REFUSALS = ROWS.filter(
  (r) => r.ctor === 'refuse' && (r.refusedOn === 'syncUrl' || r.refusedOn === 'sync' || r.refusedOn === 'mode'),
);

/**
 * The driver config a datasource loader builds from an authored one — the
 * reading `buildTursoDriverConfig` / `resolveTursoUrl` in
 * `@objectstack/service-datasource` perform (not a dependency of this package,
 * hence spelled here): the url TRIMMED, an empty `syncUrl` unset, and the
 * authored `timeoutMs` landing on the driver's `timeout`.
 */
function driverConfigOf(authored: Authored): TursoDriverConfig {
  const { url, syncUrl, sync, mode, timeoutMs } = authored;
  return {
    url: url.trim(),
    ...(syncUrl ? { syncUrl } : {}),
    ...(sync ? { sync } : {}),
    ...(mode ? { mode } : {}),
    ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
  };
}

function constructorVerdict(authored: Authored): { verdict: 'accept' | 'refuse'; message?: string } {
  try {
    new TursoDriver(driverConfigOf(authored));
    return { verdict: 'accept' };
  } catch (error) {
    // A refusal is the ADR-0112 envelope, never some other throw.
    expect((error as { code?: string }).code).toBe('VALIDATION_ERROR');
    expect((error as { status?: number }).status).toBe(400);
    return { verdict: 'refuse', message: (error as Error).message };
  }
}

type Verdict = { refusedOn?: string; code?: string; message?: string; count: number };

function schemaVerdict(schema: { safeParse: (input: unknown) => any }, config: unknown): Verdict {
  const result = schema.safeParse(config);
  if (result.success) return { count: 0 };
  const issues = result.error.issues as Array<{ code: string; path: PropertyKey[]; message: string }>;
  return {
    refusedOn: issues[0].path.join('.'),
    code: issues[0].code,
    message: issues[0].message,
    count: issues.length,
  };
}

describe('turso config: the constructor, the spec contract and this mirror agree (#19977)', () => {
  it('the table covers every verdict shape it claims to', () => {
    // A table that silently lost a class of rows would still pass every
    // per-row assertion below; these floors make the loss loud.
    expect(ROWS.filter((r) => r.ctor === 'accept' && !r.refusedOn).length).toBeGreaterThanOrEqual(20);
    expect(ROWS.filter((r) => r.refusedOn === 'url').length).toBeGreaterThanOrEqual(25);
    expect(ROWS.filter((r) => r.refusedOn === 'timeoutMs').length).toBeGreaterThanOrEqual(3);
    expect(ROWS.filter((r) => r.refusedOn === 'syncUrl').length).toBeGreaterThanOrEqual(3);
    expect(ROWS.filter((r) => r.refusedOn === 'sync').length).toBeGreaterThanOrEqual(5);
    expect(ROWS.filter((r) => r.refusedOn === 'mode').length).toBeGreaterThanOrEqual(4);
    expect(SYNC_KEY_REFUSALS.length).toBeGreaterThanOrEqual(12);
    // [#20200] Exactly zero, not a floor: every key the constructor used to
    // build and ignore is refused at construction now (see the header).
    expect(ROWS.filter((r) => r.inert).length).toBe(0);
    expect(ROWS.filter((r) => !r.config.mode).length).toBeGreaterThanOrEqual(35);
  });

  describe.each(ROWS)('$name', (row) => {
    it(`the constructor ${row.ctor}s it`, () => {
      expect(constructorVerdict(row.config).verdict).toBe(row.ctor);
    });


    it(row.refusedOn ? `the spec contract refuses it on \`${row.refusedOn}\`` : 'the spec contract accepts it', () => {
      // Authoring refuses what construction refuses, and nothing it accepts
      // but an `inert` row's declared-and-ignored key (none since #20200).
      expect(Boolean(row.refusedOn)).toBe(row.ctor === 'refuse' || Boolean(row.inert));
      const verdict = schemaVerdict(SpecTursoConfigSchema, row.config);
      expect(verdict.refusedOn, verdict.message).toBe(row.refusedOn);
      if (row.refusedOn) {
        expect(verdict.count, verdict.message).toBe(row.issues ?? 1);
        expect(verdict.code).toBe('custom');
      }
    });

    it.skipIf(row.config.mode !== undefined)('this mirror gives the same verdict, in the same words', () => {
      const spec = schemaVerdict(SpecTursoConfigSchema, row.config);
      const mirror = schemaVerdict(MirrorTursoConfigSchema, row.config);
      expect(mirror).toEqual(spec);
    });
  });

  // [#20200] The two sync refusals, and [#20437] the forced-replica refusal,
  // are copies of the spec contract's texts in `../turso-driver.ts` (the spec
  // keeps them module-local); this is the pin that holds each copy equal to the
  // schema's issue, byte for byte.
  describe.each(SYNC_KEY_REFUSALS)('$name', (row) => {
    it("the constructor's message is the spec contract's, byte for byte (#20200, #20437)", () => {
      const spec = schemaVerdict(SpecTursoConfigSchema, row.config);
      expect(spec.refusedOn).toBe(row.refusedOn);
      expect(spec.message).toBeTypeOf('string');
      expect(constructorVerdict(row.config).message).toBe(spec.message);
    });
  });
});
