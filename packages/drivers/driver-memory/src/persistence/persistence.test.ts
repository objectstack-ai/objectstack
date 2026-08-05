import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InMemoryDriver } from '../memory-driver.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

const TEST_DATA_DIR = path.join('/tmp', 'objectstack-test-persistence');
const TEST_FILE_PATH = path.join(TEST_DATA_DIR, 'test-db.json');

/**
 * Run `fn` with the process CWD moved to a scratch dir, then restore it.
 *
 * The shorthand forms (`persistence: 'file'` / `'auto'`) deliberately take the
 * adapter's DEFAULT path, which is `.objectstack/data/memory-driver.json`
 * *relative to the CWD* — so without this the suite wrote that file into
 * `packages/drivers/driver-memory/` and the next run loaded it back. A unit
 * test must not have write side effects on the package directory (#4065).
 */
async function inScratchCwd(fn: () => Promise<void>): Promise<void> {
  const prev = process.cwd();
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  process.chdir(TEST_DATA_DIR);
  try {
    await fn();
  } finally {
    process.chdir(prev);
  }
}

describe('InMemoryDriver Persistence', () => {
  beforeEach(() => {
    // Clean up test directory
    if (fs.existsSync(TEST_DATA_DIR)) {
      fs.rmSync(TEST_DATA_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DATA_DIR)) {
      fs.rmSync(TEST_DATA_DIR, { recursive: true });
    }
  });

  describe('File Persistence', () => {
    it('should persist and restore data via file adapter', async () => {
      // Create and populate driver with file persistence
      const driver1 = new InMemoryDriver({
        persistence: { type: 'file', path: TEST_FILE_PATH, autoSaveInterval: 100 },
      });
      await driver1.connect();
      await driver1.create('users', { id: '1', name: 'Alice' });
      await driver1.create('users', { id: '2', name: 'Bob' });

      // Flush and disconnect
      await driver1.flush();
      await driver1.disconnect();

      // Verify file was created
      expect(fs.existsSync(TEST_FILE_PATH)).toBe(true);

      // Create a new driver and verify data is restored
      const driver2 = new InMemoryDriver({
        persistence: { type: 'file', path: TEST_FILE_PATH, autoSaveInterval: 100 },
      });
      await driver2.connect();

      const users = await driver2.find('users', { object: 'users' });
      expect(users).toHaveLength(2);
      expect(users[0].name).toBe('Alice');
      expect(users[1].name).toBe('Bob');

      await driver2.disconnect();
    });

    it('should support shorthand "file" persistence string', async () => {
      // Use shorthand — just verifies no error is thrown with 'file'.
      // Scratch CWD: the shorthand takes the adapter's default relative path.
      await inScratchCwd(async () => {
        const driver = new InMemoryDriver({ persistence: 'file' });
        await driver.connect();
        await driver.create('items', { id: '1', name: 'Widget' });
        await driver.disconnect();
      });
    });

    it('should persist updates and deletes', async () => {
      const driver1 = new InMemoryDriver({
        persistence: { type: 'file', path: TEST_FILE_PATH, autoSaveInterval: 100 },
      });
      await driver1.connect();

      // Create, update, and delete
      await driver1.create('tasks', { id: '1', title: 'Task A', done: false });
      await driver1.create('tasks', { id: '2', title: 'Task B', done: false });
      await driver1.update('tasks', '1', { done: true });
      await driver1.delete('tasks', '2');

      await driver1.flush();
      await driver1.disconnect();

      // Restore
      const driver2 = new InMemoryDriver({
        persistence: { type: 'file', path: TEST_FILE_PATH, autoSaveInterval: 100 },
      });
      await driver2.connect();

      const tasks = await driver2.find('tasks', { object: 'tasks' });
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('1');
      expect(tasks[0].done).toBe(true);

      await driver2.disconnect();
    });

    it('should handle missing persistence file gracefully', async () => {
      const driver = new InMemoryDriver({
        persistence: { type: 'file', path: '/tmp/nonexistent/path/db.json' },
      });
      await driver.connect();

      const users = await driver.find('users', { object: 'users' });
      expect(users).toHaveLength(0);

      await driver.disconnect();
    });
  });

  describe('Custom Adapter Persistence', () => {
    it('should use a custom adapter for persistence', async () => {
      const stored: Record<string, any[]> = {};
      const customAdapter = {
        load: async () => Object.keys(stored).length > 0 ? { ...stored } : null,
        save: async (db: Record<string, any[]>) => {
          for (const [k, v] of Object.entries(db)) {
            stored[k] = [...v];
          }
        },
        flush: async () => {},
      };

      const driver1 = new InMemoryDriver({
        persistence: { adapter: customAdapter },
      });
      await driver1.connect();
      await driver1.create('projects', { id: '1', name: 'Alpha' });
      await driver1.disconnect();

      // Verify data was saved via custom adapter
      expect(stored.projects).toBeDefined();
      expect(stored.projects).toHaveLength(1);

      // Restore from custom adapter
      const driver2 = new InMemoryDriver({
        persistence: { adapter: customAdapter },
      });
      await driver2.connect();
      const projects = await driver2.find('projects', { object: 'projects' });
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('Alpha');

      await driver2.disconnect();
    });
  });

  describe('Pure Memory (No Persistence)', () => {
    it('should work without persistence when explicitly disabled', async () => {
      const driver = new InMemoryDriver({ persistence: false });
      await driver.connect();

      await driver.create('items', { id: '1', name: 'Widget' });
      const items = await driver.find('items', { object: 'items' });
      expect(items).toHaveLength(1);

      await driver.disconnect();

      // After disconnect, data is gone
      const itemsAfter = await driver.find('items', { object: 'items' });
      expect(itemsAfter).toHaveLength(0);
    });
  });

  describe('Auto Persistence', () => {
    it('should auto-detect Node.js environment and use file persistence with shorthand', async () => {
      // In Node.js, 'auto' should select file persistence.
      // Scratch CWD: the shorthand takes the adapter's default relative path.
      await inScratchCwd(async () => {
        const driver = new InMemoryDriver({ persistence: 'auto' });
        await driver.connect();
        await driver.create('items', { id: '1', name: 'Widget' });
        await driver.disconnect();
        expect(fs.existsSync(path.join('.objectstack', 'data', 'memory-driver.json'))).toBe(true);
      });
    });

    it('should auto-detect Node.js environment and use file persistence with object config', async () => {
      const filePath = path.join(TEST_DATA_DIR, 'auto-test-db.json');
      const driver1 = new InMemoryDriver({
        persistence: { type: 'auto', path: filePath, autoSaveInterval: 100 },
      });
      await driver1.connect();
      await driver1.create('users', { id: '1', name: 'Alice' });
      await driver1.flush();
      await driver1.disconnect();

      // Verify file was created (Node.js env selects file adapter)
      expect(fs.existsSync(filePath)).toBe(true);

      // Restore from file
      const driver2 = new InMemoryDriver({
        persistence: { type: 'auto', path: filePath, autoSaveInterval: 100 },
      });
      await driver2.connect();
      const users = await driver2.find('users', { object: 'users' });
      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('Alice');
      await driver2.disconnect();
    });
  });

  describe('Bulk Operations with Persistence', () => {
    it('should persist bulk creates', async () => {
      const driver1 = new InMemoryDriver({
        persistence: { type: 'file', path: TEST_FILE_PATH, autoSaveInterval: 100 },
      });
      await driver1.connect();
      await driver1.bulkCreate('items', [
        { id: '1', name: 'A' },
        { id: '2', name: 'B' },
        { id: '3', name: 'C' },
      ]);
      await driver1.flush();
      await driver1.disconnect();

      const driver2 = new InMemoryDriver({
        persistence: { type: 'file', path: TEST_FILE_PATH, autoSaveInterval: 100 },
      });
      await driver2.connect();
      const items = await driver2.find('items', { object: 'items' });
      expect(items).toHaveLength(3);
      await driver2.disconnect();
    });
  });

  // The default is the whole bug in #4065, and nothing pinned it — every test
  // in this file passes `persistence` explicitly, so the driver was free to
  // drift from #815's requirement #1 ("默认情况下不启用持久化（纯内存，行为不变）")
  // to a silent `'auto'` → file write without a single assertion turning red.
  describe('Default persistence (opt-in)', () => {
    it('writes nothing to the CWD when persistence is not configured', async () => {
      await inScratchCwd(async () => {
        const driver = new InMemoryDriver();
        await driver.connect();
        await driver.create('items', { id: 'a', name: 'Widget' });
        await driver.disconnect();
        // The path the file adapter defaults to, relative to the CWD.
        expect(fs.existsSync(path.join('.objectstack', 'data', 'memory-driver.json'))).toBe(false);
      });
    });

    it('does not carry rows across driver instances (the #4065 rerun shape)', async () => {
      await inScratchCwd(async () => {
        // Two instances seeded with the SAME fixed ids, exactly as a suite that
        // runs twice in one working tree does. Under the old `'auto'` default
        // the second instance loaded the first's rows and `find` returned four.
        for (const _run of [1, 2]) {
          const driver = new InMemoryDriver();
          await driver.connect();
          await driver.bulkCreate('ext_note', [
            { id: 'n1', title: 'first' },
            { id: 'n2', title: 'second' },
          ]);
          const rows = await driver.find('ext_note', { object: 'ext_note' });
          expect(rows.map((r: any) => r.title).sort()).toEqual(['first', 'second']);
          await driver.disconnect();
        }
      });
    });

    it('still persists when a host opts in explicitly', async () => {
      const filePath = path.join(TEST_DATA_DIR, 'opt-in.json');
      const driver = new InMemoryDriver({
        persistence: { type: 'file', path: filePath, autoSaveInterval: 100 },
      });
      await driver.connect();
      await driver.create('items', { id: 'a', name: 'Widget' });
      await driver.disconnect();
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  describe('Serverless Environment Detection', () => {
    const serverlessEnvVars = [
      'VERCEL',
      'VERCEL_ENV',
      'AWS_LAMBDA_FUNCTION_NAME',
      'NETLIFY',
      'FUNCTIONS_WORKER_RUNTIME',
      'K_SERVICE',
      'FUNCTION_TARGET',
      'DENO_DEPLOYMENT_ID',
    ];

    afterEach(() => {
      // Clean up all serverless env vars after each test
      for (const key of serverlessEnvVars) {
        delete process.env[key];
      }
    });

    it('should disable file persistence in auto mode when VERCEL env is set', async () => {
      process.env.VERCEL = '1';
      const filePath = path.join(TEST_DATA_DIR, 'serverless-test.json');
      const driver = new InMemoryDriver({
        persistence: { type: 'auto', path: filePath },
      });
      await driver.connect();
      await driver.create('items', { id: '1', name: 'Widget' });
      await driver.flush();
      await driver.disconnect();

      // File should NOT have been created because auto mode skips file persistence in serverless
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('should disable file persistence in auto shorthand mode when AWS_LAMBDA_FUNCTION_NAME is set', async () => {
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'my-function';
      const driver = new InMemoryDriver({ persistence: 'auto' });
      await driver.connect();
      await driver.create('items', { id: '1', name: 'Widget' });

      // Should work as pure in-memory without errors
      const items = await driver.find('items', { object: 'items' });
      expect(items).toHaveLength(1);

      await driver.disconnect();
    });

    it('should still allow explicit file persistence in serverless if user requests it', async () => {
      process.env.VERCEL = '1';
      const filePath = path.join(TEST_DATA_DIR, 'explicit-file-serverless.json');
      const driver = new InMemoryDriver({
        persistence: { type: 'file', path: filePath, autoSaveInterval: 100 },
      });
      await driver.connect();
      await driver.create('items', { id: '1', name: 'Widget' });
      await driver.flush();
      await driver.disconnect();

      // Explicit 'file' type should still create the file even in serverless
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('should still allow custom adapter in serverless', async () => {
      process.env.NETLIFY = 'true';
      const stored: Record<string, any[]> = {};
      const customAdapter = {
        load: async () => Object.keys(stored).length > 0 ? { ...stored } : null,
        save: async (db: Record<string, any[]>) => {
          for (const [k, v] of Object.entries(db)) { stored[k] = [...v]; }
        },
        flush: async () => {},
      };

      const driver = new InMemoryDriver({ persistence: { adapter: customAdapter } });
      await driver.connect();
      await driver.create('items', { id: '1', name: 'Widget' });
      await driver.disconnect();

      expect(stored.items).toBeDefined();
      expect(stored.items).toHaveLength(1);
    });
  });
});
