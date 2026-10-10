// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Pins the protocol upgrade guide's public address (#22449 B′, condition 2):
// one docs-site page per protocol major plus an index, generated at docs build
// by `build-upgrade-guide.ts` (no flag, or `--docs <dir>`) and never committed.
//
//   - each page says which state its major is in, judged from the tree's own
//     `@objectstack/spec` version, because the site builds from `main` and
//     `main` can carry a major no release ships yet;
//   - a page's hop section is the single-file guide's section, byte for byte —
//     one renderer, two layouts, so the address can never say something the
//     shipped file does not;
//   - the generator replaces only files it wrote, and refuses a directory that
//     holds anything else.
//
// The first block drives `lib/upgrade-guide-docs.ts` with fixture sections; the
// second spawns the REAL generator into a temporary directory.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildDocsPages,
  DOCS_DIR,
  DOCS_ROUTE,
  majorRoute,
  releaseStatus,
  writeDocsPages,
  type DocsPagesInput,
} from './lib/upgrade-guide-docs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const TSX = path.join(PKG, 'node_modules', '.bin', 'tsx');
const SPAWN_TIMEOUT_MS = 120_000;

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'upgrade-guide-docs-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** The `---` block's `key: "value"` lines, JSON-decoded; null when there is no leading block. */
function frontmatterOf(text: string): Record<string, string> | null {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return null;
  const out: Record<string, string> = {};
  for (const line of m[1]!.split('\n')) {
    const kv = /^(\w+): (.*)$/.exec(line);
    if (kv) out[kv[1]!] = JSON.parse(kv[2]!) as string;
  }
  return out;
}

/** Lines outside fenced code blocks. */
function proseLines(text: string): string[] {
  let fenced = false;
  return text.split('\n').filter((line) => {
    if (line.startsWith('```')) {
      fenced = !fenced;
      return false;
    }
    return !fenced;
  });
}

function fixture(specVersion: string): DocsPagesInput {
  return {
    specVersion,
    howToUpgrade: ['## How to upgrade — from protocol 16 onward', '', 'run the chain', ''],
    hops: [
      { major: 17, section: ['## Protocol 16 → 17', '', 'seventeen', ''] },
      { major: 18, section: ['## Protocol 17 → 18', '', 'eighteen', ''] },
    ],
    footer: ['---', '', '*equivalents*', ''],
  };
}

describe('releaseStatus — which state a protocol major is in, from the tree’s own spec version', () => {
  it('a major above the package major is unreleased (the pre-mode pending major)', () => {
    expect(releaseStatus(18, '17.7.0')).toBe('unreleased');
  });

  it('a major equal to a prerelease package major is in prerelease', () => {
    expect(releaseStatus(18, '18.0.0-next.3')).toBe('prerelease');
  });

  it('a major at or below a released package major is released', () => {
    expect(releaseStatus(17, '17.7.0')).toBe('released');
    expect(releaseStatus(18, '18.0.0')).toBe('released');
    expect(releaseStatus(17, '18.0.0-next.0')).toBe('released');
  });

  it('a version that is not MAJOR.MINOR.PATCH[-PRE] is refused, never guessed', () => {
    expect(() => releaseStatus(18, '18')).toThrow(/not MAJOR\.MINOR\.PATCH/);
    expect(() => releaseStatus(18, 'workspace:*')).toThrow(/not MAJOR\.MINOR\.PATCH/);
  });
});

describe('buildDocsPages — the generated tree', () => {
  it('writes one page per major, an index and a meta.json listing them newest first', () => {
    const files = buildDocsPages(fixture('17.7.0'));

    expect([...files.keys()].sort()).toEqual(['17.md', '18.md', 'index.md', 'meta.json']);
    expect(JSON.parse(files.get('meta.json')!)).toEqual({ title: 'Protocol Upgrade Guide', pages: ['index', '18', '17'] });
  });

  it('every page carries a parseable title and description and no body h1', () => {
    const files = buildDocsPages(fixture('17.7.0'));

    for (const name of ['index.md', '17.md', '18.md']) {
      const text = files.get(name)!;
      const fm = frontmatterOf(text);
      expect(fm, name).not.toBeNull();
      expect(fm!.title, name).toBeTruthy();
      expect(fm!.description, name).toBeTruthy();
      const body = text.slice(text.indexOf('\n---\n', 4) + 5);
      expect(proseLines(body).filter((line) => line.startsWith('# ')), name).toEqual([]);
    }
    expect(frontmatterOf(files.get('18.md')!)!.title).toBe('Protocol 17 → 18 upgrade guide');
  });

  it('each page states its major’s state, and the index lists every page with its state', () => {
    const files = buildDocsPages(fixture('17.7.0'));

    expect(files.get('18.md')).toContain('> **Not released yet.** Protocol 18 ships in no published');
    expect(files.get('17.md')).toContain('> **Released.** Protocol 17 ships in');
    const index = files.get('index.md')!;
    expect(index).toContain(`| 17 → 18 | [${majorRoute(18)}](${majorRoute(18)}) | unreleased |`);
    expect(index).toContain(`| 16 → 17 | [${majorRoute(17)}](${majorRoute(17)}) | released |`);

    expect(buildDocsPages(fixture('18.0.0-next.0')).get('18.md')).toContain('> **Prerelease.** Protocol 18');
  });

  it('a page is the shared sections around its own hop, and only its own', () => {
    const page = buildDocsPages(fixture('17.7.0')).get('18.md')!;

    expect(page).toContain('## How to upgrade — from protocol 16 onward\n\nrun the chain\n');
    expect(page).toContain('## Protocol 17 → 18\n\neighteen\n');
    expect(page).not.toContain('seventeen');
    expect(page.endsWith('---\n\n*equivalents*\n')).toBe(true);
  });

  it('serves the tree at /docs/protocol-upgrade, one route per major', () => {
    expect(DOCS_DIR).toBe('content/docs/protocol-upgrade');
    expect(DOCS_ROUTE).toBe('/docs/protocol-upgrade');
    expect(majorRoute(19)).toBe('/docs/protocol-upgrade/19');
  });
});

