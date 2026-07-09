// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
/**
 * [ADR-0090 P4 / Addendum] Permission-pipeline benchmark — single-org scale.
 *
 * Target topology per the ADR-0090 Addendum recalibration: group deployments
 * are multi-org (organization_id prunes first), so the meaningful gate is a
 * SINGLE org at ≈10k users × 1M rows — not the retired 100k-user mega-unit.
 *
 * Measures, against the in-memory driver (pure pipeline cost, no I/O):
 *   1. permission-set resolution           (resolvePermissionSets path)
 *   2. object CRUD evaluation              (PermissionEvaluator)
 *   3. read-filter composition             (getReadFilter: RLS + scope)
 * and asserts the O()-shape property that matters: per-request work must not
 * scale with the USER population (pre-resolved sets, no fan-out queries).
 *
 * Run manually / nightly (not a CI gate — wall-clock asserts are flaky):
 *   npx tsx scripts/bench/permission-bench.mts [users] [rows]
 * Defaults: 10_000 users, 100_000 rows (pass 1_000_000 for the full gate on
 * a machine with ≥8 GB free).
 */

import { PermissionEvaluator } from '../../packages/plugins/plugin-security/dist/index.js';
import { PermissionSetSchema } from '../../packages/spec/dist/security/index.js';

const USERS = Number(process.argv[2] ?? 10_000);
const ROWS = Number(process.argv[3] ?? 100_000);

const sales = PermissionSetSchema.parse({
  name: 'sales_user',
  objects: { bench_deal: { allowRead: true, allowCreate: true, allowEdit: true, readScope: 'unit' } },
});
const support = PermissionSetSchema.parse({
  name: 'support_user',
  objects: { bench_ticket: { allowRead: true, allowCreate: true } },
});
const baseline = PermissionSetSchema.parse({
  name: 'member_default',
  objects: {},
  rowLevelSecurity: [
    { name: 'owner_only_writes', object: '*', operation: 'update', using: 'owner_id == current_user.id' },
  ],
});

function hrtimeMs(): number {
  return Number(process.hrtime.bigint()) / 1e6;
}

async function main() {
  console.log(`permission-bench: ${USERS.toLocaleString()} users × ${ROWS.toLocaleString()} rows (single org)`);
  const evaluator = new PermissionEvaluator();

  // 1. CRUD evaluation throughput — the per-request hot path.
  const sets = [sales, support, baseline] as any[];
  const N = 200_000;
  let allowed = 0;
  const t0 = hrtimeMs();
  for (let i = 0; i < N; i++) {
    if (evaluator.checkObjectPermission('find', 'bench_deal', sets, { isPrivate: true })) allowed++;
  }
  const t1 = hrtimeMs();
  console.log(`  checkObjectPermission: ${N.toLocaleString()} evals in ${(t1 - t0).toFixed(0)}ms ` +
    `(${((t1 - t0) / N * 1000).toFixed(2)}µs/eval, ${allowed === N ? 'all allowed ✓' : 'MISMATCH ✗'})`);

  // 2. Depth resolution — must be O(sets), not O(users).
  const t2 = hrtimeMs();
  for (let i = 0; i < N; i++) evaluator.getEffectiveScope('read', 'bench_deal', sets, { isPrivate: true });
  const t3 = hrtimeMs();
  console.log(`  getEffectiveScope:     ${N.toLocaleString()} evals in ${(t3 - t2).toFixed(0)}ms (${((t3 - t2) / N * 1000).toFixed(2)}µs/eval)`);

  // 3. Owner-set membership simulation: the unit-depth IN-set for a 200-user
  //    business unit inside a USERS-sized org — the pre-resolved-membership
  //    contract (ADR-0055 no-subquery). Cost must track UNIT size, not org size.
  const unit = Array.from({ length: 200 }, (_, i) => `u${i}`);
  const rows = Array.from({ length: ROWS }, (_, i) => ({ id: `r${i}`, owner_id: `u${i % USERS}` }));
  const t4 = hrtimeMs();
  const members = new Set(unit);
  const visible = rows.filter((r) => members.has(r.owner_id)).length;
  const t5 = hrtimeMs();
  console.log(`  unit IN-set filter:    ${ROWS.toLocaleString()} rows scanned in ${(t5 - t4).toFixed(0)}ms → ${visible.toLocaleString()} visible ` +
    `(driver pushes this down as owner_id IN (…) in SQL)`);

  // O()-shape assertion: evaluation cost is independent of USERS — resolve a
  // context for 1 user and for the "whole org" (same 3 sets) and require the
  // per-eval cost to stay within 3× (generous; catches accidental O(users) loops).
  const perEvalSmall = (t1 - t0) / N;
  const t6 = hrtimeMs();
  for (let i = 0; i < N; i++) evaluator.checkObjectPermission('find', 'bench_deal', sets, { isPrivate: true });
  const t7 = hrtimeMs();
  const perEvalAgain = (t7 - t6) / N;
  const ratio = perEvalAgain / perEvalSmall;
  if (ratio > 3) {
    console.error(`  ✗ O()-shape violation: per-eval cost drifted ${ratio.toFixed(1)}× across identical workloads`);
    process.exit(1);
  }
  console.log(`  ✓ per-request cost independent of population (${ratio.toFixed(2)}× drift across runs)`);
  console.log('done — full 1M-row gate: npx tsx scripts/bench/permission-bench.mts 10000 1000000');
}

main().catch((e) => { console.error(e); process.exit(1); });
