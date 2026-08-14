export const PARTICIPANT_NAME_MAX_LENGTH = 120;
export const GROUP_NAME_MAX_LENGTH = 120;
export const MESSAGE_PART_MAX_LENGTH = 1000;

export function cleanHumanName(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

export function normalizeHumanName(value: string): string {
  return cleanHumanName(value)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR");
}
