import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helpers; their types are inferred from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`).
import {
  ACCEPTED_CONTROL,
  ANCHOR_DOCUMENT,
  EXIT_CODES,
  FRAGMENT_MARKER,
  FRAGMENT_MARKER_EXAMPLES,
  REFUSED_CONTROL,
  SCAN_SURFACE,
  SKILLS_ANCHOR,
  SKILLS_ROOT,
  SKILL_OPT_IN_LINE,
  SURFACE_ANCHORS,
  analyze,
  classifyFence,
  controlFailures,
  describeIssue,
  listDocuments,
  main,
  nodeTypesOf,
  readableIssues,
  scanJsonFences,
} from '../check-doc-json-fences.mjs';
import {
  FRAGMENT_MARKER as SNIPPET_FRAGMENT_MARKER,
  FRAGMENT_MARKER_EXAMPLES as SNIPPET_FRAGMENT_MARKER_EXAMPLES,
} from '../check-doc-snippet-types.mjs';
import { packageReadmePages as familyPackageReadmes, ROOT_PAGES as FAMILY_ROOT_PAGES } from '../check-doc-component-types.mjs';
// The sibling gate over the skill bundle — imported HERE, never by the gate: the
// gate spells its opt-in line itself, and this file pins the two spellings equal.
import { MARKER as SKILL_EXAMPLES_MARKER, scanSkillFences } from '../check-skill-examples.mjs';

/**
 * objectui#5250 — the JSON-fence gate the maintainer ruling orders "on top of"
 * the strict authoring face.
 *
 * The face and the CLI's own door are imported DYNAMICALLY, through specifiers
 * held in variables, on purpose. `tsconfig.scripts.json`'s program imports no
 * `@object-ui/*` package — `scripts-type-check.test.ts` pins that premise, and it
 * is why `pnpm type-check:scripts` can run before the workspace build — and a
 * static import of either would pull a package's built declarations into that
 * program. Vitest resolves both at run time through the root config's aliases,
 * so here the face is the SOURCE face; the gate itself reads the BUILT one, and
 * the agreement test below is what ties the two verdicts to one door.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

interface Verdict {
  success: boolean;
  error?: { issues: unknown[] };
}
interface FaceModule {
  StrictAnyComponentSchema: { safeParse(doc: unknown): Verdict };
  AnyComponentSchema: { safeParse(doc: unknown): Verdict };
}
interface DoorModule {
  validateAuthoredDocument(doc: unknown): Verdict;
}

const FACE_SPECIFIER = '@object-ui/types/zod';
const DOOR_SPECIFIER = '../../packages/cli/src/utils/authoring-face.ts';

// At module scope, not in a hook: the cold transform of the face belongs to the
// import phase, where no test or hook timeout applies (AGENTS.md section 9).
const face = (await import(/* @vite-ignore */ FACE_SPECIFIER)) as FaceModule;
const door = (await import(/* @vite-ignore */ DOOR_SPECIFIER)) as DoorModule;
const judge = (doc: unknown): Verdict => face.StrictAnyComponentSchema.safeParse(doc);
const tolerant = (doc: unknown): Verdict => face.AnyComponentSchema.safeParse(doc);
const nodeTypes: Set<string> = nodeTypesOf(face.AnyComponentSchema);
const parseJsonc = createRequire(path.join(repoRoot, 'packages/cli/package.json'))('jsonc-parser').parse;

