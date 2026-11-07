const KEY = "lpo-maker:orders:v1";

export function loadOrders() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveOrders(orders) {
  localStorage.setItem(KEY, JSON.stringify(orders));
}
