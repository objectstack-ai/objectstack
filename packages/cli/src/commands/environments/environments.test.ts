// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Command } from '@oclif/core';
import EnvironmentsBind from './bind.js';
import EnvironmentsList from './list.js';
import EnvironmentsShow from './show.js';
import EnvironmentsCreate from './create.js';
import EnvironmentsSwitch from './switch.js';

/**
 * Metadata-only smoke tests for the `os environments ...` commands. We do
 * not run the commands end-to-end (that would require an oclif Config
 * with hooks wired up); instead we assert that each command is a
 * well-formed oclif Command class with the flags / args we expect.
 *
 * This catches typos and missing-arg regressions without the heavy
 * lifting of a full oclif harness. Full runtime coverage lives in
 * `client.environment-scoping.test.ts` (which exercises the HTTP surface)
 * and the Chrome DevTools MCP smoke test in the PR description.
 */

describe('os environments commands', () => {
  describe('list', () => {
    it('has the expected description and flags', () => {
      expect(EnvironmentsList.description).toMatch(/list/i);
      expect(EnvironmentsList.flags).toHaveProperty('org');
      expect(EnvironmentsList.flags).toHaveProperty('status');
      expect(EnvironmentsList.flags).toHaveProperty('format');
    });
  });

  describe('show', () => {
    it('requires an id arg', () => {
      expect(EnvironmentsShow.args).toHaveProperty('id');
      expect((EnvironmentsShow.args as any).id.required).toBe(true);
    });
  });

  describe('create', () => {
    it('requires --org and --name', () => {
      expect((EnvironmentsCreate.flags as any).org.required).toBe(true);
      expect((EnvironmentsCreate.flags as any).name.required).toBe(true);
    });

    it('activates by default with --no-activate opt-out', () => {
      const flag = (EnvironmentsCreate.flags as any).activate;
      expect(flag.default).toBe(true);
      expect(flag.allowNo).toBe(true);
    });
  });

  describe('switch', () => {
    it('requires an id arg', () => {
      expect(EnvironmentsSwitch.args).toHaveProperty('id');
      expect((EnvironmentsSwitch.args as any).id.required).toBe(true);
    });

    it('calls the activate endpoint by default with --no-remote opt-out', () => {
      const flag = (EnvironmentsSwitch.flags as any).remote;
      expect(flag.default).toBe(true);
      expect(flag.allowNo).toBe(true);
    });
  });
});

/**
 * Pin (#10967): every `examples` entry on these five commands names a
 * command id THIS CLI ACTUALLY REGISTERS.
 *
 * ## The failure this exists to refuse
 *
 * `static override examples` is printed verbatim as part of `--help`, and
 * oclif's `pattern`-strategy command loader derives a command's id purely
 * from its file PATH — a `commandsDir`-relative `topic/.../command.js`
 * becomes id `topic:...:command` (`processCommandIds` in the installed
 * `@oclif/core`'s `lib/config/plugin.js`: `id = [...topics, command]
 * .filter(Boolean).join(sep)`, `topics` = the file's directory segments,
 * `command` = the basename unless it is literally `index`). The exported
 * class name plays NO part in that derivation. So a topic-directory rename
 * (`projects/` → `environments/`, v5.0) leaves every command resolving
 * exactly as before while any `examples`/JSDoc string spelling the OLD
 * topic silently stops being true — not a parse error, not a type error,
 * nothing a build catches. A user who copy-pastes the stale line hits
 * `Error: Command projects:bind not found.` (exit 2). That is the shape
 * #10967 fixed under this directory; this pin targets the MECHANISM (an
 * example naming an id this CLI does not register), not the literal string
 * `os projects`, so it keeps working for a topic nobody has renamed yet —
 * a grep for `os projects` would go green the instant someone renamed this
 * topic again to something else, or a different topic entirely.
 *
 * ## Why the registered-id set is derived from SOURCE, not the built plugin
 *
 * The direct route — `Config.load()` against the built CLI and reading
 * `config.commandIDs` — is unreachable from this suite: `turbo.json`
 * declares `test`'s `dependsOn` as `["^build"]`, dependencies' builds only,
 * never this package's OWN, so `packages/cli/dist` (what oclif's pattern
 * strategy actually scans) is not guaranteed to exist when this file runs —
 * the same constraint `child-env-source-loader.pin.test.ts` documents for
 * the same reason. So `registeredCommandIds()` below re-derives the id set
 * from `src/commands/**\/*.ts` using oclif's own algorithm instead:
 * `src/commands` is a 1:1 mirror of `dist/commands` (the build renames or
 * relocates nothing), so the set computed here is the one oclif will
 * register once the package is actually built — verified below by asserting
 * it contains known ids from several unrelated topics, including the
 * `index.ts` special case (`migrate/index.ts` → id `migrate`, no trailing
 * command segment). What this does NOT cover: a future build step that
 * renamed or dropped a file between `src` and `dist` would be invisible
 * here — nothing in this package's build does that today.
 *
 * ## Why only these five files' `examples` are asserted on
 *
 * The id universe above is built from the WHOLE command tree (so a match
 * only succeeds against a real, currently-registered command), but the
 * PROPERTY is only checked for the five files #10967 touches. Building the
 * universe from the full tree and then asserting on it repo-wide would have
 * been stronger, but going wide surfaced a live, PRE-EXISTING instance of
 * this exact defect class outside this directory (`register.ts` / `whoami.ts`
 * / `logout.ts`, root-level commands whose `examples` still say `os auth
 * whoami` though no `auth` topic has ever existed for them — confirmed via
 * `--help`: `Error: Command auth:whoami not found.`) — filed as its own
 * card (#11221) rather than folded in here, since fixing it is outside what
 * #10967 dispatched. Scoping the assertion to the five fixed files keeps
 * this pin honest about what it currently guards without silently taking on
 * that unrelated repair.
 */
