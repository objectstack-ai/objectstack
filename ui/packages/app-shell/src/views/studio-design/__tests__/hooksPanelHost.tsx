// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The hooks panel as the Data pillar mounts it, for a suite that mounts the
 * panel alone (objectstack#36511): the pillar's buffer
 * (`useObjectHooksBuffer`), read as the Hooks tab opens, its conflict dialog,
 * and the top bar's Save and Cancel around them ({@link StudioSaveHarness}).
 */

import * as React from 'react';
import { ObjectHooksPanel } from '../ObjectHooksPanel';
import { useObjectHooksBuffer } from '../objectHooksBuffer';
import { StudioSaveHarness } from './studioSaveHarness';

export interface HooksPanelHostProps {
  objectName: string;
  packageId: string;
  disabled?: boolean;
  hookSchema?: Record<string, unknown>;
  publishNonce?: number;
}

function Hooks({ objectName, packageId, disabled, hookSchema, publishNonce }: HooksPanelHostProps): React.ReactElement {
  const buffer = useObjectHooksBuffer({ objectName, packageId, active: true, disabled, publishNonce });
  return (
    <>
      {buffer.dialog}
      <ObjectHooksPanel buffer={buffer} disabled={disabled} hookSchema={hookSchema} />
    </>
  );
}

export function HooksPanelHost(props: HooksPanelHostProps): React.ReactElement {
  return (
    <StudioSaveHarness>
      <Hooks {...props} />
    </StudioSaveHarness>
  );
}
