/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10387 — the `header-bar` keys that have no read site and no in-tree
 * author retire from both faces (ADR-0049 enforce-or-remove; objectui#7759 ruling
 * rule 2 and D1-(ii): the key is objectui-own, the spec is silent, and the read
 * site is the truth).
 *
 * All eight keys the card names retire: `title`, `logo`, `nav`, `left`,
 * `center`, `right`, `sticky` and `height`. A one-off probe through the real
 * `SchemaRenderer` and the real registry drew the header byte-identical to its
 * absence for every value tried, with `rightContent` as the lit control that did
 * change the markup. Four of them (`title`, `logo`, `right`, `sticky`) had
 * documentation and type-check-example authors and no read site; the PM seat
 * ruled they retire too, and those authors migrated to `crumbs` / `actions`.
 *
 * `BaseSchema` is `.passthrough()`: an UNDECLARED key parses green unexamined. So
 * every refusal here has a lit control on the same document, an unknown key that
 * must stay green, which shows the refusal is the declared key's own verdict.
 */

import { describe, it, expect } from 'vitest';
import { HeaderBarSchema } from '../zod/navigation.zod.js';
import type { HeaderBarSchema as HeaderBarSchemaType } from '../navigation.js';

const UNKNOWN_KEY = 'zzzNotAKeyAnySurfaceDeclares10387';
const NODE = { type: 'header-bar' as const, crumbs: [{ label: 'Home' }] };
const TEXT = { type: 'text', content: 'x' };

/** Values each face used to admit for the key, one per former arm. */
const FORMER_VALUES: Record<'title' | 'logo' | 'nav' | 'left' | 'center' | 'right' | 'sticky' | 'height', unknown[]> = {
  // `logo` is the key whose two faces disagreed: the declaration said a URL string,
  // the mirror a node or node list. Every arm either face admitted is refused now.
  title: ['My App'],
  logo: ['/logo.svg', TEXT, [TEXT]],
  nav: [[{ label: 'Docs', href: '/docs' }], []],
  left: [TEXT, [TEXT], 'plain text'],
  center: [TEXT, [TEXT], 'plain text'],
  right: [TEXT, [TEXT]],
  sticky: [true, false],
  height: ['64px', 64],
};

function refusedPaths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }): string[] {
  return result.success ? [] : (result.error?.issues ?? []).map((i) => i.path.map(String).join('.'));
}

describe('header-bar unread keys retire on both faces (objectui#10387)', () => {
  for (const [key, values] of Object.entries(FORMER_VALUES)) {
    it(`\`${key}\` is refused BY NAME for every value a former arm admitted`, () => {
      for (const value of values) {
        const result = HeaderBarSchema.safeParse({ ...NODE, [key]: value });
        expect(refusedPaths(result), `${key}: ${JSON.stringify(value)}`).toEqual([key]);
      }
    });

    it(`\`${key}\`'s refusal says why and names what the renderer reads instead`, () => {
      const result = HeaderBarSchema.safeParse({ ...NODE, [key]: values[0] });
      expect(result.success).toBe(false);
      const issue = result.success ? undefined : result.error.issues[0];
      expect(issue?.code).toBe('invalid_type');
      expect(issue?.message.startsWith('REFUSED (objectui#10387, ADR-0049)')).toBe(true);
      for (const read of ['actions', 'crumbs', 'rightContent', 'search']) expect(issue?.message).toContain(`\`${read}\``);
    });
  }

  it('lit control: the same document without the keys, and with an undeclared key, parses', () => {
    expect(HeaderBarSchema.safeParse(NODE).success).toBe(true);
    expect(HeaderBarSchema.safeParse({ ...NODE, [UNKNOWN_KEY]: 'x' }).success).toBe(true);
  });

  it('the keys the renderer DOES read still parse (what the refusals point at)', () => {
    const doc = { ...NODE, search: { enabled: true }, actions: [TEXT], rightContent: TEXT };
    expect(HeaderBarSchema.safeParse(doc).success).toBe(true);
  });

  it('the declaration refuses them too (compile-time)', () => {
    // @ts-expect-error — `title` is `never` on the TS face.
    const e: HeaderBarSchemaType = { type: 'header-bar', title: 'My App' };
    // @ts-expect-error — `logo` is `never` on the TS face.
    const f: HeaderBarSchemaType = { type: 'header-bar', logo: '/logo.svg' };
    // @ts-expect-error — `right` is `never` on the TS face.
    const g: HeaderBarSchemaType = { type: 'header-bar', right: [] };
    // @ts-expect-error — `sticky` is `never` on the TS face.
    const h: HeaderBarSchemaType = { type: 'header-bar', sticky: true };
    // @ts-expect-error — `nav` is `never` on the TS face.
    const a: HeaderBarSchemaType = { type: 'header-bar', nav: [{ label: 'Docs', href: '/docs' }] };
    // @ts-expect-error — `left` is `never` on the TS face.
    const b: HeaderBarSchemaType = { type: 'header-bar', left: 'x' };
    // @ts-expect-error — `center` is `never` on the TS face.
    const c: HeaderBarSchemaType = { type: 'header-bar', center: 'x' };
    // @ts-expect-error — `height` is `never` on the TS face.
    const d: HeaderBarSchemaType = { type: 'header-bar', height: 64 };
    expect([a, b, c, d, e, f, g, h].every((n) => n.type === 'header-bar')).toBe(true);
  });
});
