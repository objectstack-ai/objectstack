// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The readability probe reads a REFUSED read as "cannot read", and only a
 * refused read (objectui#11878).
 *
 * ## What was measured, and what these cases replay
 *
 * Against a booted server, an approver with no object-level read on the
 * approval's target issued the probe's exact list read and got
 * `403 { error, code: 'PERMISSION_DENIED', object }`. Through the real
 * `ObjectStackAdapter`, that reaches the probe as a plain `Error` carrying
 * `httpStatus: 403` and `code: 'PERMISSION_DENIED'` (the client stamps both
 * from the response; the adapter rethrows it untouched). The probe's catch
 * used to swallow it as unknown, so the record link stayed and landed on the
 * record page's catch-all.
 *
 * So the data source here is the REAL adapter over the real
 * `@objectstack/client`, and only `fetch` is stubbed: each case hands the
 * transport one HTTP answer, in the server's own body shape, and reads what
 * the probe makes of it. A client that stopped stamping the status, or an
 * adapter that started swallowing the rejection, reddens the refusal case
 * rather than passing it on a hand-built error.
 *
 * ## The controls, and why each is here
 *
 * The ruling admits a refusal and nothing else, so every other answer is a
 * pin that it stays unknown (the key absent — the caller keeps the link):
 * a 5xx, a transport failure, a 401, and an `enable`-block denial (a 404 the
 * adapter rethrows rather than reading as an empty collection). The 200
 * answers are the unchanged objectui#5211 behaviour, side by side with the
 * refusal so the two verdicts are told apart in one place.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectStackAdapter, clearSharedDiscoveryCache } from '@object-ui/data-objectstack';
import { probeRecordReadability, readabilityKey } from './recordReadability';

/** The server's refusal body, as measured on the probe's list read. */
const REFUSAL_BODY = {
  error: 'You do not have permission to perform this action. Contact your administrator if you need access.',
  code: 'PERMISSION_DENIED',
  object: 'probe_invoice',
};

type Answer =
  | { kind: 'http'; status: number; body: unknown }
  | { kind: 'network' };

/**
 * A real adapter whose transport answers every data read on `object` with
 * `answer`. Discovery answers a minimal document so `connect()` succeeds.
 */
function adapterAnswering(answers: Record<string, Answer>) {
  const fetchImpl = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/api/v1/discovery')) {
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ success: true, data: { version: 'v1', routes: {} } }) };
    }
    const object = Object.keys(answers).find((name) => url.includes(`/api/v1/data/${name}`));
    if (!object) {
      return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ code: 'NOT_FOUND' }) };
    }
    const answer = answers[object];
    if (answer.kind === 'network') throw new TypeError('Failed to fetch');
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      statusText: String(answer.status),
      json: async () => answer.body,
    };
  });
  const adapter = new ObjectStackAdapter({
    baseUrl: 'http://localhost:3000',
    autoReconnect: false,
    fetch: fetchImpl as never,
  });
  return { adapter, fetchImpl };
}

const targets = (object: string, ...ids: string[]) => ids.map((record_id) => ({ object_name: object, record_id }));

describe('probeRecordReadability — a refused read (objectui#11878)', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it('answers `refused` for every id of an object whose read the server refuses with 403', async () => {
    const { adapter, fetchImpl } = adapterAnswering({
      probe_invoice: { kind: 'http', status: 403, body: REFUSAL_BODY },
    });

    const map = await probeRecordReadability(adapter, targets('probe_invoice', 'inv_a', 'inv_b'));

    // The read really went out, once, as the probe's batched list read.
    const dataCalls = fetchImpl.mock.calls.filter(([u]) => String(u).includes('/api/v1/data/'));
    expect(dataCalls).toHaveLength(1);
    expect(map.get(readabilityKey('probe_invoice', 'inv_a'))).toBe('refused');
    expect(map.get(readabilityKey('probe_invoice', 'inv_b'))).toBe('refused');
  });

  it('keeps a refusal to its own object — a readable object beside it still answers per id', async () => {
    const { adapter } = adapterAnswering({
      probe_invoice: { kind: 'http', status: 403, body: REFUSAL_BODY },
      probe_project: { kind: 'http', status: 200, body: { object: 'probe_project', records: [{ id: 'prj_seen' }], total: 1 } },
    });

    const map = await probeRecordReadability(adapter, [
      ...targets('probe_invoice', 'inv_a'),
      ...targets('probe_project', 'prj_seen', 'prj_hidden'),
    ]);

    expect(map.get(readabilityKey('probe_invoice', 'inv_a'))).toBe('refused');
    // objectui#5211, unchanged: in the row set => true; left out => false.
    expect(map.get(readabilityKey('probe_project', 'prj_seen'))).toBe(true);
    expect(map.get(readabilityKey('probe_project', 'prj_hidden'))).toBe(false);
  });

  it.each<[string, Answer]>([
    ['a 5xx', { kind: 'http', status: 500, body: { code: 'INTERNAL_ERROR', message: 'boom' } }],
    ['a 503', { kind: 'http', status: 503, body: { code: 'SERVICE_UNAVAILABLE', message: 'down' } }],
    ['a transport failure', { kind: 'network' }],
    ['a 401', { kind: 'http', status: 401, body: { code: 'UNAUTHORIZED', message: 'sign in' } }],
    ['an enable-block denial (404 OBJECT_API_DISABLED)', { kind: 'http', status: 404, body: { code: 'OBJECT_API_DISABLED', message: 'disabled' } }],
  ])('leaves %s UNKNOWN (absent) — only a refusal joins "cannot read"', async (_label, answer) => {
    const { adapter } = adapterAnswering({ probe_invoice: answer });

    const map = await probeRecordReadability(adapter, targets('probe_invoice', 'inv_a'));

    expect(map.has(readabilityKey('probe_invoice', 'inv_a'))).toBe(false);
  });
});
