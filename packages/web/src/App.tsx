import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { DevDrawer, DevDrawerProvider } from './components/DevDrawer';
import { usePresenterMode } from './presenter';
import { PlantersProvider } from './PlantersContext';
import { AddPlanter } from './routes/AddPlanter';
import { AddNote } from './routes/AddNote';
import { Home } from './routes/Home';
import { RecordNutrients } from './routes/RecordNutrients';
import { PlanterDetail } from './routes/PlanterDetail';
import { PhCheck } from './routes/PhCheck';
import { Presets } from './routes/Presets';

/** Routes follow UI-HANDOFF.md. Planter detail and the rest come next. */
export function App() {
  return (
    <BrowserRouter>
      <PlantersProvider>
        <DevDrawerProvider>
          <Shell />
        </DevDrawerProvider>
      </PlantersProvider>
    </BrowserRouter>
  );
}

/** Inside the router and both providers, so every hook is available. */
function Shell() {
  usePresenterMode();

  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/add" element={<AddPlanter />} />
        {/* pH check is nested so the dashboard renders behind it: UI-HANDOFF
            calls for a modal on desktop and a full screen on the phone. */}
        <Route path="/planters/:id" element={<PlanterDetail />}>
          <Route path="ph" element={<PhCheck />} />
          <Route path="nutrients" element={<RecordNutrients />} />
          <Route path="note" element={<AddNote />} />
        </Route>
        <Route path="/planters/:id/preset" element={<Presets />} />
        <Route path="*" element={<Home />} />
      </Routes>
      <DevDrawer />
    </>
  );
}
