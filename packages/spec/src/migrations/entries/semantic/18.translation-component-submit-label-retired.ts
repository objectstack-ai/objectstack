// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #10926 — the D3 entry of the `translation-component-submit-label-removed`
// family (ruling B on #17152: one D3 entry per retirement family, even when D2
// is lossless). The strip deletes a string nothing has read since its carrier
// retired; where the translator's work should go instead is not something the
// conversion can decide.
export const entry: SemanticMigration = {
  id: 'translation-component-submit-label-retired',
  surface: 'translation.pages.<page>.components.<id>.submitLabel — the component-copy key of the '
    + 'retired element:form',
  replacement: 'The live form surface\'s submit copy: `submitText` on the `object-form` component, '
    + 'an I18nLabel localized at its own authoring site.',
  reason: 'The D2 conversion `translation-component-submit-label-removed` deletes `submitLabel` from '
    + 'every translation bundle and stored translation item, and the delete is lossless: the key\'s '
    + 'only declarer, `element:form`, retired whole, so no resolver has overlaid the string since '
    + 'and it was read by nothing. What the delete drops is translation WORK. A translator who '
    + 'localized a submit button for each locale did so because a user was meant to read it; if '
    + 'the page\'s form now lives on `object-form`, its submit copy is `submitText`, and that key '
    + 'is not filled by moving the old strings mechanically — the component ids differ, and a '
    + 'retired `element:form` may have no successor on the page at all. Only the author can say '
    + 'which form each string belonged to and whether it still exists.',
  acceptanceCriteria: 'No translation bundle or translation item carries a component '
    + '`submitLabel`; the parse refuses it. For each form a user still submits, the `object-form` '
    + 'component carries a `submitText` whose localized values cover the locales the dropped '
    + 'strings covered, and switching the UI locale shows the submit button in that locale — or '
    + 'the author has decided the default copy is acceptable.',
};
