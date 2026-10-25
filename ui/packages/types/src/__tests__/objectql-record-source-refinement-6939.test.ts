/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6939, the `object-map` + `object-gantt` group — one of the eight the
 * card measured, dispatched as its own PR per the maintainer ruling recorded
 * 2026-09-02 (director seat, summon #8, decision batch #8):
 *
 *   > `object-map` + `object-gantt`: `objectName` becomes optional with a
 *   > refinement that at least one of `data`, `staticData`, `objectName` is
 *   > present.
 *
 * ## The defect
 *
 * Both mirrors REQUIRED `objectName`. Both renderers resolve their records from
 * one of THREE keys, in this order (`schema.data`, `schema.staticData`,
 * `schema.objectName`) — today through the shared `resolveRecordSourceConfig`
 * in `@object-ui/core` (objectui#7632), which `plugin-map/src/ObjectMap.tsx`
 * reaches via its local `getDataConfig` wrapper and
 * `plugin-gantt/src/ObjectGantt.tsx` calls directly. A document authored on
 * `staticData` alone draws correctly
 * and was refused by `safeValidateSchema`: six catalog entries, three per
 * component, every one of them `staticData`-only.
 *
 * ## What this file pins — the VALIDATOR half
 *
 * The render half ("byte-identical in element count and text before and after")
 * lives beside each renderer, where the tile can actually be drawn:
 * `examples/schema-catalog/test/objectql-record-source-render-identity-6939.test.tsx`
 * (gantt) and `packages/plugin-map/src/ObjectMap.catalogRecordSource-6939.test.tsx`
 * (map — maplibre has to be stood in for, and the stand-in only takes effect
 * from the package that resolves `react-map-gl/maplibre`).
 *
 * The negative arm asserts the ISSUE, not merely that the parse failed: a
 * document refused for an unrelated reason would otherwise read as a passing
 * pin. The refinement's issue is checked by `path`, `params.code` and the three
 * key names in its message.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectCalendarSchema, ObjectGanttSchema, ObjectMapSchema, safeValidateSchema } from '../zod/index.zod';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** The six catalog entries the card counts behind these two rows. */
const CATALOG_ENTRIES = [
  'plugin-map/event-venue-finder',
  'plugin-map/real-time-delivery-tracking',
  'plugin-map/store-locator-map',
  'plugin-gantt/construction-project-phases',
  'plugin-gantt/project-timeline-with-dependencies',
  'plugin-gantt/sprint-development-timeline',
] as const;

function catalogEntry(id: string): Record<string, unknown> {
  const file = path.join(REPO_ROOT, 'examples/schema-catalog/src/schemas', `${id}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
}

/**
 * The props of a document as its author wrote them. Since objectui#10859
 * batches 5 and 6 an authored `object-map` or `object-gantt` takes them in the
 * spec's `properties` bag, and the six entries below are written that way.
 */
function authoredProps(doc: Record<string, unknown>): Record<string, unknown> {
  return doc.properties as Record<string, unknown>;
}

/** The authored spelling of a node's props: in the bag (objectui#10859 batches 5 and 6). */
function authored(type: string, props: Record<string, unknown>): Record<string, unknown> {
  return { type, properties: props };
}

/** Report the issues rather than `false`, so a red run says what broke. */
function reasons(schema: unknown): string[] {
  const r = safeValidateSchema(schema);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

const MEMBERS = [
  ['object-map', ObjectMapSchema],
  ['object-gantt', ObjectGanttSchema],
] as const;

describe('objectui#6939 — the six catalog entries the mirrors refused now validate', () => {
  it.each(CATALOG_ENTRIES)('%s validates under safeValidateSchema', (id) => {
    const doc = catalogEntry(id);
    // The control that makes the case discriminating: every one of these
    // authors NO `objectName` and DOES author `staticData`. Before this card
    // each reported `: Invalid input` (the union's own top-level issue).
    const props = authoredProps(doc);
    expect('objectName' in props).toBe(false);
    expect(Array.isArray(props.staticData)).toBe(true);
    expect(reasons(doc)).toEqual([]);
  });
});

describe('objectui#6939 — any ONE of the three record sources satisfies the refinement', () => {
  it.each(MEMBERS)('%s accepts `data` alone, `staticData` alone and `objectName` alone', (type, member) => {
    expect(member.safeParse({ type, data: { provider: 'object', object: 'tasks' } }).success).toBe(true);
    expect(member.safeParse({ type, staticData: [] }).success).toBe(true);
    expect(member.safeParse({ type, objectName: 'tasks' }).success).toBe(true);
    // …and the same three through the published entry point, spelled as an
    // author writes them.
    expect(reasons(authored(type, { staticData: [{ id: 1 }] }))).toEqual([]);
    expect(reasons(authored(type, { objectName: 'tasks' }))).toEqual([]);
  });

  it.each(MEMBERS)('%s: the accept set only WIDENED — `objectName` alone still parses, an empty one included', (type, member) => {
    // Presence is `!== undefined`, not the renderer's truthiness: `objectName:
    // ''` validated before this card (a required `z.string()` accepts '') and
    // must still validate, or the change would narrow something.
    expect(member.safeParse({ type, objectName: '' }).success).toBe(true);
  });
});

