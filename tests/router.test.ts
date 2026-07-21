import { describe, expect, it } from "vitest";
import { routeRequest } from "../src/router.js";
import type { ProjectContext } from "../src/types.js";

const context: ProjectContext = {
  root: "C:\\project",
  docs: [],
  manifests: ["C:\\project\\package.json"],
  signals: ["node", "git"],
};

describe("routeRequest", () => {
  it("uses Luna low for a short mechanical request", () => {
    expect(routeRequest("Corrige cette faute de frappe", context).route).toBe("luna-low");
  });

  it("uses Terra medium for everyday implementation", () => {
    expect(routeRequest("Ajoute une page profil", context).route).toBe("terra-medium");
  });

  it("uses Sol high for architecture work", () => {
    expect(routeRequest("Analyse cette architecture et propose une migration", context).route).toBe("sol-high");
  });

  it("uses two Sol agents for critical cross-project work", () => {
    const result = routeRequest("Refactorise tout le projet sans regression", context);
    expect(result.route).toBe("sol-xhigh");
    expect(result.agentCount).toBe(2);
  });

  it("keeps pure analysis read-only", () => {
    expect(routeRequest("Analyse les performances", context).sandbox).toBe("read-only");
  });
});

