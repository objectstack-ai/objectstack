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
}

interface TokenParts {
  /** The token with surrounding punctuation and any line suffix removed. */
  path: string;
  /** The line suffix's value, or `null` when the token carries none. */
  line: number | null;
}

/**
 * Strip surrounding punctuation and split off any `:123` / `:12-34` line suffix.
 * The trailing class includes `:` so a realm marker written `objectui:` reduces
 * to `objectui`; a line suffix (`file.ts:150`) ends in a digit, so it survives
 * that pass and is split off by the line-number rule after it.
 *
 * The line is RETURNED rather than discarded (it used to be dropped on the
 * floor here) — a citation's line is the half of it a moved consumer rots
 * first, and a parser that cannot see the line cannot let any gate bound it.
 */
function bareToken(raw: string): TokenParts {
  const trimmed = raw
    .replace(/^[([{<"'`,;]+/, '')
    .replace(/[)\]}>"'`,;.:]+$/, '');
  const m = /:(\d+)(?:-(\d+))?$/.exec(trimmed);
  if (!m) return { path: trimmed, line: null };
  return { path: trimmed.slice(0, m.index), line: Number(m[2] ?? m[1]) };
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
  let realm = LOCAL_REALM;

  for (const raw of String(evidence).split(/\s+/)) {
    const { path: token, line } = bareToken(raw);
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
      }
    }

    // A clause boundary ends a realm's scope; the path above is classified first.
    if (/[;)]/.test(raw)) realm = LOCAL_REALM;
  }

  return { local: dedupe(local), foreign: dedupe(foreign), localCitations: dedupeCitations(citations) };
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

export interface EvidenceCheck extends EvidenceScan {
  /** Local paths that do not exist — genuinely rotted pointers. */
  missing: string[];
}

/** Scan an evidence string and resolve its local paths against the filesystem. */
export function checkEvidence(evidence: unknown, exists: (path: string) => boolean): EvidenceCheck {
  if (typeof evidence !== 'string') return { local: [], foreign: [], localCitations: [], missing: [] };
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
