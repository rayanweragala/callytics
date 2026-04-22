import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CaptureController } from './capture.controller';
import { CaptureService } from './capture.service';

describe('CaptureController', () => {
  let app: INestApplication;
  const mockService = {
    exportDialogPcap: jest.fn(),
    exportBulkPcap: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CaptureController],
      providers: [{ provide: CaptureService, useValue: mockService }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockService.exportDialogPcap.mockResolvedValue(Buffer.from('dialog-pcap'));
    mockService.exportBulkPcap.mockResolvedValue(Buffer.from('bulk-pcap'));
  });

  it('GET /capture/export/dialog/:callId returns pcap attachment', async () => {
    const response = await request(app.getHttpServer()).get('/capture/export/dialog/call-123');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/vnd.tcpdump.pcap');
    expect(response.headers['content-disposition']).toContain('callytics-dialog-call-123.pcap');
    expect(mockService.exportDialogPcap).toHaveBeenCalledWith('call-123');
  });

  it('GET /capture/export/bulk passes query filters and returns pcap attachment', async () => {
    const response = await request(app.getHttpServer())
      .get('/capture/export/bulk')
      .query({ method: 'INVITE', callId: 'call-1', endpoint: '1001', from: '10:00:00.000', to: '11:00:00.000' });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/vnd.tcpdump.pcap');
    expect(response.headers['content-disposition']).toContain('callytics-capture-export.pcap');
    expect(mockService.exportBulkPcap).toHaveBeenCalledWith({
      method: 'INVITE',
      callId: 'call-1',
      endpoint: '1001',
      from: '10:00:00.000',
      to: '11:00:00.000',
    });
  });
});
