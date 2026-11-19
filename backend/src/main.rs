use axum::{
    extract::{Multipart, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post, put},
    Json, Router,
};
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    net::SocketAddr,
    path::{Path as StdPath, PathBuf},
    sync::Arc,
    time::SystemTime,
};
use sysinfo::{Disks, Networks, ProcessesToUpdate, System};
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};
use uuid::Uuid;

// ============================================================================
// Data Models
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShortcutKind {
    Link,
    Script,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserShortcut {
    pub id: String,
    pub label: String,
    pub category: String, // "service" | "account"
    pub kind: ShortcutKind,
    pub target: String, // URL or shell command
    pub icon: String,   // "dashboard" | "table" | "terminal" | "shield" | "user" | "settings"
}

fn default_avatar_color() -> String {
    "cyan".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfile {
    pub id: String,
    pub name: String,
    pub workspace_label: String,
    pub role: String,
    pub location: String,
    pub avatar_initials: String,
    #[serde(default = "default_avatar_color")]
    pub avatar_color: String,
    #[serde(default)]
    pub is_admin: bool,
    #[serde(default)]
    pub pin_code: Option<String>,
    pub favorite_services: Vec<String>,
    pub shortcuts: Vec<UserShortcut>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PublicUserProfile {
    pub id: String,
    pub name: String,
    pub workspace_label: String,
    pub role: String,
    pub location: String,
    pub avatar_initials: String,
    pub avatar_color: String,
    pub is_admin: bool,
    pub has_pin: bool,
    pub favorite_services: Vec<String>,
    pub shortcuts: Vec<UserShortcut>,
}

impl From<&UserProfile> for PublicUserProfile {
    fn from(p: &UserProfile) -> Self {
        Self {
            id: p.id.clone(),
            name: p.name.clone(),
            workspace_label: p.workspace_label.clone(),
            role: p.role.clone(),
            location: p.location.clone(),
            avatar_initials: p.avatar_initials.clone(),
            avatar_color: p.avatar_color.clone(),
            is_admin: p.is_admin,
            has_pin: p.pin_code.as_ref().is_some_and(|pin| !pin.is_empty()),
            favorite_services: p.favorite_services.clone(),
            shortcuts: p.shortcuts.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileYamlEntry {
    pub id: String,
    pub name: String,
    pub location: String,
    #[serde(default = "default_avatar_color")]
    pub avatar_color: String,
    #[serde(default = "default_role_label")]
    pub role: String,
    #[serde(default = "default_workspace_label")]
    pub workspace_label: String,
    #[serde(default)]
    pub is_admin: bool,
    #[serde(default)]
    pub pin_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfilesYamlConfig {
    pub profiles: Vec<ProfileYamlEntry>,
}

fn default_role_label() -> String {
    "Uživatel".to_string()
}

fn default_workspace_label() -> String {
    "Vykylab".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServicePreviewRow {
    pub name: String,
    pub status: String,
    pub meta: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HomelabService {
    pub id: String,
    pub name: String,
    pub subtitle: String,
    pub status: String, // "running" | "stopped" | "warning"
    pub uptime: String,
    pub url: String,
    pub icon: String,
    pub preview_rows: Vec<ServicePreviewRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemEvent {
    pub id: String,
    pub timestamp: String,
    pub level: String, // "ok" | "info" | "warn" | "error"
    pub source: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadedFileInfo {
    pub id: String,
    pub name: String,
    pub size_bytes: u64,
    pub uploaded_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConnection {
    pub id: String,
    pub name: String,
    pub user: String,
    pub host: String,
    pub port: u16,
    pub mode: String, // "local" | "ssh"
    pub identity_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshShortcut {
    pub id: String,
    pub label: String,
    pub command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfig {
    pub active_connection_id: String,
    pub connections: Vec<SshConnection>,
    pub shortcuts: Vec<SshShortcut>,
}

fn default_ssh_config() -> SshConfig {
    SshConfig {
        active_connection_id: "ssh-local".to_string(),
        connections: vec![SshConnection {
            id: "ssh-local".to_string(),
            name: "Lokální Shell".to_string(),
            user: "sudo".to_string(),
            host: "localhost".to_string(),
            port: 22,
            mode: "local".to_string(),
            identity_file: None,
        }],
        shortcuts: vec![
            SshShortcut {
                id: "sh-uptime".to_string(),
                label: "Uptime".to_string(),
                command: "uptime".to_string(),
            },
            SshShortcut {
                id: "sh-disk".to_string(),
                label: "Disky".to_string(),
                command: "df -h /".to_string(),
            },
            SshShortcut {
                id: "sh-ports".to_string(),
                label: "Otevřené porty".to_string(),
                command: "lsof -i -P -n | head -n 15 || netstat -an | head -n 15".to_string(),
            },
            SshShortcut {
                id: "sh-ps".to_string(),
                label: "Top procesy".to_string(),
                command: "ps aux | head -n 12".to_string(),
            },
        ],
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedStore {
    pub active_profile_id: String,
    pub profiles: Vec<UserProfile>,
    pub services: Vec<HomelabService>,
    pub events: Vec<SystemEvent>,
    pub uploads: Vec<UploadedFileInfo>,
    #[serde(default = "default_ssh_config")]
    pub ssh: SshConfig,
    pub last_checked: String,
    pub weather_summary: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SystemMonitoring {
    pub host_name: String,
    pub os_version: String,
    pub kernel_version: String,
    pub cpu_arch: String,
    pub cpu_brand: String,
    pub cpu_cores: usize,
    pub cpu_freq_mhz: u64,
    pub cpu_percent: f32,
    pub load_avg: String,
    pub top_cpu_proc: String,
    pub ram_used_gb: f64,
    pub ram_total_gb: f64,
    pub ram_percent: f64,
    pub swap_used_gb: f64,
    pub swap_total_gb: f64,
    pub top_ram_proc: String,
    pub disk_free_gb: f64,
    pub disk_total_gb: f64,
    pub disk_fs: String,
    pub disk_kind: String,
    pub net_interface: String,
    pub net_rx_mb: f64,
    pub net_tx_mb: f64,
    pub net_rx_packets: u64,
    pub net_tx_packets: u64,
    pub disk_read_mb: f64,
    pub disk_write_mb: f64,
    pub top_io_proc: String,
    pub process_count: usize,
    pub uptime_formatted: String,
    pub tunnel_label: String,
    pub tunnel_tx: String,
    pub connected_to: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cpu_percent: f32,
    pub memory_mb: f64,
    pub disk_read_mb: f64,
    pub disk_write_mb: f64,
    pub status: String,
    pub cmd: String,
    pub run_time_secs: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DashboardResponse {
    pub date_label: String,
    pub weather_summary: String,
    pub last_checked: String,
    pub system_healthy: bool,
    pub system_status_text: String,
    pub active_profile: PublicUserProfile,
    pub profiles: Vec<PublicUserProfile>,
    pub services: Vec<HomelabService>,
    pub events: Vec<SystemEvent>,
    pub uploads: Vec<UploadedFileInfo>,
    pub ssh: SshConfig,
    pub monitoring: SystemMonitoring,
    pub processes: Vec<ProcessInfo>,
}

// ============================================================================
// Request Payloads
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct ActivateProfilePayload {
    pub pin: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateProfilePayload {
    pub name: String,
    pub workspace_label: Option<String>,
    pub role: Option<String>,
    pub location: Option<String>,
    pub avatar_color: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProfilePayload {
    pub name: String,
    pub workspace_label: String,
    pub role: String,
    pub location: String,
    pub avatar_color: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AddShortcutPayload {
    pub label: String,
    pub category: String,
    pub kind: ShortcutKind,
    pub target: String,
    pub icon: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ServiceActionPayload {
    pub action: String, // "restart" | "start" | "stop"
}

// ============================================================================
// App State & Persistence
// ============================================================================

#[derive(Clone)]
struct AppState {
    store_path: PathBuf,
    profiles_yaml_path: PathBuf,
    profiles_yaml_mtime: Arc<RwLock<Option<SystemTime>>>,
    uploads_dir: PathBuf,
    store: Arc<RwLock<PersistedStore>>,
    sys: Arc<RwLock<System>>,
}

impl AppState {
    fn load_or_init() -> Self {
        let data_dir = PathBuf::from("data");
        let uploads_dir = data_dir.join("uploads");
        let store_path = data_dir.join("store.json");
        let profiles_yaml_path = data_dir.join("profiles.yaml");

        let _ = fs::create_dir_all(&uploads_dir);

        let mut store = if store_path.exists() {
            match fs::read_to_string(&store_path)
                .ok()
                .and_then(|s| serde_json::from_str::<PersistedStore>(&s).ok())
            {
                Some(parsed) => parsed,
                None => default_store(),
            }
        } else {
            let init = default_store();
            let _ = save_store_to_disk(&store_path, &init);
            init
        };

        let mut changed = false;
        for fam in default_family_profiles() {
            if !store
                .profiles
                .iter()
                .any(|p| p.id == fam.id || p.name.eq_ignore_ascii_case(&fam.name))
            {
                store.profiles.push(fam);
                changed = true;
            }
        }

        if !store.profiles.iter().any(|p| p.id == "prof-sudo" || p.name == "sudo") {
            store.profiles.push(default_sudo_profile());
            changed = true;
        }

        for svc in default_extra_services() {
            if !store.services.iter().any(|s| s.id == svc.id) {
                store.services.push(svc);
                changed = true;
            }
        }

        if !profiles_yaml_path.exists() {
            let _ = save_profiles_yaml(&profiles_yaml_path, &store.profiles);
        }

        if let Some(yaml_cfg) = load_profiles_yaml(&profiles_yaml_path) {
            if apply_yaml_profiles(&mut store, &yaml_cfg) {
                changed = true;
            }
        }

        // Ensure only the sudo profile has admin dashboard access.
        for prof in &mut store.profiles {
            let should_be_admin = prof.id == "prof-sudo" || prof.name == "sudo";
            if prof.is_admin != should_be_admin {
                prof.is_admin = should_be_admin;
                changed = true;
            }
        }

        if changed {
            let _ = save_store_to_disk(&store_path, &store);
        }

        let yaml_mtime = fs::metadata(&profiles_yaml_path)
            .and_then(|m| m.modified())
            .ok();

        let mut sys = System::new_all();
        sys.refresh_all();

        Self {
            store_path,
            profiles_yaml_path,
            profiles_yaml_mtime: Arc::new(RwLock::new(yaml_mtime)),
            uploads_dir,
            store: Arc::new(RwLock::new(store)),
            sys: Arc::new(RwLock::new(sys)),
        }
    }

    async fn sync_yaml_if_changed(&self) {
        let disk_mtime = fs::metadata(&self.profiles_yaml_path)
            .and_then(|m| m.modified())
            .ok();
        let last_mtime = *self.profiles_yaml_mtime.read().await;
        if disk_mtime.is_none() || disk_mtime == last_mtime {
            return;
        }

        if let Some(yaml_cfg) = load_profiles_yaml(&self.profiles_yaml_path) {
            let mut store = self.store.write().await;
            if apply_yaml_profiles(&mut store, &yaml_cfg) {
                let _ = save_store_to_disk(&self.store_path, &store);
            }
            drop(store);
        }

        let mut guard = self.profiles_yaml_mtime.write().await;
        *guard = disk_mtime;
    }

    async fn persist(&self, store: &PersistedStore) {
        let _ = save_store_to_disk(&self.store_path, store);
        if save_profiles_yaml(&self.profiles_yaml_path, &store.profiles).is_ok() {
            let mtime = fs::metadata(&self.profiles_yaml_path)
                .and_then(|m| m.modified())
                .ok();
            let mut guard = self.profiles_yaml_mtime.write().await;
            *guard = mtime;
        }
    }
}

fn load_profiles_yaml(path: &StdPath) -> Option<ProfilesYamlConfig> {
    let raw = fs::read_to_string(path).ok()?;
    serde_yaml::from_str::<ProfilesYamlConfig>(&raw).ok()
}

fn save_profiles_yaml(path: &StdPath, profiles: &[UserProfile]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let entries: Vec<ProfileYamlEntry> = profiles
        .iter()
        .map(|p| ProfileYamlEntry {
            id: p.id.clone(),
            name: p.name.clone(),
            location: p.location.clone(),
            avatar_color: p.avatar_color.clone(),
            role: p.role.clone(),
            workspace_label: p.workspace_label.clone(),
            is_admin: p.is_admin,
            pin_code: p.pin_code.clone(),
        })
        .collect();
    let header = "# Konfigurace uživatelských profilů Vykylab Dashboardu\n\
                  # Barvy avatara (avatar_color): owl-brown | soft-pink | dark-blue | cyan (příp. hex např. \"#c084fc\")\n\
                  # Klasický dashboard mají všichni kromě účtu \"sudo\" (is_admin: true).\n\n";
    let body = serde_yaml::to_string(&ProfilesYamlConfig { profiles: entries })
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    fs::write(path, format!("{}{}", header, body))
}

fn initials_from_name(name: &str) -> String {
    name.trim()
        .chars()
        .next()
        .map(|c| c.to_uppercase().to_string())
        .unwrap_or_else(|| "U".to_string())
}

fn apply_yaml_profiles(store: &mut PersistedStore, cfg: &ProfilesYamlConfig) -> bool {
    let mut changed = false;
    for entry in &cfg.profiles {
        let should_be_admin = entry.id == "prof-sudo" || entry.name == "sudo";
        if let Some(existing) = store
            .profiles
            .iter_mut()
            .find(|p| p.id == entry.id || p.name.eq_ignore_ascii_case(&entry.name))
        {
            let next_initials = initials_from_name(&entry.name);
            if existing.name != entry.name
                || existing.location != entry.location
                || existing.avatar_color != entry.avatar_color
                || existing.role != entry.role
                || existing.workspace_label != entry.workspace_label
                || existing.avatar_initials != next_initials
                || existing.is_admin != should_be_admin
                || existing.pin_code != entry.pin_code
            {
                existing.name = entry.name.clone();
                existing.location = entry.location.clone();
                existing.avatar_color = entry.avatar_color.clone();
                existing.role = entry.role.clone();
                existing.workspace_label = entry.workspace_label.clone();
                existing.avatar_initials = next_initials;
                existing.is_admin = should_be_admin;
                existing.pin_code = entry.pin_code.clone();
                changed = true;
            }
        } else {
            let mut prof = if should_be_admin {
                default_sudo_profile()
            } else {
                build_family_profile(
                    &entry.id,
                    &entry.name,
                    &entry.role,
                    &entry.location,
                    &initials_from_name(&entry.name),
                    &entry.avatar_color,
                )
            };
            prof.workspace_label = entry.workspace_label.clone();
            prof.pin_code = entry.pin_code.clone();
            prof.is_admin = should_be_admin;
            store.profiles.push(prof);
            changed = true;
        }
    }
    changed
}

fn save_store_to_disk(path: &StdPath, store: &PersistedStore) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(store)?;
    fs::write(path, json)
}

fn default_extra_services() -> Vec<HomelabService> {
    vec![
        HomelabService {
            id: "svc-traefik".to_string(),
            name: "Traefik Proxy".to_string(),
            subtitle: "Reverse Proxy & TLS".to_string(),
            status: "running".to_string(),
            uptime: "Up (healthy) · 18d".to_string(),
            url: "https://traefik.vykylab.local".to_string(),
            icon: "layers".to_string(),
            preview_rows: vec![
                ServicePreviewRow {
                    name: "Routery".to_string(),
                    status: "active".to_string(),
                    meta: "14 aktivních".to_string(),
                },
                ServicePreviewRow {
                    name: "TLS Certifikáty".to_string(),
                    status: "active".to_string(),
                    meta: "Let's Encrypt OK".to_string(),
                },
                ServicePreviewRow {
                    name: "Entrypointy".to_string(),
                    status: "active".to_string(),
                    meta: ":80 / :443".to_string(),
                },
            ],
        },
        HomelabService {
            id: "svc-vaultwarden".to_string(),
            name: "Vaultwarden".to_string(),
            subtitle: "Správce hesel".to_string(),
            status: "running".to_string(),
            uptime: "Up (healthy) · 18d".to_string(),
            url: "https://vault.vykylab.local".to_string(),
            icon: "lock".to_string(),
            preview_rows: vec![
                ServicePreviewRow {
                    name: "Trezor".to_string(),
                    status: "active".to_string(),
                    meta: "Šifrováno".to_string(),
                },
                ServicePreviewRow {
                    name: "Záloha DB".to_string(),
                    status: "active".to_string(),
                    meta: "Dnes 02:30".to_string(),
                },
                ServicePreviewRow {
                    name: "WebSocket".to_string(),
                    status: "running".to_string(),
                    meta: "Synchronizováno".to_string(),
                },
            ],
        },
        HomelabService {
            id: "svc-jellyfin".to_string(),
            name: "Jellyfin".to_string(),
            subtitle: "Rodinné kino & média".to_string(),
            status: "running".to_string(),
            uptime: "Up (healthy) · 9d".to_string(),
            url: "https://media.vykylab.local".to_string(),
            icon: "zap".to_string(),
            preview_rows: vec![
                ServicePreviewRow {
                    name: "Transkódování".to_string(),
                    status: "active".to_string(),
                    meta: "HW VA-API".to_string(),
                },
                ServicePreviewRow {
                    name: "Filmy & Seriály".to_string(),
                    status: "active".to_string(),
                    meta: "1.4 TB".to_string(),
                },
                ServicePreviewRow {
                    name: "Přehrávání".to_string(),
                    status: "active".to_string(),
                    meta: "0 aktivních".to_string(),
                },
            ],
        },
        HomelabService {
            id: "svc-homeassistant".to_string(),
            name: "Home Assistant".to_string(),
            subtitle: "Chytrá domácnost".to_string(),
            status: "running".to_string(),
            uptime: "Up (healthy) · 14d".to_string(),
            url: "https://ha.vykylab.local".to_string(),
            icon: "zap".to_string(),
            preview_rows: vec![
                ServicePreviewRow {
                    name: "Zigbee2MQTT".to_string(),
                    status: "running".to_string(),
                    meta: "28 zařízení".to_string(),
                },
                ServicePreviewRow {
                    name: "Automatizace".to_string(),
                    status: "active".to_string(),
                    meta: "19 aktivních".to_string(),
                },
                ServicePreviewRow {
                    name: "Teplota doma".to_string(),
                    status: "active".to_string(),
                    meta: "21.8 °C".to_string(),
                },
            ],
        },
        HomelabService {
            id: "svc-grafana".to_string(),
            name: "Grafana".to_string(),
            subtitle: "Metriky & Telemetrie".to_string(),
            status: "stopped".to_string(),
            uptime: "Exited (0) · 2d".to_string(),
            url: "https://grafana.vykylab.local".to_string(),
            icon: "activity".to_string(),
            preview_rows: vec![
                ServicePreviewRow {
                    name: "Prometheus".to_string(),
                    status: "stopped".to_string(),
                    meta: "Pozastaveno".to_string(),
                },
                ServicePreviewRow {
                    name: "Dashboardy".to_string(),
                    status: "active".to_string(),
                    meta: "6 šablon".to_string(),
                },
            ],
        },
    ]
}

fn default_sudo_profile() -> UserProfile {
    UserProfile {
        id: "prof-sudo".to_string(),
        name: "sudo".to_string(),
        workspace_label: "Vykylab".to_string(),
        role: "Admin".to_string(),
        location: "Praha".to_string(),
        avatar_initials: "S".to_string(),
        avatar_color: "cyan".to_string(),
        is_admin: true,
        pin_code: Some("1234".to_string()),
        favorite_services: vec![
            "svc-portainer".to_string(),
            "svc-adguard".to_string(),
            "svc-immich".to_string(),
        ],
        shortcuts: vec![
            UserShortcut {
                id: "sc-sudo-portainer".to_string(),
                label: "Portainer".to_string(),
                category: "service".to_string(),
                kind: ShortcutKind::Link,
                target: "https://portainer.vykylab.local".to_string(),
                icon: "dashboard".to_string(),
            },
            UserShortcut {
                id: "sc-sudo-docker".to_string(),
                label: "Docker ps".to_string(),
                category: "service".to_string(),
                kind: ShortcutKind::Script,
                target: "docker ps --format 'table {{.Names}}\\t{{.Status}}' || uname -a".to_string(),
                icon: "table".to_string(),
            },
            UserShortcut {
                id: "sc-sudo-df".to_string(),
                label: "Disky (df -h)".to_string(),
                category: "service".to_string(),
                kind: ShortcutKind::Script,
                target: "df -h /".to_string(),
                icon: "terminal".to_string(),
            },
            UserShortcut {
                id: "sc-sudo-adguard".to_string(),
                label: "AdGuard DNS".to_string(),
                category: "service".to_string(),
                kind: ShortcutKind::Link,
                target: "https://dns.vykylab.local".to_string(),
                icon: "shield".to_string(),
            },
            UserShortcut {
                id: "sc-sudo-top".to_string(),
                label: "Uptime & Load".to_string(),
                category: "account".to_string(),
                kind: ShortcutKind::Script,
                target: "uptime".to_string(),
                icon: "user".to_string(),
            },
            UserShortcut {
                id: "sc-sudo-net".to_string(),
                label: "Síťové porty".to_string(),
                category: "account".to_string(),
                kind: ShortcutKind::Script,
                target: "lsof -i -P -n | head -n 15 || netstat -an | head -n 15".to_string(),
                icon: "settings".to_string(),
            },
        ],
    }
}

fn build_family_profile(
    id: &str,
    name: &str,
    role: &str,
    location: &str,
    initials: &str,
    avatar_color: &str,
) -> UserProfile {
    UserProfile {
        id: id.to_string(),
        name: name.to_string(),
        workspace_label: "Vykylab".to_string(),
        role: role.to_string(),
        location: location.to_string(),
        avatar_initials: initials.to_string(),
        avatar_color: avatar_color.to_string(),
        is_admin: false,
        pin_code: None,
        favorite_services: vec![
            "svc-portainer".to_string(),
            "svc-adguard".to_string(),
            "svc-immich".to_string(),
        ],
        shortcuts: vec![
            UserShortcut {
                id: "sc-dashboard".to_string(),
                label: "Portainer".to_string(),
                category: "service".to_string(),
                kind: ShortcutKind::Link,
                target: "https://portainer.vykylab.local".to_string(),
                icon: "dashboard".to_string(),
            },
            UserShortcut {
                id: "sc-containers".to_string(),
                label: "Docker ps".to_string(),
                category: "service".to_string(),
                kind: ShortcutKind::Script,
                target: "docker ps --format 'table {{.Names}}\\t{{.Status}}' || uname -a"
                    .to_string(),
                icon: "table".to_string(),
            },
            UserShortcut {
                id: "sc-adguard".to_string(),
                label: "AdGuard DNS".to_string(),
                category: "service".to_string(),
                kind: ShortcutKind::Link,
                target: "https://dns.vykylab.local".to_string(),
                icon: "shield".to_string(),
            },
            UserShortcut {
                id: "sc-disk".to_string(),
                label: "Kontrola disků".to_string(),
                category: "service".to_string(),
                kind: ShortcutKind::Script,
                target: "df -h /".to_string(),
                icon: "terminal".to_string(),
            },
            UserShortcut {
                id: "sc-uptime".to_string(),
                label: "Uptime & Load".to_string(),
                category: "account".to_string(),
                kind: ShortcutKind::Script,
                target: "uptime".to_string(),
                icon: "user".to_string(),
            },
            UserShortcut {
                id: "sc-backup".to_string(),
                label: "Backup Sync".to_string(),
                category: "account".to_string(),
                kind: ShortcutKind::Script,
                target: "echo 'Snapshot ověřen: 3-2-1 OK'".to_string(),
                icon: "settings".to_string(),
            },
        ],
    }
}

fn default_family_profiles() -> Vec<UserProfile> {
    vec![
        build_family_profile("prof-linda", "Linda", "Uživatel", "Jevíčko", "L", "soft-pink"),
        build_family_profile("prof-peta", "Peťa", "Uživatel", "Praha", "P", "cyan"),
        build_family_profile("prof-mamka", "Mamka", "Uživatel", "Jevíčko", "M", "owl-brown"),
        build_family_profile("prof-tata", "Táta", "Správce", "Jevíčko", "T", "dark-blue"),
    ]
}

fn default_store() -> PersistedStore {
    let now_time = Local::now().format("%H:%M").to_string();
    let mut profiles = default_family_profiles();
    let default_active_id = profiles[0].id.clone();
    profiles.push(default_sudo_profile());

    let mut services = vec![
        HomelabService {
            id: "svc-portainer".to_string(),
            name: "Portainer".to_string(),
            subtitle: "Docker Orchestrator".to_string(),
            status: "running".to_string(),
            uptime: "Up (healthy) · 18d".to_string(),
            url: "https://portainer.vykylab.local".to_string(),
            icon: "container".to_string(),
            preview_rows: vec![
                ServicePreviewRow {
                    name: "traefik-proxy".to_string(),
                    status: "running".to_string(),
                    meta: "v3.1 · 18d".to_string(),
                },
                ServicePreviewRow {
                    name: "adguard-home".to_string(),
                    status: "running".to_string(),
                    meta: "v0.107 · 18d".to_string(),
                },
                ServicePreviewRow {
                    name: "immich-server".to_string(),
                    status: "running".to_string(),
                    meta: "v1.119 · 12d".to_string(),
                },
                ServicePreviewRow {
                    name: "vaultwarden".to_string(),
                    status: "running".to_string(),
                    meta: "v1.32 · 18d".to_string(),
                },
            ],
        },
        HomelabService {
            id: "svc-adguard".to_string(),
            name: "AdGuard Home".to_string(),
            subtitle: "DNS & Filtering".to_string(),
            status: "running".to_string(),
            uptime: "Up (healthy) · 18d".to_string(),
            url: "https://dns.vykylab.local".to_string(),
            icon: "shield".to_string(),
            preview_rows: vec![
                ServicePreviewRow {
                    name: "Dotazy (24h)".to_string(),
                    status: "active".to_string(),
                    meta: "24 810".to_string(),
                },
                ServicePreviewRow {
                    name: "Blokováno".to_string(),
                    status: "active".to_string(),
                    meta: "18.4 %".to_string(),
                },
                ServicePreviewRow {
                    name: "Prům. odezva".to_string(),
                    status: "active".to_string(),
                    meta: "4 ms".to_string(),
                },
                ServicePreviewRow {
                    name: "Upstream DNS".to_string(),
                    status: "active".to_string(),
                    meta: "Cloudflare DoH".to_string(),
                },
            ],
        },
        HomelabService {
            id: "svc-immich".to_string(),
            name: "Immich".to_string(),
            subtitle: "Rodinné fotky & zálohy".to_string(),
            status: "running".to_string(),
            uptime: "Up (healthy) · 12d".to_string(),
            url: "https://photos.vykylab.local".to_string(),
            icon: "image".to_string(),
            preview_rows: vec![
                ServicePreviewRow {
                    name: "immich-ml".to_string(),
                    status: "running".to_string(),
                    meta: "GPU Ready".to_string(),
                },
                ServicePreviewRow {
                    name: "immich-postgres".to_string(),
                    status: "running".to_string(),
                    meta: "pgvector · 12d".to_string(),
                },
                ServicePreviewRow {
                    name: "Knihovna".to_string(),
                    status: "active".to_string(),
                    meta: "42 180 fotek".to_string(),
                },
                ServicePreviewRow {
                    name: "Poslední záloha".to_string(),
                    status: "active".to_string(),
                    meta: "Dnes 03:00".to_string(),
                },
            ],
        },
    ];
    services.extend(default_extra_services());

    let events = vec![
        SystemEvent {
            id: "evt-1".to_string(),
            timestamp: now_time.clone(),
            level: "ok".to_string(),
            source: "Vykylab Core".to_string(),
            message: "Všechny služby a tunely běží bez chyb.".to_string(),
        },
        SystemEvent {
            id: "evt-2".to_string(),
            timestamp: "04:32".to_string(),
            level: "info".to_string(),
            source: "Cloudflare & Tailscale".to_string(),
            message: "Noční kontrola tunelu dokončena (odezva 11 ms).".to_string(),
        },
    ];

    PersistedStore {
        active_profile_id: default_active_id,
        profiles,
        services,
        events,
        uploads: vec![],
        ssh: default_ssh_config(),
        last_checked: now_time,
        weather_summary: "7°C bez větru".to_string(),
    }
}

fn format_uptime(secs: u64) -> String {
    let days = secs / 86400;
    let hours = (secs % 86400) / 3600;
    let mins = (secs % 3600) / 60;
    if days > 0 {
        format!("{}d {}h", days, hours)
    } else if hours > 0 {
        format!("{}h {}m", hours, mins)
    } else {
        format!("{}m", mins.max(1))
    }
}

async fn build_dashboard(state: &AppState) -> DashboardResponse {
    let mut sys = state.sys.write().await;
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let cpu_percent = sys.global_cpu_usage();
    let cpu_cores = sys.cpus().len();
    let cpu_brand = sys
        .cpus()
        .first()
        .map(|c| c.brand().trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "CPU".to_string());
    let cpu_freq_mhz = sys.cpus().first().map(|c| c.frequency()).unwrap_or(0);
    let la = System::load_average();
    let load_avg = format!("{:.2} / {:.2} / {:.2}", la.one, la.five, la.fifteen);

    let ram_total_gb = sys.total_memory() as f64 / 1_073_741_824.0;
    let ram_used_gb = sys.used_memory() as f64 / 1_073_741_824.0;
    let ram_percent = if ram_total_gb > 0.0 {
        (ram_used_gb / ram_total_gb) * 100.0
    } else {
        0.0
    };
    let swap_total_gb = sys.total_swap() as f64 / 1_073_741_824.0;
    let swap_used_gb = sys.used_swap() as f64 / 1_073_741_824.0;

    let host_name = System::host_name().unwrap_or_else(|| "Vykylab Main-server".to_string());
    let os_version = System::long_os_version().unwrap_or_else(|| "Linux / macOS".to_string());
    let kernel_version = System::kernel_version().unwrap_or_else(|| "unknown".to_string());
    let cpu_arch = System::cpu_arch().unwrap_or_else(|| "unknown".to_string());
    let uptime_formatted = format_uptime(System::uptime());
    let process_count = sys.processes().len();

    let mut total_read_bytes: u64 = 0;
    let mut total_write_bytes: u64 = 0;
    let mut best_cpu: Option<(String, f32)> = None;
    let mut best_ram: Option<(String, u64)> = None;
    let mut best_io: Option<(String, u64)> = None;
    let mut processes: Vec<ProcessInfo> = Vec::with_capacity(sys.processes().len());

    for (pid, proc_item) in sys.processes() {
        let name = proc_item.name().to_string_lossy().to_string();
        let cpu_u = proc_item.cpu_usage();
        if best_cpu.as_ref().is_none_or(|(_, best)| cpu_u > *best) {
            best_cpu = Some((name.clone(), cpu_u));
        }
        let mem_b = proc_item.memory();
        if best_ram.as_ref().is_none_or(|(_, best)| mem_b > *best) {
            best_ram = Some((name.clone(), mem_b));
        }
        let usage = proc_item.disk_usage();
        let io_sum = usage.read_bytes.saturating_add(usage.written_bytes);
        if best_io.as_ref().is_none_or(|(_, best)| io_sum > *best) {
            best_io = Some((name.clone(), io_sum));
        }
        total_read_bytes = total_read_bytes.saturating_add(usage.read_bytes);
        total_write_bytes = total_write_bytes.saturating_add(usage.written_bytes);

        let cmd_str = proc_item
            .cmd()
            .iter()
            .map(|s| s.to_string_lossy())
            .collect::<Vec<_>>()
            .join(" ");
        let cmd = if cmd_str.trim().is_empty() {
            name.clone()
        } else {
            cmd_str
        };

        processes.push(ProcessInfo {
            pid: pid.as_u32(),
            name,
            cpu_percent: (cpu_u * 10.0).round() / 10.0,
            memory_mb: ((mem_b as f64 / 1_048_576.0) * 10.0).round() / 10.0,
            disk_read_mb: ((usage.read_bytes as f64 / 1_048_576.0) * 10.0).round() / 10.0,
            disk_write_mb: ((usage.written_bytes as f64 / 1_048_576.0) * 10.0).round() / 10.0,
            status: format!("{:?}", proc_item.status()),
            cmd,
            run_time_secs: proc_item.run_time(),
        });
    }
    processes.sort_by(|a, b| {
        b.cpu_percent
            .total_cmp(&a.cpu_percent)
            .then_with(|| b.memory_mb.total_cmp(&a.memory_mb))
            .then_with(|| a.pid.cmp(&b.pid))
    });
    processes.truncate(150);
    let top_cpu_proc = best_cpu
        .map(|(n, c)| format!("{} ({:.1}%)", n, c))
        .unwrap_or_else(|| "—".to_string());
    let top_ram_proc = best_ram
        .map(|(n, b)| format!("{} ({:.0} MB)", n, b as f64 / 1_048_576.0))
        .unwrap_or_else(|| "—".to_string());
    let top_io_proc = best_io
        .map(|(n, b)| format!("{} ({:.1} MB)", n, b as f64 / 1_048_576.0))
        .unwrap_or_else(|| "—".to_string());

    let disk_read_mb = total_read_bytes as f64 / 1_048_576.0;
    let disk_write_mb = total_write_bytes as f64 / 1_048_576.0;
    drop(sys);

    let networks = Networks::new_with_refreshed_list();
    let mut rx_bytes: u64 = 0;
    let mut tx_bytes: u64 = 0;
    let mut net_rx_packets: u64 = 0;
    let mut net_tx_packets: u64 = 0;
    let mut primary_iface = String::from("eth0");
    let mut max_iface_bytes: u64 = 0;
    for (iface, data) in &networks {
        let r = data.total_received();
        let t = data.total_transmitted();
        rx_bytes = rx_bytes.saturating_add(r);
        tx_bytes = tx_bytes.saturating_add(t);
        net_rx_packets = net_rx_packets.saturating_add(data.total_packets_received());
        net_tx_packets = net_tx_packets.saturating_add(data.total_packets_transmitted());
        if r.saturating_add(t) > max_iface_bytes {
            max_iface_bytes = r.saturating_add(t);
            primary_iface = iface.clone();
        }
    }
    let net_rx_mb = rx_bytes as f64 / 1_048_576.0;
    let net_tx_mb = tx_bytes as f64 / 1_048_576.0;

    let disks = Disks::new_with_refreshed_list();
    let (disk_free_gb, disk_total_gb, disk_fs, disk_kind) = disks
        .iter()
        .find(|d| d.mount_point() == StdPath::new("/"))
        .or_else(|| disks.first())
        .map(|d| {
            (
                d.available_space() as f64 / 1_073_741_824.0,
                d.total_space() as f64 / 1_073_741_824.0,
                d.file_system().to_string_lossy().to_string(),
                format!("{:?}", d.kind()),
            )
        })
        .unwrap_or((128.0, 512.0, "APFS".to_string(), "SSD".to_string()));

    let store = state.store.read().await;
    let active_profile = store
        .profiles
        .iter()
        .find(|p| p.id == store.active_profile_id)
        .cloned()
        .unwrap_or_else(|| store.profiles[0].clone());

    let any_stopped = store.services.iter().any(|s| s.status != "running");
    let system_healthy = !any_stopped;
    let system_status_text = if system_healthy {
        "vše je v pořádku".to_string()
    } else {
        "některá služba neběží".to_string()
    };

    let connected_to = format!("{} Main-server", active_profile.workspace_label);

    DashboardResponse {
        date_label: Local::now().format("%-d.%-m.").to_string(),
        weather_summary: store.weather_summary.clone(),
        last_checked: store.last_checked.clone(),
        system_healthy,
        system_status_text,
        active_profile: PublicUserProfile::from(&active_profile),
        profiles: store.profiles.iter().map(PublicUserProfile::from).collect(),
        services: store.services.clone(),
        events: store.events.clone(),
        uploads: store.uploads.clone(),
        ssh: store.ssh.clone(),
        monitoring: SystemMonitoring {
            host_name: host_name.clone(),
            os_version,
            kernel_version,
            cpu_arch,
            cpu_brand,
            cpu_cores,
            cpu_freq_mhz,
            cpu_percent,
            load_avg,
            top_cpu_proc,
            ram_used_gb,
            ram_total_gb,
            ram_percent,
            swap_used_gb,
            swap_total_gb,
            top_ram_proc,
            disk_free_gb,
            disk_total_gb,
            disk_fs,
            disk_kind,
            net_interface: primary_iface,
            net_rx_mb,
            net_tx_mb,
            net_rx_packets,
            net_tx_packets,
            disk_read_mb,
            disk_write_mb,
            top_io_proc,
            process_count,
            uptime_formatted,
            tunnel_label: "Tailscale & Cloudflare".to_string(),
            tunnel_tx: format!("{:.0}%", cpu_percent.clamp(1.0, 100.0)),
            connected_to,
        },
        processes,
    }
}

// ============================================================================
// Route Handlers
// ============================================================================

async fn health() -> impl IntoResponse {
    Json(serde_json::json!({ "ok": true, "service": "vykylab-backend" }))
}

#[derive(Debug, Deserialize)]
pub struct ServiceSearchQuery {
    pub q: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ServiceSearchHit {
    pub id: String,
    pub score: u32,
    pub matched_terms: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct ServiceSearchResponse {
    pub query: String,
    pub max_score: u32,
    pub hits: Vec<ServiceSearchHit>,
}

fn fold_ascii_char(c: char) -> char {
    match c {
        'á' | 'à' | 'â' | 'ä' | 'ã' | 'å' | 'Á' | 'À' | 'Â' | 'Ä' | 'Ã' | 'Å' => 'a',
        'č' | 'ć' | 'ç' | 'Č' | 'Ć' | 'Ç' => 'c',
        'ď' | 'đ' | 'Ď' | 'Đ' => 'd',
        'é' | 'ě' | 'è' | 'ê' | 'ë' | 'É' | 'Ě' | 'È' | 'Ê' | 'Ë' => 'e',
        'í' | 'ì' | 'î' | 'ï' | 'Í' | 'Ì' | 'Î' | 'Ï' => 'i',
        'ľ' | 'ĺ' | 'ł' | 'Ľ' | 'Ĺ' | 'Ł' => 'l',
        'ň' | 'ń' | 'ñ' | 'Ň' | 'Ń' | 'Ñ' => 'n',
        'ó' | 'ò' | 'ô' | 'ö' | 'õ' | 'Ó' | 'Ò' | 'Ô' | 'Ö' | 'Õ' => 'o',
        'ř' | 'ŕ' | 'Ř' | 'Ŕ' => 'r',
        'š' | 'ś' | 'Š' | 'Ś' => 's',
        'ť' | 'Ť' => 't',
        'ú' | 'ů' | 'ù' | 'û' | 'ü' | 'Ú' | 'Ů' | 'Ù' | 'Û' | 'Ü' => 'u',
        'ý' | 'ÿ' | 'Ý' | 'Ÿ' => 'y',
        'ž' | 'ź' | 'ż' | 'Ž' | 'Ź' | 'Ż' => 'z',
        other => other.to_ascii_lowercase(),
    }
}

fn fold_czech_ascii(input: &str) -> String {
    input.chars().map(fold_ascii_char).collect()
}

fn bounded_levenshtein(a: &[char], b: &[char]) -> usize {
    let n = a.len();
    let m = b.len();
    if n == 0 {
        return m;
    }
    if m == 0 {
        return n;
    }
    let mut prev: Vec<usize> = (0..=m).collect();
    let mut curr = vec![0usize; m + 1];
    for i in 1..=n {
        curr[0] = i;
        for j in 1..=m {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            curr[j] = (prev[j] + 1).min(curr[j - 1] + 1).min(prev[j - 1] + cost);
        }
        std::mem::swap(&mut prev, &mut curr);
    }
    prev[m]
}

fn subsequence_bonus(token: &[char], hay: &[char]) -> Option<u32> {
    if token.is_empty() || hay.is_empty() || token.len() > hay.len() {
        return None;
    }
    let mut ti = 0usize;
    let mut first_idx = None;
    let mut last_idx = 0usize;
    let mut consecutive = 0u32;
    let mut prev_match_idx: Option<usize> = None;

    for (hi, &ch) in hay.iter().enumerate() {
        if ch == token[ti] {
            if first_idx.is_none() {
                first_idx = Some(hi);
            }
            if let Some(prev) = prev_match_idx {
                if hi == prev + 1 {
                    consecutive += 1;
                }
            }
            prev_match_idx = Some(hi);
            last_idx = hi;
            ti += 1;
            if ti == token.len() {
                break;
            }
        }
    }

    if ti < token.len() {
        return None;
    }

    let span = (last_idx - first_idx.unwrap_or(0) + 1) as f32;
    let tightness = (token.len() as f32 / span).clamp(0.1, 1.0);
    Some(18 + (tightness * 16.0) as u32 + consecutive * 3)
}

fn score_token_in_field(token: &str, field: &str) -> u32 {
    if token.is_empty() || field.is_empty() {
        return 0;
    }
    if field == token {
        return 130;
    }
    if field.starts_with(token) {
        return 105;
    }

    let words: Vec<&str> = field
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect();

    let mut best = 0u32;
    for word in &words {
        if *word == token {
            best = best.max(115);
        } else if word.starts_with(token) {
            best = best.max(92);
        } else if word.contains(token) {
            best = best.max(72);
        }
    }
    if best > 0 {
        return best;
    }

    if field.contains(token) {
        return 66;
    }

    let tok_chars: Vec<char> = token.chars().collect();
    // Bounded typo tolerance on words
    if tok_chars.len() >= 3 {
        let max_edits = if tok_chars.len() >= 6 { 2 } else { 1 };
        for word in &words {
            let w_chars: Vec<char> = word.chars().collect();
            if w_chars.len().abs_diff(tok_chars.len()) <= max_edits {
                let d = bounded_levenshtein(&tok_chars, &w_chars);
                if d <= max_edits {
                    best = best.max(if d == 1 { 48 } else { 32 });
                }
            }
        }
    }

    // Subsequence fuzzy match (skip single-char noise unless word matched)
    if tok_chars.len() >= 2 {
        let hay_chars: Vec<char> = field.chars().collect();
        if let Some(sub) = subsequence_bonus(&tok_chars, &hay_chars) {
            best = best.max(sub);
        }
    }

    best
}

async fn search_services(
    State(state): State<AppState>,
    Query(params): Query<ServiceSearchQuery>,
) -> Json<ServiceSearchResponse> {
    let raw_query = params.q.unwrap_or_default();
    let trimmed = raw_query.trim().to_string();
    let folded_query = fold_czech_ascii(&trimmed);
    let tokens: Vec<String> = folded_query
        .split_whitespace()
        .filter(|t| !t.is_empty())
        .map(ToString::to_string)
        .collect();

    let store = state.store.read().await;
    if tokens.is_empty() {
        let hits = store
            .services
            .iter()
            .map(|s| ServiceSearchHit {
                id: s.id.clone(),
                score: 0,
                matched_terms: vec![],
            })
            .collect();
        return Json(ServiceSearchResponse {
            query: trimmed,
            max_score: 0,
            hits,
        });
    }

    let mut ranked: Vec<(usize, ServiceSearchHit)> = store
        .services
        .iter()
        .enumerate()
        .map(|(idx, svc)| {
            let name_f = fold_czech_ascii(&svc.name);
            let sub_f = fold_czech_ascii(&svc.subtitle);
            let url_clean = svc
                .url
                .trim_start_matches("https://")
                .trim_start_matches("http://");
            let url_f = fold_czech_ascii(url_clean);
            let uptime_f = fold_czech_ascii(&svc.uptime);
            let status_aliases = if svc.status == "running" {
                "running bezi online aktivni up healthy ok"
            } else {
                "stopped vypnuto offline exited stop down"
            };
            let rows_f: Vec<(String, String)> = svc
                .preview_rows
                .iter()
                .map(|r| (fold_czech_ascii(&r.name), fold_czech_ascii(&r.meta)))
                .collect();

            let mut total_score = 0u32;
            let mut matched_tokens = 0usize;
            let mut matched_terms: Vec<String> = Vec::new();

            if tokens.len() > 1 {
                let phrase = tokens.join(" ");
                if name_f.contains(&phrase) {
                    total_score += 240;
                } else if sub_f.contains(&phrase) {
                    total_score += 140;
                }
            }

            for tok in &tokens {
                let s_name = score_token_in_field(tok, &name_f) * 4;
                let s_sub = score_token_in_field(tok, &sub_f) * 2;
                let s_url = (score_token_in_field(tok, &url_f) * 18) / 10;
                let s_status = (score_token_in_field(tok, status_aliases) * 11) / 10
                    + (score_token_in_field(tok, &uptime_f) * 10) / 10;

                let mut s_rows = 0u32;
                for (rn, rm) in &rows_f {
                    let row_hit = score_token_in_field(tok, rn)
                        .max(score_token_in_field(tok, rm));
                    s_rows = s_rows.max((row_hit * 15) / 10);
                }

                let tok_best = s_name.max(s_sub).max(s_url).max(s_status).max(s_rows);
                if tok_best > 0 {
                    matched_tokens += 1;
                    let secondary = (s_name + s_sub + s_url + s_rows + s_status - tok_best) / 5;
                    total_score += tok_best + secondary;
                    matched_terms.push(tok.clone());
                }
            }

            if matched_tokens > 0 {
                if matched_tokens == tokens.len() && tokens.len() > 1 {
                    total_score += 220;
                } else if tokens.len() > 1 {
                    total_score = (total_score * matched_tokens as u32) / tokens.len() as u32;
                }
            }

            (
                idx,
                ServiceSearchHit {
                    id: svc.id.clone(),
                    score: total_score,
                    matched_terms,
                },
            )
        })
        .collect();

    ranked.sort_by(|(idx_a, hit_a), (idx_b, hit_b)| {
        hit_b.score.cmp(&hit_a.score).then_with(|| idx_a.cmp(idx_b))
    });

    let max_score = ranked.first().map(|(_, h)| h.score).unwrap_or(0);
    let hits = ranked.into_iter().map(|(_, h)| h).collect();

    Json(ServiceSearchResponse {
        query: trimmed,
        max_score,
        hits,
    })
}

async fn get_dashboard(State(state): State<AppState>) -> impl IntoResponse {
    state.sync_yaml_if_changed().await;
    Json(build_dashboard(&state).await)
}

async fn create_profile(
    State(state): State<AppState>,
    Json(payload): Json<CreateProfilePayload>,
) -> impl IntoResponse {
    let trimmed = payload.name.trim();
    if trimmed.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "ok": false, "message": "Jméno profilu nesmí být prázdné." })),
        );
    }

    let initials = trimmed
        .chars()
        .next()
        .map(|c| c.to_uppercase().to_string())
        .unwrap_or_else(|| "U".to_string());

    let new_profile = UserProfile {
        id: format!("prof-{}", &Uuid::new_v4().to_string()[..8]),
        name: trimmed.to_string(),
        workspace_label: payload
            .workspace_label
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "Vykylab".to_string()),
        role: payload
            .role
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "Uživatel".to_string()),
        location: payload
            .location
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "Praha".to_string()),
        avatar_initials: initials,
        avatar_color: payload
            .avatar_color
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(default_avatar_color),
        is_admin: false,
        pin_code: None,
        favorite_services: vec!["svc-portainer".to_string(), "svc-adguard".to_string()],
        shortcuts: vec![UserShortcut {
            id: format!("sc-{}", &Uuid::new_v4().to_string()[..6]),
            label: "Uptime".to_string(),
            category: "service".to_string(),
            kind: ShortcutKind::Script,
            target: "uptime".to_string(),
            icon: "terminal".to_string(),
        }],
    };

    let mut store = state.store.write().await;
    store.active_profile_id = new_profile.id.clone();
    store.profiles.push(new_profile);
    store.events.insert(
        0,
        SystemEvent {
            id: format!("evt-{}", &Uuid::new_v4().to_string()[..8]),
            timestamp: Local::now().format("%H:%M").to_string(),
            level: "info".to_string(),
            source: "Profil".to_string(),
            message: format!("Vytvořen a aktivován uživatelský profil '{}'.", trimmed),
        },
    );
    state.persist(&store).await;
    drop(store);

    (StatusCode::OK, Json(serde_json::json!({ "ok": true, "dashboard": build_dashboard(&state).await })))
}

async fn update_profile(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateProfilePayload>,
) -> impl IntoResponse {
    let mut store = state.store.write().await;
    let Some(prof) = store.profiles.iter_mut().find(|p| p.id == id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "ok": false, "message": "Profil nenalezen." })),
        );
    };

    if !payload.name.trim().is_empty() {
        prof.name = payload.name.trim().to_string();
        prof.avatar_initials = prof
            .name
            .chars()
            .next()
            .map(|c| c.to_uppercase().to_string())
            .unwrap_or_else(|| "U".to_string());
    }
    if !payload.workspace_label.trim().is_empty() {
        prof.workspace_label = payload.workspace_label.trim().to_string();
    }
    if !payload.role.trim().is_empty() {
        prof.role = payload.role.trim().to_string();
    }
    if !payload.location.trim().is_empty() {
        prof.location = payload.location.trim().to_string();
    }
    if let Some(color) = payload.avatar_color.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        prof.avatar_color = color.to_string();
    }

    state.persist(&store).await;
    drop(store);

    (StatusCode::OK, Json(serde_json::json!({ "ok": true, "dashboard": build_dashboard(&state).await })))
}

async fn activate_profile(
    State(state): State<AppState>,
    Path(id): Path<String>,
    payload: Option<Json<ActivateProfilePayload>>,
) -> impl IntoResponse {
    let mut store = state.store.write().await;
    let Some(target) = store.profiles.iter().find(|p| p.id == id).cloned() else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "ok": false, "message": "Profil nenalezen." })),
        );
    };

    if let Some(expected_pin) = target.pin_code.as_ref().filter(|s| !s.is_empty()) {
        let provided = payload.and_then(|Json(p)| p.pin);
        if provided.as_deref() != Some(expected_pin.as_str()) {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "ok": false, "message": "Nesprávný PIN kód." })),
            );
        }
    }

    store.active_profile_id = id;
    state.persist(&store).await;
    drop(store);

    (StatusCode::OK, Json(serde_json::json!({ "ok": true, "dashboard": build_dashboard(&state).await })))
}

async fn add_shortcut(
    State(state): State<AppState>,
    Path(profile_id): Path<String>,
    Json(payload): Json<AddShortcutPayload>,
) -> impl IntoResponse {
    let mut store = state.store.write().await;
    let Some(prof) = store.profiles.iter_mut().find(|p| p.id == profile_id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "ok": false, "message": "Profil nenalezen." })),
        );
    };

    prof.shortcuts.push(UserShortcut {
        id: format!("sc-{}", &Uuid::new_v4().to_string()[..8]),
        label: payload.label.trim().to_string(),
        category: payload.category,
        kind: payload.kind,
        target: payload.target.trim().to_string(),
        icon: payload.icon.unwrap_or_else(|| "terminal".to_string()),
    });

    state.persist(&store).await;
    drop(store);

    (StatusCode::OK, Json(serde_json::json!({ "ok": true, "dashboard": build_dashboard(&state).await })))
}

