import { createRoot } from 'react-dom/client';
import { lazy, Suspense } from 'react';
import { Chrome } from './Chrome';
import { Peek } from './Peek';
import { Settings } from './Settings';
import { MediaPreview } from './MediaPreview';
import './styles.css';
import './zen/library-source.css';
import './zen/electron.css';
import './zen/omnibox-source.css';
import './zen/pickers-source.css';
import './zen/theme-picker-source.css';
import './zen/workspace-form-source.css';
import './zen/progress-source.css';
import './zen/chrome.css';

// One bundle, three surfaces: the window chrome, compact mode's sidebar
// over the page, and the settings window.
const view = new URLSearchParams(location.search).get('view') ?? 'chrome';
document.documentElement.dataset.view = view;
const InterfaceOverlay = lazy(() => import('./InterfaceOverlay').then(module => ({ default: module.InterfaceOverlay })));

const Root = view === 'sidebar' ? Peek : view === 'settings' ? Settings : view === 'interface' ? InterfaceOverlay : view === 'media-preview' ? MediaPreview : Chrome;
createRoot(document.getElementById('root')!).render(<Suspense fallback={null}><Root /></Suspense>);
