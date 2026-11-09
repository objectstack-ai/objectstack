// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `security:effective-access` widget's vocabulary: the client's answer,
 * typed off the adapter's own client, and the words each origin is shown in.
 */

import type { ObjectStackAdapter } from '@object-ui/data-objectstack';

type Translate = (key: string, options?: Record<string, unknown>) => string;

type DescribeEffectiveAccess = ReturnType<ObjectStackAdapter['getClient']>['security']['describeEffectiveAccess'];
/** The answer (`EffectiveAccess` of `@objectstack/spec/contracts`, through the client). */
export type EffectiveAccessAnswer = Awaited<ReturnType<DescribeEffectiveAccess>>;
/** One way a set reaches the person (`EffectivePermissionSetOrigin`). */
export type EffectiveAccessOrigin = EffectiveAccessAnswer['permissionSets'][number]['origins'][number];

/** The object whose record pages the widget belongs on. */
export const EFFECTIVE_ACCESS_OBJECT = 'sys_user';

/** The status the client stamps on a refused call (`httpStatus`, from `res.status`). */
export function httpStatusOf(err: unknown): number | undefined {
  const status = (err as { httpStatus?: unknown } | null | undefined)?.httpStatus;
  return typeof status === 'number' ? status : undefined;
}

/** A failed call's words: the client throws an `Error` carrying the server's message. */
export function failureText(err: unknown): string {
  const message = (err as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' && message ? message : String(err);
}

/** Where one origin says the set comes from. */
export function describeOrigin(origin: EffectiveAccessOrigin, t: Translate): string {
  switch (origin.kind) {
    case 'direct':
      return t('effectiveAccess.origin.direct');
    case 'position':
      return t('effectiveAccess.origin.position', { position: origin.position });
    case 'default':
      return t('effectiveAccess.origin.default');
    case 'derived':
      return origin.source === 'platform_admin_config'
        ? t('effectiveAccess.origin.derivedPlatformAdmin')
        : t('effectiveAccess.origin.derivedAiAccess');
  }
}

/** A stable key for one origin of a row. */
export function originKey(origin: EffectiveAccessOrigin): string {
  switch (origin.kind) {
    case 'position':
      return `position-${origin.position}`;
    case 'derived':
      return `derived-${origin.source}`;
    default:
      return origin.kind;
  }
}
