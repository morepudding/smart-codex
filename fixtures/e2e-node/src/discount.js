export function discountRate(customer) {
  return customer.vip ? 20 : 0;
}
