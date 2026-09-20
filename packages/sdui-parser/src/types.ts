/**
 * ObjectUI — SDUI JSX-source parser (ADR-0080)
 *
 * Types shared by the constrained JSX-source compiler. The parser turns a
 * constrained JSX/HTML+Tailwind *text* into the existing SDUI `SchemaNode`
 * tree. It PARSES — it never executes. No `import`, no `eval`, no JS.
 */

/** A node in the compiled SDUI tree. Mirrors `@object-ui/types` BaseSchema. */
export type SchemaNode = SchemaElement | string;

export interface SchemaElement {
  type: string;
  children?: SchemaNode[];
  [prop: string]: unknown;
}

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  severity: Severity;
  /** stable machine code, e.g. 'forbidden-tag' */
  code: string;
  message: string;
  /** byte offset into the source where the issue starts */
  start?: number;
  /** the tag/component involved, when relevant */
  tag?: string;
}

export interface ParseOptions {
  /**
   * Whitelist of allowed tag names (= registry `type` set, from the manifest).
   * When provided, any tag outside it is a `forbidden-tag` error — this is the
   * sanitization boundary. When omitted, all tags are accepted (lexing only).
   */
  allowedTags?: Set<string>;
}

export interface ParseResult {
  /** the compiled tree, or null when the source has no valid root */
  tree: SchemaElement | null;
  diagnostics: Diagnostic[];
}

/* ------------------------------------------------------------------ *
 * Manifest — the serialized public-tier contract from the registry.
 * Produced by serializing `ComponentRegistry.getAllConfigs()` (ADR-0080 §3/§6).
 * ------------------------------------------------------------------ */

export type ManifestInputType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'array'
  | 'object'
  | 'color'
  | 'date'
  | 'code'
  | 'file'
  | 'slot';

export interface ManifestInput {
  name: string;
  /**
   * The input's coarse type: ONE kind, or an ARRAY of kinds when the key's
   * contract is a union (objectui#3832).
   *
   * A value passes {@link validateTree}'s coarse check when ANY arm accepts it,
   * and is reported when none does — the array widens what is legal, it does
   * not switch the check off.
   *
   * The single-kind form is unchanged and stays the canonical spelling for a
   * one-arm key: `manifestFromConfigs` collapses a one-element array back to
   * the bare string, so a manifest gains arrays only where a union was really
   * declared and every already-published entry serializes byte-identically.
   */
  type: ManifestInputType | ManifestInputType[];
  required?: boolean;
  /** allowed values for `enum` inputs */
  enum?: Array<string | { value: unknown; label?: string }>;
  /**
   * Marks a data-binding input the server must resolve (ADR-0080 §6.3):
   * `binding: 'object'` says the input NAMES an object, so the server-side
   * binding check knows what to resolve it against. Unrelated to
   * `type: 'object'`, the coarse control kind — a record-shaped value and an
   * object-naming input are two different facts.
   *
   * ## The vocabulary is exactly `'object'`
   *
   * `'field'` stood beside it from the first draft of ADR-0080 and was never
   * written. objectui retired it from the same three declarations of its copy
   * of this package — the maintainer ruling of 2026-09-07 on objectui#6950
   * (director decision batch #69) on the serializer's input boundary, and
   * objectui#8315 on the two faces here — citing enforce-or-remove on the
   * ground that the arm has zero writers. Nothing propagated that to this
   * copy; this declaration is that port.
   *
   * ⚠️ The argument for leaving THIS face wide was answered, not overlooked.
   * It runs: producer → reader is a subset relation, so a reader accepting a
   * value no producer emits is permissive rather than wrong. Against it:
   *
   *   1. **This is not a pure reader face.** `manifestFromConfigs` RETURNS a
   *      `Manifest`, so `ManifestInput` is also this package's OUTPUT type,
   *      fed straight from the already-narrowed `RegistryConfigLike` boundary
   *      in `index.ts`. A union wider than the producer's is imprecision on
   *      the way out, not permissiveness on the way in.
   *   2. **Its sibling is a pure producer face.**
   *      {@link ValidationResult.bindings}`[].kind` is written by
   *      `validateTree` by copying this key, so the subset relation runs the
   *      other way there — see that declaration. The two are COUPLED by that
   *      assignment: narrowing one alone needs a cast at the only conversion
   *      site, which is the lenient consumer-side fallback Prime Directive #12
   *      bans. So "both narrow" and "both wide" were the only self-consistent
   *      states.
   *   3. **The permissiveness protected nothing HERE either.** Re-measured on
   *      this tree rather than inherited: `binding: 'field'` has zero writers
   *      in this repository, against a firing `binding: 'object'` control of
   *      2 (both under `src/__tests__/`); the tracked `sdui.manifest.json` —
   *      the only manifest this repo produces, serialized from objectui's live
   *      registry — carries zero `binding` keys across all 339 of its inputs;
   *      and nothing outside this package reads `binding` or
   *      `bindings[].kind` at all, the package's single importer
   *      (`@objectstack/lint`'s `validate-jsx-pages.ts`) destructuring
   *      `{ diagnostics }` only.
   *
   * The reopen route is the ruling's own: a MEASURED need for field bindings
   * is filed as a widening with the vocabulary decided then — not pre-declared
   * here for a producer that does not exist. The refusal is pinned in
   * `src/__tests__/binding-field-retired.test.ts`.
   */
  binding?: 'object';
  description?: string;
}

export interface ManifestComponent {
  type: string;
  /** plugin namespace — provenance that drives `requires` */
  namespace?: string;
  inputs: ManifestInput[];
  isContainer?: boolean;
}

export interface Manifest {
  /** keyed by component `type` */
  components: Record<string, ManifestComponent>;
}

/** Result of validating a compiled tree against the manifest. */
export interface ValidationResult {
  diagnostics: Diagnostic[];
  /** unique plugin namespaces referenced — the page's `requires` */
  requires: string[];
  /**
   * Binding sites the server must resolve against object schema.
   *
   * `kind` is a PRODUCER face, not a reader face: `validateTree` writes it,
   * copying {@link ManifestInput.binding} at the one site that builds this
   * array. So the subset relation that licenses a permissive READER runs the
   * other way here — a wider union accepts nothing extra, it obliges every
   * consumer to handle an arm this package cannot emit. That is why the
   * retired `'field'` arm is gone from this end as well; the measurements are
   * on {@link ManifestInput.binding}.
   */
  bindings: Array<{ tag: string; input: string; kind: 'object'; value: unknown }>;
}
