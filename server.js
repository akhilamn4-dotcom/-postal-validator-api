const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const COUNTRIES_DIR = path.join(__dirname, 'data', 'countries');
const STATE_RANGES_DIR = path.join(__dirname, 'data', 'state-ranges');

// ---- Load all country/state config into memory at startup ----
// Adding a new country later = drop a new JSON file in these two folders.
// No code changes needed.

function loadJsonDir(dir) {
  const result = {};
  if (!fs.existsSync(dir)) return result;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const key = (data.countryName || path.basename(file, '.json')).trim().toUpperCase();
    result[key] = data;
  }
  return result;
}

let countryConfigs = loadJsonDir(COUNTRIES_DIR);
let stateRangeConfigs = loadJsonDir(STATE_RANGES_DIR);

function reloadData() {
  countryConfigs = loadJsonDir(COUNTRIES_DIR);
  stateRangeConfigs = loadJsonDir(STATE_RANGES_DIR);
}

// ---- Core validation logic ----

function validatePostalCode({ country, state, postalCode }) {
  const response = {
    valid: true,
    errors: [],
    warnings: []
  };

  if (!country || !postalCode) {
    response.valid = false;
    response.errors.push('country and postalCode are required fields.');
    return response;
  }

  const countryKey = country.trim().toUpperCase();
  const countryConfig = countryConfigs[countryKey];

  if (!countryConfig) {
    // Unknown country: we have no rules for it, so we don't block it.
    // The caller (Salesforce/Odoo/etc) decides how to treat "unsupported".
    response.valid = true;
    response.warnings.push(`No validation rules configured for country "${country}". Skipped format/state checks.`);
    return response;
  }

  // 1. Country-level format check
  const regex = new RegExp(countryConfig.regexPattern);
  const trimmedPostal = postalCode.trim();
  if (!regex.test(trimmedPostal)) {
    response.valid = false;
    response.errors.push(countryConfig.errorMessage || `Invalid postal code format for ${countryConfig.countryName}.`);
    return response; // no point checking state range against a malformed code
  }

  // 2. State-level range check (only if state was supplied and we have range data)
  if (state && stateRangeConfigs[countryKey]) {
    const stateKey = state.trim().toUpperCase();
    const prefix = parseInt(trimmedPostal.substring(0, 3), 10);

    const matchingEntries = stateRangeConfigs[countryKey].states.filter(
      s => s.stateName.trim().toUpperCase() === stateKey
    );

    if (matchingEntries.length === 0) {
      response.warnings.push(`No pincode-range data found for state "${state}" in ${countryConfig.countryName}. State check skipped.`);
    } else {
      const isInAnyRange = matchingEntries.some(
        entry => prefix >= entry.prefixStart && prefix <= entry.prefixEnd
      );

      if (!isInAnyRange) {
        response.valid = false;
        response.errors.push(
          `The postal code "${trimmedPostal}" does not match the selected state "${state}". Please verify the pincode and state.`
        );
      } else {
        const isOverlapZone = matchingEntries.some(
          entry => entry.isOverlap && prefix >= entry.prefixStart && prefix <= entry.prefixEnd
        );
        if (isOverlapZone) {
          response.warnings.push(
            `This pincode range is shared between multiple states (e.g. Telangana/Andhra Pradesh post-bifurcation). Match allowed, but consider manual review.`
          );
        }
      }
    }
  }

  return response;
}

// ---- Routes ----

app.post('/validate-postal-code', (req, res) => {
  const { country, state, postalCode } = req.body || {};
  const result = validatePostalCode({ country, state, postalCode });
  res.json(result);
});

app.get('/countries', (req, res) => {
  const list = Object.values(countryConfigs).map(c => ({
    countryName: c.countryName,
    countryCode: c.countryCode
  }));
  res.json(list);
});

app.get('/countries/:country/states', (req, res) => {
  const countryKey = req.params.country.trim().toUpperCase();
  const config = stateRangeConfigs[countryKey];
  if (!config) {
    return res.status(404).json({ error: `No state range data for "${req.params.country}".` });
  }
  res.json(config.states);
});

app.post('/admin/reload', (req, res) => {
  reloadData();
  res.json({ status: 'reloaded' });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Postal validation API running on port ${PORT}`);
});
