/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8201 — `defaultView` and `locale` are DECLARED authoring surface on
 * every tag `ObjectCalendarRenderer` is published under.
 *
 * ## The defect this pins closed
 *
 * `@objectstack/spec`'s `ComponentPropsMap['object-calendar']` declares nine
 * top-level keys; both registrations published four. `ObjectCalendar.tsx` seeds
 * its `view` state from `schema.defaultView`, and `index.tsx` resolves
 * `rest.locale` through `Intl.getCanonicalLocales` and forwards it to the
 * component's date/time formatting — so both keys changed behaviour while the
 * html tier reported them as `unknown-prop` (objectui#6678's shape).
 *
 * The gap was structural: the console registers this block with `registerLazy`
 * and `getConfig` is loaded-only, so it sat outside the console's
 * reverse-parity population until objectui#8176 loaded it.
 *
 * ## The rows
 *
 * 1-4 are the objectui#7712 house form (html tier per tag PER KEY, its control,
 * the registry declaration with `objectName` as non-vacuity, and the spec's key
 * verdict with a bogus control on the same `safeParse` call — objectui#8172's
 * lesson, since `limit` is taught by four faces and refused BY NAME by this
 * same strict map). Row 5 pins that both tags share ONE list object.
 *
 * Row 6 is specific to `defaultView` and is the reason this key needed care:
 * an `enum` arm is judged EXACTLY by the console's parity gate — every declared
 * member must be a value the contract accepts — and `agenda` was RETIRED from
 * this enum (objectui#5784, pinned by `@object-ui/types`'
 * `default-view-agenda-retired.test.ts`). So the declared member list is
 * DERIVED from the spec's verdicts here rather than restated, with the retired
 * spelling as the control that the derivation is a real reading.
 *
 * ## What this file does NOT claim
 *
 * `locale`'s end-to-end honour row already exists and is not duplicated here:
 * `object-calendar-renderer.propsContract.test.tsx`'s
 * "MUST-NOT-CHANGE: a well-formed `locale` still reaches the component" authors
 * `locale: 'de-DE'` on the NODE and asserts it arrives. `defaultView`'s honour
 * verdict rests on the read-site measurement recorded in `index.tsx`'s
 * `OBJECT_CALENDAR_INPUTS` docblock — its sink is a `useState` lazy initializer
 * inside `ObjectCalendar`, so a behaviour row costs a full data-source render.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { ComponentPropsMap } from '@objectstack/spec/ui';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
// Module scope, not a hook: this import IS the registration (AGENTS.md's
// test-discipline section).
import '../index';

/** The two tags this one renderer is published under. */
const CALENDAR_TAGS = [
  { label: 'object-calendar', type: 'object-calendar', namespace: 'plugin-calendar' },
  { label: 'view:calendar', type: 'calendar', namespace: 'view' },
] as const;

/** The two keys objectui#8201 declared, each with a value its arm admits. */
const DECLARED_SCALAR_KEYS = [
  { key: 'defaultView', value: 'week' },
  { key: 'locale', value: 'de-DE' },
] as const;

/** Every (tag, key) pair, so a red row names both halves. */
const TAG_KEY_ROWS = CALENDAR_TAGS.flatMap((tag) =>
  DECLARED_SCALAR_KEYS.map((entry) => ({ ...tag, ...entry })),
);

/** The `defaultView` spellings this repo has ever taught, retired ones included. */
const CANDIDATE_VIEWS = ['month', 'week', 'day', 'agenda', 'list', 'year', 'timeline'] as const;

const declaredInputs = (type: string, namespace?: string): any[] =>
  ((ComponentRegistry.getConfig(type, namespace) as any)?.inputs ?? []);

const declaredInputNames = (type: string, namespace?: string): string[] =>
  declaredInputs(type, namespace).map((i: any) => i.name);

