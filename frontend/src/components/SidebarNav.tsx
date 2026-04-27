import { NavLink } from 'react-router-dom';
import styles from './SidebarNav.module.css';

export function SidebarNav() {
  const appVersion = import.meta.env.VITE_APP_VERSION ?? 'dev';

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brandArea}>
        <div className={styles.brand}>CALLYTICS</div>
        <div className={styles.label}>CONTROL ROOM</div>
      </div>
      <nav className={styles.nav} aria-label="Primary navigation">
          <div className={styles.group}>
            <div className={styles.groupLabel}>MONITOR</div>
            <NavLink to="/" className={({ isActive }) => isActive ? `${styles.item} ${styles.itemActive}` : styles.item} end>
              diagnostics
            </NavLink>
            <NavLink to="/logs" className={({ isActive }) => isActive ? `${styles.item} ${styles.itemActive}` : styles.item}>
              logs
            </NavLink>
            <NavLink to="/call-logs" className={({ isActive }) => isActive ? `${styles.item} ${styles.itemActive}` : styles.item}>
              call logs
            </NavLink>
            <NavLink to="/capture" className={({ isActive }) => isActive ? `${styles.item} ${styles.itemActive}` : styles.item}>
              capture
            </NavLink>
            <NavLink to="/recordings" className={({ isActive }) => isActive ? `${styles.item} ${styles.itemActive}` : styles.item}>
              recordings
            </NavLink>
          </div>
          <div className={styles.group}>
            <div className={styles.groupLabel}>CONFIGURE</div>
            <NavLink to="/flows" className={({ isActive }) => isActive ? `${styles.item} ${styles.itemActive}` : styles.item}>
              flow builder
            </NavLink>
            <NavLink to="/extensions" className={({ isActive }) => isActive ? `${styles.item} ${styles.itemActive}` : styles.item}>
              extensions
            </NavLink>
            <NavLink to="/contacts" className={({ isActive }) => isActive ? `${styles.item} ${styles.itemActive}` : styles.item}>
              contacts
            </NavLink>
            <NavLink to="/operators" className={({ isActive }) => isActive ? `${styles.item} ${styles.itemActive}` : styles.item}>
              operators
            </NavLink>
            <NavLink to="/queues" className={({ isActive }) => isActive ? `${styles.item} ${styles.itemActive}` : styles.item}>
              queues
            </NavLink>
            <NavLink to="/callbacks" className={({ isActive }) => isActive ? `${styles.item} ${styles.itemActive}` : styles.item}>
              callbacks
            </NavLink>
            <NavLink to="/trunks" className={({ isActive }) => isActive ? `${styles.item} ${styles.itemActive}` : styles.item}>
              trunks
            </NavLink>
            <NavLink to="/inbound" className={({ isActive }) => isActive ? `${styles.item} ${styles.itemActive}` : styles.item}>
              inbound
            </NavLink>
            <NavLink to="/templates" className={({ isActive }) => isActive ? `${styles.item} ${styles.itemActive}` : styles.item}>
              templates
            </NavLink>
            <NavLink to="/audio" className={({ isActive }) => isActive ? `${styles.item} ${styles.itemActive}` : styles.item}>
              audio
            </NavLink>
          </div>
          <div className={styles.group}>
            <div className={styles.groupLabel}>OUTBOUND</div>
            <NavLink to="/campaigns" className={({ isActive }) => isActive ? `${styles.item} ${styles.itemActive}` : styles.item}>
              campaigns
            </NavLink>
          </div>
          <div className={styles.group}>
            <div className={styles.groupLabel}>SYSTEM</div>
            <NavLink to="/firewall" className={({ isActive }) => isActive ? `${styles.item} ${styles.itemActive}` : styles.item}>
              firewall
            </NavLink>
            <NavLink to="/vpn" className={({ isActive }) => isActive ? `${styles.item} ${styles.itemActive}` : styles.item}>
              vpn
            </NavLink>
            <NavLink to="/backup" className={({ isActive }) => isActive ? `${styles.item} ${styles.itemActive}` : styles.item}>
              backup & restore
            </NavLink>
            <NavLink to="/preflight" className={({ isActive }) => isActive ? `${styles.item} ${styles.itemActive}` : styles.item}>
              preflight
            </NavLink>
            <NavLink to="/settings" className={({ isActive }) => isActive ? `${styles.item} ${styles.itemActive}` : styles.item}>
              settings
            </NavLink>
          </div>
        </nav>
      <div className={styles.version}>v{appVersion}</div>
    </aside>
  );
}
