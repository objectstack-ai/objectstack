// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Spec ↔ registry DECLARATION PARITY for the curated react blocks (ADR-0081/
// ADR-0082 follow-up; corrected by #4472).
//
// ⚠️ READ THIS BEFORE TRUSTING A GREEN RUN — what this does NOT do.
//
// This compares TWO DECLARATIONS. It never looks at a renderer:
//
//   left   the props the SPEC zod schema declares for a block (`z.toJSONSchema`)
//   right  the inputs the objectui REGISTRY CONFIG declares for the same block
//          — read out of `sdui.manifest.json`, which objectui builds with
//          `manifestFromConfigs(getPublicConfigs())`; that function copies
//          `config.inputs` verbatim, so the right-hand side is a *declaration*
//          too, not evidence that anything consumes the prop.
//
// So a prop that BOTH SIDES declare and NO RENDERER READS is, to this script,
// perfect agreement. Neither declaration is lying on its own; the lie is one
// layer below, where the render happens — and that layer is outside this
// script's field of view entirely.
//
// That blind spot is not hypothetical. This file used to open by claiming it
// "confirms the objectui components ACTUALLY implement the props the spec
// protocol declares". It never could. #4413 is what that cost: four blocks
// (`record:details` / `record:highlights` / `record:related_list` /
// `record:path`) published `objectName` / `recordId` that no renderer read —
// those renderers take the record from the record page's shared context — so
// the blocks rendered a "bind a record to preview" placeholder on a
// `kind:'react'` page. Both declarations agreed the whole time, so the baseline
// recorded `{ registryOnly: [], missing: false }` for all four and this check
// stayed green for #4413's entire lifetime. The defect was found by a human
// reading the objectui renderers, not by this script. #4472 is the correction.
//
// WHAT IT DOES SEE (real signals — don't discount them):
//
//   - spec-only     : the spec schema declares a prop the registry config does
//                     NOT declare as an input → the designer palette can't
//                     configure it. A soft signal per ADR-0082 §2 (the palette
//                     is deliberately a subset), reported but never ratcheted.
//   - registry-only : the registry config declares an input the spec does NOT
//                     declare → undocumented extension, or the spec is behind.
//                     This is what the baseline ratchets on.
//   - missing       : no component for this block in the manifest at all → not
//                     registered, or not public. Real signal.
//
// WHAT IT CANNOT SEE is exactly one class: both sides declare it, nothing reads
// it. Catching that needs evidence from the render path (a behavioural probe or
// a renderer-side usage pass), which lives in objectui, not here.
// `check-react-blocks-declaration-parity.test.ts` pins the limitation with a
// fixture that stays green while its "renderer" ignores everything, so the
// capability cannot be re-assumed by the next reader.
//
// The frontend side is the objectui registry-inputs manifest (sdui.manifest.json
// — see objectui scripts/dump-public-manifest.mjs). Provide it with
// MANIFEST=/path/to/sdui.manifest.json. Without it, the check reports "manifest
// unavailable" and exits 0 (same manifest-optional posture as the html-tier gate).
//
// Run: MANIFEST=… pnpm --filter @objectstack/spec check:react-declaration-parity
//
// Baseline ratchet (cheap CI posture). The full spec↔registry divergence has an
// accepted baseline (some props are designer-palette-curated, some spec-only are
// soft). Running this on every PR is not worth it — the manifest only exists at
// console-build time. So we instead RATCHET at that point: store the accepted
// per-block registry-only set, and fail only on NEW divergence.
//
//   --baseline <path>   compare current state against a committed baseline and
//                       report only regressions (a block declares a NEW
//                       undocumented input, or a previously-present block vanished).
//   --update            with --baseline, (re)write the baseline from the current
//                       manifest instead of comparing. Run after an intentional
//                       registry change to accept the new state.
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

/**
 * The scope caveat the report carries on EVERY run, success included.
 *
 * Deliberately in the OUTPUT and not only in this header: whoever forms a belief
 * about what "✓ no new divergence" means is reading a CI log, not this file.
 * #4472's finding is that the claim travelled further than the capability, so
 * the correction has to travel with the result.
 */
const SCOPE_NOTE =
  'Scope: compares two DECLARATIONS — spec zod schema props vs registry-declared inputs.\n' +
  '       No renderer is inspected. A prop BOTH sides declare and NO renderer reads counts\n' +
  '       as agreement here; that blind spot is what #4413 shipped through (see #4472).';

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
  console.log('⚠ react-blocks declaration parity: manifest unavailable (set MANIFEST=…) — skipping.');
  process.exit(0);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
