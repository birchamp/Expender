export const colors = {
  bg: '#0B1220',
  surface: '#141C2C',
  surfaceAlt: '#1C2739',
  border: '#28344A',
  text: '#EAF0FA',
  textDim: '#94A3B8',
  textFaint: '#64748B',
  accent: '#5B9DF9',
  accentDim: '#1E3A5F',
  success: '#3DD68C',
  warning: '#F5B14C',
  danger: '#F26B6B',
  overlay: 'rgba(4, 8, 16, 0.75)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
};

export const statusColor: Record<string, string> = {
  pending: colors.textDim,
  needs_review: colors.warning,
  confirmed: colors.success,
  failed: colors.danger,
};

export const statusLabel: Record<string, string> = {
  pending: 'Scanning',
  needs_review: 'Needs review',
  confirmed: 'Confirmed',
  failed: 'Scan failed',
};
