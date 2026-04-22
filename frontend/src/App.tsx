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
import { TrunksPage } from './pages/TrunksPage';
import { CallLogsPage } from './pages/CallLogsPage';
import { SettingsPage } from './pages/SettingsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { OperatorsPage } from './pages/OperatorsPage';
import { QueuesPage } from './pages/QueuesPage';
import { ContactNumbersPage } from './pages/ContactNumbersPage';
import { CapturePage } from './pages/CapturePage';

export default function App() {
  return (
    <div className={styles.appShell}>
      <SidebarNav />
      <main className={styles.contentArea}>
        <Routes>
          <Route path="/" element={<DiagnosticsPage />} />
          <Route path="/capture" element={<CapturePage />} />
          <Route path="/audio" element={<AudioPage />} />
          <Route path="/extensions" element={<ExtensionsPage />} />
          <Route path="/contacts" element={<ContactNumbersPage />} />
          <Route path="/trunks" element={<TrunksPage />} />
          <Route path="/flows" element={<FlowsPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/flows/:id" element={<FlowEditorPage />} />
          <Route path="/inbound" element={<InboundRoutesPage />} />
          <Route path="/recordings" element={<RecordingsPage />} />
          <Route path="/call-logs" element={<CallLogsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/operators" element={<OperatorsPage />} />
          <Route path="/queues" element={<QueuesPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </div>
  );
}