const liveManifest = () =>
  manifestFromConfigs(
    ComponentRegistry.getKnownTypes().map((type) => {
      const meta = ComponentRegistry.getMeta(type);
      return { type, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
    }) as unknown as Parameters<typeof manifestFromConfigs>[0],
  );

const unknownProps = (type: string, props: Record<string, unknown>): string[] =>
  validateTree({ type, objectName: 'event', ...props } as never, liveManifest())
    .diagnostics.filter((d) => d.code === 'unknown-prop')
    .map((d) => d.message);

const calendarSpec = () => (ComponentPropsMap as Record<string, any>)['object-calendar'];

const refusedByName = (props: Record<string, unknown>): string[] => {
  const parsed = calendarSpec().safeParse(props);
  return parsed.success ? [] : parsed.error.issues.flatMap((issue: any) => issue.keys ?? []);
};

/** Does the contract accept this `defaultView` spelling? */
const specAcceptsView = (value: string): boolean =>
  calendarSpec().safeParse({ objectName: 'event', defaultView: value }).success;

describe('objectui#8201 — object-calendar publishes the scalar keys it reads', () => {
  it.each(TAG_KEY_ROWS)('$label — the html tier accepts an authored `$key`', ({ type, key, value }) => {
    expect(
      unknownProps(type, { [key]: value }),
      `<${type}> reports the spec-declared \`${key}\` as unknown while the renderer honours it`,
    ).toEqual([]);
  });

  it.each(CALENDAR_TAGS)('$label — control: a genuinely unknown prop is still reported', ({ type }) => {
    expect(unknownProps(type, { bogusProp: 'x' })).toEqual([`<${type}> has no prop "bogusProp"`]);
  });

  it.each(TAG_KEY_ROWS)('$label — the registration declares `$key`', ({ type, namespace, key }) => {
    const declared = declaredInputNames(type, namespace);
    expect(declared, `${type} inputs`).toContain('objectName');
    expect(declared, `${type} inputs`).toContain(key);
  });

  it('the spec accepts both keys together, so this declares rather than widens', () => {
    const authored = Object.fromEntries(DECLARED_SCALAR_KEYS.map(({ key, value }) => [key, value]));
    const refused = refusedByName({ objectName: 'event', ...authored });
    for (const { key } of DECLARED_SCALAR_KEYS) {
      expect(refused, `the spec refuses \`${key}\` by name`).not.toContain(key);
    }
    // The control for that zero, on the same strict schema.
    expect(refusedByName({ objectName: 'event', bogusProp: 'x' })).toContain('bogusProp');
  });

  it('both tags publish ONE shared list, so a hand-copy cannot drift', () => {
    const [a, b] = CALENDAR_TAGS.map(({ type, namespace }) => declaredInputs(type, namespace));
    expect(a.length, 'object-calendar declares no inputs at all').toBeGreaterThan(0);
    expect(a.map((i: any) => i.name)).toEqual(b.map((i: any) => i.name));
    expect(a.map((i: any) => i.name)).toEqual(
      expect.arrayContaining(DECLARED_SCALAR_KEYS.map(({ key }) => key)),
    );
  });

  it.each(CALENDAR_TAGS)(
    '$label — the declared `defaultView` members are DERIVED from the spec, retired spellings excluded',
    ({ type, namespace }) => {
      const declared = declaredInputs(type, namespace).find((i: any) => i.name === 'defaultView');
      expect(declared, `${type} declares no defaultView input`).toBeTruthy();
      expect(declared.type, 'defaultView must carry the enum arm the gate judges EXACTLY').toBe('enum');

      const accepted = CANDIDATE_VIEWS.filter(specAcceptsView);
      const refused = CANDIDATE_VIEWS.filter((v) => !specAcceptsView(v));
      // Both halves must be non-empty, or "derived from the spec" is vacuous:
      // an all-accepting contract would make the first line trivially true.
      expect(accepted.length, 'the contract accepted nothing — the probe is broken').toBeGreaterThan(0);
      expect(refused, 'the contract refused nothing — this is not a closed enum').toContain('agenda');

      expect([...declared.enum].sort()).toEqual([...accepted].sort());
    },
  );
});