describe('objectui#6939 — a document with NONE of the three is refused ON THE REFINEMENT', () => {
  it.each(MEMBERS)('%s: one root-level issue, keyed RECORD_SOURCE_REQUIRED, naming all three keys', (type, member) => {
    const result = member.safeParse({ type, label: 'no source at all' });
    expect(result.success).toBe(false);
    if (result.success) return;
    // Exactly one issue, and it is the refinement's — not a stray key-level
    // failure that would make this case green for the wrong reason.
    expect(result.error.issues).toHaveLength(1);
    const issue = result.error.issues[0];
    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual([]);
    expect((issue as { params?: { code?: string } }).params?.code).toBe('RECORD_SOURCE_REQUIRED');
    for (const key of ['data', 'staticData', 'objectName']) {
      expect(issue.message).toContain(`\`${key}\``);
    }
    expect(issue.message).toContain(`\`${type}\``);
  });

  it.each(MEMBERS)('%s: …and the published entry point refuses it too', (type) => {
    expect(safeValidateSchema({ type }).success).toBe(false);
  });
});

describe('objectui#6939 — the refinement sits on declared keys, and the objects stayed objects', () => {
  it.each(MEMBERS)('%s still exposes `.shape`, with `objectName` optional in it', (_type, member) => {
    // zod 4 attaches a refinement to the object in place; had it wrapped the
    // object, `.shape` would be gone and the parity census in
    // `zod-mirror-parity.test.ts` would read the pair as vacuous.
    const shape = (member as unknown as { shape: Record<string, { safeParse: (v: unknown) => { success: boolean } }> }).shape;
    expect(Object.keys(shape)).toEqual(expect.arrayContaining(['objectName', 'data', 'staticData']));
    expect(shape.objectName.safeParse(undefined).success).toBe(true);
    expect(shape.objectName.safeParse(5).success).toBe(false);
  });

  it('object-gantt: `data` is DECLARED, not a passthrough hole', () => {
    // Counter-probe. `data` was undeclared on the gantt mirror until this
    // card, so a malformed value rode through `.passthrough()` unvalidated —
    // and the refinement would have accepted a document on the strength of a
    // key the validator had never heard of. `objectName` is supplied so the
    // only thing under test is the value of `data`.
    expect(ObjectGanttSchema.safeParse({ type: 'object-gantt', objectName: 'tasks', data: 'nope' }).success).toBe(false);
    expect(ObjectGanttSchema.safeParse({ type: 'object-gantt', objectName: 'tasks', data: { provider: 'object', object: 'tasks' } }).success).toBe(true);
    // Same shape as the map's, so the two record sources cannot fork.
    expect(ObjectMapSchema.safeParse({ type: 'object-map', objectName: 'stores', data: 'nope' }).success).toBe(false);
  });
});

describe('objectui#9618 — the record-source text names the function each renderer actually has', () => {
  // `getDataConfig` left `ObjectGantt.tsx` (and never lived in
  // `ObjectCalendar.tsx`) when objectui#7632 moved the ladder into
  // `resolveRecordSourceConfig`; only `ObjectMap.tsx` keeps a local wrapper by
  // that name. So the gantt and calendar faces must not name it, and the map
  // face — whose text is TRUE — is the control that the descriptions and the
  // source slice are actually being read.
  type Described = { shape: Record<string, { description?: string }> };
  const describes = (member: unknown): Record<string, string> =>
    Object.fromEntries(
      Object.entries((member as Described).shape).map(([k, v]) => [k, v.description ?? '']),
    );

  /** The `export interface NAME` block of the TS face, up to the next export. */
  function tsFace(name: string): string {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'packages/types/src/objectql.ts'), 'utf8');
    const at = src.indexOf(`export interface ${name} `);
    expect(at, `${name} interface not found in objectql.ts`).toBeGreaterThan(-1);
    const end = src.indexOf('\nexport ', at + 1);
    return src.slice(at, end === -1 ? undefined : end);
  }

  it.each([
    ['ObjectGanttSchema', ObjectGanttSchema],
    ['ObjectCalendarSchema', ObjectCalendarSchema],
  ] as const)('%s: no zod describe and no TS doc names `getDataConfig`', (name, member) => {
    const d = describes(member);
    expect(Object.entries(d).filter(([, text]) => text.includes('getDataConfig'))).toEqual([]);
    expect(d.objectName).toContain('resolveRecordSourceConfig');
    expect(d.staticData).toContain('resolveRecordSourceConfig');
    const face = tsFace(name);
    expect(face).not.toContain('getDataConfig');
    expect(face).toContain('resolveRecordSourceConfig');
  });

  it('⛔ CONTROL: the map faces still name its real local `getDataConfig`', () => {
    expect(describes(ObjectMapSchema).objectName).toContain('getDataConfig');
    expect(tsFace('ObjectMapSchema')).toContain('getDataConfig');
    const renderer = fs.readFileSync(path.join(REPO_ROOT, 'packages/plugin-map/src/ObjectMap.tsx'), 'utf8');
    expect(renderer).toContain('function getDataConfig(');
  });
});
