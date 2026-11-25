// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36903 — the flow list's 「新建」, for the suites whose subject is
 * the New automation dialog. The Automations pillar's own New (its rail's "+")
 * is gone with the rail; every flow is created from the list's dialog
 * (`MetadataListCreateDialog`), which offers the same starting points, the
 * same Advanced trigger form and the same refusals.
 *
 * The button stands in for the list's 「新建」: it carries the dialog's title,
 * as the rail's "+" did, so the suites open the dialog by that title. Each
 * press mounts a fresh dialog, as the list does on every open.
 */

import * as React from 'react';
import { MetadataListCreateDialog } from '../../metadata-admin/MetadataListCreateDialog.js';
import { t, type SupportedLocale } from '../../metadata-admin/i18n.js';

export function ListFlowCreate({
  packageId,
  inPair = false,
  locale = 'en-US',
  onCreated,
}: {
  packageId: string;
  inPair?: boolean;
  locale?: SupportedLocale;
  onCreated?: (created: { name: string; packageId: string }) => void;
}): React.ReactElement {
  const [opened, setOpened] = React.useState(0);
  const [open, setOpen] = React.useState(false);
  const title = t('engine.studio.auto.newTitle', locale);
  return (
    <>
      <button
        type="button"
        title={title}
        aria-label={title}
        onClick={() => {
          setOpened((n) => n + 1);
          setOpen(true);
        }}
      >
        +
      </button>
      {opened > 0 && (
        <MetadataListCreateDialog
          key={opened}
          type="flow"
          open={open}
          onOpenChange={setOpen}
          packageId={packageId}
          inPair={inPair}
          locale={locale}
          onCreated={(created) => {
            setOpen(false);
            onCreated?.(created);
          }}
        />
      )}
    </>
  );
}
