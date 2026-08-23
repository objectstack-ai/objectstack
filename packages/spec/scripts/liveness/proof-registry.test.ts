// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Unit + wiring tests for the ADR-0054 prove-it-runs proof contract.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  HIGH_RISK_CLASSES,
  BOUND_PROOF_PATHS,
  KNOWN_PROOF_IDS,
  parseProofRef,
  extractProofTags,
  validateProofRef,
} from './proof-registry.mts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..'); // packages/spec/scripts/liveness → repo root

describe('parseProofRef', () => {
  it('splits a well-formed ref into file + id', () => {
    expect(parseProofRef('packages/qa/dogfood/test/x.test.ts#my-proof')).toEqual({
      file: 'packages/qa/dogfood/test/x.test.ts',
      id: 'my-proof',
    });
  });

  it('rejects malformed refs', () => {
    expect(parseProofRef('no-hash-here.ts')).toBeNull();
    expect(parseProofRef('#leading')).toBeNull();
    expect(parseProofRef('trailing#')).toBeNull();
    expect(parseProofRef('')).toBeNull();
    expect(parseProofRef(42 as unknown)).toBeNull();
    expect(parseProofRef(undefined)).toBeNull();
  });
});

describe('extractProofTags', () => {
  it('finds every @proof tag in text and ignores non-matches', () => {
    const tags = extractProofTags('// @proof: alpha\nnoise\n/* @proof: beta-1 */ @proof:notALabel?');
    expect(tags.has('alpha')).toBe(true);
    expect(tags.has('beta-1')).toBe(true);
    // `notALabel` is matched up to the first non-id char — fine; the point is no false negatives.
    expect(tags.has('alpha-missing')).toBe(false);
  });

  it('returns empty when there are no tags', () => {
    expect(extractProofTags('just some code').size).toBe(0);
  });
});

describe('validateProofRef (injected fs)', () => {
  const fakeJoin = (...p: string[]) => p.join('/');

  it('passes when the file exists and declares the tag', () => {
    const fs = {
      existsSync: () => true,
      readFileSync: () => '// @proof: good-proof',
    };
    expect(validateProofRef('a/b.test.ts#good-proof', { repoRoot: '/root', fs, join: fakeJoin })).toEqual({ ok: true });
  });

  it('fails on a malformed ref', () => {
    const fs = { existsSync: () => true, readFileSync: () => '' };
    const r = validateProofRef('nohash', { repoRoot: '/root', fs, join: fakeJoin });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/malformed/);
  });

  it('fails when the proof file is missing', () => {
    const fs = { existsSync: () => false, readFileSync: () => '' };
    const r = validateProofRef('a/b.test.ts#x', { repoRoot: '/root', fs, join: fakeJoin });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/file not found/);
  });

  it('fails when the file exists but the tag is absent (rot)', () => {
    const fs = { existsSync: () => true, readFileSync: () => '// @proof: other' };
    const r = validateProofRef('a/b.test.ts#x', { repoRoot: '/root', fs, join: fakeJoin });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not found in/);
  });
});

