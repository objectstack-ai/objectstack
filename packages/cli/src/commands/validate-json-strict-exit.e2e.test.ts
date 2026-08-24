// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11174 — `os validate --strict` reaches the SAME exit status with `--json` as
 * without it, over the real CLI process.
 *
 * ## The defect this pins shut
 *
 * `commands/validate.ts` emitted the `--json` payload and `return`ed *above* the
 * only `flags.strict` reader, which lived inside the text-rendering block. So on
 * a config raising four non-blocking advisories:
 *
 *     os validate --strict          → exit 1   ("Strict mode: warnings treated as errors")
 *     os validate --json --strict   → exit 0   (same config, same flag)
 *
 * `--strict` was accepted, documented — `content/docs/deployment/cli.mdx` spells
 * `os validate --json --strict` twice in its CI/CD section, once as a GitHub
 * Actions step — and inert. A pipeline gating on the exit status of the exact
 * documented invocation read 0 and concluded the stack was clean.
 *
 * This is the second half of a pair. The first (#10953) made the four structural
 * advisories *reachable* in the payload, so a pipeline could at least gate on
 * `warnings.length` itself; it did not touch the exit code, and a pipeline
 * trusting the exit status still could not.
 *
 * ## Why the assertions are a PARITY matrix and not `expect(code).toBe(1)`
 *
 * A hardcoded `1` pins one cell and says nothing about the property the card is
 * about: that the two faces of one command agree. Both sides here are read from
 * their own production source — the real exit status of two real CLI runs of the
 * same config — and compared to each other. Nothing states an expected code.
 *
 * That comparison alone is satisfiable two dishonest ways, and both are closed:
 *
 *  - **vacuously**, by a config that exits 0 on both faces. The `warns` fixture
 *    carries a FLOOR — its text run must exit non-zero — so equality is only
 *    ever asserted over a run that genuinely had something to fail on. Without
 *    it this file stays green with the fix reverted.
 *  - **by breaking the other face** — making `--json --strict` and text agree at
 *    0. The `clean` fixture pins the zero end, so both faces are held to 1 on
 *    warnings and to 0 without them; neither can move to meet the other.
 *
 * And one further run, without `--strict`, separates "gates on `--strict`" from
 * "fails whenever `--json` sees a warning" — two fixes that pass the matrix
 * above identically, only one of which is the one asked for.
 *
 * ## The conversions-only cell (#11301)
 *
 * `--strict` gates on the TEXT face's warning list, and that list folds in the
 * ADR-0087 D2 load-time conversion notices. The payload carries those notices
 * separately, under `conversions`; its own `warnings` field is the five-way
 * spread WITHOUT them. So a config whose only advisories are conversion notices
 * exits 1 carrying `{ valid: true, warnings: [], conversions: [...] }` — the one
 * cell where the exit code is decided by a collection absent from the payload
 * field a reader reaches for first. Every fixture above raises zero conversions,
 * so a regression narrowing the gate back to `payload.warnings` would restore
 * the original divergence for exactly these configs with all of them green.
 *
 * The two fixtures below are a MINIMAL PAIR from one template, differing in a
 * single key on one page-header component: `description`, the alias
 * `page-header-subtitle-alias` rewrites at load, against `subtitle`, the
 * canonical spelling that converts nothing. So the pin discriminates on the
 * CONVERSION and not on "a page is present" — measured on the pair before it
 * was written: `description` → text `--strict` 1, `--json --strict` 1, `--json`
 * 0, `warnings: []`, one notice; `subtitle` → 0 on every face, no notices.
 *
 * The non-empty `conversions` assertion is the anti-vacuity guard, and it is
 * load-bearing rather than decorative. `page-header-subtitle-alias` is a LIVE
 * window that retires from the load path at protocol 18; the day it retires,
 * this fixture raises nothing and, without that assertion, the file would keep
 * passing while pinning an empty cell — precisely the failure this test exists
 * to remove. It goes red instead, and whoever retires the entry re-points the
 * fixture at another live conversion. (The obvious candidate for this fixture,
 * `object-compactLayout-to-highlightFields`, is already `retiredFromLoadPath`:
 * the schema tombstones the key, so it raises a validation ERROR, not a notice.)
 *
 * ## Why a real child process
 *
 * `process.exitCode` set inside a vitest worker is not an exit status: the
 * number only exists once Node has exited and the kernel has masked it to
 * `& 0xFF`. `test/migrate-exit-code.e2e.test.ts` is the precedent and states
 * this in the same words — the audience `--json` exists for reads the SHELL, so
 * that is what gets asserted. Spawned through `bin/run-dev.js` + tsx, so the
 * suite does not depend on `packages/cli/dist` having been built.
 *
 * ## Why this file is not beside its siblings in `packages/cli/test/`
 *
 * That directory was held by another in-flight card while this one was written,
 * so it was read-only to this change. `src/` turns out to be the stronger of the
 * two homes anyway, and deliberately so for the same reason
 * `utils/format.exit-code.test.ts` gives for living here: `packages/cli/
 * tsconfig.json` includes `src`, so `pnpm typecheck` compiles this file, while
 * no tsc program reads `packages/cli/test/`. `tsconfig.build.json` excludes
 * `src/**\/*.test.ts`, so nothing here ships.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../../bin/run-dev.js');
const TSX = resolve(HERE, '../../../../node_modules/.bin/tsx');

/**
 * Raises all four structural advisories at once and nothing else: no
 * `manifest`, no objects, no apps. The card's own measurement used this shape,
 * and it still parses — `manifest.id` is schema-REQUIRED once a `manifest` is
 * present, so a config that merely omits the id fails the parse and exits long
 * before any advisory is computed.
 */
const WARNS_SOURCE = `
export default {
  objects: [],
  apps: [],
};
`;

/** The zero-warning control — pins the other end of the matrix. */
const CLEAN_SOURCE = `
export default {
  manifest: { id: 'com.example.strictexit', name: 'strictexit', version: '1.0.0', type: 'app', namespace: 'strictexit' },
  objects: [{
    name: 'strictexit_ticket',
    label: 'Ticket',
    sharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } },
  }],
  apps: [{ name: 'strictexit_app', label: 'Strict Exit App' }],
};
`;

/**
 * The conversions-only minimal pair (#11301) — `CLEAN_SOURCE`'s shape plus one
 * `page:header` component, whose second line is authored under the key named.
 *
 * Nothing else here raises an advisory: the unknown-key lints run on the
 * POST-conversion `normalized`, so what they see is the canonical `subtitle`
 * either way, and both members are pinned to `warnings: []` below rather than
 * assumed to be.
 */
const headerPageSource = (headerTextKey: 'description' | 'subtitle'): string => `
export default {
  manifest: { id: 'com.example.strictexit', name: 'strictexit', version: '1.0.0', type: 'app', namespace: 'strictexit' },
  objects: [{
    name: 'strictexit_ticket',
    label: 'Ticket',
    sharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } },
  }],
  apps: [{ name: 'strictexit_app', label: 'Strict Exit App' }],
  pages: [{
    name: 'strictexit_home',
    label: 'Home',
    regions: [{ name: 'main', components: [
      { type: 'page:header', properties: { title: 'Tickets', ${headerTextKey}: 'All open tickets' } },
    ] }],
  }],
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

let warnsDir: string;
let cleanDir: string;
let conversionsDir: string;
let conversionsCanonDir: string;

beforeAll(() => {
  warnsDir = mkdtempSync(join(tmpdir(), 'os-validate-strict-exit-warns-'));
  writeFileSync(join(warnsDir, 'objectstack.config.ts'), WARNS_SOURCE);
  cleanDir = mkdtempSync(join(tmpdir(), 'os-validate-strict-exit-clean-'));
  writeFileSync(join(cleanDir, 'objectstack.config.ts'), CLEAN_SOURCE);
  conversionsDir = mkdtempSync(join(tmpdir(), 'os-validate-strict-exit-conversions-'));
  writeFileSync(join(conversionsDir, 'objectstack.config.ts'), headerPageSource('description'));
  conversionsCanonDir = mkdtempSync(join(tmpdir(), 'os-validate-strict-exit-conversions-canon-'));
  writeFileSync(join(conversionsCanonDir, 'objectstack.config.ts'), headerPageSource('subtitle'));
});

afterAll(() => {
  rmSync(warnsDir, { recursive: true, force: true });
  rmSync(cleanDir, { recursive: true, force: true });
  rmSync(conversionsDir, { recursive: true, force: true });
  rmSync(conversionsCanonDir, { recursive: true, force: true });
});

describe('#11174 — --strict reaches the same exit status on both faces', () => {
  it('a config with advisories: --json --strict exits exactly as --strict does', async () => {
    const text = await runCli(['validate', '--strict'], warnsDir);
    const json = await runCli(['validate', '--json', '--strict'], warnsDir);

    // Anti-vacuity floor: equality below is only meaningful over a run that had
    // something to fail on. This is the reference face, so it is also the
    // statement that the text side has not moved to meet the JSON one.
    expect(
      text.code,
      `text --strict must fail on this config for the parity below to mean anything:\n${text.stdout}\n${text.stderr}`,
    ).not.toBe(0);

    expect(
      json.code,
      `--json --strict exited ${json.code} where --strict exited ${text.code}, same config.\n` +
        `json stdout:\n${json.stdout}\njson stderr:\n${json.stderr}`,
    ).toBe(text.code);
  }, 120_000);

  it('the failing --json run still emits exactly one parseable document, carrying the cause', async () => {
    // The exit code must not cost the payload. This file's sibling defect
    // (`isExitSignal` in `utils/format.ts`) was a `--json` failure path that
    // emitted TWO documents back to back, parseable as neither one document nor
    // as JSONL — so a non-zero `--json` run is pinned on the document too.
    const json = await runCli(['validate', '--json', '--strict'], warnsDir);

    const payload = JSON.parse(json.stdout) as { valid?: unknown; warnings?: unknown };

    // `valid: true` beside exit 1 is the text face's contract verbatim: it
    // prints "Validation passed" and THEN fails for strict. The config is
    // schema-valid; `--strict` is what turns its advisories into a failure.
    // Pinned because the pairing is new here and reads like a bug otherwise.
    expect(payload.valid).toBe(true);
    expect(Array.isArray(payload.warnings) && (payload.warnings as unknown[]).length).toBeGreaterThan(0);
  }, 120_000);

  it('control: a config with nothing to warn about exits 0 on BOTH faces under --strict', async () => {
    const text = await runCli(['validate', '--strict'], cleanDir);
    expect(text.code, `text --strict:\n${text.stdout}\n${text.stderr}`).toBe(0);

    const json = await runCli(['validate', '--json', '--strict'], cleanDir);
    expect(json.code, `json --strict:\n${json.stdout}\n${json.stderr}`).toBe(0);
  }, 120_000);

  it('conversions-only: the cell where --strict is decided by a collection the payload keeps OUT of `warnings`', async () => {
    const text = await runCli(['validate', '--strict'], conversionsDir);
    const json = await runCli(['validate', '--json', '--strict'], conversionsDir);

    // Same floor as the first case: equality is only worth asserting over a run
    // that genuinely had something to fail on.
    expect(
      text.code,
      `text --strict must fail on the conversions-only config:\n${text.stdout}\n${text.stderr}`,
    ).not.toBe(0);

    expect(
      json.code,
      `--json --strict exited ${json.code} where --strict exited ${text.code}, same config.\n` +
        `json stdout:\n${json.stdout}\njson stderr:\n${json.stderr}`,
    ).toBe(text.code);

    const payload = JSON.parse(json.stdout) as {
      valid?: unknown;
      warnings?: unknown;
      conversions?: unknown;
    };

    // The cell spelled out. `warnings: []` is asserted, not tolerated: it is the
    // whole point — narrow the gate to this field and the run above drops to 0
    // while the text face stays at 1.
    expect(payload.valid).toBe(true);
    expect(payload.warnings).toEqual([]);
    expect(
      Array.isArray(payload.conversions) && (payload.conversions as unknown[]).length,
      'the fixture raised NO conversion — the alias has most likely retired from ' +
        'the load path; re-point `headerPageSource` at a live entry in ' +
        '`packages/spec/src/conversions/registry.ts` rather than deleting this line',
    ).toBeGreaterThan(0);

    // Separates "gates on --strict" from "fails whenever a conversion is seen".
    // The warnings fixture's own without-strict control cannot cover this: it
    // raises no conversions, so it passes under either behaviour.
    const loose = await runCli(['validate', '--json'], conversionsDir);
    expect(loose.code, `--json without --strict must stay 0:\n${loose.stdout}\n${loose.stderr}`).toBe(0);
  }, 120_000);

  it('control: the same page under the CANONICAL key converts nothing and exits 0 on both faces', async () => {
    // The discriminator. Byte-identical to the fixture above but for one key,
    // so a pin that passed here too would be pinning the presence of a page.
    const text = await runCli(['validate', '--strict'], conversionsCanonDir);
    expect(text.code, `text --strict:\n${text.stdout}\n${text.stderr}`).toBe(0);

    const json = await runCli(['validate', '--json', '--strict'], conversionsCanonDir);
    expect(json.code, `json --strict:\n${json.stdout}\n${json.stderr}`).toBe(0);

    const payload = JSON.parse(json.stdout) as { warnings?: unknown; conversions?: unknown };
    expect(payload.warnings).toEqual([]);
    expect(payload.conversions).toEqual([]);
  }, 120_000);

  it('control: without --strict, the same advisory-raising config still exits 0 under --json', async () => {
    // Separates "gates on --strict" from "fails whenever --json sees a warning".
    // Both satisfy the parity matrix above; only the first is the flag's meaning.
    const json = await runCli(['validate', '--json'], warnsDir);
    expect(json.code, `--json without --strict must stay 0:\n${json.stdout}\n${json.stderr}`).toBe(0);
  }, 120_000);
});
