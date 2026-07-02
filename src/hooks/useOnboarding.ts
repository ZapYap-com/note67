import { useEffect, useState } from "react";
import { settingsApi } from "../api";

const DISMISSED_KEY = "onboarding_dismissed";

/**
 * Tracks whether the user has dismissed (or completed) the first-run onboarding
 * wizard. `dismissed` is null while the flag is loading so the wizard doesn't
 * flash before we know the persisted state.
 */
export function useOnboarding() {
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    settingsApi
      .get(DISMISSED_KEY)
      .then((value) => {
        if (!cancelled) setDismissed(value === "true");
      })
      .catch(() => {
        if (!cancelled) setDismissed(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = () => {
    setDismissed(true);
    settingsApi.set(DISMISSED_KEY, "true").catch(() => {
      // Non-fatal: the wizard still closes for this session.
    });
  };

  return { dismissed, dismiss };
}
