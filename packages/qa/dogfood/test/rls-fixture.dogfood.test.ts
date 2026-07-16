// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The HARD, revert-provable #1994 gate.
//
// @proof: rls-by-id-write
// ADR-0054 runtime proof for the RLS / sharing high-risk class. Referenced by the
// liveness ledger entry `permission.rowLevelSecurity.using`
// (packages/spec/liveness/permission.json); the spec liveness gate fails if this
// tag is removed. See proof-registry.mts.
//
// `auto-verify-rls.dogfood.test.ts` runs the cross-owner runner over the real
// apps, but single-tenant boot strips the tenant policy so every object is
// `member-visible` — the by-id-write path is never exercised. This test boots a
// purpose-built owner-isolated fixture (see `fixtures/rls-owner-fixture.ts`) so
// a fresh member genuinely cannot read an admin-created record, then asserts the
// runner's verdict in BOTH directions:
//
//   • owner policy on ALL ops      → `rls-consistent` (green gate). Safe ONLY
//     because the #1994 pre-image check enforces the by-id write — revert that
//     fix and this flips to `rls-hole` (see README for the manual revert proof,
//     and the RED block below for the automated analogue).
//   • owner policy on SELECT only  → `rls-hole` (automated red proof). The read
//     is owner-scoped but no write policy applies, so the by-id write lands —
//     the #1994 hole class, reproduced without touching engine code. This proves
//     the gate can actually go red.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { runRlsProofs, formatRlsReport, type RlsReport } from '@objectstack/verify';
import {
  rlsFixtureStack,
  ownerScopedMemberSet,
  readOnlyScopedMemberSet,
  rlsFixtureSecurity,
} from './fixtures/rls-owner-fixture.js';

describe('objectstack verify RLS: owner-isolated fixture (#1994 hard gate)', () => {
  // ── GREEN: the gate that must stay consistent ──────────────────────────────
  describe('owner-scoped member set (all ops)', () => {
    let stack: VerifyStack;
    let report: RlsReport;
    let adminToken: string;
    let memberToken: string;

    beforeAll(async () => {
      stack = await bootStack(rlsFixtureStack, {
        security: rlsFixtureSecurity(ownerScopedMemberSet),
      });
      adminToken = await stack.signIn();
      memberToken = await stack.signUp('owner-green@verify.test');
      report = await runRlsProofs(stack, adminToken, memberToken, rlsFixtureStack);
      // eslint-disable-next-line no-console
      console.error(formatRlsReport(report));
    }, 60_000);

    afterAll(async () => {
      await stack?.stop();
    });

    it('precondition: a fresh member CANNOT read an admin-created note (owner RLS reaches the member)', async () => {
      const created = await stack.apiAs(adminToken, 'POST', '/data/rls_note', {
        name: 'admin note',
        body: 'admin-only secret',
      });
      expect(created.status).toBeLessThan(300);
      const cj = (await created.json()) as { id?: string; record?: { id?: string } };
      const id = cj.id ?? cj.record?.id;
      expect(id, 'admin create should return an id').toBeTruthy();

      const bRead = await stack.apiAs(memberToken, 'GET', `/data/rls_note/${id}`);
      // Owner-scoped: the member is not the creator, so the row is invisible.
      expect(bRead.status, 'member B must not be able to read the admin note').not.toBe(200);
    });

    it('rls_note is rls-consistent — member can neither read nor mutate it by id', () => {
      const note = report.results.find((r) => r.object === 'rls_note');
      expect(note?.status, formatRlsReport(report)).toBe('rls-consistent');
    });

    it('the report has ZERO holes and ZERO member-visible objects (real isolation)', () => {
      expect(report.summary.holes, formatRlsReport(report)).toBe(0);
      expect(report.summary.memberVisible, formatRlsReport(report)).toBe(0);
      expect(report.summary.consistent).toBeGreaterThanOrEqual(1);
    });
  });

  // ── RED: proof the gate can go red on the #1994 hole class ──────────────────
  describe('read-only-scoped member set (select only) — #1994 hole reproduced', () => {
    let stack: VerifyStack;
    let report: RlsReport;

    beforeAll(async () => {
      stack = await bootStack(rlsFixtureStack, {
        security: rlsFixtureSecurity(readOnlyScopedMemberSet),
      });
      const adminToken = await stack.signIn();
      const memberToken = await stack.signUp('owner-red@verify.test');
      report = await runRlsProofs(stack, adminToken, memberToken, rlsFixtureStack);
      // eslint-disable-next-line no-console
      console.error(formatRlsReport(report));
    }, 60_000);

    afterAll(async () => {
      await stack?.stop();
    });

    it('rls_note is rls-hole — member cannot read it yet mutated it by id', () => {
      const note = report.results.find((r) => r.object === 'rls_note');
      expect(note?.status, formatRlsReport(report)).toBe('rls-hole');
      expect(report.summary.holes).toBe(1);
    });
  });
});
