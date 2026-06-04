import { redirect } from 'next/navigation';

export default function RootPage() {
  // Middleware should handle locale routing, but keep the root focused on docs.
  redirect('/docs');
}
