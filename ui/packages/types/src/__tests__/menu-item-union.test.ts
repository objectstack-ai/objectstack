/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `MenuItem` is a discriminated union (objectui#6523, maintainer ruling
 * 2026-08-27, "同意" on the triage A+B recommendation): a command item
 * (`label` required) or a divider (`separator: true`, no label). B — the
 * union — is the ruling's PRECONDITION for A (the renderer fix landing in
 * `packages/components`): a divider had to become representable before a
 * renderer could be taught to read it. `label` stays REQUIRED on the command
 * arm rather than becoming optional, which the ruling rejected because it
 * would weaken every command item's label protection to solve a problem only
 * the divider arm has.
 *
 * Both arms tombstone `type` (`?: never` on the TS side, `z.never().optional()`
 * on the zod mirror in `../zod/overlay.zod.ts`) — the undeclared key
 * `dropdown-menu.tsx`/`context-menu.tsx` used to branch on instead of the
 * declared `separator` boolean (`'separator'` for a divider, `'label'` for a
 * section heading). Retiring it needed a declared REFUSAL, not an absence:
 * `MenuItemSchema` is a bare (non-strict) `z.object`, so an undeclared key is
 * silently STRIPPED and the parse still reports success — which is why no
 * gate ever caught either renderer reading `type`. `z.never()` makes
 * authoring it fail loudly instead.
 *
 * ## Why the `@ts-expect-error` pins below route through a NAMED, non-fresh value
 *
 * A FRESH object literal assigned to a typed variable is checked twice by
 * `tsc`: excess-property checking (is every key on the literal declared
 * SOMEWHERE on the target type?) and ordinary assignability (does each
 * declared key's value match its declared type?). `type` IS declared here —
 * as `never` — so a fresh literal's rejection would not, by itself, prove the
 * `never` tombstone is doing the work: deleting the `type` declaration
 * entirely would produce the SAME visible failure (a different error code,
 * TS2353 "object literal may only specify known properties", on the exact
 * same literal). Assigning a NAMED variable of a structurally wider,
 * independently-declared shape sidesteps excess-property checking (it only
 * applies to fresh literals), so the failure below can only be the `never`
 * assignability check on a key both shapes agree exists — proof the
 * tombstone, not literal syntax, is what refuses it.
 */

import { describe, it, expect } from 'vitest';
import type { MenuItem, MenuCommandItem, MenuDividerItem } from '../overlay';
import { MenuItemSchema } from '../zod/overlay.zod';

/* ── type-level pins ─────────────────────────────────────────────────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

// The divider arm declares exactly `separator` and the `type` tombstone — no
// command-only field (label, icon, onClick, shortcut, children, disabled)
// leaks in. If a future edit adds a field to `MenuDividerItem` without a
// deliberate decision, this line goes red rather than silently widening the
// "no label" arm the ruling specified.
type _DividerKeySet = Expect<Equal<keyof MenuDividerItem, 'separator' | 'type'>>;

/* ── the union itself ────────────────────────────────────────────────────── */

describe('MenuItem — discriminated union (objectui#6523)', () => {
  it('a command item requires `label`', () => {
    const item: MenuCommandItem = { label: 'New Tab' };
    expect(item.label).toBe('New Tab');
  });

  it('a divider is `{ separator: true }` alone — no label required', () => {
    // This line is the union's whole point: before objectui#6523,
    // `MenuItem.label` was required UNCONDITIONALLY (a single object shape),
    // so a label-less divider did not compile against it at all — exactly
    // the gap the ruling's "B is the precondition" step closed.
    const divider: MenuDividerItem = { separator: true };
    expect(divider.separator).toBe(true);
  });

  it("a divider has no `label` field to write — the command arm's protection survives", () => {
    const divider: MenuDividerItem = {
      separator: true,
      // @ts-expect-error a divider has no `label` — not an optional field
      // relaxed for convenience, it does not exist on this arm at all. This
      // is the "label-optional would weaken every command item" cost the
      // ruling named and chose the union specifically to avoid paying.
      label: 'not allowed',
    };
    expect(divider.separator).toBe(true);
  });

  describe('`type` is a declared refusal, not an absence (both arms)', () => {
    // Independently declared — NOT `MenuCommandItem & { type?: string }` —
    // because intersecting with a type that already tombstones `type` as
    // `never` would just collapse back to `never`. This shape shares the
    // discriminant key with the union but keeps `type` genuinely widened, so
    // the assignment below is a real test of the tombstone. See the file
    // header for why it must also be a NAMED value, not a fresh literal.
    interface LegacyCommandShape {
      label: string;
      type?: string;
    }
    interface LegacyDividerShape {
      separator: true;
      type?: string;
    }

    it('refuses `type` on the command arm', () => {
      const legacy: LegacyCommandShape = { label: 'New Tab', type: 'separator' };
      // @ts-expect-error `type` is TOMBSTONED (`?: never`) on `MenuCommandItem`
      // (objectui#6523) — `dropdown-menu`/`context-menu` used to read this
      // undeclared key instead of the declared `separator` boolean.
      const item: MenuItem = legacy;
      // Asserted off `legacy`, not the (union-typed) `item`: the point of
      // this test is that the ASSIGNMENT above is refused, and `item`'s
      // static type stays `MenuItem` regardless — reading a member-specific
      // field off it would need its own narrowing, which is not what this
      // test is pinning.
      expect(legacy.label).toBe('New Tab');
      void item;
    });

    it('refuses `type` on the divider arm', () => {
      const legacy: LegacyDividerShape = { separator: true, type: 'separator' };
      // @ts-expect-error same tombstone, the divider arm (objectui#6523).
      const item: MenuItem = legacy;
      expect(legacy.separator).toBe(true);
      void item;
    });
  });
});

/* ── the zod mirror agrees ───────────────────────────────────────────────── */

describe('MenuItemSchema — the zod mirror agrees with the TS union (objectui#6523)', () => {
  it('the declared divider spelling parses green — for the first time', () => {
    // Before objectui#6523, `MenuItem.label` was required with no way to
    // express a label-less divider, so this EXACT value — the menubar
    // renderer's own `defaultProps` divider (`menubar.tsx`'s `{ separator:
    // true }` entry) — failed a strict parse against the shipped type. The
    // shipped default did not satisfy the shipped type; this is the fix.
    const result = MenuItemSchema.safeParse({ separator: true });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ separator: true });
  });

  it('a bare object still fails — a command item requires `label`', () => {
    const result = MenuItemSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('`type: "separator"` is REFUSED, not silently stripped — the retired dialect', () => {
    // Before objectui#6523 this call SUCCEEDED and silently dropped `type`
    // from the parsed result — the "class-2 blindness" the card measured,
    // and the reason no gate ever caught `dropdown-menu`/`context-menu`
    // reading an undeclared key that the type never protected.
    const result = MenuItemSchema.safeParse({ label: 'New Tab', type: 'separator' });
    expect(result.success).toBe(false);
  });

  it('`type: "label"` — the renderers\' OTHER undeclared spelling — is refused the same way', () => {
    // `type` has no partial refusal: a `z.never()` tombstone cannot admit one
    // string value and reject another, so retiring the declared spelling's
    // impostor necessarily retires this one too (dropdown-menu/context-menu
    // also branched on `item.type === 'label'`, equally undeclared).
    const result = MenuItemSchema.safeParse({ label: 'Section', type: 'label' });
    expect(result.success).toBe(false);
  });

  it('the divider arm refuses `type` too', () => {
    const result = MenuItemSchema.safeParse({ separator: true, type: 'separator' });
    expect(result.success).toBe(false);
  });

  it('both tombstones carry their remediation text — and where a UNION puts it (objectui#6931)', () => {
    // Until objectui#6931 both arms answered with zod's generic
    // `"Invalid input: expected never, received string"`. They now carry the
    // #6523 guidance through `retirementTombstone()`, one string feeding the
    // parse message and `.describe()` alike.
    //
    // What a UNION does to that is pinned here rather than glossed: the
    // TOP-LEVEL issue is zod's own `invalid_union` at path `[]` with the
    // message `"Invalid input"`, and the guidance lives in the per-arm errors
    // hanging off it. A consumer that prints only top-level issues therefore
    // still shows `Invalid input` — a property of the union, not of the
    // tombstone. This records which half moved, so nobody later reads the
    // unchanged top-level message as the conversion having failed.
    const result = MenuItemSchema.safeParse({ label: 'New Tab', type: 'separator' });
    expect(result.success).toBe(false);
    if (result.success) return;

    const top = result.error.issues[0]!;
    expect(top.code).toBe('invalid_union');
    expect(top.path).toEqual([]);

    const armIssues = (
      (top as unknown as { errors?: { path: PropertyKey[]; code: string; message: string }[][] }).errors ?? []
    )
      .flat()
      .filter((i) => String(i.path[0]) === 'type');
    expect(armIssues.length, 'no arm reported an issue addressed to `type`').toBeGreaterThan(0);
    for (const issue of armIssues) {
      // Accept set untouched: `invalid_type`, exactly what the bare
      // `z.never()` reported. A `refine`-based helper would say `custom` here.
      expect(issue.code).toBe('invalid_type');
      expect(issue.message).not.toContain('Invalid input: expected never, received ');
      expect(issue.message).toContain('RETIRED (objectui#6523)');
    }

    // Non-vacuity, IN THIS TEST: both declared spellings still parse green in
    // the same run, so a schema that refused everything could not satisfy the
    // assertions above by accident.
    expect(MenuItemSchema.safeParse({ label: 'New Tab' }).success).toBe(true);
    expect(MenuItemSchema.safeParse({ separator: true }).success).toBe(true);
  });

  it('a live command item — label, icon, shortcut — still parses green', () => {
    const result = MenuItemSchema.safeParse({
      label: 'New Tab',
      icon: 'plus',
      shortcut: 'Ctrl+T',
    });
    expect(result.success).toBe(true);
  });

  it('`onClick` is a RUNTIME SLOT the mirror refuses by name — the function still parses on the TS face only (objectui#6124)', () => {
    // This case used to parse a live function GREEN. objectui#6124 replaced
    // every `on*: z.function()` arm with a named refusal: the JSON face has no
    // function value, and the renderers reach `item.onClick?.()` through the
    // TypeScript `MenuCommandItem` — which keeps the callable member, pinned
    // in `handler-keys-json-refusal-6124.test.ts` — never through `safeParse`.
    const result = MenuItemSchema.safeParse({
      label: 'New Tab',
      icon: 'plus',
      shortcut: 'Ctrl+T',
      onClick: () => {},
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    // A UNION reports `invalid_union` at the top; the named refusal lives in
    // the command arm's errors (the same reading the `type` tombstone case
    // above records for objectui#6931).
    const top = result.error.issues[0]!;
    expect(top.code).toBe('invalid_union');
    const armIssues = (
      (top as unknown as { errors?: { path: PropertyKey[]; code: string; message: string }[][] }).errors ?? []
    )
      .flat()
      .filter((i) => String(i.path[0]) === 'onClick');
    expect(armIssues.length, 'no arm reported an issue addressed to `onClick`').toBeGreaterThan(0);
    for (const issue of armIssues) {
      expect(issue.code).toBe('custom');
      expect(issue.message).toContain('`onClick` is a RUNTIME SLOT');
    }
    const onClick: MenuCommandItem['onClick'] = () => {};
    expect(typeof onClick).toBe('function');
  });
});
