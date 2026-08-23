// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getCredentialsPath, readAuthConfig } from './auth-config.js';

/**
 * # `#11313` pin: the guidance this file prints names a command that resolves
 *
 * `readAuthConfig()` throws the one instruction a **stuck** user gets: they
 * have no stored credentials, the command they wanted has just failed, and
 * this string tells them how to get unstuck. It used to say
 * `os auth login`, which does not resolve — `login.ts` sits at the ROOT of
 * `src/commands/`, so oclif's pattern strategy registers it as `login`, and
 * no `auth` topic has ever existed. Measured against the built CLI before
 * the fix: `os auth login --help` -> `Error: Command auth:login not found.`
 * (exit 2), `os login --help` -> exit 0; loading the built oclif `Config`
 * enumerates 61 ids, ZERO containing `auth`, and no `auth` topic, with
 * `login`/`logout`/`register`/`whoami`/`dev`/`serve` all present as the
 * control that the zero is a real absence rather than a broken probe.
 *
 * The second failure is the expensive one: it reads as "the tool is broken",
 * not as "a typo in a help string".
 *
 * ## What is pinned — the property, not the spelling
 *
 * A pin asserting the literal new text (`os login`) would go green forever
 * and catch nothing: it would still pass on the day someone renames
 * `login.ts`, which is the next way this string can go stale. So what is
 * asserted is that **every command invocation this file documents resolves
 * to an id this CLI actually registers**, with the id set derived from the
 * command tree. Rename `login.ts` and this pin reds.
 *
 * Two legs, deliberately:
 *
 * 1. **Behavioural** — the real `readAuthConfig()` is driven into its real
 *    ENOENT branch (a temp `$HOME` with no credentials file) and the message
 *    that a user would actually see is parsed. This pins the string a stuck
 *    user reads, not a string that happens to sit in the source.
 * 2. **Source-wide** — every backticked invocation in `auth-config.ts`, so a
 *    guidance string or doc comment added here later is held to the same
 *    property without anyone remembering to extend this file. That leg is
 *    why the stale `os projects switch` in `AuthConfig.activeEnvironmentId`'s
 *    doc comment was fixed in the same commit (`projects` was renamed to
 *    `environments` in v5.0 with no aliases — ADR-0006): the alternative was
 *    an exclusion, and an exclusion is how a line stops being checked
 *    without anyone deciding to stop checking it.
 *
 * ## Why the id set is derived from SOURCE
 *
 * The direct route — `Config.load()` against the built CLI — is unreachable
 * from a vitest suite here: `turbo.json` declares `test`'s `dependsOn` as
 * `["^build"]`, dependencies' builds only, never this package's own, so
 * `packages/cli/dist` (what oclif's pattern strategy scans) is not
 * guaranteed to exist when this file runs. `registeredCommandIds()` below
 * re-derives the set from `src/commands/**` using oclif's own path->id
 * algorithm; `src/commands` is a 1:1 mirror of `dist/commands` (this
 * package's build renames and relocates nothing). Its output was checked
 * against the built `Config` while writing this pin: same ids. The same
 * reasoning, and the same derivation, is documented at length in
 * `src/commands/environments/environments.test.ts`'s `#10967` pin — which
 * covers `static override examples` arrays via AST and structurally cannot
 * see a thrown-error string, which is why this class needed its own pin
 * rather than an extension of that one. The derivation is duplicated rather
 * than shared because that file is outside this change's file surface;
 * hoisting it into one helper is a follow-up, not a rider here.
 */
