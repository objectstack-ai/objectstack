// #3896 follow-up — the empty-state gate.
//
// Scans the authorable spec surface (`packages/spec/src/**/*.zod.ts`) for
// statements that declare a property's empty/absent state to be PERMISSIVE
// ("empty = all", "absent = default-allow", "leave empty to …"), and requires
// every one of them to be classified in `empty-state-registry.mts`.
//
// Why prose and not a name heuristic: the hazard is not a naming convention, it
// is the SENTENCE. `sys_sharing_rule.criteria_json` said "leave empty to share
// every record" — and for a platform whose premise is that agents author
// metadata, a field description is not documentation *about* the contract, it IS
// the contract the next author reads. Matching the dangerous statement is exact;
// matching field names would be a guess, and the liveness ledger's README is
// blunt about where that ends up: "a permanently-noisy check is a check nobody
// reads."
//
// Pure by construction — every entry point takes its inputs, so the unit tests
// never touch the filesystem.

import type { EmptyStateEntry } from './empty-state-registry.mts';

/** A permissive-empty statement found in the spec surface. */
export interface PermissiveEmptyHit {
  /** Repo-relative file path. */
  file: string;
  /** 1-indexed line of the statement. */
  line: number;
  /** The matched line, trimmed — quoted back in findings so the author sees what tripped. */
  text: string;
  /** The property the statement describes, or null when it could not be resolved. */
  property: string | null;
}

export type FindingKind =
  | 'unregistered'
  | 'unresolved'
  | 'stale'
  | 'missing-rationale'
  | 'missing-evidence'
  | 'rotted-evidence';

export interface EmptyStateFinding {
  kind: FindingKind;
  file: string;
  line?: number;
  property?: string;
  message: string;
}

// ---- Detection ----------------------------------------------------------

// "empty-ish" — the states an author reaches by NOT writing something.
const EMPTY_TOKENS = ['empty', 'absent', 'unset', 'omitted', 'undefined', 'null', 'missing', 'blank'];

// "permissive-ish" — the meanings that make omission dangerous.
const PERMISSIVE_TOKENS = [
  'all',
  'any',
  'every',
  'everything',
  'everyone',
  'unrestricted',
  'allowed',
  'default-allow',
  'default-open',
  'match-all',
  'no restriction',
  'no limit',
];

// `<empty-ish> <=|means|→> [up to 3 filler words] <permissive-ish>`.
//
// The filler window catches "empty = catch all errors" without opening the
// pattern up to whole sentences. Deliberately NOT anchored on `.describe(` —
// a JSDoc line above the property is just as load-bearing as the describe text.
//
// `:` is deliberately NOT a separator. It reads as one in prose ("absent: all"),
// but in a schema file every property declaration is `name:` and every object
// literal is `key:`, so admitting it turned ordinary code into matches.
const PERMISSIVE_EMPTY_RE = new RegExp(
  String.raw`\b(${EMPTY_TOKENS.join('|')})\b[^.;!?\n]{0,24}?` +
    String.raw`(?:=|==|→|->|⇒|\bmeans\b|\bimplies\b)\s*` +
    String.raw`(?:\W*\b\w+\b){0,3}?\W*\b(${PERMISSIVE_TOKENS.join('|')})\b`,
  'i',
);

// The imperative form, which names no state at all: "leave empty to share every
// record" — the exact sentence #3896 shipped.
//
// It must carry a permissive CONSEQUENCE. A bare "leave it unset" is an ordinary
// deprecation instruction (`metadata-persistence.environmentId`), not a claim
// about what emptiness grants, and matching it produced pure noise.
const LEAVE_EMPTY_RE = new RegExp(
  String.raw`\bleave\s+(?:it\s+|them\s+|this\s+)?(?:empty|blank|unset)\b` +
    String.raw`[^.;!?\n]{0,24}?\bto\b[^.;!?\n]{0,32}?\b(?:${PERMISSIVE_TOKENS.join('|')})\b`,
  'i',
);

