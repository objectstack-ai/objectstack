import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * objectui#4149: `QUICK_REFERENCE.md`'s command and layout sections were dead.
 *
 * objectui#4143 repaired and pinned the file's "Current Release" block, and argued the
 * rest of the page was observation-class because "no copy-pasteable instruction is
 * wrong". On the tree that landed it, four of them were — and this is the worse class,
 * because a stale version number misleads while a dead command simply fails:
 *
 *   - `pnpm typecheck` → `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "typecheck" not
 *     found. Did you mean "pnpm type-check"?` There has never been a `typecheck` script.
 *   - all three documented `example-*` dev commands named packages that do not exist
 *     (`example-crm`, `example-todo`, `example-kitchen-sink`), while the two examples
 *     that DO run dev servers went unmentioned. Worse than an error: pnpm prints
 *     `No projects matched the filters` and exits **0**, so a script following this
 *     page succeeds while doing nothing.
 *   - `apps/server` was listed in the Repository Layout table; `apps/` holds `console`
 *     and `site`.
 *   - `packages/tenant` was listed in the Package Tiers table; that package was deleted
 *     by objectui#2564 (commit d5b1bc0b4).
 *
 * ## Why this is a sibling file and not more `it`s in the #4143 pin
 *
 * `quick-reference-current-release-4143.test.ts` is scoped, in its own words, to the
 * `## Current Release` section — deliberately, because "`## Repository Layout` above it
 * also carries numbers, and asserting over the whole file would conflate a status claim
 * with a package count". That scoping is load-bearing for its reverse direction (no
 * un-derived version literal), which would go red on this page's ports and counts if it
 * were widened. So the two files split by section, and this one never reads
 * `## Current Release`.
 *
 * ## What is pinned here, and what is deliberately not
 *
 * Pinned: everything with a machine anchor — script names (root `package.json`
 * `scripts`), workspace package names and their scripts (the `pnpm-workspace.yaml`
 * globs), filesystem paths, and the published-package count.
 *
 * The internal links used to be pinned here too, and are not any more. That block was
 * written as an explicit stopgap: this page sat outside every `SCAN_ROOTS` entry in
 * `scripts/check-doc-links.mjs`, so nothing that could fail a build resolved its links.
 * objectui#4148 added the row, and the stopgap was deleted with it — the real gate
 * judges this page on every push now, under the same `disk` rule as every other
 * GitHub-read markdown file, and two implementations of one check is one more than gets
 * maintained.
 *
 * Not pinned, on purpose: the prose descriptions, the comment text after each command,
 * and the dev-server ports of the examples — a port lives in a `vite.config.ts`
 * `server.port` that not every example sets, so the page points at
 * `examples/README.md` instead of quoting numbers it cannot derive. The rule this file
 * follows is the one #4143 established: derive the expectation from the anchor, never
 * write the value a second time.
 *
 * There is also no reverse "every root script must be documented" direction. The root
 * manifest declares ~50 scripts and this is a one-page cheat-sheet; requiring it to
 * enumerate them would turn a curated page into a generated one, and the failure this
 * card is about is a documented command that does not exist, not an existing command
 * that is undocumented.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const docRel = 'QUICK_REFERENCE.md';
const doc = fs.readFileSync(path.join(repoRoot, docRel), 'utf8');

interface Manifest {
  name?: string;
  private?: boolean;
  scripts?: Record<string, string>;
}

function manifest(rel: string): Manifest {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8')) as Manifest;
}

const rootScripts = new Set(Object.keys(manifest('package.json').scripts ?? {}));

/**
 * The `packages:` globs from `pnpm-workspace.yaml`, read rather than hardcoded, in the
 * shape `package-files-exist.test.ts` and `react-peer-range-norm-3741.test.ts` already
 * use here: understand the two syntaxes the file actually uses and throw on anything
 * else, because a guard that silently stops looking at part of the workspace goes on
 * reporting success over a shrinking surface.
 */
