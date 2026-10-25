/**
 * @object-ui/sdui-parser — constrained JSX-source → SDUI SchemaNode tree (ADR-0080)
 *
 * Isomorphic, zero React. Run server-side as the authoritative save-time gate;
 * may also run client-side for live edit preview (re-validated on the server —
 * never the trust boundary). It PARSES; it never executes.
 */

export * from './types.js';
export { parseJsx, interpretBrace } from './parse.js';
export { HTML_TIER_NODE, isHtmlTierNode, markHtmlTierNode } from './provenance.js';
export { validateTree, acceptsChildren, CHILD_LIST_KEY, SDUI_BASE_PROPS } from './validate.js';
export type { SduiBaseProp, SduiBasePropScope } from './validate.js';
export {
  checkDashboardWidgetOptions,
  CONSUMED_WIDGET_OPTION_KEYS,
  DASHBOARD_WIDGET_HOST_TYPES,
  UNCONSUMED_WIDGET_OPTION,
} from './dashboard-widget-options.js';
export { generateDts, propsName, generateBlockList } from './codegen.js';
export type { CodegenOptions } from './codegen.js';
export { inputTypeArms, canonicalizeInputType, MANIFEST_INPUT_TYPES } from './input-type.js';
export { checkRetiredBodyDialect, RETIRED_CHILD_LIST_KEY } from './body-dialect.js';

import { parseJsx } from './parse.js';
import { validateTree } from './validate.js';
import { canonicalizeInputType } from './input-type.js';
import type { Diagnostic, Manifest, SchemaElement, ManifestValidationResult } from './types.js';

