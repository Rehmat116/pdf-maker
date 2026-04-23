import { useState } from 'react';
import { Plus, Trash2, Key, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useKeyManager } from '@/hooks/useKeyManager';
import { toast } from '@/hooks/use-toast';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { getAutoCropEnabled, setAutoCropEnabled } from '@/lib/settings';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { keys, addKey, removeKey, clearAllKeys } = useKeyManager();
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [autoCropEnabled, setAutoCropEnabledState] = useState(getAutoCropEnabled);

  const handleAddKey = () => {
    if (newKey.length < 10) {
      toast({
        title: 'Invalid Key',
        description: 'Please enter a valid API key',
        variant: 'destructive',
      });
      return;
    }

    const success = addKey(newKey, newLabel || `Key ${keys.length + 1}`);
    if (success) {
      setNewKey('');
      setNewLabel('');
      toast({
        title: 'Key Added',
        description: 'API key added to your pocket',
      });
    } else {
      toast({
        title: 'Key Exists',
        description: 'This key is already in your pocket',
        variant: 'destructive',
      });
    }
  };

  const handleRemoveKey = (index: number) => {
    removeKey(index);
    toast({
      title: 'Key Removed',
      description: 'API key removed from pocket',
    });
  };

  const handleAutoCropToggle = (checked: boolean) => {
    setAutoCropEnabledState(checked);
    setAutoCropEnabled(checked);
    toast({
      title: checked ? 'Auto Crop Enabled' : 'Auto Crop Disabled',
      description: checked ? 'New uploads will be cropped automatically.' : 'New uploads will keep their original edges.',
    });
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full border-l border-border bg-background px-4 py-6 sm:max-w-xl">
        <SheetHeader className="space-y-3 border-b border-border pb-5 text-left">
          <div className="flex items-center gap-2 text-[hsl(var(--accent))]">
            <Key className="h-5 w-5" />
            <SheetTitle className="font-heading text-2xl">API Key Pocket</SheetTitle>
          </div>
          <SheetDescription className="max-w-md text-sm">
            Add multiple API keys for auto-rotation when rate limited.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 overflow-y-auto py-6">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-foreground">Auto Crop Background</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Trim outer background margins before Gemini scanning and PDF export.
                </p>
              </div>
              <Switch checked={autoCropEnabled} onCheckedChange={handleAutoCropToggle} />
            </div>
          </div>

          <div className="space-y-3">
            {keys.map((key, index) => (
              <div
                key={index}
                className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[hsl(var(--accent))]/12">
                    <Check className="h-4 w-4 text-[hsl(var(--accent))]" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {key.label || `Key ${index + 1}`}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {key.key.slice(0, 10)}...{key.key.slice(-4)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    {key.usage}/{key.limit}
                  </span>
                  <button
                    onClick={() => handleRemoveKey(index)}
                    className="rounded-full p-2 text-muted-foreground transition hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}

            {keys.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
                No keys in pocket. Add one below.
              </div>
            )}
          </div>

          <div className="space-y-3 border-t border-border pt-6">
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Label (optional)"
              className="w-full rounded-2xl border border-border bg-card p-3 text-sm text-foreground outline-none transition focus:border-[hsl(var(--accent))]/50"
            />
            <input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="Paste Gemini API Key (AIza...)"
              className="w-full rounded-2xl border border-border bg-card p-3 font-mono text-sm text-foreground outline-none transition focus:border-[hsl(var(--accent))]/50"
            />
            <Button
              onClick={handleAddKey}
              className="h-12 w-full gap-2 rounded-full bg-[linear-gradient(135deg,#e8b84b,#c9a84c)] text-[#1A1A1A] hover:opacity-95"
            >
              <Plus className="w-4 h-4" />
              Add to Pocket
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">
            Keys stored locally on your device
          </p>
          {keys.length > 0 && (
            <button
              onClick={() => {
                clearAllKeys();
                toast({ title: 'All Keys Cleared' });
              }}
              className="text-xs text-red-500 hover:text-red-600"
            >
              Clear All
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
