import { SCALE, parseDecimal, formatMoney, formatQty, formatPct } from "./decimal.js";
import { totalsFor, pendingFor } from "./order.js";

const MARGIN = 15;
const PAGE_W = 210;
const PAGE_H = 297;
const RIGHT = PAGE_W - MARGIN;

// Column widths add up to the 180 mm content width. Numeric columns are right aligned.
const COLUMNS = [
  { key: "no", label: "No", w: 8, align: "left" },
  { key: "description", label: "Description", w: 48, align: "left" },
  { key: "unit", label: "Unit", w: 13, align: "left" },
  { key: "ordered", label: "Ordered", w: 17, align: "right" },
  { key: "received", label: "Received", w: 17, align: "right" },
  { key: "pending", label: "Pending", w: 17, align: "right" },
  { key: "price", label: "Price", w: 18, align: "right" },
  { key: "disc", label: "Disc %", w: 11, align: "right" },
  { key: "vat", label: "VAT %", w: 11, align: "right" },
  { key: "net", label: "Net", w: 20, align: "right" },
];

const STATUS_LABEL = { open: "OPEN", partial: "PARTIAL", closed: "CLOSED", cancelled: "CANCELLED" };

// Builds the LPO with a jsPDF constructor so it works in the browser and in Node.
export function buildLpoPdf(JsPDF, order) {
  const doc = new JsPDF({ unit: "mm", format: "a4" });
  const totals = totalsFor(order);
  let y = MARGIN;

  const text = (s, x, yy, opts) => doc.text(String(s), x, yy, opts);

  function drawParty(label, party, x, w) {
    doc.setDrawColor(200);
    doc.roundedRect(x, y, w, 26, 1.5, 1.5);
    doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(110);
    text(label, x + 3, y + 5);
    doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(20);
    doc.splitTextToSize(party.name, w - 6).slice(0, 2).forEach((l, i) => text(l, x + 3, y + 11 + i * 4.5));
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(70);
    if (party.address) text(party.address, x + 3, y + 20, { maxWidth: w - 6 });
    if (party.vat) text(`VAT ${party.vat}`, x + 3, y + 24);
  }

  function drawHeader() {
    doc.setFont("helvetica", "bold").setFontSize(16).setTextColor(20);
    text("LOCAL PURCHASE ORDER", MARGIN, y + 6);
    doc.setFont("courier", "bold").setFontSize(11);
    text(order.number, RIGHT, y + 6, { align: "right" });
    doc.setDrawColor(20).setLineWidth(0.4).line(MARGIN, y + 9, RIGHT, y + 9).setLineWidth(0.2);
    y += 14;
    drawParty("BUYER", order.buyer, MARGIN, 88);
    drawParty("SUPPLIER", order.supplier, MARGIN + 92, 88);
    y += 32;

    const meta = [
      ["Reference", order.reference || "-"],
      ["Order date", order.orderDate],
      ["Due date", order.dueDate],
      ["Status", STATUS_LABEL[order.status]],
    ];
    meta.forEach(([label, value], i) => {
      const x = MARGIN + i * 45;
      doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(110);
      text(label, x, y);
      doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(20);
      text(value, x, y + 5);
    });
    y += 12;
  }

  function drawTableHeader() {
    doc.setFillColor(238, 241, 245).rect(MARGIN, y, 180, 7, "F");
    doc.setFont("helvetica", "bold").setFontSize(7.5).setTextColor(40);
    let x = MARGIN;
    for (const col of COLUMNS) {
      col.align === "right" ? text(col.label, x + col.w - 1.5, y + 4.7, { align: "right" }) : text(col.label, x + 1.5, y + 4.7);
      x += col.w;
    }
    y += 7;
  }

  function rowValues(line, i) {
    const ordered = parseDecimal(line.qty, SCALE.qty);
    return {
      no: String(i + 1),
      description: line.description,
      unit: line.unit,
      ordered: formatQty(ordered),
      received: formatQty(parseDecimal(line.received, SCALE.qty)),
      pending: formatQty(pendingFor(line)),
      price: line.price,
      disc: line.discountPct === "0" ? "-" : line.discountPct,
      vat: formatPct(parseDecimal(line.vatRate, SCALE.pct)),
      net: formatMoney(totals.nets[i]),
    };
  }

  function drawFooters() {
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(120);
      text(`${order.number}  |  All amounts in BHD (3 decimals)`, MARGIN, PAGE_H - 8);
      text(`Page ${p} of ${pages}`, RIGHT, PAGE_H - 8, { align: "right" });
    }
  }

  drawHeader();
  drawTableHeader();

  const descCol = COLUMNS[1];
  order.lines.forEach((line, i) => {
    const values = rowValues(line, i);
    doc.setFont("helvetica", "normal").setFontSize(8);
    const descLines = doc.splitTextToSize(values.description, descCol.w - 3);
    const rowH = Math.max(7, descLines.length * 4 + 3);
    if (y + rowH > PAGE_H - 25) {
      doc.addPage();
      y = MARGIN;
      drawTableHeader();
    }
    doc.setTextColor(20);
    let x = MARGIN;
    for (const col of COLUMNS) {
      if (col.key === "description") {
        descLines.forEach((l, k) => text(l, x + 1.5, y + 4.7 + k * 4));
      } else if (col.align === "right") {
        text(values[col.key], x + col.w - 1.5, y + 4.7, { align: "right" });
      } else {
        text(values[col.key], x + 1.5, y + 4.7);
      }
      x += col.w;
    }
    doc.setDrawColor(225).line(MARGIN, y + rowH, RIGHT, y + rowH);
    y += rowH;
  });

  const summaryRows = [
    ["Net of lines", formatMoney(totals.subtotal)],
    ["Document discount", totals.docDiscount === 0n ? "0.000" : `-${formatMoney(totals.docDiscount)}`],
    ...totals.groups.flatMap((g) => [
      [`Taxable at ${formatPct(g.rate)}%`, formatMoney(g.taxable)],
      [`VAT ${formatPct(g.rate)}%`, formatMoney(g.vatAmount)],
    ]),
  ];
  const summaryH = summaryRows.length * 5.5 + 12;
  if (y + summaryH > PAGE_H - 20) {
    doc.addPage();
    y = MARGIN;
  }
  y += 6;
  const sx = RIGHT - 80;
  doc.setFontSize(9);
  for (const [label, value] of summaryRows) {
    doc.setFont("helvetica", "normal").setTextColor(60);
    text(label, sx, y);
    doc.setTextColor(20);
    text(value, RIGHT, y, { align: "right" });
    y += 5.5;
  }
  doc.setDrawColor(20).line(sx, y - 2.5, RIGHT, y - 2.5);
  y += 3;
  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(20);
  text("Total BHD", sx, y);
  text(formatMoney(totals.total), RIGHT, y, { align: "right" });

  drawFooters();
  return doc;
}
