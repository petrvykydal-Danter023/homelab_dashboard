export type ShortcutKind = 'link' | 'script';

export interface UserShortcut {
  id: string;
  label: string;
  category: string; // 'service' | 'account'
  kind: ShortcutKind;
  target: string;
  icon: string;
}

export interface UserProfile {
  id: string;
  name: string;
  workspace_label: string;
  role: string;
  location: string;
  avatar_initials: string;
  avatar_color: string;
  is_admin: boolean;
  has_pin: boolean;
  favorite_services: string[];
  visible_services?: string[] | null;
  shortcuts: UserShortcut[];
}

export interface HomelabService {
  id: string;
  name: string;
  subtitle: string;
  status: string;
  uptime: string;
  url: string;
  icon: string;
  image_url?: string | null;
  is_docker: boolean;
  container_name?: string | null;
}

export interface NoticeboardItem {
  id: string;
  title: string;
  message: string;
  author: string;
  tag: string;
  pinned: boolean;
  timestamp: string;
}

export interface UploadedFileInfo {
  id: string;
  name: string;
  size_bytes: number;
  uploaded_at: string;
}

export interface SystemMonitoring {
  host_name: string;
  os_version: string;
  kernel_version: string;
  cpu_arch: string;
  cpu_brand: string;
  cpu_cores: number;
  cpu_freq_mhz: number;
  cpu_percent: number;
  load_avg: string;
  top_cpu_proc: string;
  ram_used_gb: number;
  ram_total_gb: number;
  ram_percent: number;
  swap_used_gb: number;
  swap_total_gb: number;
  top_ram_proc: string;
  disk_free_gb: number;
  disk_total_gb: number;
  disk_fs: string;
  disk_kind: string;
  net_interface: string;
  net_rx_mb: number;
  net_tx_mb: number;
  net_rx_packets: number;
  net_tx_packets: number;
  disk_read_mb: number;
  disk_write_mb: number;
  top_io_proc: string;
  process_count: number;
  uptime_formatted: string;
  tunnel_label: string;
  connected_to: string;
}

export interface SshConnection {
  id: string;
  name: string;
  user: string;
  host: string;
  port: number;
  mode: 'local' | 'ssh';
  identity_file?: string | null;
}

export interface SshShortcut {
  id: string;
  label: string;
  command: string;
}

export interface SshConfig {
  active_connection_id: string;
  connections: SshConnection[];
  shortcuts: SshShortcut[];
}

export interface ProcessInfo {
  pid: number;
  name: string;
  cpu_percent: number;
  memory_mb: number;
  status: string;
  cmd: string;
  run_time_secs: number;
}

export interface ServiceSearchHit {
  id: string;
  score: number;
  matched_terms: string[];
}

export interface ServiceSearchResponse {
  query: string;
  max_score: number;
  hits: ServiceSearchHit[];
}

export interface DashboardResponse {
  date_label: string;
  weather_summary: string;
  last_checked: string;
  system_healthy: boolean;
  system_status_text: string;
  active_profile: UserProfile;
  profiles: UserProfile[];
  docker_live?: boolean;
  services: HomelabService[];
  noticeboard: NoticeboardItem[];
  uploads: UploadedFileInfo[];
  ssh: SshConfig;
  monitoring: SystemMonitoring;
  processes: ProcessInfo[];
}
