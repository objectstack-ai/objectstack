// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import {
  OpenAIEmbedder,
  createOpenAIEmbedder,
  OPENAI_COMPATIBLE_PRESETS,
} from '../index';

function mockFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}

describe('OpenAIEmbedder', () => {
  it('requires apiKey', () => {
    expect(() => new OpenAIEmbedder({ apiKey: '' })).toThrow(/apiKey required/);
  });

  it('exposes id and known dimensions for default model', () => {
    const e = new OpenAIEmbedder({ apiKey: 'k', fetch: mockFetch({ data: [] }) });
    expect(e.id).toBe('openai');
    expect(e.dimensions).toBe(1536);
  });

  it('looks up dimensions for known Chinese models', () => {
    const e = new OpenAIEmbedder({
      apiKey: 'k',
      model: 'text-embedding-v3',
      fetch: mockFetch({ data: [] }),
    });
    expect(e.dimensions).toBe(1024);
  });

  it('honours explicit dimensions override', () => {
    const e = new OpenAIEmbedder({
      apiKey: 'k',
      dimensions: 256,
      fetch: mockFetch({ data: [] }),
    });
    expect(e.dimensions).toBe(256);
  });

  it('returns [] for empty input without calling fetch', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const e = new OpenAIEmbedder({ apiKey: 'k', fetch: fetchImpl });
    const out = await e.embed([]);
    expect(out).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('POSTs to the configured baseUrl with bearer auth', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const e = new OpenAIEmbedder({
      apiKey: 'sk-test',
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'BAAI/bge-m3',
      fetch: fetchImpl,
    });
    const out = await e.embed(['hello']);

    expect(out).toEqual([[0.1, 0.2]]);
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('https://api.siliconflow.cn/v1/embeddings');
    const init = call[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body as string)).toEqual({ model: 'BAAI/bge-m3', input: ['hello'] });
  });

  it('forwards dimensions in the request body when overridden', async () => {
    const fetchImpl = mockFetch({ data: [{ embedding: [1, 2] }] });
    const e = new OpenAIEmbedder({
      apiKey: 'k',
      dimensions: 512,
      fetch: fetchImpl,
    });
    await e.embed(['x']);
    const body = JSON.parse(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    );
    expect(body.dimensions).toBe(512);
  });

  it('throws a useful error on non-2xx', async () => {
    const fetchImpl = mockFetch({ error: 'bad key' }, 401);
    const e = new OpenAIEmbedder({ apiKey: 'k', fetch: fetchImpl });
    await expect(e.embed(['x'])).rejects.toThrow(/401/);
  });

  it('throws when response vector count mismatches input', async () => {
    const fetchImpl = mockFetch({ data: [{ embedding: [1] }] });
    const e = new OpenAIEmbedder({ apiKey: 'k', fetch: fetchImpl });
    await expect(e.embed(['a', 'b'])).rejects.toThrow(/expected 2 vectors/);
  });

  it('strips trailing slashes from baseUrl', async () => {
    const fetchImpl = mockFetch({ data: [{ embedding: [1] }] });
    const e = new OpenAIEmbedder({
      apiKey: 'k',
      baseUrl: 'https://x.example/v1///',
      fetch: fetchImpl,
    });
    await e.embed(['x']);
    expect(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).toBe('https://x.example/v1/embeddings');
  });

  it('merges extra headers', async () => {
    const fetchImpl = mockFetch({ data: [{ embedding: [1] }] });
    const e = new OpenAIEmbedder({
      apiKey: 'k',
      fetch: fetchImpl,
      headers: { 'x-trace-id': 't1' },
    });
    await e.embed(['x']);
    const headers = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][1].headers as Record<string, string>;
    expect(headers['x-trace-id']).toBe('t1');
    expect(headers.authorization).toBe('Bearer k');
  });
});

