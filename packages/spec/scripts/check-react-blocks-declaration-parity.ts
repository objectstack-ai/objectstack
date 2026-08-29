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
// THE SPEC SIDE IS THE WHOLE NODE CONTRACT, NOT ONLY THE PROPS HALF (#13192).
//
// `ComponentPropsMap[type]` is the PER-BLOCK half of what a page node may carry.
// The other half is declared ONCE, on `PageComponentSchema` itself — `type`,
// `id`, `className`, `dataSource`, `visibleWhen`, … — and applies to every
// component whatever its block. Judging registry inputs against the props half
// alone makes a node-level key read as an INVENTED input, and that complaint is
// FALSE rather than merely inconvenient: the spec does accept the key.
//
// The two readings that establish it, re-measured on this ref before the fix:
//
//   PageComponentSchema.safeParse({ type: 'list-view', dataSource: {…} })
//     → success: true, and the parsed output KEEPS `dataSource`
//   ComponentPropsMap['object-grid'] → 37 keys, `dataSource` among none of them
//
// So the accepted set per block is  node-level keys ∪ per-block props ∪ overlay.
//
// WHERE THE MANIFEST COMES FROM — AND WHY NOTHING HERE CAN PRODUCE ONE (#4690).
//
// The right-hand side is objectui's registry-inputs manifest (sdui.manifest.json).
// Its only producer is objectui's `scripts/dump-public-manifest.mjs`, which drives a
// real browser (Playwright chromium) at the built console's `dev/manifest-dump.html`
// and reads `window.__MANIFEST`: the registry is a browser app (plugin-map / charts
// pull browser-only deps), so nothing enumerates it from Node. `pnpm sdui:manifest`
// (scripts/gen-sdui-manifest.sh) is the wrapper that builds objectui at
// `.objectui-sha`, dumps the manifest, and then runs THIS gate against it.
//
// This repository carries no manifest to fall back on. Measured, so the next reader
// does not have to re-derive it: `packages/console/dist/` is gitignored (the package
// tracks 4 files, none of them a dist), `scripts/build-console.sh` deliberately does
// not produce one — it must not drag a browser into the console build, and says so —
// and the published `@objectstack/console` tarball has none either (16.1.0: 513
// files, zero `sdui` matches; its `dist/manifest.json` is the PWA manifest), so even
// the CLI's `@objectstack/console/dist/sdui.manifest.json` fallback resolves to
// nothing.
//
// Therefore "no manifest" never means "nothing to check" here. It means THIS GATE
// DID NOT RUN — reported as exit 1, not as a `⚠` and exit 0. Until #4690 the two
// were confused: the gate was in no workflow at all, and a manual run without a
// MANIFEST skipped and exited 0, so no path existed on which it could ever go red.
// That is the sample AGENTS.md's "Absence must be loud" describes — a verifier that
// silently degrades is worse than no verifier, because it reports success.
//
// Run: MANIFEST=… pnpm --filter @objectstack/spec check:react-declaration-parity
//      (or `pnpm sdui:manifest`, which produces the manifest and runs this for you)
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
import { ComponentPropsMap } from '../src/ui/component.zod';
import { PageComponentSchema } from '../src/ui/page.zod';

/**
 * The SDUI `object-*` page blocks whose props schemas entered
 * `ComponentPropsMap` at #7751 (maintainer ruling 2026-08-12, direction A).
 * The ruling's third point assigned their spec↔objectui parity burden to THIS
 * existing gate rather than a new one, so they ride the same comparison and
 * the same baseline ratchet as the react blocks: spec side from the zod
 * schema, registry side from the manifest, `registry-only` ratcheted,
 * `spec-only` soft (their declared sets are renderer-read supersets of the
 * registry `inputs`, so surplus is expected — ADR-0082 §2).
 *
 * Derived from the map rather than restated, so an `object-*` entry added to
 * the spec is covered by this gate the day it lands. Baseline keys use the
 * TYPE itself (`object-grid`), which cannot collide with the react blocks'
 * PascalCase tags.
 */
