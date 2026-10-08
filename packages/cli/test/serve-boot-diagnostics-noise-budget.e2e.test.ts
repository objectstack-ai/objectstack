// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22160 — the dev-mode noise budget, over a REAL boot of the blank starter.
 *
 * A project scaffolded by the on-ramp (`npm create objectstack`) and given the
 * Build-with-Claude-Code tutorial's ticket object and two actions boots with
 * exactly ONE record that needs the author. The tutorial's Resolve action is
 * a declarative update and needs no handler. The second action, Escalate, is
 * `type: 'script'` with a `target` that nothing registers, so it is a button
 * wired to nothing. (Until the tutorial moved Resolve to a declarative update,
 * Resolve itself had that shape. Measured on `main` 7d7943dd with
 * `os dev --ui --fresh`: three WARN records under *Boot diagnostics*, the dead
 * button indistinguishable from the other two.)
 *
 * What this file pins is the printer's half only, over the whole command:
 * Escalate's record is the ONE line highlighted as needing attention, with its
 * fix line under it. Resolve is named on no line, and no stack trace reaches
 * the banner. It deliberately pins NO informational count — the level every
 * other boot record is logged at belongs to that record's producer, and those
 * owners are changing them.
 * The per-shape legs (each log format, the stack withholding, the debug-level
 * stream) are `src/utils/format.boot-warning-classes.test.ts`.
 *
 * Nightly (`.e2e`): one on-ramp scaffold and one `os serve` cold start. The
 * project lives under this package's `node_modules`, so the starter's imports
 * resolve to workspace copies without an install, as
 * `starter-field-consumers.e2e.test.ts` runs the same on-ramp.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv, randomPort, runServe, type ServeRun } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
// One `resolve(HERE, …)` call per line: `check:cross-package-test-inputs`
// reconstructs this read by SOURCE SCAN.
const ON_RAMP_BIN = resolve(HERE, '../../..', 'packages/create-objectstack/bin/create-objectstack.js');

const PROJECT = 'support-desk';
/** The handler-less script action: the one record that needs the author. */
const DEAD_BUTTON = 'support_desk_ticket:escalate_ticket';
/** The tutorial's declarative Resolve: no handler needed, so never highlighted. */
const DECLARATIVE = 'resolve_ticket';

/** The tutorial's `src/objects/ticket.object.ts`. */
const TICKET_OBJECT = `import { ObjectSchema, Field } from '@objectstack/spec/data';

export const Ticket = ObjectSchema.create({
  name: 'support_desk_ticket',
  label: 'Ticket',
  pluralLabel: 'Tickets',
  icon: 'life-buoy',
  description: 'A customer support request.',
  fields: {
    subject: Field.text({ label: 'Subject', required: true, searchable: true, maxLength: 200 }),
    description: Field.textarea({ label: 'Description' }),
    priority: Field.select({
      label: 'Priority',
      required: true,
      options: [
        { label: 'Low', value: 'low', default: true },
        { label: 'Normal', value: 'normal' },
        { label: 'High', value: 'high' },
        { label: 'Urgent', value: 'urgent' },
      ],
    }),
    status: Field.select({
      label: 'Status',
      required: true,
      options: [
        { label: 'Open', value: 'open', color: '#3B82F6', default: true },
        { label: 'Pending', value: 'pending', color: '#F59E0B' },
        { label: 'Resolved', value: 'resolved', color: '#10B981' },
        { label: 'Closed', value: 'closed', color: '#6B7280' },
      ],
    }),
  },
  sharingModel: 'private',
  enable: { apiEnabled: true, searchable: true },
});
`;

/**
 * `src/actions/ticket.actions.ts`: the tutorial's Resolve, a declarative
 * single-record update that needs no handler, beside Escalate, a script action
 * whose `target` nothing registers, with no `body`.
 */
