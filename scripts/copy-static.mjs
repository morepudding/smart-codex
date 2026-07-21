import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const destination = path.join(root, "dist", "ui");
await mkdir(destination, { recursive: true });
await cp(path.join(root, "src", "ui"), destination, { recursive: true });

