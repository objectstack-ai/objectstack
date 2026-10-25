import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here.
import {
  assertMarkersAreImpossible,
  classify,
  deriveCatalogIds,
  findTagEnd,
  placeholderMarker,
  scanDocs,
  scanReferences,
} from '../check-doc-example-ids.mjs';

/**
 * objectui#8623 — the test for `scripts/check-doc-example-ids.mjs`.
 *
 * The gate answers one question: does every `<SchemaExample id="…" />` in
 * `content/docs/**` name an id the schema catalog registry carries. Nothing
 * asked it before, and the honest runtime behaviour is a THROW at page render,
 * so the failing direction is a crashed page in the published docs while every
 * local check stays green.
 *
 * The trap this file exists for: **the population was clean on the day the gate
 * landed**. A gate that has never been seen to fire is indistinguishable from a
 * gate that cannot fire, so the pins below are ordered by how the gate goes
 * wrong rather than by how it is used:
 *
 *  1. **The firing control.** The REAL script, spawned as a process, over a
 *     throwaway tree carrying a deliberately unknown id — exit code and message.
 *     A unit test of a helper would not have shown the gate going red.
 *  2. **The exemption does not swallow real references.** A placeholder is
 *     recognised by SHAPE, so the pins fixture a typo that is well-formed and a
 *     placeholder that is not, and require opposite verdicts.
 *  3. **The scan cannot collapse quietly.** Empty walk, empty reference set and
 *     an unreadable registry are each a distinct "could not run", never a zero
 *     that reads like a clean tree.
 *  4. **The registry derivation**, because an id it MISSES turns correct
 *     documentation red — the expensive direction.
 *  5. **This repository is green**, and its two illustrative references stay
 *     recognised as illustrative rather than quietly passing for some other
 *     reason.
 *  6. **The gate is wired** where a docs-only pull request can start it.
 *
 * Fixtures are temporary trees, never the real `content/docs`: a committed
 * fixture page would have to carry a deliberately wrong id, and this very gate
 * would then scan it.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = 'scripts/check-doc-example-ids.mjs';
const SCRIPT_PATH = path.join(repoRoot, SCRIPT);

/** A minimal generated index in the shape the real generator writes. */
function catalogIndex(ids: string[]): string {
  const imports = ids.map((id, i) => `import s${i} from './schemas/${id}.json' with { type: 'json' };`).join('\n');
  const entries = ids
    .map(
      (id, i) =>
        `  '${id}': {\n    id: '${id}',\n    meta: { title: "T", description: "", category: '${id.split('/')[0]}' },\n    schema: s${i},\n  },`,
    )
    .join('\n');
  return `${imports}\n\nconst REGISTRY: Record<string, Example> = {\n${entries}\n};\n`;
}

/** Builds a throwaway tree and hands its root to `run`. */
function withTree<T>(build: (write: (rel: string, contents: string) => void) => void, run: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-doc-example-ids-'));
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

/** Spawns the REAL gate over `dir`. This is what CI runs, not a helper of it. */
function gate(dir: string): { status: number; out: string } {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, '--root', dir], { encoding: 'utf8' });
  return { status: result.status ?? -1, out: `${result.stdout}${result.stderr}` };
}

/** A tree whose only defect is whatever the caller writes into `page`. */
function treeWith(page: string): (write: (rel: string, contents: string) => void) => void {
  return (write) => {
    write('examples/schema-catalog/src/index.ts', catalogIndex(['auth/login-simple', 'forms/contact']));
    write('content/docs/fine.mdx', '<SchemaExample id="auth/login-simple" />\n');
    write('content/docs/subject.mdx', page);
  };
}

describe('the firing control — the gate is SEEN to go red', () => {
  it('exits 1 and names the page and the id when a reference does not resolve', () => {
    const { status, out } = withTree(treeWith('<SchemaExample id="forms/no-such-example" />\n'), gate);

    expect(status, 'a gate whose population is clean today must still be able to fail').toBe(1);
    expect(out).toContain('content/docs/subject.mdx');
    expect(out).toContain('forms/no-such-example');
    expect(out).toMatch(/1 reference\(s\) name an id the catalog registry does not carry/);
  });

  it('exits 1 on a `<SchemaExample>` with no id at all — getExample() throws on those too', () => {
    const { status, out } = withTree(treeWith('<SchemaExample className="x" />\n'), gate);

    expect(status).toBe(1);
    expect(out).toMatch(/carry no id at all/);
  });

  it('exits 0 on the same tree once the id is corrected — the red was the id, not the fixture', () => {
    const { status, out } = withTree(treeWith('<SchemaExample id="forms/contact" />\n'), gate);

    expect(status).toBe(0);
    expect(out).toMatch(/2 real reference\(s\) all resolve/);
  });
});

