import { describe, it, expect } from 'vitest';
import { createMemoryCache } from './memory-cache';
import { createMemoryQueue } from './memory-queue';
import { createMemoryJob } from './memory-job';
import { createMemoryI18n, resolveLocale } from './memory-i18n';
import { CORE_FALLBACK_FACTORIES } from './index';
import { readServiceSelfInfo } from '@objectstack/spec/api';

describe('CORE_FALLBACK_FACTORIES', () => {
    it('should have exactly 5 entries: metadata, cache, queue, job, i18n', () => {
        expect(Object.keys(CORE_FALLBACK_FACTORIES)).toEqual(['metadata', 'cache', 'queue', 'job', 'i18n']);
    });

    // [#4058] Every kernel fallback must be readable through the ONE standard
    // descriptor. They used to carry `_fallback: true`, which `readServiceSelfInfo`
    // does not recognize — so each of them was reported as a fully available
    // service by both discovery builders.
    it('every fallback self-describes via the standard D12 descriptor', () => {
        for (const [name, factory] of Object.entries(CORE_FALLBACK_FACTORIES)) {
            const info = readServiceSelfInfo(factory());
            expect(info, `${name} must carry __serviceInfo`).toBeDefined();
            // These are real implementations with reduced capability — never fakes.
            expect(info?.status, `${name} status`).toBe('degraded');
            expect(info?.message, `${name} message`).toBeTruthy();
        }
    });

    it('should map to factory functions', () => {
        for (const factory of Object.values(CORE_FALLBACK_FACTORIES)) {
            expect(typeof factory).toBe('function');
        }
    });
});

describe('createMemoryCache', () => {
    // [#4058] Self-describes with the STANDARD D12 descriptor. The old
    // `_fallback: true` marker was read by nothing, so discovery reported
    // this as fully `available` — the honesty gap D12 exists to close.
    it('self-describes as a degraded implementation, not a stub', () => {
        const cache = createMemoryCache();
        expect(readServiceSelfInfo(cache)?.status).toBe('degraded');
        expect(readServiceSelfInfo(cache)?.handlerReady).toBe(false); // no HTTP surface for cache
        expect(readServiceSelfInfo(cache)?.message).toBeTruthy();
        expect(cache._serviceName).toBe('cache');
    });

    it('should set and get a value', async () => {
        const cache = createMemoryCache();
        await cache.set('key1', 'value1');
        expect(await cache.get('key1')).toBe('value1');
    });

    it('should return undefined for missing key', async () => {
        const cache = createMemoryCache();
        expect(await cache.get('nonexistent')).toBeUndefined();
    });

    it('should delete a key', async () => {
        const cache = createMemoryCache();
        await cache.set('key1', 'value1');
        expect(await cache.delete('key1')).toBe(true);
        expect(await cache.get('key1')).toBeUndefined();
    });

    it('should check if a key exists with has()', async () => {
        const cache = createMemoryCache();
        expect(await cache.has('key1')).toBe(false);
        await cache.set('key1', 'value1');
        expect(await cache.has('key1')).toBe(true);
    });

    it('should clear all entries', async () => {
        const cache = createMemoryCache();
        await cache.set('a', 1);
        await cache.set('b', 2);
        await cache.clear();
        expect(await cache.has('a')).toBe(false);
        expect(await cache.has('b')).toBe(false);
    });

    it('should expire entries based on TTL', async () => {
        const cache = createMemoryCache();
        // Set with very short TTL (0.001 seconds = 1ms)
        await cache.set('temp', 'data', 0.001);
        // Wait for expiry
        await new Promise(r => setTimeout(r, 20));
        expect(await cache.get('temp')).toBeUndefined();
    });

    it('should track hit/miss stats', async () => {
        const cache = createMemoryCache();
        await cache.set('key1', 'value1');
        await cache.get('key1');      // hit
        await cache.get('missing');   // miss
        const stats = await cache.stats();
        expect(stats.hits).toBe(1);
        expect(stats.misses).toBe(1);
        expect(stats.keyCount).toBe(1);
    });
});

