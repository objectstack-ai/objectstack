// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5517] The binary-dependent suites are OPT-IN, and the gate is checked before
 * anything can start a download.
 *
 * This is the suite that survives the retirement, so it has to pin the two
 * properties the retirement is worth anything for:
 *
 *   1. **Nothing is even imported when the gate is closed.** A `describe.skipIf`
 *      alone would not have been enough: the download starts at MODULE LOAD, so
 *      a gate evaluated after `import { MongoMemoryServer } from …` would skip
 *      the tests and still fetch 123 MB. The mock factory below counts library
 *      evaluations, so re-adding a static value import to `test-mongod.ts` turns
 *      the first test red.
 *   2. **The abandoned-download rejection is swallowed, and only it.** The
 *      guard's listener suppresses vitest's own unhandled-rejection reporting for
 *      the whole worker (vitest steps aside when a second listener exists), so a
 *      guard that swallowed indiscriminately would hide real failures. The
 *      re-raise path is asserted, not assumed.
 *
 * Test ORDER matters in the first three cases: case 1 asserts the library has
 * never been evaluated, and case 3 is what evaluates it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Counts evaluations of `mongodb-memory-server` and lets a case choose what `create()` does. */
const lib = vi.hoisted(() => ({
  imported: 0,
  create: undefined as undefined | (() => Promise<unknown>),
}));

vi.mock('mongodb-memory-server', () => {
  lib.imported++;
  return {
    MongoMemoryServer: {
      create: () => {
        if (!lib.create) throw new Error('no create() behaviour was configured by this test');
        return lib.create();
      },
    },
  };
});

import {
  MONGOD_TESTS_ENV,
  createTestMongod,
  disposeAbandonedDownloadGuard,
  installAbandonedDownloadGuard,
  isAbandonedDownloadRejection,
  mongodSkipReason,
  mongodTestsEnabled,
  printMongodNotice,
} from './test-mongod.js';

/** The exact shape `fs.promises.rename` throws at MongoBinaryDownload.js:413. */
function renameEnoent(
  path = '/home/runner/.cache/mongodb-binaries/mongodb-linux-x86_64-ubuntu2404-8.2.6.tgz.downloading',
): Error {
  return Object.assign(
    new Error(`ENOENT: no such file or directory, rename '${path}' -> '${path.slice(0, -12)}'`),
    { code: 'ENOENT', syscall: 'rename', errno: -2, path, dest: path.slice(0, -12) },
  );
}

