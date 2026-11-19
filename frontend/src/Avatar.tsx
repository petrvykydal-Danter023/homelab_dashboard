import React, { useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import './avatar.css';
import type { UserProfile } from './types';

export type BlinkVariant = 'single' | 'double' | 'slow' | 'wink-left' | 'wink-right';

export interface ProfileAvatarTheme {
  id: string;
  label: string;
  badge: string;
  orb: string;
  glow: string;
  swatchStyle?: React.CSSProperties;
  glowStyle?: React.CSSProperties;
}

/**
 * Central size & proportion config for every avatar instance in the app
 * (Profile Hub, User Hero, Sudo Admin Dashboard tabs, Headers, PIN modal).
 */
export const AVATAR_CONFIG = {
  badge: {
    sizeClass: 'w-12 h-12 rounded-2xl text-lg',
  },
  pill: {
    sizeClass: 'w-5 h-5 rounded-full text-[10px]',
  },
  orb: {
    sizeClass: 'w-36 h-36',
    glowClass: 'w-52 h-52',
    highlightClass: 'top-3 left-7 w-12 h-3.5',
    eyeGapClass: 'gap-3.5',
    eyeOpenClass: 'w-3 h-8 rounded-full',
    eyeClosedClass: 'w-3.5 h-1 rounded-full',
  },
  dashboardOrb: {
    sizeClass: 'w-40 h-40',
    glowClass: 'w-56 h-56',
  },
} as const;

export const AVATAR_COLOR_OPTIONS = [
  { id: 'cyan', label: 'Cyan' },
  { id: 'soft-pink', label: 'Soft Pink' },
  { id: 'owl-brown', label: 'Soví hnědá' },
  { id: 'dark-blue', label: 'Tmavě modrá' },
  { id: 'red', label: 'Červená' },
] as const;

export const AVATAR_THEMES: Record<string, ProfileAvatarTheme> = {
  red: {
    id: 'red',
    label: 'Červená',
    badge:
      'bg-gradient-to-br from-rose-300 via-red-400 to-rose-600 text-zinc-950 shadow-[0_8px_24px_rgba(244,63,94,0.35)]',
    orb:
      'bg-gradient-to-br from-rose-200 via-red-400 to-rose-600 shadow-[0_0_55px_rgba(244,63,94,0.48),inset_0_4px_14px_rgba(255,228,230,0.68)]',
    glow: 'bg-rose-500/30',
  },
  'owl-brown': {
    id: 'owl-brown',
    label: 'Soví hnědá',
    badge:
      'bg-gradient-to-br from-[#d8b490] via-[#b08460] to-[#7c583c] text-zinc-950 shadow-[0_8px_24px_rgba(176,132,96,0.38)]',
    orb:
      'bg-gradient-to-br from-[#e2c2a2] via-[#b58763] to-[#7a5438] shadow-[0_0_55px_rgba(181,135,99,0.45),inset_0_4px_14px_rgba(255,245,232,0.58)]',
    glow: 'bg-[#b58763]/30',
  },
  'soft-pink': {
    id: 'soft-pink',
    label: 'Soft Pink',
    badge:
      'bg-gradient-to-br from-pink-200 via-pink-300 to-rose-300 text-zinc-950 shadow-[0_8px_24px_rgba(244,114,182,0.3)]',
    orb:
      'bg-gradient-to-br from-pink-100 via-pink-300 to-rose-400 shadow-[0_0_55px_rgba(244,114,182,0.42),inset_0_4px_14px_rgba(255,255,255,0.7)]',
    glow: 'bg-pink-400/25',
  },
  'dark-blue': {
    id: 'dark-blue',
    label: 'Tmavě modrá',
    badge:
      'bg-gradient-to-br from-blue-500 via-blue-700 to-indigo-900 text-white shadow-[0_8px_24px_rgba(37,99,235,0.38)]',
    orb:
      'bg-gradient-to-br from-sky-400 via-blue-600 to-indigo-900 shadow-[0_0_55px_rgba(37,99,235,0.48),inset_0_4px_14px_rgba(191,219,254,0.5)]',
    glow: 'bg-blue-600/30',
  },
  cyan: {
    id: 'cyan',
    label: 'Cyan',
    badge:
      'bg-gradient-to-br from-cyan-300 to-cyan-500 text-zinc-950 shadow-[0_8px_24px_rgba(34,211,238,0.28)]',
    orb:
      'bg-gradient-to-br from-cyan-200 via-cyan-400 to-sky-500 shadow-[0_0_55px_rgba(34,211,238,0.45),inset_0_4px_14px_rgba(255,255,255,0.68)]',
    glow: 'bg-cyan-400/25',
  },
};

export function getProfileAvatarTheme(
  p: Pick<UserProfile, 'id' | 'name'> & { avatar_color?: string }
): ProfileAvatarTheme {
  const rawColor = (p.avatar_color || '').trim().toLowerCase();
  if (rawColor in AVATAR_THEMES) {
    return AVATAR_THEMES[rawColor];
  }
  if (rawColor === 'owl' || rawColor === 'brown' || rawColor === 'sova') {
    return AVATAR_THEMES['owl-brown'];
  }
  if (rawColor === 'pink') {
    return AVATAR_THEMES['soft-pink'];
  }
  if (rawColor === 'blue' || rawColor === 'navy') {
    return AVATAR_THEMES['dark-blue'];
  }
  if (rawColor === 'crimson' || rawColor === 'rose' || rawColor === 'cervena') {
    return AVATAR_THEMES.red;
  }
  if (rawColor.startsWith('#') && (rawColor.length === 4 || rawColor.length === 7)) {
    return {
      id: rawColor,
      label: rawColor,
      badge: 'text-zinc-950',
      orb: '',
      glow: '',
      swatchStyle: {
        background: `linear-gradient(135deg, ${rawColor}, ${rawColor}cc)`,
        boxShadow: `0 8px 28px ${rawColor}55`,
      },
      glowStyle: {
        backgroundColor: rawColor,
        opacity: 0.25,
      },
    };
  }

  const id = p.id.toLowerCase();
  const name = p.name.trim().toLowerCase();
  if (id === 'prof-mamka' || name === 'mamka') return AVATAR_THEMES['owl-brown'];
  if (id === 'prof-linda' || name === 'linda') return AVATAR_THEMES['soft-pink'];
  if (id === 'prof-tata' || name === 'táta' || name === 'tata') return AVATAR_THEMES['dark-blue'];
  if (id === 'prof-sudo' || name === 'sudo') return AVATAR_THEMES.red;
  return AVATAR_THEMES.cyan;
}

export function getProfileAccentColor(
  p: Pick<UserProfile, 'id' | 'name'> & { avatar_color?: string }
): { hex: string; rgb: string } {
  const theme = getProfileAvatarTheme(p);
  if (theme.id === 'soft-pink') return { hex: '#f472b6', rgb: '244, 114, 182' };
  if (theme.id === 'owl-brown') return { hex: '#d4a373', rgb: '212, 163, 115' };
  if (theme.id === 'dark-blue') return { hex: '#60a5fa', rgb: '96, 165, 250' };
  if (theme.id === 'red') return { hex: '#fb7185', rgb: '251, 113, 133' };
  if (theme.id === 'cyan') return { hex: '#22d3ee', rgb: '34, 211, 238' };

  const hex = theme.id.replace('#', '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : hex;
  if (full.length === 6) {
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return { hex: `#${full}`, rgb: `${r}, ${g}, ${b}` };
    }
  }
  return { hex: '#22d3ee', rgb: '34, 211, 238' };
}

interface AvatarBadgeProps {
  profile: Pick<UserProfile, 'id' | 'name' | 'avatar_initials'> & { avatar_color?: string };
  className?: string;
  children?: React.ReactNode;
}

export function AvatarBadge({ profile, className = '', children }: AvatarBadgeProps) {
  const theme = getProfileAvatarTheme(profile);
  return (
    <div
      className={`${AVATAR_CONFIG.badge.sizeClass} font-bold flex items-center justify-center ${theme.badge} ${className}`}
      style={theme.swatchStyle}
    >
      {children ?? profile.avatar_initials}
    </div>
  );
}

const BLINK_POOL: BlinkVariant[] = [
  'single',
  'single',
  'single',
  'double',
  'slow',
  'wink-left',
  'wink-right',
];

function useRandomBlink() {
  const [closedEyes, setClosedEyes] = useState<{ left: boolean; right: boolean; slow: boolean }>({
    left: false,
    right: false,
    slow: false,
  });

  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];

    const schedule = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        if (!cancelled) fn();
      }, ms);
      timers.push(id);
    };

    const runCycle = () => {
      const variant = BLINK_POOL[Math.floor(Math.random() * BLINK_POOL.length)];

      let blinkDuration = 140;
      if (variant === 'single') {
        setClosedEyes({ left: true, right: true, slow: false });
        schedule(() => setClosedEyes({ left: false, right: false, slow: false }), 140);
      } else if (variant === 'double') {
        blinkDuration = 350;
        setClosedEyes({ left: true, right: true, slow: false });
        schedule(() => setClosedEyes({ left: false, right: false, slow: false }), 115);
        schedule(() => setClosedEyes({ left: true, right: true, slow: false }), 230);
        schedule(() => setClosedEyes({ left: false, right: false, slow: false }), 350);
      } else if (variant === 'slow') {
        blinkDuration = 270;
        setClosedEyes({ left: true, right: true, slow: true });
        schedule(() => setClosedEyes({ left: false, right: false, slow: true }), 270);
      } else if (variant === 'wink-left') {
        blinkDuration = 260;
        setClosedEyes({ left: true, right: false, slow: false });
        schedule(() => setClosedEyes({ left: false, right: false, slow: false }), 260);
      } else {
        blinkDuration = 260;
        setClosedEyes({ left: false, right: true, slow: false });
        schedule(() => setClosedEyes({ left: false, right: false, slow: false }), 260);
      }

      // Pause between blinks: min 15s, max 35s
      const nextPause = 15000 + Math.floor(Math.random() * 20001);
      schedule(runCycle, blinkDuration + nextPause);
    };

    const initialDelay = 700 + Math.floor(Math.random() * 2800);
    schedule(runCycle, initialDelay);

    return () => {
      cancelled = true;
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  return closedEyes;
}

