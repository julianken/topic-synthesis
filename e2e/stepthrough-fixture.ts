// stepthrough-fixture — a SCRIPTED SEQUENCE of mid-run `{ ready, steps, research }` status snapshots that
// drives the live-research GENERATING view through ALL SIX pipeline phases, one push at a time, for the
// step-through e2e (e2e/generating-stepthrough.spec.ts). The status poll (GET /api/lesson/[id]/status)
// is intercepted and fulfilled with the CURRENT snapshot; the spec advances a cursor between assertions and
// the page's next 2.5s poll lands the new state — so a single test STEPS through plan → research → brief →
// spec → code → critic → ready, re-querying the DOM + asserting after each push.
//
// REAL-SHAPED, never a UX lie: every snapshot mirrors a genuine `{ steps, research }` the route serves —
// `steps` (getStepEvents) carry per-stage timing; `research` (getResearchEvents, Stage 1 / #153) carry the
// planned questions + each question's grounded findings as they land. A `pending` research row carries NO
// findings (PgResearchSink inserts it status='pending' with NULL findings; onResearch only attaches them on
// the UPDATE to 'done'), so a question's findings appear ONLY once it flips done — exactly the live feed.
// Timestamps are FIXED + in the past so the frozen durations are stable; the single in-flight row's live
// timer is the one ticking cell (the spec waits on STATE, never the timer).

import type { StepEvent } from '../src/app/lesson/[id]/stage-rail';
import type { ResearchEvent } from '../src/store/repo';

/** A fixed clock so every frozen duration is stable run-to-run. */
const T0 = '2026-06-21T00:00:00.000Z';
const T = (ms: number): string => new Date(Date.parse(T0) + ms).toISOString();

/** The three research questions the plan decomposes the topic into (the fan-out width = 3, no overflow). */
const QUESTIONS: ReadonlyArray<{ q: string; sub: string; claim: string; url: string; title: string }> = [
  {
    q: 'Where does a plant’s mass come from?',
    sub: 'Carbon source',
    claim: 'A tree’s mass comes mostly from CO₂ in the air, not the soil.',
    url: 'https://www.britannica.com/science/photosynthesis',
    title: 'Britannica',
  },
  {
    q: 'Light reactions vs. the Calvin cycle?',
    sub: 'Two stages',
    claim: 'Photosynthesis splits water (H₂O) to release O₂.',
    url: 'https://www.nature.com/articles/photosynthesis',
    title: 'Nature',
  },
  {
    q: 'Chlorophyll’s role in capturing light?',
    sub: 'Pigments',
    claim: 'Chlorophyll absorbs red and blue light, reflecting green.',
    url: 'https://www.khanacademy.org/science/biology',
    title: 'Khan Academy',
  },
];

/** A step row builder. */
function step(name: string, key: string, startMs: number, endMs: number | null): StepEvent {
  return {
    name,
    stepKey: key,
    startedAt: T(startMs),
    finishedAt: endMs === null ? null : T(endMs),
    status: endMs === null ? 'running' : 'done',
  };
}

/** A `done` research row (its question landed with one grounded finding). */
function doneResearch(i: number, endMs: number): ResearchEvent {
  const r = QUESTIONS[i]!;
  return {
    question: r.q,
    subtopic: r.sub,
    status: 'done',
    findings: [{ claim: r.claim, url: r.url, title: r.title }],
    sources: [{ url: r.url, title: r.title }],
    findingCount: 1,
    startedAt: T(2100),
    finishedAt: T(endMs),
  } as unknown as ResearchEvent;
}

/** A `pending` (announced, not-yet-landed) research row — NO findings, like the real feed. */
function pendingResearch(i: number): ResearchEvent {
  const r = QUESTIONS[i]!;
  return {
    question: r.q,
    subtopic: r.sub,
    status: 'pending',
    findings: [],
    sources: [],
    findingCount: null,
    startedAt: T(2100),
    finishedAt: null,
  } as unknown as ResearchEvent;
}

/** One scripted snapshot: the payload the status route returns + a stable label for the film strip. */
export interface StepSnapshot {
  /** A short kebab name used in the screenshot filename + the assertion ledger. */
  name: string;
  /** Which phase column should be ACTIVE (running) at this snapshot — '' once ready. */
  activePhase: '' | 'plan' | 'research' | 'brief' | 'spec' | 'code' | 'critic';
  /** Per-phase expected cell state, for the column-state assertion. */
  phaseStates: Record<'plan' | 'research' | 'brief' | 'spec' | 'code' | 'critic', 'ran' | 'running' | 'pending'>;
  /** How many research findings (done questions) should be visible in the band. */
  findingsLanded: number;
  /** The expected "N / M extracted" count text. */
  extractedText: string;
  /** The status payload (without the id, which the spec prepends). */
  payload: { ready: boolean; steps: StepEvent[]; research: ResearchEvent[] };
}

