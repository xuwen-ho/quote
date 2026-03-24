import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import type { QuotationSummary, QuotationLineItem, RateItem, DetectedRoom } from "@/lib/types";
import { buildQuotationSummary } from "@/lib/quotation";

function toSummaryFromStoredQuote(input: {
  rooms: unknown;
  rates: unknown;
  margin: number;
}): QuotationSummary | null {
  if (!Array.isArray(input.rooms) || !Array.isArray(input.rates)) return null;

  try {
    const rooms = input.rooms as DetectedRoom[];
    const rates = input.rates as RateItem[];
    return buildQuotationSummary({
      rooms,
      rates,
      margin: input.margin,
    });
  } catch {
    return null;
  }
}

function drawLineItems(args: {
  page: ReturnType<PDFDocument["addPage"]>;
  items: QuotationLineItem[];
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>;
  startY: number;
}) {
  const { page, items, font } = args;
  let y = args.startY;

  for (const line of items) {
    if (y < 80) return y;

    const roomLabel = line.room ? `[${line.room}] ` : "";
    const text = `${roomLabel}${line.category} - ${line.itemName}`;
    const rhs = `${line.quantity} ${line.unit} x ${line.unitCost.toFixed(2)} = ${line.totalCost.toFixed(2)}`;

    page.drawText(text, {
      x: 50,
      y,
      size: 10,
      font,
      color: rgb(0.1, 0.1, 0.1),
      maxWidth: 320,
    });
    page.drawText(rhs, {
      x: 390,
      y,
      size: 10,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= 14;
  }

  return y;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    const quote = await prisma.quote.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!quote) {
      return Response.json({ error: "Quote not found" }, { status: 404 });
    }

    const summary = toSummaryFromStoredQuote({
      rooms: quote.rooms,
      rates: quote.rates,
      margin: quote.margin,
    });

    if (!summary) {
      return Response.json(
        { error: "Stored quote data is invalid for PDF generation" },
        { status: 500 }
      );
    }

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]); // A4
    const titleFont = await pdf.embedFont(StandardFonts.HelveticaBold);
    const bodyFont = await pdf.embedFont(StandardFonts.Helvetica);

    page.drawText("Renovation Quotation", {
      x: 50,
      y: 790,
      size: 22,
      font: titleFont,
      color: rgb(0.1, 0.1, 0.1),
    });
    page.drawText(`Quote ID: ${quote.id}`, { x: 50, y: 765, size: 10, font: bodyFont });
    page.drawText(
      `Project: ${quote.project?.name ?? "Untitled Project"}`,
      { x: 50, y: 750, size: 10, font: bodyFont }
    );
    page.drawText(`Generated: ${new Date().toISOString().slice(0, 10)}`, {
      x: 50,
      y: 735,
      size: 10,
      font: bodyFont,
    });

    page.drawText("Itemized Breakdown", {
      x: 50,
      y: 705,
      size: 13,
      font: titleFont,
    });

    let y = drawLineItems({
      page,
      items: summary.lineItems,
      font: bodyFont,
      startY: 685,
    });

    y -= 12;
    page.drawText(`Subtotal: ${summary.subtotal.toFixed(2)}`, {
      x: 390,
      y,
      size: 11,
      font: bodyFont,
    });
    y -= 14;
    page.drawText(`Margin (${(summary.margin * 100).toFixed(0)}%): ${summary.marginAmount.toFixed(2)}`, {
      x: 390,
      y,
      size: 11,
      font: bodyFont,
    });
    y -= 16;
    page.drawText(`Grand Total: ${summary.grandTotal.toFixed(2)}`, {
      x: 390,
      y,
      size: 13,
      font: titleFont,
    });

    const bytes = await pdf.save();

    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="quote-${quote.id}.pdf"`,
      },
    });
  } catch (error) {
    console.error("Quote PDF error:", error);
    return Response.json(
      { error: "Failed to generate quote PDF" },
      { status: 500 }
    );
  }
}