function workspaceGlobs(): string[] {
  const yaml = fs.readFileSync(path.join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => /^packages:\s*$/.test(l));
  expect(start, '`pnpm-workspace.yaml` must still declare a top-level `packages:` key').toBeGreaterThan(-1);

  const globs: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    if (!/^\s/.test(line)) break; // a non-indented line ends the block
    const match = line.match(/^\s*-\s*['"]?([^'"#\s]+)['"]?\s*(#.*)?$/);
    if (!match) {
      throw new Error(
        `Unparsed entry in pnpm-workspace.yaml \`packages:\`: ${JSON.stringify(line)} — teach this guard the new syntax.`,
      );
    }
    globs.push(match[1]);
  }
  return globs;
}

interface WorkspacePackage {
  /** Repo-relative directory, e.g. `examples/console-starter`. */
  dir: string;
  name: string;
  private: boolean;
  scripts: Set<string>;
}

function readWorkspacePackages(): WorkspacePackage[] {
  const found: WorkspacePackage[] = [];

  for (const glob of workspaceGlobs()) {
    let dirs: string[];
    if (glob.endsWith('/*')) {
      const parent = path.join(repoRoot, glob.slice(0, -2));
      dirs = fs.existsSync(parent)
        ? fs
            .readdirSync(parent)
            .map((d) => path.join(parent, d))
            .filter((d) => fs.statSync(d).isDirectory())
        : [];
    } else if (!glob.includes('*')) {
      dirs = [path.join(repoRoot, glob)];
    } else {
      throw new Error(`Unsupported workspace glob ${JSON.stringify(glob)} — teach this guard how to expand it.`);
    }

    for (const dir of dirs) {
      const pkgPath = path.join(dir, 'package.json');
      if (!fs.existsSync(pkgPath)) continue;
      const json = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as Manifest;
      if (!json.name) continue;
      found.push({
        dir: path.relative(repoRoot, dir).split(path.sep).join('/'),
        name: json.name,
        private: json.private === true,
        scripts: new Set(Object.keys(json.scripts ?? {})),
      });
    }
  }

  return found;
}

const workspacePackages = readWorkspacePackages();
const byName = new Map(workspacePackages.map((p) => [p.name, p]));

/**
 * A section of the page, from its heading to the next heading of the same or higher
 * level. Used to scope the two reverse directions to the block that owns the claim.
 */
function section(heading: string): string {
  const lines = doc.split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) throw new Error(`${docRel} must still have a "${heading}" heading`);

  const level = (heading.match(/^#+/) as RegExpMatchArray)[0].length;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,6} /.test(line) && (line.match(/^#+/) as RegExpMatchArray)[0].length <= level);
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/**
 * Commands this page tells a reader to run: the ` ```bash ` fences only.
 *
 * The page also quotes one plain ``` fence — the vitest guard's rejection message,
 * which is program output rather than an instruction authored here. It is pinned
 * against its own source below instead, so that quoting it verbatim stays honest
 * without this parser having to tell the two kinds of block apart by their content.
 */
function documentedCommands(): string[] {
  const out: string[] = [];
  for (const block of doc.matchAll(/```bash\n([\s\S]*?)```/g)) {
    for (const raw of block[1].split('\n')) {
      const command = raw.replace(/\s+#.*$/, '').trim();
      if (command.startsWith('pnpm ') || command === 'pnpm') out.push(command);
    }
  }
  return out;
}

const commands = documentedCommands();

/** pnpm's own subcommands, which are not root scripts and are not ours to check. */
const PNPM_BUILTINS = new Set(['install', 'exec', 'dlx', 'add', 'remove', 'run', 'why', 'ls', 'store']);

describe('QUICK_REFERENCE.md — every documented `pnpm` command exists', () => {
  it('finds commands to check at all', () => {
    // Guards the parser, not the doc: a fence-syntax change that made
    // `documentedCommands()` return nothing would turn every assertion below into a
    // vacuous pass, which is the failure mode a doc gate can least afford.
    expect(commands.length, `${docRel} must still document \`pnpm\` commands in \`\`\`bash fences`).toBeGreaterThan(5);
  });

  it('names only scripts the root `package.json` declares', () => {
    const dead: string[] = [];

    for (const command of commands) {
      const tokens = command.split(/\s+/).slice(1);
      if (tokens.length === 0) continue;
      if (tokens[0] === '--filter' || tokens[0].startsWith('-')) continue; // covered by the filter test
      const [first] = tokens;
      if (PNPM_BUILTINS.has(first)) continue;
      if (!rootScripts.has(first)) dead.push(`${command}   (no root script "${first}")`);
    }

    expect(
      dead,
      `${docRel} documents ${JSON.stringify(dead)}. Each is a copy-pasteable line that fails: ` +
        'the root `package.json` `scripts` block is the anchor, and `pnpm typecheck` (objectui#4149) ' +
        `is what happens when nothing checks it. Declared scripts: ${JSON.stringify([...rootScripts].sort())}.`,
    ).toEqual([]);
  });

  it('filters on workspace packages that exist and declare the script it runs', () => {
    const broken: string[] = [];

    for (const command of commands) {
      const tokens = command.split(/\s+/);
      const at = tokens.indexOf('--filter');
      if (at === -1) continue;

      const selector = tokens[at + 1];
      const script = tokens.slice(at + 2).find((t) => !t.startsWith('-'));
      const pkg = byName.get(selector);

      if (!pkg) {
        broken.push(`${command}   (no workspace package named "${selector}")`);
        continue;
      }
      if (script && !pkg.scripts.has(script)) {
        broken.push(`${command}   ("${selector}" declares no "${script}" script)`);
      }
    }

    expect(
      broken,
      `${docRel} documents ${JSON.stringify(broken)}. A filter that matches nothing is the ` +
        'objectui#4149 defect in its worst form: pnpm prints "No projects matched the filters" and ' +
        `exits 0, so a reader's script "succeeds". Workspace packages: ${JSON.stringify([...byName.keys()].sort())}.`,
    ).toEqual([]);
  });
});

describe('QUICK_REFERENCE.md — the "Run Examples" section covers the examples that run', () => {
  /**
   * The reverse direction, and the one that would have caught this card before it was
   * filed. The forward test above only says the documented examples exist; it stays
   * green on a page that documents nothing. What was actually wrong is that the two
   * runnable examples were BOTH missing while three phantoms were listed.
   *
   * "Runnable" is derived, not judged: an `examples/*` package is a dev server exactly
   * when its manifest declares a `dev` script. `hello-world` (a snippet) and
   * `schema-catalog` (a data package) declare none, so they are correctly absent from
   * the command block — and the day either grows one, this goes red.
   */
  it('documents a dev command for every `examples/*` package that declares one', () => {
    const runnable = workspacePackages.filter((p) => p.dir.startsWith('examples/') && p.scripts.has('dev'));
    expect(
      runnable.length,
      'no `examples/*` package declares a `dev` script any more — the "Run Examples" section ' +
        'is now describing something that does not exist and needs rewriting, not re-pinning',
    ).toBeGreaterThan(0);

    const block = section('### Run Examples');
    const missing = runnable.filter((p) => !block.includes(`--filter ${p.name} dev`));

    expect(
      missing.map((p) => p.name),
      `${docRel}'s "Run Examples" section documents no \`pnpm --filter <name> dev\` line for ` +
        `${JSON.stringify(missing.map((p) => p.dir))}. Before objectui#4149 this section listed three ` +
        'packages that did not exist and neither of the two that did, so a newcomer following it got ' +
        'nothing runnable at all.',
    ).toEqual([]);
  });
});

describe('QUICK_REFERENCE.md — every path it names is in the tree', () => {
  /**
   * A path claim, in the spellings this page uses: an inline-code span with no
   * whitespace and at least one `/`. Placeholders (`packages/<pkg>/`) and package names
   * (`@object-ui/site`, `@objectstack/spec`) are excluded by construction rather than by
   * an allowlist — the first carry angle brackets, the second start with `@`.
   */
  const PATH_LIKE = /`([^`\s]+)`/g;

  function pathClaims(): string[] {
    const out = new Set<string>();
    for (const match of doc.matchAll(PATH_LIKE)) {
      const token = match[1];
      if (token.includes('<') || token.includes('>')) continue;
      if (token.startsWith('@') || token.includes('://')) continue;
      if (token.includes('/')) out.add(token);
      else if (/^[\w.-]+\.(md|mjs|mts|ts|json|yaml)$/.test(token)) out.add(token);
    }
    return [...out];
  }

  it('resolves every path in a code span, and every glob to at least one directory', () => {
    const claims = pathClaims();
    expect(claims.length, `${docRel} must still name paths in code spans`).toBeGreaterThan(5);

    const dead: string[] = [];
    for (const claim of claims) {
      const cleaned = claim.replace(/\/$/, '');
      if (cleaned.includes('*')) {
        const dir = path.dirname(cleaned);
        const pattern = new RegExp(`^${path.basename(cleaned).replace(/\*/g, '.*')}$`);
        const parent = path.join(repoRoot, dir);
        const matches = fs.existsSync(parent) ? fs.readdirSync(parent).filter((e) => pattern.test(e)) : [];
        if (matches.length === 0) dead.push(`${claim}   (matches nothing)`);
        continue;
      }
      if (!fs.existsSync(path.join(repoRoot, cleaned))) dead.push(`${claim}   (not in the tree)`);
    }

    expect(
      dead,
      `${docRel} names ${JSON.stringify(dead)}. objectui#4149 found two of these: \`apps/server\`, ` +
        'gone with the Vercel backend, and `packages/tenant`, deleted by objectui#2564 — both still ' +
        'sitting in tables that a reader uses to navigate the repo.',
    ).toEqual([]);
  });

  /**
   * The reverse direction for `apps/`, which the layout table enumerates one row per
   * app (unlike `packages/*`, which it summarises). Forward catches a row whose app was
   * deleted; this catches an app that was added and never listed — the same rot, one
   * direction over.
   */
  it('gives every directory under `apps/` a row in the Repository Layout table', () => {
    const layout = section('## Repository Layout');
    const apps = fs
      .readdirSync(path.join(repoRoot, 'apps'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => `apps/${e.name}`);

    const unlisted = apps.filter((app) => !layout.includes(`\`${app}\``));
    expect(
      unlisted,
      `${docRel}'s Repository Layout table has no row for ${JSON.stringify(unlisted)}. The table ` +
        'lists apps individually, so a new one is invisible to a reader until someone adds it.',
    ).toEqual([]);
  });
});

