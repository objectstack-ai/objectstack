/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * A form view may not name the `features` scope root in a predicate
 * (objectui#6262, ruled 2026-08-27, option B). Held here against the
 * INSTALLED `@objectstack/spec`, because `FormPage`'s predicate-scope comment
 * rests on it.
 *
 * Why it matters to that route: `/forms/:name` binds `features` to `{}`
 * (`InternalFormRoute` hands `ExpressionProvider` a user and nothing else) and
 * `/f/:slug` binds no scope at all. So a `features.*` predicate faults on both,
 * and `visibleWhen` fails OPEN there while the same text resolves inside an app.
 * The ruling closed that split in the vocabulary instead of wiring
 * `/auth/config` into the route: the spec refuses the root at parse on every
 * form-view predicate. If a spec bump ever loosens that, this file goes red
 * beside the comment that relies on it, instead of leaving the comment to
 * describe a rule that no longer exists.
 *
 * The two schemas are the ones metadata-admin's `view` gates resolve in
 * `validateMetadataDraft` (`clientValidation.ts`): `ViewItemSchema` for a
 * create draft that carries `viewKind`, and `ViewMetadataSchema` on edit. That
 * file's `view` loader note says why the edit gate is the schema the server's
 * save runs. The body is the ExpandedViewItem envelope `/forms/:name` loads.
 *
 * What this file does NOT hold: it parses those schemas directly and never
 * calls `validateMetadataDraft`, which `@object-ui/app-shell` does not export.
 * The gates' own behaviour is pinned in `clientValidation.viewShapes.test.ts`.
 * The refusal was measured through `validateMetadataDraft` in both modes once,
 * for objectui#6262, and got the same verdicts. Nothing here re-derives that
 * half.
 *
 * The control is load-bearing. The same body with a `current_user.*` predicate
 * must parse clean, so a refused target is about the root and not about a body
 * the schema rejects for some other reason.
 */
import { describe, it, expect } from 'vitest';
import { ViewItemSchema, ViewMetadataSchema } from '@objectstack/spec/ui';

/** The excluded root, in the shape the ruling was about. */
const TARGET = 'features.multiOrgEnabled';
/** A root form views keep: must parse clean in the identical body. */
const CONTROL = "current_user.role == 'admin'";

/** Field-level predicate, in the envelope `/forms/:name` loads. */
const fieldLevel = (predicate: string) => ({
  name: 'account.intake',
  object: 'account',
  viewKind: 'form',
  label: 'Intake',
  config: {
    type: 'simple',
    sections: [{ label: 'Main', fields: [{ field: 'name', visibleWhen: predicate }] }],
  },
});

/** Section-level predicate, same envelope. */
const sectionLevel = (predicate: string) => ({
  name: 'account.intake',
  object: 'account',
  viewKind: 'form',
  label: 'Intake',
  config: {
    type: 'simple',
    sections: [{ label: 'Main', visibleWhen: predicate, fields: ['name'] }],
  },
});

const GATES = [
  ['ViewItemSchema (create gate)', ViewItemSchema],
  ['ViewMetadataSchema (edit gate)', ViewMetadataSchema],
] as const;

const SURFACES = [
  ['field', fieldLevel, ['config', 'sections', 0, 'fields', 0, 'visibleWhen']],
  ['section', sectionLevel, ['config', 'sections', 0, 'visibleWhen']],
] as const;

describe('form-view predicates may not name the `features` root (objectui#6262)', () => {
  describe.each(GATES)('%s', (_gate, schema) => {
    it.each(SURFACES)('%s-level: a `current_user.*` predicate parses clean (control)', (_surface, build) => {
      const parsed = schema.safeParse(build(CONTROL));
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    });

    it.each(SURFACES)('%s-level: a `features.*` predicate is refused at that predicate', (_surface, build, path) => {
      const parsed = schema.safeParse(build(TARGET));
      expect(parsed.success).toBe(false);
      const issues = parsed.error?.issues ?? [];
      // Exactly one issue: the control proves the rest of the body is clean,
      // so anything beyond the refusal would be a second, unrelated rejection.
      expect(issues, JSON.stringify(issues)).toHaveLength(1);
      expect(issues[0].code).toBe('custom');
      expect(issues[0].path).toEqual(path);
      // `custom` is shared by every refinement on the form view; the named
      // subject is what says this is the root refusal and not another one.
      expect(issues[0].message).toContain('`features.*`');
    });
  });
});
