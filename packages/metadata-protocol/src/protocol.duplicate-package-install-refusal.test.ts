// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24041] `duplicatePackage` is refused, with nothing copied, when the install
 * of the copy's package record is refused — and the refusal it answers is the
 * install's own, unchanged.
 *
 * ---------------------------------------------------------------------------
 * The gap these pins close
 * ---------------------------------------------------------------------------
 * The duplicate writes the copy's package record through `installPackage`
 * before its copy loop, inside a `catch {}` that kept nothing. A refused
 * install leaves no registry record and no `sys_packages` row, so the copy's
 * items were live, bound to an id no package record holds — after a namespace
 * conflict, inside a namespace another package owns — and the caller read
 * `success: true`, with no line logged at any level. The door now keeps the
 * rule its sibling `importUnmanagedPackage` states: "There is no half-copied
 * app." (ruling B, claim amendment 6227008947).
 *
 * ---------------------------------------------------------------------------
 * The two refusals, and why each is built the way it is
 * ---------------------------------------------------------------------------
 * - The REGISTRY'S NAMESPACE GATE (ADR-0048 Phase 1).
 *   `SchemaRegistry.installPackage` refuses a namespace another installed
 *   package owns with `NamespaceConflictError` (`NAMESPACE_CONFLICT`, 422). That
 *   judge lives in `@objectstack/objectql`, which depends on this package, so it
 *   cannot be imported here: the registry below refuses exactly when another
 *   package owns the namespace and throws that error's envelope (`code`,
 *   `status`, its sentence) at the registry's own boundary, and the protocol's
 *   real `installPackage` is the code that meets it.
 * - A FAILED `sys_packages` WRITE. No stub on the install path at all: the
 *   `package` service reports a driver fault the way the real one does
 *   (`{ success: false, … }`), and the real primitive undoes its registry write
 *   and throws its own 500.
 *
 * Each asserts the refusal as the ENVELOPE an HTTP boundary resolves it to
 * (`resolveThrownHttpError`, the resolver the door's `errorFromThrown` uses),
 * that it is the install's own error object, rethrown unchanged, and that
 * nothing was copied. A CONTROL on the same harness holds the other side: an
 * accepted install still copies, and logs nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveThrownHttpError } from '@objectstack/types';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SOURCE = 'com.example.leave';
const TARGET = 'com.example.leave-copy';
/** The installed package whose namespace the copy asks for. */
const OWNER = 'com.example.taken';
const DRIVER_TEXT = 'SQLITE_ERROR: no such table: sys_packages';

/** `NamespaceConflictError`'s envelope, as `SchemaRegistry.installPackage` throws it. */
function namespaceConflict(namespace: string, existing: string, incoming: string): Error {
    return Object.assign(
        new Error(
            `Namespace conflict: namespace "${namespace}" is already owned by package "${existing}", `
            + `so package "${incoming}" cannot be installed alongside it. Choose a different namespace for `
            + `"${incoming}", or uninstall "${existing}" first.`,
        ),
        { name: 'NamespaceConflictError', code: 'NAMESPACE_CONFLICT', status: 422, httpStatus: 422 },
    );
}

/**
 * A duplicate-door harness: one source package holding one object row, a
 * registry that keeps its package records and namespace owners, and
 * optionally a `package` service. The namespace gate refuses exactly as the
 * real one does: a namespace another installed package owns. Whatever it
 * throws is kept in `thrown`, so a pin can ask for that very object back.
 */
function makeHarness(opts: { publish?: (data: unknown) => Promise<unknown> } = {}) {
    const rows = [{
        id: 'r_1',
        type: 'object',
        name: 'leave_ticket',
        organization_id: null,
        package_id: SOURCE,
        state: 'active',
        metadata: JSON.stringify({ name: 'leave_ticket', label: 'Ticket' }),
    }];
    const packages = new Map<string, any>([
        [SOURCE, { manifest: { id: SOURCE, name: 'Leave', namespace: 'leave', version: '1.0.0' } }],
        [OWNER, { manifest: { id: OWNER, name: 'Taken', namespace: 'taken', version: '1.0.0' } }],
    ]);
    const namespaceOwners = new Map<string, string[]>([['leave', [SOURCE]], ['taken', [OWNER]]]);
    const thrown: unknown[] = [];
    const registry: any = {
        getPackage: vi.fn((id: string) => packages.get(id)),
        getNamespaceOwners: vi.fn((ns: string) => [...(namespaceOwners.get(ns) ?? [])]),
        installPackage: vi.fn((manifest: any) => {
            const owner = (namespaceOwners.get(manifest.namespace) ?? []).find((id) => id !== manifest.id);
            if (owner) {
                const refusal = namespaceConflict(manifest.namespace, owner, manifest.id);
                thrown.push(refusal);
                throw refusal;
            }
            const row = { manifest, status: 'installed', enabled: true };
            packages.set(manifest.id, row);
            namespaceOwners.set(manifest.namespace, [...(namespaceOwners.get(manifest.namespace) ?? []), manifest.id]);
            return row;
        }),
        unregisterItem: vi.fn((type: string, id: string) => {
            if (type === 'package') packages.delete(id);
        }),
        unregisterNamespace: vi.fn((ns: string, id: string) => {
            namespaceOwners.set(ns, (namespaceOwners.get(ns) ?? []).filter((owner) => owner !== id));
        }),
    };
    const engine: any = { find: vi.fn(async () => rows), registry };
    const services = new Map<string, unknown>();
    if (opts.publish) services.set('package', { publish: vi.fn(opts.publish) });
    const impl = new ObjectStackProtocolImplementation(engine as never, () => services as never);
    const saveMetaItem = vi.spyOn(impl, 'saveMetaItem' as never);
    (saveMetaItem as any).mockResolvedValue({ success: true } as never);
    return { impl, packages, namespaceOwners, saveMetaItem, thrown };
}

