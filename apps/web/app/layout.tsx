import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'São Cristóvão • Entregas',
  description: 'Recebimento e retirada de encomendas do condomínio.',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
