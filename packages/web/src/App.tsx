import { phAdvice } from '@planter/shared';

// Placeholder screen. Real work starts Thu 24 Sep: SSE + live numbers.
// For now it only proves the shared package resolves in the browser too.
export function App() {
  const check = phAdvice({
    ph: 6.4,
    range: { min: 5.5, max: 6.2 },
    readingAgeHours: 4,
    checkIntervalDays: 3,
  });

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: '40rem' }}>
      <h1>Planters</h1>
      <p>
        <strong>{check.status}</strong> — {check.action}
      </p>
      <p>{check.advice}</p>
    </main>
  );
}
