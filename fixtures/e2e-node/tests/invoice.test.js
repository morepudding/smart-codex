import assert from "node:assert/strict";
import test from "node:test";
import { invoiceTotal } from "../src/invoice.js";

test("calcule le total sans remise", () => {
  assert.equal(invoiceTotal([{ price: 10, quantity: 2 }]), 20);
});

test("applique vingt pour cent aux clients VIP", () => {
  assert.equal(invoiceTotal([{ price: 10, quantity: 2 }], { vip: true }), 16);
});
