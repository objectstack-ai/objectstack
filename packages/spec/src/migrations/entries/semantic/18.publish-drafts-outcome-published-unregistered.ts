// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The follow-up the object-registry-refused advisory was ruled with (option A):
// a batch publish whose runtime registry refused a promoted object stops
// answering `published`. Registered because a caller that branched on
// `success` or on `outcome === 'published'` now takes a different branch for
// the same server event, and the new value is one an exhaustive switch over
// the outcome vocabulary has never seen.
export const entry: SemanticMigration = {
  id: 'publish-drafts-outcome-published-unregistered',
  surface:
    'PublishPackageDraftsResponseSchema.outcome and .success (the answer of '
    + '`POST /api/v1/packages/:id/publish-drafts`, `client.packages.publishDrafts()` and the '
    + 'protocol\'s `publishPackageDrafts`), and its new `unregistered[]` member',
  replacement:
    'read `outcome`, which now has four values: `published`, `published_unregistered`, `refused` '
    + 'and `nothing_to_publish`. On `published_unregistered` the drafts landed and stay live, and '
    + '`unregistered[]` names each object the runtime registry refused (rule '
    + '`object-registry-refused`, the id of the warning on that object\'s `published[]` element); '
    + 'publish those objects again, or restart, before seeding or reading them',
  reason:
    'A publish whose registry write-through refused an object used to answer `outcome: '
    + '\'published\'` and `success: true` while the object was not served: a seed load or data read '
    + 'right after it answered OBJECT_NOT_FOUND. The warning on the element made the refusal visible '
    + 'to a reader of `published[].advisories`; a programmatic caller that branched on `success` or '
    + 'on `outcome` still read a clean publish. Now that same event answers `outcome: '
    + '\'published_unregistered\'` and `success: false` (`success` stays exactly `outcome === '
    + '\'published\'`). Nothing was rolled back — ADR-0067 D2 runs the registration after the '
    + 'metadata commit — so a caller that treats every `success: false` as "nothing landed" is now '
    + 'wrong on this value, and a caller with an exhaustive switch over the outcome has a new case '
    + 'to handle. The REST door\'s app visibility flip still follows this outcome, as it followed '
    + 'the `published` answer before.',
  acceptanceCriteria:
    'Every consumer of the batch publish answer handles `published_unregistered` explicitly: it does '
    + 'not report "nothing landed" for it (the drafts are live), and it does not seed or read the '
    + 'objects `unregistered[]` names until they are registered. A test that publishes with the '
    + 'registry refusing one object sees `outcome: \'published_unregistered\'`, `success: false`, '
    + 'that object named in `unregistered[]` and still present in `published[]`; the same publish '
    + 'with the registry accepting every object still answers `published`, `success: true`, and no '
    + '`unregistered` key.',
};
