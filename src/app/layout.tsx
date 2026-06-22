import './globals.css';
import type { ReactNode } from 'react';
import { SessionNav } from './auth/session-nav';

export const metadata = {
  title: 'Topic Synthesis',
  description: 'Generate an interactive, scaffolded lesson from a topic.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionNav />
        {children}
      </body>
    </html>
  );
}