// The seven scripted snapshots, in pipeline order. Each is a genuine mid-run shape.
const PS = {
  plan: 'plan',
  research: 'research',
  brief: 'brief',
  spec: 'spec',
  code: 'code',
  critic: 'critic',
} as const;

type PhaseStates = StepSnapshot['phaseStates'];
const states = (o: Partial<PhaseStates>): PhaseStates => ({
  plan: 'pending',
  research: 'pending',
  brief: 'pending',
  spec: 'pending',
  code: 'pending',
  critic: 'pending',
  ...o,
});

export const STEP_SEQUENCE: ReadonlyArray<StepSnapshot> = [
  // 1) PLAN running — decomposing the topic; no research rows yet.
  {
    name: 'plan-running',
    activePhase: 'plan',
    phaseStates: states({ plan: 'running' }),
    findingsLanded: 0,
    extractedText: '0 / 0 extracted',
    payload: { ready: false, steps: [step(PS.plan, 'plan:k', 0, null)], research: [] },
  },
  // 2) PLAN done, RESEARCH running — the three questions appear as pending nodes (the fan-out is announced).
  {
    name: 'research-running-questions',
    activePhase: 'research',
    phaseStates: states({ plan: 'ran', research: 'running' }),
    findingsLanded: 0,
    extractedText: '0 / 3 extracted',
    payload: {
      ready: false,
      steps: [
        step(PS.plan, 'plan:k', 0, 2100),
        step(PS.research, 'research:a', 2100, null),
        step(PS.research, 'research:b', 2100, null),
        step(PS.research, 'research:c', 2100, null),
      ],
      research: [pendingResearch(0), pendingResearch(1), pendingResearch(2)],
    },
  },
  // 3) RESEARCH findings landing — first question done (1 finding in the band), two still extracting.
  {
    name: 'research-finding-1',
    activePhase: 'research',
    phaseStates: states({ plan: 'ran', research: 'running' }),
    findingsLanded: 1,
    extractedText: '1 / 3 extracted',
    payload: {
      ready: false,
      steps: [
        step(PS.plan, 'plan:k', 0, 2100),
        step(PS.research, 'research:a', 2100, 7400),
        step(PS.research, 'research:b', 2100, null),
        step(PS.research, 'research:c', 2100, null),
      ],
      research: [doneResearch(0, 7400), pendingResearch(1), pendingResearch(2)],
    },
  },
  // 4) RESEARCH findings landing — all three done; the phase completes, brief about to start.
  {
    name: 'research-findings-all',
    activePhase: 'research',
    phaseStates: states({ plan: 'ran', research: 'running' }),
    findingsLanded: 2,
    extractedText: '2 / 3 extracted',
    payload: {
      ready: false,
      steps: [
        step(PS.plan, 'plan:k', 0, 2100),
        step(PS.research, 'research:a', 2100, 7400),
        step(PS.research, 'research:b', 2100, 9200),
        step(PS.research, 'research:c', 2100, null),
      ],
      research: [doneResearch(0, 7400), doneResearch(1, 9200), pendingResearch(2)],
    },
  },
  // 5) BRIEF running — research all done (3/3), the brief is forming.
  {
    name: 'brief-running',
    activePhase: 'brief',
    phaseStates: states({ plan: 'ran', research: 'ran', brief: 'running' }),
    findingsLanded: 3,
    extractedText: '3 / 3 extracted',
    payload: {
      ready: false,
      steps: [
        step(PS.plan, 'plan:k', 0, 2100),
        step(PS.research, 'research:a', 2100, 7400),
        step(PS.research, 'research:b', 2100, 9200),
        step(PS.research, 'research:c', 2100, 10500),
        step(PS.brief, 'brief:k', 10500, null),
      ],
      research: [doneResearch(0, 7400), doneResearch(1, 9200), doneResearch(2, 10500)],
    },
  },
  // 6) SPEC running — brief done, the lesson spec is being emitted.
  {
    name: 'spec-running',
    activePhase: 'spec',
    phaseStates: states({ plan: 'ran', research: 'ran', brief: 'ran', spec: 'running' }),
    findingsLanded: 3,
    extractedText: '3 / 3 extracted',
    payload: {
      ready: false,
      steps: [
        step(PS.plan, 'plan:k', 0, 2100),
        step(PS.research, 'research:a', 2100, 7400),
        step(PS.research, 'research:b', 2100, 9200),
        step(PS.research, 'research:c', 2100, 10500),
        step(PS.brief, 'brief:k', 10500, 13800),
        step(PS.spec, 'spec:k', 13800, null),
      ],
      research: [doneResearch(0, 7400), doneResearch(1, 9200), doneResearch(2, 10500)],
    },
  },
  // 7) CODE running — spec done, the HTML lesson is being synthesized.
  {
    name: 'code-running',
    activePhase: 'code',
    phaseStates: states({ plan: 'ran', research: 'ran', brief: 'ran', spec: 'ran', code: 'running' }),
    findingsLanded: 3,
    extractedText: '3 / 3 extracted',
    payload: {
      ready: false,
      steps: [
        step(PS.plan, 'plan:k', 0, 2100),
        step(PS.research, 'research:a', 2100, 7400),
        step(PS.research, 'research:b', 2100, 9200),
        step(PS.research, 'research:c', 2100, 10500),
        step(PS.brief, 'brief:k', 10500, 13800),
        step(PS.spec, 'spec:k', 13800, 21000),
        step(PS.code, 'code:k', 21000, null),
      ],
      research: [doneResearch(0, 7400), doneResearch(1, 9200), doneResearch(2, 10500)],
    },
  },
  // 8) CRITIC running — code done, the lesson is being graded.
  {
    name: 'critic-running',
    activePhase: 'critic',
    phaseStates: states({
      plan: 'ran',
      research: 'ran',
      brief: 'ran',
      spec: 'ran',
      code: 'ran',
      critic: 'running',
    }),
    findingsLanded: 3,
    extractedText: '3 / 3 extracted',
    payload: {
      ready: false,
      steps: [
        step(PS.plan, 'plan:k', 0, 2100),
        step(PS.research, 'research:a', 2100, 7400),
        step(PS.research, 'research:b', 2100, 9200),
        step(PS.research, 'research:c', 2100, 10500),
        step(PS.brief, 'brief:k', 10500, 13800),
        step(PS.spec, 'spec:k', 13800, 21000),
        step(PS.code, 'code:k', 21000, 33000),
        step(PS.critic, 'critic:k', 33000, null),
      ],
      research: [doneResearch(0, 7400), doneResearch(1, 9200), doneResearch(2, 10500)],
    },
  },
] as const;

