// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The PRE-BOOT `--json` family: the commands that refuse at
 * `resolveConfigPath()`, before any kernel exists (#15547).
 *
 * ## Why this is a shared module and not a constant in one test file
 *
 * `json-stdout-purity.e2e.test.ts` pins "stdout is exactly one JSON document"
 * and DISCOVERS its family as the commands that call `bootSchemaStack`. The
 * commands here never boot one — they fail above it — so that discovery
 * structurally cannot see them, and the whole `--json`-stdout contract was
 * being watched by an instrument blind to ten of its faces.
 *
 * Widening that pin's own discovery to include them would drive ten commands
 * that emit no boot diagnostics against assertions about boot diagnostics. So
 * the POPULATION is widened across the pair instead: this module owns the
 * pre-boot discovery, `config-miss-stdout-purity.e2e.test.ts` drives it, and
 * `json-stdout-purity.e2e.test.ts` reconciles against it — which makes losing
 * the pre-boot half a red in BOTH files rather than a silent gap in neither.
 *
 * ⛔ Do not inline either export back into a test file. The blind spot this
 * closes was created exactly by a discovery that only one file could see.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');

/** `packages/cli/src/commands` — the tree both discoveries read. */
export const COMMANDS_DIR = resolve(HERE, '../../src/commands');

/** A path that cannot exist, driving the EXPLICIT-PATH branch of the helper. */
export const MISSING_CONFIG = './nope-does-not-exist.ts';

/**
 * How to drive one member into the config helper.
 *
 * `auto: null` marks the one member with no auto-detect branch to drive:
 * `os diff` requires two config paths, so there is no bare form that reaches
 * the helper without one.
 */
export interface ConfigMissMember {
  /** argv that reaches the helper with an EXPLICIT missing path. */
  explicit: string[];
  /** argv that reaches the helper with NO path, or `null` when there is none. */
  auto: string[] | null;
}

export const CONFIG_MISS_FAMILY: Record<string, ConfigMissMember> = {
  // `build` is `class Build extends Compile` — the alias half of the discovery.
  build: { explicit: [MISSING_CONFIG], auto: [] },
  compile: { explicit: [MISSING_CONFIG], auto: [] },
  diff: { explicit: [MISSING_CONFIG, MISSING_CONFIG], auto: null },
  'i18n check': { explicit: [MISSING_CONFIG], auto: [] },
  'i18n extract': { explicit: [MISSING_CONFIG], auto: [] },
  info: { explicit: [MISSING_CONFIG], auto: [] },
  lint: { explicit: [MISSING_CONFIG], auto: [] },
  // `--from` because `--stored` is its only other way past the flag parser, and
  // `--stored` boots a kernel — a different family, already pinned elsewhere.
  'migrate meta': { explicit: [MISSING_CONFIG, '--from', '4'], auto: ['--from', '4'] },
  validate: { explicit: [MISSING_CONFIG], auto: [] },
  // The config path is a FLAG here, not a positional.
  verify: { explicit: ['--app', MISSING_CONFIG], auto: [] },
};

/** The refusal text, one line per branch — what must be on stderr, never stdout. */
export const CONFIG_MISS_REFUSAL = {
  explicit: 'Config file not found',
  auto: 'No objectstack.config.{ts,js,mjs} found in current directory',
} as const;

/**
 * The exact stderr a refusal writes, byte for byte.
 *
 * Held here rather than asserted with `toContain` because the two HINT lines
 * are the half a "make the helper throw" change silently deletes: a catch-all
 * that re-renders `error.message` reproduces the first line and nothing else,
 * and a containment assertion on the first line passes through that loss. The
 * text face of these ten commands is pinned to this whole string (#15547).
 */
export function expectedRefusalStderr(branch: 'explicit' | 'auto', absentPath: string): string {
  if (branch === 'explicit') {
    return (
      `  ✗ Config file not found: ${absentPath}\n`
      + '\n'
      + '  Hint: Run this command from a directory with objectstack.config.ts\n'
      + '  Or specify the path: objectstack <command> path/to/config.ts\n'
    );
  }
  return (
    '  ✗ No objectstack.config.{ts,js,mjs} found in current directory\n'
    + '\n'
    + '  Hint: Run `objectstack init` to create a new project\n'
  );
}

/** Every `.ts` under `src/commands`, excluding tests. */
function commandFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      out.push(...commandFiles(abs));
      continue;
    }
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
    out.push(abs);
  }
  return out;
}

/** `src/commands/i18n/check.ts` → `i18n check`, the id oclif dispatches on. */
function commandId(abs: string): string {
  const rel = relative(COMMANDS_DIR, abs).replace(/\.ts$/, '');
  return rel.split(sep).filter((p) => p !== 'index').join(' ');
}

/**
 * The family, read off the source rather than remembered: a command belongs iff
 * it offers a machine-readable mode AND reaches the config helper — directly,
 * or by extending a command that does.
 *
 * The discovery has two halves because the reach has two shapes:
 *
 *   • DIRECT — the module declares `json: Flags.boolean(` and imports from
 *     `utils/config.js`.
 *   • ALIAS — the module's default export `extends` a command in the direct
 *     set, so it inherits both the flag and the reach without naming either.
 *     `os build` is exactly this (`class Build extends Compile`), and a
 *     one-half discovery would have missed it: the original card's static
 *     reading listed nine modules, and `build` is the tenth face.
 */
export function discoverConfigMissFamily(): string[] {
  const files = commandFiles(COMMANDS_DIR);
  const sources = new Map(files.map((abs) => [abs, readFileSync(abs, 'utf-8')]));

  const direct = new Set<string>();
  for (const [abs, src] of sources) {
    if (!/\bjson:\s*Flags\.boolean\(/.test(src)) continue;
    if (!/from '(?:\.\.\/)+utils\/config\.js'/.test(src)) continue;
    direct.add(abs);
  }

  // An alias inherits the flag and the reach from the class it extends, and
  // names neither itself. Resolve `extends <Ident>` back to the module the
  // identifier was imported from, and take the member if that module is in the
  // direct set. One level is enough for the aliases in this tree and a deeper
  // chain would show up as a discovery mismatch rather than pass silently.
  const alias = new Set<string>();
  for (const [abs, src] of sources) {
    const ext = /export default class \w+ extends (\w+)\b/.exec(src);
    if (!ext) continue;
    const imported = new RegExp(`import ${ext[1]} from '(\\.[^']+)\\.js'`).exec(src);
    if (!imported) continue;
    const target = resolve(abs, '..', `${imported[1]}.ts`);
    if (direct.has(target)) alias.add(abs);
  }

  return [...direct, ...alias].map(commandId).sort();
}