describe('#10967 pin: examples resolve to a real command id', () => {
  const ENVIRONMENTS_DIR = fileURLToPath(new URL('.', import.meta.url));
  const COMMANDS_ROOT = path.resolve(ENVIRONMENTS_DIR, '..');

  /** oclif's own `topicSeparator` for this CLI (`packages/cli/package.json` → `oclif.topicSeparator`). */
  const TOPIC_SEPARATOR = ' ';

  const isCommandSource = (name: string): boolean =>
    name.endsWith('.ts')
    && !name.endsWith('.d.ts')
    && !/\.(test|pin\.test|contract\.test|integration\.test)\.ts$/.test(name);

  function registeredCommandIds(): Set<string> {
    const ids = new Set<string>();
    const walk = (dir: string, topics: string[]): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          walk(path.join(dir, entry.name), [...topics, entry.name]);
          continue;
        }
        if (!isCommandSource(entry.name)) continue;
        const base = entry.name.slice(0, -'.ts'.length);
        const command = base === 'index' ? undefined : base;
        const id = [...topics, command].filter((s): s is string => Boolean(s)).join(TOPIC_SEPARATOR);
        ids.add(id);
      }
    };
    walk(COMMANDS_ROOT, []);
    return ids;
  }

  /**
   * True when `line` (a raw `examples` string) invokes a registered command.
   * Only handles the `$ os <tokens...>` shape every environments/*.ts
   * example uses — some OTHER commands in this package (`start.ts`,
   * `verify.ts`) use `<%= config.bin %>` templating instead, which is not
   * modeled here because none of the five files this pin covers use it.
   */
  function namesARegisteredCommand(line: string, ids: ReadonlySet<string>): boolean {
    const stripped = line.replace(/^\$\s*/, '').trim();
    if (!stripped.startsWith('os ')) return false;
    const rest = stripped.slice('os '.length);
    for (const id of ids) {
      if (rest === id || rest.startsWith(`${id} `)) return true;
    }
    return false;
  }

  const registeredIds = registeredCommandIds();

  it('the scan reached real code across multiple topics (not vacuously empty)', () => {
    expect(registeredIds.has('environments list')).toBe(true);
    expect(registeredIds.has('environments bind')).toBe(true);
    expect(registeredIds.has('migrate')).toBe(true); // the index.ts special case
    expect(registeredIds.has('data query')).toBe(true);
    expect(registeredIds.size).toBeGreaterThan(30);
  });

  it('anti-vacuity: a known-good example is correctly cleared, not just never rejected', () => {
    expect(namesARegisteredCommand('$ os environments list', registeredIds)).toBe(true);
    expect(namesARegisteredCommand('$ os environments bind <id> --reseed', registeredIds)).toBe(true);
  });

  it('reverse-verification: the PRE-FIX line is rejected, and rejected for the declared reason', () => {
    const preFix = '$ os projects bind <project-id> --artifact ./dist/objectstack.json';
    // The reason it must fail: no file tree produces this id any more.
    expect(registeredIds.has('projects bind')).toBe(false);
    expect(registeredIds.has('projects')).toBe(false);
    expect(namesARegisteredCommand(preFix, registeredIds)).toBe(false);
  });

  const commandsUnderTest: Record<string, typeof Command> = {
    'bind.ts': EnvironmentsBind,
    'create.ts': EnvironmentsCreate,
    'list.ts': EnvironmentsList,
    'show.ts': EnvironmentsShow,
    'switch.ts': EnvironmentsSwitch,
  };

  for (const [file, Cmd] of Object.entries(commandsUnderTest)) {
    it(`${file}: every examples entry names a registered command`, () => {
      const examples = (Cmd.examples ?? []).filter((e): e is string => typeof e === 'string');
      expect(examples.length, `${file} has no string examples — nothing for this pin to check`).toBeGreaterThan(0);

      const unresolved = examples.filter((line) => !namesARegisteredCommand(line, registeredIds));
      expect(
        unresolved,
        `${file} has an examples entry naming a command id this CLI does not register — a user `
        + 'who copy-pastes it from --help gets "Command ... not found." Rename it to match the '
        + 'file\'s real topic, or move the file if the topic itself is what should change.',
      ).toEqual([]);
    });
  }
});
