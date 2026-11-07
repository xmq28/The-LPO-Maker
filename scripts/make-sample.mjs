import { writeFileSync } from "node:fs";
import { jsPDF } from "jspdf";
import { createOrder, receiveGoods } from "../src/order.js";
import { sampleInput } from "../src/sample.js";
import { buildLpoPdf } from "../src/pdf.js";

// Sample order from the brief, with part of the goods received so the
// ordered / received / pending columns and the status are visible.
let order = createOrder(sampleInput("2026-11-07"), []);
order = receiveGoods(order, 0, "3");
order = receiveGoods(order, 2, "10");

const doc = buildLpoPdf(jsPDF, order);
const out = new URL("../sample/LPO-2026-0001.pdf", import.meta.url);
writeFileSync(out, Buffer.from(doc.output("arraybuffer")));
console.log(`Wrote sample/${order.number}.pdf (${order.status})`);
