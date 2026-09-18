import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionItem } from "../../types";

const api = vi.hoisted(() => ({
  getActionItems: vi.fn(),
  getOpenActionItems: vi.fn(),
  getCompletedActionItems: vi.fn(),
  createActionItem: vi.fn(),
  updateActionItem: vi.fn(),
  deleteActionItem: vi.fn(),
  extractActionItems: vi.fn(),
}));
vi.mock("../../api", () => ({ tasksApi: api }));

import { ActionsTab } from "../ActionsTab";
import { TasksView } from "../TasksView";
import { resetTasksUiStore } from "../../stores/tasksUiStore";

let nextId = 100;
function task(partial: Partial<ActionItem>): ActionItem {
  return {
    id: nextId++,
    note_id: "note-1",
    stable_id: "s",
    text: "A task",
    description: null,
    parent_id: null,
    due_date: null,
    done: false,
    sort_order: 0,
    created_at: "2026-07-02T09:00:00.000Z",
    updated_at: "2026-07-02T09:00:00.000Z",
    ...partial,
  };
}

beforeEach(() => {
  resetTasksUiStore();
  Object.values(api).forEach((fn) => fn.mockReset());
  api.updateActionItem.mockImplementation(async (id, text, description, due_date, done) =>
    task({ id, text, description, due_date, done })
  );
  api.createActionItem.mockImplementation(async (note_id, text, due_date, parent_id, description) =>
    task({ note_id, text, due_date, parent_id, description })
  );
  api.deleteActionItem.mockResolvedValue(undefined);
  api.getCompletedActionItems.mockResolvedValue([]);
});

describe("a note's Tasks tab", () => {
  const deck = () => task({ id: 1, text: "Send the deck" });

  async function renderTab(items: ActionItem[]) {
    api.getActionItems.mockResolvedValue(items);
    render(<ActionsTab noteId="note-1" canUseAI={false} />);
    await screen.findByText(items[0].text);
  }

  it("ticks a task", async () => {
    await renderTab([deck()]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Mark as done" }));
    expect(api.updateActionItem).toHaveBeenCalledWith(1, "Send the deck", null, null, true);
    expect(screen.getByRole("checkbox", { name: "Mark as not done" })).toBeTruthy();
  });

  it("deletes from the right-click menu, and Undo brings the task and its subtasks back", async () => {
    const parent = task({ id: 1, text: "Plan the offsite", due_date: "2026-08-01" });
    const subs = [
      task({ id: 2, text: "Book the venue", parent_id: 1, done: true }),
      task({ id: 3, text: "Send invites", parent_id: 1 }),
    ];
    await renderTab([parent, ...subs]);

    fireEvent.contextMenu(screen.getByText("Plan the offsite"));
    fireEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
    await screen.findByText(/task deleted with 2 subtasks/i);
    expect(api.deleteActionItem).toHaveBeenCalledWith(1);
    expect(screen.queryByText("Plan the offsite")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    });
    await screen.findByText("Plan the offsite");

    const [first, ...rest] = api.createActionItem.mock.calls;
    expect(first).toEqual(["note-1", "Plan the offsite", "2026-08-01", null, null]);
    const parentId = (await api.createActionItem.mock.results[0].value).id;
    expect(rest.map((c) => [c[1], c[3]])).toEqual([
      ["Book the venue", parentId],
      ["Send invites", parentId],
    ]);
    // The done subtask comes back done.
    expect(api.updateActionItem).toHaveBeenCalledWith(
      expect.any(Number),
      "Book the venue",
      null,
      null,
      true
    );
  });

  it("Escape closes the menu first, then deselects", async () => {
    await renderTab([deck()]);
    fireEvent.click(screen.getByText("Send the deck"));
    expect(screen.queryByText(/select a task to see its details/i)).toBeNull();

    fireEvent.contextMenu(screen.getByText("Send the deck"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByText(/select a task to see its details/i)).toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByText(/select a task to see its details/i)).toBeTruthy();
  });

  it("a click elsewhere closes the menu", async () => {
    await renderTab([deck()]);
    fireEvent.contextMenu(screen.getByText("Send the deck"));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("saves the detail pane only when something changed", async () => {
    await renderTab([deck()]);
    fireEvent.click(screen.getByText("Send the deck"));
    const title = screen.getByDisplayValue("Send the deck");

    fireEvent.focus(title);
    fireEvent.blur(title);
    expect(api.updateActionItem).not.toHaveBeenCalled();

    fireEvent.change(title, { target: { value: "Send the final deck" } });
    fireEvent.blur(title);
    expect(api.updateActionItem).toHaveBeenCalledOnce();
    expect(api.updateActionItem).toHaveBeenCalledWith(1, "Send the final deck", null, null, false);
  });

  it("adds a task", async () => {
    await renderTab([deck()]);
    const input = screen.getByPlaceholderText("Add a task…");
    fireEvent.change(input, { target: { value: "Ping legal" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(api.createActionItem).toHaveBeenCalledWith("note-1", "Ping legal");
    expect(await screen.findByText("Ping legal")).toBeTruthy();
  });
});

describe("the central Tasks page", () => {
  async function renderPage(items: ActionItem[]) {
    api.getOpenActionItems.mockResolvedValue(items);
    render(<TasksView onOpenInNote={vi.fn()} noteTitles={{ "note-1": "Weekly Sync" }} />);
    await screen.findByText(items[0].text);
  }

  it("ticks, deletes and adds tasks with the same parts", async () => {
    await renderPage([task({ id: 1, text: "Send the deck" }), task({ id: 2, text: "Book a room" })]);

    fireEvent.click(screen.getAllByRole("checkbox", { name: "Mark as done" })[0]);
    expect(api.updateActionItem).toHaveBeenCalledWith(1, "Send the deck", null, null, true);

    fireEvent.contextMenu(screen.getByText("Book a room"));
    fireEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
    await waitFor(() => expect(api.deleteActionItem).toHaveBeenCalledWith(2));
    expect(await screen.findByText("Task deleted")).toBeTruthy();

    const input = screen.getByPlaceholderText("Add a task…");
    fireEvent.change(input, { target: { value: "Standalone thing" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(api.createActionItem).toHaveBeenCalledWith(null, "Standalone thing");
  });

  it("shows which note a task came from", async () => {
    await renderPage([task({ id: 1, text: "Send the deck" })]);
    expect(screen.getByText("Weekly Sync")).toBeTruthy();
  });
});
