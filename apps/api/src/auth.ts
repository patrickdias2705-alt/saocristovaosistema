import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { z } from 'zod';
import { Database, DEMO_USERS } from './db';
import type { Config } from './config';
import type { Scope } from './packages';
export interface AuthRequest extends Request {
  userId: string;
  scope: Scope;
}
export class AuthService {
  readonly client?: SupabaseClient;
  private sessions = new Map<string, { userId: string; expires: number }>();
  constructor(
    readonly db: Database,
    readonly config: Config,
  ) {
    if (config.APP_MODE === 'supabase')
      this.client = createClient(config.SUPABASE_URL!, config.SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
  }
  demoLogin(input: unknown) {
    if (this.config.APP_MODE !== 'demo') throw new ForbiddenException();
    const { role } = z.object({ role: z.enum(['operator', 'supervisor', 'admin']) }).parse(input);
    for (const [key, s] of this.sessions) if (s.expires < Date.now()) this.sessions.delete(key);
    const token = randomBytes(32).toString('hex');
    this.sessions.set(token, {
      userId: DEMO_USERS[role],
      expires: Date.now() + 4 * 60 * 60 * 1000,
    });
    return { accessToken: token };
  }
  logout(token: string) {
    this.sessions.delete(token);
  }
  async verify(token: string) {
    if (this.config.APP_MODE === 'demo') {
      const s = this.sessions.get(token);
      if (!s || s.expires < Date.now())
        throw new UnauthorizedException('Sua sessão expirou. Entre novamente.');
      return s.userId;
    }
    const result = await this.client!.auth.getUser(token);
    if (result.error || !result.data.user)
      throw new UnauthorizedException('Sua sessão expirou. Entre novamente.');
    return result.data.user.id;
  }
  async context(userId: string) {
    return this.db.transaction(userId, async (sql) => {
      const [profile] = await sql.query<{ display_name: string; is_super_admin: boolean }>(
        'select display_name,is_super_admin from public.profiles where id=$1 and active',
        [userId],
      );
      if (!profile) throw new ForbiddenException('Usuário sem acesso ativo.');
      const memberships = profile.is_super_admin
        ? await sql.query(
            "select id as condominium_id,name,'SUPER_ADMIN' as role from public.condominiums",
          )
        : await sql.query(
            'select m.condominium_id,c.name,m.role from public.memberships m join public.condominiums c on c.id=m.condominium_id where m.user_id=$1 and m.active',
            [userId],
          );
      const gatehouses = await sql.query(
        'select id,name,condominium_id from public.gatehouses order by name',
      );
      return {
        userId,
        displayName: profile.display_name,
        memberships,
        gatehouses,
        demo: this.config.APP_MODE === 'demo',
      };
    });
  }
}
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new UnauthorizedException('Entre para continuar.');
    req.userId = await this.auth.verify(token);
    const c = req.headers['x-condominium-id'];
    const condo = typeof c === 'string' ? z.uuid().parse(c) : '';
    if (condo) {
      const allowed = await this.auth.db.transaction(req.userId, (sql) =>
        sql.query('select id from public.condominiums where id=$1', [condo]),
      );
      if (!allowed.length) throw new ForbiddenException('Condomínio não autorizado.');
    }
    req.scope = { userId: req.userId, condominiumId: condo };
    return true;
  }
}
