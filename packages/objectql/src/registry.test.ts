import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SchemaRegistry, applySystemFields, reconcileManagedApiMethods, warnStrippedLegacyApiMethods, warnFunctionalCompleteness, computeFQN, parseFQN } from './registry';
import { AUDIT_PROVENANCE_FIELDS, type ServiceObject } from '@objectstack/spec/data';

describe('SchemaRegistry', () => {
    let registry: SchemaRegistry;
    beforeEach(() => {
        // Use multiTenant: false in the bulk of the suite so the existing
        // assertions don't need to know about auto-injected system fields.
        // applySystemFields() has its own dedicated suite below.
        registry = new SchemaRegistry({ multiTenant: false });
    });

    // ==========================================
    // computeFQN / parseFQN — convention tests
    // ==========================================
    describe('computeFQN', () => {
        it('should return the short name unchanged (no namespace prefix)', () => {
            expect(computeFQN('crm', 'account')).toBe('account');
            expect(computeFQN('todo', 'task')).toBe('task');
        });

        it('should return the name for reserved namespaces', () => {
            expect(computeFQN('base', 'user')).toBe('user');
            expect(computeFQN('system', 'organization')).toBe('organization');
        });

        it('should return the name for undefined namespace', () => {
            expect(computeFQN(undefined, 'task')).toBe('task');
        });
    });

    describe('parseFQN', () => {
        it('should parse legacy FQN with double-underscore', () => {
            expect(parseFQN('crm__account')).toEqual({ namespace: 'crm', shortName: 'account' });
            expect(parseFQN('todo__task')).toEqual({ namespace: 'todo', shortName: 'task' });
        });

        it('should parse unprefixed names', () => {
            expect(parseFQN('user')).toEqual({ namespace: undefined, shortName: 'user' });
            expect(parseFQN('task')).toEqual({ namespace: undefined, shortName: 'task' });
        });
    });

    // ==========================================
    // Namespace Management Tests
    // ==========================================
    describe('Namespace Management', () => {
        it('should register namespace', () => {
            registry.registerNamespace('crm', 'com.example.crm');
            expect(registry.getNamespaceOwner('crm')).toBe('com.example.crm');
        });

        it('should allow same package to re-register namespace', () => {
            registry.registerNamespace('crm', 'com.example.crm');
            expect(() => {
                registry.registerNamespace('crm', 'com.example.crm');
            }).not.toThrow();
        });

        it('should allow multiple packages to share a namespace', () => {
            registry.registerNamespace('sys', 'com.objectstack.auth');
            registry.registerNamespace('sys', 'com.objectstack.security');
            // First registered package returned for backwards compat
            expect(registry.getNamespaceOwner('sys')).toBe('com.objectstack.auth');
            expect(registry.getNamespaceOwners('sys')).toEqual([
                'com.objectstack.auth',
                'com.objectstack.security',
            ]);
        });

        it('should unregister namespace', () => {
            registry.registerNamespace('crm', 'com.example.crm');
            registry.unregisterNamespace('crm', 'com.example.crm');
            expect(registry.getNamespaceOwner('crm')).toBeUndefined();
        });

        it('should keep namespace when one of multiple packages unregisters', () => {
            registry.registerNamespace('sys', 'com.objectstack.auth');
            registry.registerNamespace('sys', 'com.objectstack.setup');
            registry.unregisterNamespace('sys', 'com.objectstack.setup');
            expect(registry.getNamespaceOwner('sys')).toBe('com.objectstack.auth');
        });
    });

    // ==========================================
    // Object Ownership Tests
    // ==========================================
    describe('Object Ownership', () => {
        it('should register owned object using object name as canonical key', () => {
            const obj: ServiceObject = { name: 'account', fields: { name: { type: 'text' } } };
            const key = registry.registerObject(obj, 'com.example.crm', 'crm', 'own');

            expect(key).toBe('account');
            const resolved = registry.getObject('account');
            expect(resolved).toBeDefined();
            expect(resolved?.name).toBe('account');
        });

        it('should register object without namespace', () => {
            const obj: ServiceObject = { name: 'task', fields: {} };
            const key = registry.registerObject(obj, 'com.example.app');

            expect(key).toBe('task');
            expect(registry.getObject('task')).toBeDefined();
        });

        it('should allow only one owner per object name', () => {
            const obj: ServiceObject = { name: 'shared', fields: {} };
            registry.registerObject(obj, 'com.vendor.a', 'vendor_a', 'own');

            const obj2: ServiceObject = { name: 'shared', fields: {} };
            expect(() => {
                registry.registerObject(obj2, 'com.vendor.b', undefined, 'own');
            }).toThrow(/already owned/);
        });

        it('should allow re-registration by same owner', () => {
            const obj: ServiceObject = { name: 'account', fields: { v1: { type: 'text' } } };
            registry.registerObject(obj, 'com.example.crm', 'crm', 'own');

            const obj2: ServiceObject = { name: 'account', fields: { v2: { type: 'text' } } };
            expect(() => {
                registry.registerObject(obj2, 'com.example.crm', 'crm', 'own');
            }).not.toThrow();

            const resolved = registry.getObject('account');
            expect(resolved?.fields).toHaveProperty('v2');
        });
    });

    // ==========================================
    // ADR-0079 — primary-title designation (designate-only, no synthesis)
    // ==========================================
    describe('ADR-0079 primary-title designation', () => {
        it('designates nameField from an existing title-eligible field when none declared', () => {
            // No `nameField` declared; `title` (text) is derivable → registry
            // should DESIGNATE it on the owned object.
            const obj: ServiceObject = { name: 'ticket', fields: { notes: { type: 'text' }, title: { type: 'text' } } };
            registry.registerObject(obj, 'com.example.crm', undefined, 'own');

            const resolved = registry.getObject('ticket');
            expect((resolved as any)?.nameField).toBe('title');
            // designate-only: declared fields preserved, NO `name` column synthesized
            // (system audit/tenant fields may be injected by applySystemFields).
            expect(resolved?.fields).toHaveProperty('notes');
            expect(resolved?.fields).toHaveProperty('title');
            expect(resolved?.fields).not.toHaveProperty('name');
        });

        it('prefers a `name`-ish field and respects an explicit pointer', () => {
            const named: ServiceObject = { name: 'company', fields: { description: { type: 'text' }, company_name: { type: 'text' } } };
            registry.registerObject(named, 'com.crm', undefined, 'own');
            expect((registry.getObject('company') as any)?.nameField).toBe('company_name');

            const explicit: ServiceObject = { name: 'invoice', nameField: 'ref', fields: { ref: { type: 'text' }, memo: { type: 'text' } } };
            registry.registerObject(explicit, 'com.fin', undefined, 'own');
            expect((registry.getObject('invoice') as any)?.nameField).toBe('ref');
        });

        it('does NOT add a `name` column to a title-LESS object (no schema migration)', () => {
            // currency/date/select/lookup → nothing title-eligible. The object
            // must be left as-is: no `nameField`, no synthesized `name` field.
            const obj: ServiceObject = {
                name: 'sys_ledger_entry',
                fields: {
                    amount: { type: 'currency' },
                    posted_at: { type: 'datetime' },
                    status: { type: 'select' },
                    account: { type: 'lookup' },
                },
            };
            registry.registerObject(obj, 'com.objectstack.system', undefined, 'own');

            const resolved = registry.getObject('sys_ledger_entry');
            // Nothing title-eligible (currency/date/select/lookup + injected
            // audit lookups/datetimes are all ineligible) → no designation and,
            // critically, NO `name` column synthesized (no schema migration).
            expect((resolved as any)?.nameField).toBeUndefined();
            expect(resolved?.fields).not.toHaveProperty('name');
            // declared fields untouched
            for (const f of ['amount', 'posted_at', 'status', 'account']) {
                expect(resolved?.fields).toHaveProperty(f);
            }
        });

        it('does NOT add a `name` column to a FIELDLESS object', () => {
            const obj: ServiceObject = { name: 'sys_empty', fields: {} };
            registry.registerObject(obj, 'com.objectstack.system', undefined, 'own');

            const resolved = registry.getObject('sys_empty');
            expect((resolved as any)?.nameField).toBeUndefined();
            expect(resolved?.fields).not.toHaveProperty('name');
        });
    });

    // ==========================================
    // Object Extension Tests
    // ==========================================
    describe('Object Extension', () => {
        it('should merge extension fields into owner', () => {
            const owner: ServiceObject = { name: 'contact', fields: { email: { type: 'text' } } };
            registry.registerObject(owner, 'com.base', 'base', 'own');

            const ext: ServiceObject = { name: 'contact', fields: { phone: { type: 'text' } } };
            registry.registerObject(ext, 'com.crm', undefined, 'extend', 200);

            const resolved = registry.getObject('contact');
            expect(resolved?.fields).toHaveProperty('email');
            expect(resolved?.fields).toHaveProperty('phone');
        });

        it('should apply priority order (higher wins)', () => {
            const owner: ServiceObject = { name: 'task', label: 'Task', fields: {} };
            registry.registerObject(owner, 'com.base', 'base', 'own', 100);

            const ext1: ServiceObject = { name: 'task', label: 'Extended Task', fields: {} };
            registry.registerObject(ext1, 'com.ext1', undefined, 'extend', 150);

            const ext2: ServiceObject = { name: 'task', label: 'Final Task', fields: {} };
            registry.registerObject(ext2, 'com.ext2', undefined, 'extend', 250);

            const resolved = registry.getObject('task');
            expect(resolved?.label).toBe('Final Task');
        });

        it('should merge validations additively', () => {
            const owner: ServiceObject = { name: 'order', fields: {}, validations: [{ type: 'required', name: 'id_required', message: 'id is required', field: 'id' }] };
            registry.registerObject(owner, 'com.base', 'base', 'own');

            const ext: ServiceObject = { name: 'order', fields: {}, validations: [{ type: 'required', name: 'status_required', message: 'status is required', field: 'status' }] };
            registry.registerObject(ext, 'com.ext', undefined, 'extend');

            const resolved = registry.getObject('order');
            expect(resolved?.validations).toHaveLength(2);
        });

        it('should fail extension without owner', () => {
            const ext: ServiceObject = { name: 'phantom', fields: {} };
            registry.registerObject(ext, 'com.ext', undefined, 'extend');

            const resolved = registry.getObject('phantom');
            expect(resolved).toBeUndefined();
        });
    });

    // ==========================================
    // Object Resolution Tests
    // ==========================================
    describe('Object Resolution', () => {
        it('should resolve by canonical name', () => {
            const obj: ServiceObject = { name: 'deal', fields: {} };
            registry.registerObject(obj, 'com.crm', 'crm', 'own');

            expect(registry.resolveObject('deal')).toBeDefined();
        });

        it('should resolve system objects by their sys_ prefixed name', () => {
            const obj: ServiceObject = { name: 'sys_user', fields: {} };
            registry.registerObject(obj, 'com.objectstack.system', 'sys', 'own');

            expect(registry.getObject('sys_user')).toBeDefined();
        });

        it('should cache merged objects', () => {
            const obj: ServiceObject = { name: 'cached', fields: {} };
            registry.registerObject(obj, 'com.test', 'test', 'own');

            const first = registry.resolveObject('cached');
            const second = registry.resolveObject('cached');
            expect(first).toBe(second);
        });

        it('should invalidate cache on re-registration', () => {
            const obj: ServiceObject = { name: 'evolve', fields: { v1: { type: 'text' } } };
            registry.registerObject(obj, 'com.test', 'test', 'own');

            const first = registry.resolveObject('evolve');

            const obj2: ServiceObject = { name: 'evolve', fields: { v2: { type: 'text' } } };
            registry.registerObject(obj2, 'com.test', 'test', 'own');

            const second = registry.resolveObject('evolve');
            expect(first).not.toBe(second);
            expect(second?.fields).toHaveProperty('v2');
        });
    });

    // ==========================================
    // getAllObjects Tests
    // ==========================================
    describe('getAllObjects', () => {
        it('should return all merged objects', () => {
            registry.registerObject({ name: 'a', fields: {} }, 'com.pkg1', 'pkg1', 'own');
            registry.registerObject({ name: 'b', fields: {} }, 'com.pkg2', 'pkg2', 'own');

            const all = registry.getAllObjects();
            expect(all).toHaveLength(2);
            expect(all.map(o => o.name).sort()).toEqual(['a', 'b']);
        });

        it('should filter by packageId', () => {
            registry.registerObject({ name: 'a', fields: {} }, 'com.pkg1', 'pkg1', 'own');
            registry.registerObject({ name: 'b', fields: {} }, 'com.pkg2', 'pkg2', 'own');

            const filtered = registry.getAllObjects('com.pkg1');
            expect(filtered).toHaveLength(1);
            expect(filtered[0].name).toBe('a');
        });

        it('should include objects where package is extender', () => {
            registry.registerObject({ name: 'base_obj', fields: {} }, 'com.owner', 'base', 'own');
            registry.registerObject({ name: 'base_obj', fields: { ext: { type: 'text' } } }, 'com.extender', undefined, 'extend');

            const filtered = registry.getAllObjects('com.extender');
            expect(filtered).toHaveLength(1);
        });
    });

    // ==========================================
    // Uninstall Tests
    // ==========================================
    describe('Uninstall', () => {
        it('should remove owner contribution', () => {
            registry.registerObject({ name: 'removable', fields: {} }, 'com.pkg', 'pkg', 'own');
            expect(registry.getObject('removable')).toBeDefined();

            registry.unregisterObjectsByPackage('com.pkg');
            expect(registry.getObject('removable')).toBeUndefined();
        });

        it('should remove extension contribution', () => {
            registry.registerObject({ name: 'target', fields: { base: { type: 'text' } } }, 'com.owner', 'base', 'own');
            registry.registerObject({ name: 'target', fields: { ext: { type: 'text' } } }, 'com.ext', undefined, 'extend');

            registry.unregisterObjectsByPackage('com.ext');

            const resolved = registry.getObject('target');
            expect(resolved?.fields).toHaveProperty('base');
            expect(resolved?.fields).not.toHaveProperty('ext');
        });

        it('should prevent uninstall of owner with active extenders', () => {
            registry.registerObject({ name: 'important', fields: {} }, 'com.owner', 'base', 'own');
            registry.registerObject({ name: 'important', fields: {} }, 'com.ext', undefined, 'extend');

            expect(() => {
                registry.unregisterObjectsByPackage('com.owner');
            }).toThrow(/extended by/);
        });

        it('should allow force uninstall of owner with extenders', () => {
            registry.registerObject({ name: 'forced', fields: {} }, 'com.owner', 'base', 'own');
            registry.registerObject({ name: 'forced', fields: {} }, 'com.ext', undefined, 'extend');

            expect(() => {
                registry.unregisterObjectsByPackage('com.owner', true);
            }).not.toThrow();
        });
    });

    // ==========================================
    // Contributors API Tests
    // ==========================================
    describe('Contributors API', () => {
        it('should return all contributors for object', () => {
            registry.registerObject({ name: 'multi', fields: {} }, 'com.owner', 'pkg', 'own', 100);
            registry.registerObject({ name: 'multi', fields: {} }, 'com.ext1', undefined, 'extend', 200);
            registry.registerObject({ name: 'multi', fields: {} }, 'com.ext2', undefined, 'extend', 300);

            const contribs = registry.getObjectContributors('multi');
            expect(contribs).toHaveLength(3);
            expect(contribs[0].priority).toBe(100);
            expect(contribs[1].priority).toBe(200);
            expect(contribs[2].priority).toBe(300);
        });

        it('should return owner contributor', () => {
            registry.registerObject({ name: 'owned', fields: {} }, 'com.owner', 'pkg', 'own');

            const owner = registry.getObjectOwner('owned');
            expect(owner).toBeDefined();
            expect(owner?.packageId).toBe('com.owner');
            expect(owner?.ownership).toBe('own');
        });
    });

    // ==========================================
    // Generic Metadata Tests (Non-Object)
    // ==========================================
    describe('Generic Metadata', () => {
        it('should register and retrieve generic items', () => {
            const item = { name: 'test_action', type: 'custom' };
            registry.registerItem('action', item, 'name', 'com.pkg');

            const retrieved = registry.getItem('action', 'test_action');
            expect(retrieved).toEqual(item);
        });

        it('should list items by type with package filter', () => {
            registry.registerItem('action', { name: 'a1' }, 'name', 'com.pkg1');
            registry.registerItem('action', { name: 'a2' }, 'name', 'com.pkg2');

            const filtered = registry.listItems('action', 'com.pkg1');
            expect(filtered).toHaveLength(1);
        });
    });

    // ==========================================
    // Package Management Tests
    // ==========================================
    describe('Package Management', () => {
        it('should install package with namespace', () => {
            const manifest = { id: 'com.test', name: 'Test', namespace: 'test', version: '1.0.0' };
            const pkg = registry.installPackage(manifest as any);

            expect(pkg.status).toBe('installed');
            expect(registry.getNamespaceOwner('test')).toBe('com.test');
        });

        it('should uninstall package and release namespace', () => {
            const manifest = { id: 'com.test', name: 'Test', namespace: 'test', version: '1.0.0' };
            registry.installPackage(manifest as any);

            registry.uninstallPackage('com.test');
            expect(registry.getPackage('com.test')).toBeUndefined();
            expect(registry.getNamespaceOwner('test')).toBeUndefined();
        });

        it('updatePackageManifest merges editable fields, preserving lifecycle state', () => {
            registry.installPackage({ id: 'com.test', name: 'Old', version: '1.0.0' } as any);
            registry.disablePackage('com.test'); // lifecycle state that must survive an edit

            const updated = registry.updatePackageManifest('com.test', {
                name: 'New Name',
                description: 'now with a description',
                version: '2.0.0',
            });

            expect(updated?.manifest.name).toBe('New Name');
            expect((updated?.manifest as any).description).toBe('now with a description');
            expect(updated?.manifest.version).toBe('2.0.0');
            // Editing metadata must NOT re-enable a disabled package.
            expect(updated?.enabled).toBe(false);
            expect(updated?.status).toBe('disabled');
        });

        it('updatePackageManifest only overwrites the fields present in the patch', () => {
            registry.installPackage({ id: 'com.test', name: 'Keep', version: '1.0.0' } as any);
            const updated = registry.updatePackageManifest('com.test', { description: 'only this' });
            expect(updated?.manifest.name).toBe('Keep');
            expect(updated?.manifest.version).toBe('1.0.0');
            expect((updated?.manifest as any).description).toBe('only this');
        });

        it('updatePackageManifest returns undefined for an unknown package', () => {
            expect(registry.updatePackageManifest('nope', { name: 'x' })).toBeUndefined();
        });
    });

    // ==========================================
    // Reset Tests
    // ==========================================
    describe('Reset', () => {
        it('should clear all state', () => {
            registry.registerObject({ name: 'obj', fields: {} }, 'com.pkg', 'pkg', 'own');
            registry.registerItem('action', { name: 'act' }, 'name');

            registry.reset();

            expect(registry.getAllObjects()).toHaveLength(0);
            expect(registry.listItems('action')).toHaveLength(0);
        });
    });

    // ==========================================
    // listItems/getItem for 'object' type Tests
    // ==========================================
    describe('listItems and getItem for object type', () => {
        it('listItems("object") should return all registered objects', () => {
            registry.registerObject(
                { name: 'account', label: 'Account', fields: {} } as any,
                'com.crm',
                'crm',
                'own'
            );
            registry.registerObject(
                { name: 'contact', label: 'Contact', fields: {} } as any,
                'com.crm',
                'crm',
                'own'
            );

            const objects = registry.listItems('object');
            expect(objects).toHaveLength(2);
            expect(objects.map((o: any) => o.name).sort()).toEqual(['account', 'contact']);
        });

        it('listItems("objects") should return all registered objects (plural alias)', () => {
            registry.registerObject(
                { name: 'task', label: 'Task', fields: {} } as any,
                'com.todo',
                'todo',
                'own'
            );

            const objects = registry.listItems('objects');
            expect(objects).toHaveLength(1);
            expect((objects[0] as any).name).toBe('task');
        });

        it('getItem("object", name) should return object by canonical name', () => {
            registry.registerObject(
                { name: 'lead', label: 'Lead', fields: { status: { type: 'text' } } } as any,
                'com.crm',
                'crm',
                'own'
            );

            const obj = registry.getItem('object', 'lead');
            expect(obj).toBeDefined();
            expect((obj as any).name).toBe('lead');
            expect((obj as any).label).toBe('Lead');
        });

        it('getItem("object", name) should return object by name', () => {
            registry.registerObject(
                { name: 'opportunity', label: 'Opportunity', fields: {} } as any,
                'com.crm',
                'crm',
                'own'
            );

            const obj = registry.getItem('object', 'opportunity');
            expect(obj).toBeDefined();
            expect((obj as any).name).toBe('opportunity');
        });

        it('listItems("object", packageId) should filter by package', () => {
            registry.registerObject(
                { name: 'account', fields: {} } as any,
                'com.crm',
                'crm',
                'own'
            );
            registry.registerObject(
                { name: 'task', fields: {} } as any,
                'com.todo',
                'todo',
                'own'
            );

            const crmObjects = registry.listItems('object', 'com.crm');
            expect(crmObjects).toHaveLength(1);
            expect((crmObjects[0] as any).name).toBe('account');

            const todoObjects = registry.listItems('object', 'com.todo');
            expect(todoObjects).toHaveLength(1);
            expect((todoObjects[0] as any).name).toBe('task');
        });
    });
});

