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
  /** marks a data-binding input the server must resolve (ADR-0080 §6.3) */
  binding?: 'object' | 'field';
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
  /** binding sites (object/field) the server must resolve against object schema */
  bindings: Array<{ tag: string; input: string; kind: 'object' | 'field'; value: unknown }>;
}
