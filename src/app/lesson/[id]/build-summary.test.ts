import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildSummaryModel, formatWholeSeconds, LEARNER_LABEL } from './build-summary';
import { BuildSummaryView } from './build-summary-view';
import type { StepEvent } from './stage-rail';

// build-summary.test — the owner-only "How this was built" disclosure (issue #175, epic PR-5). Tests the
// PURE model (`buildSummaryModel`) in vitest's `environment: 'node'`, then string-renders the sync view
// via `react-dom/server` (no DOM/jsdom needed) to pin the COPY-GATE over the REAL rendered output. The
// async DB wrapper + the owner-gate (co-location under page.tsx's getLesson filter) are exercised by the
// Playwright e2e (`e2e/lesson-build-summary.spec.ts`).

/** Build a step_event row (ISO strings, as `getStepEvents` returns). */
function ev(name: string, startMs: number, endMs: number | null, status = 'done'): StepEvent {
  const iso = (ms: number) => new Date(Date.UTC(2026, 5, 21, 0, 0, 0, 0) + ms).toISOString();
  return {
    name,
    stepKey: `${name}-k`,
    startedAt: iso(startMs),
    finishedAt: endMs === null ? null : iso(endMs),
    status,
  };
}

// A COMPLETE built run: six stages, plan→critic spanning exactly 47.0s, with realistic per-step durations.
const BUILT_EVENTS: StepEvent[] = [
  ev('plan', 0, 2_100),
  ev('research', 2_100, 13_500),
  ev('brief', 13_500, 15_600),
  ev('spec', 15_600, 20_600),
  ev('code', 20_600, 44_000),
  ev('critic', 44_000, 47_000),
];

// The raw engine stage names that must NEVER reach this reading surface (the no-project-internals rule).
const RAW_STAGE_NAMES = ['plan', 'research', 'brief', 'spec', 'code', 'critic'];

describe('formatWholeSeconds', () => {
  it('rounds to whole seconds with an "s" suffix and never emits "ms"', () => {
    expect(formatWholeSeconds(47_000)).toBe('47s');
    expect(formatWholeSeconds(2_400)).toBe('2s');
    expect(formatWholeSeconds(-5)).toBe('0s'); // clamped, never negative
    expect(formatWholeSeconds(47_000)).not.toMatch(/ms/);
  });
});

describe('buildSummaryModel — a complete BUILT run', () => {
  const model = buildSummaryModel(BUILT_EVENTS, 'built')!;

  it('returns a model with the built headline, the wall-clock span, the step count, and a ✓ passed verdict', () => {
    expect(model).not.toBeNull();
    expect(model.disposition).toBe('built');
    expect(model.headline).toBe('How this was built');
    // wall-clock span = latest finish − earliest start = 47.0s → "47s"; six real stages → "6 steps".
    expect(model.metaParts).toEqual(['built in 47s', '6 steps']);
    expect(model.verdictGlyph).toBe('✓');
    expect(model.verdictWord).toBe('passed');
  });

  it('renders the FROZEN six-stage rail with learner-safe labels + frozen per-step durations, all done', () => {
    expect(model.rows).toHaveLength(6);
    expect(model.rows.map((r) => r.label)).toEqual([
      'Planning',
      'Researching',
      'Drafting',
      'Designing',
      'Building',
      'Reviewing',
    ]);
    // every stage ran → ✓ done with a frozen one-decimal duration (no live timer on a persisted run).
    for (const row of model.rows) {
      expect(row.state).toBe('done');
      expect(row.glyph).toBe('✓');
      expect(row.word).toBe('done');
      expect(row.duration).toMatch(/^\d+\.\d+s$/);
    }
    expect(model.rows[0]?.duration).toBe('2.1s'); // plan
    expect(model.rows[4]?.duration).toBe('23.4s'); // code
  });

  it('the learner labels are NOT the raw stage names (the no-project-internals map)', () => {
    expect(LEARNER_LABEL.brief).toBe('Drafting'); // never "brief"/"Briefing"
    expect(LEARNER_LABEL.spec).toBe('Designing'); // never "spec"
    expect(LEARNER_LABEL.critic).toBe('Reviewing'); // never "critic"
    expect(LEARNER_LABEL.code).toBe('Building'); // never "code"
  });
});

