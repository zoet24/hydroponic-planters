import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Home } from './routes/Home';

/** Routes follow UI-HANDOFF.md. Only Home is built to the design so far. */
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </BrowserRouter>
  );
}
