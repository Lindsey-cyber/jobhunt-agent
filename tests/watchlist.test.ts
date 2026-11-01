import { describe, expect, it } from "vitest";
import { loadWatchlist } from "../src/sources/fetch.ts";

describe("config/watchlist.yaml", () => {
  // A numeric board name (YAML reads it as a number) once broke jh daily before any fetch ran.
  it("parses, with unique Greenhouse boards", () => {
    const w = loadWatchlist();
    const boards = w.greenhouse.map((g) => g.board.toLowerCase());
    expect(new Set(boards).size).toBe(boards.length);
  });
});
