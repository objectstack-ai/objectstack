// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Unit coverage for the CLI-side envelope reader (#10675).
 *
 * The bodies here are built by the server's OWN writer — `sendOk` / `sendError`
 * from `@objectstack/types`, the one function pair that writes the declared
 * envelope — rather than by a literal typed out in this file. That is the whole
 * point: the defect under repair was a hand-copied server shape that kept
 * agreeing with itself long after the server had moved. A fixture transcribed
 * here would reproduce exactly that failure mode in the test layer.
 */

import { describe, expect, it } from 'vitest';
import { sendError, sendOk } from '@objectstack/types';
import { serverBody } from './__tests__/server-body.js';
import { readEnvelope, readEnvelopeFrom } from './response-envelope.js';

describe('readEnvelope', () => {
  it('returns the payload nested under `data` for a `sendOk` body', () => {
    const body = serverBody((res) => sendOk(res, { tables: [{ name: 'customers', columnCount: 7 }] }));

    const read = readEnvelope<{ tables: Array<{ name: string }> }>(body, 200);

    expect(read).toEqual({ ok: true, data: { tables: [{ name: 'customers', columnCount: 7 }] } });
  });

  it('returns `error.message` — the field, never the object — for a `sendError` body', () => {
    const body = serverBody((res) =>
      sendError(res, 400, 'EXTERNAL_DATASOURCE_ERROR', "Datasource 'nope' not found."),
    );

    const read = readEnvelope(body, 400);

    expect(read).toEqual({ ok: false, message: "Datasource 'nope' not found." });
    // The crash under repair was `this.error(<object>)`; a reader that can only
    // ever produce a string is what makes that unreachable.
    expect(typeof (read as { message: string }).message).toBe('string');
  });

  it('refuses the PRE-#3843 flat shape instead of tolerating it as a second contract', () => {
    // Exactly what the server used to send, and what the commands were still
    // reading. Accepting it here would be the consumer-side fallback Prime
    // Directive #12 forbids.
    const read = readEnvelope({ results: [{ ok: true, object: 'a', diffs: [] }] }, 200);

    expect(read.ok).toBe(false);
  });

  it('reports an unreadable body as a failure, NEVER as an empty payload', () => {
    for (const body of [undefined, null, 'plain text', 42, { success: true }, { success: 'yes', data: {} }]) {
      const read = readEnvelope(body, 500);
      expect(read.ok, `body: ${JSON.stringify(body)}`).toBe(false);
      expect((read as { message: string }).message).toContain('HTTP 500');
    }
  });

  it('still yields a string message when the server refuses without one', () => {
    const read = readEnvelope({ success: false, error: { code: 'FORBIDDEN' } }, 403);

    expect(read.ok).toBe(false);
    expect((read as { message: string }).message).toContain('FORBIDDEN');
  });
});

describe('readEnvelopeFrom', () => {
  it('reads a response whose body is the declared envelope', async () => {
    const body = serverBody((res) => sendOk(res, { draft: { source: 'export const o = {}' } }));

    const read = await readEnvelopeFrom<{ draft: { source: string } }>({
      status: 200,
      json: async () => body,
    });

    expect(read).toEqual({ ok: true, data: { draft: { source: 'export const o = {}' } } });
  });

  it('fails loudly on a body that is not JSON at all', async () => {
    const read = await readEnvelopeFrom({
      status: 404,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      },
    });

    expect(read.ok).toBe(false);
    expect((read as { message: string }).message).toContain('HTTP 404');
  });
});