describe('OpenAIEmbedder batching (per-request input cap)', () => {
  /** Answers each request with one vector per input: `[n]` for input `t<n>`. */
  function echoFetch(failOnCall?: number): ReturnType<typeof vi.fn> {
    let call = 0;
    return vi.fn(async (_url: string, init: RequestInit) => {
      call++;
      if (call === failOnCall) {
        return new Response('{"error":"too many inputs"}', { status: 400, statusText: 'Bad Request' });
      }
      const { input } = JSON.parse(init.body as string) as { input: string[] };
      return new Response(
        JSON.stringify({ data: input.map((t) => ({ embedding: [Number(t.slice(1))] })) }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
  }
  const inputs = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
  const sentSizes = (f: ReturnType<typeof vi.fn>) =>
    f.mock.calls.map((c) => (JSON.parse((c[1] as RequestInit).body as string).input as string[]).length);

  it('splits input above the cap and preserves input order', async () => {
    const f = echoFetch();
    // text-embedding-v3 is documented at 10 inputs per request.
    const e = new OpenAIEmbedder({ apiKey: 'k', model: 'text-embedding-v3', fetch: f as unknown as typeof fetch });
    const out = await e.embed(inputs(25));
    expect(sentSizes(f)).toEqual([10, 10, 5]);
    expect(out).toEqual(Array.from({ length: 25 }, (_, i) => [i]));
  });

  it('sends exactly-cap input as one request', async () => {
    const f = echoFetch();
    const e = new OpenAIEmbedder({ apiKey: 'k', model: 'text-embedding-v3', fetch: f as unknown as typeof fetch });
    await e.embed(inputs(10));
    expect(sentSizes(f)).toEqual([10]);
  });

  it('sends cap + 1 inputs as two requests', async () => {
    const f = echoFetch();
    const e = new OpenAIEmbedder({ apiKey: 'k', model: 'text-embedding-v3', fetch: f as unknown as typeof fetch });
    const out = await e.embed(inputs(11));
    expect(sentSizes(f)).toEqual([10, 1]);
    expect(out[10]).toEqual([10]);
  });

  it('fails the call on a failing batch, naming its index, and sends no later batch', async () => {
    const f = echoFetch(2);
    const e = new OpenAIEmbedder({ apiKey: 'k', model: 'text-embedding-v3', fetch: f as unknown as typeof fetch });
    const err = await e.embed(inputs(25)).then(
      () => undefined,
      (x: unknown) => x as Error,
    );
    expect(err?.message).toContain('400 Bad Request: {"error":"too many inputs"}');
    expect(err?.message).toContain('batch index 1 of 3 (0-based), inputs 10..19');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('honours an explicit maxBatchSize over the known-model cap', async () => {
    const f = echoFetch();
    const e = new OpenAIEmbedder({ apiKey: 'k', maxBatchSize: 3, fetch: f as unknown as typeof fetch });
    const out = await e.embed(inputs(7));
    expect(sentSizes(f)).toEqual([3, 3, 1]);
    expect(out).toEqual(Array.from({ length: 7 }, (_, i) => [i]));
  });

  it('refuses a maxBatchSize that is not a positive integer', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => new OpenAIEmbedder({ apiKey: 'k', maxBatchSize: bad })).toThrow(
        /maxBatchSize must be a positive integer/,
      );
    }
  });

  it('batches an unknown model at the conservative default and warns once per instance', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const f = echoFetch();
      const e = new OpenAIEmbedder({ apiKey: 'k', model: 'my-gateway-model', fetch: f as unknown as typeof fetch });
      await e.embed(inputs(12));
      await e.embed(inputs(12));
      expect(sentSizes(f)).toEqual([10, 2, 10, 2]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("'my-gateway-model'");

      // A known model, or an explicit override, stays silent.
      new OpenAIEmbedder({ apiKey: 'k', model: 'text-embedding-3-small', fetch: f as unknown as typeof fetch });
      new OpenAIEmbedder({ apiKey: 'k', model: 'my-gateway-model', maxBatchSize: 50, fetch: f as unknown as typeof fetch });
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('createOpenAIEmbedder presets', () => {
  it('maps preset names to baseUrl', () => {
    const e = createOpenAIEmbedder({
      preset: 'dashscope',
      apiKey: 'k',
      model: 'text-embedding-v3',
      fetch: mockFetch({ data: [] }),
    });
    expect(e.id).toBe('dashscope');
    expect(e.dimensions).toBe(1024);
  });

  it('exposes well-known preset URLs', () => {
    expect(OPENAI_COMPATIBLE_PRESETS.siliconflow).toContain('siliconflow.cn');
    expect(OPENAI_COMPATIBLE_PRESETS.zhipu).toContain('bigmodel.cn');
    expect(OPENAI_COMPATIBLE_PRESETS.ollama).toContain('localhost:11434');
  });

  it('explicit baseUrl wins over preset', async () => {
    const fetchImpl = mockFetch({ data: [{ embedding: [1] }] });
    const e = createOpenAIEmbedder({
      preset: 'openai',
      baseUrl: 'https://my-proxy.example/v1',
      apiKey: 'k',
      fetch: fetchImpl,
    });
    await e.embed(['x']);
    expect(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).toBe('https://my-proxy.example/v1/embeddings');
  });
});
