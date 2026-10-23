// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0015 §4.2 · #25168] The ONE predicate behind "`object.external` only
 * when the object's datasource has `schemaMode !== 'managed'`".
 *
 * ADR-0015 §1 makes an object federated by the datasource it points to, and
 * §4.2 declares this invariant "enforced at metadata-load time, not in the Zod
 * schema, because the datasource may live in another artefact". Until this
 * module no load door enforced it: `defineStack`, `os validate` and the object
 * save door all accepted an `external` binding on a managed datasource. The
 * runtime then treated the object as federated (no DDL, its table never
 * created) while the boot validation and the write gate, which read the
 * datasource's `schemaMode`, treated it as managed and judged nothing.
 *
 * The rule needs two facts, and the doors see them differently, so it has two
 * readers and one judgement:
 *
 * - the object's own `datasource` is `'default'` — the platform's primary
 *   datasource, which the host declares and owns and which is managed by
 *   construction (a stack cannot declare that name: `defineStack` refuses it
 *   as host-reserved). That half needs nothing but the object, so
 *   `ObjectSchema`'s refinement judges it (`object.zod.ts`), and every door
 *   that parses an object inherits it: `ObjectSchema.create` at module load,
 *   `defineStack`, `os validate`, the object save door, and the stored-row
 *   diagnostics;
 * - the object names another datasource, and that datasource's definition is
 *   visible to the door and declares `schemaMode: 'managed'` (or no
 *   `schemaMode`, which is managed by the spec default). `defineStack`'s
 *   cross-reference pass judges it for a datasource the same stack declares,
 *   and `composeStacks`' artifact pass for one another input of the
 *   composition declares (`stack.zod.ts`). [#25211] At runtime the metadata
 *   save doors (`@objectstack/metadata-protocol`) judge the pair from both
 *   sides: an object saved with `external`, against the datasource it names
 *   (a stored row or a registered definition), and a datasource saved as
 *   managed, against the objects that bind it with `external`; the draft
 *   promotion judges both again. A datasource no door can see gets no
 *   verdict: absence of a definition is not evidence about its `schemaMode`.
 *
 * Why the object's OWN `datasource`, and not the datasource a package
 * `defaultDatasource` or a `datasourceMapping` rule routes it to: ADR-0015's
 * boot validation and write gate read `object.datasource` and treat
 * `'default'` as the managed primary, so an `external` object routed only by
 * a mapping is queried on the routed driver while neither gate judges it. The
 * binding is a declaration about the object, so it is the object that names
 * where its remote table lives.
 *
 * [#25211] Exported from `@objectstack/spec/data` for the runtime save doors,
 * so the rule and its message keep one copy: a door resolves what it can see
 * and asks this function, ⛔ never a reimplementation of the judgement.
 */

/** The host's primary datasource — `HOST_RESERVED_DATASOURCE_NAME` in `stack.zod.ts`, managed by construction. */
const PRIMARY_DATASOURCE = 'default';

/** Why an object's `external` binding is refused — see {@link externalBindingDatasourceRefusal}. */
export interface ExternalBindingDatasourceRefusal {
  /** Where the refusal is reported: the binding itself. */
  readonly path: 'external';
  /**
   * `primary` — the object's `datasource` is `'default'`, written or by
   * default; `managed` — it names a datasource whose definition declares
   * `schemaMode: 'managed'` or none.
   */
  readonly shape: 'primary' | 'managed';
  /** The datasource the object names (`'default'` when it names none). */
  readonly datasource: string;
  /** The refusal's message, naming the object, the rule and the fix. */
  readonly message: string;
}

const RULE =
  "ADR-0015 §4.2 allows `external` only on a datasource whose `schemaMode` is not 'managed'.";

const KEEP_MANAGED = 'or remove `external` to keep this a managed object.';

/**
 * Judge one object's ADR-0015 `external` binding against the datasource it
 * names. `undefined` means this door has no refusal to make — either the
 * binding is allowed, or the verdict needs a datasource definition this door
 * cannot see.
 *
 * `declared` is the named datasource's definition as this door sees it, or
 * `undefined` when the door cannot see one. It is read on either a parsed or
 * a stored body: an absent `schemaMode` is the spec default, `'managed'`.
 *
 * Read on the PARSED object or a stored body alike: an omitted `datasource`
 * is `'default'` on both (`ObjectSchema.datasource` defaults to it).
 */
export function externalBindingDatasourceRefusal(
  objectName: unknown,
  external: unknown,
  datasource: unknown,
  declared?: { readonly schemaMode?: unknown },
): ExternalBindingDatasourceRefusal | undefined {
  if (external === undefined || external === null) return undefined;
  const name = typeof objectName === 'string' && objectName.length > 0 ? objectName : '(unnamed)';
  const ds = typeof datasource === 'string' && datasource.length > 0 ? datasource : PRIMARY_DATASOURCE;

  if (ds === PRIMARY_DATASOURCE) {
    return {
      path: 'external',
      shape: 'primary',
      datasource: ds,
      message:
        `Object '${name}' declares \`external\`, but its \`datasource\` is '${PRIMARY_DATASOURCE}' (also the value `
        + 'when none is written): the platform\'s primary datasource, which is managed, so ObjectStack owns its schema '
        + `and creates its tables. ${RULE} Set \`datasource\` on the object to the name of a datasource declared with `
        + "`schemaMode: 'external'` (or 'validate-only') that holds the remote table, "
        + `${KEEP_MANAGED} A package \`defaultDatasource\` or a \`datasourceMapping\` rule does not count: they `
        + 'route queries, while the boot validation and the write gate read the object\'s own `datasource`.',
    };
  }

  if (declared === undefined) return undefined;
  const schemaMode = declared.schemaMode ?? 'managed';
  if (schemaMode !== 'managed') return undefined;
  return {
    path: 'external',
    shape: 'managed',
    datasource: ds,
    message:
      `Object '${name}' declares \`external\` on datasource '${ds}', whose \`schemaMode\` is 'managed' (the default `
      + `when none is declared), so ObjectStack owns its schema and creates its tables. ${RULE} If '${ds}' is a `
      + "database ObjectStack does not own, declare it with `schemaMode: 'external'` (or 'validate-only') and its "
      + `\`external\` settings; ${KEEP_MANAGED}`,
  };
}
