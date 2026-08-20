/**
 * @objectstack/sdui-parser — constrained JSX-source → SDUI SchemaNode tree (ADR-0080)
 *
 * Isomorphic, zero React. Run server-side as the authoritative save-time gate;
 * may also run client-side for live edit preview (re-validated on the server —
 * never the trust boundary). It PARSES; it never executes.
 */

export * from './types.js';
export { parseJsx, interpretBrace } from './parse.js';
export { validateTree } from './validate.js';
export { generateDts, propsName, generateBlockList } from './codegen.js';
export type { CodegenOptions } from './codegen.js';

import { parseJsx } from './parse.js';
import { validateTree } from './validate.js';
import type { Diagnostic, Manifest, SchemaElement, ValidationResult } from './types.js';

export interface CompileResult {
  tree: SchemaElement | null;
  diagnostics: Diagnostic[];
  requires: string[];
  bindings: ValidationResult['bindings'];
  /** true when there are no error-severity diagnostics — the save gate's pass/fail */
  ok: boolean;
}

/**
 * The authoritative pipeline: parse (with the manifest's tags as the whitelist)
 * → validate against the manifest → derive `requires` + binding sites.
 */
export function compile(source: string, manifest: Manifest): CompileResult {
  const allowedTags = new Set(Object.keys(manifest.components));
  const parsed = parseJsx(source, { allowedTags });
  const validated = validateTree(parsed.tree, manifest);
  const diagnostics = [...parsed.diagnostics, ...validated.diagnostics];
  return {
    tree: parsed.tree,
    diagnostics,
    requires: validated.requires,
    bindings: validated.bindings,
    ok: !diagnostics.some((d) => d.severity === 'error'),
  };
}

/* ------------------------------------------------------------------ *
 * Registry → manifest adapter. Structural input (no @object-ui/core
 * dependency) so the package stays pure and hoistable to framework.
 * Feed it `ComponentRegistry.getAllConfigs()` (optionally filtered to
 * the `tier:'public'` set).
 * ------------------------------------------------------------------ */

export interface RegistryConfigLike {
  type: string;
  namespace?: string;
  isContainer?: boolean;
  /** ADR-0080 contract tier — only 'public' configs form the AI/contract surface. */
  tier?: 'public' | 'internal';
  label?: string;
  category?: string;
  inputs?: Array<{
    name: string;
    type: string;
    required?: boolean;
    enum?: Array<string | { value: unknown; label?: string }>;
    binding?: 'object' | 'field';
    description?: string;
  }>;
}

const INPUT_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'enum',
  'array',
  'object',
  'color',
  'date',
  'code',
  'file',
  'slot',
]);

export function manifestFromConfigs(
  configs: RegistryConfigLike[],
  opts: { only?: Set<string>; publicOnly?: boolean } = {},
): Manifest {
  const components: Manifest['components'] = {};
  for (const c of configs) {
    if (opts.only && !opts.only.has(c.type)) continue;
    if (opts.publicOnly && c.tier !== 'public') continue;
    components[c.type] = {
      type: c.type,
      namespace: c.namespace,
      isContainer: c.isContainer,
      inputs: (c.inputs ?? []).map((i) => ({
        name: i.name,
        type: (INPUT_TYPES.has(i.type) ? i.type : 'string') as Manifest['components'][string]['inputs'][number]['type'],
        required: i.required,
        enum: i.enum,
        binding: i.binding,
        description: i.description,
      })),
    };
  }
  return { components };
}
