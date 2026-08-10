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
// A container that is NOT drilled inherits its parent's single verdict for every
// key beneath it, and that inheritance must be DECLARED, not assumed: it is
// recorded in the shrink-only `drill.mts` baseline, counted in every run, and a
// new one fails the gate. `dashboard.widgets` rode on an undeclared inheritance
// for 22 keys while asserting in prose that they were "classified in the
// DashboardWidgetSchema subtree" — a subtree that never existed — which is how
// `widgets[].responsive` survived an inert-key sweep that removed its own
// sibling. See drill.mts (#4956).
//
// BOTH DIRECTIONS. Schema → ledger catches an undeclared property (UNCLASSIFIED).
// Ledger → schema catches the reverse: a row that outlived its property, which
// went unchecked until #4080 mapped the asymmetry (a strict removal takes the key
// out of the walked shape, so the forward pass just stops asking). See orphans.mts.
//
// Statuses: live | experimental | planned | dead.  Resolution per property:
//   ledger entry → spec `.describe()` marker ([EXPERIMENTAL — not enforced]) → UNCLASSIFIED
//
// PROVE-IT-RUNS (ADR-0054): a `live` entry may carry a `proof` (a dogfood test
// reference `<file>#<proof-id>`). For the HIGH-RISK classes bound this phase
// (see proof-registry.mts), a `live` classification MUST carry a valid proof —
// the file must exist and declare the `@proof: <id>` tag. CI fails otherwise.
//
// EVIDENCE POINTERS (ADR-0087): a `live` verdict IS its evidence pointer — "this
// property has a runtime consumer, here it is". A cited path that is repo-rooted
// and attributed to THIS repo must resolve against this checkout, or CI fails:
// an unresolvable pointer makes the claim unfalsifiable, and a directory move or
// a rename is all it takes (see evidence.mts). Cross-repo attribution
// (`objectui: …`, `cloud: …`, `packages/services/service-ai/…`) is counted, not
// resolved — those files are legitimately absent here. This was a ⚠ until #5623,
// for one historical reason: the pre-#3857 `evidence.split(':')[0]` parser
// flagged 48 of 227 entries with a ~100% false-positive rate, so failing on it
// would have failed every build. The parse fix is what turned a hit into signal.
//
// PRODUCER-SIDE EVIDENCE (`producer`, #4837): `live` means AUTHORING the
// property changes runtime behaviour. A consumer that reads the property is
// necessary and not sufficient — when the effect also depends on a second input
// somebody must supply, the verdict needs evidence that somebody does.
// `Seed.env` was `live` on a correct consumer pointer (`filterByEnv`) while not
// one of six call sites passed `env`, so the filter returned its input on line
// one and the authored value was never read. An optional `"producer"` cites the
// call site; its paths resolve exactly like `evidence`.
//
// THE README'S OWN INDEX (#7257): the ledger README ends with a "Current state"
// table, one row per governed type, under a heading that claims complete
// registry coverage. Nothing reconciled that table against `GOVERNED`, so the
// heading's number was the count of ROWS rather than of governed types, and
// `api` and `capability` were governed for days with no row at all. Same shape
// as #4956 one level up: a completeness sentence that no build could fail. See
// readme-table.mts.
//
// EVIDENCE SCOPE (`evidenceScope`, #4895): four measured verdicts have been
// reached by searching this repo alone and published as if they covered every
// consumer (`app.homePageId`, `flow.…position`, `HttpMethod`,
// `Notification`). An optional `"evidenceScope": "in-repo" | "cross-repo"`
// records how wide the last look actually was. Absent = unverified scope (a
// worklist row); malformed = FAIL, same asymmetry as `verifiedAt`.
//
// RE-VERIFICATION CLOCK (`verifiedAt`): a ledger entry is a claim with a
// timestamp, and code moves under it in BOTH directions — `flow.status` (#3711)
// and `action.undoable` (#3714) were both understated by entries that were
// accurate when written. An optional `"verifiedAt": "YYYY-MM-DD"` records when a
// human last closed the call graph. Age never fails CI (re-verification is a
// worklist); a MALFORMED or future date does, because it silently disables the
// staleness check for that entry.
//
// Usage:
//   tsx check-liveness.mts                        # check all governed types
//   tsx check-liveness.mts --dump <type>          # inventory a type's properties (seeding aid)
//   tsx check-liveness.mts --json                 # machine-readable report
//   tsx check-liveness.mts --stale-verification   # print the re-verification worklist
//   tsx check-liveness.mts --stale-verification=90  # ...with a custom staleness threshold
//   tsx check-liveness.mts --undrilled            # print the undrilled-container worklist
//   tsx check-liveness.mts --producer-gap         # print the producer-evidence worklist (#4837)
//   tsx check-liveness.mts --ledger-root=<dir>    # read the ledgers from <dir> instead of
//                                                 # packages/spec/liveness — how the self-test
//                                                 # runs the REAL gate against a mutated copy
//                                                 # of the real ledgers without touching them