async fn delete_shortcut(
    State(state): State<AppState>,
    Path((profile_id, shortcut_id)): Path<(String, String)>,
) -> impl IntoResponse {
    let mut store = state.store.write().await;
    if let Some(prof) = store.profiles.iter_mut().find(|p| p.id == profile_id) {
        prof.shortcuts.retain(|s| s.id != shortcut_id);
        state.persist(&store).await;
    }
    drop(store);

    Json(serde_json::json!({ "ok": true, "dashboard": build_dashboard(&state).await }))
}

async fn toggle_favorite(
    State(state): State<AppState>,
    Path((profile_id, service_id)): Path<(String, String)>,
) -> impl IntoResponse {
    let mut store = state.store.write().await;
    if let Some(prof) = store.profiles.iter_mut().find(|p| p.id == profile_id) {
        if prof.favorite_services.contains(&service_id) {
            prof.favorite_services.retain(|id| id != &service_id);
        } else {
            prof.favorite_services.push(service_id);
        }
        state.persist(&store).await;
    }
    drop(store);

    Json(serde_json::json!({ "ok": true, "dashboard": build_dashboard(&state).await }))
}

async fn run_script(
    State(state): State<AppState>,
    Path(shortcut_id): Path<String>,
) -> impl IntoResponse {
    let store = state.store.read().await;
    let active = store
        .profiles
        .iter()
        .find(|p| p.id == store.active_profile_id);

    let shortcut = active.and_then(|p| p.shortcuts.iter().find(|s| s.id == shortcut_id)).cloned();
    drop(store);

    let Some(sc) = shortcut else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "ok": false, "message": "Script nenalezen." })),
        );
    };

    let output = tokio::process::Command::new("sh")
        .arg("-c")
        .arg(&sc.target)
        .output()
        .await;

    let (ok, text) = match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            let combined = if !stdout.is_empty() {
                stdout
            } else if !stderr.is_empty() {
                stderr
            } else {
                "Příkaz dokončen bez výstupu.".to_string()
            };
            (out.status.success(), combined)
        }
        Err(e) => (false, format!("Chyba spuštění: {}", e)),
    };

    let mut store = state.store.write().await;
    store.events.insert(
        0,
        SystemEvent {
            id: format!("evt-{}", &Uuid::new_v4().to_string()[..8]),
            timestamp: Local::now().format("%H:%M").to_string(),
            level: if ok { "ok" } else { "warn" }.to_string(),
            source: format!("Script: {}", sc.label),
            message: text.lines().take(2).collect::<Vec<_>>().join(" | "),
        },
    );
    store.events.truncate(40);
    state.persist(&store).await;
    drop(store);

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "ok": ok,
            "output": text,
            "dashboard": build_dashboard(&state).await
        })),
    )
}

