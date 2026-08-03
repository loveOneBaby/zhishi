import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import DesktopQuickSearchApp from './desktop/DesktopQuickSearchApp';
import MobileApp from './mobile/MobileApp';
import { defaultHashForDevice, detectIPadDevice, detectMobileDevice, isMobileHash, isRootHash } from './device-route';
import './styles.css';

const deviceArgs = [
  window.navigator.userAgent,
  window.navigator.platform,
  window.navigator.maxTouchPoints,
] as const;
const isIPadDevice = detectIPadDevice(...deviceArgs);

if (isIPadDevice && isMobileHash(window.location.hash)) {
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${defaultHashForDevice(false)}`);
} else if (isRootHash(window.location.hash)) {
  const isMobileDevice = detectMobileDevice(
    window.innerWidth,
    window.matchMedia('(pointer: coarse)').matches,
    ...deviceArgs,
  );
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${defaultHashForDevice(isMobileDevice)}`);
}

const isDesktopQuickSearch = window.location.hash.replace(/^#\/?/, '').startsWith('desktop-quick-search');
const isMobileApp = window.location.hash.replace(/^#\/?/, '').startsWith('mobile');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isDesktopQuickSearch ? <DesktopQuickSearchApp /> : isMobileApp ? <MobileApp /> : <App />}
  </React.StrictMode>
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js'); });
}
