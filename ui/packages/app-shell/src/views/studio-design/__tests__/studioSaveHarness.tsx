// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The top bar's Save and Cancel for a suite that mounts a pillar without the
 * surface (objectstack#36511). A pillar's explicit-save buffers register with
 * the surface's coordinator, so a pillar mounted alone saves nothing; wrapped
 * in {@link StudioSaveHarness} it gets the same coordinator and the same two
 * buttons the surface draws, and {@link pressStudioSave} presses Save.
 */

import * as React from 'react';
import { expect } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
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

/**
 * Press the top bar's Save once it is drawn (the page holds an unsaved edit),
 * and, unless `settle` is false, wait for that Save to end: its writes sent,
 * or refused before any. `settle: false` for a Save that stops on a question
 * the case answers (the draft-version conflict).
 */
export async function pressStudioSave({ settle = true }: { settle?: boolean } = {}): Promise<void> {
  const save = await screen.findByTestId('studio-save', undefined, { timeout: 4000 });
  await act(async () => {
    fireEvent.click(save);
  });
  if (!settle) return;
  await waitFor(() => expect(screen.queryByTestId('studio-save')?.hasAttribute('disabled') ?? false).toBe(false), {
    timeout: 4000,
  });
}

/** Press the top bar's Cancel once it is drawn. */
export async function pressStudioCancel(): Promise<void> {
  const cancel = await screen.findByTestId('studio-cancel', undefined, { timeout: 4000 });
  await act(async () => {
    fireEvent.click(cancel);
  });
}
