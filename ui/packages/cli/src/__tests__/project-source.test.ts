/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Pins the project-root / routing detection surface `dev`, `serve` and `build`
 * share (objectui#4923).
 *
 * Measured before the fix, fixture `<root>/app.json` + `<root>/pages/index.json`
 * invoked from the directory above:
 *
 * - `dev`   → `Detected project structure at <root>` … `✓ Found 1 route(s)`
 * - `serve` → `📋 Loading schema: <root>/app.json` (single-schema mode)
 * - `build` → same, **exit 0**, with the app config embedded in the bundle as
 *   the page schema and no page from `pages/` in the output at all.
 *
 * Two commands out of three read the argument's directory, one read `cwd` only,
 * and the losing reading failed silently. So the tests below judge one shared
 * resolver, plus the property that all three reach it.
 *
 * ## Why there are no module mocks here
 *
 * A command-layer test that let a command run to completion would need `vite`
 * stubbed, and the `unit` project runs with `isolate: false` — a mocked shared
 * util would be visible to every other file in the worker. Instead the
 * command-layer group uses inputs whose verdict is decided *inside* the
 * detection step, so each command throws before it reaches Vite, `mkdirSync` or
 * `npm install`: an empty `pages/` directory (the error names the directory that
 * was scanned, which is exactly the fact that used to differ between the three)
 * and the two single-schema failures. The positive routed case is pinned on the
 * resolver, which is the same call all three now make.
 */

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../commands/build.js';
import { dev } from '../commands/dev.js';
import { serve } from '../commands/serve.js';
import { reportProjectSource, resolveProjectSource } from '../utils/project-source.js';

/**
 * Strip ANSI colors so an assertion holds whether or not chalk is enabled.
 *
 * The escape character is BUILT, never written: an editing tool materializes a
 * backslash-u escape into a real control byte precisely when the subject is
 * control bytes (objectui#4890), and one raw byte makes grep read the whole file
 * as binary — zero matches, no signal.
 */
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const stripAnsi = (text: string): string => text.replace(ANSI_PATTERN, '');

/** packages/cli/src/__tests__ -> packages/cli/src/commands */
const COMMAND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../commands');

const APP_CONFIG = { name: 'fixture_app', title: 'Issue 4923 Fixture App' };
const PAGE = { type: 'text', content: 'fixture home page' };

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function writeRaw(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

/**
 * Run `body` against a fresh temp directory that stands in for the directory
 * ABOVE the project — the invocation shape the card measured.
 *
 * `realpathSync` because the resolver derives its answers from the path it is
 * given, and on platforms where `tmpdir()` is a symlink an un-normalized base
 * would compare unequal to a directory name the resolver returned.
 */
async function withParentDir(body: (parent: string) => void | Promise<void>): Promise<void> {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'objectui-4923-')));
  try {
    await body(parent);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}

/** The card's fixture: an app config with a `pages/` directory beside it. */
function writeProject(parent: string, name = 'app'): string {
  const root = join(parent, name);
  writeJson(join(root, 'app.json'), APP_CONFIG);
  writeJson(join(root, 'pages/index.json'), PAGE);
  return root;
}

/**
 * The three commands, each reduced to "resolve, then render".
 *
 * Every input handed to these below is decided inside the detection step, so
 * none of the calls reaches Vite: they are the command layer's own answer to
 * "what is this project", read off the thrown error. Shared by both parity
 * groups (objectui#4923, objectui#5037) so "all three answer identically" is
 * asserted against one list rather than two copies of it.
 */
const commands: ReadonlyArray<readonly [string, (schema: string) => Promise<unknown>]> = [
  ['dev', (schema) => dev(schema, { port: '0', host: 'localhost', open: false })],
  ['serve', (schema) => serve(schema, { port: '0', host: 'localhost' })],
  ['build', (schema) => buildApp(schema, { outDir: 'dist' })]
];

