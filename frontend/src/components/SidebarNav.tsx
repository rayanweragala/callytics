import { NavLink } from 'react-router-dom';
import { sidebarNavigationGroups, useCommandPalette } from './CommandPalette';
import styles from './SidebarNav.module.css';

export function SidebarNav() {
  const appVersion = import.meta.env.VITE_APP_VERSION ?? 'dev';
  const { openPalette, recordVisit, shortcutLabel } = useCommandPalette();

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brandArea}>
        <img
          src="/callytics-logo.png"
          alt="Callytics"
          className={styles.logo}
        />
      </div>
      <nav className={styles.nav} aria-label="Primary navigation">
        {sidebarNavigationGroups.map((group) => (
          <div className={styles.group} key={group.label}>
            <div className={styles.groupLabel}>{group.label}</div>
            {group.items.map((item) => (
              <NavLink
                className={({ isActive }) => (isActive ? `${styles.item} ${styles.itemActive}` : styles.item)}
                end={item.end}
                key={item.route}
                onClick={() => recordVisit(item)}
                to={item.route}
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className={styles.footer}>
        <button className={styles.commandButton} onClick={openPalette} type="button">
          <span>command palette</span>
          <span className={styles.commandShortcut}>{shortcutLabel}</span>
        </button>
        <div className={styles.version}>v{appVersion}</div>
      </div>
    </aside>
  );
}
