// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#12665 — form-view predicates loudly reject the `features.*`
 * scope root (ruled 2026-08-27 on objectui#6262, option B: vocabulary
 * narrowing).
 *
 * ## What is being pinned
 *
 * One authored form view is served on two kinds of route, and `features.*`
 * used to get two verdicts from the same predicate text: bound to the real
 * auth-config flags inside an app, UNBOUND on the standalone form routes
 * (`/forms/:name`, `/f/:slug`) — where the predicate faults and `visibleWhen`
 * fails OPEN, showing the feature-gated field to everyone. The ruling narrows
 * the form-view predicate vocabulary at the authoring door instead of
 * building app-context parity machinery for a root with zero measured
 * consumers.
 *
 * ## Why every refusal asserts the MESSAGE, not just failure
 *
 * Same rule as `view-submit-redirect-url.test.ts`: a bare
 * `expect(success).toBe(false)` carries one bit, and this narrowing has two —
 * *that* the root is refused, and *what the author is told to write instead*.
 * Each refusal pins the issue's `code`/`path` (the identity a machine
 * consumer branches on) plus the prescription and the ruling reference (what
 * an author — human or AI — acts on).
 *
 * ## Acceptance is pinned as hard as refusal
 *
 * A root scanner written slightly too wide is indistinguishable from a
 * correct one until `record.features.enabled` (a record FIELD named
 * `features`) stops parsing. The accepted shapes below are the half that says
 * the scanner narrowed exactly as far as the ruling and no further — and the
 * app-context cases pin that no other predicate surface moved.
 */

import { describe, it, expect } from 'vitest';

import { FormViewSchema } from './view.zod';
import { PageComponentSchema } from './page.zod';
import { BulkActionDefSchema } from './bulk-action.zod';

/** Reject `value` through FormViewSchema and return its issues (parsed, not stringified). */
function reject(value: unknown): Array<{ code: string; path: Array<string | number>; message: string }> {
  const r = FormViewSchema.safeParse(value);
  expect(r.success, `expected REJECTION, got a successful parse of ${JSON.stringify(value)}`).toBe(false);
  return (r.error?.issues ?? []) as Array<{ code: string; path: Array<string | number>; message: string }>;
}

/** Parse `value` through FormViewSchema and fail loudly (with the issues) if it does not succeed. */
function accept(value: unknown): unknown {
  const r = FormViewSchema.safeParse(value);
  expect(r.success, `expected ACCEPTANCE, got ${JSON.stringify(r.error?.issues ?? '')}`).toBe(true);
  return r.data!;
}

/** The one refusal this narrowing emits, located at `path`. */
function expectFeaturesRefusal(
  issues: Array<{ code: string; path: Array<string | number>; message: string }>,
  path: Array<string | number>,
) {
  const issue = issues.find(i => JSON.stringify(i.path) === JSON.stringify(path));
  expect(issue, `expected a refusal at ${JSON.stringify(path)}, got ${JSON.stringify(issues)}`).toBeDefined();
  expect(issue!.code).toBe('custom');
  // The identity an author (and an AI author's retry loop) acts on: the root,
  // the surface, the fail-open reason, the ruling, and the prescription.
  expect(issue!.message).toContain('Form-view predicates may not name the `features.*` scope root');
  expect(issue!.message).toContain('ruled 2026-08-27 on objectui#6262');
  expect(issue!.message).toContain('UNBOUND');
  expect(issue!.message).toContain('fails OPEN');
  expect(issue!.message).toContain('`record.*`');
}

/** A minimal form view with one predicate-bearing field. */
const formWithFieldPredicate = (visibleWhen: unknown) => ({
  type: 'simple',
  sections: [{ fields: [{ field: 'phone', visibleWhen }] }],
});

