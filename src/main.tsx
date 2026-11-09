import { createRoot } from 'react-dom/client';
import App from './App';
import ContextMenuHost from './ContextMenu';
import './styles.css';
createRoot(document.getElementById('root')!).render(<><App/><ContextMenuHost/></>);
