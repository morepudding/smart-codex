import { discountRate } from "./discount.js";

export function invoiceTotal(lines, customer = { vip: false }) {
  const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  return subtotal - subtotal * discountRate(customer) / 100;
}
