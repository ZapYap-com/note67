import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * Upload an image file and save it locally to the note's attachments folder.
 * Returns a URL that can be used in the markdown editor.
 */
export async function uploadImage(
  noteId: string,
  file: File | Blob
): Promise<string> {
  // Convert file to array buffer
  const arrayBuffer = await file.arrayBuffer();
  const imageData = Array.from(new Uint8Array(arrayBuffer));

  // Determine filename
  const filename = file instanceof File ? file.name : "pasted-image.png";

  // Save image via Tauri command
  const filePath = await invoke<string>("save_image", {
    noteId,
    imageData,
    filename,
  });

  // Convert local file path to asset URL that can be displayed
  const assetUrl = convertFileSrc(filePath);

  return assetUrl;
}

/**
 * Delete all attachments for a note (call when note is deleted)
 */
export async function deleteNoteAttachments(noteId: string): Promise<void> {
  await invoke("delete_note_attachments", { noteId });
}
