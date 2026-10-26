/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8314 — `data`, `staticData` and `loading` are DECLARED authoring
 * surface on every tag `ObjectCalendarRenderer` is published under.
 *
 * ## The defect this pins closed
 *
 * `@objectstack/spec`'s `ComponentPropsMap['object-calendar']` declares nine
 * top-level keys. Slice 1 (objectui#8201, PR #8309) took the count from four to
 * six; these three are the remainder, and with them this block's reverse-parity
 * backlog is EMPTY — no `object-calendar` key is spec-declared,
 * renderer-honoured and undiscoverable any more.
 *
 * All three changed behaviour while the html tier reported them as
 * `unknown-prop` (objectui#6678's shape). Their sinks, and therefore where the
 * companion pin observes them, are NOT the same:
 *
 *   - `data` and `loading` are read off the PROPS channel at this package's
 *     renderer boundary (`index.tsx` — `resolveExternalData` /
 *     `resolveExternalLoading`), which is where `SchemaRenderer` delivers a
 *     node's own authored keys;
 *   - `staticData` is read off the SCHEMA inside `ObjectCalendar`, by the
 *     shared record-source ladder's rung 2.
 *
 * The gap was structural: the console registers this block with `registerLazy`
 * and `getConfig` is loaded-only, so it sat outside the console's
 * reverse-parity population until objectui#8176 loaded it.
 *
 * ## The rows
 *
 * 1-4 are the objectui#7712 house form (html tier per tag PER KEY, its control,
 * the registry declaration with `objectName` as non-vacuity, and the spec's key
 * verdict with a bogus control on the SAME `safeParse` call). Row 4 is clause
 * ②'s grounds MEASURED rather than asserted, because "the spec declares it" is
 * exactly the assumption objectui#8172 falsified for `limit`.
 *
 * Row 5 pins that both tags still share ONE list object.
 *
 * Row 6 derives each declared ARM from the contract's own verdicts instead of
 * restating it, with the refusals as the control that the derivation is a real
 * reading — the same discipline slice 1 applied to `defaultView`'s enum.
 *
 * Row 7 asserts that neither array key declares an `of`, and derives WHY: the
 * member contract is `z.array(z.unknown())`, so every coarse member kind is
 * accepted and no single-kind declaration is available. That is the rule
 * `ComponentInput.of` states (objectui#8067), and it is why the member claim
 * for these two keys lives entirely in the read-site pin.
 *
 * Rows 8-9 are objectui#8328's lesson applied here: a description that
 * recommends a write the renderer would drop is this gate's own failure mode
 * one layer in, so each declared description must NAME THE POSITION it is true
 * about, and those sentences are pinned rather than left to review attention.
 * Row 9 is the negative half — no description may teach the record-source
 * CONFIG spelling (`{ provider: … }`) that this renderer also honours under
 * `data`, because the contract refuses it by kind and publishing it would
 * harden a second dialect (AGENTS.md #0.1).
 *
 * ## What this file does NOT claim
 *
 * The member shapes, the ladder's ordering and `loading`'s coupling to `data`
 * are behaviour, and they are pinned where behaviour can be observed:
 * `__tests__/ObjectCalendar.recordSourceMembers-8314.test.tsx`, which
 * `registry-inputs-spec-parity.test.ts` registers as the member pin for both
 * array keys.
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

/** The three keys objectui#8314 declared, each with a value its arm admits. */
const DECLARED_KEYS = [
  { key: 'data', value: [{ id: 'r1', name: 'One' }], arm: 'array' },
  { key: 'staticData', value: [{ id: 'r2', name: 'Two' }], arm: 'array' },
  { key: 'loading', value: true, arm: 'boolean' },
] as const;

/** Every (tag, key) pair, so a red row names both halves. */
const TAG_KEY_ROWS = CALENDAR_TAGS.flatMap((tag) =>
  DECLARED_KEYS.map((entry) => ({ ...tag, ...entry })),
);

/**
 * A value the contract must REFUSE under each key, and it is chosen to be the
 * spelling most likely to be written by mistake rather than an arbitrary type:
 *
 *   - for the two arrays, the record-source CONFIG object — the shape this
 *     renderer also honours under `data` through the shared ladder, and the one
 *     the contract rejects by kind (`invalid_type`, `expected: 'array'`);
 *   - for `loading`, the string spelling of a boolean.
 */
const REFUSED_SPELLINGS = [
  { key: 'data', value: { provider: 'value', items: [] } },
  { key: 'staticData', value: { provider: 'value', items: [] } },
  { key: 'loading', value: 'yes' },
] as const;

/**
 * The POSITION each description must name — the sentence that tells an author
 * WHEN the key is honoured, not merely what it means.
 *
 * Fragments rather than whole sentences so a wording pass does not red this
 * file; each fragment is the load-bearing clause of a claim the companion
 * behaviour pin measures.
 */
const POSITION_PHRASES: Record<string, string[]> = {
  data: [
    // …it replaces the query, so the other query keys stop applying,
    'IN PLACE OF',
    '`staticData` is never reached',
    // …and the member is a record read for the config's fields plus its id.
    'Each member is a RECORD',
    'unscheduled area',
  ],
  staticData: [
    // …rung 2: below `data`, above `objectName`.
    'read SECOND',
    '`data` wins',
    '`objectName` is read AFTER it',
  ],
  loading: [
    // …the coupling slice 1 reasoned to and this card measured.
    'ONLY alongside an array `data`',
    'it is dropped',
  ],
};

/** Every coarse kind, for deriving whether a member position is single-kind. */
const COARSE_MEMBER_PROBES = [
  ['string', 'Account'],
  ['number', 42],
  ['boolean', true],
  ['array', []],
  ['object', { id: 'x' }],
] as const;

const declaredInputs = (type: string, namespace?: string): any[] =>
  ((ComponentRegistry.getConfig(type, namespace) as any)?.inputs ?? []);

const declaredInputNames = (type: string, namespace?: string): string[] =>
  declaredInputs(type, namespace).map((i: any) => i.name);

const declaredInput = (type: string, namespace: string | undefined, key: string): any =>
  declaredInputs(type, namespace).find((i: any) => i.name === key);

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

/** The keys the spec refuses BY NAME on one `safeParse` call. */
const refusedByName = (props: Record<string, unknown>): string[] => {
  const parsed = calendarSpec().safeParse(props);
  return parsed.success ? [] : parsed.error.issues.flatMap((issue: any) => issue.keys ?? []);
};

const specAccepts = (props: Record<string, unknown>): boolean =>
  calendarSpec().safeParse({ objectName: 'event', ...props }).success;

/** Does the contract accept this value at the MEMBER position of an array key? */
const specAcceptsMember = (key: string, member: unknown): boolean =>
  specAccepts({ [key]: [member] });

describe('objectui#8314 — object-calendar publishes the record-source keys it reads', () => {
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
    // Non-vacuity: a registration that resolved to nothing would satisfy
    // neither line, and `objectName` has been declared here since long before
    // this card.
    expect(declared, `${type} inputs`).toContain('objectName');
    expect(declared, `${type} inputs`).toContain(key);
  });

  it('CLAUSE ②: the spec accepts all three together, so this declares rather than widens', () => {
    // objectui#8172's lesson: "the spec declares it" is measured on the SAME
    // strict `safeParse` call shape as its control, never assumed. Installed
    // contract at the time of measurement: @objectstack/spec 17.3.0.
    const authored = Object.fromEntries(DECLARED_KEYS.map(({ key, value }) => [key, value]));
    const refused = refusedByName({ objectName: 'event', ...authored });
    for (const { key } of DECLARED_KEYS) {
      expect(refused, `the spec refuses \`${key}\` by name`).not.toContain(key);
    }
    // The control for that zero, on the same schema and the same call shape: a
    // key the contract really does not declare IS refused by name.
    expect(refusedByName({ objectName: 'event', bogusProbeKey: 'x' })).toContain('bogusProbeKey');
  });

  it('both tags publish ONE shared list, so a hand-copy cannot drift', () => {
    const [a, b] = CALENDAR_TAGS.map(({ type, namespace }) => declaredInputs(type, namespace));
    expect(a.length, 'object-calendar declares no inputs at all').toBeGreaterThan(0);
    expect(a.map((i: any) => i.name)).toEqual(b.map((i: any) => i.name));
    expect(a.map((i: any) => i.name)).toEqual(
      expect.arrayContaining(DECLARED_KEYS.map(({ key }) => key)),
    );
  });

  it.each(CALENDAR_TAGS)(
    '$label — each declared arm is DERIVED from the contract, with its refusal as the control',
    ({ type, namespace }) => {
      for (const { key, value, arm } of DECLARED_KEYS) {
        const declared = declaredInput(type, namespace, key);
        expect(declared, `${type} declares no \`${key}\` input`).toBeTruthy();
        expect(declared.type, `${key} arm`).toBe(arm);
        // The reading: the contract takes the value this arm admits…
        expect(specAccepts({ [key]: value }), `the contract refuses a ${arm} under \`${key}\``).toBe(
          true,
        );
      }
      // …and refuses the near-miss spelling, so "accepts" above is a verdict
      // about the arm rather than about an all-accepting contract.
      for (const { key, value } of REFUSED_SPELLINGS) {
        expect(
          specAccepts({ [key]: value }),
          `the contract accepts the refused spelling of \`${key}\` — this arm is not closed`,
        ).toBe(false);
      }
    },
  );

  it.each(CALENDAR_TAGS)(
    '$label — neither array key declares an `of`, and the contract is why',
    ({ type, namespace }) => {
      // objectui#8067's rule: a member arm is DECLARED when the contract admits
      // exactly one coarse member kind, and left alone when it admits several.
      // Both rows here are `z.array(z.unknown())`, so every kind is admitted —
      // which is also why the read site is the whole member contract there is,
      // and the member claim lives in the behaviour pin next door.
      for (const key of ['data', 'staticData']) {
        const accepted = COARSE_MEMBER_PROBES.filter(([, probe]) =>
          specAcceptsMember(key, probe),
        ).map(([kind]) => kind);
        expect(accepted.length, `${key} member kinds accepted: ${accepted.join(',')}`).toBeGreaterThan(1);
        expect(declaredInput(type, namespace, key).of, `${key} declares an \`of\``).toBeUndefined();
      }
    },
  );

  it.each(CALENDAR_TAGS)(
    '$label — every declared description NAMES the position it is true about',
    ({ type, namespace }) => {
      for (const [key, phrases] of Object.entries(POSITION_PHRASES)) {
        const description: string = declaredInput(type, namespace, key)?.description ?? '';
        // Asserted non-empty first, so a deleted description reads as a missing
        // description rather than as a missing phrase.
        expect(description.length, `${key} publishes no description`).toBeGreaterThan(40);
        for (const phrase of phrases) {
          expect(
            description,
            `${key}'s description stopped naming the position it is true about: "${phrase}"`,
          ).toContain(phrase);
        }
      }
    },
  );

  it.each(CALENDAR_TAGS)(
    '$label — no description teaches the record-source CONFIG spelling the contract refuses',
    ({ type, namespace }) => {
      // The negative half of the row above, and AGENTS.md #0.1 at the
      // description layer. `ObjectCalendar` also honours a
      // `{ provider, items }` config object under `data`, through the shared
      // ladder's rung 1 — but the contract rejects it by kind (asserted in the
      // arm row above), so recommending it would publish a second dialect the
      // save gate refuses.
      for (const key of Object.keys(POSITION_PHRASES)) {
        const description: string = declaredInput(type, namespace, key)?.description ?? '';
        expect(
          description,
          `${key}'s description teaches the off-spec provider-config spelling`,
        ).not.toContain('provider');
      }
    },
  );
});
