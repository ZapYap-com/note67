# Changelog

Release notes for Note67. The section for a version becomes its GitHub
release notes and the notes shown by the in-app updater, so write it for
the people using the app.

Earlier versions are listed on the
[GitHub releases page](https://github.com/ZapYap-com/note67/releases).

## [0.1.29] - 2026-11-01

A security release, and every library Note67 is built on brought up to
date.

### Security

- Note67's window could ask the app to read, write or delete files outside
  Note67's own folders, for example to delete a folder in your home
  directory or save a file somewhere it would run at login. Only HTML that
  managed to run code in the window could have done this. Each of those
  requests is now checked: a note's recordings and images stay in Note67's
  folders, deleting a note deletes only its own recording, and importing
  audio reads only the file you picked.
- Transcription models are checked against their published checksum after
  downloading. A failed download used to be saved as the model, and the
  model then counted as downloaded.
- The editor components that handle pasted content are updated for a
  cross-site scripting advisory, along with the HTML sanitizer they use.
- The secure-connection libraries (rustls) are updated for advisories that
  could weaken connections, and the updater's archive library for unsafe
  extraction.

### Changed

- Only images can be pasted into a note: PNG, JPEG, GIF, WebP, BMP and
  AVIF. Other files, including SVG, are refused.

### Fixed

- Microphones that deliver only 24- or 32-bit audio can record. They used
  to fail with an unsupported-format error.
- A transcript no longer fails when Whisper splits a character, such as
  Chinese, Japanese, Korean or an emoji, across two lines.
- Imported MP3 and Ogg files convert to their exact length, without the
  encoder's padding at the end.
- Saving a PDF export that fails now says so, instead of waiting forever.

### Under the hood

- Tauri 2.12, SQLite 3.54, a newer whisper.cpp, and updated audio
  recording, decoding and Windows system-audio libraries.
- Note67 no longer bundles OpenSSL: all secure connections use one library.

## [0.1.28] - 2026-09-19

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
- Images from the web no longer load in notes or summaries, so Note67
  makes no requests for them, and an AI summary can't use one to send your
  notes somewhere. Images you paste into a note are stored with it and
  still show.

### Fixed

- Stopping a recording while an upload was still being transcribed skipped
  the recording's final, higher-quality transcription. It now waits its turn.
- After Note67 started at login, its window couldn't be brought back by
  reloading.
- Clicking through a task's details no longer marks it as edited.
- Links in summaries open in your browser. They used to load the website
  inside Note67's window, in place of the app.
- The links in Settings and in first-run setup (such as the Ollama
  download) open in your browser again. They had done nothing since 0.1.22.
- When Retranscribe fails, Note67 now says why (the transcript you had is
  kept), and imported files are no longer marked as transcribed when their
  new transcript was discarded. Errors about imported files say whether
  adding, transcribing or deleting the file failed.

### Under the hood

- About 2,500 lines of unused code, 33 unused internal commands and five
  unused libraries removed.
- The secure-connection library the updater uses (rustls) is updated for a
  security advisory (RUSTSEC-2026-0285).
- Note67's window can reach less of your disk: it reads only your
  recordings and saves only where you choose. It could read and write
  anything in Note67's data folder before, including the notes database.
- Note67's window has a Content Security Policy, so HTML that ends up in a
  note, a transcript or an AI summary can't run code.
- HTML in AI summaries is cleaned before it's shown, so a summary can't
  hide parts of the app, embed a page or send the window somewhere else.

## [0.1.27] - Included in 0.1.28

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
