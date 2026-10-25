/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `runDiagnostics` — the body of `objectui doctor` (objectui#3891).
 *
 * The command used to be written against Tailwind 3, so on a v4 project it
 * reported a problem that did not exist (no `tailwind.config.js`), graded a
 * file v4 never reads on a key v4 does not have (`content`), and stayed silent
 * about the one dependency a v4 build cannot start without
 * (`@tailwindcss/postcss`). These tests pin all three verdicts by `id`, so the
 * wording can be improved without the coverage evaporating, and so a
 * regression toward the v3 questions goes red rather than quiet.
 *
 * Fixtures are real directories under `os.tmpdir()` — deliberately not the repo
 * tree, because `runDiagnostics` resolves `@tailwindcss/postcss` through Node
 * from the directory it is handed, and a fixture nested inside this workspace
 * would inherit the workspace's `node_modules` and make the resolution branch
 * untestable.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

import { runDiagnostics, countIssues, type DoctorDiagnostic } from '../commands/doctor.js';

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'objectui-doctor-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

/** Write `content` to `rel` inside the fixture, creating parent dirs. */
function write(rel: string, content: string): void {
  const abs = join(cwd, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf-8');
}

function writePkg(pkg: Record<string, unknown>): void {
  write('package.json', JSON.stringify(pkg, null, 2));
}

const ids = (results: readonly DoctorDiagnostic[]): string[] => results.map((r) => r.id);

function find(results: readonly DoctorDiagnostic[], id: string): DoctorDiagnostic | undefined {
  return results.find((r) => r.id === id);
}

/**
 * The shape `objectui init` scaffolds: v4 dependency set, a PostCSS config
 * naming the v4 plugin, a CSS entry running the v4 import, and no
 * `tailwind.config.*` at all.
 */
function scaffoldHealthyV4App(): void {
  writePkg({
    name: 'fixture-app',
    dependencies: { react: '^19.0.0', tailwindcss: '^4.3.3' },
    devDependencies: { '@tailwindcss/postcss': '^4.3.3', typescript: '^5.9.0' },
  });
  write('postcss.config.js', "export default { plugins: { '@tailwindcss/postcss': {} } };\n");
  write('src/index.css', "@import 'tailwindcss';\n@source '../src/**/*.{ts,tsx}';\n");
  write('tsconfig.json', '{}');
}

describe('runDiagnostics — a healthy Tailwind 4 project', () => {
  it('reports zero issues for the shape `objectui init` generates', () => {
    scaffoldHealthyV4App();
    const results = runDiagnostics(cwd);

    expect(countIssues(results)).toBe(0);
    expect(results.every((r) => r.level === 'ok')).toBe(true);
    expect(ids(results)).toContain('tailwind-postcss-declared');
    expect(ids(results)).toContain('postcss-plugin-v4');
    expect(ids(results)).toContain('css-entry-v4-import');
    expect(ids(results)).toContain('css-entry-source');
  });

  it('does NOT mention tailwind.config at all when the file is absent', () => {
    scaffoldHealthyV4App();
    const results = runDiagnostics(cwd);

    // The regression objectui#3891 is about: absence of a v4-irrelevant file
    // must produce no finding of any level, not even an `ok` one.
    expect(ids(results).filter((id) => id.startsWith('tailwind-config'))).toEqual([]);
    expect(results.map((r) => r.message).join('\n')).not.toMatch(/tailwind\.config/);
  });
});

describe('runDiagnostics — @tailwindcss/postcss, the real v4 failure mode', () => {
  it('errors when the plugin package is neither declared nor resolvable', () => {
    scaffoldHealthyV4App();
    // Same project, minus the one dependency v4 cannot build without.
    writePkg({
      name: 'fixture-app',
      dependencies: { react: '^19.0.0', tailwindcss: '^4.3.3' },
      devDependencies: { typescript: '^5.9.0' },
    });

    const results = runDiagnostics(cwd);
    const finding = find(results, 'tailwind-postcss-missing');

    expect(finding?.level).toBe('error');
    expect(finding?.message).toContain('@tailwindcss/postcss');
    expect(countIssues(results)).toBe(1);
  });

  it('accepts an undeclared plugin that a parent node_modules provides', () => {
    // The workspace case: a leaf package.json stays silent while the install
    // lives further up. Reporting that as missing would put objectui#3891's
    // false positive straight back, one directory over.
    scaffoldHealthyV4App();
    writePkg({
      name: 'fixture-app',
      dependencies: { react: '^19.0.0', tailwindcss: '^4.3.3' },
      devDependencies: { typescript: '^5.9.0' },
    });
    mkdirSync(join(cwd, 'node_modules/@tailwindcss/postcss'), { recursive: true });

    const results = runDiagnostics(cwd);

    expect(find(results, 'tailwind-postcss-installed')?.level).toBe('ok');
    expect(find(results, 'tailwind-postcss-missing')).toBeUndefined();
    expect(countIssues(results)).toBe(0);
  });

  it('is silent about the plugin when the project does not use Tailwind', () => {
    writePkg({ name: 'fixture-app', dependencies: { react: '^19.0.0' } });
    write('tsconfig.json', '{}');

    const results = runDiagnostics(cwd);

    // `tailwind-missing` says the one thing worth saying; the v4 build checks
    // must not pile findings onto a project that never asked for Tailwind.
    expect(ids(results)).toContain('tailwind-missing');
    expect(ids(results).filter((id) => id.startsWith('tailwind-postcss'))).toEqual([]);
    expect(ids(results).filter((id) => id.startsWith('css-entry'))).toEqual([]);
    expect(ids(results).filter((id) => id.startsWith('postcss-plugin'))).toEqual([]);
  });
});

describe('runDiagnostics — PostCSS config spelling', () => {
  it('errors on the bare v3 `tailwindcss` plugin key, which throws under v4', () => {
    scaffoldHealthyV4App();
    write('postcss.config.js', 'export default { plugins: { tailwindcss: {}, autoprefixer: {} } };\n');

    const results = runDiagnostics(cwd);
    const finding = find(results, 'postcss-plugin-v3');

    expect(finding?.level).toBe('error');
    expect(find(results, 'postcss-plugin-v4')).toBeUndefined();
  });

  it('errors on the quoted v3 spelling', () => {
    scaffoldHealthyV4App();
    write('postcss.config.js', "export default { plugins: { 'tailwindcss': {} } };\n");

    const results = runDiagnostics(cwd);
    const finding = find(results, 'postcss-plugin-v3');

    expect(finding?.level).toBe('error');
    expect(finding?.message).toContain('@tailwindcss/postcss');
  });

  it("does not mistake `'@tailwindcss/postcss'` for the v3 `tailwindcss` key", () => {
    scaffoldHealthyV4App();
    const results = runDiagnostics(cwd);

    // The v3 probe runs against the same text regardless of the v4 verdict, so
    // this is a real read of the probe: the scoped package name has `@` before
    // `tailwindcss` and `/` after it, defeating both alternatives. Without that
    // the healthy scaffold every `objectui init` produces would self-report.
    expect(find(results, 'postcss-plugin-v3')).toBeUndefined();
    expect(find(results, 'postcss-plugin-v4')?.level).toBe('ok');
  });

  it('warns when a PostCSS config registers no Tailwind plugin at all', () => {
    scaffoldHealthyV4App();
    write('postcss.config.js', 'export default { plugins: { autoprefixer: {} } };\n');

    const results = runDiagnostics(cwd);
    expect(find(results, 'postcss-plugin-absent')?.level).toBe('warn');
  });

  it('flags the v3 entry even when the v4 plugin is listed alongside it', () => {
    scaffoldHealthyV4App();
    write(
      'postcss.config.js',
      "export default { plugins: { '@tailwindcss/postcss': {}, 'tailwindcss': {} } };\n",
    );

    const results = runDiagnostics(cwd);
    expect(find(results, 'postcss-plugin-v3')?.level).toBe('error');
  });
});

describe('runDiagnostics — the CSS entry is where v4 is configured', () => {
  it('errors when the entry still uses the v3 @tailwind directives', () => {
    scaffoldHealthyV4App();
    write('src/index.css', '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n');

    const results = runDiagnostics(cwd);
    const finding = find(results, 'css-entry-v3-directives');

    expect(finding?.level).toBe('error');
    expect(finding?.message).toContain("@import 'tailwindcss'");
  });

  it('warns when a CSS entry exists but nothing starts Tailwind', () => {
    scaffoldHealthyV4App();
    write('src/index.css', 'body { margin: 0; }\n');

    const results = runDiagnostics(cwd);
    const finding = find(results, 'css-entry-no-tailwind');

    expect(finding?.level).toBe('warn');
    expect(finding?.message).toContain('src/index.css');
  });

  it('accepts the import from any recognised entry, not just src/index.css', () => {
    scaffoldHealthyV4App();
    rmSync(join(cwd, 'src/index.css'));
    write('app/globals.css', "@import 'tailwindcss';\n");

    const results = runDiagnostics(cwd);
    expect(find(results, 'css-entry-v4-import')?.level).toBe('ok');
    expect(countIssues(results)).toBe(0);
  });

  it('stays silent when no recognised CSS entry exists (a monorepo root)', () => {
    // This is the objectui#3891 headline case: the repo root declares
    // `tailwindcss`, has no CSS entry and no `tailwind.config.*`. doctor must
    // assert nothing about a layout it cannot see.
    writePkg({
      name: 'fixture-monorepo-root',
      dependencies: { react: '^19.0.0' },
      devDependencies: { tailwindcss: '^4.3.3', '@tailwindcss/postcss': '^4.3.3' },
    });
    write('postcss.config.mjs', "export default { plugins: { '@tailwindcss/postcss': {} } };\n");
    write('tsconfig.json', '{}');

    const results = runDiagnostics(cwd);

    expect(ids(results).filter((id) => id.startsWith('css-entry'))).toEqual([]);
    expect(ids(results).filter((id) => id.startsWith('tailwind-config'))).toEqual([]);
    expect(countIssues(results)).toBe(0);
  });
});

describe('runDiagnostics — a present tailwind.config is judged by @config, not by `content`', () => {
  it('warns that the config is inert when no stylesheet declares @config', () => {
    scaffoldHealthyV4App();
    // Byte-for-byte the shape this repo still tracks in apps/console: a v3
    // `content` array that v4 never reads. The old check answered
    // "✓ Tailwind content paths configured" here.
    write(
      'tailwind.config.js',
      "export default { content: ['./index.html', './src/**/*.{ts,tsx}'], theme: { extend: {} } };\n",
    );

    const results = runDiagnostics(cwd);
    const finding = find(results, 'tailwind-config-inert');

    expect(finding?.level).toBe('warn');
    expect(finding?.message).toContain('tailwind.config.js');
    expect(finding?.message).toContain('@config');
    // The verdict must not be reached via the v3 `content` key.
    expect(finding?.message).not.toMatch(/content array/i);
  });

  it('accepts the config when a stylesheet opts into it with @config', () => {
    scaffoldHealthyV4App();
    write('tailwind.config.ts', 'export default { theme: { extend: {} } };\n');
    write('src/index.css', "@import 'tailwindcss';\n@config '../tailwind.config.ts';\n");

    const results = runDiagnostics(cwd);

    expect(find(results, 'tailwind-config-active')?.level).toBe('ok');
    expect(find(results, 'tailwind-config-inert')).toBeUndefined();
    expect(countIssues(results)).toBe(0);
  });
});

describe('runDiagnostics — non-Tailwind checks are unchanged', () => {
  it('errors when package.json is absent', () => {
    const results = runDiagnostics(cwd);
    expect(find(results, 'package-json-missing')?.level).toBe('error');
  });

  it('errors when package.json is not valid JSON', () => {
    write('package.json', '{ not json');
    const results = runDiagnostics(cwd);
    expect(find(results, 'package-json-unreadable')?.level).toBe('error');
  });

  it('warns on a legacy TypeScript major but not on an unparseable range', () => {
    writePkg({ name: 'a', devDependencies: { typescript: '^4.9.5' } });
    write('tsconfig.json', '{}');
    expect(find(runDiagnostics(cwd), 'typescript-legacy')?.level).toBe('warn');

    writePkg({ name: 'a', devDependencies: { typescript: 'workspace:*' } });
    const results = runDiagnostics(cwd);
    expect(find(results, 'typescript-legacy')).toBeUndefined();
    expect(find(results, 'typescript-version')?.level).toBe('ok');
  });

  it('keeps the peer-dependency contracts', () => {
    writePkg({
      name: 'a',
      dependencies: { '@object-ui/react': '^17.0.0', '@object-ui/components': '^17.0.0' },
    });
    const results = runDiagnostics(cwd);
    expect(ids(results)).toContain('peer-react');
    expect(ids(results)).toContain('peer-tailwind');
  });
});

describe('countIssues', () => {
  it('counts warn and error, never ok', () => {
    expect(
      countIssues([
        { id: 'a', level: 'ok', message: '' },
        { id: 'b', level: 'warn', message: '' },
        { id: 'c', level: 'error', message: '' },
      ]),
    ).toBe(2);
  });
});
