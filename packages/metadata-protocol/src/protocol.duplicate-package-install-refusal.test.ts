// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24041] `duplicatePackage` reports a refused install of the copy's package
 * record — on its answer and in the log — and still copies the items.
 *
 * ---------------------------------------------------------------------------
 * The gap these pins close
 * ---------------------------------------------------------------------------
 * The duplicate writes the copy's package record through `installPackage`
 * before its copy loop, inside a `catch {}` that kept nothing. A refused
 * install leaves no registry record and no `sys_packages` row, so the target
 * id is not an installed package while every copied item is bound to it — and
 * the caller read `success: true` with an empty `failed[]`, and no line was
 * logged at any level.
 *
 * ---------------------------------------------------------------------------
 * The two refusals, and why each is built the way it is
 * ---------------------------------------------------------------------------
 * - The REGISTRY'S NAMESPACE GATE. `SchemaRegistry.installPackage` refuses a
 *   namespace another installed package owns with `NamespaceConflictError`
 *   (`NAMESPACE_CONFLICT`, 422) — reachable from the HTTP door through an
 *   explicit `targetNamespace` or a derived one. That judge lives in
 *   `@objectstack/objectql`, which depends on this package, so it cannot be
 *   imported here: the registry below answers with that error's envelope
 *   (`code`, `status`, its sentence) at the registry's own boundary, and the
 *   protocol's real `installPackage` is the code that meets it.
 * - A FAILED `sys_packages` WRITE. Built with no stub on the install path at
 *   all: the `package` service reports a driver fault the way the real one
 *   does (`{ success: false, … }`), and the real primitive undoes its registry
 *   write and throws its own 500. That one is NOT a client refusal, so the
 *   answer must not quote the store; the log carries it.
 *
 * Every refusal is answered by a CONTROL on the same harness: an accepted
 * install adds no `package` entry, logs no line, and leaves the record in
 * place — a pin on the refusal alone cannot tell "the refusal is reported"
 * from "this door now reports every install".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
            + `so package "${incoming}" cannot be installed alongside it.`,
        ),
        { name: 'NamespaceConflictError', code: 'NAMESPACE_CONFLICT', status: 422, httpStatus: 422 },
    );
}

/**
 * A duplicate-door harness: one source package holding one object row, a
 * registry that keeps its package records and namespace owners, and
 * optionally a `package` service. The namespace gate refuses exactly as the
 * real one does: a namespace another installed package owns.
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
    const registry: any = {
        getPackage: vi.fn((id: string) => packages.get(id)),
        getNamespaceOwners: vi.fn((ns: string) => [...(namespaceOwners.get(ns) ?? [])]),
        installPackage: vi.fn((manifest: any) => {
            const owner = (namespaceOwners.get(manifest.namespace) ?? []).find((id) => id !== manifest.id);
            if (owner) throw namespaceConflict(manifest.namespace, owner, manifest.id);
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
    return { impl, registry, packages, saveMetaItem };
}

/** The `[protocol.duplicatePackage]` lines about the copy's package record. */
function packageRecordLines(warn: ReturnType<typeof vi.spyOn>): string[] {
    return warn.mock.calls
        .map((args) => String(args[0]))
        .filter((line) => line.startsWith('[protocol.duplicatePackage] package record'));
}

describe('[#24041] duplicatePackage reports a refused install of the copy\'s package record', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        warn.mockRestore();
    });

    it('carries the registry\'s namespace refusal on failed[], logs it once, and still copies', async () => {
        const { impl, packages, saveMetaItem } = makeHarness();
        const refusal = namespaceConflict('taken', OWNER, TARGET);

        const res = await (impl as any).duplicatePackage({
            sourcePackageId: SOURCE,
            targetPackageId: TARGET,
            targetNamespace: 'taken',
        });

        // The answer names the refusal: one `package` entry, under the
        // source's own package item, quoting the registry's sentence (a 422
        // is a client refusal) and naming the target id.
        const entries = res.failed.filter((f: any) => f.type === 'package');
        expect(entries).toHaveLength(1);
        expect(entries[0].name).toBe(SOURCE);
        expect(entries[0].error).toContain(`'${TARGET}'`);
        expect(entries[0].error).toContain(refusal.message);
        expect(res.success).toBe(false);
        expect(res.failedCount).toBe(res.failed.length);

        // The copy still goes on: the item was written, bound to the target.
        expect(res.copied).toEqual([{ type: 'object', name: 'taken_ticket' }]);
        expect(saveMetaItem).toHaveBeenCalledTimes(1);
        expect((saveMetaItem.mock.calls[0]![0] as any).packageId).toBe(TARGET);
        // …and the target is not an installed package: the refusal preceded
        // every registry write.
        expect(packages.has(TARGET)).toBe(false);

        // The log names the target id, the refusal's code and its sentence, once.
        const lines = packageRecordLines(warn);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(`'${TARGET}'`);
        expect(lines[0]).toContain('NAMESPACE_CONFLICT');
        expect(lines[0]).toContain(refusal.message);
    });

    it('carries a failed sys_packages write without quoting the store, and logs the primitive\'s sentence', async () => {
        const { impl, packages } = makeHarness({
            publish: async () => ({ success: false, driverFault: { message: DRIVER_TEXT } }),
        });

        const res = await (impl as any).duplicatePackage({ sourcePackageId: SOURCE, targetPackageId: TARGET });

        const entries = res.failed.filter((f: any) => f.type === 'package');
        expect(entries).toHaveLength(1);
        expect(entries[0].name).toBe(SOURCE);
        expect(entries[0].error).toContain(`'${TARGET}'`);
        // A 500 is not a client refusal: nothing the store said reaches the answer.
        expect(entries[0].error).not.toContain('SQLITE');
        expect(res.success).toBe(false);
        // The real primitive undid its registry write before it threw.
        expect(packages.has(TARGET)).toBe(false);
        // The copy still goes on.
        expect(res.copied).toEqual([{ type: 'object', name: 'leave_copy_ticket' }]);

        const lines = packageRecordLines(warn);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(`'${TARGET}'`);
        expect(lines[0]).toContain(`Package '${TARGET}' was not installed`);
    });

    it('CONTROL: an accepted install adds no package entry and logs no line', async () => {
        const { impl, packages } = makeHarness({ publish: async () => ({ success: true }) });

        const res = await (impl as any).duplicatePackage({ sourcePackageId: SOURCE, targetPackageId: TARGET });

        expect(res.failed).toEqual([]);
        expect(res.success).toBe(true);
        expect(res.copied).toEqual([{ type: 'object', name: 'leave_copy_ticket' }]);
        expect(packages.get(TARGET)?.manifest?.namespace).toBe('leave_copy');
        expect(packageRecordLines(warn)).toEqual([]);
    });
});
