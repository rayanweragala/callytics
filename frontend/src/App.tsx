import { Route, Routes } from 'react-router-dom';
import { SidebarNav } from './components/SidebarNav';
import { DiagnosticsPage } from './pages/DiagnosticsPage';
import { FlowEditorPage } from './pages/FlowEditorPage';
import { FlowsPage } from './pages/FlowsPage';
import styles from './App.module.css';

export default function App() {
  return (
    <div className={styles.appShell}>
      <SidebarNav />
      <main className={styles.contentArea}>
        <Routes>
          <Route path="/" element={<DiagnosticsPage />} />
          <Route path="/flows" element={<FlowsPage />} />
          <Route path="/flows/:id" element={<FlowEditorPage />} />
        </Routes>
      </main>
    </div>
  );
}
