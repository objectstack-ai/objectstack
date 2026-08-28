import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Exclude integration tests that require a running server
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'tests/integration/**',
    ],
    environment: 'node',
  },
  resolve: {
    // [#12181] Both entries exist for `meta-delete-item-carriers.test.ts`, the
    // suite here that drives the REAL reset door: it boots
    // `ObjectStackProtocolImplementation` and registers the real
    // `sys_metadata*` object definitions, so it imports two sibling packages as
    // VALUES.
    //
    // Unaliased, those specifiers resolve through the workspace link to
    // `dist/` — a BUILD ARTIFACT — which would make this suite's verdict a
    // function of build state rather than of the source in the checkout. The
    // loud failure (a missing export) is the mild half; a dist merely BEHIND
    // lets the suite run GREEN against the producer's old behaviour with
    // nothing in the output saying so, and this suite's whole job is to assert
    // what the door and the protocol do with a carrier the client now sends.
    // `pnpm check:test-source-alias` refuses exactly that.
    //
    // Array form with anchored patterns, deliberately: the object form matches
    // by PREFIX, so a bare key with a FILE replacement would also swallow any
    // subpath and resolve it to `…/src/index.ts/<subpath>` (ENOTDIR) at run
    // time, in a config that looks right.
    alias: [
      {
        find: /^@objectstack\/metadata-core$/,
        replacement: path.resolve(__dirname, '../metadata-core/src/index.ts'),
      },
      {
        find: /^@objectstack\/metadata-protocol$/,
        replacement: path.resolve(__dirname, '../metadata-protocol/src/index.ts'),
      },
    ],
  },
});
