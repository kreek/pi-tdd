Testing guidelines:
- Write or update the cheapest failing test that can prove one acceptance criterion at a time.
- Use unit tests for isolated logic and integration tests for boundaries, contracts, or wiring.
- Structure the test around observable behavior and externally meaningful outcomes. A test that reads back a static declaration, schema shape, or configuration constant is not proving behavior — it mirrors the source code. Test what the system does through the declaration, not the declaration itself.
- Exercise the real seam when the risk is at a boundary, and use mocks in ways that still expose that boundary behavior honestly.
- Let the first failing proving test for the current spec item define the proof target for this cycle.
- Make the failure clear enough that the missing behavior is obvious before moving to GREEN.
- If the test already passes, RED is not complete yet. Tighten or add a proving test until the current spec item fails once at the honest seam.
- Focus this RED cycle on the current spec item, and add further scenarios in later RED cycles unless they are required to prove this item.
