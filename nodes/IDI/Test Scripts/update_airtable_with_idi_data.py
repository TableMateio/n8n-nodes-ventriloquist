#!/usr/bin/env python3
"""
Airtable IDI Data Updater
Updates Airtable with IDI contact data
- Creates/updates contacts in Contacts table
- Creates property records in Properties table
- Links properties to contacts
- Sets IDI checkbox to True
"""

import json
import os
import requests
import time
import re
from typing import Dict, List, Optional, Any

class AirtableIDIUpdater:
    def __init__(self, api_token: str, base_id: str):
        self.api_token = api_token
        self.base_id = base_id
        self.base_url = f"https://api.airtable.com/v0/{base_id}"
        self.headers = {
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json"
        }
        self.contacts_table = "tblqcysYQ2KEtaw6s"  # Contacts table
        self.properties_table = "tbll0FpyH3bF6pyOH"  # Properties table
        
    def clean_and_format_text(self, text: str, field_type: str = "general") -> str:
        """Clean and format text based on field type"""
        if not text or not isinstance(text, str):
            return text
            
        # Remove excessive whitespace
        text = text.strip()
        
        if field_type == "email":
            # Emails should be lowercase
            return text.lower()
        elif field_type == "name":
            # Names should be title case, but handle special cases
            # Handle cases like "McDowell", "O'Connor", etc.
            return self.title_case_name(text)
        elif field_type == "relation":
            # Relations should be title case
            return text.title()
        elif field_type == "address":
            # Addresses should be title case, but preserve certain abbreviations
            return self.title_case_address(text)
        elif field_type == "general":
            # General text - title case if all caps, otherwise preserve
            if text.isupper() and len(text) > 2:
                return text.title()
            return text
        else:
            return text
    
    def title_case_name(self, name: str) -> str:
        """Properly format names with special handling for prefixes"""
        if not name:
            return name
            
        # Convert to title case
        name = name.title()
        
        # Handle common name prefixes/patterns
        prefixes = ['Mc', 'Mac', 'O\'', 'De', 'Van', 'Von', 'La', 'Le']
        for prefix in prefixes:
            if name.startswith(prefix.title()):
                # Make the letter after the prefix uppercase
                rest = name[len(prefix):]
                if rest:
                    name = prefix + rest[0].upper() + rest[1:]
        
        return name
    
    def title_case_address(self, address: str) -> str:
        """Format addresses with proper capitalization"""
        if not address:
            return address
            
        # Split by spaces and handle each word
        words = address.split()
        formatted_words = []
        
        # Common abbreviations that should stay uppercase
        abbreviations = ['ST', 'AVE', 'RD', 'DR', 'LN', 'CT', 'PL', 'WAY', 'BLVD', 
                        'N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', 'US', 'RT', 'HWY']
        
        for word in words:
            if word.upper() in abbreviations:
                formatted_words.append(word.upper())
            elif word.isupper() and len(word) > 1:
                formatted_words.append(word.title())
            else:
                formatted_words.append(word)
                
        return ' '.join(formatted_words)
    
    def format_phone_number(self, phone: str) -> str:
        """Format phone number consistently"""
        if not phone:
            return phone
            
        # Remove all non-digit characters
        digits = re.sub(r'\D', '', phone)
        
        # Format as (XXX) XXX-XXXX if we have 10 digits
        if len(digits) == 10:
            return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
        elif len(digits) == 11 and digits[0] == '1':
            # Handle 1-XXX-XXX-XXXX format
            return f"({digits[1:4]}) {digits[4:7]}-{digits[7:]}"
        else:
            # Return original if we can't parse it properly
            return phone
        
    def make_request(self, method: str, url: str, data: Dict = None) -> Dict:
        """Make API request with error handling and rate limiting"""
        time.sleep(0.2)  # Rate limiting - Airtable allows 5 requests per second
        
        try:
            if method.upper() == 'GET':
                response = requests.get(url, headers=self.headers)
            elif method.upper() == 'POST':
                response = requests.post(url, headers=self.headers, json=data)
            elif method.upper() == 'PATCH':
                response = requests.patch(url, headers=self.headers, json=data)
            else:
                raise ValueError(f"Unsupported method: {method}")
            
            response.raise_for_status()
            return response.json()
            
        except requests.exceptions.RequestException as e:
            print(f"API request failed: {e}")
            if hasattr(e, 'response') and e.response is not None:
                print(f"Response: {e.response.text}")
            raise
    
    def find_existing_contact(self, contact_data: Dict) -> Optional[Dict]:
        """Find existing contact using upsert-style matching on First Name + Last Name"""
        first_name = (contact_data.get("First Name") or "").strip()
        last_name = (contact_data.get("Last Name") or "").strip()
        
        if not first_name or not last_name:
            return None
        
        # Search for contacts with matching first and last name (case-insensitive)
        matches = self._search_contacts_by_name(first_name, last_name)
        
        if matches:
            # If we found matches, check if any are the same person
            for contact in matches:
                if self._is_same_person(contact_data, contact):
                    return contact
        
        return None
    
    def _search_contacts_by_name(self, first_name: str, last_name: str) -> List[Dict]:
        """Search for contacts by first and last name using Airtable formula"""
        # Use UPPER() function in Airtable to do case-insensitive matching
        filter_formula = f"AND(UPPER({{First Name}})=UPPER('{first_name}'), UPPER({{Last Name}})=UPPER('{last_name}'))"
        
        url = f"{self.base_url}/{self.contacts_table}"
        params = {
            "filterByFormula": filter_formula,
            "maxRecords": 10,
            "fields": ["First Name", "Last Name", "Middle Name", "Suffix", "Age", "Phone", "Email", "Relation to Owner", "Foreclosures"]
        }
        
        try:
            response = requests.get(url, headers=self.headers, params=params)
            response.raise_for_status()
            data = response.json()
            
            matches = data.get("records", [])
            print(f"  Found {len(matches)} existing contacts with name: {first_name} {last_name}")
            
            return matches
            
        except requests.exceptions.RequestException as e:
            print(f"Error searching contacts: {e}")
            return []
    
    def _is_same_person(self, new_contact: Dict, existing_contact: Dict) -> bool:
        """Simple upsert logic: First+Last name match + age check"""
        new_fields = new_contact
        existing_fields = existing_contact.get("fields", {})
        
        new_age = new_fields.get("Age")
        existing_age = existing_fields.get("Age")
        
        # If both have ages and they're significantly different, different people
        if new_age and existing_age and abs(new_age - existing_age) > 5:
            print(f"  Age difference too large: {new_age} vs {existing_age} - different people")
            return False
        
        # Same First+Last name and no age conflict = same person
        print(f"  Same name, age compatible - same person")
        return True
    
    def _merge_contact_data(self, new_contact: Dict, existing_contact: Dict) -> Dict:
        """Merge data from new contact into existing contact, keeping the best information"""
        existing_fields = existing_contact.get("fields", {})
        
        # Start with a clean slate and only add non-computed fields
        merged_fields = {
            "IDI": True,
            "Traced": True,
            "Entity Type": "Person"
        }
        
        # Copy existing non-computed fields
        excluded_fields = [
            "Contact", "Record ID", "ID", "Full Name", "First and Last", 
            "Middle Initial", "Addresses", "Communications", "Own", "Foreclosures",
            "Auction (from Foreclosures)", "Claims", "Loans"
        ]
        
        for field, value in existing_fields.items():
            if field not in excluded_fields:
                merged_fields[field] = value
        
        # Fields to merge (prefer non-empty, more recent, or more complete data)
        # Exclude computed/formula fields that can't be set via API
        merge_fields = [
            "First Name", "Last Name", "Middle Name", "Suffix", "Age", 
            "Phone", "Email", "Relation to Owner", "Company Name", "Maiden Name",
            "Deceased", "Bankruptcy", "Sex", "Birth Year", "DOB", "In Jail"
        ]
        
        for field in merge_fields:
                
            new_value = new_contact.get(field)
            existing_value = existing_fields.get(field)
            
            # PRESERVE EXISTING DATA - only update if existing is truly empty
            if self._is_field_empty(existing_value) and new_value:
                if field == "Phone":
                    merged_fields[field] = self.format_phone_number(new_value)
                else:
                    merged_fields[field] = self.clean_and_format_text(new_value, self._get_field_type(field))
                print(f"    Adding {field}: '{existing_value}' → '{new_value}'")
            elif existing_value:
                # Keep existing value
                merged_fields[field] = existing_value
                print(f"    Preserving existing {field}: '{existing_value}'")
        
        return merged_fields
    
    def _is_field_empty(self, value) -> bool:
        """Check if a field value is truly empty (None, empty string, zero for age)"""
        if value is None:
            return True
        if isinstance(value, str) and value.strip() == "":
            return True
        if isinstance(value, (int, float)) and value == 0:
            return True
        return False
    
    def update_contact_relations_only(self, contact_record_id: str, idi_contact: Dict, contact_id_mapping: Dict[int, str]) -> bool:
        """Update only the Relations field for an existing contact"""
        try:
            # Handle Relations field - map IDI relation IDs to Airtable record IDs
            relation_record_ids = []
            if contact_id_mapping and idi_contact.get("Relations"):
                for relation_id in idi_contact["Relations"]:
                    if relation_id in contact_id_mapping:
                        relation_record_ids.append(contact_id_mapping[relation_id])
                        print(f"    Linking to relation ID {relation_id} → {contact_id_mapping[relation_id]}")
            
            if relation_record_ids:
                # Update only the Relations field
                url = f"{self.base_url}/{self.contacts_table}/{contact_record_id}"
                data = {
                    "fields": {
                        "Relations": relation_record_ids
                    }
                }
                result = self.make_request("PATCH", url, data)
                print(f"    Set {len(relation_record_ids)} relations")
                return True
            else:
                print(f"    No relations to set")
                return True
                
        except Exception as e:
            print(f"    Error updating relations: {e}")
            return False
    
    def update_bidirectional_relations(self, all_contacts_with_ids: List[tuple], contact_id_mapping: Dict[int, str]) -> int:
        """Update relations bidirectionally for all contacts in the network"""
        relations_updated = 0
        
        # Create a reverse mapping to find who should be related to whom
        for idi_contact, _ in all_contacts_with_ids:
            if idi_contact['ID'] in contact_id_mapping and idi_contact.get('Relations'):
                contact_record_id = contact_id_mapping[idi_contact['ID']]
                
                # Get all the people this person should be related to
                relation_record_ids = []
                for relation_id in idi_contact['Relations']:
                    if relation_id in contact_id_mapping:
                        relation_record_ids.append(contact_id_mapping[relation_id])
                
                if relation_record_ids:
                    print(f"    Setting {len(relation_record_ids)} relations for {idi_contact.get('First Name', '')} {idi_contact.get('Last Name', '')}")
                    
                    # Update this person's relations
                    url = f"{self.base_url}/{self.contacts_table}/{contact_record_id}"
                    data = {
                        "fields": {
                            "Relations": relation_record_ids
                        }
                    }
                    try:
                        result = self.make_request("PATCH", url, data)
                        relations_updated += 1
                    except Exception as e:
                        print(f"    Error updating relations for {idi_contact.get('First Name', '')} {idi_contact.get('Last Name', '')}: {e}")
        
        return relations_updated
    
    def _get_field_type(self, field_name: str) -> str:
        """Get the field type for formatting"""
        if field_name in ["First Name", "Last Name", "Middle Name", "Maiden Name"]:
            return "name"
        elif field_name == "Email":
            return "email"
        elif field_name == "Relation to Owner":
            return "relation"
        else:
            return "general"
    
    def create_property_record(self, property_data: Dict, contact_record_id: str) -> Optional[str]:
        """Create a property record in Properties table"""
        # Map property data to Airtable fields
        airtable_fields = {
            "IDI": True,  # Set IDI checkbox
            "Contacts": [contact_record_id]  # Link to contact
        }
        
        # Map address fields to correct Airtable field names with proper formatting
        if property_data.get("Street 1"):
            airtable_fields["Street 1"] = self.clean_and_format_text(property_data["Street 1"], "address")
        if property_data.get("City"):
            airtable_fields["City"] = self.clean_and_format_text(property_data["City"], "general")
        if property_data.get("State"):
            airtable_fields["State"] = property_data["State"].upper() if property_data["State"] else None
        if property_data.get("Zip Code"):
            airtable_fields["Zip Code"] = property_data["Zip Code"]
        if property_data.get("County"):
            airtable_fields["County"] = self.clean_and_format_text(property_data["County"], "general")
        
        # Set property type for IDI addresses
        airtable_fields["Type"] = "Contact"  # From schema: 'Foreclosed', 'Main', 'Secondary', 'Contact'
        
        # Map property-specific fields (only mapping fields that exist in the Properties table)
        # Note: Assessed Value, Market Value, Purchase Amount, Square Feet, Purchase Date, Parcel ID
        # are not fields in the current Properties table schema, so we skip them for now
        # You can add these fields to your Airtable Properties table if needed
        
        # Map additional address components if available with proper formatting
        if property_data.get("Street Number"):
            airtable_fields["Street Number"] = property_data["Street Number"]
        if property_data.get("Street Name"):
            airtable_fields["Street Name"] = self.clean_and_format_text(property_data["Street Name"], "address")
        if property_data.get("Street Suffix"):
            airtable_fields["Street Suffix"] = property_data["Street Suffix"].upper() if property_data["Street Suffix"] else None
        if property_data.get("Property Type"):
            airtable_fields["Property Type"] = self.clean_and_format_text(property_data["Property Type"], "general")
        
        # Create the record
        data = {
            "fields": airtable_fields
        }
        
        try:
            url = f"{self.base_url}/{self.properties_table}"
            result = self.make_request("POST", url, data)
            return result["id"]
            
        except Exception as e:
            print(f"Error creating property record: {e}")
            return None
    
    def find_owner_foreclosures(self, idi_contact: Dict, all_idi_contacts: List[Dict]) -> List[str]:
        """Find the owner's Foreclosures for a relative"""
        relation_to_owner = idi_contact.get("Relation to Owner", "").strip()
        # If this person IS the owner, get their existing foreclosures from Airtable
        if relation_to_owner.lower() == "owner":
            # Try to find existing contact to get their foreclosures
            existing_contact = self.find_existing_contact(idi_contact)
            if existing_contact:
                existing_fields = existing_contact.get("fields", {})
                foreclosures = existing_fields.get("Foreclosures", [])
                return foreclosures
            return []
        
        # If this is a relative, find the owner in the same family
        # Look through the Relations to find the owner
        relations = idi_contact.get("Relations", [])
        for relation_id in relations:
            # Find the related contact
            related_contact = next((c for c in all_idi_contacts if c.get("ID") == relation_id), None)
            if related_contact:
                related_relation = related_contact.get("Relation to Owner", "").strip().lower()
                if related_relation == "owner":
                    # Found the owner, get their foreclosures from Airtable
                    existing_owner = self.find_existing_contact(related_contact)
                    if existing_owner:
                        existing_fields = existing_owner.get("fields", {})
                        foreclosures = existing_fields.get("Foreclosures", [])
                        if foreclosures:
                            print(f"    Copying {len(foreclosures)} foreclosures from owner")
                            return foreclosures
        return []
    
    def update_or_create_contact(self, idi_contact: Dict, contact_id_mapping: Dict[int, str] = None, all_idi_contacts: List[Dict] = None) -> Optional[str]:
        """Update existing contact or create new one"""
        first_name = idi_contact.get("First Name", "")
        last_name = idi_contact.get("Last Name", "")
        
        if not first_name and not last_name:
            print("Skipping contact with no name")
            return None
        
        print(f"Processing contact: {first_name} {last_name}")
        
        # Check if contact already exists using sophisticated matching
        existing_contact = self.find_existing_contact(idi_contact)
        
        # Prepare contact fields for Airtable
        contact_fields = {
            "IDI": True,  # Set IDI checkbox
            "Traced": True,
            "Entity Type": "Person"
        }
        
        # Map basic contact fields with proper formatting
        if first_name:
            contact_fields["First Name"] = self.clean_and_format_text(first_name, "name")
        if last_name:
            contact_fields["Last Name"] = self.clean_and_format_text(last_name, "name")
        if idi_contact.get("Middle Name"):
            contact_fields["Middle Name"] = self.clean_and_format_text(idi_contact["Middle Name"], "name")
        if idi_contact.get("Suffix"):
            contact_fields["Suffix"] = self.clean_and_format_text(idi_contact["Suffix"], "general")
        if idi_contact.get("Age"):
            contact_fields["Age"] = idi_contact["Age"]
        if idi_contact.get("Phone"):
            contact_fields["Phone"] = self.format_phone_number(idi_contact["Phone"])
        if idi_contact.get("Email"):
            contact_fields["Email"] = self.clean_and_format_text(idi_contact["Email"], "email")
        if idi_contact.get("Relation to Owner"):
            contact_fields["Relation to Owner"] = self.clean_and_format_text(idi_contact["Relation to Owner"], "relation")
        if idi_contact.get("Company Name"):
            contact_fields["Company Name"] = self.clean_and_format_text(idi_contact["Company Name"], "general")
        if idi_contact.get("Maiden Name"):
            contact_fields["Maiden Name"] = self.clean_and_format_text(idi_contact["Maiden Name"], "name")
        
        # Handle boolean fields
        if idi_contact.get("Deceased") is not None:
            contact_fields["Deceased"] = idi_contact["Deceased"]
        if idi_contact.get("Bankruptcy") is not None:
            contact_fields["Bankruptcy"] = idi_contact["Bankruptcy"]
        
        # Handle Foreclosures - copy from owner if this is a relative
        if all_idi_contacts:
            owner_foreclosures = self.find_owner_foreclosures(idi_contact, all_idi_contacts)
            if owner_foreclosures:
                contact_fields["Foreclosures"] = owner_foreclosures
                print(f"    Adding {len(owner_foreclosures)} foreclosures from owner")
        
        # Handle Relations field - map IDI relation IDs to Airtable record IDs
        if contact_id_mapping and idi_contact.get("Relations"):
            relation_record_ids = []
            for relation_id in idi_contact["Relations"]:
                if relation_id in contact_id_mapping:
                    relation_record_ids.append(contact_id_mapping[relation_id])
                    print(f"  Linking to relation ID {relation_id} → {contact_id_mapping[relation_id]}")
            
            if relation_record_ids:
                contact_fields["Relations"] = relation_record_ids
                print(f"  Setting {len(relation_record_ids)} relations")
        
        # Note: Full Name and First and Last are formula fields in Airtable - they compute automatically
        # So we don't set them manually
        
        try:
            if existing_contact:
                # Merge data and update existing contact
                print(f"Found existing contact: {existing_contact['id']}")
                merged_fields = self._merge_contact_data(idi_contact, existing_contact)
                
                # Add relations if provided
                if contact_id_mapping and idi_contact.get("Relations"):
                    relation_record_ids = []
                    for relation_id in idi_contact["Relations"]:
                        if relation_id in contact_id_mapping:
                            relation_record_ids.append(contact_id_mapping[relation_id])
                            print(f"  Linking to relation ID {relation_id} → {contact_id_mapping[relation_id]}")
                    
                    if relation_record_ids:
                        merged_fields["Relations"] = relation_record_ids
                        print(f"  Setting {len(relation_record_ids)} relations")
                
                # Add foreclosures if provided
                if all_idi_contacts:
                    owner_foreclosures = self.find_owner_foreclosures(idi_contact, all_idi_contacts)
                    existing_foreclosures = existing_contact.get("fields", {}).get("Foreclosures", [])
                    if owner_foreclosures and len(existing_foreclosures) == 0:
                        merged_fields["Foreclosures"] = owner_foreclosures
                        print(f"  Adding {len(owner_foreclosures)} foreclosures from owner")
                
                print(f"Updating existing contact with merged data")
                url = f"{self.base_url}/{self.contacts_table}/{existing_contact['id']}"
                data = {"fields": merged_fields}
                result = self.make_request("PATCH", url, data)
                contact_record_id = existing_contact['id']
            else:
                # Create new contact with formatted data
                print("Creating new contact")
                url = f"{self.base_url}/{self.contacts_table}"
                data = {"fields": contact_fields}
                result = self.make_request("POST", url, data)
                contact_record_id = result["id"]
            
            print(f"Contact processed successfully: {contact_record_id}")
            
            # Process properties (Contact Addresses)
            contact_addresses = idi_contact.get("Contact Addresses", [])
            if contact_addresses:
                print(f"Processing {len(contact_addresses)} properties...")
                property_ids = []
                
                for i, property_data in enumerate(contact_addresses):
                    print(f"  Creating property {i+1}...")
                    property_id = self.create_property_record(property_data, contact_record_id)
                    if property_id:
                        property_ids.append(property_id)
                        print(f"  Property created: {property_id}")
                
                # Link properties to contact using Contact Addresses field
                if property_ids:
                    print(f"Linking {len(property_ids)} properties to contact...")
                    try:
                        # Update contact with property links
                        update_data = {
                            "fields": {
                                "Contact Addresses": property_ids  # Correct field name from schema
                            }
                        }
                        url = f"{self.base_url}/{self.contacts_table}/{contact_record_id}"
                        self.make_request("PATCH", url, update_data)
                        print("Properties linked successfully")
                    except Exception as e:
                        print(f"Warning: Could not link properties to contact: {e}")
            
            return contact_record_id
            
        except Exception as e:
            print(f"Error processing contact: {e}")
            return None
    
    def test_single_contact(self, idi_contacts_file: str, contact_index: int = 0):
        """Test with a single contact"""
        print(f"Loading IDI contacts from {idi_contacts_file}")
        
        with open(idi_contacts_file, 'r', encoding='utf-8') as file:
            idi_contacts = json.load(file)
        
        if contact_index >= len(idi_contacts):
            print(f"Error: Contact index {contact_index} out of range (max: {len(idi_contacts)-1})")
            return
        
        test_contact = idi_contacts[contact_index]
        
        print(f"\n=== TESTING WITH CONTACT {contact_index} ===")
        print(f"Name: {test_contact.get('First Name', '')} {test_contact.get('Last Name', '')}")
        print(f"Age: {test_contact.get('Age', 'N/A')}")
        print(f"Addresses: {len(test_contact.get('Contact Addresses', []))}")
        print(f"Relations: {len(test_contact.get('Relations', []))}")
        
        # Process the contact
        contact_id = self.update_or_create_contact(test_contact)
        
        if contact_id:
            print(f"\n✅ Successfully processed contact: {contact_id}")
        else:
            print(f"\n❌ Failed to process contact")

