// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16545] A throw that ESCAPES a `RouteHandler` carrying a declared ADR-0112
 * `status` + a registered `code` is answered as THAT envelope; a throw that
 * carries no such envelope still answers `500` with no cause in the body.
 *
 * The `domain:cli` half of the #15999 ruling, verbatim:
 *
 * > **Shared half** (`domain:cli`, hono adapter / registrar wrapper): an
 * > escaped throw carrying a declared ADR-0112 `status` + registered `code` is
 * > rendered by them, not as a bare `500 INTERNAL_ERROR "No response from
 * > handler"`. This changes what an escaped throw means for every direct-mount
 * > route; the PR pins that an escaped **non**-envelope throw still answers 500
 * > with no cause in the body.
 *
 * ## Why the pin is HERE and not on the raw Hono mount
 *
 * The `domain:cli` seat's scope ruling on the card (comment `5570159125`,
 * restated in `5575064522`) is binding, and its first reason is a measurement
 * about where a pin can mean anything:
 *
 * > ⭐ **本卡自带的那条 pin 在那扇门上是空的** —— 普查实测,raw mount 上「带信封的
 * > 抛出」与「不带信封的抛出」今天答的是**逐字节相同**的 `text/plain` 500,所以
 * > 「非信封抛出仍答 500 且 body 里没有 cause」这条 pin **在任何修复存在之前就已经
 * > 绿了**。⛔ 一条对着未修复的树就绿的 pin,正是本车道拒绝出货的东西。
 *
 * `HonoHttpServer.wrap()` is the seam every direct-mount route passes —
 * `get`/`post`/`put`/`delete`/`patch` each register `this.wrap(handler)`, and
 * `IHttpServer` is how `service-datasource`, `packages/rest` and the dispatcher
 * bridge all mount. A route mounted through `getRawApp()` funnels through
 * NEITHER `wrap()` nor any registrar wrapper and is out of this card's scope by
 * that ruling; it is named in the PR body as a known-unreached door and filed
 * separately, ⛔ not folded in here.
 *
 * ## Both directions, and the ablation that makes them evidence
 *
 * Every assertion below was measured RED against the unfixed tree before the
 * fix existed (the PR body carries the run). The render arm fails as `500 /
 * INTERNAL_ERROR / "No response from handler"`; the fallback arms pass on the
 * unfixed tree by construction — they are the REGRESSION half, and they are the
 * half that goes red if the gate is ever widened.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Logger } from '@objectstack/spec/contracts';

import { HonoHttpServer } from './adapter';

/**
 * The exact bytes `wrap()` answers for a throw carrying no declared envelope,
 * and for a handler that simply wrote nothing. Byte-identical to the constant
 * `handler-throw-logging.test.ts` pins — deliberately duplicated rather than
 * imported, so that suite and this one cannot drift into agreeing about a
 * literal that moved.
 */
const FALLBACK_BODY =
  '{"success":false,"error":{"code":"INTERNAL_ERROR","message":"No response from handler"}}';

/** A silent logger — this file is about the WIRE, not the diagnosis. */
function quietLogger(): Logger {
  const noop = () => {};
  return { debug: noop, info: noop, warn: noop, error: noop, fatal: noop } as unknown as Logger;
}

function server(): HonoHttpServer {
  const s = new HonoHttpServer(0);
  s.setLogger(quietLogger());
  return s;
}

const call = (s: HonoHttpServer, path: string, init?: RequestInit) =>
  s.getRawApp().fetch(new Request(`http://localhost${path}`, init));

/** A throw shaped exactly like the platform's declared refusals. */
function declared(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return Object.assign(new Error(message), { status, code, ...extra });
}