// ==========================================
// applySystemFields — system field auto-injection
// ==========================================
describe('applySystemFields', () => {
    const baseLead: any = { name: 'lead', label: 'Lead', fields: { first_name: { type: 'text' } } };

    it('injects an indexed organization_id when multiTenant is true and field is missing', () => {
        const out = applySystemFields(baseLead, { multiTenant: true });
        expect(out.fields.organization_id).toBeDefined();
        expect(out.fields.organization_id.type).toBe('lookup');
        expect(out.fields.organization_id.reference).toBe('sys_organization');
        // [#6810] Multi-tenant stacks index the column (per-tenant filtering) —
        // declared in `indexes[]`, which is what a driver materializes from. The
        // field-level `indexed: true` this used to read was never a
        // `FieldSchema` key (#2377 / ADR-0049) and only ever reached one driver.
        expect((out as any).indexes).toEqual([{ fields: ['organization_id'] }]);
        expect(out.fields.organization_id.indexed).toBeUndefined();
        // author-declared field still present
        expect(out.fields.first_name).toBeDefined();
    });

    it('still injects organization_id when multiTenant is false, but unindexed', () => {
        // The COLUMN is always provisioned (decoupled from the tenant flag) so
        // sudo writers can always stamp it; only the index is gated, since a
        // single-tenant DB never filters by organization.
        const out = applySystemFields(baseLead, { multiTenant: false });
        expect(out.fields.organization_id).toBeDefined();
        expect(out.fields.organization_id.type).toBe('lookup');
        // [#6810] "Unindexed" is now the ABSENCE of a declaration, not a
        // declaration whose value is false.
        expect((out as any).indexes).toBeUndefined();
        expect(out.fields.organization_id.indexed).toBeUndefined();
        // audit fields are tenant-independent — still injected
        expect(out.fields.created_at).toBeDefined();
        expect(out.fields.updated_at).toBeDefined();
    });

    it('injects exactly the spec AUDIT_PROVENANCE_FIELDS, byte-identical to the pre-#3786 defs', () => {
        // The injection table is keyed by the spec tuple with a `satisfies`
        // exhaustiveness clause, so which columns exist cannot drift from the
        // spec. This pins the OTHER half — that the refactor from four
        // if-blocks to the table changed nothing about what gets injected.
        const out = applySystemFields(baseLead, { multiTenant: false });
        for (const name of AUDIT_PROVENANCE_FIELDS) {
            expect(out.fields[name], name).toBeDefined();
            expect(out.fields[name].system, `${name}.system`).toBe(true);
            expect(out.fields[name].readonly, `${name}.readonly`).toBe(true);
            expect(out.fields[name].required, `${name}.required`).toBe(false);
        }
        expect(out.fields.created_at.type).toBe('datetime');
        expect(out.fields.updated_at.type).toBe('datetime');
        expect(out.fields.created_by).toMatchObject({ type: 'lookup', reference: 'sys_user', label: 'Created By' });
        expect(out.fields.updated_by).toMatchObject({ type: 'lookup', reference: 'sys_user', label: 'Last Modified By' });
        expect(out.fields.created_at.label).toBe('Created At');
        expect(out.fields.updated_at.label).toBe('Last Modified At');
    });

    it('does NOT overwrite an author-declared organization_id', () => {
        const declared: any = {
            name: 'lead',
            fields: { organization_id: { type: 'text', label: 'Org Code' } },
        };
        const out = applySystemFields(declared, { multiTenant: true });
        // organization_id preserved; audit fields still injected
        expect(out.fields.organization_id.label).toBe('Org Code');
        expect(out.fields.created_at).toBeDefined();
    });

    it('respects systemFields: false opt-out', () => {
        const opted: any = { ...baseLead, systemFields: false };
        const out = applySystemFields(opted, { multiTenant: true });
        expect(out).toBe(opted);
        expect(out.fields.organization_id).toBeUndefined();
        expect(out.fields.created_at).toBeUndefined();
    });

    it('respects systemFields.tenant: false opt-out (audit fields still injected)', () => {
        const opted: any = { ...baseLead, systemFields: { tenant: false } };
        const out = applySystemFields(opted, { multiTenant: true });
        expect(out.fields.organization_id).toBeUndefined();
        expect(out.fields.created_at).toBeDefined();
        expect(out.fields.updated_by).toBeDefined();
    });

    it('respects systemFields.audit: false opt-out (tenant field still injected)', () => {
        const opted: any = { ...baseLead, systemFields: { audit: false } };
        const out = applySystemFields(opted, { multiTenant: true });
        expect(out.fields.organization_id).toBeDefined();
        expect(out.fields.created_at).toBeUndefined();
        expect(out.fields.created_by).toBeUndefined();
        expect(out.fields.updated_at).toBeUndefined();
        expect(out.fields.updated_by).toBeUndefined();
    });

    it('skips externally-managed objects (managedBy set)', () => {
        const sysUser: any = { name: 'sys_user', managedBy: 'better-auth', fields: { email: { type: 'text' } } };
        const out = applySystemFields(sysUser, { multiTenant: true });
        expect(out).toBe(sysUser);
        expect(out.fields.organization_id).toBeUndefined();
        expect(out.fields.created_at).toBeUndefined();
    });

    it('injects all four audit fields with the expected shape', () => {
        const out = applySystemFields(baseLead, { multiTenant: false });
        expect(out.fields.created_at).toMatchObject({
            type: 'datetime', system: true, readonly: true,
        });
        expect(out.fields.created_by).toMatchObject({
            type: 'lookup', reference: 'sys_user', system: true, readonly: true,
        });
        expect(out.fields.updated_at).toMatchObject({
            type: 'datetime', system: true, readonly: true,
        });
        expect(out.fields.updated_by).toMatchObject({
            type: 'lookup', reference: 'sys_user', system: true, readonly: true,
        });
    });

    it('does NOT overwrite author-declared audit fields', () => {
        const declared: any = {
            name: 'lead',
            fields: {
                created_at: { type: 'text', label: 'Custom Created' },
                updated_by: { type: 'text', label: 'Custom Updater' },
            },
        };
        const out = applySystemFields(declared, { multiTenant: false });
        expect(out.fields.created_at.type).toBe('text');
        expect(out.fields.created_at.label).toBe('Custom Created');
        expect(out.fields.updated_by.type).toBe('text');
        // The missing ones are still injected as system fields
        expect(out.fields.created_by).toMatchObject({ system: true });
        expect(out.fields.updated_at).toMatchObject({ system: true });
    });

    // ── owner_id — canonical, reassignable record owner ──────────────────
    it('injects owner_id by default on a business object (reassignable, not readonly)', () => {
        const out = applySystemFields(baseLead, { multiTenant: false });
        expect(out.fields.owner_id).toMatchObject({
            type: 'lookup', reference: 'sys_user', system: true, readonly: false,
        });
        // Unlike the audit *_by lookups, owner is editable (ownership transfers).
        expect(out.fields.owner_id.readonly).toBe(false);
    });

    it('does NOT inject owner_id for managedBy tables', () => {
        const platform: any = { name: 'sys_audit_log', managedBy: 'platform', fields: { msg: { type: 'text' } } };
        const out = applySystemFields(platform, { multiTenant: false });
        expect(out.fields.owner_id).toBeUndefined();
    });

    it('does NOT inject owner_id for sys_* objects', () => {
        const sysish: any = { name: 'sys_widget', fields: { msg: { type: 'text' } } };
        const out = applySystemFields(sysish, { multiTenant: false });
        expect(out.fields.owner_id).toBeUndefined();
        // audit/tenant fields are still injected for non-managed sys_ objects
        expect(out.fields.created_at).toBeDefined();
    });

    it('respects ownership: "org" / "none" opt-out (audit + tenant still injected)', () => {
        for (const ownership of ['org', 'none'] as const) {
            const opted: any = { ...baseLead, ownership };
            const out = applySystemFields(opted, { multiTenant: false });
            expect(out.fields.owner_id).toBeUndefined();
            expect(out.fields.created_at).toBeDefined();
        }
    });

    it('does NOT overwrite an author-declared owner_id', () => {
        const declared: any = {
            name: 'lead',
            fields: { owner_id: { type: 'lookup', reference: 'sys_user', label: 'Custom Owner', readonly: true } },
        };
        const out = applySystemFields(declared, { multiTenant: false });
        expect(out.fields.owner_id.label).toBe('Custom Owner');
        expect(out.fields.owner_id.readonly).toBe(true);
    });

    // ── ADR-0117 D1 — owning_business_unit_id + the wantOwner allow-list ──
    //
    // The flip under test: `wantOwner` used to be a DENY-list
    // (`ownership !== 'org' && ownership !== 'none' && …`), so any value
    // outside those two — including D1's new `business_unit` tier — fell into
    // the default branch and got stamped with `owner_id`, the exact INVERSE of
    // D1's table. It is now an allow-list (`undefined | 'user'`), and a second
    // anchor covers the union of the owner tiers with `business_unit`:
    //
    //   ownership        owner_id   owning_business_unit_id
    //   undefined/user      ✅              ✅
    //   business_unit       ❌              ✅
    //   org                 ❌              ❌
    //   none                ❌              ❌
    //
    // `ownership: 'business_unit'` is a legal ObjectSchema value as of #5678,
    // which landed strictly AFTER #5677 — that ordering is #5677's whole point:
    // the engine must honour the tier before the schema can emit it, or the
    // tier's first appearance gets the inverse result. These fixtures used to
    // duck-type the schema through `as any` for exactly that gap; the casts are
    // gone now that `ServiceObject` (`z.input<typeof ObjectSchemaBase>`) admits
    // the value, and not one assertion below changed when they were removed.
    describe('[ADR-0117 D1] owning_business_unit_id injection', () => {
        it("does NOT inject owner_id for ownership: 'business_unit' — but DOES inject owning_business_unit_id", () => {
            // THE regression this issue exists to prevent. Under the old
            // deny-list this object was stamped `owner_id` (a person) even
            // though the tier's entire meaning is "owned by a unit, not a
            // person" — see #4611's one-shot probe.
            const unitOwned: ServiceObject = { ...baseLead, name: 'inventory_item', ownership: 'business_unit' };
            const out = applySystemFields(unitOwned, { multiTenant: false });

            expect(out.fields.owner_id).toBeUndefined();
            expect(out.fields.owning_business_unit_id).toMatchObject({
                type: 'lookup',
                reference: 'sys_business_unit',
                system: true,
            });
            // Tenant + audit columns are orthogonal to the ownership axis.
            expect(out.fields.organization_id).toBeDefined();
            expect(out.fields.created_at).toBeDefined();
        });

        it("injects BOTH anchors on the default tier and on an explicit ownership: 'user'", () => {
            for (const schema of [baseLead, { ...baseLead, ownership: 'user' } satisfies ServiceObject]) {
                const out = applySystemFields(schema, { multiTenant: false });
                expect(out.fields.owner_id).toBeDefined();
                expect(out.fields.owning_business_unit_id).toBeDefined();
            }
        });

        it("injects NEITHER anchor for ownership: 'org' / 'none'", () => {
            // The BU column follows `owner_id` out the door on the opt-out
            // tiers: a catalog/junction table has no per-record owner of
            // EITHER kind. (The pre-existing owner_id half of this is pinned
            // separately above — that test is what proves the allow-list flip
            // left the three existing values untouched.)
            for (const ownership of ['org', 'none'] as const) {
                const opted: any = { ...baseLead, ownership };
                const out = applySystemFields(opted, { multiTenant: false });
                expect(out.fields.owner_id).toBeUndefined();
                expect(out.fields.owning_business_unit_id).toBeUndefined();
            }
        });

        it('does NOT inject owning_business_unit_id for managedBy / sys_* tables', () => {
            const platform: any = { name: 'proj_thing', managedBy: 'platform', fields: { msg: { type: 'text' } } };
            expect(applySystemFields(platform, { multiTenant: false }).fields.owning_business_unit_id).toBeUndefined();

            const sysish: any = { name: 'sys_widget', fields: { msg: { type: 'text' } } };
            expect(applySystemFields(sysish, { multiTenant: false }).fields.owning_business_unit_id).toBeUndefined();

            // …and the skip is not a side effect of the ownership tier: even
            // the tier that WANTS the column doesn't get it on a managed table.
            const managedUnitOwned: any = {
                name: 'proj_thing', managedBy: 'platform', ownership: 'business_unit', fields: { msg: { type: 'text' } },
            };
            expect(applySystemFields(managedUnitOwned, { multiTenant: false }).fields.owning_business_unit_id).toBeUndefined();
        });

        it('is shaped like organization_id (server-stamped anchor), not like owner_id (assignable field)', () => {
            // The distinction is load-bearing, not cosmetic: D3 requires the
            // value to be derived and validated server-side and D4 makes
            // reassignment a transfer-class operation — neither guard has
            // landed, so no client write path may reach the column. `readonly`
            // + `hidden` grant no capability, which is what keeps every
            // undecided D2 policy (pinned / follow_owner / transferable)
            // reachable from here.
            const out = applySystemFields(baseLead, { multiTenant: true });
            const bu = out.fields.owning_business_unit_id;

            expect(bu.readonly).toBe(true); // ≠ owner_id, which is reassignable
            expect(out.fields.owner_id.readonly).toBe(false);
            expect(bu.hidden).toBe(true);
            expect(bu.system).toBe(true);
            expect(bu.required).toBe(false); // nullable — nothing stamps it yet
            // No index: the hierarchical predicate that would use one ships
            // with the enterprise scope resolver (D6). Unlike organization_id,
            // it is not gated on multiTenant — it is simply absent.
            expect(bu.indexed).toBeUndefined();
        });

        it('does NOT overwrite an author-declared owning_business_unit_id', () => {
            // Same precedence rule as every other injected column: `additions`
            // lose to `schema.fields`.
            const declared: any = {
                name: 'lead',
                fields: { owning_business_unit_id: { type: 'lookup', reference: 'sys_business_unit', label: 'Dept', readonly: false } },
            };
            const out = applySystemFields(declared, { multiTenant: false });
            expect(out.fields.owning_business_unit_id.label).toBe('Dept');
            expect(out.fields.owning_business_unit_id.readonly).toBe(false);
        });
    });

    it('SchemaRegistry({ multiTenant: true }) auto-injects on registerObject', () => {
        const reg = new SchemaRegistry({ multiTenant: true });
        reg.registerObject({ name: 'lead', fields: { first_name: { type: 'text' } } }, 'crm', 'crm', 'own');
        const stored = (reg as any).objectContributors.get('lead')[0].definition;
        expect(stored.fields.organization_id).toBeDefined();
        expect(stored.fields.organization_id.reference).toBe('sys_organization');
        expect(stored.fields.created_at).toMatchObject({ system: true, readonly: true });
        expect(stored.fields.updated_by).toMatchObject({ system: true, readonly: true });
    });
});

