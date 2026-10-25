import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  analyze,
  APP_DOCS,
  appDocsDirs,
  collectNodes,
  CONTROL_FIXTURES,
  deriveChannels,
  DOCS_ROOT,
  JSON_FENCE_LANGUAGES,
  listDocuments,
  loadCarriage,
  PACKAGE_READMES,
  packageReadmePages,
  parseFence,
  parseFenceDialect,
  RENDERER_SOURCE,
  requireJsonContract,
  ROOT_PAGES,
  runControls,
  sanitizeFence,
  splitTopLevel,
  SURFACE_LABEL,
  toJsonDialect,
  UNPARSED_PRESCRIPTIONS,
  unparsedPrescription,
} from '../check-doc-expression-carriage.mjs';
import {
  APP_DOCS as TYPES_APP_DOCS,
  appDocsDirs as typesAppDocsDirs,
  PACKAGE_READMES as TYPES_PACKAGE_READMES,
  packageReadmePages as typesPackageReadmePages,
  ROOT_PAGES as TYPES_ROOT_PAGES,
} from '../check-doc-component-types.mjs';
import { parseJsonFence } from '../check-skill-examples.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
const GATE = 'scripts/check-doc-expression-carriage.mjs';

/**
 * objectui#7851. `check-doc-component-types` judges the `type` literal of a json
 * fence and says so in its own header — "NOT in scope, deliberately: whether the
 * snippet's OTHER keys are read by the renderer the type resolves to" — and
 * `check-doc-snippet-types` compiles the ts/tsx blocks only. So the json fence
 * BODIES were read by nothing, and a whole class of defect (objectui#7418,
 * #7440, #7444, #7838) reached `main` under green gates every time.
 *
 * The gate this file pins is REPORT-ONLY by ruling: three members of that class
 * are open, and a blocking gate would go red on other people's cards the day it
 * landed. That posture is the first thing asserted here, because it is the thing
 * a later edit could quietly reverse.
 *
 * The second is that the instrument can SEE. A census that runs, goes green and
 * looked at nothing is the counterfeit this shape of gate produces most easily
 * (objectstack#4928, objectui#4690), so the controls are exercised in both
 * directions AND sabotaged — a control that cannot fail is not a control.
 */
describe('check-doc-expression-carriage: the evaluated-channel universe is derived, not typed', () => {
  const channels = deriveChannels(ROOT);

  it('reads the three channel shapes off SchemaRenderer’s own call sites', () => {
    expect(channels.direct).toEqual(['content']);
    expect(channels.bags).toEqual(['properties', 'props']);
  });

  /**
   * The enumeration and the reading come from DIFFERENT places on purpose
   * (AGENTS.md §9's rule for exactly this): the gate derives the condition keys
   * from the `evaluate*Predicate(newSchema.<key>, …)` CALL SITES, and this test
   * checks that answer against the two `const` ARRAYS the same file declares for
   * the visibility chain. A single source read twice proves nothing.
   */
  it('agrees with the renderer’s own VISIBILITY_* declarations', () => {
    const source = fs.readFileSync(path.join(ROOT, RENDERER_SOURCE), 'utf8');
    const declared = (name: string): string[] => {
      const literal = source.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`))?.[1];
      expect(literal, `${RENDERER_SOURCE} must still declare \`${name}\` as an array literal`).toBeDefined();
      return [...literal!.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    };
    const visibility = [...declared('VISIBILITY_SHOW_KEYS'), ...declared('VISIBILITY_HIDE_KEYS')];
    // Five: the page component's `visibility` leg was retired (objectui#12654).
    expect(visibility.length).toBe(5);
    for (const key of visibility) expect(channels.conditions).toContain(key);
    // The enablement pair is not in either array — it routes through
    // `evaluateEnablementPredicate`, which is why the gate reads call sites at all.
    expect(channels.conditions).toContain('disabled');
    expect(channels.conditions).toContain('disabledOn');
    expect(channels.conditions.length).toBe(7);
  });

  it('refuses to census against a guessed universe when the renderer is missing', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'carriage-noren-'));
    expect(() => deriveChannels(empty)).toThrow(/cannot be derived/);
    fs.rmSync(empty, { recursive: true, force: true });
  });

  it('refuses when the call sites it reads have been renamed away', () => {
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'carriage-renamed-'));
    fs.mkdirSync(path.join(fake, path.dirname(RENDERER_SOURCE)), { recursive: true });
    fs.writeFileSync(
      path.join(fake, RENDERER_SOURCE),
      '// no evaluate call sites at all, only prose naming visibleOn and properties\n',
    );
    expect(() => deriveChannels(fake)).toThrow(/matched nothing/);
    fs.rmSync(fake, { recursive: true, force: true });
  });
});

describe('check-doc-expression-carriage: the carriage map comes from the built artifact', () => {
  it('reads expressionBindableTextKeysFor out of the installed spec', async () => {
    const carriage = await loadCarriage();
    // The rows objectui#7418 measured, re-read here rather than copied from its
    // table: `badge` carrying NOTHING is what makes `badge.text` a finding.
    expect(carriage.keysFor('card')).toEqual(expect.arrayContaining(['title', 'description']));
    expect(carriage.keysFor('badge')).toEqual([]);
    expect(carriage.keysFor('progress')).toEqual([]);
    expect(carriage.version).toMatch(/^\d+\./);
  });
});

