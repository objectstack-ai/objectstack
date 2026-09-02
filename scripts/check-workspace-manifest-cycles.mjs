#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-workspace-manifest-cycles -- the workspace manifest graph, over every
 * `workspace:` edge in `dependencies`, `devDependencies`, `peerDependencies`
 * and `optionalDependencies` across all workspace packages, has NO cycle.
 *
 *   node scripts/check-workspace-manifest-cycles.mjs              # judge the checked-in tree
 *   node scripts/check-workspace-manifest-cycles.mjs --self-test  # prove the rule can go red
 *
 * ## The defect this exists for (#13513, filed as #14195)
 *
 * #13513 cost seven independent dev seats a wasted build cycle each, on trees
 * they did not touch, because one `devDependencies` edge made the workspace
 * manifest graph cyclic. Before this gate, NOTHING in the repo read that graph
 * for cycles: the nearest neighbours are `check-turbo-task-graph.mjs` (judges
 * `turbo.json` task keys, not the manifest graph) and
 * `check-undeclared-dep-imports.mjs` (judges imports against declarations, not
 * the graph's shape). The only signal that ever existed was `pnpm install`
 * printing `WARN There are cyclic workspace dependencies: …` -- on stderr, at
 * install time, with EXIT 0 -- and it had been printing that warning for the
 * entire life of the #13513 defect before anyone read it.
 *
 * The failure this predicate guards against is silent in exactly the direction
 * that matters. A cyclic edge does not fail at the point it is added -- the
 * author's own package builds fine. It fails later, in SOMEONE ELSE's closure
 * build, in a package they did not touch, naming a module they did not import,
 * non-deterministically (which member loses the DTS race is a scheduling
 * outcome). The symptom is unstable while the cause is stable, and the first
 * hypothesis every reader forms is "my diff broke an import." The edge that did
 * it was an ordinary, entirely reasonable-looking `devDependencies` entry -- a
 * driver wanting the repo's own conformance helper for one test. Nothing about
 * writing it looks wrong, which is why nothing short of a gate catches the
 * next one.
 *
 * ## ⛔ All four declaration classes, or the guard is blind in exactly the
 * ## direction that bit us
 *
 * `peerDependencies` is walked deliberately, not as an afterthought. A scan
 * over `dependencies + devDependencies + optionalDependencies` -- omitting
 * peers -- reports 0 cycles on the pre-fix #13513 tree, HONESTLY AND WRONGLY:
 * the loop's first edge was a `peerDependencies` edge. That false zero is on
 * the record (#13513 comment `5473800149`, resolved in `5479206575`), and the
 * `--self-test` battery below drives the exact adversarial shape -- a cycle
 * whose ONLY closing edge is `peerDependencies` (and, for the same reason,
 * `optionalDependencies`) -- so a future edit that narrows `DECLARATION_CLASSES`
 * back to three reddens `--self-test` rather than silently losing recall.
 *
 * ## Edge semantics
 *
 * An edge P -> Q exists when P's manifest has a key `Q` (by NAME, never by
 * directory) in any of the four maps above, with a value starting
 * `workspace:` -- `workspace:*`, `workspace:^`, `workspace:~` and a
 * `workspace:<range>` all count identically; only the `workspace:` prefix
 * matters, not what follows it. A `workspace:`-prefixed spec naming a package
 * NO workspace member declares is a separate defect this gate does not judge
 * (a stale or misspelled entry, or a package that left the workspace) --
 * `main()` lists it as an informational note, never a refusal, because
 * refusing it would be a second gate this card's ruling did not order.
 *
 * A SELF-edge (P declaring a `workspace:` spec on itself) counts as a cycle of
 * length 1, reported the same way a longer cycle is: it is exactly as real a
 * build-order problem as a 2-cycle, and Tarjan's algorithm does not surface a
 * single-node strongly-connected component as cyclic on its own -- self-loops
 * are detected as a separate, explicit case (see `findCycles` below).
 *
 * ## Cheap, and total (#13513's note 4)
 *
 * Pure manifest read: no build, no network, no `pnpm` invocation. On this tree
 * that is 78 workspace `package.json` files (measured; the repo's 80 tracked
 * `package.json` files include the root manifest and this gate does not read
 * it, since the root is not a workspace member and cannot carry a
 * `workspace:` edge) and a Tarjan strongly-connected-components pass over the
 * name graph they declare -- well under a second.
 *
 * ## Refusals, never quiet passes (#4690's family)
 *
 * A `pnpm-workspace.yaml` that cannot be read or parsed, and a workspace that
 * enumerates to zero named packages, are both exit-2 refusals naming what could
 * not be read -- never a silent "0 packages, 0 edges, no cycle" that a gate
 * reading the wrong root or a broken enumerator would print identically to a
 * clean run.
 */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { workspacePackages, WorkspaceEnumerationError } from './workspace-enumerator.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * The root workspace-definition file this gate opens, in the SUBTREE spelling
 * the `scripts/pm/dispatch-gates.mjs` derivation can match (`turbo.json/**`'s
 * idiom in `check-turbo-task-graph.mjs`: a bare filename carries no path
 * separator and `extractWatchHints` refuses it as too generic, but the `/**`
 * suffix collapses back to the literal filename and matches it exactly).
 * `--self-test` pins the exact string.
 */
export const ROOT_FILE_WATCH_HINTS = ['pnpm-workspace.yaml/**'];

/**
 * The MEMBER manifests this gate opens, one per workspace package, spelled as
 * full-path glob LITERALS -- never built from a `SCAN_ROOT`-shaped constant,
 * which is exactly the bare-top-level-dir species
 * `scripts/pm/bare-root-worklist.mjs` records as unjudged
 * (`SCAN_ROOT = 'packages'` / `SCAN_ROOTS = [...]`). `packages/**\/package.json`
 * follows `check-dual-build-cjs-loads.mjs`'s own declaration for the same
 * subtree; `apps/**\/package.json` and `examples/**\/package.json` extend the
 * same spelling to the other two workspace roots this gate (unlike that one)
 * also reads member manifests under. Held against the enumerator's LIVE answer
 * in both directions by `--self-test`, the same discipline
 * `check-turbo-task-graph.mjs` applies to its own `DECLARED_WATCH_HINTS`.
 */
export const DECLARED_WATCH_HINTS = [
  'packages/**/package.json',
  'apps/**/package.json',
  'examples/**/package.json',
];

/**
 * The four manifest maps a `workspace:` edge can be declared in. `peerDependencies`
 * stays in this list on purpose -- see the header's false-zero note.
 */
export const DECLARATION_CLASSES = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

/** Thrown for conditions that must fail the gate rather than shrink its coverage. */
export class ManifestGraphReadError extends Error {}

/**
 * name -> manifest, from an already-enumerated member list. Split from the disk
 * read below so `--self-test` can drive the zero-named-packages refusal without
 * a filesystem fixture.
 *
 * @param {Array<{ dir: string, manifest: Record<string, unknown> }>} members
 * @returns {Map<string, Record<string, unknown>>}
 */
export function manifestsFromMembers(members) {
  const byName = new Map();
  for (const { manifest } of members) {
    if (typeof manifest?.name !== 'string' || !manifest.name) continue;
    byName.set(manifest.name, manifest);
  }
  if (byName.size === 0) {
    throw new ManifestGraphReadError(
      'the workspace enumerated to zero named packages — nothing to build the manifest graph from.',
    );
  }
  return byName;
}

/**
 * name -> manifest for every workspace member, read from disk via the shared
 * enumerator (the ONE parse of `pnpm-workspace.yaml`; see its header for why a
 * private copy is refused).
 *
 * @param {string} root
 * @returns {Map<string, Record<string, unknown>>}
 */
export function readWorkspaceManifests(root) {
  let members;
  try {
    members = workspacePackages(root);
  } catch (err) {
    if (err instanceof WorkspaceEnumerationError) throw new ManifestGraphReadError(err.message);
    throw err;
  }
  return manifestsFromMembers(members);
}

/**
 * Every `workspace:`-prefixed edge the graph declares, classified.
 *
 * Resolution is by package NAME, never by directory -- `manifestsByName`'s
 * keys are exactly what a `workspace:` spec's key names. Iteration order is
 * sorted at every level (packages, classes, dependency keys) so two runs over
 * the same input always produce the same edge list and the same cycle, if any.
 *
 * @param {Map<string, Record<string, unknown>>} manifestsByName
 * @returns {{
 *   adjacency: Map<string, Array<{ to: string, cls: string }>>,
 *   edgeCounts: Record<string, number>,
 *   totalEdges: number,
 *   unresolvedSpecs: Array<{ from: string, to: string, cls: string }>,
 * }}
 */
export function buildEdges(manifestsByName) {
  const adjacency = new Map();
  const edgeCounts = Object.fromEntries(DECLARATION_CLASSES.map((c) => [c, 0]));
  const unresolvedSpecs = [];
  let totalEdges = 0;

  for (const name of [...manifestsByName.keys()].sort()) {
    const manifest = manifestsByName.get(name);
    for (const cls of DECLARATION_CLASSES) {
      const table = manifest[cls];
      if (!table || typeof table !== 'object' || Array.isArray(table)) continue;
      for (const dep of Object.keys(table).sort()) {
        const spec = table[dep];
        if (typeof spec !== 'string' || !spec.startsWith('workspace:')) continue;
        if (!manifestsByName.has(dep)) {
          unresolvedSpecs.push({ from: name, to: dep, cls });
          continue;
        }
        if (!adjacency.has(name)) adjacency.set(name, []);
        adjacency.get(name).push({ to: dep, cls });
        edgeCounts[cls] += 1;
        totalEdges += 1;
      }
    }
  }
  return { adjacency, edgeCounts, totalEdges, unresolvedSpecs };
}

/**
 * Tarjan's strongly-connected-components algorithm over the name graph.
 *
 * @param {string[]} nodes every node, in the order components are seeded from
 * @param {Map<string, Array<{ to: string, cls: string }>>} adjacency
 * @returns {string[][]} components, in Tarjan's completion order
 */
export function tarjanSCCs(nodes, adjacency) {
  let counter = 0;
  const indices = new Map();
  const lowlink = new Map();
  const onStack = new Set();
  const stack = [];
  const sccs = [];

  const strongconnect = (v) => {
    indices.set(v, counter);
    lowlink.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);
    for (const { to } of adjacency.get(v) ?? []) {
      if (!indices.has(to)) {
        strongconnect(to);
        lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(to)));
      } else if (onStack.has(to)) {
        lowlink.set(v, Math.min(lowlink.get(v), indices.get(to)));
      }
    }
    if (lowlink.get(v) === indices.get(v)) {
      const scc = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      sccs.push(scc);
    }
  };

  for (const v of nodes) if (!indices.has(v)) strongconnect(v);
  return sccs;
}

