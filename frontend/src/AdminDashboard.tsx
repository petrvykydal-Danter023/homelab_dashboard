import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {
  Activity,
  ArrowDownUp,
  Check,
  Clock,
  Container,
  Cpu,
  Database,
  Download,
  ExternalLink,
  FileText,
  Film,
  Globe,
  HardDrive,
  Home,
  Image as ImageIcon,
  Info,
  KeyRound,
  Layers,
  Lock,
  MemoryStick,
  Network,
  Palette,
  Pencil,
  Pin,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  Server,
  Settings,
  Shield,
  Square,
  Terminal,
  Trash2,
  Upload,
  Users,
  X,
  Zap,
} from 'lucide-react';
import type {
  DashboardResponse,
  HomelabService,
  NoticeboardItem,
  ProcessInfo,
  SshConnection,
  UserProfile,
} from './types';
import {
  AVATAR_COLOR_OPTIONS,
  AVATAR_CONFIG,
  AvatarBadge,
  AvatarOrb,
  getProfileAccentColor,
  getProfileAvatarTheme,
} from './Avatar';
import { WakePcButton } from './WakePcButton';

type AdminTab = 'dashboard' | 'docker' | 'ssh' | 'processes' | 'profiles' | 'noticeboard';
type ProcessSortKey = 'cpu' | 'memory' | 'name';
type HoveredMetric = 'cpu' | 'ram' | 'storage' | 'network' | 'uptime' | 'diskio' | null;

