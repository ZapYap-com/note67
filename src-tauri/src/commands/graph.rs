use serde::Serialize;
use std::collections::HashMap;
use tauri::State;

use crate::db::Database;

#[derive(Debug, Serialize)]
pub struct GraphNode {
    pub id: String,
    pub title: String,
    pub link_count: i32,
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
pub fn get_graph_data(db: State<Database>) -> Result<GraphData, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Get all notes as nodes
    let mut stmt = conn
        .prepare("SELECT id, title FROM notes")
        .map_err(|e| e.to_string())?;

    let nodes: Vec<GraphNode> = stmt
        .query_map([], |row| {
            Ok(GraphNode {
                id: row.get(0)?,
                title: row.get(1)?,
                link_count: 0,
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

    // Update nodes with link counts
    let nodes: Vec<GraphNode> = nodes
        .into_iter()
        .map(|mut n| {
            n.link_count = *link_counts.get(&n.id).unwrap_or(&0);
            n
        })
        .collect();

    Ok(GraphData { nodes, edges })
}
