/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7759 group A — `DashboardComponentSchema.header` and `.globalFilters`
 * state the spec's member on BOTH faces.
 *
 * Both keys are declared by `@objectstack/spec`'s `DashboardSchema`, so the card's
 * ruling (5617465269, principle 1) governs: the objectui zod mirror and the
 * TypeScript declaration both follow the spec, in both directions. Before this
 * change each key was DISJOINT — ledgered in `KnownDrift` AND `WiderThanDeclared`
 * in `zod-mirror-parity.test.ts`:
 *
 *  - `header` — the mirror took the spec's member by reference, the declaration
 *    was a hand-written restatement. An inline per-locale action `label` parsed
 *    green and `tsc` refused it (and `DashboardRenderer` handed the map to React);
 *    an action with no `actionUrl`, or an `actionType` outside the spec's enum,
 *    compiled and the mirror refused it. ⇒ the declaration now inherits the
 *    spec's `header` through the `Omit< Dashboard, … >` projection.
 *  - `globalFilters` — the declaration bound the spec's `GlobalFilter`, the
 *    mirror's `GlobalFilterSchema` restated `options` / `optionsFrom`. The
 *    bare-string option shorthand, a label-less option, an `optionsFrom` with no
 *    `labelField` (and an array `filter`, and an unknown key, stripped in
 *    silence) parsed green where the spec refuses them; an inline per-locale
 *    option label was refused where the spec admits it. ⇒ the mirror's
 *    `GlobalFilterSchema` IS the spec's schema now.
 *
 * The type rows are enforced by `tsconfig.test.json` (chained from this
 * package's `type-check`); the parse legs assert the mirror's verdict and its
 * issue envelope (`code` + `path`) on the same literals.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { GlobalFilterSchema as SpecGlobalFilterSchema } from '@objectstack/spec/ui';
import type { Dashboard, GlobalFilter } from '@objectstack/spec/ui';
import type { DashboardComponentSchema } from '../complex';
import { DashboardComponentSchema as DashboardMirror, GlobalFilterSchema } from '../zod/complex.zod';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

type DeclaredHeader = DashboardComponentSchema['header'];
type DeclaredFilter = NonNullable<DashboardComponentSchema['globalFilters']>[number];

const dashboard = (extra: Record<string, unknown>) => ({ type: 'dashboard', widgets: [], ...extra });

/** The mirror's verdict, and the (code, path) of each issue when it refuses. */
function verdict(doc: unknown): true | Array<[string, string]> {
  const r = DashboardMirror.safeParse(doc);
  return r.success ? true : r.error.issues.map((i) => [i.code, i.path.join('.')] as [string, string]);
}

describe('header: both faces are the spec member (objectui#7759)', () => {
  it('the declaration and the mirror input both equal the spec `Dashboard[\'header\']`', () => {
    const declared: Equal<DeclaredHeader, Dashboard['header']> = true;
    const mirror: Equal<z.input<typeof DashboardMirror>['header'], Dashboard['header']> = true;
    // Control: the hand-written restatement the declaration used to carry is NOT the spec member.
    const control: Equal<
      { showTitle?: boolean; showDescription?: boolean; actions?: Array<{ label: string; actionUrl?: string; actionType?: string; icon?: string }> } | undefined,
      Dashboard['header']
    > = false;
    expect([declared, mirror, control]).toEqual([true, true, false]);
  });

  it('an inline per-locale action label is accepted by both faces', () => {
    const header: DeclaredHeader = { actions: [{ label: { en: 'Convert', 'zh-CN': '转换' }, actionUrl: 'convert_flow', actionType: 'flow' }] };
    expect(verdict(dashboard({ header }))).toBe(true);
  });

  it('an action with no `actionUrl`, or an `actionType` outside the spec enum, is refused by both faces', () => {
    // @ts-expect-error — `actionUrl` is required by the spec's header action.
    const noUrl: DeclaredHeader = { actions: [{ label: 'Convert' }] };
    // @ts-expect-error — `refresh` is not a member of the spec's `ActionType`.
    const badType: DeclaredHeader = { actions: [{ label: 'Refresh', actionUrl: 'x', actionType: 'refresh' }] };
    expect(verdict(dashboard({ header: noUrl }))).toEqual([['invalid_type', 'header.actions.0.actionUrl']]);
    expect(verdict(dashboard({ header: badType }))).toEqual([['invalid_value', 'header.actions.0.actionType']]);
  });
});

describe('globalFilters: both faces are the spec element (objectui#7759)', () => {
  it('the declared element, the mirror element and the local `GlobalFilterSchema` all equal the spec `GlobalFilter`', () => {
    const declared: Equal<DeclaredFilter, GlobalFilter> = true;
    const mirror: Equal<NonNullable<z.input<typeof DashboardMirror>['globalFilters']>[number], GlobalFilter> = true;
    const local: Equal<z.input<typeof GlobalFilterSchema>, z.input<typeof SpecGlobalFilterSchema>> = true;
    expect([declared, mirror, local]).toEqual([true, true, true]);
  });

  it('an inline per-locale option label — refused by the mirror until now — is accepted by both faces', () => {
    const filter: DeclaredFilter = { field: 'region', type: 'select', options: [{ value: 'emea', label: { en: 'EMEA', 'zh-CN': '欧洲' } }] };
    expect(verdict(dashboard({ globalFilters: [filter] }))).toBe(true);
  });

  it('the bare-string shorthand, a label-less option and a `labelField`-less `optionsFrom` are refused by both faces', () => {
    // @ts-expect-error — the spec's options are `{ value, label }` pairs, never bare strings.
    const shorthand: DeclaredFilter = { field: 'region', options: ['EMEA'] };
    // @ts-expect-error — the spec requires an option `label`.
    const labelless: DeclaredFilter = { field: 'region', options: [{ value: 'emea' }] };
    // @ts-expect-error — the spec requires `optionsFrom.labelField`.
    const noLabelField: DeclaredFilter = { field: 'owner', optionsFrom: { object: 'users', valueField: 'id' } };
    expect(verdict(dashboard({ globalFilters: [shorthand] }))).toEqual([['invalid_type', 'globalFilters.0.options.0']]);
    expect(verdict(dashboard({ globalFilters: [labelless] }))).toEqual([['invalid_union', 'globalFilters.0.options.0.label']]);
    expect(verdict(dashboard({ globalFilters: [noLabelField] }))).toEqual([['invalid_type', 'globalFilters.0.optionsFrom.labelField']]);
  });

  it('an unknown key in a filter is refused by name instead of being stripped in silence', () => {
    expect(verdict(dashboard({ globalFilters: [{ field: 'region', bogus: 1 }] }))).toEqual([['unrecognized_keys', 'globalFilters.0']]);
  });

  it('authors no `scope` default — the imported default is stripped at the crossing', () => {
    const r = DashboardMirror.safeParse(dashboard({ globalFilters: [{ field: 'region' }] }));
    expect(r.success).toBe(true);
    expect((r as { data: { globalFilters: unknown[] } }).data.globalFilters).toEqual([{ field: 'region' }]);
  });
});

describe('control: a document both faces accepted before and after', () => {
  it('a plain-string action label and a labelled option pair still pass', () => {
    const header: DeclaredHeader = { showTitle: true, actions: [{ label: 'Open', actionUrl: '/reports', actionType: 'url' }] };
    const filter: DeclaredFilter = { field: 'region', type: 'select', options: [{ value: 'emea', label: 'EMEA' }] };
    expect(verdict(dashboard({ header, globalFilters: [filter] }))).toBe(true);
  });
});