/**
 * One explicit cycle inside a strongly-connected component, as an ordered node
 * walk with the declaration class closing each step -- the shape the refusal
 * message names edges from. A component is strongly connected by definition,
 * so a DFS confined to its own nodes always finds a back edge before running
 * out of neighbours; this never returns `null` for a real SCC of size > 1.
 *
 * Deterministic: the walk starts at the lexicographically smallest node in the
 * component and visits neighbours in `(to, cls)` sorted order, so the same SCC
 * always yields the same reported cycle.
 *
 * @param {Set<string>} sccNodes
 * @param {Map<string, Array<{ to: string, cls: string }>>} adjacency
 * @returns {{ nodes: string[], edges: string[] } | null}
 */
export function extractCycleInScc(sccNodes, adjacency) {
  const start = [...sccNodes].sort()[0];
  const path = [];
  const edgeAlong = [];
  const onStack = new Set();
  const visited = new Set();

  const dfs = (u) => {
    visited.add(u);
    onStack.add(u);
    path.push(u);
    const neighbours = (adjacency.get(u) ?? [])
      .filter((e) => sccNodes.has(e.to))
      .sort((a, b) => a.to.localeCompare(b.to) || a.cls.localeCompare(b.cls));
    for (const { to, cls } of neighbours) {
      if (onStack.has(to)) {
        const idx = path.indexOf(to);
        return { nodes: path.slice(idx), edges: [...edgeAlong.slice(idx), cls] };
      }
      if (!visited.has(to)) {
        edgeAlong.push(cls);
        const found = dfs(to);
        if (found) return found;
        edgeAlong.pop();
      }
    }
    path.pop();
    onStack.delete(u);
    return null;
  };

  return dfs(start);
}

