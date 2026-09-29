// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20078 — `os validate` refuses a field-level predicate that reads THROUGH a
 * reference field, at the door an author runs before deploying.
 *
 * ## The defect this pins shut
 *
 * `record.account.tier` in a field `requiredWhen` / `readonlyWhen` or in a
 * select option's `visibleWhen` parsed, linted and validated clean — measured
 * on the unfixed tree over exactly the `TRAVERSING` config below: exit 0,
 * "Validation passed". The field level is never hydrated, so at run time the
 * reference holds a bare id, every read through it faults, and since
 * ADR-0137 D2 the two field-rule slots refuse every write that reaches them
 * (an option, fail-open, admits the value unchecked). So an author — or an AI —
 * shipped a predicate every authoring door accepted, and met it as a refused
 * write in production. `packages/lint/src/validate-expressions.test.ts` pins
 * the rule; this file pins that the rule reaches the command.
 *
 * ## The two fixtures are a pair, and the control is load-bearing
 *
 * `CONTROL` carries every shape this refusal must NOT touch on the same three
 * slots — an own column, the reference compared as a value, an option gated on
 * `current_user.can(…)` and `current_user.positions` — plus the SAME traversal
 * written where it is served, a `validations[]` `script` rule. A fix that
 * refused every predicate naming a reference field, or every option predicate,
 * turns that fixture red; one that refused nothing leaves `TRAVERSING` green.
 *
 * ## Why a real child process
 *
 * The exit status is what a CI step reads, and it only exists once Node has
 * exited — the same reason `src/commands/validate-json-strict-exit.e2e.test.ts`
 * gives. Spawned through `bin/run-dev.js` + tsx, so the suite does not depend on
 * `packages/cli/dist`; it lands in the INTEGRATION project (`vitest-tiers.ts`).
 * ⛔ Deliberately NOT named `*.e2e.test.ts`: that name selects the NIGHTLY run,
 * and this pin belongs to the queue's.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';
import { linkSpec } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

const objects = (orderFields: string, orderExtra = '') => `
import { defineStack } from '@objectstack/spec';

export default defineStack({
  manifest: { id: 'com.example.trav', name: 'trav', version: '1.0.0', type: 'app', namespace: 'trav' },
  objects: [
    {
      name: 'trav_account',
      label: 'Account',
      sharingModel: 'private',
      fields: {
        name: { type: 'text', label: 'Name' },
        tier: { type: 'text', label: 'Tier' },
      },
    },
    {
      name: 'trav_order',
      label: 'Order',
      sharingModel: 'private',
      fields: {
        account: { type: 'lookup', label: 'Account', reference: 'trav_account' },
        status: { type: 'text', label: 'Status' },
        ${orderFields}
      },
      ${orderExtra}
    },
  ],
  apps: [{ name: 'trav_app', label: 'Trav App' }],
}, { strict: false });
`;

/** One read through `account` on each of the three slots. */
const TRAVERSING = objects(`
        po_number: { type: 'text', label: 'PO', requiredWhen: "record.account.tier == 'enterprise'" },
        discount: { type: 'number', label: 'Discount', readonlyWhen: "record.account.tier == 'gold'" },
        plan: {
          type: 'select',
          label: 'Plan',
          options: [
            { value: 'basic', label: 'Basic' },
            { value: 'premium', label: 'Premium', visibleWhen: "record.account.tier == 'enterprise'" },
          ],
        },
`);

/** The same three slots, reading nothing through a reference — and the traversal where it is served. */
const CONTROL = objects(
  `
        po_number: { type: 'text', label: 'PO', requiredWhen: "record.status == 'submitted'" },
        discount: { type: 'number', label: 'Discount', readonlyWhen: "record.account == 'acc_locked'" },
        plan: {
          type: 'select',
          label: 'Plan',
          options: [
            { value: 'basic', label: 'Basic' },
            { value: 'premium', label: 'Premium', visibleWhen: "current_user.can('trav_order', 'edit') && 'admin' in current_user.positions" },
          ],
        },
`,
  `validations: [{
        name: 'enterprise_needs_po',
        type: 'script',
        message: 'Enterprise orders need a PO number',
        condition: "record.account.tier == 'enterprise' && record.po_number == ''",
      }],`,
);

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runValidate(cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, 'validate', '--json'],
      // `childEnv()`, never a bulk `process.env` copy: the vitest worker's
      // `TEST` / `VITEST*` family must not reach the child (check:cli-test-child-env).
      { cwd, maxBuffer: 16 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        resolvePromise({
          code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

interface Finding {
  rule: string;
  where: string;
  message: string;
}

let traversingDir: string;
let controlDir: string;

beforeAll(() => {
  traversingDir = mkdtempSync(join(tmpdir(), 'os-validate-traversal-'));
  writeFileSync(join(traversingDir, 'objectstack.config.ts'), TRAVERSING);
  linkSpec(traversingDir);
  controlDir = mkdtempSync(join(tmpdir(), 'os-validate-traversal-control-'));
  writeFileSync(join(controlDir, 'objectstack.config.ts'), CONTROL);
  linkSpec(controlDir);
});

afterAll(() => {
  rmSync(traversingDir, { recursive: true, force: true });
  rmSync(controlDir, { recursive: true, force: true });
});

describe('#20078 — `os validate` refuses a field-level read through a reference', () => {
  it('refuses all three slots: exit 1, one `expression-invalid` error each, with the prescription', async () => {
    const run = await runValidate(traversingDir);
    expect(run.code, run.stderr).toBe(1);
    const payload = JSON.parse(run.stdout) as { valid: boolean; errors: Finding[] };
    expect(payload.valid).toBe(false);
    const traversals = payload.errors.filter((e) => e.message.includes('through `record.account`'));
    // Sorted: the pin is WHICH slots are refused, not the walk's order.
    expect(traversals.map((e) => [e.rule, e.where]).sort()).toEqual([
      ['expression-invalid', "object 'trav_order' · field 'discount' readonlyWhen"],
      ['expression-invalid', "object 'trav_order' · field 'plan' option 'premium' visibleWhen"],
      ['expression-invalid', "object 'trav_order' · field 'po_number' requiredWhen"],
    ]);
    // Nothing else refused this config: the three are the whole verdict.
    expect(payload.errors).toHaveLength(3);
    for (const e of traversals) {
      expect(e.message).toContain('Express the check as a `validations[]` `script` rule');
    }
  }, 120_000);

  it('CONTROL — the same slots reading no reference, and the traversal in `validations[]`, validate clean', async () => {
    const run = await runValidate(controlDir);
    expect(run.code, run.stdout + run.stderr).toBe(0);
    const payload = JSON.parse(run.stdout) as { valid: boolean; errors?: Finding[] };
    expect(payload.valid).toBe(true);
    expect(payload.errors ?? []).toEqual([]);
  }, 120_000);
});
