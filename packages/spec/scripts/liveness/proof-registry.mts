// ADR-0054 — the prove-it-runs registry.
//
// ADR-0049 closed *false compliance* (a property declared but unenforced). The
// liveness ledger (#1919) then made every authorable property declare a status
// with evidence. But "live" means only "a consumer reads it" — a static pointer.
// ADR-0054 adds the third leg: for a defined class of HIGH-RISK authorable
// properties, a `live` classification must carry a **proof** — a reference to a
// `@objectstack/dogfood` test that authors the property against the real
// in-process stack and asserts the runtime outcome.
//
// This module is the single source of truth for:
//   1. the authoritative high-risk-class list (ADR-0054 §2a), and
//   2. which ledger entries are CI-ENFORCED to carry a proof this rollout phase
//      (the ratchet lands one class at a time as its matrix is populated — §3).
//
// It is split out from check-liveness.mts so the proof contract is unit-testable
// without booting the metadata-type registry.

/** A reference to a dogfood proof: `<repo-relative-file>#<proof-id>`. */
export type ProofRef = string;

/** A ledger entry path the ratchet binds: `<type>.<path>` (one drill level). */
export interface LedgerBinding {
  type: string; // governed metadata type (e.g. 'field')
  path: string; // property path within that type (e.g. 'type', 'rowLevelSecurity.using')
}

export interface HighRiskClass {
  /** Stable class id (ADR-0054 §2a class). */
  id: string;
  /** Human label. */
  label: string;
  /** The end-to-end break this class guards — why a static consumer pointer is insufficient. */
  summary: string;
  /** Canonical `@proof:` tag id the dogfood test self-declares. */
  proofId: string;
  /** The proof reference (`file#id`), or null when the class has no runtime proof yet. */
  proofRef: ProofRef | null;
  /**
   * Whether the ratchet is CI-ENFORCED for this class THIS phase. ADR-0054 §3:
   * "CI binding lands incrementally … one class at a time as its matrix is
   * populated." A class is `bound` only once it has BOTH a runtime proof AND a
   * governed ledger entry to carry it.
   */
  bound: boolean;
  /** Ledger entries that must carry `proofRef` when their status is `live`. */
  ledgerBindings: LedgerBinding[];
  /** When `bound` is false, why — kept honest rather than faking a binding. */
  blockedReason?: string;
}

// The authoritative high-risk-class list (ADR-0054 §2a). Classes whose values
// cross the engine↔driver↔service↔HTTP boundary and have repeatedly broken in
// *integration* despite green unit tests. Two are bound this phase (their matrix
// exists AND their surface is governed); three are listed-but-blocked, honestly.
export const HIGH_RISK_CLASSES: HighRiskClass[] = [
  {
    id: 'field-type',
    label: 'Field types',
    summary:
      'persistence + read-coercion fidelity across the field-type matrix (write 4 → read 4, not "4").',
    proofId: 'field-type-roundtrip',
    proofRef: 'packages/dogfood/test/field-zoo-roundtrip.dogfood.test.ts#field-type-roundtrip',
    bound: true,
    ledgerBindings: [{ type: 'field', path: 'type' }],
  },
  {
    id: 'rls-sharing',
    label: 'RLS / sharing',
    summary:
      "row-level read AND by-id-write enforcement (the #1994 can't-write-what-you-can't-read invariant).",
    proofId: 'rls-by-id-write',
    proofRef: 'packages/dogfood/test/rls-fixture.dogfood.test.ts#rls-by-id-write',
    bound: true,
    // `using` is the read predicate the #1994 fix re-applies as a by-id-write
    // pre-image check — the property whose end-to-end correctness the proof guards.
    ledgerBindings: [{ type: 'permission', path: 'rowLevelSecurity.using' }],
  },
  {
    id: 'analytics',
    label: 'Analytics dimensions / measures',
    summary: 'date-dimension bucketing / aggregation under the org timezone (#1982/#2018).',
    proofId: 'analytics-tz-bucketing',
    proofRef: 'packages/dogfood/test/analytics-timezone.dogfood.test.ts#analytics-tz-bucketing',
    bound: true,
    // The org-timezone shift acts on a time dimension's bucketing granularity —
    // the property whose end-to-end correctness the tz proof guards.
    ledgerBindings: [{ type: 'dataset', path: 'dimensions.dateGranularity' }],
  },
  {
    id: 'flow-node',
    label: 'Flow nodes',
    summary: 'node execution + variable wiring through the automation engine.',
    proofId: 'flow-node-execution',
    proofRef: 'packages/dogfood/test/flow-node.dogfood.test.ts#flow-node-execution',
    bound: true,
    // `nodes.type` selects which executor runs — the property whose end-to-end
    // execution + variable wiring the proof guards.
    ledgerBindings: [{ type: 'flow', path: 'nodes.type' }],
  },
  {
    id: 'form-widget',
    label: 'Form layout / section / widget',
    summary: 'server-side form resolution.',
    proofId: 'form-widget-resolution',
    proofRef: null,
    bound: false,
    ledgerBindings: [],
    blockedReason:
      'the form layout/section/widget surface is not yet governed and has no runtime proof (ADR-0054 Phase 2).',
  },
];

