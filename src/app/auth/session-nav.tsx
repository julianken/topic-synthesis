import { getSessionIdentity } from './require-session';
import { SignOutButton } from './sign-out-button';

/**
 * The session-aware app header (server component) — the signed-in top-bar chrome of the Figma library
 * frame `6:2` (node `6:6`): a frosted bar with the two-tone `topic·synthesis` wordmark on the left and a
 * pill-shaped user chip (gradient avatar + the account name) on the right. Shown only when there is a
 * session (so the chromeless sign-in page stays bare). A display read only — the spend/read gates do
 * their own authoritative, revocation-checked verification.
 *
 * Scoped under `.appbar*` (the SHARED app chrome) — distinct from the `.library*` page-body scope and the
 * chromeless `.signin*` scope — so it frames both the library home and the reader route without leaking.
 * The user chip's hover/menu is the sign-out affordance, kept verbatim as `<SignOutButton>`.
 */
export async function SessionNav() {
  const identity = await getSessionIdentity();
  if (!identity) return null;
  // The chip shows a short display name; the avatar shows its first letter. Email is the only identity
  // string we hold, so derive a friendly name from its local part (never surface the raw address as the
  // primary label — the email stays available to the sign-out control's accessible context).
  const name = displayName(identity.email);
  const initial = (name[0] ?? '?').toUpperCase();
  return (
    <header className="appbar">
      <p className="appbar__wordmark">
        topic·<span className="appbar__wordmark-accent">synthesis</span>
      </p>
      <div className="appbar__chip">
        <span className="appbar__avatar" aria-hidden="true">
          {initial}
        </span>
        <span className="appbar__name">{name}</span>
        <SignOutButton />
      </div>
    </header>
  );
}

/** The friendly display name: the email's local part, trimmed of any +tag and dotted/underscored runs.
 *  Falls back to the whole string if there's no `@`. Pure — no I/O. */
function displayName(email: string): string {
  const local = email.includes('@') ? email.slice(0, email.indexOf('@')) : email;
  const base = local.split('+')[0] ?? local;
  return base.length > 0 ? base : email;
}
