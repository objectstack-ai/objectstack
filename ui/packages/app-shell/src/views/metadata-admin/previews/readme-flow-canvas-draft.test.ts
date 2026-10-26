// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `packages/app-shell/README.md`'s **Visual flow canvas** draft is parsed by the
 * schema that actually validates it — the spec's `FlowSchema` (objectui#8854).
 *
 * ## Why this file exists
 *
 * The documented draft could not be saved. Three separate reasons, all in one
 * fence, and none of them visible to any gate this repository runs:
 *
 *   1. it taught the designer's RETIRED `node.ui.{x,y}` geometry spelling, which
 *      the spec's flow node — a strict object — rejects by name. The README's
 *      own prose, twelve lines below the fence, said so: "a draft that still
 *      carries `ui` fails client-side validation and is rejected on save with a
 *      422". Two halves of one section, contradicting each other, and the half a
 *      reader copies was the wrong one;
 *   2. every edge omitted `id`, which `FlowEdgeSchema` declares required beside
 *      `source` and `target`; and
 *   3. the fence carried no `name` / `label` / `type` at all, though it is
 *      captioned as a `flow` DRAFT and `FlowSchema` requires all three.
 *
 * (3) is the one no card named, and it is the reason this test parses the WHOLE
 * object rather than its nodes and edges separately. objectui#8483 repaired one
 * node type in this same fence and the draft still did not save; objectui#8854
 * was filed for two more defects, and had it been graded per-node the draft
 * still would not have saved. A per-part check answers a question no reader
 * asks. What a reader does is paste the fence — so that is what is parsed here.
 *
 * ## The door this parses is the door the app uses
 *
 * Not `FlowNodeSchema` / `FlowEdgeSchema` piecemeal, and not the server: the
 * app-shell metadata admin validates a `flow` draft client-side by handing the
 * whole draft to `FlowSchema`. `clientValidation.ts`'s `LOADERS.flow` resolves
 * that schema and `ResourceEditPage` calls `validateMetadataDraft(type, draft)`
 * with the editor's entire body. Grading the example against anything else would
 * measure a gate no author passes through.
 *
 * ## The example is EXTRACTED, never retyped
 *
 * The fence is read out of the README on every run. A hand copy drifts from the
 * file it claims to pin and therefore pins nothing — an unre-measured snippet is
 * the whole defect this test exists to prevent, so reproducing one inside the
 * test would be self-defeating. A moved heading, a removed fence or a non-JSON
 * body throws out of the extractor rather than vacuously passing on an empty
 * fixture.
 *
 * ## The green carries its own controls
 *
 * A `safeParse` that succeeds proves nothing if the schema accepts everything,
 * so each repaired defect is re-injected into the extracted example and must be
 * REFUSED by name. Three mutations, three refusals — that pairing is the
 * measurement; neither half alone is one.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { stripComments } from 'jsonc-parser';

import { FlowSchema } from '@objectstack/spec/automation';
import { uiRoot } from '../../../../../../scripts/ui-root.mjs';

const README = join(uiRoot(), 'packages/app-shell/README.md');

const SECTION_HEADING = '\n### Visual flow canvas\n';
const ANCHOR = '**JSON shape** (a `flow` draft):';

