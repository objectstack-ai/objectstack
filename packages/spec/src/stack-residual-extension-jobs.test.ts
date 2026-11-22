/**
 * The composition door for a `'preserve'` artifact's RESIDUAL — the top-level
 * entries no package body claims, which the boot registers under the
 * artifact's `manifest.id` — for the two collections it used to leave unjudged
 * or misjudged:
 *
 * - `jobs`: two inputs without a manifest declaring one job name composed, and
 *   the boot's job binder then scheduled neither (measured through `os serve`
 *   on main `c30ce97cd7`: `NOT SCHEDULED` at `error`). They are refused here
 *   now, in the one-package wording, and the `jobs` row says what the runtime
 *   does with the pair.
 * - `objectExtensions`: a residual entry registers under `manifest.id`
 *   (`@objectstack/objectql`), which under `'preserve'` is also the last
 *   input-with-a-manifest's body. The registry keeps one extension of a target
 *   per package, so a residual entry for a target that body extends too is
 *   refused with that body's entry, body first; a residual entry is told from
 *   a body's flattened copy by value, so one extending a target ANOTHER body
 *   extends composes, as two packages' extensions do.
 *
 * The engine half (the residual's fields are served) is pinned in
 * `packages/objectql` (`manifest-service-residual-object-extension.test.ts`).
 */
import { describe, it, expect } from 'vitest';
import { composeStacks, defineStack } from './stack.zod';

const sales = { id: 'com.example.sales', namespace: 'crm', name: 'sales', version: '1.0.0', type: 'app' as const };
const billing = { id: 'com.example.billing', namespace: 'crm', name: 'billing', version: '1.0.0', type: 'module' as const };

const line = { name: 'crm_line', label: 'Line', sharingModel: 'private' as const, fields: { title: { type: 'text' as const, label: 'Title' } } };
const extension = (field: string) => ({ extend: 'crm_line', fields: { [field]: { type: 'text' as const, label: field } } });
const job = (label: string) => ({
  name: 'crm_nightly',
  label,
  schedule: { type: 'interval' as const, intervalMs: 60000 },
  body: { language: 'js' as const, source: 'return 1;', capabilities: [] },
});

interface Refusal { name?: string; code?: string; status?: number; issues?: readonly string[]; message: string }

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

const JOB_CONSEQUENCE_AND_REMEDY =
  'The runtime keys jobs by name: the metadata keeps only the last of these entries, and the job scheduler ' +
  'refuses a name two enabled jobs share, so when both are enabled neither runs. Rename one of them, or merge them into a single entry.';

const EXTENSION_CONSEQUENCE_AND_REMEDY =
  "The runtime applies one extension of a target object per package, so only the last of these entries' fields " +
  "register and the others' are silently dropped. Merge them into a single `objectExtensions` entry for 'crm_line'.";

describe('residual jobs under `preserve` are judged as one package', () => {
  it('two manifest-less inputs declaring one job name: refused, naming both', () => {
    const r = refusalOf(() =>
      composeStacks(
        [
          defineStack({ manifest: sales, objects: [line] }),
          defineStack({ manifest: billing }),
          defineStack({ jobs: [job('First')] }),
          defineStack({ jobs: [job('Second')] }),
        ],
        { manifest: 'preserve' },
      ),
    );
    expectOneIssue(r);
    expect(r.issues![0]).toBe(
      "Job 'crm_nightly' is declared twice in `jobs`: stack #2 jobs[0] and stack #3 jobs[0]. " + JOB_CONSEQUENCE_AND_REMEDY,
    );
  });

  it('a single stack says the same of its pair: one row, every door', () => {
    const r = refusalOf(() => defineStack({ jobs: [job('First'), job('Second')] }));
    expect(r?.message).toContain(
      "Job 'crm_nightly' is declared twice in `jobs`: stack.jobs[0] and stack.jobs[1]. " + JOB_CONSEQUENCE_AND_REMEDY,
    );
  });

  it('CONTROL: one residual job composes, carried at the top level', () => {
    const composed = composeStacks(
      [defineStack({ manifest: sales, objects: [line] }), defineStack({ manifest: billing }), defineStack({ jobs: [job('Only')] })],
      { manifest: 'preserve' },
    ) as unknown as { packages: unknown[]; jobs: Array<{ name: string }> };
    expect(composed.packages).toHaveLength(2);
    expect(composed.jobs.map((j) => j.name)).toEqual(['crm_nightly']);
  });

  it('CONTROL: a job each body declares stays each body\'s, not a residual pair', () => {
    expect(refusalOf(() =>
      composeStacks(
        [defineStack({ manifest: sales, objects: [line], jobs: [job('Sales')] }), defineStack({ manifest: billing, jobs: [job('Billing')] })],
        { manifest: 'preserve' },
      ),
    )).toBeNull();
  });
});

