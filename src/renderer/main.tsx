import { createRoot } from 'react-dom/client';
import { Chrome } from './Chrome';
import { Overlay } from './Overlay';
import { Settings } from './Settings';
import './styles.css';

// One bundle, three surfaces: the window chrome, the floating overlay above
// the page, and the settings window.
const view = new URLSearchParams(location.search).get('view') ?? 'chrome';
document.documentElement.dataset.view = view;

const Root = view === 'overlay' ? Overlay : view === 'settings' ? Settings : Chrome;
createRoot(document.getElementById('root')!).render(<Root />);
