/**
 * The create-form flow's MOTION guard + shared `view-transition-name` constants (the library `/` create
 * flow). The pure, node-testable core of the `+New card → intake form` container-transform and the
 * `form → in-place generating shell` chrome-to-chrome handoff — mirroring the discipline of the shipped
 * card→reader `reader-morph-guard.ts`: a pure capability+preference gate + value-locked name constants in
 * a `.ts` module (NOT the `.tsx` island), so it unit-tests under vitest's `environment: 'node'` with no
 * DOM and the names cannot drift into a static CSS leak.
 *
 * Unlike the card→reader morph (a CROSS-document VT the browser runs automatically from a plain-anchor
 * navigation, gated declaratively in `globals.css`), this flow is a SAME-document `document.start
 * ViewTransition` — both endpoints are first-party chrome on the one `/` route — so it is SCRIPTED and
 * must be gated in JS before the call. {@link vtOff} is that gate; {@link runViewTransition} is the honest
 * instant-swap floor around it.
 *
 * TRUST BOUNDARY (unchanged): every export here is a pure decision over capability + preference, or a thin
 * wrapper that runs a caller-supplied DOM-update callback inside a View-Transition. NOTHING here reads or
 * mutates the opaque-origin lesson iframe, its sandbox, or the artifact CSP — this flow lives entirely on
 * the library `/` chrome and never touches the reader's iframe boundary.
 */

/**
 * The shared `view-transition-name` the `+New` card (FLIP origin) and the intake form (FLIP destination)
 * BOTH carry so the same-document VT pairs their box snapshots and grows the card geometry into the form.
 * Set inline on both endpoints (never a static CSS rule) — paired with the `.morph-box` class, exactly as
 * the reader morph pairs `morphName(id)` + `.morph-box`. Reused in reverse on close (form → `+New` card).
 */
export const NEW_SURFACE_NAME = 'new-surface';

/**
 * The shared `view-transition-name` the typed topic TEXT carries across the submit handoff: the form's
 * topic value (OLD side, a positioned text-twin span) and the in-place generating shell's header (NEW
 * side) both carry it, so the user's typed topic is a single continuous element bridging the two screens
 * — it morphs from the field into "what is being built" rather than cross-fading. Set inline on both
 * endpoints around the `begin-generate` transition, then cleared.
 */
export const SPECIMEN_TOPIC_NAME = 'specimen-topic';

/**
 * The typed View-Transition `type` for the submit handoff. The typed-root CSS in `globals.css`
 * (`html:active-view-transition-type(begin-generate) ::view-transition-old(root){animation:vt-recede}`)
 * keys the form-recedes choreography to this type, so it runs ONLY on the submit handoff — not on the
 * open/close card↔form morph.
 */
export const BEGIN_GENERATE_TYPE = 'begin-generate';

/** The minimal `window`-shaped capability surface this module probes (so it stubs cleanly in node). */
export interface ViewTransitionCapability {
  document?: { startViewTransition?: unknown } | undefined;
  matchMedia?: ((query: string) => { matches: boolean }) | undefined;
}

/**
 * PREFERENCE GATE: does the user prefer reduced motion (`prefers-reduced-motion: reduce`)? Returns `false`
 * when `matchMedia` is unavailable (a non-browser / very old engine) — the conservative "no preference"
 * default; {@link vtOff} still skips the transition on such an engine via the capability gate when the VT
 * API is also absent. Pure: reads only the supplied matcher (default the live global `matchMedia`).
 */
export function prefersReducedMotion(
  matcher: ((query: string) => { matches: boolean }) | undefined = typeof globalThis.matchMedia === 'function'
    ? globalThis.matchMedia.bind(globalThis)
    : undefined,
): boolean {
  if (typeof matcher !== 'function') return false;
  return matcher('(prefers-reduced-motion: reduce)').matches;
}

/**
 * CAPABILITY GATE: does this browser expose the (same-document) View-Transition API at all? The scripted
 * `document.startViewTransition` must exist for this flow's open/close/submit morphs to run. Takes the
 * global as an arg (default `globalThis`) so it unit-tests with a stub in `environment: 'node'`.
 */
export function supportsViewTransitions(win: ViewTransitionCapability = globalThis): boolean {
  return typeof win.document?.startViewTransition === 'function';
}

/**
 * The single gate every scripted `document.startViewTransition` in this flow checks FIRST: skip the
 * transition entirely (mutate synchronously / instant-swap) when EITHER the user prefers reduced motion
 * OR the browser has no View-Transition API. Mirrors the scratch prototype's `vtOff()` =
 * `reduceNow() || noVT` and the reader morph's three-way degrade-to-instant rule, collapsed to this
 * flow's two inputs (the receiver-box gate is N/A — both endpoints are same-document first-party chrome).
 *
 * Pure: reads only its (defaulted, stub-able) capability surface. Returns `true` ⇒ "View-Transitions are
 * OFF, do the update synchronously"; `false` ⇒ "run the morph".
 */
export function vtOff(win: ViewTransitionCapability = globalThis): boolean {
  if (!supportsViewTransitions(win)) return true; // no API → instant-swap.
  if (prefersReducedMotion(win.matchMedia)) return true; // honor the preference → no morph.
  return false; // API present + motion allowed → run the View-Transition.
}

/** A minimal View-Transition handle (just what {@link runViewTransition} awaits). */
interface ViewTransitionHandle {
  finished: Promise<unknown>;
}

/**
 * Run `update` (the DOM mutation that swaps one view for the next) inside a same-document View-Transition,
 * with an HONEST instant-swap floor: when {@link vtOff} holds (reduced motion or no VT API), it calls
 * `update()` SYNCHRONOUSLY and resolves immediately — the swap is instant, no morph, no recede — exactly
 * the reduced-motion floor the spec requires. Otherwise it calls `document.startViewTransition({ update,
 * types })` (falling back to the positional form on an engine without the typed overload) and resolves
 * when the transition has finished (swallowing the AbortError a superseded transition rejects with, so a
 * rapid open→close never throws).
 *
 * The `win` capability surface is injectable so the floor + the call path both unit-test in node. Returns
 * a promise that resolves AFTER the update has applied (instantly on the floor, on `finished` otherwise),
 * so the caller can run post-commit work (focus the topic input, stagger the fields, clear the inline VT
 * names) in `.then(...)`.
 */
export function runViewTransition(
  update: () => void,
  types: string[],
  win: ViewTransitionCapability & {
    document?: {
      startViewTransition?: (arg: unknown) => ViewTransitionHandle;
    };
  } = globalThis as never,
): Promise<void> {
  if (vtOff(win)) {
    update();
    return Promise.resolve();
  }
  const start = win.document?.startViewTransition;
  if (typeof start !== 'function') {
    // Defensive: vtOff said supported, but the handle isn't callable — fall back to instant-swap.
    update();
    return Promise.resolve();
  }
  let transition: ViewTransitionHandle;
  try {
    transition = start.call(win.document, { update, types });
  } catch {
    // An engine with startViewTransition but no typed-overload object form: the positional callback form.
    transition = start.call(win.document, update);
  }
  return transition.finished.then(
    () => undefined,
    () => undefined, // a superseded/aborted transition rejects with AbortError — not an error to surface.
  );
}
