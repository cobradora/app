export const PHONE_INPUT_MAX_LENGTH = 25;

const E164_RE = /^\+[1-9][0-9]{7,14}$/;
const BRAZIL_MOBILE_LOCAL_RE = /^[1-9][0-9]9[0-9]{8}$/;

export class InvalidPhoneError extends Error {
  constructor() {
    super("Informe um telefone válido; para outros países, inclua o código do país (ex.: +351)");
    this.name = "InvalidPhoneError";
  }
}

export type Phone = {
  normalized: string;
  display: string;
};

/**
 * Aceita celulares brasileiros com DDD, com ou sem +55, e números
 * internacionais em E.164. Fora do Brasil, o código do país é obrigatório.
 */
export function parsePhone(raw: string): Phone {
  if (typeof raw !== "string" || raw.length > PHONE_INPUT_MAX_LENGTH) {
    throw new InvalidPhoneError();
  }

  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  const hasInternationalPrefix = trimmed.startsWith("+");
  const normalized = hasInternationalPrefix
    ? `+${digits}`
    : digits.startsWith("55") && digits.length === 13
      ? `+${digits}`
      : `+55${digits}`;

  if (!E164_RE.test(normalized)) {
    throw new InvalidPhoneError();
  }

  if (normalized.startsWith("+55")) {
    const local = normalized.slice(3);
    if (!BRAZIL_MOBILE_LOCAL_RE.test(local)) {
      throw new InvalidPhoneError();
    }
    return {
      normalized,
      display: `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`,
    };
  }

  return { normalized, display: normalized };
}

export function normalizePhone(raw: string): string {
  return parsePhone(raw).normalized;
}

export function isValidPhone(raw: string): boolean {
  try {
    parsePhone(raw);
    return true;
  } catch {
    return false;
  }
}

/** Máscara brasileira por padrão; preserva entradas iniciadas por +. */
export function formatPhoneInput(raw: string): string {
  const isInternational = raw.trimStart().startsWith("+");
  const digits = raw.replace(/\D/g, "");

  if (isInternational && !(digits.startsWith("55") && digits.length === 13)) {
    return `+${digits.slice(0, 15)}`;
  }

  const local = digits.startsWith("55") && digits.length === 13 ? digits.slice(2) : digits.slice(0, 11);
  if (local.length <= 2) return local;
  if (local.length <= 6) return `(${local.slice(0, 2)}) ${local.slice(2)}`;
  if (local.length <= 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
}