describe('resolveProjectSource — anchoring on the argument (objectui#4923)', () => {
  it('finds the project from a directory above it', async () => {
    await withParentDir((parent) => {
      const root = writeProject(parent);
      const source = resolveProjectSource(parent, 'app/app.json');

      expect(source.mode).toBe('routes');
      if (source.mode !== 'routes') return;
      expect(source.projectRoot).toBe(root);
      expect(source.pagesDir).toBe(join(root, 'pages'));
      expect(source.pagesDirOrigin).toBe('schema-dir');
      expect(source.routes.map((route) => route.path)).toEqual(['/']);
      expect(source.appConfig).toEqual(APP_CONFIG);
      expect(source.appConfigPath).toBe(join(root, 'app.json'));
      expect(source.warnings).toEqual([]);
    });
  });

  it('answers the same for one project however the invocation is spelled', async () => {
    // The regression guard for the path that already worked: invoking from
    // inside the project must keep resolving to the same project.
    await withParentDir((parent) => {
      const root = writeProject(parent);
      const fromAbove = resolveProjectSource(parent, 'app/app.json');
      const fromInside = resolveProjectSource(root, 'app.json');
      const fromAbsolute = resolveProjectSource(parent, join(root, 'app.json'));

      for (const source of [fromAbove, fromInside, fromAbsolute]) {
        expect(source.mode).toBe('routes');
        if (source.mode !== 'routes') continue;
        expect(source.projectRoot).toBe(root);
        expect(source.pagesDir).toBe(join(root, 'pages'));
        expect(source.routes.map((route) => route.filePath)).toEqual([join(root, 'pages/index.json')]);
        expect(source.appConfig).toEqual(APP_CONFIG);
      }
    });
  });

  it('reads the whole route set, dynamic routes last', async () => {
    await withParentDir((parent) => {
      const root = writeProject(parent);
      writeJson(join(root, 'pages/about.json'), PAGE);
      writeJson(join(root, 'pages/users/[id].json'), PAGE);

      const source = resolveProjectSource(parent, 'app/app.json');
      expect(source.mode).toBe('routes');
      if (source.mode !== 'routes') return;
      expect(source.routes.map((route) => route.path)).toEqual(['/', '/about', '/users/:id']);
    });
  });

  it("prefers the argument's project over the working directory's", async () => {
    await withParentDir((parent) => {
      // The parent is itself a project — the reading `serve`/`build` used to
      // have. The argument names a different one, and the argument wins.
      writeJson(join(parent, 'app.json'), { name: 'outer_app' });
      writeJson(join(parent, 'pages/index.json'), PAGE);
      const root = writeProject(parent, 'inner');

      const source = resolveProjectSource(parent, 'inner/app.json');
      expect(source.mode).toBe('routes');
      if (source.mode !== 'routes') return;
      expect(source.pagesDir).toBe(join(root, 'pages'));
      expect(source.pagesDirOrigin).toBe('schema-dir');
      expect(source.appConfig).toEqual(APP_CONFIG);
    });
  });

  it('falls back to the working directory when the argument names no project', async () => {
    // `objectui dev` with the default `app.json` argument, in a project that has
    // no app config — and `objectui dev pages/`, the documented directory form.
    await withParentDir((parent) => {
      writeJson(join(parent, 'pages/index.json'), PAGE);

      const noAppConfig = resolveProjectSource(parent, 'app.json');
      expect(noAppConfig.mode).toBe('routes');
      if (noAppConfig.mode !== 'routes') return;
      expect(noAppConfig.projectRoot).toBe(parent);
      expect(noAppConfig.pagesDirOrigin).toBe('cwd');
      expect(noAppConfig.appConfig).toBeNull();
      expect(noAppConfig.appConfigPath).toBeNull();

      // `objectui dev pages/` from inside the project reaches the SAME routed
      // answer, but since objectui#5037 it is step ① that gives it: the
      // argument names the pages directory, so it no longer needs the cwd
      // fallback to catch it by coincidence. Only the origin label moved.
      writeJson(join(parent, 'app.json'), APP_CONFIG);
      const viaPagesDir = resolveProjectSource(parent, 'pages');
      expect(viaPagesDir.mode).toBe('routes');
      if (viaPagesDir.mode !== 'routes') return;
      expect(viaPagesDir.pagesDirOrigin).toBe('argument-dir');
      expect(viaPagesDir.projectRoot).toBe(parent);
      expect(viaPagesDir.pagesDir).toBe(join(parent, 'pages'));
      expect(viaPagesDir.appConfig).toEqual(APP_CONFIG);
    });
  });

  it('keeps a lone schema file rendering on its own', async () => {
    // Single-schema mode is legitimate input, not a casualty of the fix.
    await withParentDir((parent) => {
      writeJson(join(parent, 'solo/page.json'), PAGE);

      const source = resolveProjectSource(parent, 'solo/page.json');
      expect(source.mode).toBe('schema');
      if (source.mode !== 'schema') return;
      expect(source.schemaFile).toBe(join(parent, 'solo/page.json'));
      expect(source.schema).toEqual(PAGE);
      expect(source.warnings).toEqual([]);
    });
  });

  it('warns instead of failing when the app config is malformed', async () => {
    await withParentDir((parent) => {
      const root = join(parent, 'app');
      writeRaw(join(root, 'app.json'), '{ "name": ');
      writeJson(join(root, 'pages/index.json'), PAGE);

      const source = resolveProjectSource(parent, 'app/app.json');
      expect(source.mode).toBe('routes');
      if (source.mode !== 'routes') return;
      expect(source.routes).toHaveLength(1);
      expect(source.appConfig).toBeNull();
      expect(source.warnings).toHaveLength(1);
      expect(source.warnings[0]).toContain('Failed to parse app config');
    });
  });

  it('refuses an empty pages directory, naming the directory it scanned', async () => {
    await withParentDir((parent) => {
      const root = join(parent, 'app');
      writeJson(join(root, 'app.json'), APP_CONFIG);
      mkdirSync(join(root, 'pages'), { recursive: true });

      expect(() => resolveProjectSource(parent, 'app/app.json')).toThrow(
        `No schema files found in ${join(root, 'pages')}`
      );
    });
  });

  it('reports a missing schema file with the init hint', async () => {
    await withParentDir((parent) => {
      expect(() => resolveProjectSource(parent, 'nope.json')).toThrow('Schema file not found: nope.json');
      expect(() => resolveProjectSource(parent, 'nope.json')).toThrow("Run 'objectui init'");
    });
  });

  it('reports an unparsable lone schema', async () => {
    await withParentDir((parent) => {
      writeRaw(join(parent, 'broken.json'), '{ "type": ');
      expect(() => resolveProjectSource(parent, 'broken.json')).toThrow('Invalid schema file:');
    });
  });
});

