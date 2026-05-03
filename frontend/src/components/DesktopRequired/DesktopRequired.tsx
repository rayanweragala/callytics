import { Link } from 'react-router-dom';
import styles from './DesktopRequired.module.css';

/**
 * Full-screen wall shown on mobile viewports for pages that require desktop.
 * This component itself does NOT check viewport width — the caller is
 * responsible for only rendering this when windowWidth < 768.
 */
export function DesktopRequired() {
  return (
    <div className={styles.wall}>
      <img
        src="/callytics-logo.png"
        alt="Callytics"
        className={styles.logo}
      />
      <h1 className={styles.heading}>Desktop required</h1>
      <p className={styles.message}>
        This page is designed for desktop. Open Callytics on a laptop or desktop browser for the full experience.
      </p>
      <div className={styles.navSection}>
        <p className={styles.navLabel}>Available on mobile</p>
        <ul className={styles.navList}>
          <li><Link to="/" className={styles.navLink}>diagnostics</Link></li>
          <li><Link to="/call-logs" className={styles.navLink}>call logs</Link></li>
          <li><Link to="/recordings" className={styles.navLink}>recordings</Link></li>
          <li><Link to="/logs" className={styles.navLink}>asterisk logs</Link></li>
        </ul>
      </div>
    </div>
  );
}
