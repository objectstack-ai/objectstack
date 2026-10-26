import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here —
// re-adding one is now itself an error (TS2578). See objectui#3494.
import {
  EXIT_CODES,
  IDENT_CHAR,
  KNOWN_UNTAUGHT_EVAL_TOKENS,
  ORACLE,
  SCAN_ROOTS,
  analyze,
  countSubstring,
  countWholeToken,
  listBundles,
  rowKey,
} from '../check-skill-eval-tokens.mjs';

/**
 * objectui#7461 — the test for `scripts/check-skill-eval-tokens.mjs`.
 *
 * ## What this file covers, and what it leaves to `--self-test`
 *
 * Everything here runs on an UNBUILT tree with no install, because that is what
 * the gate itself needs: its whole input is text in the checkout. The split
 * against `--self-test` is therefore not the one `check-skill-examples.test.ts`
 * makes (there, the compiler half needs a built workspace). Here it is by
 * AUDIENCE: `--self-test` is the probe the workflow runs so a gate broken into
 * permanent green is caught in CI, and this file pins the things a future edit
 * could quietly change — the oracle identity, the boundary rule's exact edges,
 * the shrink-only direction of the baseline, and the wiring.
 *
 * Both are needed and neither substitutes: a self-test nobody runs is a probe
 * that passes, and a wiring assertion cannot see a boundary rule regress.
 *
 * The fixtures are throwaway trees, never the real bundle: a committed fixture
 * eval would have to assert a deliberately untaught token, and something else in
 * this repository would eventually scan it — the reasoning
 * `check-skills-paths.test.ts` states for its own trees.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Builds a throwaway tree and hands the caller its root. */
function withTree<T>(
  build: (write: (rel: string, contents: string) => void) => void,
  run: (dir: string) => T,
): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-skill-eval-tokens-'));
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

const evalDoc = (assertions: unknown, id = 1) =>
  JSON.stringify({ skill_name: 'fixture', evals: [{ id, prompt: 'p', expected_output: 'e', files: [], assertions }] });

describe('the whole-token rule', () => {
  /**
   * objectui#7405 measured these three, and they are the entire argument for
   * comparing whole tokens. Two of them the rule closes; the third it cannot,
   * and pinning that here is what stops a future reader from mistaking this
   * gate's green for a semantic guarantee.
   */
  it('does not match `view` inside `// vite preview`', () => {
    expect(countWholeToken('// vite preview', 'view')).toBe(0);
    expect(countSubstring('// vite preview', 'view')).toBe(1);
  });

  it('does not match `FieldWidgetProps` inside `FieldWidgetPropsSchema`', () => {
    expect(countWholeToken('import { FieldWidgetPropsSchema } from "x";', 'FieldWidgetProps')).toBe(0);
    expect(countSubstring('FieldWidgetPropsSchema', 'FieldWidgetProps')).toBe(1);
  });

  it('DOES match `create` in `create: vi.fn()` — the stated limit of this gate', () => {
    // ⚠️ Not a defect and not fixable by any token rule: `create` really is a
    // whole token there. The mismatch objectui#7405 recorded was SEMANTIC — the
    // eval meant the form mode, the guide had a mocked dataSource method. So a
    // green here means "the bundle says this word", never "the bundle teaches
    // what the eval means". Pinned so the boundary stays stated.
    expect(countWholeToken("create: vi.fn().mockResolvedValue({ id: '1' })", 'create')).toBe(1);
  });

  it('binds on a boundary only where the token itself is identifier-shaped', () => {
    // Both ends identifier-shaped: a full word match.
    expect(countWholeToken('the view name', 'view')).toBe(1);
    expect(countWholeToken('overview', 'view')).toBe(0);
    // Left end only: `t(` must not be found inside `format(`.
    expect(countWholeToken('format( and t( here', 't(')).toBe(1);
    // Neither end: an exact substring, which is what such a token means.
    expect(countWholeToken('a "props": { b', '"props": {')).toBe(1);
    expect(countWholeToken('x && y', '&&')).toBe(1);
  });

  it('treats a digit as continuing an identifier, so `xl` does not match `2xl`', () => {
    expect(countWholeToken('the 2xl step', 'xl')).toBe(0);
    expect(countWholeToken('up to xl only', 'xl')).toBe(1);
  });

  it('is case-sensitive — `Type` must not vouch for `type`', () => {
    expect(countWholeToken('Type is not type', 'type')).toBe(1);
  });

  it('handles hyphenated and scoped tokens without treating the punctuation as a boundary hole', () => {
    expect(countWholeToken('use grid-cols-1 here', 'grid-cols-1')).toBe(1);
    expect(countWholeToken('grid-cols-12', 'grid-cols-1')).toBe(0);
    expect(countWholeToken('from "@object-ui/mobile"', '@object-ui/mobile')).toBe(1);
    expect(countWholeToken('from "@object-ui/mobiles"', '@object-ui/mobile')).toBe(0);
  });

  it('never matches the empty token, rather than matching everywhere', () => {
    expect(countWholeToken('anything', '')).toBe(0);
    expect(countSubstring('anything', '')).toBe(0);
  });

  it('escapes regex metacharacters in the token', () => {
    // `${` and `${data.` are real tokens in this corpus; treating them as a
    // pattern would either throw or match the wrong thing.
    expect(countWholeToken('value is ${data.total}', '${data.')).toBe(1);
    expect(countWholeToken('value is ${data.total}', '${')).toBe(1);
    expect(countWholeToken('a.b', 'a.b')).toBe(1);
    expect(countWholeToken('axb', 'a.b')).toBe(0);
  });

  it('exports the identifier class the boundary rule is stated in terms of', () => {
    for (const ch of ['a', 'Z', '0', '_', '$']) expect(IDENT_CHAR.test(ch)).toBe(true);
    for (const ch of ['-', '.', ':', '/', '"', ' ', '(']) expect(IDENT_CHAR.test(ch)).toBe(false);
  });
});

