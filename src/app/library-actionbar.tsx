'use client';

import { masterState } from './library-selection';
import { useLibrary } from './library-provider';
import { CheckboxGlyph } from './poster-mark';

/**
 * The library home's bottom ACTION BAR (issue #203) — mounted by `library-create.tsx`, shown ONLY while
 * selection mode is on AND at least one card is selected (AC9). Same bottom-center panel-reveal transport
 * family as the single/batch Undo snackbars (`library-snackbar.tsx` — a component-scoped
 * `--panel-translate-y`, never `:root`).
 *
 * Holds: the MASTER tri-state checkbox (`role="checkbox"`, `aria-checked` = `"false"`/`"mixed"`/`"true"`,
 * AC11 — toggling from non-all selects all up to the cap, from all clears, AC12), the live "{N} selected"
 * count, a quiet "Clear" control (AC13, empties the selection without leaving selection mode), and the
 * "Delete {N}" danger trigger (`.btn--danger` — status-as-foreground, `--err` text/outline over the bar's
 * panel surface, NEVER an `--err` fill, AC14). The trigger only REQUESTS deletion — `onRequestDelete` is
 * owned by the caller (`library-create.tsx`), which mounts the actual `<ConfirmModal>` and (post-close)
 * restores focus to a stable survivor (AC30) — this component has no opinion on that.
 */
export function LibraryActionBar({ onRequestDelete }: { onRequestDelete: () => void }) {
  const { selectionMode, selection, selectableCount, selectAll, clearSelection } = useLibrary();

  if (!selectionMode || selection.size === 0) return null;

  const count = selection.size;
  const state = masterState(count, selectableCount);
  const masterAriaChecked = state === 'mixed' ? 'mixed' : state === 'all' ? 'true' : 'false';

  return (
    <div className="library-actionbar">
      <button
        type="button"
        className="library-actionbar__master"
        role="checkbox"
        aria-checked={masterAriaChecked}
        aria-label="Select all"
        onClick={() => (state === 'all' ? clearSelection() : selectAll())}
      >
        <CheckboxGlyph state={state} />
        <span className="library-actionbar__master-label">Select all</span>
      </button>

      <span className="library-actionbar__count">
        {/* Number pop-in (transitions-dev §02), keyed on the count so it replays on every change. */}
        <span key={count} className="library-actionbar__count-value">
          {count}
        </span>{' '}
        selected
      </span>

      <button type="button" className="library-actionbar__clear" onClick={clearSelection}>
        Clear
      </button>

      <button type="button" className="btn btn--danger library-actionbar__delete" onClick={onRequestDelete}>
        Delete {count}
      </button>
    </div>
  );
}
