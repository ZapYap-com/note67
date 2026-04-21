use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};
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

    // Get tags for each note
    let mut stmt = conn
        .prepare("SELECT note_id, tag FROM note_tags")
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

/// Get local graph centered on a specific note
/// Returns nodes within specified depth from the center note
#[tauri::command]
pub fn get_local_graph(
    db: State<Database>,
    note_id: String,
    depth: Option<i32>,
) -> Result<GraphData, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let depth = depth.unwrap_or(1);

    // BFS to find connected notes up to depth
    let mut visited: HashSet<String> = HashSet::new();
    let mut queue: VecDeque<(String, i32)> = VecDeque::new();

    visited.insert(note_id.clone());
    queue.push_back((note_id.clone(), 0));

    // Get all links for BFS
    let mut stmt = conn
        .prepare(
            "SELECT source_note_id, target_note_id FROM note_links WHERE target_note_id IS NOT NULL",
        )
        .map_err(|e| e.to_string())?;

    let all_links: Vec<(String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Build adjacency list (bidirectional)
    let mut adj: HashMap<String, Vec<String>> = HashMap::new();
    for (source, target) in &all_links {
        adj.entry(source.clone()).or_default().push(target.clone());
        adj.entry(target.clone()).or_default().push(source.clone());
    }

    // BFS traversal
    while let Some((current, current_depth)) = queue.pop_front() {
        if current_depth >= depth {
            continue;
        }
        if let Some(neighbors) = adj.get(&current) {
            for neighbor in neighbors {
                if !visited.contains(neighbor) {
                    visited.insert(neighbor.clone());
                    queue.push_back((neighbor.clone(), current_depth + 1));
                }
            }
        }
    }

    // Get node data for visited nodes
    let visited_vec: Vec<String> = visited.iter().cloned().collect();
    let placeholders: String = visited_vec.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!("SELECT id, title FROM notes WHERE id IN ({})", placeholders);

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let params: Vec<&dyn rusqlite::ToSql> = visited_vec
        .iter()
        .map(|s| s as &dyn rusqlite::ToSql)
        .collect();

    let mut nodes: Vec<GraphNode> = stmt
        .query_map(params.as_slice(), |row| {
            Ok(GraphNode {
                id: row.get(0)?,
                title: row.get(1)?,
                link_count: 0,
                tags: vec![],
                is_orphan: false,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Filter edges to only include those between visited nodes
    let edges: Vec<GraphEdge> = all_links
        .into_iter()
        .filter(|(s, t)| visited.contains(s) && visited.contains(t))
        .map(|(source, target)| GraphEdge { source, target })
        .collect();

    // Calculate link counts for local graph
    let mut link_counts: HashMap<String, i32> = HashMap::new();
    for edge in &edges {
        *link_counts.entry(edge.source.clone()).or_insert(0) += 1;
        *link_counts.entry(edge.target.clone()).or_insert(0) += 1;
    }

    // Get tags for visited nodes
    if !visited_vec.is_empty() {
        let tag_sql = format!(
            "SELECT note_id, tag FROM note_tags WHERE note_id IN ({})",
            placeholders
        );
        let mut stmt = conn.prepare(&tag_sql).map_err(|e| e.to_string())?;

        let mut note_tags: HashMap<String, Vec<String>> = HashMap::new();
        let rows = stmt
            .query_map(params.as_slice(), |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;

        for row in rows.filter_map(|r| r.ok()) {
            note_tags.entry(row.0).or_default().push(row.1);
        }

        // Update nodes with counts and tags
        for node in &mut nodes {
            node.link_count = *link_counts.get(&node.id).unwrap_or(&0);
            node.tags = note_tags.get(&node.id).cloned().unwrap_or_default();
        }
    }

    Ok(GraphData { nodes, edges })
}
