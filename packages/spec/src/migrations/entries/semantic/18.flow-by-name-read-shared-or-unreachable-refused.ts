// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0150 child B: two packages of two namespaces may each ship a flow of the
// same name (D2, D9), so a read of a flow by its name alone can no longer stand
// for one flow. An accept-set narrowing of two by-name reads, not a key
// removal: no schema key moves and no stored row changes shape, so there is no
// D2 conversion and no tombstone. What an upgrading caller owes is the read's
// package, which only the caller knows.
export const entry: SemanticMigration = {
  id: 'flow-by-name-read-shared-or-unreachable-refused',
  surface:
    'A flow read by its name. (1) With no package: the bare metadata read GET /api/v1/meta/flow/NAME and '
    + 'MetadataManager.get for type flow with no package, on a name two packages of two namespaces hold. '
    + '(2) As a package: the registry\'s package-scoped by-name read (PACKAGE_SCOPED_READ_TYPES, which flow '
    + 'joins), on a name only the environment holds or one package outside the reading package\'s declared '
    + 'dependencies holds',
  replacement:
    'For (1), read each flow by its package: GET /api/v1/meta/flow/NAME?package=ID, or the namespace address '
    + '/api/v1/meta/flow/NS/NAME; to run, switch or act on its runs, use /api/v1/automation/NS/NAME. For (2), '
    + 'declare a dependency on the package that ships the flow (ADR-0141), or ship the flow in the reading '
    + 'package. A name one package holds, read by that name, answers as before',
  reason:
    'Before this release a flow name had one package holder per deployment, and two packages could hold one '
    + 'only as a clash the cold boot sealed with a warning; the bare read then served the first registered '
    + 'package\'s flow. Now each namespace may ship its own flow of a name, so a bare read of a name two '
    + 'packages hold answers 409 RESOURCE_CONFLICT naming both, never one of them picked. A by-name read made '
    + 'as a package follows ADR-0150 D3: a package never reaches an environment-authored flow, and reaches '
    + 'another package\'s flow only through its declared dependencies, so both reads are refused naming the '
    + 'holders where they were served. The same rule reaches what reads a flow on a caller\'s behalf: the '
    + 'bare /api/v1/automation/NAME doors (Studio\'s flow panels among them) answer the 409 naming both for '
    + 'a shared name, and an approval request whose package and run name no one slot answers its send-back '
    + 'with that 409 and its read (GET /api/v1/approvals/requests/ID) without flow_route and flow_steps, '
    + 'never another holder\'s flow. Nothing is rewritten: which package a caller meant is a judgement only '
    + 'the caller can make. Measured when the change landed: no first-party caller in either position.',
  acceptanceCriteria:
    'For every caller that reads a flow by its name with no package (REST clients of '
    + 'GET /api/v1/meta/flow/NAME, server code reading MetadataManager for type flow), confirm the name has '
    + 'one package holder in the deployment, or switch it to the package-qualified read; after a second '
    + 'namespace installs the name, the qualified read answers 200 with that package\'s flow and the bare '
    + 'read answers 409 RESOURCE_CONFLICT naming both. For every package whose actions, endpoints or code '
    + 'read a flow by name, the flow is its own or ships in a package it declares as a dependency: the read '
    + 'answers 200, not a refusal naming the holders.',
};
