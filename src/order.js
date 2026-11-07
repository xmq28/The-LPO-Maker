import { SCALE, parseDecimal, formatDecimal } from "./decimal.js";
import { computeTotals } from "./calc.js";

export const STATUS = { OPEN: "open", PARTIAL: "partial", CLOSED: "closed", CANCELLED: "cancelled" };

export class OrderError extends Error {
  constructor(message, errors = [message]) {
    super(message);
    this.errors = errors;
  }
}

const isValidDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s ?? "")) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const percent = (text, fallback) => parseDecimal(text === "" || text == null ? fallback : text, SCALE.pct);

// Parses one raw line to scaled BigInts. A field that is not valid comes back as null.
export function parseLine(line) {
  return {
    qty: parseDecimal(line.qty, SCALE.qty),
    price: parseDecimal(line.price, SCALE.price),
    disc: percent(line.discountPct, "0"),
    vat: percent(line.vatRate, "0"),
  };
}

export const isLineValid = (p) =>
  p.qty !== null && p.qty > 0n && p.price !== null && p.disc !== null && p.disc <= 10000n && p.vat !== null && p.vat <= 10000n;

// Checks raw form input. Returns { errors, parsed } where parsed holds scaled BigInts.
export function validateInput(input) {
  const errors = [];
  const text = (v) => String(v ?? "").trim();

  if (!text(input.buyer?.name)) errors.push("Buyer name is required.");
  if (!text(input.supplier?.name)) errors.push("Supplier name is required.");

  const orderDateOk = isValidDate(input.orderDate);
  const dueDateOk = isValidDate(input.dueDate);
  if (!orderDateOk) errors.push("Order date is required.");
  if (!dueDateOk) errors.push("Due date is required.");
  if (orderDateOk && dueDateOk && input.dueDate < input.orderDate) {
    errors.push("Due date cannot be before the order date.");
  }

  const rawLines = input.lines ?? [];
  if (rawLines.length === 0) errors.push("Add at least one line.");

  const lines = rawLines.map((line, i) => {
    const n = i + 1;
    const parsedLine = parseLine(line);
    const { qty, price, disc, vat } = parsedLine;
    if (!text(line.description)) errors.push(`Line ${n}: description is required.`);
    if (qty === null || qty <= 0n) errors.push(`Line ${n}: quantity must be above zero (up to 3 decimals).`);
    if (price === null) errors.push(`Line ${n}: price must be zero or more (up to 6 decimals).`);
    if (disc === null || disc > 10000n) errors.push(`Line ${n}: discount must be between 0 and 100.`);
    if (vat === null || vat > 10000n) errors.push(`Line ${n}: VAT rate must be between 0 and 100.`);
    return parsedLine;
  });

  const docDiscount = parseDecimal(text(input.documentDiscount) || "0", SCALE.money);
  if (docDiscount === null) errors.push("Document discount must be zero or more (up to 3 decimals).");

  if (lines.length > 0 && lines.every(isLineValid) && docDiscount !== null) {
    const { subtotal } = computeTotals(lines, 0n);
    if (docDiscount > subtotal) errors.push("Document discount cannot exceed the order net.");
  }

  return { errors, parsed: errors.length === 0 ? { lines, docDiscount } : null };
}

const clean = (v) => String(v ?? "").trim();

function normalise(input, parsed) {
  return {
    buyer: { name: clean(input.buyer.name), address: clean(input.buyer.address), vat: clean(input.buyer.vat) },
    supplier: { name: clean(input.supplier.name), address: clean(input.supplier.address), vat: clean(input.supplier.vat) },
    reference: clean(input.reference),
    orderDate: input.orderDate,
    dueDate: input.dueDate,
    documentDiscount: formatDecimal(parsed.docDiscount, SCALE.money),
    lines: input.lines.map((line, i) => ({
      description: clean(line.description),
      unit: clean(line.unit) || "each",
      qty: formatDecimal(parsed.lines[i].qty, SCALE.qty),
      price: formatDecimal(parsed.lines[i].price, SCALE.price, { minFraction: 3 }),
      discountPct: formatDecimal(parsed.lines[i].disc, SCALE.pct, { minFraction: 0 }),
      vatRate: formatDecimal(parsed.lines[i].vat, SCALE.pct, { minFraction: 0 }),
      received: formatDecimal(0n, SCALE.qty),
    })),
  };
}

