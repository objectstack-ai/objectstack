// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `permission-rls-tags-removed` conversion (`toMajor:
// 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `permissionRlsTagsRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { isDict, stripKeys } from '../shared.js';

/**
 * RLS-policy `tags` removed (protocol 18, #20321 — ADR-0049 enforce-or-remove,
 * graded RETIRE by the maintainer's criterion for declared-but-unenforced
 * families: does a mainstream platform have the capability?).
 *
 * The key promised "categorization and reporting" for governance and
 * compliance, and nothing ever read it: the RLS compiler reads a policy's
 * `name`, `object`, `operation`, `positions`, `enabled` and predicates, and
 * nothing else acts on its tags (objectui's permission preview renders the
 * policy COUNT; its policy editor neither seeds nor reads the key). No
 * mainstream platform tags a row-level policy — Salesforce sharing rules,
 * Dataverse security roles and PostgreSQL RLS policies carry no such
 * attribute. So the delete is lossless: no access decision changes, and
 * nothing that consumes a policy loses an input. Sibling of `permission-rls-priority-removed` (one
 * major earlier, same carrier, same walk).
 *
 * `retiredFromLoadPath`: the schema tombstones the key (`retiredKey`, tsc
 * `never` + the parse-time prescription), so a live author is refused at parse
 * rather than silently rewritten. The entry exists so a stored permission row
 * that still carries the key replays clean through
 * `applyConversionsToStoredItem`, and so `os migrate meta --from 17` lists the
 * mechanical edits for author sources. `stripKeys` deletion is idempotent by
 * construction.
 */
const permissionRlsTagsRemoved: MetadataConversion = {
  id: 'permission-rls-tags-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.4.0',
  surface: 'permission.rowLevelSecurity[].tags',
  summary:
    "RLS-policy key 'tags' removed (ADR-0049 — nothing ever read a policy's tags and no "
    + 'mainstream platform tags a row-level policy; dropping it changes no access decision)',
  apply(stack, emit) {
    return mapCollection(stack, 'permissions', (ps, path) => {
      const rls = (ps as { rowLevelSecurity?: unknown }).rowLevelSecurity;
      if (!Array.isArray(rls)) return ps;
      let touched = false;
      const next = rls.map((policy, i) => {
        if (!isDict(policy)) return policy;
        const stripped = stripKeys(policy, ['tags'], emit, `${path}.rowLevelSecurity[${i}]`);
        if (stripped !== policy) touched = true;
        return stripped;
      });
      return touched ? { ...ps, rowLevelSecurity: next } : ps;
    });
  },
  fixture: {
    before: {
      permissions: [{
        name: 'compliance_reviewer',
        label: 'Compliance Reviewer',
        rowLevelSecurity: [
          {
            name: 'reviewed_cases',
            object: 'crm_case',
            operation: 'select',
            using: "status == 'closed'",
            tags: ['compliance', 'gdpr'],
          },
          // A policy WITHOUT the key rides through untouched — the strip
          // dispatches on key presence.
          {
            name: 'own_cases',
            object: 'crm_case',
            operation: 'select',
            using: 'owner == current_user.id',
          },
        ],
      }],
    },
    after: {
      permissions: [{
        name: 'compliance_reviewer',
        label: 'Compliance Reviewer',
        rowLevelSecurity: [
          {
            name: 'reviewed_cases',
            object: 'crm_case',
            operation: 'select',
            using: "status == 'closed'",
          },
          {
            name: 'own_cases',
            object: 'crm_case',
            operation: 'select',
            using: 'owner == current_user.id',
          },
        ],
      }],
    },
    // One notice: the one policy carrying the key.
    expectedNotices: 1,
  },
};

export { permissionRlsTagsRemoved };
