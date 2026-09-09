// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The reported shape, in miniature — a two-object app where a plain member
// holds a read grant on ONE object and NOTHING at all on the other.
//
// `POST /api/v1/analytics/dataset/query` accepts an INLINE dataset from any
// authenticated caller. On a SQL driver that inline definition was compiled and
// run through the driver's raw `execute()`, which no middleware sits in front
// of, so a caller with no grant received a row count for an object whose
// `GET /api/v1/data/<object>` door answers `403 PERMISSION_DENIED`.
//
// ## Why the app declares NO dataset and NO dashboard
//
// That is the load-bearing property, not an omission. The independent
// reproduction that graded the defect measured a tree with **0 datasets and
// 0 dashboards** and got the identical 200: the reachable slot is the INLINE
// definition, so an application does not have to declare anything and cannot
// decline to. A fixture that declared a dataset would prove a weaker statement
// — that DECLARED analytics is gated — and leave the actual surface untested.
//
// ## Why the member's grant is per-object rather than a wildcard
//
// The gate has to be measured in BOTH directions on one boot. A fixture where
// the member can read nothing would go green under an implementation that
// simply refuses every analytics query on a SQL driver — which passes the
// refusal half while deleting the SQL analytics path. `admission_open` is the
// negative control that such an implementation fails.

import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, RLS, type PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

/** The object the member MAY read — with an owner RLS policy, so the row scope is live. */
export const AdmissionOpen = ObjectSchema.create({
  name: 'admission_open',
  sharingModel: 'public_read_write',
  label: 'Admission Open',
  pluralLabel: 'Admission Open',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    region: Field.text({ label: 'Region' }),
  },
});

/** The object the member holds NO grant on at all — the reported `ats_employer_member`. */
export const AdmissionWalled = ObjectSchema.create({
  name: 'admission_walled',
  sharingModel: 'public_read_write',
  label: 'Admission Walled',
  pluralLabel: 'Admission Walled',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    region: Field.text({ label: 'Region' }),
  },
});

export const admissionFixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.analytics_admission',
    namespace: 'admission',
    version: '0.0.0',
    type: 'app',
    name: 'Analytics Admission Fixture',
    description:
      'Two objects, one grant, ZERO datasets and ZERO dashboards — the inline-dataset admission surface.',
  },
  objects: [AdmissionOpen, AdmissionWalled],
});

const FIXTURE_MEMBER_SET = 'admission_fixture_member';

/**
 * The fallback set a fresh member resolves to: read on `admission_open` only,
 * owner-scoped by `created_by`, and no entry whatsoever for `admission_walled`.
 *
 * The owner policy is what makes the ADMITTED half a real measurement rather
 * than a trivially equal pair of totals: the member's count has to be their own
 * rows on both routes, which is the reported "the RLS-scoped count survives the
 * fix" control.
 */
export const admissionMemberSet: PermissionSet = PermissionSetSchema.parse({
  name: FIXTURE_MEMBER_SET,
  label: 'Admission Fixture Member — read on admission_open only',
  objects: {
    admission_open: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  },
  rowLevelSecurity: [RLS.ownerPolicy('admission_open', 'created_by')],
});

/** SecurityPlugin whose fresh-member fallback is the fixture set, over the real defaults. */
export function admissionFixtureSecurity(): SecurityPlugin {
  return new SecurityPlugin({
    defaultPermissionSets: [...securityDefaultPermissionSets, admissionMemberSet],
    fallbackPermissionSet: admissionMemberSet.name,
  });
}