/**
 * Every cycle the graph contains, one representative per cyclic
 * strongly-connected component (a component of size > 1, or a size-1
 * component whose sole node carries a self-loop). Sorted by the cycle's
 * starting node so the report is stable across runs.
 *
 * @param {Map<string, Array<{ to: string, cls: string }>>} adjacency
 * @param {string[]} nodes every node in the graph (not just ones with outgoing edges)
 * @returns {Array<{ nodes: string[], edges: string[] }>}
 */
export function findCycles(adjacency, nodes) {
  const sccs = tarjanSCCs(nodes, adjacency);
  const cycles = [];
  for (const scc of sccs) {
    if (scc.length > 1) {
      const cycle = extractCycleInScc(new Set(scc), adjacency);
      if (cycle) cycles.push(cycle);
      continue;
    }
    const [node] = scc;
    const selfEdge = (adjacency.get(node) ?? []).find((e) => e.to === node);
    if (selfEdge) cycles.push({ nodes: [node], edges: [selfEdge.cls] });
  }
  cycles.sort((a, b) => a.nodes[0].localeCompare(b.nodes[0]));
  return cycles;
}

/**
 * The rule, as a pure function over an already-resolved manifest map, so
 * `--self-test` can drive it with fixtures a clean tree does not contain.
 *
 * @param {Map<string, Record<string, unknown>>} manifestsByName
 * @returns {{
 *   memberCount: number,
 *   edgeCounts: Record<string, number>,
 *   totalEdges: number,
 *   cycles: Array<{ nodes: string[], edges: string[] }>,
 *   unresolvedSpecs: Array<{ from: string, to: string, cls: string }>,
 * }}
 */
