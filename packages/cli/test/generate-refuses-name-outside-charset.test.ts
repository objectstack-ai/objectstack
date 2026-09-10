// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#16726) — `os generate <type> <name>` refuses a name outside the
 * charset `packages/spec` declares for an object `name`, refuses it BEFORE it
 * derives anything from that name, and refuses it without rewriting it.
 *
 * ## The ruling this measures
 *
 * Decision batch #82 (2026-09-08), maintainer 「同意」 on option A — a GATE:
 *
 * > `os generate` refuses, before deriving anything, any name outside the
 * > charset `packages/spec` already declares for an object `name`
 * > (`^[a-z_][a-z0-9_]*$` — the implementer re-reads the schema rather than
 * > trusting this transcription). The refusal names the value and the rule.
 * > PR #16724's parse check stays as the backstop. ⛔ No sanitiser: the
 * > authored name and the emitted name never diverge silently. ⛔ No third
 * > charset.
 *
 * So: the refusal is asserted here, and the ⛔ half is asserted with it — a
 * gate that also quietly repaired the name would satisfy "exit 1" and would be
 * the option (B) the ruling refused.
 *
 * ⛔ The charset is NOT transcribed in this file either. The rule the command
 * prints is compared against the message the SPEC schema itself produces for
 * the same input, so a command that invented its own wording, or a gate wired
 * to a copy of the charset, reddens here — and a deliberate move in spec moves
 * both sides at once instead of leaving a stale literal to be argued with.
 *
 * ## THE TWO LAYERS ARE DISTINCT — measured in both directions
 *
 * The gate sits in front of #16541's parse check, and neither shadows the
 * other. That is not an opinion about where they sit; it is a property with
 * witnesses, and both are exercised below:
 *
 *   - `order-line` — REFUSED by the gate, and the parse check would have
 *     ACCEPTED it (its emission parses clean, asserted here against the very
 *     instrument the command runs). Delete the gate and this name generates.
 *   - `class` — ADMITTED by the gate (every character is in the charset), and
 *     REFUSED by the parse check for `object`, because `const class:` is not a
 *     declaration. Delete the parse check and this name generates.
 *
 * ## Why a child process
 *
 * Same two reasons as `generate-refuses-unparseable-name.test.ts`: the defect
 * class here is an EXIT CODE plus bytes on disk, `process.exitCode` inside a
 * vitest worker is not an exit status, and these commands print through
 * `utils/format.ts`, whose `printError` writes to stdout. Spawned through
 * `bin/run-dev.js` + tsx so the suite does not depend on `packages/cli/dist`.
 *
 * ## ⛔ Why this file is NOT named `.e2e`
 *
 * The same sanctioned combination its sibling documents: the BEHAVIOUR
 * predicate in `vitest-tiers.ts` puts a spawning file in the `integration`
 * project, while the NAME decides which RUN collects it. What is pinned here
 * is a published command's accepted set, so it belongs in the run that gates
 * the merge queue, not in the nightly one.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectSchema } from '@objectstack/spec/data';
