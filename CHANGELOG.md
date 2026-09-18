# Changelog

Release notes for Note67. The section for a version becomes its GitHub
release notes and the notes shown by the in-app updater, so write it for
the people using the app.

Earlier versions are listed on the
[GitHub releases page](https://github.com/ZapYap-com/note67/releases).

## [0.1.28] - Unreleased

Cleanup, and fixes to the features Note67 is keeping: tasks, uploaded
audio, meeting detection and launch at login.

### Changed

- Meeting detection can be turned off (Settings > System), and the setting
  is remembered. It prompts once per call instead of again whenever the
  call's window title changes, never during a recording, and the prompt
  goes away a couple of minutes after the call ends (switching tabs during
  the call doesn't end it). Having Teams or Discord open no longer counts
  as being in a meeting. If Screen Recording permission is missing, the
  setting says so.
- The meeting prompt now shows even when Note67's window is closed to the
  menu bar.
- Uploaded audio is transcribed as soon as it's added, when a
  transcription model is loaded.
- Deleting a task can be undone for a few seconds, subtasks included.
  Deleting a note tells you how many tasks go with it.
- Overdue tasks are highlighted in a note's Tasks tab too, and task
  checkboxes work with the keyboard and screen readers.

### Fixed

- Stopping a recording while an upload was still being transcribed skipped
  the recording's final, higher-quality transcription. It now waits its turn.
- After Note67 started at login, its window couldn't be brought back by
  reloading.
- Clicking through a task's details no longer marks it as edited.
- When Retranscribe fails, Note67 now says why (the transcript you had is
  kept), and imported files are no longer marked as transcribed when their
  new transcript was discarded. Errors about imported files say whether
  adding, transcribing or deleting the file failed.

### Under the hood

- About 2,500 lines of unused code, 33 unused internal commands and five
  unused libraries removed.

## [0.1.27] - Unreleased

A reliability release: fixes for crashes and for ways a recording, its
transcript or your notes could be lost.

### Fixed

- The app could quit right after a recording when the summary contained
  Chinese, Japanese or Korean text, or an em dash or emoji in the wrong place.
- Opening a note could quit the app when another note mentioned its title
  near non-English text. The "unlinked mentions" panel that caused this is
  removed; it was going away in 0.2.
- A microphone-only recording could end with an empty transcript, and
  pausing one lost everything recorded before the pause.
- Continuing an older recording could overwrite it.
- Non-English meetings were re-transcribed in English after you pressed Stop.
  The transcription language setting is now used everywhere.
- Notes typed during a meeting are saved as you type, not only when you
  click away, and they are saved before the summary is written. A save that
  fails is tried again instead of being dropped.
- Clearing a note's text now sticks.
- Starting a second recording while one was running (or paused) could file
  the first meeting's audio under the wrong note. Only one recording can
  run at a time now.
- Recording no longer needs Ollama. You only need a transcription model;
  Ollama adds summaries, titles and tasks when it's running. If you start
  Ollama after Note67, it's picked up without choosing your model again.
- Summarize no longer renames notes you've titled yourself, including a
  title you type while the summary is being written.
- Search works with hyphens, apostrophes, dots and email addresses.
- Finding tasks in a long meeting now reads the whole meeting, and running
  it again doesn't add the same tasks twice. Tasks you add yourself no
  longer get today's date and turn overdue the next day.
- Uploaded audio can be played and transcribed on notes that have no
  recording of their own, and a failed transcription no longer blocks
  transcription until you restart. Mono .m4a files (such as voice memos)
  are converted at full length instead of half. Opus files (.webm, some
  .ogg) aren't supported yet and now say so.
- Right-click in the editor shows the normal Cut, Copy, Paste and spelling
  menu. New notes open on the Note tab, and search results open from
  anywhere, including the Tasks page.

### Coming in 0.2

Note67 is narrowing its focus to meeting notes: recording, transcripts,
summaries and tasks. The graph view, hashtags, backlinks, the Cmd+J writing
sidebar and PDF export are being removed (Markdown export stays). Nothing
you wrote is deleted: `[[links]]` and `#tags` stay in your notes as text,
and links still open the note they name.
