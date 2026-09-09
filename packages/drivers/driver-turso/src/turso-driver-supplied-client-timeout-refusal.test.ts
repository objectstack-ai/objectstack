// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `TursoDriverConfig.timeout` beside a pre-configured `TursoDriverConfig.client`
 * in REMOTE mode is refused at construction — the ADR-0049 enforce-or-remove
 * answer to the one remote COMPOSITION on which the key reaches nothing.
 *
 * # The defect this pins shut
 *
 * The window is installed in exactly one place: `createRemoteClient()` spreads
 * `{ fetch: fetchBoundedBy(timeoutMs) }` into `createClient(...)`. TWO remote
 * sites decide whether that builder runs at all, and both spell the choice
 * identically — `this.tursoConfig.client ?? (await this.createRemoteClient())`:
 *
 *   1. `connect()`'s remote arm;
 *   2. the lazy connect factory the constructor registers on `RemoteTransport`
 *      via `setConnectFactory`, which `ensureConnected()` calls when an
 *      operation runs before (or without) `connect()`.
 *
 * A supplied `client` short-circuits the `??` at BOTH, so the one place the
 * window is installed is never reached and every request ran unbounded, while
 * `timeout`'s docblock promised "every request the client's HTTP transport
 * makes" and `client`'s said nothing about the key ceasing to apply.
 *
 * # Why this file drives both sites rather than asserting the refusal once
 *
 * A refusal that covered only `connect()` would leave the lazy factory open —
 * a one-cut fix to a two-site defect — and no assertion about `connect()` can
 * tell the two apart. So the CONTROLS below drive each site independently on
 * the composition that stays accepted (`client` with no `timeout`) and prove
 * each really does consume the supplied client; the refusal cases then prove
 * the constructor throws BEFORE either can run, by observing that the supplied
 * client is never touched and no driver is returned to touch it with. Both
 * halves are needed: the first shows the two sites are live, the second shows
 * the refusal sits upstream of both.
 *
 * # What else is pinned
 *
 * The envelope (ADR-0112 `code` + `status`) and a message naming BOTH keys, the
 * window, the mode and both ways out — never a bare `toThrow()`, which any
 * unrelated constructor failure would satisfy. And the refusal's WIDTH, by
 * controls that must stay accepted: `client` without `timeout`; `timeout`
 * without `client`; `timeout: 0` (the documented "no bound") beside a client;
 * an explicit `client: undefined`, which the `??` at both sites treats as
 * absent; and the REPLICA arm, where `sync()` is bounded by `boundedBy`
 * whatever client is in use — pinned here by a stalled sync that still fails as
 * `TIMEOUT` / 504 with a supplied client and a window, the measurement that
 * makes "the replica arm is untouched" a reading rather than a claim.
 *
 * # Reverse verification — direction predicted before it was run
 *
 * Restore the constructor to its pre-refusal state and the refusal cases go RED
 * (the constructor returns a driver, `transportMode: 'remote'`, and there is no
 * envelope to read); every control stays GREEN, because the controls describe
 * what was accepted before and after alike. Measured — see the PR.
 */

import type { Client, ResultSet } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createTursoDriver } from './index.js';
import { TursoDriver } from './turso-driver.js';

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

const EMPTY_RESULT: ResultSet = {
  rows: [],
  columns: [],
  columnTypes: [],
  rowsAffected: 0,
  lastInsertRowid: undefined,
  toJSON: () => ({}),
} as unknown as ResultSet;

/**
 * A pre-configured `@libsql/client` that records every call it receives — the
 * caller's own object, as the driver sees it. `calls` is the observable that
 * makes "the supplied client was reached" a measurement instead of an
 * inference, and its staying at 0 is what shows the refusal ran first.
 */
