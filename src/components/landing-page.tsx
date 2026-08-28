"use client";

import Link from "next/link";
import Image from "next/image";
import cobraLogo from "@/images/logo-cobra-sem-fundo.png";

const MODULES = [
  {
    id: "dora",
    name: "Grátis",
    eyebrow: "Controle pelo painel",
    description: "Para quem quer organizar as mensalidades sem custo e prefere conduzir o compartilhamento das cobranças pelo painel.",
    price: "R$ 0",
    priceDetail: "para começar",
    featured: false,
    features: [
      "Painel com pagos e pendentes",
      "Lista atualizada para copiar ou compartilhar",
      "Checkout integrado com baixa automática",
      "Baixa manual quando necessário",
      "Pagamentos direto na sua InfinitePay",
    ],
  },
  {
    id: "cobradora",
    name: "Premium",
    eyebrow: "Cobrança e acompanhamento automáticos",
    description: "Para quem quer tirar a cobrança da rotina e deixar a CobraDora acompanhar os pagamentos pelo WhatsApp.",
    price: "R$ 0,90",
    priceDetail: "por integrante cadastrado/mês · mínimo de R$ 9,90/mês",
    featured: true,
    features: [
      "Tudo o que existe no modo Grátis",
      "Cobranças individuais pelo WhatsApp",
      "Atualizações automáticas ao organizador",
      "Cobrança calculada pela quantidade de integrantes cadastrados",
    ],
  },
] as const;

