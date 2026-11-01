// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup › Packaged actions — on/off for this deployment, per action an
 * installed package ships (ADR-0126 §7.4: "Studio keeps the editing; Setup
 * gets the operational state").
 *
 * The page is what stayed in Setup of Setup › Packaged automation. objectstack
 * ADR-0146 D4 moved the packaged FLOW's switch onto the flow's item in Studio
 * (the Automations pillar's ledger switch), and its clone became Studio's New
 * similar, so D11 retired that page; D4 keeps the ACTION switch where it is,
 * and no card of that epic moves it. So the actions section is this page, as
 * it was, under the page header that names it. The section reads and writes
 * through its own doors (`PackagedActionsSection.tsx` says which, and why each
 * refusal is shown verbatim); the header's Refresh re-reads it.
 *
 * Reached through the `automation:packaged-actions` component ref registered
 * in `services/builtinComponents`; the Setup navigation names that ref
 * (`nav_packaged_actions`, platform-objects).
 */

import * as React from 'react';
import { Zap } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import { PackagedActionsSection } from './PackagedActionsSection.js';
import { PageHeader } from '../../layout/PageHeader.js';

export function PackagedActionsPage() {
  const { t } = useObjectTranslation();
  const [nonce, setNonce] = React.useState(0);
  return (
    <div>
      <PageHeader
        title={t('packagedAutomation.actionsHeading', { defaultValue: 'Packaged actions' })}
        subtitle={t('packagedAutomation.actionsSubtitle', {
          defaultValue:
            'Actions shipped by installed packages. Turn one off for this deployment and it stops running everywhere it is offered. Authoring your own action alongside it stays open in Studio.',
        })}
        icon={<Zap className="h-4 w-4" />}
        refresh={{
          onRefresh: () => setNonce((n) => n + 1),
          label: t('packagedAutomation.refresh', { defaultValue: 'Refresh' }),
        }}
      />
      <div className="p-6 space-y-4">
        <PackagedActionsSection nonce={nonce} headed={false} />
      </div>
    </div>
  );
}

export default PackagedActionsPage;
