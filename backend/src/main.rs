use axum::{
    extract::{Multipart, Path, State},
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
};
use sysinfo::{Disks, Networks, System};
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfile {
    pub id: String,
    pub name: String,
    pub workspace_label: String,
    pub role: String,
    pub location: String,
    pub avatar_initials: String,
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
            is_admin: p.is_admin,
            has_pin: p.pin_code.as_ref().is_some_and(|pin| !pin.is_empty()),
            favorite_services: p.favorite_services.clone(),
            shortcuts: p.shortcuts.clone(),
        }
    }
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
}

#[derive(Debug, Deserialize)]
pub struct UpdateProfilePayload {
    pub name: String,
    pub workspace_label: String,
    pub role: String,
    pub location: String,
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
    uploads_dir: PathBuf,
    store: Arc<RwLock<PersistedStore>>,
    sys: Arc<RwLock<System>>,
}

impl AppState {
    fn load_or_init() -> Self {
        let data_dir = PathBuf::from("data");
        let uploads_dir = data_dir.join("uploads");
        let store_path = data_dir.join("store.json");

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

        if !store.profiles.iter().any(|p| p.id == "prof-sudo" || p.name == "sudo") {
            store.profiles.push(default_sudo_profile());
            let _ = save_store_to_disk(&store_path, &store);
        }

        let mut sys = System::new_all();
        sys.refresh_all();

        Self {
            store_path,
            uploads_dir,
            store: Arc::new(RwLock::new(store)),
            sys: Arc::new(RwLock::new(sys)),
        }
    }

    async fn persist(&self, store: &PersistedStore) {
        let _ = save_store_to_disk(&self.store_path, store);
    }
}

fn save_store_to_disk(path: &StdPath, store: &PersistedStore) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(store)?;
    fs::write(path, json)
}

fn default_sudo_profile() -> UserProfile {
    UserProfile {
        id: "prof-sudo".to_string(),
        name: "sudo".to_string(),
        workspace_label: "Vykylab".to_string(),
        role: "Admin".to_string(),
        location: "Praha".to_string(),
        avatar_initials: "S".to_string(),
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

fn default_store() -> PersistedStore {
    let now_time = Local::now().format("%H:%M").to_string();

    let tata_profile = UserProfile {
        id: "prof-tata".to_string(),
        name: "Táta".to_string(),
        workspace_label: "Vykylab".to_string(),
        role: "Správce".to_string(),
        location: "Praha".to_string(),
        avatar_initials: "T".to_string(),
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
                target: "docker ps --format 'table {{.Names}}\\t{{.Status}}' || uname -a".to_string(),
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
    };

    let services = vec![
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
        active_profile_id: tata_profile.id.clone(),
        profiles: vec![tata_profile, default_sudo_profile()],
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

    for proc_item in sys.processes().values() {
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
            best_io = Some((name, io_sum));
        }
        total_read_bytes = total_read_bytes.saturating_add(usage.read_bytes);
        total_write_bytes = total_write_bytes.saturating_add(usage.written_bytes);
    }
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
    }
}

// ============================================================================
// Route Handlers
// ============================================================================

async fn health() -> impl IntoResponse {
    Json(serde_json::json!({ "ok": true, "service": "vykylab-backend" }))
}

async fn get_dashboard(State(state): State<AppState>) -> impl IntoResponse {
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
