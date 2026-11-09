// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A local storage root under declared replicas (cloud#3814, its R3 condition).
 *
 * The local adapter writes uploads to a directory on the machine it runs on.
 * One node, one directory: correct. Several replicas behind one load balancer,
 * each with its own directory: a file uploaded through one replica is a 404 on
 * every other, and nothing in the boot says so — every replica looks healthy.
 *
 * So, where the operator declares several replicas over the redis cluster
 * driver (`declaresMultiReplicaOnRedis`, the one condition every multi-replica
 * change keys on), the local adapter is refused unless the operator states that
 * its root is ONE volume every replica mounts — {@link LOCAL_ROOT_SHARED_ENV}.
 * That variable is a declaration, never a probe: nothing here checks that the
 * volume really is shared. A single node, any other cluster driver, and the S3
 * adapter see no difference.
 *
 * Deployment config only, deliberately not a key of the `storage` settings
 * namespace: that namespace is writable from inside the deployment, and the
 * topology the process runs in is not a value an admin there can assert.
 */

import { declaresMultiReplicaOnRedis } from '@objectstack/service-cluster';
import type { StorageTarget } from './storage-target.js';

/**
 * The operator's statement that the local root is one volume shared by every
 * replica. Only `true` (any case, surrounding space ignored) declares it — the
 * same reading the split-brain guard gives `OS_EXPECT_MULTI_NODE`.
 */
export const LOCAL_ROOT_SHARED_ENV = 'OS_STORAGE_LOCAL_ROOT_SHARED';

/** Whether `env` declares the local root shared ({@link LOCAL_ROOT_SHARED_ENV}). */
export function declaresSharedLocalRoot(env: Readonly<Record<string, string | undefined>>): boolean {
  return String(env[LOCAL_ROOT_SHARED_ENV]).trim().toLowerCase() === 'true';
}

/**
 * Whether a storage target of `kind` is refused: the local adapter, under
 * several replicas declared over the redis cluster driver, with no shared-root
 * declaration. Pure — every input is an argument.
 */
export function refusesUnsharedLocalRoot(input: {
  readonly kind: StorageTarget['kind'];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly clusterDriver: string | undefined;
}): boolean {
  return input.kind === 'local'
    && declaresMultiReplicaOnRedis(input.env, input.clusterDriver)
    && !declaresSharedLocalRoot(input.env);
}

/**
 * The refusal, one text for both places it is said (the boot, and a settings
 * change that would switch to the local adapter): what is declared, what the
 * local adapter would break, and the two fixes — S3, or the shared-root
 * declaration.
 */
export const MULTI_REPLICA_LOCAL_STORAGE_REFUSAL =
  'StorageServicePlugin: several replicas are declared (OS_EXPECT_MULTI_NODE / OS_CLUSTER_REPLICAS>1) over the '
  + 'redis cluster driver, but file storage is the local adapter — each replica would write uploads to its own '
  + 'disk, and a file uploaded through one replica would be missing on the others. Fix: use S3 '
  + '(OS_STORAGE_ADAPTER=s3 with OS_STORAGE_S3_BUCKET and OS_STORAGE_S3_REGION, plus OS_STORAGE_S3_ENDPOINT / '
  + 'OS_STORAGE_S3_ACCESS_KEY_ID / OS_STORAGE_S3_SECRET_ACCESS_KEY as your store needs, or Setup → Settings → '
  + `File Storage), or, when every replica mounts the same volume at the local root, set ${LOCAL_ROOT_SHARED_ENV}=true.`;