process.env.OS_EAGER_SCHEMAS = '1';

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { getMetadataTypeSchema, listMetadataTypeSchemaTypes } from '../../src/kernel/metadata-type-schemas';
import { WebhookSchema } from '../../src/automation/webhook.zod';
import { QuerySchema } from '../../src/data/query.zod';
import { ValidationRuleSchema } from '../../src/data/validation.zod';
import { TestSuiteSchema } from '../../src/qa/testing.zod';
import {
  BOUND_PROOF_PATHS,
  HIGH_RISK_CLASSES,
  KNOWN_PROOF_IDS,
  extractProofTags,
  parseProofRef,
  validateProofRef,
} from './proof-registry.mts';
import {
  DEFAULT_STALE_DAYS,
  buildVerificationReport,
  type VerificationEntry,
  type VerificationReport,
} from './verification.mts';
import { checkEvidence } from './evidence.mts';
import { buildProducerReport, type ProducerEntry, type ProducerReport } from './producer.mts';
import { ORPHAN_GUIDANCE, findOrphanEntries, type Orphan } from './orphans.mts';
import {
  STALE_UNDRILLED_GUIDANCE,
  UNDRILLED_GUIDANCE,
  parseUndrilledBaseline,
  reconcileContainerCoverage,
  type ContainerCoverage,
} from './drill.mts';
import {
  README_ORPHAN_ROW_GUIDANCE,
  README_TABLE_GUIDANCE,
  STATE_COUNTS_FILE,
  STATE_COUNTS_GUIDANCE,
  STATE_COUNTS_PATH,
  foldStateCounts,
  parseStateTable,
  reconcileReadmeTable,
  reconcileStateCounts,
  renderStateCounts,
} from './readme-table.mts';

const here = dirname(fileURLToPath(import.meta.url));
const specRoot = resolve(here, '../..'); // packages/spec
const repoRoot = resolve(specRoot, '../..');

const args = process.argv.slice(2);

// `--ledger-root=<dir>` points the walk at a COPY of packages/spec/liveness.
// It exists because the evidence gate below now fails the build, and a gate that
// fails is only worth as much as the proof that it fails — which needs a rotted
// pointer to fail ON. Committing one to a shipped ledger is not an option (it
// would fail every other run), and mutating a tracked file mid-test leaves the
// worktree dirty when the test crashes. So the self-test copies the real ledgers
// to a temp dir, breaks exactly one pointer there, and runs THIS script — same
// code path CI runs, no repo state touched. Everything else still resolves
// against the real repoRoot, so the resulting exit 1 has exactly one cause.
const ledgerRootArg = args.find((a) => a.startsWith('--ledger-root='));
const ledgerRoot = ledgerRootArg
  ? resolve(ledgerRootArg.slice('--ledger-root='.length))
  : join(specRoot, 'liveness');

// Governed metadata types, rolled out highest-frequency / highest-risk first.
// (`query` is not a metadata type — see SPEC_ONLY_SCHEMAS below.)
const GOVERNED = ['object', 'field', 'flow', 'action', 'hook', 'permission', 'position', 'agent', 'tool', 'skill', 'dataset', 'page', 'view', 'report', 'dashboard', 'webhook', 'query', 'datasource', 'app', 'book', 'doc', 'email_template', 'job', 'mapping', 'seed', 'translation', 'validation', 'api', 'capability', 'qa'];

// Registered metadata types that are NOT yet governed — the coverage ratchet.
//
// WHY THIS EXISTS. `GOVERNED` was hand-maintained and nothing compared it
// against the registry it claims to cover. So a type could be registered —
// authorable, served by `/api/v1/meta/types/:type`, editable in Studio — and
// simply never be asked "who reads this property?". `datasource` was in that
// state for its whole life: #4410, #4465 and #4481 found SIX inert keys on it
// BY HAND, two of them security-shaped (`schemaMode` left an external database
// constructible as `managed`, DDL ungated at the driver; `ssl` configured
// nothing while looking configured). The gate never had an opinion, because the
// type was not on the list — and a list that governs 15 of 25 registered types
// while reporting itself complete is worse than one that admits the gap.
//
// So the list is now answerable to the registry: every registered type must be
// governed OR appear here with a reason. Registering a type and forgetting the
// ledger fails CI with the entry to write.
//
// This is a RATCHET, not an allowlist to grow. An entry is a debt with an issue
// number and the direction of travel is out of this map into GOVERNED. Do not
// add one to silence the gate on a type you just registered — that is exactly
// the failure this map exists to make visible, and an entry with no issue is
// indistinguishable from never having looked.
const PENDING_GOVERNANCE: Record<string, string> = {
  // EMPTY since #4488 paid off all nine debts the map opened with (app, book,
  // doc, email_template, job, mapping, seed, translation, validation) — every
  // registered type is governed. The map stays because the ratchet is the
  // point, not the entries: registering a NEW type without a ledger fails CI
  // with instructions to either govern it or record the debt here (reason +
  // issue number). Do not add an entry just to silence the gate.
};

