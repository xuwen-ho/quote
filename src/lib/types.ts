export interface DetectedRoom {
  type: string;
  name: string;
  areaSqft: number;
  dimensions: {
    width: number;
    length: number;
    unit: "ft" | "m";
  };
}

export interface AnalysisResult {
  rooms: DetectedRoom[];
  totalAreaSqft: number;
  confidence: number;
}

export interface RateItem {
  category: string;
  itemName: string;
  unitCost: number;
  unit: string;
  description?: string | null;
}

export interface QuotationLineItem {
  category: string;
  itemName: string;
  quantity: number;
  unit: string;
  unitCost: number;
  totalCost: number;
  room?: string;
}

export interface QuotationSummary {
  lineItems: QuotationLineItem[];
  subtotal: number;
  margin: number;
  marginAmount: number;
  grandTotal: number;
}
