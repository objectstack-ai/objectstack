// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { StandardErrorCode } from '@objectstack/spec/api';

/**
 * [#30892] The upload link's wire facts, shared by the service that mints and
 * spends links (`record-file-access.ts`) and the doors and page that serve
 * them (`storage-routes.ts`, `upload-link-page.ts`) — in a module of their
 * own so the doors import no service code.
 */

/** The path segment the upload-link doors are mounted under, below the storage base path. */
export const UPLOAD_LINK_SEGMENT = 'upload-links';

/**
 * The one answer a link that cannot be used gets — used, expired, unknown, or
 * minted for another user than the signed-in caller, alike, so the answer says
 * nothing about which.
 */
export const UPLOAD_LINK_UNUSABLE_STATUS = 404;
export const UPLOAD_LINK_UNUSABLE_CODE: StandardErrorCode = 'RESOURCE_NOT_FOUND';
export const UPLOAD_LINK_UNUSABLE_MESSAGE =
  'This upload link cannot be used: it was used already, it has expired, it was made for someone else, or it does not exist. Ask for a new link.';
