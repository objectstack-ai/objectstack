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
  hasReservedComponentNamespace,
  RETIRED_PAGE_COMPONENT_TYPES,
} from '@objectstack/spec/ui';
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
    // ⛔ The RETIRED types are deliberately NOT here — their kept
    // `ComponentPropsMap` row makes them `isKnownComponentType`, and this rule
    // used to read that as "accepted". They now have their own describe below.
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

/**
 * #17595 — the EXACT-name half of the retirement story.
 *
 * A retired type is `isKnownComponentType` on purpose (its `ComponentPropsMap`
 * row is kept so the props door can dispatch the prescription), which is
 * exactly what made this rule walk past it in silence while
 * `PageComponentSchema.type` refuses the same name at the parse. Measured on
 * both sides of the #17592 review: `element:filter` → no finding, before and
 * after. This suite pins the report, and pins it BYTE-EQUAL to
 * `RETIRED_PAGE_COMPONENT_TYPES` — the rule relays the spec's prescription, it
 * does not author a second copy, so drift between the three doors is not
 * expressible.
 *
 * Driven off the map rather than a restated list: a type retired tomorrow
 * arrives here covered on the day it lands.
 */
describe('reports an EXACT retired component type, relaying the spec prescription (#17595)', () => {
  // The `it.each` below is only a reading if the map is populated — a lit
  // control for the loop itself, not decoration.
  it('the retirement map is non-empty (control for the cases below)', () => {
    expect(RETIRED_PAGE_COMPONENT_TYPES.size).toBeGreaterThan(0);
  });

  it.each([...RETIRED_PAGE_COMPONENT_TYPES.keys()])('flags %s', (type) => {
    const findings = validateComponentTypes(page([{ type }]));
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.rule).toBe(COMPONENT_TYPE_UNKNOWN);
    expect(f.severity).toBe('error');
    expect(f.path).toBe('pages[0].regions[0].components[0].type');
    expect(f.where).toBe(`page "p1" · ${type}`);
    // Verbatim, not "contains": the relay is the contract.
    expect(f.message).toBe(RETIRED_PAGE_COMPONENT_TYPES.get(type));
    expect(f.hint).toContain(type);
  });

  /**
   * The ordering pin. `RESERVED_COMPONENT_TYPE_NAMESPACES` is derived from the
   * enum, and `user:profile` was the `user:` namespace's only member — so the
   * namespace guard is FALSE for it and a retired-name check placed after that
   * guard would report the two elements and stay silent on the member that has
   * been refused longest. This asserts the reason, not just the outcome.
   */
  it('reaches `user:profile`, whose namespace left the reserved set with it', () => {
    expect(hasReservedComponentNamespace('user:profile')).toBe(false);
    const findings = validateComponentTypes(page([{ type: 'user:profile' }]));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toBe(RETIRED_PAGE_COMPONENT_TYPES.get('user:profile'));
  });

  it('reaches a retired type nested under a tab item, at its own path', () => {
    const findings = validateComponentTypes(
      page([
        {
          type: 'page:tabs',
          properties: { items: [{ label: 'T', children: [{ type: 'element:form' }] }] },
        },
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe(
      'pages[0].regions[0].components[0].properties.items[0].children[0].type',
    );
  });

  it('stays silent on a source-authored page, like every other arm', () => {
    const findings = validateComponentTypes({
      pages: [
        {
          name: 'r1',
          kind: 'react',
          source: 'export default () => null',
          regions: [{ name: 'main', components: [{ type: 'element:filter' }] }],
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('does not re-author the prescription: no second copy of the guidance', () => {
    // The hint is a located statement about the refusal, never a restatement
    // of the map's own text (which would be the third copy the retirement
    // explicitly forbids).
    for (const [type, prescription] of RETIRED_PAGE_COMPONENT_TYPES) {
      const f = validateComponentTypes(page([{ type }]))[0];
      expect(f.hint).not.toContain(prescription);
    }
  });
});

/**
 * #15110 — the suggester must never rename an author INTO a retired type.
 *
 * Measured before the fix, through this same rule: `element:fitler` was
 * answered `Rename \`element:fitler\` → \`element:filter\``, and
 * `element:frm` → `element:form`. Both targets are types
 * `PageComponentSchema` refuses by name, so the tool was emitting guidance the
 * parser rejects — wrong guidance, not a missing refusal.
 *
 * Pinned through the RULE, never by reading `KNOWN_COMPONENT_TYPE_CANDIDATES`:
 * the array is the mechanism, the hint is the contract.
 */
describe('retired types are never proposed as typo suggestions (#15110)', () => {
  it.each([
    ['element:fitler', 'element:filter'],
    ['element:frm', 'element:form'],
  ])('a near-miss of %s no longer proposes the retired %s', (typo, retired) => {
    const findings = validateComponentTypes(page([{ type: typo }]));
    // The typo is still refused — the rule's own job is untouched.
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.rule).toBe(COMPONENT_TYPE_UNKNOWN);
    // ...but nothing about the finding points the author at the retired name.
    expect(f.hint).not.toContain(retired);
    expect(f.message).not.toContain(retired);
  });

  it('the reverse direction: what it proposes instead is never worse', () => {
    // A retired-name near-miss either proposes a type that is actually
    // writable, or proposes nothing and falls back to the own-namespace
    // prescription. Both are acceptable; a proposal the parser would refuse is
    // not, which is what the per-case assertion above forbids.
    for (const typo of ['element:fitler', 'element:frm']) {
      const f = validateComponentTypes(page([{ type: typo }]))[0];
      const proposed = /Rename `[^`]+` → `([^`]+)`/.exec(f.hint)?.[1];
      if (proposed === undefined) {
        expect(f.hint).toContain('give it its own namespace');
        continue;
      }
      // Whatever it proposes must itself pass the vocabulary the rule guards.
      expect(validateComponentTypes(page([{ type: proposed }]))).toEqual([]);
    }
  });

  it('LIVE types are still proposed — the lit control', () => {
    // Same rule, same call shape, same reserved-namespace typo: if the
    // subtraction had emptied the candidate list, these would go quiet too.
    expect(validateComponentTypes(page([{ type: 'global:serch' }]))[0].hint)
      .toContain('global:search');
    expect(validateComponentTypes(page([{ type: 'element:butotn' }]))[0].hint)
      .toContain('element:button');
    expect(validateComponentTypes(page([{ type: 'record:detials' }]))[0].hint)
      .toContain('record:details');
  });
});