describe('check-doc-expression-carriage: the controls can see, and can fail', () => {
  it('reports the objectui#7418 badge site and stays silent on a clean node', async () => {
    const carriage = await loadCarriage();
    const controls = runControls({ channels: deriveChannels(ROOT), carriage });
    expect(controls.failures).toEqual([]);
    expect(controls.positive).toEqual(['text', 'variant']);
    expect(controls.negative).toEqual([]);
  });

  it('fails when the carriage map is widened until the defect disappears', async () => {
    const carriage = { version: 'sabotaged', keysFor: () => ['text', 'variant'] };
    const controls = runControls({ channels: deriveChannels(ROOT), carriage });
    expect(controls.failures.join('\n')).toMatch(/positive control/);
  });

  it('fails when a carried channel is dropped and the clean node starts reporting', async () => {
    const carriage = await loadCarriage();
    const real = deriveChannels(ROOT);
    const crippled = { ...real, all: real.all.filter((key) => key !== 'visibleOn') };
    const controls = runControls({ channels: crippled, carriage });
    expect(controls.failures.join('\n')).toMatch(/negative control/);
  });

  it('keeps the positive fixture a real pre-repair site, not a synthetic one', () => {
    // If this fixture ever stops spelling `badge` + `text`, the control is no
    // longer the objectui#7418 site and the header's claim goes stale.
    expect(CONTROL_FIXTURES.positive).toContain('"type": "badge"');
    expect(CONTROL_FIXTURES.positive).toContain('"text"');
  });

  /**
   * objectui#8334 — the DIALECT controls, both directions.
   *
   * The positive proves the leg can see a node tree spelled as a JS object
   * literal. The negative proves it still refuses a TS `interface` body, which is
   * what the great majority of these pages' ```plaintext fences hold: a leg that
   * accepted those would flood the coverage line with type DECLARATIONS and be
   * useless in the opposite direction.
   */
  it('sees the object-literal fixture and stays silent on a TS interface body', async () => {
    const controls = runControls({ channels: deriveChannels(ROOT), carriage: await loadCarriage() });
    expect(controls.failures).toEqual([]);
    expect(controls.dialectPositive).toEqual(['filter-ui', 'text']);
    expect(controls.dialectNegative).toEqual([]);
  });

  /**
   * ⭐ The regression itself, pinned as a DIFFERENCE rather than described: run
   * the OLD predicate — a strict `parseFence` — over the very fixture the corpus
   * supplied, and it sees nothing. That silent nothing is what the summary used
   * to print `✅ Dialect blind spot: none` on top of.
   */
  it('is a leg that CAN fail: the pre-objectui#8334 predicate is blind to this fixture', () => {
    const before = parseFence(CONTROL_FIXTURES.dialectPositive);
    expect(before.ok, 'the object-literal fixture must NOT parse as strict JSON').toBe(false);
    expect(before.values.flatMap((value: unknown) => collectNodes(value))).toEqual([]);

    const after = parseFenceDialect(CONTROL_FIXTURES.dialectPositive);
    expect(after.ok).toBe(true);
    expect(after.values.flatMap((value: unknown) => collectNodes(value)).map((n: { type: string }) => n.type)).toEqual([
      'filter-ui',
      'text',
    ]);
  });

  it('keeps the dialect fixtures the shapes the corpus actually uses', () => {
    // Unquoted key + single-quoted value: the spelling the five measured pages use.
    expect(CONTROL_FIXTURES.dialectPositive).toContain("type: 'filter-ui'");
    // ...and the negative must stay a TS declaration, or it stops excluding anything.
    expect(CONTROL_FIXTURES.dialectNegative).toContain('interface');
    expect(CONTROL_FIXTURES.dialectNegative).toContain('type: ');
  });
});

