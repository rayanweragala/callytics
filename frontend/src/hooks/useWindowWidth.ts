import { useEffect, useState } from 'react';

/**
 * Returns the current inner width of the browser window.
 * Updates on every resize event.
 */
export function useWindowWidth(): number {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth;
    }
    return 1024; // safe server-side default (desktop)
  });

  useEffect(() => {
    const handleResize = () => {
      setWidth(window.innerWidth);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return width;
}
