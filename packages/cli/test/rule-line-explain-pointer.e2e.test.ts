// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22161] The `field-no-consumers` warning, as `os validate` and `os build`
 * really print it: one verdict line, one `fix:` line, and the `rule:` line that
 * names `os explain field-no-consumers` — the command that prints the reasoning
 * the warning used to carry inline (one 856-character line at validate, plus a
 * second ~700-character paragraph at build, measured on a tutorial-shaped
 * project before this change).
 *
 * `os validate` used to print a registry warning as its `⚠` line alone — no
 * fix, no rule id — so this pins that the validate text face now carries the
 * same three lines as `os build`, from the same helper. The JSON faces are
 * untouched (the `⚠` line itself is unchanged in kind, so
 * `validate-json-warning-parity.e2e.test.ts` still pairs it).
 *
 * Spawns the real CLI from source (`bin/run-dev.js` + tsx, the
 * `validate-json-warning-parity.e2e.test.ts` pattern): what is pinned is the
 * text two real commands print, not a function's return value. The in-process
 * pins for the helper and for `os explain <rule-id>` are in
 * `test/explain-rule-id.test.ts`.
 */

import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { childEnv } from './helpers/serve-process.js';
import { linkSpec } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/** The tutorial shape: a ticket whose long-text `description` nothing displays. */
const SOURCE = `
import { defineStack } from '@objectstack/spec';

export default defineStack({
  manifest: { id: 'com.example.my-app', name: 'my_app', version: '0.1.0', type: 'app', namespace: 'my_app' },
  objects: [{
    name: 'my_app_ticket',
    label: 'Ticket',
    sharingModel: 'private',
    fields: {
      title: { type: 'text', label: 'Title' },
      description: { type: 'textarea', label: 'Description' },
    },
  }],
  views: [{ object: 'my_app_ticket', label: 'Tickets', list: { type: 'grid', label: 'All', columns: ['title'] } }],
});
`;

const EXPECTED = [
  '⚠ object "my_app_ticket" · field "description": declared, but nothing in this stack displays or reads it (inert)',
  'fix: add it to a view column or a form section, or remove the declaration',
  'rule: field-no-consumers  at objects[0].fields.description — ' +
    '`os explain field-no-consumers` for what counts as a consumer',
];

function runCli(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done) => {
    execFile(
      TSX,
      [CLI, ...args],
      { cwd, maxBuffer: 16 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0;
        done({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

/** The warning line for the fixture's field, and the two lines printed under it, trimmed. */
function warningBlock(stdout: string): string[] {
  const lines = stdout.split('\n');
  const at = lines.findIndex((l) => l.includes('field "description"') && l.includes('⚠'));
  return at === -1 ? [] : lines.slice(at, at + 3).map((l) => l.trim());
}

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-rule-line-pointer-'));
  writeFileSync(join(dir, 'objectstack.config.ts'), SOURCE);
  linkSpec(dir);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('the field-no-consumers warning prints as verdict, fix and rule line (#22161)', () => {
  for (const command of ['validate', 'build'] as const) {
    it(`os ${command}`, async () => {
      const run = await runCli([command], dir);
      expect(run.code, `${command} failed:\n${run.stdout}\n${run.stderr}`).toBe(0);
      expect(warningBlock(run.stdout)).toEqual(EXPECTED);
      // Printed once per run, and none of the reasoning rides along.
      expect(run.stdout.split('field-no-consumers  at').length - 1).toBe(1);
      expect(run.stdout).not.toContain('carrier, not a consumer');
      expect(run.stdout).not.toContain('Roots scanned');
    }, 120_000);
  }
});
