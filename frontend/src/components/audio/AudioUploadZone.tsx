import { ChangeEvent, DragEvent, useRef } from 'react';
import styles from './AudioUploadZone.module.css';

interface AudioUploadZoneProps {
  file: File | null;
  onFileSelect: (file: File | null) => void;
}

export function AudioUploadZone({ file, onFileSelect }: AudioUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const openPicker = () => {
    inputRef.current?.click();
  };

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    onFileSelect(event.target.files?.[0] || null);
  };

  const onDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    onFileSelect(event.dataTransfer.files?.[0] || null);
  };

  return (
    <>
      <input
        ref={inputRef}
        className={styles.hiddenInput}
        type="file"
        accept="audio/*"
        onChange={onChange}
      />
      <button
        className={styles.zone}
        onClick={openPicker}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        type="button"
      >
        <span className={styles.label}>drag file here or click to browse</span>
        <span className={styles.fileName}>{file?.name || '—'}</span>
      </button>
    </>
  );
}
