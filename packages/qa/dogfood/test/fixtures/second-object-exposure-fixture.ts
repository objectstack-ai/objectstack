// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22661] Fixture for "a read that reaches a SECOND object asks that object's
// exposure declaration": one exposed source object whose lookups point at a
// target of every exposure shape the spec's decision (`apiExposureDenialReason`,
// ADR-0049) distinguishes, plus a target the member may not read at all — the
// precedent leg (how the data door already answers a related record it will
// not serve).
//
//   • `sox_source`   — exposed (no `enable` block); one lookup per target.
//   • `sox_hidden`   — `apiEnabled: false`: the API's off switch.
//   • `sox_closed`   — `apiMethods: ['create']`: exposed, grants neither read.
//   • `sox_getonly`  — `apiMethods: ['get']`: a record can be fetched by id.
//   • `sox_listonly` — `apiMethods: ['list']`: records can be queried.
//   • `sox_open`     — exposed; carries a lookup into `sox_hidden` itself, so a
//     second-level expansion reaches an unexposed object one hop further on.
//   • `sox_private`  — exposed, but the fixture member holds no read on it.
//
// Every object is `public_read_write` so owner sharing is not what decides any
// answer here; the member's grant is CRUD on every object except `sox_private`.

import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

const target = (name: string, label: string, enable?: Record<string, unknown>) =>
  ObjectSchema.create({
    name,
    sharingModel: 'public_read_write',
    label,
    pluralLabel: `${label}s`,
    ...(enable ? { enable } : {}),
    fields: {
      name: Field.text({ label: 'Name', required: true }),
      note: Field.text({ label: 'Note' }),
    },
  });

export const Hidden = target('sox_hidden', 'Hidden', { apiEnabled: false });
export const Closed = target('sox_closed', 'Closed', { apiMethods: ['create'] });
export const GetOnly = target('sox_getonly', 'Get only', { apiMethods: ['get'] });
export const ListOnly = target('sox_listonly', 'List only', { apiMethods: ['list'] });
export const Private = target('sox_private', 'Private');

export const Open = ObjectSchema.create({
  name: 'sox_open',
  sharingModel: 'public_read_write',
  label: 'Open',
  pluralLabel: 'Opens',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    note: Field.text({ label: 'Note' }),
    inner: Field.lookup('sox_hidden', { label: 'Inner' }),
  },
});

export const Source = ObjectSchema.create({
  name: 'sox_source',
  sharingModel: 'public_read_write',
  label: 'Source',
  pluralLabel: 'Sources',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    amount: Field.number({ label: 'Amount' }),
    hidden: Field.lookup('sox_hidden', { label: 'Hidden' }),
    closed: Field.lookup('sox_closed', { label: 'Closed' }),
    getonly: Field.lookup('sox_getonly', { label: 'Get only' }),
    listonly: Field.lookup('sox_listonly', { label: 'List only' }),
    open: Field.lookup('sox_open', { label: 'Open' }),
    private: Field.lookup('sox_private', { label: 'Private' }),
  },
});

export const secondObjectExposureStack = defineStack({
  manifest: {
    id: 'com.dogfood.second-object-exposure',
    namespace: 'sox',
    version: '0.0.0',
    type: 'app',
    name: 'Second Object Exposure Fixture',
    description: 'An exposed object with lookups into objects of every exposure shape: a second-object read must ask the target its own exposure.',
  },
  objects: [Hidden, Closed, GetOnly, ListOnly, Private, Open, Source],
});

const crud = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };

/**
 * CRUD on every fixture object except `sox_private`, which the member cannot
 * read, plus export on the source (the export door auto-expands every lookup).
 */
export const soxMemberSet: PermissionSet = PermissionSetSchema.parse({
  name: 'sox_fixture_member',
  label: 'Second-object exposure fixture member',
  objects: {
    sox_source: { ...crud, allowExport: true },
    sox_hidden: crud,
    sox_closed: crud,
    sox_getonly: crud,
    sox_listonly: crud,
    sox_open: crud,
  },
});

export function secondObjectExposureSecurity(): SecurityPlugin {
  return new SecurityPlugin({
    defaultPermissionSets: [...securityDefaultPermissionSets, soxMemberSet],
    fallbackPermissionSet: soxMemberSet.name,
  });
}
