import * as PDFDocument from 'pdfkit';
import { InvoiceWithLineItems } from './invoices.service';

// Builds a simple, single-page-per-~20-lines PDF statement: header with
// the business name and invoice number/period, a line-item table, and
// a totals block. Deliberately plain (no logo, no letterhead) — this is
// an accounting record a business downloads for their own books or a
// client, not a branded customer-facing document.
export function renderInvoicePdf(invoice: InvoiceWithLineItems, businessName: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).text('WAZZAR', { continued: true }).fontSize(10).text('  delivery invoice', { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(14).text(invoice.invoiceNumber);
    doc.fontSize(10).fillColor('#555555');
    doc.text(`Billed to: ${businessName}`);
    doc.text(`Period: ${invoice.periodStart} to ${invoice.periodEnd}`);
    doc.text(`Generated: ${invoice.createdAt.toISOString().slice(0, 10)}`);
    doc.fillColor('#000000');
    doc.moveDown(1);

    const tableTop = doc.y;
    const col = { date: 50, desc: 130, amount: 460 };
    doc.fontSize(9).fillColor('#555555');
    doc.text('Date', col.date, tableTop);
    doc.text('Description', col.desc, tableTop);
    doc.text('Amount (TZS)', col.amount, tableTop, { width: 90, align: 'right' });
    doc.moveTo(50, tableTop + 14).lineTo(550, tableTop + 14).strokeColor('#dddddd').stroke();
    doc.fillColor('#000000');

    let y = tableTop + 22;
    for (const item of invoice.lineItems) {
      // A new page 40pt from the bottom margin keeps a row from ever
      // being split visually across pages.
      if (y > 760) {
        doc.addPage();
        y = 50;
      }
      const dateLabel = item.deliveredAt ? item.deliveredAt.toISOString().slice(0, 10) : '—';
      doc.fontSize(9);
      doc.text(dateLabel, col.date, y, { width: 75 });
      doc.text(item.description, col.desc, y, { width: 320 });
      doc.text(Number(item.amount).toLocaleString('en-US', { minimumFractionDigits: 2 }), col.amount, y, {
        width: 90,
        align: 'right',
      });
      y += 18;
    }

    doc.moveTo(50, y + 4).lineTo(550, y + 4).strokeColor('#dddddd').stroke();
    y += 14;

    const totalsLine = (label: string, value: string, bold = false) => {
      doc.fontSize(bold ? 11 : 9).font(bold ? 'Helvetica-Bold' : 'Helvetica');
      doc.text(label, 350, y, { width: 110, align: 'right' });
      doc.text(value, col.amount, y, { width: 90, align: 'right' });
      y += bold ? 18 : 14;
    };

    totalsLine('Subtotal', formatMoney(invoice.subtotalAmount));
    if (Number(invoice.taxRatePercent) > 0) {
      totalsLine(`Tax (${Number(invoice.taxRatePercent)}%)`, formatMoney(invoice.taxAmount));
    }
    totalsLine('Total', `${formatMoney(invoice.totalAmount)} ${invoice.currency}`, true);

    doc.end();
  });
}

function formatMoney(value: string): string {
  return Number(value).toLocaleString('en-US', { minimumFractionDigits: 2 });
}
