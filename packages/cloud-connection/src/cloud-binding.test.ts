// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `cloud-binding` service (#29920, Q1 A): the one reader of this server's
 * effective control-plane credential, registered by `CloudConnectionPlugin`
 * in `init()` and read on every call, so a bind done while the server runs is
 * seen without a restart.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ICloudBindingService } from '@objectstack/spec/contracts';
import { CLOUD_BINDING_SERVICE, createCloudBinding } from './cloud-binding.js';
import { CloudConnectionPlugin } from './cloud-connection-plugin.js';
import { ConnectionCredentialStore } from './connection-credential-store.js';
import { DEFAULT_CLOUD_URL } from './cloud-url.js';

let dir: string;
let store: ConnectionCredentialStore;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cloud-binding-'));
    store = new ConnectionCredentialStore(join(dir, 'cloud-connection.json'));
    vi.stubEnv('OS_CLOUD_API_KEY', '');
    vi.stubEnv('OS_CLOUD_URL', '');
});

afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
});

describe('createCloudBinding — the credential', () => {
    it('is empty, and not bound, before any bind', () => {
        const binding = createCloudBinding({ store });
        expect(binding.credential()).toBe('');
        expect(binding.bound()).toBe(false);
    });

    it('is read on every call: a bind stored while the server runs is presented at once, an unbind withdraws it', () => {
        const binding = createCloudBinding({ store });
        store.write({ runtimeToken: 'oscc_bound-token' });
        expect(binding.credential()).toBe('oscc_bound-token');
        expect(binding.bound()).toBe(true);
        store.write({ runtimeToken: '', runtimeId: 'rt_1' });
        expect(binding.credential()).toBe('');
        expect(binding.bound()).toBe(false);
    });

    it('is the env→cloud service key when one is set, over a stored bearer', () => {
        store.write({ runtimeToken: 'oscc_bound-token' });
        expect(createCloudBinding({ store, controlPlaneApiKey: ' svc-key ' }).credential()).toBe('svc-key');
        vi.stubEnv('OS_CLOUD_API_KEY', 'env-key');
        expect(createCloudBinding({ store }).credential()).toBe('env-key');
    });
});

describe('createCloudBinding — the control-plane URL', () => {
    it('is the configured URL, else OS_CLOUD_URL, else the default, without a trailing slash', () => {
        expect(createCloudBinding({ store, controlPlaneUrl: 'https://cp.example.com/' }).controlPlaneUrl()).toBe('https://cp.example.com');
        vi.stubEnv('OS_CLOUD_URL', 'https://env.example.com');
        expect(createCloudBinding({ store }).controlPlaneUrl()).toBe('https://env.example.com');
        vi.stubEnv('OS_CLOUD_URL', '');
        expect(createCloudBinding({ store }).controlPlaneUrl()).toBe(DEFAULT_CLOUD_URL);
    });

    it('is empty on a deployment that declared it has no control plane', () => {
        vi.stubEnv('OS_CLOUD_URL', 'off');
        expect(createCloudBinding({ store }).controlPlaneUrl()).toBe('');
    });
});

describe('CloudConnectionPlugin — registers the binding in init()', () => {
    it('registers cloud-binding, declared in providesServices, reading the plugin\'s own credential store', async () => {
        const services = new Map<string, unknown>();
        const plugin = new CloudConnectionPlugin({ credentialPath: join(dir, 'cloud-connection.json'), controlPlaneUrl: 'https://cp.example.com' });
        await plugin.init({
            hook() {},
            getService: (name: string) => services.get(name),
            registerService: (name: string, service: unknown) => services.set(name, service),
            logger: { warn() {} },
        } as never);
        expect(plugin.providesServices).toContain(CLOUD_BINDING_SERVICE);
        const binding = services.get(CLOUD_BINDING_SERVICE) as ICloudBindingService;
        expect(binding.bound()).toBe(false);
        store.write({ runtimeToken: 'oscc_bound-token' });
        expect(binding.credential()).toBe('oscc_bound-token');
        expect(binding.controlPlaneUrl()).toBe('https://cp.example.com');
    });
});