describe('check-doc-expression-carriage: the parse surface', () => {
  // These are the `jsonc` tolerances. Since objectui#10943 a `json` fence gets
  // none of them; the next describe block pins that half.
  const parse = (body: string) => parseFence(body, 'jsonc');

  it('drops comments outside strings and keeps a // that is data', () => {
    const out = parse('{ "type": "text", // a note\n  "content": "https://example.com" }');
    expect(out.ok).toBe(true);
    expect(out.values[0]).toEqual({ type: 'text', content: 'https://example.com' });
  });

  it('re-escapes the raw newlines these pages write inside ${…}', () => {
    const out = parse('{\n "type": "text",\n "content": "${ a\n  ? 1\n  : 2 }"\n}');
    expect(out.ok).toBe(true);
    expect(out.values[0].content).toContain('${');
  });

  it('tolerates trailing commas', () => {
    expect(parse('{ "type": "text", "content": "x", }').ok).toBe(true);
  });

  it('tolerates the three elision spellings, and keeps a dotted VALUE', () => {
    expect(parse('{ "type": "form", "fields": [...] }').ok).toBe(true);
    expect(parse('{ "type": "form", "fields": […] }').ok).toBe(true);
    const strung = parse('{ "type": "div", "children": [ { "type": "kanban", "..." } ] }');
    expect(strung.ok).toBe(true);
    const value = parse('{ "type": "input", "placeholder": "..." }');
    expect(value.ok).toBe(true);
    expect(value.values[0].placeholder).toBe('...');
  });

  it('splits a fence holding several top-level objects', () => {
    const out = parse('{ "type": "a" }\n\n{ "type": "b" }');
    expect(out.ok).toBe(true);
    expect(out.values).toHaveLength(2);
  });

  it('retries an object BODY wrapped in braces', () => {
    const out = parse('"dependencies": {\n  "@object-ui/plugin-x": "workspace:*"\n}');
    expect(out.ok).toBe(true);
    expect(out.wrapped).toBe(true);
  });

  it('reports a fence it cannot read instead of silently dropping it', () => {
    const out = parse('{ "type": "text"');
    expect(out.ok).toBe(false);
    expect(out.reason).toBeTruthy();
  });

  it('never invents a key: sanitizing only removes non-data', () => {
    const body = '{ "type": "badge", "label": "a//b", "variant": "x" }';
    expect(Object.keys(JSON.parse(sanitizeFence(body)))).toEqual(['type', 'label', 'variant']);
    expect(splitTopLevel(sanitizeFence(body)).values).toHaveLength(1);
  });

  it('finds a node wherever it sits, including inside a bag', () => {
    const nodes = collectNodes({ type: 'page', properties: { child: { type: 'badge' } } });
    expect(nodes.map((n) => n.type)).toEqual(['page', 'badge']);
  });

  /**
   * objectui#8334 — `toJsonDialect`, the object-literal normalization. It is a
   * REMOVAL of dialect and ⛔ must never be able to invent a member: the
   * blind-spot list it feeds is read as a coverage figure, and an invented key
   * would inflate it with fences that hold no node at all.
   */
  it('quotes a bare key and re-spells a single-quoted string, inventing nothing', () => {
    const parsed = JSON.parse(toJsonDialect("{ type: 'badge', label: 'a', variant: 'x' }"));
    expect(Object.keys(parsed)).toEqual(['type', 'label', 'variant']);
    expect(parsed).toEqual({ type: 'badge', label: 'a', variant: 'x' });
  });

  it('quotes an identifier only in a MEMBER position, so `type: string` stays unparseable', () => {
    // A TS interface body: `string` is a value-position identifier and must NOT
    // be quoted, or every type declaration in the corpus becomes a "node".
    expect(parseFenceDialect('interface P {\n  type: string;\n}').ok).toBe(false);
    expect(parseFenceDialect("{ kind: 'a', mode: 'b' }").ok).toBe(true);
  });

  it('survives an apostrophe inside a comment, which would otherwise open a string', () => {
    const parsed = parseFenceDialect("{\n  // don't let this open a string\n  type: 'badge'\n}");
    expect(parsed.ok).toBe(true);
    expect(parsed.values).toEqual([{ type: 'badge' }]);
  });

  it('keeps a `//` and a quote that are DATA inside a string', () => {
    // A raw `"` inside a single-quoted string, and a `//` that is a URL. The
    // normalization must escape the first and leave the second alone.
    const parsed = parseFenceDialect(`{ type: 'link', href: 'https://a.example', note: 'he said "hi"' }`);
    expect(parsed.ok).toBe(true);
    expect(parsed.values).toEqual([{ type: 'link', href: 'https://a.example', note: 'he said "hi"' }]);
  });

  it('leaves a strict-JSON body byte-identical — the normalization is a no-op on JSON', () => {
    const body = '{ "type": "badge", "label": "a//b" }';
    expect(toJsonDialect(body)).toBe(body);
  });
});

/**
 * objectui#10943, ruled A on 2026-09-28. A `json` fence is parsed STRICTLY with
 * the skills tree's own `parseJsonFence`, and `jsonc` keeps the tolerances. The
 * maintainer granted this as a strength increase of ONE existing pin, 'has no
 * blind spot on the corpus it ships against', and not as a new gate.
 *
 * Every tolerance body below is pinned on BOTH tags: `json` must reject it and
 * `jsonc` must still parse it. If a later edit quietly sent `json` back through
 * `sanitizeFence`, the `jsonc` half would stay green and the `json` half would
 * go red. A pin needs both halves to see that regression.
 */
