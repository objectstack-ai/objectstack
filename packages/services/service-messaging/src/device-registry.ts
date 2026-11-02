// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The push device registry (ADR-0012 §6): the four `INotificationService`
 * device members, over `sys_user_device` (`./objects/user-device.object.ts`).
 *
 * `MessagingService` delegates `registerDevice` / `unregisterDevice` /
 * `listDevices` / `invalidateDeviceToken` here; their contract, word for word,
 * is the docblocks on `INotificationService` (`@objectstack/spec/contracts`).
 *
 * ## Whose rows a call may touch
 *
 * Every call runs under {@link DEVICE_SYSTEM_CONTEXT}: the table is
 * system-owned and closed to the data API, so no principal could reach it.
 * What keeps a call to the caller's own rows is the `userId` the device route
 * takes from the session (`runtime/src/domains/notifications.ts`), and these
 * rules:
 *
 *  - a read of the caller's devices is keyed `where: { user_id }`;
 *  - an update or delete addresses only an id that a read of the SAME call
 *    returned;
 *  - the only row of ANOTHER user a call touches is the one holding the token
 *    the caller registers, which it deletes (spec rule b: the token moves).
 *
 * ## One holder per token, and how that is enforced (spec rule b)
 *
 * Three layers, each closing what the one before cannot:
 *
 *  1. Within this process, registrations of one token are serialised
 *     ({@link withTokenLock}), so two requests from the same phone cannot
 *     interleave their read and their write.
 *  2. Across processes, `sys_user_device.token` carries a unique index, so a
 *     second holder can never be stored: a racing writer's insert or update is
 *     refused by the database.
 *  3. That refusal is not the caller's error. The registration runs again
 *     ({@link REGISTER_ATTEMPTS}): the re-read now sees the winner's row and
 *     moves the token from it, which is what the losing request asked for.
 *
 * ## One registration is one unit
 *
 * A registration that moves a token deletes the previous holder's row and then
 * writes its own. Where the engine offers a transaction (`IObjectQLEngine.
 * transaction`, the ObjectQL engine always does) the reads, the delete and the
 * write run in ONE, so a write the database refuses rolls the delete back with
 * it and the previous holder keeps its row. On an engine without one the steps
 * run in order with no rollback: a refused write after the delete leaves the
 * token held by nobody until the device registers again (the next attempt, or
 * the app's next start), which loses a push target but never misdirects a push.
 */

import { randomUUID } from 'node:crypto';
import type { IDataEngine, IObjectQLEngine } from '@objectstack/spec/contracts';
import type {
    RegisterDeviceRequest,
    RegisterDeviceResponse,
    UnregisterDeviceResponse,
} from '@objectstack/spec/api';
import type { UserDevice } from '@objectstack/spec/system';
import { isUniqueViolationError, validationFailure } from '@objectstack/types';

/** The registry's table. */
export const USER_DEVICE_OBJECT = 'sys_user_device';

/**
 * The explicit system opt-in every registry call carries. See the module
 * docblock for what bounds it instead of row-level security.
 */
export const DEVICE_SYSTEM_CONTEXT = { isSystem: true } as const;

/**
 * How many times a registration runs before a unique-index refusal is let
 * through. Three: the first attempt, the one that re-reads after a racing
 * writer on another node won, and one more for a second such race in the same
 * window. Past that the refusal surfaces (the dispatcher answers it `409
 * UNIQUE_VIOLATION`) and the client's next registration settles it; the
 * in-process lock means only writers on OTHER nodes can race at all.
 */
const REGISTER_ATTEMPTS = 3;

type Vendor = 'apns' | 'fcm';

/** `platform` → the vendor a registration without `vendor` gets. `web` has none. */
const DEFAULT_VENDOR: Readonly<Record<string, Vendor | undefined>> = {
    ios: 'apns',
    android: 'fcm',
};

type DeviceRow = Record<string, unknown> & { id?: unknown };

/** The engine surface the registry uses: every engine's reads and writes, plus its transaction where it offers one. */
export type DeviceRegistryEngine = IDataEngine & Partial<Pick<IObjectQLEngine, 'transaction'>>;

export interface DeviceRegistryOptions {
    getData: () => DeviceRegistryEngine | undefined;
    now?: () => string;
}

/**
 * The error `unregisterDevice` throws for a device id this user does not hold,
 * whether it is unknown or another user's: `code: 'NOT_FOUND'`, `status: 404`,
 * which every HTTP door answers as that (`resolveThrownHttpError`). Never a
 * distinct "forbidden", so a caller cannot learn that the id exists for
 * somebody else.
 */
export function deviceNotFoundError(): Error {
    const err = new Error('Device not found.') as Error & { code?: string; status?: number };
    err.code = 'NOT_FOUND';
    err.status = 404;
    return err;
}

export class DeviceRegistry {
    private readonly now: () => string;
    /** The in-process tail of each token's registration chain. */
    private readonly tokenTails = new Map<string, Promise<unknown>>();

    constructor(private readonly opts: DeviceRegistryOptions) {
        this.now = opts.now ?? (() => new Date().toISOString());
    }

    private engine(): DeviceRegistryEngine {
        const data = this.opts.getData();
        if (!data) throw new Error('[messaging] the device registry has no data engine');
        return data;
    }

    /** `INotificationService.registerDevice`. */
    async register(userId: string, request: RegisterDeviceRequest): Promise<RegisterDeviceResponse> {
        const vendor = request.vendor ?? DEFAULT_VENDOR[request.platform];
        if (!vendor) {
            throw validationFailure(
                'A web device registration names its vendor (apns or fcm): web has no default vendor.',
                [{ field: 'vendor', code: 'required', message: 'Required for a web registration: apns or fcm' }],
            );
        }
        return this.withTokenLock(request.token, async () => {
            for (let attempt = 1; ; attempt += 1) {
                try {
                    return await this.inOneUnit((context) => this.registerOnce(userId, request, vendor, context));
                } catch (err) {
                    if (attempt >= REGISTER_ATTEMPTS || !isUniqueViolationError(err)) throw err;
                }
            }
        });
    }

    /**
     * Run `work` in one engine transaction when the engine offers one, with the
     * system context the transaction hands back; else directly, with the
     * system context (see the module docblock's "One registration is one unit").
     */
    private async inOneUnit<T>(work: (context: Record<string, unknown>) => Promise<T>): Promise<T> {
        const data = this.engine();
        if (typeof data.transaction !== 'function') return work({ ...DEVICE_SYSTEM_CONTEXT });
        return data.transaction((trxCtx) => work(trxCtx as Record<string, unknown>), { ...DEVICE_SYSTEM_CONTEXT });
    }

    private async registerOnce(
        userId: string,
        request: RegisterDeviceRequest,
        vendor: Vendor,
        context: Record<string, unknown>,
    ): Promise<RegisterDeviceResponse> {
        const data = this.engine();
        const holder = await this.findOne(data, { token: request.token }, context);

        // The row this registration refreshes: the named device, else (no
        // deviceId) the caller's own row that already holds this token.
        let target: DeviceRow | null = null;
        if (request.deviceId) {
            target = await this.findOne(data, { user_id: userId, device_id: request.deviceId }, context);
        } else if (holder && String(holder.user_id) === userId) {
            target = holder;
        }

        // The token moves: whoever else holds it — another user's device, or
        // this user's stale row under another deviceId — gives it up, by row.
        if (holder && (!target || String(holder.id) !== String(target.id))) {
            await data.delete(USER_DEVICE_OBJECT, { where: { id: holder.id }, context } as never);
        }

        const at = this.now();
        const values = {
            token: request.token,
            vendor,
            platform: request.platform,
            app_id: request.appId ?? null,
            locale: request.locale ?? null,
            name: request.name ?? null,
            enabled: true,
            invalidated_at: null,
            last_seen_at: at,
        };

        if (target) {
            await data.update(
                USER_DEVICE_OBJECT,
                values,
                { where: { id: target.id }, context } as never,
            );
            return { deviceId: String(target.device_id), success: true };
        }

        const deviceId = request.deviceId ?? randomUUID();
        await data.insert(
            USER_DEVICE_OBJECT,
            { id: randomUUID(), user_id: userId, device_id: deviceId, ...values },
            { context },
        );
        return { deviceId, success: true };
    }

    /** `INotificationService.unregisterDevice`. */
    async unregister(userId: string, deviceId: string): Promise<UnregisterDeviceResponse> {
        const data = this.engine();
        const own = await this.findOne(data, { user_id: userId, device_id: deviceId });
        if (!own) throw deviceNotFoundError();
        await data.delete(USER_DEVICE_OBJECT, { where: { id: own.id }, context: DEVICE_SYSTEM_CONTEXT } as never);
        return { success: true };
    }

    /** `INotificationService.listDevices`: newest `lastSeenAt` first, never-seen last. */
    async list(userId: string): Promise<UserDevice[]> {
        const data = this.engine();
        const rows = await data.find(
            USER_DEVICE_OBJECT,
            { where: { user_id: userId } },
            { context: DEVICE_SYSTEM_CONTEXT },
        ) as DeviceRow[];
        return rows
            .map(toUserDevice)
            .sort((a, b) => {
                if (a.lastSeenAt === b.lastSeenAt) return 0;
                if (!a.lastSeenAt) return 1;
                if (!b.lastSeenAt) return -1;
                return a.lastSeenAt < b.lastSeenAt ? 1 : -1;
            });
    }

    /** `INotificationService.invalidateDeviceToken`: the row is kept, disabled. */
    async invalidate(token: string): Promise<void> {
        const data = this.engine();
        const holder = await this.findOne(data, { token });
        if (!holder) return;
        await data.update(
            USER_DEVICE_OBJECT,
            { enabled: false, invalidated_at: this.now() },
            { where: { id: holder.id }, context: DEVICE_SYSTEM_CONTEXT } as never,
        );
    }

    private async findOne(
        data: IDataEngine,
        where: Record<string, unknown>,
        context: Record<string, unknown> = DEVICE_SYSTEM_CONTEXT,
    ): Promise<DeviceRow | null> {
        const row = await data.findOne(USER_DEVICE_OBJECT, { where }, { context });
        return (row as DeviceRow | null) ?? null;
    }

    /**
     * Run `work` after every earlier registration of `token` in this process
     * has settled, so the read and the write of one registration are never
     * interleaved with another's for the same token.
     */
    private async withTokenLock<T>(token: string, work: () => Promise<T>): Promise<T> {
        const previous = this.tokenTails.get(token) ?? Promise.resolve();
        const run = previous.then(work, work);
        const tail = run.catch(() => undefined);
        this.tokenTails.set(token, tail);
        try {
            return await run;
        } finally {
            if (this.tokenTails.get(token) === tail) this.tokenTails.delete(token);
        }
    }
}

function iso(value: unknown): string | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    if (value instanceof Date) return value.toISOString();
    return new Date(String(value)).toISOString();
}

/** A stored row in spec's `UserDeviceSchema` shape. */
function toUserDevice(row: DeviceRow): UserDevice {
    // The engine answers a boolean column as a boolean on every driver.
    const enabled = row.enabled === true;
    const device: UserDevice = {
        deviceId: String(row.device_id),
        userId: String(row.user_id),
        vendor: row.vendor as Vendor,
        token: String(row.token),
        platform: row.platform as UserDevice['platform'],
        enabled,
    };
    if (row.app_id) device.appId = String(row.app_id);
    if (row.locale) device.locale = String(row.locale);
    if (row.name) device.name = String(row.name);
    const invalidatedAt = iso(row.invalidated_at);
    if (!enabled && invalidatedAt) device.invalidatedAt = invalidatedAt;
    const lastSeenAt = iso(row.last_seen_at);
    if (lastSeenAt) device.lastSeenAt = lastSeenAt;
    return device;
}
