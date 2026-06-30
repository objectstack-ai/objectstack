// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Spec ↔ frontend conformance report (ADR-0081 follow-up). Confirms the
// objectui components ACTUALLY implement the props the spec protocol declares
// for each curated react block. The spec is the protocol; the frontend must
// conform. This surfaces (and can ratchet) the divergence.
//
//   - spec-only  : the spec schema declares a prop the component does NOT expose
//                  as a registry input → frontend hasn't implemented the protocol.
//   - frontend-only: the component exposes an input the spec does NOT declare →
//                  undocumented extension (or the spec is behind).
//
// The frontend side is the objectui registry-inputs manifest (sdui.manifest.json,
// produced from the live registry — see objectui scripts/dump-public-manifest.mjs).
// Provide it with MANIFEST=/path/to/sdui.manifest.json. Without it, the check
// reports "manifest unavailable" and exits 0 (same manifest-optional posture as
// the html-tier gate).
//
// Run: MANIFEST=… pnpm --filter @objectstack/spec check:react-conformance
//
// Baseline ratchet (cheap CI posture). The full spec↔frontend divergence has an
// accepted baseline (some props are designer-palette-curated, some spec-only are
// soft). Running this on every PR is not worth it — the manifest only exists at
// console-build time. So we instead RATCHET at that point: store the accepted
// per-block frontend-only set, and warn/fail only on NEW divergence.
//
//   --baseline <path>   compare current state against a committed baseline and
//                       report only regressions (a block exposes a NEW
//                       undocumented prop, or a previously-present block vanished).
//   --update            with --baseline, (re)write the baseline from the current
//                       manifest instead of comparing. Run after an intentional
//                       frontend change to accept the new state.
//   --strict            exit 1 on divergence (plain mode) or regression (baseline).

process.env.OS_EAGER_SCHEMAS = '1';

import fs from 'fs';
import { z } from 'zod';
import { REACT_BLOCKS } from '../src/ui/react-blocks';

const MANIFEST = process.env.MANIFEST;
const FAIL_ON_DIVERGENCE = process.argv.includes('--strict');
const UPDATE_BASELINE = process.argv.includes('--update');
function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  const inline = process.argv.find((a) => a.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : undefined;
}
const BASELINE = argValue('--baseline');

function specProps(schema: any): string[] {
  try {
    let js: any = z.toJSONSchema(schema, { unrepresentable: 'any' } as any);
    if (js?.$ref && js?.$defs) js = js.$defs[String(js.$ref).split('/').pop()!] ?? js;
    return Object.keys(js?.properties ?? {}).filter((k) => !['aria', 'type', 'id', 'className', 'style'].includes(k));
  } catch {
    return [];
  }
}

function manifestInputs(manifest: any, schemaType: string): string[] | null {
  const comps = manifest?.components ?? manifest ?? {};
  // keys may be bare ('object-form') or namespaced ('plugin-form:object-form').
  const entry =
    comps[schemaType] ??
    Object.entries(comps).find(([k]) => k === schemaType || k.endsWith(`:${schemaType}`))?.[1];
  if (!entry) return null;
  const inputs = (entry as any).inputs ?? [];
  return inputs.map((i: any) => i?.name).filter(Boolean);
}

