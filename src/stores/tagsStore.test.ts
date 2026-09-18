import { describe, it, expect, beforeEach, vi } from "vitest";

import { useTagsStore } from "./tagsStore";
import { tagsApi } from "../api/tags";

vi.mock("../api/tags", () => ({
  tagsApi: {
    getAll: vi.fn(),
    getAllNoteTags: vi.fn(),
    deleteTag: vi.fn(),
  },
}));

const api = vi.mocked(tagsApi, true);

const initialState = useTagsStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useTagsStore.setState(initialState, true);
  api.getAll.mockResolvedValue([]);
  api.getAllNoteTags.mockResolvedValue({});
});

describe("tagsStore.getTagColor", () => {
  const { getTagColor } = useTagsStore.getState();

  it("is stable for the same tag name", () => {
    expect(getTagColor("design")).toBe(getTagColor("design"));
  });

  it("always returns a colour from the palette", () => {
    const names = ["a", "design", "Q3-planning", "", "ünïcode", "a".repeat(200)];
    for (const name of names) {
      expect(getTagColor(name)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("maps into a fixed 10-colour palette, so distinct tags may collide", () => {
    // The colour is `hash(name) % PALETTE.length`, i.e. a bucket — not a unique
    // per-tag colour. Pinned because it is easy to mistake for a 1:1 mapping:
    // "Design" and "design" hash differently yet land in the same bucket.
    const many = Array.from({ length: 60 }, (_, i) => `tag-${i}`);
    const distinct = new Set(many.map(getTagColor));
    expect(distinct.size).toBeLessThanOrEqual(10);
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("spreads common tag names across more than one colour", () => {
    const names = ["design", "eng", "product", "ops", "sales", "legal"];
    const distinct = new Set(names.map(getTagColor));
    expect(distinct.size).toBeGreaterThan(1);
  });
});

describe("tagsStore.getTagsForNote", () => {
  it("returns the tags mapped to a note", () => {
    const noteTag = { id: 1, name: "design", color: null };
    useTagsStore.setState({ noteTagsMap: { n1: [noteTag] } });

    expect(useTagsStore.getState().getTagsForNote("n1")).toEqual([noteTag]);
  });

  it("returns an empty array for a note with no tags", () => {
    expect(useTagsStore.getState().getTagsForNote("missing")).toEqual([]);
  });
});

describe("tagsStore.fetchTags", () => {
  it("loads tags and the note-tag map together", async () => {
    const tags = [{ id: 1, name: "design", color: null, note_count: 3 }];
    api.getAll.mockResolvedValue(tags);
    api.getAllNoteTags.mockResolvedValue({ n1: [] });

    await useTagsStore.getState().fetchTags();

    const state = useTagsStore.getState();
    expect(state.tags).toEqual(tags);
    expect(state.noteTagsMap).toEqual({ n1: [] });
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("records the error and clears loading on failure", async () => {
    api.getAll.mockRejectedValue(new Error("boom"));

    await useTagsStore.getState().fetchTags();

    const state = useTagsStore.getState();
    expect(state.error).toContain("boom");
    expect(state.loading).toBe(false);
  });
});

describe("tagsStore selection", () => {
  it("selects and clears a tag", () => {
    useTagsStore.getState().selectTag("design");
    expect(useTagsStore.getState().selectedTag).toBe("design");

    useTagsStore.getState().clearSelection();
    expect(useTagsStore.getState().selectedTag).toBeNull();
  });
});
