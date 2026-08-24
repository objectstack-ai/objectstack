// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SysAutomationRun } from './sys-automation-run.object.js';

/**
 * `sys_automation_run` — the DELIBERATE "stays undeclared" verdict on the
 * `trigger_object` / `trigger_record_id` pair (#11386, the fifth of the five
 * objects that card surveyed; carrier landed by #11339, ADR-0052 §5).
 *
 * #11386's acceptance sketch admits two outcomes per object: declare
 * `referenceVia`, or record a deliberate "stays undeclared" verdict with the
 * reason. Four objects took the first route. This one takes the second, and
 * this file is what makes that verdict FALSIFIABLE rather than an absence
 * nobody can see — a later sweep that declares the pair by shape has to come
 * here, read the reason, and rule against it on purpose.
 *
 * The SHAPE fits and was verified: `SuspendedRunStore.serialize()` stamps
 * `trigger_object: ctx.object` beside `trigger_record_id: ctx.record.id`, and
 * the `{trigger_object, trigger_record_id}` index reads the pair back as an
 * address. What does not fit is the only thing the declaration enforces today
 * — seed-time resolution of an AUTHORED pointer:
 *
 *  - a `paused` row IS a live continuation. The store loads every
 *    `{ status: 'paused' }` row on boot and rehydrates it, so an authored one
 *    is not sample data but a fabricated continuation the engine will try to
 *    resume against snapshots no real run produced.
 *  - a terminal row is telemetry under this object's own retention contract
 *    (`class: 'telemetry'`, 30d sweep scoped to completed/failed), so seeded
 *    run history deletes itself on the first Reaper pass that reaches its age.
 *  - the object has no natural key to be addressed BY: `nameField: 'id'`, the
 *    id is the engine's raw `runId`, and there is no `name` field at all.
 *
 * Declaring would not make a real corpus resolvable; it would advertise run
 * rows as authorable seed content. To flip it: land a consumer that reads the
 * pair for something other than seed authoring (#5180's delete-cascade carrier
 * is the live candidate), or a measured case for seeding runs.
 */
describe('sys_automation_run — pointer pair stays undeclared (#11386 verdict)', () => {
  const fields = SysAutomationRun.fields as Record<string, Record<string, unknown>>;

  it('carries the pair as plain columns: trigger_record_id declares no referenceVia', () => {
    expect(fields.trigger_record_id).toBeDefined();
    expect(fields.trigger_record_id.type).toBe('text');
    expect(fields.trigger_record_id.referenceVia).toBeUndefined();
  });

  it('declares no referenceVia anywhere on the object', () => {
    // Guards the whole object, not just the one column the card named — the
    // verdict is about run rows not being authorable content, which is not a
    // fact about a single field.
    const declared = Object.entries(fields)
      .filter(([, def]) => def?.referenceVia !== undefined)
      .map(([name]) => name);
    expect(declared).toEqual([]);
  });

  it('still carries the object half, so the verdict is about authorability — not a missing pair', () => {
    // If this ever fails, the pair itself changed shape and the verdict above
    // needs re-deriving from scratch rather than re-affirming.
    expect(fields.trigger_object).toBeDefined();
    expect(fields.trigger_object.type).toBe('text');
  });

  it('has no natural key a seed dataset could address its rows by — one of the verdict\'s measured legs', () => {
    expect(fields.name).toBeUndefined();
    expect(SysAutomationRun.nameField).toBe('id');
  });
});
