#!/usr/bin/env python3
"""
IDI CSV to Contacts JSON Normalizer
Transforms IDI skip tracing CSV data into the same JSON structure as existing Contacts.json
"""

import csv
import json
import re
from datetime import datetime
from typing import Dict, List, Any, Optional
import uuid

class IDIToContactsConverter:
    def __init__(self):
        self.contact_id_counter = 1
        self.address_id_counter = 1
        self.contacts = []
        self.addresses = []
        
    def generate_contact_id(self) -> str:
        """Generate a unique contact ID in Airtable format"""
        return f"rec{uuid.uuid4().hex[:14]}"
    
    def generate_address_id(self) -> str:
        """Generate a unique address ID in Airtable format"""
        return f"rec{uuid.uuid4().hex[:14]}"
    
    def clean_name(self, name: str) -> str:
        """Clean and standardize name strings"""
        if not name or name.strip() == "":
            return ""
        return name.strip().title()
    
    def parse_date(self, date_str: str) -> Optional[str]:
        """Parse date strings from IDI format to ISO format"""
        if not date_str or date_str.strip() == "":
            return None
        try:
            # Try different date formats that might appear in IDI data
            for fmt in ["%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y"]:
                try:
                    parsed = datetime.strptime(date_str.strip(), fmt)
                    return parsed.isoformat() + ".000Z"
                except ValueError:
                    continue
        except:
            pass
        return None
    
    def yn_to_bool(self, yn_value: str) -> bool:
        """Convert Y/N/U values to boolean"""
        return yn_value.strip().upper() == "Y"
    
    def calculate_birth_year(self, age_str: str) -> Optional[int]:
        """Calculate birth year from age"""
        try:
            age = int(age_str)
            if age > 0:
                return datetime.now().year - age
        except:
            pass
        return None
    
    def format_phone(self, phone: str) -> str:
        """Format phone number consistently"""
        if not phone:
            return ""
        # Remove all non-digits
        digits = re.sub(r'\D', '', phone)
        if len(digits) == 10:
            return f"({digits[:3]}){digits[3:6]}-{digits[6:]}"
        elif len(digits) == 11 and digits[0] == '1':
            return f"({digits[1:4]}){digits[4:7]}-{digits[7:]}"
        return phone
    
    def create_contact_display_name(self, first: str, last: str, contact_id: int) -> str:
        """Create display name in format: firstname-lastname-id"""
        first_clean = first.lower().replace(" ", "-") if first else ""
        last_clean = last.lower().replace(" ", "-") if last else ""
        return f"{first_clean}-{last_clean}-{contact_id}"
    
    def create_address_record(self, street: str, city: str, state: str, zip_code: str, 
                            county: str = "", address_type: str = "Contact",
                            first_seen: str = "", last_seen: str = "") -> Dict[str, Any]:
        """Create an address record in the expected format"""
        address_id = self.generate_address_id()
        self.address_id_counter += 1
        
        # Parse street into components
        street_number = ""
        street_name = ""
        street_suffix = ""
        
        if street:
            parts = street.strip().split()
            if parts and parts[0].isdigit():
                street_number = parts[0]
                remaining = " ".join(parts[1:])
                # Simple suffix detection
                suffixes = ["ST", "STREET", "AVE", "AVENUE", "RD", "ROAD", "LN", "LANE", "DR", "DRIVE", "CT", "COURT"]
                for suffix in suffixes:
                    if remaining.upper().endswith(suffix):
                        street_suffix = suffix
                        street_name = remaining[:-len(suffix)].strip()
                        break
                else:
                    street_name = remaining
            else:
                street_name = street
        
        full_address = f"{self.address_id_counter} - {street} - {city}" if street and city else ""
        
        address_record = {
            "id": address_id,
            "createdTime": datetime.now().isoformat() + ".000Z",
            "Address": full_address,
            "Street 1": street,
            "City": city,
            "State": state,
            "Zip Code": zip_code,
            "Type": address_type,
            "ID": self.address_id_counter,
            "Country": "USA",
            "Record ID": address_id,
            "Contacts": [],  # Will be populated when linking
            "County": county
        }
        
        # Add street components if available
        if street_number:
            address_record["Street Number"] = street_number
        if street_name:
            address_record["Street Name"] = street_name
        if street_suffix:
            address_record["Street Suffix"] = street_suffix
        
        # Add date fields if available
        if first_seen:
            address_record["First Seen"] = self.parse_date(first_seen)
        if last_seen:
            address_record["Last Seen"] = self.parse_date(last_seen)
        
        return address_record
    
    def create_contact_record(self, first_name: str, last_name: str, middle_name: str = "",
                            age: str = "", phone: str = "", email: str = "",
                            relation_to_owner: str = "", deceased: str = "",
                            bankruptcy: str = "") -> Dict[str, Any]:
        """Create a contact record in the expected format"""
        contact_id = self.generate_contact_id()
        self.contact_id_counter += 1
        
        # Clean names
        first_clean = self.clean_name(first_name)
        last_clean = self.clean_name(last_name)
        middle_clean = self.clean_name(middle_name)
        
        # Create display name
        display_name = self.create_contact_display_name(first_clean, last_clean, self.contact_id_counter)
        
        # Build full name
        full_name_parts = [first_clean]
        if middle_clean:
            full_name_parts.append(middle_clean)
        full_name_parts.append(last_clean)
        full_name = " ".join(filter(None, full_name_parts))
        
        # Create contact record
        contact = {
            "id": contact_id,
            "createdTime": datetime.now().isoformat() + ".000Z",
            "Contact": display_name,
            "Entity Type": "Person",
            "First Name": first_clean,
            "Last Name": last_clean,
            "Full Name": full_name,
            "First and Last": f"{first_clean} {last_clean}",
            "ID": self.contact_id_counter,
            "Record ID": contact_id,
            "Traced": True,
            "Relations": [],
            "Contact Addresses": [],
            "Foreclosures": [],
            "Own": []
        }
        
        # Add optional fields
        if middle_clean:
            contact["Middle Name"] = middle_clean
            contact["Middle Initial"] = middle_clean[0] if middle_clean else ""
        
        if age and age.isdigit():
            contact["Age"] = int(age)
            birth_year = self.calculate_birth_year(age)
            if birth_year:
                contact["Birth Year"] = birth_year
        
        if phone:
            contact["Phone"] = self.format_phone(phone)
        
        if email:
            contact["Email"] = email
        
        if relation_to_owner:
            contact["Relation to Owner"] = relation_to_owner
        
        if deceased:
            contact["Deceased"] = self.yn_to_bool(deceased)
        
        if bankruptcy:
            contact["Bankruptcy"] = self.yn_to_bool(bankruptcy)
        
        # Add sex if determinable (basic logic)
        contact["Sex"] = self.guess_sex(first_clean)
        
        return contact
    
    def guess_sex(self, first_name: str) -> str:
        """Basic sex guessing based on common names"""
        if not first_name:
            return "U"
        
        # Very basic logic - could be enhanced with a name database
        male_names = ["james", "john", "robert", "michael", "william", "david", "richard", "joseph", "thomas", "daniel"]
        female_names = ["mary", "patricia", "jennifer", "linda", "elizabeth", "barbara", "susan", "jessica", "sarah", "karen"]
        
        name_lower = first_name.lower()
        if name_lower in male_names:
            return "M"
        elif name_lower in female_names:
            return "F"
        else:
            return "U"
    
    def process_idi_row(self, row: Dict[str, str]) -> Dict[str, List[Dict[str, Any]]]:
        """Process a single IDI CSV row and return contacts and addresses"""
        contacts = []
        addresses = []
        
        # Create primary contact (the searched person)
        primary_contact = self.create_contact_record(
            first_name=row.get("INPUT: First Name", ""),
            last_name=row.get("INPUT: Last Name", ""),
            age=row.get("DOB: Age", ""),
            phone=row.get("PH: Phone1", ""),
            relation_to_owner="Owner",
            deceased=row.get("DEC: Deceased (Y/N/U)", ""),
            bankruptcy=row.get("BNK: Bankrupt (Y/N/U)", "")
        )
        contacts.append(primary_contact)
        
        # Create primary address if available
        if row.get("ADD: Address1"):
            primary_address = self.create_address_record(
                street=row.get("ADD: Address1", ""),
                city=row.get("ADD: Address1 City", ""),
                state=row.get("ADD: Address1 State", ""),
                zip_code=row.get("ADD: Address1 Zip", ""),
                county=row.get("ADD: Address1 County", ""),
                first_seen=row.get("ADD: Address1 First Seen", ""),
                last_seen=row.get("ADD: Address1 Last Seen", "")
            )
            primary_address["Contacts"].append(primary_contact["id"])
            primary_contact["Contact Addresses"].append(primary_address["id"])
            addresses.append(primary_address)
        
        # Process relatives (REL1-REL5)
        for i in range(1, 6):
            rel_first = row.get(f"REL{i}: First Name", "")
            rel_last = row.get(f"REL{i}: Last Name", "")
            
            if rel_first and rel_last:
                # Create relative contact
                relative_contact = self.create_contact_record(
                    first_name=rel_first,
                    last_name=rel_last,
                    middle_name=row.get(f"REL{i}: Middle Name", ""),
                    age=row.get(f"REL{i}: Age", ""),
                    phone=row.get(f"REL{i}: Phone 1", ""),
                    email=row.get(f"REL{i}: Email 1", ""),
                    relation_to_owner=row.get(f"REL{i}: Likely Relationship", "")
                )
                
                # Link relatives bidirectionally
                primary_contact["Relations"].append(relative_contact["id"])
                relative_contact["Relations"].append(primary_contact["id"])
                
                contacts.append(relative_contact)
                
                # Create relative address if available
                rel_address = row.get(f"REL{i}: Address", "")
                rel_city = row.get(f"REL{i}: City", "")
                rel_state = row.get(f"REL{i}: State", "")
                rel_zip = row.get(f"REL{i}: Zip", "")
                
                if rel_address:
                    relative_address = self.create_address_record(
                        street=rel_address,
                        city=rel_city,
                        state=rel_state,
                        zip_code=rel_zip
                    )
                    relative_address["Contacts"].append(relative_contact["id"])
                    relative_contact["Contact Addresses"].append(relative_address["id"])
                    addresses.append(relative_address)
        
        return {
            "contacts": contacts,
            "addresses": addresses
        }
    
    def convert_idi_csv_to_contacts_json(self, csv_file_path: str, output_file_path: str):
        """Convert IDI CSV file to Contacts JSON format"""
        all_contacts = []
        all_addresses = []
        
        with open(csv_file_path, 'r', encoding='utf-8') as file:
            reader = csv.DictReader(file)
            
            for row in reader:
                result = self.process_idi_row(row)
                all_contacts.extend(result["contacts"])
                all_addresses.extend(result["addresses"])
        
        # Write contacts JSON
        with open(output_file_path, 'w', encoding='utf-8') as file:
            json.dump(all_contacts, file, indent=2, ensure_ascii=False)
        
        # Write addresses JSON (optional separate file)
        addresses_file = output_file_path.replace('.json', '_addresses.json')
        with open(addresses_file, 'w', encoding='utf-8') as file:
            json.dump(all_addresses, file, indent=2, ensure_ascii=False)
        
        print(f"✅ Converted {len(all_contacts)} contacts and {len(all_addresses)} addresses")
        print(f"📄 Contacts saved to: {output_file_path}")
        print(f"📄 Addresses saved to: {addresses_file}")
        
        return {
            "contacts": all_contacts,
            "addresses": all_addresses,
            "stats": {
                "total_contacts": len(all_contacts),
                "total_addresses": len(all_addresses),
                "primary_contacts": len([c for c in all_contacts if c.get("Relation to Owner") == "Owner"]),
                "relatives": len([c for c in all_contacts if c.get("Relation to Owner") != "Owner"])
            }
        }

if __name__ == "__main__":
    converter = IDIToContactsConverter()
    
    # Convert both IDI CSV files
    idi_files = [
        "IDI/Batch Template_out.csv",
        "IDI/Batch Template No Address_out.csv"
    ]
    
    for idi_file in idi_files:
        output_file = f"IDI_Contacts_{idi_file.split('/')[-1].replace('.csv', '.json')}"
        try:
            result = converter.convert_idi_csv_to_contacts_json(idi_file, output_file)
            print(f"\n📊 Stats for {idi_file}:")
            print(f"   - Primary contacts: {result['stats']['primary_contacts']}")
            print(f"   - Relatives: {result['stats']['relatives']}")
            print(f"   - Total addresses: {result['stats']['total_addresses']}")
        except Exception as e:
            print(f"❌ Error processing {idi_file}: {e}") 