describe('the oracle', () => {
  it('is bundle-wide, declared rather than inferred from the walker', () => {
    expect(ORACLE).toBe('bundle-wide');
    expect(SCAN_ROOTS).toEqual(['skills']);
  });

  it('accepts a token taught in a SIBLING file of the same bundle', () => {
    // The disagreement comment 5514262423 measured: `registerComponent` is
    // taught in `guides/plugin-development.md` and required by an eval whose
    // basename is `page-builder`. Honest under this oracle; a defect under the
    // rejected one.
    withTree(
      (write) => {
        write('skills/fixture/guides/page-builder.md', 'A page builder guide.\n');
        write('skills/fixture/guides/plugin-development.md', 'Call scope.registerComponent(type, c).\n');
        write('skills/fixture/evals/page-builder.json', evalDoc({ must_contain: ['registerComponent'], must_not_contain: [] }));
      },
      (root) => {
        const r = analyze({ root, baseline: new Set<string>() });
        expect(r.red).toEqual([]);
        expect(r.redPerGuide.map((x: { token: string }) => x.token)).toEqual(['registerComponent']);
      },
    );
  });

  it('scores each bundle against its OWN markdown, never a neighbour bundle', () => {
    // Today there is one bundle, so this can only be wrong later — which is
    // exactly when nobody would be looking.
    withTree(
      (write) => {
        write('skills/alpha/guides/a.md', 'alphaOnlyToken\n');
        write('skills/alpha/evals/a.json', evalDoc({ must_contain: ['alphaOnlyToken'], must_not_contain: [] }));
        write('skills/beta/guides/b.md', 'betaOnlyToken\n');
        write('skills/beta/evals/b.json', evalDoc({ must_contain: ['alphaOnlyToken'], must_not_contain: [] }));
      },
      (root) => {
        expect(listBundles(root).map((b: { rel: string }) => b.rel)).toEqual(['skills/alpha', 'skills/beta']);
        const r = analyze({ root, baseline: new Set<string>() });
        expect(r.red.map((x: { key: string }) => x.key)).toEqual(['skills/beta/evals/b.json eval 1 alphaOnlyToken']);
      },
    );
  });

  it('reds a substring-only match and says so', () => {
    withTree(
      (write) => {
        write('skills/fixture/guides/a.md', 'heavy widgets (grids, charts, kanbans)\n');
        write('skills/fixture/evals/a.json', evalDoc({ must_contain: ['chart'], must_not_contain: [] }));
      },
      (root) => {
        const r = analyze({ root, baseline: new Set<string>() });
        expect(r.red).toHaveLength(1);
        expect(r.red[0].bundleWhole).toBe(0);
        expect(r.red[0].bundleSubstring).toBe(1);
      },
    );
  });
});

