import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Presenter mode: bigger type and less chrome, for the projected screen.
 *
 * Per device, not per app — the laptop on the projector runs presenter mode
 * while the phone in your hand stays normal and keeps the dev drawer. Setting
 * an attribute on <html> keeps every adjustment in CSS.
 */
const STORAGE_KEY = 'planter.presenter';
const ATTRIBUTE = 'data-presenter';

export function usePresenterMode(): boolean {
  const [params] = useSearchParams();
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  // ?presenter=1 turns it on, ?presenter=0 turns it off again.
  useEffect(() => {
    const flag = params.get('presenter');
    if (flag === '1') setOn(true);
    else if (flag === '0') setOn(false);
  }, [params]);

  useEffect(() => {
    document.documentElement.setAttribute(ATTRIBUTE, String(on));
    try {
      localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
    } catch {
      /* nothing to do */
    }
  }, [on]);

  return on;
}
