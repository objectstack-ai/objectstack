/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#8654 — `navigation` is declared on `object-timeline`, BY REFERENCE
 * to the spec: the timeline arm of the objectui#8652 ruling.
 *
 * ## The ruling this executes
 *
 * Maintainer ruling on objectui#8652, verbatim 「B」: declare `navigation` on
 * the platform element schema first, then mirror it here. `@objectstack/spec`
 * 17.5.0 declares it on the `object-timeline` row as well as on the board's and
 * the calendar's, for the block standalone, with no enclosing view. objectui#8652
 * mirrored the board and the calendar; this card mirrors the timeline.
 *
 * ## Where each face lives, and what this card changed on it
 *
 *   - The VALIDATOR face is `ObjectTimelineBlockSchema` in `@object-ui/types/zod`,
 *     whose `properties` bag IS the spec row by reference (objectui#10859 batch
 *     3). It judged `navigation` before this card; the rows below pin the
 *     value-level verdicts that reading gives, ⛔ no edit was made there.
 *   - The READING face is the schema `ObjectTimelineProps` declares. Its
 *     object-bound half (`objectName`, `timeline`, `filter`, `sort`, …) is where
 *     this card declares the member, typed `ViewNavigationConfig`, the spec's
 *     `NavigationConfig`. ⛔ Not on `TimelineSchema`: that is the
 *     presentational rail, its renderer never reads the key, and the spec has
 *     no `timeline` component row to declare it on.
 *   - The DESIGNER face is the registration's `inputs`, on both tags this one
 *     renderer is published under (`object-timeline`, `view:timeline`).
 *
 * The member pins (what each member DOES on a click) are in
 * `timelineNavigationMembers-8654.test.tsx`.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { ComponentPropsMap } from '@objectstack/spec/ui';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
import { safeValidateSchema, StrictAnyComponentSchema } from '@object-ui/types/zod';
import type { ViewNavigationConfig } from '@object-ui/types';
import type { ObjectTimelineProps } from '../ObjectTimeline';
// Module scope, not a hook: this import IS the registration (AGENTS.md's
// test-discipline section).
import '../index';

afterEach(cleanup);

const OBJECT = 'campaign';
const TIMELINE = { startDateField: 'start_date', titleField: 'name' };

/** The slice of a zod `safeParse` result these rows read — no zod internals. */
type ParseResult = {
  success: boolean;
  error?: { issues: Array<{ path: PropertyKey[]; code: string }> };
  data?: unknown;
};
type Parser = { safeParse: (doc: unknown) => ParseResult };

/** Issues as `path|code`, so a red run names what broke. */
const issuesOf = (result: ParseResult): string[] =>
  result.success ? [] : (result.error?.issues ?? []).map((i) => `${i.path.map(String).join('.')}|${i.code}`);

/** The installed spec's row, read on every run rather than restated here. */
const specRow = (): Parser => (ComponentPropsMap as unknown as Record<string, Parser>)['object-timeline'];

/** A spec-shaped authored document: the props in the `properties` bag. */
const authored = (navigation: unknown) => ({
  type: 'object-timeline',
  properties: { objectName: OBJECT, timeline: TIMELINE, navigation },
});

/** Both validator faces this package publishes, each judging the same document. */
const FACES = [
  ['safeValidateSchema', (doc: unknown) => safeValidateSchema(doc) as unknown as ParseResult],
  ['StrictAnyComponentSchema', (doc: unknown) => StrictAnyComponentSchema.safeParse(doc) as unknown as ParseResult],
] as const;

describe('the installed spec declares `navigation` on `object-timeline` — the premise, read live (objectui#8654)', () => {
  it('a valid block is accepted, and a bogus key beside it is refused, on the same row', () => {
    expect(specRow(), 'object-timeline is not in the installed ComponentPropsMap').toBeDefined();
    expect(issuesOf(specRow().safeParse({ objectName: OBJECT, navigation: { mode: 'drawer' } }))).toEqual([]);
    expect(issuesOf(specRow().safeParse({ objectName: OBJECT, zzqxNoSuchKey: 1 }))).toEqual(['|unrecognized_keys']);
  });

  it('the spec refuses a bad `mode` at `navigation.mode`', () => {
    expect(issuesOf(specRow().safeParse({ navigation: { mode: 'not-a-mode' } }))).toEqual(['navigation.mode|invalid_value']);
  });
});

