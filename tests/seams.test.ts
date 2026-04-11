import { describe, expect, it } from "vitest";
import {
  classifyChecklistItemSeam,
  classifyProofSeam,
  classifyRequestedSeam,
  seamSatisfiesRequest,
  supportWorkClarification,
} from "../src/seams.ts";

describe("seams", () => {
  it("classifies HTTP-facing requests and checklist items", () => {
    expect(classifyRequestedSeam("POST /api/links creates a short link")).toBe("business_http");
    expect(classifyChecklistItemSeam("GET /[slug] redirects to the stored destination.")).toBe("business_http");
  });

  it("classifies support-oriented helper checks as internal support", () => {
    expect(classifyChecklistItemSeam("The SQLite schema stores links with a unique slug column.")).toBe("internal_support");
    expect(
      classifyProofSeam({ testFiles: ["src/lib/server/utils/slug.spec.ts"] })
    ).toBe("internal_support");
  });

  it("prefers business seams when proof files target routes", () => {
    expect(
      classifyProofSeam({ testFiles: ["src/routes/api/links/+server.test.ts"] })
    ).toBe("business_http");
  });

  it("treats HTTP proof as satisfying UI and HTTP business requests", () => {
    expect(seamSatisfiesRequest("business_http", "business_http")).toBe(true);
    expect(seamSatisfiesRequest("business_ui", "business_http")).toBe(true);
    expect(seamSatisfiesRequest("business_http", "internal_support")).toBe(false);
  });

  it("flags support-only stories that should be folded under a business slice", () => {
    expect(
      supportWorkClarification(
        "Set up a SQLite database with links and clicks tables via Drizzle ORM.",
        ["The schema defines the links and clicks tables."]
      )
    ).toEqual({
      reason:
        "This request reads like support work or scaffolding, not a user-visible feature slice. Decide whether it should be folded under the first business behavior it enables, or whether you intentionally need a dedicated internal contract cycle.",
      issue:
        "The request is entirely support work right now. Prefer proving it through the first user-visible behavior it enables instead of creating a standalone feature slice for schema, migrations, or setup chores.",
      questions: [
        "Which user-visible feature should this support first, so RED can prove the behavior through that slice?",
        "If you want a dedicated support-work cycle, what internal contract or risk must it prove beyond setting up schema, migrations, or tooling?",
      ],
    });
  });

  it("allows explicit internal-risk requests to stay as support slices", () => {
    expect(
      supportWorkClarification(
        "Add a database-layer migration check that must preserve data integrity during upgrade.",
        ["A migration preserves existing link rows during upgrade."]
      )
    ).toBeNull();
  });
});