describe('QUICK_REFERENCE.md — the published-package count is derived', () => {
  /**
   * The count kept a number rather than becoming a pointer, because unlike a churning
   * enumeration it has an exact anchor (`private` in each manifest) and it tells the
   * reader something a pointer cannot: the scale of the repo. What it may not do is be
   * written by hand — "39 published packages" counted directories, and
   * `packages/vscode-extension` (published to the VS Code marketplace, not to npm) is
   * `private: true`. Off by one, in the direction that overstates.
   */
  const packagesRow = (): string => {
    const layout = section('## Repository Layout');
    const row = layout.split('\n').find((line) => line.startsWith('| `packages/*` |'));
    expect(row, `${docRel}'s Repository Layout table must still have a \`packages/*\` row`).toBeDefined();
    return row as string;
  };

  const inPackages = workspacePackages.filter((p) => p.dir.startsWith('packages/'));
  const published = inPackages.filter((p) => !p.private);
  const privateOnes = inPackages.filter((p) => p.private);

  it('states the number of packages that are actually published', () => {
    expect(
      packagesRow(),
      `${docRel} must state "${published.length} published packages" — that is how many manifests ` +
        `under \`packages/\` are not \`private: true\` (${inPackages.length} directories, ` +
        `${privateOnes.length} of them private: ${JSON.stringify(privateOnes.map((p) => p.dir))})`,
    ).toContain(`${published.length} published`);
  });

  it('accounts for the private packages instead of quietly dropping them', () => {
    if (privateOnes.length === 0) {
      // Nothing to reconcile: the count and the directory listing agree, so the row
      // saying only "N published packages" is complete. This branch exists so the
      // requirement below retires itself the day the last private package leaves.
      return;
    }

    const row = packagesRow();
    expect(
      row,
      `${docRel}'s \`packages/*\` row states a published count that is smaller than the ` +
        `${inPackages.length} directories a reader sees there. It must say why — name the private ` +
        `package(s) ${JSON.stringify(privateOnes.map((p) => p.name))} — or the next reader "corrects" ` +
        'the number back to the directory count, which is exactly how objectui#4149 happened.',
    ).toMatch(/private/i);

    for (const pkg of privateOnes) {
      expect(row, `${docRel}'s \`packages/*\` row must name the private package "${pkg.dir}"`).toContain(
        path.basename(pkg.dir),
      );
    }
  });

  it('keeps the `@object-ui/*` parenthetical true', () => {
    const misnamed = published.filter((p) => !p.name.startsWith('@object-ui/'));
    expect(
      misnamed.map((p) => `${p.dir} → ${p.name}`),
      `${docRel}'s \`packages/*\` row calls the published packages \`@object-ui/*\`, but these are not`,
    ).toEqual([]);
  });
});

