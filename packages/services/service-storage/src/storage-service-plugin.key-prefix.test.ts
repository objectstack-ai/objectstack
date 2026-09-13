// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17571 — the S3 key namespace belongs to the HOST, and a settings re-read
 * cannot drop it or move it.
 *
 * `StorageServicePlugin` binds to the `storage` settings namespace and rebuilds
 * its inner adapter whenever an operator saves adapter-shaped values. That
 * rebuild constructs a fresh `S3StorageAdapterOptions` from `values`, so it is
 * the one place inside this package where an adapter can be produced that the
 * host never wrote — and therefore the place where a key prefix applied only at
 * construction time would silently disappear on the first settings save.
 *
 * Two properties are pinned here, and they are the same property from both
 * sides:
 *
 *   1. the host's namespace travels onto every adapter the rebuild produces;
 *   2. the namespace is NOT read out of `values` — an isolation boundary an
 *      admin inside the deployment can set or clear is a preference, not a
 *      boundary. The `storage` settings manifest deliberately has no key for
 *      it; case 2 pins that a key appearing there later still changes nothing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const fakeS3 = vi.hoisted(() => {
  const putKeys: string[] = [];
  return { putKeys, reset: () => { putKeys.length = 0; } };
});

vi.mock('@aws-sdk/client-s3', () => {
  class PutObjectCommand {
    constructor(public readonly input: Record<string, any>) {}
  }
  class S3Client {
    constructor(_config: unknown) {}
    async send(command: any): Promise<unknown> {
      if (command instanceof PutObjectCommand) {
        fakeS3.putKeys.push(command.input.Key);
        return {};
      }
      throw new Error('fake S3 bucket: this suite only serves PutObject');
    }
  }
  return {
    S3Client,
    PutObjectCommand,
    GetObjectCommand: class {},
    DeleteObjectCommand: class {},
    HeadObjectCommand: class {},
    ListObjectsV2Command: class {},
    CreateMultipartUploadCommand: class {},
    UploadPartCommand: class {},
    CompleteMultipartUploadCommand: class {},
    AbortMultipartUploadCommand: class {},
  };
});

import type { IStorageService } from '@objectstack/spec/contracts';
import { StorageServicePlugin } from './storage-service-plugin.js';

/**
 * The settings-derived rebuild, reached directly.
 *
 * `buildAdapterFromValues` is private and has no public caller that does not
 * also need a booted kernel, a settings service and a `settings:changed` event.
 * The assertion below is about the adapter that comes OUT of it — a real
 * `upload()` landing on a real bucket key — so driving it here measures the
 * behaviour, not the internals.
 */
function rebuildFromSettings(
  plugin: StorageServicePlugin,
  values: Record<string, unknown>,
): Promise<IStorageService> {
  return (plugin as unknown as {
    buildAdapterFromValues(v: Record<string, unknown>): Promise<IStorageService>;
  }).buildAdapterFromValues(values);
}

const SETTINGS_VALUES = {
  adapter: 's3',
  s3_bucket: 'operator-chosen-bucket',
  s3_region: 'eu-west-1',
};

beforeEach(() => {
  fakeS3.reset();
});

describe('a settings re-read cannot unprefix a hosted deployment', () => {
  it("carries the host's key namespace onto the rebuilt adapter", async () => {
    const plugin = new StorageServicePlugin({
      adapter: 's3',
      s3: { bucket: 'host-bucket', region: 'us-east-1', keyPrefix: 'env_7' },
    });

    const rebuilt = await rebuildFromSettings(plugin, SETTINGS_VALUES);
    await rebuilt.upload('user/a.txt', Buffer.from('x'));

    // The operator moved the bucket; the namespace inside it is not theirs to
    // move. Without this, one settings save returns the whole deployment to a
    // shared, unprefixed key space.
    expect(fakeS3.putKeys).toEqual(['env_7/user/a.txt']);
  });

  it('ignores a key prefix arriving through the settings values', async () => {
    const plugin = new StorageServicePlugin({
      adapter: 's3',
      s3: { bucket: 'host-bucket', region: 'us-east-1', keyPrefix: 'env_7' },
    });

    const rebuilt = await rebuildFromSettings(plugin, {
      ...SETTINGS_VALUES,
      s3_key_prefix: 'env_victim',
      keyPrefix: 'env_victim',
    });
    await rebuilt.upload('user/a.txt', Buffer.from('x'));

    expect(fakeS3.putKeys).toEqual(['env_7/user/a.txt']);
  });

  it('leaves a host that declared no S3 options at bucket-root, as before', async () => {
    // A single-tenant deployment configured entirely from the settings UI. It
    // expressed no namespace, so there is none to carry, and its keys are
    // byte-identical to what they were before this option existed.
    const plugin = new StorageServicePlugin({ adapter: 'local' });

    const rebuilt = await rebuildFromSettings(plugin, SETTINGS_VALUES);
    await rebuilt.upload('user/a.txt', Buffer.from('x'));

    expect(fakeS3.putKeys).toEqual(['user/a.txt']);
  });
});
