// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D5, epic #31527 child G3] The qualified address of the by-name
 * calls this SDK makes: `automation.*`, `actions.invoke` and `meta.getItem`.
 *
 * A by-name door keeps its bare form and also accepts the package's namespace
 * (its manifest `namespace`) in front of the name, or the reserved `_env`
 * segment for an item authored in the environment:
 *
 * | Door | Bare | Qualified |
 * |:--|:--|:--|
 * | automation | `/automation/:name[/…]` | `/automation/:ns/:name[/…]` |
 * | legacy trigger | `/automation/trigger/:name` | `/automation/trigger/:ns/:name` |
 * | actions | `/actions/:object/:action` | `/actions/:ns/:object/:action` |
 * | metadata | `/meta/:type/:name` | `/meta/:type/:ns/:name` |
 *
 * Without a namespace every call builds exactly the URL it built before this
 * module existed. With one, the door resolves the name among that namespace's
 * packages only, and answers `409 RESOURCE_CONFLICT` naming every candidate
 * when the address names no one item. Nothing here resolves anything: the door
 * decides who holds the name.
 *
 * ## What is refused here, before any request
 *
 * The router reads a qualified path in a documented order (D5): the door's
 * literal segments first, then `_env`, then an installed namespace, else the
 * bare grammar. So some (namespace, name) pairs have no qualified path at all:
 * the path this SDK would build means another request to the router, and the
 * door would answer it as that request — another item's data under the
 * caller's type annotation, or another action run. Each of those pairs is
 * refused here with `400 VALIDATION_ERROR` (the code and status the door
 * answers a malformed address with) and nothing is sent:
 *
 *  - a namespace the namespace grammar does not admit (`NAMESPACE_PATTERN`),
 *    other than `_env`: the router reads such a segment as part of the bare
 *    address (on `/actions`, as the object of a different call);
 *  - a namespace that spells one of the door's own literal segments
 *    (`NAMESPACE_POSITION_LITERALS`, e.g. `global` on `/actions`, `trigger` on
 *    `/automation`): the router serves the literal's route there;
 *  - a name in the position a sub-resource literal holds: `/meta/app/crm/history`
 *    is the history of the app `crm`, never the app `history` of namespace
 *    `crm`, and `/automation/crm/runs` is the runs of the flow `crm` (seat
 *    ruling Q1 = A on #31691). After `_env` the automation door declines its own
 *    literals too.
 *
 * Whether a namespace is INSTALLED is the server's to know, not this SDK's. A
 * well-formed namespace that no installed package declares reads as the bare
 * grammar at the door, which answers it as it answers that bare path.
 *
 * The namespace grammar, the `_env` segment and the door literals are the
 * spec's one declaration (`@objectstack/spec/kernel`, `address-grammar.ts`).
 * The two sub-resource sets below are the doors' readings, which no spec
 * constant spells; `package-addressing.test.ts` holds each equal to the server's
 * own (the metadata protocol's export, and the `/automation/:name/…` rows of the
 * runtime route ledger).
 */

import {
  ENVIRONMENT_ADDRESS_SEGMENT,
  NAMESPACE_PATTERN,
  NAMESPACE_POSITION_LITERALS,
  type AddressDoor,
} from '@objectstack/spec/kernel';
import type { PackageScopedHolder } from '@objectstack/core';

/**
 * The qualifier of a by-name call (ADR-0150 D5).
 *
 * `namespace` is the manifest `namespace` of the package that holds the item
 * (e.g. `'crm'`), or `'_env'` (`ENVIRONMENT_ADDRESS_SEGMENT` in
 * `@objectstack/spec/kernel`) for an item authored in the environment, which
 * no package holds. Leave it out, or pass `undefined`, to call the bare
 * address exactly as before: it answers while the name has one holder in the
 * environment, and `409 RESOURCE_CONFLICT` with the candidates otherwise.
 */
export interface QualifiedAddressOptions {
  namespace?: string;
}

/**
 * The metadata door's sub-resource segments: the literals `GET /meta/:type/:name/…`
 * serves after an item's name. A qualified read puts the name in that position,
 * so an item named one of these has no qualified path; it is read with
 * `packageId` (`?package=`). Held equal to `META_ITEM_SUBRESOURCE_SEGMENTS` of
 * `@objectstack/metadata-protocol` by `package-addressing.test.ts`.
 */
export const META_ITEM_SUBRESOURCE_SEGMENTS: readonly string[] = Object.freeze([
  'audit', 'diff', 'history', 'layers', 'publish', 'published', 'references', 'rollback', 'tree',
]);

/**
 * The flow doors' sub-resource segments: the literals `/automation/:name/…`
 * serves after a flow's name. After a namespace the router keeps their bare
 * reading, so a flow named one of these has no qualified path under a
 * namespace; it is reached bare, or under `_env`. Held equal to the
 * `/automation/:name/<segment>` rows of the runtime route ledger by
 * `package-addressing.test.ts`.
 */
export const AUTOMATION_FLOW_SUBRESOURCE_SEGMENTS: readonly string[] = Object.freeze([
  'clone', 'runs', 'toggle', 'trigger',
]);

/** The refusal of an address that has no qualified path: thrown before any request. */
export type AddressRefusal = Error & { code: 'VALIDATION_ERROR'; httpStatus: 400 };

function addressRefusal(message: string): AddressRefusal {
  const error = new Error(`${message} The request was not sent (ADR-0150 D5).`) as AddressRefusal;
  error.code = 'VALIDATION_ERROR';
  error.httpStatus = 400;
  return error;
}

/**
 * The namespace segment a door reads in its namespace position, or a refusal
 * when the router would read that segment as something else.
 */
function qualifierSegment(door: AddressDoor, namespace: string): string {
  if (namespace === ENVIRONMENT_ADDRESS_SEGMENT) return namespace;
  if (typeof namespace !== 'string' || !NAMESPACE_PATTERN.test(namespace)) {
    throw addressRefusal(
      `Namespace ${JSON.stringify(namespace)} is not a package namespace: a namespace is 2 to 20 characters, `
      + 'a lowercase letter, then lowercase letters, digits or "_" (the manifest `namespace`), and '
      + `"${ENVIRONMENT_ADDRESS_SEGMENT}" addresses an item authored in the environment. The door would read the `
      + 'segment as part of the bare address and answer another request.',
    );
  }
  const position = NAMESPACE_POSITION_LITERALS[door];
  if (position.literals.includes(namespace)) {
    throw addressRefusal(
      `Namespace '${namespace}' spells a literal segment of the door (${position.prefix}/${namespace}), which the `
      + 'router reads as its own route before any namespace, so no qualified address reaches a package under it.',
    );
  }
  return namespace;
}

/** `true` when the call names a qualifier: an absent or `undefined`/`null` namespace is the bare call. */
function named(address: QualifiedAddressOptions | undefined): address is { namespace: string } {
  return address?.namespace !== undefined && address.namespace !== null;
}

/**
 * The path segment to insert after `/automation` for a flow door
 * (`/automation/:ns/:name/…`): `''` for the bare call, else `/<ns>`.
 *
 * @throws {AddressRefusal} when `(namespace, name)` has no qualified path.
 */
export function automationFlowQualifier(name: string, address: QualifiedAddressOptions | undefined): string {
  if (!named(address)) return '';
  const segment = qualifierSegment('automation', address.namespace);
  const doorLiterals = NAMESPACE_POSITION_LITERALS.automation.literals;
  if (doorLiterals.includes(name)) {
    throw addressRefusal(
      `A flow named '${name}' has no qualified path: '${name}' is a literal segment of the /automation door, `
      + 'which the router never reads as a flow name after a qualifier. Call it bare.',
    );
  }
  if (segment !== ENVIRONMENT_ADDRESS_SEGMENT && AUTOMATION_FLOW_SUBRESOURCE_SEGMENTS.includes(name)) {
    throw addressRefusal(
      `A flow named '${name}' has no qualified path under a namespace: /automation/${segment}/${name} is the `
      + `'${name}' door of the flow '${segment}'. Call it bare, or under '${ENVIRONMENT_ADDRESS_SEGMENT}' when the `
      + 'environment holds it.',
    );
  }
  return `/${segment}`;
}

/**
 * The path segment to insert after `/automation/trigger` for the legacy trigger
 * door (`/automation/trigger/:ns/:name`): `''` for the bare call, else `/<ns>`.
 *
 * @throws {AddressRefusal} when the namespace has no qualified path.
 */
export function automationTriggerQualifier(address: QualifiedAddressOptions | undefined): string {
  if (!named(address)) return '';
  return `/${qualifierSegment('automationTrigger', address.namespace)}`;
}

/**
 * The path segment to insert after `/actions` (`/actions/:ns/:object/:action`):
 * `''` for the bare call, else `/<ns>`.
 *
 * @throws {AddressRefusal} when the namespace has no qualified path.
 */
export function actionsQualifier(address: QualifiedAddressOptions | undefined): string {
  if (!named(address)) return '';
  return `/${qualifierSegment('actions', address.namespace)}`;
}

/**
 * The path segment to insert after `/meta/:type` for the item read
 * (`/meta/:type/:ns/:name`): `''` for the bare read, else `/<ns>`.
 *
 * @throws {AddressRefusal} when `(namespace, name)` has no qualified path.
 */
export function metaItemQualifier(type: string, name: string, address: QualifiedAddressOptions | undefined): string {
  if (!named(address)) return '';
  const segment = qualifierSegment('meta', address.namespace);
  if (META_ITEM_SUBRESOURCE_SEGMENTS.includes(name)) {
    throw addressRefusal(
      `The ${type} '${name}' has no qualified path: /meta/${type}/${segment}/${name} is the '${name}' read of the `
      + `${type} '${segment}'. Read it with \`packageId\` (\`?package=\`) instead.`,
    );
  }
  return `/${segment}`;
}

/**
 * The candidates a door's `409 RESOURCE_CONFLICT` names, off an error this
 * SDK's fetch layer threw: `details.candidates`, as the `/actions` and
 * `/automation` doors send it. `undefined` when the answer carried none.
 */
export function addressCandidatesOf(error: unknown): readonly PackageScopedHolder[] | undefined {
  const candidates = (error as { details?: { candidates?: unknown } } | null | undefined)?.details?.candidates;
  return Array.isArray(candidates) ? (candidates as PackageScopedHolder[]) : undefined;
}
