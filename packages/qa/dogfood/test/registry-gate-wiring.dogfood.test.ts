// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// BOOT-LEVEL ratchet for the two object-existence gates — #3770 (data path)
// and #3867 (analytics cube auto-inference).
//
// Both gates are implemented and unit-tested. Neither implementation is what
// this file protects: it protects the WIRING, which nothing asserted.
//
// Measured, not assumed. Deleting the five lines in
// `service-analytics/src/plugin.ts` that hand `isRegisteredObject` to the
// service — i.e. switching the #3867 gate off in production while leaving the
// implementation and every unit test untouched — left the whole repo green:
// service-analytics 299/299, dogfood 395/395. The gate only logs a one-shot
// stand-down `warn`, which nobody asserts, so `/analytics/query` silently
// reverts to "any table the connection can see is readable" — the exact state
// #3867 was filed for. Deleting #3770's call site from `findData`, by contrast,
// reddens four tests immediately.
//
// The asymmetry is the test SHAPE, not luck. #3770's suite drives the real
// `protocol.findData`, so the call site is inside the object under test.
// #3867's suite injects the probe as config (`new AnalyticsService({
// isRegisteredObject })`), so it proves how the service behaves once handed a
// probe — never that anyone hands it one. That is Prime Directive #10's
// closing line in mirror image: a `case` label is not enforcement, check the
// CALL SITE. (#3106 was the same lesson pointing the other way.)
//
// This repo has already paid for this exact gap once. From
// `analytics-rls.dogfood.test.ts`, verbatim:
//
//   > Every pre-existing analytics RLS test injects `getReadScope` as a fake
//   > into a hand-built AnalyticsService. NONE booted the real plugin, so the
//   > `getReadScope → security.getReadFilter` auto-bridge had zero coverage —
//   > which is how the gap shipped.
//
// That was #3597. #3867 sits in the identical position, and the pattern is
// spreading — `measure-source-field-gate.test.ts` is a newer gate wired the
// same injected way.
//
// Everything below therefore goes through `bootStack` (real plugin lifecycle,
// real Hono app, real HTTP) and NEVER constructs a service by hand. See #4613.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * The probe target: SQLite's internal schema table.
 *
 * Chosen deliberately over an invented name. The harness boots `sqlite-wasm`,
 * so `sqlite_master` is guaranteed to EXIST and hold rows, while never being a
 * registered object. That makes it the case that actually regressed — #3867's
 * live repro read real rows out of it (`{index: …, table: …, view: …}`) — and
 * it keeps this gate honest: a 404 here cannot be explained away by "there was
 * no table anyway", which is the loophole the pre-#3770 driver-error-string
 * 404 depended on.
 */
const UNREGISTERED_BUT_REAL = 'sqlite_master';

/** The control object — proves the surfaces work at all on this boot. */
const GateNote = ObjectSchema.create({
  name: 'gate_note',
  sharingModel: 'public_read_write',
  label: 'Gate Note',
  pluralLabel: 'Gate Notes',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
  },
});

const gateStack = defineStack({
  manifest: {
    id: 'com.dogfood.registry_gate',
    namespace: 'gate',
    version: '0.0.0',
    type: 'app',
    name: 'Registry Gate Fixture',
    description: 'One object; the rest of the fixture is the ABSENCE of objects.',
  },
  objects: [GateNote],
});

