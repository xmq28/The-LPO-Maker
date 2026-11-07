import { SCALE, formatMoney, formatQty, formatPct, parseDecimal } from "./decimal.js";
import { computeTotals, lineNet } from "./calc.js";
import {
  STATUS, OrderError, createOrder, updateOrder, receiveGoods, cancelOrder, closeOrder,
  totalsFor, pendingFor, parseLine, isLineValid, validateInput,
} from "./order.js";
import { loadOrders, saveOrders } from "./store.js";
import { sampleInput } from "./sample.js";
import { buildLpoPdf } from "./pdf.js";

const $main = document.getElementById("main");
const $list = document.getElementById("order-list");
const $new = document.getElementById("new-order");

let orders = loadOrders();
let selected = orders.at(-1)?.number ?? null;

const todayIso = () => new Date().toISOString().slice(0, 10);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const byNumber = (n) => orders.find((o) => o.number === n);

function persist(next) {
  orders = next;
  saveOrders(orders);
}

function message(kind, content) {
  const body = Array.isArray(content) && content.length > 1
    ? `<ul>${content.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`
    : esc(Array.isArray(content) ? content[0] : content);
  return `<div class="message ${kind}" role="${kind === "error" ? "alert" : "status"}">${body}</div>`;
}

function showMessage(kind, content) {
  const slot = document.getElementById("msg");
  if (slot) slot.innerHTML = message(kind, content);
}

function errorsOf(err) {
  return err instanceof OrderError ? err.errors : ["Something went wrong: " + err.message];
}

function renderList() {
  if (orders.length === 0) {
    $list.innerHTML = `<li class="empty">No orders yet.</li>`;
    return;
  }
  $list.innerHTML = [...orders].reverse().map((o) => {
    const total = formatMoney(totalsFor(o).total);
    return `<li><button type="button" class="order-item" data-number="${esc(o.number)}" ${o.number === selected ? 'aria-current="true"' : ""}>
      <span class="row"><strong>${esc(o.number)}</strong><span class="badge ${o.status}">${o.status}</span></span>
      <small>${esc(o.supplier.name)}</small><small>BHD ${total}</small></button></li>`;
  }).join("");
}

function lineRowHtml(line = {}) {
  const v = (k, d = "") => esc(line[k] ?? d);
  return `<tr class="line-row">
    <td><input data-col="description" aria-label="Description" value="${v("description")}"></td>
    <td><input data-col="unit" aria-label="Unit" value="${v("unit", "each")}" size="6"></td>
    <td><input class="num" data-col="qty" inputmode="decimal" aria-label="Quantity" value="${v("qty")}"></td>
    <td><input class="num" data-col="price" inputmode="decimal" aria-label="Unit price" value="${v("price")}"></td>
    <td><input class="num" data-col="discountPct" inputmode="decimal" aria-label="Line discount percent" value="${v("discountPct")}"></td>
    <td><input class="num" data-col="vatRate" inputmode="decimal" aria-label="VAT rate percent" value="${v("vatRate", "10")}"></td>
    <td class="num" data-net>-</td>
    <td><button type="button" class="link" data-action="remove-line" aria-label="Remove line">Remove</button></td>
  </tr>`;
}

const partyFields = (id, label, p = {}) => `<fieldset><legend>${label}</legend><div class="fields">
  <label>Name<input data-field="${id}.name" value="${esc(p.name)}"></label>
  <label>Address<input data-field="${id}.address" value="${esc(p.address)}"></label>
  <label>VAT number<input data-field="${id}.vat" value="${esc(p.vat)}"></label></div></fieldset>`;

function renderForm(editing, seed) {
  const data = seed ?? editing ?? {
    buyer: {}, supplier: {}, reference: "", orderDate: todayIso(), dueDate: todayIso(), documentDiscount: "", lines: [{}],
  };
  const title = editing ? `Edit ${esc(editing.number)}` : "New order";
  $main.innerHTML = `<form id="order-form" novalidate>
    <div class="panel-head"><h2>${title}</h2>
      ${editing ? "" : `<button type="button" data-action="load-sample">Load sample order</button>`}</div>
    <div class="grid2">${partyFields("buyer", "Buyer", data.buyer)}${partyFields("supplier", "Supplier", data.supplier)}</div>
    <div class="meta">
      <label>Reference<input data-field="reference" value="${esc(data.reference)}"></label>
      <label>Order date<input type="date" data-field="orderDate" value="${esc(data.orderDate)}"></label>
      <label>Due date<input type="date" data-field="dueDate" value="${esc(data.dueDate)}"></label>
      <label>Document discount (BHD)<input class="num" inputmode="decimal" data-field="documentDiscount" value="${esc(data.documentDiscount === "0.000" ? "" : data.documentDiscount)}"></label>
    </div>
    <div class="table-wrap"><table class="line-form"><thead><tr>
      <th>Description</th><th>Unit</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Disc %</th><th class="num">VAT %</th><th class="num">Net</th><th></th>
    </tr></thead><tbody id="lines">${data.lines.map(lineRowHtml).join("")}</tbody></table></div>
    <div class="actions"><button type="button" data-action="add-line">Add line</button></div>
    <div id="preview" class="totals" aria-label="Live totals"></div>
    <div id="msg"></div>
    <div class="actions"><button type="submit" class="primary">${editing ? "Save changes" : "Create order"}</button>
      <button type="button" data-action="cancel-form">Back</button></div>
  </form>`;
  $main.querySelector("form").dataset.editing = editing?.number ?? "";
  updatePreview();
}