// Spec-only override: governed types whose canonical schema is NOT (yet) in the
// metadata-type registry, so they can't be resolved via getMetadataTypeSchema.
// The ledger still governs them — being off the registry is exactly why a drift
// can survive: neither the runtime /meta/types endpoint nor Studio's admin forms
// touch these, so nothing else notices when the spec surface goes stale.
//
// `webhook` is deliberately NOT registered: registering it would turn on Studio
// webhook CRUD + saveMetaItem overlay acceptance + diagnostics sweeping. The
// WebhookSchema authoring surface was disconnected from the sys_webhook
// dispatcher when this override landed (#3461/#3462); the materializer bridge
// has since closed that (#3489, and the mapped props are now `live` in
// webhook.json), and whether to fold `webhook` back onto the metadata-type
// registry is the reassessment tracked in #3490. The gate only needs to WALK
// the schema, not register it — so we resolve it directly.
//
// `query` is not a metadata type at all — `QueryAST` is the REQUEST surface:
// the client SDK QueryBuilder's output and the `POST /data/:object/query`
// body, authorable by every API caller yet never stored as stack metadata.
// #4286 found 12 declared members no executor ran, and the reason no gate had
// noticed: this ledger read only the metadata-type registry, so it governed
// what authors write into metadata files while nothing governed what callers
// write into a query. Walking `QuerySchema` here closes that class;
// `query.json` carries the request-surface verdicts.
//
// `validation` stopped being a metadata type in #4509 (ADR-0088 retirement):
// a standalone rule had no object-binding key, so an item authored as its own
// artifact bound to nothing and intercepted no write. The RULE VOCABULARY is
// entirely live — the engine evaluates `object.validations[]` on every insert
// and update — so the ledger must keep governing `ValidationRuleSchema`; it is
// the kind, not the schema, that went away. Governing it here is what stops the
// retirement from quietly un-governing a live surface.
//
// `qa` is not a metadata type either — `TestSuiteSchema` is the FILE surface of
// the shipped `os test` command: an author writes `qa/*.test.json`, the CLI
// loads it, and `TestRunner`/`HttpTestAdapter` execute it. #6247 filed it as
// declared-but-inert on a grep that scanned only `*Schema` identifiers; the
// consumers read the TYPE names (`QA.TestSuite`, `QA.TestStep`, `QA.TestAction`),
// so the grep missed an entire execution chain and the 2026-08-07 retire ruling
// was withdrawn on 2026-08-08 in favour of enforce. Governing it here is the
// half of that ruling that keeps the surface honest going forward: the runner
// reads a real, measured subset of the declared keys, and the ones nothing reads
// (`suite.name`, `scenario.tags`, `scenario.requires`) are now recorded as such
// instead of being invisible. Like `query`, there is no registry to fold it back
// onto — the override IS its governance.
const SPEC_ONLY_SCHEMAS: Record<string, unknown> = {
  webhook: WebhookSchema,
  query: QuerySchema,
  validation: ValidationRuleSchema,
  qa: TestSuiteSchema,
};

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
  if (def.type === 'pipe') {
    // Two pipes, opposite authorable sides. `a.pipe(b)` authors against the IN
    // side (a is the accepted input shape). `z.preprocess(fn, schema)` also
    // compiles to a pipe, but its IN side is the preprocess TRANSFORM — the
    // authorable surface is the OUT schema. Until #4488 this branch always took
    // `def.in`, so a preprocess-wrapped registration (TranslationItemSchema's
    // retired-dialect guard, #3778) unwrapped to the transform, walked to no
    // shape, and made `translation` ungovernable.
    const inDef = defOf(unwrap(def.in, depth + 1));
    if (inDef?.type === 'transform') return unwrap(def.out, depth + 1);
    return unwrap(def.in ?? def.out, depth + 1);
  }
  return s;
}
function shapeOf(s: any): Record<string, any> | null {
  const u = unwrap(s);
  const def = defOf(u);
  if (def?.type === 'object') return def.shape ?? u.shape ?? null;
  // #3095 — a metadata type may register a UNION of shapes rather than a single
  // object (e.g. `view`: defineView container | ViewItem record | flattened
  // personalization overlay). The liveness ledger governs the canonical
  // authorable **container**, which is the first object-typed member of the
  // union. Discriminated-union members (ViewItem) are skipped — their inner
  // `config` is the same ListView/FormView surface already governed under the
  // container's `list` / `form` children — so this walks the container shape.
  if (def?.type === 'union' && Array.isArray(def.options)) {
    for (const opt of def.options) {
      const uo = unwrap(opt);
      const od = defOf(uo);
      if (od?.type === 'object') return od.shape ?? uo.shape ?? null;
    }
  }
  return null;
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
  const schema = SPEC_ONLY_SCHEMAS[type] ?? getMetadataTypeSchema(type);
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
  orphanEntries: [] as string[], // a ledger row whose property is gone from the schema (the reverse direction)
  ungoverned: [] as string[], // a REGISTERED metadata type absent from both GOVERNED and PENDING_GOVERNANCE
  stalePending: [] as string[], // a PENDING_GOVERNANCE row for a type that is now governed / no longer registered
  undrilledNew: [] as string[], // a container riding on inheritance that the baseline does not record (see drill.mts)
  undrilledStale: [] as string[], // a baseline row whose container now drills / is no longer a container
  undrilled: [] as Array<{ key: string; childKeys: string[] }>, // the recorded inheritance population — a worklist, not a failure
  undrilledChildKeys: 0, // how many child keys ride on those blanket verdicts
  brokenDeferrals: [] as string[], // a declared deferral whose target is missing, drifted, or double-declared
  deferredContainers: [] as string[], // containers whose subtree IS classified elsewhere — resolved, not believed
  deferredChildKeys: 0, // how many child keys those resolved deferrals actually cover
  readmeMissingRows: [] as string[], // a GOVERNED type with no row in the README state table (#7257)
  readmeOrphanRows: [] as string[], // a README row for a type GOVERNED does not contain
  readmeHeadingErrors: [] as string[], // "N governed types" disagrees with the rows / with GOVERNED
  readmeMalformedRows: [] as string[], // a table line the row parser could not read — never silently skipped
  readmeRowCount: 0, // rows the parser found, printed every run so the number is visible rather than believed
  countsArtifactErrors: [] as string[], // state-counts.md is missing, or its bytes are not what the gate measures (#7377)
  countsRowSetErrors: [] as string[], // the README's row set and the artifact's disagree
  countsHandEdited: [] as string[], // a count column is back in the README — a hand-maintained number in the merge path
  verification: null as VerificationReport | null, // `verifiedAt` ages — the re-verification worklist
  producers: null as ProducerReport | null, // `producer` / `evidenceScope` — the #4837 / #4895 worklists
  producerMissing: [] as string[], // a `producer` pointer into thin air — FAILS, like a rotted `evidence`
  // The three evidence counters, and the distinction between the first two is
  // the whole point: `evidenceLocal` is how many repo-rooted paths `live` entries
  // DECLARE, `evidenceMissing` is how many of those do not exist here. The
  // summary line used to print `evidenceLocal` under the word "resolved", so
  // breaking five pointers left the count at 330 and the run still said
  // "330 resolved" (#5623). Count and word now agree.
  evidenceLocal: 0, // repo-rooted evidence paths attributed to THIS repo — DECLARED, not yet proven
  evidenceMissing: 0, // ...of which this many do not exist here (=== staleEvidence.length) — FAILS the gate
  evidenceForeign: 0, // evidence paths attributed to objectui / cloud — not resolvable here, never failed
};

