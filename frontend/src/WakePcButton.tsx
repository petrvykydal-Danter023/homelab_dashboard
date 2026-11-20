import React, { useCallback, useEffect, useState } from 'react';
import { Zap } from 'lucide-react';

interface WakePcButtonProps {
  onToast?: (ok: boolean, text: string) => void;
}

export const WakePcButton: React.FC<WakePcButtonProps> = ({ onToast }) => {
  const [pcOnline, setPcOnline] = useState<boolean | null>(null);
  const [pcHost, setPcHost] = useState('petruvkomp');
  const [pcIp, setPcIp] = useState('10.0.1.46');
  const [waking, setWaking] = useState(false);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/system/wol/status');
      if (!res.ok) return;
      const json = await res.json();
      if (typeof json.online === 'boolean') setPcOnline(json.online);
      if (typeof json.host === 'string') setPcHost(json.host);
      if (typeof json.ip === 'string') setPcIp(json.ip);
    } catch {
      // Ignore transient poll errors
    }
  }, []);

  useEffect(() => {
    void checkStatus();
    const timer = window.setInterval(() => void checkStatus(), 15000);
    return () => window.clearInterval(timer);
  }, [checkStatus]);

  const handleWake = async () => {
    setWaking(true);
    try {
      const res = await fetch('/api/system/wol', { method: 'POST' });
      const json = await res.json();
      onToast?.(
        Boolean(json.ok),
        json.message || 'Magic Packet odeslán — probouzím PC!'
      );
      if (typeof json.online === 'boolean') setPcOnline(json.online);
      window.setTimeout(() => void checkStatus(), 3000);
      window.setTimeout(() => void checkStatus(), 8000);
    } catch {
      onToast?.(false, 'Nepodařilo se odeslat Wake-on-LAN paket.');
    } finally {
      setWaking(false);
    }
  };

  const statusText =
    pcOnline === true ? 'online' : pcOnline === false ? 'spí / vypnuto' : 'ověřuji';

  return (
    <button
      type="button"
      onClick={() => void handleWake()}
      disabled={waking}
      title={`${pcHost} (${pcIp}) — ${statusText}. Kliknutím pošleš Wake-on-LAN Magic Packet.`}
      className="px-3 py-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.13] border border-white/[0.1] text-xs font-medium text-white flex items-center gap-1.5 transition-colors disabled:opacity-50 shrink-0"
    >
      <span
        className={`w-2 h-2 rounded-full ${
          pcOnline === true
            ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
            : pcOnline === false
              ? 'bg-zinc-500'
              : 'bg-amber-400/70'
        }`}
      />
      <Zap className={`w-3.5 h-3.5 text-amber-300 ${waking ? 'animate-pulse' : ''}`} />
      <span className="hidden sm:inline">{waking ? 'Probouzím...' : 'Zapnout PC'}</span>
    </button>
  );
};
