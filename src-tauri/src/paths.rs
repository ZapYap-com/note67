//! Checks for path parts that arrive over IPC.
//!
//! Commands join note ids into file names under the app data folder, and
//! `PathBuf::join` with an absolute path replaces the base: a note id of
//! "/Users/x" or "../recordings" pointed `delete_note_attachments` at that
//! folder. The app isn't sandboxed, so these checks are what keeps a
//! compromised webview inside the app's own files.

use std::path::Path;

use uuid::Uuid;

/// Note ids are hyphenated UUIDs (`create_note`). Anything else is refused
/// before it can reach a path.
pub fn validate_note_id(note_id: &str) -> Result<(), String> {
    // 36 characters is only the hyphenated form; parse_str also takes the
    // braced and urn forms, which contain characters that don't belong in a
    // file name.
    if note_id.len() == 36 && Uuid::parse_str(note_id).is_ok() {
        Ok(())
    } else {
        Err("Invalid note id".to_string())
    }
}

/// Whether `path` names something inside `dir` once `..` and symlinks are
/// resolved. A file that doesn't exist yet is judged by its parent folder.
pub fn is_inside(dir: &Path, path: &Path) -> bool {
    let Ok(dir) = dir.canonicalize() else {
        return false;
    };
    let resolved = match path.canonicalize() {
        Ok(p) => p,
        Err(_) => match (path.parent(), path.file_name()) {
            (Some(parent), Some(name)) => match parent.canonicalize() {
                Ok(parent) => parent.join(name),
                Err(_) => return false,
            },
            _ => return false,
        },
    };
    resolved != dir && resolved.starts_with(&dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn note_ids_must_be_hyphenated_uuids() {
        assert!(validate_note_id(&Uuid::new_v4().to_string()).is_ok());
        for bad in [
            "",
            "..",
            "../recordings",
            "/Users/x",
            "C:\\Users\\x",
            "n1",
            "{67e55044-10b1-426f-9247-bb680e5fe0c8}",
            "urn:uuid:67e55044-10b1-426f-9247-bb680e5fe0c8",
            "67e5504410b1426f9247bb680e5fe0c8",
            "67e55044-10b1-426f-9247-bb680e5fe0c8/../../x",
        ] {
            assert!(validate_note_id(bad).is_err(), "accepted {bad:?}");
        }
    }

    #[test]
    fn is_inside_resolves_traversal_and_symlinks() {
        let root = std::env::temp_dir().join(format!("note67-paths-{}", Uuid::new_v4()));
        let dir = root.join("recordings");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.wav"), b"").unwrap();
        std::fs::write(root.join("secret.txt"), b"").unwrap();

        assert!(is_inside(&dir, &dir.join("a.wav")));
        assert!(is_inside(&dir, &dir.join("not-yet.wav")));
        assert!(!is_inside(&dir, &dir));
        assert!(!is_inside(&dir, &dir.join("../secret.txt")));
        assert!(!is_inside(&dir, &root.join("secret.txt")));
        assert!(!is_inside(&dir, &dir.join("..")));
        assert!(!is_inside(&dir, &dir.join("missing/x.wav")));

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.join("secret.txt"), dir.join("link.wav")).unwrap();
            assert!(!is_inside(&dir, &dir.join("link.wav")));
        }

        std::fs::remove_dir_all(&root).unwrap();
    }
}
