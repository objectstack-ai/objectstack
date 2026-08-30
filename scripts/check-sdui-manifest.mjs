#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-sdui-manifest — freshness + integrity gate for the repo-root
 * `sdui.manifest.json` (#12924, ruled 2026-08-29: wire it, 签入 + 新鲜度门禁).
 *
 *   node scripts/check-sdui-manifest.mjs              # gate this tree
 *   node scripts/check-sdui-manifest.mjs --self-test  # verify the checker itself
 *
 * ## What rots here, and which check catches it
 *
 * The artefact is a SYNC of objectui's public-tier registry (generated from the
 * published `@object-ui/*` packages at the version `.objectui-sha` ships — see
 * `scripts/gen-sdui-manifest-node.mjs`). Checked-in syncs rot; the ruling's
 * words for the failure mode are 「同步一次就烂」. Offline, per-PR:
 *
 *   1. ABSENCE / SHAPE — the artefact exists at the repo root, parses, and
 *      carries a non-empty `components` map whose entries agree with their
 *      keys. An absent artefact silently reverts `validateJsxPages` to
 *      parse-only (`resolveSduiManifest()` degrades by design), so absence
 *      here is the loudest failure, never a skip. Same for the record file.
 *   2. TAMPER — sha256(artefact) equals the record. The manifest is
 *      generator-owned; a hand edit is invisible to every consumer (the
 *      resolver JSON.parses whatever is there), so the hash is the only
 *      instrument that notices one.
 *   3. STALENESS — the record's `objectuiSha` equals the live `.objectui-sha`.
 *      A pin bump changes which registry the shipped console runs, so the bump
 *      PR goes red HERE until the manifest is regenerated against the new pin
 *      — the same moment `check-sdui-lockstep` already forces a parser parity
 *      re-verification, and the moment an objectui checkout is guaranteed to
 *      exist (the bump required one).
 *
 * ## What this deliberately does NOT do, and where that risk is held
 *
 * No per-PR regeneration: that would put an npm-registry network dependency
 * inside a required lint job — the exact shape `check-sdui-lockstep`'s header
 * declines, for the same reasons. Under an unchanged pin the published inputs
 * are immutable, so content drift per-PR is not a live axis. The residual
 * axis — this repo's OWN adapter (`manifestFromConfigs`) changing while the
 * pin stands still — is held by `packages/sdui-parser`'s lockstep gate and
 * unit suite, and by regeneration being byte-deterministic (measured: two runs
 * from the same install, identical sha256), so the remedy this gate prints
 * always converges.
 *
 * Absence is loud, everywhere (#13014/#4690): every input is asserted before
 * any verdict; a missing one exits 1 naming which. No `⚠` + exit 0.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Gate one tree. Returns a list of problems; empty = green. */
export function checkTree(root) {
  const problems = [];
  const artefactPath = join(root, 'sdui.manifest.json');
  const recordPath = join(root, 'scripts', 'sdui-manifest.record.json');
  const pinPath = join(root, '.objectui-sha');

  if (!existsSync(artefactPath)) {
    problems.push(
      'sdui.manifest.json is MISSING at the repo root. `resolveSduiManifest()` degrades to parse-only\n' +
        '  silently, so this gate is the thing that notices. Regenerate: node scripts/gen-sdui-manifest-node.mjs',
    );
    return problems; // every later check reads it
  }
  const raw = readFileSync(artefactPath, 'utf8');

  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (e) {
    problems.push(`sdui.manifest.json does not parse as JSON: ${e.message}`);
    return problems;
  }
  const components = manifest?.components;
  if (!components || typeof components !== 'object' || Array.isArray(components)) {
    problems.push('sdui.manifest.json has no `components` object — not a component manifest.');
    return problems;
  }
  const keys = Object.keys(components);
  if (keys.length === 0) problems.push('sdui.manifest.json declares 0 components — an empty whitelist would red every page.');
  for (const k of keys) {
    if (components[k]?.type !== k) {
      problems.push(`components[${JSON.stringify(k)}].type is ${JSON.stringify(components[k]?.type)} — key/type disagree.`);
      break; // one example is enough; this shape is generator-owned
    }
  }

  if (!existsSync(recordPath)) {
    problems.push('scripts/sdui-manifest.record.json is MISSING — provenance unknown. Regenerate to re-record.');
    return problems;
  }
  let record;
  try {
    record = JSON.parse(readFileSync(recordPath, 'utf8'));
  } catch (e) {
    problems.push(`scripts/sdui-manifest.record.json does not parse: ${e.message}`);
    return problems;
  }
  for (const field of ['objectuiSha', 'objectuiPackagesVersion', 'sha256', 'components']) {
    if (record[field] === undefined) problems.push(`record is missing \`${field}\`.`);
  }
  if (problems.length) return problems;

  const sha256 = createHash('sha256').update(raw).digest('hex');
  if (sha256 !== record.sha256) {
    problems.push(
      `sdui.manifest.json sha256 ${sha256.slice(0, 12)}… does not match the record ${String(record.sha256).slice(0, 12)}…\n` +
        '  The artefact is generator-owned — never hand-edit it. Regenerate: node scripts/gen-sdui-manifest-node.mjs',
    );
  }
  if (keys.length !== record.components) {
    problems.push(`artefact has ${keys.length} components, record says ${record.components}.`);
  }

  if (!existsSync(pinPath)) {
    problems.push('.objectui-sha is MISSING — cannot judge freshness.');
    return problems;
  }
  const pin = readFileSync(pinPath, 'utf8').trim();
  if (pin !== record.objectuiSha) {
    problems.push(
      `.objectui-sha has moved to ${pin.slice(0, 12)}… but sdui.manifest.json was generated at ${String(record.objectuiSha).slice(0, 12)}…\n` +
        '  A pin bump changes which registry the shipped console runs; the manifest must follow it (同步一次就烂 is\n' +
        '  the failure mode this gate exists for). Regenerate against the new pin:\n' +
        '    node scripts/gen-sdui-manifest-node.mjs --objectui-version {the @object-ui version the new pin ships}\n' +
        "  (read it from the objectui checkout's packages/core/package.json — the bump already required that checkout).",
    );
  }
  return problems;
}

function selfTest() {
  const mk = (mutate) => {
    const root = mkdtempSync(join(tmpdir(), 'sdui-manifest-check-'));
    // fixture tree: artefact + record + pin, green by construction
    const manifest = { components: { flex: { type: 'flex', inputs: [] } } };
    const raw = JSON.stringify(manifest, null, 2);
    const scriptsDir = join(root, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(join(root, '.objectui-sha'), 'a'.repeat(40) + '\n');
    writeFileSync(join(root, 'sdui.manifest.json'), raw);
    writeFileSync(
      join(scriptsDir, 'sdui-manifest.record.json'),
      JSON.stringify(
        {
          objectuiSha: 'a'.repeat(40),
          objectuiPackagesVersion: '0.0.0-selftest',
          sha256: createHash('sha256').update(raw).digest('hex'),
          components: 1,
        },
        null,
        2,
      ),
    );
    mutate?.(root);
    return root;
  };

  const cases = [
    ['green fixture passes', mk(), 0],
    ['missing artefact is RED', mk((r) => rmSync(join(r, 'sdui.manifest.json'))), 1],
    ['hand-edited artefact (hash mismatch) is RED', mk((r) => writeFileSync(join(r, 'sdui.manifest.json'), '{"components":{"flex":{"type":"flex"}}}')), 1],
    ['moved pin is RED', mk((r) => writeFileSync(join(r, '.objectui-sha'), 'b'.repeat(40))), 1],
    ['empty components is RED', mk((r) => {
      const raw = JSON.stringify({ components: {} }, null, 2);
      writeFileSync(join(r, 'sdui.manifest.json'), raw);
      const rec = JSON.parse(readFileSync(join(r, 'scripts', 'sdui-manifest.record.json'), 'utf8'));
      rec.sha256 = createHash('sha256').update(raw).digest('hex');
      rec.components = 0;
      writeFileSync(join(r, 'scripts', 'sdui-manifest.record.json'), JSON.stringify(rec));
    }), 1],
    ['missing record is RED', mk((r) => rmSync(join(r, 'scripts', 'sdui-manifest.record.json'))), 1],
  ];

  let failures = 0;
  for (const [name, root, want] of cases) {
    const problems = checkTree(root);
    const got = problems.length ? 1 : 0;
    if (got !== want) {
      failures++;
      console.error(`✗ self-test: ${name} — expected ${want ? 'RED' : 'GREEN'}, got ${got ? 'RED' : 'GREEN'}`);
      for (const p of problems) console.error(`    ${p}`);
    }
  }
  if (failures) {
    console.error(`✗ check-sdui-manifest self-test: ${failures} case(s) failed.`);
    process.exit(1);
  }
  console.log(`✓ check-sdui-manifest self-test: ${cases.length} cases behave (green passes; absence, tamper, moved pin, emptiness are RED).`);
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    selfTest();
  } else {
    const problems = checkTree(DEFAULT_ROOT);
    if (problems.length) {
      console.error('✗ check-sdui-manifest:');
      for (const p of problems) console.error(`  ${p}`);
      process.exit(1);
    }
    const record = JSON.parse(readFileSync(join(DEFAULT_ROOT, 'scripts', 'sdui-manifest.record.json'), 'utf8'));
    console.log(
      `✓ check-sdui-manifest: sdui.manifest.json is present, intact (sha256 ${String(record.sha256).slice(0, 12)}…, ` +
        `${record.components} components) and fresh at objectui pin ${String(record.objectuiSha).slice(0, 12)}….`,
    );
  }
}
