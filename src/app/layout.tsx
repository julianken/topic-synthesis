import './globals.css';
import { Inter, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { SessionNav } from './auth/session-nav';
import { MorphReceiverGuard } from './lesson/[id]/morph-receiver-guard';

// Fonts are CHROME (DESIGN.md §Typography), loaded once here at the app boundary — the only place
// next/font runs. `display: 'swap'` keeps text visible during load (FOUT over FOIT) and next/font
// self-hosts the files + emits a size-adjusted system fallback, so the swap doesn't reflow (CLS).
// Each exposes a CSS variable that the §0 `--sans` / `--mono` stacks in globals.css lead with.
// Inter is the Figma sans proxy for the §0 system-UI stack; JetBrains Mono is the loaded half of the
// SF-Mono/JetBrains-Mono mono split (it guarantees the mono voice on Linux / Cloud Run).
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
});

export const metadata = {
  title: 'Topic Synthesis',
  description: 'Generate an interactive, scaffolded lesson from a topic.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <head>
        {/*
          RECEIVER-GUARANTEE (TS-22, PR #143 review fix). Chrome's cross-document View-Transition spec is
          explicit that a `pagereveal` listener "needs to execute before the first rendering opportunity …
          you must register the listener in a classic parser-blocking script in the <head>". So the guard's
          inline registration script is emitted HERE, as a parser-blocking child of the document <head> —
          NOT (as the first pass did) in the reader page's <main> body, where it could race the first
          rendering opportunity and register too late to call skipTransition() on the box-absent path.

          It is mounted SITE-WIDE rather than reader-route-scoped on purpose: the `@view-transition`
          transport in globals.css is itself declared globally, so a cross-doc `pagereveal` can fire on ANY
          destination route, and the handler must already be listening. The handler self-gates by reading
          the live `#readerPanel.morph-box` — present only on the built reader branch (→ morph), absent
          everywhere else (→ instant-swap; AC4) — so a head-level mount needs no per-route prop and is the
          correct surface for the global transport. App Router owns <head> only in the root layout, so the
          parser-blocking-in-<head> requirement and reader-route-scoping cannot both be satisfied here; the
          site-wide self-gating mount is the deliberate resolution, not a residual race.
        */}
        <MorphReceiverGuard />
      </head>
      <body>
        <SessionNav />
        {children}
      </body>
    </html>
  );
}