if (!MANIFEST || !fs.existsSync(MANIFEST)) {
  console.log('⚠ react-blocks conformance: manifest unavailable (set MANIFEST=…) — skipping.');
  process.exit(0);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
let totalSpecOnly = 0;
let totalMissingComp = 0;
const overlay = (b: (typeof REACT_BLOCKS)[number]) => new Set(b.interactions.map((i) => i.name));

// Per-block snapshot of the actionable signal we ratchet on: the frontend-only
// prop set (component exposes, spec does not declare) and whether the block is
// missing from the manifest entirely.
type BlockState = { frontendOnly: string[]; missing: boolean };
const current: Record<string, BlockState> = {};

console.log('# Spec ↔ frontend conformance (react blocks)\n');
for (const b of REACT_BLOCKS) {
  if (!b.schema) continue;
  const spec = new Set(specProps(b.schema));
  const inputs = manifestInputs(manifest, b.schemaType);
  if (inputs === null) {
    console.log(`✗ <${b.tag}> (${b.schemaType}): NO component in the manifest — not registered or not public.`);
    totalMissingComp++;
    current[b.tag] = { frontendOnly: [], missing: true };
    continue;
  }
  const inputSet = new Set(inputs);
  const ov = overlay(b);
  const specOnly = [...spec].filter((p) => !inputSet.has(p) && !ov.has(p));
  const frontendOnly = [...inputSet].filter((p) => !spec.has(p) && !ov.has(p));
  const matched = [...spec].filter((p) => inputSet.has(p));
  totalSpecOnly += specOnly.length;
  current[b.tag] = { frontendOnly: frontendOnly.slice().sort(), missing: false };
  const status = specOnly.length === 0 ? '✓' : '⚠';
  console.log(`${status} <${b.tag}> (${b.schemaType}): ${matched.length} matched, ${specOnly.length} spec-only, ${frontendOnly.length} frontend-only`);
  if (specOnly.length) console.log(`    spec declares but component lacks: ${specOnly.join(', ')}`);
  if (frontendOnly.length) console.log(`    component exposes but spec lacks: ${frontendOnly.join(', ')}`);
}
console.log(`\nSummary: ${totalSpecOnly} spec-only divergences, ${totalMissingComp} blocks missing from the frontend.`);

// ── Baseline ratchet ─────────────────────────────────────────────────────────
if (BASELINE) {
  type Baseline = { blocks: Record<string, BlockState> };
  if (UPDATE_BASELINE) {
    const out: Baseline = { blocks: current };
    fs.writeFileSync(
      BASELINE,
      JSON.stringify(
        {
          _comment:
            'Accepted spec↔frontend conformance baseline (react blocks). Per block: the frontend-only prop set (component exposes, spec does not declare) and whether the block is missing. Regenerate with: MANIFEST=… check:react-conformance --baseline <this> --update. The ratchet flags only NEW frontend-only props or newly-missing blocks.',
          ...out,
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );
    console.log(`\n✓ wrote conformance baseline → ${BASELINE} (${Object.keys(current).length} blocks)`);
    process.exit(0);
  }

  if (!fs.existsSync(BASELINE)) {
    console.error(`\n✗ baseline not found: ${BASELINE} — generate it with --update first.`);
    process.exit(FAIL_ON_DIVERGENCE ? 1 : 0);
  }
  const baseline: Baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const regressions: string[] = [];
  for (const [tag, state] of Object.entries(current)) {
    const base = baseline.blocks?.[tag];
    const baseFO = new Set(base?.frontendOnly ?? []);
    const newFO = state.frontendOnly.filter((p) => !baseFO.has(p));
    if (newFO.length) regressions.push(`<${tag}>: new frontend-only prop(s) not in baseline: ${newFO.join(', ')}`);
    if (state.missing && base && !base.missing) regressions.push(`<${tag}>: block vanished from the manifest (was present in baseline).`);
  }
  // A brand-new block in the registry that isn't in the baseline is fine (purely
  // additive coverage); we only ratchet against accepted blocks regressing.
  console.log('\n## Baseline ratchet');
  if (!regressions.length) {
    console.log('✓ no new divergence vs accepted baseline.');
    process.exit(0);
  }
  console.log('⚠ NEW divergence vs accepted baseline:');
  for (const r of regressions) console.log(`    - ${r}`);
  console.log(
    '\n  → If intentional (frontend added a prop / the spec is meant to follow), either declare it in the spec\n' +
      '    schema, add it to the block overlay in packages/spec/src/ui/react-blocks.ts, or accept it by\n' +
      '    rerunning with --update.',
  );
  process.exit(FAIL_ON_DIVERGENCE ? 1 : 0);
}

if (FAIL_ON_DIVERGENCE && (totalSpecOnly > 0 || totalMissingComp > 0)) {
  console.error('Conformance check failed (--strict).');
  process.exit(1);
}
