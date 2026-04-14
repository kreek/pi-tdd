# FizzBuzz

A FizzBuzz implementation with configurable rules.

## User Stories

### US-1: Classic FizzBuzz

**Story**
As a developer
I want classic FizzBuzz behavior
So that the baseline rules are implemented correctly

**Acceptance Criteria**
- Return "Fizz" for multiples of 3
- Return "Buzz" for multiples of 5
- Return "FizzBuzz" for multiples of both
- Return the number as a string otherwise

**Additional Notes**
- Return string output for all cases, including plain numbers

### US-2: Range output

**Story**
As a developer
I want to generate FizzBuzz output for a range
So that I can produce multiple results in one call

**Acceptance Criteria**
- Accept a start and end number (inclusive)
- Return an array/list of results for the range
- Start defaults to 1 if not provided

**Additional Notes**
- Preserve inclusive range semantics for both start and end

### US-3: Custom rules

**Story**
As a developer
I want configurable divisor-to-word rules
So that FizzBuzz behavior can be customized

**Acceptance Criteria**
- Accept custom divisor-word pairs (e.g. 7: "Bazz")
- Multiple rules combine in divisor order (lowest first)
- Custom rules replace the default 3/5 rules entirely

**Additional Notes**
- Use the provided custom rules instead of merging them with the defaults
