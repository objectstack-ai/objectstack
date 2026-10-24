// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0138 D5 — the organization a public form request acts in when the form
 * is bound to organizations at publish time.
 *
 * ## The rule
 *
 * A form's `sharing.organizations` (`@objectstack/spec/ui`, `SharingConfigSchema`)
 * lists the organizations the form is published to, by organization slug, and
 * the link names one of them (`?organization=SLUG`). The decision has three
 * outcomes:
 *
 *  - **unbound** — the form lists no organization and the link names none.
 *    ADR-0138 D4 is unchanged for it: the submission carries no organization
 *    and the engine derives the deployment's one organization, or refuses
 *    (`resolveSystemWriteOrganization`, ADR-0131 D9). Nothing here is asked.
 *  - **bound** — the link names an organization the form lists, and exactly one
 *    organization carries that slug. The request acts in that organization, and
 *    only in it: the door threads its id as the write's `tenantId`, so the row
 *    lands there and its number sequences count there.
 *  - **refuse** — every other combination. A bound form whose link names no
 *    organization is refused, ⛔ never answered with the default organization
 *    or the form's first listed one: on a multi-organization deployment that
 *    pick is exactly the silent guess D4 item 1 forbids. A link naming an
 *    organization the form does not list is refused, unbound forms included,
 *    because ignoring the name would land the row in an organization the link
 *    did not ask for.
 *
 * The organization comes from the server's own read of the slug the form's
 * declaration lists, never from an id the client sends (D4 item 1): the client
 * names a slug, and the slug only selects among the organizations the author
 * published to.
 *
 * ## What the caller is told
 *
 * The doors answer every refusal exactly as they answer a form that is not
 * published, so an anonymous caller learns nothing about which organizations
 * exist or which a form lists. The reason is for the server's own log.
 */

/** Why a public form request resolves no organization. Server-side only. */
export type PublicFormOrganizationRefusalReason =
  /** The form lists organizations and the link names none. */
  | 'organization-required'
  /** The link names an organization the form does not list (or the form lists none). */
  | 'not-published'
  /** The link names the organization in a shape that is not one slug (repeated, empty, not a string). */
  | 'malformed-organization'
  /** The form lists the slug, and no organization carries it. */
  | 'unknown-organization';

/** What a public form request's organization resolves to (ADR-0138 D5). */
export type PublicFormOrganizationDecision =
  /** No binding asked for and none declared: ADR-0138 D4 decides, unchanged. */
  | { kind: 'unbound' }
  /** The organization the link names, published to by the form. */
  | { kind: 'bound'; organization: string; organizationId: string }
  /** No organization: the doors answer the form as not published. */
  | { kind: 'refuse'; reason: PublicFormOrganizationRefusalReason };

/**
 * Resolve the organization a public form request acts in (ADR-0138 D5).
 *
 * `published` is the form's declared binding (`anonymousFormIntakeOrganizations`
 * over its `sharing`); `requested` is the link's `organization` query value as
 * the transport parsed it, unread until here. `probeOrganizationsBySlug` reads
 * the ids of the organizations carrying a slug, as the system, and is called
 * only once the slug is one the form lists — an unlisted slug is refused
 * without asking the database anything.
 */
export async function resolvePublicFormOrganization(args: {
  published: readonly string[];
  requested: unknown;
  /** Organization ids carrying `slug`, capped at 2 by the caller — only "0 / 1 / several" matters. */
  probeOrganizationsBySlug: (slug: string) => Promise<readonly string[]>;
}): Promise<PublicFormOrganizationDecision> {
  const { published, requested } = args;
  if (requested === undefined) {
    return published.length === 0
      ? { kind: 'unbound' }
      : { kind: 'refuse', reason: 'organization-required' };
  }
  if (typeof requested !== 'string' || requested === '') {
    return { kind: 'refuse', reason: 'malformed-organization' };
  }
  if (!published.includes(requested)) return { kind: 'refuse', reason: 'not-published' };
  const ids = await args.probeOrganizationsBySlug(requested);
  // Slugs are unique across the deployment (`sys_organization`'s global unique
  // index), so several rows is a broken invariant, refused like none.
  if (ids.length !== 1) return { kind: 'refuse', reason: 'unknown-organization' };
  return { kind: 'bound', organization: requested, organizationId: ids[0] };
}
