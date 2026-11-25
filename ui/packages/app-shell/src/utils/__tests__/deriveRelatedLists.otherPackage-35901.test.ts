/**
 * objectstack#35901 — a declared `relatedLists` does not hide a child list
 * ANOTHER package brings (Sales ruling 7073014077, flipping the hiding
 * objectstack#35897 shipped under ruling 7072511859): the package places it
 * with its object extension's `place`, which the server splices into the
 * parent's `relatedLists`; an unplaced one is kept after the listed lists, so
 * the page draws it at the end of the tabs. A child of the parent's own
 * package, or one no package owns, is still the parent's to list. Each row's
 * control differs from it by one `_packageId`.
 */
import { describe, it, expect } from 'vitest';
import { deriveRelatedLists } from '../deriveRelatedLists';

const account = { name: 'account', label: 'Account', _packageId: 'com.vendor.crm', fields: { name: { type: 'text' } } };
const childOf = (name: string, packageId?: string) => ({
  name,
  label: name,
  ...(packageId !== undefined ? { _packageId: packageId } : {}),
  fields: { account_id: { type: 'lookup', reference: 'account' } },
});
const contact = childOf('contact', 'com.vendor.crm');
const opportunity = childOf('opportunity', 'com.vendor.crm');

const names = (parent: Record<string, unknown>, objects: unknown[], includeHidden = false) =>
  deriveRelatedLists(parent, objects as never, { includeHidden }).map((r) => r.childObject);

describe('relatedLists — a child list another package brings (objectstack#35901)', () => {
  const declared = { ...account, relatedLists: ['opportunity', 'contact'] };

  it('an unplaced one is kept, after the listed lists', () => {
    expect(names(declared, [account, contact, childOf('contract', 'com.acme.contracts'), opportunity])).toEqual([
      'opportunity', 'contact', 'contract',
    ]);
  });

  it('control: a child of the parent\'s own package is hidden, as objectstack#35897 shipped', () => {
    expect(names(declared, [account, contact, childOf('contract', 'com.vendor.crm'), opportunity])).toEqual([
      'opportunity', 'contact',
    ]);
  });

  it('control: a child no package owns (absent or bound to none) is hidden too', () => {
    expect(names(declared, [account, contact, childOf('contract'), opportunity])).toEqual(['opportunity', 'contact']);
    expect(names(declared, [account, contact, childOf('contract', 'sys_metadata'), opportunity])).toEqual(['opportunity', 'contact']);
  });

  it('a placed one (the server spliced it into relatedLists) sits at its entry', () => {
    const placed = { ...account, relatedLists: ['opportunity', 'contract', 'contact'] };
    expect(names(placed, [account, contact, childOf('contract', 'com.acme.contracts'), opportunity])).toEqual([
      'opportunity', 'contract', 'contact',
    ]);
  });

  it('the authoring surface carries its source package, and never flags it unlisted', () => {
    const lists = deriveRelatedLists(declared, [account, contact, childOf('contract', 'com.acme.contracts'), opportunity] as never, { includeHidden: true });
    const contract = lists.find((r) => r.childObject === 'contract')!;
    expect(contract.fromPackage).toBe('com.acme.contracts');
    expect(contract.isUnlisted).toBeUndefined();
    // The record page asks for no hidden relationships, so no source rides along.
    expect(deriveRelatedLists(declared, [account, childOf('contract', 'com.acme.contracts')] as never)[0].fromPackage).toBeUndefined();
  });

  it('undeclared: every list shows, as before', () => {
    expect(names(account, [account, contact, childOf('contract', 'com.acme.contracts'), opportunity])).toEqual([
      'contact', 'contract', 'opportunity',
    ]);
  });
});