// `all` is the workhorse permissive token and also the tail of `deny-all` — so
// the ⚠ that object.zod.ts prints precisely to warn that an empty whitelist is
// DENY-ALL matched as if it were permissive. A negated match is the OPPOSITE of
// the hazard; dropping it is not a tolerance, it is a correction.
const NEGATED_BEFORE_RE = /(?:deny|denies|no|not|never|zero|none)[-\s]*$/i;

// A match only counts as PROSE. `const empty = {}` is code and must not trip the
// gate, so the match has to sit after a comment marker or inside a string.
const PROSE_PREFIX_RE = /(\/\/|\/\*|\*|['"`])/;

/** True when the match at `index` is inside a comment or a string literal, not bare code. */
function isProse(line: string, index: number): boolean {
  return PROSE_PREFIX_RE.test(line.slice(0, index));
}

const PROP_RE = /^\s*([A-Za-z_$][\w$]*)\s*:/;
const DOC_LINE_RE = /^\s*(\/\*|\*|\/\/)/;

/** How far from the statement to look for the property it describes. */
const MAX_PROPERTY_DISTANCE = 8;

/**
 * Resolve which property a statement belongs to.
 *
 * Direction matters and gets this wrong if you pick one: a JSDoc block sits
 * ABOVE its property, while a `.describe(...)` argument sits BELOW it. Searching
 * forward only mis-attributed `explain.zod.ts`'s effective-predicate describe to
 * the *next* property down the file.
 */
export function resolveProperty(lines: string[], matchLine: number): string | null {
  const own = lines[matchLine]?.match(PROP_RE);
  if (own) return own[1];

  const isDoc = DOC_LINE_RE.test(lines[matchLine] ?? '');
  const forward = () => {
    for (let i = matchLine + 1; i <= matchLine + MAX_PROPERTY_DISTANCE && i < lines.length; i++) {
      const m = lines[i]?.match(PROP_RE);
      if (m) return m[1];
    }
    return null;
  };
  const backward = () => {
    for (let i = matchLine - 1; i >= matchLine - MAX_PROPERTY_DISTANCE && i >= 0; i--) {
      const m = lines[i]?.match(PROP_RE);
      if (m) return m[1];
    }
    return null;
  };

  // Doc comment → its property is below. Anything else (a describe argument, a
  // trailing comment) → above.
  return isDoc ? (forward() ?? backward()) : (backward() ?? forward());
}

/** True when the permissive token this match hinged on is negated ("deny-all", "no limit"). */
function isNegated(line: string, match: RegExpExecArray): boolean {
  const token = match[2];
  if (!token) return false;
  const tokenAt = match[0].lastIndexOf(token);
  if (tokenAt < 0) return false;
  return NEGATED_BEFORE_RE.test(line.slice(0, match.index + tokenAt));
}

/** Find every permissive-empty statement in one file. */
export function scanSource(file: string, source: string): PermissiveEmptyHit[] {
  const lines = source.split('\n');
  const hits: PermissiveEmptyHit[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const m = PERMISSIVE_EMPTY_RE.exec(line) ?? LEAVE_EMPTY_RE.exec(line);
    if (!m || m.index === undefined) continue;
    if (!isProse(line, m.index)) continue;
    if (isNegated(line, m)) continue;

    hits.push({
      file,
      line: i + 1,
      text: line.trim(),
      property: resolveProperty(lines, i),
    });
  }

  return hits;
}

// ---- Checking -----------------------------------------------------------

export interface CheckInput {
  /** The scanned surface: repo-relative path → file contents. */
  sources: Map<string, string>;
  registry: EmptyStateEntry[];
  /** Resolves a repo-rooted evidence path against the checkout. */
  exists: (repoRelativePath: string) => boolean;
}

export interface CheckResult {
  hits: PermissiveEmptyHit[];
  /** Failing. */
  findings: EmptyStateFinding[];
  /**
   * Non-failing. A statement that resolves to no property is narrative — a file
   * header explaining a past bug, say — not a claim about any field's contract,
   * so it is surfaced rather than enforced. The hazard this gate exists for is a
   * FIELD whose description misstates what its empty value grants; failing CI on
   * prose would be the "permanently-noisy check nobody reads" the liveness README
   * warns about.
   */
  notes: EmptyStateFinding[];
}

const key = (file: string, property: string) => `${file}#${property}`;

/**
 * Enforce the registry against the scanned surface, in both directions.
 *
 * Forward (the ratchet): a permissive-empty statement with no entry fails — you
 * cannot add undeclared permissive surface.
 *
 * Reverse (rot): an entry whose statement no longer exists also fails. The
 * liveness ledger learned this the expensive way — "a ledger entry is a claim
 * with a timestamp; code moves under it in both directions" — and a stale
 * classification is worse than no classification, because it reads as reviewed.
 */
export function checkEmptyState({ sources, registry, exists }: CheckInput): CheckResult {
  const hits: PermissiveEmptyHit[] = [];
  for (const [file, source] of sources) hits.push(...scanSource(file, source));

  const findings: EmptyStateFinding[] = [];
  const notes: EmptyStateFinding[] = [];
  const registryByKey = new Map(registry.map((e) => [key(e.file, e.property), e]));
  const matchedKeys = new Set<string>();

  for (const hit of hits) {
    if (!hit.property) {
      notes.push({
        kind: 'unresolved',
        file: hit.file,
        line: hit.line,
        message:
          `Narrative, not a property contract: "${hit.text}". ` +
          `If it does describe a property, move it within ${MAX_PROPERTY_DISTANCE} lines of the declaration so the gate can classify it.`,
      });
      continue;
    }

    const k = key(hit.file, hit.property);
    matchedKeys.add(k);
    if (registryByKey.has(k)) continue;

    findings.push({
      kind: 'unregistered',
      file: hit.file,
      line: hit.line,
      property: hit.property,
      message:
        `\`${hit.property}\` declares a permissive empty state ("${hit.text}") but is not classified.\n` +
        `      Add an entry to empty-state-registry.mts. If it gates ACCESS, the empty state must DENY\n` +
        `      (semantics: 'closed') — omission is the most common authoring error and it must not land\n` +
        `      on the widest grant. If it only selects a range of work, 'scope' is fine — say why.`,
    });
  }

  for (const entry of registry) {
    const k = key(entry.file, entry.property);

    // A `closed` gate states that its empty value DENIES, and the scanner only
    // matches permissive statements — so a correct `closed` entry is invisible
    // to it, permanently. Staleness cannot apply: these entries exist to record
    // "this is a gate and its empty state is safe", which is precisely the
    // question an author (or a model) authoring a rule needs answered, and it is
    // answerable nowhere else in the spec.
    if (entry.semantics !== 'closed' && !matchedKeys.has(k)) {
      findings.push({
        kind: 'stale',
        file: entry.file,
        property: entry.property,
        message:
          `Registered as '${entry.semantics}', but no permissive-empty statement was found for \`${entry.property}\`. ` +
          `If the wording was fixed, drop this entry; if the property moved, update \`file\`.`,
      });
    }

    if (!entry.rationale?.trim()) {
      findings.push({
        kind: 'missing-rationale',
        file: entry.file,
        property: entry.property,
        message: `Entry has no rationale. The classification has to be a decision someone wrote down, not a default.`,
      });
    }

    // Access gates must point at where their posture actually lives; scope
    // selectors and engine output have no enforcement site to cite.
    if (entry.semantics === 'closed' || entry.semantics === 'open') {
      if (!entry.evidence?.trim()) {
        findings.push({
          kind: 'missing-evidence',
          file: entry.file,
          property: entry.property,
          message: `'${entry.semantics}' is an access-gate classification and must cite where the posture is enforced.`,
        });
      } else if (!exists(entry.evidence)) {
        findings.push({
          kind: 'rotted-evidence',
          file: entry.file,
          property: entry.property,
          message: `Evidence path does not resolve: ${entry.evidence}`,
        });
      }
    }
  }

  return { hits, findings, notes };
}