export default function LandingPage() {
  return (
    <div className="bg-brand-creme text-brand-chocolate font-[family-name:var(--font-brand)] antialiased selection:bg-brand-pink selection:text-brand-chocolate">
      <style jsx>{`
        .btn-3d {
          box-shadow: 0 4px 0px #3b2117;
          transition: all 0.1s ease-in-out;
        }
        .btn-3d:active {
          transform: translateY(4px);
          box-shadow: 0 0px 0px #3b2117;
        }
        .card-shadow {
          box-shadow: 0 10px 30px -5px rgba(59, 33, 23, 0.08);
        }
      `}</style>

      {/* Header / Navbar */}
      <header className="sticky top-0 z-50 bg-brand-creme/90 backdrop-blur-md border-b border-brand-chocolate/10">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-brand-pink rounded-full border-2 border-brand-chocolate flex items-center justify-center relative shadow-[0_3px_0px_#3B2117]">
              <Image src={cobraLogo} alt="" width={22} height={22} priority />
            </div>
            <div className="flex flex-col">
              <span className="font-extrabold text-xl tracking-tight leading-none">CobraDora</span>
              <span className="text-[10px] font-medium opacity-80">Assistente de Cobranças</span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-8 font-semibold text-sm">
            <a href="#como-funciona" className="hover:text-brand-pink-text transition-colors">Como Funciona</a>
            <a href="#dashboard" className="hover:text-brand-pink-text transition-colors">O Painel</a>
            <a href="#beneficios" className="hover:text-brand-pink-text transition-colors">Benefícios</a>
            <a href="#modulos" className="hover:text-brand-pink-text transition-colors">Módulos</a>
          </nav>

          <Link href="/signup?module=dora" className="btn-3d bg-brand-pink text-brand-chocolate font-bold text-sm px-5 py-2.5 rounded-full border-2 border-brand-chocolate inline-block hover:bg-white transition-all">
            Começar grátis
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative pt-12 pb-20 md:pt-20 md:pb-28 overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-6 space-y-6 text-center lg:text-left">
            <div className="inline-flex items-center gap-2 bg-brand-pink-light border border-brand-pink/30 text-brand-chocolate px-4 py-1.5 rounded-full text-xs font-bold tracking-wide uppercase">
              ⚡ Simples, prático e sem complicações
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.1]">
              Organize as mensalidades. <span className="text-brand-pink-text underline decoration-brand-chocolate decoration-4">Automatize quando quiser.</span>
            </h1>
            <p className="text-lg md:text-xl text-brand-chocolate/80 max-w-xl mx-auto lg:mx-0 font-medium">
              Use a CobraDora gratuitamente para acompanhar pagamentos e compartilhar suas listas. Quando quiser tirar a cobrança da rotina, ative o Premium e deixe a CobraDora fazer esse trabalho por você.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4 pt-4">
              <Link href="/signup?module=dora" className="btn-3d w-full sm:w-auto text-center bg-brand-pink text-brand-chocolate font-bold text-base px-8 py-4 rounded-full border-2 border-brand-chocolate hover:bg-white transition-all">
                Começar grátis
              </Link>
              <a href="#modulos" className="w-full sm:w-auto text-center bg-transparent text-brand-chocolate font-bold text-base px-8 py-4 rounded-full border-2 border-transparent hover:border-brand-chocolate/20 transition-all">
                Conhecer o Premium →
              </a>
            </div>

            <div className="pt-6 flex flex-wrap items-center justify-center lg:justify-start gap-6 text-sm font-semibold opacity-90">
              <div className="flex items-center gap-2">
                <span className="text-brand-pink-text text-lg">✓</span> Importação rápida de participantes
              </div>
              <div className="flex items-center gap-2">
                <span className="text-brand-pink-text text-lg">✓</span> Pagamentos direto na sua InfinitePay
              </div>
            </div>
          </div>

          {/* Hero Visual (Dashboard mockup) */}
          <div id="dashboard" className="lg:col-span-6 relative">
            <div className="absolute -top-10 -left-10 w-72 h-72 bg-brand-pink/20 rounded-full filter blur-3xl -z-10" />
            <div className="absolute -bottom-10 -right-10 w-72 h-72 bg-brand-pink-light rounded-full filter blur-3xl -z-10" />

            <div className="bg-white rounded-3xl border-2 border-brand-chocolate p-5 md:p-6 card-shadow relative">
              <div className="flex items-center justify-between border-b border-brand-chocolate/10 pb-4 mb-5">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 bg-brand-pink rounded-full border-2 border-brand-chocolate flex items-center justify-center">
                    <Image src={cobraLogo} alt="" width={18} height={18} />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-sm leading-none">CobraDora</h3>
                    <span className="text-[9px] opacity-60">Visão Geral do Painel</span>
                  </div>
                </div>
                <div className="bg-brand-creme border border-brand-chocolate/10 px-3 py-1 rounded-full text-[10px] font-bold">
                  Agosto 2026
                </div>
              </div>

              <div className="mb-6">
                <h4 className="font-extrabold text-base">Olá, Administrador! 👋</h4>
                <p className="text-xs text-brand-chocolate/70">Gerencie seus recebimentos e participantes de forma simples.</p>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-6">
                <div className="bg-brand-orange-light border border-brand-chocolate/10 p-3 rounded-xl">
                  <span className="text-[9px] font-extrabold text-brand-orange-text tracking-wider block uppercase">Previsto</span>
                  <span className="text-sm md:text-base font-extrabold block mt-1">R$ 1.250,00</span>
                  <span className="text-[8px] opacity-60 block mt-0.5">5 cobranças</span>
                </div>
                <div className="bg-brand-green-menta border border-brand-chocolate/10 p-3 rounded-xl">
                  <span className="text-[9px] font-extrabold text-brand-green-text tracking-wider block uppercase">Recebido</span>
                  <span className="text-sm md:text-base font-extrabold block mt-1">R$ 850,00</span>
                  <span className="text-[8px] opacity-60 block mt-0.5">3 confirmados</span>
                </div>
                <div className="bg-brand-red-light border border-brand-chocolate/10 p-3 rounded-xl">
                  <span className="text-[9px] font-extrabold text-brand-red-text tracking-wider block uppercase">Pendente</span>
                  <span className="text-sm md:text-base font-extrabold block mt-1">R$ 400,00</span>
                  <span className="text-[8px] opacity-60 block mt-0.5">2 em aberto</span>
                </div>
              </div>

              <div className="border border-brand-chocolate/10 rounded-2xl p-4 bg-brand-creme/50">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-extrabold tracking-wider uppercase">Seus Grupos Ativos</span>
                  <span className="text-[10px] font-bold text-brand-pink bg-brand-chocolate px-2 py-0.5 rounded-full">1 grupo</span>
                </div>

                <div className="bg-white border border-brand-chocolate/10 p-3 rounded-xl flex items-center justify-between shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-brand-pink/30 rounded-full flex items-center justify-center font-bold text-xs">KM</div>
                    <div>
                      <h5 className="font-extrabold text-xs">kmura</h5>
                      <span className="text-[10px] text-brand-green-text font-semibold">Dia 10 · em dia</span>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold bg-brand-creme px-2 py-1 rounded-md border border-brand-chocolate/5">Gerenciar</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Como Funciona */}
      <section id="como-funciona" className="py-20 bg-white border-y-2 border-brand-chocolate/10">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-16 space-y-4">
            <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight">Uma base simples, dois modos de usar</h2>
            <p className="text-base text-brand-chocolate/70 font-medium">
              Cadastre uma vez, receba pela InfinitePay e escolha quanto da rotina quer deixar com a CobraDora.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            <div className="bg-brand-creme border-2 border-brand-chocolate p-8 rounded-2xl relative shadow-[4px_4px_0px_#3B2117]">
              <div className="w-12 h-12 bg-brand-pink rounded-full border-2 border-brand-chocolate flex items-center justify-center font-extrabold text-lg mb-6 shadow-[2px_2px_0px_#3B2117]">1</div>
              <h3 className="text-lg font-extrabold mb-3">Cadastre seu grupo</h3>
              <p className="text-sm text-brand-chocolate/80 leading-relaxed font-medium">
                Adicione os participantes do grupo informando o número de cada um. Se preferir, você pode <span className="font-bold">importar uma lista de texto</span> completa em segundos.
              </p>
            </div>

            <div className="bg-brand-creme border-2 border-brand-chocolate p-8 rounded-2xl relative shadow-[4px_4px_0px_#3B2117]">
              <div className="w-12 h-12 bg-brand-pink rounded-full border-2 border-brand-chocolate flex items-center justify-center font-extrabold text-lg mb-6 shadow-[2px_2px_0px_#3B2117]">2</div>
              <h3 className="text-lg font-extrabold mb-3">Conecte a InfinitePay</h3>
              <p className="text-sm text-brand-chocolate/80 leading-relaxed font-medium">
                Para receber pelo checkout, conecte sua InfiniteTag. Os pagamentos são enviados diretamente para sua conta InfinitePay.
              </p>
            </div>

            <div className="bg-brand-creme border-2 border-brand-chocolate p-8 rounded-2xl relative shadow-[4px_4px_0px_#3B2117]">
              <div className="w-12 h-12 bg-brand-pink rounded-full border-2 border-brand-chocolate flex items-center justify-center font-extrabold text-lg mb-6 shadow-[2px_2px_0px_#3B2117]">3</div>
              <h3 className="text-lg font-extrabold mb-3">Escolha como quer cobrar</h3>
              <p className="text-sm text-brand-chocolate/80 leading-relaxed font-medium">
                No modo Grátis, você organiza e acompanha tudo pelo painel. No Premium, a CobraDora também assume a rotina de cobrança pelo WhatsApp.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Benefícios */}
      <section id="beneficios" className="py-20 bg-brand-creme">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-5 space-y-6">
              <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight leading-tight">
                Você escolhe quanto da cobrança quer deixar com a CobraDora.
              </h2>
              <p className="text-brand-chocolate/80 font-medium leading-relaxed">
                Comece organizando tudo pelo painel. Quando quiser reduzir o trabalho manual, ative o Premium e deixe a CobraDora assumir a rotina de cobrança.
              </p>
              <div className="space-y-4 pt-2">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-brand-pink/30 flex items-center justify-center shrink-0 mt-1">
                    <span className="text-brand-chocolate font-bold text-xs">✓</span>
                  </div>
                  <div>
                    <h4 className="font-bold text-sm">Grátis: você conduz</h4>
                    <p className="text-xs text-brand-chocolate/70">Consulte o painel, acompanhe os pagamentos e compartilhe a lista quando quiser.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-brand-pink/30 flex items-center justify-center shrink-0 mt-1">
                    <span className="text-brand-chocolate font-bold text-xs">✓</span>
                  </div>
                  <div>
                    <h4 className="font-bold text-sm">Premium: a rotina anda sozinha</h4>
                    <p className="text-xs text-brand-chocolate/70">A CobraDora envia cobranças individuais pelo WhatsApp e mantém você atualizado sobre os pagamentos.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-7">
              <div className="bg-white rounded-3xl border-2 border-brand-chocolate p-4 md:p-6 card-shadow">
                <div className="bg-[#E8F5E9] rounded-2xl p-4 border border-brand-chocolate/10 space-y-4">
                  <div className="flex items-center gap-3 border-b border-brand-chocolate/10 pb-3">
                    <div className="w-10 h-10 bg-emerald-600 rounded-full flex items-center justify-center text-white font-bold text-sm">KM</div>
                    <div>
                      <h4 className="font-extrabold text-xs text-emerald-900">CobraDora · atualizações</h4>
                      <span className="text-[9px] text-emerald-700 font-semibold">Mensagens privadas e transacionais</span>
                    </div>
                  </div>

                  <div className="flex gap-2.5 max-w-[85%]">
                    <div className="w-8 h-8 bg-brand-pink rounded-full border border-brand-chocolate flex items-center justify-center shrink-0">
                      <span className="text-brand-chocolate font-extrabold text-xs">A</span>
                    </div>
                    <div className="bg-white border border-brand-chocolate/10 p-3 rounded-2xl rounded-tl-none shadow-sm text-xs space-y-2">
                      <p className="font-bold text-brand-chocolate">CobraDora para o mensalista</p>
                      <p>Olá, Cris! Sua mensalidade do grupo Sport de Quinta está disponível.</p>
                      <p className="font-semibold">Valor: R$ 50,00 · vencimento dia 10</p>
                      <p className="bg-brand-creme p-2 rounded border border-brand-chocolate/10 font-mono text-[10px] break-all">
                        https://cobradora.com.br/g/sport-de-quinta-cris
                      </p>
                      <p className="text-[9px] opacity-60">O pagamento é confirmado com segurança pela InfinitePay.</p>
                    </div>
                  </div>

                  <div className="flex gap-2.5 max-w-[85%] ml-auto justify-end">
                    <div className="bg-[#DCF8C6] border border-brand-chocolate/10 p-3 rounded-2xl rounded-tr-none shadow-sm text-xs space-y-1">
                      <p className="font-bold text-emerald-900">Checkout confirmado</p>
                      <p>Pagamento aprovado. ✅</p>
                    </div>
                  </div>

                  <div className="flex gap-2.5 max-w-[85%]">
                    <div className="w-8 h-8 bg-brand-pink rounded-full border border-brand-chocolate flex items-center justify-center shrink-0">
                      <span className="text-brand-chocolate font-extrabold text-xs">A</span>
                    </div>
                    <div className="bg-white border border-brand-chocolate/10 p-3 rounded-2xl rounded-tl-none shadow-sm text-xs space-y-1">
                      <p className="font-bold text-brand-chocolate">CobraDora para o organizador</p>
                      <p>✅ <span className="font-bold">Lista atualizada:</span> Willyan agora aparece como pago no grupo kmura.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Módulos */}
      <section id="modulos" className="py-20 bg-white border-t-2 border-brand-chocolate/10 scroll-mt-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-12 space-y-4">
            <span className="inline-flex items-center rounded-full bg-brand-pink-light px-4 py-1.5 text-xs font-extrabold uppercase tracking-wider">Escolha seu modo</span>
            <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight">Grátis ou Premium?</h2>
            <p className="text-base text-brand-chocolate/70 font-medium">
              Nos dois modos, você organiza grupos, pagamentos e listas. A diferença é quanto da rotina de cobrança quer deixar com a CobraDora.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-5xl mx-auto items-stretch">
            {MODULES.map((module) => (
              <div
                key={module.id}
                className={`bg-brand-creme border-2 border-brand-chocolate rounded-3xl p-8 flex flex-col justify-between relative ${module.featured ? "shadow-[8px_8px_0px_#3B2117] transform lg:-translate-y-2" : "shadow-[6px_6px_0px_#3B2117]"}`}
              >
                {module.featured && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-brand-pink border-2 border-brand-chocolate text-brand-chocolate font-bold text-xs px-4 py-1 rounded-full uppercase tracking-wider">
                    Automação no WhatsApp
                  </div>
                )}

                <div className="space-y-6">
                  <div className="space-y-2">
                    <p className="text-xs font-extrabold uppercase tracking-wider text-brand-pink-text">{module.eyebrow}</p>
                    <h3 className="text-2xl font-extrabold">{module.name}</h3>
                    <p className="text-sm text-brand-chocolate/70 leading-relaxed">{module.description}</p>
                  </div>

                  <div className="pt-2">
                    <span className="text-4xl font-extrabold">{module.price}</span>
                    <span className="block text-xs text-brand-chocolate/60 font-semibold mt-2">{module.priceDetail}</span>
                  </div>

                  <ul className="space-y-4 text-sm font-semibold border-t border-brand-chocolate/10 pt-6">
                    {module.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-3">
                        <span className="text-brand-pink-text text-lg">✓</span> {feature}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="pt-8">
                  <Link
                    href={`/signup?module=${module.id}`}
                    className={`btn-3d w-full block text-center font-bold text-sm rounded-full border-2 border-brand-chocolate transition-all ${
                      module.featured
                        ? "bg-brand-pink text-brand-chocolate py-3.5 hover:bg-white"
                        : "bg-white text-brand-chocolate py-3 hover:bg-brand-pink"
                    }`}
                  >
                    {module.id === "dora" ? "Começar grátis" : "Ativar Premium"}
                  </Link>
                </div>
              </div>
            ))}
          </div>

          <div className="max-w-5xl mx-auto mt-10 rounded-2xl border border-brand-chocolate/15 bg-brand-pink-light p-5 text-center text-sm font-semibold text-brand-chocolate/80">
            Para receber pelo checkout, é necessário conectar uma conta InfinitePay. Cada pagamento é enviado diretamente para a conta do organizador.
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 bg-brand-creme border-t-2 border-brand-chocolate/10">
        <div className="max-w-4xl mx-auto px-4">
          <h2 className="text-3xl font-extrabold tracking-tight text-center mb-10 -translate-y-[1cm]">Perguntas Frequentes</h2>

          <div className="space-y-6">
            <div className="bg-white border-2 border-brand-chocolate p-6 rounded-2xl">
              <h3 className="font-extrabold text-base mb-2">Qual é a diferença entre o modo Grátis e o Premium?</h3>
              <p className="text-sm text-brand-chocolate/80 leading-relaxed font-medium">
                No modo Grátis, você acompanha os pagamentos pelo painel e conduz o compartilhamento das cobranças. No Premium, cada mensalista recebe sua cobrança individualmente pelo WhatsApp e você acompanha automaticamente as atualizações de pagamento.
              </p>
            </div>

            <div className="bg-white border-2 border-brand-chocolate p-6 rounded-2xl">
              <h3 className="font-extrabold text-base mb-2">Preciso ter conta na InfinitePay?</h3>
              <p className="text-sm text-brand-chocolate/80 leading-relaxed font-medium">
                Sim. Para receber pelo checkout, é necessário conectar uma conta InfinitePay. Depois, basta informar sua InfiniteTag em Configurações para que os pagamentos sejam enviados diretamente para você.
              </p>
            </div>

            <div className="bg-white border-2 border-brand-chocolate p-6 rounded-2xl">
              <h3 className="font-extrabold text-base mb-2">Ainda posso compartilhar ou dar baixa manualmente?</h3>
              <p className="text-sm text-brand-chocolate/80 leading-relaxed font-medium">
                Sim. As ações manuais continuam disponíveis nos dois modos para você copiar a lista, compartilhar o link ou registrar um pagamento recebido fora do checkout.
              </p>
            </div>

            <div className="bg-white border-2 border-brand-chocolate p-6 rounded-2xl">
              <h3 className="font-extrabold text-base mb-2">Quanto custa o Premium?</h3>
              <p className="text-sm text-brand-chocolate/80 leading-relaxed font-medium">
                O Premium custa R$ 0,90 por integrante cadastrado por mês, com valor mínimo de R$ 9,90 mensais. O valor é calculado pela quantidade total de integrantes cadastrados no sistema.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-brand-chocolate text-brand-creme py-12 border-t-4 border-brand-pink">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-brand-pink rounded-full border border-brand-creme flex items-center justify-center">
              <Image src={cobraLogo} alt="" width={18} height={18} />
            </div>
            <div>
              <span className="font-extrabold text-lg tracking-tight block leading-none">CobraDora</span>
              <span className="text-[10px] opacity-60">CobraDora by Mentel Soluções Digitais — Todos os direitos reservados.</span>
            </div>
          </div>

          <div className="flex items-center gap-6 text-sm font-semibold opacity-80">
            <Link href="/termos-de-uso" className="hover:text-brand-pink transition-colors">Termos de Uso</Link>
            <Link href="/politica-de-privacidade" className="hover:text-brand-pink transition-colors">Privacidade</Link>
            <Link href="/politica-de-cookies" className="hover:text-brand-pink transition-colors">Cookies</Link>
            <a href="mailto:contato@cobradora.com.br" className="hover:text-brand-pink transition-colors">Contato</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
