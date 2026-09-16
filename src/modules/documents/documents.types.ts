import type { DocumentLayout, DocumentType } from "./document-types.js";

export type PrintDocumentInput = {
  type: DocumentType;
  id: string;
  layout: DocumentLayout;
};
