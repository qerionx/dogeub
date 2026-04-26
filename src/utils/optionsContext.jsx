import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import {
  getStoredOptionsSync,
  initSettingsStore,
  setStoredOptions,
} from './settingsStore';

const OptionsContext = createContext();

export const OptionsProvider = ({ children }) => {
  const [options, setOptions] = useState(getStoredOptionsSync);

  useEffect(() => {
    let active = true;

    initSettingsStore().then((stored) => {
      if (active) setOptions(stored);
    });

    return () => {
      active = false;
    };
  }, []);

  const updateOption = useCallback((obj, immediate = true) => {
    if (!obj || typeof obj !== 'object') return;

    const current = getStoredOptionsSync();
    const updated = { ...current, ...obj };

    void setStoredOptions(updated);

    if (immediate) {
      setOptions(updated);
    }
  }, []);

  const contextValue = useMemo(() => ({ options, updateOption }), [options, updateOption]);

  return <OptionsContext.Provider value={contextValue}>{children}</OptionsContext.Provider>;
};

export const useOptions = () => {
  const context = useContext(OptionsContext);
  if (!context) {
    throw new Error('useOptions must be used within an OptionsProvider');
  }
  return context;
};
