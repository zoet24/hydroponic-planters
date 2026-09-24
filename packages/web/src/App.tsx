import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { PlantersProvider } from './PlantersContext';
import { AddPlanter } from './routes/AddPlanter';
import { Claim } from './routes/Claim';
import { Home } from './routes/Home';

/** Routes follow UI-HANDOFF.md. Planter detail and the rest come next. */
export function App() {
  return (
    <BrowserRouter>
      <PlantersProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/add" element={<AddPlanter />} />
          <Route path="/claim" element={<Claim />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </PlantersProvider>
    </BrowserRouter>
  );
}
