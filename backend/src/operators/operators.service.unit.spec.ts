import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { OperatorsService } from './operators.service';
import { OperatorEntity } from './entities/operator.entity';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-pin'),
}));

describe('OperatorsService', () => {
  let service: OperatorsService;

  const mockRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };

  const mockDataSource = {
    query: jest.fn(),
  };

  const redisMock = {
    get: jest.fn().mockResolvedValue(null),
    sIsMember: jest.fn().mockResolvedValue(false),
    sRem: jest.fn().mockResolvedValue(0),
    del: jest.fn().mockResolvedValue(1),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OperatorsService,
        { provide: getRepositoryToken(OperatorEntity), useValue: mockRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<OperatorsService>(OperatorsService);
    jest.spyOn(service as any, 'getRedisClient').mockResolvedValue(redisMock as any);

    mockRepo.create.mockImplementation((value: any) => ({ ...value }));
    mockRepo.save.mockImplementation(async (value: any) => ({
      id: value.id ?? 1,
      createdAt: value.createdAt ?? new Date('2026-04-20T12:00:00.000Z'),
      ...value,
    }));

    mockDataSource.query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM sip_extensions WHERE id = $1')) {
        const id = Number(params[0]);
        if (id === 101) {
          return [{ id: 101, username: '2001' }];
        }
        return [];
      }

      if (sql.includes('FROM contact_numbers WHERE id = $1')) {
        const id = Number(params[0]);
        if (id === 201) {
          return [{ id: 201, number: '+94714008762' }];
        }
        return [];
      }

      if (sql.includes('FROM operators o')) {
        return [
          {
            extension_id: null,
            extension_username: null,
            extension_transport_type: null,
            contact_id: null,
            contact_label: null,
            contact_number: null,
            contact_trunk_id: null,
          },
        ];
      }

      return [];
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('create operator with extension_id only succeeds', async () => {
    const result = await service.create({ name: 'Alice', extension_id: 101 });

    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Alice',
        extensionId: 101,
        contactNumberId: null,
      }),
    );
    expect(result.data.id).toBe(1);
    expect((bcrypt.hash as jest.Mock)).toHaveBeenCalled();
  });

  it('create operator with contact_number_id only succeeds', async () => {
    const result = await service.create({ name: 'Bob', contact_number_id: 201 });

    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Bob',
        extensionId: null,
        contactNumberId: 201,
      }),
    );
    expect(result.data.id).toBe(1);
  });

  it('create operator with neither extension_id nor contact_number_id succeeds', async () => {
    const result = await service.create({ name: 'Charlie' });

    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Charlie',
        extensionId: null,
        contactNumberId: null,
      }),
    );
    expect(result.data.id).toBe(1);
  });

  it('update hashes provided PIN and list includes structured extension and contactNumber objects when linked', async () => {
    mockDataSource.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('SELECT COUNT(*)::int AS total FROM operators')) {
        return [{ total: 1 }];
      }
      if (sql.includes('FROM operators') && sql.includes('ORDER BY name ASC')) {
        return [
          {
            id: 55,
            name: 'Dana',
            pin_hash: 'hashed',
            extension_id: 301,
            contact_number_id: 401,
            created_at: '2026-04-20T09:00:00.000Z',
            updated_at: '2026-04-20T09:00:00.000Z',
          },
        ];
      }
      if (sql.includes('FROM sip_extensions WHERE id = $1')) {
        if (Number(params[0]) === 301) {
          return [{ id: 301, username: '2002' }];
        }
        return [];
      }
      if (sql.includes('FROM contact_numbers WHERE id = $1')) {
        if (Number(params[0]) === 401) {
          return [{ id: 401, number: '+947****1122' }];
        }
        return [];
      }
      if (sql.includes('FROM operators o')) {
        return [
          {
            extension_id: 301,
            extension_username: '2002',
            extension_password: 'secret2002',
            extension_transport_type: 'webrtc',
            contact_id: 401,
            contact_label: 'Dana Mobile',
            contact_number: '+947****1122',
            contact_trunk_id: 7,
          },
        ];
      }
      return [];
    });

    mockRepo.findOne.mockResolvedValueOnce({ id: 55, name: 'Dana', pinHash: 'old-hash', extensionId: 301, contactNumberId: 401, createdAt: new Date('2026-04-20T09:00:00.000Z') });
    mockRepo.save.mockImplementationOnce(async (value: any) => value);
    await service.update(55, { pin: '123456' });
    expect((bcrypt.hash as jest.Mock)).toHaveBeenCalledWith('123456', 10);

    const result = await service.findAll();

    expect(result.data).toEqual([
      expect.objectContaining({
        id: 55,
        name: 'Dana',
        status: 'offline',
        extension: {
          id: 301,
          username: '2002',
          password: 'secret2002',
          transportType: 'webrtc',
        },
        contactNumber: expect.objectContaining({
          id: 401,
          label: 'Dana Mobile',
          trunkId: 7,
        }),
        hasPIN: true,
        createdAt: '2026-04-20T09:00:00.000Z',
      }),
    ]);
  });

  it('findAll retries without pin when cached schema state is stale and operators.pin is missing', async () => {
    let operatorListCalls = 0;
    mockDataSource.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM information_schema.columns') && sql.includes("column_name = 'pin'")) {
        return [{ '?column?': 1 }];
      }
      if (sql.includes('FROM information_schema.columns') && sql.includes("column_name IN ('callback_number', 'callback_trunk_id')")) {
        return [];
      }
      if (sql.includes('SELECT COUNT(*)::int AS total FROM operators')) {
        return [{ total: 1 }];
      }
      if (sql.includes('FROM operators') && sql.includes('ORDER BY name ASC')) {
        operatorListCalls += 1;
        if (operatorListCalls === 1) {
          throw new Error('column "pin" does not exist');
        }
        return [
          {
            id: 55,
            name: 'Dana',
            pin_hash: 'hashed',
            extension_id: null,
            contact_number_id: null,
            created_at: '2026-04-20T09:00:00.000Z',
            updated_at: '2026-04-20T09:00:00.000Z',
          },
        ];
      }
      if (sql.includes('FROM operators o')) {
        return [
          {
            extension_id: null,
            extension_username: null,
            extension_transport_type: null,
            contact_id: null,
            contact_label: null,
            contact_number: null,
            contact_trunk_id: null,
          },
        ];
      }
      return [];
    });

    const result = await service.findAll();

    expect(operatorListCalls).toBe(2);
    expect(result.data).toEqual([
      expect.objectContaining({
        id: 55,
        name: 'Dana',
        hasPIN: true,
      }),
    ]);
  });
});
