import React from 'react';
import { Input, Button, EmptyValue } from '@object-ui/components';
import { QrCode, Copy } from 'lucide-react';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';

/**
 * QR Code field widget - generates QR codes from text
 * Uses a simple SVG-based QR code generator
 */
export function QRCodeField({ value, onChange, field, readonly, error, ...props }: FieldWidgetComponentProps<string>) {
  const [showQR, setShowQR] = React.useState(false);
  const config = field;

  // Simple QR code generation using an external library would be ideal
  // For now, we'll use a service API approach or placeholder
  const getQRCodeUrl = (text: string): string => {
    // Using a simple QR code API service (you might want to replace this with a library)
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(text)}`;
  };

  const copyToClipboard = () => {
    if (value) {
      navigator.clipboard.writeText(value);
    }
  };

  if (readonly) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm flex-1 truncate">{value || <EmptyValue />}</span>
        {value && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowQR(!showQR)}
          >
            <QrCode className="w-4 h-4 mr-2" />
            {showQR ? 'Hide' : 'Show'} QR
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          // DOM pass-through onto the real focusable control (objectui#3318).
          {...toDomProps(props)}
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={config?.placeholder || 'Enter text for QR code'}
          disabled={readonly || props.disabled}
          className={props.className}
          // AFTER the spread so this widget's own computation wins: `error`
          // is the published validation slot (#3222), `!!undefined` →
          // explicit "false".
          aria-invalid={!!error}
        />
        {value && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={copyToClipboard}
            >
              <Copy className="w-4 h-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowQR(!showQR)}
            >
              <QrCode className="w-4 h-4" />
            </Button>
          </>
        )}
      </div>

      {showQR && value && (
        <div className="border rounded p-4 bg-white flex justify-center">
          <img
            src={getQRCodeUrl(value)}
            alt="QR Code"
            className="w-48 h-48"
          />
        </div>
      )}

      {value && (
        <p className="text-xs text-muted-foreground">
          QR code contains: {value.length} characters
        </p>
      )}
    </div>
  );
}
