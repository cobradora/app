"use client";

import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  CreditCard,
  Copy,
  LayoutDashboard,
  Lock,
  Menu,
  Plus,
  Settings,
  UserRound,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiClient, type ManualSettlementInput } from "@/lib/api-client";
import {
  type Charge,
  type Group,
  type OrgSettings,
  type Participant,
  competenceLabels,
  competences,
  formatDate,
  formatMoney,
  groups as seedGroups,
  initialCharges,
  participants as seedParticipants,
} from "@/lib/mock-data";

type ViewId = "overview" | "groups" | "charges" | "settings";

const navItems: { id: ViewId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "Visão Geral", icon: LayoutDashboard },
  { id: "groups", label: "Grupos", icon: Users },
  { id: "charges", label: "Cobrança", icon: WalletCards },
];

export default function GroupayDashboard() {
  const [view, setView] = useState<ViewId>("overview");
  const [groups, setGroups] = useState<Group[]>(seedGroups);
  const [participants, setParticipants] = useState<Participant[]>(seedParticipants);
  const [charges, setCharges] = useState<Charge[]>(initialCharges);
  const [settings, setSettings] = useState<OrgSettings>({ pixKey: "", pixName: "" });
  const [competence, setCompetence] = useState(competences[0]);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [pixModal, setPixModal] = useState(false);
  const [memberModal, setMemberModal] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ name: "", sport: "", amount: "" });
  const [memberForm, setMemberForm] = useState({ name: "", phone: "" });
  const [pixInput, setPixInput] = useState("");

  // Manual settlement modal state
  const [settleModal, setSettleModal] = useState<null | { chargeId: string }>(null);
  const [settleMethod, setSettleMethod] = useState<ManualSettlementInput["paymentMethod"]>("dinheiro");
  const [settleObservation, setSettleObservation] = useState("");
  const [settleError, setSettleError] = useState("");
  const [settleSaving, setSettleSaving] = useState(false);

  // Checkout flow state
  const [checkout, setCheckout] = useState<null | { participant: Participant; group: Group }>(null);
  const [checkoutStep, setCheckoutStep] = useState<"identify" | "confirm">("identify");
  const [phoneInput, setPhoneInput] = useState("");
  const [fullName, setFullName] = useState("");

  const periodCharges = useMemo(
    () => charges.filter((charge) => charge.competence === competence),
    [charges, competence],
  );

  const totals = useMemo(() => {
    const paid = periodCharges.filter((c) => c.status === "paid");
    const pending = periodCharges.filter((c) => c.status === "pending");
    const sum = (list: Charge[]) => list.reduce((acc, item) => acc + item.amount, 0);
    return { paidValue: sum(paid), pendingValue: sum(pending), paidCount: paid.length, pendingCount: pending.length };
  }, [periodCharges]);

  const pendingTotal = charges.filter((c) => c.status === "pending").length;
  const openGroup = groups.find((group) => group.id === openGroupId) ?? null;

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2400);
  }

  useEffect(() => {
    if (!settleModal) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setSettleModal(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settleModal]);

  function go(next: ViewId) {
    setView(next);
    setOpenGroupId(null);
    // Navegação não deve mexer no sidebar — abrir/fechar é responsabilidade
    // exclusiva do clique no ícone de 3 listras (ver botão "Abrir menu" e o
    // botão/overlay de fechar do próprio sidebar).
  }

  function openGroupFrom(id: string) {
    setOpenGroupId(id);
  }

  function nameOf(participantId: string) {
    return participants.find((p) => p.id === participantId)?.name ?? "—";
  }

  function groupOf(groupId: string) {
    return groups.find((g) => g.id === groupId);
  }

  function openSettleModal(chargeId: string) {
    setSettleModal({ chargeId });
    setSettleMethod("dinheiro");
    setSettleObservation("");
    setSettleError("");
  }

  async function confirmSettle() {
    if (!settleModal) return;
    const { chargeId } = settleModal;
    setSettleSaving(true);
    setSettleError("");
    try {
      await apiClient.registerManualSettlement(chargeId, {
        paymentMethod: settleMethod,
        observation: settleObservation.trim() || undefined,
      });
      setCharges((prev) =>
        prev.map((charge) =>
          charge.id === chargeId && charge.status === "pending"
            ? { ...charge, status: "paid", source: "manual", paidAt: `${charge.competence}-15` }
            : charge,
        ),
      );
      setSettleModal(null);
      flash("Pagamento registrado manualmente");
    } catch (error) {
      setSettleError(error instanceof Error ? error.message : "Erro ao registrar pagamento");
    } finally {
      setSettleSaving(false);
    }
  }

  function copyText(value: string, message: string) {
    navigator.clipboard?.writeText(value).then(() => flash(message));
  }

  function memberLink(group: Group) {
    return `https://groupay.com.br/p/${group.id}`;
  }

  function buildChargeMessage(groupId: string, competenceKey: string): string {
    const group = groups.find((g) => g.id === groupId)!;
    const participantsInGroup = participants.filter((p) => p.groupIds.includes(groupId));
    const rows = charges.filter((c) => c.groupId === groupId && c.competence === competenceKey);

    const lines = participantsInGroup.map((person) => {
      const charge = rows.find((c) => c.participantId === person.id);
      const ok = charge?.status === "paid";
      return `${ok ? "✅" : "🔴"} ${person.name} — ${ok ? "pago" : "pendente"}`;
    });

    return [
      `Olá, equipe do *${group.name}*! 🏐`,
      ``,
      `Segue o status dos pagamentos de ${competenceLabels[competenceKey]}:`,
      ``,
      ...lines,
      ``,
      `💰 Quem ainda não pagou, é só acessar o link:`,
      memberLink(group),
      ``,
      `Obrigado!`,
    ].join("\n");
  }

  function findOrCreateByPhone(groupId: string, phone: string): Participant {
    const digits = phone.replace(/\D/g, "");
    const existing = participants.find((p) => p.groupIds.includes(groupId) && p.phone.replace(/\D/g, "") === digits);
    if (existing) return existing;

    const id = `auto-${digits}`;
    let participant = participants.find((p) => p.phone.replace(/\D/g, "") === digits);
    if (participant) {
      const updated = { ...participant, groupIds: [...participant.groupIds, groupId] };
      setParticipants((prev) => prev.map((p) => (p.id === participant!.id ? updated : p)));
      participant = updated;
    } else {
      participant = { id, name: `Participante ${phone}`, initials: "??", phone, groupIds: [groupId] };
      setParticipants((prev) => [...prev, participant!]);
    }
    return participant;
  }

  function addMember(groupId: string) {
    const name = memberForm.name.trim();
    const phone = memberForm.phone.trim();
    if (!name || !phone) return;
    const id = `m-${Date.now()}`;
    setParticipants((prev) => [...prev, { id, name, initials: name.slice(0, 2).toUpperCase(), phone, groupIds: [groupId] }]);
    setCharges((prev) => [
      ...prev,
      { id: `${competence}:${id}:${groupId}`, groupId, participantId: id, competence, amount: groupOf(groupId)?.amount ?? 0, status: "pending", source: null, paidAt: null },
    ]);
    setMemberModal(false);
    setMemberForm({ name: "", phone: "" });
    flash(`${name} adicionado ao ${groupOf(groupId)?.name}`);
  }

  function createGroup() {
    const name = form.name.trim();
    if (!name) return;
    const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${groups.length + 1}`;
    const group: Group = { id, name, sport: form.sport.trim() || "Grupo", initials: name.slice(0, 2).toUpperCase(), color: "#6c7a80", amount: Number(form.amount) || 0, dueDay: 10 };
    setGroups((prev) => [...prev, group]);
    setModalOpen(false);
    setForm({ name: "", sport: "", amount: "" });
    setOpenGroupId(id);
    setView("groups");
    flash(`${name} criado`);
  }

  function createChargeMessage(group: Group) {
    const message = buildChargeMessage(group.id, competence);
    copyText(message, `Mensagem de ${group.name} copiada`);
  }

  function openCheckout(group: Group) {
    setCheckout({ participant: null as never, group });
    setCheckoutStep("identify");
    setPhoneInput("");
  }

  function identifyParticipant() {
    if (!checkout) return;
    const participant = findOrCreateByPhone(checkout.group.id, phoneInput);
    setCheckout({ participant, group: checkout.group });
    setCheckoutStep("confirm");
  }

  function copyPix() {
    if (!settings.pixKey) {
      flash("Nenhuma chave PIX cadastrada pelo organizador");
      return;
    }
    copyText(settings.pixKey, "Chave PIX copiada");
  }

  return (
    <div className="shell">
      {notice && <p className="toast"><span><Check size={13} strokeWidth={3} /></span>{notice}</p>}

      {pixModal && (
        <div className="backdrop" onMouseDown={() => setPixModal(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Chave PIX" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-top"><h2>Chave PIX</h2><button className="ghost-icon" onClick={() => setPixModal(false)} aria-label="Fechar"><X size={18} /></button></div>
            <label htmlFor="pix-key">Chave PIX para receber os pagamentos</label>
            <input id="pix-key" value={pixInput} onChange={(e) => setPixInput(e.target.value)} placeholder="123.456.789-00 ou email@email.com" />
            <label htmlFor="pix-name">Nome do recebedor</label>
            <input id="pix-name" value={settings.pixName} onChange={(e) => setSettings({ ...settings, pixName: e.target.value })} placeholder="Seu nome" />
            <button className="solid full" onClick={() => { setSettings({ ...settings, pixKey: pixInput.trim() }); setPixModal(false); flash("Chave PIX atualizada"); }} disabled={!pixInput.trim()}>Salvar chave</button>
          </div>
        </div>
      )}

      {memberModal && openGroup && (
        <div className="backdrop" onMouseDown={() => setMemberModal(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Participante" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-top"><h2>Adicionar a {openGroup.name}</h2><button className="ghost-icon" onClick={() => setMemberModal(false)} aria-label="Fechar"><X size={18} /></button></div>
            <label htmlFor="m-name">Nome</label>
            <input id="m-name" value={memberForm.name} onChange={(e) => setMemberForm({ ...memberForm, name: e.target.value })} placeholder="Nome do participante" autoFocus />
            <label htmlFor="m-phone">Celular com DDD</label>
            <input id="m-phone" value={memberForm.phone} onChange={(e) => setMemberForm({ ...memberForm, phone: e.target.value })} placeholder="(11) 98812-4410" inputMode="tel" />
            <button className="solid full" onClick={() => addMember(openGroup.id)} disabled={!memberForm.name.trim() || !memberForm.phone.trim()}>Adicionar</button>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="backdrop" onMouseDown={() => setModalOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Novo grupo" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-top"><h2>Novo grupo</h2><button className="ghost-icon" onClick={() => setModalOpen(false)} aria-label="Fechar"><X size={18} /></button></div>
            <label htmlFor="g-name">Nome do grupo</label>
            <input id="g-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Basquete de terça" autoFocus />
            <label htmlFor="g-sport">Modalidade</label>
            <input id="g-sport" value={form.sport} onChange={(e) => setForm({ ...form, sport: e.target.value })} placeholder="Basquete" />
            <label htmlFor="g-amount">Mensalidade (R$)</label>
            <input id="g-amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/\D/g, "") })} inputMode="numeric" placeholder="80" />
            <button className="solid full" onClick={createGroup} disabled={!form.name.trim()}>Criar grupo</button>
          </div>
        </div>
      )}

      {settleModal && (
        <div className="backdrop" onMouseDown={() => !settleSaving && setSettleModal(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Baixa manual" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-top"><h2>Baixa manual</h2><button className="ghost-icon" onClick={() => setSettleModal(null)} aria-label="Fechar" disabled={settleSaving}><X size={18} /></button></div>
            <label htmlFor="settle-method">Forma de pagamento</label>
            <select
              id="settle-method"
              value={settleMethod}
              onChange={(e) => setSettleMethod(e.target.value as ManualSettlementInput["paymentMethod"])}
              disabled={settleSaving}
            >
              <option value="dinheiro">Dinheiro</option>
              <option value="transferencia">Transferência</option>
              <option value="outro">Outro</option>
            </select>
            <label htmlFor="settle-observation">Observação (opcional)</label>
            <textarea
              id="settle-observation"
              value={settleObservation}
              onChange={(e) => setSettleObservation(e.target.value)}
              placeholder="Ex: pago em espécie no vestiário"
              rows={3}
              disabled={settleSaving}
            />
            {settleError && <p className="modal-error">{settleError}</p>}
            <div className="modal-actions">
              <button className="mini" onClick={() => setSettleModal(null)} disabled={settleSaving}>Cancelar</button>
              <button className="solid" onClick={confirmSettle} disabled={settleSaving}>{settleSaving ? "Salvando…" : "Confirmar"}</button>
            </div>
          </div>
        </div>
      )}

      {checkout && (
        <NativeCheckout
          group={checkout.group}
          participant={checkout.participant}
          step={checkoutStep}
          amount={groupOf(checkout.group.id)?.amount ?? 0}
          pixKey={settings.pixKey}
          phone={phoneInput}
          fullName={fullName}
          setFullName={setFullName}
          onPhone={setPhoneInput}
          onIdentify={identifyParticipant}
          onCopyPix={copyPix}
          onConfirm={() => { setCheckout(null); setView("overview"); flash("Pagamento enviado para conciliação"); }}
        />
      )}

      <aside className={`side ${menuOpen ? "open" : ""}`}>
        <div className="side-top">
          <span className="logo"><b /> groupay</span>
          <button className="ghost-icon only-mobile" onClick={() => setMenuOpen(false)} aria-label="Fechar menu"><X size={18} /></button>
        </div>
        <nav>
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} className={view === id && !openGroup ? "nav on" : "nav"} onClick={() => go(id)} aria-current={view === id}>
              <Icon size={17} strokeWidth={1.7} /> {label}
              {id === "charges" && pendingTotal > 0 && <b>{pendingTotal}</b>}
            </button>
          ))}
        </nav>
        <div className="side-end">
          <button className={view === "settings" ? "nav on" : "nav"} onClick={() => go("settings")}><Settings size={17} strokeWidth={1.7} /> Configurações</button>
          <div className="me"><span>LM</span><div><strong>Lucas Martins</strong><small>Organizador</small></div></div>
        </div>
      </aside>

      {menuOpen && <button className="overlay" aria-label="Fechar menu" onClick={() => setMenuOpen(false)} />}

      <main>
        <header className="bar">
          <button className="ghost-icon only-mobile" onClick={() => setMenuOpen(true)} aria-label="Abrir menu"><Menu size={20} /></button>
          <h1>{openGroup ? openGroup.name : navItems.find((item) => item.id === view)?.label ?? "Configurações"}</h1>
          {!openGroup && <select value={competence} onChange={(e) => setCompetence(e.target.value)} aria-label="Competência">{competences.map((item) => <option key={item} value={item}>{competenceLabels[item]}</option>)}</select>}
        </header>

        <div className="page">
          {openGroup && view === "groups" ? (
            <ManagedGroupView
              group={openGroup}
              participants={participants.filter((p) => p.groupIds.includes(openGroup.id))}
              charges={periodCharges.filter((c) => c.groupId === openGroup.id)}
              competence={competence}
              nameOf={nameOf}
              onBack={() => setOpenGroupId(null)}
              onAddMember={() => setMemberModal(true)}
              onSettle={openSettleModal}
              onCopyLink={() => copyText(memberLink(openGroup), `Link de ${openGroup.name} copiado`)}
              onCopyMessage={() => createChargeMessage(openGroup)}
              onOpenCheckout={() => openCheckout(openGroup)}
            />
          ) : view === "overview" ? (
            <>
              <section className="cards">
                <article className="card"><p>Previsto</p><strong>{formatMoney(totals.paidValue + totals.pendingValue)}</strong><small>{periodCharges.length} cobranças</small></article>
                <article className="card green"><p><CheckCircle2 size={13} /> Recebido</p><strong>{formatMoney(totals.paidValue)}</strong><small>{totals.paidCount} pagas</small></article>
                <article className="card red"><p><Clock3 size={13} /> Pendente</p><strong>{formatMoney(totals.pendingValue)}</strong><small>{totals.pendingCount} em aberto</small></article>
              </section>

              <section className="block">
                <div className="block-top"><h2>Grupos</h2><button className="solid" onClick={() => setModalOpen(true)}><Plus size={15} /> Novo</button></div>
                <ul className="list">
                  {groups.map((group) => {
                    const rows = periodCharges.filter((c) => c.groupId === group.id);
                    const pending = rows.filter((c) => c.status === "pending").length;
                    return (
                      <li key={group.id}>
                        <button className="row" onClick={() => openGroupFrom(group.id)}>
                          <span className="row-main"><strong>{group.name}</strong><small>{group.sport} · {formatMoney(group.amount)}/mês</small></span>
                          <span className={pending ? "tag red-tag" : "tag green-tag"}>{pending ? `${pending} pendente${pending > 1 ? "s" : ""}` : "Em dia"}</span>
                          <ChevronRight size={16} className="chev" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>

              {totals.pendingCount > 0 && (
                <section className="block">
                  <div className="block-top"><h2>Pendências de {competenceLabels[competence]}</h2><button className="link" onClick={() => go("charges")}>Cobrança</button></div>
                  <ul className="list">
                    {periodCharges.filter((c) => c.status === "pending").slice(0, 4).map((charge) => (
                      <li key={charge.id}>
                        <div className="row static">
                          <span className="badge soft">{nameOf(charge.participantId).slice(0, 2).toUpperCase()}</span>
                          <span className="row-main"><strong>{nameOf(charge.participantId)}</strong><small>{groupOf(charge.groupId)?.name}</small></span>
                          <strong className="value">{formatMoney(charge.amount)}</strong>
                          <button className="mini" onClick={() => openSettleModal(charge.id)}>Dar baixa</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          ) : view === "groups" ? (
            <section className="block">
              <div className="block-top"><h2>{groups.length} grupos</h2><button className="solid" onClick={() => setModalOpen(true)}><Plus size={15} /> Novo</button></div>
              <ul className="list">
                {groups.map((group) => {
                  const rows = periodCharges.filter((c) => c.groupId === group.id);
                  const paid = rows.filter((c) => c.status === "paid").length;
                  const percent = rows.length ? Math.round((paid / rows.length) * 100) : 0;
                  return (
                    <li key={group.id}>
                      <div className="row static wrap">
                        <span className="row-main"><strong>{group.name}</strong><small>{group.sport} · vence dia {group.dueDay} · {formatMoney(group.amount)}/mês</small></span>
                        <span className="bar-mini"><span style={{ width: `${percent}%` }} /><small>{paid}/{rows.length} pagos</small></span>
                        <button className="mini dark" onClick={() => openGroupFrom(group.id)}>Abrir</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : view === "charges" ? (
            <section className="block">
              <div className="block-top"><h2>Cobrança · {competenceLabels[competence]}</h2></div>
              <ChargeTabs
                charges={periodCharges}
                nameOf={nameOf}
                groupOf={groupOf}
                onSettle={openSettleModal}
              />
            </section>
          ) : (
            <section className="block">
              <div className="block-top"><h2>Configurações</h2></div>
              <ul className="list">
                <li>
                  <div className="row static">
                    <span className="row-main"><strong>Chave PIX para receber</strong><small>{settings.pixKey ? `PIX · ${settings.pixKey}` : "Nenhuma chave cadastrada"}</small></span>
                    <button className="mini" onClick={() => { setPixInput(settings.pixKey); setPixModal(true); }}><CreditCard size={13} /> {settings.pixKey ? "Editar" : "Cadastrar"}</button>
                  </div>
                </li>
                <li><div className="row static"><span className="row-main"><strong>Gateway de pagamento</strong><small>Split nativo por conta conectada</small></span><span className="tag green-tag">Conectado</span></div></li>
                <li><div className="row static"><span className="row-main"><strong>Modelo de cobrança</strong><small>Plano + comissão por pagamento</small></span><span className="tag green-tag">Ativo</span></div></li>
                <li><div className="row static"><span className="row-main"><strong>Organização</strong><small>Arena Martins · multi-tenant</small></span><span className="tag green-tag">Ativa</span></div></li>
              </ul>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

function NativeCheckout({
  group,
  participant,
  step,
  amount,
  pixKey,
  phone,
  fullName,
  setFullName,
  onPhone,
  onIdentify,
  onCopyPix,
  onConfirm,
}: {
  group: Group;
  participant: Participant;
  step: "identify" | "confirm";
  amount: number;
  pixKey: string;
  phone: string;
  fullName: string;
  setFullName: (value: string) => void;
  onPhone: (value: string) => void;
  onIdentify: () => void;
  onCopyPix: () => void;
  onConfirm: () => void;
}) {
  return (
    <main className="checkout-fixed">
      <div className="checkout-card">
        <span className="checkout-logo"><b /> groupay</span>

        {step === "identify" ? (
          <>
            <h1>{group.name}</h1>
            <p className="checkout-sub">Identifique-se para ver suas cobranças.</p>
            <label className="checkout-label" htmlFor="co-phone">Seu celular</label>
            <div className="checkout-input">
              <span className="placeholder">[ &nbsp;]</span>
              <input id="co-phone" value={phone} onChange={(e) => onPhone(e.target.value)} placeholder="(11) 98812-4410" inputMode="tel" autoFocus />
            </div>
            <button className="solid full" onClick={onIdentify} disabled={phone.replace(/\D/g, "").length < 10}>Continuar</button>
            <p className="checkout-hint"><Lock size={12} /> Seu número é usado apenas para identificar suas cobranças neste grupo.</p>
          </>
        ) : (
          <>
            <span className="checkout-check"><Check size={26} strokeWidth={3} /></span>
            <h1>Olá, {participant.name}!</h1>
            <p className="checkout-sub">Você tem <strong>{1}</strong> pendência em <strong>{group.name}</strong>.</p>
            <div className="charge-row">
              <span className="charge-info"><strong>{participant.name}</strong><small>{group.name} · Cobrança do mês</small></span>
              <strong className="charge-amount">{formatMoney(amount)}</strong>
            </div>
            <label className="checkout-label" htmlFor="co-name">Seu nome completo</label>
            <input id="co-name" className="checkout-input text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nome completo" />
            <button className="solid full" onClick={onConfirm} disabled={!fullName.trim()}>Gerar PIX</button>
            <p className="checkout-hint">O PIX será pago via chave do organizador.</p>

            {pixKey && (
              <div className="pix-key">
                <span><small>Chave PIX</small><strong>{pixKey}</strong></span>
                <button className="mini" onClick={onCopyPix}><Copy size={13} /> Copiar</button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function ManagedGroupView({
  group,
  participants,
  charges,
  competence,
  nameOf,
  onBack,
  onAddMember,
  onSettle,
  onCopyLink,
  onCopyMessage,
  onOpenCheckout,
}: {
  group: Group;
  participants: Participant[];
  charges: Charge[];
  competence: string;
  nameOf: (id: string) => string;
  onBack: () => void;
  onAddMember: () => void;
  onSettle: (id: string) => void;
  onCopyLink: () => void;
  onCopyMessage: () => void;
  onOpenCheckout: () => void;
}) {
  const paid = charges.filter((c) => c.status === "paid");
  const pending = charges.filter((c) => c.status === "pending");

  return (
    <>
      <button className="back" onClick={onBack}><ArrowLeft size={15} /> Voltar</button>
      <section className="detail">
        <div><strong>{group.name}</strong><small>{group.sport} · {formatMoney(group.amount)}/mês · {competenceLabels[competence]}</small></div>
        <div className="detail-btns">
          <button className="mini" onClick={onCopyLink}><Copy size={13} /> Copiar link</button>
          <button className="mini" onClick={onCopyMessage}><Copy size={13} /> Copiar mensagem</button>
          <button className="mini primary" onClick={onOpenCheckout}><CreditCard size={13} /> Link de pagamento</button>
        </div>
      </section>

      <section className="cards">
        <article className="card green"><p>Recebido</p><strong>{formatMoney(paid.reduce((a, c) => a + c.amount, 0))}</strong><small>{paid.length} pagas</small></article>
        <article className="card red"><p>Pendente</p><strong>{formatMoney(pending.reduce((a, c) => a + c.amount, 0))}</strong><small>{pending.length} em aberto</small></article>
      </section>

      <section className="block">
        <div className="block-top"><h2>Participantes ({participants.length})</h2><button className="solid" onClick={onAddMember}><Plus size={15} /> Adicionar</button></div>
        <ul className="list">
          {participants.map((person) => {
            const charge = charges.find((c) => c.participantId === person.id);
            const status = charge?.status ?? "pending";
            return (
              <li key={person.id}>
                <div className="row static">
                  <span className={status === "paid" ? "dot green-dot" : "dot red-dot"} />
                  <span className="row-main"><strong>{person.name}</strong><small>{person.phone} · {status === "paid" ? `Pago em ${charge?.paidAt ? formatDate(charge.paidAt) : ""}` : "Aguardando pagamento"}</small></span>
                  <strong className="value">{formatMoney(charge?.amount ?? 0)}</strong>
                  {status === "pending" && <button className="mini" onClick={() => onSettle(charge!.id)}>Baixa manual</button>}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

function ChargeTabs({
  charges,
  nameOf,
  groupOf,
  onSettle,
}: {
  charges: Charge[];
  nameOf: (id: string) => string;
  groupOf: (id: string) => Group | undefined;
  onSettle: (id: string) => void;
}) {
  const [filter, setFilter] = useState<"all" | "pending" | "paid">("all");
  const shown = charges.filter((charge) => (filter === "all" ? true : charge.status === filter));

  return (
    <>
      <div className="tabs">
        {(["all", "pending", "paid"] as const).map((key) => (
          <button key={key} className={filter === key ? "tab on" : "tab"} onClick={() => setFilter(key)}>
            {key === "all" ? "Todas" : key === "pending" ? "Pendentes" : "Pagas"}
          </button>
        ))}
      </div>
      {shown.length === 0 ? <p className="empty">Nenhuma cobrança nesta seleção.</p> : (
        <ul className="list">
          {shown.map((charge) => (
            <li key={charge.id}>
              <div className="row static">
                <span className={charge.status === "paid" ? "dot green-dot" : "dot red-dot"} />
                <span className="row-main"><strong>{nameOf(charge.participantId)}</strong><small>{groupOf(charge.groupId)?.name}{charge.paidAt ? ` · pago em ${formatDate(charge.paidAt)}` : " · em aberto"}</small></span>
                {charge.source && <span className="chip">{charge.source === "manual" ? "Manual" : "Checkout"}</span>}
                <strong className="value">{formatMoney(charge.amount)}</strong>
                {charge.status === "pending" && <button className="mini" onClick={() => onSettle(charge.id)}>Baixa</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
