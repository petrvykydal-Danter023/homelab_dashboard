use axum::{
    extract::{Multipart, Path, Query, State},
    http::{header, StatusCode},
    response::IntoResponse,
    routing::{delete, get, post, put},
    Json, Router,
};
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    net::SocketAddr,
    path::{Path as StdPath, PathBuf},
    sync::Arc,
    time::{Duration, Instant, SystemTime},
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
    #[serde(default)]
    pub visible_services: Option<Vec<String>>,
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
    pub visible_services: Option<Vec<String>>,
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
            visible_services: p.visible_services.clone(),
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

fn default_true() -> bool {
    true
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
    #[serde(default)]
    pub image_url: Option<String>,
    #[serde(default = "default_true")]
    pub is_docker: bool,
    #[serde(default)]
    pub container_name: Option<String>,
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
pub struct NoticeboardItem {
    pub id: String,
    pub title: String,
    pub message: String,
    pub author: String,
    pub tag: String, // "Oznámení" | "Info" | "Údržba"
    #[serde(default)]
    pub pinned: bool,
    pub timestamp: String,
}

fn default_noticeboard() -> Vec<NoticeboardItem> {
    vec![
        NoticeboardItem {
            id: "note-welcome".to_string(),
            title: "Vykylab běží bez problémů".to_string(),
            message: "Všechny domácí služby jsou online. Kdyby něco nešlo, mrkni sem na případnou plánovanou údržbu.".to_string(),
            author: "Sudo".to_string(),
            tag: "Info".to_string(),
            pinned: true,
            timestamp: Local::now().format("%-d.%-m. · %H:%M").to_string(),
        },
        NoticeboardItem {
            id: "note-photos".to_string(),
            title: "Záloha fotek na Immichu".to_string(),
            message: "Zálohování fotek z mobilů jede automaticky v noci po připojení na domácí Wi-Fi.".to_string(),
            author: "Sudo".to_string(),
            tag: "Oznámení".to_string(),
            pinned: false,
            timestamp: "Dnes · 08:30".to_string(),
        },
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedStore {
    pub active_profile_id: String,
    pub profiles: Vec<UserProfile>,
    pub services: Vec<HomelabService>,
    pub uploads: Vec<UploadedFileInfo>,
    #[serde(default = "default_ssh_config")]
    pub ssh: SshConfig,
    #[serde(default = "default_noticeboard")]
    pub noticeboard: Vec<NoticeboardItem>,
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
    pub connected_to: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cpu_percent: f32,
    pub memory_mb: f64,
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
    pub docker_live: bool,
    pub services: Vec<HomelabService>,
    pub noticeboard: Vec<NoticeboardItem>,
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
pub struct UpdateProfilePayload {
    pub name: Option<String>,
    pub workspace_label: Option<String>,
    pub role: Option<String>,
    pub location: Option<String>,
    pub avatar_color: Option<String>,
    pub visible_services: Option<Vec<String>>,
    pub pin_code: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AdminServicePayload {
    pub name: String,
    pub url: String,
    pub subtitle: Option<String>,
    pub icon: Option<String>,
    pub image_url: Option<String>,
    pub is_docker: Option<bool>,
    pub container_name: Option<String>,
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

#[derive(Debug, Deserialize)]
pub struct CreateNoticeboardPayload {
    pub title: String,
    pub message: String,
    pub tag: Option<String>,
    pub pinned: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateNoticeboardPayload {
    pub title: Option<String>,
    pub message: Option<String>,
    pub tag: Option<String>,
    pub pinned: Option<bool>,
}

// ============================================================================
// App State & Persistence
// ============================================================================

#[derive(Clone)]
struct WeatherEntry {
    summary: String,
    fetched_at: Instant,
}

#[derive(Clone)]
struct AppState {
    store_path: PathBuf,
    profiles_yaml_path: PathBuf,
    profiles_yaml_mtime: Arc<RwLock<Option<SystemTime>>>,
    uploads_dir: PathBuf,
    service_images_dir: PathBuf,
    http: reqwest::Client,
    weather_cache: Arc<RwLock<HashMap<String, WeatherEntry>>>,
    docker_cache: Arc<RwLock<Option<(Instant, Option<Vec<DockerPsRow>>)>>>,
    store: Arc<RwLock<PersistedStore>>,
    sys: Arc<RwLock<System>>,
}

impl AppState {
    fn load_or_init() -> Self {
        let data_dir = PathBuf::from("data");
        let uploads_dir = data_dir.join("uploads");
        let service_images_dir = data_dir.join("service-images");
        let store_path = data_dir.join("store.json");
        let profiles_yaml_path = data_dir.join("profiles.yaml");

        let _ = fs::create_dir_all(&uploads_dir);
        let _ = fs::create_dir_all(&service_images_dir);

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

        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(4))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            store_path,
            profiles_yaml_path,
            profiles_yaml_mtime: Arc::new(RwLock::new(yaml_mtime)),
            uploads_dir,
            service_images_dir,
            http,
            weather_cache: Arc::new(RwLock::new(HashMap::new())),
            docker_cache: Arc::new(RwLock::new(None)),
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
                  # Barvy avatara (avatar_color): owl-brown | soft-pink | dark-blue | cyan | red (příp. hex např. \"#c084fc\")\n\
                  # Klasický dashboard mají všichni kromě účtu \"sudo\" (is_admin: true).\n\n";
    let body = serde_yaml::to_string(&ProfilesYamlConfig { profiles: entries })
        .map_err(std::io::Error::other)?;
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
            url: "https://traefik.vykylab.dev".to_string(),
            icon: "layers".to_string(),
            image_url: None,
            is_docker: true,
            container_name: None,
        },
        HomelabService {
            id: "svc-vaultwarden".to_string(),
            name: "Vaultwarden".to_string(),
            subtitle: "Správce hesel".to_string(),
            status: "running".to_string(),
            uptime: "Up (healthy) · 18d".to_string(),
            url: "https://vault.vykylab.dev".to_string(),
            icon: "lock".to_string(),
            image_url: None,
            is_docker: true,
            container_name: None,
        },
        HomelabService {
            id: "svc-jellyfin".to_string(),
            name: "Jellyfin".to_string(),
            subtitle: "Rodinné kino & média".to_string(),
            status: "running".to_string(),
            uptime: "Up (healthy) · 9d".to_string(),
            url: "https://media.vykylab.dev".to_string(),
            icon: "zap".to_string(),
            image_url: None,
            is_docker: true,
            container_name: None,
        },
        HomelabService {
            id: "svc-homeassistant".to_string(),
            name: "Home Assistant".to_string(),
            subtitle: "Chytrá domácnost".to_string(),
            status: "running".to_string(),
            uptime: "Up (healthy) · 14d".to_string(),
            url: "https://ha.vykylab.dev".to_string(),
            icon: "zap".to_string(),
            image_url: None,
            is_docker: true,
            container_name: None,
        },
        HomelabService {
            id: "svc-grafana".to_string(),
            name: "Grafana".to_string(),
            subtitle: "Metriky & Telemetrie".to_string(),
            status: "stopped".to_string(),
            uptime: "Exited (0) · 2d".to_string(),
            url: "https://grafana.vykylab.dev".to_string(),
            icon: "activity".to_string(),
            image_url: None,
            is_docker: true,
            container_name: None,
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
        visible_services: None,
        shortcuts: vec![
            UserShortcut {
                id: "sc-sudo-docker".to_string(),
                label: "Docker ps".to_string(),
                category: "service".to_string(),
                kind: ShortcutKind::Script,
                target: "docker ps --format 'table {{.Names}}\\t{{.Status}}' || uname -a".to_string(),
                icon: "terminal".to_string(),
            },
            UserShortcut {
                id: "sc-sudo-df".to_string(),
                label: "Disky (df -h)".to_string(),
                category: "service".to_string(),
                kind: ShortcutKind::Script,
                target: "df -h /".to_string(),
                icon: "terminal".to_string(),
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
        visible_services: None,
        shortcuts: vec![
            UserShortcut {
                id: "sc-containers".to_string(),
                label: "Docker ps".to_string(),
                category: "service".to_string(),
                kind: ShortcutKind::Script,
                target: "docker ps --format 'table {{.Names}}\\t{{.Status}}' || uname -a"
                    .to_string(),
                icon: "terminal".to_string(),
            },
            UserShortcut {
                id: "sc-disk".to_string(),
                label: "Kontrola disků".to_string(),
                category: "service".to_string(),
                kind: ShortcutKind::Script,
                target: "df -h /".to_string(),
                icon: "terminal".to_string(),
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
            url: "https://docker.vykylab.dev".to_string(),
            icon: "container".to_string(),
            image_url: None,
            is_docker: true,
            container_name: None,
        },
        HomelabService {
            id: "svc-adguard".to_string(),
            name: "AdGuard Home".to_string(),
            subtitle: "DNS & Filtering".to_string(),
            status: "running".to_string(),
            uptime: "Up (healthy) · 18d".to_string(),
            url: "https://dns.vykylab.dev".to_string(),
            icon: "shield".to_string(),
            image_url: None,
            is_docker: true,
            container_name: None,
        },
        HomelabService {
            id: "svc-immich".to_string(),
            name: "Immich".to_string(),
            subtitle: "Rodinné fotky & zálohy".to_string(),
            status: "running".to_string(),
            uptime: "Up (healthy) · 12d".to_string(),
            url: "https://photos.vykylab.dev".to_string(),
            icon: "image".to_string(),
            image_url: None,
            is_docker: true,
            container_name: None,
        },
    ];
    services.extend(default_extra_services());

    PersistedStore {
        active_profile_id: default_active_id,
        profiles,
        services,
        uploads: vec![],
        ssh: default_ssh_config(),
        noticeboard: default_noticeboard(),
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

fn weather_code_cz(code: i64, wind_kmh: f64) -> &'static str {
    match code {
        0 => {
            if wind_kmh < 8.0 {
                "jasno a bez větru"
            } else {
                "jasno"
            }
        }
        1 => "skoro jasno",
        2 => "polojasno",
        3 => "zataženo",
        45 | 48 => "mlha",
        51 | 53 | 55 | 56 | 57 => "mrholení",
        61 | 63 | 65 | 66 | 67 => "déšť",
        71 | 73 | 75 | 77 => "sněžení",
        80..=82 => "přeháňky",
        85 | 86 => "sněhové přeháňky",
        95 | 96 | 99 => "bouřka",
        _ => {
            if wind_kmh < 8.0 {
                "bez větru"
            } else {
                "oblačno"
            }
        }
    }
}

async fn fetch_open_meteo_weather(client: &reqwest::Client, location: &str) -> Option<String> {
    let trimmed = location.trim();
    if trimmed.is_empty() {
        return None;
    }

    #[derive(Deserialize)]
    struct GeoResult {
        latitude: f64,
        longitude: f64,
    }
    #[derive(Deserialize)]
    struct GeoResponse {
        results: Option<Vec<GeoResult>>,
    }
    #[derive(Deserialize)]
    struct CurrentWeather {
        temperature_2m: f64,
        weather_code: Option<i64>,
        wind_speed_10m: Option<f64>,
    }
    #[derive(Deserialize)]
    struct ForecastResponse {
        current: Option<CurrentWeather>,
    }

    let geo: GeoResponse = client
        .get("https://geocoding-api.open-meteo.com/v1/search")
        .query(&[
            ("name", trimmed),
            ("count", "1"),
            ("language", "cs"),
            ("format", "json"),
        ])
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;

    let coords = geo.results?.into_iter().next()?;
    let forecast: ForecastResponse = client
        .get("https://api.open-meteo.com/v1/forecast")
        .query(&[
            ("latitude", coords.latitude.to_string()),
            ("longitude", coords.longitude.to_string()),
            ("current", "temperature_2m,weather_code,wind_speed_10m".to_string()),
            ("timezone", "auto".to_string()),
        ])
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;

    let cur = forecast.current?;
    let temp = cur.temperature_2m.round() as i64;
    let wind = cur.wind_speed_10m.unwrap_or(0.0);
    let desc = weather_code_cz(cur.weather_code.unwrap_or(1), wind);
    Some(format!("{}°C {}", temp, desc))
}

async fn resolve_weather_for_location(state: &AppState, location: &str, fallback: &str) -> String {
    let key = location.trim().to_lowercase();
    if key.is_empty() {
        return fallback.to_string();
    }

    const WEATHER_TTL: Duration = Duration::from_secs(20 * 60);

    {
        let cache = state.weather_cache.read().await;
        if let Some(entry) = cache.get(&key) {
            if entry.fetched_at.elapsed() < WEATHER_TTL {
                return entry.summary.clone();
            }
            // Expired: return stale immediately and refresh in background
            let state_bg = state.clone();
            let loc_bg = location.trim().to_string();
            let key_bg = key.clone();
            tokio::spawn(async move {
                if let Some(summary) = fetch_open_meteo_weather(&state_bg.http, &loc_bg).await {
                    let mut w = state_bg.weather_cache.write().await;
                    w.insert(
                        key_bg,
                        WeatherEntry {
                            summary,
                            fetched_at: Instant::now(),
                        },
                    );
                }
            });
            return entry.summary.clone();
        }
    }

    // First fetch for this location: try within 1.8s so UI gets live weather right away
    let fetched = tokio::time::timeout(
        Duration::from_millis(1800),
        fetch_open_meteo_weather(&state.http, location),
    )
    .await
    .ok()
    .flatten();

    if let Some(summary) = fetched {
        let mut cache = state.weather_cache.write().await;
        cache.insert(
            key,
            WeatherEntry {
                summary: summary.clone(),
                fetched_at: Instant::now(),
            },
        );
        return summary;
    }

    fallback.to_string()
}

#[derive(Debug, Clone, Deserialize)]
struct DockerPsRow {
    #[serde(rename = "ID", default)]
    id: String,
    #[serde(rename = "Names", default)]
    names: String,
    #[serde(rename = "Image", default)]
    image: String,
    #[serde(rename = "State", default)]
    state: String,
    #[serde(rename = "Status", default)]
    status: String,
}

async fn probe_real_docker_containers() -> Option<Vec<DockerPsRow>> {
    let fut = tokio::process::Command::new("docker")
        .args(["ps", "-a", "--no-trunc", "--format", "{{json .}}"])
        .output();

    let output = tokio::time::timeout(Duration::from_millis(1400), fut)
        .await
        .ok()?
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut rows = Vec::new();
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(parsed) = serde_json::from_str::<DockerPsRow>(trimmed) {
            rows.push(parsed);
        }
    }
    Some(rows)
}

async fn get_docker_containers_cached(
    state: &AppState,
    force_refresh: bool,
) -> Option<Vec<DockerPsRow>> {
    const DOCKER_CACHE_TTL: Duration = Duration::from_secs(3);

    if !force_refresh {
        let cache = state.docker_cache.read().await;
        if let Some((fetched_at, cached)) = cache.as_ref() {
            if fetched_at.elapsed() < DOCKER_CACHE_TTL {
                return cached.clone();
            }
        }
    }

    let fresh = probe_real_docker_containers().await;
    let mut cache = state.docker_cache.write().await;
    *cache = Some((Instant::now(), fresh.clone()));
    fresh
}

fn infer_docker_url(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    if lower.contains("filebrowser") {
        "https://files.vykylab.dev".to_string()
    } else if lower.contains("portainer") {
        "https://docker.vykylab.dev".to_string()
    } else if lower.contains("adguard") {
        "https://dns.vykylab.dev".to_string()
    } else if lower.contains("dashboard") || lower.contains("caddy") {
        "https://vykylab.dev".to_string()
    } else {
        format!("https://{}.vykylab.dev", name)
    }
}

fn merge_store_and_docker_services(
    store_services_snapshot: &[HomelabService],
    real_docker_opt: Option<Vec<DockerPsRow>>,
) -> (bool, Vec<HomelabService>) {
    if let Some(real_rows) = real_docker_opt {
        let mut combined: Vec<HomelabService> =
            Vec::with_capacity(real_rows.len() + store_services_snapshot.len());
        for row in real_rows {
            let short_id: String = row.id.chars().take(12).collect();
            let existing = store_services_snapshot.iter().find(|s| {
                s.is_docker
                    && (s.id == format!("docker-{}", short_id)
                        || s.container_name.as_deref() == Some(row.names.as_str())
                        || s.name.eq_ignore_ascii_case(&row.names)
                        || row
                            .names
                            .to_ascii_lowercase()
                            .contains(&s.name.to_ascii_lowercase()))
            });

            let is_running = row.state.eq_ignore_ascii_case("running");
            let svc_status = if is_running { "running" } else { "stopped" }.to_string();
            let svc_uptime = if row.status.trim().is_empty() {
                svc_status.clone()
            } else {
                row.status.clone()
            };
            let resolved_url = existing
                .map(|e| e.url.clone())
                .filter(|u| !u.contains(".vykylab.local"))
                .unwrap_or_else(|| infer_docker_url(&row.names));

            combined.push(HomelabService {
                id: existing
                    .map(|e| e.id.clone())
                    .unwrap_or_else(|| format!("docker-{}", short_id)),
                name: existing
                    .map(|e| e.name.clone())
                    .unwrap_or_else(|| row.names.clone()),
                subtitle: existing
                    .map(|e| e.subtitle.clone())
                    .unwrap_or_else(|| row.image.clone()),
                status: svc_status,
                uptime: svc_uptime,
                url: resolved_url,
                icon: existing
                    .map(|e| e.icon.clone())
                    .unwrap_or_else(|| infer_docker_icon(&row.names, &row.image)),
                image_url: existing.and_then(|e| e.image_url.clone()),
                is_docker: true,
                container_name: Some(row.names.clone()),
            });
        }

        // Append non-Docker user links / custom cards and sync any linked container status
        for s in store_services_snapshot {
            if !s.is_docker {
                let mut cloned = s.clone();
                if let Some(ref cname) = s.container_name {
                    if let Some(target) = combined.iter().find(|d| {
                        d.is_docker
                            && (d.id == *cname
                                || d.name.eq_ignore_ascii_case(cname)
                                || d.container_name.as_deref() == Some(cname.as_str()))
                    }) {
                        cloned.status = target.status.clone();
                        cloned.uptime = target.uptime.clone();
                    }
                }
                combined.push(cloned);
            }
        }
        (true, combined)
    } else {
        let fallback: Vec<HomelabService> = store_services_snapshot
            .iter()
            .map(|s| {
                if let Some(ref cname) = s.container_name {
                    if let Some(target) = store_services_snapshot.iter().find(|d| {
                        d.is_docker && (d.id == *cname || d.name.eq_ignore_ascii_case(cname))
                    }) {
                        let mut cloned = s.clone();
                        cloned.status = target.status.clone();
                        cloned.uptime = target.uptime.clone();
                        return cloned;
                    }
                }
                s.clone()
            })
            .collect();
        (false, fallback)
    }
}

fn infer_docker_icon(name: &str, image: &str) -> String {
    let hay = format!("{} {}", name.to_ascii_lowercase(), image.to_ascii_lowercase());
    if hay.contains("adguard") || hay.contains("pihole") || hay.contains("guard") {
        "shield".to_string()
    } else if hay.contains("immich") || hay.contains("photo") {
        "image".to_string()
    } else if hay.contains("vault") || hay.contains("bitwarden") {
        "lock".to_string()
    } else if hay.contains("traefik") || hay.contains("nginx") || hay.contains("caddy") {
        "layers".to_string()
    } else if hay.contains("jellyfin") || hay.contains("plex") {
        "film".to_string()
    } else if hay.contains("homeassistant") || hay.contains("home-assistant") {
        "home".to_string()
    } else if hay.contains("grafana") || hay.contains("prometheus") {
        "activity".to_string()
    } else if hay.contains("postgres") || hay.contains("redis") || hay.contains("mariadb") {
        "database".to_string()
    } else {
        "container".to_string()
    }
}

fn resolve_docker_target_name(service_id: &str, store_services: &[HomelabService]) -> Option<String> {
    if let Some(short) = service_id.strip_prefix("docker-") {
        if !short.is_empty() {
            return Some(short.to_string());
        }
    }
    store_services
        .iter()
        .find(|s| s.id == service_id)
        .map(|s| s.container_name.clone().unwrap_or_else(|| s.name.clone()))
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

    let store_services_snapshot = store.services.clone();
    let connected_to = format!("{} Main-server", active_profile.workspace_label);
    let fallback_weather = store.weather_summary.clone();
    let active_location = active_profile.location.clone();
    let last_checked = store.last_checked.clone();
    let mut noticeboard = store.noticeboard.clone();
    noticeboard.sort_by_key(|n| !n.pinned);
    let uploads = store.uploads.clone();
    let ssh = store.ssh.clone();
    let profiles: Vec<PublicUserProfile> = store.profiles.iter().map(PublicUserProfile::from).collect();
    drop(store);

    let (real_docker_opt, weather_summary) = tokio::join!(
        get_docker_containers_cached(state, false),
        resolve_weather_for_location(state, &active_location, &fallback_weather)
    );

    let (docker_live, synced_services) =
        merge_store_and_docker_services(&store_services_snapshot, real_docker_opt);

    let any_stopped = synced_services
        .iter()
        .any(|s| s.is_docker && s.status != "running");
    let system_healthy = !any_stopped;
    let system_status_text = if system_healthy {
        "vše je v pořádku".to_string()
    } else {
        "některá služba neběží".to_string()
    };

    DashboardResponse {
        date_label: Local::now().format("%-d.%-m.").to_string(),
        weather_summary,
        last_checked,
        system_healthy,
        system_status_text,
        active_profile: PublicUserProfile::from(&active_profile),
        profiles,
        docker_live,
        services: synced_services,
        noticeboard,
        uploads,
        ssh,
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
    let visible_filter = store
        .profiles
        .iter()
        .find(|p| p.id == store.active_profile_id)
        .and_then(|p| p.visible_services.clone());
    let store_services_snapshot = store.services.clone();
    drop(store);

    let real_docker_opt = get_docker_containers_cached(&state, false).await;
    let (_docker_live, synced_services) =
        merge_store_and_docker_services(&store_services_snapshot, real_docker_opt);

    let visible_services_iter = synced_services.iter().filter(|svc| {
        visible_filter
            .as_ref()
            .map(|ids| ids.iter().any(|id| id == &svc.id))
            .unwrap_or(true)
    });

    if tokens.is_empty() {
        let hits = visible_services_iter
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

    let mut ranked: Vec<(usize, ServiceSearchHit)> = visible_services_iter
        .enumerate()
        .map(|(idx, svc)| {
            let name_f = fold_czech_ascii(&svc.name);
            let cname_f = svc
                .container_name
                .as_deref()
                .map(fold_czech_ascii)
                .unwrap_or_default();
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
                "stopped vypnuto offline exited stop down restarting restart error"
            };

            let mut total_score = 0u32;
            let mut matched_tokens = 0usize;
            let mut matched_terms: Vec<String> = Vec::new();

            if tokens.len() > 1 {
                let phrase = tokens.join(" ");
                if name_f.contains(&phrase) {
                    total_score += 240;
                } else if !cname_f.is_empty() && cname_f.contains(&phrase) {
                    total_score += 180;
                } else if sub_f.contains(&phrase) {
                    total_score += 140;
                }
            }

            for tok in &tokens {
                let s_name = score_token_in_field(tok, &name_f) * 4;
                let s_cname = score_token_in_field(tok, &cname_f) * 3;
                let s_sub = score_token_in_field(tok, &sub_f) * 2;
                let s_url = (score_token_in_field(tok, &url_f) * 18) / 10;
                let s_status = (score_token_in_field(tok, status_aliases) * 11) / 10
                    + (score_token_in_field(tok, &uptime_f) * 10) / 10;

                let tok_best = s_name.max(s_cname).max(s_sub).max(s_url).max(s_status);
                if tok_best > 0 {
                    matched_tokens += 1;
                    let secondary =
                        (s_name + s_cname + s_sub + s_url + s_status - tok_best) / 5;
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

    if let Some(name) = payload.name.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        prof.name = name.to_string();
        prof.avatar_initials = prof
            .name
            .chars()
            .next()
            .map(|c| c.to_uppercase().to_string())
            .unwrap_or_else(|| "U".to_string());
    }
    if let Some(ws) = payload.workspace_label.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        prof.workspace_label = ws.to_string();
    }
    if let Some(role) = payload.role.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        prof.role = role.to_string();
    }
    if let Some(loc) = payload.location.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        prof.location = loc.to_string();
    }
    if let Some(color) = payload.avatar_color.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        prof.avatar_color = color.to_string();
    }
    if let Some(vis) = payload.visible_services {
        prof.visible_services = Some(vis);
    }
    if let Some(pin) = payload.pin_code {
        let trimmed = pin.trim();
        prof.pin_code = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        };
    }

    state.persist(&store).await;
    drop(store);

    (StatusCode::OK, Json(serde_json::json!({ "ok": true, "dashboard": build_dashboard(&state).await })))
}

async fn create_admin_service(
    State(state): State<AppState>,
    Json(payload): Json<AdminServicePayload>,
) -> impl IntoResponse {
    let name = payload.name.trim();
    let url = payload.url.trim();
    if name.is_empty() || url.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "ok": false, "message": "Vyplň název i URL adresu." })),
        );
    }

    let id = format!("svc-{}", &Uuid::new_v4().to_string()[..8]);
    let is_docker = payload.is_docker.unwrap_or(false);
    let container_name = payload
        .container_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string);
    let subtitle = payload
        .subtitle
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| {
            if let Some(ref cname) = container_name {
                cname.clone()
            } else {
                "Webový odkaz".to_string()
            }
        });
    let icon = payload
        .icon
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| if is_docker || container_name.is_some() { "container" } else { "layers" })
        .to_string();
    let image_url = payload
        .image_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string);

    let mut store = state.store.write().await;
    let linked_container = container_name.as_ref().and_then(|cname| {
        store.services.iter().find(|s| s.is_docker && (s.id == *cname || s.name.eq_ignore_ascii_case(cname)))
    });
    let (status, uptime, resolved_container_name) = if let Some(target) = linked_container {
        (target.status.clone(), target.uptime.clone(), Some(target.name.clone()))
    } else if is_docker {
        ("running".to_string(), "Up (healthy) · právě teď".to_string(), container_name.clone())
    } else {
        ("running".to_string(), "Webový odkaz".to_string(), container_name.clone())
    };

    let new_service = HomelabService {
        id: id.clone(),
        name: name.to_string(),
        subtitle,
        status,
        uptime,
        url: url.to_string(),
        icon,
        image_url,
        is_docker,
        container_name: resolved_container_name,
    };

    store.services.push(new_service);
    state.persist(&store).await;
    drop(store);

    (
        StatusCode::OK,
        Json(serde_json::json!({ "ok": true, "service_id": id, "dashboard": build_dashboard(&state).await })),
    )
}