function recordingClient(): Client & { calls: string[] } {
  const calls: string[] = [];
  const stub = {
    calls,
    execute: (statement: unknown) => {
      calls.push(typeof statement === 'string' ? statement : JSON.stringify(statement));
      return Promise.resolve(EMPTY_RESULT);
    },
    batch: () => Promise.resolve([EMPTY_RESULT]),
    sync: () => Promise.resolve(),
    close: () => {},
    closed: false,
    protocol: 'http',
  };
  return stub as unknown as Client & { calls: string[] };
}

/** A supplied client whose `sync()` never settles — a stalled primary on the replica arm. */
function stalledSyncClient(): Client {
  const stub = {
    sync: () => new Promise<never>(() => {}),
    close: () => {},
    closed: false,
    protocol: 'file',
  };
  return stub as unknown as Client;
}

/** The rejection an operation produced, or `null` when it resolved. */
function failureOf<T>(operation: Promise<T>): Promise<Refusal | null> {
  return operation.then(
    () => null,
    (error: Refusal) => error,
  );
}

const WINDOW_MS = 30_000;
const HTTP_URL = 'https://db.example.turso.io';
const PRIMARY_URL = 'libsql://primary.example.turso.io';

describe('`timeout` beside a supplied `client` in remote mode — refused at construction', () => {
  it.each([
    ['libsql://', 'libsql://db.example.turso.io'],
    ['https://', HTTP_URL],
    ['http://', 'http://127.0.0.1:8080'],
  ])(
    '%s + client + timeout is refused as VALIDATION_ERROR / 400, naming both keys, the mode and both ways out',
    (_scheme, url) => {
      const client = recordingClient();
      const refusal = refusalOf(() => new TursoDriver({ url, authToken: 'token', client, timeout: WINDOW_MS }));

      expect(refusal).not.toBeNull();
      expect(refusal!.code).toBe('VALIDATION_ERROR');
      expect(refusal!.status).toBe(400);
      // Both keys are named — a message naming only `timeout` would leave an
      // author re-reading the one key that is not the problem.
      expect(refusal!.message).toContain('TursoDriverConfig.timeout');
      expect(refusal!.message).toContain('TursoDriverConfig.client');
      expect(refusal!.message).toContain(`${WINDOW_MS} ms`);
      // The mode, because the same pair IS accepted on the replica arm.
      expect(refusal!.message).toContain('remote');
      // Both ways out, and which arm is unaffected.
      expect(refusal!.message).toContain('drop `client`');
      expect(refusal!.message).toContain('omit `timeout`');
      expect(refusal!.message).toContain('Replica mode is unaffected');
      // Nothing downstream ran: no driver exists, so neither bypass site could
      // have reached the caller's client.
      expect(client.calls).toEqual([]);
    },
  );

  it('a forced `mode: "remote"` meets the same refusal — the override does not route around it', () => {
    const refusal = refusalOf(
      () => new TursoDriver({ url: ':memory:', mode: 'remote', client: recordingClient(), timeout: WINDOW_MS }),
    );

    expect(refusal?.code).toBe('VALIDATION_ERROR');
    expect(refusal?.status).toBe(400);
  });

  it('createTursoDriver() is the same constructor, and refuses the same pair', () => {
    const refusal = refusalOf(() => createTursoDriver({ url: HTTP_URL, client: recordingClient(), timeout: WINDOW_MS }));

    expect(refusal?.code).toBe('VALIDATION_ERROR');
    expect(refusal?.status).toBe(400);
  });
});

