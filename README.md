# Postal Code Validation API (generic, multi-consumer)

A standalone REST API that validates a postal code against:
1. The country's format (regex)
2. The selected state's known pincode range (catches mismatches like "Karnataka" + a Mumbai pincode)

Knows nothing about Salesforce or Odoo — both just call it over HTTP.

## Run it

```bash
npm install
npm start
```

Runs on port 3000 by default (override with `PORT=xxxx npm start`).

## Endpoints

### `POST /validate-postal-code`
```json
{ "country": "India", "state": "Karnataka", "postalCode": "400001" }
```
Response:
```json
{
  "valid": false,
  "errors": ["The postal code \"400001\" does not match the selected state \"Karnataka\". Please verify the pincode and state."],
  "warnings": []
}
```

- `country` and `postalCode` are required. `state` is optional — if omitted, only the country format check runs.
- Unknown countries return `valid: true` with a warning (not blocked) — extend by adding data, see below.
- Overlapping state ranges (e.g. Telangana/Andhra Pradesh) return `valid: true` with a warning, not a hard failure.

### `GET /countries`
Lists countries currently configured.

### `GET /countries/:country/states`
Lists the state pincode ranges configured for that country.

### `POST /admin/reload`
Reloads the JSON config files without restarting the process (handy after editing data files on a running server).

## Adding a new country

No code changes needed:

1. Add `data/countries/<country>.json`:
   ```json
   { "countryName": "United States", "countryCode": "US", "regexPattern": "^\\d{5}(-\\d{4})?$", "errorMessage": "..." }
   ```
2. (Optional, for state-level checks) Add `data/state-ranges/<country>.json` following the same `states: [{ stateName, prefixStart, prefixEnd }]` shape used for India.
3. Restart the server or call `POST /admin/reload`.

## Integrating with Salesforce (Apex)

Do NOT call this synchronously inside a before-insert/before-update trigger — Apex triggers can't reliably make callouts mid-DML, and an API hiccup would block Account saves. Two safer patterns:

- **Recommended:** keep your existing `Postal_Code_Format__mdt` / new `State_Pincode_Range__mdt` as the fast local cache Apex reads from (like we built earlier), and have a scheduled/batch Apex job periodically call this API's `/countries/:country/states` endpoint to refresh that metadata. Validation stays instant and local; this API is the single source of truth that keeps the cache correct.
- **Alternative:** validate before the record ever reaches the trigger — e.g. an LWC or Flow screen calls this API synchronously while the user is still on the form, and shows the error inline before they even click Save.

## Integrating with Odoo (Python)

```python
import requests

resp = requests.post(
    "https://your-api-host/validate-postal-code",
    json={"country": partner.country_id.name, "state": partner.state_id.name, "postalCode": partner.zip},
    timeout=3
)
result = resp.json()
if not result["valid"]:
    raise ValidationError(result["errors"][0])
```

Add this inside an `@api.constrains('zip', 'state_id', 'country_id')` method on `res.partner`.

## Deploying

Any standard Node host works: Render, Railway, Heroku, a small EC2/VM, or a container behind your existing API gateway. Just make sure whichever domain you deploy to is added to Salesforce **Remote Site Settings** before Apex can call it.
