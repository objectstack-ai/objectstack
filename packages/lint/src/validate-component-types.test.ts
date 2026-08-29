// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `component-type-unknown` gate (#12950): a component `type` inside a
 * spec-reserved namespace must be vocabulary the platform declares. Both
 * directions matter equally here — the negative half (what the rule must NOT
 * flag) is the measured extension story a union collapse would have broken, so
 * each negative case names the face it protects.
 */
import { describe, it, expect } from 'vitest';
import {
  validateComponentTypes,
  COMPONENT_TYPE_UNKNOWN,
} from './validate-component-types.js';

const page = (components: unknown[], name = 'p1', extra: Record<string, unknown> = {}) => ({
  pages: [{ name, regions: [{ name: 'main', components }], ...extra }],
});

describe('refuses undeclared types inside reserved namespaces', () => {
  it('flags a typo of an enum member and suggests the declared spelling', () => {
    const findings = validateComponentTypes(page([{ type: 'global:serch' }]));
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.rule).toBe(COMPONENT_TYPE_UNKNOWN);
    expect(f.severity).toBe('error');
    expect(f.path).toBe('pages[0].regions[0].components[0].type');
    expect(f.where).toBe('page "p1" · global:serch');
    expect(f.message).toContain('`global:serch`');
    expect(f.message).toContain("'global:search'");
    expect(f.hint).toContain('global:search');
  });

  it('flags a typo of a record component', () => {
    const findings = validateComponentTypes(page([{ type: 'record:detials' }]));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("'record:details'");
  });

  it('a far-from-anything reserved string gets the own-namespace prescription', () => {
    const findings = validateComponentTypes(page([{ type: 'record:zzzz_qqqq_wwww' }]));
    expect(findings).toHaveLength(1);
    expect(findings[0].hint).toContain('own namespace');
    expect(findings[0].hint).toContain('my-plugin:zzzz_qqqq_wwww');
  });

  it('reaches nested components (tab item children)', () => {
    const findings = validateComponentTypes(
      page([
        {
          type: 'page:tabs',
          properties: { items: [{ label: 'T', children: [{ type: 'element:txt' }] }] },
        },
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe(
      'pages[0].regions[0].components[0].properties.items[0].children[0].type',
    );
    expect(findings[0].message).toContain("'element:text'");
  });

  it('reaches slot-mounted components', () => {
    const findings = validateComponentTypes({
      pages: [{ name: 'sl', kind: 'record', slots: { header: { type: 'page:headr' } } }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('pages[0].slots.header.type');
    expect(findings[0].message).toContain("'page:header'");
  });
});

describe('leaves the declared vocabulary and the open arm alone', () => {
  it.each([
    // Enum members — including this card's two kept Phase-2 members.
    'global:search',
    'global:notifications',
    'page:header',
    'record:details',
    // ComponentPropsMap rows that are NOT enum members: the measured
    // string-arm registrations that earned a row.
    'element:metadata_viewer',
    // Retired at element grain with the row KEPT so the props gate dispatches
    // the tombstones — the type stays accepted; the keys refuse (#9220 shape).
    'element:filter',
    'element:form',
    // The string-arm registration ledger (registered in objectui, row-less by
    // pinned decision).
    'record:line_items',
    // Plugin namespaces — the open arm's declared story.
    'mcp:connect-agent',
    'cloud-connection:panel',
    'marketplace:installed-list',
    // Colon-free custom/SDUI shapes — ditto.
    'flex',
    'grid',
    'object-chart',
    'object-grid',
    'page-header',
    'custom.widget',
  ])('accepts %s', (type) => {
    expect(validateComponentTypes(page([{ type }]))).toEqual([]);
  });

  it('yields nothing for source-authored pages (react/jsx/html)', () => {
    const findings = validateComponentTypes({
      pages: [
        {
          name: 'r1',
          kind: 'react',
          source: 'export default () => null',
          regions: [{ name: 'main', components: [{ type: 'global:serch' }] }],
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('tolerates malformed input shapes', () => {
    expect(validateComponentTypes({} as never)).toEqual([]);
    expect(validateComponentTypes({ pages: 'nope' } as never)).toEqual([]);
    expect(validateComponentTypes(page([{ type: 42 }, {}, null]))).toEqual([]);
  });

  it('walks name-keyed page maps', () => {
    const findings = validateComponentTypes({
      pages: {
        keyed_page: { regions: [{ name: 'main', components: [{ type: 'nav:menue' }] }] },
      },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].where).toBe('page "keyed_page" · nav:menue');
    expect(findings[0].message).toContain("'nav:menu'");
  });
});