describe('the exemption is a SHAPE rule, not a list of the two strings it matches today', () => {
  it('exempts metasyntax and prints every exemption it took', () => {
    const { status, out } = withTree(
      treeWith('`<SchemaExample id="…" />`\n\n```mdx\n<SchemaExample id="<category>/<your-id>" />\n```\n'),
      gate,
    );

    expect(status).toBe(0);
    expect(out).toContain('elision');
    expect(out).toContain('angle-bracket metavariable');
    // Never a silent skip: the count and both values are in the run's own output.
    expect(out).toMatch(/Exempted 2 illustrative reference\(s\)/);
    expect(out).toContain('id="<category>/<your-id>"');
  });

  it('does NOT exempt a well-formed id that is merely wrong — the typo direction', () => {
    // The failure a literal ledger invites: a value that LOOKS like an id and is
    // not one must stay judged.
    const { status, out } = withTree(treeWith('<SchemaExample id="auth/login-simpel" />\n'), gate);

    expect(status).toBe(1);
    expect(out).toContain('auth/login-simpel');
  });

  it('recognises a placeholder by its marker, and a real id by the absence of one', () => {
    expect(placeholderMarker('<category>/<your-id>')?.name).toBe('angle-bracket metavariable');
    expect(placeholderMarker('…')?.name).toBe('elision');
    expect(placeholderMarker('foo/...')?.name).toBe('elision');
    expect(placeholderMarker('auth/login-simple')).toBeNull();
    expect(placeholderMarker('Auth/Login-Simple'), 'wrong case is a defect, not an illustration').toBeNull();
  });

  it('stops rather than exempting if a real catalog id ever carries a marker', () => {
    // The rule's premise, re-derived on every run. If it dies, the exemption
    // would start swallowing real references — so the gate must refuse to run.
    expect(assertMarkersAreImpossible(['auth/login-simple'])).toEqual([]);
    expect(assertMarkersAreImpossible(['auth/login-simple', 'weird/a...b'])).toHaveLength(1);

    const { status, out } = withTree((write) => {
      write('examples/schema-catalog/src/index.ts', catalogIndex(['auth/login-simple', 'weird/a...b']));
      write('content/docs/fine.mdx', '<SchemaExample id="auth/login-simple" />\n');
    }, gate);

    expect(status, 'a dead premise is "could not run", not "found nothing"').toBe(2);
    expect(out).toMatch(/premise no longer holds/);
  });
});

describe('the scan cannot collapse quietly — a zero is never a clean verdict', () => {
  it('exits 2 when the page walk finds nothing', () => {
    const { status, out } = withTree((write) => {
      write('examples/schema-catalog/src/index.ts', catalogIndex(['auth/login-simple']));
    }, gate);

    expect(status).toBe(2);
    expect(out).toMatch(/found 0 page\(s\)/);
  });

  it('exits 2 when pages are walked but the matcher finds no references', () => {
    const { status, out } = withTree((write) => {
      write('examples/schema-catalog/src/index.ts', catalogIndex(['auth/login-simple']));
      write('content/docs/prose.mdx', 'No tags on this page.\n');
    }, gate);

    expect(status, 'a matcher that has stopped matching reads exactly like a clean tree').toBe(2);
    expect(out).toMatch(/0 <SchemaExample> reference\(s\) found/);
  });

  it('exits 2 when the registry cannot be read', () => {
    const { status, out } = withTree((write) => {
      write('content/docs/page.mdx', '<SchemaExample id="auth/login-simple" />\n');
    }, gate);

    expect(status).toBe(2);
    expect(out).toMatch(/THE GATE COULD NOT RUN/);
  });

  it('exits 2 when its two readings of the generated index disagree', () => {
    const { status, out } = withTree((write) => {
      const index = catalogIndex(['auth/login-simple', 'forms/contact']).replace(
        "import s1 from './schemas/forms/contact.json' with { type: 'json' };\n",
        '',
      );
      write('examples/schema-catalog/src/index.ts', index);
      write('content/docs/page.mdx', '<SchemaExample id="auth/login-simple" />\n');
    }, gate);

    expect(status, 'a half-read registry turns correct pages red — the expensive direction').toBe(2);
    expect(out).toMatch(/disagree/);
  });

  it('exits 2 on an unterminated tag rather than skipping the reference', () => {
    const { status, out } = withTree(treeWith('<SchemaExample id="auth/login-simple"\n'), gate);

    expect(status).toBe(2);
    expect(out).toMatch(/unterminated/);
  });
});

