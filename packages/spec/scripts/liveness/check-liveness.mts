#!/usr/bin/env tsx
// Spec liveness gate (registry-rooted).
//
// For a metadata-driven platform the spec IS the product surface: authors write
// metadata against these schemas. A property that is parsed but has no runtime
// consumer is a silent no-op (worst case, a *security* no-op — false compliance).
//
// SOURCE OF TRUTH: the metadata-type registry (BUILTIN_METADATA_TYPE_SCHEMAS via
// listMetadataTypeSchemaTypes/getMetadataTypeSchema). This is the same registry the
// runtime `/api/v1/meta/types/:type` endpoint and the Studio metadata-admin forms
// use — i.e. exactly the set of *authorable* metadata types. (We walk the Zod schema
// directly rather than z.toJSONSchema, because a couple of schemas — object, action —
// throw in the JSON-schema converter, which is precisely why the old json-schema/-based
// gate was blind to them.)
//
// Governed types must declare every authorable property's liveness status with
// evidence in packages/spec/liveness/<type>.json, or CI fails (the ratchet — no new
// undeclared surface). Property granularity is one level: a container property
// (object / record / array-of-object) may be drilled into via `"children"` so e.g.
// `permission.objects.allowCreate` stays distinguishable from a blanket `objects`.
//
// Statuses: live | experimental | planned | dead.  Resolution per property:
//   ledger entry → spec `.describe()` marker ([EXPERIMENTAL — not enforced]) → UNCLASSIFIED
//
// PROVE-IT-RUNS (ADR-0054): a `live` entry may carry a `proof` (a dogfood test
// reference `<file>#<proof-id>`). For the HIGH-RISK classes bound this phase
// (see proof-registry.mts), a `live` classification MUST carry a valid proof —
// the file must exist and declare the `@proof: <id>` tag. CI fails otherwise.
//
// Usage:
//   tsx check-liveness.mts                 # check all governed types
//   tsx check-liveness.mts --dump <type>   # inventory a type's properties (seeding aid)
//   tsx check-liveness.mts --json          # machine-readable report

process.env.OS_EAGER_SCHEMAS = '1';

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { getMetadataTypeSchema, listMetadataTypeSchemaTypes } from '../../src/kernel/metadata-type-schemas';
import {
  BOUND_PROOF_PATHS,
  HIGH_RISK_CLASSES,
  KNOWN_PROOF_IDS,
  extractProofTags,
  parseProofRef,
  validateProofRef,
} from './proof-registry.mts';

const here = dirname(fileURLToPath(import.meta.url));
const specRoot = resolve(here, '../..'); // packages/spec
const repoRoot = resolve(specRoot, '../..');
const ledgerRoot = join(specRoot, 'liveness');

// Governed metadata types, rolled out highest-frequency / highest-risk first.
const GOVERNED = ['object', 'field', 'flow', 'action', 'hook', 'permission', 'position', 'agent', 'tool', 'skill', 'dataset', 'page', 'view'];

// ADR-0010 provenance/lock overlay fields — system-stamped, on every type; auto-live.
const FRAMEWORK_FIELDS = new Set([
  '_lock', '_lockReason', '_lockSource', '_lockDocsUrl',
  '_provenance', '_packageId', '_packageVersion', 'protection',
]);

