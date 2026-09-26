import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
test('real OCR reception, fake WhatsApp, PIN pickup and immutable timeline', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Entrar na portaria' }).click();
  await expect(page.getByRole('heading', { name: 'Uma entrega bem recebida.' })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshot-operation.png', fullPage: true });
  await page.getByRole('button', { name: 'Fotografar etiqueta' }).click();
  await page.getByLabel('Foto da etiqueta').setInputFiles(resolve('docs/demo-label.png'));
  await expect(page.getByRole('heading', { name: 'Confira o destinatário.' })).toBeVisible({
    timeout: 120000,
  });
  await expect(page.getByLabel('Nome na etiqueta')).toHaveValue(/Maria/i);
  await page.getByRole('button', { name: /Maria Aparecida Silva.*score interno/ }).click();
  await page.getByRole('checkbox', { name: /Conferi a etiqueta/ }).check();
  await page.getByRole('button', { name: 'Confirmar e registrar' }).click();
  await expect(page.getByRole('heading', { name: 'Encomenda registrada.' })).toBeVisible();
  const pin = await page.locator('.receipt-pin strong').innerText();
  expect(pin).toMatch(/^\d{6}$/);
  const code = await page.locator('.public-code').innerText();
  await page.getByRole('button', { name: 'Ver histórico' }).click();
  await expect(page.locator('.fake-message')).toContainText(pin);
  await expect(page.locator('.timeline')).toContainText('Aviso enviado', { timeout: 20000 });
  await page.getByRole('button', { name: 'Retirar F3' }).click();
  await page.getByLabel('Digite o código de retirada').fill(pin);
  await page.getByRole('button', { name: 'Encontrar encomenda' }).click();
  await expect(page.locator('.pickup-found')).toContainText(code);
  await page.getByRole('checkbox', { name: /Conferi o destinatário/ }).check();
  await page.getByRole('button', { name: 'Confirmar entrega' }).click();
  await expect(page.getByRole('heading', { name: 'Encomenda entregue' })).toBeVisible();
  await page.getByRole('button', { name: 'Ver histórico' }).click();
  await expect(page.locator('.timeline')).toContainText('Retirada confirmada');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'docs/screenshot-history.png', fullPage: true });
});
test('manual fallback, mobile layout and cancellation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Entrar na portaria' }).click();
  await page.getByRole('button', { name: 'Cadastro manual' }).click();
  await page.getByLabel('Nome na etiqueta').fill('Destinatário de teste manual');
  await page.getByLabel('Unidade de destino').selectOption('40000000-0000-4000-8000-000000000001');
  await page.getByRole('checkbox', { name: /Conferi a etiqueta/ }).check();
  await page.getByRole('button', { name: 'Confirmar e registrar' }).click();
  await expect(page.getByRole('heading', { name: 'Encomenda registrada.' })).toBeVisible();
  await page.getByRole('button', { name: 'Ver histórico' }).click();
  await page.getByLabel('Ação operacional').selectOption('cancel');
  await page.getByLabel('Motivo obrigatório').fill('Teste de cancelamento na demonstração.');
  await page.getByRole('button', { name: 'Confirmar cancelamento' }).click();
  await expect(page.locator('.timeline')).toContainText('Registro cancelado');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'docs/screenshot-mobile.png', fullPage: true });
});
