export type ChargeStatus = "paid" | "pending";
export type PaymentSource = "checkout" | "manual";

export type Group = {
  id: string;
  name: string;
  sport: string;
  initials: string;
  color: string;
  amount: number;
  dueDay: number;
};

export type Participant = {
  id: string;
  name: string;
  initials: string;
  phone: string;
  groupIds: string[];
};

export type Charge = {
  id: string;
  groupId: string;
  participantId: string;
  competence: string;
  amount: number;
  status: ChargeStatus;
  source: PaymentSource | null;
  paidAt: string | null;
};

export const competences = ["2025-06", "2025-05", "2025-04"];

export const competenceLabels: Record<string, string> = {
  "2025-06": "Junho 2025",
  "2025-05": "Maio 2025",
  "2025-04": "Abril 2025",
};

export const groups: Group[] = [
  { id: "volei-quarta", name: "Vôlei de quarta", sport: "Vôlei", initials: "VQ", color: "#64798f", amount: 80, dueDay: 5 },
  { id: "futebol-sabado", name: "Futebol de sábado", sport: "Futebol", initials: "FS", color: "#5f8271", amount: 90, dueDay: 10 },
  { id: "beach-tennis", name: "Beach Tennis Clube", sport: "Beach tennis", initials: "BT", color: "#93805f", amount: 90, dueDay: 8 },
];

export const participants: Participant[] = [
  { id: "p1", name: "Marina Costa", initials: "MC", phone: "(11) 98812-4410", groupIds: ["volei-quarta"] },
  { id: "p2", name: "Rafael Lima", initials: "RL", phone: "(11) 99640-2213", groupIds: ["futebol-sabado", "volei-quarta"] },
  { id: "p3", name: "Camila Rocha", initials: "CR", phone: "(21) 98120-7745", groupIds: ["beach-tennis"] },
  { id: "p4", name: "Diego Alves", initials: "DA", phone: "(11) 97733-1180", groupIds: ["futebol-sabado"] },
  { id: "p5", name: "Bianca Freitas", initials: "BF", phone: "(31) 98455-9021", groupIds: ["volei-quarta", "beach-tennis"] },
  { id: "p6", name: "Tiago Moraes", initials: "TM", phone: "(11) 99012-3366", groupIds: ["futebol-sabado"] },
  { id: "p7", name: "Helena Prado", initials: "HP", phone: "(41) 98877-4512", groupIds: ["beach-tennis"] },
  { id: "p8", name: "Otávio Nunes", initials: "ON", phone: "(11) 98123-9087", groupIds: ["volei-quarta"] },
];

function buildCharges(): Charge[] {
  const list: Charge[] = [];
  const pendingKeys = new Set([
    "2025-06:p2:futebol-sabado",
    "2025-06:p4:futebol-sabado",
    "2025-06:p6:futebol-sabado",
    "2025-06:p8:volei-quarta",
    "2025-06:p7:beach-tennis",
    "2025-05:p4:futebol-sabado",
  ]);

  for (const competence of competences) {
    for (const participant of participants) {
      for (const groupId of participant.groupIds) {
        const group = groups.find((item) => item.id === groupId);
        if (!group) continue;
        const key = `${competence}:${participant.id}:${groupId}`;
        const pending = pendingKeys.has(key);
        const day = String(group.dueDay).padStart(2, "0");
        list.push({
          id: key,
          groupId,
          participantId: participant.id,
          competence,
          amount: group.amount,
          status: pending ? "pending" : "paid",
          source: pending ? null : participant.id === "p3" ? "manual" : "checkout",
          paidAt: pending ? null : `${competence}-${day}`,
        });
      }
    }
  }
  return list;
}

export const initialCharges = buildCharges();

export function formatMoney(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export type OrgSettings = {
  pixKey: string;
  pixName: string;
};

