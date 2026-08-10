#!/usr/bin/env tsx
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every shipped `objectstack.manifest.json` must parse against
 * `TemplateManifestSchema` (#7319).
 *
 * WHY THIS EXISTS. `TemplateManifestSchema` is documented as the schema of the
 * on-disk `objectstack.manifest.json`, and the bundled templates declare it as
 * their `$schema`. Nothing read that claim. Both consumers of the file take it
 * as raw JSON — `create-objectstack` does not depend on `@objectstack/spec` at
 * all (deps: chalk, commander, tar), and `objectstack package publish` reads it
 * with `JSON.parse` and per-key `typeof` guards — so the schema and the file it
 * describes were free to disagree, and did, twice:
 *
 *   #6861 — the schema STRIPPED `namespace`, a key the scaffolder writes,
 *           rewrites and reads back. Silent: `parse()` succeeded without it.
 *   #7319 — the schema REQUIRED `manifestId`, which the blank template has
 *           never declared. Measured on `origin/main` @ 3e8e669c0, the shipped
 *           file did not satisfy its own `$schema`, and the only complaint was
 *           `manifestId` — `invalid_type`, `expected string, received undefined`.
 *
 * Neither was reachable by any gate: the first is invisible by construction (a
 * strip is a success), and the second is invisible because no live path parses
 * this file at all. One parse per shipped manifest closes the class — the
 * declaration and the artifact are compared, in the direction that fails loudly.
 *
 * WHAT IT PROVES, AND WHAT IT DOES NOT. It proves the files we ship satisfy the
 * schema we publish for them. It says nothing about a manifest authored
 * elsewhere (a remote template, a user's project): nothing validates those
 * either, and #7319 deliberately did not add publish-time validation — the
 * question there is a contract change, not a drift.
 *
 * Usage:
 *   pnpm --filter @objectstack/spec check:template-manifests
 *   pnpm --filter @objectstack/spec check:template-manifests --self-test
 */

import { readdirSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TemplateManifestSchema } from '../src/cloud/template-manifest.zod';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(pkgRoot, '..', '..');

/**
 * Where the shipped manifests live. A DIRECTORY, walked recursively, never a
 * hand-kept list of files: the whole point is that a template added tomorrow is
 * covered on the day it lands, without anyone remembering this gate exists.
 */
const TEMPLATE_ROOT = join(repoRoot, 'packages/create-objectstack/src/templates');

const MANIFEST_FILENAME = 'objectstack.manifest.json';

/** The `$schema` these files claim. Verifying the claim is half the point. */
const TEMPLATE_MANIFEST_SCHEMA_URL = 'https://schemas.objectstack.dev/template-manifest.json';

const rel = (p: string) => relative(repoRoot, p);

/** Every `objectstack.manifest.json` under `root`, deepest paths included. */
export function findManifests(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // missing dir — the caller's zero-file guard reports it
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist') continue;
        walk(p);
      } else if (e.name === MANIFEST_FILENAME) {
        found.push(p);
      }
    }
  };
  walk(root);
  return found;
}

/**
 * Parse one manifest. Returns the problems as printable lines — empty means it
 * satisfies the schema it advertises.
 */
export function checkManifest(path: string): string[] {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    return [`cannot be read: ${(err as Error).message}`];
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return [`is not valid JSON: ${(err as Error).message}`];
  }

  const problems: string[] = [];

  // The gate's authority comes from the FILENAME — every `objectstack.manifest.json`
  // under the template root is judged against `TemplateManifestSchema`. So a file
  // claiming some other `$schema` is not an exemption, it is a contradiction: one
  // of the two statements is wrong and a reader cannot tell which. Absent is fine
  // (the claim is optional); present and different is not.
  const declared = (data as Record<string, unknown> | null)?.$schema;
  if (typeof declared === 'string' && declared !== TEMPLATE_MANIFEST_SCHEMA_URL) {
    problems.push(
      `declares $schema "${declared}", but this gate judges it against TemplateManifestSchema ` +
        `("${TEMPLATE_MANIFEST_SCHEMA_URL}"). Reconcile the claim with the schema that governs the file.`,
    );
  }

  const result = TemplateManifestSchema.safeParse(data);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const at = issue.path.length ? issue.path.join('.') : '<root>';
      problems.push(`${at}: ${issue.message} (${issue.code})`);
    }
  }

  return problems;
}

// ── self-test ───────────────────────────────────────────────────────────────
// A gate over one file today is a gate that can rot into a no-op unnoticed, so
// its detection is proved against fixtures rather than against the corpus. The
// green case is the #7319 shape (no `manifestId`) and the red cases include the
// #6861 key (`namespace`), so both intents this schema carries are exercised.