describe('createMemoryQueue', () => {
    // [#4058] Self-describes with the STANDARD D12 descriptor. The old
    // `_fallback: true` marker was read by nothing, so discovery reported
    // this as fully `available` — the honesty gap D12 exists to close.
    it('self-describes as a degraded implementation, not a stub', () => {
        const queue = createMemoryQueue();
        expect(readServiceSelfInfo(queue)?.status).toBe('degraded');
        expect(readServiceSelfInfo(queue)?.handlerReady).toBe(false); // no HTTP surface for queue
        expect(readServiceSelfInfo(queue)?.message).toBeTruthy();
        expect(queue._serviceName).toBe('queue');
    });

    it('should publish and deliver to subscriber synchronously', async () => {
        const queue = createMemoryQueue();
        const received: any[] = [];
        await queue.subscribe('test-q', async (msg: any) => { received.push(msg); });
        const id = await queue.publish('test-q', { hello: 'world' });
        expect(id).toMatch(/^fallback-msg-/);
        expect(received).toHaveLength(1);
        expect(received[0].data).toEqual({ hello: 'world' });
    });

    it('should not deliver to unsubscribed queue', async () => {
        const queue = createMemoryQueue();
        const received: any[] = [];
        await queue.subscribe('q1', async (msg: any) => { received.push(msg); });
        await queue.unsubscribe('q1');
        await queue.publish('q1', 'data');
        expect(received).toHaveLength(0);
    });

    it('should return queue size of 0', async () => {
        const queue = createMemoryQueue();
        expect(await queue.getQueueSize()).toBe(0);
    });

    it('should purge a queue', async () => {
        const queue = createMemoryQueue();
        const received: any[] = [];
        await queue.subscribe('q1', async (msg: any) => { received.push(msg); });
        await queue.purge('q1');
        await queue.publish('q1', 'data');
        expect(received).toHaveLength(0);
    });
});

describe('createMemoryJob', () => {
    // [#4058] Self-describes with the STANDARD D12 descriptor. The old
    // `_fallback: true` marker was read by nothing, so discovery reported
    // this as fully `available` — the honesty gap D12 exists to close.
    it('self-describes as a degraded implementation, not a stub', () => {
        const job = createMemoryJob();
        expect(readServiceSelfInfo(job)?.status).toBe('degraded');
        expect(readServiceSelfInfo(job)?.handlerReady).toBe(false); // no HTTP surface for job
        expect(readServiceSelfInfo(job)?.message).toBeTruthy();
        expect(job._serviceName).toBe('job');
    });

    it('should schedule and list jobs', async () => {
        const job = createMemoryJob();
        await job.schedule('daily-report', '0 0 * * *', async () => {});
        expect(await job.listJobs()).toEqual(['daily-report']);
    });

    it('should cancel a job', async () => {
        const job = createMemoryJob();
        await job.schedule('temp-job', '* * * * *', async () => {});
        await job.cancel('temp-job');
        expect(await job.listJobs()).toEqual([]);
    });

    it('should trigger a job handler', async () => {
        const job = createMemoryJob();
        let triggered = false;
        await job.schedule('my-job', '* * * * *', async (ctx: any) => {
            triggered = true;
            expect(ctx.jobId).toBe('my-job');
            expect(ctx.data).toEqual({ key: 'val' });
        });
        await job.trigger('my-job', { key: 'val' });
        expect(triggered).toBe(true);
    });

    it('should return empty executions', async () => {
        const job = createMemoryJob();
        expect(await job.getExecutions()).toEqual([]);
    });
});

