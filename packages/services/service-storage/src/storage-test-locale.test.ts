// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30335] Setup → Storage → 测试连接 answers in the caller's language.
 *
 * The console prints the `storage/test` action's `message` as the toast, bare.
 * The settings action route hands the handler the caller's display language as
 * the input's `locale` (`Accept-Language`, else `?locale`), the same source the
 * mail test notice reads. These pins run the REAL handler the plugin registers,
 * on a real local adapter, with that input member set or absent.
 *
 * `ok`, `severity`, the adapter name and the probe's cleanup are not the
 * subject: each case asserts the first two are what they were, so a
 * translation can never have moved a verdict.
 */

import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageServicePlugin } from './storage-service-plugin.js';
import { LocalStorageAdapter } from './local-storage-adapter.js';
import { storageTestCopy, STORAGE_TEST_COPY } from './storage-test-copy.js';

function makeCtx() {
  const services = new Map<string, unknown>();
  const hooks: Array<() => Promise<void> | void> = [];
  const ctx: any = {
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    registerService: (name: string, svc: unknown) => { services.set(name, svc); },
    getService: <T>(name: string): T => {
      const s = services.get(name);
      if (!s) throw new Error(`service '${name}' not registered`);
      return s as T;
    },
    hook: (event: string, fn: () => Promise<void> | void) => {
      if (event === 'kernel:ready') hooks.push(fn);
    },
    _flushReady: async () => { for (const h of hooks) await h(); },
  };
  return ctx;
}

/** A settings host that keeps the registered action so a test can run it. */
function makeSettingsHost() {
  const actions = new Map<string, (input: unknown) => Promise<any>>();
  return {
    createClient: (_ns: string) => ({}),
    getNamespace: async (_ns: string) => ({ values: {} }),
    subscribe: (_ns: string, _fn: () => void) => {},
    registerAction: (ns: string, id: string, fn: (input: unknown) => Promise<any>) => {
      actions.set(`${ns}/${id}`, fn);
    },
    run: async (input: Record<string, unknown>) => {
      const fn = actions.get('storage/test');
      if (!fn) throw new Error('storage/test was not registered');
      return await fn({ namespace: 'storage', actionId: 'test', ctx: {}, ...input });
    },
  };
}

async function bootPlugin() {
  const root = await fs.mkdtemp(join(tmpdir(), 'oss-30335-'));
  const plugin = new StorageServicePlugin({ adapter: 'local', local: { rootDir: root }, registerRoutes: false });
  const ctx = makeCtx();
  const settings = makeSettingsHost();
  ctx.registerService('settings', settings);
  await plugin.init(ctx);
  await plugin.start(ctx);
  await ctx._flushReady();
  return { root, settings, plugin };
}

/** The local adapter with a download that answers bytes other than the ones uploaded. */
function corruptDownloads(): () => void {
  const original = LocalStorageAdapter.prototype.download;
  LocalStorageAdapter.prototype.download = async function (this: LocalStorageAdapter, key: string) {
    void key;
    return Buffer.from('not the probe', 'utf-8');
  } as typeof original;
  return () => { LocalStorageAdapter.prototype.download = original; };
}

