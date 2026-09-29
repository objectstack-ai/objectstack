// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20200] Sync keys the driver would ignore are refused at construction:
 * `syncUrl` under a forced `mode: 'remote'`, and `sync` with no `syncUrl` in
 * any mode. The ADR-0049 enforce-or-remove answer to two declared settings
 * that changed nothing.
 *
 * # What was measured (the reading these refusals stand on)
 *
 * On the built driver before the change (`dist` at `dbddf02c1`):
 *
 * ```
 * libsql:// + mode 'remote' + syncUrl (+ sync) -> constructs, connects, isSyncEnabled() true,
 *                                                 no interval, sync() rejects SYNC_NOT_SUPPORTED
 * file:     + mode 'remote' + syncUrl + sync   -> the same, sync() rejects SyncNotSupported("File")
 * libsql:// + mode 'remote' + sync, no syncUrl -> constructs, isSyncEnabled() false, sync() a no-op
 * file:     + sync, no syncUrl                 -> local, sync ignored
 * libsql:// + mode 'remote' (control)          -> isSyncEnabled() false
 * ```
 *
 * # What this file pins
 *
 * Both refusals as the ADR-0112 envelope (`code` + `status`), plus the first
 * sentence of each message. The messages are `@objectstack/spec`'s
 * `TursoConfigSchema` issue texts byte for byte, and that equality is pinned in
 * `spec/turso-config-constructor-parity.test.ts`, not here. The refusals'
 * WIDTH is pinned by controls that must stay accepted: a remote config without
 * `syncUrl`, a replica on a `file:` url beside `syncUrl`, and `sync` beside
 * `syncUrl` under a forced `mode: 'local'`. The rider this card left standing
 * (`mode: 'replica'` on a `file:` url with no `syncUrl`) is refused since
 * #20437, together with the spec contract; it is pinned in
 * `turso-driver-forced-replica-without-sync-url-refusal.test.ts`.
 *
 * # Reverse verification: direction predicted before it was run
 *
 * Remove either refusal from the constructor and its cases here go RED: the
 * constructor returns a driver and there is no envelope to read. Every control
 * stays GREEN. Measured; see the PR.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import { createTursoDriver } from './index.js';
import { TursoDriver, type TursoDriverConfig } from './turso-driver.js';

type Refusal = Error & { code?: string; status?: number };

/** The error `build` threw, or `null` when it returned. */
function refusalOf(build: () => unknown): Refusal | null {
  try {
    build();
    return null;
  } catch (error) {
    return error as Refusal;
  }
}

const DIR = mkdtempSync(join(tmpdir(), 'turso-20200-'));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const REMOTE = 'libsql://db.example.turso.io';
const PRIMARY = 'libsql://primary.example.turso.io';
const file = (name: string) => `file:${DIR}/${name}.db`;

const SYNC_URL_FIRST_SENTENCE =
  "`syncUrl` configures an embedded replica, but `mode: 'remote'` sends every read and write " +
  'straight to `url` and builds no replica: the turso driver refuses this configuration when it starts.';
const SYNC_FIRST_SENTENCE =
  '`sync` configures embedded-replica syncing, which only runs when `syncUrl` names the remote to replicate from.';

describe("`syncUrl` under a forced `mode: 'remote'` — refused at construction", () => {
  it.each<[string, TursoDriverConfig]>([
    ['a libsql:// url', { url: REMOTE, mode: 'remote', syncUrl: PRIMARY }],
    ['a libsql:// url, with sync', { url: REMOTE, mode: 'remote', syncUrl: PRIMARY, sync: { intervalSeconds: 60 } }],
    ['an https:// url', { url: 'https://db.example.turso.io', mode: 'remote', syncUrl: PRIMARY }],
    ['a file: url', { url: file('forced-remote'), mode: 'remote', syncUrl: PRIMARY, sync: { intervalSeconds: 60 } }],
  ])("%s: VALIDATION_ERROR / 400, in the spec contract's words", (_name, config) => {
    const refusal = refusalOf(() => new TursoDriver(config));

    expect(refusal).not.toBeNull();
    expect(refusal!.code).toBe('VALIDATION_ERROR');
    expect(refusal!.status).toBe(400);
    expect(refusal!.message.startsWith(SYNC_URL_FIRST_SENTENCE)).toBe(true);
  });

  it('createTursoDriver() is the same constructor, and refuses the same config', () => {
    const refusal = refusalOf(() => createTursoDriver({ url: REMOTE, mode: 'remote', syncUrl: PRIMARY }));

    expect(refusal?.code).toBe('VALIDATION_ERROR');
    expect(refusal?.status).toBe(400);
  });
});

describe('`sync` with no `syncUrl` — refused at construction, in every mode', () => {
  it.each<[string, TursoDriverConfig]>([
    ['a local file: url', { url: file('local'), sync: { intervalSeconds: 60 } }],
    [':memory:', { url: ':memory:', sync: { onConnect: true } }],
    ['a remote url (auto-detected)', { url: REMOTE, sync: { intervalSeconds: 60 } }],
    ["a forced mode: 'remote'", { url: REMOTE, mode: 'remote', sync: { onConnect: true } }],
    ["a forced mode: 'replica' on a file: url", { url: file('replica-no-sync-url'), mode: 'replica', sync: { intervalSeconds: 60 } }],
    ['an empty syncUrl, which is unset', { url: file('empty-sync-url'), syncUrl: '', sync: { intervalSeconds: 60 } }],
  ])("%s: VALIDATION_ERROR / 400, in the spec contract's words", (_name, config) => {
    const refusal = refusalOf(() => new TursoDriver(config));

    expect(refusal).not.toBeNull();
    expect(refusal!.code).toBe('VALIDATION_ERROR');
    expect(refusal!.status).toBe(400);
    expect(refusal!.message.startsWith(SYNC_FIRST_SENTENCE)).toBe(true);
  });
});

describe('CONTROLS — what the refusals must leave accepted', () => {
  it('a forced remote mode with no syncUrl constructs, connects, and reports sync as off', async () => {
    const client = { close() {} };
    const driver = new TursoDriver({ url: REMOTE, mode: 'remote', client: client as never });

    expect(driver.transportMode).toBe('remote');
    await driver.connect();
    expect(driver.isSyncEnabled()).toBe(false);
    await driver.disconnect();
  });

  it('a replica on a file: url beside syncUrl, with sync, constructs as a replica', () => {
    const driver = new TursoDriver({ url: file('replica'), syncUrl: PRIMARY, sync: { onConnect: false } });

    expect(driver.transportMode).toBe('replica');
  });

  it("sync beside syncUrl under a forced mode: 'local' stays accepted, as the contract accepts it", () => {
    const driver = new TursoDriver({ url: file('forced-local'), mode: 'local', syncUrl: PRIMARY, sync: { onConnect: false } });

    expect(driver.transportMode).toBe('local');
  });
});
