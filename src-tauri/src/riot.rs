//! Accès à l'API Riot (clé personnelle) avec limiteur de débit intégré.

use crate::AppState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::{Duration, Instant};

/// Routage régional pour match-v5.
pub fn regional(platform: &str) -> &'static str {
    match platform {
        "na1" | "br1" | "la1" | "la2" => "americas",
        "kr" | "jp1" => "asia",
        "oc1" | "ph2" | "sg2" | "th2" | "tw2" | "vn2" => "sea",
        _ => "europe",
    }
}

/// Routage pour account-v1 (pas de cluster "sea").
pub fn account_region(platform: &str) -> &'static str {
    match regional(platform) {
        "sea" => "asia",
        r => r,
    }
}

pub fn enc(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => o.push(b as char),
            _ => o.push_str(&format!("%{:02X}", b)),
        }
    }
    o
}

/// Respecte les limites d'une clé de développement : 20 req/s et 100 req/2 min.
async fn acquire(st: &AppState, bg: bool) {
    // les imports en arrière-plan laissent une marge pour l'utilisation normale de l'appli
    let cap = if bg { 85 } else { 95 };
    loop {
        let wait = {
            let mut q = st.limiter.lock().await;
            let now = Instant::now();
            while q.front().is_some_and(|t| now.duration_since(*t) >= Duration::from_secs(120)) {
                q.pop_front();
            }
            let last_sec = q.iter().filter(|t| now.duration_since(**t) < Duration::from_secs(1)).count();
            if q.len() < cap && last_sec < if bg { 15 } else { 18 } {
                q.push_back(now);
                None
            } else if q.len() >= cap {
                Some(Duration::from_secs(120).saturating_sub(now.duration_since(q[0])) + Duration::from_millis(50))
            } else {
                Some(Duration::from_millis(120))
            }
        };
        match wait {
            None => return,
            Some(d) => tokio::time::sleep(d).await,
        }
    }
}

pub async fn get(st: &AppState, url: &str) -> Result<Value, String> {
    get_opt(st, url).await?.ok_or_else(|| "Introuvable : vérifie le Riot ID et la région.".to_string())
}

/// Comme `get`, mais une réponse 404 donne `None` (ex. : joueur pas en partie).
pub async fn get_opt(st: &AppState, url: &str) -> Result<Option<Value>, String> {
    get_inner(st, url, false).await
}

/// Requête d'arrière-plan (import méta) : moins prioritaire.
pub async fn get_bg(st: &AppState, url: &str) -> Result<Option<Value>, String> {
    get_inner(st, url, true).await
}

async fn get_inner(st: &AppState, url: &str, bg: bool) -> Result<Option<Value>, String> {
    let key = st.settings.lock().unwrap().api_key.trim().to_string();
    if key.is_empty() {
        return Err("Aucune clé API Riot. Ajoute-la dans Paramètres.".into());
    }
    for _ in 0..4 {
        acquire(st, bg).await;
        let resp = st
            .http
            .get(url)
            .header("X-Riot-Token", &key)
            .send()
            .await
            .map_err(|e| format!("Erreur réseau : {e}"))?;
        let status = resp.status().as_u16();
        match status {
            200 => return resp.json().await.map(Some).map_err(|e| e.to_string()),
            429 => {
                let wait = resp
                    .headers()
                    .get("retry-after")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse::<u64>().ok())
                    .unwrap_or(5);
                tokio::time::sleep(Duration::from_secs(wait.clamp(1, 120))).await;
            }
            401 | 403 => {
                return Err("Clé API refusée : elle est invalide ou a expiré (une clé de développement dure 24 h). Génère-en une nouvelle sur developer.riotgames.com.".into())
            }
            404 => return Ok(None),
            500..=599 => tokio::time::sleep(Duration::from_secs(2)).await,
            _ => return Err(format!("Erreur de l'API Riot ({status}).")),
        }
    }
    Err("L'API Riot ne répond pas, réessaie dans un instant.".into())
}

