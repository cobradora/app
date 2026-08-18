"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardPaste,
  Clock3,
  CreditCard,
  Eye,
  EyeOff,
  Home,
  KeyRound,
  Link2,
  LogOut,
  Pencil,
  Plus,
  RotateCw,
  Save,
  Settings2,
  Share2,
  Sparkles,
  Trash2,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";
import cobraLogo from "@/images/logo-cobra-sem-fundo.png";
import { Spinner } from "@/components/spinner";
import {
  apiClient,
  type GatewayAccount,
  type GroupCharge,
  type GroupParticipant,
  type ManualSettlementInput,
  type OrgCharge,
} from "@/lib/api-client";
import { formatDate, formatMoney, type Group, type Participant } from "@/lib/mock-data";

type DashboardUser = { name: string; role: "owner" | "admin" | "member" };
type ImportRow = { id: string; name: string; include: boolean; phone: string; error: string };
type DashboardParticipant = Participant & { billingAmounts: Record<string, number>; tags: Record<string, string> };
type RawChargeStatus = GroupCharge["status"];
type DashboardCharge = {
  id: string;
  groupId: string;
  participantId: string;
  participantName?: string;
  competence: string;
  amount: number;
  status: "paid" | "pending" | "ignored";
  rawStatus: RawChargeStatus;
  source: "checkout" | "manual" | null;
  paidAt: string | null;
};
type ApiGroup = {
  id: string;
  name: string;
  publicSlug: string;
  billingDay: number | null;
  defaultAmount: number;
  status: "active" | "archived";
  messageIntro: string;
  messageOutro: string;
  messageParticipantFilter: "all" | "paid" | "pending";
};
type ParticipantEnvelope = {
  participant?: {
    id?: string;
    name?: string;
    phoneDisplay?: string;
    phone?: string;
  };
  startsNextCycle?: boolean;
  nextCycleReferenceMonth?: string | null;
};
const GROUP_COLORS = ["#6B3E2E", "#F06B83", "#A96B4C", "#D7536E", "#8E5842"];
const MONTH_NAMES_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];
const ROLE_LABELS: Record<DashboardUser["role"], string> = {
  owner: "Organizador",
  admin: "Administrador",
  member: "Membro",
};
const DEFAULT_MESSAGE_INTRO = "Olá, pessoal do {grupo}! Aqui está o resumo de {mes}:";
const DEFAULT_MESSAGE_OUTRO = "Para pagar, use o link abaixo. Obrigado!";
const NAME_MAX = 80;
const MESSAGE_MAX = 500;

function monthLabel(referenceMonth: string): string {
  const [year, month] = referenceMonth.split("-").map(Number);
  return `${MONTH_NAMES_PT[month - 1] ?? referenceMonth} ${year}`;
}

function monthOptions(count: number): string[] {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  });
}

const AVAILABLE_MONTHS = monthOptions(13);

function mapApiGroup(raw: unknown, index: number): Group {
  const group = raw as ApiGroup;
  return {
    id: group.id,
    name: group.name,
    sport: "",
    initials: group.name.slice(0, 2).toUpperCase(),
    color: GROUP_COLORS[index % GROUP_COLORS.length],
    amount: group.defaultAmount / 100,
    dueDay: group.billingDay,
    publicSlug: group.publicSlug,
    status: group.status,
    messageIntro: group.messageIntro ?? "",
    messageOutro: group.messageOutro ?? "",
    messageParticipantFilter: group.messageParticipantFilter ?? "all",
  };
}

function mapRealCharge(row: GroupCharge, groupId: string): DashboardCharge {
  const isPaid = row.status === "paid" || row.status === "manually_paid";
  const isIgnored = row.status === "canceled" || row.status === "refunded";
  return {
    id: row.chargeId,
    groupId,
    participantId: row.participantId,
    participantName: row.participantName,
    competence: row.referenceMonth,
    amount: row.totalAmount / 100,
    status: isIgnored ? "ignored" : isPaid ? "paid" : "pending",
    rawStatus: row.status,
    source: row.status === "manually_paid" ? "manual" : row.status === "paid" ? "checkout" : null,
    paidAt: null,
  };
}

function mapOrgCharge(row: OrgCharge): DashboardCharge {
  return mapRealCharge(row, row.groupId);
}

function mapGroupParticipant(row: GroupParticipant, groupId: string): DashboardParticipant {
  return {
    id: row.participantId,
    name: row.name,
    initials: (row.name || "?").slice(0, 2).toUpperCase(),
    phone: row.phoneDisplay,
    groupIds: [groupId],
    billingAmounts: { [groupId]: row.billingAmount },
    tags: { [groupId]: row.tag ?? "" },
  };
}

function formatAmountInput(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseAmountInput(value: string): number {
  const normalized = value.includes(",")
    ? value.replace(/\./g, "").replace(",", ".")
    : value;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function formatPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "").slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function isValidBrPhone(value: string): boolean {
  return /^[1-9]\d9\d{8}$/.test(value.replace(/\D/g, ""));
}

function normalizePersonName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt-BR");
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
}

function interpolateMessage(value: string, group: Group, competence: string): string {
  return value.replaceAll("{grupo}", group.name).replaceAll("{mes}", monthLabel(competence));
}

function unwrapParticipant(raw: unknown): {
  participant: NonNullable<ParticipantEnvelope["participant"]>;
  startsNextCycle: boolean;
  nextCycleReferenceMonth: string | null;
} {
  const envelope = raw as ParticipantEnvelope;
  const direct = raw as NonNullable<ParticipantEnvelope["participant"]>;
  return {
    participant: envelope.participant ?? direct,
    startsNextCycle: Boolean(envelope.startsNextCycle),
    nextCycleReferenceMonth: envelope.nextCycleReferenceMonth ?? null,
  };
}

