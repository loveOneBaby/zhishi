import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import DesktopQuickSearchApp from './desktop/DesktopQuickSearchApp';
import MobileApp from './mobile/MobileApp';
import { defaultHashForDevice, detectMobileDevice, isRootHash } from './device-route';
import './styles.css';

if (isRootHash(window.location.hash)) {
  const isMobileDevice = detectMobileDevice(
    window.innerWidth,
    window.matchMedia('(pointer: coarse)').matches,
    window.navigator.userAgent,
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
