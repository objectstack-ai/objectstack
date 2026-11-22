// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The top bar's Save and Cancel for a suite that mounts a pillar without the
 * surface (objectstack#36511). A pillar's explicit-save buffers register with
 * the surface's coordinator, so a pillar mounted alone saves nothing; wrapped
 * in {@link StudioSaveHarness} it gets the same coordinator and the same two
 * buttons the surface draws, and {@link pressStudioSave} presses Save.
 */

import * as React from 'react';
import { act, fireEvent, screen } from '@testing-library/react';
import {
  StudioSaveControls,
  StudioSaveProvider,
  useStudioSaveCoordinator,
} from '../studioSaveBar';

export function StudioSaveHarness({ children, locale = 'en' }: { children: React.ReactNode; locale?: string }): React.ReactElement {
  const coordinator = useStudioSaveCoordinator(locale);
  return (
    <StudioSaveProvider value={coordinator.registry}>
      <div data-testid="studio-save-harness">
        <StudioSaveControls coordinator={coordinator} locale={locale} />
      </div>
      {children}
    </StudioSaveProvider>
  );
}

/** Press the top bar's Save once it is drawn (the page holds an unsaved edit). */
export async function pressStudioSave(): Promise<void> {
  const save = await screen.findByTestId('studio-save', undefined, { timeout: 4000 });
  await act(async () => {
    fireEvent.click(save);
  });
}

/** Press the top bar's Cancel once it is drawn. */
export async function pressStudioCancel(): Promise<void> {
  const cancel = await screen.findByTestId('studio-cancel', undefined, { timeout: 4000 });
  await act(async () => {
    fireEvent.click(cancel);
  });
}
