// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#32537 — the readings a Setup or Studio page addresses a
 * permission set by when more than one package holds its name
 * (`permission-set-holder.ts`, ADR-0150 D3/D4/D5/D7/D8). Pinned: a name with
 * one holder, and the environment's own set, are addressed by the name alone;
 * a refusal's candidates are read only from a `RESOURCE_CONFLICT` that names
 * them; and each stored row and position is read by the server's own rule.
 */
import { describe, it, expect } from 'vitest';
import {
  addressingPackageOf,
  candidatePackage,
  holderCandidatesOf,
  holderPackageOf,
  holdersOfName,
  holdingFromPick,
  holdingOf,
  holdingOfRead,
  holdingPackage,
  ledgerRowHolders,
  packageQuery,
  PermissionSetHolderConflict,
  positionReach,
  storedGrantHolders,
} from './permission-set-holder';

const conflict = (candidates: unknown) => ({
  success: false,
  error: { code: 'RESOURCE_CONFLICT', message: 'Permission set "sales_rep" is held by more than one package.', details: { candidates } },
});

describe('permission-set-holder (objectstack#32537)', () => {
  it('reads a stored or served package as the server does: blank and the overlay sentinel are no package', () => {
    expect(holderPackageOf('com.acme.crm')).toBe('com.acme.crm');
    expect(holderPackageOf('')).toBeNull();
    expect(holderPackageOf('  ')).toBeNull();
    expect(holderPackageOf('sys_metadata')).toBeNull();
    expect(holderPackageOf(undefined)).toBeNull();
    expect(holderPackageOf(7)).toBeNull();
  });

  it("lists a name's holders once each, in the order served", () => {
    const items = [
      { name: 'sales_rep', _packageId: 'com.acme.crm' },
      { name: 'auditor', _packageId: 'com.acme.crm' },
      { name: 'sales_rep', _packageId: 'sys_metadata' },
      { name: 'sales_rep', _packageId: 'com.acme.sales' },
      { name: 'sales_rep', _packageId: 'com.acme.crm' },
    ];
    expect(holdersOfName(items, 'sales_rep')).toEqual(['com.acme.crm', null, 'com.acme.sales']);
    expect(holdersOfName(items, 'auditor')).toEqual(['com.acme.crm']);
    expect(holdersOfName(items, 'nobody')).toEqual([]);
  });

  it('names a package only where the name alone does not address the set', () => {
    // CONTROL: one holder, whoever it is, is addressed by the name.
    expect(addressingPackageOf(['com.acme.crm'], 'com.acme.crm')).toBeUndefined();
    expect(addressingPackageOf([null], null)).toBeUndefined();
    // The environment's own set is what a caller with no package is served.
    expect(addressingPackageOf([null, 'com.acme.crm'], null)).toBeUndefined();
    expect(addressingPackageOf([null, 'com.acme.crm'], 'com.acme.crm')).toBe('com.acme.crm');
    expect(addressingPackageOf(['com.acme.crm', 'com.acme.sales'], 'com.acme.sales')).toBe('com.acme.sales');

    const items = [
      { name: 'sales_rep', _packageId: 'com.acme.crm' },
      { name: 'sales_rep', _packageId: 'com.acme.sales' },
      { name: 'auditor', _packageId: 'com.acme.crm' },
    ];
    expect(holdingOf(items, items[2])).toBeUndefined();
    const held = holdingOf(items, items[1]);
    expect(held).toEqual({ packageId: 'com.acme.sales', holders: ['com.acme.crm', 'com.acme.sales'] });
    expect(holdingPackage(held)).toBe('com.acme.sales');
    expect(holdingPackage(undefined)).toBeUndefined();
  });

  it('spells the qualifier the doors read, and nothing when no package is named', () => {
    expect(packageQuery(undefined)).toBe('');
    expect(packageQuery('')).toBe('');
    expect(packageQuery('com.acme/crm')).toBe('?package=com.acme%2Fcrm');
  });

  it('reads candidates only from a RESOURCE_CONFLICT that names them, structured', () => {
    expect(
      holderCandidatesOf(conflict([{ kind: 'package', packageId: 'com.acme.crm' }, { kind: 'environment' }])),
    ).toEqual([{ kind: 'package', packageId: 'com.acme.crm' }, { kind: 'environment' }]);
    // Another refusal, or one that names nobody, is not a pick.
    expect(holderCandidatesOf({ error: { code: 'PERMISSION_DENIED', details: { candidates: [{ kind: 'environment' }] } } })).toBeNull();
    expect(holderCandidatesOf(conflict([]))).toBeNull();
    expect(holderCandidatesOf(conflict(undefined))).toBeNull();
    // A display string is never parsed back into a package id.
    expect(holderCandidatesOf(conflict(['package "com.acme.crm"']))).toBeNull();
    expect(holderCandidatesOf(conflict([{ kind: 'package', packageId: '' }]))).toBeNull();
    expect(holderCandidatesOf(null)).toBeNull();

    expect(candidatePackage({ kind: 'package', packageId: 'com.acme.crm' })).toBe('com.acme.crm');
    expect(candidatePackage({ kind: 'environment' })).toBeUndefined();
  });

  it('takes the holding from the pick among every holder the refusal named', () => {
    const conflict = new PermissionSetHolderConflict('refused', [
      { kind: 'package', packageId: 'com.acme.crm' },
      { kind: 'environment' },
      { kind: 'package', packageId: 'com.acme.crm' },
    ]);
    const holders = ['com.acme.crm', null];
    expect(holdingFromPick(conflict, { kind: 'environment' })).toEqual({ packageId: null, holders });
    const crm = holdingFromPick(conflict, { kind: 'package', packageId: 'com.acme.crm' });
    expect(crm).toEqual({ packageId: 'com.acme.crm', holders });
    expect(holdingPackage(crm)).toBe('com.acme.crm');
  });

  it("reads a stored grant as the resolver does: its column, else the environment's set, else the one holder, else nothing", () => {
    const two = ['com.acme.crm', 'com.acme.sales'];
    expect(storedGrantHolders('com.acme.sales', two)).toEqual(['com.acme.sales']);
    // No column under two package holders: refused, grants nothing.
    expect(storedGrantHolders(null, two)).toEqual([]);
    // A stale column is read as none.
    expect(storedGrantHolders('com.gone', two)).toEqual([]);
    expect(storedGrantHolders(null, [null, 'com.acme.crm'])).toEqual([null]);
    expect(storedGrantHolders('com.gone', ['com.acme.crm'])).toEqual(['com.acme.crm']);
  });

  it('reads a ledger row as core does: a row two holders refuse keeps every holder off', () => {
    const two = ['com.acme.crm', 'com.acme.sales'];
    expect(ledgerRowHolders('com.acme.crm', two)).toEqual(['com.acme.crm']);
    expect(ledgerRowHolders(null, two)).toEqual(two);
    expect(ledgerRowHolders('com.gone', two)).toEqual(two);
    expect(ledgerRowHolders(null, [null, 'com.acme.crm'])).toEqual([null]);
    expect(ledgerRowHolders('com.gone', ['com.acme.crm'])).toEqual(['com.acme.crm']);
    // A name nobody serves: the row's own holder.
    expect(ledgerRowHolders('com.gone', [])).toEqual(['com.gone']);
  });

  it("reads a position's reference from the package that declared it; the anchors and environment positions as the environment's", () => {
    const two = ['com.acme.crm', 'com.acme.sales'];
    expect(positionReach({ name: 'rep', _packageId: 'com.acme.sales' }, two)).toEqual(['com.acme.sales']);
    expect(positionReach({ name: 'rep', _packageId: 'com.other' }, two)).toBe('closure');
    expect(positionReach({ name: 'rep' }, two)).toEqual([]);
    expect(positionReach({ name: 'rep', _packageId: 'sys_metadata' }, [null, 'com.acme.crm'])).toEqual([null]);
    // `everyone` is the environment's reference whatever package served it.
    expect(positionReach({ name: 'everyone', _packageId: 'com.acme.crm' }, two)).toEqual([]);
    expect(positionReach({ name: 'everyone', _packageId: 'com.acme.crm' }, ['com.acme.sales'])).toEqual(['com.acme.sales']);
    // A package's position may be an overlay or `.custom` override served under
    // the package's id, which the server reads as the environment's reference:
    // it reaches both, beside the environment's own set.
    expect(positionReach({ name: 'rep', _packageId: 'com.acme.crm' }, [null, 'com.acme.crm'])).toEqual(['com.acme.crm', null]);
  });

  it('reads which holder an item read shows: the package it named, else the set the name alone addresses', () => {
    const items = [
      { name: 'sales_rep', _packageId: 'com.acme.crm' },
      { name: 'sales_rep', _packageId: 'com.acme.sales' },
      { name: 'env_rep', _packageId: 'sys_metadata' },
      { name: 'env_rep', _packageId: 'com.acme.crm' },
      { name: 'auditor', _packageId: 'com.acme.crm' },
    ];
    // CONTROL: one holder is read by the name.
    expect(holdingOfRead(items, 'auditor', undefined)).toBeUndefined();
    expect(holdingOfRead(items, 'auditor', 'com.acme.crm')).toBeUndefined();
    expect(holdingOfRead(items, 'nobody', undefined)).toBeUndefined();
    // The package the read named.
    expect(holdingOfRead(items, 'sales_rep', 'com.acme.sales')).toEqual({
      packageId: 'com.acme.sales',
      holders: ['com.acme.crm', 'com.acme.sales'],
    });
    // Two package holders read by the name alone, or a package that holds no
    // set of it: the read addresses none of them.
    expect(holdingOfRead(items, 'sales_rep', undefined)).toBeNull();
    expect(holdingOfRead(items, 'sales_rep', 'com.gone')).toBeNull();
    // The name alone addresses the environment's own set.
    expect(holdingOfRead(items, 'env_rep', undefined)).toEqual({ packageId: null, holders: [null, 'com.acme.crm'] });
    expect(holdingOfRead(items, 'env_rep', 'com.acme.crm')).toEqual({
      packageId: 'com.acme.crm',
      holders: [null, 'com.acme.crm'],
    });
  });
});
