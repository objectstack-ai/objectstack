// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `TursoDriverConfig.timeout` beside a `wss://` / `ws://` url is refused at
 * construction — the ADR-0049 enforce-or-remove answer to the one remote scheme
 * on which the key reaches nothing.
 *
 * # What was measured (the reading this refusal stands on)
 *
 * `@libsql/client@0.17.4` routes on scheme: `wss` / `ws` go to its WebSocket
 * client (`lib-esm/ws.js`), which opens `hrana.openWs(url, authToken)` and reads
 * neither `Config.fetch` — the seam the HTTP arm's window rides — nor any
 * timeout option: over `@libsql/hrana-client@0.10.0`'s `lib-esm/ws/*.js` and
 * `lib-esm/index.js` a `timeout` grep returns zero, while a `fetch` grep over
 * `lib-esm/http/` finds the call sites (the control that makes the zero a
 * reading). So once the HTTP and replica arms were bounded, a `wss://` url with
 * `timeout: 30000` still constructed, connected and ran unbounded, silently.
 *
 * # What this file pins
 *
 * The refusal itself, on both schemes, as the ADR-0112 envelope (`code` +
 * `status`) with a message naming the key, the scheme it met and the two ways
 * out — never a bare `toThrow()`, which any unrelated constructor failure
 * would satisfy. And the refusal's WIDTH, by controls that must stay accepted:
 * the same url without `timeout`; with `timeout: 0` (the documented "no
 * bound"); every HTTP-side scheme WITH a window (`libsql://`, `https://`,
 * `http://`); and the replica arm, where `sync()` is bounded whatever the url's
 * scheme. A refusal that took any of those would be wider than the gap.
 *
 * # Reverse verification — direction predicted before it was run
 *
 * Restore `turso-driver.ts` to its pre-refusal state and the refusal cases go
 * RED (the constructor returns a driver, `transportMode: 'remote'`, and there
 * is no envelope to read); every control stays GREEN, because the controls
 * describe what was accepted before and after alike. Measured — see the PR.
 */

import { describe, expect, it } from 'vitest';
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

const WINDOW_MS = 30_000;
const WSS_URL = 'wss://db.example.turso.io';
const WS_URL = 'ws://127.0.0.1:8080';
const PRIMARY_URL = 'libsql://primary.example.turso.io';

describe('TursoDriverConfig.timeout beside a WebSocket url — refused at construction', () => {
  it.each([
    ['wss://', WSS_URL],
    ['ws://', WS_URL],
  ])('%s + timeout is refused as VALIDATION_ERROR / 400, naming the key, the scheme and the way out', (scheme, url) => {
    const refusal = refusalOf(() => new TursoDriver({ url, authToken: 'token', timeout: WINDOW_MS }));

    expect(refusal).not.toBeNull();
    expect(refusal!.code).toBe('VALIDATION_ERROR');
    expect(refusal!.status).toBe(400);
    expect(refusal!.message).toContain('TursoDriverConfig.timeout');
    expect(refusal!.message).toContain(`${WINDOW_MS} ms`);
    expect(refusal!.message).toContain(`\`${scheme}\``);
    // Both ways out are in the text: the bounded spellings, and the option of
    // dropping the key.
    expect(refusal!.message).toContain('libsql://');
    expect(refusal!.message).toContain('https://');
    expect(refusal!.message).toContain('omit `timeout`');
  });

  it('a forced `mode: "remote"` meets the same refusal — the override does not route around it', () => {
    const refusal = refusalOf(() => new TursoDriver({ url: WSS_URL, mode: 'remote', timeout: WINDOW_MS }));

    expect(refusal?.code).toBe('VALIDATION_ERROR');
    expect(refusal?.status).toBe(400);
  });

  it('createTursoDriver() is the same constructor, and refuses the same pair', () => {
    const refusal = refusalOf(() => createTursoDriver({ url: WSS_URL, timeout: WINDOW_MS }));

    expect(refusal?.code).toBe('VALIDATION_ERROR');
    expect(refusal?.status).toBe(400);
  });
});

describe('CONTROLS — what the refusal must leave accepted', () => {
  it.each([WSS_URL, WS_URL])('%s with no timeout constructs as remote, exactly as before', (url) => {
    const driver = new TursoDriver({ url, authToken: 'token' });

    expect(driver.transportMode).toBe('remote');
    expect(driver.getTursoConfig().timeout).toBeUndefined();
  });

  it('`timeout: 0` is the documented "no bound", asks for nothing, and is not refused', () => {
    const driver = new TursoDriver({ url: WSS_URL, authToken: 'token', timeout: 0 });

    expect(driver.transportMode).toBe('remote');
    expect(driver.getTursoConfig().timeout).toBe(0);
  });

  it.each(['libsql://db.example.turso.io', 'https://db.example.turso.io', 'http://127.0.0.1:8080'])(
    '%s + timeout stays accepted — the HTTP arm IS bounded, so the refusal is no wider than the gap',
    (url) => {
      const driver = new TursoDriver({ url, authToken: 'token', timeout: WINDOW_MS });

      expect(driver.transportMode).toBe('remote');
      expect(driver.getTursoConfig().timeout).toBe(WINDOW_MS);
    },
  );

  it('the replica arm keeps timeout whatever the url scheme — sync() is bounded there', () => {
    const fileReplica = new TursoDriver({
      url: ':memory:',
      syncUrl: PRIMARY_URL,
      timeout: WINDOW_MS,
      sync: { onConnect: false },
    });
    expect(fileReplica.transportMode).toBe('replica');
    expect(fileReplica.getTursoConfig().timeout).toBe(WINDOW_MS);

    const wsReplica = new TursoDriver({
      url: WSS_URL,
      syncUrl: PRIMARY_URL,
      timeout: WINDOW_MS,
      sync: { onConnect: false },
    });
    expect(wsReplica.transportMode).toBe('replica');
    expect(wsReplica.getTursoConfig().timeout).toBe(WINDOW_MS);
  });
});
