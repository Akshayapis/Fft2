export const money = (value) => `₹${(Number(value) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export function dateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function dateOnly(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function relative(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (Math.abs(mins) < 1) return 'just now';
  if (Math.abs(mins) < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return `${days}d ago`;
  return dateOnly(iso);
}

export const STATUS_LABEL = {
  registration_open: 'Registration open',
  paused: 'Paused',
  registration_closed: 'Registration closed',
  live: 'Live',
  completed: 'Completed',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

export const statusTone = (status) => {
  if (status === 'live') return 'pink';
  if (status === 'registration_open') return 'green';
  if (status === 'paused' || status === 'registration_closed') return 'amber';
  if (status === 'cancelled' || status === 'expired') return 'red';
  if (status === 'completed') return 'violet';
  return 'slate';
};

export const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const fromLocalInput = (value) => (value ? new Date(value).toISOString() : '');

export const txLabel = (type) =>
  ({
    deposit: 'Deposit',
    deposit_request: 'Deposit request',
    withdrawal: 'Withdrawal',
    withdrawal_hold: 'Withdrawal hold',
    withdrawal_reversal: 'Withdrawal reversal',
    entry_fee: 'Entry fee',
    refund: 'Refund',
    prize: 'Prize',
    bonus: 'Bonus',
    admin_adjust: 'Admin adjustment',
    transfer_in: 'Transfer in',
    transfer_out: 'Transfer out',
  }[type] || type);