const TICKET_ACTIONS = `import { defineAction } from '@objectstack/spec/ui';

export const ResolveTicketAction = defineAction({
  name: 'resolve_ticket',
  label: 'Resolve',
  objectName: 'support_desk_ticket',
  icon: 'check-circle',
  operation: 'update',
  patch: { status: 'resolved' },
  locations: ['record_header', 'list_item'],
  visible: 'has(record.status) && record.status != "resolved" && record.status != "closed"',
  successMessage: 'Ticket resolved.',
  refreshAfter: true,
});

export const EscalateTicketAction = defineAction({
  name: 'escalate_ticket',
  label: 'Escalate',
  objectName: 'support_desk_ticket',
  icon: 'arrow-up',
  type: 'script',
  target: 'escalateTicket',
  locations: ['record_header'],
});
`;

/** One scaffold, one cold start. */
const RUN_TIMEOUT_MS = 300_000;

let root: string;
let scaffold: { code: number; output: string };
let boot: ServeRun | undefined;

function scaffoldProject(cwd: string): Promise<{ code: number; output: string }> {
  return new Promise((resolveRun) => {
    execFile(
      process.execPath,
      [ON_RAMP_BIN, PROJECT, '--skip-install', '--skip-skills'],
      { cwd, maxBuffer: 16 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0;
        resolveRun({ code, output: String(stdout) + String(stderr) });
      },
    );
  });
}

beforeAll(async () => {
  root = mkdtempSync(join(HERE, '..', 'node_modules', '.boot-noise-budget-e2e-'));
  scaffold = await scaffoldProject(root);
  if (scaffold.code !== 0) return;
  const dir = join(root, PROJECT);
  writeFileSync(join(dir, 'src', 'objects', 'ticket.object.ts'), TICKET_OBJECT);
  appendFileSync(join(dir, 'src', 'objects', 'index.ts'), "export { Ticket } from './ticket.object.js';\n");
  writeFileSync(join(dir, 'src', 'actions', 'ticket.actions.ts'), TICKET_ACTIONS);
  appendFileSync(
    join(dir, 'src', 'actions', 'index.ts'),
    "export { ResolveTicketAction, EscalateTicketAction } from './ticket.actions.js';\n",
  );
  boot = await runServe(dir, ['--port', randomPort()], { waitFor: /Press Ctrl\+C to stop/, timeoutMs: RUN_TIMEOUT_MS - 60_000 });
}, RUN_TIMEOUT_MS);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

/** The *Boot diagnostics* block, header to the line before `Press Ctrl+C`. */
function bootDiagnosticsBlock(run: ServeRun): string[] {
  const lines = (run.stdout + run.stderr).split('\n');
  const from = lines.findIndex((line) => line.includes('Boot diagnostics'));
  if (from === -1) return [];
  const to = lines.findIndex((line, i) => i > from && line.includes('Press Ctrl+C to stop'));
  return lines.slice(from, to === -1 ? undefined : to);
}

describe('[#22160] a project with one dead button boots with exactly one line that needs the author', () => {
  it('scaffolds and boots', () => {
    expect(scaffold.code, scaffold.output).toBe(0);
    expect(boot, 'os serve never reached its banner').toBeDefined();
  });

  it('highlights the dead button once, with its fix line, and counts it as the one that needs attention', () => {
    const block = bootDiagnosticsBlock(boot!);
    const all = boot!.stdout + boot!.stderr;
    expect(block.length, all).toBeGreaterThan(0);

    const header = block[0];
    expect(header).toContain('1 needs your attention');

    const named = block.filter((line) => line.includes(DEAD_BUTTON));
    expect(named, block.join('\n')).toHaveLength(1);
    expect(named[0]).toMatch(/^ {4}⚠ \[action-governance\] declared script actions with NO handler/);
    expect(block[block.indexOf(named[0]) + 1]).toMatch(/^ {6}fix: \S/);
    expect(block.filter((line) => /^ {6}fix: /.test(line))).toHaveLength(1);
    // The control in the same boot: the declarative action is named nowhere.
    expect(block.filter((line) => line.includes(DECLARATIVE)), block.join('\n')).toEqual([]);
  });

  it('carries no stack trace into the banner', () => {
    expect(bootDiagnosticsBlock(boot!).join('\n')).not.toMatch(/\\n\s+at /);
  });
});
