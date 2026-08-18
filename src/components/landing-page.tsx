"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import cobraLogo from "@/images/logo-cobra-sem-fundo.png";

type BillingPeriod = "monthly" | "annual";

const PLANS = [
  {
    name: "Plano Básico",
    description: "Para quem gerencia um grupo pequeno de amigos ou esportes.",
    monthly: "R$ 14,90",
    annual: "R$ 10,43",
    annualTotal: "R$ 125,16/ano",
    savings: "Economia de R$ 53,64/ano",
    featured: false,
    features: [
      "1 grupo ativo no painel",
      "Até 50 participantes",
      "Importação rápida de lista de texto",
      "Links de cobrança e baixa manual",
    ],
  },
  {
    name: "Plano Essencial",
    description: "Ideal para organizadores de ligas locais ou assessorias esportivas.",
    monthly: "R$ 49,90",
    annual: "R$ 34,93",
    annualTotal: "R$ 419,16/ano",
    savings: "Economia de R$ 179,64/ano",
    featured: true,
    features: [
      "Até 10 grupos ativos",
      "Até 500 participantes",
      "Importação rápida de lista de texto",
      "Links de cobrança e baixa manual",
    ],
  },
  {
    name: "Plano Escala",
    description: "Para grandes comunidades, clubes e arenas com alto volume.",
    monthly: "R$ 99,90",
    annual: "R$ 69,93",
    annualTotal: "R$ 839,16/ano",
    savings: "Economia de R$ 359,64/ano",
    featured: false,
    features: [
      "Até 50 grupos ativos",
      "Até 5.000 participantes",
      "Importação rápida de lista de texto",
      "Links de cobrança e baixa manual",
    ],
  },
];

