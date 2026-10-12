import { defineConfig } from 'vitest/config';

// `pnpm test` runs every `*.test.ts` in this project. A test that boots the
// app (see note.test.ts) runs the real engine in this process, so two settings
// differ from vitest's defaults.
export default defineConfig({
  test: {
    // Booting the stack takes a few seconds, longer on a busy CI runner, and
    // the boot runs in a `beforeAll` hook: allow it more than the default 10s.
    hookTimeout: 60_000,
    // The stack logs while it boots and while it shuts down. A log line that
    // arrives while vitest is closing a test worker can fail a run in which
    // every test passed. Printing logs straight to the terminal, instead of
    // through vitest's console capture, removes that failure.
    disableConsoleIntercept: true,
    // At its default level the engine logs one `[Registry]` line for every
    // item it registers while booting, over a hundred for this starter alone.
    // `warn` keeps the engine's warnings and errors and drops that chatter.
    env: { OS_REGISTRY_LOG: 'warn' },
  },
});
