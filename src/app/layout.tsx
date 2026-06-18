import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Topic Synthesis',
  description: 'Generate interactive, scaffolded learning curricula from a topic.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
