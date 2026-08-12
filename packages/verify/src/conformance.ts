// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Conformance ledger — the reusable platform pattern (ADR-0060).
 *
 * A "conformance ledger" classifies every declarable property of a surface into
 * exactly one honest state — `enforced` / `experimental` / `removed` (ADR-0049) —
 * names the runtime site that enforces it, and (for high-risk) references a proof.
 * The platform hand-wrote this twice (ADR-0056 D10 authz matrix, ADR-0058 D7
 * expression surface) before promoting the shared invariants here.
 *
 * `checkLedger` returns a list of problems (empty = sound) so the helper carries
 * no test-runner dependency — callers assert `toEqual([])`. The optional
 * `discover` enables the **ratchet**: re-derive the real surface from source and
 * fail when a declaration is unclassified (the #1887 / declared-but-unenforced
 * class) or a `covers` entry is stale.
 *
 * The optional `attribution` closes the gap #7976 named: a `proof` used to be
 * checked for EXISTENCE only, so a row could cite a file that exercises a
 * neighbouring primitive and stay green forever (`rls-read` and
 * `rls-by-id-write` cited the same file, and nothing could tell whether it
 * exercised one, the other, or both). "Does this test actually prove this row"
 * is not mechanically decidable and is deliberately NOT attempted; the
 * checkable question it is converted into is **mutual naming** — the proof file
 * must claim the rows it is cited for, and every claim must be reciprocated.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type ConformanceState = 'enforced' | 'experimental' | 'removed';

export interface ConformanceRow {
  /** Stable unique id. */
  id: string;
  /** One-line human summary. */
  summary: string;
  /** The declaration site this row classifies (free-form; e.g. `file:field`). */
  surface?: string;
  /** Exactly one honest state (ADR-0049). */
  state: ConformanceState;
  /** Runtime enforcement site — REQUIRED when `state === 'enforced'`. */
  enforcement?: string;
  /**
   * Proof path (resolved against {@link CheckLedgerOptions.proofRoot}); the file
   * must exist — and, when {@link CheckLedgerOptions.attribution} is on, must
   * also CLAIM this row's id (see {@link ProofAttributionOptions}).
   */
  proof?: string;
  /** Ratchet keys this row accounts for (matched against `discover()`). */
  covers?: string[];
  /** Rationale — REQUIRED when `state !== 'enforced'`. */
  note?: string;
  /** Per-surface extras (dialect, mode, fail-policy, …) — not checked here. */
  meta?: Record<string, unknown>;
}

export interface CheckLedgerOptions {
  /** Directory each row's `proof` is resolved against. */
  proofRoot: string;
  /** Re-derive the real surface from source; enables the ratchet. */
  discover?: () => Iterable<string>;
  /** Row ids that MUST carry a proof. */
  highRisk?: string[];
  /** When true, EVERY enforced row must carry a proof (default: only high-risk). */
  proofRequiredForEnforced?: boolean;
  /** Bind row ↔ proof by NAME, not just by path (#7976). */
  attribution?: ProofAttributionOptions;
}

/**
 * Mutual row ↔ proof attribution (#7976).
 *
 * A cited proof file self-declares the rows it is a proof FOR, as header
 * comment lines: `// <marker>: <row-id>`, one per row. `checkLedger` then
 * asserts the pairing in BOTH directions:
 *
 *   1. every row's cited proof file claims that row's id, and
 *   2. every claim is reciprocated — the claimed id is a real ledger row AND
 *      that row cites this very file.
 *
 * Direction 2 is what makes a stale claim (a renamed row, a proof that was
 * re-pointed elsewhere) fail rather than rot, which is why {@link scan} exists:
 * a file no row cites is invisible to direction 1 by construction.
 *
 * A comment marker — rather than an exported manifest — is deliberate: proof
 * files are test modules whose import registers (and can boot) real stacks, so
 * the claim must be readable WITHOUT executing them. It is the same
 * `readFileSync` the existence check already implies, and it mirrors the
 * `@proof:` header idiom dogfood proofs already carry for the ADR-0054 liveness
 * registry. The marker keyword is per-ledger precisely so the two vocabularies
 * (liveness proof ids vs ledger row ids) cannot be confused for one another.
 */
export interface ProofAttributionOptions {
  /** Claim keyword, e.g. `'authz-row'` → a proof file line `// authz-row: rls-read`. */
  marker: string;
  /**
   * Extra proof-root-relative files to scan for claims, beyond the ones rows
   * cite. Any claim found in a file NO row cites is reported (direction 2).
   */
  scan?: () => Iterable<string>;
}

