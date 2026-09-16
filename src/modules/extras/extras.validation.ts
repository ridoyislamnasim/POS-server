import { z } from "zod";

export const importCsvSchema = z.object({
  csv: z.string().min(1, "csv required"),
});

export type ImportCsvBody = z.infer<typeof importCsvSchema>;
