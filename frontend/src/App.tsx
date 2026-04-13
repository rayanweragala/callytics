import { Route, Routes } from 'react-router-dom';
import { SidebarNav } from './components/SidebarNav';
import styles from './App.module.css';
import { DiagnosticsPage } from './pages/DiagnosticsPage';
import { AudioPage } from './pages/AudioPage';
import { FlowEditorPage } from './pages/FlowEditorPage';
import { FlowsPage } from './pages/FlowsPage';
import { RecordingsPage } from './pages/RecordingsPage';

export default function App() {
  return (
    <div className={styles.appShell}>
      <SidebarNav />
      <main className={styles.contentArea}>
        <Routes>
          <Route path="/" element={<DiagnosticsPage />} />
          <Route path="/audio" element={<AudioPage />} />
          <Route path="/flows" element={<FlowsPage />} />
          <Route path="/flows/:id" element={<FlowEditorPage />} />
          <Route path="/recordings" element={<RecordingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
