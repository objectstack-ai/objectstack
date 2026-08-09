// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The BEHAVIOURAL half of #4409, next to the structural ratchet in
 * `src/commands/authoring-rule-wiring.test.ts`.
 *
 * The ratchet proves the three authoring commands are WIRED to the same rule
 * table. This file proves the wiring produces the same VERDICT: one stack, one
 * planted defect, three commands, three rejections. Wiring and verdict are
 * genuinely different claims — a command can run a rule and still not gate on
 * what it says, which is how #3782's four lints were "wired" into `os build`
 * while `os validate` ran and then ignored the same class of finding.
 *
 * Every case below is a rule the issue MEASURED as running on a strict subset
 * of the three, with the command it was blind to named. Each one could emit
 * `error`, so each was a gate whose verdict depended on which command CI
 * happened to run — nine coin flips. The end-to-end case at the bottom is the
 * issue's own repro, run through the real CLI rather than the registry:
 *
 *     os lint      EXIT=1   ✗ approval-expression-invalid
 *     os validate  EXIT=0
 *     os build     EXIT=0   ← the artifact shipped anyway
 */

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTHORING_COMMANDS, runAuthoringRules, type AuthoringCommand } from '@objectstack/lint';

const cliBin = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'bin', 'run-dev.js');

/** A stack that satisfies the security linter, so only the planted defect gates. */
const withBaseline = (stack: Record<string, unknown>) => ({
  manifest: { id: 'parity', namespace: 'parity', version: '1.0.0', name: 'Parity', type: 'app', engines: { protocol: '^17' } },
  ...stack,
});

const listView = (object: string) => ({ type: 'grid', label: 'All', columns: ['title'], data: { provider: 'object', object } });
const formView = (object: string) => ({ type: 'simple', data: { provider: 'object', object }, sections: [] });

/**
 * One case per rule #4409 measured as partially covered, each planting the
 * defect that rule exists to catch. `blindTo` records which command let it
 * through before the registry — it is documentation, not an assertion, so the
 * table still reads as the issue's matrix once every hole is closed.
 */
const CASES: ReadonlyArray<{ rule: string; blindTo: readonly AuthoringCommand[]; stack: Record<string, unknown> }> = [
  // ── P1: gates `os build` did not run, so it PUBLISHED what the others refuse ──
  {
    rule: 'approval-expression-invalid',
    blindTo: ['validate', 'build'],
    stack: withBaseline({
      objects: [{ name: 'parity_task', label: 'Task', sharingModel: 'private', fields: { name: { type: 'text', label: 'Name' } } }],
      flows: [{
        name: 'parity_flow', label: 'Parity', type: 'record_change', runAs: 'system', status: 'active',
        nodes: [
          // #6637 — was `triggerType: 'onCreate'`, which on a `type: 'record_change'`
          // flow the engine routes to no trigger at all. This case's planted defect
          // is the approver expression; the trigger token was incidental, and leaving
          // a second (now gating) defect in the fixture would let the case pass on a
          // finding it is not about.
          { id: 'start', type: 'start', label: 'Start', config: { objectName: 'parity_task', triggerType: 'record-after-create' } },
          { id: 'appr', type: 'approval', label: 'Approve', config: { approvers: [{ type: 'expression', value: 'record.owner ==' }] } },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'appr', type: 'default' },
          { id: 'e2', source: 'appr', target: 'end', type: 'default' },
        ],
      }],
    }),
  },
  {
    rule: 'list-view-filters-in-views-mode',
    blindTo: ['build', 'lint'],
    stack: withBaseline({
      objects: [{ name: 'parity_task', label: 'Task', sharingModel: 'private', listViews: { tabular: { label: 'Tabular', userFilters: { element: 'tabs' } } }, fields: { name: { type: 'text', label: 'Name' } } }],
    }),
  },
  {
    rule: 'view-container-shape',
    blindTo: ['build', 'lint'],
    stack: withBaseline({
      views: [{ name: 'all_tasks', label: 'All Tasks', type: 'grid', data: { provider: 'object', object: 'parity_task' }, columns: ['title'] }],
    }),
  },
  // ── P2: gates `os lint` did not run, so the cheap pre-flight lied ──
  {
    rule: 'expression-invalid',
    blindTo: ['lint'],
    stack: withBaseline({
      // The planted defect is the BARE `lead_score` (a record-scoped predicate
      // binds fields under `record`, so this silently evaluates to null) — not
      // the key it is written under. Spelled `condition`, which is the only key
      // `validation.zod.ts` declares: `expression` is one of the four names it
      // rejects outright, so a fixture using it planted TWO defects and let the
      // rule under test read a stack `os validate` would never accept (#5017).
      objects: [{ name: 'parity_lead', label: 'Lead', sharingModel: 'private', fields: { lead_score: { type: 'number', label: 'Score' } }, validations: [{ type: 'script', name: 'r', message: 'Score out of range', condition: 'lead_score > 100' }] }],
    }),
  },
  {
    rule: 'filter-token-unknown',
    blindTo: ['lint'],
    stack: withBaseline({
      dashboards: [{ name: 'exec', label: 'Exec', widgets: [{ id: 'mine', type: 'metric', dataset: 'case_metrics', filter: { owner: '{current_user}', status: 'open' } }] }],
    }),
  },
  {
    rule: 'dashboard-action-target-undefined',
    blindTo: ['lint'],
    stack: withBaseline({
      dashboards: [{ name: 'exec', label: 'Exec', header: { actions: [{ label: 'Export PDF', actionType: 'script', actionUrl: 'export_dashboard_pdf' }] }, widgets: [] }],
    }),
  },
  {
    rule: 'style-node-missing-id',
    blindTo: ['lint'],
    stack: withBaseline({
      pages: [{ name: 'pricing', regions: [{ name: 'main', components: [{ type: 'flex', responsiveStyles: { large: { padding: 'var(--space-4)' } } }] }] }],
    }),
  },
  {
    rule: 'autonumber-references-unknown-field',
    blindTo: ['lint'],
    stack: withBaseline({
      objects: [{ name: 'parity_task', label: 'Task', sharingModel: 'private', fields: { task_no: { type: 'autonumber', label: 'No', autonumberFormat: '{plan_no}{000}' } } }],
    }),
  },
  {
    rule: 'view-ref-form-target-kind',
    blindTo: ['lint'],
    stack: withBaseline({
      views: [{ name: 'parity_task', list: listView('parity_task'), formViews: { default: formView('parity_task') } }],
      actions: [{ name: 'log_time', type: 'form', target: 'parity_task.default' }],
    }),
  },
];

