import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useModels, useOllama } from "../../hooks";
import { LogoImage } from "../LogoImage";

interface OnboardingWizardProps {
  /** Called when the user skips or finishes. Persists the dismissed flag. */
  onDismiss: () => void;
  /** Called after any permission change so the parent can refresh its status. */
  onStatusChange?: () => void;
}

interface PermState {
  micAvailable: boolean;
  micPermission: boolean;
  micAuthStatus: number; // 0 NotDetermined, 1 Restricted, 2 Denied, 3 Authorized
  systemAudioSupported: boolean;
  systemAudioPermission: boolean;
  loaded: boolean;
}

const INITIAL_PERMS: PermState = {
  micAvailable: false,
  micPermission: false,
  micAuthStatus: 0,
  systemAudioSupported: false,
  systemAudioPermission: false,
  loaded: false,
};

const RECOMMENDED_WHISPER = "large-turbo";

// Query permission status. Module-level (no React state) so both the mount
// effect and the manual refresh can share it without setting state directly
// in the effect body.
async function fetchPerms(): Promise<PermState> {
  const [micAvailable, micPermission, micAuthStatus, systemAudioSupported] =
    await Promise.all([
      invoke<boolean>("has_microphone_available"),
      invoke<boolean>("has_microphone_permission"),
      invoke<number>("get_microphone_auth_status"),
      invoke<boolean>("is_system_audio_supported"),
    ]);
  let systemAudioPermission = false;
  if (systemAudioSupported) {
    systemAudioPermission = await invoke<boolean>("has_system_audio_permission");
  }
  return {
    micAvailable,
    micPermission,
    micAuthStatus,
    systemAudioSupported,
    systemAudioPermission,
    loaded: true,
  };
}

