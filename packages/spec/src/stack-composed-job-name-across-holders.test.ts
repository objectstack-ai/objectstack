/**
 * One job name ENABLED in two holders of a composed artifact — two package
 * bodies, or a package body and the residual (the top-level entries no body
 * claims) — is refused at composition.
 *
 * The boot's job binder (`jobNameCollisions`, `@objectstack/runtime`) schedules
 * every job of an artifact by its bare name and refuses a name two enabled jobs
 * share, so neither runs; the install-local door refuses such a package by the
 * same judge. Composition used to admit both shapes: a residual job was claimed
 * as a body's copy by NAME, and two bodies were never read against each other.
 * It now reads the artifact the way the binder does — enabled jobs only, by
 * name, the residual by count beyond the bodies' copies — so a disabled twin,
 * a body's own flattened copy and distinct names still compose.
 */
import { describe, it, expect } from 'vitest';
import { composeStacks, defineStack } from './stack.zod';

const sales = { id: 'com.example.sales', namespace: 'crm', name: 'sales', version: '1.0.0', type: 'app' as const };
const billing = { id: 'com.example.billing', namespace: 'crm', name: 'billing', version: '1.0.0', type: 'module' as const };
const support = { id: 'com.example.support', namespace: 'crm', name: 'support', version: '1.0.0', type: 'module' as const };

const line = { name: 'crm_line', label: 'Line', sharingModel: 'private' as const, fields: { title: { type: 'text' as const, label: 'Title' } } };
const job = (label: string, name = 'crm_nightly', enabled?: boolean) => ({
  name,
  label,
  schedule: { type: 'interval' as const, intervalMs: 60000 },
  body: { language: 'js' as const, source: 'return 1;', capabilities: [] },
  ...(enabled === undefined ? {} : { enabled }),
});

interface Refusal { code?: string; status?: number; issues?: readonly string[]; message: string }

function refusalOf(run: () => unknown): Refusal | null {
  try {
    run();
    return null;
  } catch (e) {
    return e as Refusal;
  }
}

function expectOneIssue(r: Refusal | null): asserts r is Refusal {
  expect(r, 'refused').not.toBeNull();
  expect(r!.code).toBe('STACK_CROSS_REFERENCE_INVALID');
  expect(r!.status).toBe(422);
  expect(r!.issues).toHaveLength(1);
}

const CONSEQUENCE =
  "The runtime schedules an artifact's jobs by their bare name, whichever package declares them, and the job " +
  'scheduler refuses a name two enabled jobs share, so none of them runs.';
const REMEDY_TWO = 'Rename one of them, or disable one (`enabled: false`).';
const RESIDUAL = '(the top level, outside every package body)';

describe('two package bodies with one enabled job name', () => {
  it('refused at composition, naming both bodies', () => {
    const r = refusalOf(() =>
      composeStacks(
        [defineStack({ manifest: sales, objects: [line], jobs: [job('Sales')] }), defineStack({ manifest: billing, jobs: [job('Billing')] })],
        { manifest: 'preserve' },
      ),
    );
    expectOneIssue(r);
    expect(r.issues![0]).toBe(
      "Job 'crm_nightly' is declared enabled twice across the packages of one composed artifact: " +
        "'com.example.sales' (stack #0) jobs[0] and 'com.example.billing' (stack #1) jobs[0]. " +
        `${CONSEQUENCE} ${REMEDY_TWO}`,
    );
  });

  it('two bodies a nested artifact carries: refused, each named at its packages[] place', () => {
    const r = refusalOf(() =>
      composeStacks(
        [
          composeStacks(
            [defineStack({ manifest: sales, objects: [line], jobs: [job('Sales')] }), defineStack({ manifest: support })],
            { manifest: 'preserve' },
          ),
          defineStack({ manifest: billing, jobs: [job('Billing')] }),
        ],
        { manifest: 'preserve' },
      ),
    );
    expectOneIssue(r);
    expect(r.issues![0]).toBe(
      "Job 'crm_nightly' is declared enabled twice across the packages of one composed artifact: " +
        "'com.example.support' (stack #0) packages[0].manifest.jobs[0] and 'com.example.billing' (stack #1) jobs[0]. " +
        `${CONSEQUENCE} ${REMEDY_TWO}`,
    );
  });

  it('three holders: every enabled job named, and the remedy is all but one', () => {
    const r = refusalOf(() =>
      composeStacks(
        [
          defineStack({ manifest: sales, objects: [line], jobs: [job('Sales')] }),
          defineStack({ manifest: billing, jobs: [job('Billing')] }),
          defineStack({ manifest: support, jobs: [job('Support')] }),
        ],
        { manifest: 'preserve' },
      ),
    );
    expectOneIssue(r);
    expect(r.issues![0]).toMatch(/^Job 'crm_nightly' is declared enabled 3 times across the packages of one composed artifact: /);
    expect(r.issues![0]).toContain("'com.example.sales' (stack #0) jobs[0], 'com.example.billing' (stack #1) jobs[0] and 'com.example.support' (stack #2) jobs[0]");
    expect(r.issues![0]).toContain('Rename all but one of them, or disable all but one (`enabled: false`).');
  });
});