describe('[#5517] the mongod opt-in gate', () => {
  let warnings: string[];

  beforeEach(() => {
    warnings = [];
    // The notices go to stderr, NOT through `console` — vitest's default reporter
    // renders nothing a passing/skipped file logs via `console`, which would make
    // the skip silent in exactly the runs that matter. `printMongodNotice`
    // documents the measurement.
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      warnings.push(String(chunk).trimEnd());
      return true;
    });
    delete process.env[MONGOD_TESTS_ENV];
    lib.create = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env[MONGOD_TESTS_ENV];
    // Cases that open the gate install the guard on the REAL process. Leaving it
    // behind would make vitest defer its own unhandled-rejection reporting for
    // every later file in this worker.
    disposeAbandonedDownloadGuard();
  });

  it('skips without touching the library at all when the switch is unset', async () => {
    expect(mongodTestsEnabled()).toBe(false);

    const mongod = await createTestMongod('gate probe');

    expect(mongod).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('#5517');
    expect(warnings[0]).toContain(MONGOD_TESTS_ENV);
    expect(warnings[0]).toContain('SKIP gate probe');
    // The property that makes the skip cost nothing: the module that would
    // download the binary was never evaluated.
    expect(lib.imported).toBe(0);
  });

  it('treats a set-but-not-"1" value as OFF and says so instead of skipping quietly', async () => {
    process.env[MONGOD_TESTS_ENV] = 'true';

    const mongod = await createTestMongod('gate probe');

    expect(mongod).toBeUndefined();
    expect(lib.imported).toBe(0);
    expect(warnings[0]).toContain('is set to "true", which does NOT enable it');
    expect(mongodSkipReason('x', { [MONGOD_TESTS_ENV]: '' })).not.toContain('does NOT enable it');
  });

  it('imports the library and returns a server once the switch is on', async () => {
    process.env[MONGOD_TESTS_ENV] = '1';
    const stub = { getUri: () => 'mongodb://stub', stop: async () => {} };
    lib.create = async () => stub;

    const mongod = await createTestMongod('gate probe');

    expect(mongod).toBe(stub);
    expect(lib.imported).toBe(1);
    expect(warnings).toEqual([]);
  });

  it('still degrades to a named skip when an opted-in acquisition fails', async () => {
    process.env[MONGOD_TESTS_ENV] = '1';
    lib.create = async () => {
      throw renameEnoent();
    };

    const mongod = await createTestMongod('gate probe');

    expect(mongod).toBeUndefined();
    expect(warnings[0]).toContain('SKIP gate probe');
    expect(warnings[0]).toContain('could not start');
  });

  it('prints on stderr, not through the console vitest silences on a green run', () => {
    const sink: string[] = [];
    printMongodNotice('injected', (chunk) => sink.push(chunk));
    expect(sink).toEqual(['injected\n']);

    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    printMongodNotice('default sink');
    expect(warnings).toContain('default sink');
    expect(consoleWarn).not.toHaveBeenCalled();
  });
});

describe('[#5517] the abandoned-download rejection guard', () => {
  it('recognises the rename ENOENT of a lost download race', () => {
    expect(isAbandonedDownloadRejection(renameEnoent())).toBe(true);
  });

  it('does not recognise anything else', () => {
    expect(isAbandonedDownloadRejection(undefined)).toBe(false);
    expect(isAbandonedDownloadRejection(null)).toBe(false);
    expect(isAbandonedDownloadRejection('ENOENT: rename')).toBe(false);
    expect(isAbandonedDownloadRejection(new Error('boom'))).toBe(false);
    // Right code and syscall, but a real file rather than a download temp file.
    expect(
      isAbandonedDownloadRejection(
        Object.assign(new Error('x'), { code: 'ENOENT', syscall: 'rename', path: '/tmp/a.json' }),
      ),
    ).toBe(false);
    // A different syscall on the download temp file is somebody else's bug.
    expect(
      isAbandonedDownloadRejection(
        Object.assign(new Error('x'), { code: 'ENOENT', syscall: 'unlink', path: '/c/x.tgz.downloading' }),
      ),
    ).toBe(false);
  });

  it('swallows the abandoned download and re-raises every other rejection', () => {
    const listeners: ((reason: unknown) => void)[] = [];
    const host = {
      on: (_event: 'unhandledRejection', listener: (reason: unknown) => void) => {
        listeners.push(listener);
      },
      off: (_event: 'unhandledRejection', listener: (reason: unknown) => void) => {
        listeners.splice(listeners.indexOf(listener), 1);
      },
    };
    const reraised: unknown[] = [];
    const warned: string[] = [];

    installAbandonedDownloadGuard({
      host,
      reraise: (reason) => reraised.push(reason),
      warn: (message) => warned.push(message),
    });
    // One suite per worker installs it; the rest must not stack listeners.
    installAbandonedDownloadGuard({ host, reraise: () => {}, warn: () => {} });
    expect(listeners).toHaveLength(1);

    listeners[0](renameEnoent());
    expect(reraised).toEqual([]);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('#5517');

    const real = new Error('a genuine unhandled rejection');
    listeners[0](real);
    // Vitest has stepped aside because this listener exists, so the guard owes
    // the run a failure for anything it does not recognise.
    expect(reraised).toEqual([real]);
    expect(warned).toHaveLength(1);

    disposeAbandonedDownloadGuard();
    expect(listeners).toHaveLength(0);
  });
});
