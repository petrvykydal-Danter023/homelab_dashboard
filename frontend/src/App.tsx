import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Activity,
  ArrowRight,
  Check,
  Container,
  Cpu,
  Database,
  Delete,
  ExternalLink,
  FileUp,
  Film,
  Globe,
  HardDrive,
  Heart,
  Home,
  Image as ImageIcon,
  Layers,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  Shield,
  Terminal,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import type {
  DashboardResponse,
  ServiceSearchHit,
  ServiceSearchResponse,
  UserProfile,
  UserShortcut,
} from './types';
import { AdminDashboard } from './AdminDashboard';
import {
  AVATAR_COLOR_OPTIONS,
  AVATAR_CONFIG,
  AvatarBadge,
  AvatarOrb,
  getProfileAccentColor,
  getProfileAvatarTheme,
} from './Avatar';

function renderServiceIcon(icon: string, className = 'w-5 h-5') {
  switch (icon) {
    case 'shield':
      return <Shield className={className} />;
    case 'image':
      return <ImageIcon className={className} />;
    case 'lock':
      return <Lock className={className} />;
    case 'activity':
      return <Activity className={className} />;
    case 'zap':
      return <Zap className={className} />;
    case 'layers':
      return <Layers className={className} />;
    case 'globe':
      return <Globe className={className} />;
    case 'film':
      return <Film className={className} />;
    case 'home':
      return <Home className={className} />;
    case 'server':
      return <Server className={className} />;
    case 'database':
      return <Database className={className} />;
    case 'terminal':
      return <Terminal className={className} />;
    case 'hard-drive':
      return <HardDrive className={className} />;
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

function arrangeVFormation(profiles: UserProfile[]): UserProfile[] {
  if (profiles.length <= 2) return profiles;
  const rankOrder = ['prof-peta', 'prof-mamka', 'prof-tata', 'prof-linda', 'prof-sudo'];
  const sorted = [...profiles].sort((a, b) => {
    const ia = rankOrder.indexOf(a.id);
    const ib = rankOrder.indexOf(b.id);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    if (a.is_admin !== b.is_admin) return Number(a.is_admin) - Number(b.is_admin);
    return a.name.localeCompare(b.name, 'cs');
  });

  // Place index 0 at the front apex, then fan wings outward left/right
  const result: UserProfile[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (i % 2 === 1) {
      result.unshift(sorted[i]);
    } else {
      result.push(sorted[i]);
    }
  }
  return result;
}

function foldCzechAscii(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function HighlightMatchText({
  text,
  query,
  accentHex,
  accentRgb,
  active,
}: {
  text: string;
  query: string;
  accentHex: string;
  accentRgb: string;
  active: boolean;
}) {
  if (!active || !query.trim() || !text) {
    return <>{text}</>;
  }

  // Fold per original character so indices map 1:1 back to original text
  const origChars = Array.from(text);
  const foldedText = origChars
    .map((ch) => foldCzechAscii(ch)[0] ?? ch.toLowerCase())
    .join('');

  const tokens = foldCzechAscii(query)
    .split(/\s+/)
    .filter((t) => t.length > 0);

  if (tokens.length === 0) {
    return <>{text}</>;
  }

  const intervals: [number, number][] = [];

  for (const tok of tokens) {
    let idx = 0;
    while (idx < foldedText.length) {
      const pos = foldedText.indexOf(tok, idx);
      if (pos === -1) break;
      intervals.push([pos, pos + tok.length]);
      idx = pos + tok.length;
    }
  }

  if (intervals.length === 0) {
    return <>{text}</>;
  }

  intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const [start, end] of intervals) {
    const last = merged[merged.length - 1];
    if (!last || start > last[1]) {
      merged.push([start, end]);
    } else {
      last[1] = Math.max(last[1], end);
    }
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  merged.forEach(([start, end], i) => {
    if (start > cursor) {
      parts.push(origChars.slice(cursor, start).join(''));
    }
    parts.push(
      <mark
        key={`m-${i}-${start}`}
        style={{
          color: accentHex,
          backgroundColor: 'transparent',
          textShadow: `0 0 10px rgba(${accentRgb}, 0.75)`,
        }}
        className="font-semibold"
      >
        {origChars.slice(start, end).join('')}
      </mark>
    );
    cursor = end;
  });
  if (cursor < origChars.length) {
    parts.push(origChars.slice(cursor).join(''));
  }

  return <>{parts}</>;
}

export default function App() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeShortcutId, setActiveShortcutId] = useState<string>('sc-containers');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  // Always open Profile Hub ("Rozcestník") first on app launch
  const [showProfileHub, setShowProfileHub] = useState<boolean>(true);

  // PIN unlock prompt for protected profiles (e.g. sudo)
  const [pinTargetProfile, setPinTargetProfile] = useState<UserProfile | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinReturnToDash, setPinReturnToDash] = useState(false);
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const pressedKeyTimerRef = useRef<number | null>(null);

  const playMechanicalClick = useCallback((variant: 'digit' | 'alt' = 'digit') => {
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(variant === 'digit' ? 10 : 14);
      }
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }

      const now = ctx.currentTime;
      const jitter = 0.94 + Math.random() * 0.12;

      // 1) Crisp tactile switch click (short bandpass-filtered noise transient)
      const noiseDur = 0.016;
      const sampleCount = Math.floor(ctx.sampleRate * noiseDur);
      const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < sampleCount; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sampleCount * 0.28));
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime((variant === 'digit' ? 3200 : 2100) * jitter, now);
      filter.Q.setValueAtTime(1.6, now);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(variant === 'digit' ? 0.24 : 0.19, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + noiseDur);

      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(ctx.destination);
      noise.start(now);

      // 2) Deep PBT keycap bottom-out "thock"
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      const startFreq = (variant === 'digit' ? 245 : 175) * jitter;
      const endFreq = (variant === 'digit' ? 88 : 65) * jitter;
      osc.frequency.setValueAtTime(startFreq, now);
      osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.036);

      const thockGain = ctx.createGain();
      thockGain.gain.setValueAtTime(0.18, now);
      thockGain.gain.exponentialRampToValueAtTime(0.001, now + 0.042);

      osc.connect(thockGain);
      thockGain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.045);
    } catch {
      // Ignore audio errors on restricted devices
    }
  }, []);

  const triggerKeyFeedback = useCallback(
    (keyId: string, variant: 'digit' | 'alt' = 'digit') => {
      playMechanicalClick(variant);
      setPressedKey(keyId);
      if (pressedKeyTimerRef.current) window.clearTimeout(pressedKeyTimerRef.current);
      pressedKeyTimerRef.current = window.setTimeout(() => {
        setPressedKey(null);
      }, 95);
    },
    [playMechanicalClick]
  );

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
  const [editAvatarColor, setEditAvatarColor] = useState('cyan');

  // Shortcut form state
  const [scLabel, setScLabel] = useState('');
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
      setEditAvatarColor(data.active_profile.avatar_color || 'cyan');
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
          avatar_color: editAvatarColor,
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
      setSearchQuery('');
      setServiceSearch(null);
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

  const submitPin = useCallback(async () => {
    if (!pinTargetProfile || !pinInput.trim() || busyId === `act-${pinTargetProfile.id}`) return;
    const ok = await handleActivateProfile(pinTargetProfile.id, pinInput.trim(), pinReturnToDash);
    if (ok) {
      setPinTargetProfile(null);
      setPinInput('');
      setPinError(null);
    } else {
      setPinError('Nesprávný PIN kód.');
      setPinInput('');
    }
  }, [pinTargetProfile, pinInput, busyId, pinReturnToDash]);

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitPin();
  };

  useEffect(() => {
    if (!pinTargetProfile) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        triggerKeyFeedback(e.key, 'digit');
        setPinInput((prev) => (prev.length < 8 ? prev + e.key : prev));
        setPinError(null);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        triggerKeyFeedback('backspace', 'alt');
        setPinInput((prev) => prev.slice(0, -1));
        setPinError(null);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setPinTargetProfile(null);
        setPinInput('');
        setPinError(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        playMechanicalClick('alt');
        void submitPin();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pinTargetProfile, submitPin, triggerKeyFeedback, playMechanicalClick]);

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
            category: 'service',
            kind: 'script',
            target: scTarget.trim(),
            icon: 'terminal',
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

  const [serviceSearch, setServiceSearch] = useState<ServiceSearchResponse | null>(null);
  const [noMatchCount, setNoMatchCount] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const servicesContainerRef = useRef<HTMLDivElement | null>(null);
  const serviceCardRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const prevCardTopsRef = useRef<Record<string, number>>({});
  const flipCleanupTimersRef = useRef<Record<string, number>>({});
  const noMatchDebounceRef = useRef<number | null>(null);
  const lastNoMatchTriggerRef = useRef(0);

  // Global Cmd+K / Ctrl+K / "/" shortcut to jump straight into Omni-Search
  useEffect(() => {
    const onGlobalKeyDown = (e: KeyboardEvent) => {
      if (
        !data ||
        data.active_profile.is_admin ||
        showProfileHub ||
        pinTargetProfile ||
        profileModalOpen ||
        shortcutModalOpen ||
        eventsModalOpen ||
        uploadModalOpen ||
        scriptOutputModal
      ) {
        return;
      }

      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      const target = e.target as HTMLElement | null;
      const inEditable =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (isCmdK || (e.key === '/' && !inEditable)) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };

    window.addEventListener('keydown', onGlobalKeyDown);
    return () => window.removeEventListener('keydown', onGlobalKeyDown);
  }, [
    data,
    showProfileHub,
    pinTargetProfile,
    profileModalOpen,
    shortcutModalOpen,
    eventsModalOpen,
    uploadModalOpen,
    scriptOutputModal,
  ]);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      if (noMatchDebounceRef.current) {
        window.clearTimeout(noMatchDebounceRef.current);
        noMatchDebounceRef.current = null;
      }
      setServiceSearch(null);
      return;
    }

    const controller = new AbortController();
    fetch(`/api/services/search?q=${encodeURIComponent(trimmed)}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: ServiceSearchResponse | null) => {
        if (!json) return;
        // Snapshot current card positions right before applying new ranked order for 60fps FLIP
        const snapshot: Record<string, number> = {};
        Object.entries(serviceCardRefs.current).forEach(([id, el]) => {
          if (el) snapshot[id] = el.getBoundingClientRect().top;
        });
        prevCardTopsRef.current = snapshot;
        setServiceSearch(json);
        if (servicesContainerRef.current) {
          servicesContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        }

        // Shake avatar "no" when a search matches nothing
        if (noMatchDebounceRef.current) {
          window.clearTimeout(noMatchDebounceRef.current);
          noMatchDebounceRef.current = null;
        }
        if (json.max_score === 0 && json.query.trim().length > 0) {
          noMatchDebounceRef.current = window.setTimeout(() => {
            const now = Date.now();
            if (now - lastNoMatchTriggerRef.current > 1100) {
              lastNoMatchTriggerRef.current = now;
              setNoMatchCount((c) => c + 1);
            }
          }, 260);
        }
      })
      .catch(() => {
        // Ignore aborted requests while typing fast
      });

    return () => {
      controller.abort();
      if (noMatchDebounceRef.current) {
        window.clearTimeout(noMatchDebounceRef.current);
        noMatchDebounceRef.current = null;
      }
    };
  }, [searchQuery]);

  const isSearching = searchQuery.trim().length > 0;

  const { orderedServices, hitMap, maxSearchScore } = useMemo(() => {
    if (!data) {
      return {
        orderedServices: [] as DashboardResponse['services'],
        hitMap: {} as Record<string, ServiceSearchHit>,
        maxSearchScore: 0,
      };
    }

    const visList = data.active_profile.visible_services;
    const allowedSet = visList ? new Set(visList) : null;
    const baseServices = allowedSet
      ? data.services.filter((s) => allowedSet.has(s.id))
      : data.services;

    if (!isSearching) {
      const favs = new Set(data.active_profile.favorite_services);
      const byFav = [...baseServices].sort(
        (a, b) => Number(favs.has(b.id)) - Number(favs.has(a.id))
      );
      return {
        orderedServices: byFav,
        hitMap: {} as Record<string, ServiceSearchHit>,
        maxSearchScore: 0,
      };
    }

    if (serviceSearch && serviceSearch.hits.length > 0) {
      const map: Record<string, ServiceSearchHit> = {};
      const orderIdx: Record<string, number> = {};
      serviceSearch.hits.forEach((h, i) => {
        map[h.id] = h;
        orderIdx[h.id] = i;
      });
      const ranked = [...baseServices].sort((a, b) => {
        const ia = orderIdx[a.id] ?? Number.MAX_SAFE_INTEGER;
        const ib = orderIdx[b.id] ?? Number.MAX_SAFE_INTEGER;
        return ia - ib;
      });
      return {
        orderedServices: ranked,
        hitMap: map,
        maxSearchScore: serviceSearch.max_score || 1,
      };
    }

    return {
      orderedServices: baseServices,
      hitMap: {} as Record<string, ServiceSearchHit>,
      maxSearchScore: 0,
    };
  }, [data, isSearching, serviceSearch]);

  const serviceOrderKey = useMemo(
    () => orderedServices.map((s) => s.id).join(','),
    [orderedServices]
  );

  // 60fps FLIP frame animation when services reorder during search/favorite changes
  useLayoutEffect(() => {
    const prevTops = prevCardTopsRef.current;
    const hasPrev = Object.keys(prevTops).length > 0;

    orderedServices.forEach((svc) => {
      const el = serviceCardRefs.current[svc.id];
      if (!el) return;
      const nextTop = el.getBoundingClientRect().top;

      if (hasPrev && prevTops[svc.id] !== undefined) {
        const deltaY = prevTops[svc.id] - nextTop;
        if (Math.abs(deltaY) > 1.5) {
          if (flipCleanupTimersRef.current[svc.id]) {
            window.clearTimeout(flipCleanupTimersRef.current[svc.id]);
          }
          el.style.transition = 'none';
          el.style.transform = `translate3d(0, ${deltaY.toFixed(1)}px, 0)`;

          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
              el.style.transition = 'transform 460ms cubic-bezier(0.22, 1, 0.36, 1)';
              el.style.transform = 'translate3d(0, 0, 0)';
              flipCleanupTimersRef.current[svc.id] = window.setTimeout(() => {
                el.style.transition = '';
                el.style.transform = '';
              }, 480);
            });
          });
        }
      }
      prevCardTopsRef.current[svc.id] = nextTop;
    });
  }, [serviceOrderKey]);

  // Search only affects services — shortcuts stay intact
  const filteredShortcuts = useMemo(() => {
    if (!data) return [];
    return data.active_profile.shortcuts;
  }, [data]);

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
  const profileTheme = getProfileAvatarTheme(profile);
  const profileAccent = getProfileAccentColor(profile);
  const shellShortcuts = filteredShortcuts.filter(
    (s) => s.category !== 'account' && s.kind === 'script'
  );

  const pinDotCount = Math.max(4, pinInput.length);
  const handleKeypadDigit = (digit: string) => {
    triggerKeyFeedback(digit, 'digit');
    setPinInput((prev) => (prev.length < 8 ? prev + digit : prev));
    if (pinError) setPinError(null);
  };

  const pinModal = pinTargetProfile && (
    <div
      className="fixed inset-0 z-[60] bg-[#09090b]/85 backdrop-blur-2xl flex items-center justify-center p-4"
      style={{
        backgroundImage:
          'radial-gradient(ellipse 65% 45% at 50% 0%, rgba(255,255,255,0.06), transparent)',
      }}
    >
      <form
        onSubmit={handlePinSubmit}
        className="apple-card relative w-full max-w-[336px] px-6 py-7 space-y-6 text-center"
      >
        {/* Clean minimal Apple header */}
        <h2 className="text-lg font-semibold tracking-tight text-white">
          Zadej PIN kód
        </h2>

        {/* Clean floating PIN dots (no heavy inner box) */}
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-3.5 py-1">
            {Array.from({ length: pinDotCount }).map((_, idx) => {
              const filled = idx < pinInput.length;
              return (
                <span
                  key={idx}
                  className={`w-2.5 h-2.5 rounded-full transition-all duration-150 ${
                    pinError
                      ? 'bg-rose-400/70'
                      : filled
                        ? 'bg-white shadow-[0_0_12px_rgba(255,255,255,0.8)] scale-125'
                        : 'bg-white/15 scale-100'
                  }`}
                />
              );
            })}
          </div>
          {pinError && (
            <p className="text-xs text-rose-400 font-medium">{pinError}</p>
          )}
        </div>

        {/* Clean Apple iOS-style Keypad */}
        <div className="grid grid-cols-3 gap-3 max-w-[236px] mx-auto select-none">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <button
              key={digit}
              type="button"
              onClick={() => handleKeypadDigit(digit)}
              className={`w-16 h-16 mx-auto rounded-full border border-white/[0.08] text-xl font-normal text-white transition-all duration-150 touch-manipulation flex items-center justify-center ${
                pressedKey === digit
                  ? 'bg-white/25 scale-95 border-white/25'
                  : 'bg-white/[0.06] hover:bg-white/[0.12] active:bg-white/25 active:scale-95'
              }`}
            >
              {digit}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              triggerKeyFeedback('clear', 'alt');
              setPinInput('');
              setPinError(null);
            }}
            disabled={!pinInput.length}
            aria-label="Vymazat vše"
            className={`w-16 h-16 mx-auto rounded-full text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/[0.06] active:scale-95 disabled:opacity-25 transition-all duration-150 touch-manipulation flex items-center justify-center ${
              pressedKey === 'clear' ? 'bg-white/[0.12] scale-95 text-white' : ''
            }`}
          >
            Smazat
          </button>
          <button
            type="button"
            onClick={() => handleKeypadDigit('0')}
            className={`w-16 h-16 mx-auto rounded-full border border-white/[0.08] text-xl font-normal text-white transition-all duration-150 touch-manipulation flex items-center justify-center ${
              pressedKey === '0'
                ? 'bg-white/25 scale-95 border-white/25'
                : 'bg-white/[0.06] hover:bg-white/[0.12] active:bg-white/25 active:scale-95'
            }`}
          >
            0
          </button>
          <button
            type="button"
            onClick={() => {
              triggerKeyFeedback('backspace', 'alt');
              setPinInput((prev) => prev.slice(0, -1));
              if (pinError) setPinError(null);
            }}
            disabled={!pinInput.length}
            aria-label="Smazat poslední číslici"
            className={`w-16 h-16 mx-auto rounded-full text-zinc-400 hover:text-white hover:bg-white/[0.06] active:scale-95 disabled:opacity-25 transition-all duration-150 touch-manipulation flex items-center justify-center ${
              pressedKey === 'backspace' ? 'bg-white/[0.12] scale-95 text-white' : ''
            }`}
          >
            <Delete className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-2.5 pt-1">
          <button
            type="button"
            onClick={() => {
              setPinTargetProfile(null);
              setPinInput('');
              setPinError(null);
            }}
            className="flex-1 py-2.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] active:scale-[0.98] text-xs font-medium text-zinc-300 transition-all touch-manipulation"
          >
            Zrušit
          </button>
          <button
            type="submit"
            disabled={!pinInput.trim() || busyId === `act-${pinTargetProfile.id}`}
            className="flex-1 py-2.5 rounded-full bg-white hover:bg-zinc-200 active:scale-[0.98] text-zinc-950 text-xs font-semibold disabled:opacity-35 transition-all touch-manipulation"
          >
            {busyId === `act-${pinTargetProfile.id}` ? 'Ověřuji…' : 'Odemknout'}
          </button>
        </div>
      </form>
    </div>
  );

  if (showProfileHub) {
    const vProfiles = arrangeVFormation(data.profiles);
    const centerIdx = (vProfiles.length - 1) / 2;

    return (
      <div
        className="min-h-screen bg-[#09090b] text-white flex flex-col items-center justify-center px-4 py-10 overflow-x-hidden"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 65% 45% at 50% 0%, rgba(34,211,238,0.13), transparent)',
        }}
      >
        <div className="w-full max-w-5xl space-y-8">
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
          </div>

          {/* V-Formation ("Rojnice do V") */}
          <div className="group/vrow flex flex-wrap sm:flex-nowrap items-end justify-center gap-5 sm:gap-2 pt-8 pb-6">
            {vProfiles.map((p, idx) => {
              const isCurrent = p.id === profile.id;
              const cardTheme = getProfileAvatarTheme(p);
              const dist = Math.abs(idx - centerIdx);
              const depthClass =
                dist < 0.5
                  ? 'sm:translate-y-7 z-30'
                  : dist < 1.5
                    ? 'sm:translate-y-0 z-20'
                    : 'sm:-translate-y-7 z-10';
              const eyeDirection =
                idx < centerIdx
                  ? 'translate-x-1.5 group-hover:translate-x-0 transition-transform duration-300'
                  : idx > centerIdx
                    ? '-translate-x-1.5 group-hover:translate-x-0 transition-transform duration-300'
                    : '';

              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelectProfile(p, true)}
                  disabled={busyId === `act-${p.id}`}
                  className={`group relative flex flex-col items-center focus:outline-none transition-all duration-300 ease-out hover:!z-50 group-hover/vrow:opacity-45 hover:!opacity-100 ${idx > 0 ? 'sm:-ml-2' : ''} ${depthClass}`}
                >
                  {/* Ambient Glow behind Orb */}
                  <div
                    aria-hidden="true"
                    className={`pointer-events-none absolute -top-4 ${AVATAR_CONFIG.orb.glowClass} rounded-full blur-2xl opacity-50 group-hover:opacity-100 transition-opacity duration-300 ${cardTheme.glow}`}
                    style={cardTheme.glowStyle}
                  />

                  {/* Expressive Colored Avatar Orb */}
                  <div className="mb-2 transition-transform duration-300 ease-out group-hover:-translate-y-3">
                    <AvatarOrb
                      profile={p}
                      eyeShiftClass={eyeDirection}
                      showLock
                    />
                  </div>

                  {/* Subtle floor shadow */}
                  <div
                    aria-hidden="true"
                    className="w-24 h-2.5 rounded-full bg-black/75 blur-sm mb-3 transition-all duration-300 ease-out group-hover:w-20 group-hover:opacity-40"
                  />

                  {/* Minimal Name Pill */}
                  <div
                    className={`px-5 py-2 rounded-2xl border backdrop-blur-xl transition-all duration-300 ease-out flex items-center justify-center ${isCurrent
                        ? 'bg-white/[0.1] border-white/25 shadow-[0_10px_28px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.16)]'
                        : 'bg-[#111115]/85 border-white/[0.08] shadow-[0_8px_20px_rgba(0,0,0,0.5)]'
                      } group-hover:bg-white/[0.14] group-hover:border-white/35 group-hover:-translate-y-0.5 group-hover:shadow-[0_14px_32px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.22)]`}
                  >
                    <span className="text-sm font-semibold tracking-tight text-zinc-200 group-hover:text-white transition-colors whitespace-nowrap">
                      {p.name}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        {pinModal}
      </div>
    );
  }

  if (profile.is_admin && (profile.id === 'prof-sudo' || profile.name === 'sudo')) {
    return (
      <>
        <AdminDashboard
          data={data}
          onRefresh={fetchDashboard}
          onOpenProfileHub={() => setShowProfileHub(true)}
          onShowToast={showToast}
        />
        {pinModal}
        {toast && (
          <div className="fixed bottom-5 right-5 z-50 apple-card px-4 py-2.5 flex items-center gap-2 text-xs text-white shadow-2xl">
            <Check className={`w-3.5 h-3.5 ${toast.ok ? 'text-emerald-400' : 'text-rose-400'}`} />
            <span>{toast.text}</span>
          </div>
        )}
      </>
    );
  }

  // SVG circular gauge math
  const cpuPct = Math.min(100, Math.max(4, data.monitoring.cpu_percent));
  const ringRadius = 44;
  const ringCirc = 2 * Math.PI * ringRadius;
  const ringOffset = ringCirc - (cpuPct / 100) * ringCirc;

  return (
    <div
      className="min-h-screen lg:h-screen lg:overflow-hidden bg-[#09090b] text-white flex flex-col"
      style={{
        backgroundImage:
          'radial-gradient(ellipse 80% 45% at 50% -10%, rgba(255,255,255,0.065), transparent)',
      }}
    >
      <div className="max-w-[1400px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-5 flex-1 min-h-0 flex flex-col gap-5">
        {/* ================================================================ */}
        {/* TOP PROFILE HEADER BAR                                           */}
        {/* ================================================================ */}
        <header className="flex items-center gap-3.5">
          <button
            type="button"
            onClick={() => setShowProfileHub(true)}
            className="hover:scale-[1.04] transition-transform shrink-0"
            title="Vybrat profil"
          >
            <AvatarBadge profile={profile} />
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
                onClick={() => setProfileModalOpen(true)}
                className="px-3.5 py-1.5 rounded-full bg-white/[0.07] hover:bg-white/[0.13] border border-white/[0.1] text-xs font-medium text-white flex items-center gap-1.5 transition-colors"
                title="Nastavení profilu"
              >
                <Settings className="w-3.5 h-3.5 text-zinc-300" />
                <span className="hidden sm:inline">Nastavení profilu</span>
              </button>
            </div>
          </div>
        </header>

        {/* ================================================================ */}
        {/* MAIN 2-COLUMN BENTO GRID (INSPIRED BY REFERENCE LAYOUT)          */}
        {/* ================================================================ */}
        <main className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch flex-1 min-h-0">
          {/* -------------------------------------------------------------- */}
          {/* LEFT COLUMN (HERO GREETING + ZKRATKY & MONITORING)             */}
          {/* -------------------------------------------------------------- */}
          <div className="lg:col-span-7 flex flex-col gap-5 lg:h-full lg:min-h-0">
            {/* 1. Hero Greeting Card */}
            <section className="group/hero apple-card p-6 sm:p-8 relative overflow-hidden min-h-[260px] flex flex-col justify-between">
              {/* Profile Ambient Glow */}
              <div
                aria-hidden="true"
                className={`pointer-events-none absolute -bottom-24 right-0 w-72 h-72 rounded-full blur-3xl opacity-65 ${profileTheme.glow}`}
                style={profileTheme.glowStyle}
              />

              {/* Profile Avatar Orb (interactive: click eyes + global random blink) */}
              <div className="absolute -bottom-11 right-3 sm:right-6 z-30 transition-transform duration-300 ease-out group-hover/hero:-translate-y-1.5">
                <AvatarOrb
                  profile={profile}
                  interactive
                  facing="left"
                  noTrigger={noMatchCount}
                  sizeClass={AVATAR_CONFIG.dashboardOrb.sizeClass}
                  eyeShiftClass="pr-5 -mt-6"
                />
              </div>

              <div className="relative z-20 pointer-events-none space-y-4">
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

              <div className="relative z-20 pointer-events-none flex flex-wrap items-center gap-4 pt-6">
                <div className="relative pointer-events-auto flex-1 min-w-[210px] max-w-xs">
                  <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && isSearching && orderedServices.length > 0) {
                        const topService = orderedServices[0];
                        const topScore = hitMap[topService.id]?.score ?? 0;
                        if (topScore > 0) {
                          e.preventDefault();
                          window.open(topService.url, '_blank', 'noopener,noreferrer');
                          showToast(true, `Otevřeno: ${topService.name}`);
                        }
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setSearchQuery('');
                        searchInputRef.current?.blur();
                      }
                    }}
                    placeholder="Co ti mám najít?"
                    className="apple-pill-input w-full pl-10 pr-14 py-2 text-xs placeholder:text-zinc-500"
                  />
                  {searchQuery ? (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <span className="pointer-events-none hidden sm:inline-flex items-center gap-0.5 absolute right-3 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded-md bg-white/[0.06] border border-white/[0.08] text-[10px] font-mono text-zinc-400">
                      ⌘K
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setEventsModalOpen(true)}
                  className="pointer-events-auto inline-flex items-center gap-1.5 text-xs font-medium text-zinc-300 hover:text-white transition-colors"
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

                  {/* Clean Shell Shortcuts list (Name + Shell Command only) */}
                  <div className="space-y-1.5">
                    {shellShortcuts.length === 0 ? (
                      <div className="apple-well px-3.5 py-4 text-center text-xs text-zinc-500">
                        Zatím žádné shell zkratky — přidej tlačítkem +
                      </div>
                    ) : (
                      shellShortcuts.map((sc) => {
                        const isActive = activeShortcutId === sc.id;
                        return (
                          <button
                            key={sc.id}
                            type="button"
                            onClick={() => handleShortcutClick(sc)}
                            disabled={busyId === sc.id}
                            className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl text-left text-xs font-medium transition-all min-w-0 ${
                              isActive
                                ? 'bg-white text-zinc-950 shadow-sm'
                                : 'text-zinc-200 hover:text-white hover:bg-white/[0.06]'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span
                                className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                                  isActive
                                    ? 'bg-zinc-900 text-white'
                                    : 'bg-white/[0.07] text-zinc-300'
                                }`}
                              >
                                {busyId === sc.id ? (
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Terminal className="w-3.5 h-3.5" />
                                )}
                              </span>
                              <span className="truncate">{sc.label}</span>
                            </div>
                            <span
                              className={`text-[10px] font-mono truncate max-w-[45%] shrink-0 ${
                                isActive ? 'text-zinc-600' : 'text-zinc-500'
                              }`}
                            >
                              {sc.target}
                            </span>
                          </button>
                        );
                      })
                    )}
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
          {/* RIGHT COLUMN (SCROLLABLE SERVICE PREVIEW LINK CARDS)           */}
          {/* -------------------------------------------------------------- */}
          <div
            ref={servicesContainerRef}
            className="lg:col-span-5 flex flex-col gap-4 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pt-1.5 lg:-mt-1.5 lg:pb-2 lg:pr-1"
          >
            {orderedServices.map((svc) => {
              const isFav = profile.favorite_services.includes(svc.id);
              const isContainerLinked = svc.is_docker !== false || Boolean(svc.container_name);
              const isRunning = svc.status === 'running';
              const cleanUrl = svc.url.replace(/^https?:\/\//, '');
              const hit = hitMap[svc.id];
              const matchScore = hit?.score ?? 0;
              const isMatch = isSearching && matchScore > 0;
              const isDimmed = isSearching && !!serviceSearch && matchScore === 0;
              const matchStrength = isMatch
                ? Math.min(1, Math.max(0.32, matchScore / maxSearchScore))
                : 0;

              return (
                <a
                  key={svc.id}
                  ref={(el) => {
                    serviceCardRefs.current[svc.id] = el;
                  }}
                  href={svc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={
                    isMatch
                      ? {
                          borderColor: `rgba(${profileAccent.rgb}, ${(0.28 + 0.32 * matchStrength).toFixed(2)})`,
                          boxShadow: `inset 0 1px 0 rgba(${profileAccent.rgb}, ${(0.22 + 0.2 * matchStrength).toFixed(2)}), inset 0 0 ${Math.round(22 + 16 * matchStrength)}px rgba(${profileAccent.rgb}, ${(0.06 + 0.08 * matchStrength).toFixed(2)}), 0 14px 32px -14px rgba(0,0,0,0.75)`,
                        }
                      : undefined
                  }
                  className={`group apple-card p-5 flex items-stretch justify-between gap-4 relative overflow-hidden shrink-0 min-h-[164px] cursor-pointer hover:bg-white/[0.04] hover:-translate-y-0.5 transition-all duration-300 ${
                    isDimmed ? 'opacity-40 hover:opacity-75' : 'opacity-100'
                  }`}
                >
                  {/* Soft internal ambient glow matching profile avatar color (never clipped by scrollbox) */}
                  {isMatch && (
                    <div
                      aria-hidden="true"
                      style={{
                        background: `radial-gradient(65% 110% at 8% 20%, rgba(${profileAccent.rgb}, ${(0.07 + 0.07 * matchStrength).toFixed(2)}), transparent 72%)`,
                      }}
                      className="pointer-events-none absolute inset-0"
                    />
                  )}

                  {/* Left: Icon, Name, Status & Favorite Heart */}
                  <div className="flex flex-col justify-between gap-3 min-w-[140px] z-10">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-white text-zinc-950 flex items-center justify-center shrink-0 shadow-sm group-hover:scale-105 transition-transform">
                        {renderServiceIcon(svc.icon, 'w-5 h-5')}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-base font-semibold tracking-tight text-white truncate">
                            <HighlightMatchText
                              text={svc.name}
                              query={searchQuery}
                              accentHex={profileAccent.hex}
                              accentRgb={profileAccent.rgb}
                              active={isMatch}
                            />
                          </h3>
                          <ExternalLink className="w-3 h-3 text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                        </div>
                        {isContainerLinked ? (
                          <p className="text-[11px] font-medium flex items-center gap-1.5 mt-0.5">
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                isRunning ? 'bg-emerald-400' : 'bg-rose-400'
                              }`}
                            />
                            <span className={isRunning ? 'text-emerald-300' : 'text-rose-300'}>
                              <HighlightMatchText
                                text={svc.uptime}
                                query={searchQuery}
                                accentHex={profileAccent.hex}
                                accentRgb={profileAccent.rgb}
                                active={isMatch}
                              />
                            </span>
                          </p>
                        ) : (
                          <p className="text-[11px] font-mono text-zinc-400 group-hover:text-zinc-300 transition-colors truncate mt-0.5">
                            <HighlightMatchText
                              text={cleanUrl}
                              query={searchQuery}
                              accentHex={profileAccent.hex}
                              accentRgb={profileAccent.rgb}
                              active={isMatch}
                            />
                          </p>
                        )}
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
                            ? 'bg-rose-400/20 hover:bg-rose-400/30 text-rose-300 border-rose-300/40 shadow-[0_0_14px_rgba(251,113,133,0.2)]'
                            : 'bg-white/[0.05] hover:bg-rose-400/10 text-zinc-400 hover:text-rose-300 border-white/[0.08] hover:border-rose-300/25'
                          }`}
                        title={isFav ? 'Odebrat z oblíbených v profilu' : 'Přidat do oblíbených'}
                      >
                        <Heart className={`w-3.5 h-3.5 ${isFav ? 'fill-current' : ''}`} />
                      </button>
                      {isContainerLinked && (
                        <span className="text-[10px] font-mono text-zinc-500 group-hover:text-zinc-300 transition-colors truncate">
                          <HighlightMatchText
                            text={cleanUrl}
                            query={searchQuery}
                            accentHex={profileAccent.hex}
                            accentRgb={profileAccent.rgb}
                            active={isMatch}
                          />
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right: Clean Service Image / Minimal Apple Visual Preview */}
                  <div className="hidden sm:flex flex-col flex-1 rounded-2xl border border-white/[0.08] bg-[#0b0b0f] overflow-hidden min-w-0 relative shadow-inner">
                    {svc.image_url ? (
                      <>
                        <img
                          src={svc.image_url}
                          alt={svc.name}
                          className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
                        />
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#09090b]/70 via-transparent to-black/25"
                        />
                        <span className="pointer-events-none absolute bottom-2 right-2.5 px-2 py-0.5 rounded-full bg-black/55 backdrop-blur-md border border-white/[0.1] text-[9px] font-mono text-zinc-200 truncate max-w-[85%]">
                          <HighlightMatchText
                            text={svc.subtitle}
                            query={searchQuery}
                            accentHex={profileAccent.hex}
                            accentRgb={profileAccent.rgb}
                            active={isMatch}
                          />
                        </span>
                      </>
                    ) : (
                      <div
                        className="w-full h-full flex flex-col items-center justify-center p-4 text-center relative"
                        style={{
                          background: `radial-gradient(circle at 70% 30%, rgba(${profileAccent.rgb}, 0.1), transparent 72%)`,
                        }}
                      >
                        <div className="w-11 h-11 rounded-2xl bg-white/[0.06] border border-white/[0.09] flex items-center justify-center text-zinc-200 mb-2 group-hover:scale-105 transition-transform">
                          {renderServiceIcon(svc.icon, 'w-5 h-5')}
                        </div>
                        <span className="text-[11px] font-medium text-zinc-200 truncate max-w-full">
                          <HighlightMatchText
                            text={svc.subtitle}
                            query={searchQuery}
                            accentHex={profileAccent.hex}
                            accentRgb={profileAccent.rgb}
                            active={isMatch}
                          />
                        </span>
                      </div>
                    )}
                  </div>
                </a>
              );
            })}
          </div>
        </main>
      </div>

      {/* ================================================================== */}
      {/* MODAL: PROFILE SETTINGS ONLY                                       */}
      {/* ================================================================== */}
      {profileModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
          <div className="apple-card w-full max-w-md p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-white">Nastavení profilu</h2>
                <p className="text-xs text-zinc-400">
                  Úprava údajů profilu {profile.name}
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

            <form onSubmit={handleSaveProfile} className="space-y-3">
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
                  <label className="block text-[11px] text-zinc-400 mb-1">Barva avatara</label>
                  <select
                    value={editAvatarColor}
                    onChange={(e) => setEditAvatarColor(e.target.value)}
                    className="apple-well w-full px-3 py-2 text-xs text-white outline-none focus:border-white/30"
                  >
                    {AVATAR_COLOR_OPTIONS.map((c) => (
                      <option key={c.id} value={c.id} className="bg-zinc-900 text-white">
                        {c.label}
                      </option>
                    ))}
                  </select>
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
                  placeholder="např. Docker ps nebo Disky"
                  className="apple-well w-full px-3 py-2 text-xs text-white placeholder:text-zinc-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">
                  Shell příkaz
                </label>
                <input
                  type="text"
                  value={scTarget}
                  onChange={(e) => setScTarget(e.target.value)}
                  placeholder="uptime"
                  className="apple-well w-full px-3 py-2 text-xs font-mono text-white placeholder:text-zinc-500 outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={busyId === 'add-sc' || !scLabel.trim() || !scTarget.trim()}
                className="w-full py-2.5 rounded-xl bg-white text-zinc-950 font-semibold text-xs hover:bg-zinc-200 disabled:opacity-40 transition-colors"
              >
                Přidat zkratku
              </button>
            </form>

            <div className="pt-3 border-t border-white/[0.08] space-y-1.5 max-h-44 overflow-y-auto">
              {shellShortcuts.map((sc) => (
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
