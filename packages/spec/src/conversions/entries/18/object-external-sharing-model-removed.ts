// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `object-external-sharing-model-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `objectExternalSharingModelRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { stripKeys } from '../shared.js';

/**
 * `object.externalSharingModel` leaves the authorable surface (protocol 18,
 * #23268 — ADR-0049 enforce-or-remove; ruling of record 6159300530, letter A).
 *
 * ADR-0090 D11 declared a second org-wide default for EXTERNAL (portal /
 * partner) principals. No request ever resolved one (the execution context
 * assembles `audience: undefined`), and the authorization kernel's `EXTERNAL`
 * rung (ADR-0095 / ADR-0099) is explicitly shared rows only, never
 * OWD-derived, so the value changed no row answer for any principal. Its only
 * readers were authoring checks of its own ordering against `sharingModel`.
 *
 * **Retired from the load path** — the object shape tombstones the key
 * (`retiredKey`), so a live author is refused at parse with the prescription.
 * The entry exists because stored `object` rows CAN carry it: Studio's object
 * settings offered the select and `PUT /meta/object` persisted it until this
 * release, and `applyConversionsToStoredItem` replays the chain over a stored
 * row as `{ objects: [row] }`. It also lets `os migrate meta --from 17` list
 * the mechanical edits for existing sources. Deletion is the whole
 * conversion, and it is lossless: nothing read the value.
 */
const objectExternalSharingModelRemoved: MetadataConversion = {
  id: 'object-external-sharing-model-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'object.externalSharingModel',
  summary:
    'object `externalSharingModel` removed (ADR-0049 — the external org-wide default no '
    + 'principal ever read; external visibility is explicitly shared rows only, ADR-0095)',
  apply(stack, emit) {
    return mapCollection(stack, 'objects', (obj, path) =>
      stripKeys(obj, ['externalSharingModel'], emit, path));
  },
  fixture: {
    before: {
      objects: [
        { name: 'portal_case', label: 'Case', sharingModel: 'public_read', externalSharingModel: 'private' },
        // The internal default is the key that survives; an object without
        // the external one passes through untouched.
        { name: 'portal_note', label: 'Note', sharingModel: 'private' },
      ],
    },
    after: {
      objects: [
        { name: 'portal_case', label: 'Case', sharingModel: 'public_read' },
        { name: 'portal_note', label: 'Note', sharingModel: 'private' },
      ],
    },
    expectedNotices: 1,
  },
};

export { objectExternalSharingModelRemoved };
