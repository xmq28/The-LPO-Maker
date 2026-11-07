// The sample order from the brief. Dates are relative to the order date.
export function addDays(isoDate, days) {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function sampleInput(orderDate) {
  return {
    buyer: { name: "Dilmun Coastal Trading W.L.L.", address: "Manama, Kingdom of Bahrain", vat: "200000000000001" },
    supplier: { name: "Gulf Pipe Supplies W.L.L.", address: "Sitra, Kingdom of Bahrain", vat: "200000000000002" },
    reference: "DCT-REQ-0417",
    orderDate,
    dueDate: addDays(orderDate, 30),
    documentDiscount: "50.000",
    lines: [
      { description: "Chilled water dispenser, installed", unit: "each", qty: "3", price: "45.500", discountPct: "5", vatRate: "10" },
      { description: "Annual maintenance contract", unit: "each", qty: "1", price: "1200.000", discountPct: "", vatRate: "10" },
      { description: "Filter cartridge", unit: "each", qty: "24", price: "2.375", discountPct: "", vatRate: "10" },
      { description: "Copper piping", unit: "metre", qty: "12.750", price: "3.120", discountPct: "", vatRate: "0" },
    ],
  };
}
