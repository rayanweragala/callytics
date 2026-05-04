import { IsBoolean, IsIn, IsInt, IsIP, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import type { FirewallEnforcementMode } from './firewall.types';

export class UpdateFirewallConfigDto {
  @IsOptional()
  @IsIn(['iptables', 'fail2ban'])
  enforcementMode?: FirewallEnforcementMode;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  threshold?: number;

  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(3600)
  timeWindowSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  blockDurationSeconds?: number | null;

  @IsOptional()
  trunkCeilings?: Record<string, number>;
}

export class ManualFirewallBlockDto {
  @IsIP()
  ip!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class FirewallWhitelistDto {
  @IsIP()
  ip!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