describe('BOTH bypass sites — each is live, and the refusal sits upstream of both', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  it('SITE 1 — `connect()` takes the supplied client, bypassing createRemoteClient()', async () => {
    const client = recordingClient();
    const driver = new TursoDriver({ url: HTTP_URL, authToken: 'token', client });
    cleanups.push(() => driver.disconnect());

    await driver.connect();

    // The identity check is the whole point: `createRemoteClient()` would have
    // returned a different object, and it is the only place the window is
    // installed.
    expect(driver.getLibsqlClient()).toBe(client);
  });

  it('SITE 2 — the lazy connect factory takes it too, on an operation that never called connect()', async () => {
    const client = recordingClient();
    const driver = new TursoDriver({ url: HTTP_URL, authToken: 'token', client });
    cleanups.push(() => driver.disconnect());

    // connect() is deliberately NOT called: this is the self-heal path
    // `RemoteTransport.ensureConnected()` drives through the factory the
    // constructor registered.
    expect(driver.getLibsqlClient()).toBeNull();
    await failureOf(driver.find('probe', {}));

    expect(driver.getLibsqlClient()).toBe(client);
    expect(client.calls.length).toBeGreaterThan(0);
  });

  it('the refused pair reaches NEITHER site — construction throws before a driver exists', () => {
    const client = recordingClient();
    const refusal = refusalOf(() => new TursoDriver({ url: HTTP_URL, authToken: 'token', client, timeout: WINDOW_MS }));

    // Site 1 is unreachable because there is nothing to call `connect()` on;
    // site 2 because the transport that would hold the factory was never
    // constructed. The zero call count is the positive observable for both.
    expect(refusal).not.toBeNull();
    expect(client.calls).toEqual([]);
  });
});

describe('CONTROLS — what the refusal must leave accepted', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  it('a supplied `client` with NO timeout constructs as remote, exactly as before', () => {
    const client = recordingClient();
    const driver = new TursoDriver({ url: HTTP_URL, authToken: 'token', client });

    expect(driver.transportMode).toBe('remote');
    expect(driver.getTursoConfig().timeout).toBeUndefined();
    expect(driver.getTursoConfig().client).toBe(client);
  });

  it('a `timeout` with NO client stays accepted — the driver-built client IS bounded', () => {
    const driver = new TursoDriver({ url: HTTP_URL, authToken: 'token', timeout: WINDOW_MS });

    expect(driver.transportMode).toBe('remote');
    expect(driver.getTursoConfig().timeout).toBe(WINDOW_MS);
    expect(driver.getTursoConfig().client).toBeUndefined();
  });

  it('`timeout: 0` beside a client is the documented "no bound", asks for nothing, and is not refused', () => {
    const client = recordingClient();
    const driver = new TursoDriver({ url: HTTP_URL, authToken: 'token', client, timeout: 0 });

    expect(driver.transportMode).toBe('remote');
    expect(driver.getTursoConfig().timeout).toBe(0);
  });

  it('an explicit `client: undefined` is absent to the `??` at both sites, so the pair is not the refused one', () => {
    const driver = new TursoDriver({ url: HTTP_URL, authToken: 'token', client: undefined, timeout: WINDOW_MS });

    expect(driver.transportMode).toBe('remote');
    expect(driver.getTursoConfig().timeout).toBe(WINDOW_MS);
  });

  it('THE REPLICA ARM IS UNTOUCHED: client + timeout is accepted there, and sync() is still bounded', async () => {
    const driver = new TursoDriver({
      url: ':memory:',
      syncUrl: PRIMARY_URL,
      authToken: 'token',
      client: stalledSyncClient(),
      sync: { onConnect: false },
      timeout: 100,
    });

    expect(driver.transportMode).toBe('replica');
    expect(driver.getTursoConfig().timeout).toBe(100);

    await driver.connect();
    cleanups.push(() => driver.disconnect());
    expect(driver.isSyncEnabled()).toBe(true);

    // The key is NOT inert on this arm — which is exactly why the refusal is
    // scoped away from it. A stalled sync beside a supplied client still fails
    // as TIMEOUT / 504, on the `boundedBy` seam the remote arm does not have.
    const failure = await failureOf(driver.sync());

    expect(failure).not.toBeNull();
    expect(failure!.code).toBe('TIMEOUT');
    expect(failure!.status).toBe(504);
    expect(failure!.message).toContain('sync');
  });
});
