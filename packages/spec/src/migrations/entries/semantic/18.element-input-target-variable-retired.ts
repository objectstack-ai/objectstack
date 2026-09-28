// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #9198 (ADR-0049 enforce-or-remove) — the D3 entry of the
// `element-input-target-variable-removed` family. Every retirement family
// carries one D3 entry even when a lossless D2 conversion repairs its data
// (ruling B on #17152, on the maintainer's #15954 authority). The strip is
// lossless because the key never bound anything; what it cannot do is create
// the binding the author meant to declare, because only the author knows which
// page variable an input was supposed to feed.
export const entry: SemanticMigration = {
  id: 'element-input-target-variable-retired',
  surface: 'page.component.element:text_input.targetVariable / '
    + 'page.component.element:record_picker.targetVariable — the declarative binding hint on the '
    + 'two input elements',
  replacement: 'Declare the binding on the page variable instead: a `variables[]` entry whose '
    + '`source` is the input component `id`. That reverse lookup is the one binding the renderer '
    + 'has ever honoured; the variable name is the author\'s choice, and `targetVariable` named it '
    + 'from the wrong end.',
  reason: 'The D2 conversion `element-input-target-variable-removed` deletes `targetVariable` from '
    + 'every text-input and record-picker component, and the delete is lossless: no renderer, hook '
    + 'or runtime ever read the key, so an input authored with it and without a matching '
    + '`variables[].source` wrote nothing, with a success receipt and no diagnostic. What the delete '
    + 'cannot do is restore the intent. An author who wrote `targetVariable: \'contact_email\'` meant '
    + 'that input to feed that variable, and after the strip the page is exactly as unbound as it '
    + 'always was — now without even the hint that says so. Whether the variable exists, whether '
    + 'its `source` already names this component, and whether anything downstream (a flow input, a '
    + 'filter, a visibility predicate) reads it are facts about the author\'s page that no '
    + 'conversion can see, so the binding is delegated rather than invented.',
  acceptanceCriteria: 'For every `element:text_input` and `element:record_picker` component that '
    + 'carried `targetVariable`: either the page declares a variable whose `source` equals the '
    + 'component `id`, or the author has decided the input needs no binding. With the binding '
    + 'declared, typing into the input (or picking a record) and then reading the variable — from '
    + 'whatever consumes it on the page — returns the value entered. No component authors '
    + '`targetVariable`; the parse refuses it by name.',
};
