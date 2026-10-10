import { createRoot } from 'react-dom/client';
import { Chrome } from './Chrome';
import { Peek } from './Peek';
import { Settings } from './Settings';
import { ThemeEditor } from './ThemeEditor';
import './styles.css';

// One bundle, three surfaces: the window chrome, compact mode's sidebar
// over the page, and the settings window.
const view = new URLSearchParams(location.search).get('view') ?? 'chrome';
document.documentElement.dataset.view = view;

const Root = view === 'sidebar' ? Peek : view === 'settings' ? Settings : view === 'theme' ? ThemeEditor : Chrome;
createRoot(document.getElementById('root')!).render(<Root />);