describe('dogfood: the object-existence gates are actually WIRED (#3770, #3867, #4613)', () => {
  let stack: VerifyStack;
  let adminToken: string;

  beforeAll(async () => {
    // Vanilla boot on purpose — no plugin overrides. The whole point is that
    // the DEFAULT production wiring carries the gates.
    stack = await bootStack(gateStack as never);
    adminToken = await stack.signIn();

    const created = await stack.apiAs(adminToken, 'POST', '/data/gate_note', { name: 'control' });
    expect(created.status).toBeLessThan(300);
  }, 90_000);

  afterAll(async () => {
    await stack?.stop();
  });

  // ─────────────────────────────────────────────────────────────
  // Premise — the probe target really is a readable table.
  // Without this, every 404 below could be passing for the wrong reason.
  // ─────────────────────────────────────────────────────────────

  it('premise: the unregistered name IS a real table the engine can read', async () => {
    // Straight through the ENGINE, which is deliberately ungated — #3770 put
    // the gate at the protocol ingress, the external API boundary, precisely so
    // internal callers (hooks, flows, migrations, raw ObjectQL) keep working.
    // So this both establishes ground truth and pins that boundary choice.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ql = await stack.kernel.getServiceAsync<any>('objectql');
    const rows = (await ql.find(UNREGISTERED_BUT_REAL, { context: { isSystem: true } })) as unknown[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  // ─────────────────────────────────────────────────────────────
  // #3770 — the data path's registry gate, over real HTTP
  // ─────────────────────────────────────────────────────────────

  it('#3770: GET /data/:object 404s an unregistered object whose table exists', async () => {
    const res = await stack.apiAs(adminToken, 'GET', `/data/${UNREGISTERED_BUT_REAL}`);
    expect(res.status).toBe(404);

    const body = (await res.json()) as { code?: string; error?: unknown };
    // ADR-0112: top-level `error.code` is SCREAMING_SNAKE on the wire.
    expect(body.code).toBe('OBJECT_NOT_FOUND');
    // And it must not have leaked the table's contents in any shape.
    expect(JSON.stringify(body)).not.toContain('CREATE TABLE');
  });

  it('#3770: the write verbs are gated too, not just the read', async () => {
    const post = await stack.apiAs(adminToken, 'POST', `/data/${UNREGISTERED_BUT_REAL}`, { x: 1 });
    expect(post.status).toBe(404);
  });

  // ─────────────────────────────────────────────────────────────
  // #3867 — the analytics cube-inference gate, over real HTTP.
  // These are the ones that were completely unprotected.
  // ─────────────────────────────────────────────────────────────

  it('#3867: POST /analytics/query 404s a cube that is neither a Cube nor an object', async () => {
    // Pre-#3867 this returned 200 with real rows aggregated out of the table.
    const res = await stack.apiAs(adminToken, 'POST', '/analytics/query', {
      cube: UNREGISTERED_BUT_REAL,
      measures: ['count'],
    });
    expect(res.status).toBe(404);
  });

  it('#3867: a grouped query over the same name is refused identically', async () => {
    // The shape that actually disclosed data in the #3867 repro: grouping by a
    // real column of the unregistered table returned its rows.
    const res = await stack.apiAs(adminToken, 'POST', '/analytics/query', {
      cube: UNREGISTERED_BUT_REAL,
      measures: ['count'],
      dimensions: ['type'],
    });
    expect(res.status).toBe(404);

    const raw = await res.text();
    // The disclosed values from the original repro must not appear in any form.
    expect(raw).not.toContain('"rows"');
  });

  it('#3867: /analytics/sql is gated too — no SQL naming an arbitrary table', async () => {
    const res = await stack.apiAs(adminToken, 'POST', '/analytics/sql', {
      cube: UNREGISTERED_BUT_REAL,
      measures: ['count'],
    });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain(`FROM "${UNREGISTERED_BUT_REAL}"`);
  });

  // ─────────────────────────────────────────────────────────────
  // Controls — a boot where these surfaces are simply broken would make every
  // assertion above pass. These make that failure mode impossible.
  // ─────────────────────────────────────────────────────────────

  it('control: a REGISTERED object is served on the same data route', async () => {
    const res = await stack.apiAs(adminToken, 'GET', '/data/gate_note');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { records?: unknown[] };
    expect(body.records ?? []).toHaveLength(1);
  });

  it('control: a REGISTERED object still auto-infers a cube (the KPI path)', async () => {
    // #3867 narrowed auto-inference; it must not have removed it. `gate_note`
    // has no authored Cube, so a 200 here proves the intended
    // "metric over an object" path survived the gate.
    const res = await stack.apiAs(adminToken, 'POST', '/analytics/query', {
      cube: 'gate_note',
      measures: ['count'],
    });
    expect(res.status).toBe(200);
  });
});
