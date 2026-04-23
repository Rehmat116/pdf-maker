import { Settings } from 'lucide-react';
import { useState } from 'react';
import { SettingsModal } from './SettingsModal';

export function Header() {
  const [showSettings, setShowSettings] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border/80 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-[52px] max-w-6xl items-center justify-between px-4">
          <div className="font-heading text-[18px] tracking-[0.02em] text-foreground">
            PageCraft
          </div>

          <button
            onClick={() => setShowSettings(true)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition hover:border-[hsl(var(--accent))]/40 hover:text-foreground"
            aria-label="Open settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </>
  );
}
