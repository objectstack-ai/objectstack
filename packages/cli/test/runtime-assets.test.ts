// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * createRuntimeAssetsPlugin() — serves /runtime/assets/* unconditionally.
 *
 * The route must resolve even when the Console dist isn't built — unlike
 * the rest of createConsoleStaticPlugin which early-returns when
 * dist/index.html is missing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntimeAssetsPlugin } from '../src/utils/console.js';

const assetsDir = path.join(os.tmpdir(), `os-test-runtime-assets-${Date.now()}`);
const testPng = path.join(assetsDir, 'test-logo.png');

beforeAll(() => {
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(testPng, Buffer.from('fake-png-content'));
});

afterAll(() => {
  fs.rmSync(assetsDir, { recursive: true, force: true });
});

describe('createRuntimeAssetsPlugin', () => {
  it('returns a plugin object with name, init, and start', () => {
    const plugin = createRuntimeAssetsPlugin(assetsDir);
    expect(plugin).toHaveProperty('name', 'com.objectstack.runtime-assets');
    expect(plugin).toHaveProperty('init');
    expect(plugin).toHaveProperty('start');
  });

  it('skips registration when assets dir does not exist', async () => {
    const noopPlugin = createRuntimeAssetsPlugin('/nonexistent/dir');
    const ctx = {
      getService: () => ({
        getRawApp: () => ({
          get: () => { throw new Error('should not be called'); },
        }),
      }),
    };
    // Should not throw when dir doesn't exist — silently skips.
    await expect(noopPlugin.start(ctx as any)).resolves.toBeUndefined();
  });

  it('skips registration when http server service is missing', async () => {
    const plugin = createRuntimeAssetsPlugin(assetsDir);
    const ctx = { getService: () => null };
    await expect(plugin.start(ctx as any)).resolves.toBeUndefined();
  });
});
