// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24978] An approval notification's text, as the messaging service takes it:
 * the literal English every emit has always carried, and BESIDE it the catalog
 * keys the service renders per recipient, at delivery, in that recipient's
 * language (`EmitInput.keyedText`).
 *
 * ## What was wrong
 *
 * Each notification sentence was built here, at emit, as an English literal,
 * and no catalog held it — so a zh-CN, ja-JP or es-ES approver read English.
 * A notification reaches several recipients and the emit holds none of them,
 * so the language cannot be picked here: the render belongs where one
 * recipient exists, which is delivery, and the messaging service owns that
 * (the `i18n` service's catalog, `sys_user.locale` then the deployment default
 * per recipient, #13881). This module hands it the keys.
 *
 * ## One source for the English
 *
 * The literal `title` / `body` are the `en` catalog entries
 * (`./translations/messages.ts`) interpolated here, ⛔ never a second spelling
 * of the sentence: the English a recipient reads is one string whether the
 * catalog rendered it or the literal fallback carried it, and it is the
 * sentence each notification carried before it was keyed.
 *
 * ## The record a notification names
 *
 * `object` and `record` ({@link subjectParams}): the object's label and the
 * record id, the #23556 / #23594 ruling B form, never a title. The label rides
 * as a keyed param — `objects.<object>.label`, the key the reader-language
 * labels (`reader-locale-labels.ts`) and objectql's refusals name an object
 * by — so a recipient whose language pack holds it reads it in their language;
 * the schema label (the API name when there is none) stands otherwise.
 */

import { objectLabelKey } from '@objectstack/spec/system';
import { enMessages, type ApprovalMessageId } from './translations/messages.js';

/** One `{{hole}}` value: the text itself, or a catalog key with the text it falls back to. */
export type ApprovalTextParam = string | { readonly key: string; readonly fallback: string };

/**
 * The keyed half — the structural mirror of the messaging service's
 * `NotificationTextKeys` (`EmitInput.keyedText`). Declared here rather than
 * imported because this plugin takes no dependency on the messaging package;
 * it resolves whatever is registered as `messaging` (`ApprovalMessagingSurface`).
 */
export interface ApprovalKeyedText {
  readonly titleKey: string;
  readonly bodyKey?: string;
  readonly params?: Readonly<Record<string, ApprovalTextParam>>;
}

/** An approval notification's text: the literal fallback and its keys. */
export interface ApprovalNotificationText {
  /** The literal headline and body — the `en` entries, interpolated. */
  readonly title: string;
  readonly body: string;
  readonly keyedText: ApprovalKeyedText;
}

/**
 * The record an approval notification names: `{{object}} {{record}}`. A type,
 * not an interface, so it spreads into a sentence's params as it stands.
 */
export type ApprovalSubjectParams = {
  readonly object: { readonly key: string; readonly fallback: string };
  readonly record: string;
};

/** The `II18nService` key of an approval sentence, `messages.<id>`. */
export function approvalMessageKey(id: ApprovalMessageId): string {
  return `messages.${id}`;
}

/**
 * The record `objectName`/`recordId` names: the object's label — keyed by
 * `objects.<object>.label`, falling back to `objectLabel` (the schema label),
 * else the API name — and the record id.
 */
export function subjectParams(
  objectName: string,
  objectLabel: string | undefined,
  recordId: string,
): ApprovalSubjectParams {
  return {
    object: { key: objectLabelKey(objectName), fallback: objectLabel ?? objectName },
    record: recordId,
  };
}

const HOLE = /\{\{(\w+)\}\}/g;

/**
 * `{{name}}` interpolation with the convention both `II18nService.t()`
 * implementations use — one pass, a value is never re-scanned, a hole with no
 * value stays as written — over each param's literal text. Also the `en`
 * rendering of the administrators' routing note (`admin-rescue-note.ts`).
 */
export function interpolate(template: string, params: Readonly<Record<string, ApprovalTextParam>>): string {
  return template.replace(HOLE, (hole, name: string) => {
    const param = params[name];
    if (param === undefined) return hole;
    return typeof param === 'string' ? param : param.fallback;
  });
}

/**
 * An approval notification's text from its catalog ids.
 *
 * `body` names the body's sentence; `literalBody` is for the notices whose
 * body is a person's own words (a comment, a request for information) — that
 * text is delivered as written, and only the headline is keyed.
 */
export function approvalNotificationText(spec: {
  readonly title: ApprovalMessageId;
  readonly body: ApprovalMessageId;
  readonly params?: Readonly<Record<string, ApprovalTextParam>>;
} | {
  readonly title: ApprovalMessageId;
  readonly literalBody: string;
}): ApprovalNotificationText {
  if ('literalBody' in spec) {
    return {
      title: enMessages[spec.title],
      body: spec.literalBody,
      keyedText: { titleKey: approvalMessageKey(spec.title) },
    };
  }
  const params = spec.params ?? {};
  return {
    title: interpolate(enMessages[spec.title], params),
    body: interpolate(enMessages[spec.body], params),
    keyedText: {
      titleKey: approvalMessageKey(spec.title),
      bodyKey: approvalMessageKey(spec.body),
      ...(spec.params ? { params: spec.params } : {}),
    },
  };
}
