import React, { useEffect, useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const PWAInstallButton: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [showHintModal, setShowHintModal] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia?.('(display-mode: standalone)')?.matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) {
      setIsInstalled(true);
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (isInstalled) return null;

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setDeferredPrompt(null);
      }
      return;
    }
    setShowHintModal(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleInstallClick}
        title="Install TruthLens App (PWA)"
        className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-slate-800 bg-slate-950 text-xs font-medium text-cyan-300 hover:border-cyan-500/50 cursor-pointer whitespace-nowrap shrink-0"
      >
        <Download className="w-3.5 h-3.5" />
        <span className="hidden md:inline">Install App</span>
      </button>

      {showHintModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md glass-panel rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white font-semibold text-sm">
                <Smartphone className="w-4 h-4 text-cyan-400" />
                <span>Install TruthLens Workbench (PWA)</span>
              </div>
              <button
                type="button"
                onClick={() => setShowHintModal(false)}
                className="p-1 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 text-xs text-slate-300 leading-relaxed">
              <p>
                <strong>Desktop Chrome / Edge:</strong> Click the install icon in the browser address bar or choose <em>Menu → Save and Share → Install TruthLens</em>.
              </p>
              <p>
                <strong>Android Chrome:</strong> Tap <em>Menu (⋮) → Install App</em> or <em>Add to Home screen</em>.
              </p>
              <p>
                <strong>iOS Safari:</strong> Tap the <em>Share</em> icon, then choose <em>Add to Home Screen</em>.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