describe('the residual door is not `preserve`-only: a multi-package input carries `packages[]` under every strategy', () => {
  const nested = () => composeStacks(
    [defineStack({ manifest: sales, objects: [line] }), defineStack({ manifest: billing })],
    { manifest: 'preserve' },
  );

  it.each(['first', 'last'] as const)('`%s`: two residual jobs of one name beside a nested artifact\'s packages[] are refused', (strategy) => {
    const r = refusalOf(() =>
      composeStacks([nested(), defineStack({ jobs: [job('First')] }), defineStack({ jobs: [job('Second')] })], { manifest: strategy }),
    );
    expectOneIssue(r);
    expect(r.issues![0]).toMatch(/^Job 'crm_nightly' is declared twice in `jobs`: /);
    expect(r.issues![0]).toContain(JOB_CONSEQUENCE_AND_REMEDY);
  });

  it('CONTROL: `last` with a nested artifact and one residual job composes, packages[] carried', () => {
    const composed = composeStacks([nested(), defineStack({ jobs: [job('Only')] })], { manifest: 'last' }) as unknown as { packages?: unknown[] };
    expect(composed.packages, 'anti-vacuity: the artifact carries packages[]').toHaveLength(2);
  });
});

describe('a residual `objectExtensions` entry shares the slot of the body that carries `manifest.id`', () => {
  it('a residual extension of a target that body extends too: refused, the body\'s entry first', () => {
    // `'last'` keeps billing's manifest, so the residual registers as billing.
    const r = refusalOf(() =>
      composeStacks(
        [
          defineStack({ manifest: sales, objects: [line] }),
          defineStack({ objectExtensions: [extension('cb_residual')] }),
          defineStack({ manifest: billing, objectExtensions: [extension('cb_billing')] }),
        ],
        { manifest: 'preserve' },
      ),
    );
    expectOneIssue(r);
    expect(r.issues![0]).toBe(
      "Object extension of 'crm_line' is declared twice in `objectExtensions`: 'com.example.billing' (stack #2) " +
        `objectExtensions[0] and stack #1 objectExtensions[0]. ${EXTENSION_CONSEQUENCE_AND_REMEDY}`,
    );
  });

  it('a residual extension of a target ANOTHER body extends, with other fields: composes, carried at the top level', () => {
    const composed = composeStacks(
      [
        defineStack({ manifest: billing, objectExtensions: [extension('cb_billing')] }),
        defineStack({ objectExtensions: [extension('cb_residual')] }),
        defineStack({ manifest: sales, objects: [line] }),
      ],
      { manifest: 'preserve' },
    ) as unknown as { manifest: { id: string }; objectExtensions: Array<{ fields: Record<string, unknown> }> };
    expect(composed.manifest.id).toBe(sales.id);
    expect(composed.objectExtensions.map((e) => Object.keys(e.fields))).toEqual([['cb_billing'], ['cb_residual']]);
  });

  it('a residual entry EQUAL to the owning body\'s is that body\'s copy, not a pair', () => {
    expect(refusalOf(() =>
      composeStacks(
        [
          defineStack({ manifest: sales, objects: [line] }),
          defineStack({ objectExtensions: [extension('cb_same')] }),
          defineStack({ manifest: billing, objectExtensions: [extension('cb_same')] }),
        ],
        { manifest: 'preserve' },
      ),
    )).toBeNull();
  });

  it('two residual extensions of a target another body extends: refused as the residual\'s pair (claimed by value, not by target)', () => {
    const r = refusalOf(() =>
      composeStacks(
        [
          defineStack({ manifest: billing, objectExtensions: [extension('cb_billing')] }),
          defineStack({ objectExtensions: [extension('cb_first')] }),
          defineStack({ objectExtensions: [extension('cb_second')] }),
          defineStack({ manifest: sales, objects: [line] }),
        ],
        { manifest: 'preserve' },
      ),
    );
    expectOneIssue(r);
    expect(r.issues![0]).toBe(
      "Object extension of 'crm_line' is declared twice in `objectExtensions`: stack #1 objectExtensions[0] and " +
        `stack #2 objectExtensions[0]. ${EXTENSION_CONSEQUENCE_AND_REMEDY}`,
    );
  });

  it('CONTROL: a package-claimed extension is unchanged — two packages each extending one target compose', () => {
    const composed = composeStacks(
      [
        defineStack({ manifest: sales, objects: [line], objectExtensions: [extension('cb_sales')] }),
        defineStack({ manifest: billing, objectExtensions: [extension('cb_billing')] }),
      ],
      { manifest: 'preserve' },
    ) as unknown as { packages: Array<{ manifest: { objectExtensions?: unknown[] } }> };
    expect(composed.packages.map((p) => p.manifest.objectExtensions?.length)).toEqual([1, 1]);
  });

  it('CONTROL: the owning body\'s own pair is its own door\'s finding, reported once', () => {
    const r = refusalOf(() =>
      composeStacks(
        [
          defineStack({ manifest: sales, objects: [line] }),
          defineStack({ pages: [{ name: 'crm_home', label: 'Home', type: 'app', regions: [] }] }),
          defineStack({ manifest: billing, objectExtensions: [extension('cb_a'), extension('cb_b')] }, { strict: false }),
        ],
        { manifest: 'preserve' },
      ),
    );
    expectOneIssue(r);
    expect(r.issues![0]).toMatch(/^Object extension of 'crm_line' is declared twice in `objectExtensions`: '[a-z.]+' \(stack #2\) objectExtensions\[0\] and/);
  });
});