const MARKER_RE = {
  experimental: /\[experimental|not enforced|aspirational/i,
  planned: /\[planned|not yet implemented|coming soon/i,
};
function markerStatus(d: string): string | null {
  if (MARKER_RE.planned.test(d)) return 'planned';
  if (MARKER_RE.experimental.test(d)) return 'experimental';
  return null;
}

// ---- Zod schema walking (version-tolerant: prefer _zod.def, fall back to _def) ----
function defOf(s: any): any {
  return s && (s._zod?.def ?? s._def);
}
function unwrap(s: any, depth = 0): any {
  if (!s || depth > 16) return s;
  const def = defOf(s);
  if (!def) return s;
  if (def.type === 'lazy' && typeof def.getter === 'function') return unwrap(def.getter(), depth + 1);
  if (['optional', 'default', 'nullable', 'readonly', 'catch', 'nonoptional', 'prefault'].includes(def.type)) return unwrap(def.innerType, depth + 1);
  if (def.type === 'pipe') return unwrap(def.in ?? def.out, depth + 1);
  return s;
}
function shapeOf(s: any): Record<string, any> | null {
  const u = unwrap(s);
  const def = defOf(u);
  if (def?.type !== 'object') return null;
  return def.shape ?? u.shape ?? null;
}
function descOf(s: any): string {
  let cur = s;
  for (let i = 0; i < 16 && cur; i++) {
    if (cur.description) return cur.description;
    const def = defOf(cur);
    if (def?.description) return def.description;
    cur = def?.innerType ?? (def?.type === 'lazy' && def.getter ? def.getter() : undefined) ?? def?.in;
  }
  return '';
}
// container drill: object → its shape; record → value shape; array → element shape
function childShape(s: any): Record<string, any> | null {
  const u = unwrap(s);
  const def = defOf(u);
  if (!def) return null;
  if (def.type === 'object') return def.shape ?? u.shape ?? null;
  if (def.type === 'record') return shapeOf(def.valueType);
  if (def.type === 'array') return shapeOf(def.element);
  return null;
}

function topProps(type: string): Array<{ key: string; node: any; description: string }> {
  const schema = getMetadataTypeSchema(type);
  if (!schema) throw new Error(`metadata type '${type}' has no registered schema`);
  const shape = shapeOf(schema);
  if (!shape) throw new Error(`metadata type '${type}' is not an object schema (no walkable shape)`);
  return Object.keys(shape).map((k) => ({ key: k, node: shape[k], description: descOf(shape[k]) }));
}

function loadLedger(type: string): any {
  const f = join(ledgerRoot, `${type}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { props: {} };
}

// ---- dump mode ----
const args = process.argv.slice(2);
const dumpIdx = args.indexOf('--dump');
if (dumpIdx !== -1) {
  const type = args[dumpIdx + 1];
  const rows: any[] = [];
  for (const { key, node, description } of topProps(type)) {
    const cs = childShape(node);
    if (cs && !FRAMEWORK_FIELDS.has(key)) {
      for (const ck of Object.keys(cs)) rows.push({ prop: `${key}.${ck}`, marker: markerStatus(descOf(cs[ck])) || '' });
    } else {
      rows.push({ prop: key, container: !!cs, marker: markerStatus(description) || '' });
    }
  }
  process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
  process.exit(0);
}

// ---- check ----
const asJson = args.includes('--json');
const report: any = {
  types: {},
  totals: { byStatus: {} as Record<string, number> },
  unclassified: [] as string[],
  staleEvidence: [] as string[],
  proofErrors: [] as string[], // a `proof` ref that doesn't resolve (missing file / missing tag / malformed)
  proofMissing: [] as string[], // a bound high-risk `live` entry with no proof at all
  orphanProofs: [] as string[], // a dogfood `@proof:` tag not registered in proof-registry.mts
};

const proofFs = { existsSync, readFileSync };

function classify(type: string, path: string, status: string, led: any, cat: any) {
  cat.classified++;
  cat.byStatus[status] = (cat.byStatus[status] || 0) + 1;
  report.totals.byStatus[status] = (report.totals.byStatus[status] || 0) + 1;
  if (status === 'live' && led?.evidence) {
    const file = String(led.evidence).split(':')[0];
    if (/\//.test(file) && !existsSync(join(repoRoot, file))) report.staleEvidence.push(`${type}/${path} → ${led.evidence}`);
  }
  // ── ADR-0054 prove-it-runs ──
  const boundClass = BOUND_PROOF_PATHS.get(`${type}/${path}`);
  if (led?.proof !== undefined) {
    // Any declared proof is validated (no silent rot), bound or not.
    const v = validateProofRef(led.proof, { repoRoot, fs: proofFs, join });
    if (!v.ok) report.proofErrors.push(`${type}/${path} → ${v.error}`);
    else if (boundClass) {
      // A bound entry must point at ITS class's proof, not just any valid proof.
      const id = parseProofRef(led.proof)?.id;
      if (id !== boundClass.proofId) {
        report.proofErrors.push(
          `${type}/${path} → proof "${id}" is not the bound ${boundClass.label} proof ("${boundClass.proofId}")`,
        );
      }
    }
  } else if (boundClass && status === 'live') {
    report.proofMissing.push(
      `${type}/${path} (${boundClass.label}) — high-risk live property requires a proof: expected "${boundClass.proofRef}"`,
    );
  }
}

// Reverse integrity: every `@proof:` tag declared under the dogfood proof tree
// must be registered in proof-registry.mts. An orphan tag means a proof was
// written but never wired into the high-risk-class list — flag it (warning).
function scanOrphanProofs() {
  const proofDir = join(repoRoot, 'packages/dogfood/test');
  if (!existsSync(proofDir)) return; // spec may be consumed standalone (published)
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) out.push(...walk(full));
      else if (ent.isFile() && ent.name.endsWith('.ts')) out.push(full);
    }
    return out;
  };
  for (const file of walk(proofDir)) {
    for (const tag of extractProofTags(readFileSync(file, 'utf8'))) {
      if (!KNOWN_PROOF_IDS.has(tag)) {
        report.orphanProofs.push(`@proof: ${tag} (in ${file.slice(repoRoot.length + 1)}) — not registered in proof-registry.mts`);
      }
    }
  }
}

for (const type of GOVERNED) {
  const ledger = loadLedger(type);
  const props = ledger.props || {};
  const cat = { classified: 0, unclassified: 0, byStatus: {} as Record<string, number> };
  for (const { key, node, description } of topProps(type)) {
    if (FRAMEWORK_FIELDS.has(key)) { classify(type, key, 'live', null, cat); continue; }
    const led = props[key];
    if (led?.children) {
      // drill one level
      const cs = childShape(node);
      if (!cs) { cat.unclassified++; report.unclassified.push(`${type}/${key} (declared children but property is not a container)`); continue; }
      for (const ck of Object.keys(cs)) {
        const cled = led.children[ck];
        const status = cled?.status || markerStatus(descOf(cs[ck])) || led.childrenDefault;
        if (!status) { cat.unclassified++; report.unclassified.push(`${type}/${key}.${ck}`); continue; }
        classify(type, `${key}.${ck}`, status, cled, cat);
      }
    } else {
      const status = led?.status || markerStatus(description);
      if (!status) { cat.unclassified++; report.unclassified.push(`${type}/${key}`); continue; }
      classify(type, key, status, led, cat);
    }
  }
  report.types[type] = cat;
}

scanOrphanProofs();

const totalUnclassified = report.unclassified.length;
const totalProofFailures = report.proofErrors.length + report.proofMissing.length;
const failed = totalUnclassified > 0 || totalProofFailures > 0;
if (asJson) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} else {
  console.log('Spec liveness gate (registry-rooted) — governed types:', GOVERNED.join(', '));
  for (const [t, v] of Object.entries<any>(report.types)) {
    const parts = Object.entries(v.byStatus).map(([s, n]) => `${s} ${n}`).join(', ');
    console.log(`  ${t.padEnd(11)} ${v.classified} classified (${parts || '—'})${v.unclassified ? `, ${v.unclassified} UNCLASSIFIED` : ''}`);
  }
  const boundClasses = HIGH_RISK_CLASSES.filter((c) => c.bound).map((c) => c.label);
  console.log(`\nprove-it-runs (ADR-0054): proof REQUIRED for bound high-risk classes — ${boundClasses.join(', ') || 'none'}`);
  if (report.staleEvidence.length) {
    console.log(`\n⚠ ${report.staleEvidence.length} 'live' entr(ies) cite a missing file:`);
    report.staleEvidence.forEach((s: string) => console.log(`    ${s}`));
  }
  if (report.orphanProofs.length) {
    console.log(`\n⚠ ${report.orphanProofs.length} unregistered dogfood proof tag(s) — add to proof-registry.mts:`);
    report.orphanProofs.forEach((s: string) => console.log(`    ${s}`));
  }
  if (report.proofMissing.length) {
    console.log(`\n✗ ${report.proofMissing.length} high-risk 'live' propert(ies) missing a runtime proof:`);
    report.proofMissing.forEach((s: string) => console.log(`    ${s}`));
  }
  if (report.proofErrors.length) {
    console.log(`\n✗ ${report.proofErrors.length} proof reference(s) do not resolve:`);
    report.proofErrors.forEach((s: string) => console.log(`    ${s}`));
  }
  if (totalUnclassified) {
    console.log(`\n✗ ${totalUnclassified} UNCLASSIFIED — classify in packages/spec/liveness/<type>.json:`);
    report.unclassified.forEach((s: string) => console.log(`    ${s}`));
  }
  if (!failed) {
    console.log('\n✓ all governed-type properties are classified; all bound high-risk proofs resolve.');
  }
}
process.exit(failed ? 1 : 0);
