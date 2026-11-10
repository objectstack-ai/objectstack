// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash } from 'node:crypto';
import { NODE_PREFIX } from './canonical.js';

/**
 * ADR-0154 D1 — the checkpoint's Merkle tree.
 *
 * Leaf hashes come from `leafHash` (`SHA-256(0x00 ‖ JCS(leaf input))`), in
 * leaf order. An interior node is `SHA-256(0x01 ‖ left ‖ right)` — the domain
 * separation of RFC 6962 §2.1, so no leaf can be passed off as a node. Levels
 * are built pairwise, and an odd last node is promoted to the next level
 * unchanged. The root of one leaf is that leaf's hash.
 *
 * There is no root of zero leaves: an empty window writes no checkpoint (D3).
 */

const HASH_BYTES = 32;

/** An interior node's hash. */
export function nodeHash(left: Uint8Array, right: Uint8Array): Buffer {
  return createHash('sha256').update(Buffer.concat([Uint8Array.of(NODE_PREFIX), left, right])).digest();
}

/** The root of `leaves`, lowercase hex. Refuses an empty list and anything that is not a 32-byte hash. */
export function merkleRoot(leaves: readonly Uint8Array[]): string {
  if (leaves.length === 0) throw new Error('a Merkle root needs at least one leaf; an empty window writes no checkpoint');
  for (const [i, leaf] of leaves.entries()) {
    if (leaf.length !== HASH_BYTES) throw new Error(`leaf ${i} is ${leaf.length} bytes, not a ${HASH_BYTES}-byte hash`);
  }
  let level: Uint8Array[] = [...leaves];
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i + 1 < level.length; i += 2) next.push(nodeHash(level[i], level[i + 1]));
    if (level.length % 2 === 1) next.push(level[level.length - 1]);
    level = next;
  }
  return Buffer.from(level[0]).toString('hex');
}
