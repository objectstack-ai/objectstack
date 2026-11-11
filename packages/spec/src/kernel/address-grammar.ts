// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The address grammar of the by-name doors (ADR-0150 D5).
 *
 * A by-name door keeps its bare form and accepts a qualified form with the
 * package's manifest `namespace` before the name:
 *
 * | Door | Bare (kept) | Qualified |
 * |:--|:--|:--|
 * | automation | `/automation/:name[/runs …]`, `/automation/trigger/:name` | `/automation/:ns/:name[/runs …]`, `/automation/trigger/:ns/:name` |
 * | inbound hook | `/automation/hooks/:flowName/:hookId` | `/automation/hooks/:ns/:flowName/:hookId` |
 * | actions | `/actions/:object/:action[/:recordId]`, `/actions/global/:action` | `/actions/:ns/:object/:action[/:recordId]`, `/actions/:ns/global/:action` |
 * | metadata | `/meta/:type/:name` | `/meta/:type/:ns/:name` |
 * | connectors | `/automation/connectors/:name/connection` | `/automation/connectors/:ns/:name/connection` |
 *
 * This module is the one declaration of the pieces every reader of that
 * grammar shares: the namespace grammar, the reserved environment segment, the
 * router-reserved `_` prefix, the literal segments each door serves at its
 * namespace position, and the router's precedence over a segment in that
 * position. It declares; it routes nothing. The doors that read it (child G1),
 * the install gate that refuses a namespace spelling a literal (G1, objectql
 * `installPackage`) and `route-ledger.conformance.test.ts`, which pins
 * {@link NAMESPACE_POSITION_LITERALS} against the `ROUTE_LEDGER` rows, are
 * the consumers that wire it.
 */

/**
 * The manifest `namespace` grammar: 2–20 characters, a lowercase letter, then
 * lowercase letters, digits or `_`. `manifest.zod.ts` binds it on
 * `manifest.namespace`, and the install gate keeps a namespace unique per
 * environment (ADR-0048 §3.2). No namespace contains `-` or starts with `_`,
 * which is what lets {@link ENVIRONMENT_ADDRESS_SEGMENT} and the `_`-led
 * literals never read as one.
 */
export const NAMESPACE_PATTERN = /^[a-z][a-z0-9_]{1,19}$/;

/**
 * The reserved segment that addresses an environment-authored item, which has
 * no namespace (ADR-0150 D2, D5): `/automation/_env/:name`,
 * `/actions/_env/:object/:action`, and so on. A `_`-led segment is never a
 * namespace ({@link NAMESPACE_PATTERN}) and never an item name of a bucket 2/3
 * type ({@link ROUTER_ADDRESSABLE_NAME_PATTERN}), so an environment item keeps
 * every sub-resource door through it even when its bare name equals a
 * namespace installed after it was saved.
 */
export const ENVIRONMENT_ADDRESS_SEGMENT = '_env';

/**
 * The leading character the router reserves for its own segments (`_env`,
 * `_status`, `_activation`, `_drafts`, …). No namespace starts with it, and
 * since ADR-0150 D5 no name of a bucket 2/3 type does either.
 */
export const ROUTER_RESERVED_NAME_PREFIX = '_';

/**
 * The name grammar of a bucket 2/3 type whose own schema used to admit a
 * leading `_` (`^[a-z_][a-z0-9_]*$`): tool, skill, agent, flow, hook,
 * connector, sharing rule, job, analytics cube and api endpoint. A name
 * starts with a lowercase letter; the rest of buckets 2–3 already spell names
 * with `SnakeCaseIdentifierSchema`, which is the same pattern.
 *
 * It binds every row of those types, an environment-authored one included,
 * and it is refused at `defineStack`, `os validate` and the save door — a
 * declared narrowing of ADR-0150 D5 (first-party count when it landed: 0).
 * Names that were already letter-led stay valid unchanged.
 */
export const ROUTER_ADDRESSABLE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * The refusal a bucket 2/3 schema attaches to {@link ROUTER_ADDRESSABLE_NAME_PATTERN}.
 * It names the reserved prefix, because a `_`-led name is the one spelling the
 * pattern newly refuses and the author needs to know why.
 */
export const ROUTER_ADDRESSABLE_NAME_MESSAGE =
  'Name must be lowercase snake_case starting with a letter (e.g. "send_welcome_email"). '
  + 'A leading "_" is reserved for the router\'s own address segments, such as "_env" and '
  + '"_status" (ADR-0150 D5): rename the item without it.';

/** The doors whose path carries an optional namespace segment (ADR-0150 D5). */
export type AddressDoor =
  | 'automation'
  | 'automationTrigger'
  | 'inboundHook'
  | 'actions'
  | 'meta'
  | 'connectors';

/** One door's namespace position: the path before it, and the literals served there. */
export interface NamespacePosition {
  /**
   * The route-ledger path up to, and not including, the namespace position —
   * the segment after this prefix is the one the router reads with
   * {@link readNamespacePositionSegment}. `:type` stands for the metadata type
   * parameter, as the ledger spells it.
   */
  readonly prefix: string;
  /**
   * Every literal segment a `ROUTE_LEDGER` row serves at this position, in
   * code-unit order. A literal is read as the literal before any namespace
   * (D5 step 1), whether it is letter-led (`trigger`) or `_`-led (`_status`).
   * A row serves a literal here when it spells the prefix, or when a
   * parameter of its own reads the prefix's last segment and the row has the
   * verb and arity of the door's qualified form (`runs` under
   * `/automation/hooks`, see {@link NAMESPACE_POSITION_LITERALS}).
   */
  readonly literals: readonly string[];
}

