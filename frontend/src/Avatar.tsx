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
    eyeOpenClass: 'w-3 h-7 rounded-full',
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

      if (variant === 'single') {
        setClosedEyes({ left: true, right: true, slow: false });
        schedule(() => setClosedEyes({ left: false, right: false, slow: false }), 140);
      } else if (variant === 'double') {
        setClosedEyes({ left: true, right: true, slow: false });
        schedule(() => setClosedEyes({ left: false, right: false, slow: false }), 115);
        schedule(() => setClosedEyes({ left: true, right: true, slow: false }), 230);
        schedule(() => setClosedEyes({ left: false, right: false, slow: false }), 350);
      } else if (variant === 'slow') {
        setClosedEyes({ left: true, right: true, slow: true });
        schedule(() => setClosedEyes({ left: false, right: false, slow: true }), 270);
      } else if (variant === 'wink-left') {
        setClosedEyes({ left: true, right: false, slow: false });
        schedule(() => setClosedEyes({ left: false, right: false, slow: false }), 260);
      } else {
        setClosedEyes({ left: false, right: true, slow: false });
        schedule(() => setClosedEyes({ left: false, right: false, slow: false }), 260);
      }

      // Irregular human-like next blink delay (1.9s – 6.2s)
      const nextDelay = 1900 + Math.floor(Math.random() * 4300);
      schedule(runCycle, nextDelay);
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
  const joyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (joyTimerRef.current) window.clearTimeout(joyTimerRef.current);
    };
  }, []);

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
        className={`pointer-events-none absolute ${AVATAR_CONFIG.orb.highlightClass} rounded-full bg-white/40 blur-[2px] -rotate-12`}
      />

      <div
        ref={eyesRef}
        className={`will-change-transform transition-transform duration-300 ${eyeShiftClass}`}
      >
        {renderFace()}
      </div>
    </>
  );

  return (
    <div className="relative">
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
