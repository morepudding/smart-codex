import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const destination = path.join(root, "dist", "ui");
await mkdir(destination, { recursive: true });
await cp(path.join(root, "src", "ui"), destination, { recursive: true });
const vendor = path.join(destination, "vendor");
await mkdir(vendor, { recursive: true });
await cp(path.join(root, "node_modules", "marked", "lib", "marked.umd.js"), path.join(vendor, "marked.umd.js"));
await cp(path.join(root, "node_modules", "dompurify", "dist", "purify.min.js"), path.join(vendor, "purify.min.js"));
await cp(path.join(root, "benchmark-priors-v1.json"), path.join(root, "dist", "benchmark-priors-v1.json"));
