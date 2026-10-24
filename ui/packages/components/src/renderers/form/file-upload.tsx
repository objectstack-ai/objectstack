/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { FileUploadSchema } from '@object-ui/types';
import { Label, Button } from '../../ui';
import { Upload, X, Rocket, CheckCircle2 } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { cn } from '../../lib/utils';
import { toFormControlDomProps } from '../../lib/form-control-dom-props';

ComponentRegistry.register('file-upload', 
  ({ schema, className, value, onChange, ...props }: { schema: FileUploadSchema; className?: string; value?: File[]; onChange?: (files: File[]) => void; [key: string]: any }) => {
    const [files, setFiles] = useState<File[]>(value || []);
    const [isUploading, setIsUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    // Simulate upload effect
    useEffect(() => {
        if (isUploading) {
            const interval = setInterval(() => {
                setProgress(prev => {
                    if (prev >= 100) {
                        clearInterval(interval);
                        setIsUploading(false);
                        return 0;
                    }
                    return prev + 5;
                });
            }, 50);
            return () => clearInterval(interval);
        }
    }, [isUploading]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newFiles = Array.from(e.target.files || []);
      if (newFiles.length > 0) {
          setIsUploading(true);
          setProgress(0);
          const updatedFiles = schema.multiple ? [...files, ...newFiles] : newFiles;
          setTimeout(() => {
            setFiles(updatedFiles);
            if (onChange) {
                onChange(updatedFiles);
            }
          }, 1000); // Delay actual "completion" to match animation
      }
    };

    const handleRemoveFile = (index: number) => {
      const updatedFiles = files.filter((_, i) => i !== index);
      setFiles(updatedFiles);
      if (onChange) {
        onChange(updatedFiles);
      }
    };

    const handleClick = () => {
      inputRef.current?.click();
    };

    // Extract designer-related props
    const { 
        'data-obj-id': dataObjId, 
        'data-obj-type': dataObjType,
        style, 
        ...inputProps 
    } = props;

    return (
      <div 
        className={`grid w-full max-w-sm items-center gap-2 ${schema.wrapperClass || ''}`}
        data-obj-id={dataObjId}
        data-obj-type={dataObjType}
        style={style}
      >
        {schema.label && <Label htmlFor={schema.id}>{schema.label}</Label>}
        <div className={cn('relative flex flex-col gap-3 group/upload', className)}>
          <input
            ref={inputRef}
            type="file"
            id={schema.id}
            className="hidden"
            accept={schema.accept}
            multiple={schema.multiple}
            onChange={handleFileChange}
            {...toFormControlDomProps(inputProps)}
          />
          
          <div 
            onClick={handleClick}
            className={cn(
                "relative overflow-hidden cursor-pointer rounded-lg border-2 border-dashed transition-all duration-300 min-h-[120px] flex flex-col items-center justify-center p-4 sm:p-6 gap-3",
                isUploading 
                    ? "border-cyan-400 bg-cyan-950/30" 
                    : "border-slate-700 bg-slate-900/50 hover:bg-slate-900 hover:border-cyan-500/50 hover:shadow-[0_0_20px_-5px_rgba(6,182,212,0.3)]"
            )}
          >
            {/* Background Grid Animation */}
            <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-5 pointer-events-none" />
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:14px_24px] pointer-events-none" />

            {/* Launch Pad Visual */}
             <div className={cn(
                "relative z-10 p-3 rounded-full bg-slate-800 border border-slate-700 transition-all duration-500",
                isUploading ? "scale-110 shadow-[0_0_30px_cyan] border-cyan-400 animate-bounce" : "group-hover/upload:scale-110 group-hover/upload:shadow-lg group-hover/upload:border-cyan-500"
             )}>
                {isUploading ? (
                    <Rocket className="w-8 h-8 text-cyan-300 animate-pulse" />
                ) : (
                    <Upload className="w-6 h-6 text-slate-400 group-hover/upload:text-cyan-400" />
                )}
             </div>

             <div className="relative z-10 text-center">
                <p className={cn("text-xs font-mono uppercase tracking-widest transition-colors", isUploading ? "text-cyan-300" : "text-slate-500 group-hover/upload:text-cyan-200")}>
                    {isUploading ? "INITIATING LAUNCH SEQUENCE..." : (schema.buttonText || "DROP PAYLOAD OR CLICK TO UPLOAD")}
                </p>
             </div>

            {/* Progress Bar (Holographic Beam) */}
             {isUploading && (
                <div className="absolute bottom-0 left-0 h-1 bg-cyan-500 shadow-[0_0_10px_cyan] transition-all duration-75 ease-out" style={{ width: `${progress}%` }} />
             )}
          </div>

          {/* File List */}
          {files.length > 0 && (
            <div className="flex flex-col gap-2 mt-1 perspective-1000">
              {files.map((file, index) => (
                <div
                  key={index}
                  className="relative group/file overflow-hidden flex items-center justify-between p-3 border border-border bg-card/80 rounded-sm text-sm transition-all hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10 animate-in slide-in-from-bottom-2 fade-in"
                >
                  <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-primary/50 group-hover/file:bg-primary group-hover/file:shadow-[0_0_8px_hsl(var(--primary))]" />
                  
                  <div className="flex items-center gap-3 z-10">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 rounded-full" />
                    <span className="truncate max-w-[150px] sm:max-w-[200px] md:max-w-[300px] text-muted-foreground group-hover/file:text-foreground font-mono text-xs transition-colors">{file.name}</span>
                  </div>
                  
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => handleRemoveFile(index)}
                  >
                    <X className="h-3 w-3" />
                  </Button>

                  {/* Scanning Effect - Fixed gradient syntax */}
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/5 to-transparent -translate-x-full group-hover/file:animate-[shimmer_1s_infinite] pointer-events-none" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  },
  {
    namespace: 'ui',
    label: 'File Upload',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'buttonText', type: 'string' },
      { name: 'accept', type: 'string', description: 'MIME types (e.g., "image/*,application/pdf")' },
      { name: 'multiple', type: 'boolean' },
      { name: 'id', type: 'string', required: true }
    ],
    defaultProps: {
      label: 'Upload files',
      buttonText: 'Choose files',
      multiple: true,
      id: 'file-upload-field'
    }
  }
);
