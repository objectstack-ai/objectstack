/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useEffect, useState } from 'react';
import type { useObjectTranslation } from '@object-ui/i18n';

/**
 * What the record form says around an organization's `require_mfa` (ADR-0069
 * D3, the per-organization MFA requirement).
 *
 * The column is generically editable, so the organization edit form is the
 * console's ordinary record form and the field's help is the object's own. Two
 * facts that help cannot carry are the console's to say:
 *
 * - **Before saving**: the requirement can only be turned on while two-factor
 *   is on for the deployment (`features.twoFactor` in `/api/v1/auth/config`).
 *   While it is off the server refuses the write (`400 VALIDATION_FAILED` on
 *   `require_mfa`), and the form shows that refusal on the field. The notice
 *   says so before the administrator ticks the box, and where two-factor is
 *   turned on.
 * - **After an accepted save that turned it on**: who is affected (every
 *   member without an authenticator app) and when the block starts (once the
 *   MFA grace period ends, counted from each member's next use). The server
 *   now says this itself, with the grace period in force, as the save answer's
 *   `notice` (objectstack#30411); the console's line stands in only when the
 *   answer does not carry that notice (objectstack#30565).
 *
 * Both are judged only on what the console knows: an unread `features` says
 * nothing before saving, and a save whose stored value was already on says
 * nothing after it.
 */

export const ORGANIZATION_OBJECT = 'sys_organization';
export const REQUIRE_MFA_FIELD = 'require_mfa';

type Translate = ReturnType<typeof useObjectTranslation>['t'];

const isOn = (value: unknown): boolean => value === true || value === 1 || value === 'true';

/**
 * The notice the organization form shows before saving: requiring MFA needs
 * two-factor on, and it is off. `undefined` for any other object, a form that
 * does not offer the field, or a deployment whose two-factor state is unread or
 * on.
 */
export function organizationMfaFormNotice(input: {
  objectName: string | undefined;
  fields: readonly string[];
  features: Record<string, unknown>;
  t: Translate;
}): string | undefined {
  if (input.objectName !== ORGANIZATION_OBJECT) return undefined;
  if (!input.fields.includes(REQUIRE_MFA_FIELD)) return undefined;
  if (input.features.twoFactor !== false) return undefined;
  return input.t('console.organizationMfa.needsTwoFactor');
}

/**
 * The opening sentence of the notice the server answers an accepted turn-on
 * with (objectstack `plugin-auth`'s `ORGANIZATION_MFA_REQUIRED_NOTICE_COPY`), in
 * each of the four languages that copy is written in. Its sentence for N days
 * and its sentence for 0 days both open with it; a server language the copy
 * lacks answers the English one.
 */
const SERVER_MFA_NOTICE_OPENINGS: readonly string[] = [
  'Multi-factor authentication is now required for this organization.',
  '本组织现已强制多因素认证。',
  'この組織では多要素認証が必須になりました。',
  'La autenticación multifactor ahora es obligatoria en esta organización.',
];

/**
 * True when a save answer's `notice` is the server's own MFA notice. Told by
 * its opening sentence, not by a notice being there: the answer carries ONE
 * notice, the last one a hook or flow on the write set, so another notice on
 * the same save means the server's was replaced, and an older server's answer
 * can carry another hook's notice. Should the server's wording change, this
 * answers false and the toast shows both lines, never neither.
 */
const isServerMfaNotice = (notice: string | undefined): boolean =>
  typeof notice === 'string' && SERVER_MFA_NOTICE_OPENINGS.some((opening) => notice.includes(opening));

/**
 * The line an accepted organization save adds to its toast when it turned the
 * requirement on: who must enroll and when the block starts. `undefined` when
 * the saved row does not require MFA, or the stored row already did
 * (`storedRequireMfa === true`); an unread stored value (`undefined`) counts as
 * off, since saying it once too often is cheaper than not saying it.
 *
 * `undefined` too when the save answer's notice (`answerNotice`) is the
 * server's MFA notice: it says all of this with the grace period in force,
 * where the console's line can only name the default 7 days.
 */
export function organizationMfaSavedNotice(input: {
  objectName: string | undefined;
  storedRequireMfa: boolean | undefined;
  saved: unknown;
  /** The save answer's `notice`, as the record form's claim took it. */
  answerNotice?: string;
  t: Translate;
}): string | undefined {
  if (input.objectName !== ORGANIZATION_OBJECT) return undefined;
  if (input.storedRequireMfa === true) return undefined;
  const saved = input.saved as Record<string, unknown> | null | undefined;
  if (!saved || !isOn(saved[REQUIRE_MFA_FIELD])) return undefined;
  if (isServerMfaNotice(input.answerNotice)) return undefined;
  return input.t('console.organizationMfa.nowRequired');
}

/** The slice of the data source the stored-value read needs. */
interface FindOneSource {
  findOne(objectName: string, id: string): Promise<unknown>;
}

/**
 * The organization row's stored `require_mfa` while its form is open: `false`
 * for a create, the row's value for an edit, `undefined` while unread, when the
 * read fails, or for any other object. Keyed on the primitives it reads, so a
 * re-render never re-reads.
 */
export function useStoredRequireMfa(
  objectName: string | undefined,
  recordId: string | undefined,
  open: boolean,
  dataSource: FindOneSource | null | undefined,
): boolean | undefined {
  const [stored, setStored] = useState<{ key: string; value: boolean } | null>(null);
  const applies = open && objectName === ORGANIZATION_OBJECT;
  const key = `${objectName ?? ''}:${recordId ?? 'new'}`;
  useEffect(() => {
    if (!applies || !recordId || !dataSource) return;
    let cancelled = false;
    dataSource
      .findOne(ORGANIZATION_OBJECT, recordId)
      .then((row) => {
        if (cancelled) return;
        const value = (row as Record<string, unknown> | null | undefined)?.[REQUIRE_MFA_FIELD];
        setStored({ key, value: isOn(value) });
      })
      .catch(() => {
        /* unread: the saved notice treats it as off */
      });
    return () => {
      cancelled = true;
    };
    // `dataSource` is read when the form opens; a new adapter mid-form does not re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applies, recordId, key]);
  if (!applies) return undefined;
  if (!recordId) return false;
  return stored && stored.key === key ? stored.value : undefined;
}