describe('an escaped throw carrying a declared ADR-0112 envelope is rendered as that envelope', () => {
  /**
   * The motivating path, in the shape `service-datasource` really produces it:
   * `AuthzStoreUnavailableError` declares `status: 503` / `code:
   * SERVICE_UNAVAILABLE` and `requireDatasourceAdmin` re-raises it (#13279), so
   * before this card the operator's outage reached the caller as a generic
   * fault naming the wrong component.
   */
  it('answers the declared status and the declared code, not 500 INTERNAL_ERROR', async () => {
    const s = server();
    s.get('/api/v1/datasources', async () => {
      throw declared(503, 'SERVICE_UNAVAILABLE', 'The authorization store could not be read.');
    });

    const res = await call(s, '/api/v1/datasources');

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'The authorization store could not be read.',
      },
    });
  });

  it('reads `statusCode` as well as `status` — both spellings are produced in this repo', async () => {
    const s = server();
    // `plugin-approvals`' lifecycle hooks and `metadata-protocol` throw
    // `statusCode`; reading one spelling is how `/api/v1/data` answered 500 for
    // a deliberate `409 RECORD_LOCKED` until #7525.
    s.get('/api/v1/conflict', async () => {
      throw Object.assign(new Error('locked by another process'), {
        statusCode: 409,
        code: 'LOCK_CONFLICT',
      });
    });

    const res = await call(s, '/api/v1/conflict');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toEqual({
      code: 'LOCK_CONFLICT',
      message: 'locked by another process',
    });
  });

  it('renders a code registered in the LEDGER, not only a StandardErrorCode', async () => {
    const s = server();
    // `ErrorCode` is `StandardErrorCode` ∪ `ERROR_CODE_LEDGER`; a ledger member
    // is registered exactly as much as a standard one, and a gate that admitted
    // only the standard half would silently demote every service's own code.
    s.get('/api/v1/import', async () => {
      throw declared(400, 'EXTERNAL_IMPORT_ERROR', 'remote table has no primary key');
    });

    const res = await call(s, '/api/v1/import');
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('EXTERNAL_IMPORT_ERROR');
  });

  it('forwards the producer’s `details` and `userMessage` channels', async () => {
    const s = server();
    s.get('/api/v1/conflicted', async () => {
      throw declared(409, 'RESOURCE_CONFLICT', 'diagnostic prose', {
        issues: [{ path: 'name' }],
        userMessage: 'Pick a different name.',
      });
    });

    const res = await call(s, '/api/v1/conflicted');
    const body = await res.json();
    expect(res.status).toBe(409);
    // `userMessage` is the producer's END-USER-addressed text (#9934) and
    // `details` its structured context — the same two channels the REST twin
    // forwards. A door that dropped them would answer a narrower envelope than
    // the producer declared.
    expect(body.error.userMessage).toBe('Pick a different name.');
    expect(body.error.details).toEqual({ issues: [{ path: 'name' }] });
  });

  /**
   * ⚠️ The BLAST RADIUS this card accepts, pinned so it is a decision rather
   * than a surprise. `resolveThrownHttpError` — the ONE rule both HTTP doors
   * already call — treats the validation SHAPE as a declaration (`err.name ===
   * 'ValidationError'` ⇒ `400` / `VALIDATION_FAILED`, and `fields[]` alongside).
   * So a bare `ValidationError` escaping a direct-mount handler now answers 400
   * where it used to answer a bare 500.
   *
   * Carving that limb out HERE would mean this seam disagreeing with the very
   * function it delegates to, which is the two-door divergence #8016 removed.
   * It is accepted and recorded instead.
   */
  it('renders the validation SHAPE as the 400 the one rule says it declares', async () => {
    const s = server();
    s.get('/api/v1/shaped', async () => {
      throw Object.assign(new Error('name is required'), {
        name: 'ValidationError',
        fields: [{ field: 'name', code: 'required' }],
      });
    });

    const res = await call(s, '/api/v1/shaped');
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details).toEqual({ fields: [{ field: 'name', code: 'required' }] });
  });

  it('withholds a LEAKY 5xx message while keeping the declared status and code', async () => {
    const s = server();
    // This seam becomes a door that emits a thrown message with this card, so
    // it owes the disclosure filter its twins already run (#3867 / #8086) from
    // its first day — otherwise a driver dump on a declared 5xx would newly
    // reach the client, where the old bare 500 disclosed nothing.
    s.get('/api/v1/leaky', async () => {
      throw declared(503, 'SERVICE_UNAVAILABLE', 'SQLITE_ERROR: no such table: sys_metadata');
    });

    const res = await call(s, '/api/v1/leaky');
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(body.error.message).toBe('Internal server error');
    expect(body.error.message).not.toContain('sys_metadata');
  });

  it('leaves a 4xx message alone — a caller-facing refusal is not a disclosure', async () => {
    const s = server();
    s.get('/api/v1/refused', async () => {
      throw declared(409, 'RESOURCE_CONFLICT', 'no such table: pass `?version=` to disambiguate');
    });

    const body = await (await call(s, '/api/v1/refused')).json();
    expect(body.error.message).toBe('no such table: pass `?version=` to disambiguate');
  });
});

