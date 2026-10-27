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
 * as the spec's retired key (the branded `[REMOVED]` mark at the pinned 18.1.0,
 * bare `undefined` through 17.5.0) — `aria` was back in the declared key set,
 * but only as a refusal, and an authored value a compile error: the same
 * verdict the Zod twin gave at parse.
 *
 * objectstack#25767 (spec 18.2, ADR-0087) aged the ≤16.x tombstones out of the
 * spec one major on. `DashboardSchema` no longer declares `aria` at all: the
 * strict container refuses it as an unknown key, at the dashboard's own path,
 * naming the key and the protocol upgrade guide. The projection carries nothing
 * under the name, so both twins now carry the refusal as their OWN: `aria?:
 * never` on the interface, `agedOutSpecKeyRefusal` on the Zod twin (whose
 * `.passthrough()` base would otherwise turn a two-major refusal into a silent
 * KEEP). The pins below assert exactly that — declared, unwritable, refused at
 * its own path with the console's message — with the former neighbours as the
 * control and the spec's own refusal as the contract leg. Real enforcement
 * because `packages/types/tsconfig.test.json` is chained from this package's
 * `type-check` script (#3009).
 */

import { describe, it, expect } from 'vitest';
import { DashboardSchema as SpecDashboardSchema } from '@objectstack/spec/ui';
import type { DashboardComponentSchema } from '../complex';
import type { IsRetiredKeyType } from './retired-key-type';
import { DashboardComponentSchema as DashboardComponentZodSchema } from '../zod/index.zod';

// Literal (declared) keys of T: `string extends K` is true only for the index
// signature's key, so mapping it to `never` leaves exactly the authored members.
type DeclaredKeys<T> = { [K in keyof T as string extends K ? never : K]: T[K] };
type Declared = keyof DeclaredKeys<DashboardComponentSchema>;

describe('the TS interface declares `aria` only as a refusal — its own, since the spec tombstone aged out (objectui#5830, objectui#9736, objectstack#25767)', () => {
  it('`aria` is declared and admits no value; the neighbours it stood beside still are live', () => {
    // Type-level pins, erased at runtime. Through spec 18.1 `aria` was a
    // DECLARED key typed as the spec's retired key (the branded `[REMOVED]`
    // mark, bare `undefined` through 17.5.0 — both `retired-key-type.ts`'s
    // spellings, objectui#11330). At 18.2 the tombstone aged out of the spec
    // (objectstack#25767), so the projection carries nothing under the name
    // and the member is this face's own `aria?: never` — which the same
    // helper reads as a retired-key type (`undefined`, the pinned spelling).
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

  it('an authored `aria` value is a compile error — the member is `never`, and no index signature absorbs it', () => {
    const legal: DashboardComponentSchema = { type: 'dashboard', widgets: [] };
    // @ts-expect-error — `aria` is this face's own `?: never` refusal: the spec tombstone it projected aged out (objectstack#25767), and no index signature absorbs it (objectui#9736).
    const authored: DashboardComponentSchema = { type: 'dashboard', widgets: [], aria: { ariaLabel: 'Ops' } };
    expect([legal.type, authored.type]).toEqual(['dashboard', 'dashboard']);
  });
});

describe('the Zod twin refuses `aria` by name — its own arm now; the spec contract refuses it as an unknown key', () => {
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

  it('`aria` is refused at its own path, with the console\'s own message naming the key, the guide and the cut', () => {
    // Through 18.1 the refusal was the spec's tombstone, inherited by
    // reference (`/removed/` in the message). The twin is `.passthrough()`,
    // so once the projection stopped carrying the name only an arm of its own
    // keeps the verdict: `agedOutSpecKeyRefusal` (`zod/tombstone.zod.ts`),
    // `invalid_type` at `aria`, opening with the sentence the spec answers the
    // key with. Pinned on the message's three anchors so a twin that quietly
    // dropped the arm (a silent keep) or restated the spec's gone tombstone
    // goes red by name.
    const r = DashboardComponentZodSchema.safeParse({ ...legal, aria: { ariaLabel: 'Ops' } });
    expect(r.success).toBe(false);
    if (r.success) return;
    const issue = r.error.issues.find((i) => i.path.join('.') === 'aria');
    expect(issue, 'no issue at path `aria`').toBeTruthy();
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.message).toContain('Unrecognized key(s) on this dashboard: `aria`');
    expect(issue!.message).toContain('https://objectstack.ai/docs/protocol-upgrade');
    expect(issue!.message).toContain('objectstack#25767');
    expect(issue!.message).not.toMatch(/\[REMOVED\]/);
  });

  it('the spec contract refuses `aria` as an unknown key at the dashboard\'s path, naming it and the upgrade guide (objectstack#25767)', () => {
    // The contract leg: where the refusal lives now. `DashboardSchema` is
    // `.strict()`, so the aged-out key meets the unknown-key refusal — one
    // issue at the root, `unrecognized_keys`, naming the key and the protocol
    // upgrade guide an author of a ≤16.x document is sent to.
    const r = SpecDashboardSchema.safeParse({ name: 'ops', label: 'Ops', widgets: [], aria: { ariaLabel: 'Ops' } });
    expect(r.success).toBe(false);
    if (r.success) return;
    const issue = r.error.issues.find((i) => i.path.length === 0 && i.message.includes('`aria`'));
    expect(issue, 'no root issue naming `aria`').toBeTruthy();
    expect(issue!.code).toBe('unrecognized_keys');
    expect(issue!.message).toMatch(/Unrecognized key\(s\)/);
    expect(issue!.message).toContain('https://objectstack.ai/docs/protocol-upgrade');
    // Control: the same document without the key is the contract's own green.
    expect(SpecDashboardSchema.safeParse({ name: 'ops', label: 'Ops', widgets: [] }).success).toBe(true);
  });
});