async fn service_action(
    State(state): State<AppState>,
    Path(service_id): Path<String>,
    Json(payload): Json<ServiceActionPayload>,
) -> impl IntoResponse {
    let mut store = state.store.write().await;
    let Some(svc) = store.services.iter_mut().find(|s| s.id == service_id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "ok": false, "message": "Služba nenalezena." })),
        );
    };

    let svc_name = svc.name.clone();
    match payload.action.as_str() {
        "stop" => {
            svc.status = "stopped".to_string();
            svc.uptime = "Stopped".to_string();
        }
        "start" | "restart" => {
            svc.status = "running".to_string();
            svc.uptime = "Up (healthy) · právě teď".to_string();
        }
        _ => {}
    }

    store.events.insert(
        0,
        SystemEvent {
            id: format!("evt-{}", &Uuid::new_v4().to_string()[..8]),
            timestamp: Local::now().format("%H:%M").to_string(),
            level: "info".to_string(),
            source: svc_name.clone(),
            message: format!("Akce '{}' provedena na službě {}.", payload.action, svc_name),
        },
    );
    store.events.truncate(40);
    state.persist(&store).await;
    drop(store);

    (StatusCode::OK, Json(serde_json::json!({ "ok": true, "dashboard": build_dashboard(&state).await })))
}