const tempRoots: string[] = [];
afterAll(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

function tempTree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-json-gate-'));
  tempRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

const FENCE = '```';
const fence = (lang: string, value: unknown): string => [`${FENCE}${lang}`, JSON.stringify(value, null, 2), FENCE].join('\n');
const run = (files: Record<string, string>, anchors: readonly string[] | null = null) =>
  analyze({ root: tempTree(files), judge, tolerant, nodeTypes, parseJsonc, anchors });
const reasons = (r: { findings: { reason: string }[] }) => r.findings.map((f) => f.reason);

describe('scanJsonFences — what the gate reads', () => {
  it('collects json and jsonc fences, lower-cased, and nothing else', () => {
    const { fences } = scanJsonFences(
      [`${FENCE}JSON`, '{}', FENCE, `${FENCE}ts`, 'const x = 1;', FENCE, `${FENCE}jsonc title="a"`, '{}', FENCE, `${FENCE}bash`, 'ls', FENCE].join('\n'),
    );
    expect(fences.map((f) => f.language)).toEqual(['json', 'jsonc']);
    expect(fences.map((f) => f.fenceLine)).toEqual([1, 7]);
  });

  it('reads a fence inside a blockquote, with the quote prefix stripped from its body', () => {
    const { fences } = scanJsonFences(['> Callout prose.', '>', `> ${FENCE}json`, '> { "type": "text" }', `> ${FENCE}`].join('\n'));
    expect(fences).toHaveLength(1);
    expect(fences[0].quoteDepth).toBe(1);
    expect(JSON.parse(fences[0].body)).toEqual({ type: 'text' });
  });

  it('treats a shorter run inside a longer fence as body, through the shared scanner', () => {
    const { fences } = scanJsonFences(['````markdown', `${FENCE}json`, '{ "type": "text" }', FENCE, '````'].join('\n'));
    expect(fences).toEqual([]);
  });

  it('attaches a marker across blank lines, at the same quote depth only', () => {
    const marker = FRAGMENT_MARKER_EXAMPLES[0];
    const same = scanJsonFences([marker, '', '', `${FENCE}json`, '{}', FENCE].join('\n'));
    expect(same.fences[0].fragmentReason).toMatch(/not a complete, valid node document/);
    expect(same.markers.map((m) => m.consumed)).toEqual([true]);

    const otherDepth = scanJsonFences([marker, '', `> ${FENCE}json`, '> {}', `> ${FENCE}`].join('\n'));
    expect(otherDepth.fences[0].fragmentReason).toBeNull();
    expect(otherDepth.markers.map((m) => m.consumed)).toEqual([false]);

    const aboveTs = scanJsonFences([marker, `${FENCE}ts`, 'x', FENCE].join('\n'));
    expect(aboveTs.markers.map((m) => m.consumed)).toEqual([false]);
  });

  it('steps over the skill gate\'s opt-in line when it is directly above the fence — three contiguous lines at one depth, and nothing else (objectui#12204)', () => {
    const decl = FRAGMENT_MARKER_EXAMPLES[1];
    const optIn = SKILL_OPT_IN_LINE;
    const attached = (lines: string[]) => {
      const { fences, markers } = scanJsonFences(lines.join('\n'));
      return { reason: fences[0]?.fragmentReason ?? null, consumed: markers.map((m) => m.consumed) };
    };
    const declared = { reason: expect.stringMatching(/not a complete, valid node document/), consumed: [true] };
    const dangling = { reason: null, consumed: [false] };
    // Measured on the tree before this rule: the trio did NOT attach — the
    // declaration was dangling and its fence undeclared, so a page could not
    // carry both gates' lines above one fence.
    expect(attached([decl, optIn, `${FENCE}json`, '{}', FENCE])).toEqual(declared);
    expect(attached([`> ${decl}`, `> ${optIn}`, `> ${FENCE}jsonc`, '> {}', `> ${FENCE}`])).toEqual(declared);
    // Anything else between the declaration and the fence: a blank line, prose,
    // a second opt-in line, an opt-in line that is not itself directly above
    // the fence — and a declaration at another quote depth.
    for (const between of [[decl, '', optIn], [decl, 'Prose.', optIn], [decl, optIn, optIn], [decl, optIn, '']]) {
      expect(attached([...between, `${FENCE}json`, '{}', FENCE]), between.join(' | ')).toEqual(dangling);
    }
    expect(attached([decl, `> ${optIn}`, `> ${FENCE}json`, '> {}', `> ${FENCE}`])).toEqual(dangling);
    // The opt-in line is transparent only above a fence this gate reads.
    expect(attached([decl, optIn, `${FENCE}ts`, 'x', FENCE])).toEqual(dangling);
  });
});

describe('the marker spelling is its own namespace', () => {
  it('matches both of its own example spellings', () => {
    for (const example of FRAGMENT_MARKER_EXAMPLES) expect(FRAGMENT_MARKER.test(example)).toBe(true);
  });

  it('is not the ts/tsx gate\'s marker, in either direction — that gate reports its marker above a json fence as stale', () => {
    for (const example of FRAGMENT_MARKER_EXAMPLES) expect(SNIPPET_FRAGMENT_MARKER.test(example)).toBe(false);
    for (const example of SNIPPET_FRAGMENT_MARKER_EXAMPLES) expect(FRAGMENT_MARKER.test(example)).toBe(false);
  });

  it('spells the skill gate\'s opt-in line exactly as that gate does — pinned here, not imported there (objectui#12204)', () => {
    expect(SKILL_OPT_IN_LINE).toBe(SKILL_EXAMPLES_MARKER);
    // The opt-in line is not a declaration for this gate, and a declaration is not an opt-in for that one.
    expect(FRAGMENT_MARKER.test(SKILL_OPT_IN_LINE)).toBe(false);
    for (const example of FRAGMENT_MARKER_EXAMPLES) expect(example.trim()).not.toBe(SKILL_EXAMPLES_MARKER);
  });
});

describe('classifyFence — the node-document predicate', () => {
  const classify = (language: string, body: string) =>
    classifyFence({ language, body, fenceLine: 1, quoteDepth: 0, fragmentReason: null }, { nodeTypes, parseJsonc });

  it('sorts every non-document into its own bucket', () => {
    expect(classify('json', '{ "type": "text", }').kind).toBe('notJson');
    expect(classify('json', '[{ "type": "text" }]').kind).toBe('notAnObject');
    expect(classify('json', '{ "name": "amount" }').kind).toBe('noTypeKey');
    expect(classify('json', '{ "type": "my-component" }')).toEqual({ kind: 'unresolvedType', type: 'my-component' });
  });

  it('reads jsonc with the options `objectui check` reads a .json file with — comments and trailing commas', () => {
    const c = classify('jsonc', '{\n  "type": "text", // a comment\n  "content": "hi",\n}');
    expect(c.kind).toBe('document');
    expect(c.value).toEqual({ type: 'text', content: 'hi' });
  });

  it('reads json with JSON.parse — a comment in a json fence is not JSON', () => {
    expect(classify('json', '{ "type": "text" // a comment\n}').kind).toBe('notJson');
  });
});

describe('analyze — the verdicts, against the real face', () => {
  it('RED: refuses a node document carrying an undeclared key, and names the key', () => {
    const r = run({ 'content/docs/a.mdx': fence('json', { type: 'button', label: 'Go', action: { type: 'submit' } }) });
    expect(reasons(r)).toEqual(['refused']);
    // fixture-address: a page in the temp fixture tree this test writes, as the gate under test reports it
    expect(r.findings[0].site).toBe('content/docs/a.mdx:1');
    expect(r.findings[0].detail).toMatch(/tolerant face accepts it/);
    expect(r.findings[0].issues).toEqual(['at (root): undeclared key "action"']);
  });

  it('accepts a declared-only node document', () => {
    const r = run({ 'content/docs/a.md': fence('json', { type: 'button', label: 'Go' }) });
    expect(r.findings).toEqual([]);
    expect(r.accepted).toHaveLength(1);
    expect(r.judged).toHaveLength(1);
  });

  it('takes a declaration only where the face refuses the fence', () => {
    const declared = run({ 'content/docs/a.mdx': [FRAGMENT_MARKER_EXAMPLES[0], fence('json', { type: 'button', nonsense: 1 })].join('\n') });
    expect(declared.findings).toEqual([]);
    expect(declared.declared).toHaveLength(1);

    const onAccepted = run({ 'content/docs/a.md': [FRAGMENT_MARKER_EXAMPLES[1], fence('json', { type: 'button', label: 'Go' })].join('\n') });
    expect(reasons(onAccepted)).toEqual(['stale-fragment-marker']);

    const onNonDocument = run({ 'content/docs/a.md': [FRAGMENT_MARKER_EXAMPLES[1], fence('json', { name: 'amount' })].join('\n') });
    expect(reasons(onNonDocument)).toEqual(['stale-fragment-marker']);
  });

  it('reports a marker that declares nothing, a reason too short to be one, and a verification claim', () => {
    expect(reasons(run({ 'content/docs/a.mdx': [FRAGMENT_MARKER_EXAMPLES[0], '', 'Just prose.'].join('\n') }))).toEqual([
      'dangling-fragment-marker',
    ]);
    expect(
      reasons(run({ 'content/docs/a.mdx': ['{/* doc-json: fragment — short */}', fence('json', { type: 'button', nonsense: 1 })].join('\n') })),
    ).toEqual(['unexplained-fragment']);
    expect(
      reasons(
        run({
          'content/docs/a.mdx': [
            '{/* doc-json: fragment — an excerpt, verified against the renderer by hand */}',
            fence('json', { type: 'button', nonsense: 1 }),
          ].join('\n'),
        }),
      ),
    ).toEqual(['verification-claim-on-fragment']);
  });

  it('reads past the first issue of a union to the arm the value nearly fits', () => {
    const r = run({ 'content/docs/a.mdx': fence('json', { type: 'card', title: 'T', children: [{ type: 'button', label: 'Go', nonsense: 1 }] }) });
    expect(reasons(r)).toEqual(['refused']);
    expect((r.findings[0].issues ?? []).join('\n')).toMatch(/undeclared key "nonsense"/);
  });

  it('ANTI-IDLE: an enumeration that judged nothing, or lost its anchor, is a precondition, never a green', () => {
    expect(run({ 'content/docs/a.mdx': fence('json', { name: 'not a node' }) }).preconditions.map((p) => p.reason)).toEqual(['nothing-judged']);
    expect(run({ 'content/docs/a.mdx': fence('json', { type: 'button', label: 'Go' }) }, ['content/docs/anchor.mdx']).preconditions.map((p) => p.reason)).toEqual([
      'anchor-unread',
    ]);
    // Only pages OFF the surface (objectui#12131, objectui#12204): a record, a
    // README below a package root, a CHANGELOG, a changeset, a skill page
    // outside the published bundle and an internal skill. Each holds a refused
    // node document, so a leg that reached any of them would report it.
    const refusedDoc = fence('json', { type: 'button', label: 'Go', nonsense: 1 });
    const empty = run({
      'docs/audits/2026-01-record.md': refusedDoc,
      'packages/demo/src/renderers/README-KANBAN.md': refusedDoc,
      'packages/demo/src/README.md': refusedDoc,
      'packages/demo/CHANGELOG.md': refusedDoc,
      '.changeset/a-change.md': refusedDoc,
      'skills/demo/README.md': refusedDoc,
      '.claude/skills/demo/SKILL.md': refusedDoc,
    });
    expect(empty.documents).toEqual([]);
    expect(empty.findings).toEqual([]);
    expect(empty.preconditions.map((p) => p.reason)).toEqual(['empty-enumeration']);
  });
});

/**
 * objectui#12131 — the published READMEs joined the scan surface, because this
 * gate was green while three README examples were refused by `objectui
 * validate`. Each test below goes RED against the content-docs-only surface the
 * gate had before: that surface read neither README, so it reported nothing and
 * judged nothing there.
 */
describe('the scan surface — the published READMEs (objectui#12131)', () => {
  const refusedDoc = fence('json', { type: 'button', label: 'Go', action: { type: 'submit' } });
  const acceptedDoc = fence('json', { type: 'button', label: 'Go' });

  it('RED: refuses a node document in a package\'s own README and in the root README, and names each', () => {
    const r = run({ 'content/docs/a.mdx': acceptedDoc, 'packages/demo/README.md': refusedDoc, 'README.md': refusedDoc });
    expect(reasons(r)).toEqual(['refused', 'refused']);
    // fixture-address: pages in the temp fixture tree this test writes, as the gate under test reports them
    expect(r.findings.map((f) => f.site)).toEqual(['packages/demo/README.md:1', 'README.md:1']);
    expect(r.findings.map((f) => f.issues)).toEqual([['at (root): undeclared key "action"'], ['at (root): undeclared key "action"']]);
  });

  it('walks the legs in their declared order and counts each leg\'s pages', () => {
    const r = run({ 'content/docs/a.mdx': acceptedDoc, 'packages/demo/README.md': acceptedDoc, 'README.md': acceptedDoc });
    expect(r.legs.map((l) => l.leg)).toEqual(SCAN_SURFACE.map((l) => l.leg));
    // The skills leg (objectui#12204) walks last and collects nothing in this fixture.
    expect(r.legs.map((l) => l.pages)).toEqual([['content/docs/a.mdx'], ['packages/demo/README.md'], ['README.md'], []]);
    expect(r.documents).toEqual(['content/docs/a.mdx', 'packages/demo/README.md', 'README.md']);
    expect(r.accepted).toHaveLength(3);
  });

  it('takes a README fragment declared with the HTML-comment marker, and judges a declaration there as anywhere else', () => {
    const declared = run({ 'packages/demo/README.md': [FRAGMENT_MARKER_EXAMPLES[1], refusedDoc].join('\n') });
    expect(declared.findings).toEqual([]);
    expect(declared.declared).toHaveLength(1);

    const stale = run({ 'README.md': [FRAGMENT_MARKER_EXAMPLES[1], acceptedDoc].join('\n') });
    expect(reasons(stale)).toEqual(['stale-fragment-marker']);
  });

  it('ANTI-IDLE: every leg owes its anchor — a leg that collected nothing is a precondition, never a green', () => {
    const otherAnchors = SURFACE_ANCHORS.filter((a) => a !== ANCHOR_DOCUMENT);
    // Non-vacuous: both README legs and the skills leg exist, so there are anchors to fail.
    expect(otherAnchors).toContain('README.md');
    expect(otherAnchors.some((a) => /^packages\/[^/]+\/README\.md$/.test(a))).toBe(true);
    expect(otherAnchors).toContain(SKILLS_ANCHOR);
    const r = run({ [ANCHOR_DOCUMENT]: acceptedDoc }, SURFACE_ANCHORS);
    expect(r.judged).toHaveLength(1);
    expect(r.preconditions.map((p) => `${p.reason} ${p.site}`)).toEqual(otherAnchors.map((a) => `anchor-unread ${a}`));
  });

  it('every leg names an anchor, and the anchors are one per leg', () => {
    expect(SURFACE_ANCHORS).toEqual(SCAN_SURFACE.map((l) => l.anchor));
    expect(new Set(SURFACE_ANCHORS).size).toBe(SCAN_SURFACE.length);
    expect(SURFACE_ANCHORS).toContain(ANCHOR_DOCUMENT);
  });

  it('its README legs are the doc-gate family\'s, read from the real tree', () => {
    const docs = listDocuments(repoRoot);
    const family = familyPackageReadmes(repoRoot).map((abs: string) => path.relative(repoRoot, abs).split(path.sep).join('/'));
    // Non-vacuous: an empty family leg would make the equality below pass.
    expect(family.length, 'the family collected no package README').toBeGreaterThan(10);
    expect(docs.filter((d) => /^packages\/[^/]+\/README\.md$/.test(d))).toEqual(family);
    for (const name of FAMILY_ROOT_PAGES) expect(docs).toContain(name);
    expect(docs.filter((d) => d.startsWith('docs/') || /CHANGELOG\.md$/.test(d))).toEqual([]);
  });
});

/**
 * objectui#12204 — the published skill bundle joined the scan surface, on the
 * owner's ruling. Every json/jsonc fence there carries `check-skill-examples`'s
 * opt-in line directly above it, and that gate requires it exactly there; so a
 * declaration for this gate sits directly above the opt-in line, and the walk
 * steps over that one line and nothing else. Measured before the rule: the
 * three-line shape did not attach, and the leg itself did not exist, so each
 * test below goes RED against the gate as it was.
 */
describe('the scan surface — the published skill bundle (objectui#12204)', () => {
  const refusedDoc = fence('json', { type: 'button', label: 'Go', action: { type: 'submit' } });
  const acceptedDoc = fence('json', { type: 'button', label: 'Go' });
  const optIn = SKILL_OPT_IN_LINE;
  const declaration = FRAGMENT_MARKER_EXAMPLES[1];
  const page = (...lines: string[]) => lines.join('\n');
  const last = <T,>(xs: readonly T[]): T => xs[xs.length - 1];

  it('RED: an undeclared refused node document under skills/objectui/ is red, and named', () => {
    const r = run({ [ANCHOR_DOCUMENT]: acceptedDoc, 'skills/objectui/rules/protocol.md': page(optIn, refusedDoc) });
    expect(reasons(r)).toEqual(['refused']);
    // fixture-address: a page in the temp fixture tree this test writes, as the gate under test reports it
    expect(r.findings[0].site).toBe('skills/objectui/rules/protocol.md:2');
    expect(r.findings[0].issues).toEqual(['at (root): undeclared key "action"']);
  });

  it('GREEN: a declaration directly above the opt-in line that is directly above the fence declares it', () => {
    const r = run({ 'skills/objectui/guides/a.md': page(declaration, optIn, refusedDoc) });
    expect(r.findings).toEqual([]);
    expect(r.declared).toHaveLength(1);
    // Without an opt-in line the ordinary attachment rule applies there as anywhere.
    const plain = run({ 'skills/objectui/guides/a.md': page(declaration, refusedDoc) });
    expect(plain.findings).toEqual([]);
    expect(plain.declared).toHaveLength(1);
  });

  it('a declaration separated from its fence by anything but that one opt-in line is dangling, and the fence stays refused', () => {
    for (const between of [[declaration, '', optIn], [declaration, 'Lead-in prose.', optIn], [declaration, optIn, optIn], [declaration, optIn, '']]) {
      const r = run({ 'skills/objectui/guides/a.md': page(...between, refusedDoc) });
      expect(reasons(r), between.join(' | ')).toEqual(['dangling-fragment-marker', 'refused']);
      expect(r.findings[0].detail).toMatch(/opt-in line/);
    }
  });

  it('re-judges a declaration through the opt-in line as anywhere else — stale on an accepted fence, so the list can only shrink', () => {
    expect(reasons(run({ 'skills/objectui/guides/a.md': page(declaration, optIn, acceptedDoc) }))).toEqual(['stale-fragment-marker']);
  });

  it('walks every .md page under skills/objectui/ in a stable order, as the last leg, and no other skills tree', () => {
    const r = run({
      [ANCHOR_DOCUMENT]: acceptedDoc,
      'README.md': acceptedDoc,
      'skills/objectui/rules/protocol.md': acceptedDoc,
      'skills/objectui/SKILL.md': acceptedDoc,
      'skills/objectui/guides/b.md': acceptedDoc,
      'skills/objectui/guides/a.md': acceptedDoc,
      'skills/objectui/evals/protocol.json': '{}',
      'skills/other/README.md': refusedDoc,
      '.claude/skills/demo/SKILL.md': refusedDoc,
    });
    expect(r.findings).toEqual([]);
    expect(last(r.legs).leg).toBe(last(SCAN_SURFACE).leg);
    expect(last(r.legs).pages).toEqual(['skills/objectui/SKILL.md', 'skills/objectui/guides/a.md', 'skills/objectui/guides/b.md', 'skills/objectui/rules/protocol.md']);
    expect(r.documents.slice(-4)).toEqual(last(r.legs).pages);
  });

  it('ANTI-IDLE: the skills leg owes its anchor, and the anchor is a page on that leg', () => {
    expect(SKILLS_ANCHOR.startsWith(`${SKILLS_ROOT}/`)).toBe(true);
    expect(last(SURFACE_ANCHORS)).toBe(SKILLS_ANCHOR);
    const r = run({ [ANCHOR_DOCUMENT]: acceptedDoc, 'skills/objectui/guides/a.md': acceptedDoc }, [SKILLS_ANCHOR]);
    expect(r.judged).toHaveLength(2);
    expect(r.preconditions.map((p) => `${p.reason} ${p.site}`)).toEqual([`anchor-unread ${SKILLS_ANCHOR}`]);
  });

  it('reads the real bundle: the leg collects skills/objectui/ and nothing else under skills/, with the anchor on it', () => {
    const docs = listDocuments(repoRoot);
    const skills = docs.filter((d) => d.startsWith('skills/'));
    expect(skills.length, 'the skills leg collected no page').toBeGreaterThan(5);
    expect(skills.every((d) => d.startsWith(`${SKILLS_ROOT}/`) && d.endsWith('.md'))).toBe(true);
    expect(skills).toContain(SKILLS_ANCHOR);
    expect(docs.filter((d) => d.startsWith('.claude/'))).toEqual([]);
  });

  it('this gate\'s declarations in the real bundle orphan none of the skill gate\'s opt-in lines', () => {
    const r = analyze({ root: repoRoot, judge, tolerant, nodeTypes, parseJsonc });
    const pages = new Set((r.declared as { doc: string }[]).map((d) => d.doc).filter((doc) => doc.startsWith(`${SKILLS_ROOT}/`)));
    // Non-vacuous: the bundle carries declared counter-examples; none would make the loop below pass over nothing.
    expect(pages.size, 'no declared fragment under the bundle').toBeGreaterThan(0);
    for (const doc of pages) {
      const scan = scanSkillFences(fs.readFileSync(path.join(repoRoot, doc), 'utf8'));
      expect(scan.orphans, `${doc}: orphaned opt-in lines`).toEqual([]);
    }
  });
});

describe('controls — a probe that cannot fail is not a probe', () => {
  it('hold against the real faces', () => {
    expect(controlFailures({ judge, tolerant, nodeTypes })).toEqual([]);
  });

  it('REFUSES fails when the "strict" face handed in is the passthrough one', () => {
    expect(controlFailures({ judge: tolerant, tolerant, nodeTypes }).join('\n')).toMatch(/REFUSES/);
  });

  it('ACCEPTS fails when the judge refuses everything', () => {
    expect(controlFailures({ judge: () => ({ success: false }), tolerant, nodeTypes }).join('\n')).toMatch(/ACCEPTS/);
  });

  it('the control documents isolate exactly one undeclared key', () => {
    expect(judge(REFUSED_CONTROL).success).toBe(false);
    expect(tolerant(REFUSED_CONTROL).success).toBe(true);
    expect(judge(ACCEPTED_CONTROL).success).toBe(true);
    const issues = readableIssues(judge(REFUSED_CONTROL).error?.issues ?? []).map(describeIssue);
    expect(issues).toEqual(['at (root): undeclared key "thisKeyIsDeclaredNowhere"']);
  });
});

describe('one authority — the CLI door and the gate agree on every judged document', () => {
  it('validateAuthoredDocument returns the gate\'s verdict for every node document in the corpus', () => {
    const r = analyze({ root: repoRoot, judge, tolerant, nodeTypes, parseJsonc });
    const judged = r.judged as { site: string; value: unknown }[];
    expect(judged.length, 'the corpus walk judged nothing — the agreement below would be vacuous').toBeGreaterThan(0);
    // The two controls ride with the corpus. Every fence the corpus refuses is
    // refused by the TOLERANT face as well (declared fragments, each red on both
    // faces), so the corpus alone cannot tell the strict door from a tolerant
    // one — measured: a door re-pointed at `AnyComponentSchema` stayed green
    // over the corpus. The REFUSES control is strict-only by construction.
    const population = [
      ...judged,
      { site: 'REFUSED_CONTROL', value: REFUSED_CONTROL },
      { site: 'ACCEPTED_CONTROL', value: ACCEPTED_CONTROL },
    ];
    const gate = population.map((j) => `${j.site} ${judge(j.value).success}`);
    const cli = population.map((j) => `${j.site} ${door.validateAuthoredDocument(j.value).success}`);
    expect(cli).toEqual(gate);
    // Both verdicts occur, so the agreement is not over one constant answer.
    expect(new Set(judged.map((j) => judge(j.value).success))).toEqual(new Set([true, false]));
  });

  it.each(SURFACE_ANCHORS)('reads its anchor page %s, and judges a node document there, from the real corpus', (anchor) => {
    expect(listDocuments(repoRoot)).toContain(anchor);
    const r = analyze({ root: repoRoot, judge, tolerant, nodeTypes, parseJsonc, anchors: [anchor] });
    expect(r.preconditions).toEqual([]);
    expect(r.judged.some((j: { doc: string }) => j.doc === anchor)).toBe(true);
  });
});

describe('main — exit codes', () => {
  it('exits 2, could not run, when the face is not built', async () => {
    const root = tempTree({
      'packages/types/package.json': JSON.stringify({ exports: { './zod': { import: './dist/zod/index.zod.js' } } }),
      'content/docs/a.mdx': fence('json', { type: 'button', label: 'Go' }),
    });
    expect(await main([], root)).toBe(EXIT_CODES.couldNotRun);
  });

  it('states all three codes in its own header', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'scripts/check-doc-json-fences.mjs'), 'utf8');
    const header = source.slice(0, source.indexOf('## Why this exists'));
    expect(header).toContain('0 = every judged node document');
    expect(header).toContain('1 = THE GATE RAN AND FOUND ERRORS');
    expect(header).toContain('2 = THE GATE COULD NOT RUN');
  });
});

