//! Connexion à l'API locale du client League of Legends (LCU).
//! Le client expose un serveur HTTPS sur 127.0.0.1 ; le port et le mot de passe
//! sont lus dans le fichier `lockfile` ou dans la ligne de commande du processus.

use crate::AppState;
use serde_json::Value;
use std::path::PathBuf;

#[derive(Clone)]
pub struct Creds {
    pub port: u16,
    pub token: String,
}

fn from_lockfile(path: &PathBuf) -> Option<Creds> {
    let txt = std::fs::read_to_string(path).ok()?;
    let parts: Vec<&str> = txt.trim().split(':').collect();
    if parts.len() < 5 {
        return None;
    }
    Some(Creds { port: parts[2].parse().ok()?, token: parts[3].to_string() })
}

#[allow(dead_code)]
fn extract(s: &str, key: &str) -> Option<String> {
    let i = s.find(key)? + key.len();
    let rest = &s[i..];
    let end = rest.find(|c: char| c == '"' || c.is_whitespace()).unwrap_or(rest.len());
    Some(rest[..end].to_string())
}

#[cfg(windows)]
fn from_process() -> Option<Creds> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let out = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-CimInstance Win32_Process -Filter \"name='LeagueClientUx.exe'\" | Select-Object -ExpandProperty CommandLine",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    let s = String::from_utf8_lossy(&out.stdout);
    Some(Creds {
        port: extract(&s, "--app-port=")?.parse().ok()?,
        token: extract(&s, "--remoting-auth-token=")?,
    })
}

#[cfg(not(windows))]
fn from_process() -> Option<Creds> {
    None
}

pub fn discover(league_path: &str) -> Option<Creds> {
    let mut paths: Vec<PathBuf> = Vec::new();
    if !league_path.trim().is_empty() {
        paths.push(PathBuf::from(league_path.trim()).join("lockfile"));
    }
    for drive in ["C", "D", "E"] {
        paths.push(PathBuf::from(format!("{drive}:\\Riot Games\\League of Legends\\lockfile")));
    }
    paths.iter().find_map(from_lockfile).or_else(from_process)
}

async fn raw_get(st: &AppState, c: &Creds, path: &str) -> Result<Value, String> {
    let resp = st
        .lcu_http
        .get(format!("https://127.0.0.1:{}{}", c.port, path))
        .basic_auth("riot", Some(&c.token))
        .send()
        .await
        .map_err(|_| "Client LoL injoignable.".to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Client LoL : erreur {} sur {path}", resp.status().as_u16()));
    }
    resp.json().await.map_err(|e| e.to_string())
}

/// Requête vers le client, avec redécouverte automatique si le client a redémarré.
pub async fn get(st: &AppState, path: &str) -> Result<Value, String> {
    let cached = st.lcu.lock().unwrap().clone();
    if let Some(c) = cached {
        match raw_get(st, &c, path).await {
            Ok(v) => return Ok(v),
            Err(e) if !e.starts_with("Client LoL injoignable") => return Err(e),
            Err(_) => {}
        }
    }
    let league_path = st.settings.lock().unwrap().league_path.clone();
    let found = tauri::async_runtime::spawn_blocking(move || discover(&league_path))
        .await
        .ok()
        .flatten();
    *st.lcu.lock().unwrap() = found.clone();
    let c = found.ok_or_else(|| "Client League of Legends introuvable : lance le client et connecte-toi.".to_string())?;
    raw_get(st, &c, path).await
}