function readForm() {
  const field = (name) => $main.querySelector(`[data-field="${name}"]`).value;
  return {
    buyer: { name: field("buyer.name"), address: field("buyer.address"), vat: field("buyer.vat") },
    supplier: { name: field("supplier.name"), address: field("supplier.address"), vat: field("supplier.vat") },
    reference: field("reference"),
    orderDate: field("orderDate"),
    dueDate: field("dueDate"),
    documentDiscount: field("documentDiscount"),
    lines: [...$main.querySelectorAll(".line-row")].map((row) => {
      const get = (col) => row.querySelector(`[data-col="${col}"]`).value;
      return { description: get("description"), unit: get("unit"), qty: get("qty"), price: get("price"), discountPct: get("discountPct"), vatRate: get("vatRate") };
    }),
  };
}

// Live totals use the lines that are valid so far; saving validates everything.
function updatePreview() {
  const input = readForm();
  const rows = [...$main.querySelectorAll(".line-row")];
  const valid = [];
  input.lines.forEach((line, i) => {
    const parsed = parseLine(line);
    const cell = rows[i].querySelector("[data-net]");
    if (isLineValid(parsed)) {
      valid.push(parsed);
      cell.textContent = formatMoney(lineNet(parsed));
    } else {
      cell.textContent = "-";
    }
  });

  let discount = parseDecimal(input.documentDiscount.trim() || "0", SCALE.money) ?? 0n;
  const net = computeTotals(valid, 0n).subtotal;
  let note = "";
  if (discount > net) {
    discount = 0n;
    note = `<p class="hint">Document discount is larger than the order net.</p>`;
  }
  const t = computeTotals(valid, discount);
  $main.querySelector("#preview").innerHTML = totalsHtml(t) + note;
}

function totalsHtml(t) {
  return `<div><span>Net of lines</span><span>${formatMoney(t.subtotal)}</span></div>
    <div><span>Document discount</span><span>${t.docDiscount === 0n ? "0.000" : "-" + formatMoney(t.docDiscount)}</span></div>
    ${t.groups.map((g) => `<div><span>VAT ${formatPct(g.rate)}% on ${formatMoney(g.taxable)}</span><span>${formatMoney(g.vatAmount)}</span></div>`).join("")}
    <div class="grand"><span>Total BHD</span><span>${formatMoney(t.total)}</span></div>`;
}

function renderDetail(order) {
  const t = totalsFor(order);
  const finished = order.status === STATUS.CLOSED || order.status === STATUS.CANCELLED;
  const can = {
    edit: order.status === STATUS.OPEN,
    cancel: order.status === STATUS.OPEN,
    close: order.status === STATUS.PARTIAL,
  };
  const rows = order.lines.map((l, i) => {
    const pending = pendingFor(l);
    const receivable = !finished && pending > 0n;
    return `<tr>
      <td>${i + 1}</td><td>${esc(l.description)}</td><td>${esc(l.unit)}</td>
      <td class="num">${l.qty}</td><td class="num">${l.received}</td><td class="num">${formatQty(pending)}</td>
      <td class="num">${esc(l.price)}</td><td class="num">${esc(l.discountPct)}</td><td class="num">${esc(l.vatRate)}</td>
      <td class="num">${formatMoney(t.nets[i])}</td>
      <td><form class="receive" data-line="${i}"><input class="num" inputmode="decimal" aria-label="Quantity received for line ${i + 1}" placeholder="Qty" ${receivable ? "" : "disabled"}>
        <button type="submit" ${receivable ? "" : "disabled"}>Receive</button></form></td></tr>`;
  }).join("");

  $main.innerHTML = `<div class="panel-head"><h2>${esc(order.number)} <span class="badge ${order.status}">${order.status}</span></h2></div>
    <div class="grid2">
      <div><strong>Buyer</strong><br>${esc(order.buyer.name)}<br><small>${esc(order.buyer.address)}</small><br><small>${order.buyer.vat ? "VAT " + esc(order.buyer.vat) : ""}</small></div>
      <div><strong>Supplier</strong><br>${esc(order.supplier.name)}<br><small>${esc(order.supplier.address)}</small><br><small>${order.supplier.vat ? "VAT " + esc(order.supplier.vat) : ""}</small></div>
    </div>
    <div class="meta" style="margin-top:12px"><div><small>Reference</small><br>${esc(order.reference) || "-"}</div>
      <div><small>Order date</small><br>${esc(order.orderDate)}</div><div><small>Due date</small><br>${esc(order.dueDate)}</div></div>
    <div class="table-wrap"><table><thead><tr><th>No</th><th>Description</th><th>Unit</th><th class="num">Ordered</th><th class="num">Received</th><th class="num">Pending</th>
      <th class="num">Price</th><th class="num">Disc %</th><th class="num">VAT %</th><th class="num">Net</th><th>Receive goods</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="totals">${totalsHtml(t)}</div>
    <div id="msg"></div>
    <div class="actions">
      <button type="button" class="primary" data-action="pdf">Download PDF</button>
      <button type="button" data-action="edit" ${can.edit ? "" : "disabled"} title="${can.edit ? "" : "Lines lock after the first receipt"}">Edit</button>
      <span class="spacer"></span>
      <button type="button" class="danger" data-action="cancel-order" ${can.cancel ? "" : "disabled"} title="${can.cancel ? "" : "Only an open order can be cancelled"}">Cancel order</button>
      <button type="button" class="danger" data-action="close-order" ${can.close ? "" : "disabled"} title="${can.close ? "" : "Only a partially received order can be closed"}">Close order</button>
    </div>
    <p class="hint">Lines lock after the first receipt. Closed and cancelled orders accept no changes.</p>`;
}

