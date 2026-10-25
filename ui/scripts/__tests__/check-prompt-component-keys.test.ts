/**
 * objectui#8929 — a `**Keys:**` bullet in `.github/prompts/**` must teach keys
 * a REAL renderer answers, never keys the opt-in protocol placeholder answers.
 *
 * ## Why the obvious two pins are both worthless here
 *
 * The card that opened this gate found `view:kanban` and `view:gantt` on a
 * prompt bullet after both retired with the bare `kanban` / `gantt`
 * registrations. Two pins suggest themselves and neither would have held:
 *
 *   PIN THE TWO NAMES      a hand list that drifted once drifts again; the next
 *                          retirement is unpinned by construction.
 *   PIN AGAINST THE        `KNOWN_SCHEMA_TYPES` CONTAINS both retired keys —
 *   GENERATED KNOWN-TYPE   they are `PROTOCOL_COMPONENTS` members and
 *   LIST                   `registerPlaceholder` is a real `register(...)` call.
 *                          The pin would be green on the defect.
 *
 * So the mechanism under test is the PARTITION: the derived universe split into
 * the keys some non-placeholder site registers and the keys only the
 * placeholder module registers. Every case below drives it through the real
 * derivation over a throwaway tree, because a model of the partition would pass
 * against a partition that silently stopped partitioning.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helpers; types are inferred from the `.mjs` sources by
// `tsconfig.scripts.json` (`allowJs`). See objectui#3494.
import {
  PLACEHOLDER_NAMESPACE,
  PROMPT_DIR,
  analyze,
  lettered,
  letterRunFindings,
  partitionRegistry,
  placeholderSites,
  promptFiles,
  scanPromptKeys,
  scanPromptSections,
} from '../check-prompt-component-keys.mjs';
import { INDIRECT_REGISTRATIONS, deriveRegistryKeys } from '../check-doc-component-types.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = 'scripts/check-prompt-component-keys.mjs';

interface Finding {
  file: string;
  key: string;
  reason: string;
  text: string;
}

/** Builds a throwaway tree and runs the REAL derivation/scan over it. */
function withTree<T>(build: (write: (rel: string, contents: string) => void) => void, run: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-prompt-component-keys-'));
  const write = (rel: string, contents: string) => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  };
  try {
    build(write);
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** A fixture placeholder module shaped like the real one: a literal array and a
 *  helper that registers from it, so the derivation resolves it INDIRECTLY. */
const placeholderModule = (keys: string[]) =>
  [
    // The array is written multi-line on purpose: `literalArray` in the shared
    // derivation matches a collection that CLOSES on its own line, which is how
    // every real one in this repo is written.
    'const PROTOCOL_COMPONENTS = [',
    ...keys.map((k) => `  '${k}',`),
    '];',
    'function registerPlaceholder(type) {',
    `  ComponentRegistry.register(type, PlaceholderRenderer, { namespace: '${PLACEHOLDER_NAMESPACE}' });`,
    '}',
    'export function registerPlaceholders() { PROTOCOL_COMPONENTS.forEach(registerPlaceholder); }',
  ].join('\n');

const PLACEHOLDER_SITE = 'packages/components/src/renderers/placeholders.tsx';

/** The fixture's own declaration table — the thing the gate reads to learn
 *  which module the placeholders come from. */
const FIXTURE_TABLES = {
  exemptions: {},
  openRegistrationSites: {},
  indirectRegistrations: [
    {
      site: PLACEHOLDER_SITE,
      collection: 'PROTOCOL_COMPONENTS',
      kind: 'array',
      namespace: PLACEHOLDER_NAMESPACE,
      reason: 'fixture',
    },
  ],
};

const analyzeFixture = (dir: string) => analyze(dir, FIXTURE_TABLES) as { findings: Finding[]; counters: Record<string, number> };

// ── 1. the partition, which is the whole mechanism ───────────────────────────

describe('a key is authorable only when something OTHER than the placeholder registers it', () => {
  it('rejects a key the placeholder module alone registers — the defect, reproduced', () => {
    const { findings } = withTree((write) => {
      write(PLACEHOLDER_SITE, placeholderModule(['view:kanban', 'view:grid']));
      write(
        'packages/plugin-grid/src/index.tsx',
        "ComponentRegistry.register('grid', GridRenderer, { namespace: 'view' });",
      );
      write(`${PROMPT_DIR}/component.prompt.md`, '*   **Keys:** `view:grid`, `view:kanban`, etc.\n');
    }, analyzeFixture);

    expect(findings.map((f) => [f.key, f.reason])).toEqual([['view:kanban', 'placeholder-only-key']]);
  });

  it('accepts the same key once a real plugin registers it too', () => {
    // The control for the case above. Same prompt, same placeholder list; the
    // ONLY difference is a second, non-placeholder registration site. Without
    // this leg the case above would also pass against a gate that rejected
    // every `view:*` key, or every key at all.
    const { findings } = withTree((write) => {
      write(PLACEHOLDER_SITE, placeholderModule(['view:kanban', 'view:grid']));
      write(
        'packages/plugin-grid/src/index.tsx',
        [
          "ComponentRegistry.register('grid', GridRenderer, { namespace: 'view' });",
          "ComponentRegistry.register('kanban', BoardRenderer, { namespace: 'view' });",
        ].join('\n'),
      );
      write(`${PROMPT_DIR}/component.prompt.md`, '*   **Keys:** `view:grid`, `view:kanban`, etc.\n');
    }, analyzeFixture);

    expect(findings).toEqual([]);
  });

  it('reports a key nothing registers at all under its own reason', () => {
    const { findings } = withTree((write) => {
      write(PLACEHOLDER_SITE, placeholderModule(['view:grid']));
      write(
        'packages/plugin-grid/src/index.tsx',
        "ComponentRegistry.register('grid', GridRenderer, { namespace: 'view' });",
      );
      write(`${PROMPT_DIR}/component.prompt.md`, '*   **Keys:** `view:grid`, `view:board`, etc.\n');
    }, analyzeFixture);

    expect(findings.map((f) => [f.key, f.reason])).toEqual([['view:board', 'unregistered-key']]);
  });

  it('judges a BARE surviving spelling, not only namespaced ones', () => {
    // `object-kanban` is what replaced `view:kanban`. A scanner anchored on a
    // `ns:key` shape would stop reading the bullet at the moment it is
    // corrected — green forever, on a line it no longer looks at.
    const { findings, counters } = withTree((write) => {
      write(PLACEHOLDER_SITE, placeholderModule(['view:kanban']));
      write(
        'packages/plugin-kanban/src/index.tsx',
        "ComponentRegistry.register('object-kanban', Board, { namespace: 'plugin-kanban' });",
      );
      write(`${PROMPT_DIR}/component.prompt.md`, '*   **Keys:** `object-kanban`, `object-gantt`, etc.\n');
    }, analyzeFixture);

    expect(counters.keys).toBe(2);
    expect(findings.map((f) => [f.key, f.reason])).toEqual([['object-gantt', 'unregistered-key']]);
  });
});

// ── 2. the gate must not be able to pass by measuring nothing ────────────────

describe('an input it cannot read is a failure, never a pass', () => {
  const realTree = (write: (rel: string, contents: string) => void) => {
    write(PLACEHOLDER_SITE, placeholderModule(['view:kanban']));
    write('packages/plugin-grid/src/index.tsx', "ComponentRegistry.register('grid', G, { namespace: 'view' });");
    write(`${PROMPT_DIR}/component.prompt.md`, '*   **Keys:** `view:grid`, etc.\n');
  };

  it('refuses to run when no declaration names the placeholder namespace', () => {
    // The collapse that matters: with no placeholder site to subtract, the
    // partition puts EVERY registered key in the authorable half and the gate
    // silently becomes "does this key resolve" — the generous question that let
    // `view:kanban` validate green in the first place. The declaration here is
    // otherwise intact (the derivation reports nothing), so what is being tested
    // is the namespace read and not a broken fixture.
    const renamed = [{ ...FIXTURE_TABLES.indirectRegistrations[0], namespace: 'some-other-namespace' }];
    expect(() =>
      withTree(realTree, (dir) => analyze(dir, { ...FIXTURE_TABLES, indirectRegistrations: renamed })),
    ).toThrow(new RegExp(PLACEHOLDER_NAMESPACE));
  });

  it('refuses to run when the exclusion excludes nothing', () => {
    // Same collapse, reached the other way: the declaration is intact and every
    // key the placeholder module publishes — both the bare spelling and the
    // derived `protocol-placeholder:` one — is ALSO registered somewhere else,
    // so subtracting the placeholder site removes nothing at all. A run in that
    // state would ask the generous question while printing the strict verdict.
    expect(() =>
      withTree((write) => {
        write(PLACEHOLDER_SITE, placeholderModule(['view:grid']));
        write(
          'packages/plugin-grid/src/index.tsx',
          [
            "ComponentRegistry.register('view:grid', G);",
            `ComponentRegistry.register('${PLACEHOLDER_NAMESPACE}:view:grid', G);`,
          ].join('\n'),
        );
        write(`${PROMPT_DIR}/component.prompt.md`, '*   **Keys:** `view:grid`, etc.\n');
      }, analyzeFixture),
    ).toThrow(/removed no keys at all/);
  });

  it('refuses to run when the prompt surface has no Keys bullet left', () => {
    expect(() =>
      withTree((write) => {
        write(PLACEHOLDER_SITE, placeholderModule(['view:kanban']));
        write('packages/plugin-grid/src/index.tsx', "ComponentRegistry.register('grid', G, { namespace: 'view' });");
        write(`${PROMPT_DIR}/component.prompt.md`, '# no bullets here\n\nSome prose about `view:kanban`.\n');
      }, analyzeFixture),
    ).toThrow(/Keys/);
  });

  it('refuses to run when the registry derivation itself reported a finding', () => {
    expect(() =>
      withTree((write) => {
        write(PLACEHOLDER_SITE, placeholderModule(['view:kanban']));
        write('packages/plugin-grid/src/index.tsx', "ComponentRegistry.register('grid', G, { namespace: 'view' });");
        // A dynamic key the derivation cannot resolve and no table declares.
        write('packages/plugin-x/src/index.tsx', 'ComponentRegistry.register(manifest.type, X);');
        write(`${PROMPT_DIR}/component.prompt.md`, '*   **Keys:** `view:grid`, etc.\n');
      }, analyzeFixture),
    ).toThrow(/incomplete/);
  });

  it('reads keys from the Keys LINE only, so prose about props is not judged as keys', () => {
    const { counters } = withTree((write) => {
      write(PLACEHOLDER_SITE, placeholderModule(['view:kanban']));
      write('packages/plugin-grid/src/index.tsx', "ComponentRegistry.register('grid', G, { namespace: 'view' });");
      write(
        `${PROMPT_DIR}/component.prompt.md`,
        ['*   **Keys:** `view:grid`, etc.', '    *   the `wizard` presentation is a `formType` prop.'].join('\n'),
      );
    }, analyzeFixture);

    expect(counters.keys).toBe(1);
  });
});

// ── 3. the live tree ─────────────────────────────────────────────────────────

describe('the repository this gate guards', () => {
  it('has a placeholder declaration for the gate to read', () => {
    expect([...placeholderSites(INDIRECT_REGISTRATIONS)]).not.toEqual([]);
  });

  it('really does have placeholder-only keys — otherwise every case above tests nothing', () => {
    const { keys } = deriveRegistryKeys(repoRoot);
    const { authorable, placeholderOnly } = partitionRegistry(keys, placeholderSites(INDIRECT_REGISTRATIONS));
    expect(placeholderOnly.size).toBeGreaterThan(0);
    expect(authorable.size).toBeGreaterThan(0);
    // A strict subset, not an equal set: the exclusion must actually remove
    // something on the LIVE tree, not only on a fixture built to make it.
    expect(authorable.size).toBeLessThan(keys.size);
  });

  it('has a prompt surface with Keys bullets in it', () => {
    expect(promptFiles(repoRoot).length).toBeGreaterThan(0);
    expect(scanPromptKeys(repoRoot).bullets).toBeGreaterThan(0);
  });

  it('passes — every key the prompts teach is answered by a real renderer', () => {
    expect((analyze(repoRoot) as { findings: Finding[] }).findings).toEqual([]);
  });
});

// ── 4. wiring: a check nothing runs is not a gate ────────────────────────────

describe('wiring', () => {
  const workflowDir = path.join(repoRoot, '.github/workflows');
  const yamlOf = (file: string) =>
    fs
      .readFileSync(path.join(workflowDir, file), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');
  const workflowFiles = fs.readdirSync(workflowDir).filter((f) => f.endsWith('.yml'));
  const homes = workflowFiles.filter((f) => yamlOf(f).includes(SCRIPT));

  it('is exposed as a root package script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['check:prompt-keys']).toBe(`node ${SCRIPT}`);
  });

  it('has exactly one home, and that workflow gates pull requests', () => {
    expect(homes.length, 'one gate, one home').toBe(1);
    const yaml = yamlOf(homes[0]);
    expect(yaml).toMatch(/^\s*pull_request:/m);
    expect(yaml).toMatch(/^\s*push:/m);
    expect(yaml).toMatch(/^\s*merge_group:/m);
  });

  it('runs unfiltered — the change that breaks it is a markdown-only change', () => {
    // `ci.yml`'s type-check job decides whether to run with a diff that excludes
    // `'**/*.md'`, and `.github/prompts/**` is nothing but `.md`. Behind a paths
    // filter this gate would be blind to the only PR shape that can break it.
    const yaml = yamlOf(homes[0]);
    expect(yaml, `${homes[0]} runs ${SCRIPT} behind a paths-ignore`).not.toMatch(/paths-ignore:/);
    expect(yaml, `${homes[0]} runs ${SCRIPT} behind a paths filter`).not.toMatch(/^\s+paths:/m);
  });

  it('needs no install, so it can afford to run unfiltered', () => {
    // Since objectui#12214 the home is `repo-gates.yml`, ONE job that installs
    // after its install-free gates: the property is now an ORDER -- this gate's
    // step sits before the job's `pnpm install` -- and no longer an absence.
    const yaml = yamlOf(homes[0]);
    const gateAt = yaml.indexOf('scripts/check-prompt-component-keys.mjs');
    const installAt = yaml.indexOf('pnpm install');
    expect(gateAt).toBeGreaterThan(-1);
    expect(installAt === -1 || gateAt < installAt, 'the gate step moved below the install step').toBe(true);

    // Walk the WHOLE static import graph, not just this gate's first line: it
    // imports a sibling gate, and "needs no node_modules" has to stay true of
    // everything it reaches, not of its own header.
    const seen = new Set<string>();
    const external: string[] = [];
    const walk = (abs: string) => {
      if (seen.has(abs)) return;
      seen.add(abs);
      const source = fs.readFileSync(abs, 'utf8');
      for (const m of source.matchAll(/^import .* from '([^']+)';$/gm)) {
        const spec = m[1];
        if (spec.startsWith('node:')) continue;
        if (!spec.startsWith('.')) {
          external.push(`${path.relative(repoRoot, abs)} -> ${spec}`);
          continue;
        }
        walk(path.resolve(path.dirname(abs), spec));
      }
    };
    walk(path.join(repoRoot, SCRIPT));

    expect(seen.size, 'the import walk read only the gate itself — it followed nothing').toBeGreaterThan(1);
    expect(external, `the gate's import graph reaches a package, so it needs an install: ${external}`).toEqual([]);
  });
});

