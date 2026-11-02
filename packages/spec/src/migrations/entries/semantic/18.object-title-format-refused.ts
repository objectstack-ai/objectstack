// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// `titleFormat` on an object is refused at the metadata save gate and by
// `os validate` (ruling of record 6574393684 on #29007, letter B). Not deleted
// from the schema and not converted: a stored object that carries it still
// parses and reads, and no D2 conversion drops it, because which field a
// composite template should become is the author's choice — a single field, or
// a stored computed field — and the platform does not guess.
export const entry: SemanticMigration = {
  id: 'object-title-format-refused',
  surface: 'object.titleFormat',
  replacement:
    'Point `nameField` at the record\'s title field and drop `titleFormat`. A single-field template '
    + '(`{name}`) becomes `nameField: \'name\'`. A composite template that an import, a sort or a search '
    + 'must match becomes a stored computed field: a `text` field that declares an `expression`, which the '
    + 'engine computes and stores on every write, designated as `nameField`; a `formula` with '
    + '`returnType: \'text\'` stays legal for a title shown for display only. `os validate`, `os build`, '
    + '`os lint` and the metadata save gate (`422 INVALID_METADATA`) refuse the key as `title-format-retired`, '
    + 'an error.',
  reason:
    'ADR-0079 retired `titleFormat` in favour of `nameField`: a render-only template the server can neither '
    + 'return nor query. An explicit `nameField` outranks it, and the registry stamps a derived `nameField` '
    + 'on every object that authors none, so a declared template titled nothing while its save and its '
    + 'publish both succeeded. The refusal makes the no-op loud at the doors an author uses. No mechanical '
    + 'move is lossless: a composite template names several fields, and whether its title must be stored '
    + '(matched by an import, sorted, searched) or only shown is not recorded. ADR-0079 / ADR-0087.',
  acceptanceCriteria:
    'Load every object (`os validate` or `os build`): no `title-format-retired` finding, and every object '
    + 'that declared a template now declares `nameField`. A stored object row that carries `titleFormat` '
    + 'still loads and is served; its next save, publish or restore is refused until the key is dropped. '
    + 'Done when no authored or stored object carries `titleFormat`.',
};