describe('check-doc-expression-carriage: `json` is strict, `jsonc` keeps the tolerances (objectui#10943)', () => {
  it('judges `json` with the skills tree’s own parseJsonFence, the same function and not a copy', () => {
    // Identity, not behavioural equality, for the reason the scan-surface pin
    // below gives for its constants: an import has nothing to drift.
    expect(requireJsonContract()).toBe(parseJsonFence);
  });

  it('parses a good `json` fence and hands its value on', () => {
    const out = parseFence('{\n  "type": "text",\n  "content": "${user.name}"\n}', 'json');
    expect(out).toEqual({
      ok: true,
      reason: null,
      values: [{ type: 'text', content: '${user.name}' }],
      wrapped: false,
    });
  });

  // One body per tolerance the gate's header lists, plus the object-body retry
  // and the multi-document split. This census reads each of them under `jsonc`,
  // and none of them is JSON.
  const notJson: Array<[string, string]> = [
    ['a line comment', '{\n  // a note\n  "type": "text"\n}'],
    ['a block comment', '{ /* a note */ "type": "text" }'],
    ['a raw newline inside a string', '{ "type": "text", "content": "${ a\n  ? 1 : 2 }" }'],
    ['a trailing comma', '{ "type": "text", "content": "x", }'],
    ['an elision', '{ "type": "form", "fields": [...] }'],
    ['an object BODY', '"dependencies": {\n  "@object-ui/plugin-x": "workspace:*"\n}'],
    ['two top-level documents', '{ "type": "a" }\n\n{ "type": "b" }'],
  ];

  it.each(notJson)('rejects %s under `json` with the contract’s own error, and reads it under `jsonc`', (_label, body) => {
    const error = parseJsonFence(body, 'json');
    expect(error, 'the contract itself must reject this body, or this row is not about the contract').not.toBeNull();

    const strict = parseFence(body, 'json');
    expect(strict).toEqual({ ok: false, reason: `invalid-json: ${error}`, values: [], wrapped: false });

    expect(parseFence(body, 'jsonc').ok).toBe(true);
  });

  it('parses a good `jsonc` fence carrying a comment', () => {
    const out = parseFence('{\n  // Preview settings\n  "objectui.preview.port": 3000,\n}', 'jsonc');
    expect(out.ok).toBe(true);
    expect(out.values).toEqual([{ 'objectui.preview.port': 3000 }]);
  });

  it('prescribes the ruled remedy for `json`, and keeps the blind-spot remedy for every other language', () => {
    expect(UNPARSED_PRESCRIPTIONS.json).toContain('retag as `jsonc` if the example needs comments or trailing commas');
    expect(unparsedPrescription('json')).toBe(UNPARSED_PRESCRIPTIONS.json);
    expect(unparsedPrescription('jsonc')).toBe(UNPARSED_PRESCRIPTIONS.jsonc);
    expect(UNPARSED_PRESCRIPTIONS.jsonc).toContain('sanitizeFence');
  });

  /**
   * The census on a throwaway tree: a good `json` fence, the SAME annotated body
   * once as `json` and once as `jsonc`. Only the `json` copy may land on the
   * unparsed list. The entry must name the file, the fence's opening line, the
   * language and the contract's own parse error. The CLI stays report-only (exit
   * 0) and prints the ruled remedy.
   */
  it('names file, fence line, language and parse error, and the CLI prints the `jsonc` retag remedy', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'carriage-strict-'));
    const page = `${DOCS_ROOT}/guide/fences.md`;
    const annotated = ['{', '  // VS Code settings are JSONC', '  "objectui.preview.port": 3000', '}'];
    fs.mkdirSync(path.join(root, DOCS_ROOT, 'guide'), { recursive: true });
    fs.writeFileSync(
      path.join(root, page),
      [
        '# Fences', // 1
        '', // 2
        '```json', // 3
        '{ "type": "text", "content": "ok" }',
        '```',
        '',
        '```json', // 7: the one that must land on the list
        ...annotated,
        '```',
        '',
        '```jsonc',
        ...annotated,
        '```',
        '',
      ].join('\n'),
    );

    const census = analyze(root, { channels: deriveChannels(ROOT), carriage: await loadCarriage() });
    expect(census.counters.fences).toBe(3);
    expect(census.counters.parsed).toBe(2);
    expect(census.unparsed).toEqual([
      { file: page, line: 7, lang: 'json', reason: `invalid-json: ${parseJsonFence(annotated.join('\n'), 'json')}` },
    ]);

    const run = spawnSync(process.execPath, [GATE, '--root', root], { cwd: ROOT, encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain(`${page}:7  (json)  invalid-json: `);
    expect(run.stdout).toContain(UNPARSED_PRESCRIPTIONS.json);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

/**
 * objectui#7878 — the scan surface.
 *
 * This census landed (PR objectui#7868) pointed at `content/docs` alone, while its
 * two sibling doc gates had already been widened onto the per-app docs trees
 * (objectui#6600) and the root pages (objectui#7115). That is the objectui#7115
 * geometry rebuilt one gate over, and objectui#7115 is the card where the root
 * `README.md` — the repository's most-read authored page — taught an unregistered
 * component type four times for as long as the example existed, for exactly one
 * reason: nothing read the file.
 *
 * ⚠️ The card's own premise was WRONG about the destination and was corrected
 * before dispatch: it expected the widening to reach `docs/ARCHITECTURE.md`
 * (objectui#7838's site). It does not. `check-doc-component-types` names `docs/**`
 * in its exclusions, so the repository-root `docs/` tree is in NO gate's walk —
 * objectui#7856's open question, deliberately not answered here.
 *
 * ⚠️ Widening a scan surface is the change that can be GREEN ABOUT NOTHING, so
 * the surface is pinned as an EQUALITY against the gate it is supposed to match,
 * and every leg of the walk is separately proven to reach a file.
 */
describe('check-doc-expression-carriage: the scan surface is check:doc-types’, by import', () => {
  it('holds the other gate’s constants themselves, not equal copies of them', () => {
    // Identity, not `toEqual`. Three gates carry COPIES of these constants for a
    // stated reason that does not apply here (`check-doc-snippet-types` pulls in
    // `typescript` at load; `check-doc-fence-languages` must run with no install),
    // and `check-doc-fence-languages.test.ts` pins those three against each other.
    // A fourth copy would need a fourth row in that pin; an import needs none,
    // because there is nothing to drift.
    expect(APP_DOCS).toBe(TYPES_APP_DOCS);
    expect(ROOT_PAGES).toBe(TYPES_ROOT_PAGES);
    expect(appDocsDirs).toBe(typesAppDocsDirs);
    // objectui#7896's fourth leg, landed by objectui#8115.
    expect(PACKAGE_READMES).toBe(TYPES_PACKAGE_READMES);
    expect(packageReadmePages).toBe(typesPackageReadmePages);
  });

  /**
   * `DOCS_ROOT` is the one leg this file still spells, because
   * `check-doc-component-types.mjs` declares it `const` rather than `export const`
   * and this card's file surface does not extend to that file. So it is pinned
   * against that file's SOURCE TEXT — the enumeration and the reading come from
   * different places, which is the only shape of pin that can fail.
   */
  it('spells DOCS_ROOT exactly as check:doc-types declares it', () => {
    const source = fs.readFileSync(path.join(ROOT, 'scripts/check-doc-component-types.mjs'), 'utf8');
    const declared = source.match(/^const DOCS_ROOT = '([^']+)';$/m)?.[1];
    expect(declared, 'check-doc-component-types.mjs must still declare DOCS_ROOT as a string const').toBeDefined();
    expect(DOCS_ROOT).toBe(declared);
  });

  it('walks exactly the document set that surface names — no more, no less', async () => {
    const census = analyze(ROOT, { channels: deriveChannels(ROOT), carriage: await loadCarriage() });

    // Rebuilt here from the constants rather than read off the gate, so the two
    // sides of the comparison are not one source read twice.
    const isDoc = (f: string) => f.endsWith('.md') || f.endsWith('.mdx');
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of fs.readdirSync(dir).sort()) {
        if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
        const abs = path.join(dir, entry);
        if (fs.statSync(abs).isDirectory()) walk(abs, out);
        else if (isDoc(entry)) out.push(path.relative(ROOT, abs).split(path.sep).join('/'));
      }
      return out;
    };
    const expected = walk(path.join(ROOT, DOCS_ROOT));
    for (const dir of typesAppDocsDirs(ROOT)) expected.push(...walk(dir));
    // ⚠️ Rebuilt from the leg's own enumerator, in the slot the gate appends it
    // in. This is the comparison objectui#7896's leg had to reach BOTH sides of:
    // the pin is CONSTANTS versus this census's walk, so a leg added to
    // `check-doc-component-types.mjs` alone would move neither and stay green
    // while the two surfaces diverged.
    expected.push(
      ...typesPackageReadmePages(ROOT).map((abs: string) => path.relative(ROOT, abs).split(path.sep).join('/')),
    );
    expected.push(...TYPES_ROOT_PAGES.filter((name) => fs.existsSync(path.join(ROOT, name))));

    expect([...census.documents].sort()).toEqual([...expected].sort());
  });

  /**
   * Each leg separately, because the equality above would still pass if two legs
   * resolved to the same empty set. A leg that reaches nothing is a surface that
   * shrank silently, which is objectui#7115's defect exactly.
   */
  it('reaches every leg of the walk: the guide tree, the app docs trees, the package READMEs, the root pages', async () => {
    const census = analyze(ROOT, { channels: deriveChannels(ROOT), carriage: await loadCarriage() });
    const documents: string[] = census.documents;

    expect(documents.filter((f) => f.startsWith(`${DOCS_ROOT}/`)).length).toBeGreaterThan(100);

    const appDirs = appDocsDirs(ROOT).map((abs: string) => path.relative(ROOT, abs).split(path.sep).join('/'));
    expect(appDirs, `no ${APP_DOCS.dir}/*/${APP_DOCS.subdir} tree exists, so that leg pins nothing`).not.toEqual([]);
    for (const dir of appDirs) {
      expect(documents.some((f) => f.startsWith(`${dir}/`)), `${dir} contributed no document`).toBe(true);
    }

    const packageReadmes = documents.filter((f) => /^packages\/[^/]+\/README\.md$/.test(f));
    expect(
      packageReadmes.length,
      'no package README reached this census — objectui#7896’s leg stopped being walked',
    ).toBeGreaterThan(10);

    for (const name of ROOT_PAGES) expect(documents).toContain(name);
  });

  it('names the surface it walked in the summary it prints', () => {
    expect(SURFACE_LABEL).toContain(DOCS_ROOT);
    expect(SURFACE_LABEL).toContain(`${APP_DOCS.dir}/*/${APP_DOCS.subdir}`);
    expect(SURFACE_LABEL).toContain(`${PACKAGE_READMES.dir}/*/${PACKAGE_READMES.name}`);
    for (const name of ROOT_PAGES) expect(SURFACE_LABEL).toContain(name);
    // ⛔ No angle-bracket placeholder: this line is quoted into pull-request bodies
    // and issue comments, and GitHub's body sanitizer eats tag-shaped fragments.
    expect(SURFACE_LABEL).not.toMatch(/[<>]/);

    const out = execFileSync(process.execPath, [GATE], { cwd: ROOT, encoding: 'utf8' });
    expect(out).toContain(`file(s) across ${SURFACE_LABEL}`);
  });
});