describe.each(FACES)('`%s` judges the authored `properties.navigation` by the spec row (objectui#8654)', (_face, parse) => {
  it('a valid block parses, and so does every mode the spec declares', () => {
    for (const mode of ['page', 'drawer', 'modal', 'split', 'popover', 'new_window', 'none'] as const) {
      expect(issuesOf(parse(authored({ mode }))), mode).toEqual([]);
    }
    expect(issuesOf(parse(authored({ mode: 'modal', size: 'lg' })))).toEqual([]);
    expect(issuesOf(parse(authored({ mode: 'page', openNewTab: true })))).toEqual([]);
    expect(issuesOf(parse(authored({ mode: 'none', preventNavigation: true })))).toEqual([]);
    expect(issuesOf(parse(authored({ mode: 'drawer', width: '720px' })))).toEqual([]);
  });

  it('a bad `mode` is refused at `properties.navigation.mode` — where the spec refuses it', () => {
    // The lit control is the row above: the documents differ in this one value.
    expect(issuesOf(parse(authored({ mode: 'not-a-mode' })))).toEqual(['properties.navigation.mode|invalid_value']);
  });

  it('a bogus member INSIDE the block is refused — the block is the spec\'s strict object', () => {
    expect(issuesOf(parse(authored({ mode: 'drawer', zzqxNoSuchMember: true })))).toEqual([
      'properties.navigation|unrecognized_keys',
    ]);
  });

  it('the retired `view` member is refused, as the spec retired it in 17.5.0', () => {
    expect(issuesOf(parse(authored({ mode: 'page', view: 'summary' })))).not.toEqual([]);
    expect(issuesOf(specRow().safeParse({ navigation: { mode: 'page', view: 'summary' } }))).not.toEqual([]);
  });

  it('the parse writes no default into the document', () => {
    // The spec defaults `mode` to `'page'`; read through the import boundary,
    // the bag adds nothing, so what reaches the renderer is what was written.
    const absent = parse({ type: 'object-timeline', properties: { objectName: OBJECT } });
    expect(absent.success).toBe(true);
    const absentBag = (absent.data as { properties: Record<string, unknown> }).properties;
    expect(Object.prototype.hasOwnProperty.call(absentBag, 'navigation')).toBe(false);
    const noMode = parse(authored({ size: 'lg' }));
    expect(noMode.success).toBe(true);
    expect((noMode.data as { properties: { navigation: unknown } }).properties.navigation).toEqual({ size: 'lg' });
  });
});

/* ── Type-level: the reading face declares the member, by the spec's type ─── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/**
 * `Equal`, not `extends`: an undeclared member read `any` through
 * `BaseSchema`'s index signature until objectui#8347, and `any` passes a
 * one-way check on both sides — which is precisely the before-state this card
 * removed.
 */
export type assertionTimelineNavigationIsTheSpecType =
  Expect<Equal<ObjectTimelineProps['schema']['navigation'], ViewNavigationConfig | undefined>>;
/** The helper can FAIL — synthetic control. */
export type assertionEqualCanFail = Expect<Equal<Equal<any, ViewNavigationConfig | undefined>, false>>;

/**
 * The reading face's own failing instrument: with the member declared,
 * `'not-a-mode'` is not a `NavigationMode` and the expected error exists. It
 * guards the member's TYPE: since objectui#8347 removed the index signature, a
 * deleted member's value is refused as an undeclared key and the directive
 * stays used, so a deletion is caught by the `Equal` row above instead (the
 * indexed access stops compiling).
 */
export const BAD_TIMELINE_MODE_IS_REFUSED_AT_COMPILE_TIME: ObjectTimelineProps['schema'] = {
  type: 'timeline',
  objectName: OBJECT,
  // @ts-expect-error — `mode` is the spec's closed `NavigationMode` vocabulary.
  navigation: { mode: 'not-a-mode' },
};

/** The valid block annotates with no cast. */
export const TIMELINE_WITH_NAVIGATION: ObjectTimelineProps['schema'] = {
  type: 'timeline',
  objectName: OBJECT,
  navigation: { mode: 'modal', size: 'lg' },
};

/* ── The designer face: both registrations publish it ───────────────────── */

