// The owner allowlist (ADR 0002 §5). LOAD-BEARING: email_verified alone is open registration on a
// money endpoint (any throwaway Google account passes), so spend + private access also require the
// caller's `sub` to be explicitly allowlisted. Keyed by the stable Google `sub`, never the mutable
// email. Sourced from AUTH_ALLOWLIST (comma-separated subs); an empty list allows NO ONE (fail-closed).

export function allowedSubs(): ReadonlySet<string> {
  return new Set(
    (process.env.AUTH_ALLOWLIST ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

export function isAllowed(sub: string): boolean {
  return allowedSubs().has(sub);
}
