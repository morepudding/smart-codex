import assert from "node:assert/strict";
import test from "node:test";
import { add } from "../src/arithmetic.js";

test("add additionne deux nombres", () => {
  assert.equal(add(2, 3), 5);
});
