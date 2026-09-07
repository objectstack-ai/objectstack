// Types for the ONE derivation `check-error-status-conformance.mjs` publishes to
// its second consumer — the same problem, and the same fix, as
// `js-comment-mask.d.mts` and `check-regen-pending.d.mts` next door (#5475,
// #10398).
//
// The module itself stays `.mjs`: it is a root gate script with a `--self-test`
// and a `--update` entry point run with bare `node`, and every root script here
// is authored that way. What changed is that
// `packages/spec/src/api/error-catalog-docs.test.ts` — the ADR-0112 D7 catalog
// guard — now imports it from inside a tsc program (`tsconfig.test.json`), where
// an untyped `.mjs` import is TS7016: the derivation silently becomes `any`, and
// reading `.wireCode` off a misspelled property would type-check clean while the
// guard asserted over `undefined`.
//
// ⛔ ONE export deliberately. The module exports two dozen internals for its own
// `--self-test`, and declaring them here would invite the guard to re-assemble
// the derivation itself — which is the second copy the #15631 ruling forbids.
// `deriveWireFace` is the whole supported surface.
//
// Declared rather than inferred (no `allowJs`) because the module sits at the
// repo root, outside the consuming program's `rootDir`. `check-declaration-mirrors`
// holds the name, kind and required arity below equal to the module's; the TYPES
// are hand-kept, so keep this file small enough that doing so stays trivial.

/**
 * One entry the doc parser READ on a page — a heading naming an error code in
 * any shape `ENTRY_HEADING_SHAPES` recognises, bare or with a descriptive
 * suffix. `where` is `<repo-relative path>:<1-based line>`.
 */
export interface DocEntry {
  code: string;
  where: string;
}

/**
 * One row of the TRANSLATION CENSUS: a class whose thrown `code` a door
 * translates away before it reaches HTTP, so `code` is an in-process contract
 * and `toCode` is what the wire actually carries.
 */
export interface TranslatedDeclaration {
  code: string;
  toCode: string;
  status: number;
  className: string;
  where: string;
  arm: string;
}

/**
 * The whole derivation: the corpus walk, the runtime side, the doc side, the
 * reconciled vocabulary, and the wire face left once the door's translations
 * are subtracted.
 *
 * Only the members the D7 catalog guard consumes are typed precisely; the
 * derivation's internal halves (`sources`, `derived`, `doc`) are declared as
 * the module returns them but are not part of the supported surface.
 *
 * @param repoRoot Directory every repo-relative path is resolved against;
 *        defaults to the process cwd (`'.'`). Paths INSIDE the result stay
 *        repo-relative regardless of what is passed here.
 */
export function deriveWireFace(repoRoot?: string): {
  /** Every `StandardErrorCode` member, parsed out of `errors.zod.ts`. */
  members: string[];
  /** Members plus every other code a scanned page publishes a status for. */
  vocabulary: string[];
  /** The non-member half of `vocabulary` — ledger codes the docs have reached. */
  docPublishedBeyondStandard: string[];
  /**
   * `vocabulary` minus every translated code: the codes that can appear in an
   * envelope ON THE WIRE, which is the face the catalog page catalogs.
   */
  wireCodes: string[];
  /** The translation census, reported rather than dropped. */
  translated: TranslatedDeclaration[];
  /** `translated`'s in-process spellings, as a set. */
  translatedCodes: Set<string>;
  /** Every entry the parser read on the catalog page, in source order. */
  catalogEntries: DocEntry[];
  /** Repo-relative path of the catalog page, so a consumer need not respell it. */
  catalogPath: string;
  /** Repo-relative path → source text, for the scanned corpus. */
  sources: Map<string, string>;
  /** The runtime side: emitted statuses, unresolved declarations, site count. */
  derived: {
    emitted: Map<string, Map<number, string[]>>;
    unresolved: string[];
    translated: TranslatedDeclaration[];
    sites: number;
  };
  /** The doc side, as `parseDocumentedStatuses` returns it. */
  doc: {
    claimed: Map<string, Map<number, string[]>>;
    covered: Map<string, Map<number, string[]>>;
    documented: Set<string>;
    unreadableHeadings: { path: string; line: number; code: string; why: string; text: string }[];
    entries: DocEntry[];
  };
};
