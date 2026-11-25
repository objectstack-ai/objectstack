// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The × of an app page that Studio opened (objectstack#36906, epic #36890
 * decision 15): a dashboard, a report, or the new-report page that a Studio
 * list opened in its app. The page's address carries the Studio list
 * (`?studio=`, `STUDIO_RETURN_PARAM`), so the × is still there after a
 * reload and still goes back to that list, with its filters and sort.
 *
 * A page that holds edits it would drop says so with `dirty`: the × asks
 * first, as Studio's own × does (decision 12).
 *
 * @module
 */

import { useLocation, useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { Button } from '@object-ui/components';
import { useSafeTranslate } from '@object-ui/i18n';
import { confirmUnsavedLeave } from '../chrome/unsavedEdits.js';
import { readStudioReturn } from './studio-design/studioAddress.js';

/** The Studio address this app page returns to, or `null` when Studio did not open it. */
export function useStudioReturnPath(): string | null {
  const { search } = useLocation();
  return readStudioReturn(search);
}

/** The ask a dirty page's × makes before it drops the edits. */
export function useStudioReturnLeaveMessage(): string {
  const tt = useSafeTranslate();
  return tt('studioReturn.leaveConfirm', 'Leave without saving? Your unsaved changes will be lost.');
}

export function StudioReturnButton({ to, dirty = false }: { to: string; dirty?: boolean }) {
  const tt = useSafeTranslate();
  const navigate = useNavigate();
  const leaveMessage = useStudioReturnLeaveMessage();
  const label = tt('studioReturn.closeLabel', 'Close and go back to the Studio list');
  return (
    <Button
      variant="ghost"
      size="sm"
      // 44 px tall below `sm`, a phone's touch-target floor (objectstack#29078).
      className="min-h-11 sm:min-h-0"
      aria-label={label}
      title={label}
      data-testid="studio-return"
      data-target={to}
      onClick={() => {
        if (dirty) {
          if (window.confirm(leaveMessage)) navigate(to);
          return;
        }
        confirmUnsavedLeave(() => navigate(to));
      }}
    >
      <X className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
      <span className="hidden sm:inline">{tt('studioReturn.close', 'Back to Studio')}</span>
    </Button>
  );
}
