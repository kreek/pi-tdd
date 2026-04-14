# Stack Calculator

A stack-based calculator library. Push numbers, apply operators, get results.

## User Stories

### US-1: Push and peek

**Story**
As a developer
I want to push values onto a stack and inspect the top value
So that the calculator has basic stack behavior

**Acceptance Criteria**
- Push numbers onto the stack
- Peek returns the top value without removing it
- Peek on empty stack throws or returns an error

**Additional Notes**
- Preserve stack state when peeking

### US-2: Binary operators

**Story**
As a developer
I want to apply binary operators to stack values
So that the calculator can perform arithmetic

**Acceptance Criteria**
- Apply `+`, `-`, `*`, and `/` operators
- Each operator pops two values, computes the result, and pushes it
- Stack underflow (fewer than 2 values) returns an error

**Additional Notes**
- Preserve standard operand ordering for subtraction and division

### US-3: Error handling

**Story**
As a developer
I want calculator errors to be explicit and safe
So that invalid operations do not corrupt state

**Acceptance Criteria**
- Division by zero returns a descriptive error
- Invalid operator returns an error
- Errors do not corrupt the stack state

**Additional Notes**
- Error paths should leave the stack in a valid state
