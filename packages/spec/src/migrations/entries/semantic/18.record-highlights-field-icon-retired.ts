// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #10054 (ADR-0049 enforce-or-remove) — the D3 entry of the
// `record-highlights-field-icon-removed` family (ruling B on #17152: one D3
// entry per retirement family, even when D2 is lossless). The strip changes no
// pixel; what it leaves is the meaning the author put in an icon nobody drew.
export const entry: SemanticMigration = {
  id: 'record-highlights-field-icon-retired',
  surface: 'page.component.record:highlights.fields[].icon — the per-chip icon on an object entry '
    + 'of the highlights field list',
  replacement: '(removed — the highlight chip has no icon slot.) Carry whatever the icon was meant '
    + 'to signal in what the chip does render: its label, or the field\'s own value.',
  reason: 'The D2 conversion `record-highlights-field-icon-removed` deletes `icon` from the object '
    + 'entries of every `record:highlights` field list, and the delete is lossless: the chip '
    + 'renders a label and a value and nothing else, the registration path carries field names '
    + 'only, and the Studio designer publishes the list as plain strings, so an authored icon was '
    + 'accepted and drawn by nothing. The residue is the author\'s intent. Six author-facing '
    + 'surfaces advertised the key, so an author may have chosen an icon to carry meaning — a '
    + 'warning glyph beside a risk score, a flag beside a region — and designed the page assuming a '
    + 'reader would see it. That meaning was never shown and is not shown now; only the author can '
    + 'say whether it matters and where it should live instead.',
  acceptanceCriteria: 'No `record:highlights` field entry carries `icon`; the parse refuses it. The '
    + 'highlights strip renders the same chips, in the same order, with the same labels and values '
    + 'as before the upgrade. For each chip whose icon carried meaning, a reader who sees only the '
    + 'label and value can still tell what the icon was meant to say. Any tooling that generated '
    + 'highlight entries (a code generator, a template) no longer emits the key.',
};