describe('buildSummaryModel — the THREE-WAY disposition (AC5 / issue #215)', () => {
  // The thrown-`code` timeline — synthesis errored, no artifact → FAILED (soon + null html in the read).
  const FAILED_EVENTS: StepEvent[] = [
    ev('plan', 0, 2_000),
    ev('research', 2_000, 12_000),
    ev('brief', 12_000, 14_000),
    ev('spec', 14_000, 19_000),
    ev('code', 19_000, null, 'error'), // threw — no finish
  ];

  it('(a) FAILED — a THROWN step (status="error") shows that STAGE ✗ under a "couldn\'t finish · ✗ not built" summary', () => {
    // code threw and never finished; critic never ran. The disposition is `failed` (no artifact produced);
    // the code ROW carries the per-stage ✗ (a real error), and the summary verdict ✗ reflects the lesson
    // didn't build. The honest "couldn't finish" framing is RETAINED for failed (it is true here).
    const model = buildSummaryModel(FAILED_EVENTS, 'failed')!;
    expect(model.disposition).toBe('failed');
    expect(model.headline).toBe('See what happened');
    expect(model.metaParts).toEqual(["couldn't finish"]); // no duration/step-count on the degraded summary
    expect(model.verdictGlyph).toBe('✗');
    expect(model.verdictWord).toBe('not built');

    const code = model.rows.find((r) => r.name === 'code')!;
    expect(code.state).toBe('error');
    expect(code.glyph).toBe('✗');
    expect(code.word).toBe("didn't finish");

    // critic never ran → it shows as "didn't run", NOT a ✗ (only a real throw is a ✗).
    const critic = model.rows.find((r) => r.name === 'critic')!;
    expect(critic.state).toBe('pending');
    expect(critic.glyph).toBe('—');
    expect(critic.word).toBe("didn't run");
  });

  it('(b) HELD — a GRACEFUL critic reject (every step done, no throw) reads HONESTLY: all-✓ rail, "held back · not published", NEVER "couldn\'t finish"', () => {
    // The artifact rendered (67 KB, finishReason 'stop') and was cleanly REJECTED by the reviewer — every
    // step returned without throwing, so the rail is all-✓ and the disposition is `held` (soon + html
    // present in the read). The old code conflated this with `failed` and printed "couldn't finish · not
    // built" against an all-✓ rail (the incident this issue fixes). Now it tells the truth.
    const model = buildSummaryModel(BUILT_EVENTS, 'held')!;
    expect(model.disposition).toBe('held');
    expect(model.headline).toBe('See what happened');
    expect(model.metaParts).toEqual(['held back for review']);
    expect(model.verdictGlyph).toBe('✗'); // the lesson didn't build (status soon) — consistent with DESIGN.md
    expect(model.verdictWord).toBe('not published');

    // THE NON-CONTRADICTION (AC "the all-✓ rail and a held header are no longer contradictory"): every row
    // is ✓ done (no thrown stage), and the header NEVER claims the process "couldn't finish".
    expect(model.rows.every((r) => r.state === 'done' && r.glyph === '✓')).toBe(true);
    expect(model.metaParts).not.toContain("couldn't finish");
    expect(model.verdictWord).not.toBe('not built');
  });

  it('(c) held vs failed are DISTINCT copy (the core #215 distinction) — same all-✓ timeline, different honest verdict', () => {
    const held = buildSummaryModel(BUILT_EVENTS, 'held')!;
    const failed = buildSummaryModel(BUILT_EVENTS, 'failed')!;
    // Both are non-built ("degraded"), but their learner-facing copy differs — held was held back, failed
    // couldn't be produced. A reader must not see the same words for the two.
    expect(held.metaParts).not.toEqual(failed.metaParts);
    expect(held.verdictWord).not.toBe(failed.verdictWord);
    expect(held.metaParts).toEqual(['held back for review']);
    expect(failed.metaParts).toEqual(["couldn't finish"]);
  });
});

describe('buildSummaryModel — nothing to disclose', () => {
  it('returns null for a run with NO recorded steps (a legacy/blob lesson)', () => {
    expect(buildSummaryModel([], 'built')).toBeNull();
  });

  it('returns null when only the dispatch marker is present (it is not a rail stage)', () => {
    // The dispatch marker rides step_event and survives persist, but it is not a STAGE_RAIL position, so
    // deriveRail ignores it → no real stage ran → nothing to disclose.
    expect(buildSummaryModel([ev('dispatch', 0, 0, 'dispatched')], 'built')).toBeNull();
  });
});

