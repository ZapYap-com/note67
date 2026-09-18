use serde::Serialize;
use std::collections::HashMap;
use tauri::State;

use crate::db::Database;

#[derive(Debug, Serialize)]
pub struct GraphNode {
    pub id: String,
    pub title: String,
    pub link_count: i32,
    pub tags: Vec<String>,
    pub is_orphan: bool,
}

#[derive(Debug, Serialize)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Serialize)]
pub struct GraphData {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

/// Get graph data for visualization
/// Returns all notes as nodes and all links as edges
#[tauri::command]
pub fn get_graph_data(
    db: State<Database>,
    include_orphans: Option<bool>,
) -> Result<GraphData, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let include_orphans = include_orphans.unwrap_or(true);

    // Get all notes as nodes
    let mut stmt = conn
        .prepare("SELECT id, title FROM notes")
        .map_err(|e| e.to_string())?;

    let mut nodes: Vec<GraphNode> = stmt
        .query_map([], |row| {
            Ok(GraphNode {
                id: row.get(0)?,
                title: row.get(1)?,
                link_count: 0,
                tags: vec![],
                is_orphan: true,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Get all links as edges (only where target exists)
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT source_note_id, target_note_id
             FROM note_links
             WHERE target_note_id IS NOT NULL",
        )
        .map_err(|e| e.to_string())?;

    let edges: Vec<GraphEdge> = stmt
        .query_map([], |row| {
            Ok(GraphEdge {
                source: row.get(0)?,
                target: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Calculate link counts for each node
    let mut link_counts: HashMap<String, i32> = HashMap::new();
    for edge in &edges {
        *link_counts.entry(edge.source.clone()).or_insert(0) += 1;
        *link_counts.entry(edge.target.clone()).or_insert(0) += 1;
    }

    // Get tags for each note (join with tags table to get tag name)
    let mut stmt = conn
        .prepare(
            "SELECT nt.note_id, t.name FROM note_tags nt
             INNER JOIN tags t ON nt.tag_id = t.id"
        )
        .map_err(|e| e.to_string())?;

    let mut note_tags: HashMap<String, Vec<String>> = HashMap::new();
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;

    for row in rows.filter_map(|r| r.ok()) {
        note_tags.entry(row.0).or_default().push(row.1);
    }

    // Update nodes with link counts, tags, and orphan status
    for node in &mut nodes {
        node.link_count = *link_counts.get(&node.id).unwrap_or(&0);
        node.tags = note_tags.get(&node.id).cloned().unwrap_or_default();
        node.is_orphan = node.link_count == 0;
    }

    // Filter orphans if requested
    if !include_orphans {
        nodes.retain(|n| !n.is_orphan);
    }

    Ok(GraphData { nodes, edges })
}

