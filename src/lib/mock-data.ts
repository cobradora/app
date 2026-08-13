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
  publicSlug: string;
  status: "active" | "archived";
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
  participantName?: string;
  competence: string;
  amount: number;
  status: ChargeStatus;
  source: PaymentSource | null;
  paidAt: string | null;
};

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
