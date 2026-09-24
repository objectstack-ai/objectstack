// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `TursoDriverConfig.timeout` beside an UPPERCASE `WSS://` / `WS://` url in
 * forced remote mode is refused at construction, exactly as the lowercase pair
 * already is — the last corner of the same ADR-0049 gap.
 *
 * # Why the corner was open (the upstream step the first reading missed)
 *
 * `@libsql/client`'s routing switch really does match the literal lowercase
 * (`lib-esm/node.js`: `config.scheme === "wss" || config.scheme === "ws"`), and
 * reading only that switch says an uppercase url can never reach the WebSocket
 * arm. It can: `expandConfig` runs BEFORE the switch and has already lowercased
 * the scheme, so the switch never sees the original casing. Measured against
 * `@libsql/core@0.17.4`, whose `lib-esm/config.js` does it on one line —
 * `const originalUriScheme = uri.scheme.toLowerCase();`:
 *
 * ```
 * expandConfig({ url: 'WSS://db.example.turso.io' }, true).scheme === 'wss'
 * expandConfig({ url: 'Ws://127.0.0.1:8080'      }, true).scheme === 'ws'
 * ```
 *
 * (and the control that makes those two a reading rather than a coincidence:
 * `'LIBSQL://db.example.turso.io'` expands to `'https'`, so the same call is
 * observably capable of answering something other than the input's own letters.)
 * `@libsql/client@0.17.4`'s node entry is `_createClient(expandConfig(config,
 * true))`, so that lowercased scheme IS what the switch reads. An uppercase
 * `WSS://` url therefore reaches the WebSocket client, which has no window seam
 * at all — the reading `refuseWebSocketTimeout` already stands on.
 *
 * A correct local observation plus a missed upstream step yields a wrong
 * conclusion, and the observation itself survives re-checking; that is why this
 * pin spells the chain out rather than asserting the outcome alone.
 *
 * # What this file pins
 *
 * The refusal reaching the uppercase spellings, as the ADR-0112 envelope
 * (`code` + `status`) and as THE SAME MESSAGE the lowercase refusal produces —
 * asserted by construction, not by re-typing the text: the uppercase message
 * must equal the lowercase one with the echoed scheme swapped. The echo is the
 * one deliberate difference, and it is deliberate because an operator greps the
 * config for what they actually typed.
 *
 * And the three controls the refusal must not eat:
 *
 * 1. FLIPPED, deliberately. This control first pinned that an uppercase url
 *    with NO explicit mode fell through `detectMode` to `'local'`, the
 *    behaviour the window refusal was scoped not to change. That fall-through
 *    ran the local engine on a private `:memory:` database (writes read back,
 *    then vanished on restart), and it was then argued and removed on its own:
 *    `detectMode` now reads the scheme through the same case fold as
 *    `ridesWebSocketTransport`, the way `@libsql/client` routes it
 *    (`turso-driver-unrecognised-url-refusal.test.ts` is the primary pin). So
 *    an uppercase remote url with no mode is REMOTE, and an uppercase `WSS://`
 *    with a window and no mode meets this file's refusal like the lowercase one.
 * 2. The existing lowercase `wss://` / `ws://` refusals still fire
 *    (`turso-driver-ws-timeout-refusal.test.ts` is the primary pin; repeated
 *    here as the immediate neighbour of the widened predicate).
 * 3. `https://` remote + `timeout` is still ACCEPTED, in every casing. An
 *    implementation that refused `timeout` on every remote would turn this
 *    file green while deleting the whole option.
 *
 * # Reverse verification — direction predicted before it was run
 *
 * Restore `ridesWebSocketTransport` to its literal-prefix form and the refusal
 * cases go RED (the constructor returns a driver with `transportMode:
 * 'remote'`, and there is no envelope to read); controls 2 and 3 stay GREEN,
 * because each describes behaviour that is identical before and after.
 * Measured both ways — see the PR. Since control 1 was flipped, its
 * `WSS://` + window case reads the same predicate and goes RED with the
 * refusal cases; its classification cases read `detectMode` and stay GREEN.
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
const HOST = 'db.example.turso.io';

