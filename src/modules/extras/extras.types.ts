export type ImportCsvInput = {
  csv: string;
};

export type BarcodeQuery = {
  sku?: string;
  kind?: string;
  count?: string | number;
};

export type ExportQuery = {
  kind?: string;
};
