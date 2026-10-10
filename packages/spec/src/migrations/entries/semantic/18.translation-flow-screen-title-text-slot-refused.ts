// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A translated flow screen heading is judged by the one text-slot judge, like
// the translated body text and refusal message beside it: the engine picks all
// three in the run's locale and renders them as double-brace templates.
// Semantic-only — a single-brace token in a translated heading always drew as
// literal text, so whether it was meant as a hole is the translator's call,
// and no D2 conversion rewrites it.
export const entry: SemanticMigration = {
  id: 'translation-flow-screen-title-text-slot-refused',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'translation.flows.<flow>.screens.<node_id>.title — a translated screen heading, in a stack\'s translations '
    + 'or a translation metadata item, carrying a single-brace token such as {name}, or a double-brace hole over a '
    + 'dollar-named variable the flow engine does not bind',
  replacement:
    'the double-brace hole the refusal names, {{ name }}, where the heading should show the value — the holes of '
    + 'the heading it translates, as the translated description and refusal message already keep them; plain text '
    + 'where the braces were never meant as a hole. An empty string stays the untranslated slot.',
  reason:
    'The flow engine picks a translated screen heading in the run\'s locale and renders it through the flow '
    + 'text-slot renderer, the double-brace dialect, exactly as it renders the translated body text and a refusing '
    + 'end node\'s message. Those two refused a single-brace token when the bundle was parsed; the heading accepted '
    + 'one and drew it as literal text, so a translator who wrote {name} by analogy with a messages entry shipped a '
    + 'heading that showed the braces. It is now refused at the same parse, with the words the source heading '
    + 'gets. No D2 conversion exists: a single-brace token in a translated heading drew as literal text on every '
    + 'route the heading has taken, the console overlay before the engine pick included, so only the translator '
    + 'can say whether it was meant as a hole.',
  acceptanceCriteria:
    'Run objectstack validate, which parses the stack\'s translations, and parse each stored translation item: '
    + 'none is refused at a flows screens title. For each heading the refusal named, the translation now carries '
    + 'the holes of the heading it translates, or plain text; run the screen flow in that locale and confirm the '
    + 'heading shows the value, with no stray brace.',
};
