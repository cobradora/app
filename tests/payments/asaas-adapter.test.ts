import { describe, it, expect } from "vitest";
import { calculateAsaasCharge } from "@/payments/asaas-adapter";

describe("calculateAsaasCharge", () => {
  it("calcula o valor bruto para o organizador receber o liquido desejado, com split fixo e taxa Pix", () => {
    const result = calculateAsaasCharge({
      netAmountForOrganizer: 5000, // R$ 50,00
      fixedSplitToPartner: 199, // R$ 1,99
      pixFeeCents: 199, // taxa padrão Pix
    });

    // valor a cobrar = organizador + split + taxa = 50,00 + 1,99 + 1,99 = 53,98
    expect(result.grossAmount).toBe(5398);
    expect(result.netAfterFee).toBe(5199);
    expect(result.organizerAmount).toBe(5000);
  });
});
