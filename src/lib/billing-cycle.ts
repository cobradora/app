export const BILLING_TIME_ZONE = "America/Sao_Paulo";

type LocalDateParts = { year: number; month: number; day: number };

export function getBillingLocalDateParts(value = new Date()): LocalDateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BILLING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);

  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day") };
}

export function formatReferenceMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function shiftReferenceMonth(referenceMonth: string, delta: number): string {
  const [year, month] = referenceMonth.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  return formatReferenceMonth(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1);
}

export function renewalDateFor(referenceMonth: string, billingDay: number): string {
  return `${referenceMonth}-${String(billingDay).padStart(2, "0")}`;
}

export function currentReferenceMonth(value = new Date()): string {
  const local = getBillingLocalDateParts(value);
  return formatReferenceMonth(local.year, local.month);
}

export function billingStartFor(
  billingDay: number,
  value = new Date(),
  currentPeriodAlreadyGenerated = false,
): { billingStartsOn: string; referenceMonth: string; startsNextCycle: boolean } {
  const local = getBillingLocalDateParts(value);
  const current = formatReferenceMonth(local.year, local.month);
  // O Cron renova no início do billingDay; qualquer cadastro feito nesse
  // próprio dia já pertence ao ciclo seguinte.
  const startsNextCycle = currentPeriodAlreadyGenerated || local.day >= billingDay;
  const referenceMonth = startsNextCycle ? shiftReferenceMonth(current, 1) : current;

  return {
    billingStartsOn: renewalDateFor(referenceMonth, billingDay),
    referenceMonth,
    startsNextCycle,
  };
}

export function isReferenceMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