async fn update_admin_service(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<AdminServicePayload>,
) -> impl IntoResponse {
    let mut store = state.store.write().await;
    let Some(svc) = store.services.iter_mut().find(|s| s.id == id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "ok": false, "message": "Služba nenalezena." })),
        );
    };

    if !payload.name.trim().is_empty() {
        svc.name = payload.name.trim().to_string();
    }
    if !payload.url.trim().is_empty() {
        svc.url = payload.url.trim().to_string();
    }
    if let Some(sub) = payload.subtitle.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        svc.subtitle = sub.to_string();
    }
    if let Some(icon) = payload.icon.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        svc.icon = icon.to_string();
    }
    if let Some(img) = payload.image_url {
        let trimmed = img.trim();
        svc.image_url = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        };
    }
    if let Some(is_d) = payload.is_docker {
        svc.is_docker = is_d;
    }
    if let Some(cname) = payload.container_name {
        let trimmed = cname.trim();
        svc.container_name = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        };
    }

    state.persist(&store).await;
    drop(store);

    (
        StatusCode::OK,
        Json(serde_json::json!({ "ok": true, "dashboard": build_dashboard(&state).await })),
    )
}

async fn delete_admin_service(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let mut store = state.store.write().await;
    let removed_image = store
        .services
        .iter()
        .find(|s| s.id == id)
        .and_then(|s| s.image_url.clone());
    let before = store.services.len();
    store.services.retain(|s| s.id != id);
    if store.services.len() == before {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "ok": false, "message": "Služba nenalezena." })),
        );
    }
    for prof in &mut store.profiles {
        prof.favorite_services.retain(|sid| sid != &id);
        if let Some(vis) = &mut prof.visible_services {
            vis.retain(|sid| sid != &id);
        }
    }
    state.persist(&store).await;
    drop(store);

    if let Some(url) = removed_image {
        if let Some(fname) = url.strip_prefix("/api/service-images/") {
            if let Some(safe) = StdPath::new(fname).file_name().and_then(|n| n.to_str()) {
                let _ = fs::remove_file(state.service_images_dir.join(safe));
            }
        }
    }

    (
        StatusCode::OK,
        Json(serde_json::json!({ "ok": true, "dashboard": build_dashboard(&state).await })),
    )
}