export default function LandingPage() {
  const [billing, setBilling] = useState<BillingPeriod>("monthly");

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
            <a href="#como-funciona" className="hover:text-brand-pink transition-colors">Como Funciona</a>
            <a href="#dashboard" className="hover:text-brand-pink transition-colors">O Painel</a>
            <a href="#beneficios" className="hover:text-brand-pink transition-colors">Benefícios</a>
            <a href="#precos" className="hover:text-brand-pink transition-colors">Preços</a>
          </nav>

          <Link href="/signup" className="btn-3d bg-brand-pink text-brand-chocolate font-bold text-sm px-5 py-2.5 rounded-full border-2 border-brand-chocolate inline-block hover:bg-white transition-all">
            Criar meu Grupo
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
              Controle as mensalidades do seu grupo <span className="text-brand-pink underline decoration-brand-chocolate decoration-4">sem planilhas</span>.
            </h1>
            <p className="text-lg md:text-xl text-brand-chocolate/80 max-w-xl mx-auto lg:mx-0 font-medium">
              Cadastre seus participantes, gere links de cobrança personalizados e envie diretamente no WhatsApp com um clique. Você no controle absoluto, sem estresse.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4 pt-4">
              <Link href="/signup" className="btn-3d w-full sm:w-auto text-center bg-brand-pink text-brand-chocolate font-bold text-base px-8 py-4 rounded-full border-2 border-brand-chocolate hover:bg-white transition-all">
                Criar Grupo Grátis
              </Link>
              <a href="#como-funciona" className="w-full sm:w-auto text-center bg-transparent text-brand-chocolate font-bold text-base px-8 py-4 rounded-full border-2 border-transparent hover:border-brand-chocolate/20 transition-all">
                Ver como funciona →
              </a>
            </div>

            <div className="pt-6 flex flex-wrap items-center justify-center lg:justify-start gap-6 text-sm font-semibold opacity-90">
              <div className="flex items-center gap-2">
                <span className="text-brand-pink text-lg">✓</span> Importação rápida de participantes
              </div>
              <div className="flex items-center gap-2">
                <span className="text-brand-pink text-lg">✓</span> Baixa manual simples e rápida
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
            <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight">Como a CobraDora funciona?</h2>
            <p className="text-base text-brand-chocolate/70 font-medium">
              Um fluxo prático e sem complicações para você gerenciar seus recebimentos manualmente no WhatsApp, sem precisar de integrações complexas.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            <div className="bg-brand-creme border-2 border-brand-chocolate p-8 rounded-2xl relative shadow-[4px_4px_0px_#3B2117]">
              <div className="w-12 h-12 bg-brand-pink rounded-full border-2 border-brand-chocolate flex items-center justify-center font-extrabold text-lg mb-6 shadow-[2px_2px_0px_#3B2117]">1</div>
              <h3 className="text-lg font-extrabold mb-3">Cadastre e Importe</h3>
              <p className="text-sm text-brand-chocolate/80 leading-relaxed font-medium">
                Adicione os participantes do grupo informando o número de cada um. Se preferir, você pode <span className="font-bold">importar uma lista de texto</span> completa em segundos.
              </p>
            </div>

            <div className="bg-brand-creme border-2 border-brand-chocolate p-8 rounded-2xl relative shadow-[4px_4px_0px_#3B2117]">
              <div className="w-12 h-12 bg-brand-pink rounded-full border-2 border-brand-chocolate flex items-center justify-center font-extrabold text-lg mb-6 shadow-[2px_2px_0px_#3B2117]">2</div>
              <h3 className="text-lg font-extrabold mb-3">Conecte seu recebimento</h3>
              <p className="text-sm text-brand-chocolate/80 leading-relaxed font-medium">
                Antes de cobrar online, conecte gratuitamente sua <span className="font-bold">conta InfinitePay</span> em Configurações — é ela quem recebe os pagamentos direto pra você. Depois disso, o sistema gera os links personalizados e você só clica para enviar no WhatsApp de cada participante.
              </p>
            </div>

            <div className="bg-brand-creme border-2 border-brand-chocolate p-8 rounded-2xl relative shadow-[4px_4px_0px_#3B2117]">
              <div className="w-12 h-12 bg-brand-pink rounded-full border-2 border-brand-chocolate flex items-center justify-center font-extrabold text-lg mb-6 shadow-[2px_2px_0px_#3B2117]">3</div>
              <h3 className="text-lg font-extrabold mb-3">Controle e Atualize</h3>
              <p className="text-sm text-brand-chocolate/80 leading-relaxed font-medium">
                Dê baixa manual nos pagamentos recebidos e gerencie facilmente a entrada, saída ou atualização de novos participantes diretamente no seu painel.
              </p>
            </div>
          </div>

          <div className="mt-12 bg-brand-pink-light border-2 border-brand-chocolate p-6 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-[4px_4px_0px_#3B2117]">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-[#26A5E4] rounded-full border-2 border-brand-chocolate flex items-center justify-center text-white text-2xl shadow-[2px_2px_0px_#3B2117]">✈️</div>
              <div>
                <h4 className="font-extrabold text-base">Em breve: Automação Total no Telegram!</h4>
                <p className="text-xs text-brand-chocolate/80 font-medium">O fluxo 100% automatizado com nosso bot integrado diretamente no grupo estará disponível em breve para o Telegram.</p>
              </div>
            </div>
            <span className="bg-brand-chocolate text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider shrink-0">Em Desenvolvimento</span>
          </div>
        </div>
      </section>

      {/* Benefícios */}
      <section id="beneficios" className="py-20 bg-brand-creme">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-5 space-y-6">
              <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight leading-tight">
                Menos inadimplência, zero estresse e mais tempo para você.
              </h2>
              <p className="text-brand-chocolate/80 font-medium leading-relaxed">
                Cobrar amigos, alunos ou clientes manualmente é desconfortável e consome horas do seu dia. A CobraDora facilita esse processo fornecendo as ferramentas ideais para você gerenciar tudo em um só lugar.
              </p>
              <div className="space-y-4 pt-2">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-brand-pink/30 flex items-center justify-center shrink-0 mt-1">
                    <span className="text-brand-chocolate font-bold text-xs">✓</span>
                  </div>
                  <div>
                    <h4 className="font-bold text-sm">Importação Inteligente</h4>
                    <p className="text-xs text-brand-chocolate/70">Cole uma lista de nomes e números e o sistema cadastra todos de uma vez.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-brand-pink/30 flex items-center justify-center shrink-0 mt-1">
                    <span className="text-brand-chocolate font-bold text-xs">✓</span>
                  </div>
                  <div>
                    <h4 className="font-bold text-sm">Controle de Entradas e Saídas</h4>
                    <p className="text-xs text-brand-chocolate/70">Adicione novos membros ou remova quem saiu do grupo com poucos cliques.</p>
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
                      <h4 className="font-extrabold text-xs text-emerald-900">Grupo kmura (Mensalidades)</h4>
                      <span className="text-[9px] text-emerald-700 font-semibold">Você e mais 15 membros</span>
                    </div>
                  </div>

                  <div className="flex gap-2.5 max-w-[85%]">
                    <div className="w-8 h-8 bg-brand-pink rounded-full border border-brand-chocolate flex items-center justify-center shrink-0">
                      <span className="text-brand-chocolate font-extrabold text-xs">A</span>
                    </div>
                    <div className="bg-white border border-brand-chocolate/10 p-3 rounded-2xl rounded-tl-none shadow-sm text-xs space-y-2">
                      <p className="font-bold text-brand-chocolate">Organizador (Você)</p>
                      <p>Olá, pessoal! Passando para lembrar que a mensalidade do grupo vence amanhã (dia 10).</p>
                      <p className="font-semibold">Valor: R$ 50,00</p>
                      <p className="bg-brand-creme p-2 rounded border border-brand-chocolate/10 font-mono text-[10px] break-all">
                        https://cobradora.com.br/g/kmura-willyan
                      </p>
                      <p className="text-[9px] opacity-60">Acesse o link acima para realizar o pagamento e garantir sua vaga!</p>
                    </div>
                  </div>

                  <div className="flex gap-2.5 max-w-[85%] ml-auto justify-end">
                    <div className="bg-[#DCF8C6] border border-brand-chocolate/10 p-3 rounded-2xl rounded-tr-none shadow-sm text-xs space-y-1">
                      <p className="font-bold text-emerald-900">Willyan (Membro)</p>
                      <p>Pago! Segue o comprovante. ✅</p>
                    </div>
                  </div>

                  <div className="flex gap-2.5 max-w-[85%]">
                    <div className="w-8 h-8 bg-brand-pink rounded-full border border-brand-chocolate flex items-center justify-center shrink-0">
                      <span className="text-brand-chocolate font-extrabold text-xs">A</span>
                    </div>
                    <div className="bg-white border border-brand-chocolate/10 p-3 rounded-2xl rounded-tl-none shadow-sm text-xs space-y-1">
                      <p className="font-bold text-brand-chocolate">Organizador (Você)</p>
                      <p>✅ <span className="font-bold">Baixa confirmada!</span> Obrigado, Willyan. Já atualizei seu status no painel da CobraDora.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Preços */}
      <section id="precos" className="py-20 bg-white border-t-2 border-brand-chocolate/10">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-12 space-y-4">
            <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight">Planos simples e transparentes</h2>
            <p className="text-base text-brand-chocolate/70 font-medium">
              Escolha o plano ideal para o tamanho do seu grupo. Economize 30% assinando o plano anual.
            </p>

            <div className="inline-flex items-center p-1.5 bg-brand-creme border-2 border-brand-chocolate rounded-full mt-6">
              <button
                type="button"
                onClick={() => setBilling("monthly")}
                className={`px-6 py-2 rounded-full text-sm font-bold transition-all ${billing === "monthly" ? "bg-brand-chocolate text-white" : "text-brand-chocolate"}`}
              >
                Mensal
              </button>
              <button
                type="button"
                onClick={() => setBilling("annual")}
                className={`px-6 py-2 rounded-full text-sm font-bold transition-all flex items-center gap-1.5 ${billing === "annual" ? "bg-brand-chocolate text-white" : "text-brand-chocolate"}`}
              >
                Anual <span className="bg-brand-pink text-brand-chocolate text-[10px] px-2 py-0.5 rounded-full font-extrabold">30% OFF</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto items-stretch">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`bg-brand-creme border-2 border-brand-chocolate rounded-3xl p-8 flex flex-col justify-between relative ${plan.featured ? "shadow-[8px_8px_0px_#3B2117] transform lg:-translate-y-2" : "shadow-[6px_6px_0px_#3B2117]"}`}
              >
                {plan.featured && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-brand-pink border-2 border-brand-chocolate text-brand-chocolate font-bold text-xs px-4 py-1 rounded-full uppercase tracking-wider">
                    Mais Popular
                  </div>
                )}

                <div className="space-y-6">
                  <div className="space-y-2">
                    <h3 className="text-xl font-extrabold">{plan.name}</h3>
                    <p className="text-xs text-brand-chocolate/60">{plan.description}</p>
                  </div>

                  <div className="pt-2">
                    {billing === "monthly" ? (
                      <div>
                        <span className="text-4xl font-extrabold">{plan.monthly}</span>
                        <span className="text-sm opacity-75">/mês</span>
                      </div>
                    ) : (
                      <div>
                        <span className="text-4xl font-extrabold">{plan.annual}</span>
                        <span className="text-sm opacity-75">/mês</span>
                        <span className="block text-[10px] text-brand-green-text font-bold mt-1">Faturado anualmente ({plan.annualTotal})</span>
                        <span className="inline-block bg-brand-green-menta text-brand-green-text text-[10px] font-extrabold px-2.5 py-0.5 rounded-full mt-1">{plan.savings}</span>
                      </div>
                    )}
                  </div>

                  <ul className="space-y-4 text-sm font-semibold border-t border-brand-chocolate/10 pt-6">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-3">
                        <span className="text-brand-pink text-lg">✓</span> {feature}
                      </li>
                    ))}
                    <li className={`flex items-center justify-between gap-2 transition-all ${billing === "annual" ? "" : "opacity-40 line-through"}`}>
                      <span className="flex items-center gap-3">
                        <span className="text-brand-pink text-lg">✓</span> Suporte via WhatsApp
                      </span>
                      {billing === "annual" && (
                        <span className="bg-brand-chocolate text-white text-[9px] px-2 py-0.5 rounded-full font-bold">Exclusivo Anual</span>
                      )}
                    </li>
                  </ul>
                </div>

                <div className="pt-8">
                  <Link
                    href="/signup"
                    className={`btn-3d w-full block text-center font-bold text-sm rounded-full border-2 border-brand-chocolate transition-all ${
                      plan.featured
                        ? "bg-brand-pink text-brand-chocolate py-3.5 hover:bg-white"
                        : "bg-white text-brand-chocolate py-3 hover:bg-brand-pink"
                    }`}
                  >
                    {plan.featured ? "Começar Teste Grátis" : "Começar Grátis"}
                  </Link>
                </div>
              </div>
            ))}
          </div>

          <div className="max-w-6xl mx-auto mt-12 bg-brand-chocolate text-brand-creme p-6 md:p-8 rounded-3xl border-2 border-brand-chocolate flex flex-col md:flex-row items-center justify-between gap-6 shadow-[6px_6px_0px_#FF85A2]">
            <div className="space-y-2 text-center md:text-left">
              <h4 className="text-xl font-extrabold">Precisa de mais grupos ou participantes?</h4>
              <p className="text-sm opacity-80 max-w-2xl">Oferecemos soluções sob medida para grandes corporações, federações esportivas e clubes de grande porte com suporte dedicado.</p>
            </div>
            <a href="mailto:corporativo@cobradora.com.br" className="btn-3d bg-brand-pink text-brand-chocolate font-extrabold text-sm px-6 py-3 rounded-full border-2 border-brand-chocolate hover:bg-white transition-all whitespace-nowrap">
              Falar com Consultor
            </a>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 bg-brand-creme border-t-2 border-brand-chocolate/10">
        <div className="max-w-4xl mx-auto px-4">
          <h2 className="text-3xl font-extrabold tracking-tight text-center mb-10 -translate-y-[1cm]">Perguntas Frequentes</h2>

          <div className="space-y-6">
            <div className="bg-white border-2 border-brand-chocolate p-6 rounded-2xl">
              <h3 className="font-extrabold text-base mb-2">Como funciona a importação de participantes?</h3>
              <p className="text-sm text-brand-chocolate/80 leading-relaxed font-medium">
                Você pode colar uma lista simples de texto contendo o nome e o número de telefone de cada participante. O sistema processa e cadastra todos automaticamente em poucos segundos.
              </p>
            </div>

            <div className="bg-white border-2 border-brand-chocolate p-6 rounded-2xl">
              <h3 className="font-extrabold text-base mb-2">Preciso ter conta na InfinitePay?</h3>
              <p className="text-sm text-brand-chocolate/80 leading-relaxed font-medium">
                Sim, pra receber pagamentos online pelo link de cobrança. É gratuito e leva poucos minutos: depois de criar sua conta CobraDora, você conecta seu InfiniteTag em Configurações → Conta InfinitePay, e os pagamentos caem direto pra você. Enquanto isso, dá pra usar a baixa manual normalmente.
              </p>
            </div>

            <div className="bg-white border-2 border-brand-chocolate p-6 rounded-2xl">
              <h3 className="font-extrabold text-base mb-2">Como faço para dar baixa nos pagamentos?</h3>
              <p className="text-sm text-brand-chocolate/80 leading-relaxed font-medium">
                No seu painel de controle, basta localizar o nome do participante que realizou o pagamento e clicar em &quot;Dar Baixa&quot;. O status dele será atualizado imediatamente no dashboard.
              </p>
            </div>

            <div className="bg-white border-2 border-brand-chocolate p-6 rounded-2xl">
              <h3 className="font-extrabold text-base mb-2">Posso gerenciar a entrada e saída de membros?</h3>
              <p className="text-sm text-brand-chocolate/80 leading-relaxed font-medium">
                Sim! Você tem total flexibilidade para adicionar novos membros a qualquer momento ou remover aqueles que saíram do grupo, mantendo sua lista sempre atualizada.
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
              <span className="text-[10px] opacity-60">© 2026 — Todos os direitos reservados.</span>
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
