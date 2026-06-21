'use client';

import { type FirebaseApp, getApps, initializeApp } from 'firebase/app';
import { GoogleAuthProvider, getAuth, signInWithPopup } from 'firebase/auth';

// Public, browser-shipped config (NEXT_PUBLIC_* — the web API key is NOT a secret; it identifies the
// project, it does not authorize). The IdP itself enforces the Google-only + authorized-domains policy.
function firebaseConfig() {
  // `?? ''` keeps the type `string` (exactOptionalPropertyTypes rejects an explicit undefined); the
  // build inlines the real NEXT_PUBLIC_* values, and an empty key surfaces as a clear init error.
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  };
}

function app(): FirebaseApp {
  return getApps()[0] ?? initializeApp(firebaseConfig());
}

/**
 * Branded sign-in: open the Google consent popup (the one unavoidable external redirect) and return
 * the resulting Firebase ID token. The caller exchanges it for an httpOnly session cookie at
 * `/api/auth/session`; the raw ID token never persists client-side.
 */
export async function signInWithGoogle(): Promise<string> {
  const credential = await signInWithPopup(getAuth(app()), new GoogleAuthProvider());
  return credential.user.getIdToken();
}
