import { Injectable, NotFoundException, OnModuleInit, BadRequestException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join, extname, basename } from 'path';
import { spawn } from 'child_process';
import type { Response } from 'express';
import { DataSource, Repository } from 'typeorm';
import { AudioFileEntity } from './entities/audio-file.entity';

export interface AudioResponse {
  id: number;
  name: string;
  sourceType: string;
  originalFilename: string | null;
  mimeType: string | null;
  durationMs: number | null;
  conversionStatus: string;
  ttsText: string | null;
  ttsVoice: string | null;
  speed: number;
  originalUrl: string | null;
  previewUrl: string | null;
  convertedUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class AudioService implements OnModuleInit {
  private readonly storageRoot = join(process.cwd(), '..', 'storage');
  private readonly audioRoot = join(this.storageRoot, 'audio');
  private readonly originalsDir = join(this.audioRoot, 'originals');
  private readonly convertedDir = join(this.audioRoot, 'converted');
  private readonly previewsDir = join(this.audioRoot, 'previews');
  private readonly ttsDir = join(this.audioRoot, 'tts');
  private readonly voicesDir = join(this.audioRoot, 'voices');

  constructor(
    @InjectRepository(AudioFileEntity)
    private readonly audioRepository: Repository<AudioFileEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureDirectories();
    await this.ensureSchema();
  }

  async list(page = 1, limit = 5): Promise<{ data: AudioResponse[]; total: number; page: number; limit: number; totalPages: number }> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, limit);
    const [items, total] = await this.audioRepository.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });
    const data = items.map((item) => this.toResponse(item));
    return {
      data,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    };
  }

  async getOne(id: number): Promise<{ data: AudioResponse }> {
    const item = await this.audioRepository.findOne({ where: { id } });
    if (!item) throw new NotFoundException(`Audio file ${id} not found`);
    return { data: this.toResponse(item) };
  }

  async listVoices(): Promise<{ data: Array<{ id: string; label: string }>; total: number }> {
    const catalogPath = join(process.cwd(), 'src', 'audio', 'voices.json');
    const catalogRaw = await fs.readFile(catalogPath, 'utf8');
    const catalog = JSON.parse(catalogRaw) as Record<string, unknown>;
    const voices = Object.keys(catalog)
      .sort((a, b) => a.localeCompare(b))
      .map((voice) => ({ id: voice, label: voice }));
    return { data: voices, total: voices.length };
  }

  async upload(file: Express.Multer.File, name?: string): Promise<{ data: AudioResponse }> {
    if (!file) {
      throw new BadRequestException('file is required');
    }

    const idPrefix = randomUUID();
    const extension = extname(file.originalname) || '.bin';
    const originalPath = join(this.originalsDir, `${idPrefix}${extension}`);
    await fs.writeFile(originalPath, file.buffer);

    const asset = this.audioRepository.create({
      name: name?.trim() || basename(file.originalname, extension),
      sourceType: 'upload',
      originalFilename: file.originalname,
      mimeType: file.mimetype || null,
      durationMs: null,
      storagePathOriginal: originalPath,
      storagePathConverted: null,
      storagePathPreview: null,
      conversionStatus: 'processing',
      ttsText: null,
      ttsVoice: null,
      speed: 1,
    });

    const saved = await this.audioRepository.save(asset);
    const processed = await this.processAudio(saved.id, originalPath);
    return { data: this.toResponse(processed) };
  }

  async createTts(name: string, text: string, voice: string, speed = 1): Promise<{ data: AudioResponse }> {
    const trimmedText = text.trim();
    if (!trimmedText) throw new BadRequestException('text is required');

    await this.ensureVoice(voice);
    const normalizedSpeed = this.normalizeSpeed(speed);

    const idPrefix = randomUUID();
    const rawTtsPath = join(this.ttsDir, `${idPrefix}.wav`);
    const modelPath = join(this.voicesDir, `${voice}.onnx`);
    const configPath = join(this.voicesDir, `${voice}.onnx.json`);

    await this.runCommand('piper', this.buildPiperArgs(modelPath, configPath, normalizedSpeed.lengthScale, rawTtsPath), {
      stdin: trimmedText,
    });

    const asset = this.audioRepository.create({
      name: name.trim() || `tts-${idPrefix}`,
      sourceType: 'tts',
      originalFilename: `${idPrefix}.wav`,
      mimeType: 'audio/wav',
      durationMs: null,
      storagePathOriginal: rawTtsPath,
      storagePathConverted: null,
      storagePathPreview: null,
      conversionStatus: 'processing',
      ttsText: trimmedText,
      ttsVoice: voice,
      speed: normalizedSpeed.speed,
    });

    const saved = await this.audioRepository.save(asset);
    const processed = await this.processAudio(saved.id, rawTtsPath);
    return { data: this.toResponse(processed) };
  }

  async previewTts(text: string, voice: string, speed = 1, res: Response): Promise<void> {
    const trimmedText = text.trim();
    if (!trimmedText) throw new BadRequestException('text is required');

    await this.ensureVoice(voice);
    const normalizedSpeed = this.normalizeSpeed(speed);
    const modelPath = join(this.voicesDir, `${voice}.onnx`);
    const configPath = join(this.voicesDir, `${voice}.onnx.json`);

    await new Promise<void>((resolve, reject) => {
      const piper = spawn('piper', [
        '--model',
        modelPath,
        '--config',
        configPath,
        '--length_scale',
        String(normalizedSpeed.lengthScale),
        '--output_raw',
      ]);
      const ffmpeg = spawn('ffmpeg', [
        '-f', 's16le',
        '-ar', '22050',
        '-ac', '1',
        '-i', 'pipe:0',
        '-f', 'wav',
        'pipe:1',
      ]);
      let stderr = '';
      let settled = false;

      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        callback();
      };

      const stopChildren = () => {
        if (!piper.killed) {
          piper.kill('SIGTERM');
        }
        if (!ffmpeg.killed) {
          ffmpeg.kill('SIGTERM');
        }
      };

      const timeout = setTimeout(() => {
        finish(() => {
          stopChildren();
          reject(new BadRequestException('preview timed out after 15 seconds'));
        });
      }, 15000);

      piper.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      ffmpeg.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      piper.on('error', (error) => {
        clearTimeout(timeout);
        finish(() => {
          stopChildren();
          reject(error);
        });
      });
      ffmpeg.on('error', (error) => {
        clearTimeout(timeout);
        finish(() => {
          stopChildren();
          reject(error);
        });
      });
      ffmpeg.on('close', (code) => {
        clearTimeout(timeout);
        if (settled) {
          return;
        }
        finish(() => {
          if (code === 0) {
            resolve();
          } else {
            reject(new BadRequestException(stderr || `ffmpeg failed with exit code ${code}`));
          }
        });
      });

      res.on('error', () => {
        clearTimeout(timeout);
        stopChildren();
      });

      piper.stdout.pipe(ffmpeg.stdin);
      ffmpeg.stdout.pipe(res);
      piper.stdin.write(trimmedText);
      piper.stdin.end();
    });
  }

  async remove(id: number): Promise<{ data: { id: number; deleted: true } }> {
    const item = await this.audioRepository.findOne({ where: { id } });
    if (!item) throw new NotFoundException(`Audio file ${id} not found`);

    const usage = await this.dataSource.query(
      `
        SELECT COUNT(*)::int AS count
        FROM flow_nodes n
        JOIN call_flows f ON f.current_version_id = n.flow_version_id
        WHERE n.config_json ? 'audio_file_id'
          AND (n.config_json ->> 'audio_file_id')::int = $1
      `,
      [id],
    );

    if (Number(usage[0]?.count || 0) > 0) {
      throw new BadRequestException('audio file is used in a published flow');
    }

    await Promise.all([
      this.removeIfExists(item.storagePathOriginal),
      this.removeIfExists(item.storagePathConverted),
      this.removeIfExists(item.storagePathPreview),
    ]);
    await this.audioRepository.delete({ id });
    return { data: { id, deleted: true } };
  }

  private async processAudio(id: number, inputPath: string): Promise<AudioFileEntity> {
    const convertedPath = join(this.convertedDir, `${id}.wav`);
    const ulawPath = join(this.convertedDir, `${id}.ulaw`);
    const previewPath = join(this.previewsDir, `${id}.wav`);

    try {
      await this.runCommand('ffmpeg', ['-y', '-i', inputPath, '-ar', '8000', '-ac', '1', '-c:a', 'pcm_mulaw', convertedPath]);
      await this.runCommand('ffmpeg', ['-y', '-i', inputPath, '-ar', '8000', '-ac', '1', '-acodec', 'pcm_mulaw', '-f', 'mulaw', ulawPath]);
      await this.runCommand('ffmpeg', ['-y', '-i', inputPath, '-ar', '22050', '-ac', '1', '-c:a', 'pcm_s16le', previewPath]);
      const durationMs = await this.getDurationMs(previewPath);

      await this.audioRepository.update(
        { id },
        {
          storagePathConverted: convertedPath,
          storagePathPreview: previewPath,
          durationMs,
          conversionStatus: 'ready',
        },
      );
    } catch (error) {
      await this.audioRepository.update({ id }, { conversionStatus: 'failed' });
      throw error;
    }

    const refreshed = await this.audioRepository.findOne({ where: { id } });
    if (!refreshed) throw new NotFoundException(`Audio file ${id} not found after processing`);
    return refreshed;
  }

  private toResponse(item: AudioFileEntity): AudioResponse {
    return {
      id: item.id,
      name: item.name,
      sourceType: item.sourceType,
      originalFilename: item.originalFilename,
      mimeType: item.mimeType,
      durationMs: item.durationMs,
      conversionStatus: item.conversionStatus,
      ttsText: item.ttsText,
      ttsVoice: item.ttsVoice,
      speed: item.speed ?? 1,
      originalUrl: this.toMediaUrl(item.storagePathOriginal),
      previewUrl: this.toMediaUrl(item.storagePathPreview),
      convertedUrl: this.toMediaUrl(item.storagePathConverted),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private toMediaUrl(filePath: string | null): string | null {
    if (!filePath) return null;
    const relative = filePath.replace(this.storageRoot, '').replace(/^\/+/, '');
    return `/media/${relative}`;
  }

  private async ensureDirectories(): Promise<void> {
    for (const dir of [this.storageRoot, this.audioRoot, this.originalsDir, this.convertedDir, this.previewsDir, this.ttsDir, this.voicesDir]) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  private async ensureSchema(): Promise<void> {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS audio_files (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        source_type VARCHAR(50) NOT NULL,
        original_filename VARCHAR(255),
        mime_type VARCHAR(255),
        duration_ms INTEGER,
        storage_path_original TEXT,
        storage_path_converted TEXT,
        storage_path_preview TEXT,
        conversion_status VARCHAR(50) DEFAULT 'pending',
        tts_text TEXT,
        tts_voice VARCHAR(255),
        speed FLOAT DEFAULT 1.0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await this.dataSource.query(`ALTER TABLE audio_files ADD COLUMN IF NOT EXISTS speed FLOAT DEFAULT 1.0`);
  }

  private normalizeSpeed(speed?: number): { speed: number; lengthScale: number } {
    const numericSpeed = Number(speed ?? 1);
    if (!Number.isFinite(numericSpeed) || numericSpeed < 0.5 || numericSpeed > 2) {
      throw new BadRequestException('speed must be between 0.5 and 2.0');
    }

    return {
      speed: Number(numericSpeed.toFixed(1)),
      lengthScale: Number((1 / numericSpeed).toFixed(4)),
    };
  }

  private buildPiperArgs(modelPath: string, configPath: string, lengthScale: number, outputFile?: string): string[] {
    const args = ['--model', modelPath, '--config', configPath, '--length_scale', String(lengthScale)];
    if (outputFile) {
      args.push('--output_file', outputFile);
    }
    return args;
  }

  private async ensureVoice(voice: string): Promise<void> {
    const modelPath = join(this.voicesDir, `${voice}.onnx`);
    const configPath = join(this.voicesDir, `${voice}.onnx.json`);

    try {
      await fs.access(modelPath);
      await fs.access(configPath);
      return;
    } catch {
      throw new BadRequestException(
        'Voice model not found. Rebuild the backend image to restore bundled voices.',
      );
    }
  }

  private async getDurationMs(filePath: string): Promise<number | null> {
    const result = await this.runCommand('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);
    const durationSeconds = Number(result.stdout.trim());
    if (Number.isNaN(durationSeconds)) return null;
    return Math.round(durationSeconds * 1000);
  }

  private async removeIfExists(filePath: string | null): Promise<void> {
    if (!filePath) return;
    try {
      await fs.unlink(filePath);
    } catch {}
  }

  private async runCommand(
    command: string,
    args: string[],
    options: { cwd?: string; stdin?: string } = {},
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd: options.cwd });
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new BadRequestException(stderr || `${command} failed with exit code ${code}`));
        }
      });

      if (options.stdin) {
        child.stdin.write(options.stdin);
      }
      child.stdin.end();
    });
  }
}
