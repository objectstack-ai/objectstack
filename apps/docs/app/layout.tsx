import './global.css';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    template: '%s | ObjectStack Protocol',
    default: 'ObjectStack Protocol',
  },
  description: 'Documentation for the ObjectStack Protocol and runtime.',
  icons: {
    icon: '/logo.svg',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">{children}</body>
    </html>
  );
}
