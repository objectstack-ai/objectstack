// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21464 — the `object-timeline` page block's `mapping` was `z.unknown()`: its
// contract lived only in objectui, so a bare field name, a non-string binding
// or a misspelled member (`titleField` inside `mapping`) passed the
// component-props gate, and the rail bound nothing for it and drew the default
// field. The spec now declares objectui's own declaration of the binding
// record, four optional field names, and the row takes it. D3 only: page-
// component `properties` is not parsed on the metadata save or load path, so a
// stored page is never refused; and the authored census found no refused
// authored value — every one parses.
export const entry: SemanticMigration = {
  id: 'ui-object-timeline-mapping-typed',
  surface: 'page `object-timeline` components — `properties.mapping` (which used to accept any value)',
  replacement: 'the binding record the rail reads: `{ title?, date?, description?, variant? }`, each a field '
    + 'name. Write `titleField`, `dateField` / `startDateField`, `descriptionField` and `variantField` inside '
    + '`mapping` as `title`, `date`, `description` and `variant`; write a bare field name as the member it '
    + 'binds (`mapping: { title: \'subject\' }`).',
  reason: 'The timeline rail reads `mapping` as four field names — `title` and `date` between the `timeline` '
    + 'block\'s own member and the flat fallback, `description` ahead of `descriptionField`, and `variant`, '
    + 'the field whose value picks each entry\'s marker colour and the one binding with no other spelling — '
    + 'and the page-component row declared it `z.unknown()`, because that contract was objectui\'s alone. So a '
    + 'bare field name, a non-string binding or a misspelled member passed the component-props gate, and the '
    + 'rail bound nothing for it and drew the default field. The spec now declares objectui\'s own declaration '
    + 'of the binding record, four optional field names, closed as every element shape on that map is. It is '
    + 'read where every page component\'s props are: the component-props gate reports a refused value as an '
    + 'advisory `component-props-invalid` / `component-props-unknown-key` finding on `objectstack validate`, '
    + '`objectstack build` and `objectstack lint`, and a stored page still saves and loads, because a page '
    + 'component\'s `properties` is not parsed on the metadata save or load path. No conversion is '
    + 'registered: nothing on the load path refuses the shape, and the authored census found nothing to '
    + 'respell. Deployed metadata NOT MEASURED.',
  acceptanceCriteria: 'Every `object-timeline` node validates: `objectstack validate` reports no '
    + '`component-props-invalid` / `component-props-unknown-key` finding under `properties.mapping`. Each '
    + 'timeline that sets a mapping draws its entries\' title, date, description and marker colour from the '
    + 'fields it names.',
};
