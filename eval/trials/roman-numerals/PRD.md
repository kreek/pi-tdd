# Roman Numeral Converter

A library function that converts integers to Roman numeral strings.

## User Stories

### US-1: Convert integers to Roman numerals

**Story**
As a developer
I want a function that converts a positive integer to its Roman numeral representation
So that I can display numbers in classical notation

**Acceptance Criteria**
- Converts basic values: 1 -> "I", 5 -> "V", 10 -> "X", 50 -> "L", 100 -> "C", 500 -> "D", 1000 -> "M"
- Handles subtractive notation: 4 -> "IV", 9 -> "IX", 40 -> "XL", 90 -> "XC", 400 -> "CD", 900 -> "CM"
- Handles compound values: 1994 -> "MCMXCIV", 3999 -> "MMMCMXCIX"
- Returns error or throws for values outside 1-3999
- Returns error or throws for non-integer input
