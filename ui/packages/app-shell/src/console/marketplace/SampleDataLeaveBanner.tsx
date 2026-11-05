// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The reach to the sample-data clear from the installed app's own pages
 * (objectstack#30323), through the console's generic banner: a `banner`
 * notification (`NotificationBanners`, drawn above every page's content by
 * `ConsoleLayout`), not a block of its own.
 *
 * While the installer is on the package page, the install note there carries
 * the count and the clear, so no banner stands. When they leave it, to the
 * app they just installed or anywhere else, a banner follows: the app has
 * sample data, with a "Clear sample data" action that brings them back to the
 * package page with the console's confirm open. Clearing withdraws it, and so
 * does coming back to the page; dismissing it is the installer's choice.
 *
 * It is raised only for a package this session recorded loading sample data
 * into (`sampleDataNotice.ts`), and only while a notification provider is
 * mounted: the page renders this component under that guard, since
 * `useNotifications()` throws outside one.
 */

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '@object-ui/react';
import { useObjectTranslation } from '@object-ui/i18n';
import { attachBanner, requestClearConfirm, sampleDataNotice, withdrawBanner } from './sampleDataNotice.js';

export function SampleDataLeaveBanner({ manifestId }: { manifestId: string | null }) {
  const { notify, dismiss } = useNotifications();
  const { t } = useObjectTranslation();
  const navigate = useNavigate();
  // The cleanup below runs once the page is gone, so it reads the functions
  // of the last render rather than those of the render that set it up.
  const latest = useRef({ notify, dismiss, t, navigate });
  latest.current = { notify, dismiss, t, navigate };

  useEffect(() => {
    if (!manifestId) return;
    // Back on the package page: its install note speaks for the sample data.
    withdrawBanner(manifestId);
    return () => {
      const notice = sampleDataNotice(manifestId);
      if (!notice) return;
      const { notify: raise, dismiss: drop, t: tr, navigate: go } = latest.current;
      const id = raise({
        title: tr('marketplace.detail.sampleDataBannerTitle', { name: notice.name }),
        message: tr('marketplace.detail.sampleDataBannerMessage'),
        severity: 'info',
        displayType: 'banner',
        actions: [{
          label: tr('marketplace.detail.purgeSampleData'),
          variant: 'primary',
          onClick: () => {
            requestClearConfirm(notice.manifestId);
            go(notice.path);
          },
        }],
      });
      attachBanner(notice.manifestId, () => drop(id));
    };
  }, [manifestId]);

  return null;
}
