import { getSessionIdentity } from './require-session';
import { SignOutButton } from './sign-out-button';

/**
 * The session-aware top bar (server component): shows the signed-in email + sign-out when there is a
 * session, and nothing otherwise (so the sign-in page stays chromeless). A display read only — the
 * spend/read gates do their own authoritative, revocation-checked verification.
 */
export async function SessionNav() {
  const identity = await getSessionIdentity();
  if (!identity) return null;
  return (
    <header className="topbar">
      <span className="topbar__email">{identity.email}</span>
      <SignOutButton />
    </header>
  );
}