def main():
    # Configuration - UPDATE THESE VALUES
    API_TOKEN = os.getenv("AIRTABLE_API_TOKEN", "patPlJs2npm1zcFDw.451fb983e05c30333083d0a788ca4466a94217f66f41eb74f713f15068cc354b")
    BASE_ID = os.getenv("AIRTABLE_BASE_ID", "appZMhZh6hDrzAnuV")
    
    if API_TOKEN == "YOUR_API_TOKEN_HERE" or BASE_ID == "YOUR_BASE_ID_HERE":
        print("❌ Please set your Airtable API token and Base ID")
        print("You can set them as environment variables:")
        print("export AIRTABLE_API_TOKEN='your_token_here'")
        print("export AIRTABLE_BASE_ID='your_base_id_here'")
        print()
        print("Or edit the script directly")
        return
    
    # File path
    idi_contacts_file = "IDI_Converted_Data/IDI_Contacts_Combined.json"
    
    if not os.path.exists(idi_contacts_file):
        print(f"❌ Error: {idi_contacts_file} not found!")
        return
    
    # Create updater and test with first contact
    updater = AirtableIDIUpdater(API_TOKEN, BASE_ID)
    
    # Test with contact index 0 (first contact)
    # You can change this to test different contacts
    updater.test_single_contact(idi_contacts_file, contact_index=0)

if __name__ == "__main__":
    main() 