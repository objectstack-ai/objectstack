/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The public-block examples taught outside objectui#11183's roots write their
 * props in the `properties` bag, and each one passes both faces
 * (objectui#11321, item 1).
 *
 * ## The hole this closes
 *
 * objectui#11183 moved the taught `action:*` nodes into the spec's `properties`
 * bag (triage's ruling A of the objectui#10872 family: the bag is the page
 * node's contract, and `@objectstack/spec`'s `PageComponentSchema` is strict
 * for every type). Four examples outside that card's roots were written flat:
 *
 *   - `content/docs/guide/slotted-pages.md`, the `record:related_list` node
 *     under "Naming a related list's actions";
 *   - `content/docs/api/schema-reference.md`, the same block inside the
 *     blockquote that retires `detail-view`'s `related`;
 *   - `packages/app-shell/README.md`, the two `action:button` route examples
 *     under "Record create/edit modes". That README ships in the
 *     `@object-ui/app-shell` tarball.
 *
 * objectui#10872 batch 10 moved the slotted-pages node and the two README
 * nodes into the bag. Its census reads fenced code, and the schema-reference
 * node sits inside a blockquote, so it stayed flat until this card. No gate was
 * asking about any of the four: `check:doc-types` judges only the `type`
 * literal, and the docs-snippet gates compile `ts` / `tsx` fences, while these
 * are `json`.
 *
 * ## What is pinned, for each example
 *
 *   1. The tolerant face (`safeValidateSchema`) accepts the node.
 *   2. The strict authoring face (`StrictAnyComponentSchema`) accepts it, so
 *      every key it writes is declared.
 *   3. `@objectstack/spec`'s `PageComponentSchema` accepts it, which judges the
 *      node's own keys and leaves `properties` open.
 *   4. The spec row `ComponentPropsMap[type]` accepts the bag in a FULL parse,
 *      so its values are judged as well as its keys. This is the judge `os
 *      validate`'s props gate applies to the bag.
 *   5. CONTROL: the same node written flat (its bag spread onto the node) is
 *      refused by the strict face and by the spec's page component, on exactly
 *      the moved keys the spec's page component does not declare at node
 *      level. Without it, a judge that stopped judging would pass 1 to 4 too.
 *
 * The `record:related_list` node in slotted-pages carries `actions`. That key
 * IS a member of the spec row (`RecordRelatedListProps.actions`, "Action IDs
 * available for related records"), so it belongs in the bag with the others;
 * point 4 judges it there.
 *
 * ## Why the nodes are EXTRACTED, never restated here
 *
 * A copy of an example in this file would be a second, hand-kept twin of the
 * page, which is how a page drifts. Each node is read off disk on every run:
 * the section is bounded by its own heading, fence pairing is
 * `scripts/markdown-fence-scan.mjs`, and the fence body is parsed as JSON. A
 * blockquote is read with its quote markers stripped first. A node the harness
 * cannot find FAILS; it is never skipped.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComponentPropsMap, PageComponentSchema } from '@objectstack/spec/ui';
import { safeValidateSchema, StrictAnyComponentSchema } from '../zod/index.zod.js';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { closesFence, openFence } from '../../../../scripts/markdown-fence-scan.mjs';

interface OpenFence {
  marker: string;
  run: number;
  info: string;
  lang: string;
}

/** Local annotations, since the import above is untyped — the call sites stay checked. */
const open: (line: string) => OpenFence | null = openFence;
const closes: (line: string, fence: OpenFence) => boolean = closesFence;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

interface Node {
  type: string;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

interface Example {
  /** `file:line` of the fence body's first line — what a failure prints. */
  where: string;
  node: Node;
}

/** The `json` fences in `lines`, parsed; `offset` maps a slice index back to a file line. */
function jsonFences(lines: string[], file: string, offset: number): Example[] {
  const found: Example[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const fence = open(lines[i]);
    if (!fence) continue;
    let end = i + 1;
    while (end < lines.length && !closes(lines[end], fence)) end += 1;
    if (end >= lines.length) throw new Error(`unclosed fence at ${file}:${offset + i + 1}`);
    if (fence.lang === 'json') {
      found.push({
        where: `${file}:${offset + i + 2}`,
        node: JSON.parse(lines.slice(i + 1, end).join('\n')) as Node,
      });
    }
    i = end;
  }
  return found;
}

/** The lines under a heading, up to the next heading of the same or a higher level. */
function section(file: string, heading: string): { lines: string[]; offset: number } {
  const all = readFileSync(join(ROOT, file), 'utf8').split('\n');
  const start = all.indexOf(heading);
  if (start < 0) throw new Error(`"${heading}" heading not found in ${file}`);
  if (all.indexOf(heading, start + 1) >= 0) throw new Error(`"${heading}" appears twice in ${file}`);
  const level = /^#+/.exec(heading)![0].length;
  let end = start + 1;
  while (end < all.length && !(/^#+\s/.test(all[end]) && /^#+/.exec(all[end])![0].length <= level)) end += 1;
  return { lines: all.slice(start + 1, end), offset: start + 1 };
}

/** The blockquote opening on `lead`, with its quote markers stripped. */
function blockquote(file: string, lead: string): { lines: string[]; offset: number } {
  const all = readFileSync(join(ROOT, file), 'utf8').split('\n');
  const start = all.indexOf(lead);
  if (start < 0) throw new Error(`blockquote "${lead}" not found in ${file}`);
  if (all.indexOf(lead, start + 1) >= 0) throw new Error(`blockquote "${lead}" appears twice in ${file}`);
  let end = start;
  while (end < all.length && all[end].startsWith('>')) end += 1;
  return { lines: all.slice(start, end).map((line) => line.replace(/^> ?/, '')), offset: start };
}

const SLOTTED_PAGES = 'content/docs/guide/slotted-pages.md';
const SCHEMA_REFERENCE = 'content/docs/api/schema-reference.md';
const APP_SHELL_README = 'packages/app-shell/README.md';

const slotted = section(SLOTTED_PAGES, "### Naming a related list's actions: `record:related_list.actions` holds IDS");
const retired = blockquote(SCHEMA_REFERENCE, '> **Retired: `related`** (objectui#7997, ADR-0049 enforce-or-remove).');
const routes = section(APP_SHELL_README, '## Record create/edit modes');

const RELATED_LIST_EXAMPLES = [
  ...jsonFences(slotted.lines, SLOTTED_PAGES, slotted.offset),
  ...jsonFences(retired.lines, SCHEMA_REFERENCE, retired.offset),
].filter((e) => e.node.type === 'record:related_list');
const ACTION_BUTTON_EXAMPLES = jsonFences(routes.lines, APP_SHELL_README, routes.offset).filter(
  (e) => e.node.type === 'action:button',
);
const EXAMPLES: ReadonlyArray<readonly [string, Example]> = [...RELATED_LIST_EXAMPLES, ...ACTION_BUTTON_EXAMPLES].map(
  (e) => [`${e.where} (${e.node.type})`, e] as const,
);

type Issue = { code: string; path: PropertyKey[]; message: string; keys?: string[]; errors?: Issue[][] };
type Parse = { success: boolean; error?: { issues: ReadonlyArray<unknown> } };

/** Every issue, union branches unfolded and paths made absolute. */
const allIssues = (issues: ReadonlyArray<Issue> | undefined, prefix: PropertyKey[] = []): Issue[] =>
  (issues ?? []).flatMap((issue) => {
    const path = [...prefix, ...issue.path];
    return [{ ...issue, path }, ...(issue.errors ?? []).flatMap((branch) => allIssues(branch, path))];
  });
const issuesOf = (result: Parse): Issue[] => allIssues(result.error?.issues as ReadonlyArray<Issue> | undefined);

/** `code @ path: message`, one per issue — what a failure prints, never what it asserts. */
const describeIssues = (result: Parse): string =>
  issuesOf(result)
    .map((i) => `${i.code} @ ${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
    .join('; ');

/** The keys refused on the node itself: by name at a one-segment path, or listed by an `unrecognized_keys` at the root. */
const refusedOnNode = (result: Parse): string[] =>
  [
    ...new Set(
      issuesOf(result).flatMap((i) => {
        if (i.code === 'unrecognized_keys' && i.path.length === 0) return i.keys ?? [];
        if (i.code === 'invalid_type' && i.path.length === 1) return [String(i.path[0])];
        return [];
      }),
    ),
  ].sort();

/** The installed spec page component's node-level keys, read off its own shape. */
function specNodeKeys(): Set<string> {
  let schema = PageComponentSchema as unknown as { shape?: Record<string, unknown>; _zod: { def: Record<string, unknown> } };
  for (let depth = 0; depth < 6 && !schema.shape; depth++) {
    const def = schema._zod.def;
    if (def.type === 'pipe') schema = def.in as typeof schema;
    else if (def.type === 'lazy') schema = (def.getter as () => typeof schema)();
    else break;
  }
  if (!schema.shape) throw new Error('could not reach the shape of the installed PageComponentSchema');
  return new Set(Object.keys(schema.shape));
}
const SPEC_NODE_KEYS = specNodeKeys();

const rowOf = (type: string) =>
  (ComponentPropsMap as unknown as Record<string, { safeParse(value: unknown): Parse; shape: Record<string, unknown> }>)[type];

/** The node with its bag spread onto it — the spelling the four examples used to teach. */
const flattened = ({ properties, ...node }: Node): Record<string, unknown> => ({ ...node, ...properties });

describe('public-block examples outside objectui#11183\'s roots are written in the bag (objectui#11321)', () => {
  // Without these, a heading rename or a fence that stopped being `json` makes
  // every assertion below vacuous: an extractor that found nothing reads
  // exactly like a page that is clean.
  it('finds the two `record:related_list` examples and the two `action:button` examples', () => {
    expect(RELATED_LIST_EXAMPLES.map((e) => e.where.split(':')[0])).toEqual([SLOTTED_PAGES, SCHEMA_REFERENCE]);
    expect(ACTION_BUTTON_EXAMPLES.map((e) => e.where.split(':')[0])).toEqual([APP_SHELL_README, APP_SHELL_README]);
  });

  it.each(EXAMPLES)('%s writes its props in the bag, with nothing else on the node', (_label, { node }) => {
    expect(Object.keys(node).sort()).toEqual(['properties', 'type']);
    expect(Object.keys(node.properties ?? {}).length).toBeGreaterThan(0);
  });

  it.each(EXAMPLES)('%s — the tolerant face accepts it', (label, { node }) => {
    const result = safeValidateSchema(node) as Parse;
    expect(describeIssues(result), `${label} is refused`).toBe('');
    expect(result.success).toBe(true);
  });

  it.each(EXAMPLES)('%s — the strict authoring face accepts it: every key is declared', (label, { node }) => {
    const result = StrictAnyComponentSchema.safeParse(node) as Parse;
    expect(describeIssues(result), `${label} carries an undeclared key`).toBe('');
    expect(result.success).toBe(true);
  });

  it.each(EXAMPLES)('%s — the spec\'s page component accepts it', (label, { node }) => {
    const result = PageComponentSchema.safeParse(node) as Parse;
    expect(describeIssues(result), `${label} is refused by @objectstack/spec`).toBe('');
    expect(result.success).toBe(true);
  });

  it.each(EXAMPLES)('%s — the spec row accepts the bag in a full parse', (label, { node }) => {
    const row = rowOf(node.type);
    expect(row, `@objectstack/spec has no ComponentPropsMap row for ${node.type}`).toBeDefined();
    const result = row.safeParse(node.properties);
    expect(describeIssues(result), `${label}'s bag is refused by ComponentPropsMap['${node.type}']`).toBe('');
    expect(result.success).toBe(true);
  });

  it('`actions` on the slotted-pages node is a member of the spec row, so it belongs in the bag', () => {
    const slottedNode = RELATED_LIST_EXAMPLES[0].node;
    expect(Object.keys(slottedNode.properties ?? {})).toContain('actions');
    expect(Object.keys(rowOf('record:related_list').shape)).toContain('actions');
  });

  it.each(EXAMPLES)('%s — CONTROL: written flat, the strict face and the spec refuse exactly the moved keys', (label, { node }) => {
    const moved = Object.keys(node.properties ?? {})
      .filter((key) => !SPEC_NODE_KEYS.has(key))
      .sort();
    expect(moved.length, `${label} moves no key the spec refuses on the node — the control proves nothing`).toBeGreaterThan(0);
    const flat = flattened(node);
    expect(refusedOnNode(StrictAnyComponentSchema.safeParse(flat) as Parse), 'strict face').toEqual(moved);
    expect(refusedOnNode(PageComponentSchema.safeParse(flat) as Parse), '@objectstack/spec page component').toEqual(moved);
  });
});
