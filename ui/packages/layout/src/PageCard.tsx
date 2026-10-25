import React from 'react';
import { cn } from '@object-ui/components';

export function PageCard({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-xl border bg-card text-card-foreground shadow", className)} {...props}>
      <div className="p-6">
        {children}
      </div>
    </div>
  );
}