describe('a residual job sharing an enabled name with a package body\'s job', () => {
  it('refused at composition, naming the body and the residual', () => {
    const r = refusalOf(() =>
      composeStacks(
        [
          defineStack({ manifest: sales, objects: [line], jobs: [job('Sales')] }),
          defineStack({ jobs: [job('Residual')] }),
          defineStack({ manifest: billing }),
        ],
        { manifest: 'preserve' },
      ),
    );
    expectOneIssue(r);
    expect(r.issues![0]).toBe(
      "Job 'crm_nightly' is declared enabled twice across the packages of one composed artifact: " +
        `'com.example.sales' (stack #0) jobs[0] and stack #1 jobs[0] ${RESIDUAL}. ${CONSEQUENCE} ${REMEDY_TWO}`,
    );
  });

  it('the residual before the body, and its owner the declaring body: the residual still named as the residual', () => {
    const r = refusalOf(() =>
      composeStacks(
        [defineStack({ jobs: [job('Residual')] }), defineStack({ manifest: sales, objects: [line], jobs: [job('Sales')] })],
        { manifest: 'preserve' },
      ),
    );
    expectOneIssue(r);
    expect(r.issues![0]).toContain(`stack #0 jobs[0] ${RESIDUAL} and 'com.example.sales' (stack #1) jobs[0]`);
  });

  it.each(['first', 'last'] as const)(
    '`%s`: a residual job beside a nested artifact whose body declares the name is refused, by count beyond the copies',
    (strategy) => {
      // The nested artifact keeps its flattened top level (it has a residual of its own), so its body's job
      // is there twice: in the body and as the copy. Only the outer residual's job is beyond the copies.
      const nested = composeStacks(
        [defineStack({ manifest: sales, objects: [line], jobs: [job('Sales')] }), defineStack({ jobs: [job('Own', 'crm_own')] }), defineStack({ manifest: support })],
        { manifest: 'preserve' },
      );
      expect((nested as { jobs?: unknown[] }).jobs, 'anti-vacuity: the nested artifact carries the copy').toHaveLength(2);
      const r = refusalOf(() => composeStacks([nested, defineStack({ jobs: [job('Residual')] })], { manifest: strategy }));
      expectOneIssue(r);
      expect(r.issues![0]).toBe(
        "Job 'crm_nightly' is declared enabled twice across the packages of one composed artifact: " +
          `'com.example.support' (stack #0) packages[0].manifest.jobs[0] and stack #1 jobs[0] ${RESIDUAL}. ${CONSEQUENCE} ${REMEDY_TWO}`,
      );
    },
  );

  it('a residual job beside a nested artifact that dropped its flattened copy: refused all the same', () => {
    const nested = composeStacks(
      [defineStack({ manifest: sales, objects: [line], jobs: [job('Sales')] }), defineStack({ manifest: support })],
      { manifest: 'preserve' },
    );
    expect((nested as { jobs?: unknown[] }).jobs, 'anti-vacuity: no flattened copy').toBeUndefined();
    const r = refusalOf(() => composeStacks([nested, defineStack({ jobs: [job('Residual')] })], { manifest: 'last' }));
    expectOneIssue(r);
    expect(r.issues![0]).toContain(`'com.example.support' (stack #0) packages[0].manifest.jobs[0] and stack #1 jobs[0] ${RESIDUAL}`);
  });
});

