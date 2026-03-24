import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { QuotationSummary, QuotationLineItem } from "@/lib/types";

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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const summary: QuotationSummary | undefined = body.summary;

    if (
      !summary ||
      !Array.isArray(summary.lineItems) ||
      typeof summary.subtotal !== "number"
    ) {
      return Response.json(
        { error: "Invalid summary data" },
        { status: 400 }
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
    page.drawText(`Generated: ${new Date().toISOString().slice(0, 10)}`, {
      x: 50,
      y: 765,
      size: 10,
      font: bodyFont,
    });

    page.drawText("Itemized Breakdown", {
      x: 50,
      y: 735,
      size: 13,
      font: titleFont,
    });

    let y = drawLineItems({
      page,
      items: summary.lineItems,
      font: bodyFont,
      startY: 715,
    });

    y -= 12;
    page.drawText(`Subtotal: ${summary.subtotal.toFixed(2)}`, {
      x: 390,
      y,
      size: 11,
      font: bodyFont,
    });
    y -= 14;
    page.drawText(
      `Margin (${(summary.margin * 100).toFixed(0)}%): ${summary.marginAmount.toFixed(2)}`,
      {
        x: 390,
        y,
        size: 11,
        font: bodyFont,
      }
    );
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
        "Content-Disposition": `inline; filename="quotation-${Date.now()}.pdf"`,
      },
    });
  } catch (error) {
    console.error("Quote PDF error:", error);
    return Response.json(
      { error: "Failed to generate PDF" },
      { status: 500 }
    );
  }
}