// ── 5. the LABELLED BLOCK reading model (objectui#9098) ──────────────────────

/**
 * The `Keys:` model above reads ONE line. The prompt teaches keys in four more
 * places shaped the other way round — a bolded label with nothing after it, and
 * the keys one per SUB-BULLET with trailing prose. So the card's "add a label to
 * the set it scans is a one-line change" is false, and the case below that
 * matters most is the CONTROL: the same sub-bullets under an ungated label are
 * read as nothing at all.
 */
describe('a gated label opens a block, and only the block is judged', () => {
  /** One authorable key, one placeholder-only key — enough for every verdict. */
  const registryTree = (write: (rel: string, contents: string) => void) => {
    write(PLACEHOLDER_SITE, placeholderModule(['view:kanban', 'ai:input']));
    write('packages/plugin-grid/src/index.tsx', "ComponentRegistry.register('grid', G, { namespace: 'view' });");
  };
  const KEYS_LINE = '*   **Keys:** `view:grid`, etc.';
  const prompt = (...body: string[]) => [KEYS_LINE, ...body].join('\n');

  const run = (body: string[]) =>
    withTree((write) => {
      registryTree(write);
      write(`${PROMPT_DIR}/component.prompt.md`, prompt(...body));
    }, analyzeFixture);

  it('reads one key per sub-bullet — the shape the Keys model cannot see', () => {
    const { findings, counters } = run([
      '*   **Required Components:**',
      '    *   `view:grid`: a real renderer answers this one.',
      '    *   `view:kanban` (placeholder only).',
    ]);

    expect(counters.blockKeys).toBe(2);
    expect(findings.map((f) => [f.key, f.reason])).toEqual([['view:kanban', 'placeholder-only-key']]);
  });

  it('reads NOTHING under an ungated label — the control that makes the case above mean something', () => {
    // Byte-identical sub-bullets, one word changed on the label line. Without
    // this leg the case above would also pass against a gate that judged every
    // backticked token in the file, which is the failure triage warned about.
    const { findings, counters } = run([
      '*   **Required Library:**',
      '    *   `view:grid`: a real renderer answers this one.',
      '    *   `view:kanban` (placeholder only).',
    ]);

    expect(counters.blocks).toBe(0);
    expect(counters.blockKeys).toBe(0);
    expect(findings).toEqual([]);
  });

  it('leaves `Required Types:` alone — it is a spec `type` vocabulary, not a registry one', () => {
    // objectui#8929 landed that distinction in the prompt itself. A registry-key
    // gate reaching into it would red on `grid` / `kanban` / `gantt`, which are
    // spec-valid by design, so the label must stay OUT of the gated set.
    const { findings, counters } = run([
      '*   **Required Types (Ref: `src/ui/view.zod.ts`):** `grid`, `kanban`, `gantt`.',
      '*   **Required Types (Ref: `src/data/field.zod.ts`):**',
      '    *   **Textual:** `text`, `textarea`.',
    ]);

    expect(counters.blocks).toBe(0);
    expect(findings).toEqual([]);
  });

  it('never judges a tombstone in prose OUTSIDE the block — the whole point of scoping', () => {
    // The live file names `view:kanban`, `view:gantt`, `user:profile` and
    // `ai:chat_window` precisely so an author does NOT write them. Every one is
    // a key this gate rejects when it reads it, so "do not write this" prose has
    // to stay unread or the file cannot say it.
    const { findings } = run([
      '*   **Required Components:**',
      '    *   `view:grid`: the only key taught here.',
      '',
      '> ⛔ Retired — do not write it: `view:kanban` no longer renders.',
      '',
      'And a plain paragraph naming `view:kanban` again.',
    ]);

    expect(findings).toEqual([]);
  });

  it('never judges a continuation line inside the block that is not a list item', () => {
    const { findings, counters } = run([
      '*   **Required Components:**',
      '    this line sits IN the block and names `view:kanban`, but it is prose, not a list item.',
      '    *   `view:grid`: the only key taught here.',
    ]);

    expect(counters.blockKeys).toBe(1);
    expect(findings).toEqual([]);
  });

  it('never judges a backticked span with a space in it — that is a command, not a key', () => {
    // The label lines in the live file end in prose that backticks
    // `pnpm check:prompt-keys`. No key the derivation produces has whitespace in
    // it (650 of 650 measured), so this skips nothing a bad key could hide in.
    const { findings, counters } = run([
      '*   **Required Components:** — held to this by `pnpm check:prompt-keys`, see `objectui check`.',
      '    *   `view:grid`: the only key taught here.',
    ]);

    expect(counters.blockKeys).toBe(1);
    expect(findings).toEqual([]);
  });

  it('never judges trailing text on a sub-bullet unless it is backticked', () => {
    const { findings, counters } = run([
      '*   **Required Components:**',
      '    *   `view:grid`: a Standalone smart button, the view:kanban spelling is dead, see notes.',
    ]);

    expect(counters.blockKeys).toBe(1);
    expect(findings).toEqual([]);
  });

  it('ends the block at a sibling bullet indented at the label`s own level', () => {
    const { findings, counters } = run([
      '*   **Required Components:**',
      '    *   `view:grid`',
      '*   **Contract:** the retired `view:kanban` is discussed on an ungated sibling bullet.',
    ]);

    expect(counters.blockKeys).toBe(1);
    expect(findings).toEqual([]);
  });

  it('skips fenced code, so a document EXPLAINING the convention is not judged by it', () => {
    const { findings, counters } = run([
      '',
      '```markdown',
      '*   **Required Components:**',
      '    *   `view:kanban`',
      '```',
    ]);

    expect(counters.blocks).toBe(0);
    expect(findings).toEqual([]);
  });

  it('refuses to run when a gated label opens a block that teaches no key', () => {
    // The block model's equivalent of the `bullets === 0` collapse: the label is
    // still there, the keys moved out from under it, and a gate that reads
    // nothing under a live label would print a pass it did not earn.
    expect(() =>
      run([
        '*   **Required Components:**',
        '    *   see the table below for the current list.',
      ]),
    ).toThrow(/taught no key at all/);
  });
});

