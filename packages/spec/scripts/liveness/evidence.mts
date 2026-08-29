// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Evidence path resolution for the liveness gate.
//
// WHY THIS EXISTS. The gate's stale-evidence check used to be one line:
//
//     const file = String(led.evidence).split(':')[0];
//     if (/\//.test(file) && !existsSync(join(repoRoot, file))) → flag
//
// i.e. it assumed every `evidence` string is exactly `path/to/file.ts:123`.
// Almost none are. Real entries look like:
//
//   "packages/spec/src/stack.zod.ts (mergeActionsIntoObjects stable-sorts …)"
//   "packages/objectql/src/validation/rule-validator.ts (UPDATE strip); packages/…"
//   "objectui: packages/app-shell/src/views/RecordDetailView.tsx + utils/…"
//
// Taking everything before the first colon turns the prose into the "filename",
// which never exists — so the check flagged 48 of 227 entries, and **every one
// of the 48 was either a parse artefact or a deliberate cross-repo pointer**. A
// warning list that is permanently non-empty and ~100% false is a warning
// nobody reads: the one genuinely rotted pointer in that list
// (`object.enable.clone` → a file that moved repos) sat there unnoticed.
//
// So: extract path-shaped tokens properly, and honour the cross-repo attribution
// the entries already write ("objectui: …"). What's left is signal.

/** Top-level directories of THIS repo — the anchor for a repo-relative path claim. */
export const REPO_ROOTS = ['apps', 'content', 'docker', 'docs', 'examples', 'packages', 'scripts', 'skills'];

/**
 * Realm markers an evidence string may use to attribute a path to another repo.
 * `objectui` is the renderer repo; `cloud` is the closed EE runtime. `framework`
 * switches back explicitly. These are already the house convention in prose —
 * this makes them machine-read instead of decorative.
 */
export const FOREIGN_REALMS = ['objectui', 'cloud', 'ee'];
export const LOCAL_REALM = 'framework';

/**
 * Paths that are repo-rooted in shape but never present in the OPEN edition.
 * `@objectstack/service-ai` is the closed cloud runtime — `packages/services/`
 * here has every sibling service EXCEPT service-ai. Entries cite it because that
 * runtime is what consumes the property (see the `_note` in action.json).
 */
export const FOREIGN_PATH_PREFIXES = ['packages/services/service-ai/'];

const PATH_RE = new RegExp(`^(?:${REPO_ROOTS.join('|')})/[\\w.@-]+(?:/[\\w.@-]+)*\\.[a-zA-Z]{1,5}$`);

/** A local path citation that names a line: `packages/…/file.ts:150`. */
export interface EvidenceCitation {
  /** The path, exactly as it appears in `local`. */
  path: string;
  /**
   * The line the citation names. For a RANGE (`:12-34`) this is the END: a range
   * whose start is inside the file but whose end is past EOF still overruns it,
   * and a start past EOF implies an end past EOF — so the end is both the
   * stricter bound and the one that subsumes the other.
   */
  line: number;
}

/**
 * A local path citation anchored to a SYMBOL: `packages/…/file.ts#dispatchFlowAction`.
 *
 * WHY A SYMBOL AND NOT (ONLY) A LINE (#12516). A line citation rots IN RANGE:
 * the file exists, the line is inside it, the file names the key — and the
 * consumer has moved to a different line of the same file, so every check
 * passes and the pointer is still wrong. Measured on two entries `action.json`
 * had repointed with fresh line numbers on 2026-08-25: both had drifted by
 * 2026-08-26, because the cited file is 1600+ lines and actively edited — the
 * more precisely a line is cited, the faster it rots. A symbol MOVES WITH the
 * consumer, so the pointer survives exactly the movement that rots a line, and
 * when the consumer is renamed or deleted the symbol is genuinely gone and the
 * gate goes red — which is the direction a stale line can never produce.
 *
 * The `#` separator is the proof-ref convention (`<file>#<proof-id>`,
 * ADR-0054) applied to the citation grammar. A line may ride along
 * (`file.ts#symbol:150`, either order) — it stays a human convenience and is
 * still bounded by `checkCitationLines`; the symbol is the load-bearing half.
 */
