// The same status has the same colour on either chart and in the task editor.
const tones = {
  neutral: { ink: '#39485e', paper: '#eef2f6', line: '#c5ced9', accent: '#64748b' },
  active: { ink: '#20518c', paper: '#eaf3ff', line: '#b5d2f4', accent: '#3276b8' },
  blocked: { ink: '#8a321e', paper: '#fff0e9', line: '#efc4af', accent: '#b34826' },
  complete: { ink: '#1a5e4b', paper: '#e7f5ee', line: '#aed9c5', accent: '#28815f' },
};
export function statusKind(status) {
  switch (String(status ?? '').trim().toLowerCase()) {
    case '進行中': case 'in progress': return 'active';
    case '受阻': case 'blocked': return 'blocked';
    case '已完成': case 'completed': return 'complete';
    default: return 'neutral';
  }
}

export function statusTone(status) {
  return tones[statusKind(status)];
}