interface AvatarOrbProps {
  profile: Pick<UserProfile, 'id' | 'name'> & {
    avatar_color?: string;
    is_admin?: boolean;
    has_pin?: boolean;
  };
  interactive?: boolean;
  roam?: boolean;
  facing?: 'center' | 'left';
  noTrigger?: number;
  sizeClass?: string;
  eyesRef?: React.RefObject<HTMLDivElement>;
  eyeShiftClass?: string;
  showLock?: boolean;
  onClick?: () => void;
  title?: string;
  className?: string;
}

export function AvatarOrb({
  profile,
  interactive = false,
  roam = true,
  facing = 'center',
  noTrigger = 0,
  sizeClass = AVATAR_CONFIG.orb.sizeClass,
  eyesRef,
  eyeShiftClass = '',
  showLock = false,
  onClick,
  title,
  className = '',
}: AvatarOrbProps) {
  const theme = getProfileAvatarTheme(profile);
  const blink = useRandomBlink();

  const [isJoy, setIsJoy] = useState(false);
  const [noAnimKey, setNoAnimKey] = useState(0);
  const joyTimerRef = useRef<number | null>(null);
  const noTimerRef = useRef<number | null>(null);
  const orbWrapperRef = useRef<HTMLDivElement | null>(null);
  const orbTiltRef = useRef<HTMLDivElement | null>(null);
  const internalEyesRef = useRef<HTMLDivElement | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      if (joyTimerRef.current) window.clearTimeout(joyTimerRef.current);
      if (noTimerRef.current) window.clearTimeout(noTimerRef.current);
    };
  }, []);

  const prevNoTriggerRef = useRef(noTrigger);

  useEffect(() => {
    if (noTrigger <= prevNoTriggerRef.current) {
      prevNoTriggerRef.current = noTrigger;
      return;
    }
    prevNoTriggerRef.current = noTrigger;
    setNoAnimKey(noTrigger);
    if (noTimerRef.current) window.clearTimeout(noTimerRef.current);
    noTimerRef.current = window.setTimeout(() => {
      setNoAnimKey(0);
    }, 680);
  }, [noTrigger]);

  useEffect(() => {
    if (!roam) return;
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    // 8 edge & mid-edge gaze points only (never looking at the center / user)
    const ROAM_ZONES = [
      { x: -1, y: -0.95 }, // top-left corner
      { x: 0, y: -1 },     // top mid-edge
      { x: 1, y: -0.95 },  // top-right corner
      { x: 1, y: 0 },      // right mid-edge
      { x: 1, y: 0.95 },   // bottom-right corner
      { x: 0, y: 1 },      // bottom mid-edge
      { x: -1, y: 0.95 },  // bottom-left corner
      { x: -1, y: 0 },     // left mid-edge
    ];

    const roamTarget = { x: 0, y: 0 };
    const current = { x: 0, y: 0 };
    let lastRoamZone = -1;
    let rafId = 0;
    let nextRoamTimer: number | null = null;

    const pickRoamTarget = (initial = false) => {
      let zoneIdx: number;
      if (initial && facing === 'left') {
        // Start angled naturally to the left by default
        const leftZones = [0, 6, 7];
        zoneIdx = leftZones[Math.floor(Math.random() * leftZones.length)];
      } else {
        zoneIdx = Math.floor(Math.random() * ROAM_ZONES.length);
        if (zoneIdx === lastRoamZone) {
          zoneIdx =
            (zoneIdx + 1 + Math.floor(Math.random() * (ROAM_ZONES.length - 1))) %
            ROAM_ZONES.length;
        }
      }
      lastRoamZone = zoneIdx;
      const zone = ROAM_ZONES[zoneIdx];
      const radial = 0.85 + Math.random() * 0.15;
      const jitterX = (Math.random() - 0.5) * 1.0;
      const jitterY = (Math.random() - 0.5) * 0.65;

      if (facing === 'left') {
        // Compensate for the left-angled base offset (pr-5 ≈ -10px) so right glances clear the center
        if (zone.x > 0) {
          roamTarget.x = 17.5 * radial + jitterX;
        } else if (zone.x < 0) {
          roamTarget.x = -5.5 * radial + jitterX;
        } else {
          roamTarget.x = -2 + jitterX;
        }
        roamTarget.y = zone.y * 5.2 * radial + jitterY;
      } else {
        roamTarget.x = zone.x * 7.6 * radial + jitterX;
        roamTarget.y = zone.y * 4.8 * radial + jitterY;
      }
    };

    const scheduleNextRoam = () => {
      if (nextRoamTimer) window.clearTimeout(nextRoamTimer);
      // Irregular random timing (~1.4s to ~8.2s)
      const waitMs = 1400 + Math.pow(Math.random(), 1.35) * 6800;
      nextRoamTimer = window.setTimeout(() => {
        pickRoamTarget(false);
        scheduleNextRoam();
      }, waitMs);
    };

    // Start on a random edge point immediately (never center)
    pickRoamTarget(true);
    current.x = roamTarget.x;
    current.y = roamTarget.y;

    const tick = () => {
      const ease = 0.07;
      current.x += (roamTarget.x - current.x) * ease;
      current.y += (roamTarget.y - current.y) * ease;

      const nx = current.x / 8.5;
      const ny = current.y / 5.5;

      const eyeEl = eyesRef?.current ?? internalEyesRef.current;
      if (eyeEl) {
        eyeEl.style.transform = `translate3d(${current.x.toFixed(2)}px, ${current.y.toFixed(2)}px, 0)`;
      }

      if (orbTiltRef.current) {
        const tiltNormX = facing === 'left' ? Math.max(-1, Math.min(1, (current.x - 6) / 11.5)) : nx;
        const rotY = tiltNormX * 4.5;
        const rotX = -ny * 4.0;
        const shiftX = tiltNormX * 1.9;
        const shiftY = current.y * 0.22;
        orbTiltRef.current.style.transform = `perspective(520px) translate3d(${shiftX.toFixed(2)}px, ${shiftY.toFixed(2)}px, 0) rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg)`;
      }

      if (highlightRef.current) {
        const hlNormX = facing === 'left' ? Math.max(-1, Math.min(1, (current.x - 6) / 11.5)) : nx;
        const hx = hlNormX * 3.5;
        const hy = current.y * 0.36;
        highlightRef.current.style.transform = `translate3d(${hx.toFixed(2)}px, ${hy.toFixed(2)}px, 0) rotate(-12deg)`;
      }

      rafId = window.requestAnimationFrame(tick);
    };

    scheduleNextRoam();
    rafId = window.requestAnimationFrame(tick);

    return () => {
      if (nextRoamTimer) window.clearTimeout(nextRoamTimer);
      window.cancelAnimationFrame(rafId);
    };
  }, [roam, eyesRef, facing]);

  const handleOrbClick = () => {
    if (interactive) {
      setIsJoy(true);
      if (joyTimerRef.current) window.clearTimeout(joyTimerRef.current);
      joyTimerRef.current = window.setTimeout(() => {
        setIsJoy(false);
      }, 950);
    }
    onClick?.();
  };

  const orbClasses = `${sizeClass} rounded-full relative flex items-center justify-center overflow-hidden transition-all duration-300 ${theme.orb} ${
    profile.is_admin ? 'ring-2 ring-amber-400/50' : ''
  } ${interactive || onClick ? 'cursor-pointer active:scale-95' : ''} ${className}`;

  const blinkTransition = blink.slow ? 'duration-200' : 'duration-100';

  const renderFace = () => {
    if (isJoy) {
      return (
        <div className={`flex items-center ${AVATAR_CONFIG.orb.eyeGapClass}`}>
          <svg
            width="16"
            height="14"
            viewBox="0 0 16 14"
            fill="none"
            className="text-zinc-950/90 shrink-0"
          >
            <path
              d="M2.5 10.5Q8 0.5 13.5 10.5"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <svg
            width="16"
            height="14"
            viewBox="0 0 16 14"
            fill="none"
            className="text-zinc-950/90 shrink-0"
          >
            <path
              d="M2.5 10.5Q8 0.5 13.5 10.5"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
      );
    }

    if (noAnimKey > 0) {
      return (
        <div className={`flex items-center ${AVATAR_CONFIG.orb.eyeGapClass}`}>
          <span className="w-3 h-4 rounded-full bg-zinc-950/90 shadow-inner block transition-all duration-150" />
          <span className="w-3 h-4 rounded-full bg-zinc-950/90 shadow-inner block transition-all duration-150" />
        </div>
      );
    }

    return (
      <div className={`flex items-center ${AVATAR_CONFIG.orb.eyeGapClass}`}>
        <span
          className={`bg-zinc-950/90 shadow-inner block transition-all ease-out ${blinkTransition} ${
            blink.left ? AVATAR_CONFIG.orb.eyeClosedClass : AVATAR_CONFIG.orb.eyeOpenClass
          }`}
        />
        <span
          className={`bg-zinc-950/90 shadow-inner block transition-all ease-out ${blinkTransition} ${
            blink.right ? AVATAR_CONFIG.orb.eyeClosedClass : AVATAR_CONFIG.orb.eyeOpenClass
          }`}
        />
      </div>
    );
  };

  const orbInner = (
    <>
      <div
        ref={highlightRef}
        className={`pointer-events-none absolute ${AVATAR_CONFIG.orb.highlightClass} rounded-full bg-white/40 blur-[2px] -rotate-12 will-change-transform`}
      />

      <div className={eyeShiftClass}>
        <div
          ref={eyesRef ?? internalEyesRef}
          className="will-change-transform"
        >
          {renderFace()}
        </div>
      </div>
    </>
  );

  return (
    <div ref={orbWrapperRef} className="relative animate-avatar-breathe">
      <div className={noAnimKey > 0 ? 'animate-avatar-shake-no' : ''}>
        <div ref={orbTiltRef} className="will-change-transform">
          {interactive || onClick ? (
            <button
              type="button"
              onClick={handleOrbClick}
              title={title ?? (interactive ? 'Klikni na mě' : undefined)}
              className={orbClasses}
              style={theme.swatchStyle}
            >
              {orbInner}
            </button>
          ) : (
            <div className={orbClasses} style={theme.swatchStyle}>
              {orbInner}
            </div>
          )}
        </div>
      </div>

      {showLock && profile.has_pin && (
        <span
          className="absolute bottom-1 right-1 w-7 h-7 rounded-full bg-zinc-950/90 border border-white/15 flex items-center justify-center text-amber-300 shadow-lg"
          title="Chráněno PINem"
        >
          <Lock className="w-3.5 h-3.5" />
        </span>
      )}
    </div>
  );
}
