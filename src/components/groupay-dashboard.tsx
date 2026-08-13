"use client";

import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ClipboardPaste,
  CreditCard,
  Copy,
  LayoutDashboard,
  LogOut,
  Menu,
  Pencil,
  Plus,
  Settings,
  Trash2,
  UserRound,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient, type ManualSettlementInput, type GroupCharge, type OrgCharge, type GroupParticipant, type GatewayAccount } from "@/lib/api-client";
import {
  type Charge,
  type Group,
  type OrgSettings,
  type Participant,
  formatDate,
  formatMoney,
} from "@/lib/mock-data";

type ViewId = "overview" | "groups" | "charges" | "settings";

type ImportRow = { id: string; name: string; include: boolean; phone: string; error: string };

const GROUP_COLORS = ["#64798f", "#5f8271", "#93805f", "#7a6b9c", "#9c6b6b"];

type ApiGroup = {
  id: string;
  name: string;
  publicSlug: string;
  billingDay: number;
  defaultAmount: number;
  status: "active" | "archived";
};

function mapApiGroup(raw: unknown, index: number): Group {
  const g = raw as ApiGroup;
  return {
    id: g.id,
    name: g.name,
    sport: "",
    initials: g.name.slice(0, 2).toUpperCase(),
    color: GROUP_COLORS[index % GROUP_COLORS.length],
    amount: g.defaultAmount / 100,
    dueDay: g.billingDay,
    publicSlug: g.publicSlug,
    status: g.status,
  };
}

const RESOLVED_CHARGE_STATUSES = new Set(["paid", "manually_paid", "canceled", "refunded"]);

function mapRealCharge(row: GroupCharge, groupId: string): Charge {
  return {
    id: row.chargeId,
    groupId,
    participantId: row.participantId,
    participantName: row.participantName,
    competence: row.referenceMonth,
    amount: row.totalAmount / 100,
    status: RESOLVED_CHARGE_STATUSES.has(row.status) ? "paid" : "pending",
    source: row.status === "manually_paid" ? "manual" : row.status === "paid" ? "checkout" : null,
    paidAt: null,
  };
}

function mapOrgCharge(row: OrgCharge): Charge {
  return mapRealCharge(row, row.groupId);
}

function mapGroupParticipant(row: GroupParticipant, groupId: string): Participant {
  return {
    id: row.participantId,
    name: row.name,
    initials: (row.name || "?").slice(0, 2).toUpperCase(),
    phone: row.phoneDisplay,
    groupIds: [groupId],
  };
}

const MONTH_NAMES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function monthLabel(referenceMonth: string): string {
  const [year, month] = referenceMonth.split("-").map(Number);
  return `${MONTH_NAMES_PT[month - 1]} ${year}`;
}

function recentMonths(count: number): string[] {
  const now = new Date();
  const months: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

const RECENT_MONTHS = recentMonths(5);

const navItems: { id: ViewId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "Visão Geral", icon: LayoutDashboard },
  { id: "groups", label: "Grupos", icon: Users },
  { id: "charges", label: "Cobrança", icon: WalletCards },
];

