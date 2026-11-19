import React, { useRef, useState } from 'react';
import {
  Activity,
  ArrowDownUp,
  Clock,
  Container,
  Cpu,
  Download,
  ExternalLink,
  FileText,
  HardDrive,
  Info,
  KeyRound,
  Layers,
  MemoryStick,
  Network,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  Settings,
  Square,
  Terminal,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type {
  DashboardResponse,
  HomelabService,
  ProcessInfo,
  SshConnection,
} from './types';
import {
  AVATAR_CONFIG,
  AvatarBadge,
  AvatarOrb,
  getProfileAvatarTheme,
} from './Avatar';

type AdminTab = 'dashboard' | 'docker' | 'ssh' | 'processes';
type ProcessSortKey = 'cpu' | 'memory' | 'name';
type HoveredMetric = 'cpu' | 'ram' | 'storage' | 'network' | 'uptime' | 'diskio' | null;

const formatProcMemory = (mb: number) =>
  mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;

const formatProcRuntime = (secs: number) => {
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
};

interface AdminDashboardProps {
  data: DashboardResponse;
  onRefresh: () => Promise<void>;
  onOpenProfileHub: () => void;
  onShowToast: (ok: boolean, text: string) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  data,
  onRefresh,
  onOpenProfileHub,
  onShowToast,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [hoveredMetric, setHoveredMetric] = useState<HoveredMetric>(null);
  const [dockerFilter, setDockerFilter] = useState<'all' | 'running' | 'stopped'>('all');
  const [dockerSearch, setDockerSearch] = useState('');
  const [hoveredDockerSvc, setHoveredDockerSvc] = useState<HomelabService | null>(null);
  const [processSearch, setProcessSearch] = useState('');
  const [processSort, setProcessSort] = useState<ProcessSortKey>('cpu');
  const [hoveredProcess, setHoveredProcess] = useState<ProcessInfo | null>(null);
  const [dockerLogModal, setDockerLogModal] = useState<{
    service: HomelabService;
    output: string;
  } | null>(null);
  const [sshInput, setSshInput] = useState('');
  const [hoveredSshConn, setHoveredSshConn] = useState<SshConnection | null>(null);
  const [sshSettingsOpen, setSshSettingsOpen] = useState(false);
  const [sshSettingsTab, setSshSettingsTab] = useState<'connections' | 'shortcuts'>('connections');
  const [newConnName, setNewConnName] = useState('');
  const [newConnUser, setNewConnUser] = useState('root');
  const [newConnHost, setNewConnHost] = useState('');
  const [newConnPort, setNewConnPort] = useState('22');
  const [newConnKey, setNewConnKey] = useState('');
  const [newConnMode, setNewConnMode] = useState<'ssh' | 'local'>('ssh');
  const [newScLabel, setNewScLabel] = useState('');
  const [newScCmd, setNewScCmd] = useState('');
  const [cmdHistoryIdx, setCmdHistoryIdx] = useState<number>(-1);
  const [sshRunning, setSshRunning] = useState(false);
  const [sshHistory, setSshHistory] = useState<
    { id: number; cmd: string; output: string; ok: boolean; target?: string; duration_ms?: number; exit_code?: number }[]
  >([]);
  const sshEndRef = useRef<HTMLDivElement | null>(null);

  const profile = data.active_profile;
  const mon = data.monitoring;
  const diskUsedGb = Math.max(0, mon.disk_total_gb - mon.disk_free_gb);
  const diskUsedPct =
    mon.disk_total_gb > 0 ? Math.min(100, (diskUsedGb / mon.disk_total_gb) * 100) : 0;

  const handleServiceAction = async (
    svc: HomelabService,
    action: 'start' | 'restart' | 'stop'
  ) => {
    setBusyId(`adm-svc-${svc.id}`);
    try {
      const res = await fetch(`/api/services/${encodeURIComponent(svc.id)}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        await onRefresh();
        onShowToast(true, `${svc.name}: ${action}`);
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleSystemCheck = async () => {
    setBusyId('adm-check');
    try {
      const res = await fetch('/api/events/check', { method: 'POST' });
      if (res.ok) {
        await onRefresh();
        onShowToast(true, 'Kontrola systému dokončena.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const openDockerLogs = async (svc: HomelabService) => {
    setBusyId(`logs-${svc.id}`);
    try {
      const targetName = svc.preview_rows[0]?.name || svc.name.toLowerCase();
      const res = await fetch('/api/admin/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: `docker logs --tail 25 ${targetName} 2>&1 || echo "Kontejner '${targetName}' běží (${svc.uptime}) — živé Docker logy jsou dostupné na cílovém Linux hostu."`,
        }),
      });
      const json = await res.json();
      setDockerLogModal({
        service: svc,
        output: json.output || `Služba ${svc.name}: ${svc.uptime}`,
      });
    } catch {
      setDockerLogModal({
        service: svc,
        output: `Nepodařilo se načíst logy pro ${svc.name}.`,
      });
    } finally {
      setBusyId(null);
    }
  };

  const runSshCommand = async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;
    if (trimmed === 'clear') {
      setSshHistory([]);
      setSshInput('');
      return;
    }
    setSshRunning(true);
    setSshInput('');
    setCmdHistoryIdx(-1);
    try {
      const res = await fetch('/api/admin/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: trimmed,
          connection_id: data.ssh.active_connection_id,
        }),
      });
      const json = await res.json();
      setSshHistory((prev) => [
        ...prev,
        {
          id: Date.now(),
          cmd: trimmed,
          output: json.output || 'Hotovo.',
          ok: Boolean(json.ok),
          target: json.target,
          duration_ms: json.duration_ms,
          exit_code: json.exit_code,
        },
      ]);
      window.setTimeout(() => sshEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 40);
    } catch {
      setSshHistory((prev) => [
        ...prev,
        {
          id: Date.now(),
          cmd: trimmed,
          output: 'Chyba komunikace se serverem.',
          ok: false,
        },
      ]);
    } finally {
      setSshRunning(false);
    }
  };

  const handleSshKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (sshHistory.length === 0) return;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const nextIdx =
        cmdHistoryIdx < 0 ? sshHistory.length - 1 : Math.max(0, cmdHistoryIdx - 1);
      setCmdHistoryIdx(nextIdx);
      setSshInput(sshHistory[nextIdx]?.cmd || '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (cmdHistoryIdx < 0) return;
      const nextIdx = cmdHistoryIdx + 1;
      if (nextIdx >= sshHistory.length) {
        setCmdHistoryIdx(-1);
        setSshInput('');
      } else {
        setCmdHistoryIdx(nextIdx);
        setSshInput(sshHistory[nextIdx]?.cmd || '');
      }
    }
  };

  const handleActivateSshConnection = async (id: string) => {
    setBusyId(`ssh-act-${id}`);
    try {
      const res = await fetch(
        `/api/admin/ssh/connections/${encodeURIComponent(id)}/activate`,
        { method: 'POST' }
      );
      if (res.ok) {
        await onRefresh();
        onShowToast(true, 'SSH profil aktivován.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleAddSshConnection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newConnName.trim() || !newConnUser.trim() || !newConnHost.trim()) return;
    setBusyId('ssh-add-conn');
    try {
      const res = await fetch('/api/admin/ssh/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newConnName.trim(),
          user: newConnUser.trim(),
          host: newConnHost.trim(),
          port: Number(newConnPort) || 22,
          mode: newConnMode,
          identity_file: newConnKey.trim() || null,
        }),
      });
      if (res.ok) {
        await onRefresh();
        setNewConnName('');
        setNewConnHost('');
        setNewConnKey('');
        onShowToast(true, 'SSH připojení uloženo.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteSshConnection = async (id: string) => {
    const res = await fetch(`/api/admin/ssh/connections/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      await onRefresh();
      onShowToast(true, 'SSH připojení odebráno.');
    }
  };

  const handleAddSshShortcut = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newScLabel.trim() || !newScCmd.trim()) return;
    setBusyId('ssh-add-sc');
    try {
      const res = await fetch('/api/admin/ssh/shortcuts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: newScLabel.trim(),
          command: newScCmd.trim(),
        }),
      });
      if (res.ok) {
        await onRefresh();
        setNewScLabel('');
        setNewScCmd('');
        onShowToast(true, 'Zkratka přidána.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteSshShortcut = async (id: string) => {
    const res = await fetch(`/api/admin/ssh/shortcuts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      await onRefresh();
    }
  };

  return (
    <div
      className="min-h-screen lg:h-screen lg:overflow-hidden bg-[#09090b] text-white flex flex-col"
      style={{
        backgroundImage:
          'radial-gradient(ellipse 75% 45% at 50% -10%, rgba(34,211,238,0.09), transparent)',
      }}
    >
      <div className="max-w-[1380px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-5 flex-1 min-h-0 flex flex-col gap-5">
        {/* ================================================================ */}
        {/* SUDO TOP NAVIGATION BAR                                          */}
        {/* ================================================================ */}
        <header className="shrink-0 flex items-center gap-3.5">
          <button
            type="button"
            onClick={onOpenProfileHub}
            className="hover:scale-[1.04] transition-transform shrink-0"
            title="Změnit profil"
          >
            <AvatarBadge profile={profile} />
          </button>

          <div className="flex-1 apple-card px-5 py-2.5 flex flex-wrap items-center justify-between gap-4 min-w-0">
            <div className="flex items-center gap-6 min-w-0 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold tracking-tight text-white">
                    Sudo
                  </span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-300 border border-amber-400/30">
                    Admin
                  </span>
                </div>
                <div className="text-xs text-zinc-400 truncate">
                  {profile.workspace_label} / Sudo
                </div>
              </div>

              {/* Inline Admin Tabs matching reference */}
              <nav className="flex items-center gap-1.5 flex-wrap">
                {(
                  [
                    ['dashboard', 'Dashboard', <Layers className="w-3.5 h-3.5" />],
                    ['docker', 'Docker', <Container className="w-3.5 h-3.5" />],
                    ['ssh', 'SSH', <Terminal className="w-3.5 h-3.5" />],
                    ['processes', 'Procesy', <Activity className="w-3.5 h-3.5" />],
                  ] as [AdminTab, string, React.ReactNode][]
                ).map(([key, label, icon]) => {
                  const active = activeTab === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setActiveTab(key)}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-medium flex items-center gap-2 transition-all ${active
                          ? 'bg-white text-zinc-950 font-semibold shadow-sm'
                          : 'text-zinc-300 hover:text-white hover:bg-white/[0.06]'
                        }`}
                    >
                      {icon}
                      <span>{label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>

            <button
              type="button"
              onClick={onOpenProfileHub}
              className="px-3.5 py-1.5 rounded-full bg-white/[0.07] hover:bg-white/[0.13] border border-white/[0.1] text-xs font-medium text-white flex items-center gap-1.5 transition-colors shrink-0"
            >
              <Users className="w-3.5 h-3.5 text-cyan-300" />
              <span className="hidden sm:inline">Změnit profil</span>
            </button>
          </div>
        </header>

        {/* ================================================================ */}
        {/* TAB 1: ADMIN BENTO DASHBOARD (3-COLUMN WITH CENTER AVATAR)       */}
        {/* ================================================================ */}
        {activeTab === 'dashboard' && (
          <main className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1 min-h-0 items-stretch">
            {/* LEFT COLUMN (4 COLS): PROCESOR, RAM, STORAGE */}
            <div className="lg:col-span-4 flex flex-col gap-4">
              {/* Procesor (CPU) */}
              <section
                onMouseEnter={() => setHoveredMetric('cpu')}
                onMouseLeave={() => setHoveredMetric(null)}
                className="apple-card p-5 flex-1 flex flex-col justify-between gap-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-400">Procesor</span>
                  <Cpu className="w-4 h-4 text-cyan-300" />
                </div>
                <div>
                  <div className="text-3xl font-semibold font-mono tracking-tight text-white">
                    {mon.cpu_percent.toFixed(1)}%
                  </div>
                  <div className="text-xs text-zinc-400 mt-1 truncate">
                    {mon.cpu_brand} · {mon.cpu_cores} vláken
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-white/[0.07] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-white transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.max(4, mon.cpu_percent))}%` }}
                  />
                </div>
              </section>

              {/* RAM */}
              <section
                onMouseEnter={() => setHoveredMetric('ram')}
                onMouseLeave={() => setHoveredMetric(null)}
                className="apple-card p-5 flex-1 flex flex-col justify-between gap-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-400">RAM</span>
                  <MemoryStick className="w-4 h-4 text-zinc-300" />
                </div>
                <div>
                  <div className="text-3xl font-semibold font-mono tracking-tight text-white">
                    {mon.ram_used_gb.toFixed(1)}
                    <span className="text-base text-zinc-400 font-normal ml-1">
                      / {mon.ram_total_gb.toFixed(0)} GB
                    </span>
                  </div>
                  <div className="text-xs text-zinc-400 mt-1">
                    Využito {mon.ram_percent.toFixed(0)}% paměti
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-white/[0.07] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-white transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.max(4, mon.ram_percent))}%` }}
                  />
                </div>
              </section>

              {/* Storage */}
              <section
                onMouseEnter={() => setHoveredMetric('storage')}
                onMouseLeave={() => setHoveredMetric(null)}
                className="apple-card p-5 flex-1 flex flex-col justify-between gap-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-400">Storage</span>
                  <HardDrive className="w-4 h-4 text-zinc-300" />
                </div>
                <div>
                  <div className="text-3xl font-semibold font-mono tracking-tight text-white">
                    {mon.disk_free_gb.toFixed(0)}
                    <span className="text-base text-zinc-400 font-normal ml-1">GB volných</span>
                  </div>
                  <div className="text-xs text-zinc-400 mt-1">
                    {diskUsedGb.toFixed(0)} / {mon.disk_total_gb.toFixed(0)} GB obsazeno ({diskUsedPct.toFixed(0)}%)
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-white/[0.07] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-400 transition-all duration-500"
                    style={{ width: `${Math.max(4, diskUsedPct)}%` }}
                  />
                </div>
              </section>
            </div>

            {/* CENTER COLUMN (4 COLS): POLISHED CYAN AVATAR NODE STAGE */}
            <section className="group/stage lg:col-span-4 apple-card p-6 flex flex-col justify-between relative overflow-hidden min-h-[440px]">
              {/* Top Node Header */}
              <div className="relative z-10 flex items-center justify-between gap-2">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.06] border border-white/[0.08] text-xs text-zinc-200">
                  <span
                    className={`w-2 h-2 rounded-full ${data.system_healthy ? 'bg-emerald-400' : 'bg-amber-400'
                      }`}
                  />
                  <span className="font-medium truncate max-w-[140px]">{mon.host_name}</span>
                </div>
                <span
                  className={`text-[11px] font-mono px-2.5 py-0.5 rounded-full border ${data.system_healthy
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30'
                      : 'bg-amber-500/15 text-amber-300 border-amber-400/30'
                    }`}
                >
                  {data.services.filter((s) => s.status === 'running').length}/{data.services.length} online
                </span>
              </div>

              {/* Centerpiece: Steady Avatar (holds NOTHING unless hovering a telemetry widget) */}
              <div className="relative z-10 flex flex-col items-center justify-center my-auto py-2">
                {/* Dedicated fixed-height Inspector Card slot above head (zero layout shift) */}
                <div className="h-[108px] w-full flex items-end justify-center mb-3">
                  <div
                    className={`relative w-64 rounded-2xl bg-[#111114]/95 backdrop-blur-2xl border border-white/[0.14] shadow-[0_20px_48px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.14)] px-4 py-3 text-left transition-all duration-200 ease-out ${hoveredMetric !== null
                        ? 'opacity-100 translate-y-0 scale-100'
                        : 'opacity-0 translate-y-2 scale-95 pointer-events-none'
                      }`}
                  >
                    {hoveredMetric === 'cpu' && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] font-semibold text-cyan-300">
                          <span>Procesor · Detail</span>
                          <span className="font-mono text-zinc-400">
                            {mon.cpu_freq_mhz > 0 ? `${mon.cpu_freq_mhz} MHz` : mon.cpu_arch}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-zinc-400">Load Avg</span>
                          <span className="font-mono text-white">{mon.load_avg}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="text-zinc-400 shrink-0">Top proces</span>
                          <span className="font-mono text-zinc-200 truncate">{mon.top_cpu_proc}</span>
                        </div>
                      </div>
                    )}

                    {hoveredMetric === 'ram' && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] font-semibold text-cyan-300">
                          <span>Paměť · Detail</span>
                          <span className="font-mono text-zinc-400">
                            Volné {(mon.ram_total_gb - mon.ram_used_gb).toFixed(1)} GB
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-zinc-400">Swap</span>
                          <span className="font-mono text-white">
                            {mon.swap_used_gb.toFixed(1)} / {mon.swap_total_gb.toFixed(1)} GB
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="text-zinc-400 shrink-0">Top proces</span>
                          <span className="font-mono text-zinc-200 truncate">{mon.top_ram_proc}</span>
                        </div>
                      </div>
                    )}

                    {hoveredMetric === 'storage' && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] font-semibold text-emerald-300">
                          <span>Úložiště · Detail</span>
                          <span className="font-mono text-zinc-400">{mon.disk_fs}</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-zinc-400">Typ média</span>
                          <span className="font-mono text-white">{mon.disk_kind}</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-zinc-400">Běžící procesy</span>
                          <span className="font-mono text-zinc-200">{mon.process_count}</span>
                        </div>
                      </div>
                    )}

                    {hoveredMetric === 'network' && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] font-semibold text-cyan-300">
                          <span>Síť · {mon.net_interface}</span>
                          <span className="text-zinc-400 truncate max-w-[110px]">
                            {mon.tunnel_label}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-zinc-400">RX pakety</span>
                          <span className="font-mono text-white">
                            {mon.net_rx_packets.toLocaleString('cs-CZ')}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-zinc-400">TX pakety</span>
                          <span className="font-mono text-zinc-200">
                            {mon.net_tx_packets.toLocaleString('cs-CZ')}
                          </span>
                        </div>
                      </div>
                    )}

                    {hoveredMetric === 'uptime' && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] font-semibold text-emerald-300">
                          <span>Systém · Detail</span>
                          <span className="font-mono text-zinc-400">{mon.cpu_arch}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="text-zinc-400 shrink-0">Kernel</span>
                          <span className="font-mono text-white truncate">{mon.kernel_version}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="text-zinc-400 shrink-0">OS</span>
                          <span className="text-zinc-200 truncate">{mon.os_version}</span>
                        </div>
                      </div>
                    )}

                    {hoveredMetric === 'diskio' && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] font-semibold text-cyan-300">
                          <span>Disk I/O · Detail</span>
                          <span className="font-mono text-zinc-400">{mon.process_count} úloh</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="text-zinc-400 shrink-0">Nejvyšší I/O</span>
                          <span className="font-mono text-white truncate">{mon.top_io_proc}</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-zinc-400">Souborový systém</span>
                          <span className="font-mono text-zinc-200">{mon.disk_fs}</span>
                        </div>
                      </div>
                    )}

                    {/* Two integrated cyan hands gripping the bottom edge */}
                    <span
                      aria-hidden="true"
                      className="absolute -bottom-2.5 left-8 w-5 h-5 rounded-full bg-gradient-to-br from-rose-200 via-red-400 to-rose-600 shadow-[0_4px_14px_rgba(244,63,94,0.55),inset_0_2px_4px_rgba(255,228,230,0.8)]"
                    />
                    <span
                      aria-hidden="true"
                      className="absolute -bottom-2.5 right-8 w-5 h-5 rounded-full bg-gradient-to-br from-rose-200 via-red-400 to-rose-600 shadow-[0_4px_14px_rgba(244,63,94,0.55),inset_0_2px_4px_rgba(255,228,230,0.8)]"
                    />
                  </div>
                </div>

                {/* Ambient glow */}
                <div
                  aria-hidden="true"
                  className={`pointer-events-none absolute bottom-2 translate-x-2 sm:translate-x-3 ${AVATAR_CONFIG.dashboardOrb.glowClass} rounded-full blur-3xl opacity-75 ${getProfileAvatarTheme(profile).glow}`}
                  style={getProfileAvatarTheme(profile).glowStyle}
                />

                <div className="relative z-20 translate-x-2 sm:translate-x-3">
                  <AvatarOrb
                    profile={profile}
                    interactive
                    sizeClass={AVATAR_CONFIG.dashboardOrb.sizeClass}
                  />
                </div>
              </div>

              {/* Bottom Admin Quick Actions */}
              <div className="relative z-10 flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleSystemCheck}
                  disabled={busyId === 'adm-check'}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-white hover:bg-zinc-200 text-zinc-950 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${busyId === 'adm-check' ? 'animate-spin' : ''}`}
                  />
                  Zkontrolovat
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('ssh')}
                  className="py-2.5 px-3.5 rounded-xl bg-white/[0.07] hover:bg-white/[0.13] border border-white/[0.1] text-white font-medium text-xs flex items-center gap-1.5 transition-colors"
                >
                  <Terminal className="w-3.5 h-3.5 text-cyan-300" />
                  SSH
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('docker')}
                  className="py-2.5 px-3.5 rounded-xl bg-white/[0.07] hover:bg-white/[0.13] border border-white/[0.1] text-white font-medium text-xs flex items-center gap-1.5 transition-colors"
                >
                  <Container className="w-3.5 h-3.5 text-zinc-300" />
                  Docker
                </button>
              </div>
            </section>

            {/* RIGHT COLUMN (4 COLS): NETWORK, UPTIME, DISK I/O */}
            <div className="lg:col-span-4 flex flex-col gap-4">
              {/* Network RX / TX */}
              <section
                onMouseEnter={() => setHoveredMetric('network')}
                onMouseLeave={() => setHoveredMetric(null)}
                className="apple-card p-5 flex-1 flex flex-col justify-between gap-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-400">Network</span>
                  <Network className="w-4 h-4 text-cyan-300" />
                </div>
                <div className="text-2xl sm:text-3xl font-semibold font-mono tracking-tight text-white">
                  {mon.net_rx_mb.toFixed(0)}
                  <span className="text-sm text-zinc-500 mx-1.5">/</span>
                  {mon.net_tx_mb.toFixed(0)}
                  <span className="text-sm text-zinc-400 font-normal ml-1.5">MB</span>
                </div>
                <div className="text-xs text-zinc-400">RX staženo / TX odesláno</div>
              </section>

              {/* Uptime */}
              <section
                onMouseEnter={() => setHoveredMetric('uptime')}
                onMouseLeave={() => setHoveredMetric(null)}
                className="apple-card p-5 flex-1 flex flex-col justify-between gap-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-400">Uptime</span>
                  <Clock className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-3xl font-semibold font-mono tracking-tight text-white">
                  {mon.uptime_formatted}
                </div>
                <div className="text-xs text-zinc-400 truncate">{mon.host_name}</div>
              </section>

              {/* Disk I/O */}
              <section
                onMouseEnter={() => setHoveredMetric('diskio')}
                onMouseLeave={() => setHoveredMetric(null)}
                className="apple-card p-5 flex-1 flex flex-col justify-between gap-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-400">Disk I/O</span>
                  <ArrowDownUp className="w-4 h-4 text-zinc-300" />
                </div>
                <div className="text-2xl sm:text-3xl font-semibold font-mono tracking-tight text-white">
                  {mon.disk_read_mb.toFixed(0)}
                  <span className="text-sm text-zinc-500 mx-1.5">/</span>
                  {mon.disk_write_mb.toFixed(0)}
                  <span className="text-sm text-zinc-400 font-normal ml-1.5">MB</span>
                </div>
                <div className="text-xs text-zinc-400">Čtení / Zápis procesů</div>
              </section>
            </div>
          </main>
        )}

        {/* ================================================================ */}
        {/* TAB 2: DOCKER ADMIN DASHBOARD (WITH CYAN AVATAR + CONTROLS)      */}
        {/* ================================================================ */}
        {activeTab === 'docker' && (() => {
          const runningCount = data.services.filter((s) => s.status === 'running').length;
          const stoppedCount = data.services.length - runningCount;
          const filteredDocker = data.services.filter((svc) => {
            if (dockerFilter === 'running' && svc.status !== 'running') return false;
            if (dockerFilter === 'stopped' && svc.status === 'running') return false;
            const q = dockerSearch.trim().toLowerCase();
            if (!q) return true;
            return (
              svc.name.toLowerCase().includes(q) ||
              svc.url.toLowerCase().includes(q)
            );
          });

          return (
            <main className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1 min-h-0 items-stretch">
              {/* LEFT COLUMN (4 COLS): FIXED FULL-HEIGHT CYAN DOCKER COMPANION + CONTROLS */}
              <section className="lg:col-span-4 lg:h-full apple-card p-6 flex flex-col justify-between relative overflow-hidden">
                <div className="relative z-10 flex items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.06] border border-white/[0.08] text-xs text-zinc-200">
                    <Container className="w-3.5 h-3.5 text-cyan-300" />
                    <span className="font-medium">Docker Engine</span>
                  </div>
                  <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-400/30">
                    {runningCount}/{data.services.length} aktivní
                  </span>
                </div>

                {/* Avatar + Hover Inspector Card (holds nothing when idle) */}
                <div className="relative z-10 flex flex-col items-center justify-center my-auto py-2">
                  <div className="h-[100px] w-full flex items-end justify-center mb-3">
                    <div
                      className={`relative w-64 rounded-2xl bg-[#111114]/95 backdrop-blur-2xl border border-white/[0.14] shadow-[0_20px_48px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.14)] px-4 py-3 text-left transition-all duration-200 ease-out ${hoveredDockerSvc !== null
                          ? 'opacity-100 translate-y-0 scale-100'
                          : 'opacity-0 translate-y-2 scale-95 pointer-events-none'
                        }`}
                    >
                      {hoveredDockerSvc && (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-[10px] font-semibold text-cyan-300">
                            <span>{hoveredDockerSvc.name}</span>
                            <span className="font-mono text-zinc-400">
                              {hoveredDockerSvc.status === 'running' ? 'running' : 'stopped'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="text-zinc-400 shrink-0">URL</span>
                            <span className="font-mono text-white truncate">
                              {hoveredDockerSvc.url.replace(/^https?:\/\//, '')}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="text-zinc-400 shrink-0">Stav</span>
                            <span className="font-mono text-zinc-200 truncate">
                              {hoveredDockerSvc.uptime}
                            </span>
                          </div>
                        </div>
                      )}
                      <span
                        aria-hidden="true"
                        className="absolute -bottom-2.5 left-8 w-5 h-5 rounded-full bg-gradient-to-br from-rose-200 via-red-400 to-rose-600 shadow-[0_4px_14px_rgba(244,63,94,0.55),inset_0_2px_4px_rgba(255,228,230,0.8)]"
                      />
                      <span
                        aria-hidden="true"
                        className="absolute -bottom-2.5 right-8 w-5 h-5 rounded-full bg-gradient-to-br from-rose-200 via-red-400 to-rose-600 shadow-[0_4px_14px_rgba(244,63,94,0.55),inset_0_2px_4px_rgba(255,228,230,0.8)]"
                      />
                    </div>
                  </div>

                  <div
                    aria-hidden="true"
                    className={`pointer-events-none absolute bottom-2 translate-x-2 sm:translate-x-3 ${AVATAR_CONFIG.dashboardOrb.glowClass} rounded-full blur-3xl opacity-75 ${getProfileAvatarTheme(profile).glow}`}
                    style={getProfileAvatarTheme(profile).glowStyle}
                  />

                  <div className="relative z-20 translate-x-2 sm:translate-x-3">
                    <AvatarOrb
                      profile={profile}
                      interactive
                      sizeClass={AVATAR_CONFIG.dashboardOrb.sizeClass}
                    />
                  </div>
                </div>

                {/* Docker Filter & Search Controls */}
                <div className="relative z-10 space-y-3 pt-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={dockerSearch}
                      onChange={(e) => setDockerSearch(e.target.value)}
                      placeholder="Filtrovat kontejner..."
                      className="apple-well w-full pl-9 pr-3 py-2 text-xs text-white placeholder:text-zinc-500 outline-none focus:border-white/25"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-1.5 bg-white/[0.04] p-1 rounded-xl border border-white/[0.08]">
                    {(
                      [
                        ['all', `Vše (${data.services.length})`],
                        ['running', `Běží (${runningCount})`],
                        ['stopped', `Stop (${stoppedCount})`],
                      ] as ['all' | 'running' | 'stopped', string][]
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setDockerFilter(key)}
                        className={`py-1.5 rounded-lg text-[11px] font-medium transition-colors ${dockerFilter === key
                            ? 'bg-white text-zinc-950 font-semibold'
                            : 'text-zinc-400 hover:text-white'
                          }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void onRefresh()}
                      className="flex-1 py-2 px-3 rounded-xl bg-white/[0.07] hover:bg-white/[0.13] border border-white/[0.1] text-xs font-medium text-white flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-cyan-300" />
                      Obnovit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('ssh');
                        void runSshCommand('docker ps || ps aux | head -n 10');
                      }}
                      className="flex-1 py-2 px-3 rounded-xl bg-white hover:bg-zinc-200 text-zinc-950 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Terminal className="w-3.5 h-3.5" />
                      docker ps
                    </button>
                  </div>
                </div>
              </section>

              {/* RIGHT COLUMN (8 COLS): SCROLLABLE KPI STRIP + CONTAINER STACK CARDS */}
              <div className="lg:col-span-8 lg:h-full lg:overflow-y-auto lg:pt-1 lg:-mt-1 lg:pb-2 lg:pr-1 flex flex-col gap-4 min-h-0">
                {/* Summary KPI Strip */}
                <div className="grid grid-cols-3 gap-4 shrink-0">
                  <div className="apple-card px-5 py-3.5 flex items-center justify-between">
                    <div>
                      <div className="text-[11px] text-zinc-400">Běžící</div>
                      <div className="text-2xl font-semibold font-mono text-white mt-0.5">
                        {runningCount}
                      </div>
                    </div>
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_10px_#34d399]" />
                  </div>

                  <div className="apple-card px-5 py-3.5 flex items-center justify-between">
                    <div>
                      <div className="text-[11px] text-zinc-400">Zastavené</div>
                      <div className="text-2xl font-semibold font-mono text-white mt-0.5">
                        {stoppedCount}
                      </div>
                    </div>
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${stoppedCount > 0 ? 'bg-rose-400' : 'bg-zinc-600'
                        }`}
                    />
                  </div>

                  <div className="apple-card px-5 py-3.5 flex items-center justify-between">
                    <div>
                      <div className="text-[11px] text-zinc-400">Celkem</div>
                      <div className="text-2xl font-semibold font-mono text-white mt-0.5">
                        {data.services.length}
                      </div>
                    </div>
                    <Container className="w-4 h-4 text-cyan-300" />
                  </div>
                </div>

                {/* Fixed-Size Container Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 content-start">
                  {filteredDocker.map((svc) => {
                    const isRunning = svc.status === 'running';
                    const cleanHost = svc.url.replace(/^https?:\/\//, '');
                    return (
                      <div
                        key={svc.id}
                        onMouseEnter={() => setHoveredDockerSvc(svc)}
                        onMouseLeave={() => setHoveredDockerSvc(null)}
                        className="apple-card h-[196px] p-5 flex flex-col justify-between"
                      >
                        {/* Header: Container Name, URL & Real Status */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-2xl bg-white/[0.08] border border-white/[0.1] flex items-center justify-center shrink-0">
                              <Container className="w-5 h-5 text-cyan-300" />
                            </div>
                            <div className="min-w-0">
                              <h3 className="text-base font-semibold text-white truncate">
                                {svc.name}
                              </h3>
                              <a
                                href={svc.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] font-mono text-zinc-400 hover:text-cyan-300 transition-colors truncate max-w-full mt-0.5"
                              >
                                <span className="truncate">{cleanHost}</span>
                                <ExternalLink className="w-3 h-3 shrink-0" />
                              </a>
                            </div>
                          </div>

                          <span
                            className={`text-[11px] px-2.5 py-0.5 rounded-full border shrink-0 flex items-center gap-1.5 ${isRunning
                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30'
                                : 'bg-rose-500/15 text-rose-300 border-rose-400/30'
                              }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-emerald-400' : 'bg-rose-400'
                                }`}
                            />
                            {svc.uptime}
                          </span>
                        </div>

                        {/* Multi-Control Action Bar */}
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                handleServiceAction(svc, isRunning ? 'restart' : 'start')
                              }
                              disabled={busyId === `adm-svc-${svc.id}`}
                              className="flex-1 py-2 rounded-xl bg-white text-zinc-950 font-semibold text-xs flex items-center justify-center gap-1.5 hover:bg-zinc-200 transition-colors"
                            >
                              {busyId === `adm-svc-${svc.id}` ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : isRunning ? (
                                <RotateCw className="w-3.5 h-3.5" />
                              ) : (
                                <Play className="w-3.5 h-3.5" />
                              )}
                              {isRunning ? 'Restart' : 'Start'}
                            </button>

                            {isRunning && (
                              <button
                                type="button"
                                onClick={() => handleServiceAction(svc, 'stop')}
                                className="px-3 py-2 rounded-xl bg-white/[0.06] hover:bg-rose-500/20 border border-white/[0.1] text-xs font-medium text-zinc-200 hover:text-rose-200 flex items-center gap-1.5 transition-colors"
                              >
                                <Square className="w-3.5 h-3.5" />
                                Stop
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => openDockerLogs(svc)}
                              disabled={busyId === `logs-${svc.id}`}
                              className="px-3 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.1] text-xs font-medium text-zinc-200 flex items-center gap-1.5 transition-colors"
                            >
                              <FileText className="w-3.5 h-3.5 text-cyan-300" />
                              Logy
                            </button>
                          </div>

                          {/* Secondary Admin Controls: Shell, Inspect, Pull */}
                          <div className="grid grid-cols-3 gap-1.5 pt-1.5 border-t border-white/[0.06]">
                            <button
                              type="button"
                              onClick={() => {
                                setActiveTab('ssh');
                                void runSshCommand(
                                  `docker ps --filter "name=${svc.name.toLowerCase()}" || uptime`
                                );
                              }}
                              className="py-1.5 px-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] text-[11px] text-zinc-300 hover:text-white flex items-center justify-center gap-1 transition-colors"
                            >
                              <Terminal className="w-3 h-3 text-cyan-300" />
                              Shell
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                setDockerLogModal({
                                  service: svc,
                                  output: [
                                    `Container: ${svc.name}`,
                                    `Status: ${svc.uptime}`,
                                    `URL: ${svc.url}`,
                                  ].join('\n'),
                                })
                              }
                              className="py-1.5 px-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] text-[11px] text-zinc-300 hover:text-white flex items-center justify-center gap-1 transition-colors"
                            >
                              <Info className="w-3 h-3 text-zinc-400" />
                              Inspect
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                onShowToast(true, `${svc.name}: kontrola aktualizace`)
                              }
                              className="py-1.5 px-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] text-[11px] text-zinc-300 hover:text-white flex items-center justify-center gap-1 transition-colors"
                            >
                              <Download className="w-3 h-3 text-emerald-300" />
                              Pull
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </main>
          );
        })()}

        {/* ================================================================ */}
        {/* TAB 3: ADMIN SSH / SHELL TERMINAL (FIXED LEFT + LIVE TERMINAL)   */}
        {/* ================================================================ */}
        {activeTab === 'ssh' && (() => {
          const activeConn =
            data.ssh.connections.find((c) => c.id === data.ssh.active_connection_id) ||
            data.ssh.connections[0];
          const promptLabel =
            activeConn?.mode === 'ssh'
              ? `${activeConn.user}@${activeConn.host}:${activeConn.port}`
              : `sudo@${mon.host_name}`;

          return (
            <main className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1 min-h-0 items-stretch">
              {/* LEFT PANEL (4 COLS): FIXED FULL-HEIGHT CYAN AVATAR + SSH CONNECTIONS & SHORTCUTS */}
              <section className="lg:col-span-4 lg:h-full apple-card p-6 flex flex-col justify-between relative overflow-hidden">
                <div className="relative z-10 flex items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.06] border border-white/[0.08] text-xs text-zinc-200">
                    <Terminal className="w-3.5 h-3.5 text-cyan-300" />
                    <span className="font-medium">SSH & Shell</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSshSettingsTab('connections');
                      setSshSettingsOpen(true);
                    }}
                    className="p-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.14] border border-white/[0.08] text-zinc-300 hover:text-white transition-colors"
                    title="Nastavení SSH a zkratek"
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Avatar + Hover Inspector for SSH connections */}
                <div className="relative z-10 flex flex-col items-center justify-center my-auto py-1">
                  <div className="h-[92px] w-full flex items-end justify-center mb-2">
                    <div
                      className={`relative w-64 rounded-2xl bg-[#111114]/95 backdrop-blur-2xl border border-white/[0.14] shadow-[0_20px_48px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.14)] px-4 py-2.5 text-left transition-all duration-200 ease-out ${hoveredSshConn !== null
                          ? 'opacity-100 translate-y-0 scale-100'
                          : 'opacity-0 translate-y-2 scale-95 pointer-events-none'
                        }`}
                    >
                      {hoveredSshConn && (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[10px] font-semibold text-cyan-300">
                            <span>{hoveredSshConn.name}</span>
                            <span className="font-mono text-zinc-400">
                              {hoveredSshConn.mode === 'ssh' ? `port ${hoveredSshConn.port}` : 'local'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="text-zinc-400 shrink-0">Cíl</span>
                            <span className="font-mono text-white truncate">
                              {hoveredSshConn.user}@{hoveredSshConn.host}
                            </span>
                          </div>
                          {hoveredSshConn.identity_file && (
                            <div className="flex items-center justify-between gap-2 text-[10px]">
                              <span className="text-zinc-400 shrink-0">Klíč</span>
                              <span className="font-mono text-zinc-300 truncate">
                                {hoveredSshConn.identity_file}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                      <span
                        aria-hidden="true"
                        className="absolute -bottom-2.5 left-8 w-5 h-5 rounded-full bg-gradient-to-br from-rose-200 via-red-400 to-rose-600 shadow-[0_4px_14px_rgba(244,63,94,0.55),inset_0_2px_4px_rgba(255,228,230,0.8)]"
                      />
                      <span
                        aria-hidden="true"
                        className="absolute -bottom-2.5 right-8 w-5 h-5 rounded-full bg-gradient-to-br from-rose-200 via-red-400 to-rose-600 shadow-[0_4px_14px_rgba(244,63,94,0.55),inset_0_2px_4px_rgba(255,228,230,0.8)]"
                      />
                    </div>
                  </div>

                  <div
                    aria-hidden="true"
                    className={`pointer-events-none absolute bottom-1 translate-x-2 sm:translate-x-3 ${AVATAR_CONFIG.dashboardOrb.glowClass} rounded-full blur-3xl opacity-75 ${getProfileAvatarTheme(profile).glow}`}
                    style={getProfileAvatarTheme(profile).glowStyle}
                  />

                  <div className="relative z-20 translate-x-2 sm:translate-x-3">
                    <AvatarOrb
                      profile={profile}
                      interactive
                      sizeClass={AVATAR_CONFIG.dashboardOrb.sizeClass}
                    />
                  </div>
                </div>

                {/* Saved SSH Connections + Quick Command Shortcuts */}
                <div className="relative z-10 space-y-3 pt-2">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      <span>SSH Profily</span>
                      <button
                        type="button"
                        onClick={() => {
                          setSshSettingsTab('connections');
                          setSshSettingsOpen(true);
                        }}
                        className="text-cyan-300 hover:text-white flex items-center gap-0.5 normal-case font-medium"
                      >
                        <Plus className="w-3 h-3" /> Přidat
                      </button>
                    </div>
                    <div className="space-y-1 max-h-24 overflow-y-auto pr-0.5">
                      {data.ssh.connections.map((conn) => {
                        const isActive = conn.id === data.ssh.active_connection_id;
                        return (
                          <button
                            key={conn.id}
                            type="button"
                            onMouseEnter={() => setHoveredSshConn(conn)}
                            onMouseLeave={() => setHoveredSshConn(null)}
                            onClick={() => void handleActivateSshConnection(conn.id)}
                            disabled={busyId === `ssh-act-${conn.id}`}
                            className={`w-full px-3 py-1.5 rounded-xl text-left text-xs flex items-center justify-between gap-2 transition-colors ${isActive
                                ? 'bg-white text-zinc-950 font-semibold'
                                : 'bg-white/[0.04] hover:bg-white/[0.09] text-zinc-200 border border-white/[0.06]'
                              }`}
                          >
                            <span className="flex items-center gap-2 truncate">
                              <KeyRound className="w-3 h-3 shrink-0" />
                              <span className="truncate">{conn.name}</span>
                            </span>
                            <span
                              className={`text-[10px] font-mono shrink-0 ${isActive ? 'text-zinc-600' : 'text-zinc-500'
                                }`}
                            >
                              {conn.mode === 'ssh' ? `${conn.host}` : 'local'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-2 border-t border-white/[0.07]">
                    <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      <span>Zkratky příkazů</span>
                      <button
                        type="button"
                        onClick={() => {
                          setSshSettingsTab('shortcuts');
                          setSshSettingsOpen(true);
                        }}
                        className="text-cyan-300 hover:text-white flex items-center gap-0.5 normal-case font-medium"
                      >
                        <Plus className="w-3 h-3" /> Upravit
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {data.ssh.shortcuts.map((sc) => (
                        <button
                          key={sc.id}
                          type="button"
                          onClick={() => void runSshCommand(sc.command)}
                          className="px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-white/[0.12] border border-white/[0.08] text-[11px] font-medium text-zinc-200 transition-colors"
                          title={sc.command}
                        >
                          {sc.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              {/* RIGHT PANEL (8 COLS): FULL-HEIGHT INTERACTIVE TERMINAL */}
              <section className="lg:col-span-8 lg:h-full apple-card p-5 flex flex-col gap-3.5 min-h-[420px]">
                <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/[0.07]">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                    <span className="text-sm font-semibold text-white truncate">
                      {activeConn?.name || 'Shell'}
                    </span>
                    <span className="text-[11px] font-mono text-zinc-400 truncate">
                      ({promptLabel})
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setSshHistory([])}
                      className="px-3 py-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-xs font-medium text-zinc-200 transition-colors"
                    >
                      Vyčistit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSshSettingsTab('connections');
                        setSshSettingsOpen(true);
                      }}
                      className="px-3 py-1.5 rounded-full bg-white text-zinc-950 font-semibold text-xs flex items-center gap-1.5 hover:bg-zinc-200 transition-colors"
                    >
                      <Settings className="w-3.5 h-3.5" />
                      Nastavení
                    </button>
                  </div>
                </div>

                <div className="apple-well flex-1 min-h-0 p-4 font-mono text-xs space-y-3 overflow-y-auto">
                  {sshHistory.length === 0 && (
                    <div className="text-zinc-500 text-xs">
                      Zadej příkaz dolů nebo klikni na některou ze zkratek vlevo.
                    </div>
                  )}
                  {sshHistory.map((item) => (
                    <div key={item.id} className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-cyan-300 truncate">
                          {item.target || promptLabel}:~$ <span className="text-white">{item.cmd}</span>
                        </div>
                        {item.duration_ms !== undefined && (
                          <span className="text-[10px] text-zinc-500 shrink-0">
                            {item.ok ? 'OK' : `exit ${item.exit_code ?? 1}`} · {item.duration_ms}ms
                          </span>
                        )}
                      </div>
                      <pre
                        className={`whitespace-pre-wrap break-words text-[11px] pl-3 border-l ${item.ok ? 'text-zinc-300 border-white/15' : 'text-rose-300 border-rose-400/50'
                          }`}
                      >
                        {item.output}
                      </pre>
                    </div>
                  ))}
                  <div ref={sshEndRef} />
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runSshCommand(sshInput);
                  }}
                  className="shrink-0 flex items-center gap-2"
                >
                  <div className="apple-well flex-1 flex items-center gap-2 px-3.5 py-2.5 focus-within:border-cyan-400/50">
                    <span className="font-mono text-xs text-cyan-300 shrink-0">
                      {promptLabel}$
                    </span>
                    <input
                      type="text"
                      value={sshInput}
                      onChange={(e) => setSshInput(e.target.value)}
                      onKeyDown={handleSshKeyDown}
                      disabled={sshRunning}
                      placeholder="Napiš příkaz (šipky ↑/↓ pro historii)..."
                      className="flex-1 min-w-0 bg-transparent text-xs font-mono text-white placeholder:text-zinc-500 outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={sshRunning || !sshInput.trim()}
                    className="px-5 py-2.5 rounded-xl bg-white text-zinc-950 font-semibold text-xs hover:bg-zinc-200 disabled:opacity-40 transition-colors shrink-0"
                  >
                    {sshRunning ? 'Běží...' : 'Spustit'}
                  </button>
                </form>
              </section>
            </main>
          );
        })()}

        {/* ================================================================ */}
        {/* TAB 4: SYSTEM PROCESSES                                          */}
        {/* ================================================================ */}
        {activeTab === 'processes' && (() => {
          const allProcesses = data.processes ?? [];
          const q = processSearch.trim().toLowerCase();
          const filteredProcesses = allProcesses
            .filter(
              (p) =>
                !q ||
                p.name.toLowerCase().includes(q) ||
                p.cmd.toLowerCase().includes(q) ||
                String(p.pid).includes(q)
            )
            .slice()
            .sort((a, b) => {
              if (processSort === 'memory') {
                return b.memory_mb - a.memory_mb || b.cpu_percent - a.cpu_percent;
              }
              if (processSort === 'name') {
                return a.name.localeCompare(b.name, 'cs') || b.memory_mb - a.memory_mb;
              }
              return b.cpu_percent - a.cpu_percent || b.memory_mb - a.memory_mb;
            });

          return (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:h-[calc(100vh-148px)] lg:min-h-[600px] lg:overflow-hidden">
              {/* LEFT COLUMN (4 COLS): STICKY AVATAR INSPECTOR & PROCESS CONTROLS */}
              <section className="lg:col-span-4 apple-card p-6 flex flex-col justify-between relative overflow-hidden lg:h-full">
                {/* Header */}
                <div className="relative z-10 flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold text-white tracking-tight">
                      Systémové procesy
                    </h2>
                    <p className="text-xs text-zinc-400">
                      {mon.host_name} · {mon.cpu_cores} jader
                    </p>
                  </div>
                  <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-400/30">
                    {mon.process_count} celkem
                  </span>
                </div>

                {/* Avatar + Hover Inspector Card */}
                <div className="relative z-10 flex flex-col items-center justify-center my-auto py-2">
                  <div className="h-[100px] w-full flex items-end justify-center mb-3">
                    <div
                      className={`relative w-64 rounded-2xl bg-[#111114]/95 backdrop-blur-2xl border border-white/[0.14] shadow-[0_20px_48px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.14)] px-4 py-3 text-left transition-all duration-200 ease-out ${hoveredProcess !== null
                          ? 'opacity-100 translate-y-0 scale-100'
                          : 'opacity-0 translate-y-2 scale-95 pointer-events-none'
                        }`}
                    >
                      {hoveredProcess && (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2 text-[10px] font-semibold text-cyan-300">
                            <span className="truncate">{hoveredProcess.name}</span>
                            <span className="font-mono text-zinc-400 shrink-0">
                              PID {hoveredProcess.pid}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="text-zinc-400 shrink-0">CPU / RAM</span>
                            <span className="font-mono text-white truncate">
                              {hoveredProcess.cpu_percent.toFixed(1)}% · {formatProcMemory(hoveredProcess.memory_mb)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="text-zinc-400 shrink-0">Stav · Běží</span>
                            <span className="font-mono text-zinc-200 truncate">
                              {hoveredProcess.status} · {formatProcRuntime(hoveredProcess.run_time_secs)}
                            </span>
                          </div>
                        </div>
                      )}
                      <span
                        aria-hidden="true"
                        className="absolute -bottom-2.5 left-8 w-5 h-5 rounded-full bg-gradient-to-br from-rose-200 via-red-400 to-rose-600 shadow-[0_4px_14px_rgba(244,63,94,0.55),inset_0_2px_4px_rgba(255,228,230,0.8)]"
                      />
                      <span
                        aria-hidden="true"
                        className="absolute -bottom-2.5 right-8 w-5 h-5 rounded-full bg-gradient-to-br from-rose-200 via-red-400 to-rose-600 shadow-[0_4px_14px_rgba(244,63,94,0.55),inset_0_2px_4px_rgba(255,228,230,0.8)]"
                      />
                    </div>
                  </div>

                  <div
                    aria-hidden="true"
                    className={`pointer-events-none absolute bottom-2 translate-x-2 sm:translate-x-3 ${AVATAR_CONFIG.dashboardOrb.glowClass} rounded-full blur-3xl opacity-75 ${getProfileAvatarTheme(profile).glow}`}
                    style={getProfileAvatarTheme(profile).glowStyle}
                  />

                  <div className="relative z-20 translate-x-2 sm:translate-x-3">
                    <AvatarOrb
                      profile={profile}
                      interactive
                      sizeClass={AVATAR_CONFIG.dashboardOrb.sizeClass}
                    />
                  </div>
                </div>

                {/* Process Filter & Sort Controls */}
                <div className="relative z-10 space-y-3 pt-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={processSearch}
                      onChange={(e) => setProcessSearch(e.target.value)}
                      placeholder="Hledat proces, příkaz nebo PID..."
                      className="apple-well w-full pl-9 pr-3 py-2 text-xs text-white placeholder:text-zinc-500 outline-none focus:border-white/25"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-1.5 bg-white/[0.04] p-1 rounded-xl border border-white/[0.08]">
                    {(
                      [
                        ['cpu', 'CPU %'],
                        ['memory', 'Paměť'],
                        ['name', 'Název'],
                      ] as [ProcessSortKey, string][]
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setProcessSort(key)}
                        className={`py-1.5 rounded-lg text-[11px] font-medium transition-colors ${processSort === key
                            ? 'bg-white text-zinc-950 font-semibold'
                            : 'text-zinc-400 hover:text-white'
                          }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void onRefresh()}
                      className="flex-1 py-2 px-3 rounded-xl bg-white/[0.07] hover:bg-white/[0.13] border border-white/[0.1] text-xs font-medium text-white flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-cyan-300" />
                      Obnovit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('ssh');
                        void runSshCommand('ps aux --sort=-%cpu | head -n 20');
                      }}
                      className="flex-1 py-2 px-3 rounded-xl bg-white hover:bg-zinc-200 text-zinc-950 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Terminal className="w-3.5 h-3.5" />
                      ps aux
                    </button>
                  </div>
                </div>
              </section>

              {/* RIGHT COLUMN (8 COLS): SUMMARY KPI STRIP + PROCESS LIST */}
              <div className="lg:col-span-8 lg:h-full flex flex-col gap-4 min-h-0">
                {/* Summary KPI Strip */}
                <div className="grid grid-cols-3 gap-4 shrink-0">
                  <div className="apple-card px-5 py-3.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[11px] text-zinc-400">Aktivní procesy</div>
                      <div className="text-2xl font-semibold font-mono text-white mt-0.5">
                        {mon.process_count}
                      </div>
                      <div className="text-[11px] text-zinc-500 truncate mt-0.5">
                        zobrazeno {filteredProcesses.length}
                      </div>
                    </div>
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_10px_#34d399] shrink-0" />
                  </div>

                  <div className="apple-card px-5 py-3.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[11px] text-zinc-400">CPU zátěž</div>
                      <div className="text-2xl font-semibold font-mono text-white mt-0.5">
                        {mon.cpu_percent.toFixed(1)}%
                      </div>
                      <div className="text-[11px] text-zinc-500 truncate mt-0.5">
                        {mon.top_cpu_proc}
                      </div>
                    </div>
                    <Cpu className="w-4 h-4 text-cyan-300 shrink-0" />
                  </div>

                  <div className="apple-card px-5 py-3.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[11px] text-zinc-400">Paměť RAM</div>
                      <div className="text-2xl font-semibold font-mono text-white mt-0.5">
                        {mon.ram_used_gb.toFixed(1)} GB
                      </div>
                      <div className="text-[11px] text-zinc-500 truncate mt-0.5">
                        {mon.top_ram_proc}
                      </div>
                    </div>
                    <MemoryStick className="w-4 h-4 text-emerald-300 shrink-0" />
                  </div>
                </div>

                {/* Process List Card */}
                <div className="apple-card p-4 sm:p-5 flex-1 min-h-0 flex flex-col">
                  <div className="grid grid-cols-12 gap-3 px-3 pb-2.5 border-b border-white/[0.08] text-[11px] font-medium text-zinc-400 uppercase tracking-wider shrink-0">
                    <div className="col-span-5">Proces / Příkaz</div>
                    <div className="col-span-2 text-right">PID</div>
                    <div className="col-span-2 text-right">CPU</div>
                    <div className="col-span-3 text-right">Paměť</div>
                  </div>

                  <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-1.5 mt-2">
                    {filteredProcesses.length === 0 ? (
                      <div className="apple-well p-8 text-center text-xs text-zinc-500">
                        Žádné procesy neodpovídají filtru „{processSearch}“.
                      </div>
                    ) : (
                      filteredProcesses.map((proc) => {
                        const isHighCpu = proc.cpu_percent >= 25;
                        const isActiveCpu = proc.cpu_percent >= 1;
                        const cpuBarWidth = Math.min(100, Math.max(2, proc.cpu_percent));

                        return (
                          <div
                            key={proc.pid}
                            onMouseEnter={() => setHoveredProcess(proc)}
                            onMouseLeave={() => setHoveredProcess(null)}
                            className="apple-well px-3.5 py-2.5 grid grid-cols-12 items-center gap-3 hover:border-white/25 transition-colors cursor-default"
                          >
                            <div className="col-span-5 flex items-center gap-2.5 min-w-0">
                              <span
                                className={`w-2 h-2 rounded-full shrink-0 ${isHighCpu
                                    ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24]'
                                    : isActiveCpu
                                      ? 'bg-cyan-400 shadow-[0_0_8px_#22d3ee]'
                                      : proc.status === 'Run'
                                        ? 'bg-emerald-400'
                                        : 'bg-zinc-600'
                                  }`}
                              />
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-white truncate">
                                  {proc.name}
                                </div>
                                <div className="text-[11px] font-mono text-zinc-500 truncate">
                                  {proc.cmd}
                                </div>
                              </div>
                            </div>

                            <div className="col-span-2 text-right">
                              <div className="text-xs font-mono text-zinc-300">
                                {proc.pid}
                              </div>
                              <div className="text-[10px] font-mono text-zinc-500">
                                {proc.status}
                              </div>
                            </div>

                            <div className="col-span-2 text-right">
                              <div
                                className={`text-xs font-mono font-semibold ${isHighCpu
                                    ? 'text-amber-300'
                                    : isActiveCpu
                                      ? 'text-cyan-300'
                                      : 'text-zinc-300'
                                  }`}
                              >
                                {proc.cpu_percent.toFixed(1)}%
                              </div>
                              <div className="h-1 w-full rounded-full bg-white/[0.06] overflow-hidden mt-1">
                                <div
                                  className={`h-full rounded-full ${isHighCpu
                                      ? 'bg-amber-400'
                                      : 'bg-cyan-400'
                                    }`}
                                  style={{ width: `${cpuBarWidth}%` }}
                                />
                              </div>
                            </div>

                            <div className="col-span-3 text-right">
                              <div className="text-xs font-mono text-white">
                                {formatProcMemory(proc.memory_mb)}
                              </div>
                              <div className="text-[10px] font-mono text-zinc-500">
                                {formatProcRuntime(proc.run_time_secs)}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Docker Live Logs Modal */}
      {dockerLogModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
          <div className="apple-card w-full max-w-2xl p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <FileText className="w-4 h-4 text-cyan-300 shrink-0" />
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-white truncate">
                    Logy · {dockerLogModal.service.name}
                  </h2>
                  <p className="text-xs text-zinc-400 truncate">
                    {dockerLogModal.service.uptime}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDockerLogModal(null)}
                className="p-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <pre className="apple-well p-4 text-xs font-mono text-zinc-200 whitespace-pre-wrap break-words max-h-80 overflow-y-auto">
              {dockerLogModal.output}
            </pre>
          </div>
        </div>
      )}

      {/* Real SSH Settings & Shortcuts Modal */}
      {sshSettingsOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
          <div className="apple-card w-full max-w-xl p-6 space-y-5 max-h-[88vh] overflow-y-auto">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-white">Nastavení SSH & Zkratek</h2>
                <p className="text-xs text-zinc-400">
                  Vzdálené SSH cíle (přes klíč) a uložené příkazy na backendu
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSshSettingsOpen(false)}
                className="p-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1.5 bg-white/[0.04] p-1 rounded-xl border border-white/[0.08]">
              <button
                type="button"
                onClick={() => setSshSettingsTab('connections')}
                className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${sshSettingsTab === 'connections'
                    ? 'bg-white text-zinc-950 font-semibold'
                    : 'text-zinc-400 hover:text-white'
                  }`}
              >
                SSH Připojení ({data.ssh.connections.length})
              </button>
              <button
                type="button"
                onClick={() => setSshSettingsTab('shortcuts')}
                className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${sshSettingsTab === 'shortcuts'
                    ? 'bg-white text-zinc-950 font-semibold'
                    : 'text-zinc-400 hover:text-white'
                  }`}
              >
                Zkratky příkazů ({data.ssh.shortcuts.length})
              </button>
            </div>

            {sshSettingsTab === 'connections' ? (
              <div className="space-y-4">
                <form onSubmit={handleAddSshConnection} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-zinc-400 mb-1">Název profilu</label>
                      <input
                        type="text"
                        value={newConnName}
                        onChange={(e) => setNewConnName(e.target.value)}
                        placeholder="např. Homelab M75Q"
                        className="apple-well w-full px-3 py-2 text-xs text-white placeholder:text-zinc-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-zinc-400 mb-1">Režim</label>
                      <select
                        value={newConnMode}
                        onChange={(e) => setNewConnMode(e.target.value as 'ssh' | 'local')}
                        className="apple-well w-full px-3 py-2 text-xs text-white outline-none"
                      >
                        <option value="ssh">Vzdálené SSH</option>
                        <option value="local">Lokální Shell</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] text-zinc-400 mb-1">Uživatel</label>
                      <input
                        type="text"
                        value={newConnUser}
                        onChange={(e) => setNewConnUser(e.target.value)}
                        placeholder="root"
                        className="apple-well w-full px-3 py-2 text-xs font-mono text-white placeholder:text-zinc-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-zinc-400 mb-1">Host / IP</label>
                      <input
                        type="text"
                        value={newConnHost}
                        onChange={(e) => setNewConnHost(e.target.value)}
                        placeholder="192.168.1.100"
                        className="apple-well w-full px-3 py-2 text-xs font-mono text-white placeholder:text-zinc-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-zinc-400 mb-1">Port</label>
                      <input
                        type="number"
                        value={newConnPort}
                        onChange={(e) => setNewConnPort(e.target.value)}
                        className="apple-well w-full px-3 py-2 text-xs font-mono text-white outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-zinc-400 mb-1">SSH klíč (volitelné)</label>
                      <input
                        type="text"
                        value={newConnKey}
                        onChange={(e) => setNewConnKey(e.target.value)}
                        placeholder="~/.ssh/id_ed25519"
                        className="apple-well w-full px-3 py-2 text-xs font-mono text-white placeholder:text-zinc-500 outline-none"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={busyId === 'ssh-add-conn' || !newConnName.trim() || !newConnHost.trim()}
                    className="w-full py-2.5 rounded-xl bg-white text-zinc-950 font-semibold text-xs hover:bg-zinc-200 disabled:opacity-40 transition-colors"
                  >
                    Uložit SSH připojení
                  </button>
                </form>

                <div className="space-y-1.5 pt-2 border-t border-white/[0.08] max-h-44 overflow-y-auto">
                  {data.ssh.connections.map((conn) => (
                    <div
                      key={conn.id}
                      className="apple-well px-3 py-2 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-white truncate">{conn.name}</div>
                        <div className="text-[10px] font-mono text-zinc-400 truncate">
                          {conn.user}@{conn.host}:{conn.port} ({conn.mode})
                          {conn.identity_file ? ` · ${conn.identity_file}` : ''}
                        </div>
                      </div>
                      {conn.id !== 'ssh-local' && (
                        <button
                          type="button"
                          onClick={() => void handleDeleteSshConnection(conn.id)}
                          className="p-1 text-zinc-400 hover:text-rose-400 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <form onSubmit={handleAddSshShortcut} className="space-y-3">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Název zkratky</label>
                    <input
                      type="text"
                      value={newScLabel}
                      onChange={(e) => setNewScLabel(e.target.value)}
                      placeholder="např. Docker stav"
                      className="apple-well w-full px-3 py-2 text-xs text-white placeholder:text-zinc-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Příkaz</label>
                    <input
                      type="text"
                      value={newScCmd}
                      onChange={(e) => setNewScCmd(e.target.value)}
                      placeholder="docker ps"
                      className="apple-well w-full px-3 py-2 text-xs font-mono text-white placeholder:text-zinc-500 outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={busyId === 'ssh-add-sc' || !newScLabel.trim() || !newScCmd.trim()}
                    className="w-full py-2.5 rounded-xl bg-white text-zinc-950 font-semibold text-xs hover:bg-zinc-200 disabled:opacity-40 transition-colors"
                  >
                    Přidat zkratku
                  </button>
                </form>

                <div className="space-y-1.5 pt-2 border-t border-white/[0.08] max-h-44 overflow-y-auto">
                  {data.ssh.shortcuts.map((sc) => (
                    <div
                      key={sc.id}
                      className="apple-well px-3 py-2 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-white truncate">{sc.label}</div>
                        <div className="text-[10px] font-mono text-zinc-400 truncate">
                          {sc.command}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDeleteSshShortcut(sc.id)}
                        className="p-1 text-zinc-400 hover:text-rose-400 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
