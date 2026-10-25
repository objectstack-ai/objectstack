/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { cn, Button } from '@object-ui/components';
import { Paperclip, X, FileText, Image, FileArchive, File, Upload } from 'lucide-react';
import { useDetailTranslation } from './useDetailTranslation';

export interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string;
  url?: string;
  thumbnailUrl?: string;
}

export interface CommentAttachmentProps {
  attachments: Attachment[];
  onUpload?: (files: FileList) => void | Promise<void>;
  onRemove?: (attachmentId: string) => void;
  className?: string;
  readOnly?: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageType(type: string): boolean {
  return type.startsWith('image/');
}

function getFileIcon(type: string): React.ElementType {
  if (isImageType(type)) return Image;
  if (type.includes('pdf') || type.includes('document') || type.includes('text'))
    return FileText;
  if (type.includes('zip') || type.includes('archive') || type.includes('compressed'))
    return FileArchive;
  return File;
}

export const CommentAttachment: React.FC<CommentAttachmentProps> = ({
  attachments,
  onUpload,
  onRemove,
  className,
  readOnly = false,
}) => {
  const { t } = useDetailTranslation();
  const [isDragOver, setIsDragOver] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      if (onUpload && e.dataTransfer.files.length > 0) {
        onUpload(e.dataTransfer.files);
      }
    },
    [onUpload],
  );

  const handleFileSelect = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (onUpload && e.target.files && e.target.files.length > 0) {
        onUpload(e.target.files);
        // Reset so the same file can be selected again
        e.target.value = '';
      }
    },
    [onUpload],
  );

  return (
    <div className={cn('space-y-2', className)}>
      {/* Drop zone */}
      {onUpload && !readOnly && (
        <div
          className={cn(
            'border-2 border-dashed rounded-md px-4 py-3 text-center transition-colors cursor-pointer',
            isDragOver
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 hover:border-muted-foreground/40',
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
        >
          <Upload className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
          <p className="text-xs text-muted-foreground">
            {t('detail.dropFilesToUpload')}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>
      )}

      {/* Attachment list */}
      {attachments.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Paperclip className="h-3 w-3" />
            <span>
              {/* One count family (objectui#11445): i18next picks the CLDR slot,
                  so `ru` 3 reads «3 вложения» and `ar` 2 reads the dual. */}
              {t('detail.attachmentCount', { count: attachments.length })}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {attachments.map((attachment) => {
              const isImage = isImageType(attachment.type);
              const Icon = getFileIcon(attachment.type);

              return (
                <div
                  key={attachment.id}
                  className="flex items-center gap-2 rounded-md border px-2.5 py-2 bg-muted/30 group"
                >
                  {/* Thumbnail or icon */}
                  {isImage && (attachment.thumbnailUrl || attachment.url) ? (
                    <img
                      src={attachment.thumbnailUrl || attachment.url}
                      alt={attachment.name}
                      className="h-10 w-10 rounded object-cover shrink-0"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded bg-muted flex items-center justify-center shrink-0">
                      <Icon className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}

                  {/* File info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{attachment.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {formatFileSize(attachment.size)}
                    </p>
                  </div>

                  {/* Remove button */}
                  {onRemove && !readOnly && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => onRemove(attachment.id)}
                      title={t('detail.removeAttachment')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
