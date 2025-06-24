#!/usr/bin/env python3
"""
IDI CSV to Contacts JSON Normalizer (COMPLETE MAPPING VERSION)
Transforms IDI skip tracing CSV data into contact-focused JSON structure matching Airtable Contacts.json
Creates separate contact records for main person and relatives, linked via Relations field
Handles multiple addresses, phones, emails per person with property data
"""

import csv
import json
import re
import random
import string
from datetime import datetime
from typing import Dict, List, Any, Optional
import uuid

class IDIToContactsConverter:
    def __init__(self):
        self.contact_id_counter = 1
        self.unique_id_counter = 1
        self.address_id_counter = 1
        self.all_contacts = []
        
    def generate_contact_id(self) -> str:
        """Generate a unique contact ID in Airtable format"""
        return f"rec{uuid.uuid4().hex[:14].upper()}"
        
    def generate_unique_id(self) -> int:
        """Generate a unique integer ID for relations linking"""
        unique_id = self.unique_id_counter
        self.unique_id_counter += 1
        return unique_id
        
    def generate_address_id(self) -> str:
        """Generate a unique letter-based address ID"""
        letters = ''.join(random.choices(string.ascii_uppercase, k=6))
        return f"addr{letters}"
        
    def clean_name(self, name: str) -> str:
        """Clean and format a name"""
        if not name:
            return ""
        return name.strip().title()
    
    def parse_date(self, date_str: str) -> Optional[str]:
        """Parse various date formats into ISO format"""
        if not date_str or not date_str.strip():
            return None
            
        # Common date patterns
        patterns = [
            "%m/%d/%Y",
            "%m/%d/%y", 
            "%Y-%m-%d",
            "%m-%d-%Y"
        ]
        
        for pattern in patterns:
            try:
                parsed = datetime.strptime(date_str.strip(), pattern)
                return parsed.strftime("%Y-%m-%d")
            except ValueError:
                continue
        return None
    
    def yn_to_bool(self, yn_value: str) -> bool:
        """Convert Y/N string to boolean, with U or empty as False"""
        if not yn_value:
            return False
        
        clean_value = yn_value.strip().upper()
        if clean_value == 'Y':
            return True
        else:  # 'N', 'U', or other values
            return False
    
    def format_phone(self, phone: str) -> str:
        """Format phone number consistently"""
        if not phone:
            return ""
        
        # Remove all non-digits
        digits = re.sub(r'\D', '', phone)
        
        # Format as (XXX) XXX-XXXX if 10 digits
        if len(digits) == 10:
            return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
        elif len(digits) == 11 and digits[0] == '1':
            return f"({digits[1:4]}) {digits[4:7]}-{digits[7:]}"
        else:
            return phone  # Return original if can't format
    
    def create_contact_display_name(self, first: str, last: str, contact_id: int) -> str:
        """Create contact display name"""
        name_parts = []
        if first:
            name_parts.append(first.lower())
        if last:
            name_parts.append(last.lower())
        name_str = "-".join(name_parts) if name_parts else "contact"
        return f"{name_str}-{contact_id}"
    
    def get_first_non_empty(self, *values) -> str:
        """Get first non-empty value from a list"""
        for value in values:
            if value and value.strip():
                return value.strip()
        return ""
    
    def create_contact_address(self, street: str, city: str, state: str, zip_code: str, 
                             county: str = "", first_seen: str = "", last_seen: str = "",
                             address_type: str = "Contact", **extra_fields) -> Optional[Dict[str, Any]]:
        """Create a contact address sub-object with property data support"""
        if not street and not city:
            return None
            
        # Parse street into components
        street_number = ""
        street_name = ""
        street_suffix = ""
        
        if street:
            parts = street.strip().split()
            if parts and parts[0].replace(',', '').isdigit():
                street_number = parts[0].replace(',', '')
                remaining = " ".join(parts[1:])
                # Simple suffix detection
                suffixes = ["ST", "STREET", "AVE", "AVENUE", "RD", "ROAD", "LN", "LANE", 
                          "DR", "DRIVE", "CT", "COURT", "BLVD", "BOULEVARD", "PL", "PLACE"]
                for suffix in suffixes:
                    if remaining.upper().endswith(suffix):
                        street_suffix = suffix
                        street_name = remaining[:-len(suffix)].strip()
                        break
                else:
                    street_name = remaining
            else:
                street_name = street
        
        full_address = f"{street} - {city}" if street and city else street or city
        
        address = {
            "id": self.generate_address_id(),
            "createdTime": datetime.now().isoformat() + ".000Z",
            "Type": address_type,
            "Country": "USA",
            "Foreclosure": [],
            "Record ID": None,
            "Contacts": [],
            "Latitude": None,
            "Longitude": None,
            "Property Type": None
        }
        
        # Add standard address fields if they have data
        if full_address:
            address["Address"] = full_address
        if street:
            address["Street 1"] = street
        if city:
            address["City"] = city
        if state:
            address["State"] = state
        if zip_code:
            address["Zip Code"] = zip_code
        if county:
            address["County"] = county
        if street_number:
            address["Street Number"] = street_number
        if street_name:
            address["Street Name"] = street_name
        if street_suffix:
            address["Street Suffix"] = street_suffix
        
        # Add date fields if available
        if first_seen:
            parsed_date = self.parse_date(first_seen)
            if parsed_date:
                address["First Seen"] = parsed_date
        if last_seen:
            parsed_date = self.parse_date(last_seen)
            if parsed_date:
                address["Last Seen"] = parsed_date
        
        # Add extra property fields
        for key, value in extra_fields.items():
            if value and str(value).strip():
                address[key] = value
        
        return address

    def create_contact_record(self, first_name: str, last_name: str, middle_name: str = "",
                            age: str = "", phone: str = "", email: str = "",
                            relation_to_owner: str = "Owner", deceased: str = "",
                            bankruptcy: str = "", suffix: str = "", 
                            contact_addresses: List[Dict] = None,
                            related_contact_ids: List[int] = None,
                            sex: str = "") -> Dict[str, Any]:
        """Create a contact record in the Airtable format"""
        
        if contact_addresses is None:
            contact_addresses = []
        if related_contact_ids is None:
            related_contact_ids = []
            
        # Generate unique ID for this contact
        unique_id = self.generate_unique_id()
        
        # Clean names
        first_clean = self.clean_name(first_name)
        last_clean = self.clean_name(last_name)
        middle_clean = self.clean_name(middle_name)
        suffix_clean = self.clean_name(suffix)
        
        # Create display name
        display_name = self.create_contact_display_name(first_clean, last_clean, unique_id)
        
        # Build full name
        full_name_parts = [first_clean]
        if middle_clean:
            full_name_parts.append(middle_clean)
        full_name_parts.append(last_clean)
        if suffix_clean:
            full_name_parts.append(suffix_clean)
        full_name = " ".join(filter(None, full_name_parts))
        
        # Create contact record with ALL Airtable fields (including null ones)
        contact = {
            "id": self.generate_contact_id(),
            "createdTime": datetime.now().isoformat() + ".000Z",
            "Entity Type": "Person",
            "ID": unique_id,
            "Relations": related_contact_ids,
            "Contact Addresses": contact_addresses,
            "Foreclosures": [],
            "Own": [],
            "Record ID": None,
            "Traced": True,  # Assume traced since we got data from IDI
            # Include ALL possible fields, even if null
            "Contact": None,
            "First Name": None,
            "Last Name": None,
            "Middle Name": None,
            "Middle Initial": None,
            "Suffix": None,
            "Full Name": None,
            "First and Last": None,
            "Relation to Owner": None,
            "Age": None,
            "Birth Year": None,
            "Phone": None,
            "Email": None,
            "Sex": None,
            "Deceased": None,
            "Bankruptcy": None,
            "Maiden Name": None,
            "Company Name": None,
            "DOB": None,
            "Addresses": None,
            "In Jail": None,
            "Obituary": None,
            "Obituary URL": None,
            "Communications": None,
            "Claims": None,
            "Loans": None,
            "Auction (from Foreclosures)": None
        }
        
        # Only add fields if they have actual data
        if display_name:
            contact["Contact"] = display_name
        if first_clean:
            contact["First Name"] = first_clean
        if last_clean:
            contact["Last Name"] = last_clean
        if middle_clean:
            contact["Middle Name"] = middle_clean
            contact["Middle Initial"] = middle_clean[0]
        if suffix_clean:
            contact["Suffix"] = suffix_clean
        
        # Add computed fields only if we have the base data
        if first_clean and last_clean:
            contact["Full Name"] = full_name
            contact["First and Last"] = f"{first_clean} {last_clean}"
        
        if relation_to_owner:
            contact["Relation to Owner"] = relation_to_owner
            
        if age and age.isdigit():
            age_int = int(age)
            contact["Age"] = age_int
            # Calculate birth year correctly (current year - age)
            current_year = datetime.now().year
            contact["Birth Year"] = current_year - age_int
        
        if phone:
            contact["Phone"] = self.format_phone(phone)
        
        if email:
            contact["Email"] = email
            
        if sex:
            contact["Sex"] = sex
            
        # Handle boolean fields - always set them
        contact["Deceased"] = self.yn_to_bool(deceased)
        contact["Bankruptcy"] = self.yn_to_bool(bankruptcy)
        
        return contact, unique_id

    def process_idi_row(self, row: Dict[str, str]) -> List[Dict[str, Any]]:
        """Process a single IDI row and return list of contact records (main + relatives)"""
        contacts = []
        relation_ids = []
        
        # Extract main person data - prefer PROP fields, fallback to INPUT
        main_first = self.get_first_non_empty(
            row.get("PROP: First Name", ""),
            row.get("INPUT: First Name", "")
        )
        main_last = self.get_first_non_empty(
            row.get("PROP: Last Name", ""),
            row.get("INPUT: Last Name", "")
        )
        main_middle = row.get("PROP: Middle Initial", "")
        main_age = row.get("DOB: Age", "")
        main_deceased = row.get("DEC: Deceased (Y/N/U)", "")
        main_bankruptcy = row.get("BNK: Bankrupt (Y/N/U)", "")
        
        # Extract main person's contact info (use first available phone and email)
        main_phone = self.get_first_non_empty(
            row.get("PH: Phone1", ""),
            row.get("PH: Phone2", ""),
            row.get("PH: Phone3", ""),
            row.get("PH: Phone4", ""),
            row.get("PH: Phone5", "")
        )
        
        # Create main person's addresses
        main_addresses = []
        
        # Address 1: Current address (ADD section)
        current_street = row.get("ADD: Address1", "")
        current_city = row.get("ADD: Address1 City", "")
        current_state = row.get("ADD: Address1 State", "")
        current_zip = row.get("ADD: Address1 Zip", "")
        current_county = row.get("ADD: Address1 County", "")
        current_first_seen = row.get("ADD: Address1 First Seen", "")
        current_last_seen = row.get("ADD: Address1 Last Seen", "")
        
        if current_street or current_city:
            current_address = self.create_contact_address(
                current_street, current_city, current_state, current_zip, 
                current_county, current_first_seen, current_last_seen
            )
            if current_address:
                main_addresses.append(current_address)
        
        # Address 2: Property address (PROP section) with property data
        prop_street = row.get("PROP: Address Full", "")
        prop_city = row.get("PROP: City", "")
        prop_state = row.get("PROP: State", "")
        prop_zip = row.get("PROP: Zip", "")
        prop_county = row.get("PROP: County", "")
        
        if prop_street or prop_city:
            # Property-specific data
            prop_data = {
                "Assessed Value": row.get("PROP: Assessed Value", ""),
                "Market Value": row.get("PROP: Market Value", ""),
                "Purchase Date": row.get("PROP: Purchase Date", ""),
                "Purchase Amount": row.get("PROP: Purchase Amount", ""),
                "Square Feet": row.get("PROP: Square Feet", ""),
                "Lot Size": row.get("PROP: Lot Size", ""),
                "Parcel ID": row.get("PROP: Parcel ID Number", "")
            }
            
            prop_address = self.create_contact_address(
                prop_street, prop_city, prop_state, prop_zip, 
                prop_county, **prop_data
            )
            if prop_address:
                main_addresses.append(prop_address)
        
        # Process relatives (REL1-REL5) first to get their IDs
        for i in range(1, 6):
            rel_prefix = f"REL{i}: "
            rel_first = row.get(f"{rel_prefix}First Name", "")
            rel_last = row.get(f"{rel_prefix}Last Name", "")
            
            if rel_first or rel_last:  # Only create if we have name data
                rel_middle = row.get(f"{rel_prefix}Middle Name", "")
                rel_suffix = row.get(f"{rel_prefix}Suffix", "")
                rel_age = row.get(f"{rel_prefix}Age", "")
                rel_relationship = row.get(f"{rel_prefix}Likely Relationship", "")
                
                # Get first available phone and email for relative
                rel_phone = self.get_first_non_empty(
                    row.get(f"{rel_prefix}Phone 1", ""),
                    row.get(f"{rel_prefix}Phone 2", ""),
                    row.get(f"{rel_prefix}Phone 3", "")
                )
                rel_email = self.get_first_non_empty(
                    row.get(f"{rel_prefix}Email 1", ""),
                    row.get(f"{rel_prefix}Email 2", ""),
                    row.get(f"{rel_prefix}Email 3", "")
                )
                
                # Create relative's address if available
                rel_addresses = []
                rel_address_str = row.get(f"{rel_prefix}Address", "")
                rel_city = row.get(f"{rel_prefix}City", "")
                rel_state = row.get(f"{rel_prefix}State", "")
                rel_zip = row.get(f"{rel_prefix}Zip", "")
                
                if rel_address_str or rel_city:
                    rel_address = self.create_contact_address(
                        rel_address_str, rel_city, rel_state, rel_zip
                    )
                    if rel_address:
                        rel_addresses.append(rel_address)
                
                # Create relative contact
                rel_contact, rel_id = self.create_contact_record(
                    rel_first, rel_last, rel_middle, rel_age, rel_phone, rel_email,
                    rel_relationship, "", "", rel_suffix,  # deceased, bankruptcy, suffix
                    contact_addresses=rel_addresses
                )
                
                contacts.append(rel_contact)
                relation_ids.append(rel_id)
        
        # Now create main contact with relation IDs (only if we have name data)
        if main_first or main_last:
            main_contact, main_id = self.create_contact_record(
                main_first, main_last, main_middle, main_age, main_phone, "",
                "Owner", main_deceased, main_bankruptcy, 
                contact_addresses=main_addresses,
                related_contact_ids=relation_ids
            )
            
            # Add main contact ID to each relative's Relations
            for contact in contacts:
                contact["Relations"].append(main_id)
            
            # Add main contact first
            contacts.insert(0, main_contact)
        
        return contacts
    
    def convert_idi_csv_to_contacts_json(self, csv_file_path: str, output_file_path: str):
        """Convert IDI CSV file to contacts JSON format"""
        print(f"Converting {csv_file_path} to {output_file_path}")
        
        # Reset counters for each file
        self.contact_id_counter = 1
        self.unique_id_counter = 1
        all_contacts = []
        
        with open(csv_file_path, 'r', encoding='utf-8') as csvfile:
            reader = csv.DictReader(csvfile)
            
            for row_num, row in enumerate(reader, 1):
                try:
                    contacts = self.process_idi_row(row)
                    all_contacts.extend(contacts)
                    
                    if row_num % 10 == 0:
                        print(f"Processed {row_num} rows...")
                        
                except Exception as e:
                    print(f"Error processing row {row_num}: {e}")
                    continue
        
        # Write to JSON file
        with open(output_file_path, 'w', encoding='utf-8') as jsonfile:
            json.dump(all_contacts, jsonfile, indent=2, ensure_ascii=False)
        
        print(f"Conversion complete! Created {len(all_contacts)} contact records in {output_file_path}")
        return all_contacts
    
    def combine_batch_files(self, file1_path: str, file2_path: str, combined_output_path: str):
        """Combine two IDI batch files into one contacts JSON"""
        print("Combining batch files...")
        
        # Reset counters
        self.contact_id_counter = 1
        self.unique_id_counter = 1
        all_contacts = []
        
        # Process both files
        for csv_file_path in [file1_path, file2_path]:
            print(f"Processing {csv_file_path}...")
            
            with open(csv_file_path, 'r', encoding='utf-8') as csvfile:
                reader = csv.DictReader(csvfile)
                
                for row_num, row in enumerate(reader, 1):
                    try:
                        contacts = self.process_idi_row(row)
                        all_contacts.extend(contacts)
                        
                    except Exception as e:
                        print(f"Error processing row {row_num} in {csv_file_path}: {e}")
                        continue
        
        # Write combined results
        with open(combined_output_path, 'w', encoding='utf-8') as jsonfile:
            json.dump(all_contacts, jsonfile, indent=2, ensure_ascii=False)
        
        print(f"Combined files! Created {len(all_contacts)} total contact records in {combined_output_path}")
        return all_contacts

def main():
    converter = IDIToContactsConverter()
    
    # Define file paths
    csv_file1 = "IDI/Batch Template_out.csv"
    csv_file2 = "IDI/Batch Template No Address_out.csv"
    combined_output = "IDI_Converted_Data/IDI_Contacts_Combined.json"
    
    # Combine both batch files
    converter.combine_batch_files(csv_file1, csv_file2, combined_output)

if __name__ == "__main__":
    main() 