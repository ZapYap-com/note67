import { describe, expect, it } from "vitest";
import {
  languageName,
  modelSupportsLanguage,
  WHISPER_LANGUAGES,
} from "./whisperStore";

// The 25 languages Parakeet Ultra was trained on, as the backend reports them
// in ModelInfo.languages.
const PARAKEET = [
  "en",
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "ru",
  "uk",
  "hr",
  "sl",
  "lv",
  "lt",
  "et",
  "fi",
  "sv",
  "da",
  "nl",
  "pl",
  "cs",
  "sk",
  "hu",
  "ro",
  "bg",
  "el",
  "mt",
];

const parakeet = { languages: PARAKEET };
const whisper = { languages: null };

describe("modelSupportsLanguage", () => {
  it("lets every Whisper model take any language", () => {
    for (const { code } of WHISPER_LANGUAGES) {
      expect(modelSupportsLanguage(whisper, code)).toBe(true);
    }
  });

  it("refuses the languages Parakeet has no training for", () => {
    // Settings has to say this before the user picks the model, not after a
    // recording comes back as nonsense in the Latin alphabet.
    for (const code of [
      "zh",
      "ja",
      "ko",
      "tr",
      "ar",
      "hi",
      "vi",
      "th",
      "id",
      "ms",
      "tl",
    ]) {
      expect(modelSupportsLanguage(parakeet, code)).toBe(false);
    }
  });

  it("accepts the European languages Parakeet does cover", () => {
    for (const code of ["en", "es", "fr", "de", "pt", "ru", "it", "nl", "pl"]) {
      expect(modelSupportsLanguage(parakeet, code)).toBe(true);
    }
  });

  it("treats auto-detect as supported by every model", () => {
    // Each model detects among its own languages, so there is nothing to warn
    // about: Parakeet picks one of its 25, Whisper one of its 99.
    expect(modelSupportsLanguage(parakeet, "auto")).toBe(true);
    expect(modelSupportsLanguage(whisper, "auto")).toBe(true);
    // An unset language behaves the same rather than reading as unsupported.
    expect(modelSupportsLanguage(parakeet, "")).toBe(true);
  });
});

describe("languageName", () => {
  it("names a language so warnings can say which one", () => {
    expect(languageName("zh")).toBe("Chinese");
    expect(languageName("en")).toBe("English");
  });

  it("falls back to the code for anything not in the list", () => {
    expect(languageName("xx")).toBe("xx");
  });
});
