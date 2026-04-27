export type BackupType = 'full' | 'db_only' | 'recordings_only';
export type BackupStatus = 'pending' | 'running' | 'complete' | 'failed';
export type BackupInterval = 'daily' | 'weekly' | 'custom';

export interface BackupHistoryResponse {
  id: number;
  filename: string;
  sizeBytes: number;
  type: BackupType;
  status: BackupStatus;
  createdAt: string;
  notes: string | null;
}

export interface BackupConfigResponse {
  id: number;
  enabled: boolean;
  interval: BackupInterval;
  cronExpression: string | null;
  includeRecordings: boolean;
  retentionCount: number;
  updatedAt: string;
  nextRunAt: string | null;
}

export interface BackupProgressEvent {
  percentage: number;
  step: string;
}

export interface BackupCompleteEvent {
  filename: string;
  sizeBytes: number;
}

export interface BackupErrorEvent {
  message: string;
}