describe('the readers', () => {
  it('does not truncate a tag whose quoted id contains an angle bracket', () => {
    // The exact shape the authoring guide carries. A `<SchemaExample[^>]*>`
    // matcher stops inside the quotes and judges a value nobody wrote.
    const text = '<SchemaExample id="<category>/<your-id>" />';
    expect(findTagEnd(text, 0)).toBe(text.length);
    expect(findTagEnd('<SchemaExample id="a/b" />', 0)).toBe(26);
    expect(findTagEnd('<SchemaExample id="a/b"', 0), 'no terminator means no verdict').toBe(-1);
  });

  it('reads single-quoted and multi-line tags, and skips a longer tag name', () => {
    withTree((write) => {
      write('content/docs/a.mdx', "<SchemaExample\n  id='auth/login-simple'\n/>\n<SchemaExampleGallery id=\"x\" />\n");
    }, (dir) => {
      const { refs, unterminated } = scanReferences(dir, scanDocs(dir));
      expect(unterminated).toEqual([]);
      expect(refs.map((r: { id: string | null }) => r.id)).toEqual(['auth/login-simple']);
      expect(refs[0].line, 'the reported line is the tag opener').toBe(1);
    });
  });

  it('walks .md as well as .mdx, and nothing outside content/docs', () => {
    withTree((write) => {
      write('content/docs/a.mdx', 'x');
      write('content/docs/nested/b.md', 'x');
      write('content/docs/c.txt', 'x');
      write('examples/README.md', 'x');
    }, (dir) => {
      expect(scanDocs(dir)).toEqual(['content/docs/a.mdx', 'content/docs/nested/b.md']);
    });
  });

  it('derives the id universe from the REGISTRY keys, which is what getExample indexes', () => {
    withTree((write) => {
      write('examples/schema-catalog/src/index.ts', catalogIndex(['auth/login-simple', 'forms/contact']));
    }, (dir) => {
      const { keys, imports, error } = deriveCatalogIds(dir);
      expect(error).toBeNull();
      expect(keys).toEqual(['auth/login-simple', 'forms/contact']);
      expect([...imports].sort()).toEqual(['auth/login-simple', 'forms/contact']);
    });
  });

  it('classifies every reference into exactly one bucket', () => {
    const refs = [
      { file: 'a', line: 1, id: 'auth/login-simple' },
      { file: 'a', line: 2, id: 'auth/nope' },
      { file: 'a', line: 3, id: '…' },
      { file: 'a', line: 4, id: null },
    ];
    const { placeholders, resolved, unresolved, missingId } = classify(refs, ['auth/login-simple']);
    expect(resolved).toHaveLength(1);
    expect(unresolved).toHaveLength(1);
    expect(placeholders).toHaveLength(1);
    expect(missingId).toHaveLength(1);
    expect(placeholders.length + resolved.length + unresolved.length + missingId.length).toBe(refs.length);
  });
});

describe('this repository', () => {
  it('is green, over a population this run proves is non-empty', () => {
    const result = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: repoRoot, encoding: 'utf8' });
    const out = `${result.stdout}${result.stderr}`;

    expect(result.status, out).toBe(0);

    // The verdict is only worth something if it was a reading. Take the funnel
    // from the gate's own output rather than asserting a literal that rots.
    const funnel = /walked (\d+) page\(s\).*found (\d+) <SchemaExample> reference\(s\).*against (\d+) catalog id\(s\)/.exec(
      out,
    );
    expect(funnel, 'the gate stopped printing its funnel').not.toBeNull();
    const [, pages, refs, ids] = funnel!.map(Number);
    expect(pages).toBeGreaterThan(50);
    expect(refs).toBeGreaterThan(100);
    expect(ids).toBeGreaterThan(100);
  });

  it('carries its illustrative references as EXEMPTIONS, printed, not as accidental passes', () => {
    const result = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: repoRoot, encoding: 'utf8' });
    const out = `${result.stdout}${result.stderr}`;

    // Both live in the schema-catalog authoring guide: the angle-bracket
    // template in the snippet that teaches the tag, and the ellipsis in the
    // sentence describing it. Neither is a defect and neither is silent.
    expect(out).toMatch(/Exempted \d+ illustrative reference\(s\)/);
    expect(out).toContain('content/docs/guide/schema-catalog.mdx');
    expect(out).toContain('angle-bracket metavariable');
    expect(out).toContain('elision');
  });
});

