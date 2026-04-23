export const AUTO_CROP_STORAGE_KEY = "pagecraft_auto_crop_enabled";

export const getAutoCropEnabled = (): boolean => {
  const stored = localStorage.getItem(AUTO_CROP_STORAGE_KEY);
  if (stored === null) {
    return true;
  }

  return stored === "true";
};

export const setAutoCropEnabled = (enabled: boolean) => {
  localStorage.setItem(AUTO_CROP_STORAGE_KEY, String(enabled));
};
