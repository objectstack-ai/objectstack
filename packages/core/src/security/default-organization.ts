// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3/D5] The ONE definition of the deployment's Default
 * Organization: the organization with `slug = 'default'`, else the only
 * organization there is. Several organizations, none of them `default`, name
 * none; so does a deployment that holds no organization.
 *
 * Under `single` it is the owner every organization-less write derives to
 * (D9) and the owner of the `admin_full_access` grant that anchors platform
 * standing (D5), so every reader must name the same row: a reader that named
 * another one would have the boot create, the promotion write, the resolver
 * read and the last-admin guard protect four different anchors.
 *
 * What differs between the readers is HOW they read, never what they pick:
 * the resolver fails loud on an unreachable store, the bootstrap reads an
 * unreadable store as nobody, the last-admin guard simulates a pending write
 * over the rows it reads, and the ownership ceremony reads raw SQL with no
 * engine. So the rule takes the read as a parameter
 * ({@link DefaultOrganizationRead}) and each reader keeps its own read policy.
 * ⛔ Never restate the rule beside a read: hand the read to
 * {@link findDefaultOrganization}.
 */

/** [ADR-0131 D3] The slug the boot invariant creates the Default Organization with. */
export const DEFAULT_ORGANIZATION_SLUG = 'default';

/**
 * One read of `sys_organization` the definition asks for: rows matching
 * `where`, at most `limit` of them. It asks two: `{ slug: 'default' }` with
 * limit 1, then `{}` with limit 2 (enough to tell "the only one" from
 * "several"). A reader that simulates a pending write answers with the rows as
 * that write would leave them.
 */
export type DefaultOrganizationRead<R> = (
  where: Readonly<Record<string, unknown>>,
  limit: number,
) => Promise<readonly R[]>;

/** What {@link findDefaultOrganization} answers. */
export interface DefaultOrganizationAnswer<R> {
  /** The Default Organization's id, or `undefined` when none can be named. */
  id: string | undefined;
  /** The row it was named from, as the read returned it. */
  row: R | undefined;
  /**
   * `true` when none could be named because there are several organizations
   * and none is `default` — the shape the boot invariant reports as ambiguous
   * rather than creating one beside them.
   */
  several: boolean;
}

/** A row's id as the definition reads it: a non-empty string, or nothing. */
function idOf(row: unknown): string | undefined {
  const id = (row as { id?: unknown } | null | undefined)?.id;
  return id === undefined || id === null || String(id) === '' ? undefined : String(id);
}

/**
 * [ADR-0131 D3/D5] Name the Default Organization through `read`. A read that
 * throws propagates: the caller's read policy decides what an unreadable store
 * means.
 */
export async function findDefaultOrganization<R>(read: DefaultOrganizationRead<R>): Promise<DefaultOrganizationAnswer<R>> {
  const bySlug = await read({ slug: DEFAULT_ORGANIZATION_SLUG }, 1);
  const named = idOf(bySlug[0]);
  if (named !== undefined) return { id: named, row: bySlug[0], several: false };
  const all = await read({}, 2);
  const sole = all.length === 1 ? idOf(all[0]) : undefined;
  if (sole !== undefined) return { id: sole, row: all[0], several: false };
  return { id: undefined, row: undefined, several: all.length > 1 };
}
