// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22444, ruling C — a page `list-view` node's `properties` are judged by
 * `ComponentPropsMap['list-view']`, the row's finding at this door.
 *
 * Until the row, `validateComponentProps` skipped the type as unregistered, so
 * a bag holding `kanban.groupField` or `options.grid` — refused at every list
 * view door — drew no finding at all (the census on the card measured 0). The
 * row needs no dispatch change here: the rule reads `ComponentPropsMap` by
 * type. The pins are the ruling's list, at this door: `kanban.groupField`
 * flagged naming the key; an `options` bag flagged as the retired key it is
 * since #25923 (the list overlay's tombstone, with its prescription); contract
 * keys only pass; the retired `objectName` / `viewType` flagged with the react
 * tier's prescription. The
 * schema half is pinned in `@objectstack/spec`
 * (`ui/component-list-view-row.test.ts`).
 *
 * Severity is the gate's own, the same for every `ComponentPropsMap` row: no
 * rule, tier or door is added here.
 */
import { REACT_RETIRED_OVERLAY_PROPS } from '@objectstack/spec/ui';
import { describe, expect, it } from 'vitest';

import { runAuthoringRules } from './authoring-rules.js';
import { COMPONENT_PROPS_INVALID, COMPONENT_PROPS_UNKNOWN_KEY, validateComponentProps } from './validate-component-props.js';

type AnyRec = Record<string, unknown>;

const pageWith = (node: AnyRec): AnyRec => ({
  name: 'sales_home',
  label: 'Sales Home',
  regions: [{ name: 'main', components: [node] }],
});

const AT = 'pages[0].regions[0].components[0]';
const BOUND = { data: { provider: 'object', object: 'deal' } };

const judge = (properties: AnyRec, node: AnyRec = {}) =>
  validateComponentProps({ pages: [pageWith({ type: 'list-view', ...node, properties })] });
const shape = (findings: ReturnType<typeof validateComponentProps>) =>
  findings.map((f) => [f.rule, f.severity, f.path]);

describe('a page `list-view` node is judged as a list view (#22444)', () => {
  it('`kanban.groupField` is flagged, naming the key', () => {
    const findings = judge({ ...BOUND, kanban: { groupByField: 'stage', columns: ['name'], groupField: 'owner' } });
    expect(shape(findings)).toEqual([[COMPONENT_PROPS_UNKNOWN_KEY, 'error', `${AT}.properties.kanban.groupField`]]);
  });

  it('an `options` bag is flagged as the retired key, with the list overlay\'s prescription', () => {
    const findings = judge({ ...BOUND, options: { grid: { pageSize: 10 } } });
    expect(shape(findings)).toEqual([[COMPONENT_PROPS_INVALID, 'error', `${AT}.properties.options`]]);
    expect(findings[0]!.message).toContain("A list view's `options` bag was removed in @objectstack/spec 18.3.0");
    expect(findings[0]!.message).toContain('a retired key is refused');
  });

  it.each([
    ['an object-bound kanban', { ...BOUND, type: 'kanban', columns: ['name'], kanban: { groupByField: 'stage', columns: ['name'] } }, {}],
    ['a column-less node bound by a saved view', {}, { dataSource: { object: 'deal', view: 'open_deals' } }],
    ['an absent bag', undefined, { dataSource: { object: 'deal' } }],
  ])('contract keys only pass — %s', (_label, properties, node) => {
    const findings = validateComponentProps({
      pages: [pageWith({ type: 'list-view', ...node, ...(properties === undefined ? {} : { properties }) })],
    });
    expect(findings).toEqual([]);
  });

  it.each(['objectName', 'viewType'] as const)('`%s` is flagged by name, with the react tier\'s prescription', (alias) => {
    const findings = judge({ ...BOUND, [alias]: alias === 'objectName' ? 'deal' : 'kanban' });
    expect(shape(findings)).toEqual([[COMPONENT_PROPS_UNKNOWN_KEY, 'error', `${AT}.properties.${alias}`]]);
    expect(findings[0]!.message).toContain(REACT_RETIRED_OVERLAY_PROPS.ListView![alias]!.note);
  });

  it('reaches the shared pipeline — the run `os validate` / `os build` / `os lint` read', () => {
    const findings = runAuthoringRules('validate', {
      normalized: { pages: [pageWith({ type: 'list-view', properties: { objectName: 'deal', options: { grid: {} } } })] } as never,
    });
    const mine = findings.filter((f) => f.path.startsWith(`${AT}.properties`));
    expect(mine.map((f) => [f.rule, f.path]).sort()).toEqual(
      [
        [COMPONENT_PROPS_UNKNOWN_KEY, `${AT}.properties.objectName`],
        [COMPONENT_PROPS_INVALID, `${AT}.properties.options`],
      ].sort(),
    );
  });
});
