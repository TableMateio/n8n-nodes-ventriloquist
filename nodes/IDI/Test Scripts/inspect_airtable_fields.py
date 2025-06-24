#!/usr/bin/env python3
"""
Airtable Field Inspector
Checks what fields exist in your Airtable tables
"""

import requests
import json

def inspect_airtable_base():
    API_TOKEN = "patPlJs2npm1zcFDw.451fb983e05c30333083d0a788ca4466a94217f66f41eb74f713f15068cc354b"
    BASE_ID = "appZMhZh6hDrzAnuV"
    
    headers = {
        "Authorization": f"Bearer {API_TOKEN}",
        "Content-Type": "application/json"
    }
    
    # Try to get base schema first
    try:
        print("=== CHECKING BASE SCHEMA ===")
        schema_url = f"https://api.airtable.com/v0/meta/bases/{BASE_ID}/tables"
        response = requests.get(schema_url, headers=headers)
        
        if response.status_code == 200:
            schema = response.json()
            print("✅ Base schema retrieved successfully!")
            
            for table in schema.get("tables", []):
                print(f"\n📋 Table: {table['name']} (ID: {table['id']})")
                print("Fields:")
                for field in table.get("fields", []):
                    print(f"  - {field['name']} ({field['type']})")
        else:
            print(f"❌ Schema request failed: {response.status_code}")
            print(f"Response: {response.text}")
            
    except Exception as e:
        print(f"❌ Error getting schema: {e}")
    
    # Try to read a few records from Contacts table
    try:
        print("\n=== CHECKING CONTACTS TABLE ===")
        contacts_url = f"https://api.airtable.com/v0/{BASE_ID}/tblqcysYQ2KEtaw6s"
        params = {"maxRecords": 3}
        
        response = requests.get(contacts_url, headers=headers, params=params)
        
        if response.status_code == 200:
            data = response.json()
            print("✅ Contacts table accessible!")
            print(f"Records found: {len(data.get('records', []))}")
            
            if data.get('records'):
                print("\nSample record fields:")
                sample_record = data['records'][0]
                for field_name in sample_record.get('fields', {}):
                    print(f"  - {field_name}")
        else:
            print(f"❌ Contacts table request failed: {response.status_code}")
            print(f"Response: {response.text}")
            
    except Exception as e:
        print(f"❌ Error accessing contacts table: {e}")
    
    # Try to read Properties table
    try:
        print("\n=== CHECKING PROPERTIES TABLE ===")
        properties_url = f"https://api.airtable.com/v0/{BASE_ID}/tbll0FpyH3bF6pyOH"
        params = {"maxRecords": 3}
        
        response = requests.get(properties_url, headers=headers, params=params)
        
        if response.status_code == 200:
            data = response.json()
            print("✅ Properties table accessible!")
            print(f"Records found: {len(data.get('records', []))}")
            
            if data.get('records'):
                print("\nSample record fields:")
                sample_record = data['records'][0]
                for field_name in sample_record.get('fields', {}):
                    print(f"  - {field_name}")
        else:
            print(f"❌ Properties table request failed: {response.status_code}")
            print(f"Response: {response.text}")
            
    except Exception as e:
        print(f"❌ Error accessing properties table: {e}")

if __name__ == "__main__":
    inspect_airtable_base() 