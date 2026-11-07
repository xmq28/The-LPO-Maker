import test from "node:test";
import assert from "node:assert/strict";
import { roundDiv, parseDecimal, formatDecimal, formatMoney } from "../src/decimal.js";
import { computeTotals } from "../src/calc.js";
import {
  createOrder, updateOrder, receiveGoods, cancelOrder, closeOrder, validateInput, totalsFor, STATUS, OrderError,
} from "../src/order.js";
import { sampleInput } from "../src/sample.js";

const sample = () => sampleInput("2026-11-07");
const fresh = () => createOrder(sample(), []);

test("rounding is half away from zero", () => {
  assert.equal(roundDiv(5n, 10n), 1n);
  assert.equal(roundDiv(4n, 10n), 0n);
  assert.equal(roundDiv(-5n, 10n), -1n);
  assert.equal(roundDiv(-4n, 10n), 0n);
});

test("decimal parsing is strict and exact", () => {
  assert.equal(parseDecimal("12.750", 3), 12750n);
  assert.equal(parseDecimal("0.1", 3), 100n);
  assert.equal(parseDecimal("1.2345", 3), null);
  assert.equal(parseDecimal("-1", 3), null);
  assert.equal(parseDecimal("abc", 3), null);
  assert.equal(formatDecimal(1510262n, 3, { group: true }), "1,510.262");
});

test("sample order totals are exact", () => {
  const order = fresh();
  const t = totalsFor(order);
  assert.deepEqual(t.nets.map(formatMoney), ["129.675", "1,200.000", "57.000", "39.780"]);
  assert.equal(formatMoney(t.subtotal), "1,426.455");
  assert.equal(t.groups.length, 2);
  const [ten, zero] = t.groups;
  assert.equal(formatMoney(ten.discount), "48.606");
  assert.equal(formatMoney(zero.discount), "1.394");
  assert.equal(formatMoney(ten.taxable), "1,338.069");
  assert.equal(formatMoney(ten.vatAmount), "133.807");
  assert.equal(formatMoney(zero.taxable), "38.386");
  assert.equal(formatMoney(zero.vatAmount), "0.000");
  assert.equal(formatMoney(t.total), "1,510.262");
});

test("the last group takes the leftover fraction so the discount always adds up", () => {
  const line = (price, vat) => ({ qty: 1000n, price, disc: 0n, vat });
  const lines = [line(1000000n, 1000n), line(1000000n, 500n), line(1000000n, 0n)];
  const t = computeTotals(lines, 100n);
  assert.equal(t.groups.reduce((s, g) => s + g.discount, 0n), 100n);
  assert.equal(t.groups[2].discount, 100n - t.groups[0].discount - t.groups[1].discount);
});

test("VAT is computed per rate group, not per line", () => {
  const line = { qty: 1000n, price: 1003000n, disc: 0n, vat: 1000n };
  const t = computeTotals([line, line, line], 0n);
  assert.equal(t.vat, 301n);
});

test("order numbers are sequential per year with no gaps", () => {
  const a = createOrder(sample(), []);
  const b = createOrder(sample(), [a]);
  const next = createOrder({ ...sample(), orderDate: "2027-01-02", dueDate: "2027-02-01" }, [a, b]);
  assert.deepEqual([a.number, b.number, next.number], ["LPO-2026-0001", "LPO-2026-0002", "LPO-2027-0001"]);
});

test("rejected input does not consume a number", () => {
  const a = createOrder(sample(), []);
  assert.throws(() => createOrder({ ...sample(), lines: [] }, [a]), OrderError);
  assert.equal(createOrder(sample(), [a]).number, "LPO-2026-0002");
});

test("validation rules", () => {
  const bad = (patch) => validateInput({ ...sample(), ...patch }).errors;
  assert.ok(bad({ dueDate: "2026-11-06" }).some((e) => /before the order date/.test(e)));
  assert.equal(bad({ dueDate: "2026-11-07" }).length, 0);
  const withLine = (patch) => bad({ documentDiscount: "0", lines: [{ ...sample().lines[0], ...patch }] });
  assert.ok(withLine({ qty: "0" }).some((e) => /quantity/.test(e)));
  assert.ok(withLine({ qty: "-2" }).some((e) => /quantity/.test(e)));
  assert.ok(withLine({ price: "-1" }).some((e) => /price/.test(e)));
  assert.equal(withLine({ price: "0" }).length, 0);
  assert.ok(bad({ documentDiscount: "99999" }).some((e) => /exceed/.test(e)));
});

test("receiving past the ordered quantity is refused and says how much is pending", () => {
  const order = receiveGoods(fresh(), 0, "2");
  assert.equal(order.status, STATUS.PARTIAL);
  assert.throws(() => receiveGoods(order, 0, "1.001"), /only 1\.000 pending/);
  assert.equal(order.lines[0].received, "2.000");
});

test("lines lock after the first receipt", () => {
  const order = receiveGoods(fresh(), 0, "1");
  assert.throws(() => updateOrder(order, sample()), /cannot be edited/);
  const open = fresh();
  assert.equal(updateOrder(open, { ...sample(), reference: "NEW" }).number, open.number);
});

test("status flow: open can cancel, partial can only close, finished refuses everything", () => {
  const open = fresh();
  assert.throws(() => closeOrder(open), OrderError);
  const partial = receiveGoods(open, 3, "12.750");
  assert.equal(partial.status, STATUS.PARTIAL);
  assert.throws(() => cancelOrder(partial), OrderError);
  const closed = closeOrder(partial);
  assert.equal(closed.status, STATUS.CLOSED);
  for (const op of [() => receiveGoods(closed, 0, "1"), () => cancelOrder(closed), () => closeOrder(closed), () => updateOrder(closed, sample())]) {
    assert.throws(op, OrderError);
  }
  const cancelled = cancelOrder(open);
  assert.equal(cancelled.status, STATUS.CANCELLED);
  assert.throws(() => receiveGoods(cancelled, 0, "1"), OrderError);
});

test("receiving everything closes the order automatically", () => {
  let order = fresh();
  order.lines.forEach((l, i) => {
    order = receiveGoods(order, i, l.qty);
  });
  assert.equal(order.status, STATUS.CLOSED);
});