async fn upload_service_image(
    State(state): State<AppState>,
    Path(id): Path<String>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    let mut saved_url: Option<String> = None;

    while let Ok(Some(field)) = multipart.next_field().await {
        let orig_name = field.file_name().unwrap_or("image.png").to_string();
        let ext = StdPath::new(&orig_name)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .filter(|e| matches!(e.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif" | "svg"))
            .unwrap_or_else(|| "png".to_string());

        if let Ok(bytes) = field.bytes().await {
            if !bytes.is_empty() {
                let filename = format!("{}-{}.{}", id, &Uuid::new_v4().to_string()[..8], ext);
                let disk_path = state.service_images_dir.join(&filename);
                if fs::write(&disk_path, &bytes).is_ok() {
                    saved_url = Some(format!("/api/service-images/{}", filename));
                    break;
                }
            }
        }
    }

    let Some(image_url) = saved_url else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "ok": false, "message": "Nebyl nahrán žádný obrázek." })),
        );
    };

    let mut store = state.store.write().await;
    let Some(svc) = store.services.iter_mut().find(|s| s.id == id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "ok": false, "message": "Služba nenalezena." })),
        );
    };
    svc.image_url = Some(image_url.clone());
    state.persist(&store).await;
    drop(store);

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "ok": true,
            "image_url": image_url,
            "dashboard": build_dashboard(&state).await
        })),
    )
}