describe('check-doc-expression-carriage: the census on a fixture tree', () => {
  /** The same known defect, one copy on each leg of the walk. */
  const defect = ['```json', '{', '  "type": "badge",', '  "text": "${status}"', '}', '```', ''];

  /**
   * A throwaway tree with a page on EVERY leg of the scan surface: the guide tree,
   * an `apps/<app>/docs` tree, and a root page. One defective page per leg plus one
   * clean page, so a leg that stops being walked costs a finding rather than
   * nothing — objectui#7878.
   *
   * ⚠️ A fixture tree deliberately has no root README of its own beyond the one
   * written here: `listDocuments` DROPS an absent root page so a throwaway tree
   * stays scannable, which is the same bargain `check-doc-component-types.scanDocs`
   * strikes. That is what makes the root-page leg testable at all, and it is also
   * why the real-tree reach pin above exists.
   */
  function fixtureTree(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'carriage-docs-'));
    const docs = path.join(root, DOCS_ROOT, 'guide');
    fs.mkdirSync(docs, { recursive: true });
    fs.writeFileSync(path.join(docs, 'bad.md'), ['# Bad', '', ...defect].join('\n'));
    fs.writeFileSync(
      path.join(docs, 'clean.md'),
      [
        '# Clean',
        '',
        '```json',
        '{',
        '  "type": "card",',
        '  "title": "${item.name}",',
        '  "visibleOn": "${item.active}"',
        '}',
        '```',
        '',
        '```tsx',
        'const x: string = `${notJson}`;',
        '```',
        '',
      ].join('\n'),
    );
    const appDocs = path.join(root, APP_DOCS.dir, 'console', APP_DOCS.subdir);
    fs.mkdirSync(appDocs, { recursive: true });
    fs.writeFileSync(path.join(appDocs, 'guide.md'), ['# App', '', ...defect].join('\n'));
    fs.writeFileSync(path.join(root, ROOT_PAGES[0]), ['# Root', '', ...defect].join('\n'));
    return root;
  }

  it('names the defective site on every leg and says nothing about the clean page', async () => {
    const root = fixtureTree();
    const census = analyze(root, { channels: deriveChannels(ROOT), carriage: await loadCarriage() });
    expect(census.counters.files).toBe(4);
    expect(census.counters.fences).toBe(4); // the tsx block is not this gate's surface
    expect(census.counters.unparsed).toBe(0);
    expect(census.sites).toHaveLength(3);
    expect(census.sites.map((site: { file: string }) => site.file).sort()).toEqual(
      [`${APP_DOCS.dir}/console/${APP_DOCS.subdir}/guide.md`, ROOT_PAGES[0], `${DOCS_ROOT}/guide/bad.md`].sort(),
    );
    expect(census.sites.every((site: { type: string; key: string }) => site.type === 'badge' && site.key === 'text')).toBe(
      true,
    );
    expect(census.sites.find((site: { file: string }) => site.file === `${DOCS_ROOT}/guide/bad.md`)).toMatchObject({
      line: 6,
    });
    fs.rmSync(root, { recursive: true, force: true });
  });

  /**
   * The sabotage, on the population rather than on a channel: drop the two new
   * legs and the two new findings must disappear. ⛔ A control that cannot fail is
   * not a control — this one fails the moment the walk stops reaching a leg, which
   * is the only way this card's change can be green about nothing.
   */
  it('loses exactly the new legs’ findings when those trees are removed', async () => {
    const root = fixtureTree();
    const args = { channels: deriveChannels(ROOT), carriage: await loadCarriage() };
    expect(analyze(root, args).sites).toHaveLength(3);

    fs.rmSync(path.join(root, APP_DOCS.dir), { recursive: true, force: true });
    fs.rmSync(path.join(root, ROOT_PAGES[0]), { force: true });

    const narrowed = analyze(root, args);
    expect(narrowed.counters.files).toBe(2);
    expect(narrowed.sites).toHaveLength(1);
    expect(narrowed.sites[0]).toMatchObject({ file: `${DOCS_ROOT}/guide/bad.md` });
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('lists the documents it walked, in walk order: guide tree, app docs, root pages', () => {
    const root = fixtureTree();
    expect(listDocuments(root).map((abs: string) => path.relative(root, abs).split(path.sep).join('/'))).toEqual([
      `${DOCS_ROOT}/guide/bad.md`,
      `${DOCS_ROOT}/guide/clean.md`,
      `${APP_DOCS.dir}/console/${APP_DOCS.subdir}/guide.md`,
      ROOT_PAGES[0],
    ]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('check-doc-expression-carriage: the real tree, and the posture', () => {
  it('is looking at something — a vacuity guard, not a snapshot', async () => {
    const census = analyze(ROOT, { channels: deriveChannels(ROOT), carriage: await loadCarriage() });
    expect(census.counters.fences).toBeGreaterThan(100);
    expect(census.counters.nodes).toBeGreaterThan(100);
    // ⛔ Deliberately NOT asserted: how many findings there are. That number moves
    // with every card in this class, and pinning it here would make this gate
    // blocking through the back door — the exact thing the ruling forbade.
  });

  /**
   * objectui#10943 strengthened this pin and added no gate. A `json` fence that
   * is not JSON now lands on `census.unparsed`, so this assertion is what reds
   * the pull request that adds one. The list holds two different things, so the
   * message gives the remedy for each language actually on it. The text comes
   * from the same constant the CLI prints.
   */
  it('has no blind spot on the corpus it ships against', async () => {
    const census = analyze(ROOT, { channels: deriveChannels(ROOT), carriage: await loadCarriage() });
    const langs: string[] = [...new Set<string>(census.unparsed.map((fence: { lang: string }) => fence.lang))];
    const remedies = langs.map((lang) =>
      lang === 'json'
        ? `A \`json\` fence here is NOT JSON — a docs defect, not a blind spot: ${unparsedPrescription(lang)}.`
        : `A \`${lang}\` fence here is one this gate says NOTHING about — the size of its blind spot, ` +
          `not a docs rule: ${unparsedPrescription(lang)}.`,
    );
    expect(census.unparsed, remedies.join(' ')).toEqual([]);
  });

  /**
   * The language SET is a blind spot of its own, and it has already bitten: three
   * teaching blocks in `guide/record-edit-modes.md` are fenced ```jsonc, and a
   * gate reading ```json alone cannot see that page at all — found by a human
   * reading it, which is the detection mechanism this whole card replaces.
   */
  it('reads jsonc as well as json, and covers the page that proved it necessary', async () => {
    expect(JSON_FENCE_LANGUAGES).toContain('json');
    expect(JSON_FENCE_LANGUAGES).toContain('jsonc');
    const census = analyze(ROOT, { channels: deriveChannels(ROOT), carriage: await loadCarriage() });
    const jsonc = census.languages.find((row: { lang: string }) => row.lang === 'jsonc');
    expect(jsonc, 'the corpus must still hold jsonc fences for this pin to mean anything').toBeDefined();
    expect(jsonc!.fences).toBeGreaterThan(0);
    expect(jsonc!.unparsed).toBe(0);
    const page = census.fences.filter(
      (fence: { file: string }) => fence.file === `${DOCS_ROOT}/guide/record-edit-modes.md`,
    );
    expect(page.length, 'record-edit-modes.md must be inside this census').toBeGreaterThan(0);
    expect(page.every((fence: { lang: string; ok: boolean }) => fence.lang === 'jsonc' && fence.ok)).toBe(true);
  });

  /**
   * objectui#8334. ⚠️ This pin used to read `expect(census.unscannedJsonLike).toEqual([])`
   * — and it PASSED, for the worst possible reason: the leg it pinned required a
   * strict JSON parse, so an entire dialect was invisible to it and the empty
   * list was a blindness rather than a clean corpus.
   *
   * ⛔ Its failure message was worse than the pin. It instructed the next reader
   * to "Widen `JSON_FENCE_LANGUAGES` deliberately" — the one fix PR objectui#8324
   * REJECTED by content, because `plaintext` is not a JSON dialect and admitting
   * it lets every future JSON-in-plaintext block through unjudged. A defect
   * reasoned from written prose reproduces itself while the prose stands, so the
   * prose is corrected here and not only in the gate.
   *
   * What replaces it is the opposite shape: a FLOOR proving the measurement can
   * see the class, ⛔ per file rather than one summed total — a summed floor
   * cannot tell "every page still measured" from "one page the matcher quietly
   * stopped matching, and another that grew two blocks".
   */
  it('SEES the JS object-literal dialect the coverage line used to lie about', async () => {
    const census = analyze(ROOT, { channels: deriveChannels(ROOT), carriage: await loadCarriage() });
    const literals = census.unscannedJsonLike.filter(
      (fence: { dialect: string }) => fence.dialect === 'object-literal',
    );
    // ⛔ Per file. Each of the five the card measured must still be SEEN; a zero
    // on any one of them is the blindness this card exists to remove, and the
    // summary would print `none` over it again.
    for (const file of [
      `${DOCS_ROOT}/components/complex/filter-ui.mdx`,
      `${DOCS_ROOT}/components/complex/sort-ui.mdx`,
      `${DOCS_ROOT}/components/complex/view-switcher.mdx`,
      `${DOCS_ROOT}/components/feedback/toaster.mdx`,
      `${DOCS_ROOT}/components/navigation/header-bar.mdx`,
    ]) {
      expect(
        literals.filter((fence: { file: string }) => fence.file === file).length,
        `${file} authors a node tree as a JS object literal in an unscanned fence. The blind-spot ` +
          'measurement must REPORT it. If this page was legitimately retagged ```json, it has moved ' +
          'into the judged population — drop it from this list; do NOT delete the list.',
      ).toBeGreaterThan(0);
    }
    // ⛔ NOT an equality on the total: that number moves with every docs page and
    // pinning it would make a report-only gate blocking through the back door.
    // A floor is what distinguishes a measurement from a snapshot.
    expect(
      literals.length,
      'the object-literal leg reported nothing at all on a corpus that demonstrably holds this ' +
        'dialect — the leg has stopped matching and its zero is not readable.',
    ).toBeGreaterThanOrEqual(5);
  });

  /**
   * Triage's binding fence on objectui#8334, pinned mechanically rather than
   * trusted: ⛔ "Do not fix this by widening the census." The blind-spot leg is a
   * MEASUREMENT; if it ever starts feeding the judged population, this goes red.
   */
  it('judges exactly what it judged before the dialect leg existed', async () => {
    const census = analyze(ROOT, { channels: deriveChannels(ROOT), carriage: await loadCarriage() });
    expect(
      JSON_FENCE_LANGUAGES,
      '⛔ `plaintext` is not a JSON dialect. Admitting it lets every future JSON-in-plaintext block ' +
        'through UNJUDGED — rejected by content on PR objectui#8324, and the exact blind spot this ' +
        'gate exists to close.',
    ).not.toContain('plaintext');
    // Every fence the census counted is in a scanned language, and every fence in
    // the blind-spot list is NOT. The two sets are disjoint by construction, and
    // that disjointness is the whole of triage's fence.
    const judged = new Set(census.fences.map((fence: { lang: string }) => fence.lang));
    expect([...judged].sort()).toEqual([...JSON_FENCE_LANGUAGES].sort());
    for (const fence of census.unscannedJsonLike) {
      expect(JSON_FENCE_LANGUAGES).not.toContain(fence.lang);
    }
  });

  it('reports the strict-JSON and object-literal spellings as distinguishable dialects', async () => {
    const census = analyze(ROOT, { channels: deriveChannels(ROOT), carriage: await loadCarriage() });
    for (const fence of census.unscannedJsonLike) {
      expect(['json', 'object-literal']).toContain(fence.dialect);
    }
  });

  /**
   * objectui#7878 re-arms both sabotage directions against the WIDENED population
   * rather than carrying PR objectui#7868's readings forward. The fixture controls
   * above prove the instrument can see a planted defect; these prove the same on
   * the corpus this gate actually ships against, where a silently narrowed
   * universe would turn correct documentation into findings.
   *
   * ⛔ Neither pins a finding COUNT — that number moves with every card in this
   * class and pinning it would make this gate blocking through the back door. Both
   * are RELATIVE: sabotage the universe, and the census must report strictly more.
   */
  it('still notices a dropped channel on the widened corpus', async () => {
    const carriage = await loadCarriage();
    const real = deriveChannels(ROOT);
    const honest = analyze(ROOT, { channels: real, carriage });

    for (const key of ['visibleOn', 'content']) {
      const crippled = { ...real, all: real.all.filter((k: string) => k !== key) };
      const sabotaged = analyze(ROOT, { channels: crippled, carriage });
      expect(
        sabotaged.sites.length,
        `dropping \`${key}\` from the evaluated channels changed nothing on the widened corpus, so ` +
          'this control cannot fail and the census would not notice the renderer losing that leg.',
      ).toBeGreaterThan(honest.sites.length);
    }
  });

  it('still notices an emptied carriage map on the widened corpus', async () => {
    const real = deriveChannels(ROOT);
    const honest = analyze(ROOT, { channels: real, carriage: await loadCarriage() });
    const emptied = analyze(ROOT, { channels: real, carriage: { version: 'sabotaged', keysFor: () => [] } });
    expect(
      emptied.sites.length,
      'emptying `expressionBindableTextKeysFor` changed nothing, so the carriage half of the universe ' +
        'is not reaching the judgement at all.',
    ).toBeGreaterThan(honest.sites.length);
  });

  it('is REPORT-ONLY: exit 0 on the real tree even with findings', () => {
    const run = spawnSync(process.execPath, [GATE], { cwd: ROOT, encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('Controls pass');
    expect(run.stdout).toContain('Report-only');
    // The findings themselves go to stdout, never stderr: nothing downstream
    // should be able to read them as a failure.
    expect(run.stderr).toBe('');
  });

  it('is LOUD when the instrument itself is broken', () => {
    // A copy of the gate with no repo under it: no renderer to derive channels
    // from and no installed spec to read the carriage map out of. Either way the
    // answer must be exit 1 — report-only declines to fail on FINDINGS, never on
    // having looked at nothing.
    const orphan = fs.mkdtempSync(path.join(os.tmpdir(), 'carriage-orphan-'));
    fs.mkdirSync(path.join(orphan, 'scripts'));
    // Four files, not two: objectui#7878 made the gate IMPORT its scan surface
    // from `check-doc-component-types.mjs` rather than carry a fourth copy of it,
    // and objectui#9194 made both gates IMPORT the opening-fence predicate from
    // `markdown-fence-scan.mjs` rather than carry a copy each, so the orphan needs
    // those modules for the imports to resolve at all. If this list ever falls
    // behind the gate's imports the failure is a module-resolution stack trace
    // rather than the message below, which is why the message is asserted and not
    // merely the exit code. `check-skill-examples.mjs` is deliberately NOT copied:
    // objectui#10943's import of it is guarded, because it loads `typescript`, and
    // an orphan missing it must still reach the message below.
    for (const file of [
      'check-doc-expression-carriage.mjs',
      'check-doc-component-types.mjs',
      'invoked-as.mjs',
      'markdown-fence-scan.mjs',
    ]) {
      fs.copyFileSync(path.join(ROOT, 'scripts', file), path.join(orphan, 'scripts', file));
    }
    const run = spawnSync(process.execPath, ['scripts/check-doc-expression-carriage.mjs'], {
      cwd: orphan,
      encoding: 'utf8',
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('A failure, not a skip');
    fs.rmSync(orphan, { recursive: true, force: true });
  });

  it('runs the controls alone under --self-test', () => {
    const out = execFileSync(process.execPath, [GATE, '--self-test'], { cwd: ROOT, encoding: 'utf8' });
    expect(out).toContain('Controls pass');
    expect(out).not.toContain('Scanned');
  });
});

describe('check-doc-expression-carriage: the wiring', () => {
  it('is actually run by ci.yml — a gate nobody runs cannot be told from one that passes', () => {
    const ci = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toContain(`node ${GATE}`);
  });

  it('is named on the page that documents what CI runs', () => {
    const page = fs.readFileSync(path.join(ROOT, 'content/docs/guide/ci-cd-pipeline.md'), 'utf8');
    expect(page).toContain(GATE);
    // objectui#3653 pins the pairing by command; this asserts the page also says
    // the posture, because a row that reads like a guardrail when the step blocks
    // nothing is the objectui#3451 mistake.
    const row = page.split('\n').find((line) => line.startsWith('|') && line.includes(GATE));
    expect(row, 'the docs job row must name the gate').toBeDefined();
    expect(row!.toLowerCase()).toContain('report-only');
    // objectui#7878: the row named `content/docs/**` while the walk had widened.
    // A row that understates a gate's reach is the same defect one level up from
    // objectui#3451 — a page describing a guardrail that is not the one that runs.
    expect(row!).toContain(DOCS_ROOT);
    expect(row!).toContain(`${APP_DOCS.dir}/`);
    for (const name of ROOT_PAGES) expect(row!).toContain(name);
  });
});