describe('timeout beside an UPPERCASE WebSocket url in forced remote mode — refused at construction', () => {
  it.each([
    ['WSS://', `WSS://${HOST}`],
    ['Wss://', `Wss://${HOST}`],
    ['WS://', 'WS://127.0.0.1:8080'],
    ['Ws://', 'Ws://127.0.0.1:8080'],
  ])('%s + explicit remote + timeout is refused as VALIDATION_ERROR / 400', (scheme, url) => {
    const refusal = refusalOf(() => new TursoDriver({ url, mode: 'remote', timeout: WINDOW_MS }));

    expect(refusal).not.toBeNull();
    expect(refusal!.code).toBe('VALIDATION_ERROR');
    expect(refusal!.status).toBe(400);
    expect(refusal!.message).toContain('TursoDriverConfig.timeout');
    expect(refusal!.message).toContain(`${WINDOW_MS} ms`);
    // The scheme is echoed in the caller's own spelling.
    expect(refusal!.message).toContain(`\`${scheme}\``);
    // Both ways out survive.
    expect(refusal!.message).toContain('libsql://');
    expect(refusal!.message).toContain('omit `timeout`');
  });

  it('is the SAME message the lowercase refusal produces, differing only in the echoed scheme', () => {
    const upper = refusalOf(() => new TursoDriver({ url: `WSS://${HOST}`, mode: 'remote', timeout: WINDOW_MS }));
    const lower = refusalOf(() => new TursoDriver({ url: `wss://${HOST}`, mode: 'remote', timeout: WINDOW_MS }));

    expect(lower).not.toBeNull();
    expect(upper).not.toBeNull();
    expect(upper!.code).toBe(lower!.code);
    expect(upper!.status).toBe(lower!.status);
    expect(upper!.message).toBe(lower!.message.split('`wss://`').join('`WSS://`'));
  });

  it('createTursoDriver() is the same constructor, and refuses the same pair', () => {
    const refusal = refusalOf(() => createTursoDriver({ url: `WSS://${HOST}`, mode: 'remote', timeout: WINDOW_MS }));

    expect(refusal?.code).toBe('VALIDATION_ERROR');
    expect(refusal?.status).toBe(400);
  });
});

describe('CONTROL 1 (FLIPPED) — an uppercase url with no explicit mode is detected as remote, as @libsql/client routes it', () => {
  it.each([`WSS://${HOST}`, 'Ws://127.0.0.1:8080', `HTTPS://${HOST}`, `LIBSQL://${HOST}`])(
    '%s with no `mode` is remote, no longer a local database on a private :memory: engine',
    (url) => {
      const driver = new TursoDriver({ url });

      expect(driver.transportMode).toBe('remote');
      expect(driver.isRemote).toBe(true);
    },
  );

  it('so an uppercase WebSocket url WITH a timeout and no mode meets the refusal, exactly as the lowercase one does', () => {
    const upper = refusalOf(() => new TursoDriver({ url: `WSS://${HOST}`, timeout: WINDOW_MS }));
    const lower = refusalOf(() => new TursoDriver({ url: `wss://${HOST}`, timeout: WINDOW_MS }));

    expect(lower).not.toBeNull();
    expect(upper).not.toBeNull();
    expect(upper!.code).toBe('VALIDATION_ERROR');
    expect(upper!.status).toBe(400);
    expect(upper!.message).toBe(lower!.message.split('`wss://`').join('`WSS://`'));
  });
});

describe('CONTROL 2 — the existing lowercase refusals still fire', () => {
  it.each([
    ['wss://', `wss://${HOST}`],
    ['ws://', 'ws://127.0.0.1:8080'],
  ])('%s + timeout is still refused as VALIDATION_ERROR / 400', (_scheme, url) => {
    const refusal = refusalOf(() => new TursoDriver({ url, authToken: 'token', timeout: WINDOW_MS }));

    expect(refusal?.code).toBe('VALIDATION_ERROR');
    expect(refusal?.status).toBe(400);
  });
});

describe('CONTROL 3 — https:// remote + timeout stays ACCEPTED, in every casing', () => {
  it.each([`https://${HOST}`, `HTTPS://${HOST}`, `Https://${HOST}`, `LIBSQL://${HOST}`, `HTTP://127.0.0.1:8080`])(
    '%s + explicit remote + timeout constructs and keeps the window — the HTTP arm IS bounded',
    (url) => {
      const driver = new TursoDriver({ url, mode: 'remote', authToken: 'token', timeout: WINDOW_MS });

      expect(driver.transportMode).toBe('remote');
      expect(driver.getTursoConfig().timeout).toBe(WINDOW_MS);
    },
  );

  it('an uppercase WebSocket url with NO timeout still constructs as remote when mode is forced', () => {
    const driver = new TursoDriver({ url: `WSS://${HOST}`, mode: 'remote', authToken: 'token' });

    expect(driver.transportMode).toBe('remote');
    expect(driver.getTursoConfig().timeout).toBeUndefined();
  });

  it('`timeout: 0` is the documented "no bound" and is not refused on an uppercase url either', () => {
    const driver = new TursoDriver({ url: `WSS://${HOST}`, mode: 'remote', authToken: 'token', timeout: 0 });

    expect(driver.transportMode).toBe('remote');
    expect(driver.getTursoConfig().timeout).toBe(0);
  });
});