// ==========================================
// reconcileManagedApiMethods — #1591 / ADR-0092 / ADR-0103
// Registration-time consistency: ANY managed object may not advertise generic
// write verbs its resolved affordances don't grant. Scope generalized from
// better-auth to every managed bucket in ADR-0103.
// ==========================================
describe('reconcileManagedApiMethods', () => {
    const managed = (extra: any = {}): any => ({
        name: 'sys_thing',
        managedBy: 'better-auth',
        enable: { apiEnabled: true, apiMethods: ['get', 'list', 'create', 'update', 'delete'] },
        ...extra,
    });

    it('strips create/update/delete from a better-auth object with no write affordances', () => {
        const warn = vi.fn();
        const out = reconcileManagedApiMethods(managed(), { warn });
        expect(out).not.toBe(managed()); // new object
        expect(out.enable.apiMethods).toEqual(['get', 'list']);
        // Warning names the object and the stripped verbs.
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain('sys_thing');
        expect(warn.mock.calls[0][0]).toContain('create');
    });

    it('keeps update when userActions.edit grants the edit affordance (sys_user case)', () => {
        const warn = vi.fn();
        const out = reconcileManagedApiMethods(
            managed({ userActions: { edit: true }, enable: { apiEnabled: true, apiMethods: ['get', 'list', 'create', 'update', 'delete'] } }),
            { warn },
        );
        // update survives (edit affordance granted); create/delete still stripped.
        expect(out.enable.apiMethods).toEqual(['get', 'list', 'update']);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('is a no-op (same reference, no warning) when nothing needs stripping', () => {
        const warn = vi.fn();
        const already: any = managed({ enable: { apiEnabled: true, apiMethods: ['get', 'list'] } });
        const out = reconcileManagedApiMethods(already, { warn });
        expect(out).toBe(already);
        expect(warn).not.toHaveBeenCalled();
    });

    it('never touches read verbs', () => {
        const out = reconcileManagedApiMethods(
            managed({ enable: { apiEnabled: true, apiMethods: ['get', 'delete'] } }),
            { warn: vi.fn() },
        );
        expect(out.enable.apiMethods).toEqual(['get']);
    });

    it('leaves platform-bucket objects untouched (grant full CRUD → nothing stripped)', () => {
        const warn = vi.fn();
        const platform: any = {
            name: 'sys_business_unit',
            managedBy: 'platform',
            enable: { apiEnabled: true, apiMethods: ['get', 'list', 'create', 'update', 'delete'] },
        };
        const out = reconcileManagedApiMethods(platform, { warn });
        expect(out).toBe(platform);
        expect(out.enable.apiMethods).toEqual(['get', 'list', 'create', 'update', 'delete']);
        expect(warn).not.toHaveBeenCalled();
    });

    it('leaves unmanaged objects (no managedBy) untouched', () => {
        const warn = vi.fn();
        const plain: any = {
            name: 'crm_lead',
            enable: { apiEnabled: true, apiMethods: ['get', 'list', 'create', 'update', 'delete'] },
        };
        const out = reconcileManagedApiMethods(plain, { warn });
        expect(out).toBe(plain);
        expect(warn).not.toHaveBeenCalled();
    });

    // ADR-0103 — the scope generalization: engine-owned/append-only objects
    // derive to reads, while the writable set keeps its verbs.
    it('strips write verbs from an engine-owned object with no write affordances', () => {
        const warn = vi.fn();
        const engineOwned: any = {
            name: 'sys_automation_run',
            // #3355: this object has been `engine-owned` since the v16 split; the
            // fixture said `system` only because that value used to double as the
            // engine-owned default. v17 retired the doubling.
            managedBy: 'engine-owned',
            enable: { apiEnabled: true, apiMethods: ['get', 'list', 'create', 'update', 'delete'] },
        };
        const out = reconcileManagedApiMethods(engineOwned, { warn });
        expect(out.enable.apiMethods).toEqual(['get', 'list']);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain("managedBy:'engine-owned'");
    });

    it('strips write verbs from an append-only object with no write affordances', () => {
        const warn = vi.fn();
        const appendOnly: any = {
            name: 'sys_email',
            managedBy: 'append-only',
            enable: { apiEnabled: true, apiMethods: ['get', 'list', 'update'] },
        };
        const out = reconcileManagedApiMethods(appendOnly, { warn });
        expect(out.enable.apiMethods).toEqual(['get', 'list']);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('keeps CRUD on a `system-data` object — the bucket default grants the writes (#3355)', () => {
        const warn = vi.fn();
        const writable: any = {
            name: 'sys_user_position',
            // #3355: was `managedBy: 'system'` + a `userActions` re-open block.
            // The rename made create/edit/delete/exportCsv the bucket default, so
            // the reconciliation must reach the same "strip nothing" answer with no
            // `userActions` at all — that equivalence is the whole claim of the
            // rename. (CSV `import` is opt-in on this bucket since #4671, and is
            // not an `apiMethods` verb, so it does not enter this reconciliation.)
            managedBy: 'system-data',
            enable: { apiEnabled: true, apiMethods: ['get', 'list', 'create', 'update', 'delete'] },
        };
        const out = reconcileManagedApiMethods(writable, { warn });
        expect(out).toBe(writable); // nothing stripped
        expect(out.enable.apiMethods).toEqual(['get', 'list', 'create', 'update', 'delete']);
        expect(warn).not.toHaveBeenCalled();
    });

    it('applies on registerObject (the contradiction cannot be stored)', () => {
        const reg = new SchemaRegistry({ multiTenant: false });
        reg.registerObject(managed(), 'sys', 'sys', 'own');
        const stored = (reg as any).objectContributors.get('sys_thing')[0].definition;
        expect(stored.enable.apiMethods).toEqual(['get', 'list']);
    });
});

// ==========================================
// warnStrippedLegacyApiMethods — #3543
// One-shot per-object diagnostic for retired LEGACY apiMethods values (the
// derived 8). Pure observation — never mutates the schema.
// ==========================================
describe('warnStrippedLegacyApiMethods (#3543)', () => {
    it('diagnoses a whitelist declaring a retired legacy value (import/export)', () => {
        const warn = vi.fn();
        warnStrippedLegacyApiMethods(
            { name: 'crm_deal_a', enable: { apiMethods: ['get', 'list', 'create', 'update', 'delete', 'import', 'export'] } } as any,
            { warn },
        );
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain('crm_deal_a');
        expect(warn.mock.calls[0][0]).toContain('import');
        expect(warn.mock.calls[0][0]).toContain('export');
        expect(warn.mock.calls[0][0]).toContain('IGNORED');
        expect(warn.mock.calls[0][0]).toContain('#3543');
        // primitives remain, so no deny-all escalation
        expect(warn.mock.calls[0][0]).not.toContain('deny-all');
    });

    it('escalates when ignoring legacy values leaves NO primitives (deny-all cliff)', () => {
        const warn = vi.fn();
        warnStrippedLegacyApiMethods(
            { name: 'crm_deal_denyall', enable: { apiMethods: ['upsert'] } } as any,
            { warn },
        );
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain('deny-all');
    });

    it('stays silent for a pure-primitive whitelist', () => {
        const warn = vi.fn();
        warnStrippedLegacyApiMethods(
            { name: 'crm_deal_b', enable: { apiMethods: ['get', 'list', 'create', 'update', 'delete', 'bulk'] } } as any,
            { warn },
        );
        expect(warn).not.toHaveBeenCalled();
    });

    it('stays silent for an undefined / empty whitelist', () => {
        const warn = vi.fn();
        warnStrippedLegacyApiMethods({ name: 'crm_deal_c', enable: {} } as any, { warn });
        warnStrippedLegacyApiMethods({ name: 'crm_deal_d', enable: { apiMethods: [] } } as any, { warn });
        expect(warn).not.toHaveBeenCalled();
    });

    it('warns only once per object name (hot path stays free)', () => {
        const warn = vi.fn();
        const schema: any = { name: 'crm_deal_once', enable: { apiMethods: ['list', 'aggregate'] } };
        warnStrippedLegacyApiMethods(schema, { warn });
        warnStrippedLegacyApiMethods(schema, { warn });
        expect(warn).toHaveBeenCalledTimes(1);
    });
});

// ==========================================
// warnFunctionalCompleteness — ADR-0078 Phase 4
// Registration-time twin of `validate-functional-completeness`: the registry
// is the one choke point every metadata door goes through, including the ones
// that skip Zod and lint (#3896, raw registerObject). Same shared predicate,
// same rule ids. Pure observation — never mutates the schema, never throws.
// ==========================================
describe('warnFunctionalCompleteness (ADR-0078 Phase 4)', () => {
    it('diagnoses a bare summary field with the SAME rule id the lint reports', () => {
        const warn = vi.fn();
        warnFunctionalCompleteness(
            { name: 'fc_room', fields: { registration_count: { type: 'summary', label: 'Registrations' } } } as any,
            { warn },
        );
        expect(warn).toHaveBeenCalledTimes(1);
        const msg = warn.mock.calls[0][0] as string;
        expect(msg).toContain('fc_room');
        expect(msg).toContain('registration_count');
        expect(msg).toContain('field/summary-without-operations');
        expect(msg).toContain('ADR-0078');
        // The prescription rides along — a warning with no fix is a dead end.
        expect(msg).toContain('summaryOperations');
    });

    it('aggregates every inert field into ONE line (greppable, not spam)', () => {
        const warn = vi.fn();
        warnFunctionalCompleteness(
            {
                name: 'fc_multi',
                fields: {
                    total: { type: 'summary' },
                    rate: { type: 'formula' },
                    acct: { type: 'lookup' },
                    ok: { type: 'text', label: 'Fine' },
                },
            } as any,
            { warn },
        );
        expect(warn).toHaveBeenCalledTimes(1);
        const msg = warn.mock.calls[0][0] as string;
        expect(msg).toContain('field/summary-without-operations');
        expect(msg).toContain('field/formula-without-expression');
        expect(msg).toContain('field/relationship-without-reference');
        expect(msg).not.toContain('" ok:'); // the healthy field is not named
    });

    it('stays silent for a complete schema — the predicate decides, not this wrapper', () => {
        const warn = vi.fn();
        warnFunctionalCompleteness(
            {
                name: 'fc_clean',
                fields: {
                    total: { type: 'summary', summaryOperations: { object: 'line', field: 'amt', function: 'sum' } },
                    acct: { type: 'lookup', reference: 'account' },
                    stage: { type: 'select', options: [{ label: 'New', value: 'new' }] },
                    tags: { type: 'multiselect' }, // the pinned NON-rule stays a NON-rule here too
                },
            } as any,
            { warn },
        );
        expect(warn).not.toHaveBeenCalled();
    });

    it('stays silent for fieldless / malformed schemas (never the thing that crashes a boot)', () => {
        const warn = vi.fn();
        warnFunctionalCompleteness({ name: 'fc_nofields' } as any, { warn });
        warnFunctionalCompleteness({ name: 'fc_badfields', fields: 'nope' } as any, { warn });
        expect(warn).not.toHaveBeenCalled();
    });

    it('warns only once per object name (hot path stays free)', () => {
        const warn = vi.fn();
        const schema: any = { name: 'fc_once', fields: { t: { type: 'summary' } } };
        warnFunctionalCompleteness(schema, { warn });
        warnFunctionalCompleteness(schema, { warn });
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('fires through registerObject — the choke point every door shares', () => {
        // The integration half: a raw registerObject call (no Zod, no lint —
        // the #3896 class of door) still gets the diagnostic.
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const registry = new SchemaRegistry();
            registry.registerObject(
                { name: 'fc_via_register', label: 'X', fields: { dead: { type: 'formula' } } } as any,
                'test-pkg',
            );
            const hit = spy.mock.calls.find(
                (c) => typeof c[0] === 'string' && (c[0] as string).includes('fc_via_register'),
            );
            expect(hit).toBeDefined();
            expect(hit![0]).toContain('field/formula-without-expression');
        } finally {
            spy.mockRestore();
        }
    });
});
