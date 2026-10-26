/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from "react"
import { createSafeTranslation } from "@object-ui/i18n"
import { cn } from "../lib/utils"
import { Loader2 } from "lucide-react"

/**
 * The status region's accessible name reads `common.loading`, the key the rest
 * of the tree already uses for a bare "Loading…" (objectui#12145), so a
 * screen reader under a non-English locale hears its own language. The row is
 * the `en` pack's value, served when no `I18nProvider` is mounted; a caller's
 * own `aria-label` still wins, because `props` spread after it.
 */
const useSpinnerTranslation = createSafeTranslation(
  { "common.loading": "Loading…" },
  "common.loading",
)

function Spinner({ className, ...props }: React.ComponentProps<"div">) {
  const { t } = useSpinnerTranslation()
  return (
    <div
      role="status"
      aria-label={t("common.loading")}
      className={cn("flex items-center justify-center", className)}
      {...props}
    >
      <Loader2 className="animate-spin text-muted-foreground w-full h-full min-w-4 min-h-4" />
    </div>
  )
}

export { Spinner }
