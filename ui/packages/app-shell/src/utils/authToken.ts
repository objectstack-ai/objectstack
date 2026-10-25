/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { TokenStorage } from '@object-ui/auth';

/**
 * Bearer auth header from the console's stored session token
 * (`@object-ui/auth` TokenStorage — localStorage with in-memory fallback).
 *
 * For app-shell's few direct `fetch` call sites (approvals badge/panel,
 * home inbox): cookie-only fetches silently lose their surface on
 * split-origin deployments (custom-domain console ↔ API) where the
 * SameSite cookie never flows — every dataSource call already sends this
 * bearer, so these fetches must too (#2548).
 */
export function bearerAuthHeaders(): Record<string, string> {
  try {
    const token = TokenStorage.get();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}
