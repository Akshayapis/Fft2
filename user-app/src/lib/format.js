export const money = (value) => {
  const n = Number(value) || 0;
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};

export function relativeTime(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const units = [
    ['year', 31_536_000_000],
    ['month', 2_592_000_000],
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
    ['second', 1_000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms) {
      const value = Math.floor(abs / ms);
      const label = `${value} ${unit}${value > 1 ? 's' : ''}`;
      return diff >= 0 ? `${label} ago` : `in ${label}`;
    }
  }
  return 'just now';
}

export function dateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function dateOnly(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function countdown(iso) {
  if (!iso) return '—';
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'Started';
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  const seconds = Math.floor((diff % 60_000) / 1000);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export const STATUS_LABEL = {
  registration_open: 'Registration open',
  paused: 'Paused',
  registration_closed: 'Registration closed',
  live: 'Live now',
  completed: 'Completed',
  cancelled: 'Cancelled',
  expired: 'Expired',
  upcoming: 'Upcoming',
};

export function statusClass(status) {
  if (status === 'live') return 'live';
  if (status === 'registration_open') return 'open';
  if (['paused', 'registration_closed'].includes(status)) return 'warn';
  if (['cancelled', 'expired'].includes(status)) return 'err';
  if (status === 'completed') return 'closed';
  return 'closed';
}

export function txLabel(type) {
  const map = {
    deposit: 'Deposit',
    deposit_request: 'Deposit request',
    withdrawal: 'Withdrawal',
    withdrawal_hold: 'Withdrawal hold',
    withdrawal_reversal: 'Withdrawal reversed',
    entry_fee: 'Match entry',
    refund: 'Refund',
    prize: 'Prize',
    bonus: 'Bonus',
    admin_adjust: 'Admin adjustment',
    transfer_in: 'From winnings',
    transfer_out: 'To wallet',
    credit: 'Credit',
    debit: 'Debit',
  };
  return map[type] || type;
}

export const initials = (name = '') =>
  name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'P';
