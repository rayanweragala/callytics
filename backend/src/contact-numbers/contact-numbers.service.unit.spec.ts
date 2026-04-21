import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ContactNumbersService } from './contact-numbers.service';
import { ContactNumberEntity } from './entities/contact-number.entity';

describe('ContactNumbersService', () => {
  let service: ContactNumbersService;
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  };

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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContactNumbersService,
        { provide: getRepositoryToken(ContactNumberEntity), useValue: mockRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<ContactNumbersService>(ContactNumbersService);
    repo = module.get(getRepositoryToken(ContactNumberEntity));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('create inserts row and returns contact number fields', async () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const dto = {
      label: 'Alice Mobile',
      number: '+94714008762',
      trunk_id: 2,
      notes: 'After hours',
    };
    const entity = {
      id: 11,
      label: 'Alice Mobile',
      number: '+94714008762',
      trunkId: 2,
      notes: 'After hours',
      createdAt: now,
    };

    repo.create.mockReturnValue(entity);
    repo.save.mockResolvedValue(entity);

    const result = await service.create(dto);

    expect(repo.create).toHaveBeenCalledWith({
      label: 'Alice Mobile',
      number: '+94714008762',
      trunkId: 2,
      notes: 'After hours',
    });
    expect(result.data).toEqual({
      id: 11,
      label: 'Alice Mobile',
      number: '+94714008762',
      trunkId: 2,
      notes: 'After hours',
      createdAt: now.toISOString(),
    });
  });

  it('findAll/list returns array and preserves trunk mapping when trunk_id exists', async () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    repo.find.mockResolvedValue([
      {
        id: 1,
        label: 'Sales Hotline',
        number: '+18005551234',
        trunkId: 3,
        notes: null,
        createdAt: now,
      },
    ]);

    const result = await service.list();

    expect(repo.find).toHaveBeenCalledWith({ order: { label: 'ASC' } });
    expect(result.data).toEqual([
      {
        id: 1,
        label: 'Sales Hotline',
        number: '+18005551234',
        trunkId: 3,
        notes: null,
        createdAt: now.toISOString(),
      },
    ]);
  });

  it('update changes label, number, trunk_id, and notes and returns updated row', async () => {
    const existing = {
      id: 9,
      label: 'Old Label',
      number: '0710000000',
      trunkId: null,
      notes: null,
      createdAt: new Date('2026-04-20T10:00:00.000Z'),
    };
    const saved = {
      ...existing,
      label: 'New Label',
      number: '+94711111111',
      trunkId: 5,
      notes: 'VIP route',
    };

    repo.findOne.mockResolvedValue(existing);
    repo.save.mockResolvedValue(saved);

    const result = await service.update(9, {
      label: 'New Label',
      number: '+94711111111',
      trunk_id: 5,
      notes: 'VIP route',
    });

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 9,
        label: 'New Label',
        number: '+94711111111',
        trunkId: 5,
        notes: 'VIP route',
      }),
    );
    expect(result.data).toEqual({
      id: 9,
      label: 'New Label',
      number: '+94711111111',
      trunkId: 5,
      notes: 'VIP route',
      createdAt: existing.createdAt.toISOString(),
    });
  });

  it('remove deletes row and throws NotFoundException when id is missing', async () => {
    repo.findOne.mockResolvedValueOnce({ id: 22 });

    const removed = await service.remove(22);
    expect(repo.delete).toHaveBeenCalledWith({ id: 22 });
    expect(removed).toEqual({ data: { id: 22, deleted: true } });

    repo.findOne.mockResolvedValueOnce(null);
    await expect(service.remove(99)).rejects.toThrow(NotFoundException);
  });
});
