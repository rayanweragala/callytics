import styles from './Pagination.module.css';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  return (
    <div className={styles.footer}>
      <button className={styles.button} disabled={page <= 1} onClick={() => onPageChange(page - 1)} type="button">
        ← Newer
      </button>
      <div className={styles.pageIndicator}>{page} / {totalPages}</div>
      <button className={styles.button} disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} type="button">
        Older →
      </button>
    </div>
  );
}
