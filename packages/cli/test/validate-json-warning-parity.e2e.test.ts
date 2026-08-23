// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10953 — `os validate` and `os validate --json` carry the SAME warning set
 * for the same config.
 *
 * ## The defect this pins shut
 *
 * `--json` exists so CI can gate on the advisories `os validate` computes. Four
 * of them could never reach it: `commands/validate.ts` emitted the JSON payload
 * and `return`ed *above* the block that computes them, so the four structural
 * advisories (no objects / no apps+plugins / missing `manifest.id` / missing
 * `manifest.namespace`) were printed for a human and structurally unreachable
 * for the machine. Measured on the `bare` fixture below before the fix: the text
 * face printed four warnings, `--json` reported `"warnings": []` for the byte
 * -identical config. The documented purpose of the flag was defeated.
 *
 * ## Why this pin is an EQUIVALENCE pin and not four `toContain` assertions
 *
 * Asserting "these four now appear in the JSON" would close four holes and leave
 * the CLASS open: the next advisory added below the `if (flags.json)` branch
 * would be text-only again and nothing would say so. So both sides are derived
 * from their own PRODUCTION SOURCE — the real text stdout and the real JSON
 * payload of two real CLI runs — and compared as sets. Nothing in this file
 * hardcodes an expected message: a transcribed list would test the transcription,
 * not the command.
 *
 * The one number each fixture does state is a `floor` — the minimum warning
 * count the run must produce. It is not an expected list; it exists solely so
 * the set equality cannot pass VACUOUSLY. Without it a config that produces zero
 * warnings on both faces satisfies "the sets are equal" perfectly, and this file
 * would stay green with the fix reverted.
 *
 * ## The two declared fields this comparison deliberately excludes
 *
 * The text face folds two more advisory streams into the same `⚠` block that
 * the JSON payload carries as its own top-level fields instead — `conversions`
 * (ADR-0087 D2 load-time conversion notices) and `specVersionGap`. Those are a
 * declared difference in SHAPE, not a drop: the information is reachable on both
 * faces. Rather than silently ignoring them, every fixture ASSERTS both are
 * empty, so the exact set equality below is honest about its scope — and if a
 * future change makes either non-empty for these fixtures, this file fails
 * loudly instead of quietly comparing a subset.
 *
 * ## Not in scope: zero-state stat rows
 *
 * `printMetadataStats` prints zero-state section rows (`UI: 0 Apps`, and more of
 * them once the `zeroFallback` work lands). Those are a different output element
 * from a non-blocking warning — they carry no `⚠` and never enter either
 * `warnings` array — so they cannot enter this comparison. Verified against the
 * fixtures below, whose text output carries such rows while the warning sets
 * stay exactly equal.
 *
 * Spawns the real CLI (the `validate-top-level-strict.e2e.test.ts` pattern:
 * `bin/run-dev.js` + tsx, no dependency on `packages/cli/dist`) because the
 * divergence being pinned is between two real invocations, not two functions.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

interface Fixture {
  /** Directory name / test label. */
  readonly name: string;
  readonly what: string;
  readonly source: string;
  /**
   * Minimum warnings this config must raise on the text face. An anti-vacuity
   * floor, NOT an expected list — see the header.
   */
  readonly floor: number;
}

const FIXTURES: readonly Fixture[] = [
  {
    name: 'bare',
    what: 'all four structural advisories at once (the card\'s measurement)',
    // No `manifest` at all, no objects, no apps: the only shape that trips all
    // four conditions in one run. `manifest.id` is schema-REQUIRED when a
    // `manifest` is present, so a config that merely omits the id fails the
    // parse and exits long before any warning is computed.
    source: `
export default {
  objects: [],
  apps: [],
};
`,
    floor: 4,
  },
  {
    name: 'mixed',
    what: 'a registry advisory (structured) beside a structural one (string)',
    // The JSON `warnings` array is heterogeneous by construction: registry and
    // doc findings ride as OBJECTS, unknown-key and structural advisories as
    // STRINGS. This fixture puts one of each in the same run, so the parity
    // check is exercised across both representations rather than only over the
    // string ones. `externalSharingModel` is ledger-marked `authorWarn`, which
    // is what raises the registry-side advisory.
    source: `
export default {
  manifest: { id: 'com.example.parity', name: 'parity', version: '1.0.0', type: 'app', namespace: 'parity' },
  objects: [{
    name: 'parity_ticket',
    label: 'Ticket',
    sharingModel: 'private',
    externalSharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } },
  }],
};
`,
    floor: 2,
  },
];