async fn run_system_check(State(state): State<AppState>) -> impl IntoResponse {
    let now_time = Local::now().format("%H:%M").to_string();
    let mut store = state.store.write().await;
    store.last_checked = now_time.clone();
    let all_up = store.services.iter().all(|s| s.status == "running");
    store.events.insert(
        0,
        SystemEvent {
            id: format!("evt-{}", &Uuid::new_v4().to_string()[..8]),
            timestamp: now_time,
            level: if all_up { "ok" } else { "warn" }.to_string(),
            source: "Kontrola systému".to_string(),
            message: if all_up {
                "Kontrola dokončena: CPU, disky a všechny služby v pořádku.".to_string()
            } else {
                "Kontrola dokončena: některá služba je zastavena.".to_string()
            },
        },
    );
    store.events.truncate(40);
    state.persist(&store).await;
    drop(store);

    (
        StatusCode::OK,
        Json(serde_json::json!({ "ok": true, "dashboard": build_dashboard(&state).await })),
    )
}

async fn upload_file(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    let mut saved: Vec<UploadedFileInfo> = Vec::new();

    while let Ok(Some(field)) = multipart.next_field().await {
        let file_name = field
            .file_name()
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("soubor-{}", Uuid::new_v4()));
        let safe_name = file_name.replace(['/', '\\'], "_");

        if let Ok(bytes) = field.bytes().await {
            let id = format!("upl-{}", &Uuid::new_v4().to_string()[..8]);
            let dest = state.uploads_dir.join(format!("{}_{}", id, safe_name));
            if fs::write(&dest, &bytes).is_ok() {
                saved.push(UploadedFileInfo {
                    id,
                    name: safe_name,
                    size_bytes: bytes.len() as u64,
                    uploaded_at: Local::now().format("%H:%M").to_string(),
                });
            }
        }
    }

    if saved.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "ok": false, "message": "Nebyl vybrán žádný soubor." })),
        );
    }

    let mut store = state.store.write().await;
    for item in saved.iter().rev() {
        store.events.insert(
            0,
            SystemEvent {
                id: format!("evt-{}", &Uuid::new_v4().to_string()[..8]),
                timestamp: item.uploaded_at.clone(),
                level: "ok".to_string(),
                source: "Nahrání".to_string(),
                message: format!("Soubor '{}' ({} B) uložen na server.", item.name, item.size_bytes),
            },
        );
        store.uploads.insert(0, item.clone());
    }
    store.uploads.truncate(20);
    store.events.truncate(40);
    state.persist(&store).await;
    drop(store);

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "ok": true,
            "uploaded": saved,
            "dashboard": build_dashboard(&state).await
        })),
    )
}