const SDUI_OBJECT_BLOCK_TYPES = Object.keys(ComponentPropsMap)
  .filter((t) => t.startsWith('object-'))
  .sort();

/**
 * Exit loudly because the NODE-LEVEL half of the accepted set could not be read.
 *
 * Same posture as {@link cannotRun} and for the same reason (#4690): a derivation
 * that silently comes back empty does not make this gate lenient, it makes it
 * catastrophically strict — every node-level key on every block would report as an
 * invented registry input, i.e. the exact false failure #13192 exists to remove,
 * restored by a shrug. Independent of `--strict`: no comparison can be trusted.
 */
function cannotDeriveNodeContract(reason: string): never {
  console.error(`✗ react-blocks declaration parity: ${reason}`);
  console.error('  This gate did NOT run. That is a failure, not a skip (#4690/#13192).');
  console.error(
    [
      '',
      "  The accepted set per block is the FULL node contract — PageComponentSchema's own",
      "  node-level keys UNION the block's ComponentPropsMap props — and the node-level half",
      '  is derived from the shape, never listed (#13192).',
      '',
      '  PageComponentSchema ends in `.transform(normalizeVisibleWhen)`, so it is a ZodPipe and',
      '  `z.toJSONSchema` of the pipe itself yields NO properties; the authorable key shape is',
      '  the pipe INPUT side, `_def.in`. If zod moved that internal, re-point the reader in',
      '  `deriveNodeContractKeys()` below.',
      '',
      '  ⛔ Do NOT "fix" this by restoring a hand-listed key set. The list this derivation',
      '     replaced named five of the twelve keys the shape accepts, and each of the other',
      '     seven was one registry declaration away from the same false failure.',
    ].join('\n'),
  );
  process.exit(1);
}

/**
 * A JSON-Schema entry that accepts NOTHING — `{ not: {} }`, which is how
 * `z.toJSONSchema` spells `z.never()`.
 *
 * That is what a key retired with `retiredKey()` looks like: the tombstone stays
 * in the shape (so `z.input` keeps typing it `never` and the parse keeps the
 * removal's prescription) while the spec refuses every value. `responsive` is one
 * today. ⚠️ A tombstone must NOT join the accepted set — the spec does not accept
 * the key, so a registry still declaring it as an input is a REAL finding and has
 * to stay red. Sweeping the whole shape in without this discrimination is how a
 * widening turns a gate vacuous.
 */
function acceptsNothing(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const not = (entry as { not?: unknown }).not;
  return !!not && typeof not === 'object' && Object.keys(not as object).length === 0;
}

/**
 * The node-level half of the accepted set, read off `PageComponentSchema`'s own
 * key shape — DERIVED, never listed, so the node-level key that lands next month
 * is covered the day it lands rather than after it has produced a false failure.
 *
 * Measured on this ref: twelve keys — `aria`, `className`, `dataSource`, `events`,
 * `id`, `label`, `properties`, `responsiveStyles`, `style`, `type`, `visibility`,
 * `visibleWhen` — plus the `responsive` tombstone, which {@link acceptsNothing}
 * drops. The literal this replaced listed five of those twelve.
 */
function deriveNodeContractKeys(): Set<string> {
  const pipe = PageComponentSchema as unknown as { _def?: { in?: unknown } };
  const shapeSource = pipe?._def?.in ?? PageComponentSchema;
  let js: any;
  try {
    js = z.toJSONSchema(shapeSource as any, { unrepresentable: 'any' } as any);
  } catch (err) {
    cannotDeriveNodeContract(
      `PageComponentSchema's key shape is unreadable — z.toJSONSchema threw: ${(err as Error).message}`,
    );
  }
  if (js?.$ref && js?.$defs) js = js.$defs[String(js.$ref).split('/').pop()!] ?? js;
  const props = js?.properties;
  if (!props || typeof props !== 'object' || Object.keys(props).length === 0) {
    cannotDeriveNodeContract(
      "PageComponentSchema's key shape read as EMPTY — no node-level key could be derived.",
    );
  }
  return new Set(Object.keys(props).filter((k) => !acceptsNothing(props[k])));
}