async fn serve_service_image(
    State(state): State<AppState>,
    Path(filename): Path<String>,
) -> impl IntoResponse {
    let safe_name = StdPath::new(&filename)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    if safe_name.is_empty() || safe_name != filename {
        return (StatusCode::BAD_REQUEST, "Neplatný název souboru").into_response();
    }

    let path = state.service_images_dir.join(safe_name);
    let Ok(bytes) = fs::read(&path) else {
        return (StatusCode::NOT_FOUND, "Obrázek nenalezen").into_response();
    };

    let mime = match StdPath::new(safe_name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        _ => "image/png",
    };

    (StatusCode::OK, [(header::CONTENT_TYPE, mime)], bytes).into_response()
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
    let action = payload.action.as_str();
    if !matches!(action, "start" | "restart" | "stop") {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "ok": false, "message": "Neznámá akce." })),
        );
    }

    // Check if real Docker Engine is reachable
    if let Some(real_rows) = get_docker_containers_cached(&state, true).await {
        let store_snap = state.store.read().await;
        let resolved_name = resolve_docker_target_name(&service_id, &store_snap.services);
        drop(store_snap);

        let target_container = resolved_name
            .as_deref()
            .and_then(|name| {
                real_rows.iter().find(|r| {
                    r.id.starts_with(name)
                        || r.names.eq_ignore_ascii_case(name)
                        || r.names.to_ascii_lowercase().contains(&name.to_ascii_lowercase())
                })
            })
            .map(|r| r.names.clone())
            .or(resolved_name);

        if let Some(cname) = target_container {
            let cmd_res = tokio::process::Command::new("docker")
                .args([action, &cname])
                .output()
                .await;

            if let Ok(out) = cmd_res {
                *state.docker_cache.write().await = None;
                return (
                    StatusCode::OK,
                    Json(serde_json::json!({ "ok": out.status.success(), "dashboard": build_dashboard(&state).await })),
                );
            }
        }
    }

    // Mac / Demo fallback using store.json dummy containers
    let mut store = state.store.write().await;
    let Some(svc) = store.services.iter_mut().find(|s| s.id == service_id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "ok": false, "message": "Služba nenalezena." })),
        );
    };

    match action {
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

    state.persist(&store).await;
    drop(store);

    (StatusCode::OK, Json(serde_json::json!({ "ok": true, "dashboard": build_dashboard(&state).await })))
}

