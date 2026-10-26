/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Generates a unique ID for messages or other entities
 * Uses crypto.randomUUID() if available, otherwise falls back to timestamp + random string
 */
export function generateUniqueId(prefix = 'msg'): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