/** The terminal `ready: true` snapshot — every phase done; the poller navigates / refreshes on this. */
export const READY_SNAPSHOT: StepSnapshot = {
  name: 'ready',
  activePhase: '',
  phaseStates: states({
    plan: 'ran',
    research: 'ran',
    brief: 'ran',
    spec: 'ran',
    code: 'ran',
    critic: 'ran',
  }),
  findingsLanded: 3,
  extractedText: '3 / 3 extracted',
  payload: {
    ready: true,
    steps: [
      step(PS.plan, 'plan:k', 0, 2100),
      step(PS.research, 'research:a', 2100, 7400),
      step(PS.research, 'research:b', 2100, 9200),
      step(PS.research, 'research:c', 2100, 10500),
      step(PS.brief, 'brief:k', 10500, 13800),
      step(PS.spec, 'spec:k', 13800, 21000),
      step(PS.code, 'code:k', 21000, 33000),
      step(PS.critic, 'critic:k', 33000, 41000),
    ],
    research: [doneResearch(0, 7400), doneResearch(1, 9200), doneResearch(2, 10500)],
  },
};

// ── A STRESS payload (N=9) for the states+edge spec: the research column caps at 3 visible + a "+6 below"
//    chip, and the overflow sinks into the band as queued cards. Three done findings, six pending. ────────
const STRESS_QUESTIONS = [
  ...QUESTIONS,
  { q: 'What limits the rate of photosynthesis?', sub: 'Rate limits' },
  { q: 'C3 vs C4 vs CAM pathways?', sub: 'Pathways' },
  { q: 'How is glucose stored and used?', sub: 'Storage' },
  { q: 'Photosynthesis vs cellular respiration?', sub: 'Contrast' },
  { q: 'The role of the thylakoid membrane?', sub: 'Structure' },
  { q: 'How do stomata regulate gas exchange?', sub: 'Stomata' },
];

export const STRESS_PAYLOAD = {
  ready: false,
  steps: [
    step(PS.plan, 'plan:k', 0, 2100),
    step(PS.research, 'research:a', 2100, 7400),
    step(PS.research, 'research:b', 2100, 9200),
    step(PS.research, 'research:c', 2100, 10500),
    step(PS.research, 'research:d', 2100, null),
  ],
  research: STRESS_QUESTIONS.map((r, i): ResearchEvent => {
    const done = i < 3;
    const q = QUESTIONS[i];
    return {
      question: r.q,
      subtopic: r.sub,
      status: done ? 'done' : 'pending',
      findings: done && q ? [{ claim: q.claim, url: q.url, title: q.title }] : [],
      sources: done && q ? [{ url: q.url, title: q.title }] : [],
      findingCount: done ? 1 : null,
      startedAt: T(2100),
      finishedAt: done ? T(7400 + i * 700) : null,
    } as unknown as ResearchEvent;
  }),
};
