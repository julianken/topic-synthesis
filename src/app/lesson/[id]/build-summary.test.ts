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
  const model = buildSummaryModel(BUILT_EVENTS, false)!;

  it('returns a model with the built headline, the wall-clock span, the step count, and a ✓ passed verdict', () => {
    expect(model).not.toBeNull();
    expect(model.degraded).toBe(false);
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

describe('buildSummaryModel — the TWO degradation kinds (AC5)', () => {
  it('(a) a THROWN step (status="error") shows that STAGE with a ✗ under a "not built" summary', () => {
    // code threw and never finished; critic never ran. The summary is degraded; the code ROW carries the
    // per-stage ✗ (a real error), while the summary verdict ✗ reflects the lesson didn't build.
    const events: StepEvent[] = [
      ev('plan', 0, 2_000),
      ev('research', 2_000, 12_000),
      ev('brief', 12_000, 14_000),
      ev('spec', 14_000, 19_000),
      ev('code', 19_000, null, 'error'), // threw — no finish
    ];
    const model = buildSummaryModel(events, true)!;
    expect(model.degraded).toBe(true);
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

  it('(b) a GRACEFUL degrade (critic vapid / coverage — no throw) shows ALL steps done under a degraded summary', () => {
    // Every step finished normally (the critic returned passed:false, or coverage routed to soon) — there
    // is NO errored stage, so the rail shows all ✓; only the SUMMARY says the lesson wasn't built.
    const model = buildSummaryModel(BUILT_EVENTS, true)!;
    expect(model.degraded).toBe(true);
    expect(model.verdictGlyph).toBe('✗');
    expect(model.verdictWord).toBe('not built');
    // no per-stage ✗ — every row is done (the key AC5(b) distinction from the thrown-step case above).
    expect(model.rows.every((r) => r.state === 'done' && r.glyph === '✓')).toBe(true);
  });
});

describe('buildSummaryModel — nothing to disclose', () => {
  it('returns null for a run with NO recorded steps (a legacy/blob lesson)', () => {
    expect(buildSummaryModel([], false)).toBeNull();
  });

  it('returns null when only the dispatch marker is present (it is not a rail stage)', () => {
    // The dispatch marker rides step_event and survives persist, but it is not a STAGE_RAIL position, so
    // deriveRail ignores it → no real stage ran → nothing to disclose.
    expect(buildSummaryModel([ev('dispatch', 0, 0, 'dispatched')], false)).toBeNull();
  });
});

describe('COPY-GATE — the rendered disclosure leaks NO project internals (AC3)', () => {
  // Render the REAL sync view to a static HTML string (no DOM needed) and scan it. The constraint: a
  // reading surface shows learner-safe stage WORDS only and NO token/cost/model/ms/TTFT — ever.
  const render = (events: StepEvent[], degraded: boolean) =>
    renderToStaticMarkup(createElement(BuildSummaryView, { model: buildSummaryModel(events, degraded)! }));

  const BUILT_HTML = render(BUILT_EVENTS, false);
  const DEGRADED_HTML = render(
    [ev('plan', 0, 2_000), ev('research', 2_000, 12_000), ev('brief', 12_000, 14_000), ev('spec', 14_000, 19_000), ev('code', 19_000, null, 'error')],
    true,
  );

  it('renders a native <details>/<summary> (the disclosure) on both branches', () => {
    for (const html of [BUILT_HTML, DEGRADED_HTML]) {
      expect(html).toContain('<details');
      expect(html).toContain('<summary');
      expect(html).toContain('build-summary');
    }
  });

  it('contains NO raw engine stage name (plan/research/brief/spec/code/critic) as a word', () => {
    for (const html of [BUILT_HTML, DEGRADED_HTML]) {
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
    for (const html of [BUILT_HTML, DEGRADED_HTML]) {
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

  it('surfaces the degraded summary + the per-stage ✗ on the thrown-step branch', () => {
    expect(DEGRADED_HTML).toContain('See what happened');
    // react-dom escapes the apostrophe to an HTML entity; match tolerantly (the visible text is correct).
    expect(DEGRADED_HTML).toMatch(/couldn(?:&#x27;|&#39;|')t finish/);
    expect(DEGRADED_HTML).toContain('not built');
    expect(DEGRADED_HTML).toContain('✗'); // the errored stage's glyph
    expect(DEGRADED_HTML).toMatch(/didn(?:&#x27;|&#39;|')t finish/); // its state word (status by label + icon)
  });
});