/** The two tags this one renderer is published under. */
const TIMELINE_TAGS = [
  { tagLabel: 'object-timeline', type: 'object-timeline', namespace: 'plugin-timeline' },
  { tagLabel: 'view:timeline', type: 'timeline', namespace: 'view' },
] as const;

const declaredInputs = (type: string, namespace?: string): Array<{ name: string; type: string }> =>
  ((ComponentRegistry.getConfig(type, namespace) as { inputs?: Array<{ name: string; type: string }> } | undefined)?.inputs ?? []);

/** A manifest built from the live registry, the way `gen-manifest.ts` builds it. */
const liveManifest = () =>
  manifestFromConfigs(
    ComponentRegistry.getKnownTypes().map((type) => {
      const meta = ComponentRegistry.getMeta(type);
      return { type, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
    }) as unknown as Parameters<typeof manifestFromConfigs>[0],
  );

/** Messages of one diagnostic code that a one-node document draws for `props`. */
const diagnosticsOf = (type: string, props: Record<string, unknown>, code: string): string[] =>
  validateTree({ type, objectName: OBJECT, ...props } as never, liveManifest())
    .diagnostics.filter((d) => d.code === code)
    .map((d) => d.message);

describe.each(TIMELINE_TAGS)('$tagLabel publishes `navigation` (objectui#8654)', ({ type, namespace }) => {
  it('the registration declares it as an object', () => {
    const inputs = declaredInputs(type, namespace);
    const names = inputs.map((i) => i.name);
    // Non-vacuity: an empty read (wrong type/namespace) fails both lines.
    expect(names, `${type} inputs`).toContain('objectName');
    expect(names, `${type} inputs`).toContain('navigation');
    expect(inputs.find((i) => i.name === 'navigation')?.type).toBe('object');
  });

  it('the html tier accepts the block, and refuses a non-object value by kind', () => {
    expect(diagnosticsOf(type, { navigation: { mode: 'drawer' } }, 'unknown-prop')).toEqual([]);
    expect(diagnosticsOf(type, { navigation: { mode: 'drawer' } }, 'type-mismatch')).toEqual([]);
    expect(diagnosticsOf(type, { navigation: 'drawer' }, 'type-mismatch')).toHaveLength(1);
  });

  it('control: a genuinely unknown prop is still reported', () => {
    expect(diagnosticsOf(type, { zzqxNoSuchProp: { mode: 'drawer' } }, 'unknown-prop')).toEqual([
      `<${type}> has no prop "zzqxNoSuchProp"`,
    ]);
  });
});

/* ── End to end: the authored key reaches the click, on both tags ──────── */

const RECORDS = [{ id: '1', name: 'Launch', start_date: '2024-03-01', owner: 'Grace Hopper' }];

function makeDataSource() {
  return {
    find: vi.fn().mockResolvedValue({ data: RECORDS }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: OBJECT,
      fields: { name: { type: 'text' }, start_date: { type: 'date' }, owner: { type: 'text' } },
    }),
  };
}

/** Mount one node through the real `SchemaRenderer` and the real registry, then click its entry. */
async function mountAndClick(node: Record<string, unknown>) {
  render(
    <SchemaRendererProvider dataSource={makeDataSource() as never}>
      <SchemaRenderer schema={node as never} />
    </SchemaRendererProvider>,
  );
  fireEvent.click(await screen.findByText('Launch'));
}

const NODES = [
  {
    label: 'object-timeline, the spec-shaped `properties` bag',
    withNav: authored({ mode: 'drawer' }),
    without: { type: 'object-timeline', properties: { objectName: OBJECT, timeline: TIMELINE } },
  },
  {
    label: 'view:timeline (the bare `timeline` key), flat',
    withNav: { type: 'timeline', objectName: OBJECT, timeline: TIMELINE, navigation: { mode: 'drawer' } },
    without: { type: 'timeline', objectName: OBJECT, timeline: TIMELINE },
  },
] as const;

describe.each(NODES)('$label — the authored block decides the click (objectui#8654)', ({ withNav, without }) => {
  it('`navigation: { mode: "drawer" }` opens the entry\'s record in a drawer', async () => {
    await mountAndClick(withNav);
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    expect(screen.getByText('Grace Hopper')).toBeTruthy();
  });

  it('control: the same node without the key opens nothing', async () => {
    await mountAndClick(without);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(screen.queryByText('Grace Hopper')).toBeNull();
  });
});
