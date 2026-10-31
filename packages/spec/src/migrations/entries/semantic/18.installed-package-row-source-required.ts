// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #23972 — a wire narrowing with no authorable key: every installed-package
// row now states where the package came from, and the served read-door row
// declares the writability verdict it already carried. A reader that parses an
// older row through the published schemas is refused now, so it is registered.
export const entry: SemanticMigration = {
  id: 'installed-package-row-source-required',
  surface:
    'InstalledPackageSchema.source (kernel) on every installed-package row, now required and closed to '
    + 'code, marketplace or authored; and writable on the served GET /api/v1/packages and '
    + 'GET /api/v1/packages/:id row (InstalledPackageAtEitherStageSchema, api-assembled), now required',
  replacement:
    'Read the origin from row.source and the writability verdict from row.writable, both served on every row '
    + 'by this runtime. Not mechanically convertible for a row held elsewhere: an InstalledPackage value '
    + 'without source cannot be given one by a reader, because only the door that registered the package '
    + 'knows where it came from; re-read the row from GET /api/v1/packages instead of rebuilding it',
  reason:
    'The registry stamps source at registration (code for a package the deployment\'s own code registers, '
    + 'marketplace for an install-local install and its ledger rehydrate, authored for an installPackage '
    + 'install and its sys_packages rehydrate), and the read doors have served writable since the server '
    + 'took over the writability verdict. Declaring both makes the published row parse what this runtime '
    + 'serves. A consumer that kept rows from an older runtime, built fixture rows by hand, or derived the '
    + 'origin by joining writable with a marketplace list must decide what each such row is: the old row '
    + 'carries no statement of origin, and the join reads a control-plane install as code wherever the '
    + 'install-local capability is off.',
  acceptanceCriteria:
    'Every row the consumer parses through InstalledPackageSchema carries a source from the closed set, and '
    + 'every served row it parses through InstalledPackageAtEitherStageSchema carries a boolean writable. No '
    + 'reader derives the origin from writable or from a second list; a row it cannot attribute is re-read '
    + 'from the runtime, not guessed.',
};
