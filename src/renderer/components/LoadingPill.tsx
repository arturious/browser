import { useEffect, useState } from 'react';
export function LoadingPill({ isLoading, color, tabId }: { isLoading: boolean; color: string | null; tabId: string }) {
  const [long, setLong] = useState(false);
  useEffect(() => { setLong(false); if (!isLoading) return; const timer = setTimeout(() => setLong(true), 3000); return () => clearTimeout(timer); }, [isLoading, tabId]);
  if (!isLoading) return null;
  return <div id="zen-loading-progress-bar" long-load={long ? 'true' : undefined} style={color ? { '--zen-loading-progress-bar-color': color } as React.CSSProperties : undefined} />;
}
