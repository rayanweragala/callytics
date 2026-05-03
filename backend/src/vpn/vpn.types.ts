export interface VpnStatusResponse {
  installed: boolean;
  running: boolean | null;
  serverPublicKey: string | null;
  serverPublicKeyError: string | null;
  endpoint: string | null;
  subnet: string | null;
  peerCount: number;
  subnetConflict: boolean;
  subnetConflictDetail: string | null;
}

export type VpnPeerStatus = 'active' | 'idle' | 'offline';

export interface VpnPeerResponse {
  id: number;
  name: string;
  assignedIp: string;
  publicKey: string;
  status: VpnPeerStatus;
  lastHandshake: string | null;
  bytesReceived: number;
  bytesSent: number;
  createdAt: string;
}

export interface CreatedVpnPeerResponse extends VpnPeerResponse {
  privateKey: string;
  config: string;
}

export interface RelayGuideCommand {
  command: string;
  explanation: string;
  verification: string | null;
  verificationExpected: string | null;
}

export interface RelayGuideValue {
  label: string;
  value: string;
}

export interface RelayGuideStep {
  stepNumber: number;
  title: string;
  explanation: string;
  commands: RelayGuideCommand[];
  values?: RelayGuideValue[];
}

export interface RelayTunnelStatusResponse {
  active: boolean;
  handshakeEstablished: boolean;
  vpsPublicIp: string | null;
}

export interface RelayConfigResponse {
  config: string | null;
  vpsPublicKey: string | null;
  vpsPublicIp: string | null;
}