describe('writeDocsPages — replaces only what it wrote', () => {
  it('drops a page whose major left the registries, and writes the rest', () => {
    const dir = path.join(tmp, 'protocol-upgrade');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, '16.md'), 'a hop below the support floor');

    writeDocsPages(dir, buildDocsPages(fixture('17.7.0')));

    expect(fs.readdirSync(dir).sort()).toEqual(['17.md', '18.md', 'index.md', 'meta.json']);
  });

  it('refuses a directory holding a file it did not write, and leaves it untouched', () => {
    const dir = path.join(tmp, 'docs');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'upgrading.mdx'), 'hand-written');
    fs.writeFileSync(path.join(dir, '17.md'), 'old');

    expect(() => writeDocsPages(dir, buildDocsPages(fixture('17.7.0')))).toThrow(/upgrading\.mdx.*refusing to replace it/);
    expect(fs.readdirSync(dir).sort()).toEqual(['17.md', 'upgrading.mdx']);
    expect(fs.readFileSync(path.join(dir, '17.md'), 'utf8')).toBe('old');
  });
});

describe('the real generator writes the docs pages from the same renderer as the shipped file', () => {
  function run(args: string[]): { status: number; output: string } {
    const r = spawnSync(TSX, [path.join(HERE, 'build-upgrade-guide.ts'), ...args], {
      cwd: PKG,
      encoding: 'utf8',
      timeout: SPAWN_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  }

  /** The single file's `## Protocol N-1 → N` sections, keyed by N. */
  function sectionsOf(text: string): Map<number, string> {
    const sections = new Map<number, string>();
    const body = text.slice(0, text.lastIndexOf('\n---\n') + 1);
    const parts = body.split(/^(?=## Protocol \d+ → \d+$)/m).slice(1);
    for (const part of parts) sections.set(Number(/→ (\d+)/.exec(part)![1]), part);
    return sections;
  }

  it('--docs writes one page per hop of the single-file guide, each holding that hop verbatim', () => {
    const file = path.join(tmp, 'guide.md');
    const dir = path.join(tmp, 'pages');

    expect(run(['--out', file]).status).toBe(0);
    const docs = run(['--docs', dir]);
    expect(docs.status, docs.output).toBe(0);

    const sections = sectionsOf(fs.readFileSync(file, 'utf8'));
    expect(sections.size).toBeGreaterThan(0);
    const majors = [...sections.keys()].sort((a, b) => b - a);
    expect(fs.readdirSync(dir).sort()).toEqual([...majors.map((m) => `${m}.md`), 'index.md', 'meta.json'].sort());
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).pages).toEqual([
      'index',
      ...majors.map(String),
    ]);
    for (const [major, section] of sections) {
      expect(fs.readFileSync(path.join(dir, `${major}.md`), 'utf8')).toContain(section);
    }
  });

  it('--docs is deterministic across runs', () => {
    const first = path.join(tmp, 'first');
    const second = path.join(tmp, 'second');

    expect(run(['--docs', first]).status).toBe(0);
    expect(run(['--docs', second]).status).toBe(0);

    for (const name of fs.readdirSync(first)) {
      expect(fs.readFileSync(path.join(second, name)).equals(fs.readFileSync(path.join(first, name))), name).toBe(true);
    }
  });

  it('--docs with --check or --out, or with no directory, is a usage error that writes nothing', () => {
    const dir = path.join(tmp, 'never');

    expect(run(['--docs', dir, '--check']).status).toBe(2);
    expect(run(['--docs', dir, '--out', path.join(tmp, 'x.md')]).status).toBe(2);
    expect(run(['--docs']).status).toBe(2);
    expect(run(['--docs', '--check']).status).toBe(2);
    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  it('--docs at a directory holding a hand-written file is red and removes nothing', () => {
    const dir = path.join(tmp, 'docs');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'upgrading.mdx'), 'hand-written');

    const r = run(['--docs', dir]);

    expect(r.status).toBe(1);
    expect(r.output).toContain('refusing to replace it');
    expect(fs.readdirSync(dir)).toEqual(['upgrading.mdx']);
  });
});
