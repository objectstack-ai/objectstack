// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// An accept-set narrowing of one VALUE, not a key removal: `manifest.namespace`
// stays declared with the grammar it had, and seven spellings of it are
// refused because a door of the REST address grammar serves that string as a
// literal where the qualified form puts the namespace (ADR-0150 D5). No
// tombstone and no RETIRED_KEYS_BY_MAJOR row, since no key leaves; no D2
// conversion, since the remedy is a rename that moves the package's object
// names and their tables with it, and no conversion can choose the new name.
// One entry for the class: six of the literals were refused when the grammar
// landed, and `runs` joined them once the inbound hook's position named the
// literal the run doors serve there. No relevance question: the surface is the
// manifest, which every stack carries and which the one question protocol 18
// ships cannot name.
export const entry: SemanticMigration = {
  id: 'manifest-namespace-address-literal-refused',
  surface:
    'manifest.namespace (ManifestSchema), a stack\'s own or a packages[] body\'s — a value equal to actions, '
    + 'connectors, global, hooks, oauth, runs or trigger: the literal segments of the REST address grammar that '
    + 'a namespace can spell (NAMESPACE_REFUSED_LITERALS, kernel/address-grammar.ts)',
  replacement:
    'Any other namespace. Rename it (hooks becomes hooks_app, runs becomes runs_app) and rename the prefix of '
    + 'the package\'s object names with it, in the same change. A namespace that only contains one of the seven '
    + '(triggers, globals, reruns) was never refused and needs nothing. An object\'s name is its table name, so a '
    + 'deployment that already holds data under the old names plans that data move before it installs the '
    + 'renamed package; until then it can keep the package installed under the old namespace, which the server '
    + 'keeps booting.',
  reason:
    'ADR-0150 D5: a by-name door takes the package\'s namespace before the name in its qualified form, and the '
    + 'router reads a literal segment in that position before any namespace. Each of the seven is such a literal '
    + 'at one door: actions, connectors, hooks and trigger under /api/v1/automation, global under /api/v1/actions, '
    + 'oauth under /api/v1/automation/connectors, and runs under /api/v1/automation/hooks, where the run doors of '
    + 'a flow named hooks (resume, cancel and restore-suspension of one run) have the verb and arity of the '
    + 'qualified inbound hook. A package under one of them was validated, built and installed like any other, and '
    + 'its qualified addresses at that door were answered by the other route, with nothing saying so; its '
    + 'qualified addresses on every other door were, and are, read as any namespace\'s. The value is now refused '
    + 'by one judge (validateNamespaceNotAddressLiteral), whose sentence names the literal and the address that '
    + 'serves it: objectstack validate and objectstack build exit 1 and the build writes no artifact; the '
    + 'registry\'s install gate raises NAMESPACE_CONFLICT (422), which the package install door answers as 422 '
    + 'PLUGIN_REGISTER_FAILED carrying that sentence; defineStack warns once per package and namespace and still returns the '
    + 'stack, because it runs at every load of a config, the server\'s included. A package a deployment ALREADY '
    + 'holds under one of the seven is not refused: the boot keeps it and warns once per package, a re-install or '
    + 'an upgrade under the same id and namespace still installs, and objectstack migrate stored-references '
    + 'lists it (literalNamespaces) with the same sentence. Its items stay readable by naming the package in the '
    + 'package query parameter, and under runs the one address it lacks is its qualified inbound hook, which is '
    + 'reached at the bare hook address. An upgrade that MOVES a package to one of the seven is a new occupation '
    + 'and is refused. No deprecation window on the authoring doors: the boot exemption is the grace a '
    + 'deployment that holds such a package gets.',
  acceptanceCriteria:
    'Read manifest.namespace of the stack and of every packages[] body, and run objectstack migrate '
    + 'stored-references against each deployment: no namespace equals one of the seven, and literalNamespaces is '
    + 'empty, or lists only packages the deployment has decided to keep under their old namespace. After a '
    + 'rename, objectstack validate and objectstack build exit 0, the package installs, the boot logs no warning '
    + 'that a namespace spells an address literal, and the package\'s qualified addresses answer at the door that '
    + 'used to read the literal (for a package that was under runs: its inbound hook answers at the qualified '
    + 'hook address). Measured when runs joined the set: no first-party manifest, example, fixture or template '
    + 'declares it, in this repository or in HotCRM.',
};
