// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #23488 — ADR-0049 enforce-or-remove (ruling of record 6181988435, letter A):
// the D3 entry of the `permission-admin-scope-binding-authoring-removed` family
// (one D3 entry per retirement family, even when D2 is lossless). Registered
// keys: `security/AdminScope:manageBindings` and
// `security/AdminScope:authorEnvironmentSets`. The strip grants and revokes
// nothing; what it changes is one refusal of the delegated-admin gate, and that
// is the judgement this entry hands the upgrader.
export const entry: SemanticMigration = {
  id: 'permission-admin-scope-binding-authoring-retired',
  surface:
    'permissions[].adminScope.manageBindings / permissions[].adminScope.authorEnvironmentSets — the delegated '
    + 'administrator\'s right to bind sets to positions and to author environment permission sets',
  replacement:
    'Nothing: delete both keys. A delegate\'s scope is placement, assignment and the allowlist — businessUnit '
    + 'with includeSubtree, manageAssignments, and assignablePermissionSets. What a position distributes and what '
    + 'a permission set grants are environment definitions, written through the metadata door by a '
    + 'manage_metadata holder (ADR-0131 D3).',
  reason:
    'The D2 conversion `permission-admin-scope-binding-authoring-removed` deletes both keys from every '
    + 'permission set\'s adminScope. No right is lost: the binding rows `manageBindings` gated and the set rows '
    + '`authorEnvironmentSets` gated were retired by ADR-0131 D3, and the metadata door that now writes a '
    + 'position\'s sets and a set\'s body admits a manage_metadata holder and reads no adminScope, so neither '
    + 'flag let a delegate do anything. One decision DID read them, and it changes: the delegated-admin '
    + 'gate\'s strict-containment comparison, which judges a delegate handing out a set that itself carries '
    + 'an adminScope (a sys_user_position assignment of a position that distributes it, or a direct '
    + 'sys_user_permission_set grant). The comparison now reads includeSubtree, manageAssignments and the '
    + 'allowlist only. Two consequences: a granted scope that set either flag `true` is no longer refused for '
    + 'out-reaching a delegate that did not; and a delegate whose scope set either flag `true` can no longer '
    + 'hand out a scope that is otherwise EQUAL to its own — the inert flag used to count as the "strictly '
    + 'larger" axis and let that lateral copy through the equal-scope refusal. That second case is now refused '
    + 'with 403 PERMISSION_DENIED (not strictly contained).',
  acceptanceCriteria:
    'No permission set carries `manageBindings` or `authorEnvironmentSets` in its adminScope, and the parse '
    + 'refuses either with the prescription. Every delegate that relied on handing out a set whose adminScope '
    + 'equals its own (differing only in either retired flag) now narrows the handed-out scope on a real axis '
    + '— a smaller allowlist, includeSubtree false, or manageAssignments false — or has a tenant admin make '
    + 'the assignment. Nothing the author maintains reads either key from a set or from the '
    + 'my-delegable-scope report, which no longer carries them.',
};
