/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useCallback, useState } from 'react';
import { Button, cn, toast } from '@object-ui/components';
import { ScanBarcode } from 'lucide-react';
import { nativeScan, useNativeHost, type ObjectStackNative } from '@object-ui/mobile';
import { PHONE_TOUCH_SQUARE } from './touchTarget.js';
import { useFieldTranslation } from './useFieldTranslation.js';

/** Whether the shell bridge announces `scan` and carries the method. */
function hostOffersScan(host: ObjectStackNative | null): boolean {
  if (!host || typeof host.has !== 'function' || typeof host.scan !== 'function') return false;
  try {
    return host.has('scan') === true;
  } catch {
    return false;
  }
}

/**
 * Whether a field may offer the scan button: only inside the ObjectStack mobile
 * shell, and only when that shell announces `scan`. A plain browser and an
 * older shell answer `false`. Re-renders when a late bridge is injected.
 */
export function useFieldScanOffered(): boolean {
  return hostOffersScan(useNativeHost());
}

/** Internal to `@object-ui/fields`; not exported from the package entry. */
export interface ScanFieldButtonProps {
  /** Called with the decoded text. Not called when the user closes the scanner. */
  onScan: (text: string) => void;
  className?: string;
}

/**
 * The icon button that opens the shell's code scanner. The caller renders it
 * only when `useFieldScanOffered()` is true and the field is editable. A
 * scanner failure (camera permission denied, a scan already open) is shown
 * with the error toast, carrying the shell's message.
 */
export function ScanFieldButton({ onScan, className }: ScanFieldButtonProps) {
  const { t } = useFieldTranslation();
  const [scanning, setScanning] = useState(false);

  const handleClick = useCallback(async () => {
    setScanning(true);
    try {
      const result = await nativeScan();
      if (result.status === 'ok') {
        if (typeof result.value === 'string' && result.value !== '') onScan(result.value);
      } else if (result.status === 'failed') {
        toast.error(t('fields.scan.failed'), { description: result.message });
      }
    } finally {
      setScanning(false);
    }
  }, [onScan, t]);

  const label = t('fields.scan.button');
  return (
    <Button
      variant="outline"
      size="icon"
      type="button"
      className={cn('shrink-0', PHONE_TOUCH_SQUARE, className)}
      onClick={handleClick}
      disabled={scanning}
      aria-label={label}
      title={label}
      data-testid="field-scan-button"
    >
      <ScanBarcode className="size-4" />
    </Button>
  );
}
