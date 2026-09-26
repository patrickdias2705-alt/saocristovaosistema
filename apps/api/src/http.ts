import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z, ZodError } from 'zod';
import { AuthGuard, AuthService, type AuthRequest } from './auth';
import { PackageService } from './packages';
import { OCRService } from './ocr';
import { AdminService } from './admin';
import { NotificationWorker } from './notifications';
import type { Config } from './config';
import {
  receiveSchema,
  commandSchema,
  residentSchema,
  unitSchema,
  memberSchema,
} from '@sc/validation';
// Zod emits OpenAPI 3.0-compatible JSON; the two libraries model schema unions differently.
const bodyDoc = (schema: z.ZodType) =>
  ({
    schema: z.toJSONSchema(schema, { target: 'openapi-3.0', unrepresentable: 'any' }),
  }) as Parameters<typeof ApiBody>[0];
@Catch()
export class SafeErrors implements ExceptionFilter {
  catch(e: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const code = (e as { code?: string })?.code;
    const status =
      e instanceof HttpException
        ? e.getStatus()
        : e instanceof ZodError
          ? 400
          : code === '42501'
            ? 403
            : ['23503', '23505', '23514'].includes(code || '')
              ? 409
              : 500;
    let message = 'Não foi possível concluir a operação. Tente novamente.';
    if (e instanceof ZodError)
      message = 'Confira os campos informados e a confirmação do destinatário.';
    else if (e instanceof HttpException) message = e.message;
    else if (status === 403) message = 'Operação não autorizada.';
    else if (status === 409)
      message = 'Os dados estão em conflito. Confira a unidade e atualize a tela.';
    // Never serialize a database/provider exception: it may contain personal data.
    response.status(status).json({ message, requestId: response.getHeader('X-Request-Id') });
  }
}
@ApiTags('session')
@Controller()
export class SessionController {
  constructor(@Inject(AuthService) private auth: AuthService) {}
  @Get('health') health() {
    return { status: 'ok' };
  }
  @Get('config') config() {
    return {
      demo: this.auth.config.APP_MODE === 'demo',
      supabaseUrl: this.auth.config.SUPABASE_URL || null,
      supabaseAnonKey: this.auth.config.SUPABASE_ANON_KEY || null,
    };
  }
  @Post('auth/demo') demo(@Body() body: unknown) {
    return this.auth.demoLogin(body);
  }
  @UseGuards(AuthGuard) @Get('me') me(@Req() req: AuthRequest) {
    return this.auth.context(req.userId);
  }
  @UseGuards(AuthGuard) @Post('auth/logout') logout(@Req() req: AuthRequest) {
    this.auth.logout(req.headers.authorization!.slice(7));
    return { ok: true };
  }
}
@ApiTags('operations')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Condominium-Id', required: true })
@UseGuards(AuthGuard)
@Controller()
export class OperationsController {
  constructor(
    @Inject(PackageService) private packages: PackageService,
    @Inject(OCRService) private ocr: OCRService,
    @Inject(AdminService) private admin: AdminService,
    @Inject(NotificationWorker) private notifications: NotificationWorker,
  ) {}
  @Get('catalog') catalog(@Req() r: AuthRequest) {
    return this.admin.catalog(r.scope);
  }
  @Get('overview') overview(@Req() r: AuthRequest, @Query('gatehouseId') gate: unknown) {
    return this.packages.overview(r.scope, z.uuid().parse(gate));
  }
  @Get('admin/members') members(@Req() r: AuthRequest) {
    return this.admin.members(r.scope);
  }
  @Post('residents/match') match(@Req() r: AuthRequest, @Body() b: unknown) {
    return this.packages.candidates(r.scope, b);
  }
  @Post('ocr')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['gatehouseId', 'file'],
      properties: {
        gatehouseId: { type: 'string', format: 'uuid' },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 1 } }),
  )
  ocrImage(
    @Req() r: AuthRequest,
    @Body('gatehouseId') gate: unknown,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.ocr.process(r.scope, z.uuid().parse(gate), file);
  }
  @Post('packages')
  @ApiOperation({ summary: 'Confirma destinatário e registra encomenda atomicamente' })
  @ApiBody(bodyDoc(receiveSchema))
  async receive(@Req() r: AuthRequest, @Body() b: unknown) {
    const result = await this.packages.receive(r.scope, b);
    if (process.env.VERCEL) await this.notifications.tick();
    return result;
  }
  @Get('packages') search(
    @Req() r: AuthRequest,
    @Query('gatehouseId') gate: unknown,
    @Query('q') q: unknown,
  ) {
    return this.packages.search(
      r.scope,
      z.uuid().parse(gate),
      z.string().max(100).default('').parse(q),
    );
  }
  @Post('packages/find-pin') find(@Req() r: AuthRequest, @Body() b: unknown) {
    const v = z.object({ gatehouseId: z.uuid(), pin: z.string().regex(/^\d{6}$/) }).parse(b);
    return this.packages.findPin(r.scope, v.gatehouseId, v.pin);
  }
  @Get('packages/:id') detail(@Req() r: AuthRequest, @Param('id') id: string) {
    return this.packages.detail(r.scope, z.uuid().parse(id));
  }
  @Post('packages/:id/commands') @ApiBody(bodyDoc(commandSchema)) command(
    @Req() r: AuthRequest,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.packages.command(r.scope, z.uuid().parse(id), b);
  }
  @Get('admin/dashboard') dashboard(@Req() r: AuthRequest) {
    return this.admin.dashboard(r.scope);
  }
  @Get('admin/residents') residents(@Req() r: AuthRequest) {
    return this.admin.residents(r.scope);
  }
  @Post('admin/residents') @ApiBody(bodyDoc(residentSchema)) addResident(
    @Req() r: AuthRequest,
    @Body() b: unknown,
  ) {
    return this.admin.createResident(r.scope, b);
  }
  @Post('admin/units') @ApiBody(bodyDoc(unitSchema)) addUnit(
    @Req() r: AuthRequest,
    @Body() b: unknown,
  ) {
    return this.admin.createUnit(r.scope, b);
  }
  @Post('admin/memberships') @ApiBody(bodyDoc(memberSchema)) member(
    @Req() r: AuthRequest,
    @Body() b: unknown,
  ) {
    return this.admin.assignMember(r.scope, b);
  }
}
const webhookSchema = z.object({
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          value: z.object({
            statuses: z.array(z.object({ id: z.string(), status: z.string() })).optional(),
          }),
        }),
      ),
    }),
  ),
});
@Controller('webhooks/whatsapp')
export class WebhookController {
  constructor(
    @Inject('CONFIG') private config: Config,
    @Inject(NotificationWorker) private worker: NotificationWorker,
  ) {}
  @Get() verify(@Query() q: Record<string, string>, @Res() res: Response) {
    if (
      this.config.META_WHATSAPP_VERIFY_TOKEN &&
      q['hub.mode'] === 'subscribe' &&
      q['hub.verify_token'] === this.config.META_WHATSAPP_VERIFY_TOKEN
    )
      return res.type('text').send(q['hub.challenge']);
    return res.sendStatus(403);
  }
  @Post() async receive(@Req() req: Request & { rawBody?: Buffer }, @Res() res: Response) {
    if (!this.config.META_APP_SECRET || !req.rawBody) return res.sendStatus(403);
    const expected = Buffer.from(
      `sha256=${createHmac('sha256', this.config.META_APP_SECRET).update(req.rawBody).digest('hex')}`,
    );
    const actual = Buffer.from(String(req.headers['x-hub-signature-256'] || ''));
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return res.sendStatus(403);
    const payload = webhookSchema.safeParse(req.body);
    if (!payload.success) return res.sendStatus(400);
    for (const entry of payload.data.entry)
      for (const change of entry.changes)
        for (const status of change.value.statuses || []) {
          if (
            status.status === 'delivered' ||
            status.status === 'read' ||
            status.status === 'failed'
          )
            await this.worker.delivery(status.id, status.status);
        }
    return res.sendStatus(200);
  }
}
