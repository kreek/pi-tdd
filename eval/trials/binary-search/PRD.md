# Binary Search

A library function that performs binary search on a sorted array, returning either the index or the insertion point.

## User Stories

### US-1: Search sorted array with insertion point

**Story**
As a developer
I want a function that searches a sorted number array for a target value
So that I can efficiently locate elements or determine where to insert them

**Acceptance Criteria**
- Returns the index of the target if found
- Returns the insertion index (where the target would go to maintain order) if not found
- Distinguish between "found" and "not found" in the return value
- Works on an empty array (insertion point is 0)
- Works on a single-element array
- Handles duplicates: returns any valid index for the target
