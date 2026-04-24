import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { parsePhoneNumber, type CountryCode } from 'libphonenumber-js';
import { runSqlMigrations } from '../db/run-sql-migrations';
import { CreateContactNumberDto } from './dto/create-contact-number.dto';
import { UpdateContactNumberDto } from './dto/update-contact-number.dto';
import { ContactNumberEntity } from './entities/contact-number.entity';

export interface ContactNumberResponse {
  id: number;
  label: string;
  number: string;
  trunkId: number | null;
  notes: string | null;
  createdAt: string;
}

@Injectable()
export class ContactNumbersService {
  constructor(
    @InjectRepository(ContactNumberEntity)
    private readonly contactNumbersRepository: Repository<ContactNumberEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    await runSqlMigrations(this.dataSource);
  }

  async findAll(page = 1, limit = 10): Promise<{ data: ContactNumberResponse[]; total: number; page: number; limit: number }> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, limit);
    const offset = (safePage - 1) * safeLimit;
    const [items, total] = await this.contactNumbersRepository.findAndCount({
      order: { label: 'ASC' },
      take: safeLimit,
      skip: offset,
    });
    return { data: items.map((item) => this.toResponse(item)), total, page: safePage, limit: safeLimit };
  }

  async findOne(id: number): Promise<{ data: ContactNumberResponse }> {
    const item = await this.contactNumbersRepository.findOne({ where: { id } });
    if (!item) throw new NotFoundException(`Contact number ${id} not found`);
    return { data: this.toResponse(item) };
  }

  async create(dto: CreateContactNumberDto): Promise<{ data: ContactNumberResponse }> {
    const country = this.normalizeCountryCode(dto.country);
    const entity = this.contactNumbersRepository.create({
      label: this.normalizeRequired(dto.label, 'label'),
      number: this.normalizePhoneNumber(this.normalizeRequired(dto.number, 'number'), country),
      trunkId: dto.trunk_id ?? null,
      notes: this.normalizeOptional(dto.notes),
    });

    const saved = await this.contactNumbersRepository.save(entity);
    return { data: this.toResponse(saved) };
  }

  async update(id: number, dto: UpdateContactNumberDto): Promise<{ data: ContactNumberResponse }> {
    const entity = await this.contactNumbersRepository.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`Contact number ${id} not found`);

    if (dto.label !== undefined) entity.label = this.normalizeRequired(dto.label, 'label');
    if (dto.number !== undefined) {
      const country = this.normalizeCountryCode(dto.country);
      entity.number = this.normalizePhoneNumber(this.normalizeRequired(dto.number, 'number'), country);
    }
    if (dto.trunk_id !== undefined) entity.trunkId = dto.trunk_id ?? null;
    if (dto.notes !== undefined) entity.notes = this.normalizeOptional(dto.notes);

    const saved = await this.contactNumbersRepository.save(entity);
    return { data: this.toResponse(saved) };
  }

  async remove(id: number): Promise<{ data: { id: number; deleted: true } }> {
    const entity = await this.contactNumbersRepository.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`Contact number ${id} not found`);
    await this.contactNumbersRepository.delete({ id });
    return { data: { id, deleted: true } };
  }

  private toResponse(item: ContactNumberEntity): ContactNumberResponse {
    return {
      id: item.id,
      label: item.label,
      number: item.number,
      trunkId: item.trunkId,
      notes: item.notes,
      createdAt: item.createdAt.toISOString(),
    };
  }

  private normalizeRequired(value: string | undefined, field: string): string {
    const normalized = (value || '').trim();
    if (!normalized) throw new BadRequestException(`${field} is required`);
    return normalized;
  }

  private normalizeOptional(value?: string): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  private normalizeCountryCode(value?: string): CountryCode {
    const normalized = (value || 'US').trim().toUpperCase();
    if (!normalized) {
      return 'US';
    }
    return normalized as CountryCode;
  }

  private normalizePhoneNumber(value: string, country: CountryCode): string {
    const raw = value.trim();
    let parsed: ReturnType<typeof parsePhoneNumber> | undefined;

    try {
      parsed = parsePhoneNumber(raw);
    } catch {
      try {
        parsed = parsePhoneNumber(raw, country);
      } catch {
        throw new BadRequestException(`number "${value}" is not a valid phone number for country ${country}`);
      }
    }

    if (!parsed || !parsed.isValid()) {
      throw new BadRequestException(`number "${value}" is not a valid phone number for country ${country}`);
    }

    return parsed.format('E.164');
  }
}
