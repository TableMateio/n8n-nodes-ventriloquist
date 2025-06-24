# IDI Converted Data

This folder contains IDI skip tracing data converted to match your existing Contacts.json structure.

## Files

### Final Combined Data
- `IDI_Contacts_Combined.json` - **457 total contacts** (123 owners + 334 relatives)
- `IDI_Contacts_Combined_addresses.json` - **486 total addresses**

*Note: Individual batch files were combined and removed for simplicity*

## Data Source
- **Source**: IDI CSV files (`IDI/Batch Template_out.csv` and `IDI/Batch Template No Address_out.csv`)
- **Conversion Script**: `idi_to_contacts_json_fixed.py`
- **Conversion Date**: June 23, 2025

## Key Features
- ✅ **Only IDI Data**: No auto-generated metadata or Record IDs
- ✅ **Property Integration**: PROP: fields integrated into Contact Addresses
- ✅ **Linked Structure**: Proper bidirectional linking between contacts and addresses
- ✅ **Relations**: Relatives linked to primary contacts
- ✅ **Native Format**: Matches existing Airtable Contacts.json structure exactly

## Structure
- **Contacts**: Person records with names, ages, phones, relations, etc.
- **Addresses**: Location records with property data, dates, contact links
- **Relations**: Bidirectional links between primary contacts and relatives

## Property Data Integration
Property information from IDI (PROP: fields) is embedded in addresses:
- Property Type (Residential/Commercial)
- Parcel ID
- Assessed Value
- Market Value  
- Square Feet

## Ready For
This data is ready for comparison analysis against your existing skip tracing system (System A vs IDI System B). 