async fn get_docker_logs(
    State(state): State<AppState>,
    Path(service_id): Path<String>,
) -> impl IntoResponse {
    let store = state.store.read().await;
    let svc_opt = store.services.iter().find(|s| s.id == service_id).cloned();
    let target_name = resolve_docker_target_name(&service_id, &store.services);
    drop(store);

    if let Some(real_rows) = probe_real_docker_containers().await {
        let matched = target_name
            .as_deref()
            .and_then(|name| {
                real_rows.iter().find(|r| {
                    r.id.starts_with(name)
                        || r.names.eq_ignore_ascii_case(name)
                        || r.names.to_ascii_lowercase().contains(&name.to_ascii_lowercase())
                })
            })
            .map(|r| r.names.clone())
            .or(target_name.clone());

        if let Some(cname) = matched {
            let fut = tokio::process::Command::new("docker")
                .args(["logs", "--tail", "80", "--timestamps", &cname])
                .output();
            if let Ok(Ok(out)) = tokio::time::timeout(Duration::from_secs(3), fut).await {
                let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
                let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
                let combined = match (stdout.is_empty(), stderr.is_empty()) {
                    (false, true) => stdout,
                    (true, false) => stderr,
                    (false, false) => format!("{}\n{}", stdout, stderr),
                    (true, true) => format!("Kontejner '{}' nemá zatím žádné logy.", cname),
                };
                return (
                    StatusCode::OK,
                    Json(serde_json::json!({ "ok": true, "live": true, "output": combined })),
                );
            }
        }
    }

    let label = svc_opt
        .as_ref()
        .map(|s| s.name.as_str())
        .or(target_name.as_deref())
        .unwrap_or("container");
    let uptime = svc_opt
        .as_ref()
        .map(|s| s.uptime.as_str())
        .unwrap_or("unknown");
    let demo_log = format!(
        "[Demo režim · Docker daemon neběží lokálně]\n\
         Kontejner: {label}\n\
         Stav: {uptime}\n\
         ----------------------------------------\n\
         {now} INFO  vykylab-docker-bridge: připraveno na real Docker CLI / socket\n\
         {now} INFO  {label}: služba inicializována a čeká na požadavky",
        label = label,
        uptime = uptime,
        now = Local::now().format("%Y-%m-%d %H:%M:%S"),
    );

    (
        StatusCode::OK,
        Json(serde_json::json!({ "ok": true, "live": false, "output": demo_log })),
    )
}

