export function normalizePhoneBR(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const withoutCountry = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  return `+55${withoutCountry}`;
}
