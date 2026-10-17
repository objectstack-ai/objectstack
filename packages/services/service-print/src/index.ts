// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/service-print — print a record's print page to a PDF in
 * headless Chromium, as the requesting user, and archive it as a file attached
 * to the record.
 */

export { PrintServicePlugin, PRINT_SERVICE, type PrintServicePluginOptions } from './print-service-plugin.js';
export {
  PRINT_RENDER_TIMEOUT_MS,
  PRINT_SESSION_TTL_SECONDS,
  type IPrintService,
  type PrintEngineStatus,
  type PrintRecordRequest,
  type PrintedRecordFile,
} from './print-service.js';
export {
  PRINT_CHROMIUM_PATH_ENV,
  PRINT_BROWSER_ENDPOINT_ENV,
  PRINT_CONSOLE_URL_ENV,
  type PrintPlacement,
  type PrintPlacementOptions,
} from './config.js';