export function verdict(manifestsByName) {
  const { adjacency, edgeCounts, totalEdges, unresolvedSpecs } = buildEdges(manifestsByName);
  const cycles = findCycles(adjacency, [...manifestsByName.keys()]);
  return { memberCount: manifestsByName.size, edgeCounts, totalEdges, cycles, unresolvedSpecs };
}

/**
 * A cycle as `A --class--> B --class--> … --> A`, the format the repair needs:
 * "there is a cycle" does not tell an author which edge to cut, this does.
 *
 * @param {{ nodes: string[], edges: string[] }} cycle
 * @returns {string}
 */
export function formatCycle(cycle) {
  const { nodes, edges } = cycle;
  let out = nodes[0];
  for (let i = 0; i < nodes.length; i++) {
    const next = nodes[(i + 1) % nodes.length];
    out += ` --${edges[i]}--> ${next}`;
  }
  return out;
}

function main() {
  let manifestsByName;
  try {
    manifestsByName = readWorkspaceManifests(ROOT);
  } catch (err) {
    if (err instanceof ManifestGraphReadError) {
      console.error(`FAIL: check-workspace-manifest-cycles could not read its input.\n  ${err.message}`);
      process.exit(2);
    }
    throw err;
  }

  const result = verdict(manifestsByName);

  if (result.cycles.length > 0) {
    console.error(
      `FAIL: the workspace manifest graph has ${result.cycles.length} cycle${result.cycles.length === 1 ? '' : 's'} ` +
        'over `workspace:` edges in dependencies, devDependencies, peerDependencies and ' +
        'optionalDependencies.\n',
    );
    for (const cycle of result.cycles) console.error(`  - ${formatCycle(cycle)}`);
    console.error(
      '\nWhy this gate exists (#13513): a cyclic edge does not fail where it is added -- the\n' +
        "author's own package builds fine. It fails later, in someone else's closure build, in a\n" +
        'package they did not touch, non-deterministically. `pnpm install` warns about this on\n' +
        'stderr with exit 0 and nothing reads it; this gate is the thing that does.\n' +
        '\n' +
        'Cut one edge per cycle listed above (the `workspace:` entry on the SOURCE side of the\n' +
        'named class) to break it, or confirm the dependency should not be `workspace:`-pinned at all.',
    );
    process.exit(1);
  }

  const byClass = DECLARATION_CLASSES.map((c) => `${c}=${result.edgeCounts[c]}`).join(', ');
  console.log(
    `OK: ${result.memberCount} workspace package(s), ${result.totalEdges} \`workspace:\` edge(s) ` +
      `(${byClass}) — the manifest graph has no cycle.` +
      (result.unresolvedSpecs.length
        ? ` ${result.unresolvedSpecs.length} \`workspace:\` spec(s) name a package no member ` +
          'declares (a separate defect this gate does not judge).'
        : ''),
  );
}

