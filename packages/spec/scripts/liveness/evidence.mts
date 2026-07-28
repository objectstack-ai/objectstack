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

export interface EvidenceScan {
  /** Repo-rooted paths attributed to THIS repo — these must resolve. */
  local: string[];
  /** Paths attributed to another repo (realm marker or foreign prefix) — not resolved here. */
  foreign: string[];
}

/**
 * Strip surrounding punctuation and any `:123` / `:12-34` line suffix from a
 * token. The trailing class includes `:` so a realm marker written `objectui:`
 * reduces to `objectui`; a line suffix (`file.ts:150`) ends in a digit, so it
 * survives that pass and is removed by the line-number rule after it.
 */
function bareToken(raw: string): string {
  return raw
    .replace(/^[([{<"'`,;]+/, '')
    .replace(/[)\]}>"'`,;.:]+$/, '')
    .replace(/:\d+(?:-\d+)?$/, '');
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
  let realm = LOCAL_REALM;

  for (const raw of String(evidence).split(/\s+/)) {
    const token = bareToken(raw);
    const asRealm = token.toLowerCase();

    if (FOREIGN_REALMS.includes(asRealm)) { realm = asRealm; continue; }
    if (asRealm === LOCAL_REALM) { realm = LOCAL_REALM; continue; }

    if (PATH_RE.test(token)) {
      const isForeignPath = FOREIGN_PATH_PREFIXES.some((p) => token.startsWith(p));
      if (realm !== LOCAL_REALM || isForeignPath) foreign.push(token);
      else local.push(token);
    }

    // A clause boundary ends a realm's scope; the path above is classified first.
    if (/[;)]/.test(raw)) realm = LOCAL_REALM;
  }

  return { local: dedupe(local), foreign: dedupe(foreign) };
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}

export interface EvidenceCheck extends EvidenceScan {
  /** Local paths that do not exist — genuinely rotted pointers. */
  missing: string[];
}

/** Scan an evidence string and resolve its local paths against the filesystem. */
export function checkEvidence(evidence: unknown, exists: (path: string) => boolean): EvidenceCheck {
  if (typeof evidence !== 'string') return { local: [], foreign: [], missing: [] };
  const scan = scanEvidence(evidence);
  return { ...scan, missing: scan.local.filter((p) => !exists(p)) };
}