const SERVICE_ICON_OPTIONS: { id: string; label: string; icon: React.ReactNode }[] = [
  { id: 'container', label: 'Kontejner', icon: <Container className="w-4 h-4" /> },
  { id: 'globe', label: 'Web', icon: <Globe className="w-4 h-4" /> },
  { id: 'shield', label: 'Bezpečnost', icon: <Shield className="w-4 h-4" /> },
  { id: 'lock', label: 'Hesla', icon: <Lock className="w-4 h-4" /> },
  { id: 'image', label: 'Fotky', icon: <ImageIcon className="w-4 h-4" /> },
  { id: 'film', label: 'Média', icon: <Film className="w-4 h-4" /> },
  { id: 'home', label: 'Domov', icon: <Home className="w-4 h-4" /> },
  { id: 'server', label: 'Server', icon: <Server className="w-4 h-4" /> },
  { id: 'database', label: 'Databáze', icon: <Database className="w-4 h-4" /> },
  { id: 'terminal', label: 'Terminál', icon: <Terminal className="w-4 h-4" /> },
  { id: 'activity', label: 'Metriky', icon: <Activity className="w-4 h-4" /> },
  { id: 'zap', label: 'Automatizace', icon: <Zap className="w-4 h-4" /> },
  { id: 'layers', label: 'Proxy / Síť', icon: <Layers className="w-4 h-4" /> },
  { id: 'hard-drive', label: 'Úložiště', icon: <HardDrive className="w-4 h-4" /> },
];

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
  const [ptyConnected, setPtyConnected] = useState(false);
  const [ptyStatusText, setPtyStatusText] = useState<
    'connecting' | 'connected' | 'closed' | 'error'
  >('connecting');
  const [ptyReconnectSeq, setPtyReconnectSeq] = useState(0);
  const ptyContainerRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ptyWsRef = useRef<WebSocket | null>(null);
  const pendingPtyCommandRef = useRef<string | null>(null);

  // Profiles & Service Visibility + Service Media state (exclude admin/sudo)
  const manageableProfiles = data.profiles.filter((p) => !p.is_admin);
  const [selectedProfileId, setSelectedProfileId] = useState<string>(() => {
    return manageableProfiles[0]?.id ?? '';
  });
  const selectedProfile =
    manageableProfiles.find((p) => p.id === selectedProfileId) ?? manageableProfiles[0];
  const [profDraftName, setProfDraftName] = useState(selectedProfile?.name ?? '');
  const [profDraftColor, setProfDraftColor] = useState(
    selectedProfile?.avatar_color ?? 'cyan'
  );
  const [profDraftPin, setProfDraftPin] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [noteMessage, setNoteMessage] = useState('');
  const [noteTag, setNoteTag] = useState<'Oznámení' | 'Info' | 'Údržba'>('Oznámení');
  const [notePinned, setNotePinned] = useState(false);
  const [noteFilter, setNoteFilter] = useState<'all' | 'pinned'>('all');
  const [editingNote, setEditingNote] = useState<NoticeboardItem | null>(null);
  // Real Docker containers only (excludes profile links)
  const dockerServices = data.services.filter((s) => s.is_docker !== false);
  const [newSvcMode, setNewSvcMode] = useState<'link' | 'container'>('link');
  const [newSvcContainerId, setNewSvcContainerId] = useState<string>(
    () => dockerServices[0]?.id ?? ''
  );
  const [newSvcName, setNewSvcName] = useState('');
  const [newSvcUrl, setNewSvcUrl] = useState('');
  const [newSvcSubtitle, setNewSvcSubtitle] = useState('');
  const [newSvcIcon, setNewSvcIcon] = useState('globe');
  const [newSvcImageFile, setNewSvcImageFile] = useState<File | null>(null);
  const [editingService, setEditingService] = useState<{
    id: string;
    name: string;
    url: string;
    subtitle: string;
    icon: string;
    image_url: string;
  } | null>(null);
  const [githubUpdating, setGithubUpdating] = useState(false);
  const [githubUpdateModal, setGithubUpdateModal] = useState<{
    ok: boolean;
    message: string;
    old_commit?: string;
    new_commit?: string;
    restarting?: boolean;
    output: string;
  } | null>(null);

  useEffect(() => {
    if (selectedProfile) {
      setProfDraftName(selectedProfile.name);
      setProfDraftColor(selectedProfile.avatar_color || 'cyan');
      setProfDraftPin('');
    }
  }, [selectedProfile?.id, selectedProfile?.name, selectedProfile?.avatar_color]);

  const profile = data.active_profile;
  const handleSaveProfileSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProfile || !profDraftName.trim()) return;
    setBusyId(`prof-save-${selectedProfile.id}`);
    try {
      const payload: Record<string, string> = {
        name: profDraftName.trim(),
        avatar_color: profDraftColor.trim() || 'cyan',
      };
      if (profDraftPin.trim().length > 0) {
        payload.pin_code = profDraftPin.trim();
      }
      const res = await fetch(`/api/profiles/${encodeURIComponent(selectedProfile.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setProfDraftPin('');
        await onRefresh();
        onShowToast(true, `Profil ${profDraftName.trim()} uložen.`);
      } else {
        onShowToast(false, 'Nepodařilo se uložit profil.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleRemoveProfilePin = async () => {
    if (!selectedProfile) return;
    setBusyId(`prof-pin-clear-${selectedProfile.id}`);
    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(selectedProfile.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin_code: '' }),
      });
      if (res.ok) {
        setProfDraftPin('');
        await onRefresh();
        onShowToast(true, `PIN pro ${selectedProfile.name} odstraněn.`);
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteTitle.trim() || !noteMessage.trim()) return;
    setBusyId('note-create');
    try {
      const res = await fetch('/api/admin/noticeboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: noteTitle.trim(),
          message: noteMessage.trim(),
          tag: noteTag,
          pinned: notePinned,
        }),
      });
      if (res.ok) {
        setNoteTitle('');
        setNoteMessage('');
        setNotePinned(false);
        await onRefresh();
        onShowToast(true, 'Vzkaz přidán na nástěnku.');
      } else {
        onShowToast(false, 'Nepodařilo se přidat vzkaz.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleNotePin = async (note: NoticeboardItem) => {
    setBusyId(`note-pin-${note.id}`);
    try {
      const res = await fetch(`/api/admin/noticeboard/${encodeURIComponent(note.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: !note.pinned }),
      });
      if (res.ok) {
        await onRefresh();
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveEditedNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingNote || !editingNote.title.trim() || !editingNote.message.trim()) return;
    setBusyId(`note-edit-${editingNote.id}`);
    try {
      const res = await fetch(`/api/admin/noticeboard/${encodeURIComponent(editingNote.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editingNote.title.trim(),
          message: editingNote.message.trim(),
          tag: editingNote.tag,
          pinned: editingNote.pinned,
        }),
      });
      if (res.ok) {
        setEditingNote(null);
        await onRefresh();
        onShowToast(true, 'Vzkaz upraven.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    setBusyId(`note-del-${noteId}`);
    try {
      const res = await fetch(`/api/admin/noticeboard/${encodeURIComponent(noteId)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        await onRefresh();
        onShowToast(true, 'Vzkaz smazán.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleQuickColorSelect = async (colorValue: string) => {
    setProfDraftColor(colorValue);
    if (!selectedProfile) return;
    setBusyId(`prof-color-${selectedProfile.id}`);
    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(selectedProfile.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar_color: colorValue }),
      });
      if (res.ok) {
        await onRefresh();
      }
    } finally {
      setBusyId(null);
    }
  };

  const getEffectiveVisibleIds = (target: UserProfile): Set<string> => {
    if (target.visible_services == null) {
      return new Set(data.services.map((s) => s.id));
    }
    return new Set(target.visible_services);
  };

  const handleToggleProfileService = async (target: UserProfile, svcId: string) => {
    const currentSet = getEffectiveVisibleIds(target);
    if (currentSet.has(svcId)) {
      currentSet.delete(svcId);
    } else {
      currentSet.add(svcId);
    }
    const nextIds = data.services.map((s) => s.id).filter((id) => currentSet.has(id));
    setBusyId(`vis-${target.id}-${svcId}`);
    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(target.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visible_services: nextIds }),
      });
      if (res.ok) {
        await onRefresh();
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleSetAllProfileServices = async (target: UserProfile, enabled: boolean) => {
    const nextIds = enabled ? data.services.map((s) => s.id) : [];
    setBusyId(`vis-all-${target.id}`);
    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(target.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visible_services: nextIds }),
      });
      if (res.ok) {
        await onRefresh();
        onShowToast(true, enabled ? 'Všechny služby povoleny.' : 'Všechny služby skryty.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleUploadServiceImage = async (svcId: string, file: File | null) => {
    if (!file) return;
    setBusyId(`img-${svcId}`);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/services/${encodeURIComponent(svcId)}/image`, {
        method: 'POST',
        body: fd,
      });
      if (res.ok) {
        await onRefresh();
        onShowToast(true, 'Obrázek služby nahrán.');
      } else {
        onShowToast(false, 'Nahrání obrázku selhalo.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSvcName.trim() || !newSvcUrl.trim()) return;
    setBusyId('create-svc');
    try {
      const pickedContainer =
        newSvcMode === 'container'
          ? dockerServices.find((c) => c.id === newSvcContainerId) ?? dockerServices[0]
          : undefined;
      const res = await fetch('/api/admin/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newSvcName.trim(),
          url: newSvcUrl.trim(),
          subtitle:
            newSvcSubtitle.trim() ||
            (pickedContainer ? pickedContainer.name : undefined),
          icon: newSvcIcon,
          is_docker: false,
          container_name: pickedContainer ? pickedContainer.name : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        onShowToast(false, json.message || 'Nepodařilo se přidat službu.');
        return;
      }

      const createdId: string | undefined = json.service_id;
      if (createdId && newSvcImageFile) {
        const fd = new FormData();
        fd.append('file', newSvcImageFile);
        await fetch(`/api/services/${encodeURIComponent(createdId)}/image`, {
          method: 'POST',
          body: fd,
        });
      }

      // If currently selected profile uses custom visibility list, also include the newly added service
      if (createdId && selectedProfile && selectedProfile.visible_services != null) {
        const updatedVis = Array.from(new Set([...selectedProfile.visible_services, createdId]));
        await fetch(`/api/profiles/${encodeURIComponent(selectedProfile.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visible_services: updatedVis }),
        });
      }

      setNewSvcName('');
      setNewSvcUrl('');
      setNewSvcSubtitle('');
      setNewSvcIcon(newSvcMode === 'container' ? 'container' : 'globe');
      setNewSvcImageFile(null);
      await onRefresh();
      onShowToast(true, 'Služba přidána.');
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveEditedService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingService || !editingService.name.trim() || !editingService.url.trim()) return;
    setBusyId(`edit-svc-${editingService.id}`);
    try {
      const res = await fetch(`/api/admin/services/${encodeURIComponent(editingService.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editingService.name.trim(),
          url: editingService.url.trim(),
          subtitle: editingService.subtitle.trim() || undefined,
          icon: editingService.icon,
          image_url: editingService.image_url.trim(),
        }),
      });
      if (res.ok) {
        setEditingService(null);
        await onRefresh();
        onShowToast(true, 'Služba upravena.');
      } else {
        onShowToast(false, 'Nepodařilo se upravit službu.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteService = async (svcId: string) => {
    setBusyId(`del-svc-${svcId}`);
    try {
      const res = await fetch(`/api/admin/services/${encodeURIComponent(svcId)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        await onRefresh();
        onShowToast(true, 'Služba odstraněna.');
      }
    } finally {
      setBusyId(null);
    }
  };

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
      const res = await fetch('/api/system/check', { method: 'POST' });
      if (res.ok) {
        await onRefresh();
        onShowToast(true, 'Kontrola systému dokončena.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleGithubUpdate = async () => {
    setGithubUpdating(true);
    try {
      const res = await fetch('/api/admin/update', { method: 'POST' });
      const json = await res.json();
      setGithubUpdateModal({
        ok: Boolean(json.ok),
        message: json.message || (json.ok ? 'Aktualizace dokončena.' : 'Aktualizace selhala.'),
        old_commit: json.old_commit,
        new_commit: json.new_commit,
        restarting: Boolean(json.restarting),
        output: json.output || '',
      });
      onShowToast(Boolean(json.ok), json.message || 'Aktualizace z GitHubu dokončena.');
      if (json.ok) {
        if (json.restarting) {
          window.setTimeout(() => {
            void onRefresh();
          }, 1200);
        } else {
          await onRefresh();
        }
      }
    } catch {
      setGithubUpdateModal({
        ok: false,
        message: 'Nepodařilo se spojit s backendem při aktualizaci z GitHubu.',
        output: 'Chyba sítě při volání POST /api/admin/update.',
      });
      onShowToast(false, 'Chyba komunikace při aktualizaci.');
    } finally {
      setGithubUpdating(false);
    }
  };

  const openDockerLogs = async (svc: HomelabService) => {
    setBusyId(`logs-${svc.id}`);
    try {
      const res = await fetch(`/api/docker/logs/${encodeURIComponent(svc.id)}`);
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

  useEffect(() => {
    if (activeTab !== 'ssh') {
      return;
    }
    const container = ptyContainerRef.current;
    if (!container) return;

    setPtyConnected(false);
    setPtyStatusText('connecting');

    const term = new XTerm({
      cursorBlink: true,
      fontFamily:
        '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.35,
      scrollback: 5000,
      convertEol: false,
      theme: {
        background: '#0a0a0d',
        foreground: '#e4e4e7',
        cursor: '#22d3ee',
        cursorAccent: '#09090b',
        selectionBackground: 'rgba(34, 211, 238, 0.25)',
        black: '#18181b',
        red: '#fb7185',
        green: '#34d399',
        yellow: '#fbbf24',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e4e4e7',
        brightBlack: '#52525b',
        brightRed: '#fda4af',
        brightGreen: '#6ee7b7',
        brightYellow: '#fde68a',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#ffffff',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    const fitNow = () => {
      try {
        fitAddon.fit();
      } catch {
        // Ignore fit measurements before layout settles
      }
    };
    fitNow();
    const rafId = window.requestAnimationFrame(fitNow);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const activeConnId =
      data.ssh.active_connection_id || data.ssh.connections[0]?.id || 'ssh-local';
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProto}//${window.location.host}/api/admin/pty?connection_id=${encodeURIComponent(
      activeConnId
    )}&profile_id=${encodeURIComponent(data.active_profile.id)}&cols=${
      term.cols || 100
    }&rows=${term.rows || 28}`;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    ptyWsRef.current = ws;

    ws.onopen = () => {
      setPtyConnected(true);
      setPtyStatusText('connected');
      fitNow();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        if (pendingPtyCommandRef.current) {
          const pending = pendingPtyCommandRef.current;
          pendingPtyCommandRef.current = null;
          ws.send(JSON.stringify({ type: 'input', data: `${pending}\r` }));
        }
      }
      term.focus();
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        term.write(ev.data);
      } else if (ev.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(ev.data));
      }
    };

    ws.onerror = () => {
      setPtyConnected(false);
      setPtyStatusText('error');
    };

    ws.onclose = () => {
      setPtyConnected(false);
      setPtyStatusText((prev) => (prev === 'error' ? 'error' : 'closed'));
    };

    const dataSub = term.onData((input) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data: input }));
      }
    });

    const resizeSub = term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      fitNow();
    });
    resizeObserver.observe(container);

    return () => {
      window.cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      dataSub.dispose();
      resizeSub.dispose();
      if (ptyWsRef.current === ws) {
        ptyWsRef.current = null;
      }
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      setPtyConnected(false);
    };
  }, [activeTab, data.ssh.active_connection_id, data.active_profile.id, ptyReconnectSeq]);

  const sendPtyInput = (raw: string): boolean => {
    const ws = ptyWsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data: raw }));
      xtermRef.current?.focus();
      return true;
    }
    return false;
  };

  const runSshCommand = (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;
    if (trimmed === 'clear') {
      xtermRef.current?.clear();
    }
    if (!sendPtyInput(`${trimmed}\r`)) {
      pendingPtyCommandRef.current = trimmed;
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
            title="Vybrat profil"
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
                    ['profiles', 'Profiles', <Users className="w-3.5 h-3.5" />],
                    ['noticeboard', 'Nástěnka', <Pin className="w-3.5 h-3.5" />],
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

            <div className="flex items-center gap-2 shrink-0">
              <WakePcButton onToast={onShowToast} />

              <button
                type="button"
                onClick={() => void handleGithubUpdate()}
                disabled={githubUpdating}
                className="px-3.5 py-2 rounded-xl bg-white/[0.08] hover:bg-white/[0.15] border border-white/[0.12] text-xs font-semibold text-white flex items-center gap-2 transition-all disabled:opacity-50 shrink-0"
                title="Stáhnout nejnovější změny z GitHubu (git pull + build + restart)"
              >
                {githubUpdating ? (
                  <RefreshCw className="w-3.5 h-3.5 text-cyan-300 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5 text-cyan-300" />
                )}
                <span>{githubUpdating ? 'Aktualizuji...' : 'Aktualizovat z GitHubu'}</span>
              </button>
            </div>
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
                  {dockerServices.filter((s) => s.status === 'running').length}/{dockerServices.length} online
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
          const runningCount = dockerServices.filter((s) => s.status === 'running').length;
          const stoppedCount = dockerServices.length - runningCount;
          const filteredDocker = dockerServices.filter((svc) => {
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
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                        data.docker_live
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-white/[0.06] text-zinc-400'
                      }`}
                    >
                      {data.docker_live ? 'Live' : 'Demo'}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-400/30">
                    {runningCount}/{dockerServices.length} aktivní
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
                        ['all', `Vše (${dockerServices.length})`],
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
                        {dockerServices.length}
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
          const promptUser =
            activeConn?.mode === 'ssh'
              ? activeConn.user
              : activeConn?.user && activeConn.user !== 'sudo'
                ? activeConn.user
                : 'petr';
          const promptHost =
            activeConn?.mode === 'ssh' ? activeConn.host : mon.host_name;
          const promptLabel = `${promptUser}@${promptHost}`;

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

              {/* RIGHT PANEL (8 COLS): FULL-HEIGHT LIVE XTERM.JS PTY TERMINAL */}
              <section className="lg:col-span-8 lg:h-full apple-card p-5 flex flex-col gap-3.5 min-h-[420px]">
                <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/[0.07]">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        ptyStatusText === 'connected'
                          ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.75)]'
                          : ptyStatusText === 'connecting'
                            ? 'bg-amber-400 animate-pulse'
                            : 'bg-rose-400'
                      }`}
                    />
                    <span className="text-sm font-semibold text-white truncate">
                      {activeConn?.name || 'Shell'}
                    </span>
                    <span className="text-[11px] font-mono text-zinc-400 truncate">
                      ({promptLabel})
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wider shrink-0 ${
                        ptyConnected
                          ? 'bg-emerald-500/15 border-emerald-400/35 text-emerald-300'
                          : ptyStatusText === 'connecting'
                            ? 'bg-amber-500/15 border-amber-400/35 text-amber-300'
                            : 'bg-rose-500/15 border-rose-400/35 text-rose-300'
                      }`}
                    >
                      {ptyConnected
                        ? 'LIVE PTY'
                        : ptyStatusText === 'connecting'
                          ? 'Připojování...'
                          : 'Odpojeno'}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={!ptyConnected}
                      onClick={() => runSshCommand('sudo su')}
                      className="px-3 py-1.5 rounded-full bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/35 text-xs font-medium text-cyan-200 transition-colors disabled:opacity-40"
                      title="Přepnout na root shell (sudo su)"
                    >
                      sudo su
                    </button>
                    <button
                      type="button"
                      disabled={!ptyConnected}
                      onClick={() => sendPtyInput('\x03')}
                      className="px-3 py-1.5 rounded-full bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/35 text-xs font-mono font-medium text-rose-200 transition-colors disabled:opacity-40"
                      title="Poslat SIGINT (Ctrl+C)"
                    >
                      Ctrl+C
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        xtermRef.current?.clear();
                        sendPtyInput('clear\r');
                      }}
                      className="px-3 py-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-xs font-medium text-zinc-200 transition-colors"
                    >
                      Vyčistit
                    </button>
                    <button
                      type="button"
                      onClick={() => setPtyReconnectSeq((s) => s + 1)}
                      className="px-3 py-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-xs font-medium text-zinc-200 flex items-center gap-1.5 transition-colors"
                      title="Restartovat PTY relaci"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                      Restart shellu
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

                <div
                  className="apple-well flex-1 min-h-[340px] p-3 overflow-hidden relative bg-[#0a0a0d] cursor-text"
                  onClick={() => xtermRef.current?.focus()}
                >
                  <div ref={ptyContainerRef} className="w-full h-full" />
                </div>
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

        {/* ================================================================ */}
        {/* TAB 5: PROFILES & SERVICE VISIBILITY / IMAGES                    */}
        {/* ================================================================ */}
        {activeTab === 'profiles' && selectedProfile && (() => {
          const previewProfile = {
            ...selectedProfile,
            name: profDraftName.trim() || selectedProfile.name,
            avatar_color: profDraftColor || selectedProfile.avatar_color,
          };
          const previewAccent = getProfileAccentColor(previewProfile);
          const previewTheme = getProfileAvatarTheme(previewProfile);
          const effectiveVis = getEffectiveVisibleIds(selectedProfile);

          return (
            <main className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1 min-h-0 items-stretch">
              {/* LEFT COLUMN (4 COLS): FIXED PROFILE SELECTOR + STANDARD SIZE AVATAR */}
              <section className="lg:col-span-4 lg:h-full apple-card p-6 flex flex-col justify-between gap-4 relative overflow-hidden">
                <div className="relative z-10 flex items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.06] border border-white/[0.08] text-xs text-zinc-200">
                    <Users className="w-3.5 h-3.5" style={{ color: previewAccent.hex }} />
                    <span className="font-medium">Správa profilů</span>
                  </div>
                  <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-white/[0.05] text-zinc-300 border border-white/[0.08]">
                    {manageableProfiles.length} profilů
                  </span>
                </div>

                {/* Dual Avatar Stage: Main Red Sudo Avatar + Clicked Profile Companion Orb */}
                <div className="relative z-10 flex flex-col items-center justify-center my-auto py-2 text-center gap-3">
                  <div className="relative flex items-center justify-center">
                    {/* Main Sudo Red Ambient Glow */}
                    <div
                      aria-hidden="true"
                      className={`pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 ${AVATAR_CONFIG.dashboardOrb.glowClass} rounded-full blur-3xl opacity-75 ${getProfileAvatarTheme(profile).glow}`}
                      style={getProfileAvatarTheme(profile).glowStyle}
                    />

                    {/* Main Red Sudo Avatar (standard dashboardOrb size) */}
                    <div className="relative z-20 -translate-x-3">
                      <AvatarOrb
                        profile={profile}
                        interactive
                        sizeClass={AVATAR_CONFIG.dashboardOrb.sizeClass}
                      />
                    </div>

                    {/* Selected / Clicked Profile Companion Orb (proportionally scaled) */}
                    <div
                      key={previewProfile.id}
                      className="absolute -bottom-1 -right-6 z-30 w-[84px] h-[84px] rounded-full ring-4 ring-[#121216] bg-[#121216] flex items-center justify-center shadow-[0_14px_30px_rgba(0,0,0,0.8)] transition-all duration-300"
                    >
                      <div
                        aria-hidden="true"
                        className={`pointer-events-none absolute inset-0 rounded-full blur-xl opacity-65 ${previewTheme.glow}`}
                        style={previewTheme.glowStyle}
                      />
                      <div className="scale-[0.58] origin-center">
                        <AvatarOrb profile={previewProfile} interactive />
                      </div>
                    </div>
                  </div>

                  <div className="relative z-20 pt-1">
                    <div className="text-lg font-semibold tracking-tight text-white flex items-center justify-center gap-2">
                      <span>{previewProfile.name}</span>
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{
                          backgroundColor: previewAccent.hex,
                          boxShadow: `0 0 10px ${previewAccent.hex}`,
                        }}
                      />
                    </div>
                    <div className="text-[11px] text-zinc-400 flex items-center justify-center gap-1.5 mt-0.5">
                      <span>{selectedProfile.role}</span>
                      <span>·</span>
                      <span className="font-mono" style={{ color: previewAccent.hex }}>
                        {effectiveVis.size}/{data.services.length} služeb
                      </span>
                    </div>
                  </div>
                </div>

                {/* Compact Profile Selector List */}
                <div className="relative z-10 flex flex-col max-h-[240px] min-h-0">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                    Vybrat profil
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-1.5">
                    {manageableProfiles.map((p) => {
                      const active = p.id === selectedProfile.id;
                      const pVisCount = getEffectiveVisibleIds(p).size;
                      const pAccent = getProfileAccentColor(p);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setSelectedProfileId(p.id)}
                          className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-2xl border text-left transition-all ${
                            active
                              ? 'bg-white/[0.09] border-white/[0.2]'
                              : 'bg-white/[0.02] hover:bg-white/[0.06] border-white/[0.06]'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <AvatarBadge
                              profile={p}
                              className="!w-7 !h-7 !rounded-lg !text-[11px] shrink-0"
                            />
                            <div className="min-w-0">
                              <span className="text-xs font-semibold text-white truncate block">
                                {p.name}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] font-mono text-zinc-400">
                              {pVisCount}/{data.services.length}
                            </span>
                            <span
                              className="w-2.5 h-2.5 rounded-full border border-white/20"
                              style={{ backgroundColor: pAccent.hex }}
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>

              {/* RIGHT COLUMN (8 COLS): SCROLLABLE EDITOR (PROFILE + ASSIGNMENTS + ADD SERVICE) */}
              <div className="lg:col-span-8 lg:h-full lg:overflow-y-auto lg:pt-1 lg:-mt-1 lg:pb-2 lg:pr-1 flex flex-col gap-4 min-h-0">
                {/* 1. Profile Name & Avatar Color / Accent Card */}
                <section className="apple-card p-5 space-y-4 shrink-0">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold tracking-tight text-white">
                        Vzhled & zabezpečení profilu · {selectedProfile.name}
                      </h2>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        Uprav jméno, barvu avatara / akcentu a volitelný PIN kód
                      </p>
                    </div>
                    <span
                      className={`text-[11px] font-medium px-2.5 py-1 rounded-full border shrink-0 flex items-center gap-1.5 ${
                        selectedProfile.has_pin
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30'
                          : 'bg-white/[0.04] text-zinc-400 border-white/[0.08]'
                      }`}
                    >
                      <Lock className="w-3 h-3" />
                      {selectedProfile.has_pin ? 'Chráněno PINem' : 'Bez PINu'}
                    </span>
                  </div>

                  <form onSubmit={handleSaveProfileSettings} className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                      <div className="sm:col-span-5">
                        <label className="text-[11px] font-medium text-zinc-400 block mb-1.5">
                          Jméno profilu
                        </label>
                        <input
                          type="text"
                          value={profDraftName}
                          onChange={(e) => setProfDraftName(e.target.value)}
                          placeholder="Jméno profilu"
                          className="apple-well w-full px-3.5 py-2.5 text-xs text-white placeholder:text-zinc-500 outline-none focus:border-white/25"
                        />
                      </div>

                      <div className="sm:col-span-7">
                        <label className="text-[11px] font-medium text-zinc-400 flex items-center gap-1.5 mb-1.5">
                          <Palette className="w-3.5 h-3.5" />
                          Barva avatara / accent
                        </label>
                        <div className="apple-well px-3 py-2 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            {AVATAR_COLOR_OPTIONS.map((opt) => {
                              const swatchAccent = getProfileAccentColor({
                                id: selectedProfile.id,
                                name: selectedProfile.name,
                                avatar_color: opt.id,
                              });
                              const selected = profDraftColor === opt.id;
                              return (
                                <button
                                  key={opt.id}
                                  type="button"
                                  title={opt.label}
                                  onClick={() => handleQuickColorSelect(opt.id)}
                                  className={`w-6 h-6 rounded-full transition-transform ${
                                    selected
                                      ? 'scale-110 ring-2 ring-white ring-offset-2 ring-offset-[#0f0f12]'
                                      : 'hover:scale-105 opacity-80 hover:opacity-100'
                                  }`}
                                  style={{ backgroundColor: swatchAccent.hex }}
                                />
                              );
                            })}
                          </div>
                          <label
                            title="Vlastní barva (HEX)"
                            className="relative flex items-center gap-1.5 pl-2 border-l border-white/[0.08] cursor-pointer shrink-0"
                          >
                            <input
                              type="color"
                              value={previewAccent.hex}
                              onChange={(e) => setProfDraftColor(e.target.value)}
                              className="w-6 h-6 rounded-full bg-transparent border-0 cursor-pointer p-0"
                            />
                            <span className="text-[10px] font-mono text-zinc-400 hidden xl:inline">
                              {previewAccent.hex}
                            </span>
                          </label>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                      <div className="sm:col-span-7">
                        <label className="text-[11px] font-medium text-zinc-400 flex items-center gap-1.5 mb-1.5">
                          <Lock className="w-3.5 h-3.5" />
                          Volitelný PIN kód (čísla, max 8)
                        </label>
                        <input
                          type="password"
                          inputMode="numeric"
                          maxLength={8}
                          value={profDraftPin}
                          onChange={(e) =>
                            setProfDraftPin(e.target.value.replace(/\D/g, '').slice(0, 8))
                          }
                          placeholder={
                            selectedProfile.has_pin
                              ? 'Zadej nový PIN pro změnu…'
                              : 'Nastavit PIN (nepovinné)…'
                          }
                          className="apple-well w-full px-3.5 py-2.5 text-xs font-mono tracking-widest text-white placeholder:text-zinc-500 placeholder:tracking-normal placeholder:font-sans outline-none focus:border-white/25"
                        />
                      </div>

                      <div className="sm:col-span-5 flex items-center gap-2">
                        {selectedProfile.has_pin && (
                          <button
                            type="button"
                            onClick={handleRemoveProfilePin}
                            disabled={busyId === `prof-pin-clear-${selectedProfile.id}`}
                            className="py-2.5 px-3 rounded-xl bg-white/[0.06] hover:bg-rose-500/15 border border-white/[0.08] hover:border-rose-400/30 text-xs font-medium text-zinc-300 hover:text-rose-300 transition-colors shrink-0"
                          >
                            Odebrat PIN
                          </button>
                        )}
                        <button
                          type="submit"
                          disabled={
                            !profDraftName.trim() ||
                            busyId === `prof-save-${selectedProfile.id}`
                          }
                          className="flex-1 py-2.5 px-4 rounded-xl bg-white hover:bg-zinc-200 text-zinc-950 text-xs font-semibold disabled:opacity-40 transition-colors"
                        >
                          Uložit
                        </button>
                      </div>
                    </div>
                  </form>
                </section>

                {/* 2. Per-Profile Visible Services & Service Images */}
                <section className="apple-card p-5 space-y-4 shrink-0">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold tracking-tight text-white">
                        Služby v nabídce profilu · {selectedProfile.name}
                      </h2>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        Vyber, které služby profil uvidí, uprav URL/kontejner nebo nahraj obrázek místo terminálového náhledu
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleSetAllProfileServices(selectedProfile, true)}
                        className="px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-[11px] font-medium text-zinc-200 transition-colors"
                      >
                        Vybrat vše
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSetAllProfileServices(selectedProfile, false)}
                        className="px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.08] text-[11px] font-medium text-zinc-400 hover:text-white transition-colors"
                      >
                        Skrýt vše
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {data.services.map((svc) => {
                      const isVisible = effectiveVis.has(svc.id);
                      const cleanUrl = svc.url.replace(/^https?:\/\//, '');
                      return (
                        <div
                          key={svc.id}
                          className={`rounded-2xl border p-3.5 flex flex-col justify-between gap-3 transition-all ${
                            isVisible
                              ? 'bg-white/[0.04] border-white/[0.14]'
                              : 'bg-white/[0.015] border-white/[0.06] opacity-65'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            {/* Thumbnail Preview + Name/URL/Container */}
                            <div className="flex items-start gap-3 min-w-0 flex-1">
                              <div className="w-14 h-12 rounded-xl border border-white/[0.1] bg-[#09090c] overflow-hidden shrink-0 flex items-center justify-center">
                                {svc.image_url ? (
                                  <img
                                    src={svc.image_url}
                                    alt={svc.name}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <ImageIcon className="w-4 h-4 text-zinc-500" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-semibold text-white truncate">
                                    {svc.name}
                                  </span>
                                  <span
                                    className={`text-[9px] font-mono px-1.5 py-0.5 rounded-full border shrink-0 ${
                                      svc.is_docker !== false || svc.container_name
                                        ? 'bg-cyan-500/10 text-cyan-300 border-cyan-400/25'
                                        : 'bg-white/[0.06] text-zinc-400 border-white/[0.08]'
                                    }`}
                                  >
                                    {svc.is_docker !== false
                                      ? 'Docker'
                                      : svc.container_name
                                        ? svc.container_name
                                        : 'Odkaz'}
                                  </span>
                                </div>
                                <div className="text-[11px] text-zinc-400 truncate">
                                  {svc.subtitle}
                                </div>
                                <div className="text-[10px] font-mono text-zinc-500 truncate mt-0.5">
                                  {cleanUrl}
                                </div>
                              </div>
                            </div>

                            {/* Visibility Toggle */}
                            <button
                              type="button"
                              onClick={() => handleToggleProfileService(selectedProfile, svc.id)}
                              disabled={busyId === `vis-${selectedProfile.id}-${svc.id}`}
                              className={`px-2.5 py-1 rounded-full text-[11px] font-medium flex items-center gap-1 border shrink-0 transition-all ${
                                isVisible
                                  ? 'bg-white text-zinc-950 border-white'
                                  : 'bg-white/[0.04] text-zinc-400 border-white/[0.08] hover:text-white'
                              }`}
                            >
                              {isVisible && <Check className="w-3 h-3" />}
                              <span>{isVisible ? 'Viditelné' : 'Skryté'}</span>
                            </button>
                          </div>

                          <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.06]">
                            <label className="cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.11] border border-white/[0.08] text-[11px] font-medium text-zinc-300 hover:text-white transition-colors">
                              <Upload className="w-3 h-3" />
                              <span>
                                {busyId === `img-${svc.id}`
                                  ? 'Nahrávám…'
                                  : svc.image_url
                                    ? 'Změnit obrázek'
                                    : 'Nahrát obrázek'}
                              </span>
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const f = e.target.files?.[0] ?? null;
                                  void handleUploadServiceImage(svc.id, f);
                                  e.target.value = '';
                                }}
                              />
                            </label>

                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  setEditingService({
                                    id: svc.id,
                                    name: svc.name,
                                    url: svc.url,
                                    subtitle: svc.subtitle,
                                    icon: svc.icon || 'container',
                                    image_url: svc.image_url || '',
                                  })
                                }
                                title="Upravit název, URL / kontejner nebo obrázek"
                                className="p-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.12] border border-white/[0.08] text-zinc-300 hover:text-white transition-colors"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteService(svc.id)}
                                disabled={busyId === `del-svc-${svc.id}`}
                                title="Odstranit službu"
                                className="p-1.5 rounded-xl bg-white/[0.04] hover:bg-rose-500/15 border border-white/[0.08] hover:border-rose-400/30 text-zinc-400 hover:text-rose-300 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* 3. Add New Service (Uncramped, Icon Picker + Image Upload) */}
                <section className="apple-card p-6 space-y-5 shrink-0">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold tracking-tight text-white">
                        Přidat novou službu
                      </h2>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        Webový odkaz (mimo Docker) nebo karta přiřazená ke stávajícímu kontejneru
                      </p>
                    </div>

                    <div className="inline-flex p-1 rounded-xl bg-white/[0.04] border border-white/[0.08] gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setNewSvcMode('link');
                          setNewSvcIcon('globe');
                        }}
                        className={`px-3.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                          newSvcMode === 'link'
                            ? 'bg-white text-zinc-950 font-semibold'
                            : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        Webový odkaz
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setNewSvcMode('container');
                          setNewSvcIcon('container');
                        }}
                        className={`px-3.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                          newSvcMode === 'container'
                            ? 'bg-white text-zinc-950 font-semibold'
                            : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        Přiřadit kontejner
                      </button>
                    </div>
                  </div>

                  <form onSubmit={handleCreateService} className="space-y-4">
                    {/* Row 1: Name & URL */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-[11px] font-medium text-zinc-400 block mb-1.5">
                          Název
                        </label>
                        <input
                          type="text"
                          value={newSvcName}
                          onChange={(e) => setNewSvcName(e.target.value)}
                          placeholder={
                            newSvcMode === 'link' ? 'např. Proxmox VE' : 'např. Portainer Web'
                          }
                          className="apple-well w-full px-3.5 py-2.5 text-xs text-white placeholder:text-zinc-500 outline-none focus:border-white/25"
                        />
                      </div>

                      <div>
                        <label className="text-[11px] font-medium text-zinc-400 block mb-1.5">
                          URL adresa
                        </label>
                        <input
                          type="text"
                          value={newSvcUrl}
                          onChange={(e) => setNewSvcUrl(e.target.value)}
                          placeholder="https://proxmox.vykylab.local"
                          className="apple-well w-full px-3.5 py-2.5 text-xs font-mono text-white placeholder:text-zinc-500 outline-none focus:border-white/25"
                        />
                      </div>
                    </div>

                    {/* Row 2: Container/Subtitle & Image Upload */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {newSvcMode === 'container' ? (
                        <div>
                          <label className="text-[11px] font-medium text-zinc-400 block mb-1.5">
                            Kontejner z Dockeru
                          </label>
                          <select
                            value={newSvcContainerId}
                            onChange={(e) => setNewSvcContainerId(e.target.value)}
                            className="apple-well w-full px-3.5 py-2.5 text-xs text-white bg-[#0f0f12] outline-none focus:border-white/25"
                          >
                            {dockerServices.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name} ({c.status})
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div>
                          <label className="text-[11px] font-medium text-zinc-400 block mb-1.5">
                            Popisek (volitelný)
                          </label>
                          <input
                            type="text"
                            value={newSvcSubtitle}
                            onChange={(e) => setNewSvcSubtitle(e.target.value)}
                            placeholder="např. Router & Admin"
                            className="apple-well w-full px-3.5 py-2.5 text-xs text-white placeholder:text-zinc-500 outline-none focus:border-white/25"
                          />
                        </div>
                      )}

                      <div>
                        <label className="text-[11px] font-medium text-zinc-400 block mb-1.5">
                          Obrázek služby (místo náhledu)
                        </label>
                        <div className="flex items-center gap-2">
                          <label
                            className={`flex-1 cursor-pointer apple-well px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs transition-colors ${
                              newSvcImageFile
                                ? 'border-emerald-400/40 text-emerald-300'
                                : 'text-zinc-400 hover:text-white hover:border-white/20'
                            }`}
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <Upload className="w-3.5 h-3.5 shrink-0" />
                              <span className="truncate">
                                {newSvcImageFile ? newSvcImageFile.name : 'Vybrat obrázek z PC…'}
                              </span>
                            </span>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => setNewSvcImageFile(e.target.files?.[0] ?? null)}
                            />
                          </label>
                          {newSvcImageFile && (
                            <button
                              type="button"
                              onClick={() => setNewSvcImageFile(null)}
                              title="Odebrat vybraný obrázek"
                              className="p-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-zinc-400 hover:text-white transition-colors shrink-0"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Row 3: Visual Icon Picker + Submit CTA */}
                    <div className="pt-1 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <label className="text-[11px] font-medium text-zinc-400 block">
                          Ikona služby
                        </label>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {SERVICE_ICON_OPTIONS.map((opt) => {
                            const active = newSvcIcon === opt.id;
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                title={opt.label}
                                onClick={() => setNewSvcIcon(opt.id)}
                                className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-all ${
                                  active
                                    ? 'bg-white text-zinc-950 border-white shadow-sm scale-105'
                                    : 'bg-white/[0.04] hover:bg-white/[0.1] border-white/[0.08] text-zinc-400 hover:text-white'
                                }`}
                              >
                                {opt.icon}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={
                          !newSvcName.trim() ||
                          !newSvcUrl.trim() ||
                          busyId === 'create-svc'
                        }
                        className="py-2.5 px-5 rounded-xl bg-white hover:bg-zinc-200 text-zinc-950 text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-40 transition-colors shrink-0"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Přidat službu</span>
                      </button>
                    </div>
                  </form>
                </section>
              </div>
            </main>
          );
        })()}

        {/* ================================================================ */}
        {/* TAB 6: FAMILY NOTICEBOARD (NÁSTĚNKA)                            */}
        {/* ================================================================ */}
        {activeTab === 'noticeboard' && (() => {
          const allNotes = data.noticeboard ?? [];
          const pinnedCount = allNotes.filter((n) => n.pinned).length;
          const visibleNotes =
            noteFilter === 'pinned' ? allNotes.filter((n) => n.pinned) : allNotes;

          return (
            <main className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1 min-h-0 items-stretch">
              {/* LEFT COLUMN (4 COLS): FIXED RED SUDO AVATAR + NOTICEBOARD CONTROLS */}
              <section className="lg:col-span-4 lg:h-full apple-card p-6 flex flex-col justify-between gap-4 relative overflow-hidden">
                <div className="relative z-10 flex items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.06] border border-white/[0.08] text-xs text-zinc-200">
                    <Pin className="w-3.5 h-3.5 text-rose-300" />
                    <span className="font-medium">Rodinná nástěnka</span>
                  </div>
                  <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-white/[0.05] text-zinc-300 border border-white/[0.08]">
                    {allNotes.length} vzkazů
                  </span>
                </div>

                {/* Main Red Sudo Avatar */}
                <div className="relative z-10 flex flex-col items-center justify-center my-auto py-2 text-center gap-3">
                  <div
                    aria-hidden="true"
                    className={`pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 ${AVATAR_CONFIG.dashboardOrb.glowClass} rounded-full blur-3xl opacity-75 ${getProfileAvatarTheme(profile).glow}`}
                    style={getProfileAvatarTheme(profile).glowStyle}
                  />
                  <div className="relative z-20">
                    <AvatarOrb
                      profile={profile}
                      interactive
                      sizeClass={AVATAR_CONFIG.dashboardOrb.sizeClass}
                    />
                  </div>
                  <div className="relative z-20 space-y-0.5">
                    <div className="text-sm font-semibold text-white">
                      Vzkazy pro všechny profily
                    </div>
                    <div className="text-[11px] text-zinc-400">
                      Připnuto nahoru: <span className="font-mono text-white">{pinnedCount}</span>
                    </div>
                  </div>
                </div>

                {/* Filter Controls */}
                <div className="relative z-10 grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-white/[0.04] border border-white/[0.07]">
                  {(
                    [
                      ['all', `Vše (${allNotes.length})`],
                      ['pinned', `Připnuté (${pinnedCount})`],
                    ] as ['all' | 'pinned', string][]
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setNoteFilter(key)}
                      className={`py-2 rounded-lg text-xs font-medium transition-colors ${
                        noteFilter === key
                          ? 'bg-white text-zinc-950 font-semibold'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </section>

              {/* RIGHT COLUMN (8 COLS): COMPOSE & MANAGE NOTICEBOARD */}
              <div className="lg:col-span-8 lg:h-full lg:overflow-y-auto lg:pt-1 lg:-mt-1 lg:pb-2 lg:pr-1 flex flex-col gap-4 min-h-0">
                {/* 1. Compose New Notice */}
                <section className="apple-card p-6 space-y-4 shrink-0">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold tracking-tight text-white">
                        Nový vzkaz na nástěnku
                      </h2>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        Zobrazí se v pop-up Nástěnce na všech uživatelských profilech
                      </p>
                    </div>

                    <div className="inline-flex p-1 rounded-xl bg-white/[0.04] border border-white/[0.08] gap-1">
                      {(['Oznámení', 'Info', 'Údržba'] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setNoteTag(t)}
                          className={`px-3 py-1 rounded-lg text-[11px] font-medium transition-all ${
                            noteTag === t
                              ? 'bg-white text-zinc-950 font-semibold'
                              : 'text-zinc-400 hover:text-white'
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  <form onSubmit={handleCreateNote} className="space-y-3">
                    <div>
                      <label className="text-[11px] font-medium text-zinc-400 block mb-1.5">
                        Nadpis
                      </label>
                      <input
                        type="text"
                        value={noteTitle}
                        onChange={(e) => setNoteTitle(e.target.value)}
                        placeholder="např. Večerní restart serveru"
                        className="apple-well w-full px-3.5 py-2.5 text-xs text-white placeholder:text-zinc-500 outline-none focus:border-white/25"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-medium text-zinc-400 block mb-1.5">
                        Text vzkazu
                      </label>
                      <textarea
                        rows={3}
                        value={noteMessage}
                        onChange={(e) => setNoteMessage(e.target.value)}
                        placeholder="Napiš krátkou zprávu pro rodinu nebo poznámku k homelabu…"
                        className="apple-well w-full px-3.5 py-2.5 text-xs text-white placeholder:text-zinc-500 outline-none focus:border-white/25 resize-none"
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                      <button
                        type="button"
                        onClick={() => setNotePinned((p) => !p)}
                        className={`px-3.5 py-2 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition-colors ${
                          notePinned
                            ? 'bg-white/[0.12] border-white/25 text-white'
                            : 'bg-white/[0.04] border-white/[0.08] text-zinc-400 hover:text-white'
                        }`}
                      >
                        <Pin className="w-3.5 h-3.5" />
                        <span>{notePinned ? 'Připnuto nahoru' : 'Připnout nahoru'}</span>
                      </button>

                      <button
                        type="submit"
                        disabled={
                          !noteTitle.trim() ||
                          !noteMessage.trim() ||
                          busyId === 'note-create'
                        }
                        className="py-2.5 px-5 rounded-xl bg-white hover:bg-zinc-200 text-zinc-950 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40 transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Přidat vzkaz</span>
                      </button>
                    </div>
                  </form>
                </section>

                {/* 2. Existing Notices List */}
                <section className="space-y-3">
                  {visibleNotes.length === 0 ? (
                    <div className="apple-card p-8 text-center text-xs text-zinc-500">
                      Žádné vzkazy k zobrazení.
                    </div>
                  ) : (
                    visibleNotes.map((note) => (
                      <div
                        key={note.id}
                        className={`apple-card p-5 space-y-2.5 transition-colors ${
                          note.pinned ? 'border-white/[0.18]' : ''
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              {note.pinned && (
                                <Pin className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                              )}
                              <h3 className="text-sm font-semibold text-white">
                                {note.title}
                              </h3>
                              <span
                                className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                                  note.tag === 'Údržba'
                                    ? 'bg-amber-500/15 text-amber-300 border-amber-400/30'
                                    : note.tag === 'Info'
                                      ? 'bg-cyan-500/10 text-cyan-300 border-cyan-400/25'
                                      : 'bg-white/[0.06] text-zinc-300 border-white/[0.1]'
                                }`}
                              >
                                {note.tag}
                              </span>
                            </div>
                            <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap">
                              {note.message}
                            </p>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleToggleNotePin(note)}
                              disabled={busyId === `note-pin-${note.id}`}
                              title={note.pinned ? 'Odepnout' : 'Připnout nahoru'}
                              className={`p-2 rounded-xl border transition-colors ${
                                note.pinned
                                  ? 'bg-white text-zinc-950 border-white'
                                  : 'bg-white/[0.04] hover:bg-white/[0.1] border-white/[0.08] text-zinc-400 hover:text-white'
                              }`}
                            >
                              <Pin className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingNote(note)}
                              title="Upravit vzkaz"
                              className="p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.08] text-zinc-300 hover:text-white transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteNote(note.id)}
                              disabled={busyId === `note-del-${note.id}`}
                              title="Smazat vzkaz"
                              className="p-2 rounded-xl bg-white/[0.04] hover:bg-rose-500/15 border border-white/[0.08] hover:border-rose-400/30 text-zinc-400 hover:text-rose-300 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-zinc-500 pt-1 border-t border-white/[0.06]">
                          <span>Autor: {note.author}</span>
                          <span className="font-mono">{note.timestamp}</span>
                        </div>
                      </div>
                    ))
                  )}
                </section>
              </div>
            </main>
          );
        })()}
      </div>

      {/* Edit Noticeboard Item Modal */}
      {editingNote && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveEditedNote}
            className="apple-card w-full max-w-md p-6 space-y-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-white">Upravit vzkaz</h2>
              <button
                type="button"
                onClick={() => setEditingNote(null)}
                className="p-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="inline-flex p-1 rounded-xl bg-white/[0.04] border border-white/[0.08] gap-1">
                {(['Oznámení', 'Info', 'Údržba'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setEditingNote({ ...editingNote, tag: t })}
                    className={`px-3 py-1 rounded-lg text-[11px] font-medium transition-all ${
                      editingNote.tag === t
                        ? 'bg-white text-zinc-950 font-semibold'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <div>
                <label className="text-xs text-zinc-400 block mb-1">Nadpis</label>
                <input
                  type="text"
                  value={editingNote.title}
                  onChange={(e) =>
                    setEditingNote({ ...editingNote, title: e.target.value })
                  }
                  className="apple-well w-full px-3.5 py-2.5 text-sm text-white outline-none focus:border-white/25"
                />
              </div>

              <div>
                <label className="text-xs text-zinc-400 block mb-1">Text vzkazu</label>
                <textarea
                  rows={4}
                  value={editingNote.message}
                  onChange={(e) =>
                    setEditingNote({ ...editingNote, message: e.target.value })
                  }
                  className="apple-well w-full px-3.5 py-2.5 text-xs text-white outline-none focus:border-white/25 resize-none"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingNote(null)}
                className="flex-1 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-xs font-medium text-zinc-300"
              >
                Zrušit
              </button>
              <button
                type="submit"
                disabled={
                  !editingNote.title.trim() ||
                  !editingNote.message.trim() ||
                  busyId === `note-edit-${editingNote.id}`
                }
                className="flex-1 py-2.5 rounded-xl bg-white hover:bg-zinc-200 text-zinc-950 text-xs font-semibold disabled:opacity-40"
              >
                Uložit
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Service Modal (Název, URL / Kontejner, Obrázek) */}
      {editingService && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveEditedService}
            className="apple-card w-full max-w-md p-6 space-y-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-white">
                Upravit službu
              </h2>
              <button
                type="button"
                onClick={() => setEditingService(null)}
                className="p-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Název</label>
                <input
                  type="text"
                  value={editingService.name}
                  onChange={(e) =>
                    setEditingService({ ...editingService, name: e.target.value })
                  }
                  className="apple-well w-full px-3.5 py-2.5 text-sm text-white outline-none focus:border-white/25"
                />
              </div>

              <div>
                <label className="text-xs text-zinc-400 block mb-1">URL adresa</label>
                <input
                  type="text"
                  value={editingService.url}
                  onChange={(e) =>
                    setEditingService({ ...editingService, url: e.target.value })
                  }
                  className="apple-well w-full px-3.5 py-2.5 text-xs font-mono text-white outline-none focus:border-white/25"
                />
              </div>

              <div>
                <label className="text-xs text-zinc-400 block mb-1">
                  Kontejner / popisek
                </label>
                <input
                  type="text"
                  value={editingService.subtitle}
                  onChange={(e) =>
                    setEditingService({ ...editingService, subtitle: e.target.value })
                  }
                  className="apple-well w-full px-3.5 py-2.5 text-sm text-white outline-none focus:border-white/25"
                />
              </div>

              <div>
                <label className="text-xs text-zinc-400 block mb-1.5">Ikona služby</label>
                <div className="flex flex-wrap items-center gap-1.5">
                  {SERVICE_ICON_OPTIONS.map((opt) => {
                    const active = editingService.icon === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        title={opt.label}
                        onClick={() =>
                          setEditingService({ ...editingService, icon: opt.id })
                        }
                        className={`w-8 h-8 rounded-xl border flex items-center justify-center transition-all ${
                          active
                            ? 'bg-white text-zinc-950 border-white shadow-sm'
                            : 'bg-white/[0.04] hover:bg-white/[0.1] border-white/[0.08] text-zinc-400 hover:text-white'
                        }`}
                      >
                        {opt.icon}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="text-xs text-zinc-400 block mb-1">
                  URL obrázku (nebo nahraj přímo na kartě)
                </label>
                <input
                  type="text"
                  value={editingService.image_url}
                  onChange={(e) =>
                    setEditingService({ ...editingService, image_url: e.target.value })
                  }
                  placeholder="/api/service-images/... nebo https://..."
                  className="apple-well w-full px-3.5 py-2.5 text-xs font-mono text-white placeholder:text-zinc-500 outline-none focus:border-white/25"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingService(null)}
                className="flex-1 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-xs font-medium text-zinc-300"
              >
                Zrušit
              </button>
              <button
                type="submit"
                disabled={
                  !editingService.name.trim() ||
                  !editingService.url.trim() ||
                  busyId === `edit-svc-${editingService.id}`
                }
                className="flex-1 py-2.5 rounded-xl bg-white hover:bg-zinc-200 text-zinc-950 text-xs font-semibold disabled:opacity-40"
              >
                Uložit změny
              </button>
            </div>
          </form>
        </div>
      )}

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

      {/* ================================================================== */}
      {/* MODAL: GITHUB UPDATE RESULT                                        */}
      {/* ================================================================== */}
      {githubUpdateModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
          <div className="apple-card w-full max-w-2xl p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                    githubUpdateModal.ok
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30'
                      : 'bg-rose-500/20 text-rose-300 border border-rose-400/30'
                  }`}
                >
                  {githubUpdateModal.ok ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <X className="w-4 h-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-white truncate">
                    Aktualizace z GitHubu
                  </h2>
                  <p className="text-xs text-zinc-400 truncate">
                    {githubUpdateModal.message}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {githubUpdateModal.old_commit && githubUpdateModal.new_commit && (
                  <span className="px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/[0.1] text-[11px] font-mono text-cyan-300">
                    {githubUpdateModal.old_commit} → {githubUpdateModal.new_commit}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setGithubUpdateModal(null)}
                  className="p-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <pre className="apple-well p-4 text-[11px] font-mono text-zinc-200 whitespace-pre-wrap break-words max-h-80 overflow-y-auto">
              {githubUpdateModal.output || 'Hotovo.'}
            </pre>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setGithubUpdateModal(null)}
                className="px-4 py-2 rounded-xl bg-white hover:bg-zinc-200 text-zinc-950 font-semibold text-xs transition-colors"
              >
                Zavřít
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
