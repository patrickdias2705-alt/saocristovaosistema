'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CameraOff,
  ImagePlus,
  ScanBarcode,
  PenLine,
  PackageCheck,
  Package,
  Search,
  LogOut,
  Check,
  Building2,
  Clock,
  ShieldCheck,
  ChevronRight,
  LayoutDashboard,
} from 'lucide-react';
import { Button, Field, Notice } from '@sc/ui';
import type { SessionContext, Candidate, Unit, PackageView, PackageDetail } from '@sc/types';
import type { OCRResult } from '@sc/validation';
import { request, labels, eventLabels, date, ApiError } from '../lib/api';
type Screen = 'home' | 'receive' | 'pickup' | 'search' | 'detail' | 'admin';
type Api = <T>(path: string, body?: unknown) => Promise<T>;
type RuntimeConfig = { demo: boolean; supabaseUrl: string | null; supabaseAnonKey: string | null };
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : 'Não foi possível concluir. Tente novamente.';

export default function Page() {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [context, setContext] = useState<SessionContext | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [condo, setCondo] = useState('');
  const [gate, setGate] = useState('');
  const [screen, setScreen] = useState<Screen>('home');
  const [mode, setMode] = useState('photo');
  const [detailId, setDetailId] = useState('');
  const [error, setError] = useState('');
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<PackageView[]>([]);
  const [waiting, setWaiting] = useState(0);
  const supabase = useRef<SupabaseClient | null>(null);
  const main = useRef<HTMLElement>(null);
  const loadConfig = useCallback(() => {
    setError('');
    request<RuntimeConfig>('config', null, null)
      .then((c) => {
        setConfig(c);
        if (!c.demo && c.supabaseUrl && c.supabaseAnonKey) {
          supabase.current = createClient(c.supabaseUrl, c.supabaseAnonKey, {
            auth: { persistSession: false },
          });
        }
      })
      .catch((e) => setError(errorText(e)));
  }, []);
  useEffect(loadConfig, [loadConfig]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  const api = useCallback<Api>(
    async (path, body) => {
      try {
        let current = token;
        if (supabase.current) {
          const { data } = await supabase.current.auth.getSession();
          current = data.session?.access_token || token;
        }
        return await request(path, current, condo, body);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          setContext(null);
          setToken(null);
          setError(e.message);
        }
        throw e;
      }
    },
    [token, condo],
  );
  const login = async (email: string, password: string, role: string) => {
    let access: string;
    if (config?.demo)
      access = (await request<{ accessToken: string }>('auth/demo', null, null, { role }))
        .accessToken;
    else {
      const result = await supabase.current!.auth.signInWithPassword({ email, password });
      if (result.error || !result.data.session)
        throw new Error('Não foi possível entrar. Confira e-mail e senha.');
      access = result.data.session.access_token;
    }
    const ctx = await request<SessionContext>('me', access, null);
    if (!ctx.memberships.length || !ctx.gatehouses.length)
      throw new Error('Seu acesso ainda não tem condomínio e portaria associados.');
    setToken(access);
    setContext(ctx);
    const c = ctx.memberships[0]!.condominium_id;
    setCondo(c);
    setGate(ctx.gatehouses.find((g) => g.condominium_id === c)?.id || '');
    setScreen('home');
    setError('');
  };
  const logout = async () => {
    try {
      await api('auth/logout', {});
      await supabase.current?.auth.signOut();
    } finally {
      setContext(null);
      setToken(null);
      setQueue([]);
      setScreen('home');
    }
  };
  const refresh = useCallback(() => {
    if (token && gate)
      void Promise.all([
        api<PackageView[]>(`packages?gatehouseId=${gate}`),
        api<{ waiting: number }>(`overview?gatehouseId=${gate}`),
      ])
        .then(([rows, summary]) => {
          setQueue(rows);
          setWaiting(summary.waiting);
        })
        .catch((e) => setError(errorText(e)));
  }, [api, token, gate]);
  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 15000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    main.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [screen]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!context || e.ctrlKey || e.metaKey || e.altKey) return;
      if (
        ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName) &&
        e.key !== 'Escape'
      )
        return;
      if (e.key === 'F2') {
        e.preventDefault();
        setMode('photo');
        setScreen('receive');
      } else if (e.key === 'F3') {
        e.preventDefault();
        setScreen('pickup');
      } else if (e.key === 'F4') {
        e.preventDefault();
        setScreen('search');
      } else if (e.key === 'Escape') {
        setScreen('home');
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [context]);
  if (!context) return <Login config={config} onLogin={login} error={error} retry={loadConfig} />;
  const membership = context.memberships.find((m) => m.condominium_id === condo);
  const gates = context.gatehouses.filter((g) => g.condominium_id === condo);
  const gateName = gates.find((g) => g.id === gate)?.name || 'Selecione a portaria';
  const admin = ['CONDO_ADMIN', 'SUPER_ADMIN'].includes(membership?.role || '');
  const openDetail = (id: string) => {
    setDetailId(id);
    setScreen('detail');
  };
  const newPackage = (m: string) => {
    setMode(m);
    setScreen('receive');
  };
  return (
    <>
      <a className="skip" href="#main">
        Pular para conteúdo
      </a>
      {context.demo && (
        <div className="demo-bar">
          Ambiente de demonstração · dados fictícios · WhatsApp simulado
        </div>
      )}
      <header className="header">
        <button className="brand" onClick={() => setScreen('home')} aria-label="Página inicial">
          <span className="brand-mark">
            <Package size={23} />
          </span>
          <span>
            {membership?.name}
            <small>Gestão de encomendas</small>
          </span>
        </button>
        <div className="header-context">
          {context.memberships.length > 1 && (
            <label className="sr-only" htmlFor="condo">
              Condomínio
            </label>
          )}
          {context.memberships.length > 1 && (
            <select
              id="condo"
              value={condo}
              onChange={(e) => {
                setCondo(e.target.value);
                setGate(
                  context.gatehouses.find((g) => g.condominium_id === e.target.value)?.id || '',
                );
                setScreen('home');
              }}
            >
              {context.memberships.map((m) => (
                <option key={m.condominium_id} value={m.condominium_id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
          <Building2 size={18} />
          <label className="sr-only" htmlFor="gate">
            Portaria em operação
          </label>
          <select
            id="gate"
            value={gate}
            onChange={(e) => {
              setGate(e.target.value);
              setScreen('home');
            }}
          >
            {gates.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <span className="user">
            {context.displayName}
            <small>{online ? 'Sessão ativa' : 'Sem conexão'}</small>
          </span>
          <button className="icon-button" onClick={() => void logout()} aria-label="Sair">
            <LogOut size={18} />
          </button>
        </div>
      </header>
      <nav className="nav" aria-label="Operação">
        <button
          aria-current={screen === 'home' || screen === 'receive' ? 'page' : undefined}
          onClick={() => setScreen('home')}
        >
          <Package size={18} />
          Receber <kbd>F2</kbd>
        </button>
        <button
          aria-current={screen === 'pickup' ? 'page' : undefined}
          onClick={() => setScreen('pickup')}
        >
          <PackageCheck size={18} />
          Retirar <kbd>F3</kbd>
        </button>
        <button
          aria-current={screen === 'search' ? 'page' : undefined}
          onClick={() => setScreen('search')}
        >
          <Search size={18} />
          Pesquisar <kbd>F4</kbd>
        </button>
        {admin && (
          <button
            aria-current={screen === 'admin' ? 'page' : undefined}
            onClick={() => setScreen('admin')}
          >
            <LayoutDashboard size={18} />
            Administração
          </button>
        )}
      </nav>
      <main
        id="main"
        ref={main}
        tabIndex={-1}
        className={`main ${screen === 'admin' ? 'admin-main' : ''}`}
      >
        {!online && (
          <Notice error>
            Você está sem conexão. Reconecte-se antes de registrar ou entregar uma encomenda.
          </Notice>
        )}
        {error && (
          <Notice error>
            {error}{' '}
            <button
              onClick={() => {
                setError('');
                refresh();
              }}
            >
              Tentar novamente
            </button>
          </Notice>
        )}
        {screen === 'home' && (
          <>
            <div className="page-heading">
              <div>
                <p className="eyebrow">Operação · {gateName}</p>
                <h1>Uma entrega bem recebida.</h1>
                <p>Registre a chegada. Nós organizamos o próximo passo.</p>
              </div>
              <div className="waiting">
                <strong>{waiting}</strong>
                <span>
                  aguardando retirada
                  <br />
                  <small>nesta portaria</small>
                </span>
              </div>
            </div>
            <section className="receive-panel" aria-labelledby="new-title">
              <div className="receive-intro">
                <span className="step-number">Recebimento</span>
                <h2 id="new-title">Nova encomenda</h2>
                <p>
                  Comece pela etiqueta.
                  <br />
                  Confirme o morador antes de registrar.
                </p>
                <div className="privacy-note">
                  <ShieldCheck size={16} /> Foto tratada com acesso restrito
                </div>
              </div>
              <div className="entry-actions">
                <button className="photo-action" onClick={() => newPackage('photo')}>
                  <Camera size={30} />
                  <span>
                    Fotografar etiqueta<small>Use a câmera ou envie uma foto</small>
                  </span>
                  <ArrowRight size={24} />
                </button>
                <div className="alternative-actions">
                  <button onClick={() => newPackage('scan')}>
                    <ScanBarcode size={23} />
                    <span>
                      Bipar código<small>Leitor ou digitação</small>
                    </span>
                    <ChevronRight size={18} />
                  </button>
                  <button onClick={() => newPackage('manual')}>
                    <PenLine size={23} />
                    <span>
                      Cadastro manual<small>Preencha os dados</small>
                    </span>
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            </section>
            <section className="recent">
              <div className="section-heading">
                <h2>Últimos recebimentos</h2>
                <button className="text-button" onClick={() => setScreen('search')}>
                  Ver encomendas <ArrowRight size={16} />
                </button>
              </div>
              <PackageList packages={queue.slice(0, 5)} open={openDetail} />
            </section>
          </>
        )}
        {screen === 'receive' && (
          <Receive
            key={`${gate}-${mode}`}
            api={api}
            gate={gate}
            mode={mode}
            back={() => setScreen('home')}
            done={(id) => {
              refresh();
              openDetail(id);
            }}
          />
        )}
        {screen === 'pickup' && (
          <Pickup api={api} gate={gate} open={openDetail} refresh={refresh} />
        )}
        {screen === 'search' && <SearchPackages api={api} gate={gate} open={openDetail} />}
        {screen === 'detail' && (
          <Detail
            key={detailId}
            api={api}
            id={detailId}
            back={() => setScreen('search')}
            refresh={refresh}
          />
        )}
        {screen === 'admin' && admin && <Admin api={api} />}
      </main>
      <footer className="footer">
        <span>São Cristóvão Entregas</span>
        <span>Receber com cuidado. Entregar com segurança.</span>
      </footer>
    </>
  );
}

function Login({
  config,
  onLogin,
  error,
  retry,
}: {
  config: RuntimeConfig | null;
  onLogin: (e: string, p: string, r: string) => Promise<void>;
  error: string;
  retry: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('operator');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  return (
    <main className="login-shell">
      <section className="login-story">
        <span className="brand">
          <span className="brand-mark">
            <Package />
          </span>
          São Cristóvão
        </span>
        <div>
          <p className="eyebrow">Entregas do condomínio</p>
          <h1>
            Da portaria
            <br />
            para a pessoa certa.
          </h1>
          <p>
            Cada encomenda identificada.
            <br />
            Cada retirada registrada.
          </p>
          <div className="login-route">
            <span>
              <Camera />
              Receber
            </span>
            <i />
            <span>
              <Check />
              Confirmar
            </span>
            <i />
            <span>
              <PackageCheck />
              Entregar
            </span>
          </div>
        </div>
        <small>Acesso exclusivo à equipe autorizada.</small>
      </section>
      <section className="login-form">
        <div>
          <span className="eyebrow">Bem-vindo à portaria</span>
          <h2>Comece seu atendimento</h2>
          <p>Entre para receber e entregar encomendas.</p>
          {!config ? (
            <>
              <Notice error={!!error}>{error || 'Conectando ao serviço…'}</Notice>
              {error && <Button onClick={retry}>Tentar novamente</Button>}
            </>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setFailure('');
                try {
                  await onLogin(email, password, role);
                } catch (err) {
                  setFailure(errorText(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {config.demo ? (
                <>
                  <Notice>
                    Modo de demonstração. O acesso abaixo é simulado e usa apenas dados fictícios.
                  </Notice>
                  <Field label="Entrar como">
                    <select value={role} onChange={(e) => setRole(e.target.value)}>
                      <option value="operator">Carlos Oliveira · Portaria 01</option>
                      <option value="supervisor">Ana · Supervisora das portarias</option>
                      <option value="admin">Administração do condomínio</option>
                    </select>
                  </Field>
                </>
              ) : (
                <>
                  <Field label="E-mail">
                    <input
                      type="email"
                      autoComplete="username"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </Field>
                  <Field label="Senha">
                    <input
                      type="password"
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </Field>
                </>
              )}
              {(failure || error) && <Notice error>{failure || error}</Notice>}
              <Button disabled={busy} type="submit">
                {busy ? 'Entrando…' : 'Entrar na portaria'}
                <ArrowRight size={18} />
              </Button>
            </form>
          )}
          <p className="login-help">Precisa de acesso? Procure a administração do condomínio.</p>
        </div>
      </section>
    </main>
  );
}

function PackageList({ packages, open }: { packages: PackageView[]; open: (id: string) => void }) {
  return !packages.length ? (
    <div className="empty">
      <Package size={30} />
      <h3>Nenhuma encomenda por aqui</h3>
      <p>Os recebimentos aparecerão nesta lista.</p>
    </div>
  ) : (
    <div className="package-list">
      {packages.map((p) => (
        <button className="package-row" key={p.id} onClick={() => open(p.id)}>
          <span className="package-icon">
            <Package size={21} />
          </span>
          <span className="row-person">
            <strong>{p.recipient_name_raw}</strong>
            <small>
              Bloco {p.block} · Apto {p.apartment}
            </small>
          </span>
          <span className="row-code">
            {p.public_code}
            <small>{date(p.received_at)}</small>
          </span>
          <span className={`status ${p.status.toLowerCase()}`}>{labels[p.status]}</span>
          <ChevronRight size={17} />
        </button>
      ))}
    </div>
  );
}

type CameraStatus = 'opening' | 'live' | 'unavailable';

function CameraCapture({
  busy,
  onCapture,
}: {
  busy: boolean;
  onCapture: (file: File) => Promise<boolean>;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const request = useRef(0);
  const [status, setStatus] = useState<CameraStatus>('opening');
  const [message, setMessage] = useState('Abrindo a câmera traseira…');

  const stopCamera = useCallback(() => {
    request.current += 1;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }, []);

  const startCamera = useCallback(async () => {
    stopCamera();
    const currentRequest = request.current;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setStatus('unavailable');
      setMessage('A câmera interna precisa de HTTPS. Use a câmera do aparelho abaixo.');
      return;
    }
    setStatus('opening');
    setMessage('Abrindo a câmera traseira…');
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1440 },
        },
      });
      if (request.current !== currentRequest) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      if (!video.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      video.current.srcObject = media;
      await video.current.play();
      setStatus('live');
      setMessage('Câmera pronta. Centralize toda a etiqueta dentro da moldura.');
    } catch {
      stopCamera();
      setStatus('unavailable');
      setMessage('Não foi possível acessar a câmera. Confira a permissão ou use a opção abaixo.');
    }
  }, [stopCamera]);

  useEffect(() => {
    void startCamera();
    return stopCamera;
  }, [startCamera, stopCamera]);

  const capture = async () => {
    const source = video.current;
    if (!source || source.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      setMessage('A câmera ainda está preparando a imagem. Tente novamente em um instante.');
      return;
    }
    const longestSide = Math.max(source.videoWidth, source.videoHeight);
    const scale = Math.min(1, 2000 / longestSide);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(source.videoWidth * scale);
    canvas.height = Math.round(source.videoHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) {
      setMessage('Não foi possível capturar a imagem. Use a opção de foto abaixo.');
      return;
    }
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolveBlob) =>
      canvas.toBlob(resolveBlob, 'image/jpeg', 0.92),
    );
    if (!blob) {
      setMessage('Não foi possível capturar a imagem. Use a opção de foto abaixo.');
      return;
    }
    await onCapture(new File([blob], `etiqueta-${Date.now()}.jpg`, { type: 'image/jpeg' }));
  };

  return (
    <div className="camera-capture">
      <div className={`camera-viewport ${status !== 'live' ? 'is-waiting' : ''}`}>
        <video ref={video} muted playsInline aria-label="Imagem ao vivo da câmera" />
        {status === 'live' && (
          <div className="camera-guide" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
        )}
        {status !== 'live' && (
          <div className="camera-placeholder">
            {status === 'opening' ? <Camera size={34} /> : <CameraOff size={34} />}
            <strong>{status === 'opening' ? 'Preparando câmera' : 'Câmera indisponível'}</strong>
          </div>
        )}
        {busy && (
          <div className="camera-processing" role="status">
            <span className="processing-dot" />
            Lendo destinatário…
          </div>
        )}
        {status === 'live' && !busy && (
          <Button className="camera-shutter" onClick={() => void capture()}>
            <Camera size={21} /> Capturar e identificar
          </Button>
        )}
      </div>
      <p className="camera-help" aria-live="polite">
        {message}
      </p>
      {status === 'unavailable' && (
        <Button tone="secondary" disabled={busy} onClick={() => void startCamera()}>
          Tentar abrir a câmera novamente
        </Button>
      )}
      <label className={`button secondary file-button ${busy ? 'disabled' : ''}`}>
        <ImagePlus size={19} /> Usar câmera do aparelho ou galeria
        <input
          aria-label="Foto da etiqueta"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onCapture(file);
          }}
        />
      </label>
      <small>JPEG, PNG ou WebP · até 4 MB</small>
    </div>
  );
}

function Receive({
  api,
  gate,
  mode,
  back,
  done,
}: {
  api: Api;
  gate: string;
  mode: string;
  back: () => void;
  done: (id: string) => void;
}) {
  const [phase, setPhase] = useState(
    mode === 'photo' ? 'photo' : mode === 'scan' ? 'scan' : 'edit',
  );
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [block, setBlock] = useState('');
  const [apartment, setApartment] = useState('');
  const [tracking, setTracking] = useState('');
  const [carrier, setCarrier] = useState('');
  const [ocrId, setOcrId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [resident, setResident] = useState<Candidate | null>(null);
  const [unit, setUnit] = useState('');
  const [units, setUnits] = useState<Unit[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [receipt, setReceipt] = useState<{
    id: string;
    publicCode: string;
    pin: string | null;
    notificationStatus: string;
  } | null>(null);
  const key = useRef(crypto.randomUUID());
  useEffect(() => {
    api<{ units: Unit[] }>('catalog')
      .then((r) => setUnits(r.units))
      .catch((e) => setError(errorText(e)));
  }, [api]);
  const upload = async (file?: File): Promise<boolean> => {
    if (!file) return false;
    if (file.size > 4 * 1024 * 1024) {
      setError('A foto deve ter até 4 MB.');
      return false;
    }
    setBusy('Enviando e analisando etiqueta…');
    setError('');
    try {
      const data = new FormData();
      data.append('gatehouseId', gate);
      data.append('file', file);
      const r = await api<{ id: string; result: OCRResult; candidates: Candidate[] }>('ocr', data);
      setOcrId(r.id);
      setName(r.result.recipientName.value || '');
      setBlock(r.result.block.value || '');
      setApartment(r.result.apartment.value || '');
      setTracking(r.result.trackingCode.value || '');
      setCarrier(r.result.carrier.value || '');
      setCandidates(r.candidates);
      setPhase('edit');
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy('');
    }
  };
  const match = async () => {
    setBusy('Procurando morador…');
    setError('');
    setResident(null);
    setConfirmed(false);
    try {
      setCandidates(await api<Candidate[]>('residents/match', { name, block, apartment }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  };
  const changeName = (value: string) => {
    setName(value);
    setConfirmed(false);
    setResident(null);
  };
  if (receipt)
    return (
      <div className="receipt">
        <span className="success-mark">
          <Check size={34} />
        </span>
        <p className="eyebrow">Recebimento concluído</p>
        <h1>Encomenda registrada.</h1>
        <p>{name}</p>
        <strong className="public-code">{receipt.publicCode}</strong>
        <div className="receipt-pin">
          <span>PIN de retirada</span>
          <strong>{receipt.pin || 'Já gerado'}</strong>
          <small>
            {receipt.pin
              ? 'Anote agora, se necessário. O PIN não será exibido novamente fora da demonstração.'
              : 'Registro recuperado sem duplicação. O PIN foi enviado no aviso original, quando autorizado.'}
          </small>
        </div>
        <Notice>
          {receipt.notificationStatus === 'SKIPPED'
            ? 'Sem contato autorizado para WhatsApp. Oriente o morador sobre a retirada.'
            : 'O aviso está na fila de envio. O recebimento já está salvo.'}
        </Notice>
        <div className="button-row">
          <Button onClick={back}>Receber outra encomenda</Button>
          <Button tone="secondary" onClick={() => done(receipt.id)}>
            Ver histórico
          </Button>
        </div>
      </div>
    );
  return (
    <>
      <button className="back" onClick={back}>
        <ArrowLeft size={17} />
        Voltar ao recebimento
      </button>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Nova encomenda</p>
          <h1>
            {phase === 'photo'
              ? 'Comece pela etiqueta.'
              : phase === 'scan'
                ? 'Bipe o código.'
                : 'Confira o destinatário.'}
          </h1>
          <p>
            {phase === 'edit'
              ? 'A leitura é uma sugestão. A confirmação é sua.'
              : 'Se preferir, você pode preencher os dados manualmente.'}
          </p>
        </div>
        <span className="progress-steps">
          1. Identificar <ChevronRight size={16} /> <b>2. Confirmar</b>
        </span>
      </div>
      {error && <Notice error>{error}</Notice>}
      {busy && (
        <Notice>
          {busy} {phase === 'photo' && 'A primeira leitura pode levar mais tempo.'}
        </Notice>
      )}
      {phase === 'photo' && (
        <section className="capture-panel">
          <div className="capture-heading">
            <h2>Enquadre a etiqueta inteira</h2>
            <p>Evite reflexos e mantenha remetente e destinatário visíveis.</p>
          </div>
          <CameraCapture busy={!!busy} onCapture={upload} />
          <Button
            tone="quiet"
            disabled={!!busy}
            onClick={() => {
              setError('');
              setPhase('edit');
            }}
          >
            Preencher manualmente <ArrowRight size={16} />
          </Button>
        </section>
      )}
      {phase === 'scan' && (
        <form
          className="panel compact-form"
          onSubmit={(e) => {
            e.preventDefault();
            setPhase('edit');
          }}
        >
          <ScanBarcode size={34} />
          <Field label="Código de rastreamento" hint="Bipe com o leitor e pressione Enter.">
            <input
              autoFocus
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              maxLength={100}
              required
            />
          </Field>
          <Button type="submit">
            Continuar <ArrowRight size={18} />
          </Button>
        </form>
      )}
      {phase === 'edit' && (
        <div className="confirmation-grid">
          <section className="panel">
            <h2>Dados da etiqueta</h2>
            <p>Corrija qualquer informação antes de continuar.</p>
            <Field label="Nome na etiqueta">
              <input value={name} onChange={(e) => changeName(e.target.value)} maxLength={160} />
            </Field>
            <div className="form-pair">
              <Field label="Bloco">
                <input
                  value={block}
                  onChange={(e) => {
                    setBlock(e.target.value);
                    setConfirmed(false);
                  }}
                />
              </Field>
              <Field label="Apartamento">
                <input
                  value={apartment}
                  onChange={(e) => {
                    setApartment(e.target.value);
                    setConfirmed(false);
                  }}
                />
              </Field>
            </div>
            <Button
              tone="secondary"
              onClick={() => void match()}
              disabled={!!busy || (!name && !block && !apartment)}
            >
              Procurar morador <Search size={18} />
            </Button>
            <hr />
            <Field label="Rastreamento (opcional)">
              <input
                value={tracking}
                maxLength={100}
                onChange={(e) => setTracking(e.target.value)}
              />
            </Field>
            <Field label="Transportadora (opcional)">
              <input value={carrier} maxLength={80} onChange={(e) => setCarrier(e.target.value)} />
            </Field>
          </section>
          <section className="panel confirm-panel">
            <p className="eyebrow">Confirmação humana</p>
            <h2>Para quem é a encomenda?</h2>
            <p>Selecione o morador e confira a unidade.</p>
            <div className="candidates">
              {candidates.map((c) => (
                <button
                  aria-pressed={resident?.id === c.id}
                  className={`candidate ${resident?.id === c.id ? 'selected' : ''}`}
                  key={c.id}
                  onClick={() => {
                    setResident(c);
                    setUnit(c.unit_id);
                    setConfirmed(false);
                  }}
                >
                  <span>
                    <strong>{c.full_name}</strong>
                    <small>
                      Bloco {c.block} · Apto {c.apartment}
                    </small>
                  </span>
                  <span className="score">
                    {c.score}
                    <small>score interno</small>
                  </span>
                  {resident?.id === c.id && <Check size={18} />}
                </button>
              ))}
              {!candidates.length && (
                <div className="empty compact">
                  <Search size={25} />
                  <p>Pesquise o morador pelos dados ao lado ou confirme apenas a unidade.</p>
                </div>
              )}
            </div>
            <Field label="Unidade de destino">
              <select
                value={unit}
                onChange={(e) => {
                  setUnit(e.target.value);
                  setResident(null);
                  setConfirmed(false);
                }}
              >
                <option value="">Selecione bloco e apartamento</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    Bloco {u.block} · Apto {u.number}
                  </option>
                ))}
              </select>
            </Field>
            {!resident && unit && (
              <small>
                Registro vinculado à unidade, sem morador específico. Não haverá aviso automático.
              </small>
            )}
            <label className="checkbox">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                disabled={!unit || name.trim().length < 3}
              />
              <span>
                Conferi a etiqueta e confirmo{' '}
                {resident ? <strong>{resident.full_name}</strong> : 'a unidade selecionada'} como
                destinatário.
              </span>
            </label>
            <Button
              className="full-width"
              disabled={!confirmed || !!busy}
              onClick={async () => {
                setBusy('Registrando encomenda…');
                setError('');
                try {
                  const r = await api<{
                    id: string;
                    publicCode: string;
                    pin: string | null;
                    notificationStatus: string;
                  }>('packages', {
                    gatehouseId: gate,
                    unitId: unit,
                    residentId: resident?.id || null,
                    recipientNameRaw: name,
                    externalTrackingCode: tracking,
                    carrier,
                    ocrResultId: ocrId,
                    recipientConfirmed: confirmed,
                    idempotencyKey: key.current,
                  });
                  setReceipt(r);
                } catch (e) {
                  setError(errorText(e));
                } finally {
                  setBusy('');
                }
              }}
            >
              Confirmar e registrar <Check size={18} />
            </Button>
          </section>
        </div>
      )}
    </>
  );
}

function Pickup({
  api,
  gate,
  open,
  refresh,
}: {
  api: Api;
  gate: string;
  open: (id: string) => void;
  refresh: () => void;
}) {
  const [pin, setPin] = useState('');
  const [pkg, setPkg] = useState<PackageView | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  return (
    <div className="pickup-layout">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Retirada de encomenda</p>
          <h1>{done ? 'Entrega concluída.' : 'Pronta para ir para casa.'}</h1>
          <p>
            {done
              ? 'A retirada foi registrada no histórico.'
              : 'Peça o PIN ao morador e confira o destinatário.'}
          </p>
        </div>
      </div>
      {error && <Notice error>{error}</Notice>}
      <section className="panel pickup-panel">
        {done ? (
          <>
            <span className="success-mark">
              <Check size={32} />
            </span>
            <h2>Encomenda entregue</h2>
            <p>{pkg?.recipient_name_raw}</p>
            <Button
              onClick={() => {
                setDone(false);
                setPkg(null);
                setPin('');
                setChecked(false);
              }}
            >
              Fazer outra retirada
            </Button>
            <Button tone="quiet" onClick={() => open(pkg!.id)}>
              Ver histórico
            </Button>
          </>
        ) : (
          <>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError('');
                setPkg(null);
                setChecked(false);
                try {
                  setPkg(await api<PackageView>('packages/find-pin', { gatehouseId: gate, pin }));
                } catch (err) {
                  setError(errorText(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field label="Digite o código de retirada">
                <input
                  className="pin-input"
                  autoFocus
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="000000"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                />
              </Field>
              <Button type="submit" disabled={busy || pin.length !== 6}>
                {busy ? 'Procurando…' : 'Encontrar encomenda'}
                <Search size={18} />
              </Button>
            </form>
            {pkg && (
              <div className="pickup-found">
                <span className="eyebrow">Encomenda encontrada</span>
                <h2>{pkg.recipient_name_raw}</h2>
                <p className="unit-big">
                  Bloco {pkg.block} <span>·</span> Apto {pkg.apartment}
                </p>
                <dl>
                  <div>
                    <dt>Código</dt>
                    <dd>{pkg.public_code}</dd>
                  </div>
                  <div>
                    <dt>Recebida em</dt>
                    <dd>{date(pkg.received_at)}</dd>
                  </div>
                  <div>
                    <dt>Portaria</dt>
                    <dd>{pkg.gatehouse}</dd>
                  </div>
                </dl>
                {pkg.status === 'INCIDENT' ? (
                  <Notice error>
                    Há uma ocorrência nesta encomenda.{' '}
                    <button onClick={() => open(pkg.id)}>Consultar histórico</button>
                  </Notice>
                ) : (
                  <>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => setChecked(e.target.checked)}
                      />
                      Conferi o destinatário e a encomenda que será entregue.
                    </label>
                    <Button
                      disabled={!checked || busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await api(`packages/${pkg.id}/commands`, {
                            command: 'pickup',
                            recipientChecked: true,
                          });
                          setDone(true);
                          setPin('');
                          refresh();
                        } catch (e) {
                          setError(errorText(e));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Confirmar entrega <PackageCheck size={18} />
                    </Button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </section>
      <p className="subtle centered">
        Sem o PIN? Use “Pesquisar” para localizar por nome, unidade ou rastreamento.
      </p>
    </div>
  );
}

function SearchPackages({
  api,
  gate,
  open,
}: {
  api: Api;
  gate: string;
  open: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<PackageView[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const search = useCallback(
    async (q: string) => {
      setBusy(true);
      setError('');
      try {
        setRows(
          await api<PackageView[]>(`packages?gatehouseId=${gate}&q=${encodeURIComponent(q)}`),
        );
      } catch (e) {
        setError(errorText(e));
      } finally {
        setBusy(false);
      }
    },
    [api, gate],
  );
  useEffect(() => {
    void search('');
  }, [search]);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Consulta da portaria</p>
          <h1>Encontre uma encomenda.</h1>
          <p>Busque por destinatário, código, rastreamento ou bloco/apartamento.</p>
        </div>
      </div>
      <form
        className="search-form"
        onSubmit={(e) => {
          e.preventDefault();
          void search(query);
        }}
      >
        <Field label="Pesquisar encomendas">
          <input
            placeholder="Nome, SC-…, rastreamento ou 18/66"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={100}
          />
        </Field>
        <Button disabled={busy} type="submit">
          <Search size={20} />
          Pesquisar
        </Button>
      </form>
      {error && <Notice error>{error}</Notice>}
      {busy ? (
        <Notice>Buscando encomendas…</Notice>
      ) : (
        <>
          <p className="subtle">{rows.length} resultados · até 100 recebimentos mais recentes</p>
          <PackageList packages={rows} open={open} />
        </>
      )}
    </>
  );
}

function Detail({
  api,
  id,
  back,
  refresh,
}: {
  api: Api;
  id: string;
  back: () => void;
  refresh: () => void;
}) {
  const [data, setData] = useState<PackageDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [command, setCommand] = useState('');
  const [reason, setReason] = useState('');
  const [checked, setChecked] = useState(false);
  const load = useCallback(
    () =>
      api<PackageDetail>(`packages/${id}`)
        .then(setData)
        .catch((e) => setError(errorText(e))),
    [api, id],
  );
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 5000);
    return () => clearInterval(timer);
  }, [load]);
  const run = async () => {
    setBusy(true);
    setError('');
    try {
      await api(
        `packages/${id}/commands`,
        command === 'pickup' ? { command, recipientChecked: checked } : { command, reason },
      );
      setCommand('');
      setReason('');
      setChecked(false);
      await load();
      refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className="back" onClick={back}>
        <ArrowLeft size={17} />
        Voltar à pesquisa
      </button>
      {error && <Notice error>{error}</Notice>}
      {!data ? (
        <Notice>Carregando histórico…</Notice>
      ) : (
        <>
          <div className="page-heading">
            <div>
              <p className="eyebrow">{data.package.public_code}</p>
              <h1>{data.package.recipient_name_raw}</h1>
              <p>
                Bloco {data.package.block} · Apto {data.package.apartment} ·{' '}
                {data.package.gatehouse}
              </p>
            </div>
            <span className={`status ${data.package.status.toLowerCase()}`}>
              {labels[data.package.status]}
            </span>
          </div>
          <div className="detail-grid">
            <section className="panel">
              <h2>Histórico da encomenda</h2>
              <ol className="timeline">
                {data.events.map((e) => (
                  <li key={e.id}>
                    <span className="timeline-dot" />
                    <div>
                      <strong>{eventLabels[e.type] || e.type}</strong>
                      <small>
                        {date(e.created_at)} · {e.actor_name || 'Sistema'}
                      </small>
                      {typeof e.detail.reason === 'string' && <p>{e.detail.reason}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
            <aside>
              <section className="panel">
                <h2>Dados do recebimento</h2>
                <dl>
                  <div>
                    <dt>Recebida</dt>
                    <dd>{date(data.package.received_at)}</dd>
                  </div>
                  <div>
                    <dt>Rastreamento</dt>
                    <dd>{data.package.external_tracking_code || 'Não informado'}</dd>
                  </div>
                  <div>
                    <dt>Notificação</dt>
                    <dd>{labels[data.package.notification_status || ''] || 'Não disponível'}</dd>
                  </div>
                </dl>
                {['WAITING_PICKUP', 'INCIDENT'].includes(data.package.status) && (
                  <>
                    <hr />
                    <Field label="Ação operacional">
                      <select
                        value={command}
                        onChange={(e) => {
                          setCommand(e.target.value);
                          setChecked(false);
                        }}
                      >
                        <option value="">Selecione uma ação</option>
                        {data.package.status === 'WAITING_PICKUP' ? (
                          <>
                            <option value="pickup">Confirmar entrega</option>
                            <option value="incident">Registrar ocorrência</option>
                          </>
                        ) : (
                          <option value="resolve">Resolver ocorrência</option>
                        )}
                        <option value="return">Registrar devolução</option>
                        <option value="cancel">Cancelar registro</option>
                      </select>
                    </Field>
                    {command &&
                      (command === 'pickup' ? (
                        <label className="checkbox">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => setChecked(e.target.checked)}
                          />
                          Conferi o destinatário, a unidade e a encomenda para entrega.
                        </label>
                      ) : (
                        <Field label="Motivo obrigatório">
                          <textarea
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            minLength={5}
                            maxLength={500}
                            rows={3}
                          />
                        </Field>
                      ))}
                    {command && (
                      <Button
                        tone={command === 'cancel' ? 'danger' : 'primary'}
                        disabled={
                          busy || (command === 'pickup' ? !checked : reason.trim().length < 5)
                        }
                        onClick={() => void run()}
                      >
                        {busy
                          ? 'Registrando…'
                          : command === 'cancel'
                            ? 'Confirmar cancelamento'
                            : 'Confirmar operação'}
                      </Button>
                    )}
                  </>
                )}
              </section>
              {data.fakeMessage && (
                <section className="fake-message">
                  <span className="eyebrow">WhatsApp simulado · somente demo</span>
                  <p>{data.fakeMessage}</p>
                  <small>Prévia restrita da mensagem. Nenhum envio real foi realizado.</small>
                </section>
              )}
            </aside>
          </div>
        </>
      )}
    </>
  );
}

type Dashboard = {
  metrics: { received: number; waiting: number; picked: number; old: number };
  gatehouses: { name: string; count: number }[];
  activity: { action: string; created_at: string; entity_id: string }[];
};
function Admin({ api }: { api: Api }) {
  const [access, setAccess] = useState<{
    members: { id: string; display_name: string; role: string }[];
    gatehouses: { id: string; name: string }[];
  }>({ members: [], gatehouses: [] });
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const [catalog, setCatalog] = useState<{ units: Unit[]; blocks: { id: string; name: string }[] }>(
    { units: [], blocks: [] },
  );
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('overview');
  const load = useCallback(async () => {
    try {
      const [d, c, a] = await Promise.all([
        api<Dashboard>('admin/dashboard'),
        api<typeof catalog>('catalog'),
        api<typeof access>('admin/members'),
      ]);
      setData(d);
      setCatalog(c);
      setAccess(a);
    } catch (e) {
      setError(errorText(e));
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <>
      <div className="admin-heading">
        <span className="eyebrow">Administração do condomínio</span>
        <h1>A operação, por inteiro.</h1>
        <p>Visão consolidada das portarias e cadastros essenciais.</p>
      </div>
      <div className="admin-tabs">
        {[
          ['overview', 'Visão geral'],
          ['resident', 'Novo morador'],
          ['unit', 'Nova unidade'],
          ['member', 'Acessos'],
        ].map(([key, label]) => (
          <button
            key={key}
            aria-pressed={tab === key}
            onClick={() => {
              setTab(key!);
              setSuccess('');
              setError('');
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <Notice error>{error}</Notice>}
      {success && <Notice>{success}</Notice>}
      {tab === 'overview' &&
        (!data ? (
          <Notice>Carregando visão geral…</Notice>
        ) : (
          <>
            <div className="metrics">
              {[
                [data.metrics.received, 'Recebidas hoje'],
                [data.metrics.waiting, 'Aguardando retirada'],
                [data.metrics.picked, 'Retiradas hoje'],
                [data.metrics.old, 'Há mais de 7 dias'],
              ].map(([n, label]) => (
                <div key={label}>
                  <strong>{n}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
            <div className="detail-grid">
              <section className="panel">
                <h2>Últimas atividades</h2>
                {data.activity.length ? (
                  data.activity.map((a, i) => (
                    <div className="activity" key={i}>
                      <Clock size={16} />
                      <span>
                        {eventLabels[a.action] || a.action}
                        <small>{date(a.created_at)}</small>
                      </span>
                    </div>
                  ))
                ) : (
                  <p>Ainda não há atividades.</p>
                )}
              </section>
              <section className="panel">
                <h2>Aguardando por portaria</h2>
                {data.gatehouses.map((g) => (
                  <div className="gate-stat" key={g.name}>
                    <span>{g.name}</span>
                    <strong>{g.count}</strong>
                  </div>
                ))}
              </section>
            </div>
          </>
        ))}
      {tab !== 'overview' && (
        <form
          key={tab}
          className="panel admin-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const form = e.currentTarget;
            setBusy(true);
            setError('');
            setSuccess('');
            try {
              if (tab === 'resident')
                await api('admin/residents', {
                  unitId: f.get('unitId'),
                  fullName: f.get('name'),
                  phone: f.get('phone') || null,
                  whatsappOptIn: f.get('opt') === 'on',
                });
              else if (tab === 'unit')
                await api('admin/units', { blockId: f.get('blockId'), number: f.get('number') });
              else
                await api('admin/memberships', {
                  userId: f.get('userId'),
                  role: f.get('role'),
                  gatehouseIds: f.getAll('gates'),
                });
              setSuccess('Cadastro salvo com registro de auditoria.');
              form.reset();
              await load();
            } catch (err) {
              setError(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {tab === 'resident' ? (
            <>
              <h2>Cadastrar morador</h2>
              <Field label="Nome completo">
                <input name="name" required minLength={3} />
              </Field>
              <Field label="Unidade">
                <select name="unitId" required>
                  <option value="">Selecione</option>
                  {catalog.units.map((u) => (
                    <option key={u.id} value={u.id}>
                      Bloco {u.block} · Apto {u.number}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="WhatsApp (opcional)" hint="Formato internacional, por exemplo +5511…">
                <input name="phone" type="tel" autoComplete="tel" pattern="\+[1-9][0-9]{9,14}" />
              </Field>
              <label className="checkbox">
                <input name="opt" type="checkbox" />O morador autorizou receber avisos por WhatsApp.
              </label>
            </>
          ) : tab === 'unit' ? (
            <>
              <h2>Cadastrar unidade</h2>
              <Field label="Bloco">
                <select name="blockId" required>
                  {catalog.blocks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Apartamento">
                <input name="number" required maxLength={30} />
              </Field>
            </>
          ) : (
            <>
              <h2>Gerenciar acesso da equipe</h2>
              <p>
                Selecione um funcionário e as portarias em que pode operar. Para adicionar uma nova
                pessoa, procure a equipe da plataforma.
              </p>
              <Field label="Funcionário">
                <select name="userId" required>
                  <option value="">Selecione</option>
                  {access.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.display_name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Papel">
                <select name="role">
                  <option value="GATEHOUSE_OPERATOR">Operador</option>
                  <option value="GATEHOUSE_SUPERVISOR">Supervisor</option>
                  <option value="CONDO_ADMIN">Administrador</option>
                </select>
              </Field>
              <fieldset>
                <legend>Portarias autorizadas</legend>
                {access.gatehouses.map((g) => (
                  <label key={g.id} className="checkbox">
                    <input name="gates" type="checkbox" value={g.id} />
                    {g.name}
                  </label>
                ))}
                <small>Administradores têm acesso a todas as portarias do condomínio.</small>
              </fieldset>
            </>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar cadastro'}
            <Check size={18} />
          </Button>
        </form>
      )}
    </>
  );
}