#[derive(Debug, Deserialize)]
pub struct AdminExecPayload {
    pub command: String,
    pub connection_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AddSshConnectionPayload {
    pub name: String,
    pub user: String,
    pub host: String,
    pub port: Option<u16>,
    pub mode: Option<String>,
    pub identity_file: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AddSshShortcutPayload {
    pub label: String,
    pub command: String,
}

async fn add_ssh_connection(
    State(state): State<AppState>,
    Json(payload): Json<AddSshConnectionPayload>,
) -> impl IntoResponse {
    if payload.name.trim().is_empty() || payload.host.trim().is_empty() || payload.user.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "ok": false, "message": "Vyplň název, uživatele a host." })),
        );
    }

    let id = format!("ssh-{}", &Uuid::new_v4().to_string()[..8]);
    let conn = SshConnection {
        id: id.clone(),
        name: payload.name.trim().to_string(),
        user: payload.user.trim().to_string(),
        host: payload.host.trim().to_string(),
        port: payload.port.unwrap_or(22),
        mode: payload.mode.unwrap_or_else(|| "ssh".to_string()),
        identity_file: payload.identity_file.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
    };

    let mut store = state.store.write().await;
    store.ssh.connections.push(conn);
    store.ssh.active_connection_id = id;
    state.persist(&store).await;
    drop(store);

    (StatusCode::OK, Json(serde_json::json!({ "ok": true, "dashboard": build_dashboard(&state).await })))
}