describe('form-view predicates reject the features.* root (objectui#6262)', () => {
  it('refuses a field-level visibleWhen naming features.* (bare-string shorthand)', () => {
    const issues = reject(formWithFieldPredicate('features.multiOrgEnabled == true'));
    expectFeaturesRefusal(issues, ['sections', 0, 'fields', 0, 'visibleWhen']);
  });

  it('refuses the full Expression envelope form too', () => {
    const issues = reject(
      formWithFieldPredicate({ dialect: 'cel', source: 'features.phoneNumber' }),
    );
    expectFeaturesRefusal(issues, ['sections', 0, 'fields', 0, 'visibleWhen']);
  });

  it('refuses a section-level visibleWhen naming features.*', () => {
    const issues = reject({
      type: 'simple',
      sections: [{ visibleWhen: 'features.beta == true', fields: ['name'] }],
    });
    expectFeaturesRefusal(issues, ['sections', 0, 'visibleWhen']);
  });

  it('refuses the deprecated visibleOn alias — the fold cannot smuggle the root past the scan', () => {
    // ADR-0089 D2 folds `visibleOn` into `visibleWhen` at the field parse,
    // BEFORE this refinement runs — so the alias spelling arrives at the
    // scanner as the canonical key and is refused at that key's path.
    const issues = reject({
      type: 'simple',
      sections: [{ fields: [{ field: 'phone', visibleOn: 'features.phoneNumber == true' }] }],
    });
    expectFeaturesRefusal(issues, ['sections', 0, 'fields', 0, 'visibleWhen']);
  });

  it('refuses the root inside the legacy `groups` bucket (pre-fold)', () => {
    const issues = reject({
      type: 'simple',
      groups: [{ fields: [{ field: 'phone', visibleWhen: 'features.phoneNumber' }] }],
    });
    expectFeaturesRefusal(issues, ['groups', 0, 'fields', 0, 'visibleWhen']);
  });

  it('refuses the root on a nested sub-field (repeater/composite recursion)', () => {
    const issues = reject({
      type: 'simple',
      sections: [{
        fields: [{
          field: 'lines',
          type: 'repeater',
          fields: [{ field: 'discount', visibleWhen: 'features.discounting == true' }],
        }],
      }],
    });
    expectFeaturesRefusal(
      issues,
      ['sections', 0, 'fields', 0, 'fields', 0, 'visibleWhen'],
    );
  });

  it('refuses the root on a per-option visibleWhen authored inline in the form view', () => {
    const issues = reject({
      type: 'simple',
      sections: [{
        fields: [{
          field: 'channel',
          type: 'select',
          options: [
            { value: 'email', label: 'Email' },
            { value: 'sms', label: 'SMS', visibleWhen: 'features.smsEnabled == true' },
          ],
        }],
      }],
    });
    expectFeaturesRefusal(
      issues,
      ['sections', 0, 'fields', 0, 'options', 1, 'visibleWhen'],
    );
  });

  it('refuses index access and the bare root, not only dotted member access', () => {
    const bracket = reject(formWithFieldPredicate("features['beta'] == true"));
    expectFeaturesRefusal(bracket, ['sections', 0, 'fields', 0, 'visibleWhen']);

    const bare = reject(formWithFieldPredicate('features != null'));
    expectFeaturesRefusal(bare, ['sections', 0, 'fields', 0, 'visibleWhen']);

    const inCall = reject(formWithFieldPredicate('has(features.beta) && record.active'));
    expectFeaturesRefusal(inCall, ['sections', 0, 'fields', 0, 'visibleWhen']);
  });

  it("refuses on type: 'split' forms too — the exclusion has no per-type gap", () => {
    // The same refinement hosts the split-only `pane` check behind a type
    // guard; this pins that the features scan did NOT inherit that guard.
    const issues = reject({
      type: 'split',
      sections: [
        { pane: 'primary', fields: ['name'] },
        { pane: 'secondary', fields: [{ field: 'phone', visibleWhen: 'features.x' }] },
      ],
    });
    expectFeaturesRefusal(issues, ['sections', 1, 'fields', 0, 'visibleWhen']);
  });
});

describe('positive controls — the scanner narrows exactly as far as the ruling', () => {
  it('an equivalent predicate on a permitted root still validates', () => {
    accept(formWithFieldPredicate("record.priority == 'urgent'"));
    accept({
      type: 'simple',
      sections: [{ visibleWhen: "record.status != 'cancelled'", fields: ['name'] }],
    });
  });

  it('a record FIELD named `features` is member access, not the scope root — accepted', () => {
    accept(formWithFieldPredicate('record.features.enabled == true'));
    accept(formWithFieldPredicate("data.features == 'on'"));
  });

  it('a longer identifier that merely starts with `features` is not the root — accepted', () => {
    accept(formWithFieldPredicate('record.features_enabled == true'));
  });

  it('the word inside a string literal is data, not a root reference — accepted', () => {
    accept(formWithFieldPredicate("record.tag == 'features.beta'"));
    accept(formWithFieldPredicate('record.tag == "features"'));
  });

  it('an AST-only envelope is opaque at this layer and passes (documented boundary)', () => {
    // The authoring shape is the source string; build emits ASTs from sources
    // this gate already accepted. An AST-only envelope has nothing to scan.
    accept(formWithFieldPredicate({ dialect: 'cel', ast: { kind: 'ident', name: 'record' } }));
  });
});

describe('app-context surfaces keep features.* exactly as-is', () => {
  it('a page component visibleWhen naming features.* still parses', () => {
    const r = PageComponentSchema.safeParse({
      type: 'record:detail',
      visibleWhen: 'features.multiOrgEnabled == true',
    });
    expect(r.success, JSON.stringify(r.success ? '' : r.error?.issues)).toBe(true);
  });

  it('a bulk-action eligibility predicate naming features.* still parses', () => {
    const r = BulkActionDefSchema.safeParse({
      name: 'notify',
      label: 'Notify',
      operation: 'update',
      patch: { notified: true },
      visible: 'features.notifications != false',
    });
    expect(r.success, JSON.stringify(r.success ? '' : r.error?.issues)).toBe(true);
  });
});