export interface CompileResult {
  tree: SchemaElement | null;
  diagnostics: Diagnostic[];
  requires: string[];
  bindings: ManifestValidationResult['bindings'];
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

/**
 * The shape of one `@object-ui/types` `NodeSlotDeclaration`, restated
 * structurally because this package imports nothing at runtime: a position in
 * that package's key-path grammar, and whether its spelling is retired.
 */
export interface NodeSlotDeclarationLike {
  readonly path: string;
  readonly retired?: boolean;
}

export interface RegistryConfigLike {
  type: string;
  namespace?: string;
  /**
   * LAYOUT containment — the registration's `ComponentMeta.isContainer`,
   * carried through to the manifest for the consumers that read it there.
   * ⛔ It does not mean "accepts children" and `validateTree` does not read
   * it: whether a component takes an authored child list is declared as an
   * input named `children` (objectui#9910; `acceptsChildren` in `validate.ts`).
   */
  isContainer?: boolean;
  /**
   * ADR-0080 contract tier — only 'public' configs form the AI/contract
   * surface under `publicOnly`. `'html'` is the projection-only stamp
   * `ComponentRegistry.getPublicConfigs()` puts on the html tier's intrinsic
   * elements (objectui#10735); it is the one value {@link manifestFromConfigs}
   * carries into `ManifestComponent.tier`.
   */
  tier?: 'public' | 'internal' | 'html';
  label?: string;
  category?: string;
  inputs?: Array<{
    name: string;
    /**
     * One coarse kind, or the arms of a union (objectui#3832). Typed loosely
     * (`string`) on purpose — this interface is the STRUCTURAL boundary that
     * keeps this package free of a dependency on the registry, so an
     * off-vocabulary value has to be representable here and is normalized by
     * `canonicalizeInputType` on the way in.
     */
    type: string | string[];
    /**
     * The declared member kind(s) — array elements, or an object map's values
     * (objectui#8067). Typed as loosely as `type` above and for the same
     * reason: this interface is the STRUCTURAL boundary that keeps the package
     * free of a registry dependency, so an off-vocabulary value has to be
     * representable here and is normalized on the way in.
     */
    of?: string | string[];
    required?: boolean;
    enum?: Array<string | { value: unknown; label?: string }>;
    /**
     * The binding marker — exactly `'object'` (`9e37d9b39`).
     *
     * `'field'` was declared beside it from the first draft of ADR-0080 §6.3
     * and never written: every `binding:` literal in `packages/`, `apps/`
     * and `examples/` is `'object'` (7 of 7, measured 2026-09-06 and
     * re-measured at the retiring PR's merge-base), and nothing on either
     * side of the manifest resolved a field binding. Retired under ADR-0049
     * enforce-or-remove by the maintainer ruling of 2026-09-07 (decision
     * batch #69): a config that spells the arm is a `tsc` error here rather
     * than an entry the server would never resolve.
     *
     * The retirement then reached the two faces the ruling did not name
     * (objectui#8315): `ManifestInput.binding` and
     * `ManifestValidationResult.bindings[].kind` in `types.ts` read `'object'`
     * too, so the published package no longer narrows on one face and stays
     * wide on the other. The argument for keeping the manifest face wide —
     * producer → reader is a subset relation — is answered at
     * `ManifestInput.binding`, which is where a later reader lands.
     *
     * Only the framework writes the key: `InjectedComponentInput` in
     * `@object-ui/types`, spliced by `Registry.register`. `ComponentInput`
     * itself has no `binding` member, deliberately.
     */
    binding?: 'object';
    description?: string;
  }>;
  /**
   * True when the registry entry is a pending lazy stub — registered, but its
   * plugin module has not been imported, so it carries metadata and no
   * `inputs`. See {@link assertFullyLoaded}.
   */
  lazy?: boolean;
}

/**
 * Build-time guard for the manifest generators.
 *
 * A manifest is the contract's frozen form: the parser's tag whitelist and the
 * save gate's prop validator both read it. So it has to be generated from
 * FULLY LOADED registrations. A `lazy: true` entry means the generator never
 * imported that plugin, and the block would be written out with empty
 * `inputs` — indistinguishable from a block that legitimately takes no props,
 * which turns every prop an author writes on it into an `unknown-prop`
 * diagnostic. Wrong quietly, in the artifact everything downstream trusts.
 *
 * The generators keep their own eager import list, so this is what catches it
 * drifting behind the app's registration list (objectui#2953 was the same
 * class of bug one layer down).
 */
export function assertFullyLoaded(configs: RegistryConfigLike[]): void {
  const stubs = configs.filter((c) => c.lazy).map((c) => c.type).sort();
  if (stubs.length === 0) return;
  throw new Error(
    `Manifest generation saw ${stubs.length} not-yet-loaded lazy block(s): ${stubs.join(', ')}.\n` +
      `A manifest must describe loaded registrations — these would be written out with no \`inputs\`, ` +
      `so every prop an author passes them would be reported as unknown.\n` +
      `Add an eager \`import\` of each block's plugin to the generator entry.`,
  );
}

/* The arm vocabulary and the two projections over it now live in
 * `input-type.ts` — `manifestFromConfigs` below, `validateTree` and the codegen
 * all read `ManifestInput.type` and must agree on how, since it holds one arm
 * or an array of them (objectui#3832). */

/**
 * Project registry configs into the SDUI manifest.
 *
 * ⚠️ Every field here is copied from what the registration **declared**. In
 * particular `inputs` is `config.inputs` verbatim — this function does not, and
 * cannot, observe whether the renderer behind the block reads any of them.
 *
 * Worth stating because of what consumes the output. The framework's
 * `check:react-blocks-declaration-parity` diffs this against the spec's zod
 * schemas, and while that check was named `check:react-conformance` it was read
 * — by its own file header — as confirming the components "ACTUALLY implement"
 * the spec's props. It never could: both sides of that diff are declarations,
 * and this is the side this file produces. Four blocks published an `objectName`
 * no renderer read and sailed through it green (objectstack#4413; corrected in
 * objectstack#4472). Evidence about the render path has to come from the render
 * path — see `apps/console/src/__tests__/public-block-binding-reach.test.tsx`.
 *
 * `opts.slotsFor` is the one exception to "copied from the registration", and
 * it is a DECLARATION too (objectui#11170): hand it `nodeSlotsFor` from
 * `@object-ui/types` and every entry carries `slots`, the node-slot positions
 * that type's renderer reads besides `children`, so `validateTree` judges the
 * nodes under them. This package has no runtime dependency and so cannot
 * import the declaration itself; the producers that build a live manifest
 * (`getJsxManifest` in `@object-ui/components`' page renderer, the console's
 * manifest generator) pass it. A RETIRED position is left out here: this is
 * the authoring tier, and the spec's own authoring walks skip the tombstoned
 * spellings for the same reason. Without the option no `slots` key is written,
 * so every manifest built before the option existed serialises byte-identically.
 */
export function manifestFromConfigs(
  configs: RegistryConfigLike[],
  opts: {
    only?: Set<string>;
    publicOnly?: boolean;
    slotsFor?: (type: string) => readonly NodeSlotDeclarationLike[];
  } = {},
): Manifest {
  const components: Manifest['components'] = {};
  for (const c of configs) {
    if (opts.only && !opts.only.has(c.type)) continue;
    if (opts.publicOnly && c.tier !== 'public') continue;
    const slots = opts.slotsFor
      ? opts.slotsFor(c.type).filter((s) => !s.retired).map((s) => s.path)
      : undefined;
    components[c.type] = {
      type: c.type,
      namespace: c.namespace,
      isContainer: c.isContainer,
      // `undefined` is dropped by `JSON.stringify`, so a manifest built with
      // no resolver — or an entry with no slots — serialises exactly as before
      // this key existed.
      slots: slots && slots.length > 0 ? slots : undefined,
      // The html tier's stamp, and ONLY that stamp (objectui#10735): a
      // registration's `'public'` / `'internal'` is registry mechanics the
      // manifest never carried, and `undefined` is dropped by `JSON.stringify`,
      // so every curated entry serialises exactly as before this key existed.
      tier: c.tier === 'html' ? 'html' : undefined,
      inputs: (c.inputs ?? []).map((i) => ({
        name: i.name,
        type: canonicalizeInputType(i.type),
        // Undefined stays undefined rather than going through
        // `canonicalizeInputType`, whose no-arms fallback is `'string'`: an
        // input that declares no member kind must publish NO `of`, or every
        // array in every manifest would suddenly claim string members it was
        // never told it had. `JSON.stringify` drops the undefined key, so the
        // published artifact is byte-identical for every input that does not
        // declare one (objectui#8067).
        of: i.of === undefined ? undefined : canonicalizeInputType(i.of),
        required: i.required,
        enum: i.enum,
        binding: i.binding,
        description: i.description,
      })),
    };
  }
  return { components };
}
