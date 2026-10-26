/**
 * ImageCropperDialog - Lightweight crop/rotate dialog for ImageField.
 *
 * Implementation notes:
 * - Uses a Canvas + native pointer events (no extra dependency) so the bundle
 *   stays small and the widget works in all SDUI contexts.
 * - Exposes a rectangular crop selection that can be dragged around the image
 *   and a rotate-by-90° button.
 * - On confirm, returns a `Blob` of the cropped image (PNG by default) so callers
 *   can wire it into upload providers or `URL.createObjectURL()`.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@object-ui/components';
import { RotateCw, Crop as CropIcon } from 'lucide-react';
import { useFieldTranslation } from './useFieldTranslation.js';

export interface ImageCropperDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Source image URL or data URL */
  src: string;
  /** MIME type for the cropped output. Defaults to image/png. */
  outputType?: string;
  /** Suggested filename (passed back via onConfirm). Defaults to "cropped.png". */
  outputName?: string;
  /** Called when the user confirms the crop. */
  onConfirm: (blob: Blob, name: string) => void;
}

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const ImageCropperDialog: React.FC<ImageCropperDialogProps> = ({
  open,
  onOpenChange,
  src,
  outputType = 'image/png',
  outputName = 'cropped.png',
  onConfirm,
}) => {
  const { t } = useFieldTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [rotation, setRotation] = useState(0); // 0, 90, 180, 270
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, width: 100, height: 100 });
  const [drag, setDrag] = useState<{ ox: number; oy: number; cx: number; cy: number } | null>(null);
  const [imageReady, setImageReady] = useState(false);

  // Load the image when the dialog opens
  useEffect(() => {
    if (!open || !src) return;
    setImageReady(false);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      // Default crop = centred 80% box
      const w = img.naturalWidth * 0.8;
      const h = img.naturalHeight * 0.8;
      setCrop({
        x: (img.naturalWidth - w) / 2,
        y: (img.naturalHeight - h) / 2,
        width: w,
        height: h,
      });
      setRotation(0);
      setImageReady(true);
    };
    img.onerror = () => setImageReady(false);
    img.src = src;
  }, [open, src]);

  // Render image + crop overlay
  useEffect(() => {
    if (!imageReady || !imgRef.current || !canvasRef.current) return;
    const img = imgRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Scale image to fit a 480px-wide preview while preserving aspect
    const previewW = 480;
    const scale = previewW / img.naturalWidth;
    const previewH = img.naturalHeight * scale;
    canvas.width = previewW;
    canvas.height = previewH;
    ctx.clearRect(0, 0, previewW, previewH);

    // Apply rotation to the image (purely visual — actual rotation is baked in on confirm)
    ctx.save();
    ctx.translate(previewW / 2, previewH / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    const drawW = rotation % 180 === 0 ? previewW : previewH;
    const drawH = rotation % 180 === 0 ? previewH : previewW;
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    // Draw crop overlay (in preview coordinates)
    const px = crop.x * scale;
    const py = crop.y * scale;
    const pw = crop.width * scale;
    const ph = crop.height * scale;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, previewW, py);
    ctx.fillRect(0, py + ph, previewW, previewH - py - ph);
    ctx.fillRect(0, py, px, ph);
    ctx.fillRect(px + pw, py, previewW - px - pw, ph);
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.strokeRect(px, py, pw, ph);
  }, [imageReady, crop, rotation]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!imgRef.current || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const scale = imgRef.current.naturalWidth / rect.width;
      setDrag({
        ox: (e.clientX - rect.left) * scale,
        oy: (e.clientY - rect.top) * scale,
        cx: crop.x,
        cy: crop.y,
      });
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    },
    [crop],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drag || !imgRef.current || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const scale = imgRef.current.naturalWidth / rect.width;
      const dx = (e.clientX - rect.left) * scale - drag.ox;
      const dy = (e.clientY - rect.top) * scale - drag.oy;
      const nextX = Math.max(0, Math.min(drag.cx + dx, imgRef.current.naturalWidth - crop.width));
      const nextY = Math.max(0, Math.min(drag.cy + dy, imgRef.current.naturalHeight - crop.height));
      setCrop((c) => ({ ...c, x: nextX, y: nextY }));
    },
    [drag, crop.width, crop.height],
  );

  const handlePointerUp = useCallback(() => setDrag(null), []);

  const rotate = useCallback(() => setRotation((r) => (r + 90) % 360), []);

  const handleConfirm = useCallback(async () => {
    if (!imgRef.current) return;
    const img = imgRef.current;
    const out = document.createElement('canvas');
    // After rotation, swap width/height when needed
    const cw = crop.width;
    const ch = crop.height;
    out.width = rotation % 180 === 0 ? cw : ch;
    out.height = rotation % 180 === 0 ? ch : cw;
    const ctx = out.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(img, crop.x, crop.y, cw, ch, -cw / 2, -ch / 2, cw, ch);
    ctx.restore();
    const blob: Blob | null = await new Promise((resolve) => out.toBlob(resolve, outputType));
    if (blob) {
      onConfirm(blob, outputName);
      onOpenChange(false);
    }
  }, [crop, rotation, outputName, outputType, onConfirm, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Crop & rotate image</DialogTitle>
          <DialogDescription>
            Drag the highlighted box to reposition the crop. Use the rotate button to spin the image
            in 90° increments.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3">
          {imageReady ? (
            <canvas
              ref={canvasRef}
              data-testid="image-cropper-canvas"
              role="img"
              aria-label={t('fields.image.cropPreview')}
              className="border rounded-md cursor-move touch-none max-w-full"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            />
          ) : (
            <div className="flex h-[270px] w-full items-center justify-center text-sm text-muted-foreground">
              Loading image…
            </div>
          )}
          <div className="flex w-full items-center justify-between text-xs text-muted-foreground">
            <span>
              Crop: {Math.round(crop.width)} × {Math.round(crop.height)} px
            </span>
            <span>Rotation: {rotation}°</span>
          </div>
        </div>

        <DialogFooter className="flex justify-between sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={rotate}
            data-testid="image-cropper-rotate"
          >
            <RotateCw className="size-4 mr-2" />
            Rotate 90°
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={!imageReady}
              data-testid="image-cropper-confirm"
            >
              <CropIcon className="size-4 mr-2" />
              Apply crop
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
