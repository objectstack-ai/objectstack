// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateNavAccess,
  validateSecurityPosture,
  NAV_OBJECT_UNGRANTED,
  SECURITY_MASTER_DETAIL_UNGRANTED,
} from '@objectstack/lint';

import stack from '../objectstack.config.js';

/**
 * The showcase's navigation and its permission sets must keep agreeing
 * (ADR-0090 D6 `nav-object-ungranted`; ADR-0055 `security-master-detail-
 * ungranted`).
 *
 * ## Why this pin exists in this shape
 *
 * Both rules are ADVISORY: they warn and the build still exits 0. The showcase
 * shipped seven ungranted nav entries and three ungranted detail objects for
 * long enough that the warnings became scenery, and `objectstack build` was
 * green through all of it. So a pin asserting "the build succeeds" would have
 * passed on the broken tree — it has to assert on the FINDINGS.
 *
 * It runs the SHIPPED rule implementations against the REAL stack rather than
 * re-deriving them here. A re-derivation is a second opinion that drifts: the
 * rule could be tightened (or broken) and this file would keep answering about
 * its own old copy. `vitest.config.ts` aliases `@objectstack/lint` to its
 * `src/`, so the verdict is about the rule source in this checkout, not about
 * `packages/lint/dist` (`pnpm check:test-source-alias`).
 *
 * ## Population — what this covers, and what it does NOT
 *
 * COVERS, for this app's stack only:
 *   - every `type: 'object'` navigation entry in `showcase_app`, at any depth
 *     (top level, groups, areas, nested children), whose target is an object
 *     THIS stack defines — each must be readable through some permission set
 *     this stack declares (`allowRead` / `viewAllRecords` / `modifyAllRecords`,
 *     as `buildAccessMatrix` folds them);
 *   - every non-system object in this stack carrying a `master_detail` field —
 *     each must hold an object-level CRUD grant (any of the six bits) in some
 *     declared set.
 *
 * DOES NOT COVER:
 *   - the other example apps (`app-crm`, `app-todo`, `app-multi-package`) —
 *     each would need its own pin;
 *   - the other 23 author-time warnings this build still emits (approval
 *     staffing, deprecated React props, roll-up titles, planned properties,
 *     `security-private-no-readscope`); this pin is deliberately scoped to the
 *     two rules and says nothing about the total;
 *   - WHETHER THE GRANT IS THE RIGHT ONE. Both rules ask only that SOME set
 *     grants the object. Moving every grant onto one set, or widening one to a
 *     `'*'` wildcard, satisfies both rules and this pin — `access-matrix.json`
 *     is the artifact that makes that visible, because any such change shows up
 *     as reviewable snapshot drift and fails `objectstack build` until committed;
 *   - runtime behaviour. This is a static agreement check on declarations; it
 *     does not boot the app or issue a request.
 */

type AnyRec = Record<string, unknown>;
const asStack = stack as unknown as AnyRec;

/** The stack with `objectName`'s grant removed from EVERY permission set. */
function withoutGrant(objectName: string): AnyRec {
  const permissions = (asStack.permissions as AnyRec[]).map((ps) => {
    const objects = ps?.objects as AnyRec | undefined;
    if (!objects || !(objectName in objects)) return ps;
    const stripped = { ...objects };
    delete stripped[objectName];
    return { ...ps, objects: stripped };
  });
  return { ...asStack, permissions };
}

const navFindings = (s: AnyRec) => validateNavAccess(s).filter((f) => f.rule === NAV_OBJECT_UNGRANTED);
const detailFindings = (s: AnyRec) =>
  validateSecurityPosture(s).filter((f) => f.rule === SECURITY_MASTER_DETAIL_UNGRANTED);

describe('showcase navigation and detail objects are granted (#14453)', () => {
  it('every navigable object is readable through some declared permission set', () => {
    const offenders = navFindings(asStack).map((f) => `${f.where} -> ${f.path}`);
    expect(
      offenders,
      `nav entries exposing an object no permission set grants read on:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('every master-detail child holds an object-level CRUD grant', () => {
    const offenders = detailFindings(asStack).map((f) => `${f.where} -> ${f.path}`);
    expect(
      offenders,
      `detail objects with no object-level CRUD grant:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  // ── Controls ─────────────────────────────────────────────────────────────
  // Without these the two assertions above could go green because the rules
  // stopped finding anything at all — a rule renamed, an exemption widened, a
  // stack shape the collector no longer walks. Each control removes ONE real
  // grant and demands the corresponding rule name that exact object back.

  it('CONTROL: dropping the grant on a nav object makes the nav rule fire on it', () => {
    const findings = navFindings(withoutGrant('showcase_cascade'));
    // Matched by CONTENT, not by position: on a tree where more than one grant
    // is missing this must still be a statement about `showcase_cascade`.
    expect(findings.map((f) => f.path)).toContain('apps[0].navigation[3].children[11].objectName');
    expect(findings.map((f) => f.message).join('\n')).toContain(
      'navigation exposes object "showcase_cascade"',
    );
  });

  it('CONTROL: dropping the grant on a detail child makes the master-detail rule fire on it', () => {
    const findings = detailFindings(withoutGrant('showcase_expense_line'));
    expect(findings.map((f) => f.where)).toContain('object "showcase_expense_line"');
    expect(findings.map((f) => f.message).join('\n')).toContain(
      'detail object "showcase_expense_line" (master_detail "expense_report" → ' +
        '"showcase_expense_report") has no object-level CRUD grant',
    );
  });
});
