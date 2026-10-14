import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { PlantersProvider } from './PlantersContext';
import { AddPlanter } from './routes/AddPlanter';
import { AddNote } from './routes/AddNote';
import { Home } from './routes/Home';
import { RecordNutrients } from './routes/RecordNutrients';
import { PlanterDetail } from './routes/PlanterDetail';
import { PhCheck } from './routes/PhCheck';
import { Presets } from './routes/Presets';

export function App() {
  return (
    <BrowserRouter>
      <PlantersProvider>
        <Shell />
      </PlantersProvider>
    </BrowserRouter>
  );
}

/** Inside the router and the provider, so every route has its context. */
function Shell() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/add" element={<AddPlanter />} />
      {/* pH check is nested so the dashboard renders behind it: a modal on
          desktop, a full screen on the phone. */}
      <Route path="/planters/:id" element={<PlanterDetail />}>
        <Route path="ph" element={<PhCheck />} />
        <Route path="nutrients" element={<RecordNutrients />} />
        <Route path="note" element={<AddNote />} />
      </Route>
      <Route path="/planters/:id/preset" element={<Presets />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