export const formatNumber = (year, seq) => `LPO-${year}-${String(seq).padStart(4, "0")}`;

// The next sequence is derived from stored orders and orders are never deleted,
// so numbers within a year have no gaps.
export function nextSequence(orders, year) {
  return orders.filter((o) => o.year === year).reduce((max, o) => Math.max(max, o.seq), 0) + 1;
}

export function createOrder(input, existingOrders, now = new Date()) {
  const { errors, parsed } = validateInput(input);
  if (!parsed) throw new OrderError(errors.join(" "), errors);
  const year = Number(input.orderDate.slice(0, 4));
  const seq = nextSequence(existingOrders, year);
  return {
    number: formatNumber(year, seq),
    year,
    seq,
    status: STATUS.OPEN,
    createdAt: now.toISOString(),
    ...normalise(input, parsed),
  };
}

function refuseIfFinished(order) {
  if (order.status === STATUS.CLOSED || order.status === STATUS.CANCELLED) {
    throw new OrderError(`${order.number} is ${order.status}; nothing can be changed.`);
  }
}

export function updateOrder(order, input) {
  refuseIfFinished(order);
  if (order.status !== STATUS.OPEN) {
    throw new OrderError("Lines cannot be edited after the first receipt.");
  }
  const { errors, parsed } = validateInput(input);
  if (!parsed) throw new OrderError(errors.join(" "), errors);
  if (Number(input.orderDate.slice(0, 4)) !== order.year) {
    throw new OrderError(`Order date must stay in ${order.year} to keep the number ${order.number}.`);
  }
  return { ...order, ...normalise(input, parsed) };
}

export function pendingFor(line) {
  return parseDecimal(line.qty, SCALE.qty) - parseDecimal(line.received, SCALE.qty);
}

export function receiveGoods(order, lineIndex, qtyText, now = new Date()) {
  refuseIfFinished(order);
  const line = order.lines[lineIndex];
  if (!line) throw new OrderError("Unknown line.");
  const qty = parseDecimal(qtyText, SCALE.qty);
  if (qty === null || qty <= 0n) throw new OrderError("Received quantity must be above zero (up to 3 decimals).");

  const pending = pendingFor(line);
  if (qty > pending) {
    throw new OrderError(
      `Cannot receive ${formatDecimal(qty, SCALE.qty)} on line ${lineIndex + 1}: only ${formatDecimal(pending, SCALE.qty)} pending.`,
    );
  }

  const received = parseDecimal(line.received, SCALE.qty) + qty;
  const lines = order.lines.map((l, i) =>
    i === lineIndex ? { ...l, received: formatDecimal(received, SCALE.qty) } : l,
  );
  const complete = lines.every((l) => pendingFor(l) === 0n);
  return {
    ...order,
    lines,
    status: complete ? STATUS.CLOSED : STATUS.PARTIAL,
    ...(complete ? { closedAt: now.toISOString() } : {}),
  };
}

export function cancelOrder(order, now = new Date()) {
  refuseIfFinished(order);
  if (order.status !== STATUS.OPEN) {
    throw new OrderError("A partially received order cannot be cancelled; close it instead.");
  }
  return { ...order, status: STATUS.CANCELLED, closedAt: now.toISOString() };
}

export function closeOrder(order, now = new Date()) {
  refuseIfFinished(order);
  if (order.status !== STATUS.PARTIAL) {
    throw new OrderError("Only a partially received order can be closed; cancel an open order instead.");
  }
  return { ...order, status: STATUS.CLOSED, closedAt: now.toISOString() };
}

// Parses a stored order back to scaled values and returns its totals.
export function totalsFor(order) {
  const lines = order.lines.map((l) => ({
    qty: parseDecimal(l.qty, SCALE.qty),
    price: parseDecimal(l.price, SCALE.price),
    disc: parseDecimal(l.discountPct, SCALE.pct),
    vat: parseDecimal(l.vatRate, SCALE.pct),
  }));
  return computeTotals(lines, parseDecimal(order.documentDiscount, SCALE.money));
}