describe('reportProjectSource — the lines the three commands print', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function capture(body: () => void): { log: string[]; warn: string[] } {
    const log: string[] = [];
    const warn: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      log.push(stripAnsi(args.map(String).join(' ')));
    });
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warn.push(stripAnsi(args.map(String).join(' ')));
    });
    body();
    return { log, warn };
  }

  it('names the detected project, its config, its pages directory and its routes', async () => {
    await withParentDir((parent) => {
      const root = writeProject(parent);
      const { log, warn } = capture(() => {
        reportProjectSource(resolveProjectSource(parent, 'app/app.json'), parent);
      });

      expect(log).toEqual([
        `📂 Detected project structure at ${root}`,
        '⚙️  Loaded App Config from app/app.json',
        `📁 Using file-system routing from ${join(root, 'pages')}`,
        '✓ Found 1 route(s)',
        '  / → app/pages/index.json'
      ]);
      expect(warn).toEqual([]);
    });
  });

  it('names the file in single-schema mode', async () => {
    await withParentDir((parent) => {
      writeJson(join(parent, 'solo/page.json'), PAGE);
      const { log } = capture(() => {
        reportProjectSource(resolveProjectSource(parent, 'solo/page.json'), parent);
      });

      expect(log).toEqual(['📋 Loading schema: solo/page.json']);
    });
  });

  it('surfaces a malformed app config as a warning, not silence', async () => {
    await withParentDir((parent) => {
      const root = join(parent, 'app');
      writeRaw(join(root, 'app.json'), '{ "name": ');
      writeJson(join(root, 'pages/index.json'), PAGE);

      const { log, warn } = capture(() => {
        reportProjectSource(resolveProjectSource(parent, 'app/app.json'), parent);
      });

      expect(warn).toHaveLength(1);
      expect(warn[0]).toContain('Failed to parse app config');
      // The routes still report — a broken layout config is not a dead project.
      expect(log).toContain('✓ Found 1 route(s)');
      expect(log.some((line) => line.startsWith('⚙️  Loaded App Config'))).toBe(false);
    });
  });
});