/**
 * Wired like its two siblings, and pinned the way they pin theirs: a check no
 * workflow runs is not a gate (objectui#8757).
 */
describe('wiring — the gate runs in CI, after the build and after its siblings', () => {
  const GATE = 'scripts/check-doc-json-fences.mjs';
  const SIBLINGS = ['scripts/check-doc-snippet-types.mjs', 'scripts/check-doc-example-types.mjs'];
  const HOME = 'repo-gates.yml';
  const workflowDir = path.join(repoRoot, '.github/workflows');
  const workflowFiles = fs.readdirSync(workflowDir).filter((f) => f.endsWith('.yml'));
  const yamlOf = (file: string): string =>
    fs
      .readFileSync(path.join(workflowDir, file), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');
  const invocation = (yaml: string, script: string) => yaml.search(new RegExp(`run: node ${script.replace(/[.\\/]/g, '\\$&')}\\s*$`, 'm'));

  it('lives in exactly one workflow, which gates pull requests and filters no path', () => {
    expect(workflowFiles.length, 'the workflow directory scan returned implausibly few files').toBeGreaterThan(5);
    expect(workflowFiles.filter((f) => yamlOf(f).includes(GATE))).toEqual([HOME]);
    const yaml = yamlOf(HOME);
    expect(yaml).toContain('pull_request:');
    expect(yaml).not.toMatch(/^\s*paths(-ignore)?:/m);
  });

  it('is invoked after the build that produces @object-ui/types, and after both sibling gates', () => {
    const yaml = yamlOf(HOME);
    const build = yaml.indexOf('turbo run build');
    const invoke = invocation(yaml, GATE);
    expect(build).toBeGreaterThan(-1);
    expect(invoke, 'the workflow must invoke the gate itself').toBeGreaterThan(build);
    for (const sibling of SIBLINGS) {
      const at = invocation(yaml, sibling);
      expect(at, `${sibling} must still be invoked`).toBeGreaterThan(-1);
      expect(invoke, `a newly wired gate must not mask ${sibling}`).toBeGreaterThan(at);
    }
  });

  it('has a root script and is documented on the page that inventories the gates', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(manifest.scripts['check:doc-json']).toBe(`node ${GATE}`);
    const page = fs.readFileSync(path.join(repoRoot, 'content/docs/guide/ci-cd-pipeline.md'), 'utf8');
    expect(page).toContain('pnpm check:doc-json');
    expect(page).toContain(GATE);
  });
});
