/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — `DashboardComponentSchema.aria` (objectui#5830).
 *
 * The spec removed `dashboard.aria` at the #3896 audit close-out ("no
 * dashboard renderer ever applied it"): `DashboardSchema.shape.aria` in
 * `@objectstack/spec/ui` is a tombstone that refuses any value and tells
 * authors to delete the key. objectui's Zod twin inherits that refusal by
 * reference (`SpecDashboardFields`, `zod/complex.zod.ts` — `aria` is not in
 * its exclusion list), and `packages/plugin-dashboard/src` has no
 * `schema.aria` read site (pinned by that package's
 * `dashboardAuthoredInputs.test.tsx`). The TS interface was the last surface
 * still DECLARING the key — under a comment claiming alignment with
 * `AriaPropsSchema`, the opposite of the contract: the member-level instance
 * of #4631's "declared surfaces disagree".
 *
 * What the deletion changed at the type level, stated honestly: `BaseSchema`
 * carried `[key: string]: any` then, so after the removal an authored `aria:` on a
 * dashboard literal still COMPILED — it fell to the index signature, and a
 * `@ts-expect-error` pin on an authored literal could not stick.
 *
 * objectui#9736 closed that half. The interface now extends the spec's own
 * `Dashboard` input type (`Omit< Dashboard, … >` over the exclusion list its
 * mirror reads), so it inherits the spec's tombstone as a DECLARED member typed
 * as the spec's retired key (the branded `[REMOVED]` mark at the pinned 18.1.0
 * and on objectstack `main`, bare `undefined` through 17.5.0) — `aria` is back in the declared key
 * set, but only as a refusal,
 * and an authored value is a compile error: the same verdict the Zod twin gives
 * at parse. The pins below assert exactly that, with the former neighbours as
 * the control. Real enforcement because `packages/types/tsconfig.test.json` is
 * chained from this package's `type-check` script (#3009).
 */

import { describe, it, expect } from 'vitest';
import type { DashboardComponentSchema } from '../complex';
import type { IsRetiredKeyType } from './retired-key-type';
import { DashboardComponentSchema as DashboardComponentZodSchema } from '../zod/index.zod';

// Literal (declared) keys of T: `string extends K` is true only for the index
// signature's key, so mapping it to `never` leaves exactly the authored members.
type DeclaredKeys<T> = { [K in keyof T as string extends K ? never : K]: T[K] };
type Declared = keyof DeclaredKeys<DashboardComponentSchema>;

describe('the TS interface declares `aria` only as the spec tombstone (objectui#5830, objectui#9736)', () => {
  it('`aria` is declared, typed as the spec\'s retired key; the neighbours it stood beside still are', () => {
    // Type-level pins, erased at runtime. `aria` is a DECLARED key again — the
    // spec projection carries the tombstone — and its type admits no value:
    // the branded `[REMOVED]` mark at the pinned 18.1.0 and on objectstack
    // `main`, bare `undefined` through 17.5.0 (both spellings are
    // `retired-key-type.ts`'s, objectui#11330).
    const ariaDeclared: 'aria' extends Declared ? true : false = true;
    const ariaAdmitsNoValue: IsRetiredKeyType<DashboardComponentSchema['aria']> extends true ? true : false = true;
    // The control for the line above, through the same helper: a live
    // neighbour is NOT a retired-key type.
    const widgetsIsLive: IsRetiredKeyType<DashboardComponentSchema['widgets']> extends false ? true : false = true;
    // Positive controls through the same extraction: a probe that saw no
    // members at all would also report `aria` absent.
    const widgetsDeclared: 'widgets' extends Declared ? true : false = true;
    const dateRangeDeclared: 'dateRange' extends Declared ? true : false = true;
    expect(ariaDeclared && ariaAdmitsNoValue && widgetsIsLive && widgetsDeclared && dateRangeDeclared).toBe(true);
  });

  it('an authored `aria` value is a compile error — no longer absorbed by the index signature', () => {
    const legal: DashboardComponentSchema = { type: 'dashboard', widgets: [] };
    // @ts-expect-error — `aria` is the spec's retirement tombstone (objectui#9736).
    const authored: DashboardComponentSchema = { type: 'dashboard', widgets: [], aria: { ariaLabel: 'Ops' } };
    expect([legal.type, authored.type]).toEqual(['dashboard', 'dashboard']);
  });
});

describe('the Zod twin refuses the key by name — the spec tombstone, inherited by reference', () => {
  const legal = { type: 'dashboard' as const, widgets: [] };

  it('a legal dashboard parses green — the control for the refusal below', () => {
    expect(DashboardComponentZodSchema.safeParse(legal).success).toBe(true);
  });

  it('an arbitrary unknown key does not refuse — the red below is the tombstone, not strictness', () => {
    // BaseSchema is not `.strict()`: an undeclared key rides through (or is
    // stripped) but never refuses. So a red `aria` can only come from the
    // DECLARED tombstone flowing in from the spec — the thing being pinned.
    const r = DashboardComponentZodSchema.safeParse({ ...legal, objectui5830NotAKey: 'x' });
    expect(r.success).toBe(true);
  });

  it('`aria` is refused at its own path, with the removal message', () => {
    const r = DashboardComponentZodSchema.safeParse({ ...legal, aria: { ariaLabel: 'Ops' } });
    expect(r.success).toBe(false);
    if (r.success) return;
    const issue = r.error.issues.find((i) => i.path.join('.') === 'aria');
    expect(issue, 'no issue at path `aria`').toBeTruthy();
    expect(issue!.message).toMatch(/removed/);
  });
});
