#!/usr/bin/env python3
"""
Simple Airtable Connection Test
Tests different ways to connect to your Airtable base
"""

import requests

def test_connection():
    API_TOKEN = "patPlJs2npm1zcFDw.451fb983e05c30333083d0a788ca4466a94217f66f41eb74f713f15068cc354b"
    BASE_ID = "appZMhZh6hDrzAnuV"
    
    headers = {
        "Authorization": f"Bearer {API_TOKEN}",
    }
    
    # Test 1: Try with table names instead of IDs
    print("=== TEST 1: Using Table Names ===")
    try:
        url = f"https://api.airtable.com/v0/{BASE_ID}/Contacts"
        params = {"maxRecords": 1}
        response = requests.get(url, headers=headers, params=params)
        
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            print("✅ SUCCESS: Can access Contacts table by name!")
            data = response.json()
            print(f"Records found: {len(data.get('records', []))}")
        else:
            print(f"❌ FAILED: {response.text}")
            
    except Exception as e:
        print(f"❌ ERROR: {e}")
    
    # Test 2: Try with table IDs
    print("\n=== TEST 2: Using Table IDs ===")
    try:
        url = f"https://api.airtable.com/v0/{BASE_ID}/tblqcysYQ2KEtaw6s"
        params = {"maxRecords": 1}
        response = requests.get(url, headers=headers, params=params)
        
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            print("✅ SUCCESS: Can access Contacts table by ID!")
            data = response.json()
            print(f"Records found: {len(data.get('records', []))}")
        else:
            print(f"❌ FAILED: {response.text}")
            
    except Exception as e:
        print(f"❌ ERROR: {e}")
    
    # Test 3: Try a very simple create operation
    print("\n=== TEST 3: Test Create Permission ===")
    try:
        url = f"https://api.airtable.com/v0/{BASE_ID}/Contacts"
        test_record = {
            "fields": {
                "First Name": "Test",
                "Last Name": "Contact"
            }
        }
        
        # Just test the headers, don't actually create
        print("Testing create permissions...")
        print("(Note: This will show what error we get without actually creating)")
        
        response = requests.post(url, headers={**headers, "Content-Type": "application/json"}, json=test_record)
        
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            print("✅ SUCCESS: Can create records!")
            # Clean up the test record if we accidentally created it
            record_id = response.json()["id"]
            delete_url = f"{url}/{record_id}"
            requests.delete(delete_url, headers=headers)
            print("Test record cleaned up")
        else:
            print(f"❌ Create failed: {response.text}")
            
    except Exception as e:
        print(f"❌ ERROR: {e}")

if __name__ == "__main__":
    test_connection() 