let totalSpecOnly = 0;
let totalMissingComp = 0;
const overlay = (b: (typeof REACT_BLOCKS)[number]) => new Set(b.interactions.map((i) => i.name));

// Per-block snapshot of the actionable signal we ratchet on: the registry-only
// input set (the registry config declares it, the spec does not) and whether the
// block is missing from the manifest entirely.
type BlockState = { registryOnly: string[]; missing: boolean };
const current: Record<string, BlockState> = {};

console.log('# Spec ↔ registry declaration parity (react blocks)\n');
console.log(SCOPE_NOTE + '\n');
for (const b of REACT_BLOCKS) {
  if (!b.schema) continue;
  const spec = new Set(specProps(b.schema));
  const inputs = manifestInputs(manifest, b.schemaType);
  if (inputs === null) {
    console.log(`✗ <${b.tag}> (${b.schemaType}): NO component in the manifest — not registered or not public.`);
    totalMissingComp++;
    current[b.tag] = { registryOnly: [], missing: true };
    continue;
  }
  const inputSet = new Set(inputs);
  const ov = overlay(b);
  const specOnly = [...spec].filter((p) => !inputSet.has(p) && !ov.has(p));
  const registryOnly = [...inputSet].filter((p) => !spec.has(p) && !ov.has(p));
  const declaredByBoth = [...spec].filter((p) => inputSet.has(p));
  totalSpecOnly += specOnly.length;
  current[b.tag] = { registryOnly: registryOnly.slice().sort(), missing: false };
  const status = specOnly.length === 0 ? '✓' : '⚠';
  console.log(
    `${status} <${b.tag}> (${b.schemaType}): ${declaredByBoth.length} declared by both, ${specOnly.length} spec-only, ${registryOnly.length} registry-only`,
  );
  if (specOnly.length) console.log(`    spec declares, registry does not: ${specOnly.join(', ')}`);
  if (registryOnly.length) console.log(`    registry declares, spec does not: ${registryOnly.join(', ')}`);
}
console.log(
  `\nSummary: ${totalSpecOnly} spec-only divergences, ${totalMissingComp} blocks missing from the registry.`,
);
console.log('  "declared by both" is a statement about the two declarations, not about the renderer.');

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
            'Accepted spec↔registry DECLARATION-PARITY baseline (react blocks). Per block: the registry-only input set (the registry config declares it, the spec does not) and whether the block is missing. Regenerate with: MANIFEST=… check:react-declaration-parity --baseline <this> --update. The ratchet flags only NEW registry-only inputs or newly-missing blocks. It compares two declarations and inspects no renderer, so a prop both sides declare and nothing reads records as agreement here (#4413/#4472).',
          ...out,
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );
    console.log(`\n✓ wrote declaration-parity baseline → ${BASELINE} (${Object.keys(current).length} blocks)`);
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
    const baseRO = new Set(base?.registryOnly ?? []);
    const newRO = state.registryOnly.filter((p) => !baseRO.has(p));
    if (newRO.length) regressions.push(`<${tag}>: new registry-only input(s) not in baseline: ${newRO.join(', ')}`);
    if (state.missing && base && !base.missing) regressions.push(`<${tag}>: block vanished from the manifest (was present in baseline).`);
  }
  // A brand-new block in the registry that isn't in the baseline is fine (purely
  // additive coverage); we only ratchet against accepted blocks regressing.
  console.log('\n## Baseline ratchet');
  if (!regressions.length) {
    console.log('✓ no new DECLARATION divergence vs accepted baseline (see the scope note above).');
    process.exit(0);
  }
  console.log('⚠ NEW declaration divergence vs accepted baseline:');
  for (const r of regressions) console.log(`    - ${r}`);
  console.log(
    '\n  → If intentional (the registry added an input / the spec is meant to follow), either declare it\n' +
      '    in the spec schema, add it to the block overlay in packages/spec/src/ui/react-blocks.ts, or\n' +
      '    accept it by rerunning with --update.',
  );
  process.exit(FAIL_ON_DIVERGENCE ? 1 : 0);
}

if (FAIL_ON_DIVERGENCE && (totalSpecOnly > 0 || totalMissingComp > 0)) {
  console.error('Declaration-parity check failed (--strict).');
  process.exit(1);
}