describe('CONTROLS: what the binder schedules without a refusal still composes', () => {
  it('a body\'s job alone: its flattened copy is not read as a residual twin', () => {
    const composed = composeStacks(
      [
        defineStack({ manifest: sales, objects: [line], jobs: [job('Sales')] }),
        defineStack({ jobs: [job('Residual', 'crm_hourly')] }),
        defineStack({ manifest: billing }),
      ],
      { manifest: 'preserve' },
    ) as unknown as { jobs: Array<{ name: string }> };
    expect(composed.jobs.map((j) => j.name), 'anti-vacuity: the copy and the residual sit at the top level').toEqual(['crm_nightly', 'crm_hourly']);
  });

  it('a nested artifact\'s flattened copy, composed again: not read as a second job of the name', () => {
    const nested = composeStacks(
      [defineStack({ manifest: sales, objects: [line], jobs: [job('Sales')] }), defineStack({ jobs: [job('Own', 'crm_own')] }), defineStack({ manifest: support })],
      { manifest: 'preserve' },
    );
    expect(refusalOf(() => composeStacks([nested, defineStack({ manifest: billing })], { manifest: 'preserve' }))).toBeNull();
    expect(refusalOf(() => composeStacks([nested, defineStack({ jobs: [job('Hourly', 'crm_hourly')] })], { manifest: 'last' }))).toBeNull();
  });

  it('a nested artifact read back through JSON: its copies are other objects now, and still counted as copies, not by content', () => {
    const nested = composeStacks(
      [defineStack({ manifest: sales, objects: [line], jobs: [job('Sales')] }), defineStack({ jobs: [job('Own', 'crm_own')] }), defineStack({ manifest: support })],
      { manifest: 'preserve' },
    );
    const reloaded = defineStack(JSON.parse(JSON.stringify(nested)));
    const carried = reloaded as unknown as { jobs: unknown[]; packages: Array<{ manifest: { jobs: unknown[] } }> };
    expect(carried.jobs[0], 'anti-vacuity: the copy is not the body\'s job object').not.toBe(carried.packages[0].manifest.jobs[0]);
    expect(refusalOf(() => composeStacks([reloaded, defineStack({ manifest: billing })], { manifest: 'preserve' }))).toBeNull();
    // …and a job beyond the copies is still the residual's.
    const r = refusalOf(() => composeStacks([reloaded, defineStack({ manifest: billing, jobs: [job('Billing', 'crm_own')] })], { manifest: 'preserve' }));
    expectOneIssue(r);
    expect(r.issues![0]).toContain(`'com.example.support' (stack #0) jobs[1] ${RESIDUAL} and 'com.example.billing' (stack #1) jobs[0]`);
  });

  it.each([
    ['the first body\'s twin', [false, undefined]],
    ['the second body\'s twin', [undefined, false]],
  ] as const)('a disabled twin across two bodies composes: %s', (_label, [first, second]) => {
    expect(refusalOf(() =>
      composeStacks(
        [
          defineStack({ manifest: sales, objects: [line], jobs: [job('Sales', 'crm_nightly', first)] }),
          defineStack({ manifest: billing, jobs: [job('Billing', 'crm_nightly', second)] }),
        ],
        { manifest: 'preserve' },
      ),
    )).toBeNull();
  });

  it.each([
    ['the body\'s twin', [false, undefined]],
    ['the residual\'s twin', [undefined, false]],
  ] as const)('a disabled twin across a body and the residual composes: %s', (_label, [body, residual]) => {
    expect(refusalOf(() =>
      composeStacks(
        [
          defineStack({ manifest: sales, objects: [line], jobs: [job('Sales', 'crm_nightly', body)] }),
          defineStack({ jobs: [job('Residual', 'crm_nightly', residual)] }),
          defineStack({ manifest: billing }),
        ],
        { manifest: 'preserve' },
      ),
    )).toBeNull();
  });

  it('distinct names across two bodies and the residual compose', () => {
    expect(refusalOf(() =>
      composeStacks(
        [
          defineStack({ manifest: sales, objects: [line], jobs: [job('Sales', 'crm_sales')] }),
          defineStack({ jobs: [job('Residual', 'crm_residual')] }),
          defineStack({ manifest: billing, jobs: [job('Billing', 'crm_billing')] }),
        ],
        { manifest: 'preserve' },
      ),
    )).toBeNull();
  });

  it('a flat composition is one package: its pair is the one-package finding, not this one', () => {
    const r = refusalOf(() => composeStacks([defineStack({ jobs: [job('First')] }), defineStack({ jobs: [job('Second')] })]));
    expectOneIssue(r);
    expect(r.issues![0]).toMatch(/^Job 'crm_nightly' is declared twice in `jobs`: stack #0 jobs\[0\] and stack #1 jobs\[0\]\. /);
  });
});
