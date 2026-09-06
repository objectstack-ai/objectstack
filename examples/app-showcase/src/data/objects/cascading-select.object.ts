// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { P } from '@objectstack/spec';

/**
 * Cascading Select — the B3 (#1583) dynamic-field-options runtime fixture.
 *
 * Demonstrates per-option `SelectOption.visibleWhen` end to end, through the
 * SERVED pipeline (defineStack → REST metadata → form renderer + the objectql
 * write path), with the dual-side guarantee B3 is built on: the client narrows
 * the offered set for UX, but the SERVER is the boundary.
 *
 *  - `country` → `province` CASCADE. `province` declares `dependsOn: ['country']`
 *    (so the form gates it until a country is chosen and re-filters as it
 *    changes) and each of its options carries a `visibleWhen` cascade predicate
 *    (`record.country == 'cn'` …). The client offers only the matching options;
 *    the objectql rule-validator (`evaluateOptionVisibility`, objectui#2284)
 *    re-evaluates the SUBMITTED value against the merged record and rejects an
 *    out-of-set one with `{ field, code: 'invalid_option' }` — client hiding is
 *    UX, not a security boundary.
 *
 *  - `tier` carries one ROLE-GATED option: `restricted` is offered only when
 *    `'admin' in current_user.positions`. The same rule-validator rejects a
 *    non-admin who submits it anyway; it fails open only when `current_user` is
 *    unbound (a system write) — the acting user is bound from the request on
 *    authenticated writes (engine `buildEvalUser`).
 *
 * `sharingModel: 'public_read_write'` is the RECORD baseline (gate ②) — no
 * sharing rule is needed for one persona to see another's row. It is NOT what
 * makes the object reachable: object-level CRUD (gate ①) comes only from a
 * permission set and is checked first. This comment used to say the wide OWD let
 * the seeded admin and the live e2e create records "without a bespoke permission
 * set". What actually carried the admin was their built-in WILDCARD set: with no
 * grant anywhere, `nav-object-ungranted` warned on every build and reports the
 * `nav_cascade` entry as permission-denied for every principal that does not
 * hold that wildcard set. `showcase_member_default` now grants read/create/edit,
 * so the object is in the access-matrix snapshot and a plain member holds the
 * capability the navigation entry already claimed for them. Note where the
 * narrowing really lives: on one OPTION (`tier: 'restricted'`, admin-only),
 * not on the object.
 *
 * The server verdict is unit-covered by objectql
 * `rule-validator.option-visibility.test.ts`; this object is the served fixture
 * the browser/API e2e drives. Predicates use the `P` (CEL) tag — the same
 * authoring shape as the field-level `visibleWhen` on showcase_invoice.
 */
export const CascadingSelect = ObjectSchema.create({
  name: 'showcase_cascade',
  // [ADR-0090 D1] Explicit grandfather stamp: this demo object is intentionally
  // world-writable (the live e2e creates against it); without the explicit OWD
  // the secure default (unset => private) would owner-filter it.
  sharingModel: 'public_read_write',
  label: 'Cascading Select',
  pluralLabel: 'Cascading Selects',
  icon: 'git-fork',
  description:
    'B3 dynamic-options fixture: a country → province cascade (per-option visibleWhen + dependsOn) plus a role-gated tier, enforced client-side (offered set) AND server-side (objectql rejects an out-of-set submit).',

  fields: {
    name: Field.text({ label: 'Label', required: true, searchable: true, maxLength: 120 }),

    country: Field.select({
      label: 'Country',
      options: [
        { label: 'China', value: 'cn' },
        { label: 'United States', value: 'us' },
      ],
    }),

    // Dependent (cascading) options: gated until `country` is set, then filtered
    // by each option's `visibleWhen`. `dependsOn` drives the form's gate +
    // refresh; the per-option `visibleWhen` is the actual rule the client filters
    // on AND the server enforces. Same predicate shape as the objectui catalog
    // example (`fields-select/cascading-options`).
    province: Field.select({
      label: 'Province / State',
      dependsOn: ['country'],
      options: [
        { label: 'Zhejiang', value: 'zj', visibleWhen: P`record.country == 'cn'` },
        { label: 'Guangdong', value: 'gd', visibleWhen: P`record.country == 'cn'` },
        { label: 'California', value: 'ca', visibleWhen: P`record.country == 'us'` },
        { label: 'Texas', value: 'tx', visibleWhen: P`record.country == 'us'` },
      ],
    }),

    // Role-gated option: `restricted` is offered only to admins. The client hides
    // it for everyone else; the server rejects a non-admin who submits it anyway
    // (`current_user` is bound from the request on authenticated writes).
    tier: Field.select({
      label: 'Tier',
      options: [
        { label: 'Standard', value: 'standard', default: true },
        { label: 'Restricted (admin only)', value: 'restricted', visibleWhen: P`'admin' in current_user.positions` },
      ],
    }),
  },
});