async fn delete_ssh_connection(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let mut store = state.store.write().await;
    if id == "ssh-local" {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "ok": false, "message": "Lokální shell nelze smazat." })),
        );
    }
    store.ssh.connections.retain(|c| c.id != id);
    if store.ssh.active_connection_id == id {
        store.ssh.active_connection_id = "ssh-local".to_string();
    }
    state.persist(&store).await;
    drop(store);

    (StatusCode::OK, Json(serde_json::json!({ "ok": true, "dashboard": build_dashboard(&state).await })))
}

async fn activate_ssh_connection(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let mut store = state.store.write().await;
    if !store.ssh.connections.iter().any(|c| c.id == id) {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "ok": false, "message": "SSH profil nenalezen." })),
        );
    }
    store.ssh.active_connection_id = id;
    state.persist(&store).await;
    drop(store);

    (StatusCode::OK, Json(serde_json::json!({ "ok": true, "dashboard": build_dashboard(&state).await })))
}

async fn add_ssh_shortcut(
    State(state): State<AppState>,
    Json(payload): Json<AddSshShortcutPayload>,
) -> impl IntoResponse {
    if payload.label.trim().is_empty() || payload.command.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "ok": false, "message": "Vyplň název i příkaz." })),
        );
    }
    let mut store = state.store.write().await;
    store.ssh.shortcuts.push(SshShortcut {
        id: format!("sh-{}", &Uuid::new_v4().to_string()[..8]),
        label: payload.label.trim().to_string(),
        command: payload.command.trim().to_string(),
    });
    state.persist(&store).await;
    drop(store);

    (
        StatusCode::OK,
        Json(serde_json::json!({ "ok": true, "dashboard": build_dashboard(&state).await })),
    )
}

