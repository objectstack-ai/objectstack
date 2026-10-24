import React, { useRef, useEffect } from 'react';
import { Button } from '@object-ui/components';
import { Eraser } from 'lucide-react';
import { FieldWidgetComponentProps } from './types.js';
import { toHostGroupProps } from './toHostGroupProps.js';

/**
 * Signature field widget - provides a signature pad for capturing signatures
 * Outputs signature as a base64 PNG image
 *
 * ## Naming, and the half that is deliberately absent (objectui#3318)
 *
 * This widget forwarded nothing a host handed it — every branch below wrote its
 * attributes by hand — so its visible label pointed `for` at an id no element
 * in the row carried, and the rendered help text had zero consumers. Measured
 * on `origin/main`, a real form, this field required and freshly failed:
 *
 * ```
 * signature  labelFor=…-form-item -> DANGLING  descConsumers=0  ids=[]
 * ```
 *
 * The name and the description arrive here, on the container, through
 * {@link toHostGroupProps} — the objectui#3961 route for a widget whose surface
 * no `<label for>` can reach (`<canvas>` is not a labelable element), and which
 * therefore declares `labelling: 'group'` in `FIELD_WIDGET_LABELLING`.
 * `'instead-of-the-inputs'` because this field renders no input of its own for
 * the description to land on: the Clear button is auxiliary — it acts on the
 * value, it is not the value's control — the same reading that put
 * `geolocation`'s focusable "View on map" link on that side of the split.
 *
 * `aria-invalid` and `aria-required` are NOT here, and their absence is a
 * verdict rather than an omission. The drawing surface has no keyboard path at
 * all (measured: this row offers zero focusable elements while empty — the only
 * candidate, Clear, is `disabled` until something has been drawn), so there is
 * no element assistive technology would read a control state from. Marking the
 * container instead would announce a state with no control behind it — the
 * non-focusable-wrapper move objectui#3291 and #3318 both draw the line
 * against. The type is recorded in that sweep's NOT_APPLICABLE ledger with a
 * guard that turns red the day a real control appears here.
 */
export function SignatureField({
  value,
  onChange,
  readonly,
  ...props
}: FieldWidgetComponentProps<string>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = React.useState(false);
  const [isEmpty, setIsEmpty] = React.useState(!value);

  useEffect(() => {
    if (value && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0);
          setIsEmpty(false);
        };
        img.src = value;
      }
    }
  }, [value]);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (readonly) return;
    setIsDrawing(true);
    setIsEmpty(false);
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || readonly) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    ctx.lineTo(x, y);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Save signature as base64 PNG
    const dataUrl = canvas.toDataURL('image/png');
    onChange(dataUrl);
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setIsEmpty(true);
    onChange('');
  };

  const hostGroupProps = toHostGroupProps(props, 'instead-of-the-inputs');

  if (readonly && value) {
    return (
      <div {...hostGroupProps} className="border rounded p-2 bg-white">
        <img src={value} alt="Signature" loading="lazy" className="max-w-full h-auto" />
      </div>
    );
  }

  if (readonly && !value) {
    return (
      <span {...hostGroupProps} className="text-sm text-muted-foreground">
        No signature
      </span>
    );
  }

  return (
    <div {...hostGroupProps} className="space-y-2">
      <div className="border rounded bg-white">
        <canvas
          ref={canvasRef}
          width={400}
          height={200}
          className="w-full touch-none cursor-crosshair"
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
      </div>
      <div className="flex justify-between items-center">
        <p className="text-xs text-muted-foreground">
          {isEmpty ? 'Sign above' : 'Signature captured'}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={clearSignature}
          disabled={readonly || isEmpty}
        >
          <Eraser className="w-4 h-4 mr-2" />
          Clear
        </Button>
      </div>
    </div>
  );
}