describe('must_not_contain is never scored against the guides', () => {
  it('does not red on an entry absent from every guide', () => {
    withTree(
      (write) => {
        write('skills/fixture/guides/a.md', 'taughtToken\n');
        write(
          'skills/fixture/evals/a.json',
          evalDoc({
            must_contain: ['taughtToken'],
            // objectui#7370 spelled one deliberately as a quoted key fragment.
            must_not_contain: ['nothingInAnyGuideSaysThis', '"props": {', 'return <div'],
          }),
        );
      },
      (root) => {
        const r = analyze({ root, baseline: new Set<string>() });
        expect(r.red).toEqual([]);
        expect(r.shapeFindings).toEqual([]);
        // And it produces no ROW at all — the array is not part of the judgement.
        expect(r.rows.map((x: { token: string }) => x.token)).toEqual(['taughtToken']);
      },
    );
  });

  it('still shape-checks it — an empty entry or a non-array is a finding', () => {
    withTree(
      (write) => {
        write('skills/fixture/guides/a.md', 'taughtToken\n');
        write('skills/fixture/evals/a.json', evalDoc({ must_contain: ['taughtToken'], must_not_contain: ['', 7] }));
      },
      (root) => {
        const r = analyze({ root, baseline: new Set<string>() });
        expect(r.shapeFindings).toHaveLength(2);
        expect(r.shapeFindings.every((f: { reason: string }) => f.reason === 'bad-token')).toBe(true);
        expect(r.red).toEqual([]);
      },
    );
  });
});

describe('the baseline is shrink-only', () => {
  const build = (write: (rel: string, contents: string) => void) => {
    write('skills/fixture/guides/a.md', 'taughtToken and charts\n');
    write(
      'skills/fixture/evals/a.json',
      evalDoc({ must_contain: ['taughtToken', 'chart', 'neverTaught'], must_not_contain: [] }),
    );
  };
  const CHART = 'skills/fixture/evals/a.json eval 1 chart';
  const NEVER = 'skills/fixture/evals/a.json eval 1 neverTaught';

  it('is EMPTY at landing, because the chosen oracle has no red rows', () => {
    expect([...KNOWN_UNTAUGHT_EVAL_TOKENS]).toEqual([]);
  });

  it('suppresses exactly its own row and nothing else', () => {
    withTree(build, (root) => {
      const r = analyze({ root, baseline: new Set([CHART]) });
      expect(r.red.map((x: { key: string }) => x.key).sort()).toEqual([CHART, NEVER].sort());
      expect(r.fresh.map((x: { key: string }) => x.key)).toEqual([NEVER]);
      expect(r.stale).toEqual([]);
    });
  });

  it('reports a row whose red is gone as STALE, so the list can only shrink', () => {
    withTree(build, (root) => {
      const r = analyze({ root, baseline: new Set([CHART, NEVER, 'skills/fixture/evals/a.json eval 1 taughtToken']) });
      expect(r.fresh).toEqual([]);
      expect(r.stale).toEqual(['skills/fixture/evals/a.json eval 1 taughtToken']);
    });
  });

  it('keys a row by file, eval and token, keeping a token with spaces whole', () => {
    expect(rowKey('skills/x/evals/y.json', 3, 'await expect')).toBe('skills/x/evals/y.json eval 3 await expect');
  });
});