/** The README section this example lives in, bounded to its own heading. */
function flowSection(): string {
  const src = readFileSync(README, 'utf8');
  const start = src.indexOf(SECTION_HEADING);
  if (start < 0) throw new Error(`"${SECTION_HEADING.trim()}" heading not found in ${README}`);
  const next = src.indexOf('\n### ', start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

/** The `jsonc` fence that follows the anchor sentence — the draft itself. */
function fenceBody(): string {
  const section = flowSection();
  const anchors = section.split(ANCHOR).length - 1;
  if (anchors !== 1) throw new Error(`expected exactly one "${ANCHOR}" in the section, found ${anchors}`);
  const after = section.slice(section.indexOf(ANCHOR));
  const fence = /^[ \t]*```jsonc[ \t]*\n([\s\S]*?)\n[ \t]*```/m.exec(after);
  if (!fence) throw new Error('no ```jsonc fence follows the "JSON shape" sentence in the README');
  return fence[1];
}

/** The documented draft, exactly as a reader would paste it. */
function readmeDraft(): Record<string, unknown> {
  // Not wrapped in a try/catch: `JSON.parse`'s own `SyntaxError` names the
  // offending token and is thrown from this line, which is louder than anything
  // a re-throw could add. The comments are blanked with spaces rather than
  // deleted so the line the `SyntaxError` names is the line of the fence.
  //
  // objectui#9323 — the strip is `jsonc-parser`'s, replacing a string-state
  // scanner private to this file. That scanner stated its own invariant ("a
  // blunt replace … cannot silently truncate a value") and held it for `//`,
  // but was blind to `/* */`: a block comment in this fence threw here instead
  // of being stripped. `packages/cli/src/commands/check.ts` had already ruled
  // `jsonc-parser` the reader for exactly this question. Measured: this fence
  // parses to a byte-identical value before and after.
  const parsed: unknown = JSON.parse(stripComments(fenceBody(), ' '));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error("the README's flow draft is not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

type Issue = { code?: string; path?: Array<string | number>; message: string; keys?: string[] };

const DRAFT = readmeDraft();

function issuesOf(value: unknown): Issue[] {
  const result = FlowSchema.safeParse(value);
  return result.success ? [] : (result.error.issues as unknown as Issue[]);
}

function describeIssues(issues: Issue[]): string[] {
  return issues.map((i) => `${i.code ?? '?'} ${JSON.stringify(i.path ?? [])}: ${i.message}`);
}

/** A structural clone, so a mutation control cannot leak into the next test. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nodes(draft: Record<string, unknown>): Array<Record<string, unknown>> {
  const list = draft.nodes;
  if (!Array.isArray(list)) throw new Error("the README's flow draft no longer carries a `nodes` array");
  return list as Array<Record<string, unknown>>;
}

function edges(draft: Record<string, unknown>): Array<Record<string, unknown>> {
  const list = draft.edges;
  if (!Array.isArray(list)) throw new Error("the README's flow draft no longer carries an `edges` array");
  return list as Array<Record<string, unknown>>;
}

/** Index of the one node the README pins a canvas position on. */
function positionedNodeIndex(): number {
  const idx = nodes(DRAFT).findIndex((n) => n.position !== undefined);
  if (idx < 0) throw new Error('no node in the README draft carries a `position` — the fixture the controls mutate is gone');
  return idx;
}

describe('app-shell README: the Visual flow canvas draft', () => {
  it('is a draft `FlowSchema` ACCEPTS — i.e. a reader who pastes it can save it', () => {
    expect(
      describeIssues(issuesOf(DRAFT)),
      'The documented draft must survive the parse an author hands it to. ' +
        '`validateMetadataDraft(\'flow\', draft)` runs exactly this schema over exactly this body, ' +
        'so a rejected draft is a reader refused on save — the defect objectui#8854 was filed for, ' +
        'and objectui#8483 before it.',
    ).toEqual([]);
  });

  it('CONTROL: the retired `ui` geometry spelling is still REFUSED, by name', () => {
    const mutated = clone(DRAFT);
    const idx = positionedNodeIndex();
    const node = nodes(mutated)[idx];
    node.ui = node.position;
    delete node.position;

    const issues = issuesOf(mutated);
    const unrecognized = issues.filter((i) => i.code === 'unrecognized_keys');
    expect(
      unrecognized.flatMap((i) => i.keys ?? []),
      'This control is what makes the green above a measurement rather than a schema that accepts ' +
        'anything. If `ui` ever parses, the spec node has stopped being strict and the README ' +
        "sentence about a 422 has stopped being true with it.",
    ).toContain('ui');
    expect(unrecognized.map((i) => JSON.stringify(i.path ?? []))).toContain(JSON.stringify(['nodes', idx]));
  });

  it('CONTROL: an edge that omits `id` is still REFUSED, at that edge\'s `id`', () => {
    const mutated = clone(DRAFT);
    delete edges(mutated)[0].id;

    const paths = issuesOf(mutated).map((i) => JSON.stringify(i.path ?? []));
    expect(
      paths,
      '`FlowEdgeSchema` declares `id` required beside `source` and `target`. Every edge in the ' +
        'documented fence omitted it, which is the second half of objectui#8854.',
    ).toContain(JSON.stringify(['edges', 0, 'id']));
  });

  it('CONTROL: a draft stripped of its identity keys is still REFUSED', () => {
    const mutated = clone(DRAFT);
    delete mutated.name;
    delete mutated.label;
    delete mutated.type;

    const paths = issuesOf(mutated).map((i) => JSON.stringify(i.path ?? []));
    for (const key of ['name', 'label', 'type']) {
      expect(
        paths,
        `\`FlowSchema\` requires \`${key}\` on a flow draft. The fence carried none of the three ` +
          'until objectui#8854 — no card named that, and grading nodes and edges separately would ' +
          'have missed it while reporting green.',
      ).toContain(JSON.stringify([key]));
    }
  });

  it('every documented edge carries an `id`', () => {
    const missing = edges(DRAFT)
      .map((e, i) => ({ i, id: e.id }))
      .filter((e) => typeof e.id !== 'string' || e.id.length === 0);
    expect(missing, 'An edge without an `id` is refused on save; the README must not teach one.').toEqual([]);
  });

  it('teaches `position`, with both coordinates, and never the retired `ui`', () => {
    const positioned = nodes(DRAFT)[positionedNodeIndex()];
    expect(
      positioned.position,
      'The README calls this line an "optional persisted canvas position", and the spec\'s ' +
        '`position` requires BOTH coordinates — a half-coordinate is not a position.',
    ).toEqual({ x: expect.any(Number), y: expect.any(Number) });

    expect(
      nodes(DRAFT).filter((n) => 'ui' in n),
      'The fence must not reintroduce the retired spelling in any node.',
    ).toEqual([]);
  });

  it('does not reintroduce the retired spelling anywhere inside the fence', () => {
    // Scoped to the FENCE, not the section: the prose deliberately names
    // `node.ui.{x,y}` to explain why stored flows heal, and that sentence is
    // correct. Only the copyable half is forbidden to carry it.
    expect(
      /"ui"\s*:/.test(fenceBody()),
      'The prose may discuss `ui`; the block a reader copies may not carry it.',
    ).toBe(false);
  });
});
