import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseIntPipe, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CreateRelayConfigDto } from './dto/create-relay-config.dto';
import { CreateVpnPeerDto } from './dto/create-vpn-peer.dto';
import { VpnService } from './vpn.service';

@Controller('vpn')
export class VpnController {
  constructor(private readonly vpnService: VpnService) {}

  @Get('status')
  getStatus() {
    return this.vpnService.getStatus();
  }

  @Get('peers')
  getPeers() {
    return this.vpnService.listPeers();
  }

  @Post('peers')
  createPeer(@Body() dto: CreateVpnPeerDto) {
    return this.vpnService.createPeer(dto.name);
  }

  @Get('peers/:id/config')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  getPeerConfig(@Param('id', ParseIntPipe) id: number) {
    return this.vpnService.getPeerConfig(id);
  }

  @Get('peers/:id/qr')
  async getPeerQr(@Param('id', ParseIntPipe) id: number, @Res() response: Response): Promise<void> {
    const png = await this.vpnService.getPeerQr(id);
    response.setHeader('Content-Type', 'image/png');
    response.send(png);
  }

  @Delete('peers/:id')
  @HttpCode(204)
  async revokePeer(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.vpnService.revokePeer(id);
  }

  @Delete()
  @HttpCode(200)
  removeVpn() {
    return this.vpnService.removeVpn();
  }

  @Get('relay-guide')
  getRelayGuide() {
    return this.vpnService.getRelayGuide();
  }

  @Post('relay-config')
  @HttpCode(200)
  createRelayConfig(@Body() dto: CreateRelayConfigDto) {
    return this.vpnService.createRelayConfig(dto.vpsPublicKey, dto.vpsPublicIp);
  }
}