describe('the preconditions — never exit 0 for "nothing checked"', () => {
  it('names three distinct exit codes, with 1 and 2 kept apart', () => {
    expect(EXIT_CODES).toEqual({ verified: 0, tokensUntaught: 1, couldNotRun: 2 });
  });

  it('refuses a tree with no bundle at all', () => {
    withTree(
      (write) => write('skills/fixture/guides/a.md', 'prose\n'),
      (root) => {
        expect(analyze({ root, baseline: new Set<string>() }).preconditions.map((p: { reason: string }) => p.reason)).toContain(
          'no-bundles',
        );
      },
    );
  });

  it('refuses a bundle whose evals assert no must_contain token', () => {
    withTree(
      (write) => {
        write('skills/fixture/guides/a.md', 'prose\n');
        write('skills/fixture/evals/a.json', evalDoc({ must_contain: [], must_not_contain: [] }));
      },
      (root) => {
        expect(analyze({ root, baseline: new Set<string>() }).preconditions.map((p: { reason: string }) => p.reason)).toContain(
          'empty-population',
        );
      },
    );
  });

  it('refuses a bundle with eval files but no markdown corpus', () => {
    withTree(
      (write) => write('skills/fixture/evals/a.json', evalDoc({ must_contain: ['x'], must_not_contain: [] })),
      (root) => {
        expect(analyze({ root, baseline: new Set<string>() }).preconditions.map((p: { reason: string }) => p.reason)).toContain(
          'no-guides',
        );
      },
    );
  });

  it('refuses an eval file that does not parse, rather than greening over the rest', () => {
    withTree(
      (write) => {
        write('skills/fixture/guides/a.md', 'taughtToken\n');
        write('skills/fixture/evals/good.json', evalDoc({ must_contain: ['taughtToken'], must_not_contain: [] }));
        write('skills/fixture/evals/bad.json', '{ "evals": [ }');
      },
      (root) => {
        const r = analyze({ root, baseline: new Set<string>() });
        expect(r.preconditions.map((p: { reason: string }) => p.reason)).toContain('unparseable');
      },
    );
  });
});

describe('the real corpus', () => {
  it('is non-empty and green under the chosen oracle', () => {
    // The starting population objectui#7461 asked to be stated. If this ever
    // reads zero, the gate has stopped finding the corpus rather than started
    // agreeing with it.
    const r = analyze({ root: repoRoot });
    expect(r.preconditions).toEqual([]);
    expect(r.bundles.map((b: { rel: string }) => b.rel)).toEqual(['skills/objectui']);
    expect(r.rows.length).toBeGreaterThan(100);
    expect(r.shapeFindings).toEqual([]);
    expect(r.fresh).toEqual([]);
    expect(r.stale).toEqual([]);
  });

  it('keeps the rejected oracle re-derivable rather than deleted', () => {
    // The comparison the header's decision rests on. It is computed on every
    // run, so `--measure` cannot drift from the gate.
    const r = analyze({ root: repoRoot });
    expect(r.redBundle).toEqual([]);
    expect(r.redPerGuide.length).toBeGreaterThan(0);
    const artefacts = r.redPerGuide.filter((x: { perGuideExists: boolean }) => !x.perGuideExists);
    expect(
      artefacts.length,
      'the per-guide oracle is not total over this corpus — that is the header\'s argument, and if ' +
        'it ever becomes total the decision deserves re-reading rather than silently holding',
    ).toBeGreaterThan(0);
  });
});