describe('dev / serve / build detection parity (objectui#4923)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(commands)('%s anchors the project on the argument, not on cwd', async (_name, run) => {
    await withParentDir(async (parent) => {
      const root = join(parent, 'app');
      writeJson(join(root, 'app.json'), APP_CONFIG);
      mkdirSync(join(root, 'pages'), { recursive: true });
      vi.spyOn(process, 'cwd').mockReturnValue(parent);
      vi.spyOn(console, 'log').mockImplementation(() => {});

      // Before the fix `serve`/`build` never looked here: they parsed the app
      // config as a page and started Vite. Naming this directory in the error is
      // the proof that the argument's project is what got scanned.
      await expect(run('app/app.json')).rejects.toThrow(
        `No schema files found in ${join(root, 'pages')}`
      );
    });
  });

  it.each(commands)('%s keeps single-schema mode for a lone file', async (_name, run) => {
    await withParentDir(async (parent) => {
      writeRaw(join(parent, 'solo.json'), '{ "type": ');
      vi.spyOn(process, 'cwd').mockReturnValue(parent);
      vi.spyOn(console, 'log').mockImplementation(() => {});

      // Reaching the parse at all means the fallback still runs for all three.
      await expect(run('solo.json')).rejects.toThrow('Invalid schema file:');
    });
  });

  it.each(commands)('%s reports a missing schema the same way', async (_name, run) => {
    await withParentDir(async (parent) => {
      vi.spyOn(process, 'cwd').mockReturnValue(parent);
      vi.spyOn(console, 'log').mockImplementation(() => {});

      await expect(run('nope.json')).rejects.toThrow('Schema file not found: nope.json');
    });
  });
});


/**
 * The documented directory form (objectui#5037).
 *
 * `content/docs/utilities/cli.mdx` records the positional argument as "Path to
 * JSON/YAML schema file or `pages/` directory" and shows `objectui dev pages/`.
 * Before this fix that promise had never been parsed: step ① required
 * `statSync(...).isFile()`, so a directory argument fell straight through it,
 * and only the one spelling that happened to BE `<cwd>/pages` was caught — by
 * the cwd fallback, as a coincidence of position rather than a reading of the
 * argument. Every pathful spelling reached step ③ and handed a directory to
 * `readFileSync`:
 *
 *     $ objectui dev my-app/pages
 *     Error: Invalid schema file: EISDIR: illegal operation on a directory, read
 *
 * Ruled 2026-08-17 (「同意」): support it, in step ① so all three commands
 * answer identically, and refuse the remaining directory-shaped miss in plain
 * language instead of leaking EISDIR.
 */
