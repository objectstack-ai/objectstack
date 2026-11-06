// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Provision `sys_user` and give each user a suite's writes name a row.
 *
 * [#29029] A write that is not a system write may name, in a `user` or
 * `lookup` field, only a record its caller's own read door returns (ruling
 * records 6573561091 and 6663849489), and a read door that fails — a
 * registered `sys_user` with no table behind it among them — answers
 * `reference_not_found`. A suite whose subject is another predicate on the
 * same write (a membership, a catalog name, a boundary) provisions the users
 * its writes name, so that predicate is the one it measures.
 *
 * Call it after `sys_user` is registered. The rows are written as the system;
 * each suite's callers read them through their own grants, as in a deployment.
 */
export async function provisionRigUsers(
  engine: {
    syncObjectSchema(object: string): Promise<unknown>;
    insert(object: string, data: Record<string, unknown>, options: unknown): Promise<unknown>;
  },
  ids: readonly string[],
): Promise<void> {
  await engine.syncObjectSchema('sys_user');
  for (const id of new Set(ids)) {
    await engine.insert('sys_user', { id, name: id, email: `${id}@example.test` }, { context: { isSystem: true } });
  }
}