/** Bound ledger paths → the class that binds them. Key: `<type>/<path>`. */
export const BOUND_PROOF_PATHS: Map<string, HighRiskClass> = (() => {
  const m = new Map<string, HighRiskClass>();
  for (const cls of HIGH_RISK_CLASSES) {
    if (!cls.bound) continue;
    for (const b of cls.ledgerBindings) m.set(`${b.type}/${b.path}`, cls);
  }
  return m;
})();

/** Every proof id the registry knows about (bound + pending) — used to flag orphan tags. */
export const KNOWN_PROOF_IDS: Set<string> = new Set(HIGH_RISK_CLASSES.map((c) => c.proofId));

/** Parse a proof reference into its file + id parts, or null if malformed. */
export function parseProofRef(ref: unknown): { file: string; id: string } | null {
  if (typeof ref !== 'string') return null;
  const hash = ref.indexOf('#');
  if (hash <= 0 || hash >= ref.length - 1) return null;
  const file = ref.slice(0, hash).trim();
  const id = ref.slice(hash + 1).trim();
  if (!file || !id) return null;
  return { file, id };
}

// A proof tag a dogfood test self-declares, e.g. `// @proof: field-type-roundtrip`.
// Greppable + stable across test-title churn (field-zoo titles are generated in a
// loop), which is why we match a tag rather than a test name.
const PROOF_TAG_RE = /@proof:\s*([a-z0-9][a-z0-9-]*)/g;

/** Collect all `@proof:` tag ids declared in a file's text. */
export function extractProofTags(content: string): Set<string> {
  const out = new Set<string>();
  for (const m of content.matchAll(PROOF_TAG_RE)) out.add(m[1]);
  return out;
}

/** Minimal fs surface so validation is unit-testable without touching disk. */
export interface ProofFs {
  existsSync(path: string): boolean;
  readFileSync(path: string, enc: 'utf8'): string;
}

export interface ProofValidation {
  ok: boolean;
  error?: string;
}

/**
 * Validate that a proof reference resolves to a real, named proof: the file
 * exists AND declares the `@proof: <id>` tag. STATIC ONLY — it never runs the
 * test (that is the dogfood gate's job); the liveness gate stays seconds-cheap.
 */
export function validateProofRef(
  ref: unknown,
  opts: { repoRoot: string; fs: ProofFs; join: (...parts: string[]) => string },
): ProofValidation {
  const parsed = parseProofRef(ref);
  if (!parsed) return { ok: false, error: `malformed proof ref (expected "<file>#<proof-id>"): ${String(ref)}` };
  const abs = opts.join(opts.repoRoot, parsed.file);
  if (!opts.fs.existsSync(abs)) return { ok: false, error: `proof file not found: ${parsed.file}` };
  const content = opts.fs.readFileSync(abs, 'utf8');
  if (!extractProofTags(content).has(parsed.id)) {
    return { ok: false, error: `proof tag "@proof: ${parsed.id}" not found in ${parsed.file}` };
  }
  return { ok: true };
}
