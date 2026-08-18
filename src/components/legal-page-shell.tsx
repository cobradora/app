import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import cobraLogo from "@/images/logo-cobra-sem-fundo.png";

export function LegalPageShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="bg-brand-creme text-brand-chocolate antialiased selection:bg-brand-pink selection:text-brand-chocolate">
      <header className="sticky top-0 z-40 bg-brand-creme/95 backdrop-blur-md border-b border-brand-chocolate/10">
        <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between gap-6">
          <Link href="/" className="flex items-center gap-3" aria-label="Voltar para a página inicial da CobraDora">
            <div className="w-10 h-10 bg-brand-pink rounded-full border-2 border-brand-chocolate flex items-center justify-center shadow-[0_3px_0px_#3B2117]">
              <Image src={cobraLogo} alt="" width={22} height={22} priority />
            </div>
            <div>
              <span className="font-extrabold text-xl tracking-tight leading-none block">CobraDora</span>
              <span className="text-[10px] font-medium opacity-70">Assistente de Cobranças</span>
            </div>
          </Link>
          <Link href="/" className="font-bold text-sm px-4 py-2 rounded-full border-2 border-brand-chocolate hover:bg-brand-pink transition-colors">
            Voltar ao site
          </Link>
        </div>
      </header>
      <main>
        <section className="py-12 md:py-16">
          <div className="max-w-4xl mx-auto px-6">
            <div className="mb-8">
              <span className="inline-block bg-brand-pink-light border border-brand-pink/40 rounded-full px-3 py-1 text-xs font-extrabold uppercase tracking-wide mb-4">CobraDora</span>
              <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight leading-tight">{title}</h1>
              <p className="mt-3 text-xs font-semibold text-brand-chocolate/55">Última atualização: {updated}</p>
            </div>
            <article className="legal-card legal-content bg-white border-2 border-brand-chocolate rounded-3xl p-6 md:p-10">
              {children}
            </article>
          </div>
        </section>
      </main>
      <footer className="bg-brand-chocolate text-brand-creme py-10 border-t-4 border-brand-pink">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row justify-between gap-6">
          <div>
            <strong className="text-lg">CobraDora</strong>
            <p className="text-xs opacity-65 mt-1">© 2026 — Todos os direitos reservados.</p>
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
            <Link href="/termos-de-uso" className="hover:text-brand-pink">Termos de Uso</Link>
            <Link href="/politica-de-privacidade" className="hover:text-brand-pink">Privacidade</Link>
            <Link href="/politica-de-cookies" className="hover:text-brand-pink">Cookies</Link>
            <a href="mailto:contato@cobradora.com.br" className="hover:text-brand-pink">Contato</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
