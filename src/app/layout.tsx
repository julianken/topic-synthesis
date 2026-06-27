import './globals.css';
import type { ReactNode } from 'react';
import { SessionNav } from './auth/session-nav';
import { MorphReceiverGuard } from './curriculum/[id]/morph-receiver-guard'; // concept-drift-ok: retained route identifier (ADR-0003 deferred rename)

export const metadata = {
  title: 'Topic Synthesis',
  description: 'Generate an interactive, scaffolded lesson from a topic.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
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
