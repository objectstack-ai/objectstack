/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6751 — the `flex` node in `data-display-examples.json` declares its
 * layout keys where they reach the renderer, not inside a `props` envelope.
 *
 * ## What was wrong
 *
 * `compositeExample` authored
 *
 *     { "type": "flex", "props": { "direction": "col", "gap": 4 } }
 *
 * `SchemaRenderer` hoists `properties.*` onto the node and spreads `props` as
 * React props instead, so a renderer declared `({ schema })` — the ordinary
 * component-renderer shape, which `flex.tsx` has — never sees the envelope.
 * The example therefore rendered with the DEFAULT `row` direction and the
 * DEFAULT gap while presenting itself as a column with `gap: 4`. objectui#6751
 * lifted the two keys onto the node.
 *
 * ## Where they live now (objectui#11276)
 *
 * The maintainer's ruling A on objectui#11300 made the `properties` bag the
 * contract on `flex`, as `@objectstack/spec`'s page component declares it, and
 * revoked objectui#6751's fence ("`flex` declares its own keys", "it is NOT to
 * rename `props` to `properties`") for `flex` only. So the keys sit in the
 * `properties` bag — which `SchemaRenderer` DOES hoist, unlike `props` — and
 * the authored arm (`FlexBlockSchema`) refuses them flat on the node by name.
 * The `props` envelope stays wrong, for the reason above.
 *
 * ## Why the assertions here are structural rather than acceptance-shaped
 *
 * `BaseSchema` is `.passthrough()`, so a `props` envelope parses GREEN through
 * every schema in this package and would keep doing so. Acceptance cannot tell
 * "in the bag" from "still under `props`, admitted unexamined". What separates
 * the two is the parsed VALUE:
 *
 *     fixture state          FlexBlockSchema.parse(node).properties?.direction / ?.gap / 'props' in node
 *     props envelope         undefined / undefined / true
 *     in the properties bag  'col'     / 4         / false
 *
 * ## The fence this file must not cross (objectui#6751 triage, twice)
 *
 * Three same-shaped occurrences elsewhere in the repo are DELIBERATE
 * counter-examples — `skills/objectui/rules/protocol.md`'s `card`, and
 * `skills/objectui/guides/schema-expressions.md`'s `card` and `text`, each
 * marked wrong where it stands. The walk below is scoped to this one fixture
 * for that reason: a repo-wide "no node carries `props`" assertion would make
 * the teaching material fail. (That half of the fence stands: objectui#11276
 * revoked only its "`flex` declares its own keys" half, and only for `flex`.)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FlexBlockSchema, LayoutSchema } from '../zod/layout.zod';

const ROOT = resolve(__dirname, '../../../..');
const FIXTURE = 'packages/types/examples/data-display-examples.json';

/** The fixture is an arbitrary JSON document, so it is read as one. */
type JsonObject = { [key: string]: unknown };

function readFixture(): JsonObject {
  return JSON.parse(readFileSync(resolve(ROOT, FIXTURE), 'utf8')) as JsonObject;
}

/** `doc[key]`, refused loudly rather than read as `undefined` if it is not an object. */
function objectAt(doc: JsonObject, key: string): JsonObject {
  const value = doc[key];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${FIXTURE}: expected an object at \`${key}\`, got ${JSON.stringify(value)}`);
  }
  return value as JsonObject;
}

/**
 * Every object in `doc` that carries a `type` AND a `props` key, reported as
 * `type` + JSON path. The `element:*` namespace is excluded because those
 * renderers read `props` by design (`readProps` merges both bags); every other
 * `type` is a component-renderer type, which never sees the envelope.
 */
function envelopeSites(doc: unknown, path = '$'): string[] {
  const hits: string[] = [];
  if (Array.isArray(doc)) {
    doc.forEach((v, i) => hits.push(...envelopeSites(v, `${path}[${i}]`)));
    return hits;
  }
  if (doc === null || typeof doc !== 'object') return hits;
  const node = doc as Record<string, unknown>;
  if (typeof node.type === 'string' && !node.type.startsWith('element:')
      && Object.prototype.hasOwnProperty.call(node, 'props')) {
    hits.push(`${path} (type=${node.type})`);
  }
  for (const [k, v] of Object.entries(node)) hits.push(...envelopeSites(v, `${path}.${k}`));
  return hits;
}

describe('objectui#6751 — flex layout keys sit in the `properties` bag, not under `props` (objectui#11276)', () => {
  it('compositeExample parses through FlexBlockSchema with direction/gap in its bag', () => {
    const node = objectAt(readFixture(), 'compositeExample');
    expect(node.type).toBe('flex');

    const parsed = FlexBlockSchema.parse(node);
    // Under the envelope these two read UNDEFINED, and the renderer applies its
    // defaults ('row' / 2), which is precisely the bug: the document says one
    // thing and renders another.
    expect(parsed.properties?.direction).toBe('col');
    expect(parsed.properties?.gap).toBe(4);
    // Not on the node: the authored arm refuses them there by name.
    expect(Object.prototype.hasOwnProperty.call(node, 'direction')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(node, 'gap')).toBe(false);
    // `.passthrough()` carries unknown keys through, so a surviving `props` on
    // the PARSED node is the direct reading that the envelope is still there.
    expect(Object.prototype.hasOwnProperty.call(parsed, 'props')).toBe(false);
  });

  it('compositeExample parses the same way through the published LayoutSchema union', () => {
    const parsed = LayoutSchema.parse(objectAt(readFixture(), 'compositeExample')) as JsonObject;
    expect(parsed.type).toBe('flex');
    expect(parsed.properties).toMatchObject({ direction: 'col', gap: 4 });
    expect(Object.prototype.hasOwnProperty.call(parsed, 'props')).toBe(false);
  });

  it('no component-renderer node anywhere in the fixture carries a `props` envelope', () => {
    expect(envelopeSites(readFixture())).toEqual([]);
  });

  it('positive control — the walk above catches an envelope when one is present', () => {
    // Without this, the zero on the previous assertion could come from a walker
    // that never reports anything.
    const doc = readFixture();
    objectAt(doc, 'compositeExample').props = { direction: 'col', gap: 4 };
    expect(envelopeSites(doc)).toEqual(['$.compositeExample (type=flex)']);
  });

  it('negative control — `properties` and the `element:*` carve-out are not flagged', () => {
    // `properties` is the bag SchemaRenderer DOES hoist, and `element:*` reads
    // `props` by design; flagging either would make the zero above meaningless.
    expect(envelopeSites({ type: 'card', properties: { title: 'Customer Summary' } })).toEqual([]);
    expect(envelopeSites({ type: 'element:div', props: { className: 'p-4' } })).toEqual([]);
  });

  it('negative control — the move left the rest of the node untouched', () => {
    const node = objectAt(readFixture(), 'compositeExample');
    expect(node.id).toBe('user-profile-card');
    // The child list moved into the bag with the other `flex` props (objectui#11276).
    const children = objectAt(node, 'properties').children as JsonObject[];
    expect(children.map((c) => c.type)).toEqual(['avatar', 'statistic', 'badge', 'list']);
    expect(children[0]).toMatchObject({
      type: 'avatar', alt: 'User Avatar', fallback: 'JD', size: 'lg',
    });
  });
});