/** Escape a literal for embedding in a RegExp source. */
function escapeRe(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract a proof file's row claims. Matches the marker at the start of a
 * comment line (`//` or a block-comment `*` continuation) so a mention inside
 * prose or a string literal is not mistaken for a claim.
 */
function readClaims(absPath: string, marker: string): string[] {
  const re = new RegExp(`^[ \\t]*(?://+|\\*)[ \\t]*${escapeRe(marker)}:[ \\t]*(\\S+)`, 'gm');
  const src = readFileSync(absPath, 'utf8');
  const claims: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) claims.push(m[1]);
  return claims;
}

const VALID_STATES: ReadonlySet<string> = new Set(['enforced', 'experimental', 'removed']);

/**
 * Assert a conformance ledger's shared invariants. Returns a list of problem
 * strings; an empty array means the ledger is sound.
 */
export function checkLedger(rows: readonly ConformanceRow[], opts: CheckLedgerOptions): string[] {
  const problems: string[] = [];

  // Unique ids.
  const seenIds = new Set<string>();
  for (const r of rows) {
    if (seenIds.has(r.id)) problems.push(`duplicate id: ${r.id}`);
    seenIds.add(r.id);
  }

  for (const r of rows) {
    if (!VALID_STATES.has(r.state)) problems.push(`${r.id}: invalid state '${r.state}'`);
    if (!r.summary) problems.push(`${r.id}: missing summary`);
    if (r.state === 'enforced' && !r.enforcement) problems.push(`${r.id}: enforced but names no enforcement site`);
    if (r.state !== 'enforced' && !r.note) problems.push(`${r.id}: ${r.state} but carries no note (honest rationale)`);
    if (r.proof && !existsSync(join(opts.proofRoot, r.proof))) problems.push(`${r.id}: proof missing on disk: ${r.proof}`);
    if (opts.proofRequiredForEnforced && r.state === 'enforced' && !r.proof) problems.push(`${r.id}: enforced but carries no proof`);
  }

  // High-risk rows must carry a proof.
  for (const id of opts.highRisk ?? []) {
    const r = rows.find((x) => x.id === id);
    if (!r) problems.push(`high-risk id not in ledger: ${id}`);
    else if (!r.proof) problems.push(`high-risk ${id} must carry a proof`);
  }

  // Mutual row ↔ proof attribution (#7976) — a proof must NAME what it proves.
  if (opts.attribution) {
    const { marker, scan } = opts.attribution;

    // Which rows cite each proof file (a shared file legitimately proves several).
    const citedBy = new Map<string, string[]>();
    for (const r of rows) {
      if (r.proof) citedBy.set(r.proof, [...(citedBy.get(r.proof) ?? []), r.id]);
    }

    for (const file of new Set([...citedBy.keys(), ...(scan?.() ?? [])])) {
      const abs = join(opts.proofRoot, file);
      if (!existsSync(abs)) continue; // already reported as missing on disk
      const claims = readClaims(abs, marker);
      const citers = citedBy.get(file) ?? [];

      // Direction 1 — the cited file must claim every row citing it.
      for (const id of citers) {
        if (!claims.includes(id)) {
          problems.push(`${id}: proof does not claim this row — add \`${marker}: ${id}\` to ${file}, or stop citing it`);
        }
      }

      // Direction 2 — every claim is reciprocated by the ledger.
      for (const id of claims) {
        if (!seenIds.has(id)) {
          problems.push(`${file}: claims \`${marker}: ${id}\`, but no such row is in the ledger (orphaned claim)`);
        } else if (!citers.includes(id)) {
          const cited = rows.find((x) => x.id === id)?.proof;
          problems.push(
            `${file}: claims \`${marker}: ${id}\`, but that row cites ${cited ? `\`${cited}\`` : 'no proof'} — attribution is not mutual`,
          );
        }
      }
    }
  }

  // `covers`: each surface classified by exactly one row.
  const covered = new Map<string, string>();
  for (const r of rows) {
    for (const c of r.covers ?? []) {
      const prev = covered.get(c);
      if (prev) problems.push(`surface "${c}" classified by more than one row (${prev}, ${r.id})`);
      else covered.set(c, r.id);
    }
  }

  // The ratchet: every discovered surface is covered; no stale covers.
  if (opts.discover) {
    const discovered = new Set(opts.discover());
    for (const s of discovered) {
      if (!covered.has(s)) problems.push(`UNCLASSIFIED surface — add a ledger row (ADR-0060): ${s}`);
    }
    for (const c of covered.keys()) {
      if (!discovered.has(c)) problems.push(`STALE covers — surface no longer in source: ${c}`);
    }
  }

  return problems;
}
