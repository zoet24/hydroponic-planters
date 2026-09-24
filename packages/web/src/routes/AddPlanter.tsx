import { Link } from 'react-router-dom';
import { Screen, ScreenHead } from '../components/Screen';

const STEPS = [
  "Open your phone's camera app.",
  'Point it at the QR code on the planter.',
  'Tap the link that appears, then claim the planter.',
];

export function AddPlanter() {
  return (
    <Screen>
      <ScreenHead title="Add a planter" back="/" backLabel="Back to your planters" />

      <div className="stack">
        <p className="lede lede--tight">
          Each planter has a QR code on it. Scan it with your phone's own camera.
        </p>

        <ol className="rows-card rows-card--steps">
          {STEPS.map((step, i) => (
            <li key={step} className="row-item">
              <span className="numdot" aria-hidden="true">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="screen__foot">
        <p className="fineprint">
          The link opens in your browser, so this app never needs camera access.
        </p>
        <Link to="/" className="button button--primary button--block">
          Back to your planters
        </Link>
      </div>
    </Screen>
  );
}
