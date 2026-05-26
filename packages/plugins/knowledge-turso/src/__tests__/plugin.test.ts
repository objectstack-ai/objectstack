// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import type { IKnowledgeService, IEmbedder } from '@objectstack/spec/contracts';
import { KNOWLEDGE_SERVICE, EMBEDDER_SERVICE } from '@objectstack/spec/contracts';
import { KnowledgeTursoPlugin } from '../index';
import { HashEmbedder } from '../embedding';

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function createCtx(initialServices: Record<string, unknown> = {}) {
  const services = new Map<string, unknown>(Object.entries(initialServices));
  return {
    registerService: vi.fn((n: string, s: unknown) => services.set(n, s)),
    getService: vi.fn(<T,>(n: string): T => {
      if (!services.has(n)) throw new Error(`Service "${n}" not found`);
      return services.get(n) as T;
    }),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: silentLogger(),
    _services: services,
  } as any;
}

function createKnowledgeService(): IKnowledgeService {
  return {
    registerAdapter: vi.fn(),
    registerSource: vi.fn(),
    search: vi.fn(),
  } as unknown as IKnowledgeService;
}

describe('KnowledgeTursoPlugin — embedder wiring', () => {
  it('constructs without an embedding option (deferred resolution)', () => {
    expect(
      () =>
        new KnowledgeTursoPlugin({
          url: ':memory:',
        }),
    ).not.toThrow();
  });

  it('resolves embedder from EMBEDDER_SERVICE at start()', async () => {
    const svc = createKnowledgeService();
    const embedder: IEmbedder = new HashEmbedder(64);
    const ctx = createCtx({
      [KNOWLEDGE_SERVICE]: svc,
      [EMBEDDER_SERVICE]: embedder,
    });
    const plugin = new KnowledgeTursoPlugin({ url: ':memory:' });
    await plugin.init(ctx);
    await plugin.start(ctx);
    expect(svc.registerAdapter).toHaveBeenCalledTimes(1);
    const [id, adapter] = (svc.registerAdapter as any).mock.calls[0];
    expect(id).toBe('turso');
    expect(adapter).toBeDefined();
    await plugin.stop(ctx);
  });

  it('prefers explicit embedding option over EMBEDDER_SERVICE', async () => {
    const svc = createKnowledgeService();
    const explicit: IEmbedder = new HashEmbedder(64);
    Object.defineProperty(explicit, 'id', { value: 'explicit-hash' });
    const fromService: IEmbedder = new HashEmbedder(64);
    Object.defineProperty(fromService, 'id', { value: 'service-hash' });
    const ctx = createCtx({
      [KNOWLEDGE_SERVICE]: svc,
      [EMBEDDER_SERVICE]: fromService,
    });
    const plugin = new KnowledgeTursoPlugin({
      url: ':memory:',
      embedding: explicit,
    });
    await plugin.init(ctx);
    await plugin.start(ctx);
    expect(svc.registerAdapter).toHaveBeenCalledTimes(1);
    await plugin.stop(ctx);
  });

  it('warns and no-ops when neither embedding nor EMBEDDER_SERVICE present', async () => {
    const svc = createKnowledgeService();
    const ctx = createCtx({ [KNOWLEDGE_SERVICE]: svc });
    const plugin = new KnowledgeTursoPlugin({ url: ':memory:' });
    await plugin.init(ctx);
    await plugin.start(ctx);
    expect(svc.registerAdapter).not.toHaveBeenCalled();
    expect(ctx.logger.warn).toHaveBeenCalled();
    const msg = (ctx.logger.warn as any).mock.calls[0][0];
    expect(msg).toMatch(/EMBEDDER_SERVICE|Settings/i);
    await plugin.stop(ctx);
  });

  it('warns when IKnowledgeService is missing (with embedder resolved)', async () => {
    const ctx = createCtx({
      [EMBEDDER_SERVICE]: new HashEmbedder(64),
    });
    const plugin = new KnowledgeTursoPlugin({ url: ':memory:' });
    await plugin.init(ctx);
    await plugin.start(ctx);
    expect(ctx.logger.warn).toHaveBeenCalled();
    const msg = (ctx.logger.warn as any).mock.calls[0][0];
    expect(msg).toMatch(/IKnowledgeService/);
    await plugin.stop(ctx);
  });
});
