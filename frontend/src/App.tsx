import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Check,
  Container,
  Cpu,
  ExternalLink,
  FileUp,
  HardDrive,
  Heart,
  Image as ImageIcon,
  Layers,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shield,
  Table2,
  Terminal,
  Trash2,
  Upload,
  User,
  UserPlus,
  Users,
  X,
  Zap,
} from 'lucide-react';
import type {
  DashboardResponse,
  ShortcutKind,
  UserProfile,
  UserShortcut,
} from './types';

function renderShortcutIcon(icon: string, className = 'w-4 h-4') {
  switch (icon) {
    case 'dashboard':
      return <Layers className={className} />;
    case 'table':
      return <Table2 className={className} />;
    case 'shield':
      return <Shield className={className} />;
    case 'user':
      return <User className={className} />;
    case 'settings':
      return <Settings className={className} />;
    case 'terminal':
    default:
      return <Terminal className={className} />;
  }
}

function renderServiceIcon(icon: string, className = 'w-5 h-5') {
  switch (icon) {
    case 'shield':
      return <Shield className={className} />;
    case 'image':
      return <ImageIcon className={className} />;
    case 'container':
    default:
      return <Container className={className} />;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function App() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeShortcutId, setActiveShortcutId] = useState<string>('sc-containers');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  // First-time / switchable Profile Hub ("Rozcestník")
  const [showProfileHub, setShowProfileHub] = useState<boolean>(() => {
    return !window.localStorage.getItem('vykylab_profile_selected');
  });
  const [hubCreating, setHubCreating] = useState(false);

  // PIN unlock prompt for protected profiles (e.g. sudo)
  const [pinTargetProfile, setPinTargetProfile] = useState<UserProfile | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinReturnToDash, setPinReturnToDash] = useState(false);

  // Modals
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [shortcutModalOpen, setShortcutModalOpen] = useState(false);
  const [eventsModalOpen, setEventsModalOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [scriptOutputModal, setScriptOutputModal] = useState<{
    title: string;
    output: string;
    ok: boolean;
  } | null>(null);

  // Profile form state
  const [editName, setEditName] = useState('');
  const [editWorkspace, setEditWorkspace] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileRole, setNewProfileRole] = useState('Člen rodiny');

  // Shortcut form state
  const [scLabel, setScLabel] = useState('');
  const [scCategory, setScCategory] = useState<'service' | 'account'>('service');
  const [scKind, setScKind] = useState<ShortcutKind>('script');
  const [scTarget, setScTarget] = useState('');

  // Upload state
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const showToast = useCallback((ok: boolean, text: string) => {
    setToast({ ok, text });
    window.setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 3600);
  }, []);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard');
      if (!res.ok) throw new Error('HTTP error');
      const json: DashboardResponse = await res.json();
      setData(json);
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
    const timer = window.setInterval(fetchDashboard, 6000);
    return () => window.clearInterval(timer);
  }, [fetchDashboard]);

  useEffect(() => {
    if (data?.active_profile) {
      setEditName(data.active_profile.name);
      setEditWorkspace(data.active_profile.workspace_label);
      setEditRole(data.active_profile.role);
      setEditLocation(data.active_profile.location);
    }
  }, [data?.active_profile?.id]);

  const handleShortcutClick = async (sc: UserShortcut) => {
    setActiveShortcutId(sc.id);
    if (sc.kind === 'link') {
      window.open(sc.target, '_blank', 'noopener,noreferrer');
      showToast(true, `Otevřeno: ${sc.label}`);
      return;
    }

    setBusyId(sc.id);
    try {
      const res = await fetch(`/api/scripts/${encodeURIComponent(sc.id)}/run`, {
        method: 'POST',
      });
      const json = await res.json();
      if (json.dashboard) setData(json.dashboard);
      setScriptOutputModal({
        title: sc.label,
        output: json.output || 'Hotovo.',
        ok: Boolean(json.ok),
      });
    } catch {
      showToast(false, `Nepodařilo se spustit ${sc.label}.`);
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleFavorite = async (serviceId: string) => {
    if (!data) return;
    setBusyId(`fav-${serviceId}`);
    try {
      const res = await fetch(
        `/api/profiles/${encodeURIComponent(data.active_profile.id)}/favorites/${encodeURIComponent(serviceId)}`,
        { method: 'POST' }
      );
      const json = await res.json();
      if (json.dashboard) setData(json.dashboard);
    } finally {
      setBusyId(null);
    }
  };

  const handleSystemCheck = async () => {
    setBusyId('sys-check');
    try {
      const res = await fetch('/api/events/check', { method: 'POST' });
      const json = await res.json();
      if (json.dashboard) setData(json.dashboard);
      showToast(true, 'Kontrola systému dokončena.');
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data) return;
    setBusyId('save-prof');
    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(data.active_profile.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName,
          workspace_label: editWorkspace,
          role: editRole,
          location: editLocation,
        }),
      });
      const json = await res.json();
      if (json.dashboard) setData(json.dashboard);
      showToast(true, 'Profil uložen.');
      setProfileModalOpen(false);
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProfileName.trim()) return;
    setBusyId('create-prof');
    try {
      const res = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newProfileName.trim(),
          workspace_label: data?.active_profile.workspace_label || 'Vykylab',
          role: newProfileRole.trim() || 'Uživatel',
          location: data?.active_profile.location || 'Praha',
        }),
      });
      const json = await res.json();
      if (json.dashboard) {
        setData(json.dashboard);
        window.localStorage.setItem('vykylab_profile_selected', json.dashboard.active_profile.id);
      }
      setNewProfileName('');
      setHubCreating(false);
      setShowProfileHub(false);
      showToast(true, 'Nový profil vytvořen a aktivován.');
    } finally {
      setBusyId(null);
    }
  };

  const handleActivateProfile = async (
    id: string,
    pin?: string,
    enterDashboard = false
  ): Promise<boolean> => {
    setBusyId(`act-${id}`);
    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(id)}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pin ?? null }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        return false;
      }
      if (json.dashboard) setData(json.dashboard);
      window.localStorage.setItem('vykylab_profile_selected', id);
      if (enterDashboard) {
        setShowProfileHub(false);
      }
      showToast(true, 'Profil vybrán.');
      return true;
    } finally {
      setBusyId(null);
    }
  };

  const handleSelectProfile = (target: UserProfile, enterDashboard = false) => {
    if (target.has_pin) {
      setPinTargetProfile(target);
      setPinInput('');
      setPinError(null);
      setPinReturnToDash(enterDashboard);
      return;
    }
    void handleActivateProfile(target.id, undefined, enterDashboard);
  };

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pinTargetProfile || !pinInput.trim()) return;
    const ok = await handleActivateProfile(pinTargetProfile.id, pinInput.trim(), pinReturnToDash);
    if (ok) {
      setPinTargetProfile(null);
      setPinInput('');
      setPinError(null);
    } else {
      setPinError('Nesprávný PIN kód.');
      setPinInput('');
    }
  };

  const handleAddShortcut = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data || !scLabel.trim() || !scTarget.trim()) return;
    setBusyId('add-sc');
    try {
      const res = await fetch(
        `/api/profiles/${encodeURIComponent(data.active_profile.id)}/shortcuts`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: scLabel.trim(),
            category: scCategory,
            kind: scKind,
            target: scTarget.trim(),
            icon: scKind === 'link' ? 'dashboard' : 'terminal',
          }),
        }
      );
      const json = await res.json();
      if (json.dashboard) setData(json.dashboard);
      setScLabel('');
      setScTarget('');
      setShortcutModalOpen(false);
      showToast(true, 'Zkratka uložena do profilu.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteShortcut = async (shortcutId: string) => {
    if (!data) return;
    const res = await fetch(
      `/api/profiles/${encodeURIComponent(data.active_profile.id)}/shortcuts/${encodeURIComponent(shortcutId)}`,
      { method: 'DELETE' }
    );
    const json = await res.json();
    if (json.dashboard) setData(json.dashboard);
  };

  const handleUploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const formData = new FormData();
      Array.from(files).forEach((f) => formData.append('file', f));
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      const json = await res.json();
      if (json.dashboard) setData(json.dashboard);
      showToast(true, `Nahráno (${files.length} souborů).`);
    } catch {
      showToast(false, 'Nahrávání selhalo.');
    } finally {
      setUploading(false);
    }
  };

  const filteredServices = useMemo(() => {
    if (!data) return [];
    const q = searchQuery.trim().toLowerCase();
    const list = data.services.filter(
      (s) =>
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.subtitle.toLowerCase().includes(q) ||
        s.preview_rows.some((r) => r.name.toLowerCase().includes(q))
    );
    const favs = new Set(data.active_profile.favorite_services);
    return [...list].sort((a, b) => Number(favs.has(b.id)) - Number(favs.has(a.id)));
  }, [data, searchQuery]);

  const filteredShortcuts = useMemo(() => {
    if (!data) return [];
    const q = searchQuery.trim().toLowerCase();
    return data.active_profile.shortcuts.filter(
      (sc) => !q || sc.label.toLowerCase().includes(q) || sc.target.toLowerCase().includes(q)
    );
  }, [data, searchQuery]);

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-[#09090b] text-white flex items-center justify-center p-6">
        <div className="apple-card px-6 py-4 flex items-center gap-3 text-sm text-zinc-300">
          <RefreshCw className="w-4 h-4 animate-spin text-white" />
          <span>Načítám Vykylab profil...</span>
        </div>
      </div>
    );
  }

  const profile = data.active_profile;
  const serviceShortcuts = filteredShortcuts.filter((s) => s.category !== 'account');
  const accountShortcuts = filteredShortcuts.filter((s) => s.category === 'account');

  const pinModal = pinTargetProfile && (
    <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <form
        onSubmit={handlePinSubmit}
        className="apple-card w-full max-w-xs p-6 space-y-4 text-center"
      >
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-300 to-cyan-500 text-zinc-950 flex items-center justify-center mx-auto shadow-[0_8px_24px_rgba(34,211,238,0.28)]">
          <Lock className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-white">
            Odemknout profil {pinTargetProfile.name}
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Zadej PIN kód pro přístup k admin profilu
          </p>
        </div>

        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={pinInput}
          onChange={(e) => {
            setPinInput(e.target.value);
            if (pinError) setPinError(null);
          }}
          placeholder="••••"
          className="apple-well w-full px-4 py-2.5 text-center font-mono text-lg tracking-[0.4em] text-white placeholder:text-zinc-600 outline-none focus:border-cyan-400/60"
        />

        {pinError && <p className="text-xs text-rose-400">{pinError}</p>}

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              setPinTargetProfile(null);
              setPinInput('');
              setPinError(null);
            }}
            className="flex-1 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-xs font-medium text-zinc-300 transition-colors"
          >
            Zrušit
          </button>
          <button
            type="submit"
            disabled={!pinInput.trim() || busyId === `act-${pinTargetProfile.id}`}
            className="flex-1 py-2.5 rounded-xl bg-white hover:bg-zinc-200 text-zinc-950 text-xs font-semibold disabled:opacity-40 transition-colors"
          >
            Odemknout
          </button>
        </div>
      </form>
    </div>
  );

  if (showProfileHub) {
    return (
      <div
        className="min-h-screen bg-[#09090b] text-white flex flex-col items-center justify-center p-6"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 65% 45% at 50% 0%, rgba(34,211,238,0.13), transparent)',
        }}
      >
        <div className="w-full max-w-3xl space-y-8">
          <div className="text-center space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.05] border border-white/[0.08] text-xs text-zinc-300">
              <span
                className={`w-2 h-2 rounded-full ${data.system_healthy ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
              />
              <span>
                {profile.workspace_label} · {data.monitoring.host_name}
              </span>
            </div>

            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white">
              Vyber si profil
            </h1>
            <p className="text-sm text-zinc-400 max-w-md mx-auto">
              Otevři svůj osobní dashboard se svými zkratkami a oblíbenými službami, nebo vytvoř nový profil.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.profiles.map((p) => {
              const isCurrent = p.id === profile.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelectProfile(p, true)}
                  disabled={busyId === `act-${p.id}`}
                  className="group apple-card p-5 text-left flex flex-col justify-between gap-5 hover:-translate-y-1 hover:bg-white/[0.04] transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-300 to-cyan-500 text-zinc-950 font-bold text-lg flex items-center justify-center shadow-[0_8px_24px_rgba(34,211,238,0.28)] group-hover:scale-105 transition-transform">
                      {p.avatar_initials}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {p.has_pin && <Lock className="w-3.5 h-3.5 text-zinc-400" />}
                      <ArrowRight className="w-4 h-4 text-zinc-500 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-semibold text-white truncate">
                        {p.name}
                      </span>
                      {p.is_admin && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-300 border border-amber-400/30">
                          Admin
                        </span>
                      )}
                      {isCurrent && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-400/15 text-cyan-300 border border-cyan-400/30">
                          Aktivní
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-zinc-400">
                      {p.role} · {p.location}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-white/[0.07] flex items-center justify-between text-[11px] text-zinc-400">
                    <span>{p.shortcuts.length} zkratek</span>
                    <span>{p.favorite_services.length} oblíbených</span>
                  </div>
                </button>
              );
            })}

            {!hubCreating ? (
              <button
                type="button"
                onClick={() => setHubCreating(true)}
                className="apple-card border-dashed border-white/[0.14] hover:border-white/[0.28] p-5 flex flex-col items-center justify-center gap-2.5 text-center min-h-[184px] hover:bg-white/[0.03] transition-all"
              >
                <div className="w-11 h-11 rounded-2xl bg-white/[0.07] border border-white/[0.1] flex items-center justify-center text-white">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">Nový profil</div>
                  <div className="text-xs text-zinc-400 mt-0.5">Přidat uživatele</div>
                </div>
              </button>
            ) : (
              <form
                onSubmit={handleCreateProfile}
                className="apple-card p-5 flex flex-col justify-between gap-3 min-h-[184px]"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-white">Nový profil</span>
                  <button
                    type="button"
                    onClick={() => setHubCreating(false)}
                    className="text-zinc-400 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-2">
                  <input
                    type="text"
                    autoFocus
                    value={newProfileName}
                    onChange={(e) => setNewProfileName(e.target.value)}
                    placeholder="Jméno (např. Máma)"
                    className="apple-well w-full px-3 py-2 text-xs text-white placeholder:text-zinc-500 outline-none"
                  />
                  <input
                    type="text"
                    value={newProfileRole}
                    onChange={(e) => setNewProfileRole(e.target.value)}
                    placeholder="Role"
                    className="apple-well w-full px-3 py-2 text-xs text-white placeholder:text-zinc-500 outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busyId === 'create-prof' || !newProfileName.trim()}
                  className="w-full py-2 rounded-xl bg-white text-zinc-950 font-semibold text-xs hover:bg-zinc-200 disabled:opacity-40 transition-colors"
                >
                  Vytvořit a otevřít
                </button>
              </form>
            )}
          </div>
        </div>
        {pinModal}
      </div>
    );
  }

  // SVG circular gauge math
  const cpuPct = Math.min(100, Math.max(4, data.monitoring.cpu_percent));
  const ringRadius = 44;
  const ringCirc = 2 * Math.PI * ringRadius;
  const ringOffset = ringCirc - (cpuPct / 100) * ringCirc;

  return (
    <div
      className="min-h-screen bg-[#09090b] text-white flex flex-col"
      style={{
        backgroundImage:
          'radial-gradient(ellipse 80% 45% at 50% -10%, rgba(255,255,255,0.065), transparent)',
      }}
    >
      <div className="max-w-[1400px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-5 flex-1 flex flex-col gap-5">
        {/* ================================================================ */}
        {/* TOP PROFILE HEADER BAR                                           */}
        {/* ================================================================ */}
        <header className="flex items-center gap-3.5">
          <button
            type="button"
            onClick={() => setProfileModalOpen(true)}
            className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-300 to-cyan-500 text-zinc-950 font-bold text-lg flex items-center justify-center shadow-[0_8px_24px_rgba(34,211,238,0.28)] hover:scale-[1.04] transition-transform shrink-0"
            title="Přepnout nebo upravit profil"
          >
            {profile.avatar_initials}
          </button>

          <div className="flex-1 apple-card px-5 py-2.5 flex items-center justify-between gap-4 min-w-0">
            <button
              type="button"
              onClick={() => setProfileModalOpen(true)}
              className="text-left group min-w-0"
            >
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold tracking-tight text-white group-hover:text-zinc-200 transition-colors truncate">
                  {profile.name}
                </span>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-white/[0.08] text-zinc-300 border border-white/[0.08]">
                  {profile.role}
                </span>
              </div>
              <div className="text-xs text-zinc-400 truncate">
                {profile.workspace_label} / {profile.name}
              </div>
            </button>

            <div className="flex items-center gap-2 shrink-0">
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-xs text-zinc-300">
                <span
                  className={`w-2 h-2 rounded-full ${data.system_healthy ? 'bg-emerald-400' : 'bg-amber-400'
                    }`}
                />
                <span>{data.monitoring.host_name}</span>
              </div>

              <button
                type="button"
                onClick={() => setShowProfileHub(true)}
                className="px-3.5 py-1.5 rounded-full bg-white/[0.07] hover:bg-white/[0.13] border border-white/[0.1] text-xs font-medium text-white flex items-center gap-1.5 transition-colors"
                title="Otevřít rozcestník profilů"
              >
                <Users className="w-3.5 h-3.5 text-cyan-300" />
                <span className="hidden sm:inline">Změnit profil</span>
              </button>

              <button
                type="button"
                onClick={() => setProfileModalOpen(true)}
                className="px-3.5 py-1.5 rounded-full bg-white/[0.07] hover:bg-white/[0.13] border border-white/[0.1] text-xs font-medium text-white flex items-center gap-1.5 transition-colors"
              >
                <User className="w-3.5 h-3.5 text-zinc-300" />
                <span className="hidden sm:inline">Profil</span>
              </button>
            </div>
          </div>
        </header>

        {/* ================================================================ */}
        {/* MAIN 2-COLUMN BENTO GRID (INSPIRED BY REFERENCE LAYOUT)          */}
        {/* ================================================================ */}
        <main className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch flex-1">
          {/* -------------------------------------------------------------- */}
          {/* LEFT COLUMN (HERO GREETING + ZKRATKY & MONITORING)             */}
          {/* -------------------------------------------------------------- */}
          <div className="lg:col-span-7 flex flex-col gap-5">
            {/* 1. Hero Greeting Card */}
            <section className="group/hero apple-card p-6 sm:p-8 relative overflow-hidden min-h-[260px] flex flex-col justify-between">
              {/* Cyan Ambient Glow */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -bottom-24 right-4 w-72 h-72 rounded-full bg-cyan-400/25 blur-3xl animate-avatar-pulse"
              />

              {/* Animated Cyan Avatar Orb with Eyes */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -bottom-16 right-8 sm:right-14 w-44 h-44 transition-transform duration-500 ease-out group-hover/hero:-translate-y-2 group-hover/hero:scale-[1.03]"
              >
                <div className="w-full h-full rounded-full bg-gradient-to-br from-cyan-200 via-cyan-400 to-sky-500 shadow-[0_0_50px_rgba(34,211,238,0.45),inset_0_4px_14px_rgba(255,255,255,0.65)] animate-avatar-float relative flex items-start justify-center pt-11 pr-6">
                  {/* Glossy highlight */}
                  <div className="absolute top-3 left-8 w-14 h-5 rounded-full bg-white/35 blur-[2px] -rotate-12" />
                  {/* Eyes */}
                  <div className="flex items-center gap-3.5 transition-transform duration-300 group-hover/hero:translate-x-1.5 group-hover/hero:-translate-y-0.5">
                    <span className="w-3 h-7 rounded-full bg-zinc-950/90 shadow-inner animate-avatar-blink block" />
                    <span className="w-3 h-7 rounded-full bg-zinc-950/90 shadow-inner animate-avatar-blink block" />
                  </div>
                </div>
              </div>

              <div className="relative z-10 space-y-4">
                <p className="text-sm font-medium text-zinc-400">
                  Vítej zpět, <span className="text-white">{profile.name}</span>
                </p>

                <h1 className="text-xl sm:text-[26px] font-semibold leading-[1.45] tracking-tight text-zinc-100 max-w-2xl">
                  Dnes je{' '}
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg bg-white text-zinc-950 font-semibold text-[0.88em] align-baseline">
                    {data.date_label}
                  </span>{' '}
                  a v lokalitě {profile.location} je{' '}
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg bg-white/[0.12] text-white border border-white/[0.14] font-medium text-[0.88em] align-baseline">
                    {data.weather_summary}
                  </span>
                  .
                  <br className="hidden sm:block" /> Systém jsem kontroloval naposled v{' '}
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg bg-white/[0.12] text-white border border-white/[0.14] font-mono font-medium text-[0.86em] align-baseline">
                    {data.last_checked}
                  </span>{' '}
                  a{' '}
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-lg font-medium text-[0.88em] align-baseline border ${data.system_healthy
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30'
                        : 'bg-amber-500/20 text-amber-300 border-amber-400/30'
                      }`}
                  >
                    {data.system_status_text}
                  </span>
                  .
                </h1>
              </div>

              <div className="relative z-10 flex flex-wrap items-center gap-4 pt-6">
                <div className="relative flex-1 min-w-[210px] max-w-xs">
                  <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Co ti mám najít?"
                    className="apple-pill-input w-full pl-10 pr-8 py-2 text-xs placeholder:text-zinc-500"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setEventsModalOpen(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-300 hover:text-white transition-colors"
                >
                  <span>Události</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </section>

            {/* 2. Bottom Row: Zkratky & Scripty + Monitoring & Nahrát */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 flex-1">
              {/* Zkratky & Scripty */}
              <section className="apple-card p-5 flex flex-col justify-between gap-4">
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold tracking-tight text-white">
                      Zkratky & Scripty
                    </h2>
                    <button
                      type="button"
                      onClick={() => setShortcutModalOpen(true)}
                      className="w-7 h-7 rounded-full bg-white/[0.06] hover:bg-white/[0.14] border border-white/[0.1] flex items-center justify-center text-zinc-300 hover:text-white transition-colors"
                      title="Přidat zkratku nebo script"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Two-column clean shortcut list matching reference */}
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                    <div className="space-y-1">
                      {serviceShortcuts.map((sc) => {
                        const isActive = activeShortcutId === sc.id;
                        return (
                          <div key={sc.id} className="group flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleShortcutClick(sc)}
                              disabled={busyId === sc.id}
                              className={`flex-1 flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left text-xs font-medium transition-all min-w-0 ${isActive
                                  ? 'bg-white text-zinc-950 shadow-sm'
                                  : 'text-zinc-300 hover:text-white hover:bg-white/[0.06]'
                                }`}
                            >
                              <span
                                className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${isActive
                                    ? 'bg-zinc-900 text-white'
                                    : 'bg-white/[0.07] text-zinc-300'
                                  }`}
                              >
                                {busyId === sc.id ? (
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  renderShortcutIcon(sc.icon, 'w-3.5 h-3.5')
                                )}
                              </span>
                              <span className="truncate">{sc.label}</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    <div className="space-y-1">
                      <div className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        Účet & Systém
                      </div>
                      {accountShortcuts.map((sc) => {
                        const isActive = activeShortcutId === sc.id;
                        return (
                          <button
                            key={sc.id}
                            type="button"
                            onClick={() => handleShortcutClick(sc)}
                            disabled={busyId === sc.id}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left text-xs font-medium transition-all min-w-0 ${isActive
                                ? 'bg-white text-zinc-950 shadow-sm'
                                : 'text-zinc-300 hover:text-white hover:bg-white/[0.06]'
                              }`}
                          >
                            <span
                              className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${isActive
                                  ? 'bg-zinc-900 text-white'
                                  : 'bg-white/[0.07] text-zinc-300'
                                }`}
                            >
                              {busyId === sc.id ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                renderShortcutIcon(sc.icon, 'w-3.5 h-3.5')
                              )}
                            </span>
                            <span className="truncate">{sc.label}</span>
                          </button>
                        );
                      })}

                      <button
                        type="button"
                        onClick={() => setProfileModalOpen(true)}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left text-xs font-medium text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-all"
                      >
                        <span className="w-6 h-6 rounded-lg bg-white/[0.07] text-zinc-300 flex items-center justify-center shrink-0">
                          <User className="w-3.5 h-3.5" />
                        </span>
                        <span className="truncate">Správa profilu</span>
                      </button>
                    </div>
                  </div>
                </div>
              </section>

              {/* Monitoring + Nahrát CTA */}
              <div className="flex flex-col gap-4">
                <section className="apple-card p-5 flex-1 flex flex-col justify-between gap-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-semibold tracking-tight text-white">
                        Monitoring
                      </h2>
                      <p className="text-[11px] text-zinc-400 mt-0.5">
                        {data.monitoring.host_name}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleSystemCheck}
                      disabled={busyId === 'sys-check'}
                      className="p-1.5 rounded-full bg-white/[0.05] hover:bg-white/[0.12] border border-white/[0.08] text-zinc-300 hover:text-white transition-colors"
                      title="Spustit kontrolu teď"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${busyId === 'sys-check' ? 'animate-spin' : ''}`}
                      />
                    </button>
                  </div>

                  <div className="grid grid-cols-[auto_1fr] gap-4 items-center my-auto py-1">
                    {/* Circular CPU Gauge */}
                    <div className="flex flex-col items-center justify-center text-center">
                      <div className="relative w-28 h-28 flex items-center justify-center">
                        <svg className="w-28 h-28 -rotate-90" viewBox="0 0 104 104">
                          <circle
                            cx="52"
                            cy="52"
                            r={ringRadius}
                            fill="none"
                            stroke="rgba(255,255,255,0.08)"
                            strokeWidth="7"
                          />
                          <circle
                            cx="52"
                            cy="52"
                            r={ringRadius}
                            fill="none"
                            stroke="#ffffff"
                            strokeWidth="7"
                            strokeLinecap="round"
                            strokeDasharray={ringCirc}
                            strokeDashoffset={ringOffset}
                            className="transition-all duration-500"
                          />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <Zap className="w-3.5 h-3.5 text-emerald-400 mb-0.5" />
                          <span className="text-xl font-semibold font-mono tracking-tight text-white leading-none">
                            {data.monitoring.tunnel_tx}
                          </span>
                          <span className="text-[10px] text-zinc-400 mt-1 leading-tight">
                            CPU
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* 2 Stacked Well Stat Cards */}
                    <div className="space-y-2.5 min-w-0">
                      <div className="apple-well p-3 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[10px] text-zinc-400">Volné místo</div>
                          <div className="text-sm font-semibold font-mono text-white truncate">
                            {data.monitoring.disk_free_gb.toFixed(0)} GB
                          </div>
                        </div>
                        <div className="w-8 h-8 rounded-xl bg-white/[0.08] flex items-center justify-center shrink-0">
                          <HardDrive className="w-4 h-4 text-white" />
                        </div>
                      </div>

                      <div className="apple-well p-3 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[10px] text-zinc-400">Paměť RAM</div>
                          <div className="text-sm font-semibold font-mono text-white truncate">
                            {data.monitoring.ram_used_gb.toFixed(1)} GB
                          </div>
                        </div>
                        <div className="w-8 h-8 rounded-xl bg-white/[0.08] flex items-center justify-center shrink-0">
                          <Cpu className="w-4 h-4 text-white" />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2.5 border-t border-white/[0.07] flex items-center justify-between text-[11px]">
                    <span className="text-zinc-400 truncate">
                      Připojen k <span className="text-zinc-200 font-medium">{data.monitoring.connected_to}</span>
                    </span>
                    <span className="font-mono text-white font-medium shrink-0">
                      {data.monitoring.uptime_formatted}
                    </span>
                  </div>
                </section>

                {/* Primary CTA Button */}
                <button
                  type="button"
                  onClick={() => setUploadModalOpen(true)}
                  className="w-full py-3.5 px-5 rounded-2xl bg-white hover:bg-zinc-200 text-zinc-950 font-semibold text-sm flex items-center justify-center gap-2 shadow-[0_12px_30px_rgba(255,255,255,0.12)] transition-all active:scale-[0.99]"
                >
                  <Upload className="w-4 h-4" />
                  Nahrát
                </button>
              </div>
            </div>
          </div>

          {/* -------------------------------------------------------------- */}
          {/* RIGHT COLUMN (3 CLICKABLE SERVICE PREVIEW LINK CARDS)          */}
          {/* -------------------------------------------------------------- */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            {filteredServices.map((svc) => {
              const isFav = profile.favorite_services.includes(svc.id);
              const isRunning = svc.status === 'running';
              const cleanUrl = svc.url.replace(/^https?:\/\//, '');
              return (
                <a
                  key={svc.id}
                  href={svc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group apple-card p-5 flex items-stretch justify-between gap-4 relative overflow-hidden flex-1 min-h-[158px] cursor-pointer hover:bg-white/[0.04] hover:-translate-y-0.5 transition-all"
                >
                  {/* Left: Icon, Name, Status & Favorite Heart */}
                  <div className="flex flex-col justify-between gap-3 min-w-[140px] z-10">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-white text-zinc-950 flex items-center justify-center shrink-0 shadow-sm group-hover:scale-105 transition-transform">
                        {renderServiceIcon(svc.icon, 'w-5 h-5')}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-base font-semibold tracking-tight text-white truncate">
                            {svc.name}
                          </h3>
                          <ExternalLink className="w-3 h-3 text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                        </div>
                        <p className="text-[11px] font-medium flex items-center gap-1.5 mt-0.5">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-emerald-400' : 'bg-rose-400'
                              }`}
                          />
                          <span className={isRunning ? 'text-emerald-300' : 'text-rose-300'}>
                            {svc.uptime}
                          </span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleToggleFavorite(svc.id);
                        }}
                        disabled={busyId === `fav-${svc.id}`}
                        className={`p-2 rounded-xl border transition-colors ${isFav
                            ? 'bg-white text-zinc-950 border-white'
                            : 'bg-white/[0.05] hover:bg-white/[0.12] text-zinc-400 hover:text-white border-white/[0.08]'
                          }`}
                        title={isFav ? 'Odebrat z oblíbených v profilu' : 'Přidat do oblíbených'}
                      >
                        <Heart className={`w-3.5 h-3.5 ${isFav ? 'fill-current' : ''}`} />
                      </button>
                      <span className="text-[10px] font-mono text-zinc-500 group-hover:text-zinc-300 transition-colors truncate">
                        {cleanUrl}
                      </span>
                    </div>
                  </div>

                  {/* Right: App Preview Thumbnail (Náhledovka) */}
                  <div className="hidden sm:flex flex-col flex-1 rounded-xl border border-white/[0.08] bg-[#09090c] overflow-hidden min-w-0 relative shadow-inner">
                    {/* Mini Window Chrome */}
                    <div className="px-3 py-1.5 border-b border-white/[0.06] bg-white/[0.03] flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                      </div>
                      <span className="text-[9px] font-mono text-zinc-500 truncate">
                        {svc.subtitle}
                      </span>
                    </div>

                    {/* Preview Content */}
                    <div className="p-2.5 space-y-1.5 flex-1">
                      {svc.preview_rows.slice(0, 4).map((row) => (
                        <div
                          key={row.name}
                          className="flex items-center justify-between gap-2 px-2 py-1 rounded-md bg-white/[0.02] border border-white/[0.03] text-[10px]"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${isRunning ? 'bg-emerald-400' : 'bg-zinc-600'
                                }`}
                            />
                            <span className="text-zinc-200 font-mono truncate">{row.name}</span>
                          </div>
                          <span className="text-zinc-500 font-mono text-[9px] shrink-0">
                            {row.meta}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Subtle Dark Edge Fade */}
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-[#09090c]/85 to-transparent"
                    />
                  </div>
                </a>
              );
            })}
          </div>
        </main>
      </div>

      {/* ================================================================== */}
      {/* MODAL: USER PROFILE MANAGER & SWITCHER                             */}
      {/* ================================================================== */}
      {profileModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
          <div className="apple-card w-full max-w-lg p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-white">Uživatelský profil</h2>
                <p className="text-xs text-zinc-400">
                  Přepnutí profilu nebo úprava údajů pro Vykylab
                </p>
              </div>
              <button
                type="button"
                onClick={() => setProfileModalOpen(false)}
                className="p-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Profile Switcher Pills */}
            <div className="space-y-2">
              <div className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
                Profily ({data.profiles.length})
              </div>
              <div className="flex flex-wrap gap-2">
                {data.profiles.map((p) => {
                  const active = p.id === profile.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelectProfile(p, false)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-2 border transition-colors ${active
                          ? 'bg-white text-zinc-950 border-white'
                          : 'bg-white/[0.05] text-zinc-200 border-white/[0.1] hover:bg-white/[0.1]'
                        }`}
                    >
                      <span
                        className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center ${active ? 'bg-zinc-900 text-white' : 'bg-white/[0.12] text-white'
                          }`}
                      >
                        {p.avatar_initials}
                      </span>
                      <span>{p.name}</span>
                      {p.has_pin && <Lock className="w-3 h-3 opacity-70" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Edit Active Profile */}
            <form onSubmit={handleSaveProfile} className="space-y-3 pt-2 border-t border-white/[0.08]">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">Jméno</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="apple-well w-full px-3 py-2 text-xs text-white outline-none focus:border-white/30"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">Homelab název</label>
                  <input
                    type="text"
                    value={editWorkspace}
                    onChange={(e) => setEditWorkspace(e.target.value)}
                    className="apple-well w-full px-3 py-2 text-xs text-white outline-none focus:border-white/30"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">Role</label>
                  <input
                    type="text"
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value)}
                    className="apple-well w-full px-3 py-2 text-xs text-white outline-none focus:border-white/30"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">Lokalita</label>
                  <input
                    type="text"
                    value={editLocation}
                    onChange={(e) => setEditLocation(e.target.value)}
                    className="apple-well w-full px-3 py-2 text-xs text-white outline-none focus:border-white/30"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={busyId === 'save-prof'}
                className="w-full py-2.5 rounded-xl bg-white text-zinc-950 font-semibold text-xs hover:bg-zinc-200 transition-colors"
              >
                Uložit změny profilu
              </button>
            </form>

            {/* Create New Profile */}
            <form
              onSubmit={handleCreateProfile}
              className="space-y-2.5 pt-3 border-t border-white/[0.08]"
            >
              <div className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <UserPlus className="w-3.5 h-3.5" /> Přidat nový profil
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  placeholder="Jméno (např. Petr)"
                  className="apple-well flex-1 px-3 py-2 text-xs text-white placeholder:text-zinc-500 outline-none"
                />
                <input
                  type="text"
                  value={newProfileRole}
                  onChange={(e) => setNewProfileRole(e.target.value)}
                  placeholder="Role"
                  className="apple-well w-28 px-3 py-2 text-xs text-white placeholder:text-zinc-500 outline-none"
                />
                <button
                  type="submit"
                  disabled={busyId === 'create-prof' || !newProfileName.trim()}
                  className="px-4 py-2 rounded-xl bg-white/[0.1] hover:bg-white/[0.18] text-white text-xs font-medium disabled:opacity-40 transition-colors"
                >
                  Přidat
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* MODAL: ADD / MANAGE SHORTCUTS & SCRIPTS                            */}
      {/* ================================================================== */}
      {shortcutModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
          <div className="apple-card w-full max-w-md p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">Zkratky & Scripty</h2>
              <button
                type="button"
                onClick={() => setShortcutModalOpen(false)}
                className="p-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddShortcut} className="space-y-3">
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Název</label>
                <input
                  type="text"
                  value={scLabel}
                  onChange={(e) => setScLabel(e.target.value)}
                  placeholder="např. Restart Proxy nebo Grafana"
                  className="apple-well w-full px-3 py-2 text-xs text-white placeholder:text-zinc-500 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">Typ</label>
                  <select
                    value={scKind}
                    onChange={(e) => setScKind(e.target.value as ShortcutKind)}
                    className="apple-well w-full px-3 py-2 text-xs text-white outline-none"
                  >
                    <option value="script">Script / Příkaz</option>
                    <option value="link">Webový odkaz</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">Sekce</label>
                  <select
                    value={scCategory}
                    onChange={(e) => setScCategory(e.target.value as 'service' | 'account')}
                    className="apple-well w-full px-3 py-2 text-xs text-white outline-none"
                  >
                    <option value="service">Služby</option>
                    <option value="account">Účet & Systém</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">
                  {scKind === 'link' ? 'URL adresa' : 'Shell příkaz'}
                </label>
                <input
                  type="text"
                  value={scTarget}
                  onChange={(e) => setScTarget(e.target.value)}
                  placeholder={scKind === 'link' ? 'https://...' : 'uptime'}
                  className="apple-well w-full px-3 py-2 text-xs font-mono text-white placeholder:text-zinc-500 outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={busyId === 'add-sc' || !scLabel.trim() || !scTarget.trim()}
                className="w-full py-2.5 rounded-xl bg-white text-zinc-950 font-semibold text-xs hover:bg-zinc-200 disabled:opacity-40 transition-colors"
              >
                Přidat do profilu {profile.name}
              </button>
            </form>

            <div className="pt-3 border-t border-white/[0.08] space-y-1.5 max-h-44 overflow-y-auto">
              {profile.shortcuts.map((sc) => (
                <div
                  key={sc.id}
                  className="apple-well px-3 py-2 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="text-white font-medium truncate">{sc.label}</div>
                    <div className="text-[10px] font-mono text-zinc-400 truncate">{sc.target}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteShortcut(sc.id)}
                    className="p-1 text-zinc-400 hover:text-rose-400 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* MODAL: EVENTS                                                      */}
      {/* ================================================================== */}
      {eventsModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
          <div className="apple-card w-full max-w-xl p-6 space-y-4 max-h-[82vh] flex flex-col">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">Události & Kontroly</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSystemCheck}
                  disabled={busyId === 'sys-check'}
                  className="px-3 py-1.5 rounded-full bg-white text-zinc-950 text-xs font-semibold flex items-center gap-1.5"
                >
                  <RefreshCw
                    className={`w-3 h-3 ${busyId === 'sys-check' ? 'animate-spin' : ''}`}
                  />
                  Zkontrolovat teď
                </button>
                <button
                  type="button"
                  onClick={() => setEventsModalOpen(false)}
                  className="p-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="space-y-2 overflow-y-auto pr-1">
              {data.events.map((ev) => (
                <div key={ev.id} className="apple-well p-3 flex items-start justify-between gap-3">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2 text-[11px]">
                      <span
                        className={`w-2 h-2 rounded-full ${ev.level === 'ok'
                            ? 'bg-emerald-400'
                            : ev.level === 'warn'
                              ? 'bg-amber-400'
                              : 'bg-zinc-400'
                          }`}
                      />
                      <span className="font-semibold text-white">{ev.source}</span>
                      <span className="font-mono text-zinc-500">{ev.timestamp}</span>
                    </div>
                    <p className="text-xs text-zinc-300">{ev.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* MODAL: FILE UPLOAD                                                 */}
      {/* ================================================================== */}
      {uploadModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
          <div className="apple-card w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">Nahrát na server</h2>
              <button
                type="button"
                onClick={() => setUploadModalOpen(false)}
                className="p-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => handleUploadFiles(e.target.files)}
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full apple-well border-dashed border-white/20 hover:border-white/40 p-8 flex flex-col items-center justify-center gap-2 text-center transition-colors"
            >
              <FileUp className="w-7 h-7 text-white" />
              <span className="text-sm font-medium text-white">
                {uploading ? 'Nahrávám...' : 'Vybrat soubory k nahrání'}
              </span>
              <span className="text-[11px] text-zinc-400">
                Uloží se přímo na {data.monitoring.connected_to}
              </span>
            </button>

            {data.uploads.length > 0 && (
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                <div className="text-[11px] text-zinc-400 uppercase tracking-wider">
                  Poslední nahrané
                </div>
                {data.uploads.map((u) => (
                  <div
                    key={u.id}
                    className="apple-well px-3 py-2 flex items-center justify-between text-xs"
                  >
                    <span className="text-zinc-200 truncate">{u.name}</span>
                    <span className="font-mono text-[10px] text-zinc-400 shrink-0">
                      {formatBytes(u.size_bytes)} · {u.uploaded_at}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* MODAL: SCRIPT OUTPUT                                               */}
      {/* ================================================================== */}
      {scriptOutputModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
          <div className="apple-card w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                <h2 className="text-base font-semibold text-white">
                  {scriptOutputModal.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setScriptOutputModal(null)}
                className="p-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <pre className="apple-well p-4 text-xs font-mono text-zinc-200 whitespace-pre-wrap break-words max-h-72 overflow-y-auto">
              {scriptOutputModal.output}
            </pre>
          </div>
        </div>
      )}

      {pinModal}

      {/* ================================================================== */}
      {/* TOAST                                                              */}
      {/* ================================================================== */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 apple-card px-4 py-2.5 flex items-center gap-2 text-xs text-white shadow-2xl">
          <Check className={`w-3.5 h-3.5 ${toast.ok ? 'text-emerald-400' : 'text-rose-400'}`} />
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
}
