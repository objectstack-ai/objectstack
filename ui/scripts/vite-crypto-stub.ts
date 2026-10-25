import type { Plugin } from 'vite';

/**
 * Vite plugin that stubs the Node.js `crypto` module for browser builds.
 *
 * @objectstack/core statically imports `createHash` from `crypto` for plugin
 * hashing. The code already has a browser fallback, so we provide a no-op stub
 * instead of marking it as external (which emits a bare `import 'crypto'` that
 * browsers reject, causing a blank page).
 *
 * Must use `enforce: 'pre'` so it runs before Vite's built-in
 * browser-external resolve.
 */
export function viteCryptoStub(): Plugin {
  return {
    name: 'stub-crypto',
    enforce: 'pre',
    resolveId(id: string) {
      if (id === 'crypto') return '\0crypto-stub';
    },
    load(id: string) {
      if (id === '\0crypto-stub') {
        return [
          'export function createHash() { return { update() { return this; }, digest() { return ""; } }; }',
          'export function createVerify() { return { update() { return this; }, end() {}, verify() { return false; } }; }',
          'export default {};',
        ].join('\n');
      }
    },
  };
}