const NODE_CONTRACT_KEYS = deriveNodeContractKeys();

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

/** How an accepted node-level input is named in the per-block detail lines. */
const NODE_LEVEL_ACCEPT_LABEL = 'registry declares, spec accepts at NODE level (not a per-block prop)';

/**
 * What the gate accepted at node level, printed on EVERY run.
 *
 * Same reason the scope note is in the output rather than only in this header
 * (#4472): a widening that is invisible in the CI log cannot be audited, and the
 * whole risk of widening an accepted set is that it quietly becomes everything.
 * Naming the twelve keys — and saying that tombstones are excluded — makes the
 * calibration readable from the log a person actually forms a belief from.
 */
const NODE_CONTRACT_NOTE =
  `Node contract: the accepted set per block is node-level keys ∪ this block's props ∪ overlay.\n` +
  `       ${NODE_CONTRACT_KEYS.size} node-level keys, DERIVED from PageComponentSchema's own key shape (#13192):\n` +
  `       ${[...NODE_CONTRACT_KEYS].sort().join(', ')}\n` +
  '       Keys the shape RETIRES (`z.never()` tombstones) are excluded, so a registry input\n' +
  '       naming one is still reported — a widening that swept those in would be vacuous.';

/**
 * The PER-BLOCK half of the accepted set: the props this block's own schema
 * declares, minus anything the node-level contract already carries.
 *
 * The subtraction used to be a five-name literal (`aria`, `type`, `id`,
 * `className`, `style`); it is now {@link NODE_CONTRACT_KEYS}, the same derived
 * set the registry side is judged against — one source for "what is node-level",
 * because two would be the same drift kept in two places (#13192).
 */