async fn run_system_check(State(state): State<AppState>) -> impl IntoResponse {
    let now_time = Local::now().format("%H:%M").to_string();
    let mut store = state.store.write().await;
    store.last_checked = now_time;
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
        store.uploads.insert(0, item.clone());
    }
    store.uploads.truncate(20);
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

async fn create_noticeboard_item(
    State(state): State<AppState>,
    Json(payload): Json<CreateNoticeboardPayload>,
) -> impl IntoResponse {
    let title = payload.title.trim();
    let message = payload.message.trim();
    if title.is_empty() || message.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "ok": false, "message": "Vyplň nadpis i text vzkazu." })),
        );
    }

    let tag = payload
        .tag
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("Oznámení")
        .to_string();

    let mut store = state.store.write().await;
    let author = store
        .profiles
        .iter()
        .find(|p| p.id == store.active_profile_id)
        .map(|p| p.name.clone())
        .unwrap_or_else(|| "Sudo".to_string());

    store.noticeboard.insert(
        0,
        NoticeboardItem {
            id: format!("note-{}", &Uuid::new_v4().to_string()[..8]),
            title: title.to_string(),
            message: message.to_string(),
            author,
            tag,
            pinned: payload.pinned.unwrap_or(false),
            timestamp: Local::now().format("%-d.%-m. · %H:%M").to_string(),
        },
    );
    state.persist(&store).await;
    drop(store);

    (
        StatusCode::OK,
        Json(serde_json::json!({ "ok": true, "dashboard": build_dashboard(&state).await })),
    )
}

