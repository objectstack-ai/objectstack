// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24287] `toResponse`'s events arm writes a string event as given, and a
 * producer's own header replaces the default it names.
 *
 * The standalone server's writer (`runtime/src/dispatcher-plugin.ts`,
 * `sendResultBase`) writes a string event verbatim and an object event as one
 * SSE frame, and a route's header replaces the default. This arm SSE-framed
 * every event outside a Vercel data stream and appended the producer's
 * lowercase headers beside its own capitalised defaults, so the `/mcp/skill`
 * domain's single markdown chunk reached the caller as `data: "# skill"` under
 * a doubled `Content-Type` and `no-cache, no-store`.
 *
 * The rows below are the producers that reach this arm: the `/mcp/skill`
 * domain (`runtime/src/domains/mcp.ts`), and the `/ai` domain
 * (`runtime/src/domains/ai.ts`) in both its shapes — a Vercel data stream of
 * pre-encoded string frames, and an SSE stream of object parts. The two `/ai`
 * rows pin answers this card leaves unchanged. The dispatcher is a fixture
 * (this package's config aliases `@objectstack/runtime` to a stub); the same
 * skill row through the real dispatcher and both doors is
 * `packages/qa/http-conformance/src/hono-mcp-skill-raw-body.conformance.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDispatcher = {
  getDiscoveryInfo: vi.fn().mockReturnValue({ version: '1.0', routes: {} }),
  handleAuth: vi.fn(),
  dispatch: vi.fn(),
};

vi.mock('@objectstack/runtime', () => ({
  HttpDispatcher: function HttpDispatcher() { return mockDispatcher; },
}));

import { createHonoApp } from './index';

const PREFIX = '/api/v1';
const kernel = { name: 'test-kernel' } as any;

async function* events(...items: unknown[]) {
  for (const item of items) yield item;
}

async function get(result: Record<string, unknown>): Promise<Response> {
  mockDispatcher.dispatch.mockResolvedValue({ handled: true, result: { type: 'stream', ...result } });
  const app = createHonoApp({ kernel, prefix: PREFIX, cors: false });
  return app.request(`http://hosted.test${PREFIX}/some/stream`);
}

beforeEach(() => {
  mockDispatcher.dispatch.mockReset();
});

describe('[#24287] toResponse events arm: string events verbatim, producer headers replace defaults', () => {
  it('the /mcp/skill shape: the markdown verbatim, and each declared header once', async () => {
    const markdown = '---\nname: objectstack\n---\n\n# skill "quoted"\n';
    const res = await get({
      status: 200,
      contentType: 'text/markdown; charset=utf-8',
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': 'inline; filename="SKILL.md"',
        'cache-control': 'no-store',
      },
      events: events(markdown),
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(markdown);
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-disposition')).toBe('inline; filename="SKILL.md"');
  });

  it('an object event outside a Vercel data stream is still one SSE frame, under the SSE defaults', async () => {
    const res = await get({ contentType: 'text/event-stream', events: events({ type: 'text-delta', text: 'hi' }, { type: 'finish' }) });

    expect(await res.text()).toBe('data: {"type":"text-delta","text":"hi"}\n\ndata: {"type":"finish"}\n\n');
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('connection')).toBe('keep-alive');
  });

  it('the /ai SSE shape (object parts, capitalised headers): unchanged', async () => {
    const res = await get({
      contentType: 'text/event-stream',
      events: events({ type: 'text-delta', id: '0', text: 'a' }),
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
    });

    expect(await res.text()).toBe('data: {"type":"text-delta","id":"0","text":"a"}\n\n');
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('the /ai Vercel data stream shape (pre-encoded string frames): unchanged', async () => {
    const frames = ['data: {"type":"start"}\n\n', 'data: {"type":"text-delta","id":"0","delta":"a"}\n\n', 'data: [DONE]\n\n'];
    const res = await get({
      contentType: 'text/plain; charset=utf-8',
      vercelDataStream: true,
      events: events(...frames, { type: 'raw' }),
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
    });

    expect(await res.text()).toBe(`${frames.join('')}{"type":"raw"}\n`);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });
});
