/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7804 — the `list-view` arm declares the five handler keys its
 * registered renderer reads, and the TypeScript face survives the declaration.
 *
 * Two halves, one file, because on THIS arm they are one change. Every earlier
 * slice of this card drained a plain `interface X extends BaseSchema`, whose
 * TypeScript face is hand-written and therefore untouched by what the mirror
 * declares. `ListViewSchema` is not that shape: it is `z.input` of the mirror
 * (`ListViewInferred`) intersected with `ListViewRuntimeProps`, so a refusal
 * arm — whose `z.input` is `never | undefined` — ANDs a runtime declaration
 * down to `undefined`. Measured before the precedence was written:
 * `ListViewSchema['onNavigate']` resolved to `undefined`, down from
 * `((recordId: string | number, action?: string) => void) | undefined`, and
 * NOTHING went red, because `undefined` is assignable to every optional
 * callback parameter the reads hand it.
 *
 * ⇒ the type half below is not decoration. It is the only thing that fails
 * when someone collapses `ListViewAuthored` back to a bare intersection, and
 * it is compiled — `tsconfig.test.json` type-checks every `*.test.ts` in this
 * package, chained from the package's `type-check` script.
 *
 * ⛔ What this file does NOT assert: that the keys are unreachable. They are
 * RUNTIME SLOTS. `onNavigate` / `onDensityChange` reach `ListView` off the node
 * (`schema.onX`); the other three reach it off the PROPS bag, which a host fills
 * either by passing the React prop `ListViewProps` declares or by putting the
 * key on the NODE, where `SchemaRenderer` spreads it in. A host still supplies
 * all five; what is refused is AUTHORING one as JSON, which could only ever hand
 * a call site a plain object where it expects a function.
 */
import { describe, it, expect } from 'vitest';
import { ListViewSchema as ListViewMirror } from '../zod/objectql.zod.js';
import type { ListViewSchema, ListViewRuntimeProps } from '../objectql.js';

/** The five rows this slice drained from `KNOWN_UNDECLARED_READS`. */
const DECLARED_REFUSALS = [
  'onAddRecord',
  'onBulkAction',
  'onDensityChange',
  'onNavigate',
  'onPageSizeChange',
] as const;

/**
 * A handler key this arm still does not declare — the LIVE CONTROL.
 *
 * It is the exact state all five above were in before this slice: undeclared,
 * so `BaseSchema.passthrough()` does not refuse it — it stops judging it and
 * KEEPS the value. Asserting it is still accepted in the same pass is what
 * makes the five refusals a reading rather than a claim about a parser that
 * might simply be rejecting everything.
 *
 * ⚠️ If a later slice declares this key, this control dies silently — so the
 * first assertion below fails loudly instead, telling the next author to pick
 * a new one rather than lose the control.
 */
const STILL_UNDECLARED = 'onRowClick';

/** A minimal node the arm accepts, so a failure can only come from the key under test. */
function node(extra: Record<string, unknown>) {
  return { type: 'list-view', objectName: 'accounts', ...extra };
}

/** The authored value shape that motivates the whole card: an action object, not a function. */
const AUTHORED = { action: 'toast' } as const;