function specProps(schema: any): string[] {
  try {
    let js: any = z.toJSONSchema(schema, { unrepresentable: 'any' } as any);
    if (js?.$ref && js?.$defs) js = js.$defs[String(js.$ref).split('/').pop()!] ?? js;
    return Object.keys(js?.properties ?? {}).filter((k) => !NODE_CONTRACT_KEYS.has(k));
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

/**
 * The prescription every "could not run" exit carries.
 *
 * A refusal is only better than a skip if the reader can act on it. The manifest's
 * provenance is two repos away from whoever hits this — it is dumped from objectui's
 * registry in a browser — so the exit that replaced the skip has to hand over the
 * whole path, not just the missing variable's name.
 */
const MANIFEST_PRESCRIPTION = [
  '',
  '  The registry side of this comparison is objectui\'s sdui.manifest.json, and this',
  '  repository contains no copy of it: packages/console/dist/ is gitignored, the console',
  '  build deliberately does not produce one (it must not pull in a browser), and the',
  '  published @objectstack/console ships none either. Produce one, then re-run:',
  '',
  '    pnpm objectui:build     # build + vendor the console at the pinned .objectui-sha',
  '    pnpm sdui:manifest      # dump the manifest in a browser AND run this ratchet',
  '',
  '  Against a sibling objectui checkout, point the build at it first:',
  '',
  '    OBJECTUI_ROOT=../objectui pnpm objectui:build && pnpm sdui:manifest',
  '',
  '  Or, with a manifest already in hand:',
  '',
  '    MANIFEST=/path/to/sdui.manifest.json \\',
  '      pnpm --filter @objectstack/spec check:react-declaration-parity \\',
  '      --baseline react-declaration-parity.baseline.json --strict',
  '',
  '  (the dump needs a browser: pnpm exec playwright install chromium-headless-shell)',
].join('\n');

/**
 * Exit loudly because the gate could not run — never because it ran and disagreed.
 *
 * Deliberately independent of `--strict`: that flag decides what a DIVERGENCE costs,
 * and this is the other thing entirely — no comparison happened at all. Making it
 * conditional would re-create #4690's hole one flag deeper.
 */
function cannotRun(reason: string): never {
  console.error(`✗ react-blocks declaration parity: ${reason}`);
  console.error('  This gate did NOT run. That is a failure, not a skip (#4690).');
  console.error(MANIFEST_PRESCRIPTION);
  process.exit(1);
}

if (!MANIFEST) cannotRun('MANIFEST is not set — there is no registry side to compare against.');
if (!fs.existsSync(MANIFEST)) cannotRun(`MANIFEST=${MANIFEST} does not exist.`);

let manifest: any;
try {
  manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
} catch (err) {
  cannotRun(`MANIFEST=${MANIFEST} is not readable JSON — ${(err as Error).message}`);
}
if (!manifest || typeof manifest !== 'object') {
  cannotRun(`MANIFEST=${MANIFEST} is not an object — expected { components: { <type>: { inputs: [...] } } }.`);
}
// An empty dump is the same defect wearing a manifest: every block would report as
// "missing", which under --strict reads as a catastrophic regression and without it
// as a green run that compared against nothing. objectui's dumper already refuses to
// write one ("empty manifest — registry not populated"); refuse to read one too.
if (Object.keys((manifest.components ?? manifest) as Record<string, unknown>).length === 0) {
  cannotRun(`MANIFEST=${MANIFEST} declares no components — an empty registry dump compares against nothing.`);
}
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
console.log(NODE_CONTRACT_NOTE + '\n');
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
  const nodeLevel = [...inputSet].filter((p) => NODE_CONTRACT_KEYS.has(p) && !spec.has(p) && !ov.has(p));
  const registryOnly = [...inputSet].filter((p) => !spec.has(p) && !ov.has(p) && !NODE_CONTRACT_KEYS.has(p));
  const declaredByBoth = [...spec].filter((p) => inputSet.has(p));
  totalSpecOnly += specOnly.length;
  current[b.tag] = { registryOnly: registryOnly.slice().sort(), missing: false };
  const status = specOnly.length === 0 ? '✓' : '⚠';
  console.log(
    `${status} <${b.tag}> (${b.schemaType}): ${declaredByBoth.length} declared by both, ${specOnly.length} spec-only, ${registryOnly.length} registry-only, ${nodeLevel.length} node-level`,
  );
  if (specOnly.length) console.log(`    spec declares, registry does not: ${specOnly.join(', ')}`);
  if (nodeLevel.length) console.log(`    ${NODE_LEVEL_ACCEPT_LABEL}: ${nodeLevel.sort().join(', ')}`);
  if (registryOnly.length) console.log(`    registry declares, spec does not: ${registryOnly.join(', ')}`);
}
// ── SDUI object-* blocks (#7751) — same comparison, same ratchet ─────────────
console.log('\n# Spec ↔ registry declaration parity (SDUI object-* blocks, #7751)\n');
for (const type of SDUI_OBJECT_BLOCK_TYPES) {
  const schema = (ComponentPropsMap as Record<string, unknown>)[type];
  const spec = new Set(specProps(schema));
  const inputs = manifestInputs(manifest, type);
  if (inputs === null) {
    console.log(`✗ ${type}: NO component in the manifest — not registered or not public.`);
    totalMissingComp++;
    current[type] = { registryOnly: [], missing: true };
    continue;
  }
  const inputSet = new Set(inputs);
  const specOnly = [...spec].filter((p) => !inputSet.has(p));
  const nodeLevel = [...inputSet].filter((p) => NODE_CONTRACT_KEYS.has(p) && !spec.has(p));
  const registryOnly = [...inputSet].filter((p) => !spec.has(p) && !NODE_CONTRACT_KEYS.has(p));
  const declaredByBoth = [...spec].filter((p) => inputSet.has(p));
  totalSpecOnly += specOnly.length;
  current[type] = { registryOnly: registryOnly.slice().sort(), missing: false };
  const status = specOnly.length === 0 ? '✓' : '⚠';
  console.log(
    `${status} ${type}: ${declaredByBoth.length} declared by both, ${specOnly.length} spec-only, ${registryOnly.length} registry-only, ${nodeLevel.length} node-level`,
  );
  if (specOnly.length) console.log(`    spec declares, registry does not: ${specOnly.join(', ')}`);
  if (nodeLevel.length) console.log(`    ${NODE_LEVEL_ACCEPT_LABEL}: ${nodeLevel.sort().join(', ')}`);
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