/**
 * The literal segments each door serves where the qualified form puts the
 * namespace — the set the router reads first (D5 step 1).
 *
 * Measured off `ROUTE_LEDGER` (`packages/runtime/src/route-ledger.ts`); the
 * conformance test there pins this constant against the ledger rows so the
 * two never drift. `actions` carries the empty segment of
 * `POST /actions//:action`, the object-less spelling of the global-action
 * call: it is a routed literal at this position, and no namespace is empty.
 * The metadata door's namespace position is the one after `:type`; no row
 * serves a literal there (`_drafts`, `_migrate-stored` and `types` sit in the
 * type position, before it).
 *
 * `inboundHook` carries `runs`, which no row spells under `/automation/hooks`.
 * `POST /automation/:name/runs/:runId/resume`, `…/cancel` and
 * `…/restore-suspension` are, for a flow named `hooks`, the verb and arity of
 * the qualified hook (`POST /automation/hooks/:ns/:flowName/:hookId`), and
 * they stay the gated run doors of that flow. So `runs` in the hook's
 * namespace position is read as their literal, never as a namespace: the
 * anonymous allow-list row and the trigger mount read this entry
 * (`INBOUND_HOOK_QUALIFIER_EXCLUSIONS`, `@objectstack/core`), and a package
 * namespaced `runs` would have no qualified hook address.
 */
export const NAMESPACE_POSITION_LITERALS: Readonly<Record<AddressDoor, NamespacePosition>> = Object.freeze({
  automation: Object.freeze({
    prefix: '/automation',
    literals: Object.freeze(['_status', 'actions', 'connectors', 'hooks', 'trigger']),
  }),
  automationTrigger: Object.freeze({ prefix: '/automation/trigger', literals: Object.freeze([]) }),
  inboundHook: Object.freeze({ prefix: '/automation/hooks', literals: Object.freeze(['runs']) }),
  actions: Object.freeze({ prefix: '/actions', literals: Object.freeze(['', '_activation', 'global']) }),
  meta: Object.freeze({ prefix: '/meta/:type', literals: Object.freeze([]) }),
  connectors: Object.freeze({
    prefix: '/automation/connectors',
    literals: Object.freeze(['credential-refs', 'oauth']),
  }),
});

/**
 * The namespace-position literals the namespace grammar admits — the ones a
 * package could declare as its namespace, and so the set the install gate
 * refuses (ADR-0150 D5, child G1). Derived from
 * {@link NAMESPACE_POSITION_LITERALS}, so a literal a new route adds joins it
 * in the same change. The `_`-led literals, the empty segment and
 * `credential-refs` are absent because no namespace can spell them.
 */
export const NAMESPACE_REFUSED_LITERALS: readonly string[] = Object.freeze(
  [...new Set(Object.values(NAMESPACE_POSITION_LITERALS).flatMap((p) => p.literals))]
    .filter((literal) => NAMESPACE_PATTERN.test(literal))
    .sort(),
);

/**
 * Judge a namespace against the address grammar's literals.
 *
 * Returns an actionable refusal naming the literal and the doors that serve
 * it, or `null` when the namespace spells none. Only the grammar is judged
 * here: whether the namespace is well-formed, reserved or already installed
 * is the manifest schema's and the install gate's question.
 */
export function validateNamespaceNotAddressLiteral(namespace: string | undefined): string | null {
  if (!namespace || !NAMESPACE_REFUSED_LITERALS.includes(namespace)) return null;
  const doors = (Object.keys(NAMESPACE_POSITION_LITERALS) as AddressDoor[])
    .filter((door) => NAMESPACE_POSITION_LITERALS[door].literals.includes(namespace))
    .map((door) => `${NAMESPACE_POSITION_LITERALS[door].prefix}/${namespace}`);
  return `Namespace '${namespace}' spells a literal segment of the address grammar (${doors.join(', ')}), `
    + 'which the router reads before any namespace, so the package\'s qualified addresses would never reach it '
    + '(ADR-0150 D5). Choose another namespace.';
}

/** How the router reads the segment in a door's namespace position (ADR-0150 D5). */
export type NamespacePositionReading =
  /** Step 1: a literal the door serves at this position (`trigger`, `global`, `_status`, …). */
  | { readonly reading: 'literal'; readonly literal: string }
  /** Step 1: the reserved environment segment; the item after it is environment-authored. */
  | { readonly reading: 'environment' }
  /** Step 2: an installed namespace; the item after it is that namespace's. */
  | { readonly reading: 'namespace'; readonly namespace: string }
  /** Step 3: none of the above; the segment is the bare grammar's first segment. */
  | { readonly reading: 'bare' };

/**
 * Read the segment in a door's namespace position, in the router's documented
 * order (ADR-0150 D5): the grammar's literal segments win, then the reserved
 * environment segment, then an installed namespace, else the bare grammar.
 *
 * `isInstalledNamespace` is the environment's namespace catalogue, which the
 * caller holds; this function never guesses one. A bare reading is not a
 * resolution: a bare name with two holders is still the door's `409` with the
 * candidate qualified addresses, never a pick.
 */
export function readNamespacePositionSegment(
  door: AddressDoor,
  segment: string,
  isInstalledNamespace: (segment: string) => boolean,
): NamespacePositionReading {
  if (NAMESPACE_POSITION_LITERALS[door].literals.includes(segment)) {
    return { reading: 'literal', literal: segment };
  }
  if (segment === ENVIRONMENT_ADDRESS_SEGMENT) return { reading: 'environment' };
  if (NAMESPACE_PATTERN.test(segment) && isInstalledNamespace(segment)) {
    return { reading: 'namespace', namespace: segment };
  }
  return { reading: 'bare' };
}