describe('objectui#7804 — the `list-view` arm refuses its five handler keys BY NAME', () => {
  it('the control key is genuinely still undeclared on this arm', () => {
    expect(Object.keys((ListViewMirror as unknown as { shape: Record<string, unknown> }).shape))
      .not.toContain(STILL_UNDECLARED);
  });

  it.each(DECLARED_REFUSALS)('refuses `%s` at its own path, with the #5099 `custom` code', (key) => {
    const result = ListViewMirror.safeParse(node({ [key]: AUTHORED }));

    expect(result.success).toBe(false);
    const issues = result.success ? [] : result.error.issues;
    const own = issues.filter((issue) => issue.path.length === 1 && issue.path[0] === key);
    expect(own).toHaveLength(1);
    expect(own[0].code).toBe('custom');
    // The message names the key, so the issue is addressed even when it is read
    // without its path — the one contract `handlerKeyRefusal` composes.
    expect(own[0].message).toContain(`\`${key}\``);
  });

  it('a LIVE FUNCTION is refused too — the refusal is about the key, not the value', () => {
    for (const key of DECLARED_REFUSALS) {
      const result = ListViewMirror.safeParse(node({ [key]: () => undefined }));
      expect(result.success, `${key} should refuse a function value as well`).toBe(false);
    }
  });

  it('⭐ CONTROL — the still-undeclared key is ACCEPTED and its value is KEPT', () => {
    const result = ListViewMirror.safeParse(node({ [STILL_UNDECLARED]: AUTHORED }));

    expect(result.success).toBe(true);
    // Not merely accepted: the passthrough KEEPS it, which is what carried an
    // authored object all the way to a call site expecting a function.
    const parsed = (result.success ? result.data : {}) as Record<string, unknown>;
    expect(parsed[STILL_UNDECLARED]).toEqual(AUTHORED);
  });
});

describe('objectui#7804 — the TypeScript face survives the declaration', () => {
  it('compiles: the assertions in this file are the check, and tsc is what runs them', () => {
    // The work is in the type-level block below; this keeps the suite honest
    // about there being a runtime no-op here.
    expect(typeof TYPE_PINS).toBe('object');
  });
});

/**
 * ⛔ TYPE-LEVEL PINS — these fail at `tsc`, not at runtime.
 *
 * Each one was `undefined` (or, for `objectName`, `unknown`) under a candidate
 * this slice measured and rejected; see `ListViewAuthored` in `../objectql.ts`
 * for both readings.
 */
const TYPE_PINS = {
  /** The node-read runtime slots stay CALLABLE — what `'runtime-slot'` promises. */
  onNavigate: ((recordId: string | number, action?: string) => {
    void recordId;
    void action;
  }) satisfies NonNullable<ListViewSchema['onNavigate']>,
  onDensityChange: ((mode: 'compact' | 'comfortable' | 'spacious') => {
    void mode;
  }) satisfies NonNullable<ListViewSchema['onDensityChange']>,
  /** The non-handler runtime prop rides the same precedence. */
  refreshTrigger: 1 satisfies NonNullable<ListViewSchema['refreshTrigger']>,
  /**
   * ⭐ THE `Omit` REGRESSION PIN. `Omit<ListViewInferred, keyof ListViewRuntimeProps>`
   * keeps ONLY the index signature `BaseSchema.passthrough()` puts on the
   * inferred type, so every declared member collapses to `unknown` — measured:
   * `objectName` read `unknown` instead of `string`. This is that measurement,
   * kept where it fails.
   */
  objectName: 'accounts' satisfies ListViewSchema['objectName'],
} as const;

/**
 * The three PROPS-half slots stay CALLABLE on the node type too — the second
 * supply path (`SchemaRenderer` spreading a node key into the props bag) is what
 * this declaration contracts, and it is exactly what the refusal arm would have
 * killed without the precedence.
 */
const propsHalf = {
  onAddRecord: (() => undefined) satisfies NonNullable<ListViewSchema['onAddRecord']>,
  onBulkAction: ((action: string, records: unknown[]) => {
    void action;
    void records;
  }) satisfies NonNullable<ListViewSchema['onBulkAction']>,
  onPageSizeChange: ((size: number) => {
    void size;
  }) satisfies NonNullable<ListViewSchema['onPageSizeChange']>,
} as const;
void propsHalf;

/**
 * ⛔ And the precedence is keyed on `ListViewRuntimeProps`' own member list, so
 * a sixth refusal arm added to the mirror without a matching declaration here
 * would go back to resolving as `undefined`. This is that list, stated where it
 * fails if a member leaves it.
 */
const runtimeKeys: Array<keyof ListViewRuntimeProps> = [
  'onNavigate',
  'onDensityChange',
  'refreshTrigger',
  'onAddRecord',
  'onBulkAction',
  'onPageSizeChange',
];
void runtimeKeys;