describe('wiring — the gate is reachable and a docs-only PR starts it', () => {
  const workflowDir = path.join(repoRoot, '.github/workflows');
  const workflowFile = 'repo-gates.yml';
  const workflowPath = path.join(workflowDir, workflowFile);
  const workflowFiles = fs.readdirSync(workflowDir).filter((f) => f.endsWith('.yml'));

  /**
   * A workflow's YAML with whole-line comments removed — these headers name each
   * other's scripts in prose, and a scan that counted comments would report
   * duplicate homes that no file has.
   */
  const yamlOf = (file: string) =>
    fs
      .readFileSync(path.join(workflowDir, file), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');

  it('is exposed as a root package script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['check:doc-example-ids']).toBe(`node ${SCRIPT}`);
  });

  it('does not collide with the three neighbouring doc-example scripts', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    // Adjacent names, separate questions. Each must still point at its own file.
    expect(pkg.scripts['check:doc-examples']).toBe('node scripts/check-doc-example-types.mjs');
    expect(pkg.scripts['check:doc-example-readers']).toBe('node scripts/check-doc-example-shared-reader.mjs');
    expect(pkg.scripts['check:doc-types']).toBe('node scripts/check-doc-component-types.mjs');
  });

  it('has a workflow that gates pull requests, not just pushes', () => {
    expect(fs.existsSync(workflowPath), 'a check nothing runs is not a gate').toBe(true);
    const yaml = yamlOf(workflowFile);
    expect(yaml).toMatch(new RegExp(`run:\\s*node\\s+${SCRIPT.replace(/[.]/g, '\\.')}`));
    expect(yaml).toMatch(/^\s*pull_request:/m);
    expect(yaml).toMatch(/^\s*push:/m);
    expect(yaml).toMatch(/^\s*merge_group:/m);
  });

  it('runs it in NO path-filtered workflow — the change that breaks it is docs-only', () => {
    expect(workflowFiles.length, 'the workflow directory scan returned implausibly few files').toBeGreaterThan(5);
    for (const file of workflowFiles) {
      const yaml = yamlOf(file);
      if (!yaml.includes(SCRIPT)) continue;
      expect(yaml, `${file} runs ${SCRIPT} behind a paths-ignore — a docs-only change would not start it`).not.toMatch(
        /paths-ignore:/,
      );
      expect(yaml, `${file} runs ${SCRIPT} behind a paths filter`).not.toMatch(/^\s+paths:/m);
    }
  });

  it('has exactly one home', () => {
    expect(workflowFiles.filter((f) => yamlOf(f).includes(SCRIPT))).toEqual([workflowFile]);
  });

  it('needs no install, so it can afford to run unfiltered', () => {
    // Since objectui#12214 the home is `repo-gates.yml`, ONE job that installs
    // after its install-free gates: the property is now an ORDER -- this gate's
    // step sits before the job's `pnpm install` -- and no longer an absence.
    const yaml = yamlOf(workflowFile);
    const gateAt = yaml.indexOf('scripts/check-doc-example-ids.mjs');
    const installAt = yaml.indexOf('pnpm install');
    expect(gateAt).toBeGreaterThan(-1);
    expect(installAt === -1 || gateAt < installAt, 'the gate step moved below the install step').toBe(true);
  });

  it('carries no population count in its header — a number in a comment has nothing that fails when it drifts', () => {
    const header = fs
      .readFileSync(workflowPath, 'utf8')
      .split('\n')
      .filter((line) => /^\s*#/.test(line))
      .map((line) => line.replace(/^\s*#\s?/, ''))
      .join('\n');

    // The floor is what makes "no counts here" a reading rather than the absence
    // of one: an extraction that has stopped reading returns '' and passes.
    expect(header.length, 'the header extraction read nothing, so the pin below is vacuous').toBeGreaterThan(400);

    const counts = [
      ...header.matchAll(/(?<![#\w.])\d+(?:,\d{3})*\s+(?:[A-Za-z][\w-]*\s+){0,2}`?(?:\.mdx|\.md|documents?|pages?|docs?|files?|ids?|references?)\b/gi),
    ].map((m) => m[0].replace(/\s+/g, ' ').trim());
    expect(counts).toEqual([]);
  });
});
