import { useState, useRef, useEffect, useCallback } from "react";
import { readFile } from "@tauri-apps/plugin-fs";

interface AudioPlayerProps {
  audioPath: string;
  title: string;
}

export function AudioPlayer({ audioPath }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);

  const playbackRates = [0.5, 0.75, 1, 1.25, 1.5, 2];

  const cyclePlaybackRate = () => {
    const currentIndex = playbackRates.indexOf(playbackRate);
    const nextIndex = (currentIndex + 1) % playbackRates.length;
    const newRate = playbackRates[nextIndex];
    setPlaybackRate(newRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = newRate;
    }
  };

  // Load audio file as blob URL
  useEffect(() => {
    let blobUrl: string | null = null;

    const loadAudio = async () => {
      try {
        const data = await readFile(audioPath);
        const blob = new Blob([data], { type: "audio/wav" });
        blobUrl = URL.createObjectURL(blob);
        setAudioSrc(blobUrl);
        setLoadError(null);
      } catch (err) {
        console.error("Failed to load audio:", err);
        setLoadError("Failed to load audio file");
      }
    };

    loadAudio();

    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [audioPath]);

  const formatTime = (seconds: number) => {
    if (!isFinite(seconds) || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    if (audioRef.current && !isDragging) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }
  };

  const seekTo = useCallback((clientX: number) => {
    if (!progressRef.current || !audioRef.current) return;
    const rect = progressRef.current.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const newTime = percent * duration;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  }, [duration]);

  const handleProgressClick = (e: React.MouseEvent) => {
    seekTo(e.clientX);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    seekTo(e.clientX);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        seekTo(e.clientX);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, seekTo]);

  const skip = (seconds: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(
      0,
      Math.min(duration, audioRef.current.currentTime + seconds)
    );
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Show loading or error state
  if (loadError) {
    return (
      <div
        className="border-t px-6 py-3 text-center text-sm"
        style={{
          backgroundColor: "var(--color-bg-elevated)",
          borderColor: "var(--color-border)",
          color: "var(--color-text-tertiary)",
        }}
      >
        {loadError}
      </div>
    );
  }

  if (!audioSrc) {
    return (
      <div
        className="border-t px-6 py-3 text-center text-sm"
        style={{
          backgroundColor: "var(--color-bg-elevated)",
          borderColor: "var(--color-border)",
          color: "var(--color-text-tertiary)",
        }}
      >
        Loading audio...
      </div>
    );
  }

  return (
    <div
      className="border-t px-6 py-3"
      style={{
        backgroundColor: "var(--color-bg-elevated)",
        borderColor: "var(--color-border)",
      }}
    >
      <audio
        ref={audioRef}
        src={audioSrc}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onError={(e) => console.error("Audio error:", e.currentTarget.error, "src:", audioSrc)}
      />

      <div className="flex items-center gap-4">
        {/* Play/Pause - left side */}
        <button
          onClick={togglePlay}
          className="w-9 h-9 rounded-full flex items-center justify-center transition-colors shrink-0"
          style={{
            backgroundColor: "var(--color-text)",
            color: "var(--color-bg)",
          }}
        >
          {isPlaying ? (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Progress bar - takes remaining space */}
        <div className="flex-1 flex items-center gap-2">
          <span
            className="text-xs tabular-nums w-10 text-right"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            {formatTime(currentTime)}
          </span>
          <div
            ref={progressRef}
            className="flex-1 h-1 rounded-full cursor-pointer group relative"
            style={{ backgroundColor: "var(--color-bg-subtle)" }}
            onClick={handleProgressClick}
            onMouseDown={handleMouseDown}
          >
            <div
              className="h-full rounded-full relative"
              style={{
                width: `${progress}%`,
                backgroundColor: "var(--color-text)",
              }}
            >
              <div
                className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                style={{
                  backgroundColor: "var(--color-text)",
                  transform: "translate(50%, -50%)",
                }}
              />
            </div>
          </div>
          <span
            className="text-xs tabular-nums w-10"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            {formatTime(duration)}
          </span>
        </div>

        {/* Controls - right side */}
        <div className="flex items-center gap-1">
          {/* Skip back 10s */}
          <button
            onClick={() => skip(-10)}
            className="p-1.5 rounded-full hover:bg-black/5 transition-colors"
            style={{ color: "var(--color-text-secondary)" }}
            title="Back 10 seconds"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z"
              />
            </svg>
          </button>

          {/* Skip forward 10s */}
          <button
            onClick={() => skip(10)}
            className="p-1.5 rounded-full hover:bg-black/5 transition-colors"
            style={{ color: "var(--color-text-secondary)" }}
            title="Forward 10 seconds"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z"
              />
            </svg>
          </button>

          {/* Playback speed */}
          <button
            onClick={cyclePlaybackRate}
            className="px-2 py-1 rounded-md hover:bg-black/5 transition-colors text-xs font-medium min-w-[3rem]"
            style={{ color: "var(--color-text-secondary)" }}
            title="Playback speed"
          >
            {playbackRate}x
          </button>
        </div>
      </div>
    </div>
  );
}
