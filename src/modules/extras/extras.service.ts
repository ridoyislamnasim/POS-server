import { parseCsv, tenantId } from "../../lib/erp.js";
import { normalizeBdPhone } from "../../shared/phone.js";
import { AppError } from "../../utils/errors.js";
import type { RequestContext } from "../../types.js";
import { extrasRepository } from "./extras.repository.js";
import type { BarcodeQuery, ExportQuery, ImportCsvInput } from "./extras.types.js";

/** Import/export + barcode business logic. No Express `req`/`res` here. */
export const extrasService = {
  generateBarcodes(query: BarcodeQuery) {
    const sku = String(query.sku ?? "ITEM");
    const kind = String(query.kind ?? "CODE128");
    const count = Math.min(Number(query.count ?? 1), 50);
    return Array.from({ length: count }, (_, i) => {
      const n = String(Date.now()).slice(-8) + String(i).padStart(2, "0");
      const code = kind === "EAN13" ? `890${n.padStart(9, "0").slice(0, 9)}` : `${sku}-${n}`;
      return { code, kind, sku, label: `${sku} ${code}` };
    });
  },

  async importProducts(ctx: RequestContext, input: ImportCsvInput) {
    const csv = String(input.csv ?? "");
    if (!csv.trim()) throw new AppError("VALIDATION", "csv required", 400);
    const { rows } = parseCsv(csv);
    const created: string[] = [];
    const errors: { line: number; error: string }[] = [];
    let line = 1;
    for (const row of rows) {
      line += 1;
      try {
        const name = row.name || row.product;
        const code = row.code || row.sku;
        if (!name || !code) throw new Error("name and code/sku required");
        const product = await extrasRepository.upsertProduct(tenantId(ctx), code, name, row.category || null);
        const sku = row.sku || `${code}-DEF`;
        await extrasRepository.upsertVariant(tenantId(ctx), product.id, sku, row.price, row.cost);
        created.push(sku);
      } catch (e) {
        errors.push({ line, error: (e as Error).message });
      }
    }
    return { created: created.length, errors };
  },

  async importCustomers(ctx: RequestContext, input: ImportCsvInput) {
    const csv = String(input.csv ?? "");
    if (!csv.trim()) throw new AppError("VALIDATION", "csv required", 400);
    const { rows } = parseCsv(csv);
    let created = 0;
    const errors: { line: number; error: string }[] = [];
    let line = 1;
    for (const row of rows) {
      line += 1;
      try {
        const name = row.name;
        const phone = row.phone;
        if (!name || !phone) throw new Error("name and phone required");
        const phoneCanonical = normalizeBdPhone(phone);
        await extrasRepository.upsertCustomer(
          tenantId(ctx),
          phoneCanonical,
          { name, phone, email: row.email || null, address: row.address || null },
          { name, email: row.email || undefined, address: row.address || undefined },
        );
        created += 1;
      } catch (e) {
        errors.push({ line, error: (e as Error).message });
      }
    }
    return { created, errors };
  },

  async exportData(ctx: RequestContext, query: ExportQuery) {
    const kind = String(query.kind ?? "customers");
    if (kind === "products") return extrasRepository.listProductsWithVariants(tenantId(ctx));
    return extrasRepository.listCustomers(tenantId(ctx));
  },
};