describe('resolveProjectSource — directory arguments (objectui#5037)', () => {
  it('routes from a pathful `pages/` argument, invoked from outside the project', async () => {
    await withParentDir((parent) => {
      // The card's own invocation: `objectui dev my-app/pages`, run from ABOVE
      // `my-app`. The cwd-relative spelling passes on the unfixed code, so it
      // is this one that carries the defect.
      const root = writeProject(parent);
      const source = resolveProjectSource(parent, 'app/pages');

      expect(source.mode).toBe('routes');
      if (source.mode !== 'routes') return;
      expect(source.projectRoot).toBe(root);
      expect(source.pagesDir).toBe(join(root, 'pages'));
      expect(source.pagesDirOrigin).toBe('argument-dir');
      expect(source.routes.map((route) => route.path)).toEqual(['/']);
      expect(source.appConfig).toEqual(APP_CONFIG);
      expect(source.appConfigPath).toBe(join(root, 'app.json'));
      expect(source.warnings).toEqual([]);
    });
  });

  it('routes from a project directory that contains a `pages/`', async () => {
    await withParentDir((parent) => {
      const root = writeProject(parent);
      const source = resolveProjectSource(parent, 'app');

      expect(source.mode).toBe('routes');
      if (source.mode !== 'routes') return;
      expect(source.projectRoot).toBe(root);
      expect(source.pagesDir).toBe(join(root, 'pages'));
      expect(source.pagesDirOrigin).toBe('argument-dir');
      expect(source.appConfig).toEqual(APP_CONFIG);
      expect(source.appConfigPath).toBe(join(root, 'app.json'));
    });
  });

  it('answers a directory argument exactly as it answers the app config beside it', async () => {
    await withParentDir((parent) => {
      const root = writeProject(parent);
      writeJson(join(root, 'pages/about.json'), PAGE);

      const viaAppConfig = resolveProjectSource(parent, 'app/app.json');
      const spellings = [
        resolveProjectSource(parent, 'app'),
        resolveProjectSource(parent, 'app/pages'),
        resolveProjectSource(parent, 'app/pages/'),
        resolveProjectSource(parent, join(root, 'pages'))
      ];

      expect(viaAppConfig.mode).toBe('routes');
      if (viaAppConfig.mode !== 'routes') return;
      for (const source of spellings) {
        expect(source.mode).toBe('routes');
        if (source.mode !== 'routes') continue;
        expect(source.projectRoot).toBe(viaAppConfig.projectRoot);
        expect(source.pagesDir).toBe(viaAppConfig.pagesDir);
        expect(source.routes).toEqual(viaAppConfig.routes);
        expect(source.appConfig).toEqual(viaAppConfig.appConfig);
        expect(source.appConfigPath).toBe(viaAppConfig.appConfigPath);
        expect(source.warnings).toEqual([]);
      }
    });
  });

  it('refuses a directory that is neither, naming what was expected', async () => {
    await withParentDir((parent) => {
      mkdirSync(join(parent, 'not-a-project/src'), { recursive: true });

      // A non-zero exit is NOT the assertion: `EISDIR` exits non-zero too, so an
      // exit-code pin cannot tell the fix from the bug. What must hold is that
      // the sentence names the directory and what was expected of it.
      const refuse = () => resolveProjectSource(parent, 'not-a-project');
      expect(refuse).toThrow('Not a project directory: not-a-project');
      expect(refuse).toThrow(/'pages' directory/);
      expect(refuse).not.toThrow(/EISDIR/);
    });
  });

  it('leaves the working-directory fallback ahead of the refusal', async () => {
    // A directory argument that resolves to nothing does not become fatal while
    // the cwd still names a project: the fallback that answers every unresolved
    // argument today keeps answering this one. objectui#5037 adds a limb and a
    // diagnosis; it narrows nothing.
    await withParentDir((parent) => {
      writeJson(join(parent, 'pages/index.json'), PAGE);
      mkdirSync(join(parent, 'not-a-project'), { recursive: true });

      const source = resolveProjectSource(parent, 'not-a-project');
      expect(source.mode).toBe('routes');
      if (source.mode !== 'routes') return;
      expect(source.pagesDir).toBe(join(parent, 'pages'));
      expect(source.pagesDirOrigin).toBe('cwd');
    });
  });

  it('keeps a directory named `pages` legible when it holds no schema', async () => {
    await withParentDir((parent) => {
      mkdirSync(join(parent, 'app/pages'), { recursive: true });

      expect(() => resolveProjectSource(parent, 'app/pages')).toThrow(
        `No schema files found in ${join(parent, 'app/pages')}`
      );
    });
  });
});

