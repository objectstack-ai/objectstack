// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #23972 — a runtime-API narrowing: the registry's package install takes the
// package's origin as its second argument, and a call without one is refused.
// Every earlier call shape breaks, so it is registered with its prescription.
export const entry: SemanticMigration = {
  id: 'registry-install-package-source-argument',
  // No backticks in `surface`: build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'SchemaRegistry.installPackage(manifest, settings?, scope?) in @objectstack/objectql and '
    + 'EngineSchemaRegistryView.installPackage(manifest, settings?) in @objectstack/spec/contracts, now '
    + 'installPackage(manifest, source, settings?, scope?) with source one of code, marketplace or authored',
  replacement:
    'Pass where the package came from as the second argument: installPackage(manifest, \'code\') for a package '
    + 'your own code registers, \'marketplace\' for a marketplace install, \'authored\' for a database-authored '
    + 'package; move settings and scope one position right. Prefer ObjectQL.registerApp (code by default) or '
    + 'the manifest service\'s register(artifact, { source: \'marketplace\' }) where they fit. Not '
    + 'mechanically convertible: only the caller knows the origin, so no codemod can choose it',
  reason:
    'The registry records the origin and never infers it, so a call that does not state it, or states a '
    + 'value outside the closed set, throws a TypeError before anything is recorded. An old call compiled '
    + 'against the earlier signature either fails to type-check or, through an untyped caller, refuses at run '
    + 'time; one that passed settings second now has them read as the origin and refused.',
  acceptanceCriteria:
    'Every direct installPackage call in the consumer\'s code passes a source naming the package\'s real '
    + 'origin, its settings and scope moved one position right; the rows those calls produce serve that '
    + 'source on GET /api/v1/packages.',
};
