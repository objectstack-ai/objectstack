// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Pins the BOOT-ATTRIBUTION contract of `scripts/publish-smoke.sh` — the half
// that decides whether a run blames the boot or blames a probe.
//
// ## What was measured
//
// Registry canary run `34084559243`, job `101626009369`. The entire defect was
// one line, at boot:
//
//     ⚠ AuthPlugin failed to load: The requested module '@better-auth/core/db'
//       does not provide an export named 'createLocalAccountIssuer'
//
// The run did not stop there. It probed every auth and CRUD route against a
// server with no auth, and exited 1 on `GET /auth/get-session … got 404`. Two
// properties of the log scan combined to produce that, and fixing either one
// alone leaves the other:
//
//   * SEVERITY — a plugin that fails to load logs at WARN, and the scan matched
//     `error|fatal` only. Measured against the specimen's own boot window, the
//     pre-fix pattern matches ZERO lines; `OLD_PATTERN_HITS` below is that
//     number, and it is the regression this file exists to hold at 0-is-wrong.
//   * ORDER — section 4 (log scan) is the LAST thing in the script, after
//     section 3 (probes), so even at a matching severity a boot defect is
//     reported as a probe failure first.
//
// The cost is not a false green — CI went red either way. It is OWNERSHIP: a
// boot-load failure and a genuine auth regression have different owners and
// produced the same job output.
//
// ## Why the predicate is not "warn", and how it was chosen
//
// The obvious repair — widen the severity set to WARN — is the wrong one, and
// the healthy baseline is what says so rather than an opinion. `HEALTHY_BOOT`
// below is the verbatim boot window of pack run `34276056630` (job
// `102229481940`), a run whose auth and CRUD probes were ALL green and whose
// banner reads `Plugins: 34 loaded` with `Auth` in the roster. It carries
//
//     ⚠ Console dist not found — install `@object-ui/console` …
//
// — a warn-shaped line, with the SAME `⚠` glyph as the specimen, in a boot that
// is completely healthy. Registry mode adds a second one (`[MetadataPlugin]
// artifact … predates this runtime's spec`, normal for a published artifact).
// A canary that reds on either gets ignored, and then nobody reads it when the
// real boot breaks.
//
// So the predicate keys on the SENTENCE, not the level: *a unit of the
// composition did not arrive*. Its two legs are asserted separately below
// because they buy different things — leg A names the owner, leg B survives a
// rewording — and a change that quietly drops one would otherwise still pass on
// the specimen.
//
// ## Why these are executed assertions and not greps
//
// The pattern and the scrubber are read out of the script by SOURCING it, the
// same mechanism the sibling collision test uses: a grep assertion also passes
// against a version that names the behaviour only in a comment. The one
// deliberate exception is ORDER_OK, which is a byte-offset comparison on the
// file — order-in-file is the property under test and it lives BELOW the
// sourcing guard, where sourcing cannot reach it. What that assertion can see
// is that the gate is invoked before the probes; what it cannot see is whether
// the gate does anything, which is what every other assertion here is for.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, '..', '..', '..', 'scripts', 'publish-smoke.sh');