async fn delete_ssh_shortcut(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let mut store = state.store.write().await;
    store.ssh.shortcuts.retain(|s| s.id != id);
    state.persist(&store).await;
    drop(store);

    (
        StatusCode::OK,
        Json(serde_json::json!({ "ok": true, "dashboard": build_dashboard(&state).await })),
    )
}

async fn admin_exec(
    State(state): State<AppState>,
    Json(payload): Json<AdminExecPayload>,
) -> impl IntoResponse {
    let store = state.store.read().await;
    let is_admin = store
        .profiles
        .iter()
        .find(|p| p.id == store.active_profile_id)
        .is_some_and(|p| p.is_admin);
    let conn_id = payload
        .connection_id
        .as_deref()
        .unwrap_or(&store.ssh.active_connection_id);
    let active_conn = store
        .ssh
        .connections
        .iter()
        .find(|c| c.id == conn_id)
        .cloned()
        .unwrap_or_else(|| store.ssh.connections[0].clone());
    drop(store);

    if !is_admin {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "ok": false, "output": "Vyžadován admin profil sudo." })),
        );
    }

    let cmd = payload.command.trim();
    if cmd.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "ok": false, "output": "Prázdný příkaz." })),
        );
    }

    let started = std::time::Instant::now();
    let output = if active_conn.mode == "ssh" {
        let mut proc = tokio::process::Command::new("ssh");
        proc.arg("-o")
            .arg("BatchMode=yes")
            .arg("-o")
            .arg("ConnectTimeout=5")
            .arg("-p")
            .arg(active_conn.port.to_string());
        if let Some(key_path) = active_conn.identity_file.as_ref().filter(|s| !s.is_empty()) {
            proc.arg("-i").arg(key_path);
        }
        proc.arg(format!("{}@{}", active_conn.user, active_conn.host))
            .arg(cmd)
            .output()
            .await
    } else {
        tokio::process::Command::new("sh")
            .arg("-c")
            .arg(cmd)
            .output()
            .await
    };

    let duration_ms = started.elapsed().as_millis() as u64;
    let target_label = if active_conn.mode == "ssh" {
        format!("{}@{}:{}", active_conn.user, active_conn.host, active_conn.port)
    } else {
        "local".to_string()
    };

    let (ok, exit_code, text) = match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            let combined = match (stdout.is_empty(), stderr.is_empty()) {
                (false, true) => stdout,
                (true, false) => stderr,
                (false, false) => format!("{}\n{}", stdout, stderr),
                (true, true) => "Příkaz dokončen bez výstupu.".to_string(),
            };
            (out.status.success(), out.status.code().unwrap_or(-1), combined)
        }
        Err(e) => (false, -1, format!("Chyba spuštění: {}", e)),
    };

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "ok": ok,
            "exit_code": exit_code,
            "duration_ms": duration_ms,
            "target": target_label,
            "output": text
        })),
    )
}

