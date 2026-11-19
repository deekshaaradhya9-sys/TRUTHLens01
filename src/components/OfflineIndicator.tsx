import React, { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

export const OfflineIndicator: React.FC = () => {
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div className="bg-amber-950/90 border-b border-amber-600/50 px-4 py-2 text-xs text-amber-100 flex items-center justify-center gap-2">
      <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
      <span>
        Offline Mode: App shell loaded locally. Live server forensic uploads, Gemini synthesis, and private evidence streams require reconnection.
      </span>
    </div>
  );
};
