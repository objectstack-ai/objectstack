// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21464, stage 3] Four of the form family's nine `z.unknown()` members are
 * typed: `object-form` `contentLayout`, `submitBehavior`, `navigateOnSuccess`
 * and `mobile`. The other five stayed in the enumeration pin's ledger: the
 * form's `fields` and `sections` and the master-detail form's two were held,
 * because the form drew a value each typed shape would refuse (a `{ name }`
 * field entry; an inline runtime field inside a section), and `customFields`
 * waited with the objectui-held contracts (its entries are objectui's runtime
 * `FormField`, which the spec has not declared). The S-objectui-held stage
 * typed both forms' `fields` as field names once objectui retired the
 * `{ name }` entry (`component-objectui-held-typed-members.pin.test.ts`), and
 * held `customFields` and both `sections` as forks: the runtime form field has
 * more than one viable spec shape.
 *
 * ## The defect this file closes
 *
 * Each of the four is read with one shape (measured at the `.objectui-sha` pin
 * `89cad75d55`; the read points are in the members' docblocks), and the row
 * declared them `z.unknown()`. So a `submitBehavior` whose `kind` the form does
 * not know, a `contentLayout: 'tabs'`, a numeric `navigateOnSuccess` and a
 * misspelled `mobile` member all passed the component-props gate, and the form
 * fell back to its thank-you panel, stacked the sections, threw after the
 * record was written, or ignored the key — with no report.
 *
 * ## What is pinned, and why each half
 *
 * - §1 THE DECLARED SHAPES PARSE: every shape a measured writer authors parses
 *   byte-identical — none of the four carries a default, so the parsed value
 *   IS the authored one. A refusal pin with no lit control passes just as well
 *   when the door refuses everything.
 * - §2 THE REFUSALS: an off-shape value of each member is refused with the
 *   code AND the path, so a refusal for the wrong reason reds.
 * - §3 ONE SCHEMA: `submitBehavior` holds the form view's own def by identity,
 *   and the two shapes declared here hold exactly the measured vocabulary.
 * - §4 THE REGISTRATION: the ADR-0087 D3 entry step 18 carries.
 *
 * The enumeration pin (`component-props-unknown-members.pin.test.ts`) holds the
 * other half: these four left its ledger, so a member reverted to
 * `z.unknown()` reds there.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';

import { ComponentPropsMap, ObjectFormPropsSchema } from './component.zod';
import { FormViewSchema } from './view.zod';
import { MIGRATIONS_BY_MAJOR } from '../migrations/registry';

const BASE = { objectName: 'account' } as const;
const parse = (props: Record<string, unknown>) => ComponentPropsMap['object-form'].safeParse({ ...BASE, ...props });

/** The issue codes and paths a refusal carries, so a refusal for the WRONG reason reds. */
function issues(result: z.ZodSafeParseResult<unknown>): { code: string; path: string }[] {
  if (result.success) return [];
  return result.error.issues.map((i) => ({ code: i.code, path: i.path.join('.') }));
}

// ───────────────────────────────────────────────────────────────────────────
// §1 the declared shapes parse
// ───────────────────────────────────────────────────────────────────────────

describe('§1 each member accepts every shape a measured writer authors', () => {
  const BYTE_IDENTICAL: ReadonlyArray<readonly [label: string, props: Record<string, unknown>]> = [
    ['contentLayout \'tabbed\'', { contentLayout: 'tabbed' }],
    ['contentLayout \'simple\'', { contentLayout: 'simple' }],
    // The showcase's own wizard page (`examples/app-showcase/src/ui/pages/new-project-wizard.page.ts`).
    ['a thank-you panel with a title and a message', {
      submitBehavior: { kind: 'thank-you', title: 'Project created', message: 'Your new project is ready.' },
    }],
    ['a bare thank-you panel', { submitBehavior: { kind: 'thank-you' } }],
    ['a relative redirect with a delay', { submitBehavior: { kind: 'redirect', url: '/apps/x/done', delayMs: 241 } }],
    ['a redirect interpolating declared record fields', {
      submitBehavior: { kind: 'redirect', url: '/t/{{record.slug}}?ref={{record.id}}' },
    }],
    ['continue', { submitBehavior: { kind: 'continue' } }],
    ['next-record', { submitBehavior: { kind: 'next-record' } }],
    ['a navigateOnSuccess template', { navigateOnSuccess: '/apps/x/o/record/{id}' }],
    ['mobile fullscreenLongText', { mobile: { fullscreenLongText: true } }],
    ['mobile stickyActions', { mobile: { stickyActions: true } }],
    ['an empty mobile block (its presence marks the wrapper)', { mobile: {} }],
    ['mobile stepper true with a minimum', { mobile: { stepper: true, stepperMinFields: 99 } }],
    ['mobile stepper auto with a minimum', { mobile: { stepper: 'auto', stepperMinFields: 3 } }],
    ['mobile stepper with fields per step', { mobile: { stepper: true, stepperFieldsPerStep: 2 } }],
    ['mobile stepper false', { mobile: { stepper: false } }],
  ];

  for (const [label, props] of BYTE_IDENTICAL) {
    it(`parses ${label}, byte-identical`, () => {
      const r = parse(props);
      expect(issues(r)).toEqual([]);
      expect(r.success && r.data).toStrictEqual({ ...BASE, ...props });
    });
  }

  it('an absent member stays absent', () => {
    const r = parse({});
    expect(issues(r)).toEqual([]);
    expect(r.success && Object.keys(r.data)).toEqual(['objectName']);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §2 the refusals
// ───────────────────────────────────────────────────────────────────────────

describe('§2 each member refuses an off-shape value', () => {
  const REFUSED: ReadonlyArray<readonly [label: string, props: Record<string, unknown>, code: string, path: string]> = [
    ['a contentLayout outside the two', { contentLayout: 'tabs' }, 'invalid_value', 'contentLayout'],
    ['a contentLayout object', { contentLayout: { mode: 'tabbed' } }, 'invalid_value', 'contentLayout'],
    ['a submitBehavior kind the form does not know', { submitBehavior: { kind: 'toast' } }, 'invalid_union', 'submitBehavior.kind'],
    ['a submitBehavior with no kind', { submitBehavior: { title: 'Done' } }, 'invalid_union', 'submitBehavior.kind'],
    ['a bare-string submitBehavior', { submitBehavior: 'thank-you' }, 'invalid_type', 'submitBehavior'],
    ['a protocol-relative redirect', { submitBehavior: { kind: 'redirect', url: '//example.com/thanks' } }, 'custom', 'submitBehavior.url'],
    ['an absolute redirect', { submitBehavior: { kind: 'redirect', url: 'https://app.example.com/thanks' } }, 'custom', 'submitBehavior.url'],
    ['a negative redirect delay', { submitBehavior: { kind: 'redirect', url: '/done', delayMs: -1 } }, 'too_small', 'submitBehavior.delayMs'],
    ['a thank-you `heading`', { submitBehavior: { kind: 'thank-you', heading: 'Done' } }, 'unrecognized_keys', 'submitBehavior'],
    ['options on continue', { submitBehavior: { kind: 'continue', title: 'Again' } }, 'unrecognized_keys', 'submitBehavior'],
    ['a numeric navigateOnSuccess', { navigateOnSuccess: 42 }, 'invalid_type', 'navigateOnSuccess'],
    ['an object navigateOnSuccess', { navigateOnSuccess: { url: '/x' } }, 'invalid_type', 'navigateOnSuccess'],
    ['a stepper outside true / false / auto', { mobile: { stepper: 'yes' } }, 'invalid_union', 'mobile.stepper'],
    ['a mobile member the form does not read', { mobile: { sticky: true } }, 'unrecognized_keys', 'mobile'],
    ['zero fields per step', { mobile: { stepper: true, stepperFieldsPerStep: 0 } }, 'too_small', 'mobile.stepperFieldsPerStep'],
    ['a fractional minimum', { mobile: { stepperMinFields: 2.5 } }, 'invalid_type', 'mobile.stepperMinFields'],
    ['a boolean mobile', { mobile: true }, 'invalid_type', 'mobile'],
  ];

  for (const [label, props, code, path] of REFUSED) {
    it(`refuses ${label} — ${code} at ${path}`, () => {
      const r = parse(props);
      expect(r.success).toBe(false);
      expect(issues(r)).toEqual([{ code, path }]);
    });
  }

  it('says a thank-you `heading` is its `title`', () => {
    const r = parse({ submitBehavior: { kind: 'thank-you', heading: 'Done' } });
    expect(r.success ? '' : r.error.issues[0]!.message).toMatch(/`heading` → `title`/);
  });

  it('LIT CONTROL — an unknown top-level key is still refused at the row itself', () => {
    expect(issues(parse({ contentLayout: 'tabbed', notAFormKey: 1 }))).toEqual([{ code: 'unrecognized_keys', path: '' }]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §3 one schema, not a copy of its shape
// ───────────────────────────────────────────────────────────────────────────

describe('§3 the members hold the form view\'s own def, and the measured vocabulary', () => {
  const form = () => ObjectFormPropsSchema.shape;

  it('submitBehavior is the form view\'s own member — the same def', () => {
    expect(form().submitBehavior.unwrap()._zod.def).toBe(FormViewSchema.shape.submitBehavior.unwrap()._zod.def);
  });

  it('contentLayout declares exactly the read\'s two layouts', () => {
    expect([...form().contentLayout.unwrap().options].sort()).toEqual(['simple', 'tabbed']);
  });

  it('a mobile block declares exactly the five members the form reads', () => {
    expect(Object.keys(form().mobile.unwrap().shape).sort())
      .toEqual(['fullscreenLongText', 'stepper', 'stepperFieldsPerStep', 'stepperMinFields', 'stickyActions']);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §4 the registration
// ───────────────────────────────────────────────────────────────────────────

describe('§4 the ADR-0087 entry', () => {
  it('is registered as the D3 entry step 18 carries, beside the earlier stages\' entries', () => {
    const ids = MIGRATIONS_BY_MAJOR[18]!.semantic.map((s) => s.id);
    expect(ids).toContain('ui-object-form-members-typed');
    expect(ids).toContain('ui-object-grid-kanban-calendar-list-members-typed');
    expect(ids).toContain('ui-object-map-gantt-tree-navigation-typed');
  });
});
