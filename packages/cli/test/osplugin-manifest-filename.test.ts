// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The compiled manifest's filename has ONE spelling (#28080): the CLI's
 * `MANIFEST_FILENAME` (the entry `os plugin build` writes, the entry publish
 * and install exempt from the integrity map) is the runtime's
 * `COMPILED_PLUGIN_MANIFEST_FILE` (the entry `readCompiledPluginManifest`
 * finds), not a hand-kept twin of it.
 */

import { describe, it, expect } from 'vitest';
import { readCompiledPluginManifest } from '@objectstack/runtime';
import { COMPILED_PLUGIN_MANIFEST_FILE } from '@objectstack/runtime/compiled-plugin-manifest-file';
import { MANIFEST_FILENAME, computeIntegrity } from '../src/utils/osplugin.js';

describe('the compiled manifest filename', () => {
  it("is the runtime's constant", () => {
    expect(MANIFEST_FILENAME).toBe(COMPILED_PLUGIN_MANIFEST_FILE);
  });

  it("names the entry the runtime's reader finds, and the entry the integrity map leaves out", () => {
    const manifest = {
      id: 'com.acme.demo', name: 'Demo', version: '1.2.0', type: 'plugin',
      runtime: 'sandbox', packaging: 'bundled', main: 'dist/index.mjs',
    };
    const files = [
      { path: 'dist/index.mjs', data: new Uint8Array(Buffer.from('export const x = 1;\n')) },
      { path: MANIFEST_FILENAME, data: new Uint8Array(Buffer.from(JSON.stringify(manifest))) },
    ];
    expect(readCompiledPluginManifest(files).ok).toBe(true);
    expect(Object.keys(computeIntegrity(files))).toEqual(['dist/index.mjs']);
  });
});