async fn update_noticeboard_item(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateNoticeboardPayload>,
) -> impl IntoResponse {
    let mut store = state.store.write().await;
    let Some(item) = store.noticeboard.iter_mut().find(|n| n.id == id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "ok": false, "message": "Vzkaz nenalezen." })),
        );
    };

    if let Some(title) = payload.title.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        item.title = title.to_string();
    }
    if let Some(msg) = payload.message.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        item.message = msg.to_string();
    }
    if let Some(tag) = payload.tag.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        item.tag = tag.to_string();
    }
    if let Some(pinned) = payload.pinned {
        item.pinned = pinned;
    }

    state.persist(&store).await;
    drop(store);

    (
        StatusCode::OK,
        Json(serde_json::json!({ "ok": true, "dashboard": build_dashboard(&state).await })),
    )
}

async fn delete_noticeboard_item(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let mut store = state.store.write().await;
    let before = store.noticeboard.len();
    store.noticeboard.retain(|n| n.id != id);
    if store.noticeboard.len() == before {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "ok": false, "message": "Vzkaz nenalezen." })),
        );
    }
    state.persist(&store).await;
    drop(store);

    (
        StatusCode::OK,
        Json(serde_json::json!({ "ok": true, "dashboard": build_dashboard(&state).await })),
    )
}

async fn run_update_step(program: &str, args: &[&str], dir: &StdPath) -> (bool, String) {
    let mut cmd = tokio::process::Command::new(program);
    cmd.args(args).current_dir(dir);
    match cmd.output().await {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            let combined = match (stdout.is_empty(), stderr.is_empty()) {
                (false, true) => stdout,
                (true, false) => stderr,
                (false, false) => format!("{}\n{}", stdout, stderr),
                (true, true) => String::new(),
            };
            (out.status.success(), combined)
        }
        Err(e) => (false, format!("Chyba spuštění '{}': {}", program, e)),
    }
}