describe('registry invariants', () => {
  it('bound classes carry a proofRef whose id matches the class proofId', () => {
    for (const cls of HIGH_RISK_CLASSES) {
      if (!cls.bound) continue;
      expect(cls.proofRef, `${cls.id} is bound but has no proofRef`).toBeTruthy();
      expect(parseProofRef(cls.proofRef)?.id).toBe(cls.proofId);
      expect(cls.ledgerBindings.length, `${cls.id} is bound but binds no ledger entry`).toBeGreaterThan(0);
    }
  });

  it('unbound classes record an honest blockedReason', () => {
    for (const cls of HIGH_RISK_CLASSES) {
      if (cls.bound) continue;
      expect(cls.blockedReason, `${cls.id} is unbound without a blockedReason`).toBeTruthy();
    }
  });

  it('BOUND_PROOF_PATHS maps the expected entries this phase', () => {
    expect([...BOUND_PROOF_PATHS.keys()].sort()).toEqual(
      [
        'field/type',
        'field/readonly',
        'flow/nodes.type',
        'flow/runAs',
        'permission/rowLevelSecurity.using',
        'dataset/dimensions.dateGranularity',
        'object/sharingModel',
        'position/delegatable',
        'object/lifecycle',
        'webhook/object',
        // Bound 2026-08-02 (#4509) — the second materializer bridge. Authored
        // email templates now reach sendTemplate, and `subject` is the
        // representative prop for a pipeline that had THREE independent breaks
        // on it, so its `live` status is exactly what the proof gates.
        'email_template/subject',
        // Bound when the 13 orphan `@proof:` tags were registered — the five
        // classes that had an authorable property whose `live` status they
        // actually gate (the other eight record a blockedReason instead).
        'object/enable.files',
        'object/highlightFields',
        'object/stageField',
        'object/fieldGroups',
        'permission/rowLevelSecurity.check',
        'permission/objects.readScope',
        'permission/objects.modifyAllRecords',
        // Bound 2026-07-30 (#3896 security-subset re-verification) — after the
        // me-apps dogfood proof was extended to actually AUTHOR the property on
        // a permission set, rather than mentioning it in its header.
        'permission/tabPermissions',
        // Bound 2026-07-30, same sweep: writeScope was the only scope axis
        // without a runtime proof; its new dogfood file asserts post-state in
        // three postures (widen / independent-of-read / fail-closed seam).
        'permission/objects.writeScope',
        // Bound 2026-08-23 (#10959) — the three proofs PR #10934 registered
        // with a PROPOSED binding, adopted after the spec seat adjudicated
        // them. Six paths, because two of the three are multi-entry.
        //
        // `showcase-fls-read-mask-strip` → the READ axis only. Its sibling
        // `permission/fields.editable` is deliberately absent: that proof
        // authors the key but asserts its refusal as a consequence of
        // unreadability, not as the write-deny axis.
        'permission/fields.readable',
        // `showcase-crud-persona-matrix` → all four verbs. The exact allow/deny
        // split is asserted per cell, so a narrowing sweep breaks the build
        // rather than quietly shrinking what these four cite (`semantic-roles`
        // is the multi-entry precedent).
        'permission/objects.allowCreate',
        'permission/objects.allowRead',
        'permission/objects.allowEdit',
        'permission/objects.allowDelete',
        // `sharing-rule-org-less-caller` → `systemPermissions`. The card held
        // this one back pending a measurement: its ledger note claimed
        // "app-entry/nav visibility only". The note was stale — ADR-0111 D6
        // makes it a data-layer gate at `SharingRuleService` — so the note was
        // corrected and the binding adopted in the same PR.
        'permission/systemPermissions',
      ].sort(),
    );
  });

  it('every class proofId is in KNOWN_PROOF_IDS', () => {
    for (const cls of HIGH_RISK_CLASSES) expect(KNOWN_PROOF_IDS.has(cls.proofId)).toBe(true);
  });
});

// End-to-end wiring: the REAL ledger entries reference the REAL dogfood proofs,
// and those proofs declare the matching tag. This is the check that the spec gate
// runs in CI, asserted here without booting the metadata-type registry.
describe('real proof wiring resolves', () => {
  const fs = { existsSync, readFileSync };
  const ledgerFor: Record<string, string> = {
    field: 'packages/spec/liveness/field.json',
    permission: 'packages/spec/liveness/permission.json',
    flow: 'packages/spec/liveness/flow.json',
    dataset: 'packages/spec/liveness/dataset.json',
    object: 'packages/spec/liveness/object.json',
    position: 'packages/spec/liveness/position.json',
    webhook: 'packages/spec/liveness/webhook.json',
    email_template: 'packages/spec/liveness/email_template.json',
  };

  function ledgerEntry(type: string, path: string): any {
    const ledger = JSON.parse(readFileSync(join(repoRoot, ledgerFor[type]), 'utf8'));
    let node = ledger.props;
    const segs = path.split('.');
    for (let i = 0; i < segs.length; i++) {
      node = i === 0 ? node[segs[i]] : node.children?.[segs[i]];
      expect(node, `missing ledger node ${type}.${segs.slice(0, i + 1).join('.')}`).toBeTruthy();
    }
    return node;
  }

  for (const cls of HIGH_RISK_CLASSES.filter((c) => c.bound)) {
    for (const b of cls.ledgerBindings) {
      it(`${b.type}.${b.path} carries the ${cls.id} proof and it resolves`, () => {
        const entry = ledgerEntry(b.type, b.path);
        expect(entry.status).toBe('live');
        expect(entry.proof, `${b.type}.${b.path} missing proof`).toBe(cls.proofRef);
        expect(validateProofRef(entry.proof, { repoRoot, fs, join })).toEqual({ ok: true });
      });
    }
  }

  it('no bound class is left with an unresolved proof or a blockedReason', () => {
    for (const cls of HIGH_RISK_CLASSES.filter((c) => c.bound)) {
      expect(cls.blockedReason, `${cls.id} is bound but still records a blockedReason`).toBeUndefined();
      expect(validateProofRef(cls.proofRef, { repoRoot, fs, join })).toEqual({ ok: true });
    }
  });
});