describe('an escaped throw that is NOT such an envelope keeps today’s behaviour exactly', () => {
  it('a plain Error answers the byte-identical 500 with no cause in the body', async () => {
    const s = server();
    s.get('/api/v1/boom', async () => { throw new Error('datasource exploded'); });

    const res = await call(s, '/api/v1/boom');
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(FALLBACK_BODY);
  });

  it('a declared status with NO code takes the fallback arm', async () => {
    const s = server();
    s.get('/api/v1/half', async () => {
      throw Object.assign(new Error('half declared'), { status: 503 });
    });

    const res = await call(s, '/api/v1/half');
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(FALLBACK_BODY);
  });

  it('a registered code with NO status takes the fallback arm', async () => {
    const s = server();
    s.get('/api/v1/codeonly', async () => {
      throw Object.assign(new Error('code only'), { code: 'SERVICE_UNAVAILABLE' });
    });

    const res = await call(s, '/api/v1/codeonly');
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(FALLBACK_BODY);
  });

  it('an UNREGISTERED code takes the fallback arm — ⛔ nothing is registered in passing', async () => {
    const s = server();
    // A code on this path that is not registered is a LEDGER GAP under the
    // #16404 ruling — reported, never minted here. The card states this as a
    // prohibition, so it is pinned as one.
    s.get('/api/v1/unregistered', async () => {
      throw declared(503, 'TENANCY_SERVICE_EXPLODED', 'not in the ledger');
    });

    const res = await call(s, '/api/v1/unregistered');
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(FALLBACK_BODY);
  });

  it('a status ADR-0112 does not declare takes the fallback arm', async () => {
    const s = server();
    // 418 is not a key of `HttpStatusErrorCodeMap`, so it is not "a declared
    // ADR-0112 status" however registered the code beside it is.
    s.get('/api/v1/teapot', async () => {
      throw declared(418, 'INTERNAL_ERROR', 'kaboom');
    });

    const res = await call(s, '/api/v1/teapot');
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(FALLBACK_BODY);
  });

  it('a NON-string `code` is context, never a declaration', async () => {
    const s = server();
    // A driver errno. Promoting it would put a number in the field callers
    // branch on — the drift #3842 removed.
    s.get('/api/v1/errno', async () => {
      throw Object.assign(new Error('driver said no'), { status: 503, code: 1 });
    });

    const res = await call(s, '/api/v1/errno');
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(FALLBACK_BODY);
  });

  it('a handler that simply writes nothing is unaffected', async () => {
    const s = server();
    // Not a throw — the OTHER way to reach the same body. It never had a
    // declaration to read, and this card does not give it one.
    s.get('/api/v1/silent', async () => { /* resolves without responding */ });

    const res = await call(s, '/api/v1/silent');
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(FALLBACK_BODY);
  });
});

describe('the seams this card deliberately does not move', () => {
  it('a handler that WROTE and then threw keeps what it wrote', async () => {
    const s = server();
    s.get('/api/v1/wrote-then-threw', async (_req, res) => {
      res.status(202);
      res.json({ accepted: true });
      throw declared(503, 'SERVICE_UNAVAILABLE', 'too late');
    });

    const res = await call(s, '/api/v1/wrote-then-threw');
    // The declared envelope must not overwrite a response the handler already
    // produced — the render decision is taken where `capturedResponse` is
    // visible precisely so this stays true.
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true });
  });

  it('a THROWING FALLBACK handler still answers `Fallback handler failed`', async () => {
    const s = server();
    // The `notFound` seam's consumer is a fallback, and a fallback that threw
    // is a broken consumer — not a refusal it declared. The ruling names
    // direct-mount ROUTES, so this arm is opted OUT of the render.
    s.setFallbackHandler(() => {
      throw declared(503, 'SERVICE_UNAVAILABLE', 'fallback exploded');
    });

    const res = await call(s, '/api/v1/nothing-mounted');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Fallback handler failed' },
    });
  });
});

describe('the diagnosis names the answer that was really sent', () => {
  function recording() {
    const errors: Array<{ message: string; meta?: Record<string, any> }> = [];
    const noop = () => {};
    const logger = {
      debug: noop, info: noop, warn: noop, fatal: noop,
      error: (message: string, _err?: unknown, meta?: Record<string, any>) => {
        errors.push({ message, meta });
      },
    } as unknown as Logger;
    return { logger, errors };
  }

  it('reports the rendered envelope instead of claiming an opaque 500', async () => {
    const s = new HonoHttpServer(0);
    const rec = recording();
    s.setLogger(rec.logger);
    s.get('/api/v1/outage', async () => {
      throw declared(503, 'SERVICE_UNAVAILABLE', 'store unreadable');
    });

    await call(s, '/api/v1/outage');

    // Still reported, still exactly once, still at `error`: a refusal thrown
    // past its own `catch` is a server-side defect whatever the wire says.
    expect(rec.errors).toHaveLength(1);
    expect(rec.errors[0]!.message).toContain('declared ADR-0112 envelope');
    expect(rec.errors[0]!.meta).toMatchObject({
      method: 'GET',
      path: '/api/v1/outage',
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it('keeps the old sentence for a throw that took the fallback arm', async () => {
    const s = new HonoHttpServer(0);
    const rec = recording();
    s.setLogger(rec.logger);
    s.get('/api/v1/plain', async () => { throw new Error('plain'); });

    await call(s, '/api/v1/plain');

    expect(rec.errors).toHaveLength(1);
    expect(rec.errors[0]!.message).toBe(
      '[hono] route handler threw — request answered 500 with no cause in the body',
    );
    expect(rec.errors[0]!.meta).toEqual({ method: 'GET', path: '/api/v1/plain' });
  });
});

/**
 * A guard on the reading above: `vi` is imported by every sibling suite in this
 * package and an unused import is a lint failure, so it is used here for the
 * one thing this file genuinely needs a spy for — proving the recording logger
 * is the object the adapter really wrote through.
 */
describe('the logger under test is the one the adapter uses', () => {
  it('routes through `setLogger`, not the package default', async () => {
    const s = new HonoHttpServer(0);
    const error = vi.fn();
    s.setLogger({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), fatal: vi.fn(), error } as unknown as Logger);
    s.get('/api/v1/probe', async () => { throw new Error('probe'); });

    await call(s, '/api/v1/probe');
    expect(error).toHaveBeenCalledTimes(1);
  });
});