describe('#11313 pin: auth-config guidance resolves to a real command id', () => {
  const HERE = fileURLToPath(new URL('.', import.meta.url));
  const COMMANDS_ROOT = path.resolve(HERE, '../commands');
  const AUTH_CONFIG_SOURCE = path.resolve(HERE, 'auth-config.ts');
  const PACKAGE_JSON = path.resolve(HERE, '../../package.json');

  /**
   * oclif's separator between topic and command in a user-typed invocation,
   * read from this package's own manifest rather than hardcoded — the
   * property under test is about what a user types, so a change to
   * `oclif.topicSeparator` must move this pin with it.
   */
  const TOPIC_SEPARATOR: string = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')).oclif.topicSeparator;

  const isCommandSource = (name: string): boolean =>
    name.endsWith('.ts')
    && !name.endsWith('.d.ts')
    && !/\.(test|pin\.test|contract\.test|integration\.test|e2e\.test)\.ts$/.test(name);

  /** Every command source file, as a path relative to `COMMANDS_ROOT` (posix separators). */
  function commandSourceFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string, prefix: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walk(path.join(dir, entry.name), rel);
          continue;
        }
        if (!isCommandSource(entry.name)) continue;
        out.push(rel);
      }
    };
    walk(COMMANDS_ROOT, '');
    return out.sort();
  }

  /** The command ids oclif registers, in the form a user types them. */
  function registeredCommandIds(): Set<string> {
    const ids = new Set<string>();
    for (const rel of commandSourceFiles()) {
      const parts = rel.split('/');
      const base = parts[parts.length - 1].slice(0, -'.ts'.length);
      const topics = parts.slice(0, -1);
      const command = base === 'index' ? undefined : base;
      ids.add([...topics, command].filter((s): s is string => Boolean(s)).join(TOPIC_SEPARATOR));
    }
    return ids;
  }

  const registeredIds = registeredCommandIds();

  /**
   * True when `invocation` (`os <tokens>`, without the `$ ` prompt) names a
   * registered command — exactly, or as the command plus its arguments.
   */
  function namesARegisteredCommand(invocation: string): boolean {
    let rest = invocation.trim();
    if (!rest.startsWith('os ')) return false;
    rest = rest.slice('os '.length);
    for (const id of registeredIds) {
      if (rest === id || rest.startsWith(`${id} `)) return true;
    }
    return false;
  }

  /**
   * Every `` `os …` `` span in a blob of text — the one shape this file uses
   * to name a command, in thrown messages and in doc comments alike. A
   * trailing backslash is dropped: inside a template literal the closing
   * backtick is written escaped.
   */
  function documentedInvocations(text: string): string[] {
    const found: string[] = [];
    const re = /`(?:\\?\$ )?(os [^`\n]*)`/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const invocation = m[1].replace(/\\$/, '').trim();
      if (invocation !== 'os') found.push(invocation);
    }
    return found;
  }

  it('the derived id set is real: known ids across several topics, including the index.ts case', () => {
    expect(TOPIC_SEPARATOR).toBe(' ');
    expect(registeredIds.has('login')).toBe(true);
    expect(registeredIds.has('logout')).toBe(true);
    expect(registeredIds.has('environments switch')).toBe(true);
    expect(registeredIds.has('data query')).toBe(true);
    expect(registeredIds.has('migrate')).toBe(true); // migrate/index.ts -> `migrate`, no trailing segment
    expect(registeredIds.size).toBeGreaterThan(30);
  });

  it('anti-vacuity: the predicate clears a good invocation and rejects both pre-fix spellings', () => {
    // Cleared, so the assertions below are not passing because nothing ever passes.
    expect(namesARegisteredCommand('os login')).toBe(true);
    expect(namesARegisteredCommand('os login --email a@b.c')).toBe(true);
    expect(namesARegisteredCommand('os environments switch proj-123')).toBe(true);

    // Rejected, and rejected for the declared reason: no file tree produces these ids.
    expect(registeredIds.has('auth')).toBe(false);
    expect(registeredIds.has('auth login')).toBe(false);
    expect(namesARegisteredCommand('os auth login')).toBe(false);
    expect(registeredIds.has('projects')).toBe(false);
    expect(registeredIds.has('projects switch')).toBe(false);
    expect(namesARegisteredCommand('os projects switch')).toBe(false);
  });

  describe('the credentials-missing guidance a stuck user actually reads', () => {
    let home: string;
    let previousHome: string | undefined;
    let previousUserProfile: string | undefined;

    beforeAll(() => {
      previousHome = process.env.HOME;
      previousUserProfile = process.env.USERPROFILE;
      home = mkdtempSync(path.join(tmpdir(), 'os-auth-config-pin-'));
      process.env.HOME = home;
      process.env.USERPROFILE = home;
    });

    afterAll(() => {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousUserProfile;
      rmSync(home, { recursive: true, force: true });
    });

    it('reads credentials from the redirected home (the ENOENT below is the real branch)', () => {
      // Self-validating: if `homedir()` ignored the redirect, the throw under
      // test would be about the developer's own machine and could even not
      // happen at all (real credentials present). Fail loudly instead.
      expect(getCredentialsPath().startsWith(home)).toBe(true);
    });

    it('names a command this CLI registers', async () => {
      const error = await readAuthConfig().then(
        () => undefined,
        (e: unknown) => e as Error,
      );
      expect(error, 'readAuthConfig() must reject when no credentials file exists').toBeInstanceOf(Error);

      const message = error!.message;
      expect(message).toContain('No stored credentials found');

      const invocations = documentedInvocations(message);
      expect(
        invocations.length,
        `the credentials-missing message must tell the user which command to run; got: ${message}`,
      ).toBeGreaterThan(0);

      const unresolved = invocations.filter((i) => !namesARegisteredCommand(i));
      expect(
        unresolved,
        'the message a user sees when they have no credentials names a command this CLI does not '
        + 'register -- they are already stuck, and running what it tells them prints '
        + '"Command ... not found.", which reads as a broken tool rather than a stale string. '
        + `Registered ids are derived from src/commands/**; message was: ${message}`,
      ).toEqual([]);
    });
  });

  it('every invocation documented in auth-config.ts source names a registered command', () => {
    const text = readFileSync(AUTH_CONFIG_SOURCE, 'utf8');
    const invocations = documentedInvocations(text);

    // Anti-vacuity: an empty scan (a moved file, a changed quoting style) must
    // not read as a pass.
    expect(
      invocations.length,
      'the scan of auth-config.ts found no `os ...` invocation at all -- the file moved, or it '
      + 'stopped naming commands in backticks and this pin is now checking nothing.',
    ).toBeGreaterThanOrEqual(2);

    const unresolved = invocations.filter((i) => !namesARegisteredCommand(i));
    expect(
      unresolved,
      'auth-config.ts documents a command invocation that does not resolve to an id this CLI '
      + 'registers. Fix the spelling against src/commands/** rather than excluding the line: an '
      + 'exclusion is how a line stops being checked without anyone deciding to stop checking it.',
    ).toEqual([]);
  });
});