export default function GroupayDashboard() {
  const router = useRouter();
  const [view, setView] = useState<ViewId>("overview");
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [settings, setSettings] = useState<OrgSettings>({ pixKey: "", pixName: "" });
  const [competence, setCompetence] = useState(RECENT_MONTHS[0]);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [pixModal, setPixModal] = useState(false);
  const [gatewayAccount, setGatewayAccount] = useState<GatewayAccount | null>(null);
  const [gatewayModal, setGatewayModal] = useState(false);
  const [gatewayInput, setGatewayInput] = useState("");
  const [gatewaySaving, setGatewaySaving] = useState(false);
  const [gatewayError, setGatewayError] = useState("");
  const [memberModal, setMemberModal] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [form, setForm] = useState({ name: "", sport: "", amount: "" });
  const [memberForm, setMemberForm] = useState({ name: "", phone: "" });
  const [memberSaving, setMemberSaving] = useState(false);
  const [memberError, setMemberError] = useState("");
  const [pixInput, setPixInput] = useState("");

  // Manual settlement modal state
  const [settleModal, setSettleModal] = useState<null | { chargeId: string }>(null);
  const [settleMethod, setSettleMethod] = useState<ManualSettlementInput["paymentMethod"]>("dinheiro");
  const [settleObservation, setSettleObservation] = useState("");
  const [settleError, setSettleError] = useState("");
  const [settleSaving, setSettleSaving] = useState(false);

  // Grupo: editar nome / arquivar
  const [groupEditModal, setGroupEditModal] = useState(false);
  const [groupEditName, setGroupEditName] = useState("");
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState(false);
  const [groupSaving, setGroupSaving] = useState(false);
  const [groupError, setGroupError] = useState("");
  const [billingSaving, setBillingSaving] = useState(false);

  // Participante: modal de detalhe (excluir e editar usam a API real)
  const [participantModal, setParticipantModal] = useState<null | { groupId: string; participantId: string }>(null);
  const [participantEditForm, setParticipantEditForm] = useState({ name: "", phone: "" });
  const [participantSaving, setParticipantSaving] = useState(false);
  const [participantError, setParticipantError] = useState("");

  // Importar lista de participantes (colar nomes -> mapear -> escolher -> telefone -> API real)
  const [importModal, setImportModal] = useState(false);
  const [importText, setImportText] = useState("");
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importSaving, setImportSaving] = useState(false);

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
  const activeGroups = useMemo(() => groups.filter((g) => g.status !== "archived"), [groups]);
  const openGroup = groups.find((group) => group.id === openGroupId) ?? null;

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2400);
  }

  function mergeCharges(mapped: Charge[]) {
    setCharges((prev) => {
      const map = new Map(prev.map((c) => [c.id, c]));
      for (const charge of mapped) map.set(charge.id, charge);
      return Array.from(map.values());
    });
  }

  function upsertParticipantInMap(map: Map<string, Participant>, person: Participant, groupId: string) {
    const existing = map.get(person.id);
    map.set(
      person.id,
      existing
        ? { ...existing, name: person.name, initials: person.initials, phone: person.phone, groupIds: Array.from(new Set([...existing.groupIds, groupId])) }
        : person,
    );
  }

  // Faz upsert de um unico participante recem adicionado a `groupId` — soma
  // esse grupo aos `groupIds` de quem ja e conhecido (pode estar em outros
  // grupos), sem mexer em mais ninguem.
  function upsertParticipant(person: Participant, groupId: string) {
    setParticipants((prev) => {
      const map = new Map(prev.map((p) => [p.id, p]));
      upsertParticipantInMap(map, person, groupId);
      return Array.from(map.values());
    });
  }

  // Reconcilia a lista de participantes de `groupId` com uma busca completa
  // e autoritativa (todos os participantes ativos daquele grupo agora): tira
  // `groupId` de quem nao veio mais na lista (saiu do grupo desde a ultima
  // busca), sem apagar o participante por completo caso ele ainda pertenca a
  // outro grupo.
  function reconcileGroupParticipants(mapped: Participant[], groupId: string) {
    setParticipants((prev) => {
      const map = new Map(prev.map((p) => [p.id, p]));
      const fetchedIds = new Set(mapped.map((p) => p.id));
      for (const [id, existing] of map) {
        if (existing.groupIds.includes(groupId) && !fetchedIds.has(id)) {
          map.set(id, { ...existing, groupIds: existing.groupIds.filter((g) => g !== groupId) });
        }
      }
      for (const person of mapped) upsertParticipantInMap(map, person, groupId);
      return Array.from(map.values());
    });
  }

  async function fetchGroupCharges(groupId: string) {
    try {
      const rows = await apiClient.listGroupCharges(groupId);
      mergeCharges(rows.map((row) => mapRealCharge(row, groupId)));
    } catch (error) {
      flash(error instanceof Error ? error.message : "Erro ao carregar cobranças do grupo");
    }
  }

  function openGatewayModal() {
    setGatewayInput(gatewayAccount?.externalAccountId ?? "");
    setGatewayError("");
    setGatewayModal(true);
  }

  async function saveGatewayHandle() {
    const handle = gatewayInput.trim();
    if (!handle) return;
    setGatewaySaving(true);
    setGatewayError("");
    try {
      const account = await apiClient.setInfinitePayHandle(handle);
      setGatewayAccount(account);
      setGatewayModal(false);
      flash("Conta InfinitePay atualizada");
    } catch (error) {
      setGatewayError(error instanceof Error ? error.message : "Erro ao salvar a conta InfinitePay");
    } finally {
      setGatewaySaving(false);
    }
  }

  async function handleLogout() {
    try {
      await apiClient.logout();
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  useEffect(() => {
    let cancelled = false;
    apiClient
      .listGroups()
      .then((raw) => {
        if (cancelled) return;
        setGroups(raw.map((g, index) => mapApiGroup(g, index)));
      })
      .catch(() => {
        if (!cancelled) flash("Não foi possível carregar os grupos do servidor — verifique se sua sessão ainda é válida");
      })
      .finally(() => {
        if (!cancelled) setGroupsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .getInfinitePayAccount()
      .then((account) => {
        if (!cancelled) setGatewayAccount(account);
      })
      .catch(() => {
        if (!cancelled) flash("Não foi possível carregar a conta de pagamento");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!openGroupId) return;
    let cancelled = false;
    apiClient
      .listGroupCharges(openGroupId)
      .then((rows) => {
        if (cancelled) return;
        mergeCharges(rows.map((row) => mapRealCharge(row, openGroupId)));
      })
      .catch(() => {
        if (!cancelled) flash("Erro ao carregar cobranças do grupo");
      });
    return () => {
      cancelled = true;
    };
  }, [openGroupId]);

  useEffect(() => {
    if (!openGroupId) return;
    let cancelled = false;
    apiClient
      .listGroupParticipants(openGroupId)
      .then((rows) => {
        if (cancelled) return;
        reconcileGroupParticipants(rows.map((row) => mapGroupParticipant(row, openGroupId)), openGroupId);
      })
      .catch(() => {
        if (!cancelled) flash("Erro ao carregar participantes do grupo");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openGroupId]);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .listOrganizationCharges(competence)
      .then((rows) => {
        if (cancelled) return;
        mergeCharges(rows.map(mapOrgCharge));
      })
      .catch(() => {
        if (!cancelled) flash("Erro ao carregar cobranças do mês");
      });
    return () => {
      cancelled = true;
    };
  }, [competence]);

  useEffect(() => {
    if (!settleModal) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setSettleModal(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settleModal]);

  useEffect(() => {
    if (!groupEditModal) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setGroupEditModal(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [groupEditModal]);

  useEffect(() => {
    if (!participantModal) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !participantSaving) setParticipantModal(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [participantModal, participantSaving]);

  useEffect(() => {
    if (!importModal) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !importSaving) setImportModal(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [importModal, importSaving]);

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
      const today = new Date().toISOString().slice(0, 10);
      setCharges((prev) =>
        prev.map((charge) =>
          charge.id === chargeId && charge.status === "pending"
            ? { ...charge, status: "paid", source: "manual", paidAt: today }
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

  // ---- Grupo: editar nome / arquivar ----
  function openGroupEditModal(group: Group) {
    setGroupEditName(group.name);
    setConfirmDeleteGroup(false);
    setGroupError("");
    setGroupEditModal(true);
  }

  async function saveGroupName() {
    if (!openGroup) return;
    const name = groupEditName.trim();
    if (!name) return;
    setGroupSaving(true);
    setGroupError("");
    try {
      await apiClient.updateGroup(openGroup.id, { name });
      setGroups((prev) => prev.map((g) => (g.id === openGroup.id ? { ...g, name } : g)));
      setGroupEditModal(false);
      flash(`Nome do grupo atualizado para "${name}"`);
    } catch (error) {
      setGroupError(error instanceof Error ? error.message : "Erro ao atualizar grupo");
    } finally {
      setGroupSaving(false);
    }
  }

  async function removeGroup() {
    if (!openGroup) return;
    setGroupSaving(true);
    setGroupError("");
    try {
      await apiClient.deleteGroup(openGroup.id);
      const removedName = openGroup.name;
      const removedId = openGroup.id;
      setGroups((prev) => prev.map((g) => (g.id === removedId ? { ...g, status: "archived" } : g)));
      setParticipants((prev) => prev.map((p) => ({ ...p, groupIds: p.groupIds.filter((id) => id !== removedId) })));
      setCharges((prev) => prev.filter((c) => c.groupId !== removedId));
      setGroupEditModal(false);
      setOpenGroupId(null);
      flash(`${removedName} arquivado`);
    } catch (error) {
      setGroupError(error instanceof Error ? error.message : "Erro ao arquivar grupo");
    } finally {
      setGroupSaving(false);
    }
  }

  async function generateBillingForOpenGroup() {
    if (!openGroup) return;
    const now = new Date();
    const referenceMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    setBillingSaving(true);
    try {
      await apiClient.generateBillingPeriod(openGroup.id, referenceMonth);
      await fetchGroupCharges(openGroup.id);
      flash(`Cobrança de ${referenceMonth} gerada`);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Erro ao gerar cobrança");
    } finally {
      setBillingSaving(false);
    }
  }

  // ---- Participante: modal de detalhe ----
  const participantModalPerson = participantModal
    ? (participants.find((p) => p.id === participantModal.participantId) ?? null)
    : null;

  function openParticipantModal(groupId: string, participant: Participant) {
    setParticipantModal({ groupId, participantId: participant.id });
    setParticipantEditForm({ name: participant.name, phone: participant.phone });
    setParticipantError("");
  }

  async function saveParticipantEdit() {
    if (!participantModalPerson) return;
    const name = participantEditForm.name.trim();
    const phone = participantEditForm.phone.trim();
    if (!name || !phone) return;
    setParticipantSaving(true);
    setParticipantError("");
    try {
      await apiClient.updateParticipant(participantModalPerson.id, { name, phone });
      setParticipants((prev) =>
        prev.map((p) => (p.id === participantModalPerson.id ? { ...p, name, initials: name.slice(0, 2).toUpperCase(), phone } : p)),
      );
      flash("Dados do participante atualizados");
    } catch (error) {
      setParticipantError(error instanceof Error ? error.message : "Erro ao atualizar participante");
    } finally {
      setParticipantSaving(false);
    }
  }

  async function removeParticipantFromGroup() {
    if (!participantModal || !participantModalPerson) return;
    const { groupId, participantId } = participantModal;
    setParticipantSaving(true);
    setParticipantError("");
    try {
      await apiClient.removeParticipant(groupId, participantId);
      setParticipants((prev) =>
        prev.map((p) => (p.id === participantId ? { ...p, groupIds: p.groupIds.filter((id) => id !== groupId) } : p)),
      );
      setCharges((prev) => prev.filter((c) => !(c.participantId === participantId && c.groupId === groupId)));
      const removedName = participantModalPerson.name;
      setParticipantModal(null);
      flash(`${removedName} removido do grupo`);
    } catch (error) {
      setParticipantError(error instanceof Error ? error.message : "Erro ao remover participante");
    } finally {
      setParticipantSaving(false);
    }
  }

  // ---- Importar lista de participantes ----
  function parseImportedName(rawLine: string): string {
    return rawLine
      .replace(/^\s*\d+\s*[-.)]\s*/, "") // "1. ", "4 - ", "5- "
      .replace(/^\s*[-.)]\s*/, "") // "- " sem número
      .trim();
  }

  function isValidBrPhone(value: string): boolean {
    return /^\(\d{2}\) \d{9}$/.test(value.trim());
  }

  function analyzeImportText() {
    const names = importText
      .split("\n")
      .map(parseImportedName)
      .filter((name) => name.length > 0);
    setImportRows(
      names.map((name, index) => ({ id: `import-${index}-${Date.now()}`, name, include: true, phone: "", error: "" })),
    );
  }

  function updateImportRow(id: string, patch: Partial<ImportRow>) {
    setImportRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  async function confirmImport() {
    if (!openGroup) return;
    const groupId = openGroup.id;
    setImportSaving(true);
    const eligible = importRows.filter((row) => row.include);
    const untouched = importRows.filter((row) => !row.include);
    const failed: ImportRow[] = [];
    let successCount = 0;

    for (const row of eligible) {
      const phone = row.phone.trim();
      if (!isValidBrPhone(phone)) {
        failed.push({ ...row, error: "Telefone inválido — use (XX) 999999999" });
        continue;
      }
      try {
        const created = (await apiClient.addParticipant(groupId, { name: row.name, phone })) as { id?: string } | null;
        // A rota real hoje ignora o nome quando o participante é novo (ver
        // comentário em src/lib/api-client.ts) — usamos o nome digitado
        // aqui para a lista ficar correta enquanto isso não é corrigido no
        // backend.
        const id = created?.id ?? `local-${Date.now()}-${row.id}`;
        upsertParticipant({ id, name: row.name, initials: row.name.slice(0, 2).toUpperCase(), phone, groupIds: [groupId] }, groupId);
        successCount += 1;
      } catch (error) {
        failed.push({ ...row, error: error instanceof Error ? error.message : "Erro ao adicionar participante" });
      }
    }

    setImportRows([...untouched, ...failed]);
    setImportSaving(false);
    if (successCount > 0) {
      flash(`${successCount} participante${successCount > 1 ? "s" : ""} adicionado${successCount > 1 ? "s" : ""} ao grupo`);
    }
    if (failed.length === 0) {
      setImportModal(false);
      setImportText("");
      setImportRows([]);
    }
  }

  function memberLink(group: Group) {
    const base = typeof window !== "undefined" ? window.location.origin : "";
    return `${base}/g/${group.publicSlug}`;
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
      `Segue o status dos pagamentos de ${monthLabel(competenceKey)}:`,
      ``,
      ...lines,
      ``,
      `💰 Quem ainda não pagou, é só acessar o link:`,
      memberLink(group),
      ``,
      `Obrigado!`,
    ].join("\n");
  }

  async function addMember(groupId: string) {
    const name = memberForm.name.trim();
    const phone = memberForm.phone.trim();
    if (!name || !phone) return;
    setMemberSaving(true);
    setMemberError("");
    try {
      const created = (await apiClient.addParticipant(groupId, { name, phone })) as { id?: string } | null;
      const id = created?.id ?? `local-${Date.now()}`;
      upsertParticipant({ id, name, initials: name.slice(0, 2).toUpperCase(), phone, groupIds: [groupId] }, groupId);
      setMemberModal(false);
      setMemberForm({ name: "", phone: "" });
      flash(`${name} adicionado ao ${groupOf(groupId)?.name}`);
    } catch (error) {
      setMemberError(error instanceof Error ? error.message : "Erro ao adicionar participante");
    } finally {
      setMemberSaving(false);
    }
  }

  async function createGroup() {
    const name = form.name.trim();
    if (!name) return;
    setCreatingGroup(true);
    try {
      const created = (await apiClient.createGroup({
        name,
        sport: form.sport.trim() || undefined,
        billingDay: 10,
        defaultAmount: Math.round((Number(form.amount) || 0) * 100),
      })) as ApiGroup;
      const group = mapApiGroup(created, groups.length);
      setGroups((prev) => [...prev, group]);
      setModalOpen(false);
      setForm({ name: "", sport: "", amount: "" });
      setOpenGroupId(group.id);
      setView("groups");
      flash(`${name} criado`);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Erro ao criar grupo");
    } finally {
      setCreatingGroup(false);
    }
  }

  function createChargeMessage(group: Group) {
    const message = buildChargeMessage(group.id, competence);
    copyText(message, `Mensagem de ${group.name} copiada`);
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

      {gatewayModal && (
        <div className="backdrop" onMouseDown={() => !gatewaySaving && setGatewayModal(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Conta InfinitePay" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-top"><h2>Conta InfinitePay</h2><button className="ghost-icon" onClick={() => setGatewayModal(false)} aria-label="Fechar" disabled={gatewaySaving}><X size={18} /></button></div>
            <label htmlFor="gateway-handle">InfiniteTag (sem o caractere $)</label>
            <input
              id="gateway-handle"
              value={gatewayInput}
              onChange={(e) => setGatewayInput(e.target.value)}
              placeholder="minha-conta-infinitepay"
              disabled={gatewaySaving}
              autoFocus
            />
            {gatewayError && <p className="modal-error">{gatewayError}</p>}
            <button className="solid full" onClick={saveGatewayHandle} disabled={!gatewayInput.trim() || gatewaySaving}>
              {gatewaySaving ? "Salvando…" : "Salvar conta"}
            </button>
          </div>
        </div>
      )}

      {memberModal && openGroup && (
        <div className="backdrop" onMouseDown={() => !memberSaving && setMemberModal(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Participante" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-top"><h2>Adicionar a {openGroup.name}</h2><button className="ghost-icon" onClick={() => setMemberModal(false)} aria-label="Fechar" disabled={memberSaving}><X size={18} /></button></div>
            <label htmlFor="m-name">Nome</label>
            <input id="m-name" value={memberForm.name} onChange={(e) => setMemberForm({ ...memberForm, name: e.target.value })} placeholder="Nome do participante" autoFocus disabled={memberSaving} />
            <label htmlFor="m-phone">Celular com DDD</label>
            <input id="m-phone" value={memberForm.phone} onChange={(e) => setMemberForm({ ...memberForm, phone: e.target.value })} placeholder="(11) 98812-4410" inputMode="tel" disabled={memberSaving} />
            {memberError && <p className="modal-error">{memberError}</p>}
            <button className="solid full" onClick={() => addMember(openGroup.id)} disabled={!memberForm.name.trim() || !memberForm.phone.trim() || memberSaving}>
              {memberSaving ? "Adicionando…" : "Adicionar"}
            </button>
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
            <button className="solid full" onClick={createGroup} disabled={!form.name.trim() || creatingGroup}>{creatingGroup ? "Criando…" : "Criar grupo"}</button>
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

      {groupEditModal && openGroup && (
        <div className="backdrop" onMouseDown={() => !groupSaving && setGroupEditModal(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Editar grupo" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-top"><h2>Editar grupo</h2><button className="ghost-icon" onClick={() => setGroupEditModal(false)} aria-label="Fechar" disabled={groupSaving}><X size={18} /></button></div>
            <label htmlFor="ge-name">Nome do grupo</label>
            <input id="ge-name" value={groupEditName} onChange={(e) => setGroupEditName(e.target.value)} autoFocus disabled={groupSaving} />
            {groupError && <p className="modal-error">{groupError}</p>}
            <div className="modal-actions">
              <button className="mini" onClick={() => setGroupEditModal(false)} disabled={groupSaving}>Cancelar</button>
              <button className="solid" onClick={saveGroupName} disabled={!groupEditName.trim() || groupSaving}>{groupSaving ? "Salvando…" : "Salvar nome"}</button>
            </div>

            {!confirmDeleteGroup ? (
              <button className="mini danger full" onClick={() => setConfirmDeleteGroup(true)}><Trash2 size={13} /> Arquivar grupo</button>
            ) : (
              <div className="danger-confirm">
                <p className="modal-hint">Arquivar &quot;{openGroup.name}&quot; o remove das listas ativas. Não é possível arquivar um grupo com cobranças em aberto.</p>
                <div className="modal-actions">
                  <button className="mini" onClick={() => setConfirmDeleteGroup(false)} disabled={groupSaving}>Cancelar</button>
                  <button className="solid danger" onClick={removeGroup} disabled={groupSaving}>{groupSaving ? "Arquivando…" : "Confirmar arquivamento"}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {participantModal && participantModalPerson && (
        <div className="backdrop" onMouseDown={() => !participantSaving && setParticipantModal(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Participante" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-top"><h2>{participantModalPerson.name}</h2><button className="ghost-icon" onClick={() => setParticipantModal(null)} aria-label="Fechar" disabled={participantSaving}><X size={18} /></button></div>

            <label htmlFor="pe-name">Nome</label>
            <input id="pe-name" value={participantEditForm.name} onChange={(e) => setParticipantEditForm({ ...participantEditForm, name: e.target.value })} disabled={participantSaving} />
            <label htmlFor="pe-phone">Celular</label>
            <input id="pe-phone" value={participantEditForm.phone} onChange={(e) => setParticipantEditForm({ ...participantEditForm, phone: e.target.value })} inputMode="tel" disabled={participantSaving} />
            <button className="mini full" onClick={saveParticipantEdit} disabled={!participantEditForm.name.trim() || !participantEditForm.phone.trim() || participantSaving}>{participantSaving ? "Salvando…" : "Salvar"}</button>

            {participantError && <p className="modal-error">{participantError}</p>}
            <div className="danger-confirm">
              <p className="modal-hint">Excluir remove {participantModalPerson.name} deste grupo. A pessoa continua nos demais grupos, se houver.</p>
              <button className="solid danger full" onClick={removeParticipantFromGroup} disabled={participantSaving}>
                <Trash2 size={13} /> {participantSaving ? "Removendo…" : "Excluir do grupo"}
              </button>
            </div>
          </div>
        </div>
      )}

      {importModal && openGroup && (
        <div className="backdrop" onMouseDown={() => !importSaving && setImportModal(false)}>
          <div className="modal wide" role="dialog" aria-modal="true" aria-label="Importar participantes" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-top"><h2>Importar participantes</h2><button className="ghost-icon" onClick={() => setImportModal(false)} aria-label="Fechar" disabled={importSaving}><X size={18} /></button></div>

            <label htmlFor="import-text">Cole a lista de nomes (um por linha)</label>
            <textarea
              id="import-text"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={"1. João\n2. Felipe\n3. Alfredo\n4 - Marcelo\n5- Otavio\n- Matheus"}
              rows={5}
              disabled={importSaving}
            />
            <button className="mini full" onClick={analyzeImportText} disabled={!importText.trim() || importSaving}>Analisar lista</button>

            {importRows.length > 0 && (
              <ul className="import-list">
                {importRows.map((row) => (
                  <li key={row.id} className="import-row">
                    <input
                      type="checkbox"
                      checked={row.include}
                      onChange={(e) => updateImportRow(row.id, { include: e.target.checked })}
                      aria-label={`Incluir ${row.name}`}
                      disabled={importSaving}
                    />
                    <span className="import-name">{row.name}</span>
                    {row.include && (
                      <input
                        className="import-phone"
                        value={row.phone}
                        onChange={(e) => updateImportRow(row.id, { phone: e.target.value, error: "" })}
                        placeholder="(11) 998124410"
                        inputMode="tel"
                        disabled={importSaving}
                      />
                    )}
                    {row.error && <small className="import-error">{row.error}</small>}
                  </li>
                ))}
              </ul>
            )}

            {importRows.length > 0 && (
              <div className="modal-actions">
                <button className="mini" onClick={() => setImportModal(false)} disabled={importSaving}>Fechar</button>
                <button className="solid" onClick={confirmImport} disabled={importSaving || !importRows.some((r) => r.include)}>
                  {importSaving ? "Importando…" : "Importar selecionados"}
                </button>
              </div>
            )}
          </div>
        </div>
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
          <button className="nav" onClick={handleLogout}><LogOut size={17} strokeWidth={1.7} /> Sair</button>
          <div className="me"><span>LM</span><div><strong>Lucas Martins</strong><small>Organizador</small></div></div>
        </div>
      </aside>

      {menuOpen && <button className="overlay" aria-label="Fechar menu" onClick={() => setMenuOpen(false)} />}

      <main>
        <header className="bar">
          <button className="ghost-icon only-mobile" onClick={() => setMenuOpen(true)} aria-label="Abrir menu"><Menu size={20} /></button>
          <h1>{openGroup ? openGroup.name : navItems.find((item) => item.id === view)?.label ?? "Configurações"}</h1>
          {!openGroup && <select value={competence} onChange={(e) => setCompetence(e.target.value)} aria-label="Competência">{RECENT_MONTHS.map((item) => <option key={item} value={item}>{monthLabel(item)}</option>)}</select>}
        </header>

        <div className="page">
          {openGroup && view === "groups" ? (
            <ManagedGroupView
              group={openGroup}
              participants={participants.filter((p) => p.groupIds.includes(openGroup.id))}
              charges={charges.filter((c) => c.groupId === openGroup.id)}
              nameOf={nameOf}
              onBack={() => setOpenGroupId(null)}
              onAddMember={() => setMemberModal(true)}
              onImportMembers={() => setImportModal(true)}
              onSettle={openSettleModal}
              onCopyLink={() => copyText(memberLink(openGroup), `Link de ${openGroup.name} copiado`)}
              onCopyMessage={() => createChargeMessage(openGroup)}
              onEditGroup={() => openGroupEditModal(openGroup)}
              onOpenParticipant={(participant) => openParticipantModal(openGroup.id, participant)}
              onGenerateBilling={generateBillingForOpenGroup}
              billingSaving={billingSaving}
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
                  {activeGroups.map((group) => {
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
                  <div className="block-top"><h2>Pendências de {monthLabel(competence)}</h2><button className="link" onClick={() => go("charges")}>Cobrança</button></div>
                  <ul className="list">
                    {periodCharges.filter((c) => c.status === "pending").slice(0, 4).map((charge) => (
                      <li key={charge.id}>
                        <div className="row static">
                          <span className="badge soft">{(charge.participantName ?? nameOf(charge.participantId)).slice(0, 2).toUpperCase()}</span>
                          <span className="row-main"><strong>{charge.participantName ?? nameOf(charge.participantId)}</strong><small>{groupOf(charge.groupId)?.name}</small></span>
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
              <div className="block-top"><h2>{groupsLoading ? "Carregando…" : `${activeGroups.length} grupos`}</h2><button className="solid" onClick={() => setModalOpen(true)}><Plus size={15} /> Novo</button></div>
              <ul className="list">
                {activeGroups.map((group) => {
                  const rows = periodCharges.filter((c) => c.groupId === group.id);
                  const paid = rows.filter((c) => c.status === "paid").length;
                  const percent = rows.length ? Math.round((paid / rows.length) * 100) : 0;
                  return (
                    <li key={group.id}>
                      <button className="row" onClick={() => openGroupFrom(group.id)}>
                        <span className="row-main"><strong>{group.name}</strong><small>{group.sport} · vence dia {group.dueDay} · {formatMoney(group.amount)}/mês</small></span>
                        <span className="bar-mini"><span style={{ width: `${percent}%` }} /><small>{paid}/{rows.length} pagos</small></span>
                        <ChevronRight size={16} className="chev" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : view === "charges" ? (
            <section className="block">
              <div className="block-top"><h2>Cobrança · {monthLabel(competence)}</h2></div>
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
                <li>
                  <div className="row static">
                    <span className="row-main">
                      <strong>Gateway de pagamento (InfinitePay)</strong>
                      <small>{gatewayAccount ? `InfiniteTag · ${gatewayAccount.externalAccountId}` : "Nenhuma conta cadastrada"}</small>
                    </span>
                    <span className={gatewayAccount?.status === "active" ? "tag green-tag" : "tag red-tag"}>
                      {gatewayAccount?.status === "active" ? "Conectado" : "Não configurado"}
                    </span>
                    <button className="mini" onClick={openGatewayModal}><CreditCard size={13} /> {gatewayAccount ? "Editar" : "Cadastrar"}</button>
                  </div>
                </li>
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

function ManagedGroupView({
  group,
  participants,
  charges,
  nameOf,
  onBack,
  onAddMember,
  onImportMembers,
  onSettle,
  onCopyLink,
  onCopyMessage,
  onEditGroup,
  onOpenParticipant,
  onGenerateBilling,
  billingSaving,
}: {
  group: Group;
  participants: Participant[];
  charges: Charge[];
  nameOf: (id: string) => string;
  onBack: () => void;
  onAddMember: () => void;
  onImportMembers: () => void;
  onSettle: (id: string) => void;
  onCopyLink: () => void;
  onCopyMessage: () => void;
  onEditGroup: () => void;
  onOpenParticipant: (participant: Participant) => void;
  onGenerateBilling: () => void;
  billingSaving: boolean;
}) {
  const paid = charges.filter((c) => c.status === "paid");
  const pending = charges.filter((c) => c.status === "pending");

  return (
    <>
      <button className="back" onClick={onBack}><ArrowLeft size={15} /> Voltar</button>
      <section className="detail">
        <div><strong>{group.name}</strong><small>{group.sport} · {formatMoney(group.amount)}/mês · todos os períodos</small></div>
        <div className="detail-btns">
          <button className="mini" onClick={onGenerateBilling} disabled={billingSaving}>
            <WalletCards size={13} /> {billingSaving ? "Gerando…" : "Gerar cobrança do mês"}
          </button>
          <button className="mini" onClick={onCopyLink}><Copy size={13} /> Copiar link</button>
          <button className="mini" onClick={onCopyMessage}><Copy size={13} /> Copiar mensagem</button>
          <button className="mini" onClick={onEditGroup}><Pencil size={13} /> Editar grupo</button>
        </div>
      </section>

      <section className="cards">
        <article className="card green"><p>Recebido</p><strong>{formatMoney(paid.reduce((a, c) => a + c.amount, 0))}</strong><small>{paid.length} pagas</small></article>
        <article className="card red"><p>Pendente</p><strong>{formatMoney(pending.reduce((a, c) => a + c.amount, 0))}</strong><small>{pending.length} em aberto</small></article>
      </section>

      <section className="block">
        <div className="block-top">
          <h2>Participantes ({participants.length})</h2>
          <div className="row-btns">
            <button className="mini" onClick={onImportMembers}><ClipboardPaste size={13} /> Importar lista</button>
            <button className="solid" onClick={onAddMember}><Plus size={15} /> Adicionar</button>
          </div>
        </div>
        <ul className="list">
          {participants.map((person) => {
            const personCharges = charges.filter((c) => c.participantId === person.id);
            const pendingCharges = personCharges.filter((c) => c.status === "pending");
            const charge = pendingCharges[0] ?? personCharges[0];
            const status = charge?.status ?? "pending";
            const pendingLabel = pendingCharges.length > 1 ? `Aguardando pagamento (${pendingCharges.length} meses)` : "Aguardando pagamento";
            return (
              <li key={person.id}>
                <div className="row static">
                  <button className="row-click" onClick={() => onOpenParticipant(person)}>
                    <span className={status === "paid" ? "dot green-dot" : "dot red-dot"} />
                    <span className="row-main"><strong>{person.name}</strong><small>{person.phone} · {status === "paid" ? `Pago em ${charge?.paidAt ? formatDate(charge.paidAt) : ""}` : pendingLabel}</small></span>
                  </button>
                  <strong className="value">{formatMoney(charge?.amount ?? 0)}</strong>
                  {status === "pending" && charge && <button className="mini" onClick={() => onSettle(charge.id)}>Baixa manual</button>}
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
                <span className="row-main"><strong>{charge.participantName ?? nameOf(charge.participantId)}</strong><small>{groupOf(charge.groupId)?.name}{charge.paidAt ? ` · pago em ${formatDate(charge.paidAt)}` : " · em aberto"}</small></span>
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
