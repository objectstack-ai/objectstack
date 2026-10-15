// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate security-catalog-overlays` without `--apply`, beside a process
 * holding the SQLite file: what the occupancy warning says the preview writes.
 *
 * The preview's boot is read-only (deferred DDL, no seed, no hydration), but
 * its connect can switch a SQLite file's journal mode, which rewrites the
 * file's header and no row (measured on a rollback-journal file beside an idle
 * holder: header bytes 18 and 19 from 1,1 to 2,2, the change counter up by
 * one, schema and rows byte-identical). So the warning claims no row or table
 * and names the switch (`JOURNAL_MODE_SWITCH_NOTE`); it never says the preview
 * writes nothing. The warning prints only on a busy SQLite file, so it always
 * carries the note.
 *
 * The warning is printed before the boot, so the probe answers busy and the
 * boot is replaced by one that refuses: the case reads what was printed first.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Config } from '@oclif/core';
import { fileURLToPath } from 'node:url';
import { isExitSignal } from '../../utils/format.js';
import { JOURNAL_MODE_SWITCH_NOTE } from '../../utils/sqlite-occupancy.js';
import MigrateSecurityCatalogOverlays from './security-catalog-overlays.js';

const probe = vi.hoisted(() => vi.fn());
vi.mock('../../utils/migrate-occupancy-gate.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/migrate-occupancy-gate.js')>()),
  probeMigrationTarget: probe,
}));
const boot = vi.hoisted(() => vi.fn());
vi.mock('../../utils/schema-migrate.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/schema-migrate.js')>()),
  bootSchemaStack: boot,
}));

const CLI_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

// oclif reads the package's config (its whole command table) on a first run;
// it is paid here, outside the cases.
let oclifConfig: Config;
beforeAll(async () => {
  oclifConfig = await Config.load({ root: CLI_ROOT });
}, 60_000);

const FILE = '/srv/app/.objectstack/data/objectstack.db';

afterEach(() => {
  probe.mockReset();
  boot.mockReset();
});

/** Run the command with its output captured and its exit trapped. */
async function run(argv: string[]): Promise<{ lines: string[]; exitCode: number | undefined }> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const savedExitCode = process.exitCode;
  let exitCode: number | undefined;
  try {
    try {
      await MigrateSecurityCatalogOverlays.run(argv, oclifConfig);
    } catch (thrown) {
      if (!isExitSignal(thrown)) throw thrown;
      exitCode = (thrown as { oclif?: { exit?: number } }).oclif?.exit;
    }
    return { lines: log.mock.calls.map((c) => c.map(String).join(' ')), exitCode };
  } finally {
    process.exitCode = savedExitCode;
    for (const spy of [log, warn, error]) spy.mockRestore();
  }
}

describe('os migrate security-catalog-overlays (preview) beside a holder', () => {
  it('warns that the preview writes no row or table, and names the journal-mode switch', async () => {
    probe.mockResolvedValue({
      status: 'busy',
      filename: FILE,
      signal: 'file_open',
      detail: 'it is open in pid 4242 (node)',
      sidecars: [],
    });
    boot.mockRejectedValue(new Error('boot refused by the test: the warning is printed before it'));

    const { lines, exitCode } = await run([]);

    expect(exitCode).toBe(1);
    // The preview's boot is the read-only one.
    expect(boot).toHaveBeenCalledWith(expect.objectContaining({ deferSchemaDdl: true, readOnlyProbe: true }));
    const warning = lines.find((line) => line.includes(`${FILE} is in use`));
    expect(warning, lines.join('\n')).toContain(`The preview below writes no row or table. ${JOURNAL_MODE_SWITCH_NOTE}`);
    expect(lines.join('\n')).not.toContain('writes nothing');
  }, 60_000);
});
