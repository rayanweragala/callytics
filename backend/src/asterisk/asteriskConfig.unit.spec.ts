import { AsteriskConfigService } from './asterisk-config.service';

function createService() {
  return new AsteriskConfigService(
    { find: jest.fn() } as any,
    { find: jest.fn() } as any,
    { query: jest.fn() } as any,
  );
}

describe('AsteriskConfigService config generation', () => {
  it('generates a valid SIP extension endpoint block for a given extension', () => {
    const service = createService();
    const content = (service as any).buildExtensionsConfig([
      { username: '1001', password: 'secret' },
    ]);

    expect(content).toContain('[1001]');
    expect(content).toContain('type = endpoint');
    expect(content).toContain('username = 1001');
    expect(content).toContain('auth = 1001-auth');
  });

  it('generates a valid trunk block for a given trunk record', () => {
    const service = createService();
    const content = (service as any).buildTrunksConfig([
      { id: 7, name: 'ProviderA', host: 'sip.provider.test', port: 5060, username: null, password: null, fromDomain: null, fromUser: null, enabled: true },
    ]);

    expect(content).toContain('[trunk-7]');
    expect(content).toContain('type = endpoint');
    expect(content).toContain('contact = sip:sip.provider.test:5060');
  });

  it('includes transport based on the optional trunk protocol field', () => {
    const service = createService();
    const tcpContent = (service as any).buildTrunksConfig([
      { id: 8, name: 'TCPTrunk', host: 'tcp.provider.test', port: 5061, username: null, password: null, fromDomain: null, fromUser: null, enabled: true, protocol: 'tcp' },
    ]);
    const udpContent = (service as any).buildTrunksConfig([
      { id: 9, name: 'UDPTrunk', host: 'udp.provider.test', port: 5060, username: null, password: null, fromDomain: null, fromUser: null, enabled: true, protocol: 'udp' },
    ]);

    expect(tcpContent).toContain('transport = transport-tcp');
    expect(udpContent).toContain('transport = transport-udp');
  });

  it('generated config contains host with the correct trunk host value', () => {
    const service = createService();
    const content = (service as any).buildTrunksConfig([
      { id: 10, name: 'HostCheck', host: 'sip.hostcheck.test', port: 5070, username: null, password: null, fromDomain: null, fromUser: null, enabled: true },
    ]);

    expect(content).toContain('contact = sip:sip.hostcheck.test:5070');
  });

  it('generated config contains username with the correct extension username', () => {
    const service = createService();
    const content = (service as any).buildExtensionsConfig([
      { username: '2001', password: 'secret' },
    ]);

    expect(content).toContain('username = 2001');
  });

  it('generates correct inbound routes config with one exten line per route and no duplicates', () => {
    const service = createService();
    const content = (service as any).buildInboundRoutesConfig([
      { did: '1234' },
      { did: '5678' },
    ]);

    expect(content).toContain('exten => 1234,1,Stasis(callytics)');
    expect(content).toContain('exten => 5678,1,Stasis(callytics)');
    expect(content.match(/exten => 1234,1,Stasis\(callytics\)/g)).toHaveLength(1);
    expect(content.match(/exten => 5678,1,Stasis\(callytics\)/g)).toHaveLength(1);
  });
});
