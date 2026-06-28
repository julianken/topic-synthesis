// A DETERMINISTIC mid-run status payload for the live-research GENERATING view (Figma 1:2) — the exact
// shape `GET /api/curriculum/[id]/status` returns ({ ready, steps, research }). The visual spec (and the
// /tmp render script) intercept the status poll with THIS payload so the captured node-graph + LIVE
// RESEARCH panel are byte-stable, with NO live pipeline and NO model spend.
//
// REAL-SHAPED, never a UX lie: it mirrors a genuine mid-run snapshot — plan done, two research questions
// answered with grounded findings, a third still extracting, brief forming — exactly what the Stage-1
// feed (#153) emits. The timestamps are FIXED and in the PAST so the rail's frozen durations are stable
// (the in-flight `research` row has no finishedAt → a live timer, which the spec captures under
// `animations: 'disabled'` at a frozen value; the visual tolerance absorbs the single ticking cell).

// A fixed clock so the rail's plan duration is a stable "2.1s" etc. All times are ISO strings (the poll's
// contract). The base is arbitrary but FIXED.
const T0 = '2026-06-21T00:00:00.000Z';
const T = (ms: number): string => new Date(Date.parse(T0) + ms).toISOString();

export const GENERATING_STATUS_PAYLOAD = {
  ready: false,
  steps: [
    { name: 'plan', stepKey: 'plan:k', startedAt: T(0), finishedAt: T(2100), status: 'done' },
    // The research fan-out: three concurrent rows, two finished + one still running (the phase is running).
    { name: 'research', stepKey: 'research:a', startedAt: T(2100), finishedAt: T(7400), status: 'done' },
    { name: 'research', stepKey: 'research:b', startedAt: T(2100), finishedAt: T(9200), status: 'done' },
    { name: 'research', stepKey: 'research:c', startedAt: T(2100), finishedAt: null, status: 'running' },
  ],
  research: [
    {
      question: 'Where does a plant’s mass come from?',
      subtopic: 'Carbon source',
      status: 'done',
      findings: [
        {
          claim: 'A tree’s mass comes mostly from CO₂ in the air, not the soil.',
          url: 'https://www.britannica.com/science/photosynthesis',
          title: 'Britannica',
        },
      ],
      sources: [{ url: 'https://www.britannica.com/science/photosynthesis', title: 'Britannica' }],
      findingCount: 1,
      startedAt: T(2100),
      finishedAt: T(7400),
    },
    {
      question: 'Light reactions vs. the Calvin cycle?',
      subtopic: 'Two stages',
      status: 'done',
      findings: [
        {
          claim: 'Photosynthesis splits water (H₂O) to release O₂.',
          url: 'https://www.nature.com/articles/photosynthesis',
          title: 'Nature',
        },
      ],
      sources: [{ url: 'https://www.nature.com/articles/photosynthesis', title: 'Nature' }],
      findingCount: 1,
      startedAt: T(2100),
      finishedAt: T(9200),
    },
    {
      // The in-flight question — REAL-shaped: a 'pending' row carries NO findings (PgResearchSink.onQuestions
      // INSERTs it as status='pending' with NULL findings; onResearch only attaches findings when it UPDATEs
      // the row to status='done'). So this row contributes ZERO ledger rows — the panel honestly shows 2/3
      // extracted with the two done findings, while the third research NODE still reads ⟳ "extracting claims…"
      // in the graph (the node keys off status, not findings). An "extracting from <host> …" finding line is a
      // shape the live feed can never emit; never fake it here.
      question: 'Chlorophyll’s role in capturing light?',
      subtopic: null,
      status: 'pending',
      findings: [],
      sources: [],
      findingCount: null,
      startedAt: T(2100),
      finishedAt: null,
    },
  ],
} as const;

// ── A STRESS payload (N=8) for the geometry/measurement spec (generating-geometry.spec.ts) ──────────────
// Same REAL shape as the N=3 payload, scaled to EIGHT research questions so the fit-math's OVERFLOW path
// is exercised against the BUILT app: at 1440×900 the Research column caps at 3 visible @ the floor height
// and the remaining 5 sink DOWN into the relocated band as queued cards (the "+5 below" chip). This is the
// case the geometry spec measures — the four SPEC §10 guarantees (column-lock, research margins, spine
// uniformity, edge anchors) must hold WITH the overflow chip reserved inside the column budget. The first
// three rows are `done` (grounded findings), the rest `pending` — an honest mid-run fan-out, never
// fabricated evidence (the pending rows contribute zero ledger findings, like the N=3 in-flight row).
const STRESS_QUESTIONS: ReadonlyArray<{ q: string; sub: string; claim: string; host: string; title: string }> = [
  { q: 'Where does a plant’s mass come from?', sub: 'Carbon source', claim: 'A tree’s mass comes mostly from CO₂ in the air, not the soil.', host: 'https://www.britannica.com/science/photosynthesis', title: 'Britannica' },
  { q: 'Light reactions vs. the Calvin cycle?', sub: 'Two stages', claim: 'Photosynthesis splits water (H₂O) to release O₂.', host: 'https://www.nature.com/articles/photosynthesis', title: 'Nature' },
  { q: 'Chlorophyll’s role in capturing light?', sub: 'Pigments', claim: 'Chlorophyll absorbs red and blue light, reflecting green.', host: 'https://www.khanacademy.org/science/biology', title: 'Khan Academy' },
  { q: 'What limits the rate of photosynthesis?', sub: 'Rate limits', claim: '', host: '', title: '' },
  { q: 'C3 vs C4 vs CAM pathways?', sub: 'Pathways', claim: '', host: '', title: '' },
  { q: 'How is glucose stored and used?', sub: 'Storage', claim: '', host: '', title: '' },
  { q: 'Photosynthesis vs cellular respiration?', sub: 'Contrast', claim: '', host: '', title: '' },
  { q: 'The role of the thylakoid membrane?', sub: 'Structure', claim: '', host: '', title: '' },
];

export const GENERATING_STATUS_PAYLOAD_STRESS = {
  ready: false,
  steps: [
    { name: 'plan', stepKey: 'plan:k', startedAt: T(0), finishedAt: T(2100), status: 'done' },
    { name: 'research', stepKey: 'research:a', startedAt: T(2100), finishedAt: T(7400), status: 'done' },
    { name: 'research', stepKey: 'research:b', startedAt: T(2100), finishedAt: T(9200), status: 'done' },
    { name: 'research', stepKey: 'research:c', startedAt: T(2100), finishedAt: T(10500), status: 'done' },
    { name: 'research', stepKey: 'research:d', startedAt: T(2100), finishedAt: null, status: 'running' },
  ],
  research: STRESS_QUESTIONS.map((r, i) => {
    const done = i < 3;
    return {
      question: r.q,
      subtopic: r.sub,
      status: done ? 'done' : 'pending',
      findings: done ? [{ claim: r.claim, url: r.host, title: r.title }] : [],
      sources: done ? [{ url: r.host, title: r.title }] : [],
      findingCount: done ? 1 : null,
      startedAt: T(2100),
      finishedAt: done ? T(7400 + i * 700) : null,
    };
  }),
} as const;