/// Version du format des parties en cache : les parties plus anciennes sont retéléchargées.
pub const MATCH_V: u8 = 2;

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct Part {
    pub puuid: String,
    pub name: String,
    pub champ: String,
    pub champ_id: i64,
    pub team: i64,
    pub win: bool,
    pub k: i64,
    pub d: i64,
    pub a: i64,
    pub cs: i64,
    pub gold: i64,
    pub dmg: i64,
    pub vision: i64,
    pub level: i64,
    pub pos: String,
    pub items: Vec<i64>,
    // --- v2
    pub spells: Vec<i64>,
    pub keystone: i64,
    pub sub_style: i64,
    pub style: i64,
    pub perks: Vec<i64>,
    pub shards: Vec<i64>,
    pub dmg_taken: i64,
    pub mitigated: i64,
    pub heal: i64,
    pub shield: i64,
    pub phys: i64,
    pub magic: i64,
    pub true_dmg: i64,
    pub turret_dmg: i64,
    pub obj_dmg: i64,
    pub cc: i64,
    pub wards: i64,
    pub wards_killed: i64,
    pub pinks: i64,
    pub doubles: i64,
    pub triples: i64,
    pub quadras: i64,
    pub pentas: i64,
    pub spree: i64,
    pub first_blood: bool,
    pub dead: i64,
    pub solo_kills: i64,
    pub plates: i64,
    pub cs10: f64,
    pub cs_adv: f64,
    pub dodged: i64,
    pub turrets: i64,
    pub dragons: i64,
    pub barons: i64,
    pub placement: i64,
    pub subteam: i64,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct TeamInfo {
    pub id: i64,
    pub win: bool,
    pub baron: i64,
    pub dragon: i64,
    pub herald: i64,
    pub grubs: i64,
    pub atakhan: i64,
    pub tower: i64,
    pub inhib: i64,
    pub kills: i64,
    pub first_blood: bool,
    pub first_tower: bool,
    pub first_dragon: bool,
    pub bans: Vec<i64>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct MatchLite {
    pub id: String,
    pub creation: i64,
    pub duration: i64,
    pub queue: i64,
    pub remake: bool,
    pub parts: Vec<Part>,
    pub teams: Vec<TeamInfo>,
    pub patch: String,
    pub v: u8,
}

fn s(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_string()
}
fn n(v: &Value) -> i64 {
    v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)).unwrap_or(0)
}
fn f(v: &Value) -> f64 {
    v.as_f64().unwrap_or(0.0)
}
fn obj(t: &Value, k: &str) -> i64 {
    n(&t["objectives"][k]["kills"])
}
fn first(t: &Value, k: &str) -> bool {
    t["objectives"][k]["first"].as_bool().unwrap_or(false)
}

/// Réduit une partie brute (~50 Ko) au nécessaire (~6 Ko).
pub fn to_lite(raw: &Value) -> MatchLite {
    let info = &raw["info"];
    let mut remake = false;
    let parts = info["participants"]
        .as_array()
        .map(|a| a.as_slice())
        .unwrap_or_default()
        .iter()
        .map(|p| {
            if p["gameEndedInEarlySurrender"].as_bool() == Some(true) {
                remake = true;
            }
            let gn = s(&p["riotIdGameName"]);
            let name = if gn.is_empty() {
                s(&p["summonerName"])
            } else {
                format!("{}#{}", gn, s(&p["riotIdTagline"]))
            };
            let ch = &p["challenges"];
            let styles = &p["perks"]["styles"];
            Part {
                puuid: s(&p["puuid"]),
                name,
                champ: s(&p["championName"]),
                champ_id: n(&p["championId"]),
                team: n(&p["teamId"]),
                win: p["win"].as_bool().unwrap_or(false),
                k: n(&p["kills"]),
                d: n(&p["deaths"]),
                a: n(&p["assists"]),
                cs: n(&p["totalMinionsKilled"]) + n(&p["neutralMinionsKilled"]),
                gold: n(&p["goldEarned"]),
                dmg: n(&p["totalDamageDealtToChampions"]),
                vision: n(&p["visionScore"]),
                level: n(&p["champLevel"]),
                pos: s(&p["teamPosition"]),
                items: (0..7).map(|i| n(&p[format!("item{i}")])).collect(),
                spells: vec![n(&p["summoner1Id"]), n(&p["summoner2Id"])],
                keystone: n(&styles[0]["selections"][0]["perk"]),
                sub_style: n(&styles[1]["style"]),
                style: n(&styles[0]["style"]),
                perks: styles
                    .as_array()
                    .map(|a| a.iter().flat_map(|st| st["selections"].as_array().cloned().unwrap_or_default()).map(|x| n(&x["perk"])).collect())
                    .unwrap_or_default(),
                shards: ["offense", "flex", "defense"].iter().map(|k| n(&p["perks"]["statPerks"][k])).collect(),
                dmg_taken: n(&p["totalDamageTaken"]),
                mitigated: n(&p["damageSelfMitigated"]),
                heal: n(&p["totalHealsOnTeammates"]),
                shield: n(&p["totalDamageShieldedOnTeammates"]),
                phys: n(&p["physicalDamageDealtToChampions"]),
                magic: n(&p["magicDamageDealtToChampions"]),
                true_dmg: n(&p["trueDamageDealtToChampions"]),
                turret_dmg: n(&p["damageDealtToBuildings"]),
                obj_dmg: n(&p["damageDealtToObjectives"]),
                cc: n(&p["timeCCingOthers"]),
                wards: n(&p["wardsPlaced"]),
                wards_killed: n(&p["wardsKilled"]),
                pinks: n(&p["visionWardsBoughtInGame"]),
                doubles: n(&p["doubleKills"]),
                triples: n(&p["tripleKills"]),
                quadras: n(&p["quadraKills"]),
                pentas: n(&p["pentaKills"]),
                spree: n(&p["largestKillingSpree"]),
                first_blood: p["firstBloodKill"].as_bool().unwrap_or(false) || p["firstBloodAssist"].as_bool().unwrap_or(false),
                dead: n(&p["totalTimeSpentDead"]),
                solo_kills: n(&ch["soloKills"]),
                plates: n(&ch["turretPlatesTaken"]),
                cs10: f(&ch["laneMinionsFirst10Minutes"]) + f(&ch["jungleCsBefore10Minutes"]),
                cs_adv: f(&ch["maxCsAdvantageOnLaneOpponent"]),
                dodged: n(&ch["skillshotsDodged"]),
                turrets: n(&p["turretKills"]),
                dragons: n(&p["dragonKills"]),
                barons: n(&p["baronKills"]),
                placement: n(&p["placement"]),
                subteam: n(&p["playerSubteamId"]),
            }
        })
        .collect();
    let teams = info["teams"]
        .as_array()
        .map(|a| a.as_slice())
        .unwrap_or_default()
        .iter()
        .map(|t| TeamInfo {
            id: n(&t["teamId"]),
            win: t["win"].as_bool().unwrap_or(false),
            baron: obj(t, "baron"),
            dragon: obj(t, "dragon"),
            herald: obj(t, "riftHerald"),
            grubs: obj(t, "horde"),
            atakhan: obj(t, "atakhan"),
            tower: obj(t, "tower"),
            inhib: obj(t, "inhibitor"),
            kills: obj(t, "champion"),
            first_blood: first(t, "champion"),
            first_tower: first(t, "tower"),
            first_dragon: first(t, "dragon"),
            bans: t["bans"]
                .as_array()
                .map(|b| b.iter().map(|x| n(&x["championId"])).collect())
                .unwrap_or_default(),
        })
        .collect();
    let mut duration = n(&info["gameDuration"]);
    if info.get("gameEndTimestamp").is_none() {
        duration /= 1000; // anciennes parties : durée en ms
    }
    let patch = s(&info["gameVersion"]).split('.').take(2).collect::<Vec<_>>().join(".");
    MatchLite {
        id: s(&raw["metadata"]["matchId"]),
        creation: n(&info["gameCreation"]),
        duration,
        queue: n(&info["queueId"]),
        remake,
        parts,
        teams,
        patch,
        v: MATCH_V,
    }
}

