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
      question: 'Chlorophyll’s role in capturing light?',
      subtopic: null,
      status: 'pending',
      findings: [
        {
          claim: 'Chlorophyll absorbs red & blue light, reflects green.',
          url: 'https://www.khanacademy.org/science/biology/photosynthesis',
          title: 'Khan Academy',
        },
      ],
      sources: [{ url: 'https://www.khanacademy.org/science/biology/photosynthesis', title: 'Khan Academy' }],
      findingCount: null,
      startedAt: T(2100),
      finishedAt: null,
    },
  ],
} as const;
