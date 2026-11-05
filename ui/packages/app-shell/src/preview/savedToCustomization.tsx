// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack ADR-0146 D3 — the one sentence that names where a customization
 * of a read-only base is saved: "Saved to BASE's customizations". The
 * pending-changes sheet (`DraftChangesPanel`) draws it under its title, and
 * the Studio item header draws it on its note line (objectstack#29691), so
 * both say the same words from the same key.
 *
 * Its own module, not the sheet's: many Studio tests replace the whole
 * `DraftChangesPanel` module with a stub, and the header must not depend on
 * what such a stub happens to export.
 */

import { useObjectTranslation } from '@object-ui/i18n';

type Translate = ReturnType<typeof useObjectTranslation>['t'];

export function savedToCustomizationText(t: Translate, baseLabel: string): string {
  return t('preview.changes.savedToCustomization', {
    package: baseLabel,
    defaultValue: 'Saved to {{package}}’s customizations',
  });
}

/**
 * The command that moves a customization to another environment, spelled
 * verbatim in every language: it is typed, not read (objectstack#30119).
 */
export const PACKAGE_EXPORT_COMMAND = 'os package export';

/**
 * objectstack#30119 (ADR-0146 D2) — the sentence under "Saved to BASE's
 * customizations" in the pending-changes sheet: the changes live in this
 * environment's database as items of `pairId`, the `<base>.custom` package
 * the server answered for the base, not in the project's source, and only
 * {@link PACKAGE_EXPORT_COMMAND} takes them to another environment. True on
 * every deployment, so it is not switched by the served `environment`.
 */
export function customizationEnvironmentText(t: Translate, pairId: string): string {
  return t('preview.changes.customizationEnvironment', {
    pair: pairId,
    command: PACKAGE_EXPORT_COMMAND,
    defaultValue:
      'These changes are kept in this environment’s database as items of {{pair}}, not in your project’s source. They reach another environment only through {{command}}.',
  });
}

/**
 * {@link savedToCustomizationText} as an element, for the Studio item header's
 * note line. Given the pair's id, it goes on with the pending-changes sheet's
 * second sentence, {@link customizationEnvironmentText}, so the header and
 * the sheet say the same words from the same keys (objectstack#30436).
 */
export function SavedToCustomizationNote({
  baseLabel,
  pairId,
  testId,
}: {
  baseLabel: string;
  /** The base's `<base>.custom` pair; nothing more is said without one. */
  pairId?: string | null;
  testId?: string;
}) {
  const { t } = useObjectTranslation();
  return (
    <>
      <span data-testid={testId}>{savedToCustomizationText(t, baseLabel)}</span>
      {pairId ? (
        <span data-testid={testId ? `${testId}-environment` : undefined} className="block">
          {customizationEnvironmentText(t, pairId)}
        </span>
      ) : null}
    </>
  );
}