describe('QUICK_REFERENCE.md — the quoted vitest-guard message is still what the guard prints', () => {
  /**
   * The page quotes the guard's rejection box so a reader recognises it. Two of the five
   * quoted lines are built by interpolation in `canonicalLines()`
   * (`  pnpm exec vitest run ${file}   # 只跑一个文件`), so they are not literals in the
   * source and are not asserted here — that is the "brittle prose stays unpinned rather
   * than force-parsed" half of objectui#4149. The three that ARE literals are asserted,
   * which is enough to catch the guard being reworded out from under the quote.
   */
  it('quotes lines that appear verbatim in `scripts/vitest-invocation-guard.mjs`', () => {
    const guardRel = 'scripts/vitest-invocation-guard.mjs';
    const guard = fs.readFileSync(path.join(repoRoot, guardRel), 'utf8');

    const quoted = ['vitest 调用被拒绝:从包目录跑 vitest 会静默跑错测试集 (objectui#3378)', 'pnpm test   # 全量'];

    for (const line of quoted) {
      expect(doc, `${docRel} must still quote the guard line ${JSON.stringify(line)}`).toContain(line);
      expect(
        guard,
        `${docRel} quotes ${JSON.stringify(line)} as the guard's output, but ${guardRel} no longer ` +
          'contains that text — the quote has drifted from the program it claims to reproduce',
      ).toContain(line);
    }
  });
});
