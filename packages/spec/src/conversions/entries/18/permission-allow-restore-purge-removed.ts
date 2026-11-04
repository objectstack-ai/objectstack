// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `permission-allow-restore-purge-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `permissionAllowRestorePurgeRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { isDict, stripKeys } from '../shared.js';

/**
 * Object-permission lifecycle bits `allowRestore` / `allowPurge` removed
 * (protocol 18, #12497 — ADR-0049 enforce-or-remove, maintainer ruling
 * 2026-08-26 accepting #1883's recommendation B).
 *
 * The `restore` / `purge` ObjectQL operations the bits claimed to gate have
 * never existed: no destructive lifecycle verb is in the engine's dispatch
 * vocabulary (pinned by objectql's
 * `engine-middleware-operation-vocabulary.test.ts`, #8106). Authoring the bits
 * therefore granted nothing — an advertised switch with nothing behind it, on
 * the most destructive operations (undelete, GDPR hard-delete). A pure
 * lossless delete: a dispatched `restore`/`purge` was denied before (deny
 * unless a bit nothing could ever exercise was granted) and stays denied after
 * (the evaluator's `DESTRUCTIVE_OPERATIONS` fail-closed backstop — the
 * pre-mapping rows retired in the same batch, #12497). The keys RETURN with
 * the M2 lifecycle initiative (feature + RBAC in one batch); #1883 stays open.
 *
 * `allowTransfer` — the third lifecycle bit — is ENFORCED (#3004) and stays.
 *
 * `retiredFromLoadPath`: ObjectPermissionSchema tombstones both keys
 * (`retiredKey`, tsc `never` + the parse-time prescription), the
 * `permission-rls-priority-removed` posture one block over — with one ruled
 * exception the tombstone carries itself (#12840, maintainer 2026-08-28):
 * the keys' retired default (`false`), which every artifact built by the
 * published 17.x toolchain has materialized in every entry, parses as inert
 * residue and is stripped by the `acceptRetiredDefaultResidue` stage on the
 * schema. This conversion stays migrate-meta-only: it rewrites SOURCES (both
 * values, `true` included); the load-path tolerance covers only the emitted
 * default and leaves `true` on the refusal.
 */
const permissionAllowRestorePurgeRemoved: MetadataConversion = {
  id: 'permission-allow-restore-purge-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.2.0',
  surface: 'permission.objects.<object>.allowRestore / permission.objects.<object>.allowPurge',
  summary:
    "object-permission keys 'allowRestore' and 'allowPurge' removed (ADR-0049 — the "
    + '`restore`/`purge` operations they claimed to gate have never existed, so granting the '
    + 'bits delivered nothing; dispatched destructive lifecycle verbs stay denied fail-closed. '
    + 'The keys return with the M2 lifecycle initiative, which builds undelete and purge together '
    + 'with the permission bits that gate them)',
  apply(stack, emit) {
    return mapCollection(stack, 'permissions', (ps, path) => {
      const objects = (ps as { objects?: unknown }).objects;
      if (!isDict(objects)) return ps;
      let touched = false;
      const nextObjects: Record<string, unknown> = { ...objects };
      for (const [objName, perm] of Object.entries(objects)) {
        if (!isDict(perm)) continue;
        const stripped = stripKeys(perm, ['allowRestore', 'allowPurge'], emit, `${path}.objects.${objName}`);
        if (stripped === perm) continue;
        nextObjects[objName] = stripped;
        touched = true;
      }
      if (!touched) return ps;
      return { ...ps, objects: nextObjects };
    });
  },
  fixture: {
    before: {
      permissions: [{
        name: 'support_agent',
        label: 'Support Agent',
        objects: {
          // The measured shape: full CRUD plus the two inert lifecycle bits.
          crm_ticket: {
            allowRead: true,
            allowCreate: true,
            allowEdit: true,
            allowDelete: true,
            allowRestore: true,
            allowPurge: false,
          },
          // An object WITHOUT the keys rides through untouched — the strip
          // dispatches on key presence, and the copy-on-write contract keeps
          // the reference.
          crm_note: { allowRead: true },
        },
      }],
    },
    after: {
      permissions: [{
        name: 'support_agent',
        label: 'Support Agent',
        objects: {
          crm_ticket: {
            allowRead: true,
            allowCreate: true,
            allowEdit: true,
            allowDelete: true,
          },
          crm_note: { allowRead: true },
        },
      }],
    },
    // Two notices: both keys on the one object carrying them (presence-based —
    // the authored `false` is as dead as the authored `true`).
    expectedNotices: 2,
  },
};

export { permissionAllowRestorePurgeRemoved };