/// Chronologie réduite d'un joueur : ordre des sorts montés et achats (objet, seconde).
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct TimelineLite {
    pub skills: Vec<u8>,
    pub buys: Vec<(i64, i64)>,
    /// [or, xp, cs] à 10 et 15 minutes
    pub at10: Option<[i64; 3]>,
    pub at15: Option<[i64; 3]>,
}

/// Réduit une chronologie brute (~1 Mo) à l'ordre des compétences et des achats, par puuid.
pub fn timeline_lite(raw: &Value) -> std::collections::HashMap<String, TimelineLite> {
    let mut by_id: std::collections::HashMap<i64, TimelineLite> = Default::default();
    let mut puuid_of: std::collections::HashMap<i64, String> = Default::default();
    if let Some(ps) = raw["info"]["participants"].as_array() {
        for p in ps {
            puuid_of.insert(n(&p["participantId"]), s(&p["puuid"]));
        }
    }
    if puuid_of.is_empty() {
        if let Some(ps) = raw["metadata"]["participants"].as_array() {
            for (i, p) in ps.iter().enumerate() {
                puuid_of.insert(i as i64 + 1, p.as_str().unwrap_or_default().to_string());
            }
        }
    }
    let frames = raw["info"]["frames"].as_array().map(|a| a.as_slice()).unwrap_or_default();
    for (minute, slot) in [(10usize, 0u8), (15, 1)] {
        if let Some(f) = frames.get(minute) {
            if let Some(pf) = f["participantFrames"].as_object() {
                for (k, v) in pf {
                    let Ok(id) = k.parse::<i64>() else { continue };
                    let snap = [n(&v["totalGold"]), n(&v["xp"]), n(&v["minionsKilled"]) + n(&v["jungleMinionsKilled"])];
                    let t = by_id.entry(id).or_default();
                    if slot == 0 { t.at10 = Some(snap) } else { t.at15 = Some(snap) }
                }
            }
        }
    }
    for frame in frames {
        for e in frame["events"].as_array().map(|a| a.as_slice()).unwrap_or_default() {
            let pid = n(&e["participantId"]);
            match e["type"].as_str().unwrap_or_default() {
                "SKILL_LEVEL_UP" if e["levelUpType"].as_str() != Some("EVOLVE") => {
                    by_id.entry(pid).or_default().skills.push(n(&e["skillSlot"]) as u8);
                }
                "ITEM_PURCHASED" => {
                    by_id.entry(pid).or_default().buys.push((n(&e["itemId"]), n(&e["timestamp"]) / 1000));
                }
                "ITEM_UNDO" => {
                    let before = n(&e["beforeId"]);
                    let t = by_id.entry(pid).or_default();
                    if let Some(i) = t.buys.iter().rposition(|b| b.0 == before) {
                        t.buys.remove(i);
                    }
                }
                _ => {}
            }
        }
    }
    by_id.into_iter().filter_map(|(id, t)| Some((puuid_of.get(&id)?.clone(), t))).collect()
}
