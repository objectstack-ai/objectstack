/**
 * ObjectUI — SDUI JSX-source parser (ADR-0080)
 *
 * Types shared by the constrained JSX-source compiler. The parser turns a
 * constrained JSX *text* into an SDUI node tree (`ParsedSchemaNode`, below).
 * It PARSES — it never executes. No `import`, no `eval`, no JS.
 */

/**
 * A node in the compiled SDUI tree, as parsed: an element or a text child.
 *
 * Not `SchemaNode`: `@object-ui/types` publishes that name for the closed
 * AUTHORING face, a union discriminated on a literal `type` with no index
 * signature and with primitive children admitted. This is the parser's open,
 * as-parsed data (any `type` string, the keys as authored), neither is
 * assignable to the other, and this package takes no runtime dependency on
 * `@object-ui/types` to re-export from. One exported name stood for both until
 * this declaration was renamed (objectui#6349, batch 11).
 */
export type ParsedSchemaNode = SchemaElement | string;

export interface SchemaElement {
  type: string;
  children?: ParsedSchemaNode[];
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
  /**
   * The coarse kind of the input's MEMBERS — array elements, or the values of
   * an object used as a map — as ONE kind or an ARRAY of kinds for a member
   * contract that is a union (objectui#8067).
   *
   * Absent means "not declared", which is what every input published before
   * this key existed says: {@link validateTree} checks no member and the
   * codegen emits the unnarrowed element type, exactly as before. So a
   * manifest gains this key only where a member kind was really declared, and
   * every already-published entry serializes byte-identically.
   *
   * Read the arms through `inputTypeArms(input.of)` — the same accessor
   * `type`'s arms go through, since the two fields carry the same shape and a
   * reader that forgets the array form is silently inert on it.
   */
  of?: ManifestInputType | ManifestInputType[];
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
   * ## The vocabulary is exactly `'object'` — `'field'` is retired on this face too
   *
   * `'field'` stood beside it from the first draft of ADR-0080 and was never
   * written. It was retired on the serializer's INPUT boundary
   * (`RegistryConfigLike` in `index.ts`) under ADR-0049 enforce-or-remove by
   * the maintainer ruling of 2026-09-07 (decision batch #69), and on THIS
   * face by objectui#8315 — the residue that ruling did not name, which left
   * one published package narrow on one face and wide on the other.
   *
   * ⚠️ The argument for leaving this face wide was ANSWERED, not overlooked.
   * It runs: producer → reader is a subset relation, so a reader accepting a
   * value no producer emits is permissive rather than wrong. Three measured
   * facts decided against it (objectui#8315):
   *
   *   1. **This is not a pure reader face.** `manifestFromConfigs` RETURNS a
   *      `Manifest`, so `ManifestInput` is also this package's OUTPUT type,
   *      and this key is fed straight from the already-narrowed boundary. A
   *      union wider than the producer's is imprecision on the way out, not
   *      permissiveness on the way in.
   *   2. **Its sibling is a pure producer face.**
   *      `ManifestValidationResult.bindings[].kind` is written by
   *      `validateTree` by copying this key, so the subset relation runs the
   *      other way there — see that declaration. The two are COUPLED by that
   *      assignment: narrowing one alone needs a cast at the only conversion
   *      site, which is the lenient fallback AGENTS.md #0.1 bans. So "both
   *      narrow" and "both wide" were the only self-consistent states, and
   *      only one of them can be justified on the producer face.
   *   3. **The permissiveness protected nothing.** `binding: 'field'` has
   *      zero writers here and zero in the objectstack copy of this package
   *      (measured 2026-09-09 on both heads, each with a firing
   *      `binding: 'object'` control), and the only manifest producer in
   *      either tree is `manifestFromConfigs`, whose input face is narrow.
   *
   * The reopen route is the ruling's own: a MEASURED need for field bindings
   * is filed as a widening with the vocabulary decided then — not
   * pre-declared here for a producer that does not exist.
   */
  binding?: 'object';
  description?: string;
}

export interface ManifestComponent {
  type: string;
  /** plugin namespace — provenance that drives `requires` */
  namespace?: string;
  /**
   * The declared authoring surface. An input named `children` (type `slot`)
   * is ALSO the containment declaration: `validateTree` draws
   * `not-a-container` on a child list under any component whose `inputs`
   * carry no such entry (objectui#9910; `acceptsChildren` in `validate.ts`).
   */
  inputs: ManifestInput[];
  /**
   * The NODE SLOTS this component's renderer reads besides `children`
   * (objectui#11170): positions in the key-path grammar `@object-ui/types`'
   * `NODE_SLOT_DECLARATIONS` states — `trigger`, `items[].content`,
   * `regions[].components`. `validateTree` descends each one the way it
   * descends `children`, so a slot-held node is judged too. Projected from
   * that one declaration by `manifestFromConfigs`'s `slotsFor` option; the
   * authoring tier leaves the declaration's RETIRED positions out, as the
   * spec's own authoring walks do. ⛔ This tier keeps no slot list of its own:
   * a manifest built without the option carries none, and the walk then
   * follows `children` alone.
   */
  slots?: readonly string[];
  /**
   * LAYOUT containment (objectui#6804, objectui#9910 Q2-A): the flag the
   * react-page JSX scope builder skips and the public layout ledger lists.
   * ⛔ Not "accepts children" — this tier's containment check does not read it.
   */
  isContainer?: boolean;
  /**
   * The authoring tier this entry belongs to (objectui#10735).
   *
   * Absent = the curated PUBLIC tier (ADR-0080 §4), the JSON-surface
   * AI-authoring vocabulary. `'html'` = one of the intrinsic HTML elements a
   * `kind:'html'` page may author (ADR-0081 §2), declared by the registry's
   * `HTML_TIER_INTRINSICS` roster and carried here so the ONE flat `components`
   * map can serve both of its readers: a whitelist reader (`compile`, the
   * objectstack gate) takes every key and needs no change; a reader that means
   * the curated vocabulary — the `kind:'react'` scope, the block list, a census
   * of curated blocks — filters this key out.
   *
   * ⛔ Not the registration's `tier` copied through. `manifestFromConfigs`
   * writes exactly `'html'` or nothing, so every entry published before this
   * key existed serialises byte-identically.
   */
  tier?: 'html';
}

export interface Manifest {
  /** keyed by component `type` */
  components: Record<string, ManifestComponent>;
}

/**
 * Result of validating a compiled tree against the MANIFEST.
 *
 * Named `ManifestValidationResult`, not `ValidationResult` (objectui#3161,
 * objectstack#4115 ledger batch 7), following the convention registered on
 * objectstack#4115 for this name: **`<what was validated>Validation<Error |
 * Result>`**. `ValidationResult` is exported twice by the spec — `kernel` and
 * `contracts`, both `{ valid, errors?: [{ field, message, code? }], warnings? }`
 * for PLUGIN MANIFEST validation — and `@object-ui/core` took
 * `SchemaNodeValidationResult` under the same convention in batch 4
 * (objectui#3188). Three results, three subjects: a plugin, a schema node, and
 * this one, which carries no `valid` flag at all — it returns `diagnostics`
 * (severity lives per entry), the `requires` set the compiled page needs, and
 * the binding sites the server must resolve. Nothing here is assignable to
 * anything there in either direction.
 */
export interface ManifestValidationResult {
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
   * retired `'field'` arm (`9e37d9b39` on the input boundary, objectui#8315
   * here) is gone from this end as well; the measurements are on
   * {@link ManifestInput.binding}.
   */
  bindings: Array<{ tag: string; input: string; kind: 'object'; value: unknown }>;
}