import { GENERATOR_SCAFFOLD_TARGETS } from '../src/commands/generate.js';
import { metadataFileName } from '../src/utils/metadata-file-name.js';
import { findEmissionParseFailures } from '../src/utils/emitted-source-parses.js';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/** oclif + tsx cold start, with every command module loaded; ~2-10 s when healthy. */
const RUN_TIMEOUT_MS = 240_000;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runTsx(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      args,
      { cwd, maxBuffer: 8 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        resolvePromise({
          // `err.code` is the real exit status; null/undefined means the child
          // was signalled — a different failure, never reported as 0.
          code: err
            ? typeof (err as { code?: unknown }).code === 'number'
              ? (err as unknown as { code: number }).code
              : 1
            : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

/**
 * What the SPEC schema says about `name`, asked the same way the command asks
 * it. The command's refusal is compared against this, so neither side is a
 * transcription of the other.
 */
function specVerdict(name: string): { accepted: boolean; message: string } {
  const verdict = ObjectSchema.shape.name.safeParse(name);
  return verdict.success
    ? { accepted: true, message: '' }
    : { accepted: false, message: verdict.error.issues[0]?.message ?? '' };
}

/** `toSnakeCase` / `toCamelCase` as `generate.ts` spells them (same reason as the sibling pin: not exported for a test's convenience). */
function toSnakeCase(str: string): string {
  return str.replace(/[-]/g, '_').replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`).replace(/^_/, '');
}
function toCamelCase(str: string): string {
  return str.replace(/[-_]([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** The two emissions one `os generate <type> <name>` produces, built the way the command builds them. */
function emissionsFor(type: string, name: string) {
  const target = GENERATOR_SCAFFOLD_TARGETS.find((t) => t.type === type);
  if (!target) throw new Error(`no generator for type: ${type}`);
  const fileName = metadataFileName(type, toSnakeCase(name));
  if (fileName === null) throw new Error(`no file naming convention for type: ${type}`);
  return [
    { label: fileName, source: target.generate(name) },
    {
      label: 'index.ts',
      source: `export { default as ${toCamelCase(name)} } from './${fileName.replace(/\.ts$/, '')}';`,
    },
  ];
}

let gatedDir: string;
let dryRunDir: string;
let backstopDir: string;
let controlDir: string;

let gated: Run;
let dryRun: Run;
let backstop: Run;
let control: Run;

beforeAll(async () => {
  gatedDir = mkdtempSync(join(tmpdir(), 'os-g-charset-'));
  dryRunDir = mkdtempSync(join(tmpdir(), 'os-g-charset-dry-'));
  backstopDir = mkdtempSync(join(tmpdir(), 'os-g-charset-backstop-'));
  controlDir = mkdtempSync(join(tmpdir(), 'os-g-charset-control-'));

  // Sequential on purpose: cold tsx starts, each loading every command module,
  // in a container several agents share.
  gated = await runTsx([CLI, 'generate', 'object', 'order-line'], gatedDir);
  dryRun = await runTsx([CLI, 'generate', 'flow', 'lead-qual', '--dry-run'], dryRunDir);
  backstop = await runTsx([CLI, 'generate', 'object', 'class'], backstopDir);
  control = await runTsx([CLI, 'generate', 'object', 'order_line'], controlDir);
}, RUN_TIMEOUT_MS);

afterAll(() => {
  for (const dir of [gatedDir, dryRunDir, backstopDir, controlDir]) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('[#16726] a name outside the declared charset is refused at the door', () => {
  it('exits non-zero — `order-line` used to exit 0', () => {
    expect(gated.code).toBe(1);
  });

  it('names the VALUE it refused', () => {
    expect(gated.stdout).toContain('order-line');
  });

  it('names the RULE — and it is the schema`s own, not this command`s wording', () => {
    const verdict = specVerdict('order-line');
    expect(verdict.accepted).toBe(false);
    // Non-empty guard: a schema that stopped producing a message would make
    // the assertion below vacuously true.
    expect(verdict.message.length).toBeGreaterThan(0);
    expect(gated.stdout).toContain(verdict.message);
  });

  it('⛔ does not rewrite the name into one that fits', () => {
    // Option B, refused by the ruling: the author writes one name and a
    // different one lands in the file. Neither the folded metadata name nor
    // the derived binding may appear anywhere in a refusal.
    expect(gated.stdout).not.toContain('order_line');
    expect(gated.stdout).not.toContain('orderLine');
    expect(gated.stdout).not.toContain('Created');
  });

  it('writes nothing — no scaffold, no barrel, no directory', () => {
    expect(existsSync(join(gatedDir, 'src'))).toBe(false);
  });

  it('is the CHARSET refusal, not the parse check speaking', () => {
    // If this said "does not parse", the gate would not exist and #16541's
    // backstop would be answering — for a name whose emission parses fine.
    expect(gated.stdout).not.toContain('does not parse');
  });
});

describe('[#16726] the gate is one chokepoint, and it fires before the preview', () => {
  it('`os generate flow lead-qual --dry-run` is refused too', () => {
    // A second generator AND the dry-run branch in one run: a preview that
    // renders a scaffold for a name the command would refuse to write is the
    // same divergence in preview form.
    expect(dryRun.code).toBe(1);
    expect(dryRun.stdout).toContain('lead-qual');
    expect(dryRun.stdout).not.toContain('Automation.Flow');
    expect(dryRun.stdout).not.toContain('leadQual');
    expect(existsSync(join(dryRunDir, 'src'))).toBe(false);
  });
});

describe('[#16726] the gate and #16541`s parse check are DISTINCT layers', () => {
  it('the gate refuses a name the parse check would have accepted', async () => {
    // `order-line`: the emission is parseable — measured with the instrument
    // the command itself runs — so the ONLY thing standing between it and a
    // generated file is the gate asserted above.
    const failures = await findEmissionParseFailures(emissionsFor('object', 'order-line'));
    expect(failures).toEqual([]);
    expect(specVerdict('order-line').accepted).toBe(false);
    expect(gated.code).toBe(1);
  });

  it('the parse check refuses a name the gate admits', async () => {
    // `class` is inside the charset — every character is a lowercase letter —
    // so the gate lets it through and the backstop is what refuses it.
    expect(specVerdict('class').accepted).toBe(true);
    const failures = await findEmissionParseFailures(emissionsFor('object', 'class'));
    expect(failures.length).toBeGreaterThan(0);
    expect(backstop.code).toBe(1);
    expect(backstop.stdout).toContain('does not parse');
    // ⛔ The gate must not have shadowed it: the author gets the compiler's
    // reason, which is the specific one.
    expect(backstop.stdout).toContain("',' expected.");
  });

  it('⚠️ records what the pair actually does with `os generate view class`', () => {
    // The card called this row "the decision in miniature", and the ruling
    // comment's closing line states it "is therefore refused at the door".
    // ⚠️ That does not follow from the mechanism the same ruling specifies:
    // `class` is INSIDE the charset spec declares for an object `name`, so a
    // charset gate admits it, and the `view` generator emits `const
    // classViews:` plus an `export { default as class }` alias, both of which
    // parse. The pair therefore still accepts it.
    //
    // Recorded rather than legislated: refusing reserved words is a THIRD
    // rule, and the ruling's other half is ⛔ no third charset. Reported on
    // #16726 for the maintainer; this assertion exists so that whichever way
    // that is answered, the answer is a deliberate edit here.
    expect(specVerdict('class').accepted).toBe(true);
    return findEmissionParseFailures(emissionsFor('view', 'class')).then((failures) => {
      expect(failures).toEqual([]);
    });
  });
});

describe('[#16726] CONTROL — a name inside the charset still generates', () => {
  it('still exits 0 and reports both writes', () => {
    // A gate that refused everything would satisfy every assertion above.
    expect(control.code).toBe(0);
    expect(control.stdout).toContain('Created src/objects/order_line.object.ts');
    expect(control.stdout).toContain('Created src/objects/index.ts');
    expect(existsSync(join(controlDir, 'src', 'objects', 'order_line.object.ts'))).toBe(true);
  });

  it('a leading underscore is inside the charset too', () => {
    // The charset spec declares is `[a-z_]` first, not `[a-z]` — asserted
    // through the schema rather than by spawning a fifth child process, so a
    // gate quietly narrowed to "letters only" is still caught.
    expect(specVerdict('_internal').accepted).toBe(true);
    expect(specVerdict('order_line_2').accepted).toBe(true);
    expect(specVerdict('Order').accepted).toBe(false);
    expect(specVerdict('2fast').accepted).toBe(false);
    expect(specVerdict('').accepted).toBe(false);
  });
});
