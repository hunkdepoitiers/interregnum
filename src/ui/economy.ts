import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { economyEpoch, query, status, world } from '../bridge/client';
import { dayToDate } from '../sim/calendar';
import type { CharacterReport, ProvinceReport, RealmReport } from '../worker/protocol';

/** Realm whose treasury screen is open; 0 = closed. */
export const treasuryOpen = signal(0);

/** Hundredths of a ducat as whole ducats: "1,234". */
export function money(h: number): string {
  return Math.trunc(h / 100).toLocaleString('en');
}

/** Signed, for ledger lines and monthly balances: "+1,234", "−56". */
export function signedMoney(h: number): string {
  const n = Math.trunc(h / 100);
  return `${n < 0 ? '−' : '+'}${Math.abs(n).toLocaleString('en')}`;
}

/** Hundredths of a percent as "7.5%". */
export function percent(h: number): string {
  return `${Math.round(h / 10) / 10}%`;
}

/**
 * A realm's or province's money from the worker, refetched when the month turns, after commands, and when the
 * world changes (ownership, modifiers).
 */
export function useReport(q: { kind: 'realm'; id: number } | null): RealmReport | null;
export function useReport(q: { kind: 'province'; id: number } | null): ProvinceReport | null;
export function useReport(q: { kind: 'character'; id: number } | null): CharacterReport | null;
export function useReport(q: { kind: 'realm' | 'province' | 'character'; id: number } | null): RealmReport | ProvinceReport | CharacterReport | null {
  const [data, setData] = useState<RealmReport | ProvinceReport | CharacterReport | null>(null);
  const key = q ? `${q.kind}:${q.id}` : '';
  const d = dayToDate(status.value.day);
  const month = d.year * 12 + d.month;
  const epoch = economyEpoch.value;
  const w = world.value;
  useEffect(() => {
    if (!q) {
      setData(null);
      return;
    }
    let live = true;
    const ask = q.kind === 'realm' ? query({ kind: 'realm', id: q.id }) : q.kind === 'province' ? query({ kind: 'province', id: q.id }) : query({ kind: 'character', id: q.id });
    void ask.then((r) => { if (live) setData(r); });
    return () => { live = false; };
  }, [key, month, epoch, w]);
  return data;
}
