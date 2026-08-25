// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'object-grid-data-view-data-converged',
  surface:
    "`object-grid` component props — `data` (the KIND: bare array `z.array(z.unknown())` "
    + 'vs the `ViewDataSchema` provider object)',
  replacement:
    "`ViewDataSchema` — the provider-discriminated object (`provider: 'object' | 'api' | "
    + "'value' | 'schema'`). Static inline rows move from `data: [...]` to "
    + "`data: { provider: 'value', items: [...] }` — the same rows, wrapped in the one "
    + 'arm that means "hardcoded data array". The other three arms are unchanged '
    + '`ViewDataSchema` semantics; `staticData` (the deprecated bare-array shortcut the '
    + 'renderer still reads) keeps its shape but is not the prescription',
  reason:
    'Two entries of one contract disagreed on the KIND (objectui#6207, contract-vs-'
    + "contract): `ComponentPropsMap['object-grid'].data` said bare array ('Static inline "
    + "rows — bypasses the object query') while `ViewDataSchema` — the authority "
    + 'objectui#5090 ruled the registry declaration against, pinned by '
    + '`gridDataInputContract.test.ts`, and what `ObjectGridSchema.data` resolves to — is '
    + "an object discriminated on `provider`. Measured on @objectstack/spec@17.2.0: "
    + "`{ provider: 'value', items: [] }` — the pinned-legal form — was REFUSED by the "
    + 'props-map entry (`expected array, received object`) while the bare array parsed. '
    + 'Whichever authority a value satisfied, the other refused it, and the objectui '
    + 'parity gate had to carry the reasoned exemption `object-grid.data:object` to look '
    + 'away. The maintainer ruling (2026-08-25, batch adjudication batch 4; verbatim: '
    + '「同意」, Option A) converged the props-map entry onto `ViewDataSchema`; the '
    + 'bare-array form is the deprecated `staticData` shortcut the objectui#4648 '
    + 'carve-out already refuses to publish. The ruled migration check ran with the '
    + 'change: the sweep of generated artifacts, templates and first-party corpora '
    + '(examples/, skills/, create-objectstack, spec fixtures) found ZERO bare-array '
    + '`data` authors, so no rewrite ships — this entry carries the prescription for '
    + 'authors outside the repo.',
  acceptanceCriteria:
    "`ComponentPropsMap['object-grid'].safeParse({ data: { provider: 'value', items: [] } })` "
    + 'succeeds (and the other `ViewDataSchema` arms parse through the same entry); a '
    + 'bare-array `data: [...]` is refused at the `data` path. An author carrying '
    + "`data: [...]` writes `data: { provider: 'value', items: [...] }` — same rows, "
    + 'one wrapping object. Downstream (objectui, after a released spec version reaches '
    + 'the pin): the `object-grid.data:object` exemption entry in '
    + '`registry-inputs-spec-parity.test.ts` becomes deletable, which is what closes '
    + 'objectui#6207.',
};
