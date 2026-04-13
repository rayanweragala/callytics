import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './AudioPreviewPlayer.module.css';

interface AudioPreviewPlayerProps {
  src: string;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function AudioPreviewPlayer({ src }: AudioPreviewPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = new Audio(src);
    audio.preload = 'metadata';
    audioRef.current = audio;

    const syncTime = () => setCurrentTime(audio.currentTime);
    const syncDuration = () => setDuration(audio.duration || 0);
    const syncEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener('timeupdate', syncTime);
    audio.addEventListener('loadedmetadata', syncDuration);
    audio.addEventListener('ended', syncEnded);

    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', syncTime);
      audio.removeEventListener('loadedmetadata', syncDuration);
      audio.removeEventListener('ended', syncEnded);
      audioRef.current = null;
    };
  }, [src]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      await audio.play();
      setIsPlaying(true);
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setIsMuted(audio.muted);
  };

  const progress = useMemo(() => (duration > 0 ? (currentTime / duration) * 100 : 0), [currentTime, duration]);

  return (
    <div className={styles.player}>
      <button className={`${styles.iconButton} ${isPlaying ? styles.active : ''}`} onClick={() => void togglePlay()} type="button">
        {isPlaying ? 'pause' : 'play'}
      </button>
      <div className={styles.progressWrap}>
        <input
          className={styles.range}
          type="range"
          min={0}
          max={duration || 0}
          step={0.01}
          value={Math.min(currentTime, duration || 0)}
          onChange={(event) => {
            const audio = audioRef.current;
            if (!audio) return;
            audio.currentTime = Number(event.target.value);
            setCurrentTime(audio.currentTime);
          }}
          style={{ backgroundSize: `${progress}% 100%` } as React.CSSProperties}
        />
        <div className={styles.time}>{formatTime(currentTime)} / {formatTime(duration)}</div>
      </div>
      <button className={styles.iconButton} onClick={toggleMute} type="button">
        {isMuted ? 'muted' : 'mute'}
      </button>
    </div>
  );
}