describe('createMemoryI18n', () => {
    // [#4058] Self-describes with the STANDARD D12 descriptor. The old
    // `_fallback: true` marker was read by nothing, so discovery reported
    // this as fully `available` — the honesty gap D12 exists to close.
    it('self-describes as a degraded implementation, not a stub', () => {
        const i18n = createMemoryI18n();
        expect(readServiceSelfInfo(i18n)?.status).toBe('degraded');
        expect(readServiceSelfInfo(i18n)?.handlerReady).toBe(true); // the dispatcher's /i18n domain serves it
        expect(readServiceSelfInfo(i18n)?.message).toBeTruthy();
        expect(i18n._serviceName).toBe('i18n');
    });

    it('should return the key when no translations are loaded', () => {
        const i18n = createMemoryI18n();
        expect(i18n.t('objects.account.label', 'en')).toBe('objects.account.label');
    });

    it('should translate after loading translations', () => {
        const i18n = createMemoryI18n();
        i18n.loadTranslations('en', { objects: { account: { label: 'Account' } } });
        expect(i18n.t('objects.account.label', 'en')).toBe('Account');
    });

    it('should interpolate parameters', () => {
        const i18n = createMemoryI18n();
        i18n.loadTranslations('en', { greeting: 'Hello, {{name}}!' });
        expect(i18n.t('greeting', 'en', { name: 'World' })).toBe('Hello, World!');
    });

    it('should fall back to default locale', () => {
        const i18n = createMemoryI18n();
        i18n.loadTranslations('en', { hello: 'Hello' });
        // 'fr' has no translations, should fall back to default 'en'
        expect(i18n.t('hello', 'fr')).toBe('Hello');
    });

    it('should get and set default locale', () => {
        const i18n = createMemoryI18n();
        expect(i18n.getDefaultLocale()).toBe('en');
        i18n.setDefaultLocale('zh-CN');
        expect(i18n.getDefaultLocale()).toBe('zh-CN');
    });

    it('should list loaded locales', () => {
        const i18n = createMemoryI18n();
        expect(i18n.getLocales()).toEqual([]);
        i18n.loadTranslations('en', { hello: 'Hello' });
        i18n.loadTranslations('zh-CN', { hello: '你好' });
        expect(i18n.getLocales()).toEqual(['en', 'zh-CN']);
    });

    it('should get all translations for a locale', () => {
        const i18n = createMemoryI18n();
        i18n.loadTranslations('en', { hello: 'Hello', bye: 'Goodbye' });
        expect(i18n.getTranslations('en')).toEqual({ hello: 'Hello', bye: 'Goodbye' });
    });

    it('should return empty object for unknown locale', () => {
        const i18n = createMemoryI18n();
        expect(i18n.getTranslations('unknown')).toEqual({});
    });

    it('should merge translations on subsequent loads', () => {
        const i18n = createMemoryI18n();
        i18n.loadTranslations('en', { hello: 'Hello' });
        i18n.loadTranslations('en', { bye: 'Goodbye' });
        expect(i18n.getTranslations('en')).toEqual({ hello: 'Hello', bye: 'Goodbye' });
    });
});

describe('resolveLocale', () => {
    it('should return exact match', () => {
        expect(resolveLocale('zh-CN', ['en', 'zh-CN', 'ja'])).toBe('zh-CN');
    });

    it('should return case-insensitive match', () => {
        expect(resolveLocale('zh-cn', ['en', 'zh-CN'])).toBe('zh-CN');
        expect(resolveLocale('EN-US', ['en-US', 'zh-CN'])).toBe('en-US');
    });

    it('should return base language match', () => {
        expect(resolveLocale('zh-TW', ['en', 'zh'])).toBe('zh');
    });

    it('should return variant expansion (zh → zh-CN)', () => {
        expect(resolveLocale('zh', ['en', 'zh-CN', 'zh-TW'])).toBe('zh-CN');
    });

    it('should return undefined for no match', () => {
        expect(resolveLocale('fr', ['en', 'zh-CN'])).toBeUndefined();
    });

    it('should return undefined for empty available locales', () => {
        expect(resolveLocale('en', [])).toBeUndefined();
    });

    it('should handle es → es-ES expansion', () => {
        expect(resolveLocale('es', ['en', 'es-ES', 'fr'])).toBe('es-ES');
    });
});

describe('createMemoryI18n locale fallback', () => {
    it('should resolve translations via locale fallback (zh → zh-CN)', () => {
        const i18n = createMemoryI18n();
        i18n.loadTranslations('zh-CN', { hello: '你好' });
        expect(i18n.getTranslations('zh')).toEqual({ hello: '你好' });
    });

    it('should resolve translations via case-insensitive fallback (zh-cn → zh-CN)', () => {
        const i18n = createMemoryI18n();
        i18n.loadTranslations('zh-CN', { hello: '你好' });
        expect(i18n.getTranslations('zh-cn')).toEqual({ hello: '你好' });
    });

    it('should translate via locale fallback (zh → zh-CN)', () => {
        const i18n = createMemoryI18n();
        i18n.loadTranslations('zh-CN', { greeting: '你好世界' });
        expect(i18n.t('greeting', 'zh')).toBe('你好世界');
    });

    it('should still fall back to default locale when no locale match at all', () => {
        const i18n = createMemoryI18n();
        i18n.loadTranslations('en', { hello: 'Hello' });
        expect(i18n.t('hello', 'ja')).toBe('Hello');
    });
});
