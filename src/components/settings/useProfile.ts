import { useEffect } from "react";
import { useProfileStore } from "../../stores/profileStore";

export type { UserProfile } from "../../stores/profileStore";

export function useProfile() {
  const profile = useProfileStore((state) => state.profile);
  const updateProfile = useProfileStore((state) => state.updateProfile);
  const loadSettings = useProfileStore((state) => state.loadSettings);
  const settingsLoaded = useProfileStore((state) => state.settingsLoaded);

  // Load profile settings from database on first mount
  useEffect(() => {
    if (!settingsLoaded) {
      loadSettings();
    }
  }, [settingsLoaded, loadSettings]);

  return { profile, updateProfile };
}
