/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useEffect } from 'react';
import { toast } from 'sonner';
import { useObjectTranslation } from '@object-ui/i18n';
import { isSignedInLinkRefusal, signedInLinkRefusalMessage } from '../pages/auth/ssoCallbackRefusal';

/**
 * The tab-scoped slot a refused link travels in, from the login page that
 * received it to the page the person lands on. It holds a refusal CODE, never
 * a sentence, and is read back only for a code the console has a sentence for.
 */
export const LINK_REFUSAL_STORAGE_KEY = 'objectstack.console.linkRefusal';

/**
 * Called by the login page for a signed-in person who arrived with `?error=`,
 * right before it sends them on: a link refusal it knows is kept for the page
 * they land on. Any other code is not kept. The navigation that follows is a
 * full page load, so the slot is `sessionStorage` (this tab only).
 */
export function holdLinkRefusalForLanding(code: string | null | undefined): void {
  if (!isSignedInLinkRefusal(code)) return;
  try {
    window.sessionStorage.setItem(LINK_REFUSAL_STORAGE_KEY, code);
  } catch {
    // Storage refused (a locked-down browser): the person lands as before.
  }
}

/** Takes the held code out of the slot: shown once, then gone. `null` when none, or not one we know. */
function takeHeldLinkRefusal(): string | null {
  try {
    const code = window.sessionStorage.getItem(LINK_REFUSAL_STORAGE_KEY);
    if (code === null) return null;
    window.sessionStorage.removeItem(LINK_REFUSAL_STORAGE_KEY);
    return isSignedInLinkRefusal(code) ? code : null;
  } catch {
    return null;
  }
}

/** Rendered inside the toast, so the sentence follows the person's language once it has loaded. */
function LinkRefusalSentence({ code }: { code: string }) {
  const { t } = useObjectTranslation();
  return <span data-testid="link-refusal-notice">{signedInLinkRefusalMessage(t, code)}</span>;
}

/**
 * Says why a link was refused, on the page a signed-in person lands on after
 * the refusal: an error toast that stays until they close it. Mounted once,
 * after the console's toaster, so the toaster is listening when it fires.
 */
export function LinkRefusalNotice() {
  useEffect(() => {
    const code = takeHeldLinkRefusal();
    if (!code) return;
    toast.error(<LinkRefusalSentence code={code} />, {
      id: 'link-refusal',
      duration: Infinity,
      closeButton: true,
    });
  }, []);
  return null;
}