// ── 6. the INVERTED leg: a placeholder list is a factual claim too ───────────

describe('`Protocol Placeholders:` is judged the other way round', () => {
  const run = (body: string[], placeholderKeys: string[] = ['view:kanban', 'ai:input']) =>
    withTree((write) => {
      write(PLACEHOLDER_SITE, placeholderModule(placeholderKeys));
      write('packages/plugin-grid/src/index.tsx', "ComponentRegistry.register('grid', G, { namespace: 'view' });");
      write(`${PROMPT_DIR}/component.prompt.md`, ['*   **Keys:** `view:grid`, etc.', ...body].join('\n'));
    }, analyzeFixture);

  const BLOCK = ['*   **Protocol Placeholders:**', '    *   `ai:input`: prompt input.'];

  it('accepts a key the placeholder module alone registers', () => {
    const { findings, counters } = run(BLOCK);
    expect(counters.placeholderClaims).toBe(1);
    expect(findings).toEqual([]);
  });

  it('rejects a key a REAL renderer answers — the section would understate the platform', () => {
    // Same block, and the only change is that `ai:input` now has a real
    // renderer. Without this leg, "move the placeholder-only keys into a
    // placeholder section" would have moved the drift instead of fixing it.
    const { findings } = withTree((write) => {
      write(PLACEHOLDER_SITE, placeholderModule(['view:kanban', 'ai:input']));
      write(
        'packages/plugin-grid/src/index.tsx',
        [
          "ComponentRegistry.register('grid', G, { namespace: 'view' });",
          "ComponentRegistry.register('input', AiInput, { namespace: 'ai' });",
        ].join('\n'),
      );
      write(`${PROMPT_DIR}/component.prompt.md`, ['*   **Keys:** `view:grid`, etc.', ...BLOCK].join('\n'));
    }, analyzeFixture);

    expect(findings.map((f) => [f.key, f.reason])).toEqual([['ai:input', 'not-a-placeholder-key']]);
  });

  it('rejects a key the placeholder module has stopped registering', () => {
    const { findings } = run(BLOCK, ['view:kanban']);
    expect(findings.map((f) => [f.key, f.reason])).toEqual([['ai:input', 'unregistered-key']]);
  });
});