function renderMain() {
  const order = selected && byNumber(selected);
  if (order) return renderDetail(order);
  $main.innerHTML = `<h2>Welcome</h2><p class="empty">Create an order to get started, or load the sample order from the form.</p>`;
}

function refresh() {
  renderList();
  renderMain();
}

function replace(updated) {
  persist(orders.map((o) => (o.number === updated.number ? updated : o)));
}

function downloadPdf(order) {
  const doc = buildLpoPdf(window.jspdf.jsPDF, order);
  const url = URL.createObjectURL(new Blob([doc.output("arraybuffer")], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${order.number}.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function run(action) {
  try {
    action();
  } catch (err) {
    if (!(err instanceof OrderError)) console.error(err);
    showMessage("error", errorsOf(err));
  }
}

$new.addEventListener("click", () => renderForm(null));

$list.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-number]");
  if (!btn) return;
  selected = btn.dataset.number;
  refresh();
});

$main.addEventListener("input", (e) => {
  if (e.target.closest("#order-form")) updatePreview();
});

$main.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  // Re-read storage so a change made in another tab is never overwritten.
  orders = loadOrders();
  const order = selected && byNumber(selected);
  switch (btn.dataset.action) {
    case "add-line":
      $main.querySelector("#lines").insertAdjacentHTML("beforeend", lineRowHtml());
      updatePreview();
      break;
    case "remove-line": {
      const rows = $main.querySelectorAll(".line-row");
      if (rows.length > 1) btn.closest("tr").remove();
      else showMessage("error", "An order needs at least one line.");
      updatePreview();
      break;
    }
    case "load-sample":
      renderForm(null, sampleInput(todayIso()));
      break;
    case "cancel-form":
      refresh();
      break;
    case "edit":
      run(() => renderForm(order));
      break;
    case "pdf":
      run(() => downloadPdf(order));
      break;
    case "cancel-order":
      if (confirm(`Cancel ${order.number}? This cannot be undone.`)) {
        run(() => {
          replace(cancelOrder(order));
          refresh();
        });
      }
      break;
    case "close-order":
      if (confirm(`Close ${order.number}? Pending quantities will no longer be receivable.`)) {
        run(() => {
          replace(closeOrder(order));
          refresh();
        });
      }
      break;
  }
});

$main.addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  // The number is taken from the freshest stored orders, in the same synchronous step as the save.
  orders = loadOrders();
  if (form.id === "order-form") {
    run(() => {
      const input = readForm();
      const editingNumber = form.dataset.editing;
      if (editingNumber) {
        const updated = updateOrder(byNumber(editingNumber), input);
        replace(updated);
        selected = updated.number;
      } else {
        const created = createOrder(input, orders);
        persist([...orders, created]);
        selected = created.number;
      }
      refresh();
    });
  } else if (form.classList.contains("receive")) {
    const order = byNumber(selected);
    const index = Number(form.dataset.line);
    const qty = form.querySelector("input").value;
    run(() => {
      replace(receiveGoods(order, index, qty));
      refresh();
      showMessage("ok", `Received ${qty} on line ${index + 1}.`);
    });
  }
});

refresh();
