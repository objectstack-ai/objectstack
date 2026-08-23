// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
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
  describe('bind', () => {
    it('has the expected description and flags', () => {
      expect(EnvironmentsBind.description).toMatch(/bind/i);
      expect(EnvironmentsBind.flags).toHaveProperty('artifact');
      expect(EnvironmentsBind.flags).toHaveProperty('build');
      expect(EnvironmentsBind.flags).toHaveProperty('reseed');
    });
  });

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
 * Pin (#10967): every `examples` entry on EVERY CLI command source names a
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
 * exactly as before while any `examples` string spelling the OLD topic
 * silently stops being true — not a parse error, not a type error, nothing
 * a build catches. A user who copy-pastes the stale line hits `Error:
 * Command projects:bind not found.` (exit 2). That is the shape #10967
 * fixed under `environments/*.ts`; this pin targets the MECHANISM (an
 * example naming an id this CLI does not register), not the literal string
 * `os projects`, so it keeps working for a topic nobody has renamed yet —
 * a grep for `os projects` would go green the instant someone renamed this
 * topic again to something else, or renamed a DIFFERENT topic entirely.
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
 * ## Population: EVERY command source, via AST — not via `import`
 *
 * The property is checked against every non-test file under
 * `packages/cli/src/commands/**`, not just the five #10967 touches — a
 * five-file population is exactly the set that is already correct, so it
 * cannot catch the defect class returning anywhere else (it did not catch
 * it in `register.ts`/`whoami.ts`/`logout.ts`, discovered by hand below).
 * `examples` is read via TypeScript AST (`extractExamples`), not by
 * `import`ing all ~60 command modules and reading `Cmd.examples` off the
 * live class: several commands pull heavy transitive graphs at module load
 * (database drivers, `@objectstack/client`, `@objectstack/runtime`), so
 * importing every one just to read one static array would make this file's
 * cost and failure surface track the whole package's import graph instead
 * of the property being tested — the same reasoning
 * `child-env-source-loader.pin.test.ts` gives for reading command sources
 * as text/AST rather than executing them.
 *
 * `extractExamples` handles every invocation shape actually present in this
 * package (catalogued by hand across all command sources before writing
 * this): a plain string (`'$ os topic cmd ...'`), the oclif help-template
 * form (`'<%= config.bin %> cmd ...'` — `config.bin` is `"os"`,
 * `package.json`'s `oclif.bin`), either of those prefixed by one or more
 * `ENV=value` assignments (`'$ OS_CLOUD_URL=http://localhost:4000 os
 * package publish'`, including a double-quoted value containing spaces —
 * `start.ts`'s `OS_ARTIFACT_URL="...#sha256=<64 hex chars>" <%= config.bin
 * %> start`), and the `{ command, description }` object form (`start.ts`,
 * two entries). An entry matching NONE of these is graded a failure with
 * its own message (not silently skipped) — "prefer failing to falling
 * back" (AGENTS.md, Route & surface ownership §3): a shape this pin cannot
 * parse is exactly the shape that could hide a stale command undetected.
 *
 * ## The one exclusion, and why it self-retired
 *
 * `register.ts` / `whoami.ts` / `logout.ts` are root-level commands whose
 * `examples` USED TO say `os auth register` / `os auth whoami` / `os auth
 * logout`, though no `auth` topic has ever existed for them (confirmed via
 * `--help`: `Error: Command auth:whoami not found.`) — the same defect
 * class as #10967, found by scanning the whole tree, but not #10967's to
 * fix (outside its dispatched file surface). Filed as #11221 and fixed
 * there, so `EXCLUDED` is now empty and all three are scanned by the main
 * assertion like every other command source.
 *
 * The mechanism stays, because it is what made that handoff safe: a silent,
 * permanent exemption is its own defect — a file excluded here stops being
 * checked by this pin forever, even after the excluded condition no longer
 * holds. So a second `it.each` re-runs the SAME predicate over the excluded
 * files and asserts it still finds an unresolved entry. That is not
 * hypothetical here: when #11221's fix removed the last unresolved entry,
 * this assertion went red on purpose for all three files, and its message
 * ("remove it from EXCLUDED above") is what retired them. The pattern
 * (map-of-reason + filtered main assertion + a "still needs its exclusion"
 * retiring assertion) matches
 * `packages/create-objectstack/src/starter-comments-self-contained.test.ts`'s
 * `EXCLUDED`, which has retired this same way before (#11022).
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

  function registeredCommandIds(): Set<string> {
    const ids = new Set<string>();
    for (const rel of commandSourceFiles()) {
      const parts = rel.split('/');
      const base = parts[parts.length - 1].slice(0, -'.ts'.length);
      const topics = parts.slice(0, -1);
      const command = base === 'index' ? undefined : base;
      const id = [...topics, command].filter((s): s is string => Boolean(s)).join(TOPIC_SEPARATOR);
      ids.add(id);
    }
    return ids;
  }

  /**
   * The `examples` entries a command source declares, read from the AST —
   * string literals directly, and a `command` property off any object-shaped
   * entry (`start.ts`'s two annotated examples). See the file header for why
   * this reads source instead of importing the command class.
   */
  function extractExamples(absPath: string): string[] {
    const text = readFileSync(absPath, 'utf8');
    const sourceFile = ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true);
    const found: string[] = [];

    const stringValue = (node: ts.Node): string | undefined =>
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined;

    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyDeclaration(node)
        && node.name && ts.isIdentifier(node.name) && node.name.text === 'examples'
        && node.initializer && ts.isArrayLiteralExpression(node.initializer)
      ) {
        for (const el of node.initializer.elements) {
          const direct = stringValue(el);
          if (direct !== undefined) {
            found.push(direct);
            continue;
          }
          if (ts.isObjectLiteralExpression(el)) {
            for (const prop of el.properties) {
              if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'command') {
                const value = stringValue(prop.initializer);
                if (value !== undefined) found.push(value);
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return found;
  }

  /** A leading `ENV_VAR=value ` assignment — value may be double- or single-quoted (and contain spaces). */
  const ENV_ASSIGNMENT = /^[A-Z_][A-Z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+/;
  const BIN_PREFIXES = ['os ', '<%= config.bin %> '] as const;

  /**
   * Strips a recognised CLI-invocation prefix (`$ `, then zero or more `ENV=value`
   * assignments, then the bin name) and returns what follows — the command
   * tokens. `undefined` means the line does not match any recognised shape.
   */
  function stripInvocationPrefix(raw: string): string | undefined {
    let s = raw.trim();
    if (s.startsWith('$ ')) s = s.slice(2);
    while (ENV_ASSIGNMENT.test(s)) s = s.replace(ENV_ASSIGNMENT, '');
    for (const prefix of BIN_PREFIXES) {
      if (s.startsWith(prefix)) return s.slice(prefix.length);
    }
    return undefined;
  }

  /** True when `raw` (an `examples` entry) invokes a registered command. */
  function namesARegisteredCommand(raw: string, ids: ReadonlySet<string>): boolean {
    const rest = stripInvocationPrefix(raw);
    if (rest === undefined) return false;
    for (const id of ids) {
      if (rest === id || rest.startsWith(`${id} `)) return true;
    }
    return false;
  }

  /**
   * Nothing is excluded — every command source is scanned. `register.ts` /
   * `whoami.ts` / `logout.ts` each carried a self-retiring entry here while
   * their `os auth …` examples were #11221's to fix; that fix landed, the
   * retiring assertion below went red exactly as designed, and the map goes
   * back to empty rather than staying around as a silent exemption over three
   * root-level commands. The assertion stays, so the next entry added here is
   * held to the same self-retirement.
   */
  const EXCLUDED = new Map<string, string>();

  const sourceFiles = commandSourceFiles();
  const registeredIds = registeredCommandIds();

  it('the walk reached real command sources across multiple topics (not vacuously empty)', () => {
    expect(sourceFiles).toContain('environments/bind.ts');
    expect(sourceFiles).toContain('migrate/index.ts'); // the index.ts special case
    expect(sourceFiles).toContain('data/query.ts');
    expect(sourceFiles).toContain('start.ts'); // the object-shaped `examples` entries
    expect(sourceFiles.length).toBeGreaterThan(30);
  });

  it('the registered-id set derived from the walk carries the same known ids', () => {
    expect(registeredIds.has('environments list')).toBe(true);
    expect(registeredIds.has('environments bind')).toBe(true);
    expect(registeredIds.has('migrate')).toBe(true);
    expect(registeredIds.has('data query')).toBe(true);
    expect(registeredIds.size).toBeGreaterThan(30);
  });

  it('anti-vacuity: a known-good example is correctly cleared, not just never rejected', () => {
    expect(namesARegisteredCommand('$ os environments list', registeredIds)).toBe(true);
    expect(namesARegisteredCommand('$ os environments bind <id> --reseed', registeredIds)).toBe(true);
    // The other two recognised invocation shapes, cleared the same way.
    expect(namesARegisteredCommand('<%= config.bin %> verify --rls', registeredIds)).toBe(true);
    expect(
      namesARegisteredCommand('$ OS_CLOUD_URL=http://localhost:4000 os package publish', registeredIds),
    ).toBe(true);
  });

  it('reverse-verification: the PRE-FIX line is rejected, and rejected for the declared reason', () => {
    const preFix = '$ os projects bind <project-id> --artifact ./dist/objectstack.json';
    // The reason it must fail: no file tree produces this id any more.
    expect(registeredIds.has('projects bind')).toBe(false);
    expect(registeredIds.has('projects')).toBe(false);
    expect(namesARegisteredCommand(preFix, registeredIds)).toBe(false);
  });

  it('anti-vacuity: the walk actually found examples entries to check, not just files', () => {
    const total = sourceFiles
      .filter((f) => !EXCLUDED.has(f))
      .reduce((n, f) => n + extractExamples(path.join(COMMANDS_ROOT, f)).length, 0);
    expect(total).toBeGreaterThan(50);
  });

  it.each(sourceFiles.filter((f) => !EXCLUDED.has(f)))(
    '%s: every examples entry names a registered command',
    (rel) => {
      const examples = extractExamples(path.join(COMMANDS_ROOT, rel));
      const unresolved = examples.filter((line) => !namesARegisteredCommand(line, registeredIds));
      expect(
        unresolved,
        `${rel} has an examples entry that does not resolve to a command this CLI registers -- `
        + 'either it names an id this CLI does not have (a user who copy-pastes it from --help '
        + 'gets "Command ... not found."), or it uses an invocation shape this pin does not '
        + 'recognise ($ os ..., <%= config.bin %> ..., each optionally prefixed by ENV=value '
        + 'assignments) -- extend stripInvocationPrefix if a new, legitimate shape is needed.',
      ).toEqual([]);
    },
  );

  it.each([...EXCLUDED.keys()])('%s still needs its exclusion (owned by #11221)', (rel) => {
    const examples = extractExamples(path.join(COMMANDS_ROOT, rel));
    const unresolved = examples.filter((line) => !namesARegisteredCommand(line, registeredIds));
    expect(
      unresolved.length,
      `${rel} no longer has an unresolved examples entry -- remove it from EXCLUDED above so it `
      + 'is scanned like every other command source. An exclusion kept past its cause is how a '
      + 'file stops being checked without anyone deciding to stop checking it.',
    ).toBeGreaterThan(0);
  });
});