function selfTest(): never {
  const failures: string[] = [];
  const check = (ok: boolean, what: string) => {
    if (!ok) failures.push(what);
  };

  const dir = mkdtempSync(join(tmpdir(), 'os-template-manifests-'));
  try {
    const write = (name: string, body: unknown) => {
      const d = join(dir, name);
      mkdirSync(d, { recursive: true });
      const p = join(d, MANIFEST_FILENAME);
      writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body, null, 2), 'utf8');
      return p;
    };

    const base = {
      $schema: TEMPLATE_MANIFEST_SCHEMA_URL,
      name: 'blank',
      namespace: 'blank',
      specVersion: '^6.0.0',
      displayName: 'Blank Starter',
    };

    // GREEN — the shipped shape: no `manifestId` at all (#7319).
    const green = write('green', base);
    check(
      checkManifest(green).length === 0,
      `green fixture: a manifest with no manifestId must PASS — that relaxation is #7319 itself; got ${JSON.stringify(checkManifest(green))}`,
    );

    // GREEN — a manifest that DOES declare a well-formed id.
    const withId = write('with-id', { ...base, manifestId: 'com.acme.blank' });
    check(
      checkManifest(withId).length === 0,
      `with-id fixture: a well-formed reverse-domain manifestId must PASS; got ${JSON.stringify(checkManifest(withId))}`,
    );

    // RED — optional is not unvalidated: a malformed id is still a malformed id.
    const badId = write('bad-id', { ...base, manifestId: 'Not A Reverse Domain' });
    check(
      checkManifest(badId).some((p) => p.startsWith('manifestId:')),
      'bad-id fixture: a malformed manifestId must FAIL — optional must not mean unchecked',
    );

    // RED — the #6861 key. The gate that would have caught that drift is this one,
    // so it has to actually judge `namespace` values.
    const badNs = write('bad-namespace', { ...base, namespace: 'CRM-App' });
    check(
      checkManifest(badNs).some((p) => p.startsWith('namespace:')),
      'bad-namespace fixture: a malformed namespace must FAIL (#6861 — the key is declared, so its values are judged)',
    );

    // RED — a genuinely required key is still required.
    const { displayName: _dropped, ...noDisplayName } = base;
    const missing = write('missing-required', noDisplayName);
    check(
      checkManifest(missing).some((p) => p.startsWith('displayName:')),
      'missing-required fixture: a missing displayName must FAIL — the relaxation is manifestId ONLY',
    );

    // RED — a contradictory `$schema` claim.
    const wrongSchema = write('wrong-schema', { ...base, $schema: 'https://example.invalid/other.json' });
    check(
      checkManifest(wrongSchema).some((p) => p.includes('declares $schema')),
      'wrong-schema fixture: a manifest claiming a different $schema must FAIL',
    );

    // RED — malformed JSON is a finding, not a skip.
    const broken = write('broken', '{ not json');
    check(
      checkManifest(broken).some((p) => p.includes('not valid JSON')),
      'broken fixture: malformed JSON must FAIL',
    );

    // Discovery walks recursively and finds exactly the manifests written above.
    const discovered = findManifests(dir);
    check(
      discovered.length === 7,
      `discovery: expected 7 fixture manifests, found ${discovered.length}`,
    );

    // The vacuous-green guard's input: an empty tree yields zero, which `main`
    // turns into a failure rather than a silent pass.
    const emptyDir = mkdtempSync(join(tmpdir(), 'os-template-manifests-empty-'));
    try {
      check(findManifests(emptyDir).length === 0, 'discovery: an empty tree must yield zero manifests');
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length) {
    for (const f of failures) console.error(`✗ self-test: ${f}`);
    console.error(`\ncheck-template-manifests --self-test: ${failures.length} failure(s).\n`);
    process.exit(1);
  }
  console.log(
    '✅  self-test: accepts a manifest with no manifestId (#7319) and one with a well-formed id,\n' +
      '    rejects a malformed manifestId / namespace (#6861), a missing required key, a\n' +
      '    contradictory $schema and malformed JSON; discovery walks the template tree.',
  );
  process.exit(0);
}

function main(): void {
  if (process.argv.includes('--self-test')) selfTest();

  console.log(`🧪 Parsing every shipped ${MANIFEST_FILENAME} against TemplateManifestSchema...\n`);

  const manifests = findManifests(TEMPLATE_ROOT);

  // Vacuous-green guard. Zero files is far more likely to mean "the templates
  // moved" than "we ship no templates", and a gate that checked nothing must not
  // report success.
  if (manifests.length === 0) {
    console.error(
      `✗ No ${MANIFEST_FILENAME} found under ${rel(TEMPLATE_ROOT)}.\n\n` +
        `  Every bundled template ships one, so this is almost certainly a moved\n` +
        `  directory rather than an empty one — point TEMPLATE_ROOT at wherever the\n` +
        `  templates live now. A gate that parses nothing must not report success.\n`,
    );
    process.exit(1);
  }

  let bad = 0;
  for (const path of manifests) {
    const problems = checkManifest(path);
    console.log(`  ${problems.length === 0 ? '✓' : '✗'} ${rel(path)}`);
    for (const p of problems) console.log(`      ${p}`);
    if (problems.length) bad++;
  }

  if (bad === 0) {
    console.log(
      `\n✅ ${manifests.length} shipped manifest(s) satisfy TemplateManifestSchema — ` +
        `their $schema line is a verified claim.`,
    );
    return;
  }

  console.error(
    `\n✗ ${bad} of ${manifests.length} shipped manifest(s) do not satisfy the schema they declare.\n\n` +
      `  Two fixes, and the right one depends on which side is wrong:\n` +
      `    • the FILE is wrong — it omits a key the schema requires, or carries a bad\n` +
      `      value. Fix the manifest.\n` +
      `    • the SCHEMA is wrong — it demands something no template can supply, the way\n` +
      `      it required a publish-time \`manifestId\` from a source tree (#7319). Fix\n` +
      `      packages/spec/src/cloud/template-manifest.zod.ts, and keep the relaxation\n` +
      `      LOCAL: CreatePackageRequestSchema is the publish request and must stay strict.\n`,
  );
  process.exit(1);
}

main();
