import { NavLink } from 'react-router-dom';
import styles from './SidebarNav.module.css';

export function SidebarNav() {
  return (
    <aside className={styles.sidebar}>
      <div>
        <div className={styles.brand}>CALLYTICS</div>
        <div className={styles.label}>CONTROL ROOM</div>
        <nav className={styles.nav} aria-label="Primary navigation">
          <div className={styles.group}>
            <div className={styles.groupLabel}>MONITOR</div>
            <NavLink to="/" className={({ isActive }) => isActive ? `${styles.item} ${styles.itemActive}` : styles.item} end>
              diagnostics
            </NavLink>
            <NavLink to="/call-logs" className={({ isActive }) => isActive ? `${styles.item} ${styles.itemActive}` : styles.item}>
              call logs
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
            <NavLink to="/trunks" className={({ isActive }) => isActive ? `${styles.item} ${styles.itemActive}` : styles.item}>
              trunks
            </NavLink>
            <NavLink to="/inbound" className={({ isActive }) => isActive ? `${styles.item} ${styles.itemActive}` : styles.item}>
              inbound
            </NavLink>
            <NavLink to="/audio" className={({ isActive }) => isActive ? `${styles.item} ${styles.itemActive}` : styles.item}>
              audio
            </NavLink>
          </div>
          <div className={styles.group}>
            <div className={styles.groupLabel}>SYSTEM</div>
            <NavLink to="/settings" className={({ isActive }) => isActive ? `${styles.item} ${styles.itemActive}` : styles.item}>
              settings
            </NavLink>
          </div>
        </nav>
      </div>
      <div className={styles.version}>v0.8.0-dev</div>
    </aside>
  );
}