export interface EvidenceAnchor {
  /** The path, exactly as it appears in `local`. */
  path: string;
  /** The anchored symbol text, exactly as written after `#` (validated later). */
  symbol: string;
}

export interface EvidenceScan {
  /** Repo-rooted paths attributed to THIS repo — these must resolve. */
  local: string[];
  /** Paths attributed to another repo (realm marker or foreign prefix) — not resolved here. */
  foreign: string[];
  /**
   * The subset of `local` whose citation names a line, paired with that line —
   * the only citations a line-bound check can falsify. Deduped on `path:line`,
   * not on path: one evidence string routinely cites several lines of one file,
   * and collapsing them would drop every citation but the first.
   */
  localCitations: EvidenceCitation[];
  /**
   * The subset of `local` whose citation anchors a symbol (`path#symbol`) —
   * the only citations a symbol check can falsify. Deduped on `path#symbol`
   * for the same reason `localCitations` dedupes on `path:line`. Foreign
   * anchors are never collected, for the same reason foreign lines are not:
   * the file is legitimately absent here, so every symbol in it would read as
   * gone.
   */
  localAnchors: EvidenceAnchor[];
}

interface TokenParts {
  /** The token with surrounding punctuation and any line/anchor suffix removed. */
  path: string;
  /** The line suffix's value, or `null` when the token carries none. */
  line: number | null;
  /** The `#symbol` anchor's text, or `null` when the token carries none. */
  anchor: string | null;
}

/**
 * Strip surrounding punctuation and split off any `:123` / `:12-34` line suffix
 * and any `#symbol` anchor suffix. The trailing class includes `:` so a realm
 * marker written `objectui:` reduces to `objectui`; a line suffix
 * (`file.ts:150`) ends in a digit, so it survives that pass and is split off by
 * the line-number rule after it.
 *
 * The line is RETURNED rather than discarded (it used to be dropped on the
 * floor here) — a citation's line is the half of it a moved consumer rots
 * first, and a parser that cannot see the line cannot let any gate bound it.
 *
 * The anchor is split off in EITHER order relative to the line
 * (`file.ts#symbol:150` and `file.ts:150#symbol` both parse) on purpose: an
 * order the parser did not accept would not fail — the token would just stop
 * matching PATH_RE and quietly become prose, taking the existence check down
 * with it. The anchor's TEXT is deliberately permissive here (anything but
 * whitespace, `#`, `/`); whether it is a well-formed symbol is judged by
 * `checkEvidenceAnchors`, so a typo'd anchor is a loud finding rather than a
 * silently-ignored token — the same asymmetry `verifiedAt` applies to a
 * malformed date.
 */
