// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `producer` and `evidenceScope` — the two things a liveness `evidence` pointer
// never said, and the two ways a `live` verdict has been wrong in production.
//
// ## 1. `producer` — a consumer is only half the call graph (#4837)
//
// `seed.json` marked `Seed.env` **live**, evidence
// `packages/metadata-protocol/src/seed-loader.ts:91`, note "filterByEnv drops
// datasets whose env list excludes the running environment". Every word of that
// was checkable and the verdict was still false: line 91 really does call
// `filterByEnv(request.seeds, config.env)`, but not one of the six call sites
// that built a `SeedLoaderRequest` passed `env`. `config.env` was permanently
// `undefined`, `filterByEnv` returned its input on the first line, and
// `dataset.env` was never read. The evidence pointed at the CONSUMER; the
// property was dead at the PRODUCER.
//
// The ledger's own README already names this shape in a different context —
// "a `case` label is not enforcement; check the call site" (#3106) — and the
// unit test made it worse rather than better: `seed-loader.test.ts` has always
// had a passing `should handle environment filtering` case, because the test
// passes `config.env` itself. The mechanism was correct all along. Only the
// wiring was missing, and both the ledger and the test looked exclusively at the
// mechanism.
//
// So: for a property whose runtime effect depends on a SECOND input that some
// producer must supply, `live` requires evidence on the producer side too.
// `producer` is that field. It resolves exactly like `evidence` — repo-rooted
// paths must exist, cross-repo paths are attributed and counted — because a
// producer pointer into thin air is the same unfalsifiable claim.
//
// ## 2. `evidenceScope` — how wide the last look was (#4895)
//
// Four measured cases, all one blind spot: a verdict reached by searching THIS
// repo, published as if it covered every consumer.
//
//   1. `app.homePageId` — tombstoned "no shell ever read it"; objectui's
//      `AppContent.resolveLandingRoute()` had been reading it all along
//      (corrected in #4709).
//   2. `flow.nodes.children.position` — marked live, "designer canvas layout";
//      the designer wrote its own `ui:{x,y}` and NOTHING read `position`.
//   3. `HttpMethod` — a scan that matched only `import … from` reported a false
//      negative.
//   4. `Notification`/`NotificationConfig` — removed on "zero importers"; objectui
//      re-exported them with `export … from` and consumed them from
//      `@object-ui/types`, so even a scan covering `export … from` would have
//      missed it if it matched on the spec specifier.
//
// Case 4 is why this field records a SCOPE rather than a boolean "checked": the
// honest answers differ in kind. `in-repo` says the call graph was closed inside
// this repo only. `cross-repo` says a named foreign realm was walked too, and
// the entry is expected to say WHERE in its evidence (pin the commit — an
// objectui reader's line numbers drifted 28 lines in one day, #3714).
//
// Neither field fails CI for being ABSENT. Both fail for being MALFORMED, the
// same asymmetry `verifiedAt` uses: an absent field reports as unverified and
// joins a worklist, while a value the parser cannot read would silently exempt
// the entry from every future sweep — which is the silent-no-op shape this whole
// ledger exists to remove.

/** The vocabulary for `evidenceScope`. Anything else is a malformed value. */
export const EVIDENCE_SCOPES = ['in-repo', 'cross-repo'] as const;
export type EvidenceScope = (typeof EVIDENCE_SCOPES)[number];

export type FieldCheck = { ok: true } | { ok: false; error: string };

/**
 * Validate an `evidenceScope` value. Present-and-unknown fails; absent is not
 * this function's business (the caller skips it).
 */
export function parseEvidenceScope(value: unknown): FieldCheck {
  if (typeof value !== 'string') {
    return { ok: false, error: `evidenceScope must be a string, got ${typeof value}` };
  }
  if (!(EVIDENCE_SCOPES as readonly string[]).includes(value)) {
    return {
      ok: false,
      error: `evidenceScope "${value}" is not one of ${EVIDENCE_SCOPES.join(' | ')}`,
    };
  }
  return { ok: true };
}

/**
 * Validate a `producer` value's SHAPE. Its paths are resolved by the caller
 * through the same `checkEvidence` used for `evidence` — one resolver, so a
 * producer pointer cannot rot in a way an evidence pointer could not.
 *
 * A bare file path with no prose is accepted but discouraged: the point of the
 * field is to say WHO supplies the value, and `seed-loader.ts:143` alone does not
 * (the failing `Seed.env` entry was exactly that shape on the consumer side).
 */
export function parseProducer(value: unknown): FieldCheck {
  if (typeof value !== 'string') {
    return { ok: false, error: `producer must be a string, got ${typeof value}` };
  }
  if (value.trim() === '') {
    return { ok: false, error: 'producer is empty — either cite the call site or drop the field' };
  }
  return { ok: true };
}

export interface ProducerEntry {
  /** `<type>/<propPath>` — the ledger coordinate. */
  key: string;
  status: string;
  producer?: unknown;
  evidenceScope?: unknown;
}

export interface ProducerReport {
  /** Malformed values — these FAIL the gate. */
  errors: string[];
  /** `live` entries carrying producer-side evidence. */
  withProducer: number;
  /** `live` entries that do not — the #4837 worklist, never a failure. */
  withoutProducer: string[];
  /** Entries whose verification scope is declared, by scope. */
  byScope: Record<string, number>;
  /** Classified entries with no declared scope — the #4895 worklist. */
  unscoped: number;
}

/**
 * Fold ledger entries into the producer/scope report. Pure, for the same reason
 * `verification.mts` and `drill.mts` are: the tree is nearly all-defaults today,
 * so a green run proves nothing about whether the checks can fire.
 */
export function buildProducerReport(entries: ProducerEntry[]): ProducerReport {
  const report: ProducerReport = {
    errors: [],
    withProducer: 0,
    withoutProducer: [],
    byScope: {},
    unscoped: 0,
  };

  for (const entry of entries) {
    if (entry.producer !== undefined) {
      const parsed = parseProducer(entry.producer);
      if (!parsed.ok) report.errors.push(`${entry.key} → ${parsed.error}`);
      else if (entry.status === 'live') report.withProducer++;
    } else if (entry.status === 'live') {
      report.withoutProducer.push(entry.key);
    }

    if (entry.evidenceScope !== undefined) {
      const parsed = parseEvidenceScope(entry.evidenceScope);
      if (!parsed.ok) report.errors.push(`${entry.key} → ${parsed.error}`);
      else report.byScope[String(entry.evidenceScope)] = (report.byScope[String(entry.evidenceScope)] || 0) + 1;
    } else {
      report.unscoped++;
    }
  }

  report.withoutProducer.sort();
  return report;
}
