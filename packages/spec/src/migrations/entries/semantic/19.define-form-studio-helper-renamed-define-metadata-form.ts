// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A TS/API surface, never stored in stack metadata: the helper builds Studio's
// schema-bound metadata-editing forms, so no authored stack and no stored row
// carries its name and there is no source for the chain to rewrite. This entry
// is the whole ADR-0087 registration of the export rename (ADR-0159, ruled
// question 1 = A, ruling record 7131569242 on #36868).
export const entry: SemanticMigration = {
  id: 'define-form-studio-helper-renamed-define-metadata-form',
  surface:
    '`defineForm` (function) on `@objectstack/spec` and `@objectstack/spec/ui` — the factory of a '
    + 'schema-bound Studio metadata-editing form (`data.provider: \'schema\'`), and the `*.form.ts` file '
    + 'suffix of its modules',
  replacement:
    '`defineMetadataForm`, with the same argument and the same result (`defineMetadataForm({ schemaId, … })`); '
    + 'a module that builds one is named `NAME.metadata-form.ts`. The name `defineForm` and the `*.form.ts` '
    + 'suffix belong to the `form` metadata type (ADR-0159 D2) and return with that type in the same major, '
    + 'with another meaning: a `form` item is `name` + `object` + a form body, not a schema-bound Studio form',
  reason:
    'ADR-0159 adds `form` as a metadata type, and the maintainer ruled that the obvious factory name goes to '
    + 'it (question 1 = A). The Studio helper held that name and the suffix in a meaning the new type does not '
    + 'have, so it is renamed after the translation family its modules feed (`metadataForms`). The outside-use '
    + 'reading before the rename found no import or call of `defineForm` outside objectstack-ai/objectstack, in '
    + 'any public repository of the organization or in the cloud repository. The compiler delivers the break at '
    + 'the call site (TS2305 / TS2724); `os migrate meta` has nothing to visit, because no metadata document '
    + 'names the helper',
  acceptanceCriteria:
    'No code imports `defineForm` from `@objectstack/spec` for a schema-bound Studio form: each such call reads '
    + '`defineMetadataForm` and its module is named `*.metadata-form.ts`; the project type-checks; every '
    + 'metadata-editing form parses and refuses exactly as before, because only the name moved.',
};