/** The thrown refusal, or a failure naming what happened instead. */
async function refusalOf(run: () => Promise<unknown>): Promise<any> {
    try {
        await run();
    } catch (e) {
        return e;
    }
    throw new Error('expected the duplicate to be refused, but it resolved');
}

/** The `[protocol.duplicatePackage] refused:` log calls, each with its arguments. */
function refusalLogs(warn: { mock: { calls: unknown[][] } }): unknown[][] {
    return warn.mock.calls.filter((args: unknown[]) => String(args[0]).startsWith('[protocol.duplicatePackage] refused:'));
}

describe('[#24041] duplicatePackage is refused when the copy\'s package record is refused', () => {
    let warn: { mock: { calls: unknown[][] }; mockRestore: () => void };
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {}) as never;
    });
    afterEach(() => {
        warn.mockRestore();
    });

    it('answers the registry\'s namespace refusal (422 NAMESPACE_CONFLICT) unchanged, and copies nothing', async () => {
        const { impl, packages, namespaceOwners, saveMetaItem, thrown } = makeHarness();

        const err = await refusalOf(() => (impl as any).duplicatePackage({
            sourcePackageId: SOURCE,
            targetPackageId: TARGET,
            targetNamespace: 'taken',
        }));

        // The registry's own refusal, rethrown unchanged — so the door answers
        // its status, its code and its remedy.
        expect(thrown).toHaveLength(1);
        expect(err).toBe(thrown[0]);
        const envelope = resolveThrownHttpError(err);
        expect(envelope.status).toBe(422);
        expect(envelope.code).toBe('NAMESPACE_CONFLICT');

        // Nothing was copied, and nothing was minted.
        expect(saveMetaItem).not.toHaveBeenCalled();
        expect(packages.has(TARGET)).toBe(false);
        expect(namespaceOwners.get('taken')).toEqual([OWNER]);

        // Logged once, naming the target, the code and the sentence; a client
        // refusal is not handed to the log as an error object.
        const logs = refusalLogs(warn);
        expect(logs).toHaveLength(1);
        expect(logs[0]).toHaveLength(1);
        expect(String(logs[0]![0])).toContain(`'${TARGET}'`);
        expect(String(logs[0]![0])).toContain('NAMESPACE_CONFLICT');
        expect(String(logs[0]![0])).toContain(err.message);
    });

    it('answers a failed sys_packages write with the primitive\'s 500, undone, and copies nothing', async () => {
        const { impl, packages, saveMetaItem } = makeHarness({
            publish: async () => ({ success: false, driverFault: { message: DRIVER_TEXT } }),
        });

        const err = await refusalOf(() => (impl as any).duplicatePackage({ sourcePackageId: SOURCE, targetPackageId: TARGET }));

        // The primitive's own failure: a 500 whose sentence names the target and
        // quotes nothing of the store.
        const envelope = resolveThrownHttpError(err);
        expect(envelope.status).toBe(500);
        expect(err.message).toContain(`'${TARGET}'`);
        expect(err.message).not.toContain('SQLITE');

        // Nothing was copied, and the primitive undid its registry write.
        expect(saveMetaItem).not.toHaveBeenCalled();
        expect(packages.has(TARGET)).toBe(false);

        // Logged once, with the error itself attached: its `cause` is the only
        // place the driver's text survives.
        const logs = refusalLogs(warn);
        expect(logs).toHaveLength(1);
        expect(String(logs[0]![0])).toContain(`'${TARGET}'`);
        expect(logs[0]![1]).toBe(err);
        expect((err as { cause?: any }).cause?.driverFault?.message).toBe(DRIVER_TEXT);
    });

    it('CONTROL: an accepted install still copies, and logs no refusal', async () => {
        const { impl, packages, saveMetaItem } = makeHarness({ publish: async () => ({ success: true }) });

        const res = await (impl as any).duplicatePackage({ sourcePackageId: SOURCE, targetPackageId: TARGET });

        expect(res.failed).toEqual([]);
        expect(res.success).toBe(true);
        expect(res.copied).toEqual([{ type: 'object', name: 'leave_copy_ticket' }]);
        expect(saveMetaItem).toHaveBeenCalledTimes(1);
        expect(packages.get(TARGET)?.manifest?.namespace).toBe('leave_copy');
        expect(refusalLogs(warn)).toEqual([]);
    });
});
