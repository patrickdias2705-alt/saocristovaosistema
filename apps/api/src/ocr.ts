import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ocrSchema } from '@sc/validation';
import { PackageService, type Scope } from './packages';
import { recordAudit } from './events';
export class OCRService {
  private storage?: SupabaseClient;
  constructor(private packages: PackageService) {
    const e = packages.config;
    if (e.SUPABASE_SERVICE_ROLE_KEY && e.SUPABASE_URL)
      this.storage = createClient(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
  }
  async process(scope: Scope, gate: string, file: Express.Multer.File) {
    if (
      !file ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) ||
      file.size > 4 * 1024 * 1024
    )
      throw new BadRequestException('Use imagem JPEG, PNG ou WebP de até 4 MB.');
    await this.packages.db.transaction(scope.userId, (sql) =>
      this.packages.gate(sql, scope.condominiumId, gate),
    );
    await this.packages.limit(scope, 'ocr', 10);
    let buffer: Buffer;
    try {
      const image = sharp(file.buffer, { limitInputPixels: 16000000 });
      const meta = await image.metadata();
      if (!['jpeg', 'png', 'webp'].includes(meta.format || '') || (meta.pages || 1) > 1)
        throw new Error('Invalid format');
      buffer = await image
        .rotate()
        .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
    } catch {
      throw new BadRequestException('Não foi possível abrir a imagem. Use outra foto.');
    }
    const body = new FormData();
    body.append('file', new Blob([new Uint8Array(buffer)], { type: 'image/jpeg' }), 'label.jpg');
    let result;
    try {
      const endpoint = new URL(
        'recognize',
        `${this.packages.config.OCR_SERVICE_URL.replace(/\/$/, '')}/`,
      );
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'X-Service-Token': this.packages.config.OCR_SERVICE_TOKEN },
        body,
        signal: AbortSignal.timeout(120000),
      });
      if (!response.ok) throw new Error('OCR unavailable');
      result = ocrSchema.parse(await response.json());
    } catch {
      throw new ServiceUnavailableException(
        'Não conseguimos ler a etiqueta com segurança. Tente outra foto ou preencha manualmente.',
      );
    }
    const id = randomUUID();
    const retention = this.packages.config.OCR_IMAGE_RETENTION_DAYS;
    let path: string | null = null;
    if (retention > 0 && this.storage) {
      path = `${scope.condominiumId}/${id}/label.jpg`;
      const { error } = await this.storage.storage
        .from('ocr-labels')
        .upload(path, buffer, { contentType: 'image/jpeg', upsert: false });
      if (error) path = null;
    }
    const { rawText: _rawText, ...fields } = result;
    try {
      await this.packages.db.transaction(scope.userId, async (sql) => {
        await sql.query(
          "insert into public.package_ocr_results(id,condominium_id,gatehouse_id,created_by,fields,provider,processing_ms,image_path,image_expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,now()+($9::integer*interval '1 day'))",
          [
            id,
            scope.condominiumId,
            gate,
            scope.userId,
            JSON.stringify(fields),
            result.provider,
            Math.round(result.processingTime),
            path,
            retention,
          ],
        );
        await recordAudit(sql, scope.condominiumId, gate, scope.userId, 'OCR_PROCESSED', id);
      });
    } catch (e) {
      if (path) await this.storage?.storage.from('ocr-labels').remove([path]);
      throw e;
    }
    const candidates = await this.packages.candidates(scope, {
      name: result.recipientName.value || '',
      block: result.block.value || '',
      apartment: result.apartment.value || '',
    });
    return { id, result, candidates };
  }
  async purgeExpiredImages() {
    if (!this.storage) return;
    const rows = await this.packages.db.transaction(
      null,
      (sql) =>
        sql.query<{ id: string; image_path: string }>(
          'select id,image_path from public.package_ocr_results where image_path is not null and image_expires_at<now() limit 100',
        ),
      true,
    );
    for (const row of rows) {
      const { error } = await this.storage.storage.from('ocr-labels').remove([row.image_path]);
      if (!error)
        await this.packages.db.transaction(
          null,
          (sql) =>
            sql.query('update public.package_ocr_results set image_path=null where id=$1', [
              row.id,
            ]),
          true,
        );
    }
  }
}
