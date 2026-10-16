// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23182 row 1, step B] Shard 4 of 4 of the lock family's generated table: the
 * rows of read groups numbered 3 modulo 4, from the helper. This file is
 * its call and nothing else; the shard it is comes from its own name, and
 * `protocol.lock-one-resolution.kit.test.ts` pins that the four files exist.
 */
import { registerRowShard } from './protocol.lock-one-resolution.kit.test.js';

registerRowShard();