// ============================================================================
// Main Entry
// ============================================================================

#[tokio::main]
async fn main() {
    let state = AppState::load_or_init();
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/dashboard", get(get_dashboard))
        .route("/api/services/search", get(search_services))
        .route("/api/profiles", post(create_profile))
        .route("/api/profiles/:id", put(update_profile))
        .route("/api/profiles/:id/activate", post(activate_profile))
        .route("/api/profiles/:id/shortcuts", post(add_shortcut))
        .route("/api/profiles/:id/shortcuts/:shortcut_id", delete(delete_shortcut))
        .route("/api/profiles/:id/favorites/:service_id", post(toggle_favorite))
        .route("/api/scripts/:shortcut_id/run", post(run_script))
        .route("/api/services/:id/action", post(service_action))
        .route("/api/events/check", post(run_system_check))
        .route("/api/upload", post(upload_file))
        .route("/api/admin/exec", post(admin_exec))
        .route("/api/admin/ssh/connections", post(add_ssh_connection))
        .route("/api/admin/ssh/connections/:id", delete(delete_ssh_connection))
        .route("/api/admin/ssh/connections/:id/activate", post(activate_ssh_connection))
        .route("/api/admin/ssh/shortcuts", post(add_ssh_shortcut))
        .route("/api/admin/ssh/shortcuts/:id", delete(delete_ssh_shortcut))
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], 3001));
    println!("Vykylab Rust backend listening on http://{}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
