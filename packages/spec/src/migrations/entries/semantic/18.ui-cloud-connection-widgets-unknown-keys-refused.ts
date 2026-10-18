// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// Narrowed by #24230 to `cloud-connection:panel` alone. It was written for two
// widgets; the second, `marketplace:installed-list`, was retired by name in the
// same major (D3 entry `ui-marketplace-installed-list-retired`), so the
// guidance here, keep an empty bag and validate clean, would contradict the
// refusal an upgrader meets for that type. The id stays: it is referenced by
// shipped changelog text and by the guidance census in `packages/cli`.
export const entry: SemanticMigration = {
  id: 'ui-cloud-connection-widgets-unknown-keys-refused',
  surface: 'page `cloud-connection:panel` component — `properties` (any key at all: the '
    + 'widget declares no props)',
  replacement: 'an empty `properties` bag (`{}`), or omit `properties` entirely. The widget '
    + 'reads no prop: the console registration discards the schema node '
    + '(`() => <Widget />`) and the component takes no arguments, so there is no declared '
    + 'key to move to — a key authored on it configures nothing and is removed, '
    + 'not renamed. Node-level keys (`visibleWhen`, `id`, `style`, …) stay on the component '
    + 'node, where the page runtime reads them.',
  reason:
    'These were two more instances (the second, `marketplace:installed-list`, since retired by '
    + 'name: see `ui-marketplace-installed-list-retired`) of the class already closed for `record:reference_rail` '
    + 'and then for `record:alert` / `record:quick_actions` / `record:history`, each by '
    + 'declaring a strict `ComponentPropsMap` row measured from the renderer\'s read points: '
    + 'console-registered widgets on '
    + '`@objectstack/cloud-connection`\'s published Setup pages, reachable through the '
    + 'component type union\'s open string arm, with registered renderers but no '
    + '`ComponentPropsMap` row — so the props gate\'s dispatch (it parses `properties` '
    + 'against the type\'s row at publish and lint time, and skips a type with no row because '
    + 'the type union is open) skipped them as '
    + 'unregistered and any authored key rode through every validator in silence. The new '
    + 'rows are strict and EMPTY, measured from the renderers\' actual read points at the '
    + 'objectui pin (not from the registrations\' declared-input lists): both registrations '
    + 'ignore the component node entirely, so the widgets accept no configuration at all, '
    + 'and an authored key is now a publish-time refusal naming the surface instead of a '
    + 'silent no-op.',
  acceptanceCriteria:
    'Every `cloud-connection:panel` node authors an empty (or absent) `properties` bag and '
    + 'validates clean — the plugin-shipped page (`cloud_connection_settings`) already does; '
    + '`objectstack validate` reports no `component-props-unknown-key` finding for the type. Any '
    + 'remaining authored key on the widget is deleted (it never configured anything), '
    + 'and behaviour that seems to need one is a renderer capability request against '
    + 'objectui, not a metadata key.',
};