function have(bin: string): boolean {
  try {
    execFileSync('sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// No ports, no network, no `/proc` — unlike the sibling collision test this one
// only needs a shell and the two text utilities the gate itself calls.
const RUNNABLE = ['bash', 'grep', 'sed'].every(have);

/**
 * ESC as an ESCAPE SPELLING, never a raw byte.
 *
 * A literal U+001B in this file would make `grep` treat the whole thing as
 * binary and report `Binary file … matches` instead of the line, which is how a
 * control byte hides from the very searches that would find it
 * (`scripts/check-nul-bytes.mjs` is the authority). It is materialised at
 * runtime, into the fixture only.
 */
const ESC = '\u001b';

/**
 * The specimen's boot window, verbatim from job `101626009369`.
 *
 * Trimmed to the boot — everything here was written before the first probe ran,
 * which is the whole point: this is what the gate gets to look at.
 */
const SPECIMEN_BOOT = [
  '',
  '◆ Development Mode',
  '  Loading objectstack.config.ts...',
  "  ⚠ AuthPlugin failed to load: The requested module '@better-auth/core/db' does not provide an export named 'createLocalAccountIssuer'",
  '[LocalCryptoProvider] No OS_SECRET_KEY/OS_DEV_CRYPTO_KEY set — generated a new AES-256-GCM key and persisted it to /tmp/y/dev-crypto-key (mode 0600).',
  "[sql-driver] DATABASE_ERROR — the backend refused a read on 'sys_organization' (SQLITE_ERROR). select `id` from `sys_organization` limit 500 - no such table: sys_organization ",
  '  ↪ secret fields: LocalCryptoProvider wired (dev) — set OS_SECRET_KEY and swap for KMS/Vault in production',
  '',
  '  ✓ Server is ready',
  '',
  '  Plugins: 30 loaded',
  '',
  '  ⚠ Boot diagnostics — 4 warnings logged during startup:',
  "    2026-09-07T04:51:11.594Z WARN [MetadataPlugin] artifact '/tmp/y/dist/objectstack.json' predates this runtime's spec (authored engines.protocol floor 17.0.0, runtime spec 17.3.0) — converted 1 site(s) forward via ADR-0087 conversion 'field-required-notnull-explicit'.",
  '    2026-09-07T04:51:11.638Z WARN CORE: Core service missing, functionality may be degraded: auth',
  '    2026-09-07T04:51:11.639Z WARN System started with degraded capabilities. Missing core services: auth',
  '    2026-09-07T04:51:11.761Z WARN SharingServicePlugin: could not enumerate organizations — declared sharing rules were NOT seeded per organization at this boot; seeding retries on the next boot and on organization creation',
  '    run with --log-level debug to watch the boot stream live',
  '',
].join('\n');

/**
 * A HEALTHY boot window, verbatim from pack run `34276056630` / job
 * `102229481940` — every auth and CRUD probe in that run was green.
 *
 * ⚠ The `⚠ Console dist not found` line is the reason this fixture is here and
 * not paraphrased. It is warn-shaped, glyph-prefixed exactly like the specimen,
 * and completely benign. Any predicate that reds on this fixture is a canary
 * that cries wolf, and `HEALTHY_WARN_LINES` below refuses to let it pass as a
 * vacuous green.
 */
const HEALTHY_BOOT = [
  '',
  '◆ Development Mode',
  '  Loading objectstack.config.ts...',
  '[LocalCryptoProvider] No OS_SECRET_KEY/OS_DEV_CRYPTO_KEY set — generated a new AES-256-GCM key and persisted it to /tmp/x/dev-crypto-key (mode 0600).',
  '  ⚠ Console dist not found — install `@object-ui/console` (already built) or run `pnpm --filter @object-ui/console build` in the objectui workspace',
  '[sql-driver] while creating table "sys_metadata_commit": declared field \'id\' asks for storage the platform\'s own \'id\' column does not provide — maxLength: 64 (the column is 255).',
  '[sql-driver] DATABASE_ERROR — the backend refused a raw statement (SQLITE_ERROR). statement: SELECT "tenant_id" FROM "_objectstack_sequences" WHERE 1 = 0 - no such table: _objectstack_sequences',
  '  ↪ secret fields: LocalCryptoProvider wired (dev) — set OS_SECRET_KEY and swap for KMS/Vault in production',
  '',
  '  ✓ Server is ready',
  '',
  '  Plugins: 34 loaded',
  '           ObjectQL, SqlDriver, HonoServer, Metadata, PlatformObjects, Auth, Security, Audit, RestAPI, SettingsServicePlugin, SharingServicePlugin, AnalyticsServicePlugin',
  '',
].join('\n');

/**
 * A healthy REGISTRY-mode boot window.
 *
 * ⚠ Unlike `HEALTHY_BOOT` this one is RECONSTRUCTED, not verbatim, and the
 * distinction is load-bearing so it is stated rather than glossed: it is the
 * specimen's own boot window (job `101626009369`) with the four lines
 * attributable to the defect removed — the `AuthPlugin failed to load` line,
 * both kernel degraded-capability lines, and `SharingServicePlugin: could not
 * enumerate organizations`, which only failed because the plugin that creates
 * `sys_organization` never loaded. What is KEPT is the one boot warning that is
 * normal for registry mode: the canary installs the LAST PUBLISHED release, so
 * an artifact whose protocol floor predates the runtime's spec is expected, and
 * the ADR-0087 forward conversion says so at WARN.
 *
 * ⭐ This fixture exists because the pack-mode one could not do this job, and
 * that was MEASURED rather than foreseen: under a deliberately wrong
 * `WARN|warn` predicate the firing control below stayed GREEN, because
 * `HEALTHY_BOOT`'s only warn-shaped line carries the `⚠` glyph and never the
 * word. A healthy boot that spells `WARN` in full is what makes "⛔ do not
 * widen the severity set wholesale" a thing this file can actually catch.
 */
const HEALTHY_REGISTRY_BOOT = [
  '',
  '◆ Development Mode',
  '  Loading objectstack.config.ts...',
  '[LocalCryptoProvider] No OS_SECRET_KEY/OS_DEV_CRYPTO_KEY set — generated a new AES-256-GCM key and persisted it to /tmp/y/dev-crypto-key (mode 0600).',
  '  ↪ secret fields: LocalCryptoProvider wired (dev) — set OS_SECRET_KEY and swap for KMS/Vault in production',
  '',
  '  ✓ Server is ready',
  '',
  '  Plugins: 31 loaded',
  '',
  '  ⚠ Boot diagnostics — 1 warning logged during startup:',
  "    2026-09-07T04:51:11.594Z WARN [MetadataPlugin] artifact '/tmp/y/dist/objectstack.json' predates this runtime's spec (authored engines.protocol floor 17.0.0, runtime spec 17.3.0) — converted 1 site(s) forward via ADR-0087 conversion 'field-required-notnull-explicit'.",
  '    run with --log-level debug to watch the boot stream live',
  '',
].join('\n');

/**
 * Every benign `failed to load` in the tree, plus the two near-misses that make
 * the legs' boundaries real rather than asserted.
 *
 * All of these are degradations of a plugin that DID load — a locale bundle, a
 * metadata row, an optional transport dependency — which is why a bare
 * `failed to load` grep is not the predicate. The last two are the sharp cases:
 * `[i18n] … could not be loaded` says in its own text that it is "not a boot
 * failure", and `Service '…' not provided — using in-memory fallback` is the
 * kernel's warn for a core service that WAS covered — the sibling of leg B's
 * line, and the one it must not match.
 */
const BENIGN_BOOT = [
  '  Loading objectstack.config.ts...',
  "SettingsServicePlugin: failed to load translations for 'fr': ENOENT: no such file or directory",
  "[platform-objects] failed to load setup-bundle translations for 'de': ENOENT",
  '[webhook-auto-enqueuer] failed to load sys_webhook_subscription',
  'Loader FileSystemLoader failed to load object:accounts',
  "[MarketplaceInstallLocal] failed to load app_crm translations for 'ja': ENOENT",
  'SmtpTransport: failed to load `nodemailer` — SMTP delivery is unavailable.',
  '[i18n] @objectstack/i18n-files was requested but could not be loaded (declared-not-installed).',
  '  Unchanged: this boot serves i18n from the kernel in-memory fallback, so what follows',
  '  is why the file-based service is absent — not a boot failure.',
  "Service 'cache' not provided — using in-memory fallback",
  '  ✓ Server is ready',
  '',
].join('\n');

/** The other two load-failure emit sites on the CLI's boot path (leg A2, A3). */
const OTHER_SITES = [
  "  ✗ Failed to load plugin: Cannot find module '@acme/plugin-thing'",
  '[Capability:audit] failed to load @objectstack/plugin-audit: boom',
  '',
].join('\n');

const NONSENSE = ['the quick brown fox', 'lorem ipsum dolor sit amet', '1234567890', ''].join('\n');

/**
 * The specimen with ANSI landing INSIDE the matched span — `chalk.bold` on the
 * plugin name, under a logger that colorizes without a TTY.
 *
 * ⚠ Deliberately mid-span rather than wrapped around the whole line. Decoration
 * at the EDGES leaves `AuthPlugin failed to load:` contiguous, so an unanchored
 * pattern matches it even unscrubbed and a test built on that shape proves
 * nothing about the scrubber. This shape splits the span, and the measured
 * consequence is asserted below: without scrubbing the run still detects a
 * failed boot (leg B survives) but LOSES THE PLUGIN'S NAME — which is the one
 * thing this card is about.
 */
const DECORATED_BOOT = SPECIMEN_BOOT.replace(
  '⚠ AuthPlugin failed to load:',
  `⚠ ${ESC}[1mAuthPlugin${ESC}[22m failed to load:`,
);

/** The pre-fix section-4 pattern, transcribed from `main` for the before/after. */
const OLD_ERROR_PATTERN =
  '^\\[(error|fatal)\\]|"level":"(error|fatal)"|^\\S+Z ERROR |Failed to register OIDC discovery routes';

/**
 * Source the real script and run the real helpers over the fixtures, reporting
 * one `KEY=VALUE` line per measurement.
 *
 * `set +e +o pipefail` after the source for the reason the sibling documents:
 * the script's own `set -euo pipefail` comes with it, and several steps here are
 * EXPECTED to exit non-zero — a `grep` that matches nothing is the pass
 * condition for three of them. The harness's own exit status is not a
 * measurement; every measurement is a printed line and the assertions grade
 * those.
 */
function runHarness(): Record<string, string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-smoke-boot-'));
  const write = (name: string, body: string): string => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, body);
    return p;
  };
  const fixtures = {
    SPECIMEN: write('specimen.log', SPECIMEN_BOOT),
    HEALTHY: write('healthy.log', HEALTHY_BOOT),
    BENIGN: write('benign.log', BENIGN_BOOT),
    OTHER: write('other.log', OTHER_SITES),
    NONSENSE: write('nonsense.log', NONSENSE),
    DECORATED: write('decorated.log', DECORATED_BOOT),
    REGISTRY: write('registry.log', HEALTHY_REGISTRY_BOOT),
  };

  const harness = path.join(dir, 'harness.sh');
  fs.writeFileSync(
    harness,
    [
      '#!/usr/bin/env bash',
      'set -u',
      `export SCRATCH=${JSON.stringify(dir)}`,
      `source ${JSON.stringify(SCRIPT)}`,
      'set +e +u +o pipefail',
      'echo "SOURCED=ok"',
      // The pattern and the scrubber both have to EXIST as the script's own
      // seams. A rename that inlined either would otherwise leave this file
      // measuring nothing while staying green.
      'echo "HAS_PATTERN=$([ -n "${SMOKE_BOOT_FAILURE_PATTERN:-}" ] && echo yes || echo no)"',
      'echo "HAS_SCRUB=$(type -t smoke_scrub_ansi)"',
      'echo "HAS_LINES=$(type -t smoke_boot_failure_lines)"',
      // verdict <KEY> <fixture> — scrub, then run the REAL matcher.
      'verdict() {',
      // The scrub target is derived from SCRATCH and the KEY, never from `$src`:
      // an empty `$2` under `set +u` would otherwise make it `.scrubbed` in the
      // harness's inherited cwd — which is `packages/spec` under vitest, i.e. a
      // stray file inside the repo rather than a loud failure.
      '  local key=$1 src=$2 out st',
      '  if [ -z "$src" ]; then echo "${key}_STATUS=BADARGS"; return; fi',
      '  local scrubbed="$SCRATCH/$key.scrubbed"',
      '  smoke_scrub_ansi "$src" "$scrubbed"',
      '  out=$(smoke_boot_failure_lines "$scrubbed"); st=$?',
      '  echo "${key}_STATUS=$st"',
      '  echo "${key}_HITS=$(printf %s "$out" | grep -c . )"',
      '  echo "${key}_FIRST=$(printf %s "$out" | head -1 | tr -d "\\n")"',
      '}',
      ...Object.entries(fixtures).map(([k, p]) => `verdict ${k} ${JSON.stringify(p)}`),
      // BEFORE: the pre-fix pattern over the specimen's own boot window.
      `OLD=${JSON.stringify(OLD_ERROR_PATTERN)}`,
      `echo "OLD_PATTERN_HITS=$(grep -cE "$OLD" ${JSON.stringify(fixtures.SPECIMEN)})"`,
      // Decoration: what is lost when the scrubber does not run.
      `echo "DECOR_UNSCRUBBED_NAMES_PLUGIN=$(grep -cE "$SMOKE_BOOT_FAILURE_PATTERN" ${JSON.stringify(fixtures.DECORATED)} )"`,
      // Vacuity guard: the healthy fixture really does carry warn-shaped lines.
      `echo "HEALTHY_WARN_LINES=$(grep -c '⚠' ${JSON.stringify(fixtures.HEALTHY)})"`,
      `echo "REGISTRY_WARN_WORDS=$(grep -c 'WARN' ${JSON.stringify(fixtures.REGISTRY)})"`,
      'exit 0',
    ].join('\n'),
    { mode: 0o755 },
  );

  const out = execFileSync('bash', [harness], { encoding: 'utf8', timeout: 60_000 });
  const parsed: Record<string, string> = {};
  for (const line of out.split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (m) parsed[m[1]] = m[2];
  }
  return parsed;
}