function bareToken(raw: string): TokenParts {
  let t = raw
    .replace(/^[([{<"'`,;]+/, '')
    .replace(/[)\]}>"'`,;.:]+$/, '');
  let line: number | null = null;
  let anchor: string | null = null;
  // Two suffixes at most, one strip per pass, order-independent.
  for (let i = 0; i < 2; i++) {
    const lm = /:(\d+)(?:-(\d+))?$/.exec(t);
    if (line === null && lm) { line = Number(lm[2] ?? lm[1]); t = t.slice(0, lm.index); continue; }
    const am = /#([^\s#/]*)$/.exec(t);
    if (anchor === null && am) { anchor = am[1]; t = t.slice(0, am.index); continue; }
    break;
  }
  return { path: t, line, anchor };
}

/**
 * Split an evidence string into local vs foreign path claims.
 *
 * A realm marker (`objectui:`, `(objectui`, `cloud:`) attributes the paths that
 * FOLLOW it, and its scope ends at the next clause boundary (`;` or a closing
 * paren) — so `"objectui X gates … (plugin-audit, packages/plugins/…/y.ts) …"`
 * still resolves the framework path in the trailing clause. Anything that is not
 * repo-rooted (`app-shell/MetadataProvider.tsx`, `action-button/-group`) is
 * prose and is neither resolved nor reported.
 */
export function scanEvidence(evidence: string): EvidenceScan {
  const local: string[] = [];
  const foreign: string[] = [];
  const citations: EvidenceCitation[] = [];
  const anchors: EvidenceAnchor[] = [];
  let realm = LOCAL_REALM;

  for (const raw of String(evidence).split(/\s+/)) {
    const { path: token, line, anchor } = bareToken(raw);
    const asRealm = token.toLowerCase();

    if (FOREIGN_REALMS.includes(asRealm)) { realm = asRealm; continue; }
    if (asRealm === LOCAL_REALM) { realm = LOCAL_REALM; continue; }

    if (PATH_RE.test(token)) {
      const isForeignPath = FOREIGN_PATH_PREFIXES.some((p) => token.startsWith(p));
      if (realm !== LOCAL_REALM || isForeignPath) foreign.push(token);
      else {
        local.push(token);
        // Every token is scanned, so a multi-citation entry ("…file.ts:267 (prose)
        // + …other.ts:136 + …third.ts:897") contributes ALL of its lines, not the
        // first — the concatenated form is the house style for a property with
        // several consumers, and seeing only its head would leave the rest of the
        // chain exactly as unfalsifiable as before.
        if (line !== null) citations.push({ path: token, line });
        if (anchor !== null) anchors.push({ path: token, symbol: anchor });
      }
    }

    // A clause boundary ends a realm's scope; the path above is classified first.
    if (/[;)]/.test(raw)) realm = LOCAL_REALM;
  }

  return {
    local: dedupe(local),
    foreign: dedupe(foreign),
    localCitations: dedupeCitations(citations),
    localAnchors: dedupeAnchors(anchors),
  };
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}

function dedupeCitations(cs: EvidenceCitation[]): EvidenceCitation[] {
  const seen = new Set<string>();
  return cs.filter((c) => {
    const k = `${c.path}:${c.line}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function dedupeAnchors(as: EvidenceAnchor[]): EvidenceAnchor[] {
  const seen = new Set<string>();
  return as.filter((a) => {
    const k = `${a.path}#${a.symbol}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export interface EvidenceCheck extends EvidenceScan {
  /** Local paths that do not exist — genuinely rotted pointers. */
  missing: string[];
}

/** Scan an evidence string and resolve its local paths against the filesystem. */
export function checkEvidence(evidence: unknown, exists: (path: string) => boolean): EvidenceCheck {
  if (typeof evidence !== 'string') return { local: [], foreign: [], localCitations: [], localAnchors: [], missing: [] };
  const scan = scanEvidence(evidence);
  return { ...scan, missing: scan.local.filter((p) => !exists(p)) };
}

/**
 * `wc -l` semantics: the number of lines a citation can address. A trailing
 * newline terminates the last line rather than opening an empty one, so a
 * 717-line file does not have a line 718 to cite — the off-by-one that makes
 * the difference between reading a past-EOF citation as rot and reading it as
 * a boundary case.
 */
export function countLines(content: string): number {
  if (content === '') return 0;
  const n = content.split('\n').length;
  return content.endsWith('\n') ? n - 1 : n;
}

/** A citation whose line is not inside the file it cites. */
export interface OutOfRangeCitation extends EvidenceCitation {
  /** The cited file's actual line count. */
  lines: number;
}

/**
 * Bound each local `path:NNN` citation by the cited file's length.
 *
 * WHY THIS IS SEPARATE FROM `checkEvidence`. Existence and line-bounding are two
 * standards, and only the ledger gate has measured its citations against the
 * second one. Folding the line check into `checkEvidence` would impose it on
 * every current and future caller of that function silently — including
 * `empty-state.mts`, whose registry has never been measured this way — and an
 * optional `lineCount` parameter would do the mirror-image harm: a caller that
 * omits it gets no line check and nothing says so. A separately named function
 * has to be *called*, so which surfaces bound their citations stays readable.
 *
 * `lineCount` returns `null` for a file it cannot read. Those are skipped on
 * purpose: a citation into a missing file is already reported by the existence
 * check, and reporting one rot twice teaches a reader to discount the list.
 */
export function checkCitationLines(
  scan: EvidenceScan,
  lineCount: (path: string) => number | null,
): OutOfRangeCitation[] {
  const out: OutOfRangeCitation[] = [];
  for (const c of scan.localCitations) {
    const lines = lineCount(c.path);
    if (lines === null) continue;
    if (c.line > lines) out.push({ ...c, lines });
  }
  return out;
}

/**
 * The symbol grammar an anchor must satisfy: one JS/TS identifier. Anything
 * else — a hyphenated proof-id shape, a dotted member path, an empty suffix —
 * is MALFORMED and fails loudly rather than parsing to nothing, because an
 * anchor that quietly degrades to prose takes the whole citation's existence
 * check down with it (the token stops matching PATH_RE), which is the silent
 * no-op shape this ledger exists to catch.
 */
const SYMBOL_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Does `content` name this symbol as a WORD? Identifier-bounded rather than
 * `\b`-bounded: `$` is a legal identifier character that `\b` treats as a
 * boundary, so `\bfoo\b` would let `foo` satisfy an anchor at `foo$bar`.
 */
export function isSymbolNamed(content: string, symbol: string): boolean {
  const esc = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_$])${esc}(?![A-Za-z0-9_$])`).test(content);
}

export interface AnchorCheck {
  /** Well-formed local anchors that were resolvable and were asked. */
  checked: EvidenceAnchor[];
  /** ...of which these name a symbol the cited file does not contain — rot. */
  unresolved: EvidenceAnchor[];
  /** Anchors whose text is not one identifier — malformed, also a failure. */
  malformed: EvidenceAnchor[];
}

/**
 * Resolve each local `path#symbol` anchor against the cited file's text.
 *
 * SEPARATE from `checkEvidence` for exactly the reason `checkCitationLines`
 * states: which surfaces hold their citations to which standard must stay
 * readable at the call site, and `empty-state.mts` shares the scanner.
 *
 * WHAT THIS FALSIFIES — AND WHAT IT CANNOT (#12516). A line citation rots in
 * range when the consumer moves within its file; an anchored citation cannot —
 * the symbol moves with the consumer, and when the consumer is renamed or
 * deleted the anchor goes RED, which the line bound never could (the stale
 * line is still "a line the file has"). The honest residual: a symbol that
 * SURVIVES while its body stops reading the key is out of reach at text level
 * — locating a symbol's extent needs a parser, and the #11457 precedent is
 * not to switch on a matcher whose false-positive class has not been measured.
 * The file-level key-mention check remains that case's backstop.
 *
 * `readFile` returns `null` for a path it cannot read; those anchors are
 * SKIPPED, not reported — the existence check already owns that path's
 * verdict (the same contract `checkCitationLines` and `findUnanchoredCitations`
 * state for their own `null` cases).
 */
export function checkEvidenceAnchors(
  scan: EvidenceScan,
  readFile: (path: string) => string | null,
): AnchorCheck {
  const checked: EvidenceAnchor[] = [];
  const unresolved: EvidenceAnchor[] = [];
  const malformed: EvidenceAnchor[] = [];
  for (const a of scan.localAnchors) {
    if (!SYMBOL_RE.test(a.symbol)) { malformed.push(a); continue; }
    const content = readFile(a.path);
    if (content === null) continue;
    checked.push(a);
    if (!isSymbolNamed(content, a.symbol)) unresolved.push(a);
  }
  return { checked, unresolved, malformed };
}
