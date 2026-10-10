import { useEffect, useState } from 'react';

type Phase = 'idle' | 'pulsing' | 'long' | 'stalled';

/**
 * A small pill that breathes while a page loads (styled after Zen's). If
 * loading takes more than 3s it settles into a wider pill with a shimmer;
 * after 30s (a hung load, not a slow page) the shimmer stops, so it doesn't
 * keep animating forever.
 */
export function LoadingPill({ isLoading, color, tabId }: { isLoading: boolean; color: string | null; tabId: string }) {
  const [phase, setPhase] = useState<Phase>('idle');

  useEffect(() => {
    if (!isLoading) {
      setPhase('idle');
      return;
    }
    setPhase('pulsing');
    const long = setTimeout(() => setPhase('long'), 3000);
    const stall = setTimeout(() => setPhase('stalled'), 33000);
    return () => {
      clearTimeout(long);
      clearTimeout(stall);
    };
  }, [isLoading, tabId]);

  return (
    <div className={`loading-pill ${phase}`} style={{ background: color ?? 'rgb(153, 153, 153)' }}>
      {phase === 'long' && <div className="shimmer" />}
    </div>
  );
}
