// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Tests for the generalized unknown-authoring-key walker (#3786).
 *
 * Three jobs: prove the walk still fires on the drifts that motivated #4148
 * (object/field), prove the NEW coverage really spans the non-strict metadata
 * population instead of sampling it, and prove the lint's posture agrees with
 * each schema's own — silent where the parse is loud (strict) or lenient
 * (passthrough), loud only where the parse is silent (strip).
 */

import { describe, it, expect } from 'vitest';

import {
  lintUnknownAuthoringKeys,
  listLintableAuthoringCollections,
} from './metadata-authoring-lint';
import { PLURAL_TO_SINGULAR } from '../shared/metadata-collection.zod';
import { getMetadataTypeSchema } from './metadata-type-schemas';

const lintables = listLintableAuthoringCollections();
const lintableTypes = new Set(lintables.map((l) => l.type));

describe('coverage derivation (#3786 — no third hand-written list)', () => {
  it('spans the non-strict population, not a sample', () => {
    // #4148 covered object+field: 2 surfaces. The point of this walker is the
    // rest. If the derivation regresses to a handful, the "evidence base" for
    // the #4001 strict tiers quietly becomes a sample again.
    expect(lintables.length).toBeGreaterThanOrEqual(14);
    // `view` matters doubly: it is a UNION (container | ViewItem | overlay), so
    // its presence pins the union half of the posture logic — a regression that
    // silently dropped unions would shrink coverage without failing the count.
    for (const expected of ['object', 'page', 'agent', 'dashboard', 'action', 'report', 'view']) {
      expect(lintableTypes, `expected '${expected}' to be lint-covered`).toContain(expected);
    }
  });

  it('excludes the strict types — the parse is already loud there', () => {
    // This list GROWS as the #4001 tier programme hardens schemas, and each
    // graduation shrinks the lint's coverage by design — the parse takes over.
    // `app` graduated mid-flight (#4165) while this very test was in review:
    // the derivation adapted on its own, and the pinned expectation above is
    // what forced a human to confirm the shrink was a graduation, not a bug.
    // It did that job again for `hook` + `datasource` (#4001 data step): the
    // count fell 16 → 14 and the pin above failed until both were confirmed
    // graduations and moved into this list. `hook` also had to leave the
    // pinned-coverage list above, where it had been an expected lint target.
    for (const strict of ['flow', 'permission', 'position', 'tool', 'app', 'hook', 'datasource']) {
      expect(lintableTypes, `'${strict}' is .strict(); the lint must not double-report`).not.toContain(strict);
    }
  });

  it('every lintable entry is a real collection with a real schema', () => {
    for (const { collection, type } of lintables) {
      expect(PLURAL_TO_SINGULAR[collection]).toBe(type);
      expect(getMetadataTypeSchema(type), `no schema for '${type}'`).toBeDefined();
    }
  });

  it('every lintable collection actually produces a finding for a bogus key', () => {
    // The derivation says these are covered; this proves the walk agrees, per
    // collection — the assertion that keeps "covered" from becoming a claim.
    for (const { collection, type } of lintables) {
      const stack = { [collection]: [{ name: 'probe_item', zzz_bogus_key: 1 }] };
      const findings = lintUnknownAuthoringKeys(stack);
      const hit = findings.find((f) => f.key === 'zzz_bogus_key');
      expect(hit, `${collection} (${type}) swallowed an unknown key`).toBeDefined();
      expect(hit!.surface).toBe(type);
      expect(hit!.path).toBe(`${collection}.probe_item.zzz_bogus_key`);
    }
  });

  it('a strict collection stays silent — the parse owns that failure', () => {
    const findings = lintUnknownAuthoringKeys({
      flows: [{ name: 'f1', zzz_bogus_key: 1 }],
    });
    expect(findings).toEqual([]);
  });
});

describe('the #4148 behaviours survive the generalization', () => {
  const stackWith = (obj: Record<string, unknown>, field: Record<string, unknown>) => ({
    objects: [
      { name: 'crm_case', label: 'Case', fields: { owner: { label: 'Owner', type: 'text', ...field } }, ...obj },
    ],
  });

  it('is silent on a clean stack', () => {
    expect(lintUnknownAuthoringKeys(stackWith({}, {}))).toEqual([]);
  });

  it('reports a retired field key with guidance and no suggestion', () => {
    const [finding, ...rest] = lintUnknownAuthoringKeys(stackWith({}, { pii: true }));
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({
      path: 'objects.crm_case.fields.owner.pii',
      surface: 'field',
      key: 'pii',
    });
    expect(finding.guidance).toBeTruthy();
    expect(finding.suggestion).toBeUndefined();
  });

  it('reports the renamed object key with its rename', () => {
    const [finding] = lintUnknownAuthoringKeys(stackWith({ capabilities: { trackHistory: true } }, {}));
    expect(finding).toMatchObject({
      path: 'objects.crm_case.capabilities',
      surface: 'object',
      suggestion: 'enable',
    });
  });

  it('reports across collections in one walk, with per-type surfaces', () => {
    const findings = lintUnknownAuthoringKeys({
      objects: [{ name: 'a', label: 'A', fields: { x: { type: 'text', indexed: true } } }],
      pages: [{ name: 'p', label: 'P', zzz: 1 }],
      agents: [{ name: 'ag', zzz: 1 }],
    });
    expect(findings.map((f) => `${f.surface}:${f.path}`).sort()).toEqual([
      'agent:agents.ag.zzz',
      'field:objects.a.fields.x.indexed',
      'page:pages.p.zzz',
    ]);
  });

  it('survives malformed input rather than throwing', () => {
    for (const junk of [undefined, null, 42, 'x', {}, { objects: 'nope' }, { pages: [null, 7] }]) {
      expect(() => lintUnknownAuthoringKeys(junk)).not.toThrow();
    }
    expect(lintUnknownAuthoringKeys({ objects: [{ name: 'a', fields: 'nope' }] })).toEqual([]);
  });

  it('ignores the underscore-prefixed packaging channel everywhere', () => {
    const findings = lintUnknownAuthoringKeys({
      objects: [{ name: 'a', _packageId: 'p', fields: { x: { type: 'text', _provenance: 'x' } } }],
      pages: [{ name: 'p', _lock: true }],
    });
    expect(findings).toEqual([]);
  });
});
