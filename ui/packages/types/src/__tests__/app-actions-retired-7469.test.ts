/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — `AppComponentSchema.actions`, `AppAction` and
 * `AppActionSchema` are RETIRED (objectui#7469, maintainer ruling C, ADR-0049
 * enforce-or-remove). App-level actions are `navigation` items of
 * `type: 'action'`.
 *
 * ## What the ruling closed
 *
 * `actions` was an objectui-only array of free-form header buttons and a user
 * menu. The platform's `@objectstack/spec` `AppSchema` is strict and never
 * declared it, so the same app document parsed green here and was refused at
 * the platform door — two validators, two answers. The console reads apps only
 * from the platform, so it could never receive the array; only the standalone
 * runner drew it, and the buttons declared no behaviour to run. The maintainer
 * chose, verbatim: 「C 退役 actions[] (Recommended)」 — one channel, one
 * contract: `navigation` items of `type: 'action'`, which the console sidebar
 * dispatches by action name.
 *
 * ## Why a tombstone and not a deletion
 *
 * `BaseSchema` is `.passthrough()` on the zod side (and carried an index
 * signature on the TS side until objectui#8347), so an UNDECLARED key is not
 * refused there, it is KEPT.
 * Block (d) takes that reading on this very mirror, so the reason is a
 * measurement and not prose.
 *
 * ## How refusals are asserted
 *
 * By the issue ENVELOPE — `code` and `path`, and that it is the ONLY issue —
 * at the public door `safeValidateSchema` (the tolerant face) and
 * on the mirror. The message is asserted to carry the remedy's own spelling
 * (`navigation`, `type: 'action'`, `actionDef`), which is the contract here;
 * nothing else of its wording is pinned.
 *
 * The `@ts-expect-error` directives in block (f) are REAL enforcement: this
 * package type-checks its tests through `tsconfig.test.json`, so re-widening
 * the member or re-exporting `AppAction` fails the build on the unused
 * directive (TS2578). A green `vitest` run is NOT evidence about them.
 */

import { describe, it, expect } from 'vitest';
import { AppSchema as SpecAppSchema } from '@objectstack/spec/ui';
import type { AppComponentSchema } from '../app';
// @ts-expect-error — `AppAction` is retired (objectui#7469); re-exporting it turns this directive unused
import type { AppAction } from '../index';
import { AppComponentSchema as AppMirror } from '../zod/app.zod';
import * as zodFace from '../zod/index.zod';

const APP = { type: 'app', name: 'pin_app', title: 'Pin App' } as const;
const app = (extra: Record<string, unknown>) => ({ ...APP, ...extra });

/** Every arm the retired element declared, plus the empty array: a tombstone
 *  refuses the KEY, so no value of it may slip through. */
const RETIRED_VALUES: ReadonlyArray<readonly [string, unknown]> = [
  ['a `button` action', [{ type: 'button', label: 'Quick Actions', icon: 'zap', variant: 'outline' }]],
  ['a `dropdown` action', [{ type: 'dropdown', label: 'More', items: [{ type: 'item', label: 'Help', path: '/help' }] }]],
  ['a `user` action', [{ type: 'user', label: 'Ada Lovelace', avatar: '/a.png', description: 'ada@example.com' }]],
  ['an empty array', []],
];

/** The remedy, spelled the way the spec's `ActionNavItemSchema` accepts it. */
const ACTION_NAV_ITEM = {
  id: 'quick_create',
  type: 'action',
  label: 'Quick Create',
  icon: 'zap',
  actionDef: { actionName: 'quick_create' },
} as const;

type Issue = { code: string; path: PropertyKey[]; message: string };
const issuesOf = (r: { success: boolean; error?: { issues: Issue[] } }): Issue[] => r.error?.issues ?? [];

const mirrorShape = (AppMirror as unknown as { shape: Record<string, { description?: string }> }).shape;

/* ── (a) the key is refused by name, with the navigation remedy ──────────── */

describe('objectui#7469 (a) — `actions` is RETIRED on the `app` node', () => {
  it.each(RETIRED_VALUES)(
    'refuses %s at the public door and on the mirror: ONE `invalid_type` issue at `actions`, naming the remedy',
    (_label, value) => {
      for (const r of [zodFace.safeValidateSchema(app({ actions: value })), AppMirror.safeParse(app({ actions: value }))]) {
        expect(r.success, 'an authored `actions` array was ACCEPTED').toBe(false);
        const issues = issuesOf(r);
        expect(issues.map(({ code, path }) => ({ code, path }))).toEqual([{ code: 'invalid_type', path: ['actions'] }]);
        const message = issues[0]!.message;
        expect(message).toContain('`actions`');
        expect(message).toContain('navigation');
        expect(message).toContain("type: 'action'");
        expect(message).toContain('actionDef');
      }
    },
  );

  it('the refusal message and the published `.describe()` metadata are ONE string', () => {
    const r = AppMirror.safeParse(app({ actions: RETIRED_VALUES[0]![1] }));
    expect(issuesOf(r)[0]!.message).toBe(mirrorShape.actions!.description);
  });

  it('stays DECLARED on the mirror — a tombstone, not a deletion (see block d)', () => {
    expect(Object.keys(mirrorShape)).toContain('actions');
  });
});

/* ── (b) LIT CONTROL: the remedy parses, on both doors ───────────────────── */

describe('objectui#7469 (b) — LIT CONTROL: a `navigation` item of `type: \'action\'` parses', () => {
  it('on this package\'s public door and mirror', () => {
    const doc = app({ navigation: [ACTION_NAV_ITEM] });
    expect(issuesOf(zodFace.safeValidateSchema(doc))).toEqual([]);
    expect(issuesOf(AppMirror.safeParse(doc))).toEqual([]);
  });

  it('on the platform\'s strict `AppSchema` too — the remedy is the spec\'s own spelling', () => {
    const r = SpecAppSchema.safeParse({ name: 'pin_app', label: 'Pin App', navigation: [ACTION_NAV_ITEM] });
    expect(issuesOf(r as never)).toEqual([]);
  });
});

/* ── (c) the two doors now give ONE answer ───────────────────────────────── */

describe('objectui#7469 (c) — the platform\'s `AppSchema` refuses the key too', () => {
  it('the spec refuses `actions` with `unrecognized_keys` naming it — the answer this mirror now agrees with', () => {
    const r = SpecAppSchema.safeParse({ name: 'pin_app', label: 'Pin App', actions: RETIRED_VALUES[0]![1] });
    expect(r.success).toBe(false);
    const issues = (r.error?.issues ?? []) as Array<{ code: string; keys?: string[] }>;
    expect(issues.map((i) => ({ code: i.code, keys: i.keys }))).toEqual([{ code: 'unrecognized_keys', keys: ['actions'] }]);
  });

  it('CONTROL — the same spec document parses without the key', () => {
    expect(SpecAppSchema.safeParse({ name: 'pin_app', label: 'Pin App' }).success).toBe(true);
  });
});

/* ── (d) why a tombstone: an undeclared key would be KEPT, not refused ──── */

describe('objectui#7469 (d) — CONTROL: a deleted arm would KEEP the array under `.passthrough()`', () => {
  it('the mirror with the arm omitted parses the retired array green and keeps it — what a deletion would have left', () => {
    const value = RETIRED_VALUES[0]![1];
    const r = AppMirror.omit({ actions: true }).safeParse(app({ actions: value }));
    expect(r.success).toBe(true);
    expect((r.data as Record<string, unknown>).actions).toEqual(value);
  });
});

/* ── (e) the element schema left the published face ──────────────────────── */

describe('objectui#7469 (e) — `AppActionSchema` is no longer exported', () => {
  it('the `./zod` entry exports no `AppActionSchema`, while its siblings stay', () => {
    expect('AppActionSchema' in zodFace).toBe(false);
    // CONTROL: the same namespace read finds the app mirror and the legacy
    // menu-item mirror, so the `false` above is a reading, not a dead probe.
    expect('AppComponentSchema' in zodFace).toBe(true);
    expect('AppMenuItemSchema' in zodFace).toBe(true);
  });
});

/* ── (f) the TS twin carries the same contract ───────────────────────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/** `Equal`, not `extends`: an UNDECLARED member read `any` through the index signature until objectui#8347. */
export type assertionActionsRetired = Expect<Equal<AppComponentSchema['actions'], undefined>>;
/** The helper can FAIL — synthetic control (a declared member is not `undefined`). */
export type assertionEqualCanFail = Expect<Equal<Equal<AppComponentSchema['type'], undefined>, false>>;
/** An undeclared key is not a member at all since objectui#8347 — it read `any` before. */
export type assertionUndeclaredKeyIsNoMember = Expect<Equal<'actionz' extends keyof AppComponentSchema ? true : false, false>>;
/** Keeps the retired-import directive above honest: the name is USED, so a
 *  re-exported `AppAction` cannot leave the directive satisfied by an
 *  unused-import diagnostic instead of the missing-export one. */
export type RetiredAppActionImport = AppAction;

describe('objectui#7469 (f) — the TS twin refuses what the mirror refuses', () => {
  it('authoring `actions` is a compile error — checked by `tsc -p tsconfig.test.json`', () => {
    const refused: AppComponentSchema = {
      ...APP,
      // @ts-expect-error — retired: author `navigation` items of `type: 'action'`
      actions: [{ type: 'button', label: 'Quick Actions' }],
    };
    expect(refused.type).toBe('app');
  });

  it('CONTROL — the navigation remedy compiles on the same node', () => {
    const node: AppComponentSchema = {
      ...APP,
      navigation: [{ id: 'quick_create', type: 'action', label: 'Quick Create', actionDef: { actionName: 'quick_create' } }],
    };
    expect(node.navigation?.[0]?.actionDef?.actionName).toBe('quick_create');
  });
});
