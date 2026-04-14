# Temperature Conversion API

An HTTP API for converting between Celsius, Fahrenheit, and Kelvin.

## User Stories

### US-1: Single conversion

**Story**
As an API consumer
I want to convert a temperature between supported scales
So that I can use the service for one-off conversions

**Acceptance Criteria**
- `GET /convert?from=C&to=F&value=100` returns the converted value
- Support all 6 direction pairs (`C`, `F`, and `K` in any combination)
- Return a response containing `from`, `to`, `input`, and `result`

**Additional Notes**
- Example response: `{ "from": "C", "to": "F", "input": 100, "result": 212 }`

### US-2: Input validation

**Story**
As an API consumer
I want invalid requests to fail clearly
So that I can correct bad input quickly

**Acceptance Criteria**
- Return 400 for invalid scale names (not `C`, `F`, or `K`)
- Return 400 for non-numeric or missing values
- Return 400 for missing `from` or `to` parameters

**Additional Notes**
- Example error response: `{ "error": "Invalid scale: X" }`

### US-3: Batch conversion

**Story**
As an API consumer
I want to submit multiple conversions in one request
So that I can process batches efficiently

**Acceptance Criteria**
- `POST /convert` accepts a JSON array of conversion requests
- Each item uses the shape `{ "from": "C", "to": "F", "value": 100 }`
- Return an array of results in the same order
- Individual failures do not block others and should return inline errors

**Additional Notes**
- Mixed-success batch responses are expected behavior
