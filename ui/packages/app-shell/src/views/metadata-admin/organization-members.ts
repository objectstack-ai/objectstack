/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The active organization's members, as Setup's holder pickers read them
 * (objectui#13337, objectui#13408).
 *
 * A grant that binds a user inside an organization — a position assignment
 * (`sys_user_position`) or a permission set grant (`sys_user_permission_set`)
 * — may name only a member of that organization: objectstack's
 * `grant-holder-membership-refusal` refuses a non-system write of either row
 * whose `user_id` holds no `sys_member` row in the row's organization. So
 * `PositionHoldersSection` and `AssignedUsersSection` both offer, in their
 * picker, only the users the organization's `sys_member` rows name, read when
 * the picker opens.
 *
 * Where that refusal judges nothing, the pickers keep the whole user list, as
 * the server does: no active organization (the row is stored with none, a
 * global grant), or a composition that registers no `sys_member` object
 * ({@link membershipOrganization}).
 */

/** The membership object, and its two columns the pickers' candidates are read from. */
export const MEMBERSHIP_OBJECT = 'sys_member';
const MEMBERSHIP_ORGANIZATION_FIELD = 'organization_id';
const MEMBERSHIP_USER_FIELD = 'user_id';
/** Page size of the membership read; it pages until a short page. */
export const MEMBERSHIP_PAGE = 500;

/** A holder picker's hard filter: the members of the active organization, by user id. */
export type MemberFilter = { id: { $in: string[] } };

/** Rows of a `find()` answer, read as `QueryResult` declares them (`data`). */
const asArray = (res: unknown): unknown[] => {
  if (Array.isArray(res)) return res;
  const data = (res as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? data : [];
};

/**
 * The organization whose membership the server judges a new holder by, or
 * `null` where it judges none: only an active organization counts, and only
 * in a composition that registers {@link MEMBERSHIP_OBJECT} (`objects` is the
 * registry's object list, as `useMetadata()` serves it).
 */
export function membershipOrganization(
  activeOrganizationId: string | null | undefined,
  objects: readonly unknown[] | null | undefined,
): string | null {
  if (!activeOrganizationId) return null;
  const registered = (objects ?? []).some((o) => (o as { name?: unknown } | null)?.name === MEMBERSHIP_OBJECT);
  return registered ? activeOrganizationId : null;
}

/**
 * The user ids of `organizationId`'s `sys_member` rows, every page of them,
 * each id once. A refused read throws, as the adapter threw it: the caller
 * says it in the server's words and keeps its picker shut.
 */
export async function readOrganizationMemberIds(
  adapter: { find: (object: string, query: Record<string, unknown>) => Promise<unknown> },
  organizationId: string,
): Promise<string[]> {
  const ids = new Set<string>();
  for (let skip = 0; ; skip += MEMBERSHIP_PAGE) {
    const page = asArray(
      await adapter.find(MEMBERSHIP_OBJECT, {
        $filter: { [MEMBERSHIP_ORGANIZATION_FIELD]: organizationId },
        $top: MEMBERSHIP_PAGE,
        $skip: skip,
      }),
    );
    for (const m of page) {
      const uid = (m as Record<string, unknown> | null)?.[MEMBERSHIP_USER_FIELD];
      if (uid != null && uid !== '') ids.add(String(uid));
    }
    if (page.length < MEMBERSHIP_PAGE) break;
  }
  return [...ids];
}
