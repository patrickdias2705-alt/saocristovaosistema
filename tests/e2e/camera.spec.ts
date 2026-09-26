import { expect, test } from '@playwright/test';

test.use({
  permissions: ['camera'],
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
});

test('mobile camera captures the label and opens extracted fields', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/ocr', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id: '77777777-7777-4777-8777-777777777777',
        result: {
          recipientName: { value: 'João da Silva', confidence: 0.95 },
          block: { value: 'B', confidence: 0.93 },
          apartment: { value: '42', confidence: 0.93 },
          trackingCode: { value: null, confidence: 0 },
          carrier: { value: null, confidence: 0 },
          address: { value: null, confidence: 0 },
          rawText: '',
          processingTime: 1,
          requestId: '88888888-8888-4888-8888-888888888888',
          provider: 'browser-test',
        },
        candidates: [],
      }),
    });
  });

  await page.goto('/');
  if (process.env.BOOTSTRAP_ADMIN_EMAIL && process.env.BOOTSTRAP_ADMIN_PASSWORD) {
    await page.getByLabel('E-mail').waitFor();
    await page.getByLabel('E-mail').fill(process.env.BOOTSTRAP_ADMIN_EMAIL);
    await page.getByLabel('Senha').fill(process.env.BOOTSTRAP_ADMIN_PASSWORD);
  }
  await page.getByRole('button', { name: 'Entrar na portaria' }).click();
  await page.getByRole('button', { name: 'Fotografar etiqueta' }).click();
  await expect(page.getByText('Câmera pronta.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Capturar e identificar' })).toBeVisible();
  for (const viewport of [
    { width: 320, height: 700 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Capturar e identificar' }).click();

  await expect(page.getByRole('heading', { name: 'Confira o destinatário.' })).toBeVisible();
  await expect(page.getByLabel('Nome na etiqueta')).toHaveValue('João da Silva');
  await expect(page.getByRole('textbox', { name: 'Bloco' })).toHaveValue('B');
  await expect(page.getByRole('textbox', { name: 'Apartamento' })).toHaveValue('42');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
