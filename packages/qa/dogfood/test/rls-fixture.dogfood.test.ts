// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The HARD, revert-provable #1994 gate.
//
// ADR-0056 D10 — the authz-conformance matrix rows this file is the cited proof
// for; `authz-conformance.test.ts` asserts the pairing is mutual (#7976). BOTH
// are claimed on their own evidence, as re-decided in PR #7975: the read side by
// the member who cannot GET the admin note, the by-id write by the select-only
// block below (its member set grants FULL CRUD on `rls_note`, so a refusal is
// the record gate) asserting the PATCH is refused with the row unchanged.
// authz-row: rls-read
// authz-row: rls-by-id-write
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
//     fix and this flips to `rls-hole` (see README for the manual revert proof).
//   • owner policy on SELECT only  → `rls-consistent` since #7665. This block
//     was the automated RED proof of the #1994 hole class (select-only reads
//     scoped, by-id write landed); QA #7637 then measured the same class live
//     on the stock showcase, and #7665 closed it platform-side by deriving the
//     write scope from the caller's select narrowing. The block is now the
//     END-TO-END regression guard for #7665: revert that derivation and it
//     flips back to `rls-hole`. Measured both ways, on a real HTTP stack:
//     with the fix `PATCH 403, row unchanged`; without it `PATCH 200` and the
//     row mutated by a member who gets `GET 404` on the same id.
//     ⚠️ To reproduce that revert you MUST rebuild the plugin, not just edit
//     its source: this suite resolves `@objectstack/plugin-security` through
//     its built `dist`, so a source-only revert runs against the previous
//     build and reports a FALSE GREEN (`rls-consistent` with no fix present).
//     `pnpm --filter @objectstack/plugin-security build` between the edit and
//     the run is what makes the ablation real.
//     The "runner can actually answer rls-hole" liveness this block used to
//     carry lives in `rls-runner.test.ts`, whose scripted stack can still
//     plant the hole — verified to stay green in BOTH states above, so it is
//     an oracle this fix cannot switch off.

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

  // ── [#7665] select-only narrowing gates the by-id write end-to-end ─────────
  // The probe persona is criterion 2's shape: the fixture member set grants
  // full CRUD on `rls_note` (read+edit+delete), so a refusal below is the
  // record-scope gate answering — never the object-level CRUD bit. (The
  // `verify --rls` proof persona that holds NO object grants is structurally
  // unable to fail; this member is the persona that can.)
  describe('read-only-scoped member set (select only) — #7665: the write scope derives from select', () => {
    let stack: VerifyStack;
    let report: RlsReport;
    let adminToken: string;
    let memberToken: string;

    beforeAll(async () => {
      stack = await bootStack(rlsFixtureStack, {
        security: rlsFixtureSecurity(readOnlyScopedMemberSet),
      });
      adminToken = await stack.signIn();
      memberToken = await stack.signUp('owner-red@verify.test');
      report = await runRlsProofs(stack, adminToken, memberToken, rlsFixtureStack);
      // eslint-disable-next-line no-console
      console.error(formatRlsReport(report));
    }, 60_000);

    afterAll(async () => {
      await stack?.stop();
    });

    it('rls_note is rls-consistent — the select-only #1994 hole class is closed (#7665)', () => {
      const note = report.results.find((r) => r.object === 'rls_note');
      expect(note?.status, formatRlsReport(report)).toBe('rls-consistent');
      expect(report.summary.holes, formatRlsReport(report)).toBe(0);
    });

    it('by-id: the member still cannot READ the admin note (read side unchanged), and a direct PATCH is refused with the row unchanged', async () => {
      const created = await stack.apiAs(adminToken, 'POST', '/data/rls_note', {
        name: 'admin note 7665',
        body: 'admin-only secret',
      });
      expect(created.status).toBeLessThan(300);
      const cj = (await created.json()) as { id?: string; record?: { id?: string } };
      const id = cj.id ?? cj.record?.id;
      expect(id, 'admin create should return an id').toBeTruthy();

      const bRead = await stack.apiAs(memberToken, 'GET', `/data/rls_note/${id}`);
      expect(bRead.status, 'select-only narrowing must keep hiding the row').not.toBe(200);

      const bWrite = await stack.apiAs(memberToken, 'PATCH', `/data/rls_note/${id}`, { body: 'FORGED' });
      expect(bWrite.status, 'the out-of-visibility by-id write must be refused').toBeGreaterThanOrEqual(300);

      const after = await stack.apiAs(adminToken, 'GET', `/data/rls_note/${id}`);
      const afterBody = (((await after.json()) as any)?.record ?? {}).body;
      expect(afterBody, 'ground truth: the row must be untouched').toBe('admin-only secret');
    });

    it('a legitimately in-scope write still succeeds — the member edits their OWN note', async () => {
      const created = await stack.apiAs(memberToken, 'POST', '/data/rls_note', {
        name: 'member note 7665',
        body: 'mine',
      });
      expect(created.status).toBeLessThan(300);
      const cj = (await created.json()) as { id?: string; record?: { id?: string } };
      const id = cj.id ?? cj.record?.id;
      expect(id, 'member create should return an id').toBeTruthy();

      const edit = await stack.apiAs(memberToken, 'PATCH', `/data/rls_note/${id}`, { body: 'mine, edited' });
      expect(edit.status, 'the in-scope by-id write must still land').toBeLessThan(300);

      const after = await stack.apiAs(memberToken, 'GET', `/data/rls_note/${id}`);
      const afterBody = (((await after.json()) as any)?.record ?? {}).body;
      expect(afterBody).toBe('mine, edited');
    });
  });
});
