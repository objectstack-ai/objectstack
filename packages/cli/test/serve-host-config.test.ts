import { describe, it, expect } from 'vitest';
import { isHostConfig } from '../src/utils/plugin-detection';

/**
 * Tests for the host config detection logic used in serve.ts
 *
 * When the root config is a host/aggregator (i.e. its `plugins` array
 * contains already-instantiated Plugin objects), the CLI must NOT wrap
 * it again with AppPlugin, as that would cause duplicate registration
 * and a `plugin.app.<id> failed to start` error.
 */
describe('Host config detection', () => {

  it('should detect host config with instantiated plugins', () => {
    const config = {
      manifest: { id: 'com.example.dev-workspace', name: 'dev_workspace' },
      plugins: [
        { name: 'objectql', init: async () => {}, start: async () => {} },
        { name: 'driver', init: async () => {}, start: async () => {} },
      ],
    };
    expect(isHostConfig(config)).toBe(true);
  });

  it('should NOT detect pure app bundle config (no plugins)', () => {
    const config = {
      manifest: { id: 'com.example.my-app', name: 'my_app' },
      objects: [{ name: 'task', fields: [] }],
    };
    expect(isHostConfig(config)).toBe(false);
  });

  it('should NOT detect config with empty plugins array', () => {
    const config = {
      manifest: { id: 'com.example.my-app', name: 'my_app' },
      objects: [{ name: 'task', fields: [] }],
      plugins: [],
    };
    expect(isHostConfig(config)).toBe(false);
  });

  it('should NOT detect config with string plugin references', () => {
    const config = {
      manifest: { id: 'com.example.my-app', name: 'my_app' },
      plugins: ['@objectstack/plugin-auth', '@objectstack/objectql'],
    };
    expect(isHostConfig(config)).toBe(false);
  });

  it('should NOT detect config with plain object plugins (no init method)', () => {
    const config = {
      manifest: { id: 'com.example.my-app', name: 'my_app' },
      plugins: [
        { name: 'some-plugin', version: '1.0.0' },
      ],
    };
    expect(isHostConfig(config)).toBe(false);
  });

  it('should detect if at least one plugin has init method', () => {
    const config = {
      manifest: { id: 'com.example.dev-workspace' },
      plugins: [
        { name: 'plain-bundle', version: '1.0.0' },
        { name: 'real-plugin', init: async () => {}, start: async () => {} },
      ],
    };
    expect(isHostConfig(config)).toBe(true);
  });

  it('should handle config without plugins property', () => {
    const config = {
      manifest: { id: 'com.example.my-app', name: 'my_app' },
    };
    expect(isHostConfig(config)).toBe(false);
  });
});