describe('dev / serve / build answer a directory argument identically (objectui#5037)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(commands)('%s routes a pathful `pages/` argument to the argument\'s project', async (_name, run) => {
    await withParentDir(async (parent) => {
      const root = join(parent, 'app');
      writeJson(join(root, 'app.json'), APP_CONFIG);
      mkdirSync(join(root, 'pages'), { recursive: true });
      vi.spyOn(process, 'cwd').mockReturnValue(parent);
      vi.spyOn(console, 'log').mockImplementation(() => {});

      // The `pages/` is left empty so the verdict is reached inside detection,
      // before Vite: naming this directory is the proof that the pathful
      // argument — not cwd, which is not a project at all here — got scanned.
      await expect(run('app/pages')).rejects.toThrow(
        `No schema files found in ${join(root, 'pages')}`
      );
    });
  });

  it.each(commands)('%s routes a pathful project directory to the same place', async (_name, run) => {
    await withParentDir(async (parent) => {
      const root = join(parent, 'app');
      writeJson(join(root, 'app.json'), APP_CONFIG);
      mkdirSync(join(root, 'pages'), { recursive: true });
      vi.spyOn(process, 'cwd').mockReturnValue(parent);
      vi.spyOn(console, 'log').mockImplementation(() => {});

      await expect(run('app')).rejects.toThrow(`No schema files found in ${join(root, 'pages')}`);
    });
  });

  it.each(commands)('%s refuses a non-project directory in plain language', async (_name, run) => {
    await withParentDir(async (parent) => {
      mkdirSync(join(parent, 'not-a-project'), { recursive: true });
      vi.spyOn(process, 'cwd').mockReturnValue(parent);
      vi.spyOn(console, 'log').mockImplementation(() => {});

      await expect(run('not-a-project')).rejects.toThrow(
        'Not a project directory: not-a-project'
      );
      await expect(run('not-a-project')).rejects.toThrow(/'pages' directory/);
    });
  });
});

describe('the three commands reach detection through one helper (objectui#4923)', () => {
  // Same shape as the objectui#3890 group in `workspace-vite.test.ts`, for the
  // same reason: the routed happy path ends in a Vite server or a Vite build, so
  // what the commands HAND ON cannot be read off a mock-free behavioral test —
  // and dropping the app config is precisely how `serve` and `build` used to
  // render a routed project without its layout.
  const sources = new Map(
    ['dev.ts', 'serve.ts', 'build.ts'].map(
      (file) => [file, readFileSync(join(COMMAND_DIR, file), 'utf-8')] as const
    )
  );

  it('resolves and reports through the shared functions', () => {
    // The CALL, not the identifier: reverting one command's detection while
    // leaving its now-unused import behind kept a bare-name assertion green.
    for (const [file, source] of sources) {
      expect(source, `${file} must resolve through the shared helper`).toContain(
        'resolveProjectSource(cwd, schemaPath)'
      );
      expect(source, `${file} must report the shared detection lines`).toContain(
        'reportProjectSource(source, cwd)'
      );
    }
  });

  it('hands the resolved app config to the routed generator', () => {
    // `createTempAppWithRouting(tmpDir, routes)` — two arguments — is how the
    // app layout got dropped in `serve` and `build`.
    for (const [file, source] of sources) {
      expect(source, `${file} must pass the resolved app config`).toContain(
        'createTempAppWithRouting(tmpDir, source.routes, source.appConfig)'
      );
    }
  });

  it('leaves no hand-rolled pages/ lookup behind in any of them', () => {
    // The exact expression the card names, which `serve.ts` and `build.ts` each
    // used to decide the whole question with. Matched as text, so it must not
    // appear in a comment either — the history it belongs to is written up once,
    // in `utils/project-source.ts`, which is not one of these files.
    const handRolled = /join\(\s*cwd\s*,\s*['"]pages['"]\s*\)/;
    for (const [file, source] of sources) {
      expect(handRolled.test(source), `${file} still resolves pages/ by hand`).toBe(false);
    }
  });
});
