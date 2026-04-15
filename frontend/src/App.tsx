import { Route, Routes } from 'react-router-dom';
import { SidebarNav } from './components/SidebarNav';
import styles from './App.module.css';
import { DiagnosticsPage } from './pages/DiagnosticsPage';
import { AudioPage } from './pages/AudioPage';
import { ExtensionsPage } from './pages/ExtensionsPage';
import { FlowEditorPage } from './pages/FlowEditorPage';
import { FlowsPage } from './pages/FlowsPage';
import { InboundRoutesPage } from './pages/InboundRoutesPage';
import { RecordingsPage } from './pages/RecordingsPage';
import { TrunksPage } from './pages/Trunks/TrunksPage';

export default function App() {
  return (
    <div className={styles.appShell}>
      <SidebarNav />
      <main className={styles.contentArea}>
        <Routes>
          <Route path="/" element={<DiagnosticsPage />} />
          <Route path="/audio" element={<AudioPage />} />
          <Route path="/extensions" element={<ExtensionsPage />} />
          <Route path="/trunks" element={<TrunksPage />} />
          <Route path="/flows" element={<FlowsPage />} />
          <Route path="/flows/:id" element={<FlowEditorPage />} />
          <Route path="/inbound" element={<InboundRoutesPage />} />
          <Route path="/recordings" element={<RecordingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