export function OnboardingWizard({ onDismiss, onStatusChange }: OnboardingWizardProps) {
  const {
    models,
    loadedModel,
    isDownloading,
    downloadingModel,
    downloadProgress,
    downloadModel,
    loadModel,
  } = useModels();
  const {
    isRunning: ollamaRunning,
    models: ollamaModels,
    selectedModel: ollamaModel,
    selectModel,
    checkStatus: checkOllama,
    loading: ollamaLoading,
  } = useOllama();

  const [perms, setPerms] = useState<PermState>(INITIAL_PERMS);
  const [busy, setBusy] = useState(false);

  const refreshPerms = async () => {
    try {
      const next = await fetchPerms();
      setPerms(next);
      onStatusChange?.();
    } catch (err) {
      console.error("Failed to check permissions:", err);
      setPerms((prev) => ({ ...prev, loaded: true }));
    }
  };

  // Initial permission check. Inlined so setState only runs in the async
  // continuation, not synchronously in the effect body.
  useEffect(() => {
    let cancelled = false;
    fetchPerms()
      .then((next) => {
        if (!cancelled) setPerms(next);
      })
      .catch((err) => {
        console.error("Failed to check permissions:", err);
        if (!cancelled) setPerms((prev) => ({ ...prev, loaded: true }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Derived per-step completion.
  const whisperDone = !!loadedModel;
  const ollamaDone = ollamaRunning && !!ollamaModel;
  const micDone = !perms.micAvailable || perms.micPermission;
  const screenDone = perms.systemAudioPermission;

  // Steps that apply on this platform (screen audio is macOS-only).
  const steps = [
    { key: "whisper", label: "Transcription", done: whisperDone },
    { key: "ollama", label: "Assistant", done: ollamaDone },
    { key: "mic", label: "Microphone", done: micDone },
    ...(perms.systemAudioSupported
      ? [{ key: "screen", label: "Screen Audio", done: screenDone }]
      : []),
  ];

  const [current, setCurrent] = useState(0);
  const [stepInitialized, setStepInitialized] = useState(false);

  // Land on the first unmet step once data has loaded (only once). Adjusting
  // state during render (guarded by stepInitialized) avoids an init effect.
  if (!stepInitialized && models.length > 0 && perms.loaded) {
    setStepInitialized(true);
    const firstUndone = steps.findIndex((s) => !s.done);
    setCurrent(firstUndone === -1 ? steps.length : firstUndone);
  }

  const allDone = steps.every((s) => s.done);
  const isComplete = current >= steps.length;
  const step = steps[current];

  const goNext = () => setCurrent((c) => Math.min(c + 1, steps.length));
  const goBack = () => setCurrent((c) => Math.max(c - 1, 0));

  // --- Permission actions ---
  const requestMic = async () => {
    setBusy(true);
    try {
      await invoke<boolean>("request_microphone_permission");
    } catch (err) {
      console.error("Failed to request mic permission:", err);
    } finally {
      await refreshPerms();
      setBusy(false);
    }
  };
  const openMicSettings = () => invoke("open_microphone_settings").catch(console.error);
  const openScreenSettings = () =>
    invoke("open_screen_recording_settings").catch(console.error);

  const recommendedModel = models.find((m) => m.size === RECOMMENDED_WHISPER);
  const recommendedOllama = ollamaModels.find((m) =>
    m.name.toLowerCase().startsWith("gemma4")
  );
  const generativeOllama = ollamaModels.filter(
    (m) => !/embed|minilm/i.test(m.name)
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
    >
      <div
        className="w-full max-w-lg rounded-2xl overflow-hidden flex flex-col"
        style={{
          backgroundColor: "var(--color-bg-elevated)",
          boxShadow: "var(--shadow-lg)",
          maxHeight: "90vh",
        }}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 text-center">
          <LogoImage className="w-24 h-auto mx-auto mb-3" />
          <h1 className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>
            {isComplete ? "You're all set" : "Welcome to Note67"}
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--color-text-secondary)" }}>
            {isComplete
              ? "Everything you need to record your first meeting is ready."
              : "A couple of quick steps to get you recording — all local, all private."}
          </p>
        </div>

        {/* Progress rail */}
        <div className="px-6 pb-4 flex items-center justify-center gap-2">
          {steps.map((s, i) => (
            <button
              key={s.key}
              onClick={() => setCurrent(i)}
              className="flex items-center gap-1.5"
              title={s.label}
            >
              <span
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-colors"
                style={{
                  backgroundColor: s.done
                    ? "rgba(34,197,94,0.15)"
                    : i === current
                      ? "var(--color-accent)"
                      : "var(--color-bg-subtle)",
                  color: s.done
                    ? "#16a34a"
                    : i === current
                      ? "white"
                      : "var(--color-text-tertiary)",
                }}
              >
                {s.done ? "✓" : i + 1}
              </span>
              {i < steps.length - 1 && (
                <span
                  className="w-5 h-px"
                  style={{ backgroundColor: "var(--color-border)" }}
                />
              )}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="px-6 pb-2 overflow-y-auto flex-1">
          {isComplete ? (
            <CompleteBody allDone={allDone} />
          ) : step?.key === "whisper" ? (
            <StepShell
              title="Download a transcription model"
              desc="Note67 turns speech into text on your device with Whisper. We recommend the balanced Turbo model."
              done={whisperDone}
              doneLabel="Transcription model ready"
            >
              {recommendedModel ? (
                <ActionRow
                  title={`Whisper ${recommendedModel.name} · ${recommendedModel.size_mb} MB`}
                  subtitle="Fast and accurate — the recommended default."
                >
                  {loadedModel ? (
                    <DoneChip />
                  ) : recommendedModel.downloaded ? (
                    <PrimaryBtn onClick={() => loadModel(recommendedModel.size)}>
                      Use this model
                    </PrimaryBtn>
                  ) : (
                    <PrimaryBtn
                      onClick={() => downloadModel(recommendedModel.size)}
                      disabled={isDownloading}
                    >
                      {isDownloading && downloadingModel === recommendedModel.size
                        ? `${downloadProgress}%`
                        : "Download"}
                    </PrimaryBtn>
                  )}
                </ActionRow>
              ) : (
                <p className="text-sm" style={{ color: "var(--color-text-tertiary)" }}>
                  Loading models…
                </p>
              )}
              <p className="text-xs mt-2" style={{ color: "var(--color-text-tertiary)" }}>
                You can pick a different size later in Settings → Whisper.
              </p>
            </StepShell>
          ) : step?.key === "ollama" ? (
            <StepShell
              title="Connect a local AI assistant"
              desc="Ollama runs a local model to write summaries and action items. It stays on your machine."
              done={ollamaDone}
              doneLabel={`Using ${ollamaModel ?? "a model"}`}
            >
              {!ollamaRunning ? (
                <div>
                  <p className="text-sm mb-3" style={{ color: "var(--color-text-secondary)" }}>
                    Ollama isn't running yet. Install it, then check again.
                  </p>
                  <div className="flex items-center gap-2">
                    <a
                      href="https://note67.com/ollama-setup"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 text-sm font-medium rounded-lg"
                      style={{ backgroundColor: "var(--color-accent)", color: "white" }}
                    >
                      Setup guide
                    </a>
                    <SecondaryBtn onClick={() => checkOllama()} disabled={ollamaLoading}>
                      {ollamaLoading ? "Checking…" : "Check again"}
                    </SecondaryBtn>
                  </div>
                </div>
              ) : generativeOllama.length === 0 ? (
                <div>
                  <p className="text-sm mb-3" style={{ color: "var(--color-text-secondary)" }}>
                    Ollama is running, but no models are installed. Pull one (we
                    recommend <strong>gemma4</strong>), then check again.
                  </p>
                  <div className="flex items-center gap-2">
                    <a
                      href="https://note67.com/ollama-setup"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 text-sm font-medium rounded-lg"
                      style={{ backgroundColor: "var(--color-accent)", color: "white" }}
                    >
                      How to pull a model
                    </a>
                    <SecondaryBtn onClick={() => checkOllama()} disabled={ollamaLoading}>
                      {ollamaLoading ? "Checking…" : "Check again"}
                    </SecondaryBtn>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {recommendedOllama && !ollamaModel && (
                    <p className="text-xs mb-1" style={{ color: "var(--color-text-tertiary)" }}>
                      Pick the model to use for summaries.
                    </p>
                  )}
                  {generativeOllama.map((m) => (
                    <button
                      key={m.name}
                      onClick={() => selectModel(m.name)}
                      className="w-full flex items-center gap-2.5 p-2.5 rounded-lg text-left transition-colors"
                      style={{
                        backgroundColor:
                          ollamaModel === m.name
                            ? "rgba(34,197,94,0.06)"
                            : "var(--color-bg-subtle)",
                        border:
                          ollamaModel === m.name
                            ? "1px solid rgba(34,197,94,0.25)"
                            : "1px solid transparent",
                      }}
                    >
                      <span
                        className="w-4 h-4 rounded-full shrink-0 flex items-center justify-center"
                        style={{
                          backgroundColor:
                            ollamaModel === m.name ? "var(--color-accent)" : "transparent",
                          border:
                            ollamaModel === m.name
                              ? "none"
                              : "2px solid var(--color-border)",
                        }}
                      >
                        {ollamaModel === m.name && (
                          <span className="text-white text-[10px]">✓</span>
                        )}
                      </span>
                      <span className="text-sm flex-1 truncate" style={{ color: "var(--color-text)" }}>
                        {m.name}
                      </span>
                      {m.name.toLowerCase().startsWith("gemma4") && (
                        <span
                          className="text-xs px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: "var(--color-accent-light)", color: "var(--color-accent)" }}
                        >
                          Recommended
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </StepShell>
          ) : step?.key === "mic" ? (
            <StepShell
              title="Allow microphone access"
              desc="This lets Note67 capture your voice during a meeting."
              done={micDone}
              doneLabel={perms.micAvailable ? "Microphone enabled" : "No microphone — system audio only"}
            >
              {!perms.micAvailable ? (
                <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                  No microphone detected. You can still record system audio in
                  listen-only mode.
                </p>
              ) : perms.micPermission ? (
                <DoneChip />
              ) : perms.micAuthStatus === 0 ? (
                <PrimaryBtn onClick={requestMic} disabled={busy}>
                  {busy ? "Requesting…" : "Request permission"}
                </PrimaryBtn>
              ) : (
                <div className="flex items-center gap-2">
                  <PrimaryBtn onClick={openMicSettings}>Open Settings</PrimaryBtn>
                  <SecondaryBtn onClick={refreshPerms}>Refresh</SecondaryBtn>
                </div>
              )}
            </StepShell>
          ) : step?.key === "screen" ? (
            <StepShell
              title="Allow screen recording (optional)"
              desc="Only needed to capture other participants' voices. Skip if you only record yourself."
              done={screenDone}
              doneLabel="System audio enabled"
            >
              {perms.systemAudioPermission ? (
                <DoneChip />
              ) : (
                <div className="flex items-center gap-2">
                  <PrimaryBtn onClick={openScreenSettings}>Open Settings</PrimaryBtn>
                  <SecondaryBtn onClick={refreshPerms}>Refresh</SecondaryBtn>
                </div>
              )}
            </StepShell>
          ) : null}
        </div>

        {/* Footer */}
        <div
          className="px-6 py-4 flex items-center justify-between border-t"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            onClick={onDismiss}
            className="text-sm transition-colors"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            {isComplete ? "" : "Skip for now"}
          </button>
          <div className="flex items-center gap-2">
            {current > 0 && !isComplete && (
              <SecondaryBtn onClick={goBack}>Back</SecondaryBtn>
            )}
            {isComplete ? (
              <PrimaryBtn onClick={onDismiss}>Start recording</PrimaryBtn>
            ) : (
              <PrimaryBtn onClick={goNext}>
                {current === steps.length - 1 ? "Finish" : step?.done ? "Next" : "Skip step"}
              </PrimaryBtn>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StepShell({
  title,
  desc,
  done,
  doneLabel,
  children,
}: {
  title: string;
  desc: string;
  done: boolean;
  doneLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-2">
      <h2 className="text-base font-semibold mb-1" style={{ color: "var(--color-text)" }}>
        {title}
      </h2>
      <p className="text-sm mb-4" style={{ color: "var(--color-text-secondary)" }}>
        {desc}
      </p>
      {done ? (
        <div
          className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium"
          style={{ backgroundColor: "rgba(34,197,94,0.1)", color: "#16a34a" }}
        >
          <span>✓</span>
          {doneLabel}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

function ActionRow({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 p-3 rounded-xl"
      style={{ backgroundColor: "var(--color-bg-subtle)" }}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>
          {title}
        </p>
        <p className="text-xs truncate" style={{ color: "var(--color-text-tertiary)" }}>
          {subtitle}
        </p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function PrimaryBtn({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-4 py-1.5 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
      style={{ backgroundColor: "var(--color-accent)", color: "white" }}
    >
      {children}
    </button>
  );
}

function SecondaryBtn({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
      style={{
        backgroundColor: "var(--color-bg-subtle)",
        color: "var(--color-text-secondary)",
        border: "1px solid var(--color-border)",
      }}
    >
      {children}
    </button>
  );
}

function DoneChip() {
  return (
    <span
      className="px-3 py-1.5 text-xs font-medium rounded-lg"
      style={{ backgroundColor: "rgba(34,197,94,0.15)", color: "#16a34a" }}
    >
      Enabled
    </span>
  );
}

function CompleteBody({ allDone }: { allDone: boolean }) {
  return (
    <div className="py-4 text-center">
      <div
        className="w-14 h-14 rounded-full mx-auto flex items-center justify-center text-2xl mb-3"
        style={{ backgroundColor: "rgba(34,197,94,0.12)", color: "#16a34a" }}
      >
        ✓
      </div>
      <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
        {allDone
          ? "Press ⌘R (or “Start listening”) to record your first meeting."
          : "You can finish any remaining setup anytime in Settings."}
      </p>
    </div>
  );
}
