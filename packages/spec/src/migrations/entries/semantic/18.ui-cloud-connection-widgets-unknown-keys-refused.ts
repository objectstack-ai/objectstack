// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'ui-cloud-connection-widgets-unknown-keys-refused',
  surface: 'page `cloud-connection:panel` / `marketplace:installed-list` components — '
    + '`properties` (any key at all: both widgets declare no props)',
  replacement: 'an empty `properties` bag (`{}`), or omit `properties` entirely. Neither '
    + 'widget reads any prop: the console registrations discard the schema node '
    + '(`() => <Widget />`) and the components take no arguments, so there is no declared '
    + 'key to move to — a key authored on either widget configures nothing and is removed, '
    + 'not renamed. Node-level keys (`visibleWhen`, `id`, `style`, …) stay on the component '
    + 'node, where the page runtime reads them.',
  reason:
    'These were two more instances of the #8691/#8744 class: console-registered widgets on '
    + '`@objectstack/cloud-connection`\'s published Setup pages, reachable through the '
    + 'component type union\'s open string arm, with registered renderers but no '
    + '`ComponentPropsMap` row — so the #5068 props gate\'s dispatch skipped them as '
    + 'unregistered and any authored key rode through every validator in silence. The new '
    + 'rows are strict and EMPTY, measured from the renderers\' actual read points at the '
    + 'objectui pin (not from the registrations\' declared-input lists): both registrations '
    + 'ignore the component node entirely, so the widgets accept no configuration at all, '
    + 'and an authored key is now a publish-time refusal naming the surface instead of a '
    + 'silent no-op.',
  acceptanceCriteria:
    'Every `cloud-connection:panel` / `marketplace:installed-list` node authors an empty '
    + '(or absent) `properties` bag and validates clean — the two plugin-shipped pages '
    + '(`cloud_connection_settings`, `marketplace_installed`) already do; `objectstack '
    + 'validate` reports no `component-props-unknown-key` finding for these types. Any '
    + 'remaining authored key on either widget is deleted (it never configured anything), '
    + 'and behaviour that seems to need one is a renderer capability request against '
    + 'objectui, not a metadata key.',
};
