// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15451] `oauth.applications.delete` must RESOLVE on the zero-byte 200 its
 * route actually answers — and must still reject, loudly, on anything else.
 *
 * ## Why this file exists at all, when its sibling is type-level
 *
 * `return-type-precision.test.ts` says in its own header that a runtime test
 * cannot observe a return-type narrowing: the value is identical either way.
 * The reverse is true here and is the whole point. This card did not narrow a
 * declaration — it changed what the method DOES. Before it, the method called
 * `res.json()` on a body of zero bytes and REJECTED with `SyntaxError:
 * Unexpected end of JSON input` on every successful delete; after it, the
 * same call resolves. No compile-time assertion can see a reject/resolve
 * flip, so the two files pin the two halves and neither is redundant.
 *
 * ## The wire fact these fixtures encode, measured not assumed
 *
 * Real `betterAuth` + real `@better-auth/oauth-provider` over the real
 * ObjectQL adapter, driven through the real `ObjectStackClient` with only the
 * socket stood in for:
 *
 *     POST /api/v1/auth/oauth2/delete-client
 *       -> 200 · 0 bytes · content-type: application/json · NO content-length
 *
 * Both shortcuts a reader will reach for were measured and both are unusable,
 * which is why the fix reads the body instead:
 *
 *   - `res.status === 204` — the spelling five other delete surfaces in
 *     `index.ts` use. The status here is **200**, so it never fires.
 *   - `content-length === '0'` — the header is **absent**, not zero, so a
 *     header test never fires either and would leave the defect in place
 *     while looking like a fix.
 *
 * ## ⛔ The malformed-body case is load-bearing, not leftover
 *
 * The implementation still runs `JSON.parse` on a NON-EMPTY body and throws
 * the result away. That reads like dead code and is not: it is what keeps a
 * malformed response loud, so the ONLY behaviour the card changed is the
 * zero-byte case — the defect itself. Delete the parse "because nothing reads
 * it" and `expect(...).rejects` below goes red, by design.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackClient } from './index';

const BASE = 'http://localhost:3000';
const DELETE_URL = `${BASE}/api/v1/auth/oauth2/delete-client`;

/**
 * A client whose transport answers with a REAL `Response`. Deliberately not a
 * hand-rolled double with a stubbed `json()`: the defect lived in how a real
 * `Response` behaves when its body is empty, and a double that answers
 * `json: async () => undefined` cannot reproduce it — it would have been
 * green against the broken client too.
 */
function clientAnswering(body: BodyInit | null, init?: ResponseInit) {
  const fetchMock = vi.fn(async () => new Response(body, init));
  const client = new ObjectStackClient({ baseUrl: BASE, fetch: fetchMock as never });
  return { client, fetchMock };
}

/** The exact answer the route was measured to send on a successful delete. */
const ZERO_BYTE_200: [BodyInit | null, ResponseInit] = [
  null,
  { status: 200, headers: { 'content-type': 'application/json' } },
];

describe('#15451 oauth.applications.delete — the zero-byte 200', () => {
  it('RESOLVES on the 200 / zero-byte answer the route actually sends', async () => {
    const { client } = clientAnswering(...ZERO_BYTE_200);
    // ⚠️ RED BEFORE: this rejected with `SyntaxError: Unexpected end of JSON
    // input`, on the successful path, every single time.
    await expect(client.oauth.applications.delete('c_1')).resolves.toBeUndefined();
  });

  it('resolves on an empty-STRING body too — the same zero bytes, spelled differently', async () => {
    const { client } = clientAnswering('', { status: 200 });
    await expect(client.oauth.applications.delete('c_1')).resolves.toBeUndefined();
  });

  it('sends the same request bytes as before — only the RESPONSE handling moved', async () => {
    const { client, fetchMock } = clientAnswering(...ZERO_BYTE_200);
    await client.oauth.applications.delete('c_1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(DELETE_URL);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ client_id: 'c_1' }));
  });

  it('⛔ still REJECTS on a malformed non-empty body — the parse is not decoration', async () => {
    const { client } = clientAnswering('{ not json', { status: 200 });
    // Green in BOTH states, and recorded as such: it is here to go RED if
    // someone removes the `JSON.parse` as unused, which would trade this
    // card's loud bug for a quiet one.
    await expect(client.oauth.applications.delete('c_1')).rejects.toThrow(SyntaxError);
  });

  it('rejects on a whitespace-only body — the boundary is EXACTLY zero bytes', async () => {
    const { client } = clientAnswering('\n', { status: 200 });
    // Stated rather than left to drift: the tolerated case is the empty body
    // the route sends, not "anything that looks blank". A body that is
    // present but not JSON is a malformed response and says so.
    await expect(client.oauth.applications.delete('c_1')).rejects.toThrow(SyntaxError);
  });

  it('resolves and DISCARDS a well-formed body, should the route ever grow one', async () => {
    const { client } = clientAnswering(JSON.stringify({ deleted: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    // The declared contract is `void`. A payload arriving here is validated
    // and dropped; surfacing it is a deliberate widening of the return type,
    // never a silent change of shape under an unchanged declaration.
    await expect(client.oauth.applications.delete('c_1')).resolves.toBeUndefined();
  });

  it('"already gone" still arrives as a THROW, which is what makes `void` honest', async () => {
    // The route distinguishes deleted from already-gone on the ERROR channel:
    // a missing client answers 404 `{ error: 'not_found' }`. `this.fetch`
    // raises that before any success value exists, so the success answer has
    // no information left to carry and `{ deleted: true }` would be invented.
    const { client } = clientAnswering(
      JSON.stringify({ error_description: 'client not found', error: 'not_found' }),
      { status: 404, headers: { 'content-type': 'application/json' } },
    );
    await expect(client.oauth.applications.delete('gone')).rejects.toThrow(/not_found/);
  });
});
