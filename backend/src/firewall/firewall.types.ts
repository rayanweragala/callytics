export type FirewallEventType = 'blocked' | 'allowed' | 'whitelisted';
export type FirewallEnforcementMode = 'iptables' | 'fail2ban';
export type FirewallLogEventKind = 'failed_registration' | 'invite_flood' | 'auth_failure' | 'allowed_registration';

export interface FirewallConfig {
  enforcementMode: FirewallEnforcementMode;
  threshold: number;
  timeWindowSeconds: number;
  blockDurationSeconds: number | null;
  trunkCeilings: Record<string, number>;
  fail2banInstalled: boolean;
}

export interface FirewallConfigUpdate {
  enforcementMode?: FirewallEnforcementMode;
  threshold?: number;
  timeWindowSeconds?: number;
  blockDurationSeconds?: number | null;
  trunkCeilings?: Record<string, number>;
}

export interface FirewallLogEvent {
  ip: string;
  username: string | null;
  timestamp: string;
  kind: FirewallLogEventKind;
  reason: string;
  detail: string;
}

export interface FirewallBlockedIp {
  id: number;
  ip: string;
  countryCode: string;
  countryName: string;
  attemptCount: number;
  reason: string;
  enforcementMode: FirewallEnforcementMode;
  expiresAt: string | null;
  createdAt: string;
  isWhitelisted: boolean;
}

export interface FirewallEventItem {
  id: number;
  ip: string;
  countryCode: string;
  countryName: string;
  eventType: FirewallEventType;
  reason: string;
  detail: string;
  createdAt: string;
}

export interface FirewallFeedEvent {
  ip: string;
  countryCode: string;
  countryName: string;
  eventType: FirewallEventType;
  reason: string;
  detail: string;
  createdAt: string;
}

export interface FirewallStats {
  totalBlockedToday: number;
  totalAttemptsToday: number;
  topIps: Array<{ ip: string; countryCode: string; attemptCount: number }>;
  topCountries: Array<{ countryCode: string; countryName: string; count: number }>;
  hourly: Array<{ hour: number; count: number }>;
  trunks: Array<{ id: number; name: string; activeCalls: number; ceiling: number }>;
}

export interface FirewallPreflightStatus {
  fail2banInstalled: boolean;
}
