// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * resolveConsolePath() hardening — stale out-of-workspace installs.
 *
 * Node module resolution from the consumer cwd climbs `node_modules`
 * directories all the way up the filesystem. A stray
 * `~/node_modules/@objectstack/console` left behind by an old npm
 * experiment used to win over the version-locked bundle and serve a
 * stale Console (browser-side OBJUI-001 "Unknown component type").
 * These tests pin the major-version guard that skips such candidates.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import {
  resolveConsolePath,
  isConsoleVersionCompatible,
  warnOnConsoleShaDrift,
} from '../src/utils/console.js';

// resolveConsolePath() also discovers the real, version-locked workspace
// @objectstack/console via the CLI's own module location (createRequire on
// import.meta.url), and that package shares the CLI's fixed-group version.
// Pin the guard's reference version to the live major — read from the CLI's
// own package.json — so these fixtures don't go stale and warn-mismatch on
// every major bump (the 9.x -> 10.0.0 release broke them once already).
const CLI_MAJOR = Number.parseInt(
  createRequire(import.meta.url)('../package.json').version,
  10,
);
const CLI_VERSION = `${CLI_MAJOR}.2.0`;
/** Same major as the CLI — a healthy, version-locked install. */
const MATCHING_VERSION = `${CLI_MAJOR}.0.0`;
/** A different major — the stale, out-of-workspace install shape. */
const STALE_VERSION = `${CLI_MAJOR - 1}.8.0`;

function writeConsolePackage(
  dir: string,
  { name = '@objectstack/console', version, withDist = true }: {
    name?: string;
    version: string;
    withDist?: boolean;
  },
): string {
  const pkgDir = path.join(dir, 'node_modules', '@objectstack', 'console');
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name, version }));
  if (withDist) {
    fs.mkdirSync(path.join(pkgDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'dist', 'index.html'), '<html></html>');
  }
  return pkgDir;
}

/** Fresh sandbox: <tmp>/home/project is the cwd, <tmp>/home simulates $HOME. */
function makeSandbox(): { home: string; project: string } {
  // realpath: node's require.resolve returns symlink-resolved paths, and
  // macOS tmpdir lives behind the /var -> /private/var symlink.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'os-console-resolve-')));
  const home = path.join(root, 'home');
  const project = path.join(home, 'project');
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(
    path.join(project, 'package.json'),
    JSON.stringify({ name: 'consumer-app', version: '1.0.0' }),
  );
  return { home, project };
}

describe('isConsoleVersionCompatible', () => {
  it('accepts the same major', () => {
    expect(isConsoleVersionCompatible('9.2.0', '9.2.0')).toBe(true);
    expect(isConsoleVersionCompatible('9.0.1', '9.5.0')).toBe(true);
    expect(isConsoleVersionCompatible('9.3.0-beta.1', '9.2.0')).toBe(true);
  });

  it('rejects a different major', () => {
    expect(isConsoleVersionCompatible('7.8.0', '9.2.0')).toBe(false);
    expect(isConsoleVersionCompatible('10.0.0', '9.2.0')).toBe(false);
  });

  it('rejects missing or malformed versions', () => {
    expect(isConsoleVersionCompatible(undefined, '9.2.0')).toBe(false);
    expect(isConsoleVersionCompatible('', '9.2.0')).toBe(false);
    expect(isConsoleVersionCompatible('not-a-version', '9.2.0')).toBe(false);
  });
});