describe('COPY-GATE — the rendered disclosure leaks NO project internals (AC3)', () => {
  // Render the REAL sync view to a static HTML string (no DOM needed) and scan it. The constraint: a
  // reading surface shows learner-safe stage WORDS only and NO token/cost/model/ms/TTFT — ever.
  const render = (events: StepEvent[], disposition: 'built' | 'held' | 'failed') =>
    renderToStaticMarkup(createElement(BuildSummaryView, { model: buildSummaryModel(events, disposition)! }));

  const THROWN_EVENTS: StepEvent[] = [
    ev('plan', 0, 2_000), ev('research', 2_000, 12_000), ev('brief', 12_000, 14_000), ev('spec', 14_000, 19_000), ev('code', 19_000, null, 'error'),
  ];
  const BUILT_HTML = render(BUILT_EVENTS, 'built');
  const HELD_HTML = render(BUILT_EVENTS, 'held'); // critic-reject: all-✓ rail, honest "held back" summary
  const FAILED_HTML = render(THROWN_EVENTS, 'failed'); // synthesis-exception: per-stage ✗, "couldn't finish"
  const ALL_HTML = [BUILT_HTML, HELD_HTML, FAILED_HTML];

  it('renders a native <details>/<summary> (the disclosure) on every branch', () => {
    for (const html of ALL_HTML) {
      expect(html).toContain('<details');
      expect(html).toContain('<summary');
      expect(html).toContain('build-summary');
    }
  });

  it('exposes the precise disposition on the disclosure element (data-disposition)', () => {
    expect(BUILT_HTML).toContain('data-disposition="built"');
    expect(HELD_HTML).toContain('data-disposition="held"');
    expect(FAILED_HTML).toContain('data-disposition="failed"');
    // The existing CSS hook stays: held/failed are the "degraded" branch, built is not.
    expect(HELD_HTML).toContain('data-degraded');
    expect(FAILED_HTML).toContain('data-degraded');
    expect(BUILT_HTML).not.toContain('data-degraded');
  });

  it('contains NO raw engine stage name (plan/research/brief/spec/code/critic) as a word', () => {
    for (const html of ALL_HTML) {
      for (const raw of RAW_STAGE_NAMES) {
        // Word-boundary match: "Planning"/"Researching" (the learner words) must NOT trip — only the raw
        // lowercase identifier as a standalone token would. A leak (e.g. the lowercase `stage.name` the
        // LIVE progress bar uses) trips this.
        expect(html, `raw stage name "${raw}" leaked into the rendered disclosure`).not.toMatch(
          new RegExp(`\\b${raw}\\b`, 'i'),
        );
      }
    }
  });

  it('contains NO token/cost/model/TTFT/ms readout (timeline-only)', () => {
    for (const html of ALL_HTML) {
      expect(html).not.toMatch(/\btokens?\b/i);
      expect(html).not.toMatch(/\bcost\b/i);
      expect(html).not.toMatch(/\bmodel\b/i);
      expect(html).not.toMatch(/\bttft\b/i);
      expect(html).not.toMatch(/\$/); // no dollar cost
      expect(html).not.toMatch(/\bhaiku\b|\bsonnet\b|\bopus\b|\bgpt\b|\bgemini\b|\bclaude\b/i); // no model id
      expect(html).not.toMatch(/\d\s*ms\b/i); // no millisecond readout (durations are whole/decimal seconds)
    }
  });

  it('shows learner-safe labels + the timeline (durations in seconds) on the built branch', () => {
    expect(BUILT_HTML).toContain('How this was built');
    expect(BUILT_HTML).toContain('Planning');
    expect(BUILT_HTML).toContain('Reviewing');
    expect(BUILT_HTML).toContain('2.1s'); // a frozen per-step duration
    expect(BUILT_HTML).toContain('47s'); // the whole-second wall-clock span
    expect(BUILT_HTML).toContain('passed');
  });

  it('HELD reads honestly — "held back" + "not published", NEVER "couldn\'t finish"/"not built" (issue #215)', () => {
    expect(HELD_HTML).toContain('See what happened');
    expect(HELD_HTML).toContain('held back for review');
    expect(HELD_HTML).toContain('not published');
    // The all-✓ rail must NOT be contradicted by a "couldn't finish" / "not built" header.
    expect(HELD_HTML).not.toMatch(/couldn(?:&#x27;|&#39;|')t finish/);
    expect(HELD_HTML).not.toContain('not built');
    // Every rail row is ✓ done (no per-stage ✗ on a graceful hold) — the verdict ✗ is the lone summary mark.
    expect(HELD_HTML).not.toMatch(/didn(?:&#x27;|&#39;|')t finish/);
  });

  it('FAILED surfaces the degraded summary + the per-stage ✗ on the thrown-step branch', () => {
    expect(FAILED_HTML).toContain('See what happened');
    // react-dom escapes the apostrophe to an HTML entity; match tolerantly (the visible text is correct).
    expect(FAILED_HTML).toMatch(/couldn(?:&#x27;|&#39;|')t finish/);
    expect(FAILED_HTML).toContain('not built');
    expect(FAILED_HTML).toContain('✗'); // the errored stage's glyph
    expect(FAILED_HTML).toMatch(/didn(?:&#x27;|&#39;|')t finish/); // its state word (status by label + icon)
  });
});