describe.skipIf(!RUNNABLE)('[#16793] publish-smoke.sh judges the BOOT before it probes', () => {
  const r = RUNNABLE ? runHarness() : ({} as Record<string, string>);

  it('sources cleanly and exposes the boot-failure seams', () => {
    expect(r.SOURCED).toBe('ok');
    expect(r.HAS_PATTERN, 'SMOKE_BOOT_FAILURE_PATTERN is not defined by the script').toBe('yes');
    expect(r.HAS_SCRUB).toBe('function');
    expect(r.HAS_LINES).toBe('function');
  });

  it('BEFORE: the error-only scan is blind to the specimen — 0 hits in its boot window', () => {
    // The severity half of the defect, as a number. If this ever becomes
    // non-zero the pre-fix scan would have caught the specimen after all, and
    // the argument in this file's header needs re-measuring, not patching.
    expect(r.OLD_PATTERN_HITS).toBe('0');
  });

  it('AFTER: the specimen fails at boot, and the failure NAMES the plugin', () => {
    expect(r.SPECIMEN_STATUS).toBe('0');
    // Attribution is the deliverable. A generic "the boot looks wrong" is the
    // same unowned red the card was filed about.
    expect(r.SPECIMEN_FIRST).toContain('AuthPlugin');
    expect(r.SPECIMEN_FIRST).toContain('failed to load');
    expect(r.SPECIMEN_FIRST).toContain('createLocalAccountIssuer');
  });

  it('leg B fires on the kernel verdict alone, so a reworded cause still reds', () => {
    // Three hits, not one: the load site (A1) plus BOTH kernel lines (B). The
    // count is asserted because it is what proves leg B is live — drop it and
    // the specimen still passes on A1 alone, and the next differently-worded
    // boot defect goes back to being a probe failure.
    expect(r.SPECIMEN_HITS).toBe('3');
  });

  it('FIRING CONTROL: a healthy boot still passes, warn lines and all', () => {
    // Verbatim from a run whose probes were all green. A fix that reds here is
    // worse than the defect: a canary that cries wolf stops being read.
    expect(r.HEALTHY_STATUS).toBe('1');
    expect(r.HEALTHY_HITS).toBe('0');
    // …and the fixture is not vacuously clean — it carries the same `⚠` glyph
    // the specimen does.
    expect(Number(r.HEALTHY_WARN_LINES)).toBeGreaterThan(0);
  });

  it('FIRING CONTROL 2: a healthy REGISTRY boot passes even though it spells WARN', () => {
    // The half `HEALTHY_BOOT` cannot test. Registry mode installs the last
    // PUBLISHED release, so a protocol-floor conversion warning is normal there
    // — and it arrives as a full `<ISO>Z WARN …` line. This is the assertion
    // that turns "⛔ do not widen the severity set to WARN" from advice in a
    // comment into something that reddens.
    expect(r.REGISTRY_STATUS).toBe('1');
    expect(r.REGISTRY_HITS).toBe('0');
    // Vacuity guard: the fixture really does contain the literal word.
    expect(Number(r.REGISTRY_WARN_WORDS)).toBeGreaterThan(0);
  });

  it('the benign `failed to load` family is NOT a boot failure', () => {
    expect(r.BENIGN_STATUS).toBe('1');
    expect(r.BENIGN_HITS).toBe('0');
  });

  it('nonsense control: no fixture-independent match', () => {
    expect(r.NONSENSE_STATUS).toBe('1');
    expect(r.NONSENSE_HITS).toBe('0');
  });

  it('the other two load-failure sites on the boot path are covered', () => {
    expect(r.OTHER_STATUS).toBe('0');
    expect(r.OTHER_HITS).toBe('2');
  });

  it('DECORATION CONTROL: scrubbing is what keeps the plugin NAMED', () => {
    // Scrubbed: identical to the undecorated specimen, name included.
    expect(r.DECORATED_STATUS).toBe('0');
    expect(r.DECORATED_HITS).toBe('3');
    expect(r.DECORATED_FIRST).toContain('AuthPlugin');
    // Unscrubbed, the same input yields 2 — the two kernel lines. The one that
    // is lost is precisely the one carrying the plugin's name, which is the
    // measured reason the gate scrubs first rather than trusting NO_COLOR.
    expect(r.DECOR_UNSCRUBBED_NAMES_PLUGIN).toBe('2');
  });

  it('ORDER: the gate is invoked before the probes, and section 4 stays put', () => {
    // A text assertion, deliberately, and the header says why: the gate runs
    // below the sourcing guard where sourcing cannot reach it, and ORDER is the
    // property. It grades position only — every other test here grades
    // behaviour.
    const src = fs.readFileSync(SCRIPT, 'utf8');
    const gate = src.indexOf('if smoke_boot_failure_lines "$BOOT_LOG"; then');
    const probes = src.indexOf('# ── 3. probes ');
    const scan = src.indexOf('# ── 4. log scan ');
    expect(gate, 'the boot gate is not invoked at all').toBeGreaterThan(-1);
    expect(probes).toBeGreaterThan(-1);
    expect(scan).toBeGreaterThan(-1);
    expect(gate, 'the boot gate must run BEFORE the probes').toBeLessThan(probes);
    // Section 4 was NOT hoisted: moving it forward would drop the probe-window
    // errors it exists to catch, which is a different regression.
    expect(scan, 'section 4 must still run after the probes').toBeGreaterThan(probes);
  });
});
