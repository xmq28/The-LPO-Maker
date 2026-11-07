# LPO Maker

A small web app that turns a purchase request into a Local Purchase Order (LPO) PDF and tracks the goods as they arrive. BHD, no login, no server database: orders live in the browser (`localStorage`).

Static site, no build step. Vanilla JS modules plus a vendored copy of [jsPDF](https://github.com/parallax/jsPDF) for the PDF.

## Run

```
npm install      # only needed for tests and the sample script
npm start        # http://localhost:5173
npm test         # node:test, no extra dependencies
npm run sample   # regenerates sample/LPO-2026-0001.pdf
```

Any static host works (GitHub Pages, Netlify). Serve the repo root.

## Rules as built

| Rule | Where |
|---|---|
| Money in BHD, 3 decimals, round half away from zero | `src/decimal.js` (BigInt fixed point, no floats) |
| Line net = qty x unit price less line discount, rounded once | `src/calc.js` `lineNet` |
| Document discount split across VAT rate groups by net, last group takes the leftover fraction | `src/calc.js` `computeTotals` |
| VAT per rate group after the discount, not per line | `src/calc.js` |
| Qty above zero, price zero or more, due date not before order date | `src/order.js` `validateInput` |
| Never receive past the ordered quantity; refuse and say how much is pending | `src/order.js` `receiveGoods` |
| Lines lock after the first receipt | `src/order.js` `updateOrder` |
| Open -> partial -> closed when everything is received. Open can cancel, partial can only close, closed and cancelled refuse everything | `src/order.js` |
| `LPO-year-0001`, no gaps within a year | `src/order.js` `nextSequence` (derived from stored orders, orders are never deleted, rejected input never takes a number) |
| PDF: buyer, supplier, number, dates, reference, ordered/received/pending per line, discount, VAT per rate, total, status | `src/pdf.js` |

## Decisions where the brief is open

- "Last group" is the last VAT rate group in order of first appearance on the lines.
- An open order cannot be closed (it is cancelled instead), and a partial order cannot be cancelled (it is closed instead).
- The order number year is the year of the order date. Editing an open order cannot move its order date to another year.
- The PDF uses the standard Latin fonts, so Arabic text is not rendered in the PDF.
- Data is per browser. Clearing site data removes the orders.

## Tests

`test/order.test.js` covers rounding, the sample order totals (net 1,426.455, total 1,510.262), discount allocation, per-group VAT, numbering, validation, receiving limits, locking and the status flow.
