import { PageLayout } from '../components/common/PageLayout';
import styles from './NotFoundPage.module.css';

export function NotFoundPage() {
  return (
    <PageLayout title="Not found" subtitle="This page does not exist">
      <div className={styles.page}>
        <h1>404 - Page Not Found</h1>
        <p>The page you are looking for does not exist.</p>
      </div>
    </PageLayout>
  );
}