// Every classified entry, for the `verifiedAt` fold below. Collected during the
// walk so the age report sees exactly the set the gate itself classified.
const verificationEntries: VerificationEntry[] = [];

// The same set, folded for the producer / evidence-scope report below.
const producerEntries: ProducerEntry[] = [];

const proofFs = { existsSync, readFileSync };

function classify(type: string, path: string, status: string, led: any, cat: any) {
  cat.classified++;
  cat.byStatus[status] = (cat.byStatus[status] || 0) + 1;
  report.totals.byStatus[status] = (report.totals.byStatus[status] || 0) + 1;
  // Framework-auto entries (`led === null`) have no ledger row to date-stamp.
  if (led !== null) {
    verificationEntries.push({ key: `${type}/${path}`, status, verifiedAt: led?.verifiedAt });
    producerEntries.push({
      key: `${type}/${path}`,
      status,
      producer: led?.producer,
      evidenceScope: led?.evidenceScope,
    });
  }
  // A `producer` pointer resolves through the SAME resolver as `evidence`: a
  // call-site claim nothing can falsify is the failure mode this field exists to
  // remove, so it must not get a weaker standard than the consumer pointer it
  // completes (#4837).
  if (typeof led?.producer === 'string') {
    const pv = checkEvidence(led.producer, (p) => existsSync(join(repoRoot, p)));
    for (const miss of pv.missing) report.producerMissing.push(`${type}/${path} → ${miss}`);
  }
  if (status === 'live' && led?.evidence) {
    // Extract every repo-rooted path the evidence claims and resolve the ones
    // attributed to THIS repo. Cross-repo pointers (objectui / cloud) are
    // counted, not resolved — see evidence.mts for why the old
    // `split(':')[0]` heuristic reported ~100% false positives.
    const ev = checkEvidence(led.evidence, (p) => existsSync(join(repoRoot, p)));
    report.evidenceForeign += ev.foreign.length;
    report.evidenceLocal += ev.local.length;
    report.evidenceMissing += ev.missing.length;
    for (const miss of ev.missing) report.staleEvidence.push(`${type}/${path} → ${miss}`);
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
  const proofDir = join(repoRoot, 'packages/qa/dogfood/test');
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

// Containers the walk classified with ONE blanket verdict — reconciled against
// the shrink-only baseline after the walk (drill.mts).
const observedContainers: ContainerCoverage[] = [];

for (const type of GOVERNED) {
  const ledger = loadLedger(type);
  const props = ledger.props || {};
  const cat = { classified: 0, unclassified: 0, byStatus: {} as Record<string, number> };
  const walked = topProps(type);

  // ── reverse direction: a row whose property is gone (see orphans.mts) ──
  // Runs off the SAME walk the forward pass classifies against, so the two
  // directions can never disagree about what the schema contains.
  const nodeOf = new Map(walked.map((p) => [p.key, p.node]));
  const orphans: Orphan[] = findOrphanEntries({
    type,
    props,
    shapeKeys: walked.map((p) => p.key),
    childKeysOf: (key) => {
      const cs = childShape(nodeOf.get(key));
      return cs ? Object.keys(cs) : null;
    },
  });
  for (const o of orphans) report.orphanEntries.push(o.key);

  for (const { key, node, description } of walked) {
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
      // One verdict standing in for a whole subtree. Legal, but it must be
      // declared rather than inherited by default — record it for the
      // post-walk reconcile (drill.mts, #4956).
      const cs = childShape(node);
      const childKeys = cs ? Object.keys(cs) : [];
      if (childKeys.length > 0) observedContainers.push({ key: `${type}/${key}`, childKeys });
      classify(type, key, status, led, cat);
    }
  }
  report.types[type] = cat;
}

scanOrphanProofs();

// ── container coverage: is every blanket verdict a DECLARED one? ──
// The gate's third direction (#4956). Schema → ledger catches an undeclared
// property; ledger → schema catches a row that outlived its property; this
// catches a row that silently covers a subtree nobody classified.
const undrilledBaselineFile = join(here, 'undrilled-containers.baseline.json');
const undrilledBaseline = parseUndrilledBaseline(
  JSON.parse(readFileSync(undrilledBaselineFile, 'utf8')),
);

/**
 * Resolve a deferral target to the keys CLASSIFIED there, or `null` if it does
 * not exist. Two forms, both real coordinates rather than prose:
 *   `field`      — a governed type root; its walked top-level keys all carry a
 *                  verdict (the type is governed, so the forward pass proved it).
 *   `view/list`  — a drilled ledger coordinate; its `children` keys are verdicts.
 * Anything else dangles, which is the failure this resolution exists to produce.
 */
function classifiedKeysAt(target: string): readonly string[] | null {
  if (!target.includes('/')) {
    if (!GOVERNED.includes(target)) return null;
    try {
      return topProps(target).map((p) => p.key);
    } catch { return null; }
  }
  const [type, prop] = target.split('/');
  if (!GOVERNED.includes(type)) return null;
  const children = loadLedger(type).props?.[prop]?.children;
  return children ? Object.keys(children) : null;
}

const coverage = reconcileContainerCoverage({
  observed: observedContainers,
  baseline: undrilledBaseline.containers,
  deferred: undrilledBaseline.deferred,
  classifiedKeysAt,
});
report.undrilledNew = coverage.undeclared.map(
  (c) => `${c.key} — one verdict covers ${c.childKeys.length} unclassified child key(s): ${c.childKeys.join(', ')}`,
);
report.undrilledStale = coverage.stale;
report.brokenDeferrals = coverage.brokenDeferrals;
const deferredKeys = new Set(undrilledBaseline.deferred.map((d) => d.container));
report.undrilled = observedContainers
  .filter((c) => !coverage.undeclared.some((u) => u.key === c.key) && !deferredKeys.has(c.key))
  .map((c) => ({ key: c.key, childKeys: [...c.childKeys] }));
report.undrilledChildKeys = coverage.inheritedChildKeys;
report.deferredContainers = undrilledBaseline.deferred.map((d) => `${d.container} → ${d.to}`);
report.deferredChildKeys = coverage.deferredChildKeys;

// ── the README's own index: does the state table cover GOVERNED? ──
// The gate's fourth direction (#7257). The three above ask whether the LEDGERS
// are honest; this asks whether the file that indexes them is. It reads the
// README from the ledger root so the self-test can point it at a mutated copy —
// the same `--ledger-root` trick the evidence guard uses, and for the same
// reason: a gate that fails is worth exactly as much as the proof that it fails,
// and this table is complete on a green tree.
const readmeFile = join(ledgerRoot, 'README.md');
if (!existsSync(readmeFile)) {
  report.readmeHeadingErrors.push(`${readmeFile} does not exist — the ledger index is gone`);
} else {
  const stateTable = parseStateTable(readFileSync(readmeFile, 'utf8'));
  const readme = reconcileReadmeTable({ governed: GOVERNED, table: stateTable });
  report.readmeMissingRows = readme.missingRows;
  report.readmeOrphanRows = readme.orphanRows.concat(
    readme.duplicateRows.map((d) => `${d} — duplicate row`),
  );
  report.readmeHeadingErrors = readme.headingErrors;
  report.readmeMalformedRows = readme.malformed;
  report.readmeRowCount = stateTable.rows.length;

  // ── the count columns, now a generated artifact (#7377) ──
  // Read from `ledgerRoot` for the same reason the table above is: it is what
  // lets the self-test point the REAL gate at a copy with one number skewed and
  // read the exit code. An artifact the gate could only ever find in its own
  // green state is an artifact whose check is unproven.
  const countsFile = join(ledgerRoot, STATE_COUNTS_FILE);
  const counts = reconcileStateCounts({
    table: stateTable,
    rendered: renderStateCounts(
      foldStateCounts(
        GOVERNED,
        Object.fromEntries(Object.entries<any>(report.types).map(([t, v]) => [t, v.byStatus])),
      ),
    ),
    onDisk: existsSync(countsFile) ? readFileSync(countsFile, 'utf8') : null,
  });
  report.countsArtifactErrors = counts.artifactErrors;
  report.countsRowSetErrors = counts.rowSetErrors;
  report.countsHandEdited = counts.handCountErrors;
}

// ── verifiedAt: how old is each claim? ──
// Age never fails the gate — re-verification is a worklist, not a merge gate.
// A MALFORMED value does fail: it silently disables the staleness check for
// that entry, the exact silent-no-op shape this ledger exists to catch.
const staleDaysArg = args.find((a) => a.startsWith('--stale-verification'));
const staleDays = Number(staleDaysArg?.split('=')[1]) || DEFAULT_STALE_DAYS;
const showWorklist = staleDaysArg !== undefined;
const showUndrilled = args.includes('--undrilled');
report.verification = buildVerificationReport(verificationEntries, { staleDays });

// ── producer-side evidence + verification scope (#4837 / #4895) ──
// Same asymmetry as the clock above: an ABSENT field is a worklist row (the
// ledger predates both fields, and back-filling guesses is exactly the sin these
// record), a MALFORMED one fails.
const showProducerGap = args.includes('--producer-gap');
report.producers = buildProducerReport(producerEntries);

// ── coverage: is every REGISTERED metadata type accounted for? ──
// The gate's own blind spot until #4487. Everything above asks "is every
// property of a governed type classified?" — nothing asked "is every authorable
// type governed?", so a type absent from GOVERNED was never in the denominator
// and its silence read as success.
const governedSet = new Set(GOVERNED);
report.ungoverned = listMetadataTypeSchemaTypes()
  .filter((t) => !governedSet.has(t) && !(t in PENDING_GOVERNANCE))
  .sort();
// A PENDING_GOVERNANCE row for a type that is now governed (or no longer
// registered) is the same rot as an orphan ledger row: it claims a debt that
// does not exist, and it makes the map's length a lie about how much is left.
report.stalePending = Object.keys(PENDING_GOVERNANCE)
  .filter((t) => governedSet.has(t) || !listMetadataTypeSchemaTypes().includes(t))
  .sort();

const totalUnclassified = report.unclassified.length;
const totalProofFailures = report.proofErrors.length + report.proofMissing.length;
const failed =
  totalUnclassified > 0 ||
  totalProofFailures > 0 ||
  // A `live` entry whose repo-local evidence path is gone. Red since #5623 — the
  // ⚠ it replaces was calibrated for the false-positive era, not for the parser
  // that now resolves 330 paths and reports zero. Cross-repo attribution never
  // reaches this list: checkEvidence only resolves the LOCAL bucket.
  report.staleEvidence.length > 0 ||
  report.orphanEntries.length > 0 ||
  report.verification.errors.length > 0 ||
  report.producers.errors.length > 0 ||
  report.producerMissing.length > 0 ||
  report.ungoverned.length > 0 ||
  report.stalePending.length > 0 ||
  report.undrilledNew.length > 0 ||
  report.undrilledStale.length > 0 ||
  report.brokenDeferrals.length > 0 ||
  report.readmeMissingRows.length > 0 ||
  report.readmeOrphanRows.length > 0 ||
  report.readmeHeadingErrors.length > 0 ||
  report.readmeMalformedRows.length > 0 ||
  report.countsArtifactErrors.length > 0 ||
  report.countsRowSetErrors.length > 0 ||
  report.countsHandEdited.length > 0;
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
  // Two numbers, because one cannot carry both facts. "Declared" is the
  // extraction-health signal (#3857's unit test guards it against degrading to
  // "extracts nothing"); "resolved" is the verdict. They are equal on a green
  // run, which is exactly why printing only the first read as a pass.
  console.log(
    `\nevidence paths: ${report.evidenceLocal} repo-local path(s) declared by 'live' entries, ` +
    `${report.evidenceLocal - report.evidenceMissing} resolved against this checkout` +
    (report.evidenceMissing ? `, ${report.evidenceMissing} MISSING` : '') +
    `; ${report.evidenceForeign} attributed to another repo (objectui / cloud — not resolvable here).`,
  );
  if (report.staleEvidence.length) {
    console.log(`\n✗ ${report.staleEvidence.length} 'live' entr(ies) cite a file that is missing from THIS repo:`);
    report.staleEvidence.forEach((s: string) => console.log(`    ${s}`));
    console.log(
      '\n   A `live` verdict IS its evidence pointer — "this property has a runtime consumer,\n' +
      '   here it is". When the cited file is gone from this checkout the claim is no longer\n' +
      '   falsifiable: declared, but nothing enforces that anything still reads the property,\n' +
      '   and a directory move or a rename is the whole cost of getting there.\n\n' +
      '   Three repairs, and picking the right one is the work:\n' +
      '     • the consumer MOVED inside this repo → repoint the path, and stamp `verifiedAt`\n' +
      '       while you have the call graph open;\n' +
      '     • the consumer moved to ANOTHER repo → say so with a realm marker\n' +
      '       (`objectui: packages/app-shell/…`, `cloud: …`). Attributed paths are counted,\n' +
      '       never resolved, and never fail here — that boundary is deliberate;\n' +
      '     • the consumer is GONE → the verdict is not `live` any more. Re-classify under\n' +
      '       ADR-0049 enforce-or-remove instead of repointing at a plausible survivor.\n\n' +
      '   This was a ⚠ until #5623 for one reason: the pre-#3857 parser took\n' +
      '   `evidence.split(":")[0]` as the filename, flagged 48 of 227 entries and every one\n' +
      '   was a false positive — so it could not fail the build, and the one real rot it was\n' +
      '   burying (`object.enable.clone`, whose consumer had moved packages) sat unread.\n' +
      '   evidence.mts fixed the parse; the list has been empty since, which is what makes\n' +
      '   a hit worth stopping for.',
    );
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
  if (report.ungoverned.length) {
    console.log(`\n✗ ${report.ungoverned.length} REGISTERED metadata type(s) governed by nothing:`);
    report.ungoverned.forEach((t: string) => console.log(`    ${t}`));
    console.log(
      '\n   These are authorable — `/api/v1/meta/types/:type` serves them and Studio edits\n' +
      '   them — but no ledger asks who reads their properties, so an inert key on one is\n' +
      '   invisible to CI. `datasource` sat here for its whole life and cost six inert keys\n' +
      '   found by hand, two of them security-shaped (#4410, #4465, #4481).\n\n' +
      '   Either govern the type (add it to GOVERNED and seed packages/spec/liveness/<type>.json\n' +
      '   — see the seeding aid: `tsx check-liveness.mts --dump <type>`), or record the debt in\n' +
      "   PENDING_GOVERNANCE with a reason AND an issue number. Do not pick the second option\n" +
      '   just to get green: an entry with no issue behind it is indistinguishable from never\n' +
      '   having looked, which is the state this gate exists to end.',
    );
  }
  if (report.stalePending.length) {
    console.log(`\n✗ ${report.stalePending.length} stale PENDING_GOVERNANCE row(s) — the debt is already paid:`);
    report.stalePending.forEach((t: string) => console.log(`    ${t}`));
    console.log(
      '\n   The type is now governed (or no longer registered), so the row claims a debt that\n' +
      '   no longer exists and overstates how much coverage work is left. Delete it — same\n' +
      '   rot as an orphan ledger row, opposite direction.',
    );
  }
  if (report.orphanEntries.length) {
    console.log(`\n✗ ${report.orphanEntries.length} ORPHAN ledger row(s) — the property is gone from the schema:`);
    report.orphanEntries.forEach((s: string) => console.log(`    ${s}`));
    console.log('');
    ORPHAN_GUIDANCE.forEach((line) => console.log(line ? `   ${line}` : ''));
  }
  if (report.undrilledNew.length) {
    console.log(`\n✗ ${report.undrilledNew.length} UNDECLARED container inheritance — a blanket verdict covers keys nothing classified:`);
    report.undrilledNew.forEach((s: string) => console.log(`    ${s}`));
    console.log('');
    UNDRILLED_GUIDANCE.forEach((line) => console.log(line ? `   ${line}` : ''));
  }
  if (report.undrilledStale.length) {
    console.log(`\n✗ ${report.undrilledStale.length} stale undrilled-container row(s) — the gap is already closed:`);
    report.undrilledStale.forEach((s: string) => console.log(`    ${s}`));
    console.log('');
    STALE_UNDRILLED_GUIDANCE.forEach((line) => console.log(line ? `   ${line}` : ''));
  }
  if (report.brokenDeferrals.length) {
    console.log(`\n✗ ${report.brokenDeferrals.length} broken deferral(s) — a "classified elsewhere" claim that does not resolve:`);
    report.brokenDeferrals.forEach((s: string) => console.log(`    ${s}`));
    console.log(
      '\n   This is the #4956 claim itself, caught. A deferral is only allowed because\n' +
      '   the gate RESOLVES it: the target must exist (a governed type, or a drilled\n' +
      '   `type/prop` coordinate) and classify exactly this container\'s child keys.\n' +
      '   Point it at the real coordinate, drill the container, or move it to the\n' +
      '   `containers` list and admit the keys are classified nowhere.',
    );
  }
  if (report.readmeMissingRows.length) {
    console.log(
      `\n✗ ${report.readmeMissingRows.length} governed type(s) with NO row in the README's ` +
      '"Current state" table — the index fell behind its own registry:',
    );
    report.readmeMissingRows.forEach((t: string) => console.log(`    ${t}`));
    console.log('');
    README_TABLE_GUIDANCE.forEach((line) => console.log(line ? `   ${line}` : ''));
  }
  if (report.readmeOrphanRows.length) {
    console.log(`\n✗ ${report.readmeOrphanRows.length} README state-table row(s) that GOVERNED does not back:`);
    report.readmeOrphanRows.forEach((t: string) => console.log(`    ${t}`));
    console.log('');
    README_ORPHAN_ROW_GUIDANCE.forEach((line) => console.log(line ? `   ${line}` : ''));
  }
  if (report.readmeHeadingErrors.length) {
    console.log(`\n✗ ${report.readmeHeadingErrors.length} README state-table heading error(s):`);
    report.readmeHeadingErrors.forEach((s: string) => console.log(`    ${s}`));
    console.log(
      '\n   "N governed types (complete registry coverage)" is a completeness CLAIM, and\n' +
      '   until #7257 nothing could falsify it: N was the count of rows, not of governed\n' +
      '   types, so the two agreed only by coincidence — until `api` and `capability` were\n' +
      '   governed with no row and the sentence stayed true-looking. Fix the number and the\n' +
      '   rows together; they are checked against each other AND against GOVERNED.',
    );
  }
  if (report.readmeMalformedRows.length) {
    console.log(
      `\n✗ ${report.readmeMalformedRows.length} unreadable line(s) in the README state table —` +
      ' a row this parser cannot see is a row it cannot govern:',
    );
    report.readmeMalformedRows.forEach((s: string) => console.log(`    ${s}`));
  }
  if (report.countsArtifactErrors.length) {
    console.log(`\n✗ the generated count artifact is not current:`);
    report.countsArtifactErrors.forEach((s: string) => console.log(`    ${s}`));
    console.log('');
    STATE_COUNTS_GUIDANCE.forEach((line) => console.log(line ? `   ${line}` : ''));
  }
  if (report.countsRowSetErrors.length) {
    console.log(
      `\n✗ ${report.countsRowSetErrors.length} row(s) where README.md and ${STATE_COUNTS_FILE} disagree:`,
    );
    report.countsRowSetErrors.forEach((s: string) => console.log(`    ${s}`));
    console.log(
      '\n   The prose and the numbers are two halves of one table (#7377). A type with\n' +
      '   counts and no Note publishes a measurement nobody explained; a Note with no\n' +
      '   counts publishes an explanation of nothing. Both halves, or neither.',
    );
  }
  if (report.countsHandEdited.length) {
    console.log(
      `\n✗ ${report.countsHandEdited.length} README state-table row(s) carrying a COUNT COLUMN — ` +
      'the numbers are generated:',
    );
    report.countsHandEdited.forEach((s: string) => console.log(`    ${s}`));
    console.log(
      `\n   The count columns moved to ${STATE_COUNTS_PATH} at #7377, on #5107's\n` +
      '   precedent: a hand-maintained number is a number in the merge path, and these\n' +
      '   merge clean and WRONG — two PRs each move a different row by their own correct\n' +
      '   delta, the rows do not overlap, and git composes a table nobody wrote. A column\n' +
      '   re-added here would be invisible to the freshness check above, so the table\n' +
      '   would publish two sets of numbers with only one of them enforced. Delete the\n' +
      '   cell; the Notes prose is what this table is for.',
    );
  }
  // ── re-verification clock ──
  // Annotated at the boundary: `report` is deliberately `any` (see its
  // declaration), so without this every `v.*` below is `any` too — which is how
  // the `stale` worklist ended up iterated with an implicitly-any element while
  // its neighbours carried hand-written `: string` annotations (#5475). Naming
  // the producer's own type once types all four reads, and a shape change in
  // verification.mts now lands here instead of passing through.
  const v: VerificationReport = report.verification!;
  if (v.errors.length) {
    console.log(`\n✗ ${v.errors.length} malformed \`verifiedAt\` value(s) — a bad date silently disables the staleness check:`);
    v.errors.forEach((s) => console.log(`    ${s}`));
  }
  const dated = v.fresh + v.stale.length;
  console.log(
    `\nre-verification clock: ${dated} entr(ies) carry \`verifiedAt\` (${v.stale.length} older than ${staleDays}d), ` +
    `${v.unverified.length} undated.`,
  );
  if (showWorklist) {
    if (v.stale.length) {
      console.log(`\n  stale (verified > ${staleDays}d ago) — re-verify oldest first:`);
      v.stale.forEach((s) => console.log(`    ${s.key.padEnd(40)} ${s.verifiedAt} (${s.ageDays}d)`));
    }
    if (v.unverified.length) {
      console.log(`\n  never dated (${v.unverified.length}) — predate the field; date them as you re-verify:`);
      v.unverified.forEach((k) => console.log(`    ${k}`));
    }
  } else if (v.stale.length || v.unverified.length) {
    console.log('  run with --stale-verification[=days] for the worklist.');
  }

  // ── producer-side evidence + verification scope ──
  const pr: ProducerReport = report.producers!;
  if (pr.errors.length) {
    console.log(`\n✗ ${pr.errors.length} malformed \`producer\` / \`evidenceScope\` value(s):`);
    pr.errors.forEach((s: string) => console.log(`    ${s}`));
  }
  if (report.producerMissing.length) {
    console.log(
      `\n✗ ${report.producerMissing.length} \`producer\` pointer(s) that do not resolve — a call-site claim`
      + ` nothing can falsify is what this field exists to remove:`,
    );
    report.producerMissing.forEach((s: string) => console.log(`    ${s}`));
  }
  const scopes = Object.entries(pr.byScope).map(([s, n]) => `${n} ${s}`).join(', ') || 'none';
  console.log(
    `\nevidence quality: ${pr.withProducer} live entr(ies) cite a PRODUCER (${pr.withoutProducer.length} do not); `
    + `verification scope declared on ${scopes} (${pr.unscoped} undeclared).`,
  );
  if (showProducerGap) {
    if (pr.withoutProducer.length) {
      console.log(
        `\n  live without producer-side evidence (${pr.withoutProducer.length}) — a consumer pointer is half`
        + ` the call graph; the half that killed \`Seed.env\` is the other one:`,
      );
      pr.withoutProducer.forEach((k: string) => console.log(`    ${k}`));
    }
  } else if (pr.withoutProducer.length) {
    console.log('  run with --producer-gap for the producer-evidence worklist.');
  }
  // ── container coverage: how much rides on inheritance? ──
  // Printed every run, pass or fail. The gate used to say "all properties are
  // classified" while hundreds of child keys had never been asked about; a
  // count nobody can see is the same silence that produced #4956.
  console.log(
    `\ncontainer coverage: ${report.undrilled.length} container entr(ies) carry a blanket verdict over ` +
    `${report.undrilledChildKeys} child key(s) that are classified NOWHERE; ` +
    `${report.deferredContainers.length} more defer ${report.deferredChildKeys} key(s) to a coordinate that ` +
    'DOES classify them (resolved, not asserted). Both recorded in ' +
    'scripts/liveness/undrilled-containers.baseline.json — shrink-only.',
  );
  if (showUndrilled) {
    console.log('\n  resolved deferrals (classified, just not here):');
    report.deferredContainers.forEach((s: string) => console.log(`    ${s}`));
    console.log('\n  undrilled worklist — classified nowhere; drill the divergent ones first:');
    report.undrilled.forEach((c: { key: string; childKeys: string[] }) =>
      console.log(`    ${c.key.padEnd(34)} ${c.childKeys.length} key(s): ${c.childKeys.join(', ')}`));
  } else if (report.undrilled.length) {
    console.log('  run with --undrilled for the worklist.');
  }
  const pendingCount = Object.keys(PENDING_GOVERNANCE).length;
  if (pendingCount) {
    console.log(
      `\ncoverage: ${GOVERNED.length} type(s) governed, ${pendingCount} registered type(s) awaiting a ledger ` +
      `(${Object.keys(PENDING_GOVERNANCE).sort().join(', ')}) — a worklist, not a merge gate.`,
    );
  }
  if (!failed) {
    // Deliberately qualified. The old wording — "all governed-type properties
    // are classified" — was the instrument's own false claim: it counted a
    // blanket container verdict as one classified property and said nothing
    // about the keys underneath, which is exactly how #4956 stayed invisible.
    console.log(
      '\n✓ every governed-type property at the walk\'s one-level granularity is classified, every ' +
      'registered type is governed or explicitly pending, no ledger row outlives its property, ' +
      'every container inheritance is declared, every `live` entry\'s repo-local evidence path ' +
      'resolves, all bound high-risk proofs resolve, and the README state table carries a row ' +
      `for each of the ${report.readmeRowCount} governed type(s) it claims to index.`,
    );
    console.log(
      `✓ ${STATE_COUNTS_PATH} is current — the same ${report.readmeRowCount} row(s), ` +
      'no count column left in the README.',
    );
    if (report.undrilledChildKeys) {
      console.log(
        `  (not a completeness claim about the ${report.undrilledChildKeys} child key(s) under the ` +
        'declared blanket verdicts above — those are recorded, not classified.)',
      );
    }
  }
}
process.exit(failed ? 1 : 0);