describe('wiring — the gate is reachable and a markdown-only PR starts it', () => {
  const SCRIPT = 'scripts/check-skill-eval-tokens.mjs';
  const workflowDir = path.join(repoRoot, '.github/workflows');
  const workflowPath = path.join(workflowDir, 'repo-gates.yml');
  const workflowFiles = fs.readdirSync(workflowDir).filter((f) => f.endsWith('.yml'));

  /**
   * A workflow's YAML with whole-line comments removed. Every workflow in this
   * repository discusses `paths`, `paths-ignore` and its neighbours' scripts in
   * prose; a scan that counted comments would report filters and duplicate homes
   * that no file has.
   */
  const yamlOf = (file: string) =>
    fs
      .readFileSync(path.join(workflowDir, file), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');

  it('is exposed as a root package script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(pkg.scripts['check:skill-eval-tokens']).toBe(`node ${SCRIPT}`);
  });

  it('has a workflow that gates pull requests, not just pushes', () => {
    expect(fs.existsSync(workflowPath), 'a check nothing runs is not a gate').toBe(true);
    const yaml = yamlOf('repo-gates.yml');
    expect(yaml).toMatch(new RegExp(`run:\\s*node\\s+${SCRIPT.replace(/[.]/g, '\\.')}\\s*$`, 'm'));
    expect(yaml).toMatch(/^\s*pull_request:/m);
    expect(yaml).toMatch(/^\s*push:/m);
    expect(yaml).toMatch(/^\s*merge_group:/m);
  });

  it('runs the self-test too — a probe nobody runs is a probe that passes', () => {
    expect(yamlOf('repo-gates.yml')).toMatch(
      new RegExp(`run:\\s*node\\s+${SCRIPT.replace(/[.]/g, '\\.')}\\s+--self-test`),
    );
  });

  it('installs nothing — the criterion is text in the checkout', () => {
    // The property `check-pre-install-import-graph.mjs` then enforces on the
    // script: with no `pnpm install` step in the job, every step is a
    // pre-install step, so the whole static import graph must stay free of
    // `node_modules`. Folding this gate into `check-skill-examples.mjs` would
    // have lost exactly this, since that one exits 2 on an unbuilt tree.
    // Since objectui#12214 the home is `repo-gates.yml`, ONE job that installs
    // after its install-free gates: the property is now an ORDER -- this gate's
    // step sits before the job's `pnpm install` -- and no longer an absence.
    const yaml = yamlOf('repo-gates.yml');
    const gateAt = yaml.indexOf(`run: node ${SCRIPT} --self-test`);
    expect(gateAt).toBeGreaterThan(-1);
    for (const marker of ['pnpm install', 'turbo run build']) {
      const at = yaml.indexOf(marker);
      expect(at === -1 || gateAt < at, `the gate step moved below \`${marker}\``).toBe(true);
    }
    expect(yaml).not.toMatch(/pnpm build/);
  });

  it('runs it in NO path-filtered workflow — the scan surface is entirely markdown and JSON', () => {
    expect(workflowFiles.length, 'the workflow directory scan returned implausibly few files').toBeGreaterThan(5);
    for (const file of workflowFiles) {
      const yaml = yamlOf(file);
      if (!yaml.includes(SCRIPT)) continue;
      expect(yaml, `${file} runs ${SCRIPT} behind a paths-ignore — a guide-only change would not start it`).not.toMatch(
        /paths-ignore:/,
      );
      expect(yaml, `${file} runs ${SCRIPT} behind a paths filter — see objectui#3448`).not.toMatch(/^\s+paths:/m);
    }
  });

  it('has exactly one home', () => {
    expect(workflowFiles.filter((f) => yamlOf(f).includes(SCRIPT))).toEqual(['repo-gates.yml']);
  });

  it('does not run a NEIGHBOUR gate from this workflow', () => {
    // `check-skill-examples.test.ts` pins that its own script lives in exactly
    // one workflow. Invoking it from this YAML would break that pin and give
    // one gate two homes.
    // Since objectui#12214 every gate shares `repo-gates.yml`, so "this
    // workflow" is now this gate's OWN steps: the ones named after its check.
    const own = yamlOf('repo-gates.yml')
      .split(/^(?= {6}- name: )/m)
      .filter((step) => step.startsWith('      - name: Skill Eval Token Check'));
    expect(own.length).toBeGreaterThan(0);
    for (const step of own) expect(step).not.toContain('scripts/check-skill-examples.mjs');
  });

  it('is classified as a blocking context rather than defaulting into silence', () => {
    // Since objectui#12214 the check reports as a step of the ONE `Repo Gates`
    // context, which is the name the classification and the floor read.
    const gate = fs.readFileSync(path.join(repoRoot, 'scripts/dependabot-merge-gate.mjs'), 'utf8');
    expect(gate).toContain("'Repo Gates'");
    expect(yamlOf('repo-gates.yml')).toContain('name: Skill Eval Token Check');
  });

  it('has a section on the CI page, named by heading', () => {
    // `ci-cd-pipeline-doc.test.ts` enforces this repo-wide; restated here
    // because objectui#3212's lesson is that the omission happens at the moment
    // the workflow is added, not later.
    const doc = fs.readFileSync(path.join(repoRoot, 'content/docs/guide/ci-cd-pipeline.md'), 'utf8');
    const headings = doc.split('\n').filter((line) => /^#{1,6}\s/.test(line));
    expect(headings.some((h) => h.includes('repo-gates.yml'))).toBe(true);
  });
});
