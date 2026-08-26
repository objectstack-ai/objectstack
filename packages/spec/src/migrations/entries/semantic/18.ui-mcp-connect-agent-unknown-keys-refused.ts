// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'ui-mcp-connect-agent-unknown-keys-refused',
  surface: 'page `mcp:connect-agent` component — `properties` (any key at all: the widget '
    + 'declares no props)',
  replacement: 'an empty `properties` bag (`{}`), or omit `properties` entirely. The widget '
    + 'reads no prop: the console registration discards the schema node '
    + '(`() => <ConnectAgent />`) and the component function takes no parameters — every '
    + 'value it renders comes from `/discovery`, i18n and its own state — so there is no '
    + 'declared key to move to; a key authored on it configures nothing and is removed, '
    + 'not renamed. Node-level keys (`visibleWhen`, `id`, `style`, …) stay on the component '
    + 'node, where the page runtime reads them.',
  reason:
    'This was a third instance of the #8691/#8744 class (#11575 closed the previous two): a '
    + 'console-registered widget on `@objectstack/mcp`\'s plugin-shipped Setup page, '
    + 'reachable through the component type union\'s open string arm, with a registered '
    + 'renderer but no `ComponentPropsMap` row — so the #5068 props gate\'s dispatch '
    + 'skipped it as unregistered, any authored key rode through every validator in '
    + 'silence, and door 3 of the mcp canonical-envelope gate (#12269) had to carry a '
    + 'standing exemption for the type. The new row is strict and EMPTY, measured from the '
    + 'renderer\'s actual read points at the objectui pin (not from the registration\'s '
    + 'declared-input list): the registration ignores the component node entirely, so the '
    + 'widget accepts no configuration at all, and an authored key is now a publish-time '
    + 'refusal naming the surface instead of a silent no-op.',
  acceptanceCriteria:
    'Every `mcp:connect-agent` node authors an empty (or absent) `properties` bag and '
    + 'validates clean — the plugin-shipped page (`connect_agent`) already does; '
    + '`objectstack validate` reports no `component-props-unknown-key` finding for the '
    + 'type. Any remaining authored key on the widget is deleted (it never configured '
    + 'anything), and behaviour that seems to need one is a renderer capability request '
    + 'against objectui, not a metadata key.',
};