export default function CobraDoraDashboard({ user }: { user: DashboardUser }) {
  const router = useRouter();
  const isAdmin = user.role === "owner" || user.role === "admin";
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [participants, setParticipants] = useState<DashboardParticipant[]>([]);
  const [charges, setCharges] = useState<DashboardCharge[]>([]);
  const [competence, setCompetence] = useState(AVAILABLE_MONTHS[0]);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [lateCycleNotice, setLateCycleNotice] = useState("");

  const [gatewayAccount, setGatewayAccount] = useState<GatewayAccount | null>(null);
  const [gatewayModal, setGatewayModal] = useState(false);
  const [gatewayInput, setGatewayInput] = useState("");
  const [gatewaySaving, setGatewaySaving] = useState(false);
  const [gatewayError, setGatewayError] = useState("");

  const [mobileTab, setMobileTab] = useState<"home" | "grupos" | "pendencias" | "ajustes">("home");

  const [memberModal, setMemberModal] = useState(false);
  const [memberForm, setMemberForm] = useState({ name: "", phone: "", billingAmount: "", tag: "" });
  const [memberSaving, setMemberSaving] = useState(false);
  const [memberError, setMemberError] = useState("");

  const [groupModal, setGroupModal] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupForm, setGroupForm] = useState({ name: "", sport: "", amount: "", billingDay: "10" });
  const [groupCreateError, setGroupCreateError] = useState("");

  const [settleModal, setSettleModal] = useState<null | { chargeId: string }>(null);
  const [settleMethod, setSettleMethod] = useState<ManualSettlementInput["paymentMethod"]>("dinheiro");
  const [settleObservation, setSettleObservation] = useState("");
  const [settleError, setSettleError] = useState("");
  const [settleSaving, setSettleSaving] = useState(false);

  const [groupEditModal, setGroupEditModal] = useState(false);
  const [groupEditName, setGroupEditName] = useState("");
  const [groupEditAmount, setGroupEditAmount] = useState("");
  const [groupEditDay, setGroupEditDay] = useState("");
  const [groupEditMessageIntro, setGroupEditMessageIntro] = useState(DEFAULT_MESSAGE_INTRO);
  const [groupEditMessageOutro, setGroupEditMessageOutro] = useState(DEFAULT_MESSAGE_OUTRO);
  const [groupEditMessageFilter, setGroupEditMessageFilter] = useState<"all" | "paid" | "pending">("all");
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState(false);
  const [groupSaving, setGroupSaving] = useState(false);
  const [groupError, setGroupError] = useState("");
  const [renewingCycle, setRenewingCycle] = useState(false);

  const [participantModal, setParticipantModal] = useState<null | { groupId: string; participantId: string }>(null);
  const [participantEditForm, setParticipantEditForm] = useState({ name: "", phone: "", billingAmount: "", tag: "" });
  const [participantSaving, setParticipantSaving] = useState(false);
  const [participantError, setParticipantError] = useState("");

  const [importModal, setImportModal] = useState(false);
  const [importText, setImportText] = useState("");
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importSaving, setImportSaving] = useState(false);

  const [groupTagOrders, setGroupTagOrders] = useState<Record<string, string[]>>({});

  const [changePasswordForm, setChangePasswordForm] = useState({ current: "", next: "", confirm: "" });
  const [changePasswordSaving, setChangePasswordSaving] = useState(false);
  const [changePasswordError, setChangePasswordError] = useState("");
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [cancelingChargeId, setCancelingChargeId] = useState<string | null>(null);
  const [releasingChargeId, setReleasingChargeId] = useState<string | null>(null);

  const activeGroups = useMemo(() => groups.filter((group) => group.status !== "archived"), [groups]);
  const openGroup = groups.find((group) => group.id === openGroupId) ?? null;
  const periodCharges = useMemo(
    () => charges.filter((charge) => charge.competence === competence && charge.status !== "ignored"),
    [charges, competence],
  );
  const pendingCharges = useMemo(
    () => periodCharges.filter((charge) => charge.status === "pending"),
    [periodCharges],
  );
  const totals = useMemo(() => {
    const paid = periodCharges.filter((charge) => charge.status === "paid");
    const sum = (rows: DashboardCharge[]) => rows.reduce((total, charge) => total + charge.amount, 0);
    return {
      expected: sum(periodCharges),
      received: sum(paid),
      pending: sum(pendingCharges),
      paidCount: paid.length,
      pendingCount: pendingCharges.length,
    };
  }, [periodCharges, pendingCharges]);
  const participantModalPerson = participantModal
    ? participants.find((participant) => participant.id === participantModal.participantId) ?? null
    : null;

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 4200);
  }

  function mergeCharges(mapped: DashboardCharge[]) {
    setCharges((previous) => {
      const byId = new Map(previous.map((charge) => [charge.id, charge]));
      mapped.forEach((charge) => byId.set(charge.id, charge));
      return Array.from(byId.values());
    });
  }

  function upsertParticipantInMap(
    map: Map<string, DashboardParticipant>,
    person: DashboardParticipant,
    groupId: string,
  ) {
    const existing = map.get(person.id);
    map.set(
      person.id,
      existing
        ? {
            ...existing,
            name: person.name,
            initials: person.initials,
            phone: person.phone,
            groupIds: Array.from(new Set([...existing.groupIds, groupId])),
            billingAmounts: { ...existing.billingAmounts, ...person.billingAmounts },
            tags: { ...existing.tags, ...person.tags },
          }
        : person,
    );
  }

  function upsertParticipant(person: DashboardParticipant, groupId: string) {
    setParticipants((previous) => {
      const map = new Map(previous.map((participant) => [participant.id, participant]));
      upsertParticipantInMap(map, person, groupId);
      return Array.from(map.values());
    });
  }

  function reconcileGroupParticipants(mapped: DashboardParticipant[], groupId: string) {
    setParticipants((previous) => {
      const map = new Map(previous.map((participant) => [participant.id, participant]));
      const fetchedIds = new Set(mapped.map((participant) => participant.id));
      for (const [id, existing] of map) {
        if (existing.groupIds.includes(groupId) && !fetchedIds.has(id)) {
          map.set(id, {
            ...existing,
            groupIds: existing.groupIds.filter((item) => item !== groupId),
            billingAmounts: Object.fromEntries(
              Object.entries(existing.billingAmounts).filter(([item]) => item !== groupId),
            ),
            tags: Object.fromEntries(Object.entries(existing.tags).filter(([item]) => item !== groupId)),
          });
        }
      }
      mapped.forEach((person) => upsertParticipantInMap(map, person, groupId));
      return Array.from(map.values());
    });
  }

  async function fetchGroupCharges(groupId: string) {
    const rows = await apiClient.listGroupCharges(groupId);
    mergeCharges(rows.map((row) => mapRealCharge(row, groupId)));
  }

  useEffect(() => {
    let cancelled = false;
    apiClient
      .listGroups()
      .then((raw) => {
        if (cancelled) return;
        const mapped = raw.map((group, index) => mapApiGroup(group, index));
        setGroups(mapped);
      })
      .catch(() => {
        if (!cancelled) flash("Não foi possível carregar os grupos. Verifique sua sessão.");
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
        if (!cancelled) flash("Não foi possível carregar a conta InfinitePay.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .listOrganizationCharges(competence)
      .then((rows) => {
        if (!cancelled) mergeCharges(rows.map(mapOrgCharge));
      })
      .catch(() => {
        if (!cancelled) flash("Não foi possível carregar as cobranças do mês.");
      });
    return () => {
      cancelled = true;
    };
  }, [competence]);

  useEffect(() => {
    if (!openGroupId) return;
    let cancelled = false;
    Promise.all([apiClient.listGroupParticipants(openGroupId), apiClient.listGroupCharges(openGroupId)])
      .then(([participantResult, chargeRows]) => {
        if (cancelled) return;
        reconcileGroupParticipants(
          participantResult.participants.map((row) => mapGroupParticipant(row, openGroupId)),
          openGroupId,
        );
        setGroupTagOrders((previous) => ({ ...previous, [openGroupId]: participantResult.tagOrder }));
        mergeCharges(chargeRows.map((row) => mapRealCharge(row, openGroupId)));
      })
      .catch(() => {
        if (!cancelled) flash("Não foi possível carregar todos os dados do grupo.");
      });
    return () => {
      cancelled = true;
    };
    // A reconciliação usa somente setters funcionais e o grupo capturado nesta execução.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openGroupId]);

  useEffect(() => {
    if (!openGroupId) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !memberModal && !groupEditModal && !participantModal && !importModal) {
        setOpenGroupId(null);
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [openGroupId, memberModal, groupEditModal, participantModal, importModal]);

  useEffect(() => {
    const hasOverlay = Boolean(
      openGroupId ||
      gatewayModal ||
      memberModal ||
      groupModal ||
      settleModal ||
      groupEditModal ||
      participantModal ||
      importModal,
    );
    if (!hasOverlay) return;
    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
    };
  }, [
    gatewayModal,
    groupEditModal,
    groupModal,
    importModal,
    memberModal,
    openGroupId,
    participantModal,
    settleModal,
  ]);

  function groupOf(groupId: string) {
    return groups.find((group) => group.id === groupId);
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
      flash("InfiniteTag atualizada.");
    } catch (error) {
      setGatewayError(error instanceof Error ? error.message : "Erro ao salvar a InfiniteTag.");
    } finally {
      setGatewaySaving(false);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await apiClient.logout();
    } finally {
      router.push("/login");
      router.refresh();
    }
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
    if (settleMethod === "outro" && !settleObservation.trim()) {
      setSettleError("Descreva a forma de pagamento no campo de observação.");
      return;
    }
    setSettleSaving(true);
    setSettleError("");
    try {
      await apiClient.registerManualSettlement(chargeId, {
        paymentMethod: settleMethod,
        observation: settleObservation.trim() || undefined,
      });
      const today = new Date().toISOString().slice(0, 10);
      setCharges((previous) =>
        previous.map((charge) =>
          charge.id === chargeId && charge.status === "pending"
            ? { ...charge, status: "paid", rawStatus: "manually_paid", source: "manual", paidAt: today }
            : charge,
        ),
      );
      setSettleModal(null);
      flash("Pagamento registrado manualmente.");
    } catch (error) {
      setSettleError(error instanceof Error ? error.message : "Erro ao registrar pagamento.");
    } finally {
      setSettleSaving(false);
    }
  }

  async function copyText(value: string, message: string) {
    try {
      await navigator.clipboard.writeText(value);
      flash(message);
    } catch {
      flash("Não foi possível copiar automaticamente.");
    }
  }

  async function shareMessage(title: string, text: string) {
    if (navigator.share) {
      try {
        await navigator.share({ title, text });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        flash("Não foi possível compartilhar.");
      }
      return;
    }
    await copyText(text, `Mensagem de ${title} copiada.`);
  }

  function memberLink(group: Group) {
    return `${window.location.origin}/g/${group.publicSlug}`;
  }

  function matchesMessageFilter(status: "paid" | "pending" | "ignored", filter: "all" | "paid" | "pending") {
    if (filter === "paid") return status === "paid";
    if (filter === "pending") return status === "pending";
    return true;
  }

  /**
   * Participantes entram ordenados pela ordem de cadastro da tag no grupo
   * (não alfabética) — quem não tem tag entra por último. Uma linha
   * separadora marca a troca de tag pra ordem ficar visível na mensagem.
   */
  function automaticLines(group: Group, referenceMonth: string) {
    const tagOrder = groupTagOrders[group.id] ?? [];
    const rankOf = (tag: string) => {
      const index = tagOrder.indexOf(tag);
      return index === -1 ? tagOrder.length : index;
    };

    const rows = charges
      .filter((charge) => charge.groupId === group.id && charge.competence === referenceMonth && charge.status !== "ignored")
      .filter((charge) => matchesMessageFilter(charge.status, group.messageParticipantFilter))
      .map((charge) => ({
        charge,
        tag: participants.find((person) => person.id === charge.participantId)?.tags[group.id] || "",
      }))
      .sort((left, right) => {
        const rankDiff = rankOf(left.tag) - rankOf(right.tag);
        if (rankDiff !== 0) return rankDiff;
        return (left.charge.participantName ?? "").localeCompare(right.charge.participantName ?? "", "pt-BR");
      });

    const lines: string[] = [];
    let lastTag: string | null = null;
    for (const { charge, tag } of rows) {
      if (tag !== lastTag) {
        if (tag) lines.push(`— ${tag} —`);
        lastTag = tag;
      }
      lines.push(`${charge.status === "paid" ? "✅" : "🔴"} ${charge.participantName ?? "Participante"} — ${charge.status === "paid" ? "pago" : "pendente"}`);
    }
    return lines;
  }

  function buildChargeMessage(group: Group, referenceMonth = competence): string {
    const lines = automaticLines(group, referenceMonth);
    return [
      interpolateMessage(group.messageIntro.trim() || DEFAULT_MESSAGE_INTRO, group, referenceMonth),
      "",
      ...(lines.length
        ? lines
        : [
            group.messageParticipantFilter === "paid"
              ? "Nenhum pagador ainda nesta competência."
              : group.messageParticipantFilter === "pending"
                ? "Nenhuma pendência nesta competência."
                : "A lista de cobranças ainda não foi gerada para esta competência.",
          ]),
      "",
      interpolateMessage(group.messageOutro.trim() || DEFAULT_MESSAGE_OUTRO, group, referenceMonth),
      memberLink(group),
    ].join("\n");
  }

  function openGroupEditModal(group: Group) {
    setGroupEditName(group.name);
    setGroupEditAmount(formatAmountInput(Math.round(group.amount * 100)));
    setGroupEditDay(group.dueDay ? String(group.dueDay) : "");
    setGroupEditMessageIntro(group.messageIntro || DEFAULT_MESSAGE_INTRO);
    setGroupEditMessageOutro(group.messageOutro || DEFAULT_MESSAGE_OUTRO);
    setGroupEditMessageFilter(group.messageParticipantFilter || "all");
    setConfirmDeleteGroup(false);
    setGroupError("");
    setGroupEditModal(true);
  }

  async function saveGroupName() {
    if (!openGroup) return;
    const name = groupEditName.trim();
    const defaultAmount = parseAmountInput(groupEditAmount);
    const dayTrimmed = groupEditDay.trim();
    const billingDay = dayTrimmed === "" ? null : Number(dayTrimmed);
    const messageIntro = groupEditMessageIntro.trim();
    const messageOutro = groupEditMessageOutro.trim();
    if (!name || defaultAmount <= 0 || defaultAmount > 100_000_000) {
      setGroupError("Informe um nome e uma sugestão de valor maior que zero.");
      return;
    }
    if (billingDay !== null && (billingDay < 1 || billingDay > 28)) {
      setGroupError("O dia de renovação deve ficar entre 1 e 28, ou em branco para manual.");
      return;
    }
    if (!messageIntro || !messageOutro) {
      setGroupError("Preencha a introdução e o encerramento da mensagem de cobrança.");
      return;
    }
    setGroupSaving(true);
    setGroupError("");
    try {
      await apiClient.updateGroup(openGroup.id, {
        name,
        defaultAmount,
        billingDay,
        messageIntro,
        messageOutro,
        messageParticipantFilter: groupEditMessageFilter,
      });
      setGroups((previous) =>
        previous.map((group) =>
          group.id === openGroup.id
            ? {
                ...group,
                name,
                amount: defaultAmount / 100,
                dueDay: billingDay,
                messageIntro,
                messageOutro,
                messageParticipantFilter: groupEditMessageFilter,
              }
            : group,
        ),
      );
      setGroupEditModal(false);
      flash(`Grupo “${name}” atualizado.`);
    } catch (error) {
      setGroupError(error instanceof Error ? error.message : "Erro ao atualizar o grupo.");
    } finally {
      setGroupSaving(false);
    }
  }

  async function renewGroupCycle() {
    if (!openGroup) return;
    setRenewingCycle(true);
    try {
      await apiClient.renewGroupCycle(openGroup.id);
      flash(`Ciclo de ${openGroup.name} renovado para este mês.`);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Erro ao renovar o ciclo.");
    } finally {
      setRenewingCycle(false);
    }
  }

  async function removeGroup() {
    if (!openGroup) return;
    setGroupSaving(true);
    setGroupError("");
    try {
      await apiClient.deleteGroup(openGroup.id);
      const removedId = openGroup.id;
      const removedName = openGroup.name;
      setGroups((previous) => previous.map((group) => (group.id === removedId ? { ...group, status: "archived" } : group)));
      setParticipants((previous) =>
        previous.map((participant) => ({
          ...participant,
          groupIds: participant.groupIds.filter((groupId) => groupId !== removedId),
          billingAmounts: Object.fromEntries(
            Object.entries(participant.billingAmounts).filter(([groupId]) => groupId !== removedId),
          ),
          tags: Object.fromEntries(Object.entries(participant.tags).filter(([groupId]) => groupId !== removedId)),
        })),
      );
      setCharges((previous) => previous.filter((charge) => charge.groupId !== removedId));
      setGroupEditModal(false);
      setOpenGroupId(null);
      flash(`${removedName} arquivado.`);
    } catch (error) {
      setGroupError(error instanceof Error ? error.message : "Erro ao arquivar o grupo.");
    } finally {
      setGroupSaving(false);
    }
  }

  function openMemberModal(group: Group) {
    setMemberForm({
      name: "",
      phone: "",
      billingAmount: formatAmountInput(Math.round(group.amount * 100)),
      tag: "",
    });
    setMemberError("");
    setMemberModal(true);
  }

  function openParticipantModal(groupId: string, participant: DashboardParticipant) {
    const group = groupOf(groupId);
    const currentCharge = charges.find(
      (charge) =>
        charge.groupId === groupId &&
        charge.participantId === participant.id &&
        charge.competence === competence &&
        charge.status !== "ignored",
    );
    const billingAmount =
      participant.billingAmounts[groupId] ??
      Math.round((currentCharge?.amount ?? group?.amount ?? 0) * 100);
    setParticipantModal({ groupId, participantId: participant.id });
    setParticipantEditForm({
      name: participant.name,
      phone: participant.phone,
      billingAmount: formatAmountInput(billingAmount),
      tag: participant.tags[groupId] ?? "",
    });
    setParticipantError("");
  }

  async function saveParticipantEdit() {
    if (!participantModal || !participantModalPerson) return;
    const groupId = participantModal.groupId;
    const participantId = participantModalPerson.id;
    const name = participantEditForm.name.trim();
    const phone = participantEditForm.phone.trim();
    const billingAmount = parseAmountInput(participantEditForm.billingAmount);
    const duplicate = participants.some(
      (participant) =>
        participant.id !== participantId &&
        participant.groupIds.includes(groupId) &&
        normalizePersonName(participant.name) === normalizePersonName(name),
    );
    if (duplicate) {
      setParticipantError("Já existe um participante com esse nome neste grupo.");
      return;
    }
    if (!isValidBrPhone(phone)) {
      setParticipantError("Informe um telefone brasileiro com DDD.");
      return;
    }
    if (billingAmount <= 0 || billingAmount > 100_000_000) {
      setParticipantError("Informe um valor de cobrança maior que zero.");
      return;
    }
    setParticipantSaving(true);
    setParticipantError("");
    try {
      const currentBillingAmount = participantModalPerson.billingAmounts[groupId];
      if (currentBillingAmount !== billingAmount) {
        await apiClient.updateGroupParticipantBillingAmount(
          groupId,
          participantId,
          billingAmount,
        );
        setParticipants((previous) =>
          previous.map((participant) =>
            participant.id === participantId
              ? {
                  ...participant,
                  billingAmounts: {
                    ...participant.billingAmounts,
                    [groupId]: billingAmount,
                  },
                }
              : participant,
          ),
        );
        setCharges((previous) =>
          previous.map((charge) =>
            charge.groupId === groupId &&
            charge.participantId === participantId &&
            charge.rawStatus === "open"
              ? { ...charge, amount: billingAmount / 100 }
              : charge,
          ),
        );
      }
      if (name !== participantModalPerson.name || phone !== participantModalPerson.phone) {
        await apiClient.updateParticipant(participantId, { name, phone });
      }
      const tag = participantEditForm.tag.trim();
      const currentTag = participantModalPerson.tags[groupId] ?? "";
      if (tag !== currentTag) {
        await apiClient.updateGroupParticipantTag(groupId, participantId, tag || null);
        setGroupTagOrders((previous) => {
          const order = previous[groupId] ?? [];
          if (!tag || order.includes(tag)) return previous;
          return { ...previous, [groupId]: [...order, tag] };
        });
      }
      setParticipants((previous) =>
        previous.map((participant) =>
          participant.id === participantId
            ? { ...participant, name, initials: name.slice(0, 2).toUpperCase(), phone, tags: { ...participant.tags, [groupId]: tag } }
            : participant,
        ),
      );
      setParticipantModal(null);
      flash("Participante atualizado.");
    } catch (error) {
      setParticipantError(error instanceof Error ? error.message : "Erro ao atualizar o participante.");
    } finally {
      setParticipantSaving(false);
    }
  }

  async function removeParticipantFromGroup() {
    if (!participantModal || !participantModalPerson) return;
    const { groupId, participantId } = participantModal;

    const pendingCharge = charges.find(
      (charge) =>
        charge.participantId === participantId &&
        charge.groupId === groupId &&
        (charge.rawStatus === "open" || charge.rawStatus === "checkout_pending"),
    );

    let settleChoice: "settle" | "forgive" | null = null;
    if (pendingCharge) {
      const proceed = window.confirm(
        `${participantModalPerson.name} tem uma cobrança pendente de ${formatMoney(pendingCharge.amount)} neste grupo. Clique OK para continuar (você escolhe a seguir dar baixa ou perdoar), ou Cancelar para desistir da remoção.`,
      );
      if (!proceed) return;
      settleChoice = window.confirm(
        "OK = Dar baixa (marcar a cobrança como paga). Cancelar = Perdoar a dívida (cancelar a cobrança).",
      )
        ? "settle"
        : "forgive";
    }

    setParticipantSaving(true);
    setParticipantError("");
    try {
      if (pendingCharge && settleChoice === "settle") {
        await apiClient.registerManualSettlement(pendingCharge.id, {
          paymentMethod: "outro",
          observation: "Baixa automática ao remover participante do grupo",
        });
        const today = new Date().toISOString().slice(0, 10);
        setCharges((previous) =>
          previous.map((charge) =>
            charge.id === pendingCharge.id
              ? { ...charge, status: "paid", rawStatus: "manually_paid", source: "manual", paidAt: today }
              : charge,
          ),
        );
      } else if (pendingCharge && settleChoice === "forgive") {
        await apiClient.cancelCharge(pendingCharge.id);
        setCharges((previous) =>
          previous.map((charge) => (charge.id === pendingCharge.id ? { ...charge, status: "ignored", rawStatus: "canceled" } : charge)),
        );
      }

      await apiClient.removeParticipant(groupId, participantId);
      setParticipants((previous) =>
        previous.map((participant) =>
          participant.id === participantId
            ? {
                ...participant,
                groupIds: participant.groupIds.filter((id) => id !== groupId),
                billingAmounts: Object.fromEntries(
                  Object.entries(participant.billingAmounts).filter(([id]) => id !== groupId),
                ),
                tags: Object.fromEntries(Object.entries(participant.tags).filter(([id]) => id !== groupId)),
              }
            : participant,
        ),
      );
      setParticipantModal(null);
      flash(`${participantModalPerson.name} removido do grupo.`);
    } catch (error) {
      setParticipantError(error instanceof Error ? error.message : "Erro ao remover o participante.");
    } finally {
      setParticipantSaving(false);
    }
  }

  async function addMember(groupId: string) {
    const name = memberForm.name.trim();
    const phone = memberForm.phone.trim();
    const billingAmount = parseAmountInput(memberForm.billingAmount);
    const duplicate = participants.some(
      (participant) => participant.groupIds.includes(groupId) && normalizePersonName(participant.name) === normalizePersonName(name),
    );
    if (duplicate) {
      setMemberError("Já existe um participante com esse nome neste grupo.");
      return;
    }
    if (!isValidBrPhone(phone)) {
      setMemberError("Informe um telefone brasileiro com DDD.");
      return;
    }
    if (billingAmount <= 0 || billingAmount > 100_000_000) {
      setMemberError("Informe um valor de cobrança maior que zero.");
      return;
    }
    setMemberSaving(true);
    setMemberError("");
    const tag = memberForm.tag.trim();
    try {
      const result = unwrapParticipant(await apiClient.addParticipant(groupId, { name, phone, billingAmount, tag: tag || undefined }));
      const id = result.participant.id ?? `local-${Date.now()}`;
      upsertParticipant(
        {
          id,
          name: result.participant.name || name,
          initials: (result.participant.name || name).slice(0, 2).toUpperCase(),
          phone: result.participant.phoneDisplay || result.participant.phone || phone,
          groupIds: [groupId],
          billingAmounts: { [groupId]: billingAmount },
          tags: { [groupId]: tag },
        },
        groupId,
      );
      if (tag) {
        setGroupTagOrders((previous) => {
          const order = previous[groupId] ?? [];
          if (order.includes(tag)) return previous;
          return { ...previous, [groupId]: [...order, tag] };
        });
      }
      if (result.startsNextCycle) {
        const cycle = result.nextCycleReferenceMonth ? monthLabel(result.nextCycleReferenceMonth) : "o próximo ciclo";
        setLateCycleNotice(`${name} foi adicionado, mas entra nas cobranças somente em ${cycle}.`);
      }
      setMemberModal(false);
      setMemberForm({ name: "", phone: "", billingAmount: "", tag: "" });
      flash(`${name} adicionado ao grupo.`);
    } catch (error) {
      setMemberError(error instanceof Error ? error.message : "Erro ao adicionar o participante.");
    } finally {
      setMemberSaving(false);
    }
  }

  function parseImportedName(rawLine: string): string {
    return rawLine.replace(/^\s*\d+\s*[-.)]\s*/, "").replace(/^\s*[-.)]\s*/, "").trim().slice(0, NAME_MAX);
  }

  function analyzeImportText() {
    const existingNames = new Set(
      participants
        .filter((participant) => openGroup && participant.groupIds.includes(openGroup.id))
        .map((participant) => normalizePersonName(participant.name)),
    );
    const namesSeen = new Set<string>();
    const names = importText.split("\n").map(parseImportedName).filter(Boolean);
    setImportRows(
      names.map((name, index) => {
        const normalized = normalizePersonName(name);
        const duplicate = existingNames.has(normalized) || namesSeen.has(normalized);
        namesSeen.add(normalized);
        return {
          id: `import-${index}-${Date.now()}`,
          name,
          include: !duplicate,
          phone: "",
          error: duplicate ? "Nome duplicado neste grupo" : "",
        };
      }),
    );
  }

  function updateImportRow(id: string, patch: Partial<ImportRow>) {
    setImportRows((previous) => previous.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  async function confirmImport() {
    if (!openGroup) return;
    const suggestedBillingAmount = Math.round(openGroup.amount * 100);
    setImportSaving(true);
    const eligible = importRows.filter((row) => row.include);
    const untouched = importRows.filter((row) => !row.include);
    const failed: ImportRow[] = [];
    let successCount = 0;
    const nextCycles: string[] = [];

    for (const row of eligible) {
      if (!isValidBrPhone(row.phone)) {
        failed.push({ ...row, error: "Telefone inválido — informe DDD e número" });
        continue;
      }
      try {
        const result = unwrapParticipant(
          await apiClient.addParticipant(openGroup.id, {
            name: row.name,
            phone: row.phone,
            billingAmount: suggestedBillingAmount,
          }),
        );
        const id = result.participant.id ?? `local-${row.id}`;
        upsertParticipant(
          {
            id,
            name: result.participant.name || row.name,
            initials: (result.participant.name || row.name).slice(0, 2).toUpperCase(),
            phone: result.participant.phoneDisplay || result.participant.phone || row.phone,
            groupIds: [openGroup.id],
            billingAmounts: { [openGroup.id]: suggestedBillingAmount },
            tags: { [openGroup.id]: "" },
          },
          openGroup.id,
        );
        if (result.startsNextCycle) nextCycles.push(row.name);
        successCount += 1;
      } catch (error) {
        failed.push({ ...row, error: error instanceof Error ? error.message : "Erro ao adicionar participante" });
      }
    }

    setImportRows([...untouched, ...failed]);
    setImportSaving(false);
    if (nextCycles.length) {
      setLateCycleNotice(
        `${nextCycles.join(", ")} ${nextCycles.length === 1 ? "entra" : "entram"} nas cobranças somente no próximo ciclo.`,
      );
    }
    if (successCount > 0) flash(`${successCount} participante${successCount > 1 ? "s" : ""} importado${successCount > 1 ? "s" : ""}.`);
    if (failed.length === 0) {
      setImportModal(false);
      setImportText("");
      setImportRows([]);
    }
  }

  async function createGroup() {
    const name = groupForm.name.trim();
    const dayTrimmed = groupForm.billingDay.trim();
    const billingDay = dayTrimmed === "" ? undefined : Number(dayTrimmed);
    const amount = parseAmountInput(groupForm.amount);
    if (!name || (billingDay !== undefined && (billingDay < 1 || billingDay > 28)) || amount <= 0) {
      setGroupCreateError("Preencha nome e uma sugestão de valor; o dia deve ficar entre 1 e 28, ou em branco para manual.");
      return;
    }
    setCreatingGroup(true);
    setGroupCreateError("");
    try {
      const created = await apiClient.createGroup({
        name,
        sport: groupForm.sport.trim() || undefined,
        billingDay,
        defaultAmount: amount,
      });
      const group = mapApiGroup(created, groups.length);
      setGroups((previous) => [...previous, group]);
      setGroupModal(false);
      setGroupForm({ name: "", sport: "", amount: "", billingDay: "10" });
      setOpenGroupId(group.id);
      flash(`${name} criado.`);
    } catch (error) {
      setGroupCreateError(error instanceof Error ? error.message : "Erro ao criar o grupo.");
    } finally {
      setCreatingGroup(false);
    }
  }

  async function submitChangePassword() {
    if (changePasswordForm.next !== changePasswordForm.confirm) {
      setChangePasswordError("A confirmação não bate com a nova senha.");
      return;
    }
    if (changePasswordForm.next.length < 8) {
      setChangePasswordError("A nova senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    setChangePasswordSaving(true);
    setChangePasswordError("");
    try {
      await apiClient.changePassword({
        currentPassword: changePasswordForm.current,
        newPassword: changePasswordForm.next,
      });
      setChangePasswordForm({ current: "", next: "", confirm: "" });
      flash("Senha atualizada.");
    } catch (error) {
      setChangePasswordError(error instanceof Error ? error.message : "Erro ao trocar a senha.");
    } finally {
      setChangePasswordSaving(false);
    }
  }

  async function cancelCharge(chargeId: string) {
    if (!window.confirm("Cancelar esta cobrança? Essa ação não pode ser desfeita.")) return;
    setCancelingChargeId(chargeId);
    try {
      await apiClient.cancelCharge(chargeId);
      setCharges((previous) =>
        previous.map((charge) => (charge.id === chargeId ? { ...charge, status: "ignored", rawStatus: "canceled" } : charge)),
      );
      flash("Cobrança cancelada.");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Erro ao cancelar a cobrança.");
    } finally {
      setCancelingChargeId(null);
    }
  }

  async function releaseStuckCheckout(chargeId: string) {
    if (
      !window.confirm(
        "Liberar esta cobrança do checkout travado? Se a pessoa já tiver pago pelo link antigo, confira manualmente antes de dar baixa ou cancelar de novo.",
      )
    ) {
      return;
    }
    setReleasingChargeId(chargeId);
    try {
      await apiClient.releaseCheckout(chargeId);
      setCharges((previous) =>
        previous.map((charge) => (charge.id === chargeId ? { ...charge, rawStatus: "open" } : charge)),
      );
      flash("Cobrança liberada — já dá pra dar baixa ou cancelar.");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Erro ao liberar a cobrança.");
    } finally {
      setReleasingChargeId(null);
    }
  }

  const openGroupParticipants = openGroup
    ? participants.filter((participant) => participant.groupIds.includes(openGroup.id))
    : [];
  const openGroupCharges = openGroup
    ? charges.filter((charge) => charge.groupId === openGroup.id && charge.competence === competence && charge.status !== "ignored")
    : [];
  const openGroupPaid = openGroupCharges.filter((charge) => charge.status === "paid");
  const openGroupPending = openGroupCharges.filter((charge) => charge.status === "pending");
  const messagePreviewLines = openGroup
    ? automaticLines({ ...openGroup, messageParticipantFilter: groupEditMessageFilter }, competence)
    : [];

  return (
    <div className="cobradora-shell">
      {notice && (
        <p className="toast" role="status" aria-live="polite">
          <span><Check size={14} strokeWidth={3} /></span>{notice}
        </p>
      )}

      <header className="app-header">
        <div className="app-header__inner">
          <a className="brand" href="#top" aria-label="CobraDora — início">
            <Image src={cobraLogo} alt="" width={52} height={52} priority className="brand__mark" />
            <span><strong>CobraDora</strong><small>Assistente de Cobranças</small></span>
          </a>
          <label className="month-picker">
            <CalendarDays size={18} aria-hidden="true" />
            <span>Competência</span>
            <select value={competence} onChange={(event) => setCompetence(event.target.value)} aria-label="Mês de competência">
              {AVAILABLE_MONTHS.map((month) => <option key={month} value={month}>{monthLabel(month)}</option>)}
            </select>
          </label>
        </div>
      </header>

      <main id="top" className="dashboard-main">
        <section className={`welcome ${mobileTab === "home" ? "" : "mobile-tab-hidden"}`} aria-labelledby="dashboard-title">
          <div>
            <p className="eyebrow"><Sparkles size={15} /> Visão do mês</p>
            <h1 id="dashboard-title">Olá, {user.name.split(" ")[0]}!</h1>
            <p>Acompanhe recebimentos, resolva pendências e cuide dos seus grupos em um só lugar.</p>
          </div>
          {isAdmin && (
            <button className="button button--primary" type="button" onClick={() => setGroupModal(true)}>
              <Plus size={18} /> Novo grupo
            </button>
          )}
        </section>

        <section className={`summary-grid ${mobileTab === "home" ? "" : "mobile-tab-hidden"}`} aria-label={`Resumo de ${monthLabel(competence)}`}>
          <article className="summary-card summary-card--expected">
            <span className="summary-card__icon"><WalletCards size={21} /></span>
            <div><p>Previsto</p><strong>{formatMoney(totals.expected)}</strong><small>{periodCharges.length} cobranças ativas</small></div>
          </article>
          <article className="summary-card summary-card--received">
            <span className="summary-card__icon"><CheckCircle2 size={21} /></span>
            <div><p>Recebido</p><strong>{formatMoney(totals.received)}</strong><small>{totals.paidCount} pagamentos confirmados</small></div>
          </article>
          <article className="summary-card summary-card--pending">
            <span className="summary-card__icon"><Clock3 size={21} /></span>
            <div><p>Pendente</p><strong>{formatMoney(totals.pending)}</strong><small>{totals.pendingCount} cobranças em aberto</small></div>
          </article>
        </section>

        <section id="grupos" className={`surface groups-section ${mobileTab === "home" || mobileTab === "grupos" ? "" : "mobile-tab-hidden"}`} aria-labelledby="groups-title">
          <div className="section-heading">
            <div><p className="section-kicker">Seus grupos</p><h2 id="groups-title">Abra um grupo para gerenciar</h2></div>
            <div className="section-heading__actions">
              <span className="count-pill">{groupsLoading ? "…" : activeGroups.length}</span>
              {isAdmin && (
                <button className="button button--primary button--small mobile-only" type="button" onClick={() => setGroupModal(true)}>
                  <Plus size={16} /> Novo grupo
                </button>
              )}
            </div>
          </div>
          {groupsLoading ? (
            <div className="skeleton-row" aria-label="Carregando grupos"><span /><span /><span /></div>
          ) : activeGroups.length === 0 ? (
            <div className="empty-state"><UsersRound size={28} /><strong>Seu primeiro grupo começa aqui</strong><p>Crie um grupo e adicione os participantes que serão cobrados.</p></div>
          ) : (
            <div className="group-badges" role="group" aria-label="Grupos ativos">
              {activeGroups.map((group) => {
                const groupRows = periodCharges.filter((charge) => charge.groupId === group.id);
                const pending = groupRows.filter((charge) => charge.status === "pending").length;
                return (
                  <button
                    type="button"
                    key={group.id}
                    className="group-badge"
                    style={{ "--group-color": group.color } as React.CSSProperties}
                    onClick={() => { setLateCycleNotice(""); setOpenGroupId(group.id); }}
                    aria-label={`Abrir ${group.name}, ${group.dueDay ? `renovação dia ${group.dueDay}` : "renovação manual"}, ${pending} pendências`}
                  >
                    <span className="group-badge__dot" />
                    <span><strong>{group.name}</strong><small>{group.dueDay ? `Dia ${group.dueDay}` : "Manual"} · {pending ? `${pending} pendente${pending > 1 ? "s" : ""}` : "em dia"}</small></span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section id="pendencias" className={`surface pending-section ${mobileTab === "pendencias" ? "" : "mobile-tab-hidden"}`} aria-labelledby="pending-title">
          <div className="section-heading">
            <div><p className="section-kicker">Atenção necessária</p><h2 id="pending-title">Pendências de {monthLabel(competence)}</h2></div>
            <span className="count-pill count-pill--pink">{pendingCharges.length}</span>
          </div>
          {pendingCharges.length === 0 ? (
            <div className="empty-state empty-state--success"><CheckCircle2 size={30} /><strong>Tudo certo por aqui</strong><p>Não há cobranças pendentes nesta competência.</p></div>
          ) : (
            <ul className="pending-list">
              {pendingCharges.map((charge) => {
                const group = groupOf(charge.groupId);
                return (
                  <li key={charge.id} className="pending-row">
                    <span className="person-avatar">{getInitials(charge.participantName ?? "Participante")}</span>
                    <div className="pending-row__person">
                      <strong>{charge.participantName ?? "Participante"}</strong>
                      <span>{group?.name ?? "Grupo"} · {charge.rawStatus === "checkout_pending" ? "checkout iniciado" : "aguardando pagamento"}</span>
                    </div>
                    <strong className="pending-row__amount">{formatMoney(charge.amount)}</strong>
                    {isAdmin && charge.rawStatus === "open" ? (
                      <span className="pending-row__actions">
                        <button className="button button--secondary button--small" type="button" onClick={() => openSettleModal(charge.id)}>Dar baixa</button>
                        <button className="button button--danger button--small" type="button" onClick={() => cancelCharge(charge.id)} disabled={cancelingChargeId === charge.id}>{cancelingChargeId === charge.id ? <Spinner size={15} /> : <X size={15} />} Cancelar dívida</button>
                      </span>
                    ) : charge.rawStatus === "checkout_pending" ? (
                      <span className="pending-row__actions">
                        <span className="status-pill">Em conciliação</span>
                        {isAdmin && (
                          <button className="button button--secondary button--small" type="button" onClick={() => releaseStuckCheckout(charge.id)} disabled={releasingChargeId === charge.id}>
                            {releasingChargeId === charge.id && <Spinner size={15} />} Liberar cobrança
                          </button>
                        )}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section id="configuracoes" className={`settings-section ${mobileTab === "ajustes" ? "" : "mobile-tab-hidden"}`} aria-labelledby="settings-title">
          <div className="section-heading section-heading--outside">
            <div><p className="section-kicker"><Settings2 size={15} /> Ajustes</p><h2 id="settings-title">Configurações</h2></div>
            <p>Conta, conexão com a InfinitePay e segurança.</p>
          </div>
          <div className="settings-grid">
            <article className="setting-card setting-card--gateway">
              <div className="setting-card__icon"><CreditCard size={22} /></div>
              <div className="setting-card__content">
                <p className="setting-label">InfinitePay</p>
                <h3>{gatewayAccount ? `@${gatewayAccount.externalAccountId}` : "Conecte sua InfiniteTag"}</h3>
                <p>{gatewayAccount ? "Checkout habilitado para sua organização." : "Necessária para gerar links de pagamento seguros."}</p>
              </div>
              <span className={`status-pill ${gatewayAccount?.status === "active" ? "status-pill--active" : ""}`}>
                {gatewayAccount?.status === "active" ? "Conectada" : "Pendente"}
              </span>
              {isAdmin && <button className="button button--secondary" type="button" onClick={openGatewayModal}>{gatewayAccount ? "Editar" : "Conectar"}</button>}
            </article>

            <article className="setting-card setting-card--password">
              <div className="setting-card__heading">
                <div className="setting-card__icon"><KeyRound size={22} /></div>
                <div><p className="setting-label">Segurança</p><h3>Trocar senha</h3><p>Sua senha atual é necessária para confirmar a troca.</p></div>
              </div>
              <div className="message-fields">
                <label htmlFor="current-password">Senha atual</label>
                <input id="current-password" type={showChangePassword ? "text" : "password"} autoComplete="current-password" value={changePasswordForm.current} onChange={(event) => setChangePasswordForm({ ...changePasswordForm, current: event.target.value })} disabled={changePasswordSaving} />
                <label htmlFor="new-password">Nova senha</label>
                <input id="new-password" type={showChangePassword ? "text" : "password"} autoComplete="new-password" minLength={8} value={changePasswordForm.next} onChange={(event) => setChangePasswordForm({ ...changePasswordForm, next: event.target.value })} disabled={changePasswordSaving} />
                <label htmlFor="confirm-new-password">Confirmar nova senha</label>
                <input id="confirm-new-password" type={showChangePassword ? "text" : "password"} autoComplete="new-password" minLength={8} value={changePasswordForm.confirm} onChange={(event) => setChangePasswordForm({ ...changePasswordForm, confirm: event.target.value })} disabled={changePasswordSaving} />
                <label className="checkbox-label"><input type="checkbox" checked={showChangePassword} onChange={(event) => setShowChangePassword(event.target.checked)} /> Mostrar senhas</label>
              </div>
              {changePasswordError && <p className="form-error" role="alert">{changePasswordError}</p>}
              <div className="setting-actions">
                <button className="button button--primary" type="button" onClick={submitChangePassword} disabled={changePasswordSaving || !changePasswordForm.current.trim() || !changePasswordForm.next.trim() || !changePasswordForm.confirm.trim()}>
                  {changePasswordSaving ? <Spinner size={17} /> : <KeyRound size={17} />} {changePasswordSaving ? "Salvando…" : "Trocar senha"}
                </button>
              </div>
            </article>

            <button className="button button--ghost button--full mobile-only" type="button" onClick={handleLogout} disabled={loggingOut}>{loggingOut ? <Spinner size={17} /> : <LogOut size={17} />} Sair</button>
          </div>
        </section>
      </main>

      <nav className="mobile-tabbar" aria-label="Navegação principal">
        <button type="button" className={mobileTab === "home" ? "active" : ""} onClick={() => setMobileTab("home")}><Home size={20} /> Home</button>
        <button type="button" className={mobileTab === "grupos" ? "active" : ""} onClick={() => setMobileTab("grupos")}><UsersRound size={20} /> Grupos</button>
        <button type="button" className={mobileTab === "pendencias" ? "active" : ""} onClick={() => setMobileTab("pendencias")}><WalletCards size={20} /> Pendências</button>
        <button type="button" className={mobileTab === "ajustes" ? "active" : ""} onClick={() => setMobileTab("ajustes")}><Settings2 size={20} /> Ajustes</button>
      </nav>

      <footer className="app-footer">
        <div className="app-footer__inner">
          <div className="footer-brand"><Image src={cobraLogo} alt="" width={44} height={44} /><span><strong>CobraDora</strong><small>Sua assistente de cobranças</small></span></div>
          <nav className="footer-nav" aria-label="Atalhos da tela principal">
            <a className="footer-link" href="#top">Resumo</a>
            <a className="footer-link" href="#grupos">Grupos</a>
            <a className="footer-link" href="#pendencias">Pendências</a>
            <a className="footer-link" href="#configuracoes"><Settings2 size={17} /> Configurações</a>
          </nav>
          <div className="footer-user"><span className="person-avatar person-avatar--user">{getInitials(user.name)}</span><div><strong>{user.name}</strong><small>{ROLE_LABELS[user.role]}</small></div><button className="button button--ghost" type="button" onClick={handleLogout} disabled={loggingOut}>{loggingOut ? <Spinner size={17} /> : <LogOut size={17} />} Sair</button></div>
        </div>
      </footer>

      {openGroup && (
        <div className="drawer-backdrop" onMouseDown={() => setOpenGroupId(null)}>
          <aside className="group-drawer" role="dialog" aria-modal="true" aria-labelledby="group-drawer-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <p className="section-kicker">Detalhes do grupo</p>
                <h2 id="group-drawer-title">{openGroup.name}</h2>
                <span>Valor sugerido {formatMoney(openGroup.amount)} · {openGroup.dueDay ? `renovação dia ${openGroup.dueDay}` : "renovação manual"}</span>
                {isAdmin && !openGroup.dueDay && (
                  <button className="button button--secondary button--small drawer-header__renew" type="button" onClick={renewGroupCycle} disabled={renewingCycle}>
                    {renewingCycle ? <Spinner size={15} /> : <RotateCw size={15} />} {renewingCycle ? "Renovando…" : "Renovar ciclo"}
                  </button>
                )}
              </div>
              <button className="icon-button icon-button--large" type="button" onClick={() => setOpenGroupId(null)} aria-label="Fechar detalhes do grupo"><X size={21} /></button>
            </div>
            <div className="drawer-body">
              {lateCycleNotice && <div className="inline-alert" role="status"><AlertTriangle size={19} /><p><strong>Próximo ciclo</strong>{lateCycleNotice}</p><button type="button" onClick={() => setLateCycleNotice("")} aria-label="Dispensar aviso"><X size={16} /></button></div>}
              <div className="drawer-metrics">
                <div><span>Previsto</span><strong>{formatMoney(openGroupCharges.reduce((total, charge) => total + charge.amount, 0))}</strong></div>
                <div><span>Recebido</span><strong>{formatMoney(openGroupPaid.reduce((total, charge) => total + charge.amount, 0))}</strong></div>
                <div><span>Pendente</span><strong>{formatMoney(openGroupPending.reduce((total, charge) => total + charge.amount, 0))}</strong></div>
              </div>
              <div className="drawer-actions">
                <button className="button button--secondary" type="button" onClick={() => copyText(memberLink(openGroup), `Link de ${openGroup.name} copiado.`)}><Link2 size={17} /> Copiar link</button>
                <button className="button button--secondary" type="button" onClick={() => shareMessage(openGroup.name, buildChargeMessage(openGroup))}><Share2 size={17} /> Compartilhar</button>
                {isAdmin && <button className="button button--secondary" type="button" onClick={() => openGroupEditModal(openGroup)}><Pencil size={17} /> Editar</button>}
              </div>
              <section className="drawer-participants" aria-labelledby="participants-title">
                <div className="section-heading"><div><p className="section-kicker">Pessoas</p><h3 id="participants-title">Participantes ({openGroupParticipants.length})</h3></div>{isAdmin && <div className="inline-actions"><button className="button button--secondary button--small" type="button" onClick={() => setImportModal(true)}><ClipboardPaste size={16} /> Importar</button><button className="button button--primary button--small" type="button" onClick={() => openMemberModal(openGroup)}><Plus size={16} /> Adicionar</button></div>}</div>
                {openGroupParticipants.length === 0 ? <div className="empty-state"><UsersRound size={27} /><strong>Nenhum participante ainda</strong><p>Adicione uma pessoa ou importe uma lista.</p></div> : <ul className="participant-list">{openGroupParticipants.map((person) => {
                  const charge = openGroupCharges.find((item) => item.participantId === person.id);
                  const label = !charge ? "Entra no próximo ciclo" : charge.status === "paid" ? `Pago${charge.paidAt ? ` em ${formatDate(charge.paidAt)}` : ""}` : charge.rawStatus === "checkout_pending" ? "Checkout em andamento" : "Aguardando pagamento";
                  const individualAmount = person.billingAmounts[openGroup.id];
                  const tag = person.tags[openGroup.id];
                  return <li key={person.id}><button type="button" className="participant-button" onClick={() => isAdmin && openParticipantModal(openGroup.id, person)} disabled={!isAdmin}><span className={`status-dot ${charge?.status === "paid" ? "status-dot--paid" : !charge ? "status-dot--next" : ""}`} /><span className="person-avatar">{getInitials(person.name)}</span><span className="participant-button__main"><strong>{person.name}</strong><small>{person.phone} · {label}</small>{tag && <span className="tag-chip">{tag}</span>}</span><span className="participant-button__billing"><small>Valor individual</small><strong>{individualAmount ? formatMoney(individualAmount / 100) : charge ? formatMoney(charge.amount) : formatMoney(openGroup.amount)}</strong></span>{isAdmin && <Pencil className="participant-button__edit" size={16} aria-hidden="true" />}</button>{isAdmin && charge?.rawStatus === "open" ? <span className="participant-settle-actions"><button type="button" className="button button--secondary button--small participant-settle" onClick={() => openSettleModal(charge.id)}>Dar baixa</button><button type="button" className="icon-button icon-button--danger" onClick={() => cancelCharge(charge.id)} aria-label={`Cancelar cobrança de ${person.name}`}><X size={15} /></button></span> : isAdmin && charge?.rawStatus === "checkout_pending" ? <span className="participant-settle-actions"><button type="button" className="button button--secondary button--small participant-settle" onClick={() => releaseStuckCheckout(charge.id)} disabled={releasingChargeId === charge.id}>{releasingChargeId === charge.id ? <Spinner size={15} /> : null} Liberar cobrança</button></span> : null}</li>;
                })}</ul>}
              </section>
            </div>
          </aside>
        </div>
      )}

      {isAdmin && <>
      {groupModal && <ModalShell title="Novo grupo" id="new-group-title" onClose={() => !creatingGroup && setGroupModal(false)} locked={creatingGroup}><label htmlFor="group-name">Nome do grupo</label><input id="group-name" maxLength={NAME_MAX} value={groupForm.name} onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })} placeholder="Vôlei de quinta" autoFocus disabled={creatingGroup} /><label htmlFor="group-sport">Modalidade (opcional)</label><input id="group-sport" maxLength={40} value={groupForm.sport} onChange={(event) => setGroupForm({ ...groupForm, sport: event.target.value })} placeholder="Vôlei" disabled={creatingGroup} /><div className="field-grid"><div><label htmlFor="group-amount">Sugestão de valor</label><div className="input-prefix"><span>R$</span><input id="group-amount" value={groupForm.amount} onChange={(event) => setGroupForm({ ...groupForm, amount: event.target.value.replace(/[^\d,.]/g, "") })} inputMode="decimal" placeholder="80,00" disabled={creatingGroup} /></div><p className="field-hint">Preenche novos cadastros, mas cada participante pode ter seu próprio valor.</p></div><div><label htmlFor="group-day">Renovação</label><div className="input-prefix"><span>dia</span><input id="group-day" type="number" min={1} max={28} inputMode="numeric" placeholder="manual" value={groupForm.billingDay} onChange={(event) => setGroupForm({ ...groupForm, billingDay: event.target.value })} disabled={creatingGroup} /></div><p className="field-hint">Deixe em branco para renovar manualmente.</p></div></div>{groupCreateError && <p className="form-error" role="alert">{groupCreateError}</p>}<button className="button button--primary button--full" type="button" onClick={createGroup} disabled={creatingGroup || !groupForm.name.trim()}>{creatingGroup && <Spinner />}{creatingGroup ? "Criando…" : "Criar grupo"}</button></ModalShell>}

      {gatewayModal && <ModalShell title="Conta InfinitePay" id="gateway-title" onClose={() => !gatewaySaving && setGatewayModal(false)} locked={gatewaySaving}><p className="modal-copy">Informe a InfiniteTag que receberá os pagamentos da organização.</p><label htmlFor="gateway-handle">InfiniteTag (sem $)</label><div className="input-prefix"><span>@</span><input id="gateway-handle" maxLength={80} value={gatewayInput} onChange={(event) => setGatewayInput(event.target.value.replace(/^\$/, ""))} placeholder="minha-infinite-tag" autoFocus disabled={gatewaySaving} /></div>{gatewayError && <p className="form-error" role="alert">{gatewayError}</p>}<button className="button button--primary button--full" type="button" onClick={saveGatewayHandle} disabled={gatewaySaving || !gatewayInput.trim()}>{gatewaySaving && <Spinner />}{gatewaySaving ? "Salvando…" : "Salvar InfiniteTag"}</button></ModalShell>}

      {memberModal && openGroup && <ModalShell title={`Adicionar a ${openGroup.name}`} id="member-title" onClose={() => !memberSaving && setMemberModal(false)} locked={memberSaving}><p className="modal-copy">Se o ciclo deste mês já foi renovado, a pessoa entrará apenas na próxima cobrança.</p><label htmlFor="member-name">Nome</label><input id="member-name" maxLength={NAME_MAX} value={memberForm.name} onChange={(event) => setMemberForm({ ...memberForm, name: event.target.value })} placeholder="Nome do participante" autoFocus disabled={memberSaving} /><label htmlFor="member-phone">Celular com DDD</label><input id="member-phone" type="tel" inputMode="numeric" maxLength={15} value={memberForm.phone} onChange={(event) => setMemberForm({ ...memberForm, phone: formatPhoneInput(event.target.value) })} placeholder="(11) 99999-9999" disabled={memberSaving} /><label htmlFor="member-billing-amount">Valor deste participante</label><div className="input-prefix"><span>R$</span><input id="member-billing-amount" inputMode="decimal" value={memberForm.billingAmount} onChange={(event) => setMemberForm({ ...memberForm, billingAmount: event.target.value.replace(/[^\d,.]/g, "") })} placeholder="80,00" disabled={memberSaving} /></div><p className="field-hint">A sugestão de {formatMoney(openGroup.amount)} veio do grupo. Ajuste aqui sem alterar os demais participantes.</p><label htmlFor="member-tag">Categoria (opcional)</label><input id="member-tag" maxLength={60} value={memberForm.tag} onChange={(event) => setMemberForm({ ...memberForm, tag: event.target.value })} placeholder="Ex.: Sub-15" disabled={memberSaving} />{memberError && <p className="form-error" role="alert">{memberError}</p>}<button className="button button--primary button--full" type="button" onClick={() => addMember(openGroup.id)} disabled={memberSaving || !memberForm.name.trim() || !memberForm.phone.trim() || !memberForm.billingAmount.trim()}>{memberSaving && <Spinner />}{memberSaving ? "Adicionando…" : "Adicionar participante"}</button></ModalShell>}

      {settleModal && <ModalShell title="Registrar pagamento" id="settle-title" onClose={() => !settleSaving && setSettleModal(null)} locked={settleSaving}><p className="modal-copy">Use a baixa manual apenas quando o pagamento foi confirmado fora do checkout.</p><fieldset className="message-filter"><legend>Forma de pagamento</legend><label><input type="radio" name="settle-method" checked={settleMethod === "dinheiro"} onChange={() => setSettleMethod("dinheiro")} disabled={settleSaving} /> Dinheiro</label><label><input type="radio" name="settle-method" checked={settleMethod === "pix"} onChange={() => setSettleMethod("pix")} disabled={settleSaving} /> Pix</label><label><input type="radio" name="settle-method" checked={settleMethod === "outro"} onChange={() => setSettleMethod("outro")} disabled={settleSaving} /> Outro</label></fieldset><label htmlFor="settle-observation">Observação {settleMethod === "outro" ? "" : "(opcional)"}</label><textarea id="settle-observation" maxLength={300} rows={3} value={settleObservation} onChange={(event) => setSettleObservation(event.target.value)} placeholder={settleMethod === "outro" ? "Descreva a forma de pagamento" : "Ex.: pago em espécie"} disabled={settleSaving} />{settleError && <p className="form-error" role="alert">{settleError}</p>}<div className="modal-actions"><button className="button button--secondary" type="button" onClick={() => setSettleModal(null)} disabled={settleSaving}>Cancelar</button><button className="button button--primary" type="button" onClick={confirmSettle} disabled={settleSaving || (settleMethod === "outro" && !settleObservation.trim())}>{settleSaving && <Spinner />}{settleSaving ? "Salvando…" : "Confirmar baixa"}</button></div></ModalShell>}

      {groupEditModal && openGroup && <ModalShell title="Editar grupo" id="edit-group-title" wide onClose={() => !groupSaving && setGroupEditModal(false)} locked={groupSaving}><label htmlFor="edit-group-name">Nome do grupo</label><input id="edit-group-name" maxLength={NAME_MAX} value={groupEditName} onChange={(event) => setGroupEditName(event.target.value)} autoFocus disabled={groupSaving} /><div className="field-grid"><div><label htmlFor="edit-group-amount">Sugestão para novos participantes</label><div className="input-prefix"><span>R$</span><input id="edit-group-amount" inputMode="decimal" value={groupEditAmount} onChange={(event) => setGroupEditAmount(event.target.value.replace(/[^\d,.]/g, ""))} placeholder="80,00" disabled={groupSaving} /></div><p className="field-hint">Esta sugestão não altera o valor dos participantes que já estão cadastrados.</p></div><div><label htmlFor="edit-group-day">Dia de renovação</label><div className="input-prefix"><span>dia</span><input id="edit-group-day" type="number" min={1} max={28} inputMode="numeric" placeholder="manual" value={groupEditDay} onChange={(event) => setGroupEditDay(event.target.value)} disabled={groupSaving} /></div><p className="field-hint">Em branco = renovação manual (sem cron automático).</p></div></div>

        <div className="message-editor">
          <div className="message-fields">
            <label htmlFor="edit-message-intro">Introdução <span>{groupEditMessageIntro.length}/{MESSAGE_MAX}</span></label>
            <textarea id="edit-message-intro" rows={4} maxLength={MESSAGE_MAX} value={groupEditMessageIntro} onChange={(event) => setGroupEditMessageIntro(event.target.value)} disabled={groupSaving} />
            <label htmlFor="edit-message-outro">Encerramento <span>{groupEditMessageOutro.length}/{MESSAGE_MAX}</span></label>
            <textarea id="edit-message-outro" rows={4} maxLength={MESSAGE_MAX} value={groupEditMessageOutro} onChange={(event) => setGroupEditMessageOutro(event.target.value)} disabled={groupSaving} />
            <fieldset className="message-filter">
              <legend>Listar na mensagem</legend>
              <label><input type="radio" name="edit-message-filter" checked={groupEditMessageFilter === "all"} onChange={() => setGroupEditMessageFilter("all")} disabled={groupSaving} /> Todos</label>
              <label><input type="radio" name="edit-message-filter" checked={groupEditMessageFilter === "paid"} onChange={() => setGroupEditMessageFilter("paid")} disabled={groupSaving} /> Pagadores</label>
              <label><input type="radio" name="edit-message-filter" checked={groupEditMessageFilter === "pending"} onChange={() => setGroupEditMessageFilter("pending")} disabled={groupSaving} /> Pendentes</label>
            </fieldset>
          </div>
          <div className="message-preview" aria-label="Prévia da lista automática">
            <div className="message-preview__top"><span>Lista automática</span></div>
            <div className="locked-list" aria-readonly="true">
              <p>{interpolateMessage(groupEditMessageIntro || DEFAULT_MESSAGE_INTRO, openGroup, competence)}</p>
              <div className="locked-list__rows">
                {messagePreviewLines.length ? messagePreviewLines.map((line, index) => <span key={index}>{line}</span>) : <span className="locked-list__empty">{groupEditMessageFilter === "paid" ? "Nenhum pagador ainda." : groupEditMessageFilter === "pending" ? "Nenhuma pendência." : "A lista aparecerá após a geração das cobranças."}</span>}
              </div>
              <p>{interpolateMessage(groupEditMessageOutro || DEFAULT_MESSAGE_OUTRO, openGroup, competence)}</p>
              <small>/g/{openGroup.publicSlug}</small>
            </div>
          </div>
        </div>

        {groupError && <p className="form-error" role="alert">{groupError}</p>}<button className="button button--primary button--full" type="button" onClick={saveGroupName} disabled={groupSaving || !groupEditName.trim() || !groupEditAmount.trim() || !groupEditMessageIntro.trim() || !groupEditMessageOutro.trim()}>{groupSaving && <Spinner />}{groupSaving ? "Salvando…" : "Salvar grupo"}</button><div className="danger-zone">{confirmDeleteGroup ? <><p>Arquivar remove o grupo das listas ativas. Grupos com cobranças em aberto não podem ser arquivados.</p><div className="modal-actions"><button className="button button--secondary" type="button" onClick={() => setConfirmDeleteGroup(false)} disabled={groupSaving}>Cancelar</button><button className="button button--danger" type="button" onClick={removeGroup} disabled={groupSaving}>{groupSaving && <Spinner />}{groupSaving ? "Arquivando…" : "Confirmar"}</button></div></> : <button className="button button--danger-soft button--full" type="button" onClick={() => setConfirmDeleteGroup(true)}><Trash2 size={17} /> Arquivar grupo</button>}</div></ModalShell>}

      {participantModal && participantModalPerson && <ModalShell title={participantModalPerson.name} id="participant-title" onClose={() => !participantSaving && setParticipantModal(null)} locked={participantSaving}><label htmlFor="participant-name">Nome</label><input id="participant-name" maxLength={NAME_MAX} value={participantEditForm.name} onChange={(event) => setParticipantEditForm({ ...participantEditForm, name: event.target.value })} disabled={participantSaving} /><label htmlFor="participant-phone">Celular</label><input id="participant-phone" type="tel" inputMode="numeric" maxLength={15} value={participantEditForm.phone} onChange={(event) => setParticipantEditForm({ ...participantEditForm, phone: formatPhoneInput(event.target.value) })} disabled={participantSaving} /><label htmlFor="participant-billing-amount">Valor cobrado neste grupo</label><div className="input-prefix"><span>R$</span><input id="participant-billing-amount" inputMode="decimal" value={participantEditForm.billingAmount} onChange={(event) => setParticipantEditForm({ ...participantEditForm, billingAmount: event.target.value.replace(/[^\d,.]/g, "") })} placeholder="80,00" disabled={participantSaving} /></div><p className="field-hint">O checkout usará este valor. A alteração também atualiza cobranças abertas; checkouts já iniciados precisam terminar primeiro.</p><label htmlFor="participant-tag">Categoria (opcional)</label><input id="participant-tag" maxLength={60} value={participantEditForm.tag} onChange={(event) => setParticipantEditForm({ ...participantEditForm, tag: event.target.value })} placeholder="Ex.: Sub-15" disabled={participantSaving} />{participantError && <p className="form-error" role="alert">{participantError}</p>}<button className="button button--primary button--full" type="button" onClick={saveParticipantEdit} disabled={participantSaving || !participantEditForm.name.trim() || !participantEditForm.phone.trim() || !participantEditForm.billingAmount.trim()}>{participantSaving && <Spinner />}{participantSaving ? "Salvando…" : "Salvar participante"}</button><div className="danger-zone"><p>Remover desvincula a pessoa somente deste grupo.</p><button className="button button--danger-soft button--full" type="button" onClick={removeParticipantFromGroup} disabled={participantSaving}><Trash2 size={17} /> Remover do grupo</button></div></ModalShell>}

      {importModal && openGroup && <ModalShell title="Importar participantes" id="import-title" wide onClose={() => !importSaving && setImportModal(false)} locked={importSaving}><p className="modal-copy">Cole um nome por linha. Nomes repetidos no grupo serão bloqueados. Os importados começam com a sugestão de {formatMoney(openGroup.amount)}, que pode ser editada depois em cada cadastro.</p><label htmlFor="import-text">Lista de nomes</label><textarea id="import-text" maxLength={5000} rows={5} value={importText} onChange={(event) => setImportText(event.target.value)} placeholder={"1. Ana\n2. Bruno\n3. Camila"} disabled={importSaving} /><button className="button button--secondary button--full" type="button" onClick={analyzeImportText} disabled={importSaving || !importText.trim()}>Analisar lista</button>{importRows.length > 0 && <ul className="import-list">{importRows.map((row) => <li key={row.id} className="import-row"><input type="checkbox" checked={row.include} onChange={(event) => updateImportRow(row.id, { include: event.target.checked })} aria-label={`Incluir ${row.name}`} disabled={importSaving || Boolean(row.error && !row.phone)} /><span className="import-row__name">{row.name}</span>{row.include && <input type="tel" inputMode="numeric" maxLength={15} value={row.phone} onChange={(event) => updateImportRow(row.id, { phone: formatPhoneInput(event.target.value), error: "" })} onFocus={(event) => event.currentTarget.scrollIntoView({ block: "center", behavior: "smooth" })} placeholder="(11) 99999-9999" aria-label={`Telefone de ${row.name}`} disabled={importSaving} />}{row.error && <small role="alert">{row.error}</small>}</li>)}</ul>}{importRows.length > 0 && <div className="modal-actions"><button className="button button--secondary" type="button" onClick={() => setImportModal(false)} disabled={importSaving}>Fechar</button><button className="button button--primary" type="button" onClick={confirmImport} disabled={importSaving || !importRows.some((row) => row.include)}>{importSaving && <Spinner />}{importSaving ? "Importando…" : "Importar selecionados"}</button></div>}</ModalShell>}
      </>}
    </div>
  );
}

function ModalShell({
  title,
  id,
  children,
  onClose,
  locked = false,
  wide = false,
}: {
  title: string;
  id: string;
  children: React.ReactNode;
  onClose: () => void;
  locked?: boolean;
  wide?: boolean;
}) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !locked) onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [locked, onClose]);

  // Em vários navegadores mobile (sobretudo Android), o viewport de layout
  // (usado por vh/dvh e position:fixed) nao encolhe junto com o teclado —
  // so o viewport visual encolhe. Sem isso, o modal fica dimensionado para
  // a tela inteira e parte dele (inclusive o campo focado) some atras do
  // teclado. Expor a altura real como variavel CSS deixa o modal se ajustar
  // a area de fato visivel.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    function updateViewportHeight() {
      document.documentElement.style.setProperty("--modal-vvh", `${viewport!.height}px`);
    }

    updateViewportHeight();
    viewport.addEventListener("resize", updateViewportHeight);
    return () => {
      viewport.removeEventListener("resize", updateViewportHeight);
      document.documentElement.style.removeProperty("--modal-vvh");
    };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`modal-card ${wide ? "modal-card--wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={id} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header"><h2 id={id}>{title}</h2><button type="button" className="icon-button" onClick={onClose} disabled={locked} aria-label={`Fechar ${title}`}><X size={19} /></button></div>
        {children}
      </div>
    </div>
  );
}
