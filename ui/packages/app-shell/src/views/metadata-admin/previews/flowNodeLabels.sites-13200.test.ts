// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13200 — the enumeration pin for the flow designer's node names.
 *
 * The designer names a node in words through ONE rule, `flowNodeDisplayName`,
 * and a connection through `flowEdgeDisplayName` (objectui#13143). This file
 * holds that in two halves:
 *
 * 1. `RESOLVER_SITES` — every site that formats a node or connection name for
 *    display through the rule, each asserted to still call it. A site that
 *    stops calling it goes red here.
 * 2. The id-shaped sites — the flow-designer source is scanned (comments masked
 *    by `scripts/js-comment-mask.mjs`) for the shapes that print a node by its
 *    id instead: `label || id`, `label ? label : id`, `${source} → ${target}`,
 *    a `join(' → ')` of ids, and a message parameter set to an id. Every hit
 *    must be in `ID_SITES` with the reason the id is right there (among them
 *    `own-title`, a node's own title beside its type, ruled on objectui#13200).
 *    objectui#13242 converted the last sites this card left `open`; there is no
 *    `open` verdict any more, so a new id-shaped site fails until it is
 *    converted or given a reason; a listed site that is gone fails until its
 *    entry is deleted.
 *
 * The population is ENUMERATED from the directories below (AGENTS.md #9), and
 * a control proves it reaches the files this card changed.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../../../scripts/js-comment-mask.mjs';

const mask: (source: string) => string = maskComments;

const here = path.dirname(fileURLToPath(import.meta.url));
/** `packages/app-shell/src/views/metadata-admin`. */
const ADMIN = path.resolve(here, '..');
const DIRS = ['previews', 'previews/simulator', 'inspectors'];

/** The flow designer's source: `flow*` / `Flow*` files, and the Problems panel. */
function designerFiles(): string[] {
  const out: string[] = [];
  for (const dir of DIRS) {
    for (const name of readdirSync(path.join(ADMIN, dir))) {
      if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
      if (/^flow/i.test(name) || name === 'ProblemsPanel.tsx') out.push(`${dir}/${name}`);
    }
  }
  return out.sort();
}

const masked = new Map<string, string>();
function source(file: string): string {
  let s = masked.get(file);
  if (s === undefined) {
    s = mask(readFileSync(path.join(ADMIN, file), 'utf8'));
    masked.set(file, s);
  }
  return s;
}

interface ResolverSite {
  file: string;
  /** What the site shows. */
  what: string;
  /** Must match the file's masked source exactly once, the resolver call inside it. */
  pattern: RegExp;
}

const RESOLVER_SITES: ResolverSite[] = [
  {
    file: 'previews/simulator/flow-sim-validate.ts',
    what: 'the decision Problems (objectui#13143)',
    pattern: /const name = flowNodeDisplayName\(n, locale\);\s*if \(defaults\.length > 1\)/,
  },
  {
    file: 'previews/simulator/flow-sim-validate.ts',
    what: 'the unreachable-node Problem',
    pattern: /const name = flowNodeDisplayName\(n, locale\);\s*warnings\.push\(\{[^\n]*'engine\.flowValidate\.nodeUnreachable', locale, \{ name, id: n\.id \}/,
  },
  {
    file: 'previews/ProblemsPanel.tsx',
    what: 'the Problems target column, a node',
    pattern: /text: node \? flowNodeDisplayName\(node, locale\) : nodeId/,
  },
  {
    file: 'previews/ProblemsPanel.tsx',
    what: 'the Problems target column, a connection',
    pattern: /text: flowEdgeDisplayName\(p\.target, nodes, locale\)/,
  },
  {
    file: 'previews/FlowPreview.tsx',
    what: 'the node selection label a problem click writes',
    pattern: /onSelectionChange\?\.\(\{ kind: 'node', id: nodeId, label: node \? flowNodeDisplayName\(node, locale\) : nodeId \}\)/,
  },
  {
    file: 'previews/FlowPreview.tsx',
    what: 'the edge selection label a problem click writes',
    pattern: /onSelectionChange\?\.\(\{ kind: 'edge', id: p\.target\.edgeKey, label: flowEdgeDisplayName\(p\.target, nodes, locale\) \}\)/,
  },
  {
    file: 'previews/FlowPreview.tsx',
    what: 'the selection label of a node just added',
    pattern: /label: flowNodeDisplayName\(newNode, locale\)/,
  },
  {
    file: 'previews/FlowPreview.tsx',
    what: 'the selection label of a canvas node select',
    pattern: /kind: 'node', id: n\.id, label: flowNodeDisplayName\(n, locale\)/,
  },
  {
    file: 'previews/FlowPreview.tsx',
    what: 'the selection label of a canvas edge select',
    pattern: /kind: 'edge', id: key, label: flowEdgeDisplayName\(e, nodes, locale\)/,
  },
  {
    file: 'previews/FlowPreview.tsx',
    what: 'the selection label of a nested node select',
    pattern: /label: node \? flowNodeDisplayName\(node, locale\) : path\.nodeId/,
  },
  {
    file: 'previews/FlowPreview.tsx',
    what: 'the host header title of a connection (objectui#13143)',
    pattern: /\? flowEdgeDisplayName\(edge, Array\.isArray\(draft\.nodes\) \? draft\.nodes : \[\], locale\)/,
  },
  {
    file: 'previews/FlowRunsPanel.tsx',
    what: 'a run step’s node (objectui#13143)',
    pattern: /names\.set\(node\.id, flowNodeDisplayName\(node, locale\)\)/,
  },
  {
    file: 'inspectors/FlowEdgeInspector.tsx',
    what: 'the selection label of a reconnected edge (objectui#13143)',
    pattern: /label: flowEdgeDisplayName\(\{ source, target \}, nodes, locale\)/,
  },
  {
    file: 'inspectors/FlowEdgeInspector.tsx',
    what: 'the connection inspector’s title (objectui#13143)',
    pattern: /title=\{flowEdgeDisplayName\(edge, nodes, locale\)\}/,
  },
  {
    file: 'inspectors/FlowObjectListField.tsx',
    what: 'a branch card’s target',
    pattern: /return n \? flowNodeDisplayName\(\{ \.\.\.n, id \}, locale\) : id;/,
  },
  {
    file: 'inspectors/FlowNodeConfigField.tsx',
    what: 'the designer locale handed to a branch card’s target',
    pattern: /decisionEdgeBranches\(\s*context\.node\.id,\s*draftEdges,\s*draftNodes,\s*unpairedDecisionEdges\(context\.node\.id, value, draftEdges\),\s*locale,\s*\)/,
  },
  {
    file: 'inspectors/FlowObjectListField.tsx',
    what: 'the selection label "Edit connection" writes',
    pattern: /label: flowEdgeDisplayName\(\s*\{ source: String\(context\?\.node\?\.id \?\? ''\), target: b\.target \},/,
  },
  // ── objectui#13242: the sites objectui#13200 left open ──
  {
    file: 'previews/FlowCanvas.tsx',
    what: 'an edge hover title’s end name (objectui#13242)',
    pattern: /const endName = \(id: string\): string => \{\s*const node = nodes\.find\(\(n\) => n\.id === id\);\s*return node \? flowNodeDisplayName\(node, locale\) : id;/,
  },
  {
    file: 'previews/FlowCanvas.tsx',
    what: 'the hover title of an edge in an undeclared cycle (objectui#13242)',
    pattern: /tFormat\('engine\.flowCanvas\.edge\.undeclaredCycle', locale, \{ source: endName\(edge\.source\), target: endName\(edge\.target\) \}\)/,
  },
  {
    file: 'previews/FlowCanvas.tsx',
    what: 'the hover title of a back-edge (objectui#13242)',
    pattern: /tFormat\('engine\.flowCanvas\.edge\.backEdge', locale, \{ source: endName\(edge\.source\), target: endName\(edge\.target\) \}\)/,
  },
  {
    file: 'previews/FlowCanvas.tsx',
    what: 'the hover title of a plain edge (objectui#13242)',
    pattern: /: flowEdgeDisplayName\(edge, nodes, locale\)\}/,
  },
  {
    file: 'previews/FlowSimulatorPanel.tsx',
    what: 'the simulator’s mockable node list (objectui#13242)',
    pattern: /out\.push\(\{ id: n\.id, label: flowNodeDisplayName\(n, locale\), type: n\.type, outputs \}\)/,
  },
  {
    file: 'previews/FlowSimulatorPanel.tsx',
    what: 'the target name of a simulator step’s unguarded edge row (objectui#13242)',
    pattern: /const targetName = \(id: string\): string => \{\s*const node = nodes\.find\(\(n\) => n\.id === id\);\s*return node \? flowNodeDisplayName\(node, locale\) : id;/,
  },
  {
    file: 'previews/FlowSimulatorPanel.tsx',
    what: 'a simulator step’s unguarded edge row (objectui#13242)',
    pattern: /\(ed\.condition \?\? `→ \$\{targetName\(ed\.target\)\}`\)/,
  },
  {
    file: 'previews/flow-problems.ts',
    what: 'the repeated-connection Problem, each end named beside its id (objectui#13242)',
    pattern: /const nameOf = \(id: string\) => \{\s*const node = nodes\.find\(\(n\) => n\.id === id\);\s*return node \? flowNodeDisplayName\(node, locale\) : id;\s*\};[\s\S]*?'engine\.flowProblems\.repeatedEdge', locale, \{\s*sourceName: nameOf\(edge\.source\),\s*source: edge\.source,\s*targetName: nameOf\(edge\.target\),\s*target: edge\.target,/,
  },
  {
    file: 'previews/simulator/flow-sim-validate.ts',
    what: 'the cycle Problem’s node names (objectui#13242)',
    pattern: /named\.set\(id, node \? flowNodeDisplayName\(node, locale\) : id\);[\s\S]*?'engine\.flowValidate\.cycleDetected', locale, \{ cycle: cycleDisplayName\(cycle, nodes, locale\) \}/,
  },
  {
    file: 'previews/simulator/flow-sim-validate.ts',
    what: 'the missing boundary host Problem, the boundary event named beside its id (objectui#13242)',
    pattern: /const name = flowNodeDisplayName\(p\.node, locale\);\s*diag = \{[^\n]*'engine\.flowValidate\.boundaryHostMissing', locale, \{ name, id: p\.nodeId, host: p\.id \}/,
  },
  {
    file: 'previews/simulator/flow-simulator.ts',
    what: 'a simulator step’s label (objectui#13242)',
    pattern: /label: flowNodeDisplayName\(\{ id: nodeId, type, label \}, this\.locale\)/,
  },
  {
    file: 'inspectors/FlowNodeInspector.tsx',
    what: 'the selection label a node rename writes (objectui#13242)',
    pattern: /onSelectionChange\?\.\(\{ kind: 'node', id: nextId, label: flowNodeDisplayName\(\{ \.\.\.node, id: nextId \}, locale\) \}\)/,
  },
  {
    file: 'inspectors/FlowNodeInspector.tsx',
    what: 'the nested breadcrumb’s container crumb (objectui#13242)',
    pattern: /\{loc\?\.container \? flowNodeDisplayName\(loc\.container, locale\) : null\}/,
  },
  {
    file: 'inspectors/FlowNodeInspector.tsx',
    what: 'the nested breadcrumb’s node crumb (objectui#13242)',
    pattern: /text-foreground">\{flowNodeDisplayName\(node, locale\)\}<\/span>/,
  },
];

/** The shapes that print a node by its id. */
const ID_SHAPES: Record<string, RegExp> = {
  'label-or-id': /\blabel\)?\s*(?:\|\||\?\?)\s*[\w.?]*?\b\w*(?:id|Id)\b/,
  'label-ternary': /\.label\s*\?\s*[\w.?]+\.label\s*:\s*\w*(?:id|Id)\b/,
  'edge-ends': /\$\{[^}]*\b(?:source|target)\}\s*→|→\s*\$\{[^}]*\b(?:source|target)\}/,
  // A ` → ` join straight on a named list (`cycle.join(' → ')`), the ids as they
  // are; a join on a mapped list — the names the rule gave — is not this shape.
  'id-join': /\w\.join\(\s*['"`]\s*→\s*['"`]\s*\)/,
  'id-param': /tFormat\([^)]*\{\s*(?:id|source|target)\s*:\s*[\w.?]+\.(?:id|nodeId|source|target)\b/,
};

type Verdict =
  /** The id is kept on purpose beside or behind a name. */
  | 'id-kept'
  /** The node is missing from the flow: its id is all there is to name it by. */
  | 'missing-node'
  /** The message is about the id itself. */
  | 'id-subject'
  /** Not a node: a run id. */
  | 'not-a-node'
  /** Shows a selection's label, which the rule wrote; the id only for a selection with none. */
  | 'selection-label'
  /**
   * A node's own title, where its type is shown beside it: author label, else
   * id. The resolver would repeat the type (ruled B on objectui#13200).
   */
  | 'own-title'
  /**
   * A locator into the stored flow, in no language's words: the holder's id
   * roots a key path (`d › config.conditions[0].expression`), as the removal
   * refusal's `${nodeId} › boundaryConfig.attachedToNodeId` row does. It names
   * where an expression sits for a node-id rename, so the id is the address,
   * and a label (which two nodes may share) would not locate the key.
   */
  | 'id-path';

/** Keyed `file · shape · the masked line, trimmed` — content, never a line number (AGENTS.md #11). */
const ID_SITES: Record<string, Verdict> = {
  'previews/ProblemsPanel.tsx · edge-ends · title: `${p.target.source} → ${p.target.target}`,': 'id-kept',
  "previews/simulator/flow-sim-validate.ts · id-param · errors.push({ level: 'error', edge: { source: e.source, target: e.target }, message: tFormat('engine.flowValidate.edgeSourceMissing', locale, { source: e.source }) });": 'missing-node',
  "previews/simulator/flow-sim-validate.ts · id-param · errors.push({ level: 'error', edge: { source: e.source, target: e.target }, message: tFormat('engine.flowValidate.edgeTargetMissing', locale, { target: e.target }) });": 'missing-node',
  "inspectors/FlowNodeInspector.tsx · id-param · ? tFormat('engine.inspector.flowNode.idRefsUnparsed', locale, { id: node.id, refs })": 'id-subject',
  "previews/FlowRunsPanel.tsx · id-param · {tFormat('engine.flowRuns.runId', locale, { id: run.id })}": 'not-a-node',
  'previews/FlowPreview.tsx · label-or-id · : (selection.label ?? selection.id),': 'selection-label',
  'previews/FlowPreview.tsx · label-or-id · return { eyebrow: kind, title: selection.label ?? nested?.nodeId ?? selection.id };': 'selection-label',
  'inspectors/FlowEdgeInspector.tsx · label-or-id · title={selection.label ?? selection.id}': 'selection-label',
  "inspectors/FlowNodeInspector.tsx · label-or-id · <InspectorShell kindLabel={t('engine.inspector.flowNode.kind', locale)} title={selection.label ?? emptyId} onClose={onClearSelection} closeLabel={t('engine.inspector.flowNode.close', locale)}>": 'selection-label',
  // ── own-title: own title beside the type eyebrow; resolver would repeat the type (ruled B on objectui#13200) ──
  'previews/FlowCanvas.tsx · label-or-id · label={node.label || node.id}': 'own-title',
  "previews/FlowPreview.tsx · label-or-id · title: (typeof node.label === 'string' && node.label) || node.id,": 'own-title',
  'previews/flow-region-view.tsx · label-or-id · <div className="truncate text-[12px] font-semibold leading-tight text-foreground" title={node.label || node.id}>': 'own-title',
  'previews/flow-region-view.tsx · label-or-id · {node.label || node.id}': 'own-title',
  'inspectors/FlowNodeInspector.tsx · label-or-id · title={node.label || node.id}': 'own-title',
  "previews/flow-node-refs.ts · edge-ends · const where = site.holder.kind === 'node' ? site.holder.id : `${site.holder.source} → ${site.holder.target}`;": 'id-path',
};

function idShapedSites(): string[] {
  const hits = new Set<string>();
  for (const file of designerFiles()) {
    for (const line of source(file).split('\n')) {
      for (const [shape, re] of Object.entries(ID_SHAPES)) {
        if (re.test(line)) hits.add(`${file} · ${shape} · ${line.trim()}`);
      }
    }
  }
  return [...hits].sort();
}

describe('flow designer node names go through one rule (objectui#13200)', () => {
  it('control: the enumeration reaches every file a site lives in', () => {
    const files = designerFiles();
    for (const site of RESOLVER_SITES) expect(files).toContain(site.file);
    expect(files).toContain('previews/flow-canvas-parts.tsx');
  });

  it.each(RESOLVER_SITES.map((s) => [`${s.file} — ${s.what}`, s] as const))('%s goes through the rule', (_name, site) => {
    const matches = source(site.file).match(new RegExp(site.pattern.source, 'g')) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('every id-shaped site is listed, with the reason the id is right there', () => {
    expect(idShapedSites()).toEqual(Object.keys(ID_SITES).sort());
  });

  it('objectui#13242: no site is left open — every listed site has a reason', () => {
    const verdicts: string[] = Object.values(ID_SITES);
    // Population control: the scan still finds the sites the ledger reasons about,
    // so "no open entry" is not read off an empty list.
    expect(idShapedSites().length).toBe(verdicts.length);
    expect(verdicts.length).toBeGreaterThanOrEqual(15);
    expect(verdicts.filter((v) => v === 'own-title')).toHaveLength(5);
    expect(verdicts).not.toContain('open');
  });

  it('control: each shape catches the spelling the converted sites used to have', () => {
    const before = [
      ['label-or-id', "onSelectionChange?.({ kind: 'node', id: nodeId, label: node?.label || nodeId });"],
      ['label-ternary', "return typeof n?.label === 'string' && n.label ? n.label : id;"],
      ['edge-ends', "onSelectionChange?.({ kind: 'edge', id: key, label: `${e.source} → ${e.target}` })"],
      ['edge-ends', "label: `${String(context?.node?.id ?? '')} → ${b.target}`"],
      ['id-param', "message: tFormat('engine.flowValidate.nodeUnreachable', locale, { id: n.id })"],
      ['id-join', "tFormat('engine.flowValidate.cycleDetected', locale, { cycle: cycle.join(' → ') })"],
    ] as const;
    for (const [shape, line] of before) expect(ID_SHAPES[shape].test(line)).toBe(true);
    // ... and passes the converted spelling.
    expect(Object.values(ID_SHAPES).some((re) => re.test("label: flowEdgeDisplayName(p.target, nodes, locale)"))).toBe(false);
    // objectui#13242 — the cycle's names, joined after the rule mapped them.
    expect(ID_SHAPES['id-join'].test(".join(' → ');")).toBe(false);
    expect(ID_SHAPES['id-join'].test("cycle.map((id) => named.get(id)).join(' → ')")).toBe(false);
    expect(
      Object.values(ID_SHAPES).some((re) =>
        re.test("tFormat('engine.flowValidate.nodeUnreachable', locale, { name, id: n.id })"),
      ),
    ).toBe(false);
  });
});