/**
 * The instrument for a gate whose defect class is its MATCHING RULE: a clean
 * tree cannot tell a working rule from one that stopped matching, because both
 * print zero findings (#11150's family). These cases supply the adversarial
 * inputs the tree does not contain, in both directions -- the peer-only and
 * optional-only cases are the #13513 false-zero control, driven directly:
 * narrowing `DECLARATION_CLASSES` back to the pre-fix three reds exactly those
 * two cases and nothing else.
 *
 * @returns {string[]} failure descriptions; empty means OK
 */
export function selfTest() {
  const failures = [];
  const t = (label, ok) => {
    if (!ok) failures.push(label);
  };

  // ── Direction 1: the rule must go RED on every cyclic shape ────────────────

  // (b) a plain 2-cycle via devDependencies -- both edges named with their class.
  const devCycle = verdict(
    new Map([
      ['@objectstack/a', { devDependencies: { '@objectstack/b': 'workspace:*' } }],
      ['@objectstack/b', { devDependencies: { '@objectstack/a': 'workspace:*' } }],
    ]),
  );
  t('a 2-cycle via devDependencies is a finding', devCycle.cycles.length === 1);
  {
    const msg = formatCycle(devCycle.cycles[0]);
    t('the message names both edges with their declaration class', (msg.match(/devDependencies/g) ?? []).length === 2);
  }

  // (c) the #13513 false-zero control: a cycle whose ONLY closing edge is
  // peerDependencies. A walker that drops peers reports this GREEN.
  const peerClosing = verdict(
    new Map([
      ['@objectstack/a', { dependencies: { '@objectstack/b': 'workspace:*' } }],
      ['@objectstack/b', { peerDependencies: { '@objectstack/a': 'workspace:*' } }],
    ]),
  );
  t(
    'a cycle whose ONLY closing edge is peerDependencies is caught (#13513 false-zero control)',
    peerClosing.cycles.length === 1,
  );
  t('the peer-only cycle names the peerDependencies edge', formatCycle(peerClosing.cycles[0]).includes('peerDependencies'));

  // (d) the same control for optionalDependencies.
  const optionalClosing = verdict(
    new Map([
      ['@objectstack/a', { dependencies: { '@objectstack/b': 'workspace:*' } }],
      ['@objectstack/b', { optionalDependencies: { '@objectstack/a': 'workspace:*' } }],
    ]),
  );
  t(
    'a cycle whose ONLY closing edge is optionalDependencies is caught',
    optionalClosing.cycles.length === 1,
  );
  t(
    'the optional-only cycle names the optionalDependencies edge',
    formatCycle(optionalClosing.cycles[0]).includes('optionalDependencies'),
  );

  // (f) a 3+-node cycle -- red, every edge listed in cycle order.
  const threeCycle = verdict(
    new Map([
      ['@objectstack/a', { dependencies: { '@objectstack/b': 'workspace:*' } }],
      ['@objectstack/b', { devDependencies: { '@objectstack/c': 'workspace:*' } }],
      ['@objectstack/c', { peerDependencies: { '@objectstack/a': 'workspace:*' } }],
    ]),
  );
  t('a 3-node cycle is a finding', threeCycle.cycles.length === 1);
  t('the 3-node cycle names all three nodes', threeCycle.cycles[0].nodes.length === 3);
  {
    const msg = formatCycle(threeCycle.cycles[0]);
    t(
      'the 3-node cycle lists all three edges with their classes, in cycle order',
      msg.includes('dependencies') && msg.includes('devDependencies') && msg.includes('peerDependencies') &&
        msg.indexOf('@objectstack/a') < msg.indexOf('@objectstack/b') &&
        msg.indexOf('@objectstack/b') < msg.indexOf('@objectstack/c'),
    );
  }

  // A self-edge counts as a cycle of length 1.
  const selfLoop = verdict(
    new Map([
      ['@objectstack/a', {}],
      ['@objectstack/b', { devDependencies: { '@objectstack/b': 'workspace:*' } }],
    ]),
  );
  t('a self-edge is a cycle of length 1', selfLoop.cycles.length === 1 && selfLoop.cycles[0].nodes.length === 1);
  t('the self-cycle names the package itself', selfLoop.cycles[0].nodes[0] === '@objectstack/b');
  t('the self-cycle names its own declaration class', selfLoop.cycles[0].edges[0] === 'devDependencies');

  // A disjoint SECOND cycle elsewhere in the graph is found too, not masked by
  // the first -- both are cyclic SCCs and `findCycles` walks every one of them.
  const twoCycles = verdict(
    new Map([
      ['@objectstack/a', { dependencies: { '@objectstack/b': 'workspace:*' } }],
      ['@objectstack/b', { dependencies: { '@objectstack/a': 'workspace:*' } }],
      ['@objectstack/c', { devDependencies: { '@objectstack/d': 'workspace:*' } }],
      ['@objectstack/d', { devDependencies: { '@objectstack/c': 'workspace:*' } }],
    ]),
  );
  t('two disjoint cycles are both reported', twoCycles.cycles.length === 2);

  // ── Direction 2: the rule must stay GREEN on every legitimate shape ────────

  // (a) an acyclic chain.
  const acyclic = verdict(
    new Map([
      ['@objectstack/a', {}],
      ['@objectstack/b', { dependencies: { '@objectstack/a': 'workspace:*' } }],
      ['@objectstack/c', { devDependencies: { '@objectstack/b': 'workspace:*' } }],
    ]),
  );
  t('an acyclic graph is green', acyclic.cycles.length === 0);
  t('its edges are still counted', acyclic.totalEdges === 2);

  // (e) a non-`workspace:` spec between two members is NOT an edge.
  const nonWorkspaceSpec = verdict(
    new Map([
      ['@objectstack/a', {}],
      ['@objectstack/b', { dependencies: { '@objectstack/a': '^1.0.0' } }],
    ]),
  );
  t('a non-workspace: spec is not an edge', nonWorkspaceSpec.totalEdges === 0);
  t('so it cannot form a cycle', nonWorkspaceSpec.cycles.length === 0);

  // All four `workspace:` spellings count identically.
  const specShapes = verdict(
    new Map([
      ['@objectstack/a', {}],
      ['@objectstack/b', {}],
      ['@objectstack/c', {}],
      ['@objectstack/d', {}],
      [
        '@objectstack/e',
        {
          dependencies: {
            '@objectstack/a': 'workspace:*',
            '@objectstack/b': 'workspace:^',
            '@objectstack/c': 'workspace:~',
            '@objectstack/d': 'workspace:^1.2.3',
          },
        },
      ],
    ]),
  );
  t('workspace:*, workspace:^, workspace:~ and workspace:<range> all count as edges', specShapes.totalEdges === 4);

  // A `workspace:` spec naming a package NO member declares is neither an edge
  // nor a refusal -- it is recorded so a caller can report it as a note.
  const unresolved = verdict(
    new Map([['@objectstack/a', { dependencies: { '@objectstack/does-not-exist': 'workspace:*' } }]]),
  );
  t('an unresolved workspace: spec is not an edge', unresolved.totalEdges === 0);
  t('and not a cycle finding', unresolved.cycles.length === 0);
  t('it is recorded rather than silently dropped', unresolved.unresolvedSpecs.length === 1);
  t(
    'the unresolved record names the source, target and class',
    unresolved.unresolvedSpecs[0].from === '@objectstack/a' &&
      unresolved.unresolvedSpecs[0].to === '@objectstack/does-not-exist' &&
      unresolved.unresolvedSpecs[0].cls === 'dependencies',
  );

  // Edge counts are attributed to the right class, not just totalled.
  t(
    'edge counts are attributed per class',
    devCycle.edgeCounts.devDependencies === 2 &&
      devCycle.edgeCounts.dependencies === 0 &&
      devCycle.edgeCounts.peerDependencies === 0 &&
      devCycle.edgeCounts.optionalDependencies === 0,
  );

  // ── formatCycle, pinned directly ────────────────────────────────────────
  t(
    'formatCycle closes the walk back to the starting node',
    formatCycle({ nodes: ['A', 'B'], edges: ['devDependencies', 'peerDependencies'] }) ===
      'A --devDependencies--> B --peerDependencies--> A',
  );
  t(
    'formatCycle handles a length-1 self-cycle',
    formatCycle({ nodes: ['A'], edges: ['devDependencies'] }) === 'A --devDependencies--> A',
  );

  // ── Refusals must refuse (#4690's family) ──────────────────────────────────
  const refuses = (label, fn) => {
    try {
      fn();
      failures.push(`${label} — did not throw`);
    } catch (err) {
      if (!(err instanceof ManifestGraphReadError)) failures.push(`${label} — threw ${err?.constructor?.name}`);
    }
  };
  refuses('a workspace root with no pnpm-workspace.yaml refuses', () =>
    readWorkspaceManifests(join(ROOT, 'scripts', 'no-such-dir-14195')),
  );
  refuses('zero named packages refuses rather than reporting an empty clean graph', () =>
    manifestsFromMembers([
      { dir: 'x', manifest: {} },
      { dir: 'y', manifest: { name: 123 } },
    ]),
  );
  t(
    'a member with a real name is still counted alongside the unnamed ones',
    manifestsFromMembers([
      { dir: 'x', manifest: {} },
      { dir: 'y', manifest: { name: '@objectstack/y' } },
    ]).size === 1,
  );

  // ── The derivation half, pinned as bytes ──────────────────────────────────
  // A reword back to a bare filename or a `SCAN_ROOT`-shaped constant is
  // invisible in every other signal this gate emits: production stays green,
  // CI stays green, and the only thing lost is that a manifest-graph card can
  // name this gate at all (or, for the member glob, that it re-enters the
  // bare-root species `scripts/pm/bare-root-worklist.mjs` records).
  t(
    'the root file is declared in the SUBTREE spelling',
    ROOT_FILE_WATCH_HINTS.join(',') === 'pnpm-workspace.yaml/**',
  );
  t(
    'the member manifests are declared as full-path glob literals for all three roots',
    DECLARED_WATCH_HINTS.join(',') === 'packages/**/package.json,apps/**/package.json,examples/**/package.json',
  );

  // ── The MEMBER manifests, held against the enumerator's live answer ────────
  // Both directions, mirroring `check-turbo-task-graph.mjs`'s own discipline: a
  // pattern that covers nothing is a fabricated lead, and a member manifest no
  // pattern covers is the undeclared read this gate would otherwise ship with.
  const patternMatches = (pattern, path) => {
    const segs = pattern.split('/');
    let rx = '';
    for (let i = 0; i < segs.length; i++) {
      if (segs[i] === '**') {
        rx += '(?:[^/]+/)*';
        continue;
      }
      rx += segs[i].replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
      if (i < segs.length - 1) rx += '/';
    }
    return new RegExp(`^${rx}$`).test(path);
  };
  const memberManifests = workspacePackages(ROOT).map((p) => `${p.dir}/package.json`);
  t(`the enumerator finds member manifests to declare (${memberManifests.length})`, memberManifests.length > 0);
  const undeclaredManifests = memberManifests.filter((m) => !DECLARED_WATCH_HINTS.some((h) => patternMatches(h, m)));
  t(
    `every member manifest this gate opens is covered by a declared pattern (uncovered: ${undeclaredManifests.join(', ') || 'none'})`,
    undeclaredManifests.length === 0,
  );
  const emptyPatterns = DECLARED_WATCH_HINTS.filter((h) => !memberManifests.some((m) => patternMatches(h, m)));
  t(
    `and no declared pattern covers zero of them (empty: ${emptyPatterns.join(', ') || 'none'})`,
    emptyPatterns.length === 0,
  );
  t(
    'the pattern matcher crosses separators for `**` and matches a top-level manifest too',
    patternMatches('packages/**/package.json', 'packages/plugins/knowledge-memory/package.json') &&
      patternMatches('packages/**/package.json', 'packages/spec/package.json') &&
      patternMatches('apps/**/package.json', 'apps/docs/package.json') &&
      !patternMatches('apps/**/package.json', 'apps/docs/package.json/extra'),
  );

  // ── Non-vacuity, on the LIVE tree ─────────────────────────────────────────
  // The cases above are all synthetic; this is the one that fails when the
  // gate is wired to a workspace it cannot actually reach.
  try {
    const live = verdict(readWorkspaceManifests(ROOT));
    t('the live tree presents workspace packages to judge', live.memberCount > 0);
    t('the live tree presents workspace: edges to judge', live.totalEdges > 0);
  } catch (err) {
    failures.push(`the live tree could not be read: ${err.message}`);
  }

  return failures;
}

function runSelfTest() {
  const failures = selfTest();
  if (failures.length) {
    console.error(`FAIL: check-workspace-manifest-cycles --self-test — ${failures.length} case(s) failed.`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('OK: check-workspace-manifest-cycles --self-test — all cases passed.');
}

// Exports bindings, so an import for those exports alone must run nothing (#10667).
if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) runSelfTest();
  else main();
}
