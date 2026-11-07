import { roundDiv } from "./decimal.js";

const TEN_POW_10 = 10n ** 10n;

// Line net = qty x unit price, less the line discount, rounded once to 3 decimals.
// qty has scale 3, price scale 6 and discount percent scale 2 (5% = 500).
export function lineNet(line) {
  return roundDiv(line.qty * line.price * (10000n - line.disc), TEN_POW_10);
}

// lines: [{ qty, price, disc, vat }] as scaled BigInts. docDiscount: money BigInt (scale 3).
// The document discount is split across VAT rate groups by their net; the last
// group takes whatever fraction is left. VAT is computed per group after the discount.
export function computeTotals(lines, docDiscount) {
  const nets = lines.map(lineNet);
  const groups = [];
  lines.forEach((line, i) => {
    let group = groups.find((g) => g.rate === line.vat);
    if (!group) {
      group = { rate: line.vat, net: 0n };
      groups.push(group);
    }
    group.net += nets[i];
  });

  const subtotal = nets.reduce((sum, n) => sum + n, 0n);
  let allocated = 0n;
  groups.forEach((group, i) => {
    const isLast = i === groups.length - 1;
    group.discount = isLast
      ? docDiscount - allocated
      : subtotal === 0n
        ? 0n
        : roundDiv(docDiscount * group.net, subtotal);
    allocated += group.discount;
    group.taxable = group.net - group.discount;
    group.vatAmount = roundDiv(group.taxable * group.rate, 10000n);
  });

  const taxable = groups.reduce((sum, g) => sum + g.taxable, 0n);
  const vat = groups.reduce((sum, g) => sum + g.vatAmount, 0n);
  return { nets, groups, subtotal, docDiscount, taxable, vat, total: taxable + vat };
}
