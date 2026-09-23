import { phAdvice } from '@planter/shared';

// Placeholder entry point. Real work starts Wed 23 Sep: SQLite, MQTT ingest, SSE.
// For now it only proves the workspace package resolves under tsx.
const check = phAdvice({
  ph: 6.4,
  range: { min: 5.5, max: 6.2 },
  readingAgeHours: 4,
  checkIntervalDays: 3,
});

console.log(`[backend] shared resolves — ${check.status} / ${check.action}`);
