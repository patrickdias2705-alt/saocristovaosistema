export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function request<T>(
  path: string,
  token: string | null,
  condo: string | null,
  body?: unknown,
): Promise<T> {
  const isFile = body instanceof FormData;
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(condo ? { 'X-Condominium-Id': condo } : {}),
      ...(body !== undefined && !isFile ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : isFile ? body : JSON.stringify(body),
    cache: 'no-store',
  });
  const contentType = response.headers.get('content-type') || '';
  const result = contentType.includes('application/json')
    ? await response.json()
    : {
        message: 'O serviço demorou mais que o esperado. Tente novamente ou preencha manualmente.',
      };
  if (!response.ok)
    throw new ApiError(
      result.message || 'Não foi possível concluir. Tente novamente.',
      response.status,
    );
  return result as T;
}
export const labels: Record<string, string> = {
  WAITING_PICKUP: 'Aguardando retirada',
  PICKED_UP: 'Entregue',
  CANCELED: 'Cancelada',
  RETURNED: 'Devolvida',
  INCIDENT: 'Com ocorrência',
  PENDING: 'Aviso na fila',
  FAILED: 'Falha no aviso',
  SENT: 'Aviso enviado',
  DELIVERED: 'Aviso entregue',
  READ: 'Aviso lido',
  SKIPPED: 'Sem contato autorizado',
};
export const eventLabels: Record<string, string> = {
  PACKAGE_CREATED: 'Encomenda registrada',
  OCR_PROCESSED: 'Etiqueta analisada',
  RECIPIENT_CONFIRMED: 'Destinatário confirmado',
  NOTIFICATION_QUEUED: 'Aviso adicionado à fila',
  NOTIFICATION_SENT: 'Aviso enviado',
  NOTIFICATION_FAILED: 'Falha no envio do aviso',
  NOTIFICATION_SKIPPED: 'Sem contato autorizado para aviso',
  NOTIFICATION_DELIVERED: 'Aviso entregue no WhatsApp',
  NOTIFICATION_READ: 'Aviso lido no WhatsApp',
  PICKUP_COMPLETED: 'Retirada confirmada',
  PACKAGE_CANCELED: 'Registro cancelado',
  INCIDENT_CREATED: 'Ocorrência registrada',
  INCIDENT_RESOLVED: 'Ocorrência resolvida',
  PACKAGE_RETURNED: 'Devolução registrada',
};
export const date = (v: string) =>
  new Date(v).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
