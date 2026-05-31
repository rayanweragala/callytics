import { Navigate, Route, Routes } from 'react-router-dom';
import { CommandPalette } from './components/CommandPalette';
import { SidebarNav } from './components/SidebarNav';
import styles from './App.module.css';
import { DashboardPage } from './pages/DashboardPage';
import { DiagnosticsPage } from './pages/DiagnosticsPage';
import { AudioPage } from './pages/AudioPage';
import { ExtensionsPage } from './pages/ExtensionsPage';
import { FlowEditorPage } from './pages/FlowEditorPage';
import { FlowsPage } from './pages/FlowsPage';
import { InboundRoutesPage } from './pages/InboundRoutesPage';
import { RecordingsPage } from './pages/RecordingsPage';
import { TrunksPage } from './pages/TrunksPage';
import { CallLogsPage } from './pages/CallLogsPage';
import { WebhookLogsPage } from './pages/WebhookLogsPage';
import { SettingsPage } from './pages/SettingsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { OperatorsPage } from './pages/OperatorsPage';
import { QueuesPage } from './pages/QueuesPage';
import { ContactNumbersPage } from './pages/ContactNumbersPage';
import { CapturePage } from './pages/CapturePage';
import { AsteriskLogsPage } from './pages/AsteriskLogsPage';
import { PreflightPage } from './pages/PreflightPage';
import { CampaignsPage } from './pages/CampaignsPage';
import { CampaignDetailPage } from './pages/CampaignDetailPage';
import { CallbacksPage } from './pages/CallbacksPage';
import { VpnPage } from './pages/VpnPage';
import { FirewallPage } from './pages/FirewallPage';
import { BackupPage } from './pages/BackupPage';
import { Softphone } from './components/Softphone/Softphone';

export default function App() {
  return (
    <div className={styles.appShell}>
      <SidebarNav />
      <main className={styles.contentArea}>
        <Routes>
          <Route path="/" element={<Navigate replace to="/dashboard" />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/diagnostics" element={<DiagnosticsPage />} />
          <Route path="/logs" element={<AsteriskLogsPage />} />
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
          <Route path="/webhook-logs" element={<WebhookLogsPage />} />
          <Route path="/preflight" element={<PreflightPage />} />
          <Route path="/firewall" element={<FirewallPage />} />
          <Route path="/vpn" element={<VpnPage />} />
          <Route path="/backup" element={<BackupPage />} />
          <Route path="/campaigns" element={<CampaignsPage />} />
          <Route path="/campaigns/:id" element={<CampaignDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/operators" element={<OperatorsPage />} />
          <Route path="/queues" element={<QueuesPage />} />
          <Route path="/callbacks" element={<CallbacksPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
      <CommandPalette />
      <Softphone />
    </div>
  );
}