describe('every authoring command reaches the same verdict (#4409)', () => {
  it.each(CASES.map((c) => [c.rule, c] as const))('%s gates on all three commands', (_rule, testCase) => {
    for (const command of AUTHORING_COMMANDS) {
      // `os lint` never Zod-parses, so it hands the normalized stack to both
      // tiers — modelled here exactly as the command does it.
      const findings = runAuthoringRules(command, {
        normalized: testCase.stack,
        ...(command === 'lint' ? {} : { parsed: testCase.stack }),
      });
      const gating = findings.filter((f) => f.severity === 'error').map((f) => f.rule);
      expect(
        gating,
        `os ${command} does not gate on ${testCase.rule} — it did not before #4409 either ` +
          `(blind: ${testCase.blindTo.join(', ')}), which is the drift this registry exists to end.`,
      ).toContain(testCase.rule);
    }
  });

  it('the case table still covers every command as a blind spot', () => {
    // Guard the guard: if the table drifted to cover only one direction, the
    // suite above would keep passing while testing half the problem. The issue
    // found holes in BOTH — `os build` publishing what `os lint` refuses, and
    // `os lint` passing what `os build` rejects.
    const blind = new Set(CASES.flatMap((c) => c.blindTo));
    expect([...blind].sort()).toEqual(['build', 'lint', 'validate']);
  });

  /**
   * The issue's own repro, end to end through the real CLI: a flow whose
   * expression approver does not parse used to exit 1 on `os lint` and 0 on
   * both `os validate` and `os build` — so the build emitted an artifact for a
   * flow the runtime refuses to run.
   *
   * Spawned rather than run in-process: the exit CODE is the contract CI reads,
   * and only a real process produces it.
   */
  it('the broken approval flow now exits non-zero on all three commands', () => {
    const dir = mkdtempSync(join(tmpdir(), 'os-authoring-parity-'));
    try {
      // A plain literal config: no imports, so it resolves without a
      // node_modules next to it.
      writeFileSync(
        join(dir, 'objectstack.config.mjs'),
        `export default ${JSON.stringify(CASES[0].stack, null, 2)};\n`,
      );

      for (const command of ['lint', 'validate', 'build']) {
        let exitCode = 0;
        let output = '';
        try {
          output = execFileSync(process.execPath, [cliBin, command], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
        } catch (error: any) {
          exitCode = error.status ?? 1;
          output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
        }
        expect(exitCode, `os ${command} exited 0 on a flow whose approver expression does not parse`).toBe(1);
        expect(output, `os ${command} rejected the stack without naming the rule`).toContain(
          'approval-expression-invalid',
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
