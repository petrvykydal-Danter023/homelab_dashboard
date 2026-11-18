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
  is_admin: boolean;
  has_pin: boolean;
  favorite_services: string[];
  shortcuts: UserShortcut[];
}

export interface ServicePreviewRow {
  name: string;
  status: string;
  meta: string;
}

export interface HomelabService {
  id: string;
  name: string;
  subtitle: string;
  status: string;
  uptime: string;
  url: string;
  icon: string;
  preview_rows: ServicePreviewRow[];
}

export interface SystemEvent {
  id: string;
  timestamp: string;
  level: string;
  source: string;
  message: string;
}

export interface UploadedFileInfo {
  id: string;
  name: string;
  size_bytes: number;
  uploaded_at: string;
}

export interface SystemMonitoring {
  host_name: string;
  cpu_percent: number;
  ram_used_gb: number;
  ram_total_gb: number;
  ram_percent: number;
  disk_free_gb: number;
  disk_total_gb: number;
  uptime_formatted: string;
  tunnel_label: string;
  tunnel_tx: string;
  connected_to: string;
}

export interface DashboardResponse {
  date_label: string;
  weather_summary: string;
  last_checked: string;
  system_healthy: boolean;
  system_status_text: string;
  active_profile: UserProfile;
  profiles: UserProfile[];
  services: HomelabService[];
  events: SystemEvent[];
  uploads: UploadedFileInfo[];
  monitoring: SystemMonitoring;
}