// ── 7. the live tree, under the widened model ────────────────────────────────

describe('the prompt surface this gate now reads', () => {
  const scan = () => scanPromptKeys(repoRoot) as {
    sites: { key: string; label: string; expect: string; scope: string }[];
    bullets: number;
    blocks: number;
    emptyBlocks: string[];
  };

  it('really does reach the labelled blocks — floors, so a reformat cannot quietly empty them', () => {
    const { blocks, sites, emptyBlocks } = scan();
    expect(emptyBlocks).toEqual([]);
    expect(blocks, 'gated label blocks on the live prompt surface').toBeGreaterThanOrEqual(4);
    expect(sites.filter((s) => s.scope === 'block').length, 'keys read from blocks').toBeGreaterThanOrEqual(24);
    expect(
      sites.filter((s) => s.expect === 'placeholder-only').length,
      'keys claimed as protocol placeholders',
    ).toBeGreaterThanOrEqual(4);
  });

  it('still reads objectui#8929`s two `Keys:` bullets, and reads them the old way', () => {
    // The widening must not have moved them: they are correct and already gated,
    // and their sub-bullet prose (the `formType` values) must stay unjudged.
    const { bullets, sites } = scan();
    expect(bullets).toBe(2);
    expect(sites.filter((s) => s.scope === 'keys-line').map((s) => s.key)).toEqual([
      'view:grid',
      'object-kanban',
      'object-map',
      'view:calendar',
      'object-gantt',
      'view:simple',
      'view:form',
      'view:detail',
    ]);
  });

  it('teaches no key at all under a `Required Types` label', () => {
    expect(scan().sites.filter((s) => /^Required Types/.test(s.label))).toEqual([]);
  });

  it('names the retired and deliberately-unregistered keys ONLY in prose', () => {
    // Each of these appears in the file, and each would be a finding if the gate
    // read it. That they are absent from the scan IS the prose-safety proof.
    const taught = new Set(scan().sites.map((s) => s.key));
    for (const tombstone of ['user:profile', 'ai:chat_window', 'view:kanban', 'view:gantt', 'view:map']) {
      expect(taught.has(tombstone), `${tombstone} must stay in prose, never in a judged list`).toBe(false);
    }
    const prompt = fs.readFileSync(path.join(repoRoot, PROMPT_DIR, 'component.prompt.md'), 'utf8');
    for (const tombstone of ['user:profile', 'ai:chat_window', 'view:kanban']) {
      expect(prompt, `${tombstone} tombstone must still be written down`).toContain(`\`${tombstone}\``);
    }
  });
});

