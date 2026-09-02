import { describe, expect, it } from "vitest";
import { formatPhoneInput, isValidPhone, parsePhone } from "@/lib/phone";

describe("phone", () => {
  it("mantém a entrada brasileira existente e normaliza para E.164", () => {
    expect(parsePhone("(11) 98812-4410")).toEqual({
      normalized: "+5511988124410",
      display: "(11) 98812-4410",
    });
  });

  it("aceita e preserva telefones internacionais com código do país", () => {
    expect(parsePhone("+351 912 345 678")).toEqual({
      normalized: "+351912345678",
      display: "+351912345678",
    });
    expect(parsePhone("+1 (415) 555-2671").normalized).toBe("+14155552671");
  });

  it("exige o prefixo + para não confundir um telefone estrangeiro com um brasileiro", () => {
    expect(isValidPhone("351 912 345 678")).toBe(false);
    expect(isValidPhone("+351 912 345 678")).toBe(true);
  });

  it("preserva o + na digitação de números internacionais", () => {
    expect(formatPhoneInput("+351 912 345 678")).toBe("+351912345678");
  });
});