async fn admin_github_update(State(state): State<AppState>) -> impl IntoResponse {
    let store = state.store.read().await;
    let is_admin = store
        .profiles
        .iter()
        .find(|p| p.id == store.active_profile_id)
        .is_some_and(|p| p.is_admin);
    if !is_admin {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "ok": false, "message": "Vyžadován admin profil sudo." })),
        );
    }
    let store_snapshot = store.clone();
    drop(store);

    let repo_root = if StdPath::new("../.git").exists() {
        PathBuf::from("..")
    } else {
        PathBuf::from(".")
    };
    let frontend_dir = repo_root.join("frontend");
    let backend_dir = repo_root.join("backend");

    let mut logs: Vec<String> = Vec::new();
    let (_, old_commit_raw) =
        run_update_step("git", &["rev-parse", "--short", "HEAD"], &repo_root).await;
    let old_commit = if old_commit_raw.is_empty() {
        "unknown".to_string()
    } else {
        old_commit_raw
    };
    logs.push(format!("$ git rev-parse --short HEAD -> {}", old_commit));

    let _ = run_update_step(
        "git",
        &["checkout", "--", "backend/data/store.json", "backend/data/profiles.yaml"],
        &repo_root,
    )
    .await;

    let (pull_ok, pull_out) =
        run_update_step("git", &["pull", "--ff-only", "origin", "main"], &repo_root).await;
    logs.push(format!(
        "$ git pull --ff-only origin main\n{}",
        if pull_out.is_empty() {
            "(bez výstupu)".to_string()
        } else {
            pull_out
        }
    ));

    let (_, new_commit_raw) =
        run_update_step("git", &["rev-parse", "--short", "HEAD"], &repo_root).await;
    let new_commit = if new_commit_raw.is_empty() {
        old_commit.clone()
    } else {
        new_commit_raw
    };

    // Always restore runtime store & profiles.yaml so user state is never lost
    state.persist(&store_snapshot).await;

    if !pull_ok {
        return (
            StatusCode::OK,
            Json(serde_json::json!({
                "ok": false,
                "updated": false,
                "old_commit": old_commit,
                "new_commit": new_commit,
                "restarting": false,
                "message": "Git pull z GitHubu selhal.",
                "output": logs.join("\n\n"),
            })),
        );
    }

    let updated = old_commit != new_commit;

    if frontend_dir.exists() {
        let (fe_ok, fe_out) = run_update_step("npm", &["run", "build"], &frontend_dir).await;
        logs.push(format!(
            "$ npm run build (frontend)\n{}",
            if fe_out.is_empty() {
                "Hotovo.".to_string()
            } else {
                fe_out
            }
        ));
        if !fe_ok {
            return (
                StatusCode::OK,
                Json(serde_json::json!({
                    "ok": false,
                    "updated": updated,
                    "old_commit": old_commit,
                    "new_commit": new_commit,
                    "restarting": false,
                    "message": "Build frontendu (npm run build) selhal.",
                    "output": logs.join("\n\n"),
                })),
            );
        }
    }

    let cargo_bin = std::env::var("HOME")
        .ok()
        .map(|h| format!("{}/.cargo/bin/cargo", h))
        .filter(|p| StdPath::new(p).exists())
        .unwrap_or_else(|| "cargo".to_string());

    let build_dir = if backend_dir.exists() {
        backend_dir.as_path()
    } else {
        StdPath::new(".")
    };
    let (be_ok, be_out) = run_update_step(&cargo_bin, &["build"], build_dir).await;
    logs.push(format!(
        "$ cargo build (backend)\n{}",
        if be_out.is_empty() {
            "Hotovo.".to_string()
        } else {
            be_out
        }
    ));
    if !be_ok {
        return (
            StatusCode::OK,
            Json(serde_json::json!({
                "ok": false,
                "updated": updated,
                "old_commit": old_commit,
                "new_commit": new_commit,
                "restarting": false,
                "message": "Build Rust backendu (cargo build) selhal.",
                "output": logs.join("\n\n"),
            })),
        );
    }

    let mut restarting = false;
    if updated {
        if let Ok(exe) = std::env::current_exe() {
            let args: Vec<String> = std::env::args().skip(1).collect();
            restarting = true;
            logs.push(format!(
                "Nový commit {} -> {}: restartuji backend proces ({})...",
                old_commit,
                new_commit,
                exe.display()
            ));
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(450)).await;
                #[cfg(unix)]
                {
                    use std::os::unix::process::CommandExt;
                    let err = std::process::Command::new(&exe).args(&args).exec();
                    eprintln!("Nepodařilo se restartovat backend pomocí exec: {}", err);
                }
            });
        }
    }

    let message = if updated {
        format!(
            "Aktualizováno z {} na {} — backend se restartuje.",
            old_commit, new_commit
        )
    } else {
        format!("Vše je aktuální (commit {}).", new_commit)
    };

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "ok": true,
            "updated": updated,
            "old_commit": old_commit,
            "new_commit": new_commit,
            "restarting": restarting,
            "message": message,
            "output": logs.join("\n\n"),
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
        .route("/api/profiles/:id", put(update_profile))
        .route("/api/profiles/:id/activate", post(activate_profile))
        .route("/api/profiles/:id/shortcuts", post(add_shortcut))
        .route("/api/profiles/:id/shortcuts/:shortcut_id", delete(delete_shortcut))
        .route("/api/profiles/:id/favorites/:service_id", post(toggle_favorite))
        .route("/api/scripts/:shortcut_id/run", post(run_script))
        .route("/api/services/:id/action", post(service_action))
        .route("/api/docker/logs/:id", get(get_docker_logs))
        .route("/api/services/:id/image", post(upload_service_image))
        .route("/api/service-images/:filename", get(serve_service_image))
        .route("/api/admin/services", post(create_admin_service))
        .route("/api/admin/services/:id", put(update_admin_service).delete(delete_admin_service))
        .route("/api/admin/noticeboard", post(create_noticeboard_item))
        .route("/api/admin/noticeboard/:id", put(update_noticeboard_item).delete(delete_noticeboard_item))
        .route("/api/system/check", post(run_system_check))
        .route("/api/upload", post(upload_file))
        .route("/api/admin/exec", post(admin_exec))
        .route("/api/admin/update", post(admin_github_update))
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
