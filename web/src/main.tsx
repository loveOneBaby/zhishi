import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import DesktopQuickSearchApp from './desktop/DesktopQuickSearchApp';
import './styles.css';

const isDesktopQuickSearch = window.location.hash.replace(/^#\/?/, '').startsWith('desktop-quick-search');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isDesktopQuickSearch ? <DesktopQuickSearchApp /> : <App />}
  </React.StrictMode>
);
