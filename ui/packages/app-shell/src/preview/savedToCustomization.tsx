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

/** {@link savedToCustomizationText} as an element, for the Studio item header's note line. */
export function SavedToCustomizationNote({ baseLabel, testId }: { baseLabel: string; testId?: string }) {
  const { t } = useObjectTranslation();
  return <span data-testid={testId}>{savedToCustomizationText(t, baseLabel)}</span>;
}
