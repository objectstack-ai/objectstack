// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #19143 — the HOST half of the dataset publish door.
 *
 * `@objectstack/lint`'s own `runtime-gate.dataset-writes.test.ts` proves the
 * gate dispatches a `dataset` write to the rules that judge it. That is one
 * side of a package wall. This file asks the question the other side owns, and
 * it is a different question: does the SHIPPED caller thread a dataset write to
 * that gate, and does the refusal arrive in the ADR-0112 envelope a Studio /
 * REST `/meta` / MCP author's client reads?
 *
 * ⭐ The two are not interchangeable. The `datasets` collection was already
 * gathered here for `validateWidgetBindings` (#7529) and `dataset` already had
 * its `CLOSURE_CONTEXT_KEY_BY_TYPE` row — so every part of the host was in
 * place and the door still judged nothing, because the TYPE axis one package
 * over was empty. A green on the lint side says the rules are reachable; only
 * this side says the writes reach them.
 *
 * Harness: none. `evaluateRuntimeAuthoringGate` is pure by construction — the
 * impure reads (registry collections, package closure, tenancy posture) are its
 * caller's and arrive as arguments — so the collections are passed directly and
 * nothing about the door is stubbed.
 *
 * ## Two faces, asserted differently
 *
 * This function RETURNS the error and its caller throws it, so the refusal is
 * asserted on the ADR-0112 ENVELOPE — `code` AND `status` together, plus the
 * `issues` array that is the author's whole receipt. ⛔ Never a bare
 * `toThrow()`: this face does not throw at all, so a throw-only assertion would
 * report "the promise resolved" and never "the envelope is missing".
 */
import { describe, expect, it } from 'vitest';

import { evaluateRuntimeAuthoringGate } from './runtime-authoring-gate.js';

/** The tenant's live objects — the resolution universe the rules judge against. */
const OBJECTS = [
  {
    name: 'acme_invoice',
    label: 'Invoice',
    sharingModel: 'private',
    fields: {
      region: { type: 'text', label: 'Region' },
      issued_on: { type: 'date', label: 'Issued' },
      total: { type: 'currency', label: 'Total' },
    },
  },
];

/** A dataset every crossed rule passes. */
const cleanDataset = (over: Record<string, unknown> = {}) => ({
  name: 'acme_invoice_metrics',
  label: 'Invoice Metrics',
  object: 'acme_invoice',
  dimensions: [
    { name: 'region', field: 'region' },
    { name: 'issued_on', field: 'issued_on', dateGranularity: 'month' },
  ],
  measures: [
    { name: 'invoice_count', aggregate: 'count' },
    { name: 'total_amount', aggregate: 'sum', field: 'total' },
  ],
  ...over,
});

const publishDataset = (body: unknown, datasets: readonly unknown[] = []) =>
  evaluateRuntimeAuthoringGate({
    type: 'dataset',
    name: (body as { name?: string })?.name ?? 'acme_invoice_metrics',
    state: 'active',
    body,
    objects: OBJECTS,
    permissions: [],
    books: [],
    datasets,
  });

describe('the host threads a dataset publish to the runtime gate (#19143)', () => {
  it('⭐ LIT — a dangling dimension field is refused in the ADR-0112 envelope', () => {
    const verdict = publishDataset(
      cleanDataset({ dimensions: [{ name: 'region', field: 'no_such_column_xyz' }] }),
    );

    expect(verdict.error, 'the caller throws this; null here means the door judged nothing').not.toBeNull();
    // Envelope, both halves. `code` alone would pass on any refusal the
    // platform makes; `status` alone would pass on any 422.
    expect((verdict.error as { code?: string }).code).toBe('INVALID_METADATA');
    expect((verdict.error as { status?: number }).status).toBe(422);

    // The receipt the author reads back: rule id, name-keyed path (#10064), and
    // the string they actually typed.
    const issues = (verdict.error as { issues?: Array<Record<string, unknown>> }).issues!;
    const wire = JSON.stringify(issues);
    expect(wire).toContain('dataset-field-unknown');
    expect(wire).toContain('datasets.acme_invoice_metrics.dimensions[0].field');
    expect(wire).toContain('no_such_column_xyz');

    // `rulesRun` is how a caller tells "clean" from "nothing ran" — the exact
    // ambiguity this card was filed about.
    expect((verdict.error as { rulesRun?: string[] }).rulesRun).toContain('validateReferenceIntegrity');
  });

  it('⭐ LIT — an aggregate the field type cannot carry is refused at the same door (#16354)', () => {
    const verdict = publishDataset(
      cleanDataset({ measures: [{ name: 'region_total', aggregate: 'sum', field: 'region' }] }),
    );

    expect(verdict.error).not.toBeNull();
    expect((verdict.error as { status?: number }).status).toBe(422);
    const wire = JSON.stringify((verdict.error as { issues?: unknown }).issues);
    expect(wire).toContain('measure-aggregate-field-type-refused');
    expect((verdict.error as { rulesRun?: string[] }).rulesRun)
      .toContain('validateDatasetMeasureAggregates');
  });

  it('the same dataset publishes once the reference is repaired', () => {
    const verdict = publishDataset(cleanDataset());

    expect(
      verdict.error,
      'the refusal is about the reference, not about the type — a clean dataset must still publish',
    ).toBeNull();
    expect(verdict.advisories).toEqual([]);
  });

  it('a stored dataset s pre-existing defect is not charged to this publish (#4463 D4)', () => {
    // The `datasets` collection this host has gathered since #7529 is now also
    // the collection the write lands in, so the differential has to hold on it.
    const broken = {
      name: 'acme_legacy_metrics',
      object: 'acme_invoice',
      dimensions: [{ name: 'region', field: 'long_gone_column' }],
      measures: [{ name: 'c', aggregate: 'count' }],
    };

    expect(publishDataset(cleanDataset(), [broken]).error).toBeNull();
    // Non-vacuous: the same stored row IS refused when it is the write.
    expect(publishDataset(broken, [broken]).error).not.toBeNull();
  });

  it('a DRAFT dataset save is never gated (#4463 D1)', () => {
    // The author keeps working on a half-finished dataset and is stopped at the
    // moment they claim it is ready.
    const verdict = evaluateRuntimeAuthoringGate({
      type: 'dataset',
      name: 'acme_invoice_metrics',
      state: 'draft',
      body: cleanDataset({ dimensions: [{ name: 'region', field: 'no_such_column_xyz' }] }),
      objects: OBJECTS,
    });

    expect(verdict).toEqual({ error: null, advisories: [] });
  });
});
