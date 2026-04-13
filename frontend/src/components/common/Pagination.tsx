import styles from './Pagination.module.css';

interface PaginationProps {
  page: number;
  totalPages: number;
  limit: number;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
}

export function Pagination({ page, totalPages, limit, onPageChange, onLimitChange }: PaginationProps) {
  return (
    <div className={styles.footer}>
      <div className={styles.pageCount}>page {page} of {totalPages}</div>
      <div className={styles.controls}>
        <button className={styles.button} disabled={page <= 1} onClick={() => onPageChange(page - 1)} type="button">previous</button>
        <select className={styles.select} value={String(limit)} onChange={(event) => onLimitChange(Number(event.target.value))}>
          {[5, 10, 25, 50].map((value) => <option key={value} value={value}>{value} / page</option>)}
        </select>
        <button className={styles.button} disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} type="button">next</button>
      </div>
    </div>
  );
}
