// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { readCompiledPluginManifest, COMPILED_PLUGIN_MANIFEST_FILE } from './compiled-plugin-manifest.js';

const authored = {
  id: 'com.acme.demo', name: 'Demo', version: '1.2.0', type: 'plugin',
  runtime: 'sandbox', packaging: 'bundled', main: 'dist/index.mjs',
};

function entry(text: string) {
  return [{ path: COMPILED_PLUGIN_MANIFEST_FILE, data: new Uint8Array(Buffer.from(text)) }];
}

describe('readCompiledPluginManifest', () => {
  it('answers the document it decoded beside the parsed manifest, without the defaults the parse stamps', () => {
    const text = JSON.stringify(authored, null, 2);
    const read = readCompiledPluginManifest(entry(text));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    // The parse stamps `scope` / `defaultDatasource`; the document does not.
    expect(read.manifest).toHaveProperty('scope');
    expect(read.document).not.toHaveProperty('scope');
    expect(read.document).not.toHaveProperty('defaultDatasource');
    // Key for key and in the entry's own order.
    expect(JSON.stringify(read.document)).toBe(JSON.stringify(JSON.parse(text)));
  });

  it('refuses a missing entry or a non-object document as unreadable', () => {
    expect(readCompiledPluginManifest([])).toMatchObject({ ok: false, reason: 'unreadable' });
    expect(readCompiledPluginManifest(entry('[1,2]'))).toMatchObject({ ok: false, reason: 'unreadable' });
  });
});
