import { useState, useCallback, useEffect } from 'react';

export interface ApiKey {
  key: string;
  usage: number;
  limit: number;
  label?: string;
}

const STORAGE_KEY = 'smartbook_api_keys';
const KEY_LIMIT = 4; // Requests before rotating

export function useKeyManager() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [currentKeyIndex, setCurrentKeyIndex] = useState(0);

  // Load keys from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setKeys(parsed);
      } catch {
        setKeys([]);
      }
    }
  }, []);

  // Save keys to localStorage whenever they change
  const saveKeys = useCallback((newKeys: ApiKey[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newKeys));
    setKeys(newKeys);
  }, []);

  // Add a new key
  const addKey = useCallback((key: string, label?: string) => {
    if (!key || key.length < 10) return false;
    
    // Check if key already exists
    const exists = keys.some(k => k.key === key);
    if (exists) return false;

    const newKey: ApiKey = { key, usage: 0, limit: KEY_LIMIT, label };
    saveKeys([...keys, newKey]);
    return true;
  }, [keys, saveKeys]);

  // Remove a key by index
  const removeKey = useCallback((index: number) => {
    const newKeys = keys.filter((_, i) => i !== index);
    saveKeys(newKeys);
    if (currentKeyIndex >= newKeys.length && newKeys.length > 0) {
      setCurrentKeyIndex(newKeys.length - 1);
    }
  }, [keys, currentKeyIndex, saveKeys]);

  // Get the current active key
  const getCurrentKey = useCallback((): string | null => {
    if (keys.length === 0) return null;
    return keys[currentKeyIndex]?.key || null;
  }, [keys, currentKeyIndex]);

  // Increment usage and auto-rotate if needed
  const incrementUsage = useCallback(() => {
    if (keys.length === 0) return;

    const newKeys = [...keys];
    newKeys[currentKeyIndex] = {
      ...newKeys[currentKeyIndex],
      usage: newKeys[currentKeyIndex].usage + 1
    };

    // Check if we need to rotate
    if (newKeys[currentKeyIndex].usage >= KEY_LIMIT) {
      const nextIndex = (currentKeyIndex + 1) % keys.length;
      
      // Reset usage on the new key
      newKeys[nextIndex] = { ...newKeys[nextIndex], usage: 0 };
      setCurrentKeyIndex(nextIndex);
    }

    saveKeys(newKeys);
  }, [keys, currentKeyIndex, saveKeys]);

  // Force rotate to next key (e.g., on 429 error)
  const rotateKey = useCallback(() => {
    if (keys.length <= 1) return false;

    const nextIndex = (currentKeyIndex + 1) % keys.length;
    
    // Reset usage on the new key
    const newKeys = [...keys];
    newKeys[nextIndex] = { ...newKeys[nextIndex], usage: 0 };
    
    setCurrentKeyIndex(nextIndex);
    saveKeys(newKeys);
    return true;
  }, [keys, currentKeyIndex, saveKeys]);

  // Reset all usage counters (e.g., after a minute)
  const resetAllUsage = useCallback(() => {
    const newKeys = keys.map(k => ({ ...k, usage: 0 }));
    saveKeys(newKeys);
  }, [keys, saveKeys]);

  // Clear all keys
  const clearAllKeys = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setKeys([]);
    setCurrentKeyIndex(0);
  }, []);

  // Check if we have any keys
  const hasKeys = keys.length > 0;

  return {
    keys,
    currentKeyIndex,
    hasKeys,
    addKey,
    removeKey,
    getCurrentKey,
    incrementUsage,
    rotateKey,
    resetAllUsage,
    clearAllKeys,
  };
}