// ── 8. the letter run, scoped to its section (objectui#9145) ─────────────────

describe('a `## N.` section\'s `### X.` headings must run A, B, C, … without a gap', () => {
  /** The minimum surface the earlier guards need, plus the headings under test. */
  const runLetters = (prompt: string[]) =>
    withTree((write) => {
      write(PLACEHOLDER_SITE, placeholderModule(['view:kanban']));
      write('packages/plugin-grid/src/index.tsx', "ComponentRegistry.register('grid', G, { namespace: 'view' });");
      write(`${PROMPT_DIR}/component.prompt.md`, ['*   **Keys:** `view:grid`, etc.', '', ...prompt].join('\n'));
    }, analyzeFixture);

  it('reports the gap — the defect this card was filed for, reproduced', () => {
    // `A B D` is the shape `component.prompt.md` §1 carried from its first
    // commit: seven sections lettered A B D E F G H, no `### C.`.
    const { findings } = runLetters(['## 1. Component Categories', '', '### A. One', '', '### B. Two', '', '### D. Four']);

    expect(findings.map((f) => [f.key, f.reason])).toEqual([['### D.', 'letter-run-gap']]);
    expect(findings[0].text).toContain('expected `### C.`');
    expect(findings[0].text).toContain('heading 3 of 3');
  });

  it('reports only the FIRST mismatch in a run, not every heading after the gap', () => {
    // A gap at C makes D, E and F wrong too. Listing all of them buries the one
    // heading an author actually has to decide about.
    const { findings } = runLetters([
      '## 1. Component Categories',
      '',
      '### A. One',
      '',
      '### B. Two',
      '',
      '### D. Four',
      '',
      '### E. Five',
      '',
      '### F. Six',
    ]);

    expect(findings.map((f) => f.key)).toEqual(['### D.']);
  });

  it('scopes the run to its section, so a second run restarting at A is not a gap', () => {
    // The reason this is not a file-wide sequence check: `component.prompt.md`
    // carries a second run under §2 and `engine.prompt.md` carries five, and a
    // file-wide check would red on every correct file on this surface.
    const { findings, counters } = runLetters([
      '## 1. Component Categories',
      '',
      '### A. One',
      '',
      '### B. Two',
      '',
      '## 2. API Reference',
      '',
      '### A. Field Widget Implementation',
      '',
      '### B. Dashboard Widget Implementation',
    ]);

    expect(findings).toEqual([]);
    expect(counters.letterRuns).toBe(2);
    expect(counters.letterHeadings).toBe(4);
  });

  it('does not read a heading inside a fenced code block', () => {
    const { findings, counters } = runLetters([
      '## 1. Component Categories',
      '',
      '### A. One',
      '',
      '```md',
      '### D. An EXAMPLE of a heading, not a heading',
      '```',
      '',
      '### B. Two',
    ]);

    expect(findings).toEqual([]);
    expect(counters.letterHeadings).toBe(2);
  });

  it('refuses to pass when every section has lost its letter headings', () => {
    // The collapse this guard exists for: the inventories are reformatted away
    // and a run that reads nothing reports a pass it did not earn.
    expect(() => runLetters(['## 1. Component Categories', '', 'Prose, and no headings at all.'])).toThrow(
      /carry no `### X\.` heading/,
    );
  });

  it('says nothing about a surface that has no `## N.` sections at all', () => {
    // A run only exists inside a section, so "no sections" is not a collapsed
    // inventory — it is a document this pin makes no claim about. Every fixture
    // in the sections above is that shape, which is why they must stay green.
    const { findings, counters } = runLetters(['Just a Keys bullet and nothing else.']);

    expect(findings).toEqual([]);
    expect(counters.letterRuns).toBe(0);
  });
});

