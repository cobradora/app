export const PHONE_INPUT_MAX_LENGTH = 20;

const BRAZIL_MOBILE_LOCAL_RE = /^[1-9][0-9]9[0-9]{8}$/;

export class InvalidBrazilMobilePhoneError extends Error {
  constructor() {
    super("Informe um celular brasileiro válido com DDD");
    this.name = "InvalidBrazilMobilePhoneError";
  }
}

export type BrazilMobilePhone = {
  normalized: string;
  display: string;
};

export function parsePhoneBR(raw: string): BrazilMobilePhone {
  if (typeof raw !== "string" || raw.length > PHONE_INPUT_MAX_LENGTH) {
    throw new InvalidBrazilMobilePhoneError();
  }

  const digits = raw.replace(/\D/g, "");
  const local = digits.startsWith("55") && digits.length === 13 ? digits.slice(2) : digits;

  if (!BRAZIL_MOBILE_LOCAL_RE.test(local)) {
    throw new InvalidBrazilMobilePhoneError();
  }

  return {
    normalized: `+55${local}`,
    display: `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`,
  };
}

export function normalizePhoneBR(raw: string): string {
  return parsePhoneBR(raw).normalized;
}