describe('resolveConsolePath version guard', () => {
  it('skips a stale major-mismatched install climbed to outside the project, with a warning', () => {
    const { home, project } = makeSandbox();
    // The incident shape: ~/node_modules/@objectstack/console@7.8.0 with a
    // built dist, reachable from the project cwd by climbing node_modules.
    const stale = writeConsolePackage(home, { version: STALE_VERSION });

    const warnings: string[] = [];
    const result = resolveConsolePath({
      cwd: project,
      cliVersion: CLI_VERSION,
      warn: (m) => warnings.push(m),
    });

    expect(result).not.toBe(stale);
    expect(warnings.some((m) => m.includes(STALE_VERSION) && m.includes(stale))).toBe(true);
  });

  it('accepts a same-major install climbed to from the project cwd', () => {
    const { home, project } = makeSandbox();
    const ok = writeConsolePackage(home, { version: MATCHING_VERSION });

    const warnings: string[] = [];
    const result = resolveConsolePath({
      cwd: project,
      cliVersion: CLI_VERSION,
      warn: (m) => warnings.push(m),
    });

    expect(result).toBe(ok);
    expect(warnings).toEqual([]);
  });

  it('prefers a matching local install over a stale parent-directory one', () => {
    const { home, project } = makeSandbox();
    writeConsolePackage(home, { version: STALE_VERSION });
    const local = writeConsolePackage(project, { version: MATCHING_VERSION });

    const result = resolveConsolePath({
      cwd: project,
      cliVersion: CLI_VERSION,
      warn: () => {},
    });

    expect(result).toBe(local);
  });

  it('skips an install whose package.json carries no version', () => {
    const { home, project } = makeSandbox();
    const unversionedDir = path.join(home, 'node_modules', '@objectstack', 'console');
    fs.mkdirSync(path.join(unversionedDir, 'dist'), { recursive: true });
    fs.writeFileSync(
      path.join(unversionedDir, 'package.json'),
      JSON.stringify({ name: '@objectstack/console' }),
    );
    fs.writeFileSync(path.join(unversionedDir, 'dist', 'index.html'), '<html></html>');

    const warnings: string[] = [];
    const result = resolveConsolePath({
      cwd: project,
      cliVersion: CLI_VERSION,
      warn: (m) => warnings.push(m),
    });

    expect(result).not.toBe(unversionedDir);
    expect(warnings.some((m) => m.includes('unknown'))).toBe(true);
  });
});

describe('warnOnConsoleShaDrift', () => {
  const SHA_A = '2b86379384f0f6e99d9a5bb81d73017fd6f99cef';
  const SHA_B = '69d6b94419bcaa11223344556677889900aabbcc';

  /**
   * Lay out a monorepo-shaped tree: <root>/.objectui-sha is the pin, and
   * <root>/packages/console/dist is the vendored, optionally-stamped build.
   * Returns the console package dir (what resolveConsolePath would hand back).
   */
  function makePinnedTree(
    pin: string,
    stamp: string | null,
  ): { root: string; consoleDir: string } {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'os-console-sha-')));
    fs.writeFileSync(path.join(root, '.objectui-sha'), `${pin}\n`);
    const consoleDir = path.join(root, 'packages', 'console');
    fs.mkdirSync(path.join(consoleDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(consoleDir, 'dist', 'index.html'), '<html></html>');
    if (stamp !== null) {
      fs.writeFileSync(path.join(consoleDir, 'dist', '.objectui-sha'), `${stamp}\n`);
    }
    return { root, consoleDir };
  }

  it('warns when the dist stamp differs from the pin (the pull-without-rebuild case)', () => {
    const { consoleDir } = makePinnedTree(SHA_A, SHA_B);
    const warnings: string[] = [];
    warnOnConsoleShaDrift(consoleDir, (m) => warnings.push(m));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(SHA_A.slice(0, 12));
    expect(warnings[0]).toContain(SHA_B.slice(0, 12));
    expect(warnings[0]).toContain('objectui:build');
  });

  it('is silent when the dist stamp matches the pin', () => {
    const { consoleDir } = makePinnedTree(SHA_A, SHA_A);
    const warnings: string[] = [];
    warnOnConsoleShaDrift(consoleDir, (m) => warnings.push(m));
    expect(warnings).toEqual([]);
  });

  it('is silent for an unstamped dist (pre-guard build / sibling-repo fallback)', () => {
    const { consoleDir } = makePinnedTree(SHA_A, null);
    const warnings: string[] = [];
    warnOnConsoleShaDrift(consoleDir, (m) => warnings.push(m));
    expect(warnings).toEqual([]);
  });

  it('is silent when no pin exists up-tree (published install)', () => {
    // A console package with a stamped dist but NO .objectui-sha anywhere
    // above it — the shape of a published npm install.
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'os-console-sha-pub-')));
    const consoleDir = path.join(root, 'node_modules', '@objectstack', 'console');
    fs.mkdirSync(path.join(consoleDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(consoleDir, 'dist', 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(consoleDir, 'dist', '.objectui-sha'), `${SHA_B}\n`);

    const warnings: string[] = [];
    warnOnConsoleShaDrift(consoleDir, (m) => warnings.push(m));
    expect(warnings).toEqual([]);
  });
});
