/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The load-path premise `PageHeader` no longer has a fallback for
 * (objectui#3789).
 *
 * `PageHeader.tsx` used to read `subtitle ?? description`. That read was not
 * tolerance for a sloppy author — it was the ONLY thing standing between an
 * externally authored `description` and a page that renders its title and
 * silently drops its second line. objectui#3226 refused to delete it on the
 * strength of "no in-repo author writes `description`", because in-repo
 * authorship says nothing about the stored metadata of out-of-repo consumers.
 *
 * What replaced it is upstream normalization: the ADR-0087 D2 conversion
 * `page-header-subtitle-alias` rewrites a page-header node's
 * `properties.description` to `properties.subtitle` as the stack is loaded, so
 * the renderer only ever sees the canonical key. Deleting the fallback is
 * therefore safe exactly as far as that conversion REACHES — and reach was the
 * thing that failed, twice. Measured on 2026-08-08 against
 * `@objectstack/spec@17.0.0-rc.5`, the conversion walker visited
 * `pages[].regions[].components[]` and nothing else: seven spec-valid header
 * positions were left unconverted, including `slots.header` on a
 * `kind: 'slotted'` record page — the shape this repo's own
 * `content/docs/guide/slotted-pages.md` prescribes. objectstack#6775 recorded
 * that gap; #6776 fixed the slots half and PR #7034 the container-nesting half.
 *
 * So this file is the measurement, kept running. It is not a re-test of
 * upstream's own walker tests (`packages/spec/src/conversions/
 * page-component-walk.test.ts` and the cross-walker parity test in
 * `packages/lint` pin the reachable set INSIDE that repo). It pins the fact
 * this package's source now depends on: the spec build **objectui actually
 * resolves** rewrites the alias at every position a header can occupy. A
 * dependency pinned back to a pre-#7034 build, or a future narrowing of the
 * walk, fails here — loudly, at the seam — instead of turning into a second
 * line that quietly stops rendering in a consumer's app.
 *
 * Reading a failure: if a row goes red, the conversion no longer reaches that
 * shape. Do NOT re-add a `?? description` read to make it green (that is the
 * consumer-side tolerance objectui#3226 and AGENTS.md #0.1 both refuse) — fix
 * the walk upstream, or raise the reach loss as a spec-side regression.
 */

import { describe, it, expect } from 'vitest';
import { applyConversionsToStoredItem } from '@objectstack/spec';
import { PageSchema } from '@objectstack/spec/ui';

/** A page-header node authored with the retired alias. */
const legacyHeader = (line: string) => ({
  type: 'page:header',
  properties: { title: '{name}', description: line },
});

const recordPage = (extra: Record<string, unknown>) => ({
  name: 'account_detail_page',
  label: 'Account Detail',
  type: 'record',
  object: 'account',
  regions: [],
  ...extra,
});

/**
 * The seven positions objectstack#6775 enumerated, each with the probe that
 * digs the header back out of the converted page. Every one of them is
 * `PageSchema`-valid — that is what made the gap silent: nothing on the load
 * path validates `properties` per component `type`, so `properties.description`
 * parses green wherever it sits.
 */
const POSITIONS: ReadonlyArray<{
  readonly name: string;
  readonly page: Record<string, unknown>;
  readonly probe: (page: any) => Record<string, unknown>;
}> = [
  {
    name: 'regions[].components[] — the baseline the walk always reached',
    page: recordPage({ regions: [{ name: 'header', components: [legacyHeader('base line')] }] }),
    probe: (p) => p.regions[0].components[0].properties,
  },
  {
    name: "slots.header on a kind: 'slotted' page authoring regions: []",
    page: recordPage({
      kind: 'slotted',
      slots: { header: legacyHeader('slot line') },
    }),
    probe: (p) => p.slots.header.properties,
  },
  {
    name: 'page:card → properties.children[]',
    page: recordPage({
      regions: [
        {
          name: 'main',
          components: [{ type: 'page:card', properties: { children: [legacyHeader('card children line')] } }],
        },
      ],
    }),
    probe: (p) => p.regions[0].components[0].properties.children[0].properties,
  },
  {
    name: 'page:tabs → properties.items[].children[]',
    page: recordPage({
      regions: [
        {
          name: 'main',
          components: [
            {
              type: 'page:tabs',
              properties: { items: [{ label: 'Detail', children: [legacyHeader('tab line')] }] },
            },
          ],
        },
      ],
    }),
    probe: (p) => p.regions[0].components[0].properties.items[0].children[0].properties,
  },
  {
    name: 'page:card → properties.body[]',
    page: recordPage({
      regions: [
        { name: 'main', components: [{ type: 'page:card', properties: { body: [legacyHeader('card body line')] } }] },
      ],
    }),
    // `page-card-body-to-children` MOVES the container key on the way past, so
    // the converted node carries the sub-tree under `children`. Read whichever
    // spelling survives — this row is about the header inside, not about which
    // key the card ends up using.
    probe: (p) => {
      const props = p.regions[0].components[0].properties;
      return (props.children ?? props.body)[0].properties;
    },
  },
  {
    name: 'page:card → properties.footer[]',
    page: recordPage({
      regions: [
        {
          name: 'main',
          components: [{ type: 'page:card', properties: { footer: [legacyHeader('card footer line')] } }],
        },
      ],
    }),
    probe: (p) => p.regions[0].components[0].properties.footer[0].properties,
  },
  {
    name: 'slots.header → containers nested two deep',
    page: recordPage({
      kind: 'slotted',
      slots: {
        header: {
          type: 'page:card',
          properties: {
            children: [{ type: 'page:card', properties: { children: [legacyHeader('slot nested line')] } }],
          },
        },
      },
    }),
    probe: (p) => p.slots.header.properties.children[0].properties.children[0].properties,
  },
];

describe('page-header-subtitle-alias reaches every spec-valid header position', () => {
  it.each(POSITIONS.map((p) => [p.name, p] as const))(
    'rewrites `description` → `subtitle` at %s',
    (_name, position) => {
      // Reachability first: a shape the schema rejects would make the rewrite
      // assertion below vacuous — the conversion would be "covering" a page no
      // author can store. This is the half objectstack#6775 leaned on: these
      // are valid pages that were silently skipped, not invalid ones.
      const parsed = PageSchema.safeParse(structuredClone(position.page));
      expect(parsed.success, `not a spec-valid page: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);

      const converted = applyConversionsToStoredItem('pages', structuredClone(position.page));
      const properties = position.probe(converted);

      expect(properties).not.toHaveProperty('description');
      expect(typeof properties.subtitle).toBe('string');
      expect(properties.subtitle).toBe(
        (position.probe(position.page as any) as { description?: string }).description,
      );
    },
  );

  it('leaves a canonical `subtitle` alone and keeps a shadowed `description` visible', () => {
    // The conversion deliberately does NOT pick between two different second
    // lines (objectstack#4923) — it renames only when there is nothing to
    // clobber. That is why `PageHeader` can drop its fallback without also
    // needing a precedence rule: after conversion there is at most one
    // canonical key, and an author who wrote both still has both to reconcile.
    const page = recordPage({
      regions: [
        {
          name: 'header',
          components: [
            { type: 'page:header', properties: { title: 'Both', subtitle: 'canonical', description: 'other' } },
          ],
        },
      ],
    });
    const converted = applyConversionsToStoredItem('pages', structuredClone(page)) as any;
    const properties = converted.regions[0].components[0].properties;

    expect(properties.subtitle).toBe('canonical');
    expect(properties.description).toBe('other');
  });

  it("does not touch a component whose own declared prop is `description`", () => {
    // The type gate that makes the widened walk safe: an `element:text_input`'s
    // `description` is its helper text, a real declared prop, and descending
    // into containers must not start renaming it.
    const page = recordPage({
      regions: [
        {
          name: 'main',
          components: [
            {
              type: 'page:card',
              properties: {
                children: [{ type: 'element:text_input', properties: { label: 'Note', description: 'Helper text' } }],
              },
            },
          ],
        },
      ],
    });
    const converted = applyConversionsToStoredItem('pages', structuredClone(page)) as any;
    const properties = converted.regions[0].components[0].properties.children[0].properties;

    expect(properties.description).toBe('Helper text');
    expect(properties).not.toHaveProperty('subtitle');
  });
});
