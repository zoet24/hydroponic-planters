import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { PlantersProvider } from './PlantersContext';
import { AddPlanter } from './routes/AddPlanter';
import { Claim } from './routes/Claim';
import { Home } from './routes/Home';
import { PlanterDetail } from './routes/PlanterDetail';
import { PhCheck } from './routes/PhCheck';
import { Presets } from './routes/Presets';

/** Routes follow UI-HANDOFF.md. Planter detail and the rest come next. */
export function App() {
  return (
    <BrowserRouter>
      <PlantersProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/add" element={<AddPlanter />} />
          <Route path="/claim" element={<Claim />} />
        {/* pH check is nested so the dashboard renders behind it: UI-HANDOFF
            calls for a modal on desktop and a full screen on the phone. */}
        <Route path="/planters/:id" element={<PlanterDetail />}>
          <Route path="ph" element={<PhCheck />} />
        </Route>
        <Route path="/planters/:id/preset" element={<Presets />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </PlantersProvider>
    </BrowserRouter>
  );
}
