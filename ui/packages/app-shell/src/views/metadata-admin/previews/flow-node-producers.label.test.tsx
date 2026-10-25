// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **Every flow-node PRODUCER writes a `label`** — objectui#6331.
 *
 * ## Why this file exists at the producer and not at the reader
 *
 * `FlowNodeSchema` requires `label` (`z.string()`); the designer's own
 * {@link FlowDesignerNode} makes it optional, and that is a deliberate LAYER
 * difference, not drift — a canvas holds nodes the user has dropped but not
 * finished, so typing it as the spec's would make the editor's own
 * intermediate state unrepresentable. Both are true only if something
 * guarantees a node ACQUIRES a label before it is saved. This file is that
 * something.
 *
 * ⛔ The reader-side type is NOT the enforcement point, and this is measured,
 * not asserted. objectui#6287 made `label` required on the reader type and got
 * `tsc` exit 0 with **zero errors**: every node reaches that type through
 * `as InspectorFlowNode[]` casts out of `Record<string, unknown>`, and **a cast
 * bypasses a required member**. It is also mildly harmful — `node.label ?? ''`
 * and `node.label || node.id` are guards the OPTIONAL type currently forces,
 * while a required `label` would let `node.label.trim()` compile against a
 * value that genuinely is absent. So the enforcement has to sit where a node
 * is CONSTRUCTED, where a cast cannot get in front of it.
 *
 * ## What the census found (objectui#6331)
 *
 * Six node literals across five producer call sites, and every one of them
 * already writes a label. But before this file, three of the five were
 * enforced only by ACCIDENT — measured by deleting the `label` line from
 * `insertOnEdge` and from `FlowPreview.handleAddNode` on `origin/main`:
 * vitest green (58/58), `tsc` exit 0, `eslint` exit 0 with zero errors.
 * "They all happen to" and "something prevents otherwise" looked identical
 * from the outside, and only one of them survives an edit.
 *
 * The two that were already enforced stay where they are — this file does not
 * restate them:
 *   - `FlowCanvas.addReviseLoop` — `flow-canvas-seeds.spec-parse.test.tsx`
 *     clicks the real button and full-`safeParse`s the emitted node.
 *   - `buildFlowSkeleton` — its label strings are REQUIRED positional
 *     parameters (omitting one does not type-check, the same discipline
 *     `buildObjectSkeleton`'s `sharingModel` comment sets out), and
 *     `createConformance.test.ts` parses the whole emitted draft. It is
 *     re-asserted below only at node level, because it is the one producer
 *     whose labels come from its CALLER.
 *
 * ## Two halves, and why neither is enough alone
 *
 * 1. **Observed output.** Each producer is driven through the affordance a
 *    user actually clicks, and the node it EMITS is `safeParse`d whole against
 *    the spec. ⛔ Never hand-compose the node and parse that — the sibling
 *    seeds file does exactly that for the palette seeds (`{ id, type, label:
 *    defaultNodeLabel(type), ...defaultNodeExtras(type) }`), which is correct
 *    for ITS subject (the seed extras) and is precisely why it stayed green
 *    through the ablation above: it supplies the label itself, so it can never
 *    see a producer drop one.
 * 2. **A census ratchet over source.** The render half can only speak for the
 *    producers it renders; a producer added tomorrow is invisible to it. The
 *    scan enumerates node literals from source and refuses one that writes no
 *    label, so a NEW producer lands red here rather than at the author's save.
 *
 * ## What the scan can and cannot see
 *
 * It reads the three directories that hold this designer's producers and finds
 * (a) object literals declared AS a flow node type, and (b) object literals
 * inside a `nodes: [ … ]` array. It cannot see an untyped literal assembled
 * elsewhere and cast in — the same blind spot the casts create for the
 * compiler — which is why half 1 exists. `apps/console/src/preview-samples.ts`
 * is deliberately out of the roots: it is read-only gallery data, not an
 * authoring path to save.
 *
 * ## If this fails
 *
 * Write the label at the producer. ⛔ Do not relax the pin, and ⛔ do not
 * "fix" it by making `label` required on a reader type — that is the
 * zero-error no-op objectui#6287 already measured and objectui#6331 re-ruled.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Automation from '@objectstack/spec/automation';
import { FlowCanvas } from './FlowCanvas';
import { FlowPreview } from './FlowPreview';
import { buildFlowSkeleton } from '../../studio-design/skeletons';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

afterEach(cleanup);

/**
 * objectui#4699 / #4701 — same escape as both sibling files: every
 * `<FlowCanvas>` mount pulls `useFlowNodePalette` → `useActionDescriptors`,
 * which fires a real `GET ${apiBase()}/automation/actions` and aborts it on
 * unmount. happy-dom answers `fetch` with its own `http`-core-backed polyfill,
 * so with nothing listening the abort races a real socket. Answer with the
 * "engine absent" 404 the hook already degrades from.
 */
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      expect(String(url)).toBe('/api/v1/automation/actions');
      return new Response('not found', { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface ZodIssue {
  path: PropertyKey[];
  message: string;
}
interface ZodLike {
  safeParse: (value: unknown) => { success: boolean; error?: { issues: ZodIssue[] } };
}
const FlowNodeSchema = (Automation as unknown as Record<string, ZodLike>).FlowNodeSchema;

function explain(result: { success: boolean; error?: { issues: ZodIssue[] } }): string {
  return (result.error?.issues ?? [])
    .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
}

/**
 * The assertion every producer gets: the node it EMITTED parses whole against
 * the spec's own node schema. `label` is one required member of that shape, so
 * this is the contract's verdict rather than a second, local rule about
 * labels — and it moves with the spec if the contract ever changes.
 */
function expectSpecValidNode(node: unknown, who: string): void {
  const result = FlowNodeSchema.safeParse(node);
  expect(result.success, `${who} emitted a node the spec refuses:\n${explain(result)}\nnode=${JSON.stringify(node)}`).toBe(true);
  // Name the member this card is about, so a failure reads as the defect it is
  // rather than as an anonymous parse error.
  expect(typeof (node as { label?: unknown }).label, `${who} emitted a node with no \`label\``).toBe('string');
}

/** The open add-node palette's row for `label` (objectui#11778: every "+" opens it). */
function pickInPalette(label: string): void {
  const option = screen.getAllByRole('option').find((o) => o.textContent?.startsWith(label));
  expect(option, `palette row ${label}`).toBeDefined();
  fireEvent.click(option!);
}

/** The nodes a canvas patch carries, in the shape the producers emit. */
function patchedNodes(patch: Record<string, unknown>): Array<Record<string, unknown>> {
  return patch.nodes as Array<Record<string, unknown>>;
}

describe('flow-node producers ↔ spec FlowNodeSchema (#6331): observed output', () => {
  it('`FlowCanvas.addNode` (the + handle) emits a spec-valid node', () => {
    const patches: Array<Record<string, unknown>> = [];
    render(
      <FlowCanvas
        nodes={[{ id: 'a', type: 'start', label: 'Start' }]}
        edges={[]}
        editable
        designMode
        selectedId={null}
        onSelect={() => {}}
        onPatch={(partial) => patches.push(partial)}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Add connected node' })[0]);
    // objectui#11778 — the + opens the add-node palette; the node lands on a pick.
    pickInPalette('Create record');

    expect(patches, 'the + handle must emit one patch').toHaveLength(1);
    const added = patchedNodes(patches[0]!).find((n) => n.id !== 'a');
    expect(added, 'the patch must add a node').toBeDefined();
    expectSpecValidNode(added, 'FlowCanvas.addNode');
  });

  it('`FlowCanvas.insertOnEdge` (insert on an edge) emits a spec-valid node', () => {
    const patches: Array<Record<string, unknown>> = [];
    render(
      <FlowCanvas
        nodes={[
          { id: 'a', type: 'start', label: 'Start' },
          { id: 'b', type: 'end', label: 'End' },
        ]}
        edges={[{ id: 'e1', source: 'a', target: 'b' }]}
        editable
        designMode
        selectedId={null}
        onSelect={() => {}}
        onPatch={(partial) => patches.push(partial)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Insert node here' }));
    pickInPalette('Create record');

    expect(patches, 'insert-on-edge must emit one patch').toHaveLength(1);
    const inserted = patchedNodes(patches[0]!).find((n) => n.id !== 'a' && n.id !== 'b');
    expect(inserted, 'the patch must add a node').toBeDefined();
    expectSpecValidNode(inserted, 'FlowCanvas.insertOnEdge');
  });

  it('`FlowPreview.handleAddNode` (the empty-flow seed) emits a spec-valid node', () => {
    const patches: Array<Record<string, unknown>> = [];
    render(
      <FlowPreview
        type="flow"
        name="f1"
        draft={{ name: 'f1', type: 'autolaunched', nodes: [], edges: [] }}
        editing
        selection={null}
        onSelectionChange={() => {}}
        onPatch={(partial) => patches.push(partial)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /add node/i }));

    expect(patches, 'the empty-flow add button must emit one patch').toHaveLength(1);
    const seeded = patchedNodes(patches[0]!);
    expect(seeded, 'the patch must seed exactly one node').toHaveLength(1);
    expectSpecValidNode(seeded[0], 'FlowPreview.handleAddNode');
  });

  it('`buildFlowSkeleton` (Studio "New flow") emits spec-valid nodes', () => {
    // The one producer whose labels come from its CALLER — the pillar passes
    // localized `t(…)` values. Required positional parameters are what stop a
    // second create path omitting them; this asserts the emitted result.
    const skeleton = buildFlowSkeleton('f1', 'Flow One', 'Start', 'End');
    const nodes = skeleton.nodes as Array<Record<string, unknown>>;
    expect(nodes, 'the skeleton must seed start + end').toHaveLength(2);
    for (const node of nodes) expectSpecValidNode(node, `buildFlowSkeleton(${String(node.id)})`);
  });
});

// ── Half 2: the census ratchet ────────────────────────────────────────────────

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..');

/** The directories that hold this designer's flow-node producers. */
const SCAN_ROOTS = [
  'packages/app-shell/src/views/metadata-admin/previews',
  'packages/app-shell/src/views/metadata-admin/inspectors',
  'packages/app-shell/src/views/studio-design',
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

/** Blank out comments so prose about `label` cannot answer for the code. */
function stripComments(src: string): string {
  return mask(src);
}

/** Index of the bracket closing the one opened at `open`. */
function matchBracket(src: string, open: number, oc: string, cc: string): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === oc) depth++;
    else if (src[i] === cc) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

interface Site {
  file: string;
  line: number;
  kind: 'typed' | 'nodes-array';
  text: string;
}

function collectSites(file: string, src: string): Site[] {
  const rel = path.relative(repoRoot, file);
  const at = (i: number) => src.slice(0, i).split('\n').length;
  const sites: Site[] = [];

  // (a) a literal declared AS a flow node
  for (const m of src.matchAll(/:\s*(?:FlowDesignerNode|InspectorFlowNode|FlowNodeLike|FlowNode)\s*=\s*\{/g)) {
    const open = src.indexOf('{', m.index!);
    const close = matchBracket(src, open, '{', '}');
    if (close < 0) continue;
    sites.push({ file: rel, line: at(m.index!), kind: 'typed', text: src.slice(open, close + 1) });
  }

  // (b) object literals inside a `nodes: [ … ]` array
  for (const m of src.matchAll(/\bnodes:\s*\[/g)) {
    const open = src.indexOf('[', m.index!);
    const close = matchBracket(src, open, '[', ']');
    if (close < 0) continue;
    const span = src.slice(open + 1, close);
    let depth = 0;
    let start = -1;
    for (let i = 0; i < span.length; i++) {
      if (span[i] === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (span[i] === '}') {
        depth--;
        if (depth === 0 && start >= 0) {
          sites.push({ file: rel, line: at(open), kind: 'nodes-array', text: span.slice(start, i + 1) });
          start = -1;
        }
      }
    }
  }
  return sites;
}

/** Members at the literal's own level, with nested braces/brackets removed. */
function topLevelMembers(text: string, keepParens: boolean): string {
  let t = text.slice(1, -1);
  let prev: string;
  do {
    prev = t;
    t = t.replace(/\{[^{}]*\}/g, '');
  } while (t !== prev);
  do {
    prev = t;
    t = t.replace(/\[[^[\]]*\]/g, '');
  } while (t !== prev);
  if (keepParens) return t;
  do {
    prev = t;
    t = t.replace(/\([^()]*\)/g, '');
  } while (t !== prev);
  return t;
}

/** `label:` or the `label` shorthand, at the literal's own level. */
function writesLabel(text: string): boolean {
  return /(^|,)\s*label\s*(:|,|$)/.test(topLevelMembers(text, false));
}

/**
 * A RE-WRITER rather than a producer: it spreads an existing node (`{ ...node,
 * position }`), so it carries whatever label that node had and cannot be the
 * place one is first written. Deliberately a BARE identifier — `...call(x)` is
 * a spread of a computed value (`...defaultNodeExtras(type)`), which promises
 * nothing about a label, so it must not buy an exemption. That is why this
 * reads the text with parentheses intact.
 */
function isRewriteOfExistingNode(text: string): boolean {
  return /(^|,)\s*\.\.\.\s*[A-Za-z_$][\w$]*\s*(,|$)/.test(topLevelMembers(text, true));
}

describe('flow-node producers ↔ spec FlowNodeSchema (#6331): census ratchet', () => {
  const sites = SCAN_ROOTS.flatMap((r) =>
    sourceFiles(path.join(repoRoot, r)).flatMap((f) => collectSites(f, stripComments(readFileSync(f, 'utf8')))),
  );

  it('the scan actually finds the producers it is meant to police', () => {
    // A hot control: a zero here would otherwise read as "no producer omits a
    // label" when it in fact means the scan matched nothing at all.
    expect(sites.length, 'the producer scan found nothing — it is broken, not clean').toBeGreaterThanOrEqual(6);
    // Two named producers that must be in any honest reading of these roots:
    // the palette/append literal (the most-used one, identified by its seed
    // spread) and the Studio skeleton's pair.
    expect(
      sites.some((s) => s.text.includes('defaultNodeExtras(type)')),
      '`FlowCanvas.addNode` is missing from the scan — the control failed',
    ).toBe(true);
    expect(
      sites.filter((s) => s.file.endsWith('studio-design/skeletons.ts')).length,
      '`buildFlowSkeleton` nodes are missing from the scan — the control failed',
    ).toBe(2);
  });

  it('every flow-node literal writes a `label`', () => {
    const offenders = sites
      .filter((s) => !isRewriteOfExistingNode(s.text))
      .filter((s) => !writesLabel(s.text))
      .map((s) => `${s.file}:${s.line} [${s.kind}] ${s.text.replace(/\s+/g, ' ').slice(0, 120)}`);
    expect(
      offenders,
      'a flow-node producer writes no `label`; `FlowNodeSchema` requires one, so this node is refused at save',
    ).toEqual([]);
  });
});