describe('[#30335] storage/test answers in the caller\'s language', () => {
  it('zh-CN: the success sentence is Chinese and names the adapter; the verdict is unchanged', async () => {
    const { root, settings } = await bootPlugin();
    const result = await settings.run({ values: { adapter: 'local', local_root: root }, locale: 'zh-CN' });
    expect(result.ok).toBe(true);
    expect(result.severity).toBe('info');
    expect(result.message).toBe('存储连接测试成功（适配器：local）。');
    expect(result.message).not.toContain('round-trip');
  });

  it('en: the success sentence is the English one the console showed before', async () => {
    const { root, settings } = await bootPlugin();
    const result = await settings.run({ values: { adapter: 'local', local_root: root }, locale: 'en-US' });
    expect(result.ok).toBe(true);
    expect(result.severity).toBe('info');
    expect(result.message).toBe('Storage round-trip succeeded (adapter=local).');
  });

  it('no locale, or one with no copy: English, exactly as an older settings host gets it', async () => {
    const { root, settings } = await bootPlugin();
    const values = { adapter: 'local', local_root: root };
    for (const input of [{ values }, { values, locale: 'fr-FR' }, { values, locale: '' }]) {
      const result = await settings.run(input);
      expect(result.ok).toBe(true);
      expect(result.severity).toBe('info');
      expect(result.message).toBe('Storage round-trip succeeded (adapter=local).');
    }
  });

  it('a language tag without the region still picks its copy (zh → zh-CN)', async () => {
    const { root, settings } = await bootPlugin();
    const result = await settings.run({ values: { adapter: 'local', local_root: root }, locale: 'zh' });
    expect(result.message).toBe('存储连接测试成功（适配器：local）。');
  });

  it('zh-CN: a download that does not match the upload is refused in Chinese', async () => {
    const { root, settings } = await bootPlugin();
    const restore = corruptDownloads();
    try {
      const result = await settings.run({ values: { adapter: 'local', local_root: root }, locale: 'zh-CN' });
      expect(result.ok).toBe(false);
      expect(result.severity).toBe('error');
      expect(result.message).toBe('探测文件下载后的内容与上传的不一致。');
    } finally {
      restore();
    }
    // The probe object is still removed on this path (#13726).
    const left = await fs.readdir(join(root, '__objectstack_probe__')).catch(() => []);
    expect(left).toEqual([]);
  });

  it('zh-CN: incomplete S3 settings are refused in Chinese, naming the two fields', async () => {
    const { settings } = await bootPlugin();
    const result = await settings.run({ values: { adapter: 's3', s3_bucket: '', s3_region: '' }, locale: 'zh-CN' });
    expect(result.ok).toBe(false);
    expect(result.severity).toBe('error');
    expect(result.message).toBe('S3 适配器需要填写存储桶（s3_bucket）和区域（s3_region）。');
  });

  it('no locale: incomplete S3 settings keep the English refusal', async () => {
    const { settings } = await bootPlugin();
    const result = await settings.run({ values: { adapter: 's3', s3_bucket: '', s3_region: '' } });
    expect(result.ok).toBe(false);
    expect(result.message).toBe('StorageServicePlugin: S3 adapter requires s3_bucket and s3_region');
  });

  it('zh-CN: the adapter\'s own error text stays verbatim behind a Chinese lead-in', async () => {
    const { settings } = await bootPlugin();
    // A root the process cannot create: a path under a regular FILE.
    const file = join(await fs.mkdtemp(join(tmpdir(), 'oss-30335-file-')), 'not-a-dir');
    await fs.writeFile(file, 'x');
    const zh = await settings.run({ values: { adapter: 'local', local_root: join(file, 'root') }, locale: 'zh-CN' });
    const en = await settings.run({ values: { adapter: 'local', local_root: join(file, 'root') } });
    expect(zh.ok).toBe(false);
    expect(zh.severity).toBe('error');
    expect(en.ok).toBe(false);
    // English stays the adapter's sentence alone; Chinese is lead-in + that same sentence.
    expect(en.message.length).toBeGreaterThan(0);
    expect(zh.message).toBe(`存储连接测试失败：${en.message}`);
  });
});

describe('[#30335] the storage/test copy table', () => {
  it('serves every locale the package\'s translations serve, each with every sentence', () => {
    expect(Object.keys(STORAGE_TEST_COPY).sort()).toEqual(['en', 'es-ES', 'ja-JP', 'zh-CN']);
    for (const locale of Object.keys(STORAGE_TEST_COPY)) {
      const copy = storageTestCopy(locale);
      expect(copy.succeeded('s3')).toContain('s3');
      expect(copy.downloadMismatch.length).toBeGreaterThan(0);
      expect(copy.s3SettingsIncomplete).toContain('s3_bucket');
      expect(copy.s3SettingsIncomplete).toContain('s3_region');
      expect(copy.failed('EACCES')).toContain('EACCES');
    }
  });
});