/** The zero-warning control — see the test that uses it. */
const CLEAN_SOURCE = `
export default {
  manifest: { id: 'com.example.clean', name: 'clean', version: '1.0.0', type: 'app', namespace: 'clean' },
  objects: [{
    name: 'clean_ticket',
    label: 'Ticket',
    sharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } },
  }],
  apps: [{ name: 'clean_app', label: 'Clean App' }],
};
`;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, ...args],
      { cwd, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } },
      (err, stdout, stderr) => {
        resolvePromise({
          code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

/**
 * The text face's warning set, read off the rendered output — its production
 * source. Every non-blocking warning `os validate` prints goes through the one
 * `⚠` line shape.
 */
function textWarnings(stdout: string): string[] {
  return stdout
    .split('\n')
    .filter((l) => l.includes('⚠'))
    .map((l) => l.slice(l.indexOf('⚠') + 1).trim())
    .filter((l) => l.length > 0);
}

/**
 * The JSON face's warning set, read off the emitted payload — its production
 * source. Entries ride either as a bare string or as a finding object; the
 * message is the part the text face renders, so it is the comparable key.
 */
function jsonWarnings(payload: { warnings?: unknown }): string[] {
  const raw = Array.isArray(payload.warnings) ? payload.warnings : [];
  return raw.map((w) => {
    if (typeof w === 'string') return w;
    const message = (w as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    throw new Error(`warning entry is neither a string nor a {message} object: ${JSON.stringify(w)}`);
  });
}

/**
 * Match each JSON message to a DISTINCT text line by containment, and report
 * what is left over on either side.
 *
 * Containment rather than equality because a structured finding keeps `where`
 * as its own field while the text face renders `${where}: ${message}` — the
 * same advisory, one face carrying the locus separately. Comparing on the
 * message avoids re-implementing that join here, which would make this file a
 * pin on the formatting rather than on the parity.
 *
 * Consuming a distinct line per message is what makes this a bijection and not
 * a mutual-covering check: two JSON copies of one advisory cannot both be
 * satisfied by a single printed line.
 */
function pair(jsonMessages: string[], lines: string[]): { jsonOnly: string[]; textOnly: string[] } {
  const remaining = [...lines];
  const jsonOnly: string[] = [];
  for (const m of jsonMessages) {
    const i = remaining.findIndex((l) => l.includes(m));
    if (i === -1) jsonOnly.push(m);
    else remaining.splice(i, 1);
  }
  return { jsonOnly, textOnly: remaining };
}

const dirs = new Map<string, string>();

beforeAll(() => {
  for (const f of FIXTURES) {
    const dir = mkdtempSync(join(tmpdir(), `os-validate-parity-${f.name}-`));
    writeFileSync(join(dir, 'objectstack.config.ts'), f.source);
    dirs.set(f.name, dir);
  }
  const cleanDir = mkdtempSync(join(tmpdir(), 'os-validate-parity-clean-'));
  writeFileSync(join(cleanDir, 'objectstack.config.ts'), CLEAN_SOURCE);
  dirs.set('clean', cleanDir);
});

afterAll(() => {
  for (const dir of dirs.values()) rmSync(dir, { recursive: true, force: true });
});

describe('#10953 — text and --json carry the same warning set', () => {
  for (const f of FIXTURES) {
    it(`${f.name}: ${f.what}`, async () => {
      const dir = dirs.get(f.name)!;

      const text = await runCli(['validate'], dir);
      expect(text.code, `text run failed:\n${text.stdout}\n${text.stderr}`).toBe(0);

      const json = await runCli(['validate', '--json'], dir);
      expect(json.code, `json run failed:\n${json.stdout}\n${json.stderr}`).toBe(0);

      const payload = JSON.parse(json.stdout) as {
        warnings?: unknown;
        conversions?: unknown;
        specVersionGap?: unknown;
      };

      // Scope declaration, asserted rather than assumed — see the header.
      expect(payload.conversions, 'fixture must raise no conversion notices').toEqual([]);
      expect(payload.specVersionGap, 'fixture must raise no spec-version gap').toBeNull();

      const lines = textWarnings(text.stdout);
      const messages = jsonWarnings(payload);

      // Anti-vacuity: a run with nothing to compare would satisfy set equality.
      expect(lines.length, `text face raised too few warnings to compare:\n${text.stdout}`)
        .toBeGreaterThanOrEqual(f.floor);

      const { jsonOnly, textOnly } = pair(messages, lines);
      expect(
        { jsonOnly, textOnly },
        `warning sets diverge for the same config.\n` +
          `text (${lines.length}):\n  ${lines.join('\n  ')}\n` +
          `json (${messages.length}):\n  ${messages.join('\n  ')}`,
      ).toEqual({ jsonOnly: [], textOnly: [] });
    }, 120_000);
  }

  it('control: a config with nothing to warn about is empty on BOTH faces', async () => {
    // Proves the parity above is not satisfied by one face simply echoing the
    // other's non-emptiness — the fix must not manufacture warnings either.
    const dir = dirs.get('clean')!;

    const text = await runCli(['validate'], dir);
    expect(text.code, `text run failed:\n${text.stdout}\n${text.stderr}`).toBe(0);
    expect(textWarnings(text.stdout)).toEqual([]);

    const json = await runCli(['validate', '--json'], dir);
    expect(json.code, `json run failed:\n${json.stdout}\n${json.stderr}`).toBe(0);
    expect(jsonWarnings(JSON.parse(json.stdout))).toEqual([]);
  }, 120_000);
});
