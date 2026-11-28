// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The ADR-0087 registration of card ② of ADR-0159 (the `form` metadata type):
// its two breaks together, as the record's own consequences paragraph asks
// (one marker for the export break of ruled question 1 and the refusal of
// D5). Neither has a source the chain rewrites: the export is a TS name, and
// the refused save is a runtime write whose fix is another key or another
// binding, chosen by the administrator.
export const entry: SemanticMigration = {
  id: 'form-type-define-form-and-packageless-list-at-form-name',
  surface:
    '`defineForm` (function) on `@objectstack/spec` and `@objectstack/spec/ui`, which now builds a `form` '
    + 'metadata item; and a package-less `view` write (save, publish of a draft, rollback) that would store a '
    + 'LIST — an item, or a container\'s expansion — at a name a read-only package authors as a `form` item',
  replacement:
    '`defineForm({ name: \'OBJECT.KEY\', object, …form body })` builds a `form` item (ADR-0159 D2); the Studio '
    + 'helper that held the name is `defineMetadataForm` since the previous entry. A list at a form\'s name is '
    + 'saved under another key, or into an app of the environment\'s own: a list and a form of one name are two '
    + 'items, and a package-less list there would be read over the package\'s form',
  reason:
    'ADR-0159 makes `form` a metadata type of its own (ruled question 1 = A gives it the factory name), and D5 '
    + 'reads a stored `view` row that stands over a package\'s form as the form it replaces. A package-less row '
    + 'is in every package\'s served-row order, so a list stored there at a form\'s name would leave nothing '
    + 'served for that name from the package. Some such saves are admitted today: several packages ship the '
    + 'name, the base has no pair, a re-save of a row its pair already holds, a container that overlays the '
    + 'package\'s own. The refusal bites for a name from the release in which a package authors it as a `form` '
    + 'item (`400 VALIDATION_ERROR`, naming the package)',
  acceptanceCriteria:
    'Every `defineForm` call builds a `form` item that parses under `FormSchema` (its name `OBJECT.KEY`, its '
    + 'body at the top level, no `data`); a Studio metadata-editing form is built with `defineMetadataForm`. No '
    + 'package-less `view` row stores a list at a name a read-only package authors as a `form` item; the same '
    + 'list under another key, or in an app of the environment\'s own, saves as before.',
};