// ── 9. the live tree, under the letter-run pin ───────────────────────────────

describe('the letter runs on the live prompt surface', () => {
  const sections = () => scanPromptSections(repoRoot) as {
    file: string;
    section: string;
    entries: { letter: string; line: number; text: string }[];
  }[];

  it('every run in every prompt file is contiguous from A', () => {
    expect(letterRunFindings(lettered(sections()))).toEqual([]);
  });

  it('pins §1 of `component.prompt.md` to the seven categories, lettered A–G', () => {
    // The corrected state. objectui#9145: this run read `A B D E F G H` — the
    // gap was in the file's first commit, not a category that was dropped, so
    // it is renumbered rather than filled.
    const one = sections().find(
      (s) => s.file === `${PROMPT_DIR}/component.prompt.md` && /^1\./.test(s.section),
    );
    expect(one, '§1 Component Categories must still be a `## 1.` section').toBeDefined();
    expect(one!.entries.map((e) => e.letter)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  });

  it('floors the surface, so a reformat cannot quietly empty it', () => {
    const runs = lettered(sections()) as { entries: unknown[] }[];
    expect(runs.length, 'letter runs on the live prompt surface').toBeGreaterThanOrEqual(8);
    expect(
      runs.reduce((n: number, run) => n + run.entries.length, 0),
      'lettered headings on the live prompt surface',
    ).toBeGreaterThanOrEqual(29);
  });
});

/**
 * objectui#9331 — the fence mask reads a RUN, not "three backticks"
 *
 * ## The defect
 *
 * This gate's private predicate was `/^\s*(?:```|~~~)/` used as a TOGGLE. It
 * answers "marker" for a run of any length, so a FOUR-backtick opener flipped
 * the mask on and the next THREE-backtick line — which CommonMark makes body
 * text, and which is exactly how a page quotes a fence — flipped it back off.
 * From there the gate read code as prose and prose as code for the rest of the
 * file, and reported a clean pass over a region it had mis-paired.
 *
 * ## Why these two fixtures and not the live corpus
 *
 * The corpus cannot show this: `.github/prompts/**` carries ZERO runs of four
 * or more backticks (measured on this card's base — 627 lines, 34 marker lines,
 * no divergence), so the defect is LATENT and the gate's output is byte-identical
 * before and after the repair. A case built here is the only thing that can fail
 * before it and pass after it.
 *
 * The two wrappers are the two halves of one desynchronisation, and a fix that
 * addressed only one would still pass the other:
 *
 *   EVEN marker count   the quoted bullet becomes VISIBLE — the gate judges an
 *                       example of a bullet as a bullet (prose read as code).
 *   ODD marker count    pairing never resynchronises, so the REAL bullet after
 *                       the wrapper goes invisible (code read as prose). This is
 *                       the worse half: the gate reports OK over text it never
 *                       looked at.
 */
describe('a fence quoted inside a longer wrapper (objectui#9331)', () => {
  // ⛔ Fixtures are arrays of string literals, never raw fences in this file. A
  // backtick run at the start of a line HERE would open a fence in the very
  // gates this suite drives, and would be swept by greps over this tree.
  const QUOTED = '*   **Keys:** `quoted-inside-the-wrapper`';
  const REAL = '*   **Keys:** `view:table`';

  /** Four markers: pairing resynchronises, so the phantom bullet is the symptom. */
  const EVEN_WRAPPER = ['# Teaching a nested fence', '', '````markdown', '```md', QUOTED, '```', '````', '', REAL, ''];

  /** Three markers: pairing never recovers, so the REAL bullet is swallowed. */
  const ODD_WRAPPER = ['# Teaching a nested fence', '', '````markdown', '```md', QUOTED, '````', '', REAL, ''];

  const keysIn = (lines: string[]) =>
    withTree(
      (write) => write(`${PROMPT_DIR}/component.prompt.md`, lines.join('\n')),
      (dir) => scanPromptKeys(dir) as { sites: { key: string }[]; bullets: number },
    );

  it('does not judge a bullet quoted inside the wrapper as a bullet', () => {
    // Before the repair: ['quoted-inside-the-wrapper', 'view:table'], 2 bullets.
    const scan = keysIn(EVEN_WRAPPER);
    expect(scan.sites.map((s) => s.key)).toEqual(['view:table']);
    expect(scan.bullets).toBe(1);
  });

  it('still sees the real bullet after an ODD number of markers', () => {
    // Before the repair: ['quoted-inside-the-wrapper'] — `view:table` sat inside
    // a fence that never closed, and the gate passed without reading it.
    const scan = keysIn(ODD_WRAPPER);
    expect(scan.sites.map((s) => s.key)).toEqual(['view:table']);
  });

  it('leaves an ordinary three-backtick fence exactly as it was', () => {
    // The control in the other direction: the shape that already worked must not
    // have changed, or the two cases above could pass by masking everything.
    const scan = keysIn(['# Ordinary fence', '', '```md', QUOTED, '```', '', REAL, '']);
    expect(scan.sites.map((s) => s.key)).toEqual(['view:table']);
  });

  it('reads a bullet that is not fenced at all — the lit control', () => {
    // A guard against a mask that simply returns "fenced" for everything: if it
    // did, every case above would pass while the gate judged nothing.
    const scan = keysIn(['# No fence here', '', REAL, '']);
    expect(scan.sites.map((s) => s.key)).toEqual(['view:table']);
    expect(scan.bullets).toBe(1);
  });
});
